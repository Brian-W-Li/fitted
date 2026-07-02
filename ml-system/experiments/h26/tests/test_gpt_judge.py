"""Hermetic tests for the LLM-as-judge protocol (C4 / §8) — the OpenAI API is MOCKED.

Nothing here imports `openai` or touches the network: the judge's I/O is behind injected seams
(`JudgeClient`, `ContentProvider`), so the whole runner is driven on fakes. Coverage:

  - **parse robustness** — structured + free-text + adversarial/garbled judge output never silently
    mis-scores (the judge is untrusted free text);
  - the **K×2 → per-question collapse** rules (§8): both-order agreement, the plurality K-vote, the
    no-decision tie, and the drop-vs-inconsistent distinction, incl. the load-bearing reverse-order
    index remap;
  - the **scalar-only ledger invariant** (the §14 public-repo leak guard) — round-trips + refuses a
    free-text field;
  - **egress isolation** per arm (image-only sends no title, the text arm sends no image, §8);
  - the **two-stage paired bootstrap** (§11) propagates the judge's sample variance;
  - an end-to-end `run_arm` on a fake client + provider.

One real-API smoke test is skipped unless `H26_LIVE_JUDGE=1` (+ a key) — it is the only path that
ever spends a token. Reference: docs/plans/h26-compatibility-spike-v2.md §8 / §12 / §14 / §15.
"""

import json
import os

import pytest

import gpt_judge as gj
from data_loader import FitbQuestion
from gpt_judge import (
    INCONSISTENT_HALF,
    INCONSISTENT_MISS,
    ItemContent,
    JudgeResponse,
    JudgeSample,
    QuestionSamples,
    QuestionVerdict,
    build_messages,
    collapse_question,
)


# --------------------------------------------------------------------------- #
# parse_choice — structured, free-text, and adversarial
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "content,n,expected",
    [
        ('{"choice": "A"}', 4, 0),
        ('{"choice":"C"}', 4, 2),
        ('{"choice": 2}', 4, 1),                       # 1-based int -> index 1
        ('{"choice": 0}', 4, 0),                       # tolerate a 0-based 'A'
        ('I pick {"choice": "C"}', 4, 2),              # prose-wrapped JSON (embedded object)
        ("```json\n{\"choice\": \"D\"}\n```", 4, 3),   # code-fenced JSON
        ("B", 4, 1),                                   # bare letter
        ("a", 4, 0),                                   # bare lowercase letter
        ("B.", 4, 1),                                  # bare letter + trailing punctuation
        ("(3)", 4, 2),                                 # bare 1-based digit, wrapped
        ('"C"', 4, 2),                                 # bare quoted letter
    ],
)
def test_parse_choice_valid(content, n, expected):
    assert gj.parse_choice(content, n) == expected


@pytest.mark.parametrize(
    "content,n",
    [
        ("", 4),
        (None, 4),
        ("It depends on your taste.", 4),              # no label at all
        ('{"choice": "E"}', 4),                        # out of range at @4
        ('{"choice": 9}', 4),                          # out of range int
        ('{"choice": true}', 4),                       # bool is not a choice
        ("A or C could both work", 4),                 # prose, not a bare label -> drop (conservative)
        ("Options 2 and 4 are close", 4),              # prose with two numbers -> drop
        ('{"verdict": "A"}', 4),                       # wrong key + prose-embedded letter is NOT rescued
        ("the best is candidate a.", 4),               # prose with an embedded label -> drop, not rescued
        ("Candidate B fits best here.", 4),            # ditto: never scrape prose for a stray label
        ("The A-line skirt works.", 4),                # the 'A' in 'A-line' must NEVER count as choice A
    ],
)
def test_parse_choice_rejects(content, n):
    assert gj.parse_choice(content, n) is None


def test_parse_choice_structured_invalid_is_a_reject_not_a_fallthrough():
    # An explicit but out-of-range structured choice must REJECT, not fall through to a stray letter in
    # the surrounding prose (that would let a malformed structured answer be rescued by noise).
    assert gj.parse_choice('{"choice": "Z"} but maybe A', 4) is None


# --------------------------------------------------------------------------- #
# The K x 2 -> per-question collapse (§8)
# --------------------------------------------------------------------------- #
def _collapse(fwd, rev, correct, n=4):
    return collapse_question(fwd, rev, question_id="q", correct_index=correct, n_candidates=n)


def test_collapse_hit_requires_both_orders_agree_on_correct():
    # correct canonical index = 0; in the reversed presentation the answer sits at n-1-0 = 3, so a
    # judge that truly picks the answer returns as-presented index 3 in reverse. The remap must turn
    # that back into canonical 0 for the orders to agree -> this pins the reverse remap.
    v = _collapse([0, 0, 0], [3, 3, 3], correct=0)
    assert v.status == "hit"
    assert v.forward_verdict == 0 and v.reverse_verdict == 0


def test_collapse_consistent_wrong_is_a_miss():
    # both orders agree on canonical index 1, but the answer is 0 -> a clean (consistent) miss.
    v = _collapse([1, 1, 1], [2, 2, 2], correct=0)   # reverse as-presented 2 -> canonical 4-1-2 = 1
    assert v.status == "miss"


def test_collapse_orders_disagree_is_inconsistent():
    v = _collapse([0, 0, 0], [0, 0, 0], correct=0)   # reverse as-presented 0 -> canonical 3 != 0
    assert v.status == "inconsistent"


def test_collapse_no_decision_tie_is_inconsistent():
    # forward splits 2-2 (no plurality) -> no_decision; the question is inconsistent (counted a miss).
    v = _collapse([0, 0, 1, 1], [3, 3, 3, 3], correct=0)
    assert v.status == "inconsistent"


def test_collapse_dropped_when_an_order_has_no_parseable_sample():
    v = _collapse([None, None], [3, 3], correct=0)
    assert v.status == "dropped"


def test_collapse_plurality_vote_breaks_a_majority():
    # forward votes 0,0,1 -> plurality 0; reverse as-presented 3,3,2 -> canonical 0,0,1 -> plurality 0.
    v = _collapse([0, 0, 1], [3, 3, 2], correct=0)
    assert v.status == "hit"


# --------------------------------------------------------------------------- #
# The scalar-only ledger invariant (§14 public-repo leak guard)
# --------------------------------------------------------------------------- #
def _sample(choice=0, **kw):
    base = dict(
        question_id="o01", arm="image_only", order="forward", sample_index=0, choice=choice,
        retried=0, dropped=choice is None, model_snapshot="gpt-5.4-mini-2026-03-17",
        system_fingerprint=None, payload_log_sha256="a" * 64,
    )
    base.update(kw)
    return JudgeSample(**base)


def test_ledger_row_is_exactly_the_scalar_field_set():
    row = _sample().to_row()
    assert set(row) == set(gj.LEDGER_FIELDS)


def test_assert_scalar_only_rejects_free_text_leak():
    row = _sample().to_row()
    row["rationale"] = "this top and those jeans look great on the person in the photo"
    with pytest.raises(ValueError, match="non-scalar field"):
        gj.assert_scalar_only(row)


def test_assert_scalar_only_rejects_caption_and_image_keys():
    for leak in ("caption", "title", "image_b64"):
        row = _sample().to_row()
        row[leak] = "x"
        with pytest.raises(ValueError, match="non-scalar field"):
            gj.assert_scalar_only(row)


def test_ledger_write_read_roundtrip(tmp_path):
    path = str(tmp_path / "judge_runs.ndjson")
    samples = [_sample(choice=0), _sample(choice=None, dropped=True, order="reverse")]
    gj.write_ledger(path, samples)
    rows = gj.read_ledger(path)
    assert [r["choice"] for r in rows] == [0, None]
    # every committed line is a scalar-only object
    for line in open(path, encoding="utf-8"):
        if line.strip():
            assert set(json.loads(line)) == set(gj.LEDGER_FIELDS)


def test_write_ledger_refuses_a_bad_order_or_arm():
    with pytest.raises(ValueError, match="order must be"):
        _sample(order="sideways").to_row()
    with pytest.raises(ValueError, match="arm must be"):
        _sample(arm="audio_only").to_row()


def test_group_samples_dedups_a_rerun_keep_last():
    # the ledger is append-only; a resumed/re-run judge pass appends a SECOND set of rows for an
    # already-scored question. group_samples dedups keep-last on (order, sample_index) so K is NOT
    # doubled (a doubled K silently corrupts the plurality vote + the §11 two-stage variance).
    q = _question("o01")
    first = [_sample(order=o, sample_index=i, choice=(0 if o == "forward" else 3))
             for o in ("forward", "reverse") for i in range(2)]
    rerun = [_sample(order="forward", sample_index=0, choice=1)]   # re-run overwrites forward sample 0
    rows = [s.to_row() for s in first + rerun]
    per_q = gj.group_samples(rows, [q], arm="image_only", expected_k=2)
    assert len(per_q[0].forward) == 2 and len(per_q[0].reverse) == 2   # NOT 4 -> not doubled
    assert per_q[0].forward[0] == 1                                    # keep-last (the re-run value)


def test_group_samples_rejects_incomplete_or_wrong_k():
    q = _question("o01")
    forward_only = [_sample(order="forward", sample_index=0).to_row()]
    with pytest.raises(ValueError, match="incomplete/asymmetric"):
        gj.group_samples(forward_only, [q], arm="image_only")          # reverse missing -> fail loud
    both_k1 = [_sample(order="forward", sample_index=0, choice=0).to_row(),
               _sample(order="reverse", sample_index=0, choice=3).to_row()]
    with pytest.raises(ValueError, match="frozen K"):
        gj.group_samples(both_k1, [q], arm="image_only", expected_k=2)  # K=1 present but frozen K=2


# --------------------------------------------------------------------------- #
# Message-builder egress isolation per arm (§8 modality control)
# --------------------------------------------------------------------------- #
def _flatten(messages):
    parts = []
    for m in messages:
        if isinstance(m["content"], list):
            parts += m["content"]
    return parts


def _has_image(messages):
    return any(p.get("type") == "image_url" for p in _flatten(messages))


def _text_blob(messages):
    return " ".join(p.get("text", "") for p in _flatten(messages) if p.get("type") == "text")


def test_image_only_arm_sends_images_and_no_title():
    retained = [ItemContent("r1", image_b64="aW1n", title="a navy oxford shirt")]
    cands = [ItemContent("c1", image_b64="aW1n", title="white sneakers"),
             ItemContent("c2", image_b64="aW1n", title="black derby")]
    msgs = build_messages(retained, cands, "image_only")
    assert _has_image(msgs)
    assert "oxford" not in _text_blob(msgs) and "sneakers" not in _text_blob(msgs)  # NO title egress


def test_text_attribute_arm_sends_no_image():
    attrs = {"category": "top", "colors": "navy", "pattern": "solid"}
    retained = [ItemContent("r1", attributes=attrs)]
    cands = [ItemContent("c1", attributes=attrs), ItemContent("c2", attributes=attrs)]
    msgs = build_messages(retained, cands, "text_attribute")
    assert not _has_image(msgs)                                  # NO image egress in the text arm
    assert "navy" in _text_blob(msgs)


def test_image_title_arm_sends_both():
    retained = [ItemContent("r1", image_b64="aW1n", title="navy oxford")]
    cands = [ItemContent("c1", image_b64="aW1n", title="white sneakers"),
             ItemContent("c2", image_b64="aW1n", title="black derby")]
    msgs = build_messages(retained, cands, "image_title")
    assert _has_image(msgs) and "oxford" in _text_blob(msgs)


def test_item_payload_fails_loud_on_missing_field():
    with pytest.raises(ValueError, match="needs an image"):
        gj._item_payload(ItemContent("x", title="t"), "image_only")
    with pytest.raises(ValueError, match="needs structured attributes"):
        gj._item_payload(ItemContent("x", image_b64="aW1n"), "text_attribute")
    with pytest.raises(ValueError, match="unknown judge arm"):
        gj._item_payload(ItemContent("x"), "hologram")


def test_every_image_part_carries_detail_low_in_both_image_arms():
    # detail:"low" is part of the frozen envelope (judge_addendum image_detail): cost-neutral on the
    # 300x300 Polyvore images but load-bearing for the C5 closet arm (real phone photos at high/auto
    # balloon ~15x + invite server-side-resize nondeterminism). EVERY image part — retained AND
    # candidates, both image arms — must carry it; one unpinned part breaks the determinism envelope.
    retained = [ItemContent("r1", image_b64="aW1n", title="t1")]
    cands = [ItemContent("c1", image_b64="aW1n", title="t2"),
             ItemContent("c2", image_b64="aW1n", title="t3")]
    for arm in ("image_only", "image_title"):
        msgs = build_messages(retained, cands, arm)
        images = [p for p in _flatten(msgs) if p.get("type") == "image_url"]
        assert len(images) == 3, arm                              # retained + 2 candidates
        assert all(p["image_url"]["detail"] == "low" for p in images), arm


# --------------------------------------------------------------------------- #
# OpenAIJudgeClient — the GPT-5.x SDK param contract (frozen envelope consts)
# --------------------------------------------------------------------------- #
class _FakeOpenAISDK:
    """Stands in for the `openai` module (installed into sys.modules, so the client's lazy
    `from openai import OpenAI` resolves here and the suite stays hermetic — no real SDK import,
    no key, no network). Captures the exact kwargs the client sends to chat.completions.create."""

    def __init__(self):
        from types import SimpleNamespace

        self.calls = []
        sdk = self

        class _Completions:
            def create(self, **kwargs):
                sdk.calls.append(kwargs)
                msg = SimpleNamespace(content='{"choice": "A"}')
                return SimpleNamespace(choices=[SimpleNamespace(message=msg)],
                                       system_fingerprint="fp-test",
                                       model_dump=lambda: {"stub": True})

        class OpenAI:
            def __init__(self, api_key=None):
                self.chat = SimpleNamespace(completions=_Completions())

        self.OpenAI = OpenAI


def test_openai_client_sends_gpt5_params_and_never_max_tokens(monkeypatch):
    # gpt-5.4-mini (GPT-5.x reasoning family) hard-400s on `max_tokens` — the client must map the
    # internal max_tokens kwarg to `max_completion_tokens`, pin `reasoning_effort:"none"` (so a
    # provider default change can never spend the tiny completion budget on hidden reasoning ->
    # truncated {"choice":..} -> parse-drop storms), and keep the frozen temp-0 json_object envelope.
    import sys
    from types import ModuleType

    sdk = _FakeOpenAISDK()
    mod = ModuleType("openai")
    mod.OpenAI = sdk.OpenAI
    monkeypatch.setitem(sys.modules, "openai", mod)
    client = gj.OpenAIJudgeClient("gpt-5.4-mini-2026-03-17")
    resp = client.complete([{"role": "user", "content": "pick"}], max_tokens=16)
    (kw,) = sdk.calls
    assert kw["max_completion_tokens"] == 16
    assert "max_tokens" not in kw                                 # the rejected legacy param is NEVER sent
    assert kw["reasoning_effort"] == "none"
    assert kw["model"] == "gpt-5.4-mini-2026-03-17"
    assert kw["temperature"] == 0.0
    assert kw["response_format"] == {"type": "json_object"}
    assert gj.parse_choice(resp.content, 4) == 0                  # the SDK reply round-trips
    assert resp.system_fingerprint == "fp-test"


# --------------------------------------------------------------------------- #
# Two-stage paired bootstrap (§11) — propagates the judge sample variance
# --------------------------------------------------------------------------- #
def _verdict(qid, status, correct=0):
    return QuestionVerdict(question_id=qid, status=status, forward_verdict=correct,
                           reverse_verdict=correct, correct_index=correct)


def test_two_stage_diff_point_matches_trained_minus_judge():
    # 4 kept questions: trained gets 3/4, judge (miss convention) gets hits on 2.
    verdicts = [_verdict("a", "hit"), _verdict("b", "hit"), _verdict("c", "miss"), _verdict("d", "inconsistent")]
    samples = {
        "a": QuestionSamples("a", (0, 0, 0), (3, 3, 3), 0, 4),
        "b": QuestionSamples("b", (0, 0, 0), (3, 3, 3), 0, 4),
        "c": QuestionSamples("c", (1, 1, 1), (2, 2, 2), 0, 4),
        "d": QuestionSamples("d", (0, 0, 0), (0, 0, 0), 0, 4),
    }
    trained = [1.0, 1.0, 1.0, 0.0]   # 3/4
    ci = gj.two_stage_paired_fitb_diff_ci(
        trained, verdicts, samples, convention=INCONSISTENT_MISS, seed=1, b=300
    )
    assert ci.point == pytest.approx(0.75 - 0.5)     # judge miss-conv: a,b hit -> 2/4
    assert ci.low <= ci.point <= ci.high


def test_two_stage_half_convention_gives_inconsistent_partial_credit():
    verdicts = [_verdict("a", "hit"), _verdict("d", "inconsistent")]
    samples = {
        "a": QuestionSamples("a", (0, 0, 0), (3, 3, 3), 0, 4),
        "d": QuestionSamples("d", (0, 0, 0), (0, 0, 0), 0, 4),
    }
    trained = [1.0, 1.0]
    miss = gj.two_stage_paired_fitb_diff_ci(trained, verdicts, samples, convention=INCONSISTENT_MISS, seed=2, b=200)
    half = gj.two_stage_paired_fitb_diff_ci(trained, verdicts, samples, convention=INCONSISTENT_HALF, seed=2, b=200)
    # judge accuracy: miss -> 1/2 = 0.5 ; half -> (1 + 0.5)/2 = 0.75 -> the diff is SMALLER under half
    assert miss.point == pytest.approx(1.0 - 0.5)
    assert half.point == pytest.approx(1.0 - 0.75)


def test_two_stage_inner_resample_is_live_not_single_stage():
    # 20 questions, each forward=(0,0,0,1) reverse=(3,3,3,3) correct=0 -> all HIT at the point, so every
    # per-question diff (trained 1 - judge 1) is IDENTICAL = 0. A plain SINGLE-stage cluster bootstrap of
    # identical values is DEGENERATE (low==high==0). The §11 inner judge-sample resample sometimes flips
    # forward's plurality (a (1,1,..)-heavy redraw -> disagree with reverse -> inconsistent miss), so the
    # diff varies and the CI is NON-degenerate. `low < high` therefore PINS that the inner resample is
    # present -- a regression to a single-stage bootstrap makes this fail (mutation guard for the headline
    # gate-B parity statistic).
    n = 20
    verdicts = [_verdict(f"q{i}", "hit") for i in range(n)]
    samples = {f"q{i}": QuestionSamples(f"q{i}", (0, 0, 0, 1), (3, 3, 3, 3), 0, 4) for i in range(n)}
    ci = gj.two_stage_paired_fitb_diff_ci(
        [1.0] * n, verdicts, samples, convention=INCONSISTENT_MISS, seed=7, b=400
    )
    assert ci.point == pytest.approx(0.0)      # all hits at the point estimate
    assert ci.low < ci.high                    # non-degenerate -> the inner judge-sample resample is live


def test_two_stage_needs_aligned_inputs():
    v = [_verdict("a", "hit")]
    s = {"a": QuestionSamples("a", (0,), (3,), 0, 4)}
    with pytest.raises(ValueError, match="align"):
        gj.two_stage_paired_fitb_diff_ci([1.0, 0.0], v, s, convention=INCONSISTENT_MISS, seed=1, b=10)


# --------------------------------------------------------------------------- #
# End-to-end run_arm on fakes (no network)
# --------------------------------------------------------------------------- #
class _ScriptedClient:
    """Returns canned letter answers in call order (one per `complete`)."""

    def __init__(self, letters):
        self._letters = list(letters)
        self.calls = 0

    def complete(self, messages, *, max_tokens):
        letter = self._letters[self.calls % len(self._letters)]
        self.calls += 1
        return JudgeResponse(content=f'{{"choice": "{letter}"}}', system_fingerprint=None,
                             raw={"i": self.calls})


class _DictProvider:
    def get(self, item_id):
        return ItemContent(item_id, image_b64="aW1n", title=f"title-{item_id}")


def _question(set_id="o01"):
    return FitbQuestion(set_id=set_id, retained=("r1", "r2"),
                        candidates=("ans", "d1", "d2", "d3"), correct_index=0, answer_category="11")


def test_run_arm_writes_two_orders_times_k_rows(tmp_path):
    ledger = str(tmp_path / "judge_runs.ndjson")
    client = _ScriptedClient(["A"])               # always picks the first presented candidate
    gj.run_arm([_question()], arm="image_only", client=client, provider=_DictProvider(),
               k_samples=3, max_tokens=8, retry_budget=1, model_snapshot="gpt-5.4-mini-2026-03-17",
               ledger_path=ledger)
    rows = gj.read_ledger(ledger)
    assert len(rows) == 3 * 2                      # K samples x 2 orders, 1 question
    assert {r["order"] for r in rows} == {"forward", "reverse"}
    # "always pick the first presented candidate": forward picks the answer (index 0), reverse picks
    # the reversed-list first item (canonical index 3) -> the orders disagree -> inconsistent.
    per_q = gj.group_samples(rows, [_question()], arm="image_only")
    assert gj.verdict_for(per_q[0]).status == "inconsistent"


def test_payload_log_redacts_image_bytes(tmp_path):
    # §14: even the gitignored payload log must NEVER hold raw photo bytes — base64 image data URIs are
    # redacted to their content hash before writing (so the C5 closet reuse is safe by construction).
    secret = "QUJDREVGRw=="    # a stand-in base64 photo payload
    raw = {"request": {"messages": [{"content": [
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{secret}"}}]}]}}
    pdir = str(tmp_path / "raw_payloads")
    sha = gj._log_payload(pdir, "o01", "image_only", "forward", 0, 0, raw)
    written = open(os.path.join(pdir, "o01_image_only_forward_0_0.payload.json"), encoding="utf-8").read()
    assert secret not in written and "base64-sha256:" in written      # bytes redacted to a hash ref
    assert len(sha) == 64
    # the caller's payload (reused across K samples) is NOT mutated by redaction
    assert raw["request"]["messages"][0]["content"][0]["image_url"]["url"].endswith(secret)


def test_run_arm_retries_then_drops_unparseable(tmp_path):
    ledger = str(tmp_path / "judge_runs.ndjson")
    client = _ScriptedClient(["banana"])          # never parseable
    gj.run_arm([_question()], arm="image_only", client=client, provider=_DictProvider(),
               k_samples=1, max_tokens=8, retry_budget=2, model_snapshot="snap",
               ledger_path=ledger)
    rows = gj.read_ledger(ledger)
    assert all(r["choice"] is None and r["dropped"] for r in rows)
    assert all(r["retried"] == 2 for r in rows)   # spent the whole budget before dropping
    assert client.calls == (2 + 1) * 2            # (retry_budget+1) attempts x 2 orders


# --------------------------------------------------------------------------- #
# Live smoke (skipped by default — the ONLY path that spends a token)
# --------------------------------------------------------------------------- #
@pytest.mark.skipif(
    os.environ.get("H26_LIVE_JUDGE") != "1" or not os.environ.get("OPENAI_API_KEY"),
    reason="live judge smoke: set H26_LIVE_JUDGE=1 + OPENAI_API_KEY (spends real money — kickoff B1)",
)
def test_live_openai_judge_smoke():  # pragma: no cover - network, opt-in only
    from gpt_judge import OpenAIJudgeClient

    client = OpenAIJudgeClient("gpt-5.4-mini-2026-03-17")
    msgs = build_messages(
        [ItemContent("r1", attributes={"category": "top", "colors": "navy"})],
        [ItemContent("c1", attributes={"category": "bottom", "colors": "grey"}),
         ItemContent("c2", attributes={"category": "bottom", "colors": "navy"})],
        "text_attribute",
    )
    resp = client.complete(msgs, max_tokens=16)
    assert gj.parse_choice(resp.content, 2) in (0, 1, None)
