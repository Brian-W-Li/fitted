"""Tests for the C4 emission half — the four-file unlock + the first metrics.json (§1/§12/§15).

The blindness gate's teeth: `evaluate.py` must REFUSE to write any held-out test-set number until all
four unlock files are committed and validate, the sealed selection binds, and the judge ledger exists.
These tests build a complete *valid* unlock directory in a tmp dir (real frozen schemas/artifacts copied
from the package, a FROZEN judge addendum, a filled closet manifest, a bound selection.json) + an
injected git seam, then assert the happy path emits a schema-valid metrics.json and that every refusal
path (absent selection/closet — kickoff B2/B3; a scaffold addendum; a prereg .md/.json disagreement; a
closet referential break; an uncommitted freeze file; a selection manifest-hash drift) writes NOTHING.
One test exercises the REAL git seam against the actually-committed freeze. Reference:
docs/plans/h26-compatibility-spike-v2.md §1 / §12 / §15.
"""

import hashlib
import json
import os
import shutil

import pytest

import evaluate as ev
from baselines import LeakCheck
from coherence import COHERENCE_RULE
from data_loader import FitbQuestion, Item
from evaluate import GateBMetrics, MetricSuite, UnlockError
from gpt_judge import JudgeResponse, JudgeSample, run_arm
from metrics import CI
from train_head import manifest_hashes

H26 = os.path.dirname(os.path.dirname(__file__))

# Frozen artifacts the unlock dir must carry verbatim (schemas + the C2/C3 freeze the binding reads).
_COPY = (
    "preregistration.md", "preregistration.json", "fitb_manifest.json", "fitb_order.json",
    "embedding_manifest_fashionsiglip.json", "type_map.json",
    "metrics.schema.json", "selection.schema.json", "judge_addendum.schema.json",
    "closet_manifest.schema.json", "closet_category_reference.json",
)


def _ci(point, low, high, b=200):
    return CI(point=point, low=low, high=high, b=b)


def _suite():
    """A synthetic MetricSuite with plausible CIs (gate *application* is C6 — these need only be
    schema-valid CIs, not gate-passing)."""
    return MetricSuite(
        AUC_catalog_pair=_ci(0.85, 0.84, 0.86),
        AUC_zero_shot_cosine=_ci(0.80, 0.79, 0.81),
        gate_A_diff=_ci(0.05, 0.04, 0.06),
        outfit_auc=_ci(0.83, 0.82, 0.84),
        fitb_trained_full=_ci(0.55, 0.53, 0.57),
        fitb_zero_shot_cosine=_ci(0.40, 0.38, 0.42),
        AUC_pair_item_level=_ci(0.83, 0.82, 0.84),
        seam_diff_pairwise_minus_item_level=_ci(0.02, 0.01, 0.03),
        outfit_auc_item_level=_ci(0.81, 0.80, 0.82),
        fitb_item_level_full=_ci(0.52, 0.50, 0.54),
        AUC_pop_edge=_ci(0.54, 0.52, 0.56),
        AUC_pop_outfit=_ci(0.56, 0.54, 0.58),
        leak=LeakCheck(edge_auc=0.50, fitb_acc=0.25, outfit_auc=0.50),
    )


def _gate_b():
    return GateBMetrics(
        arm="image_only", n_kept=480, n_dropped=20,
        fitb_trained_gateB=_ci(0.55, 0.52, 0.58),
        fitb_judge_gateB=_ci(0.53, 0.50, 0.56),
        gate_B_diff_inconsistent_miss=_ci(0.02, -0.02, 0.06),
        gate_B_diff_inconsistent_half=_ci(0.00, -0.04, 0.04),
    )


def _calibration_json(question_ids=None):
    # human forced-choice calibration set; question_ids feed the §F disjointness check. The default ids
    # are obviously-synthetic so they never collide with real Polyvore gate-B/gate-D test set_ids.
    ids = question_ids if question_ids is not None else [f"calib_{i:04d}" for i in range(60)]
    return {"question_ids": ids,
            "labels": {i: {"human_choice": "A"} for i in ids},
            "_note": "actual-human single-annotator forced-choice; judge-selection only"}


def _frozen_envelope(*, cal_sha="b" * 64, **overrides):
    env = {
        "frozen": True,
        "spike": "h26",
        "model_snapshot": "gpt-5.4-mini-2026-03-17",
        "snapshot_rule": "dated_snapshot_frozen_at_C4_does_not_move_after",
        "temperature": 0,
        "k_samples": 3,
        "both_order_policy": "forward_plus_exact_reverse_consistent_only",
        "adjudication_convention": "inconsistent_is_miss",
        "conservative_cross_check_convention": "inconsistent_is_half",
        "max_tokens": 16,
        "sdk_token_param": "max_completion_tokens",
        "reasoning_effort": "none",
        "image_detail": "low",
        "retry_budget": 2,
        "drop_policy": "unparseable after the retry budget -> drop the sample + log; reduced shared set",
        "payload_logging_policy": "full payloads -> gitignored raw_payloads/; ledger scalar-only",
        "system_fingerprint_policy": "logged opportunistically; may be null",
        "prompt_sha256": "a" * 64,
        "response_format": "json_object",
        "logprob_escape_hatch": {"image_logprobs_available": False, "rechecked_at_C4": True},
        "calibration_set": {
            "manifest_path": "calibration_set.json",
            "manifest_sha256": cal_sha,
            "size": 60,
            "source": "polyvore_valid_train_image_only_panel",
            "label_kind": "actual_human_forced_choice",
            "single_annotator": False,
            "n_annotators": 3,
            "inter_annotator_agreement": 0.9,
            "disjoint_from": ["gate_B_set", "gate_D_full_fitb"],
            "judge_only_use": "select_judge_envelope_never_scores_trained_head",
        },
        "arms": ["image_only", "image_title", "text_attribute"],
        "commit_hash": "c" * 40,
    }
    env.update(overrides)
    return env


def _addendum_md(envelope):
    return "# Judge addendum (frozen)\n\n```json\n" + json.dumps(envelope, indent=2) + "\n```\n"


def _closet(category_ids, *, items=None, outfits=None):
    items = items or [
        {"item_id": "c001", "clothing_type": "top", "polyvore_category_id": category_ids[0],
         "fine_label_human": "oxford shirt", "photo_path": "closet/c001.jpg",
         "photo_sha256": "d" * 64, "coarsening_note": None},
        {"item_id": "c014", "clothing_type": "bottom", "polyvore_category_id": category_ids[1],
         "fine_label_human": "chinos", "photo_path": "closet/c014.jpg",
         "photo_sha256": "e" * 64, "coarsening_note": None},
    ]
    outfits = outfits or [{"set_id": "o01", "item_ids": ["c001", "c014"]}]
    return {
        "_schema_version": 1,
        "_consent": {"owner_id": "owner-7f3a", "third_party_api_processing": False,
                     "providers_photos_may_reach": []},
        "_taxonomy": {"fine_category_key": "polyvore_category_id",
                      "reference": "closet_category_reference.json",
                      "coarsening_policy": "null id -> coarsening_note; reported separately"},
        "label_audit": {"second_pass_completed": True, "items_rechecked": 2, "agreement_rate": 1.0},
        "items": items,
        "outfits": outfits,
    }


class FakeGit:
    """Injected git seam — every file reads committed-clean unless overridden. The blob sha is a real
    40-hex string (metrics.schema requires `^[0-9a-f]{40,64}$`)."""

    def __init__(self, *, committed=True, overrides=None, head="b" * 40):
        self.committed = committed
        self.overrides = overrides or {}
        self.head = head

    def identity(self, path):
        name = os.path.basename(path)
        committed = self.overrides.get(name, self.committed)
        sha = hashlib.sha1(name.encode()).hexdigest()
        return ev.FileIdentity(git_blob_sha=sha, committed=committed)

    def head_commit(self):
        return self.head


@pytest.fixture
def unlock_dir(tmp_path):
    """A complete, VALID unlock directory: the frozen artifacts + a frozen addendum + a filled closet +
    a bound selection.json (its manifest_hashes computed over the tmp copies, so the binding holds)."""
    root = tmp_path / "h26"
    root.mkdir()
    for name in _COPY:
        shutil.copy(os.path.join(H26, name), root / name)
    cal_bytes = json.dumps(_calibration_json()).encode("utf-8")
    (root / "calibration_set.json").write_bytes(cal_bytes)
    cal_sha = hashlib.sha256(cal_bytes).hexdigest()
    (root / "judge_addendum.md").write_text(_addendum_md(_frozen_envelope(cal_sha=cal_sha)), encoding="utf-8")
    ref = json.load(open(root / "closet_category_reference.json", encoding="utf-8"))
    cat_ids = list(ref["categories"])[:2]
    (root / "closet_manifest.json").write_text(json.dumps(_closet(cat_ids)), encoding="utf-8")
    selection = {
        "checkpoint_id": "fashionsiglip_pairwise_edge_grid_0_seed20260629",
        "checkpoint_sha256": "f" * 64,
        "training_config": {"head": "pairwise_type_conditioned_edge", "optimizer": "adam",
                            "seed": 20260629, "config_id": "grid_0",
                            "selection_metric": "valid_pooled_pair_level_roc_auc"},
        "converged": True, "early_stop_epoch": 7,
        "manifest_hashes": manifest_hashes(str(root)),
    }
    (root / "selection.json").write_text(json.dumps(selection), encoding="utf-8")
    return str(root)


# --------------------------------------------------------------------------- #
# Happy path
# --------------------------------------------------------------------------- #
def test_validate_unlock_files_happy_path(unlock_dir):
    unlock_files, selection_meta = ev.validate_unlock_files(unlock_dir, FakeGit())
    assert set(unlock_files) == set(ev.UNLOCK_FILES)
    for rec in unlock_files.values():
        assert rec["validated"] is True and len(rec["sha256"]) == 64
    assert selection_meta["checkpoint_id"].endswith("seed20260629")
    assert selection_meta["validated"] is True


def test_emit_writes_schema_valid_metrics_json(unlock_dir):
    metrics = ev.emit_metrics(_suite(), _gate_b(), root_dir=unlock_dir, git=FakeGit())
    assert os.path.exists(os.path.join(unlock_dir, "metrics.json"))
    assert metrics["_meta"]["stage"] == "C4"
    for field in ("AUC_catalog_pair", "gate_A_diff", "fitb_trained_gateB", "fitb_judge_gateB",
                  "gate_B_diff_inconsistent_miss", "gate_B_diff_inconsistent_half",
                  "outfit_auc", "fitb_trained_full"):
        assert field in metrics
    # closet/transfer + seam_holm_adjusted_p stage to C5/C6 -> absent at C4
    assert "AUC_closet_pair" not in metrics and "seam_holm_adjusted_p" not in metrics
    # the file genuinely re-validates against the committed metrics.schema
    ev._validate_against_schema(metrics, os.path.join(unlock_dir, "metrics.schema.json"), what="reread")


# --------------------------------------------------------------------------- #
# Refusal matrix — every path writes NOTHING (the blindness teeth)
# --------------------------------------------------------------------------- #
def _assert_no_emit(root_dir, **kw):
    with pytest.raises(UnlockError) as exc:
        ev.emit_metrics(_suite(), _gate_b(), root_dir=root_dir, git=kw.pop("git", FakeGit()), **kw)
    assert not os.path.exists(os.path.join(root_dir, "metrics.json")), "metrics.json leaked on a refusal"
    return exc.value


def test_refuse_when_selection_absent_b2(unlock_dir):
    os.remove(os.path.join(unlock_dir, "selection.json"))
    assert "selection.json is absent" in str(_assert_no_emit(unlock_dir))


def test_refuse_when_closet_absent_b3(unlock_dir):
    os.remove(os.path.join(unlock_dir, "closet_manifest.json"))
    assert "closet_manifest.json is absent" in str(_assert_no_emit(unlock_dir))


def test_refuse_scaffold_addendum(unlock_dir):
    # the committed SCAFFOLD (frozen:false) must be refused — the whole point of the freeze order.
    shutil.copy(os.path.join(H26, "judge_addendum.md"), os.path.join(unlock_dir, "judge_addendum.md"))
    assert "judge_addendum" in str(_assert_no_emit(unlock_dir))


def test_refuse_addendum_missing_envelope_block(unlock_dir):
    (open(os.path.join(unlock_dir, "judge_addendum.md"), "w", encoding="utf-8")
     .write("# frozen but no machine-readable block\n"))
    assert "envelope" in str(_assert_no_emit(unlock_dir)).lower()


def test_refuse_uncommitted_freeze_file(unlock_dir):
    git = FakeGit(overrides={"judge_addendum.md": False})
    assert "not committed-clean" in str(_assert_no_emit(unlock_dir, git=git))


def test_refuse_uncommitted_selection(unlock_dir):
    git = FakeGit(overrides={"selection.json": False})
    assert "selection.json is not committed" in str(_assert_no_emit(unlock_dir, git=git))


def test_refuse_prereg_md_json_disagreement(unlock_dir):
    # drop the gate-D AUC floor literal from the .md authority -> the mirror no longer agrees.
    md_path = os.path.join(unlock_dir, "preregistration.md")
    md = open(md_path, encoding="utf-8").read().replace("0.81", "0.XX")
    open(md_path, "w", encoding="utf-8").write(md)
    assert "disagree" in str(_assert_no_emit(unlock_dir))


def test_refuse_closet_bogus_category_id(unlock_dir):
    # a SCHEMA-VALID id (1-4 digits, ^[0-9]{1,4}$) that is absent from the reference -> the C4
    # referential check fires (a 5-digit id would fail the schema regex first, a different layer).
    ref = json.load(open(os.path.join(unlock_dir, "closet_category_reference.json"), encoding="utf-8"))
    bogus = next(str(n) for n in range(9999, 0, -1) if str(n) not in ref["categories"])
    real = list(ref["categories"])[0]
    closet = _closet([bogus, real])
    open(os.path.join(unlock_dir, "closet_manifest.json"), "w", encoding="utf-8").write(json.dumps(closet))
    assert "absent from" in str(_assert_no_emit(unlock_dir))


def test_refuse_closet_outfit_references_undeclared_item(unlock_dir):
    ref = json.load(open(os.path.join(unlock_dir, "closet_category_reference.json"), encoding="utf-8"))
    cats = list(ref["categories"])[:2]
    closet = _closet(cats, outfits=[{"set_id": "o01", "item_ids": ["c001", "GHOST"]}])
    open(os.path.join(unlock_dir, "closet_manifest.json"), "w", encoding="utf-8").write(json.dumps(closet))
    assert "undeclared item" in str(_assert_no_emit(unlock_dir))


def test_refuse_closet_duplicate_item_id(unlock_dir):
    ref = json.load(open(os.path.join(unlock_dir, "closet_category_reference.json"), encoding="utf-8"))
    cats = list(ref["categories"])[:2]
    items = _closet(cats)["items"]
    items[1]["item_id"] = "c001"             # duplicate
    closet = _closet(cats, items=items)
    open(os.path.join(unlock_dir, "closet_manifest.json"), "w", encoding="utf-8").write(json.dumps(closet))
    assert "more than once" in str(_assert_no_emit(unlock_dir))


def test_refuse_selection_manifest_hash_drift(unlock_dir):
    # editing a bound frozen artifact after selection froze must be caught (the C3 selection guard at
    # runtime): append a byte to type_map.json so manifest_hashes(root) no longer match selection's.
    tm = os.path.join(unlock_dir, "type_map.json")
    open(tm, "a", encoding="utf-8").write("\n")
    assert "manifest_hashes" in str(_assert_no_emit(unlock_dir))


def test_refuse_calibration_overlaps_gate_b(unlock_dir):
    # the §F blindness invariant, made mechanical: a calibration question that is ALSO a gate-B question
    # means the judge was tuned on a gated question -> refuse. Inject a real gate-B set_id.
    order = json.load(open(os.path.join(unlock_dir, "fitb_order.json"), encoding="utf-8"))
    leaked = order["gate_b_set_ids"][0]
    cal_bytes = json.dumps(_calibration_json(["calib_0001", leaked])).encode("utf-8")
    open(os.path.join(unlock_dir, "calibration_set.json"), "wb").write(cal_bytes)
    cal_sha = hashlib.sha256(cal_bytes).hexdigest()
    open(os.path.join(unlock_dir, "judge_addendum.md"), "w", encoding="utf-8").write(
        _addendum_md(_frozen_envelope(cal_sha=cal_sha)))
    assert "overlaps the gate_B" in str(_assert_no_emit(unlock_dir))


def test_refuse_calibration_manifest_sha_mismatch(unlock_dir):
    # edit the bound calibration manifest after the freeze -> its sha no longer matches the addendum.
    open(os.path.join(unlock_dir, "calibration_set.json"), "a", encoding="utf-8").write(" ")
    assert "manifest" in str(_assert_no_emit(unlock_dir))


def test_refuse_calibration_manifest_absent(unlock_dir):
    os.remove(os.path.join(unlock_dir, "calibration_set.json"))
    assert "calibration manifest" in str(_assert_no_emit(unlock_dir)).lower()


def test_assert_calibration_disjoint_is_pure_and_strict():
    ev.assert_calibration_disjoint({"a", "b"}, {"c", "d"}, label="gate_B")   # disjoint -> no raise
    with pytest.raises(UnlockError, match="overlaps the gate_D"):
        ev.assert_calibration_disjoint({"a", "x"}, {"x", "y"}, label="gate_D")


def test_gate_d_disjoint_leg_is_wired_and_hermetic(unlock_dir):
    # The gate-D blindness leg (calibration set disjoint from the FULL test FITB set) lives inside the
    # torch-gated materialize; factoring it into assert_gate_d_disjoint makes it hermetically testable —
    # a mutation deleting/weakening it now fails a green test. The fixture's calibration ids are calib_00xx.
    envelope = ev.extract_envelope(ev._read_text(os.path.join(unlock_dir, "judge_addendum.md")))
    ev.assert_gate_d_disjoint(unlock_dir, envelope, {"real_test_q1", "real_test_q2"}, git=FakeGit())  # disjoint
    with pytest.raises(UnlockError, match="overlaps the gate_D_full_fitb"):
        ev.assert_gate_d_disjoint(unlock_dir, envelope, {"calib_0001", "real_test_q2"}, git=FakeGit())


def test_refuse_empty_closet_template(unlock_dir):
    # the unfilled template (items: []) fails the schema minItems -> a refusal, never a silent pass.
    shutil.copy(os.path.join(H26, "closet_manifest.template.json"),
                os.path.join(unlock_dir, "closet_manifest.json"))
    _assert_no_emit(unlock_dir)


# --------------------------------------------------------------------------- #
# The REAL git seam (exercise it against the actually-committed freeze)
# --------------------------------------------------------------------------- #
def test_real_git_identity_distinguishes_committed_from_untracked(tmp_path):
    git = ev.RealGit(H26)
    committed = git.identity(os.path.join(H26, "preregistration.json"))
    assert committed.committed is True and len(committed.git_blob_sha) == 40
    # A genuinely-untracked file (exists on disk, absent from HEAD) is NOT committed-clean -> the emit
    # teeth refuse it. judge_addendum.md can no longer stand in here: its scaffold is committed so the
    # operator can freeze it in place (edit -> frozen:true -> commit), so RealGit reports it committed;
    # the gate that blocks an unfrozen scaffold is the schema `frozen:true` check, not this git one.
    probe = tmp_path / "untracked_probe.json"
    probe.write_text("{}\n")
    untracked = git.identity(str(probe))
    assert untracked.committed is False
    assert len(git.head_commit()) == 40


# --------------------------------------------------------------------------- #
# compute_gate_b — drops are excluded from BOTH sides (like-for-like, §12)
# --------------------------------------------------------------------------- #
def _q(set_id):
    return FitbQuestion(set_id=set_id, retained=("r1", "r2"),
                        candidates=("ans", "d1", "d2", "d3"), correct_index=0, answer_category="11")


class _PickCanonicalZeroClient:
    """Always picks the answer (canonical index 0) in BOTH orders: returns 'A' in forward, 'D' in
    reverse (reverse as-presented index 3 -> canonical 0) -> a consistent hit."""

    def complete(self, messages, *, max_tokens):
        # detect order by candidate label count is overkill; alternate by call parity instead.
        self._n = getattr(self, "_n", 0) + 1
        letter = "A" if self._n % 2 == 1 else "D"
        return JudgeResponse(content=f'{{"choice": "{letter}"}}', system_fingerprint=None, raw={})


class _DictProvider:
    def get(self, item_id):
        return __import__("gpt_judge").ItemContent(item_id, image_b64="aW1n")


def test_compute_gate_b_excludes_dropped_questions(tmp_path):
    questions = [_q("o01"), _q("o02"), _q("o03")]
    ledger = str(tmp_path / "judge_runs.ndjson")
    # o01,o02: scored by the consistent-hit client; o03: a fully-dropped order (all None).
    run_arm(questions[:2], arm="image_only", client=_PickCanonicalZeroClient(), provider=_DictProvider(),
            k_samples=1, max_tokens=8, retry_budget=0, model_snapshot="snap", ledger_path=ledger)
    from gpt_judge import JudgeSample, write_ledger
    drops = [JudgeSample("o03", "image_only", o, 0, None, 0, True, "snap", None, None) for o in ("forward", "reverse")]
    write_ledger(ledger, drops)

    def edge_score(i, j):  # trained head: a trivial scorer (the answer 'ans' is most compatible)
        return 1.0 if "ans" in (i, j) else 0.0

    from gpt_judge import read_ledger
    gb = ev.compute_gate_b(questions, edge_score, read_ledger(ledger), arm="image_only", seed=1, b=50)
    assert gb.n_dropped == 1 and gb.n_kept == 2           # o03 dropped, excluded from BOTH sides
    assert 0.0 <= gb.fitb_judge_gateB.point <= 1.0


def test_compute_gate_b_convention_wiring(tmp_path):
    # Pin that fitb_judge_gateB uses the HEADLINE inconsistent=miss convention and that the two gated
    # diffs genuinely differ by convention (a mutation swapping miss<->half on the readout/diff survives
    # the existing hit/drop-only coverage). Build one consistent hit + one inconsistent question.
    from gpt_judge import JudgeSample, read_ledger, write_ledger
    questions = [_q("o01"), _q("o02")]
    ledger = str(tmp_path / "judge_runs.ndjson")
    rows = [
        JudgeSample("o01", "image_only", "forward", 0, 0, 0, False, "s", None, None),   # canonical 0
        JudgeSample("o01", "image_only", "reverse", 0, 3, 0, False, "s", None, None),   # 3 -> canonical 0 -> HIT
        JudgeSample("o02", "image_only", "forward", 0, 0, 0, False, "s", None, None),   # canonical 0
        JudgeSample("o02", "image_only", "reverse", 0, 0, 0, False, "s", None, None),   # 0 -> canonical 3 -> INCONSISTENT
    ]
    write_ledger(ledger, rows)

    def edge_score(i, j):
        return 1.0 if "ans" in (i, j) else 0.0          # trained head hits both questions

    gb = ev.compute_gate_b(questions, edge_score, read_ledger(ledger), arm="image_only", seed=1, b=100, expected_k=1)
    assert gb.n_kept == 2 and gb.n_dropped == 0
    assert gb.fitb_judge_gateB.point == pytest.approx(0.5)     # miss conv: hit + inconsistent(miss=0) -> 1/2
    # half gives the inconsistent question 0.5 -> judge acc 0.75 -> a SMALLER trained-judge diff than miss
    assert gb.gate_B_diff_inconsistent_miss.point == pytest.approx(0.5)   # 1.0 - 0.5
    assert gb.gate_B_diff_inconsistent_half.point == pytest.approx(0.25)  # 1.0 - 0.75
    assert gb.gate_B_diff_inconsistent_miss.point > gb.gate_B_diff_inconsistent_half.point


# --------------------------------------------------------------------------- #
# compute_coherence_sensitivity — the §F reported-never-gating sliced diagnostic
# --------------------------------------------------------------------------- #
def _coh_fixture():
    """Three FITB questions with a controlled coherence split + a K=1 judge ledger: qc1 coherent
    (top+bottom, judge consistent-hit), qc2 coherent (dress, judge order-INCONSISTENT), qf1 flagged
    (retained already holds a shoe, the answer is another shoe; judge consistent-hit). The answer is
    always shoe_a at index 0, so the trivial edge score hits every question on the trained side."""
    types = {"top_a": "top", "bot_a": "bottom", "dress_a": "dress", "shoe_e": "shoes",
             "shoe_a": "shoes", "shoe_b": "shoes", "shoe_c": "shoes", "shoe_d": "shoes"}
    idx = {iid: Item(item_id=iid, category_id="c_" + t, semantic=t, type=t) for iid, t in types.items()}

    def mk(sid, retained):
        return FitbQuestion(sid, retained, ("shoe_a", "shoe_b", "shoe_c", "shoe_d"), 0, "c_shoes")

    questions = [mk("qc1", ("top_a", "bot_a")), mk("qc2", ("dress_a",)), mk("qf1", ("shoe_e", "top_a"))]

    def row(qid, order, choice):
        return JudgeSample(qid, "image_only", order, 0, choice, 0, choice is None,
                           "snap", None, None).to_row()

    rows = [
        row("qc1", "forward", 0), row("qc1", "reverse", 3),   # canonical 0 both -> HIT
        row("qc2", "forward", 0), row("qc2", "reverse", 0),   # reverse canonical 3 != 0 -> INCONSISTENT
        row("qf1", "forward", 0), row("qf1", "reverse", 3),   # HIT
    ]

    def edge_score(i, j):
        return 1.0 if "shoe_a" in (i, j) else 0.0

    return idx, questions, rows, edge_score


def test_coherence_sensitivity_slices_counts_and_rates():
    idx, questions, rows, edge = _coh_fixture()
    sens = ev.compute_coherence_sensitivity(
        questions, questions, idx, edge, rows, arm="image_only", seed=1, b=60, expected_k=1)
    assert sens["rule"] == COHERENCE_RULE
    assert sens["n_gate_b_coherent"] == 2 and sens["n_gate_b_flagged"] == 1
    assert sens["n_gate_b_coherent"] + sens["n_gate_b_flagged"] == len(questions)  # slices partition N
    # coherent slice: qc2 is the 1 inconsistent of 2 kept; flagged slice: qf1 kept, none inconsistent
    assert sens["judge_inconsistent_rate_coherent"] == pytest.approx(0.5)
    assert sens["judge_inconsistent_rate_flagged"] == pytest.approx(0.0)
    # trained hits everything; judge coherent-slice acc: miss-conv (1+0)/2, half-conv (1+0.5)/2
    assert sens["gate_B_diff_inconsistent_miss_coherent"]["point"] == pytest.approx(0.5)
    assert sens["gate_B_diff_inconsistent_half_coherent"]["point"] == pytest.approx(0.25)
    assert sens["gate_B_diff_inconsistent_miss_flagged"]["point"] == pytest.approx(0.0)
    for field in ("fitb_trained_full_coherent", "fitb_trained_full_flagged"):
        assert {"point", "low", "high", "b"} <= set(sens[field])
    assert sens["fitb_trained_full_coherent"]["point"] == pytest.approx(1.0)


def test_coherence_sensitivity_empty_slice_emits_nulls():
    idx, questions, rows, edge = _coh_fixture()
    coherent_only = questions[:2]                       # no flagged question in the prefix at all
    sens = ev.compute_coherence_sensitivity(
        coherent_only, coherent_only, idx, edge, rows[:4], arm="image_only", seed=1, b=50, expected_k=1)
    assert sens["n_gate_b_flagged"] == 0
    for field in ("gate_B_diff_inconsistent_miss_flagged", "gate_B_diff_inconsistent_half_flagged",
                  "judge_inconsistent_rate_flagged", "fitb_trained_full_flagged"):
        assert sens[field] is None
    assert sens["gate_B_diff_inconsistent_miss_coherent"] is not None


def test_coherence_sensitivity_zero_kept_slice_is_null_not_a_crash():
    # A NON-empty slice whose every question judge-DROPS (no parseable sample in an order) has no kept
    # question for the two-stage bootstrap — the diagnostic must preserve the counts and emit null
    # gate-B fields, never raise (it runs inside the gated emission path; a crash would block emit).
    idx, questions, rows, edge = _coh_fixture()

    def drop_row(qid, order):
        return JudgeSample(qid, "image_only", order, 0, None, 0, True, "snap", None, None).to_row()

    rows_dropped_flagged = rows[:4] + [drop_row("qf1", "forward"), drop_row("qf1", "reverse")]
    sens = ev.compute_coherence_sensitivity(
        questions, questions, idx, edge, rows_dropped_flagged,
        arm="image_only", seed=1, b=50, expected_k=1)
    assert sens["n_gate_b_flagged"] == 1                          # the count survives the drop
    assert sens["gate_B_diff_inconsistent_miss_flagged"] is None
    assert sens["gate_B_diff_inconsistent_half_flagged"] is None
    assert sens["judge_inconsistent_rate_flagged"] is None
    # the trained-side full-set slice never depends on judge drops -> still a CI
    assert {"point", "low", "high", "b"} <= set(sens["fitb_trained_full_flagged"])
    assert sens["gate_B_diff_inconsistent_miss_coherent"] is not None   # the other slice is untouched


def test_emit_validates_coherence_sensitivity_against_the_schema(unlock_dir):
    # The end-to-end shape check: the EXACT dict compute_coherence_sensitivity emits (CI dicts + rates)
    # must satisfy metrics.schema.json's optional coherence_sensitivity block through the real gated
    # emission, and the null-heavy zero-kept variant must too (the schema's anyOf-null legs).
    idx, questions, rows, edge = _coh_fixture()
    sens = ev.compute_coherence_sensitivity(
        questions, questions, idx, edge, rows, arm="image_only", seed=1, b=60, expected_k=1)
    metrics = ev.emit_metrics(_suite(), _gate_b(), root_dir=unlock_dir, git=FakeGit(), coherence=sens)
    assert metrics["coherence_sensitivity"]["rule"] == COHERENCE_RULE
    coherent_only = questions[:2]
    with_nulls = ev.compute_coherence_sensitivity(
        coherent_only, coherent_only, idx, edge, rows[:4], arm="image_only", seed=1, b=50, expected_k=1)
    unlock_files, selection_meta = ev.validate_unlock_files(unlock_dir, FakeGit())
    assembled = ev.assemble_metrics(_suite(), _gate_b(), unlock_files=unlock_files,
                                    selection_meta=selection_meta, git_commit="b" * 40,
                                    coherence=with_nulls)
    ev._validate_against_schema(assembled, os.path.join(unlock_dir, "metrics.schema.json"),
                                what="assembled metrics with null coherence slices")


def test_compute_gate_b_binds_ledger_snapshot_to_frozen_envelope(tmp_path):
    # §8: the gate-B ledger must be scored by the frozen judge snapshot; a mismatch (a stray --snapshot or
    # a mid-spike production bump) must refuse, not silently produce the headline number off an unfrozen model.
    from gpt_judge import JudgeSample, read_ledger, write_ledger
    questions = [_q("o01")]
    ledger = str(tmp_path / "judge_runs.ndjson")
    write_ledger(ledger, [
        JudgeSample("o01", "image_only", "forward", 0, 0, 0, False, "gpt-5.4-mini-2026-06-01", None, None),
        JudgeSample("o01", "image_only", "reverse", 0, 3, 0, False, "gpt-5.4-mini-2026-06-01", None, None),
    ])

    def edge_score(i, j):
        return 1.0 if "ans" in (i, j) else 0.0

    rows = read_ledger(ledger)
    # the matching snapshot passes; the frozen (different) snapshot refuses.
    ev.compute_gate_b(questions, edge_score, rows, arm="image_only", seed=1, b=50,
                      expected_snapshot="gpt-5.4-mini-2026-06-01")
    with pytest.raises(UnlockError, match="does not move after|binds"):
        ev.compute_gate_b(questions, edge_score, rows, arm="image_only", seed=1, b=50,
                          expected_snapshot="gpt-5.4-mini-2026-03-17")
