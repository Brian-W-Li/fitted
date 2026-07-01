"""The LLM-as-judge baseline — `gpt-5.4-mini`, native FITB@4 forced choice (C4 / §8).

The production stylist serves `gpt-5.4-mini` (`recommend/route.ts:450`), so the judge baseline is a
**dated snapshot of that same mini model**. It answers exactly the gate-B parity question: on the same
FITB@4 questions the trained head scores, how often does the judge pick the held-out item? The
per-edge continuous-score Monte-Carlo AUC arm is **CUT** (§8) — gate B is FITB-parity only, so the
judge never emits a continuous score and we never need image logprobs.

Why this module is mostly pure (and why that matters):

  - The **protocol** is a forced choice. Each FITB question runs in **both** candidate orders (a seeded
    order + its exact reverse) × **K** temperature-0 samples. Within an order the K samples collapse by
    **plurality vote**; the question is a **hit** iff both orders' verdicts agree *and* pick the held-out
    item, a **miss** iff they agree on a wrong item, **inconsistent** (→ counted a miss, §8/§12) iff the
    orders disagree or either ties, and **dropped** (excluded from *both* models' denominator,
    like-for-like) iff an order yielded no parseable sample at all. All of that — `parse_choice`,
    `collapse_question`, the ledger read/write, the two-stage paired bootstrap — is pure and hermetic.
  - The **I/O** (the OpenAI call + the image/title/attribute payload) is behind injected seams
    (`JudgeClient`, `ContentProvider`), so the unit suite **mocks the API** and never spends a token; one
    real-API smoke test is skipped by default. `openai` is a lazy import — importing this module pulls no
    network dep.

**Blindness (load-bearing — §1):** this module produces only the judge's FITB verdicts; it materializes
**no** trained-head metric and writes **no** `metrics.json` (that is `evaluate.py`'s gated emission half,
unlocked only after the four-file freeze). The committed `judge_runs.ndjson` ledger is **scalar-only**
(`question_id` + order + choice index + flags + provenance) — never the judge's free-text rationale or
any photo-derived caption, which route only to the gitignored `raw_payloads/` (§8/§14), so the closet
judge slice cannot leak person-describing text into the public repo. Reference:
docs/plans/h26-compatibility-spike-v2.md §8 (judge protocol) / §12 (gate B) / §14 (privacy) / §15.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from data_loader import FitbQuestion
from metrics import CI, _percentile_ci

# The three judge arms (§8). image_only is the headline parity comparator (gate B): same modality as
# the trained head + a text-memorization control. image_title estimates the memorization/text lift.
# text_attribute mirrors the production config (text fields, no image) — reported, not the gate.
ARMS = ("image_only", "image_title", "text_attribute")
ORDERS = ("forward", "reverse")
# Forced-choice labels (letters, never 1-based integers — letters dodge the 0-vs-1-based parse trap).
CHOICE_LABELS = ("A", "B", "C", "D", "E", "F", "G", "H")
# The two gate-B adjudication conventions (§12 bias accounting): the headline counts an inconsistent
# verdict a miss (deployable-reliability reading); the cross-check gives it half credit.
INCONSISTENT_MISS = "inconsistent_miss"
INCONSISTENT_HALF = "inconsistent_half"
CONVENTIONS = (INCONSISTENT_MISS, INCONSISTENT_HALF)


# --------------------------------------------------------------------------- #
# Item content (the per-arm payload) + injected seams
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class ItemContent:
    """One item's judge-visible content, arm-gated by the message builder. `image_b64` is a base64
    JPEG (image arms only); `title` the item title (image+title / text arms); `attributes` the
    structured production-style fields (text arm). The builder egresses ONLY what the arm needs — the
    image-only arm sends no title, the text arm sends no image (§8 modality isolation, an egress
    invariant the tests pin)."""

    item_id: str
    image_b64: str | None = None
    title: str | None = None
    attributes: dict | None = None


class ContentProvider(Protocol):
    """Resolve an `item_id` to its `ItemContent`. The live impl reads the gated Polyvore parquet
    (images) + metadata (titles/attributes); the tests inject a dict-backed stub."""

    def get(self, item_id: str) -> ItemContent: ...


@dataclass(frozen=True)
class JudgeResponse:
    """One completion from the judge. `content` is the model's raw text (parsed by `parse_choice`,
    never committed); `system_fingerprint` is logged opportunistically (it was *null* on the
    2026-06-28 `gpt-5.4-mini` smoke test, so it is provenance, NOT the drift mechanism — §8); `raw` is
    the full request+response payload, written only to the gitignored `raw_payloads/` (§14)."""

    content: str | None
    system_fingerprint: str | None
    raw: dict


class JudgeClient(Protocol):
    """The one API seam. `complete` runs a single forced-choice completion. The live
    `OpenAIJudgeClient` wraps the SDK (lazy import); the unit suite injects a deterministic fake, so
    pytest never hits the network or spends a token."""

    def complete(self, messages: list[dict], *, max_tokens: int) -> JudgeResponse: ...


# --------------------------------------------------------------------------- #
# Prompt / message construction (pure — egress isolation is a tested invariant)
# --------------------------------------------------------------------------- #
SYSTEM_PROMPT = (
    "You are a careful fashion stylist judging outfit compatibility. You are shown a partial outfit "
    "(items already chosen) and several candidate items. Exactly one candidate best completes the "
    "outfit — it is the most compatible with, and wears well alongside, the items already chosen. "
    "Choose that single best candidate. Respond with ONLY a JSON object of the form {\"choice\": \"A\"} "
    "naming the letter of your chosen candidate, and nothing else."
)


def _item_payload(content: ItemContent, arm: str) -> list[dict]:
    """The OpenAI-style content parts for one item under `arm`. Egress isolation (§8): the image-only
    arm emits the image and NO title; image_title adds the title; text_attribute emits the structured
    fields and NEVER an image. Fails loud if the arm needs a field the provider did not supply."""
    if arm not in ARMS:
        raise ValueError(f"unknown judge arm {arm!r} (expected one of {ARMS})")
    parts: list[dict] = []
    if arm in ("image_only", "image_title"):
        if not content.image_b64:
            raise ValueError(f"arm {arm!r} needs an image for item {content.item_id!r}")
        parts.append(
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{content.image_b64}"}}
        )
    if arm == "image_title":
        if not content.title:
            raise ValueError(f"arm {arm!r} needs a title for item {content.item_id!r}")
        parts.append({"type": "text", "text": f"Title: {content.title}"})
    if arm == "text_attribute":
        if not content.attributes:
            raise ValueError(f"arm {arm!r} needs structured attributes for item {content.item_id!r}")
        # Mirror the production stylist's text fields (route.ts strips id/imageUrl); deterministic key
        # order so the same item yields a byte-identical prompt across runs (prompt-hash stability).
        fields = "; ".join(f"{k}: {content.attributes[k]}" for k in sorted(content.attributes))
        parts.append({"type": "text", "text": fields})
    return parts


def build_messages(
    retained: Sequence[ItemContent], candidates: Sequence[ItemContent], arm: str
) -> list[dict]:
    """Assemble the chat messages for one FITB question in one order: the retained partial outfit, then
    the labelled candidates (A, B, …) in the given order. Pure — the live client passes the result
    straight to the SDK; the tests assert the per-arm egress isolation off it."""
    if not 2 <= len(candidates) <= len(CHOICE_LABELS):
        raise ValueError(f"FITB needs 2..{len(CHOICE_LABELS)} candidates, got {len(candidates)}")
    user: list[dict] = [{"type": "text", "text": "Partial outfit (items already chosen):"}]
    for it in retained:
        user += _item_payload(it, arm)
    user.append({"type": "text", "text": "Candidate items (choose the one that best completes it):"})
    for label, it in zip(CHOICE_LABELS, candidates):
        user.append({"type": "text", "text": f"Candidate {label}:"})
        user += _item_payload(it, arm)
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


# --------------------------------------------------------------------------- #
# Robust answer parsing (the judge emits free text; we trust nothing)
# --------------------------------------------------------------------------- #
def parse_choice(content: str | None, n_candidates: int) -> int | None:
    """Extract the chosen candidate's **as-presented** 0-based index from the model's reply, or `None`
    if it is unparseable/ambiguous/out-of-range (→ a retry, then a drop). **Conservative by design** —
    the judge is untrusted free text, so a wrong *rescue* corrupts the score while a drop is honest and
    excluded like-for-like (§8/§12). It does NOT scrape prose for a stray label (e.g. the "A" in
    "A-line skirt" must never count); production pins `response_format=json_object`, so the structured
    path dominates and the bare-label path is the only fallback:

      1. Structured: the first embedded JSON object carrying a usable `choice` letter/int. An explicit
         but out-of-range/typed-wrong `choice` is a **reject** (None), never a fall-through.
      2. Else a **bare** reply that is a single label letter or a single 1-based digit in range (after
         stripping wrapping quotes/parens/punctuation) — e.g. `"A"`, `B.`, `(3)`.
      3. Anything else → None (drop).
    """
    if not content or n_candidates < 1:
        return None
    labels = CHOICE_LABELS[:n_candidates]

    # 1) Structured: the first JSON object carrying a "choice" (the production response_format).
    for obj in _iter_json_objects(content):
        if "choice" in obj:
            return _label_to_index(obj["choice"], labels, n_candidates)  # None if invalid -> reject

    # 2) Bare label: strip wrapping quotes/parens/punctuation and accept ONLY a lone label/digit.
    core = re.sub(r"^[\s\"'`(\[{*:.]+|[\s\"'`)\]}*:.]+$", "", content.strip())
    if len(core) == 1 and core.upper() in labels:
        return labels.index(core.upper())
    if core.isdigit():
        return _int_to_index(int(core), n_candidates)
    return None


def _iter_json_objects(text: str):
    """Yield parsed JSON objects embedded in `text` (the whole reply, then any `{...}` span). Tolerant
    of code fences / leading prose without executing anything but `json.loads`."""
    text = text.strip()
    for candidate in (text, *re.findall(r"\{[^{}]*\}", text)):
        try:
            obj = json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(obj, dict):
            yield obj


def _label_to_index(value, labels: Sequence[str], n_candidates: int) -> int | None:
    """Map a structured `choice` value (a letter 'A'/'b', or a 1-based or 0-based int) to a 0-based
    index, or None if out of range. Letters are unambiguous; an integer is treated as 1-based unless
    that lands out of range and the 0-based reading is in range (so both '{"choice":1}' and
    '{"choice":0}' resolve to candidate A, but '{"choice":4}' at @4 -> D)."""
    if isinstance(value, str):
        v = value.strip().upper()
        if len(v) == 1 and v in labels:
            return labels.index(v)
        if v.isdigit():
            return _int_to_index(int(v), n_candidates)
        return None
    if isinstance(value, bool):  # bool is an int subclass — never a valid choice
        return None
    if isinstance(value, int):
        return _int_to_index(value, n_candidates)
    return None


def _int_to_index(value: int, n_candidates: int) -> int | None:
    if 1 <= value <= n_candidates:
        return value - 1          # 1-based (the prompt's convention)
    if value == 0:
        return 0                  # tolerate a 0-based 'A'
    return None


# --------------------------------------------------------------------------- #
# The scalar-only ledger (judge_runs.ndjson — committed; raw payloads stay gitignored)
# --------------------------------------------------------------------------- #
# Exactly the §8/§15 scalar fields. NO free-text rationale, NO photo-derived caption — those route only
# to raw_payloads/ (gitignored). `choice` is the AS-PRESENTED 0-based index (collapse remaps reverse).
LEDGER_FIELDS = (
    "question_id",          # opaque FITB question id (the outfit set_id; one Q per distinct outfit)
    "arm",                  # image_only | image_title | text_attribute
    "order",                # forward | reverse
    "sample_index",         # 0..K-1 (the temp-0 repeats)
    "choice",               # as-presented 0-based candidate index, or null (unparseable -> dropped)
    "retried",              # #retries spent before this sample resolved/dropped
    "dropped",              # true iff unparseable after the retry budget
    "model_snapshot",       # the dated snapshot actually called
    "system_fingerprint",   # provenance only (may be null on gpt-5.4-mini — §8)
    "payload_log_sha256",   # sha256 ref into the gitignored raw_payloads/ (not the payload itself)
)
_LEDGER_ALLOWED = frozenset(LEDGER_FIELDS)


@dataclass(frozen=True)
class JudgeSample:
    """One ledger row: a single API sample's scalar outcome. `choice` is the as-presented index."""

    question_id: str
    arm: str
    order: str
    sample_index: int
    choice: int | None
    retried: int
    dropped: bool
    model_snapshot: str
    system_fingerprint: str | None
    payload_log_sha256: str | None

    def to_row(self) -> dict:
        if self.order not in ORDERS:
            raise ValueError(f"order must be one of {ORDERS}, got {self.order!r}")
        if self.arm not in ARMS:
            raise ValueError(f"arm must be one of {ARMS}, got {self.arm!r}")
        return {
            "question_id": self.question_id,
            "arm": self.arm,
            "order": self.order,
            "sample_index": self.sample_index,
            "choice": self.choice,
            "retried": self.retried,
            "dropped": self.dropped,
            "model_snapshot": self.model_snapshot,
            "system_fingerprint": self.system_fingerprint,
            "payload_log_sha256": self.payload_log_sha256,
        }


def assert_scalar_only(row: dict) -> None:
    """Refuse a ledger row carrying anything beyond the frozen scalar field set — the public-repo
    leak guard (§8/§14). A stray `rationale`/`caption`/`title`/`image` key (the person-describing text
    the closet slice could otherwise leak) fails loud HERE, before it is written."""
    extra = set(row) - _LEDGER_ALLOWED
    if extra:
        raise ValueError(f"judge_runs.ndjson row carries non-scalar field(s) {sorted(extra)} (§8/§14 leak guard)")
    missing = _LEDGER_ALLOWED - set(row)
    if missing:
        raise ValueError(f"judge_runs.ndjson row missing field(s) {sorted(missing)}")
    if not isinstance(row["choice"], (int, type(None))) or isinstance(row["choice"], bool):
        raise ValueError("ledger `choice` must be an int index or null")


def write_ledger(path: str, samples: Sequence[JudgeSample]) -> None:
    """Append scalar-only rows to `judge_runs.ndjson` (one JSON object per line). Validates every row
    through `assert_scalar_only` before it touches disk."""
    with open(path, "a", encoding="utf-8") as f:
        for s in samples:
            row = s.to_row()
            assert_scalar_only(row)
            f.write(json.dumps(row, separators=(",", ":"), sort_keys=True) + "\n")


def read_ledger(path: str) -> list[dict]:
    """Read `judge_runs.ndjson` rows, re-validating the scalar-only invariant on read (a hand-edited
    leak is caught before it reaches the collapse)."""
    rows: list[dict] = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            assert_scalar_only(row)
            rows.append(row)
    return rows


# --------------------------------------------------------------------------- #
# K x 2 -> per-question collapse (§8) — pure
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class QuestionVerdict:
    """One question's collapsed judge outcome. `status` ∈ {hit, miss, inconsistent, dropped}:
    `dropped` (an order had no parseable sample at all) is excluded from BOTH models' gate-B
    denominator; the others are kept, with `inconsistent` counted a miss (or 0.5) per the convention."""

    question_id: str
    status: str  # "hit" | "miss" | "inconsistent" | "dropped"
    forward_verdict: int | None   # canonical (forward-order) plurality index, or None (drop/tie)
    reverse_verdict: int | None
    correct_index: int


def _order_verdict(canonical_choices: Sequence[int | None]) -> tuple[str, int | None]:
    """Collapse one order's K samples (already remapped to canonical/forward indices) by plurality.
    Returns `("drop", None)` if no sample parsed, `("no_decision", None)` on a top-count tie (incl.
    3-/4-way at any K), else `("verdict", idx)`."""
    parsed = [c for c in canonical_choices if c is not None]
    if not parsed:
        return ("drop", None)
    counts = Counter(parsed)
    top = max(counts.values())
    winners = [c for c, n in counts.items() if n == top]
    if len(winners) != 1:
        return ("no_decision", None)
    return ("verdict", winners[0])


def collapse_question(
    forward_choices: Sequence[int | None],
    reverse_choices: Sequence[int | None],
    *,
    question_id: str,
    correct_index: int,
    n_candidates: int,
) -> QuestionVerdict:
    """The §8 collapse. `forward_choices`/`reverse_choices` are the per-sample AS-PRESENTED indices in
    each order; the reverse order is the exact reverse of the candidate list, so its as-presented index
    `c` maps to canonical (forward) index `n-1-c`. The question is a **hit** iff both orders' plurality
    verdicts agree and equal `correct_index`, a **miss** iff they agree on a wrong index, **dropped**
    iff either order had no parseable sample, else **inconsistent** (orders disagree or either tied —
    counted a miss/0.5 by convention, never excluded)."""
    rev_canonical = [None if c is None else (n_candidates - 1 - c) for c in reverse_choices]
    fstat, fverdict = _order_verdict(forward_choices)
    rstat, rverdict = _order_verdict(rev_canonical)
    if fstat == "drop" or rstat == "drop":
        status = "dropped"
    elif fstat == "verdict" and rstat == "verdict" and fverdict == rverdict:
        status = "hit" if fverdict == correct_index else "miss"
    else:
        status = "inconsistent"
    return QuestionVerdict(
        question_id=question_id, status=status,
        forward_verdict=fverdict, reverse_verdict=rverdict, correct_index=correct_index,
    )


# --------------------------------------------------------------------------- #
# Ledger -> gate-B per-question samples (joined on question_id) -> verdicts / hits
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class QuestionSamples:
    """The raw per-order sample choices for one question, the unit the two-stage bootstrap resamples.
    Both lists are AS-PRESENTED indices (collapse/resample remap reverse)."""

    question_id: str
    forward: tuple[int | None, ...]
    reverse: tuple[int | None, ...]
    correct_index: int
    n_candidates: int


def group_samples(
    ledger_rows: Sequence[dict], questions: Sequence[FitbQuestion], *, arm: str,
    expected_k: int | None = None,
) -> list[QuestionSamples]:
    """Join the scalar ledger to the gate-B `questions` (on `question_id` = `set_id`) for one `arm`,
    returning per-question sample lists in the questions' order.

    **Idempotent + completeness-checked (load-bearing — the ledger is append-only `judge_runs.ndjson`).**
    A resumed/re-run judge pass appends a SECOND set of rows for an already-scored question; rows are
    therefore deduped **keep-last on (order, sample_index)** so a re-run overwrites rather than
    doubling K (a doubled K would silently corrupt the plurality vote + shrink the §11 two-stage
    variance). Each question must then have BOTH orders non-empty and equal-length (an incomplete WRITE
    — e.g. a crash mid-question leaving one order unwritten — fails loud here instead of being silently
    misread as a judge `dropped`), and, when `expected_k` is given (the frozen K), exactly `expected_k`
    samples per order. The judge must have scored the identical shared gate-B set (§12 like-for-like)."""
    by_q: dict[str, dict[str, dict[int, int | None]]] = {}
    for row in ledger_rows:
        if row["arm"] != arm:
            continue
        slot = by_q.setdefault(row["question_id"], {"forward": {}, "reverse": {}})
        slot[row["order"]][row["sample_index"]] = row["choice"]  # keep-last dedup on sample_index
    out: list[QuestionSamples] = []
    for q in questions:
        rec = by_q.get(q.set_id)
        if rec is None:
            raise ValueError(f"gate-B question {q.set_id!r} has no judge rows for arm {arm!r} (incomplete run)")
        fwd = tuple(c for _, c in sorted(rec["forward"].items()))
        rev = tuple(c for _, c in sorted(rec["reverse"].items()))
        if not fwd or not rev or len(fwd) != len(rev):
            raise ValueError(
                f"gate-B question {q.set_id!r} arm {arm!r} has an incomplete/asymmetric judge run "
                f"(forward={len(fwd)} reverse={len(rev)} samples) — both orders must be present and equal"
            )
        if expected_k is not None and len(fwd) != expected_k:
            raise ValueError(
                f"gate-B question {q.set_id!r} arm {arm!r} has {len(fwd)} samples/order, expected the "
                f"frozen K={expected_k} (incomplete or corrupt ledger)"
            )
        out.append(
            QuestionSamples(
                question_id=q.set_id, forward=fwd, reverse=rev,
                correct_index=q.correct_index, n_candidates=len(q.candidates),
            )
        )
    return out


def verdict_for(samples: QuestionSamples) -> QuestionVerdict:
    return collapse_question(
        samples.forward, samples.reverse, question_id=samples.question_id,
        correct_index=samples.correct_index, n_candidates=samples.n_candidates,
    )


def _verdict_credit(status: str, convention: str) -> float | None:
    """Gate-B per-question credit: hit=1, miss=0, dropped=excluded (None), inconsistent=0 (miss
    convention) or 0.5 (half convention). §12."""
    if status == "dropped":
        return None
    if status == "hit":
        return 1.0
    if status == "miss":
        return 0.0
    if convention == INCONSISTENT_MISS:
        return 0.0
    if convention == INCONSISTENT_HALF:
        return 0.5
    raise ValueError(f"unknown convention {convention!r}")


@dataclass(frozen=True)
class GateBVerdicts:
    """The kept (non-dropped) gate-B questions, aligned across the judge and the trained head so both
    score the identical shared set (§12). `kept_question_ids` is the like-for-like denominator both
    models reduce to; `dropped_question_ids` are the API/parse failures excluded from both."""

    kept_question_ids: tuple[str, ...]
    dropped_question_ids: tuple[str, ...]
    verdicts: tuple[QuestionVerdict, ...]   # aligned to kept_question_ids
    samples_by_id: dict[str, QuestionSamples]


def gate_b_verdicts(per_question: Sequence[QuestionSamples]) -> GateBVerdicts:
    """Collapse every gate-B question and split into kept vs dropped (§8). Order-preserving on the
    input question order so the trained head can align to `kept_question_ids` identically."""
    kept_ids: list[str] = []
    dropped_ids: list[str] = []
    verdicts: list[QuestionVerdict] = []
    samples_by_id: dict[str, QuestionSamples] = {}
    for s in per_question:
        v = verdict_for(s)
        samples_by_id[s.question_id] = s
        if v.status == "dropped":
            dropped_ids.append(s.question_id)
        else:
            kept_ids.append(s.question_id)
            verdicts.append(v)
    return GateBVerdicts(
        kept_question_ids=tuple(kept_ids), dropped_question_ids=tuple(dropped_ids),
        verdicts=tuple(verdicts), samples_by_id=samples_by_id,
    )


def judge_gate_b_hits(verdicts: Sequence[QuestionVerdict], convention: str) -> list[float]:
    """The judge's per-question gate-B credit under `convention`, over the kept questions (§12)."""
    return [_verdict_credit(v.status, convention) for v in verdicts]


# --------------------------------------------------------------------------- #
# The gate-B paired TWO-STAGE bootstrap (§11): cluster resample + judge sample resample
# --------------------------------------------------------------------------- #
def two_stage_paired_fitb_diff_ci(
    trained_hits: Sequence[float],
    verdicts: Sequence[QuestionVerdict],
    samples_by_id: dict[str, QuestionSamples],
    *,
    convention: str,
    seed: int,
    b: int = 10_000,
    alpha: float = 0.05,
) -> CI:
    """Paired CI of `fitb_trained_gateB − fitb_judge_gateB` that ALSO propagates the judge's temp-0
    run-to-run variance (§11): each replicate (1) resamples the kept question clusters with replacement
    and (2) for each chosen question re-collapses the judge from a resample of its K forward + K reverse
    samples, so the parity CI does not understate uncertainty (an unpaired or single-stage combine
    would). The trained head is deterministic per question, so only the judge side carries the inner
    resample. `trained_hits` aligns 1:1 to `verdicts` (the kept gate-B questions)."""
    n = len(verdicts)
    if n == 0:
        raise ValueError("gate-B two-stage bootstrap needs >= 1 kept question")
    if len(trained_hits) != n:
        raise ValueError("trained_hits must align 1:1 to the kept gate-B verdicts")
    if convention not in CONVENTIONS:
        raise ValueError(f"unknown convention {convention!r}")
    th = np.asarray(trained_hits, dtype=float)
    samples = [samples_by_id[v.question_id] for v in verdicts]
    rng = np.random.default_rng(seed)

    def judge_credit(s: QuestionSamples, gen: np.random.Generator) -> float:
        # Inner resample: draw K forward + K reverse samples WITH replacement, re-collapse.
        fwd = _resample(s.forward, gen)
        rev = _resample(s.reverse, gen)
        v = collapse_question(
            fwd, rev, question_id=s.question_id,
            correct_index=s.correct_index, n_candidates=s.n_candidates,
        )
        credit = _verdict_credit(v.status, convention)
        # A drop in the inner resample (e.g. all-None redraw) keeps the question (it was kept at the
        # point estimate) but contributes 0 — never silently shrinks the resampled denominator.
        return 0.0 if credit is None else credit

    # kept verdicts never carry a `dropped` credit (None), so the point judge accuracy is well-defined.
    judge_point = [_verdict_credit(v.status, convention) for v in verdicts]
    point = float(th.mean() - np.mean(judge_point))
    boot = np.empty(b, dtype=float)
    for i in range(b):
        idx = rng.integers(0, n, n)
        t_mean = float(th[idx].mean())
        j_mean = float(np.mean([judge_credit(samples[k], rng) for k in idx]))
        boot[i] = t_mean - j_mean
    return _percentile_ci(point, boot, b, alpha)


def _resample(choices: Sequence[int | None], gen: np.random.Generator) -> list[int | None]:
    if not choices:
        return []
    idx = gen.integers(0, len(choices), len(choices))
    return [choices[k] for k in idx]


# --------------------------------------------------------------------------- #
# The live runner (I/O — mocked in the unit suite, exercised by the skip-by-default smoke)
# --------------------------------------------------------------------------- #
def _candidate_contents(
    q: FitbQuestion, provider: ContentProvider, order: str
) -> tuple[list[ItemContent], list[ItemContent]]:
    """Resolve a question's retained + candidate contents for one order (reverse = the exact reverse of
    the candidate tuple). The as-presented index the judge returns maps back to canonical in collapse."""
    retained = [provider.get(i) for i in q.retained]
    cand_ids = list(q.candidates) if order == "forward" else list(reversed(q.candidates))
    candidates = [provider.get(i) for i in cand_ids]
    return retained, candidates


def run_question_order(
    q: FitbQuestion,
    *,
    arm: str,
    order: str,
    client: JudgeClient,
    provider: ContentProvider,
    k_samples: int,
    max_tokens: int,
    retry_budget: int,
    model_snapshot: str,
    payload_dir: str | None = None,
) -> list[JudgeSample]:
    """Run one question in one order: K temp-0 samples, each retried up to `retry_budget` times until it
    parses (temp 0 is near-stable, so a retry is rare), else dropped. Writes each raw payload to the
    gitignored `payload_dir` and records only its sha into the scalar ledger row (§14)."""
    retained, candidates = _candidate_contents(q, provider, order)
    messages = build_messages(retained, candidates, arm)
    n = len(candidates)
    out: list[JudgeSample] = []
    for s in range(k_samples):
        choice: int | None = None
        retried = 0
        fingerprint: str | None = None
        payload_sha: str | None = None
        for attempt in range(retry_budget + 1):
            resp = client.complete(messages, max_tokens=max_tokens)
            fingerprint = resp.system_fingerprint
            payload_sha = _log_payload(payload_dir, q.set_id, arm, order, s, attempt, resp.raw)
            choice = parse_choice(resp.content, n)
            if choice is not None:
                retried = attempt
                break
            retried = attempt
        out.append(
            JudgeSample(
                question_id=q.set_id, arm=arm, order=order, sample_index=s,
                choice=choice, retried=retried, dropped=choice is None,
                model_snapshot=model_snapshot, system_fingerprint=fingerprint,
                payload_log_sha256=payload_sha,
            )
        )
    return out


def run_arm(
    questions: Sequence[FitbQuestion],
    *,
    arm: str,
    client: JudgeClient,
    provider: ContentProvider,
    k_samples: int,
    max_tokens: int,
    retry_budget: int,
    model_snapshot: str,
    ledger_path: str,
    payload_dir: str | None = None,
) -> None:
    """Score every gate-B `questions` in both orders × K samples for one `arm`, streaming scalar rows
    to `ledger_path`. All API/image I/O flows through the injected `client`/`provider`, so the unit
    suite drives this end-to-end on fakes; the live judge run wires `OpenAIJudgeClient` + the parquet
    provider. Materializes no metric (§1) — only the ledger the collapse + emission read."""
    for q in questions:
        for order in ORDERS:
            samples = run_question_order(
                q, arm=arm, order=order, client=client, provider=provider,
                k_samples=k_samples, max_tokens=max_tokens, retry_budget=retry_budget,
                model_snapshot=model_snapshot, payload_dir=payload_dir,
            )
            write_ledger(ledger_path, samples)


def _log_payload(
    payload_dir: str | None, qid: str, arm: str, order: str, sample: int, attempt: int, raw: dict
) -> str | None:
    """Write one request/response payload to the gitignored `payload_dir` and return its sha256 (the
    ledger stores only the ref, never the payload — §14). Image bytes are **redacted to their content
    hash first** (`_redact_image_bytes`), so even the gitignored payload log never holds raw photo bytes
    — the §14 closet-slice requirement ('log image hashes/refs, never raw photo bytes'), honored
    universally so the C5 closet reuse of this path is safe by construction. The hash is enough for
    drift detection; the bytes are reproducible from the parquet / closet manifest. Returns None when no
    dir is configured (the sha is still computed for the ledger ref)."""
    safe = _redact_image_bytes(raw)
    blob = json.dumps(safe, sort_keys=True, default=str).encode("utf-8")
    sha = hashlib.sha256(blob).hexdigest()
    if payload_dir is not None:
        os.makedirs(payload_dir, exist_ok=True)
        with open(os.path.join(payload_dir, f"{qid}_{arm}_{order}_{sample}_{attempt}.payload.json"), "wb") as f:
            f.write(blob)
    return sha


_DATA_URI = re.compile(r"^data:(image/[\w.+-]+);base64,(.+)$", re.DOTALL)


def _redact_image_bytes(obj):
    """Return a deep copy of `obj` with every base64 image data URI replaced by
    `data:<mime>;base64-sha256:<hash>` — so a payload log carries an image *reference*, never the bytes
    (§14). A pure copy (never mutates the caller's `messages`, which are reused across K samples)."""
    if isinstance(obj, dict):
        return {k: _redact_image_bytes(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_redact_image_bytes(v) for v in obj]
    if isinstance(obj, str):
        m = _DATA_URI.match(obj)
        if m:
            return f"data:{m.group(1)};base64-sha256:{hashlib.sha256(m.group(2).encode('utf-8')).hexdigest()}"
    return obj


# --------------------------------------------------------------------------- #
# Live OpenAI client (lazy import — the unit suite never constructs this)
# --------------------------------------------------------------------------- #
class OpenAIJudgeClient:
    """The live `gpt-5.4-mini` forced-choice client (temperature 0, structured `response_format`). Lazy
    `openai` import so importing this module needs no network dep. NOT exercised by the unit suite — the
    skip-by-default smoke test and the RUN-phase pilot are its only callers, after explicit spend
    approval (§8 / kickoff B1). The dated snapshot + max_tokens freeze in `judge_addendum.md` at C4."""

    def __init__(self, model_snapshot: str, *, temperature: float = 0.0, api_key: str | None = None) -> None:
        from openai import OpenAI

        self.model_snapshot = model_snapshot
        self.temperature = temperature
        self._client = OpenAI(api_key=api_key) if api_key else OpenAI()

    def complete(self, messages: list[dict], *, max_tokens: int) -> JudgeResponse:
        resp = self._client.chat.completions.create(
            model=self.model_snapshot,
            messages=messages,
            temperature=self.temperature,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
        choice = resp.choices[0]
        return JudgeResponse(
            content=choice.message.content,
            system_fingerprint=getattr(resp, "system_fingerprint", None),
            raw={"request": {"model": self.model_snapshot, "messages": messages, "max_tokens": max_tokens},
                 "response": resp.model_dump() if hasattr(resp, "model_dump") else str(resp)},
        )
