"""Hermetic tests for the gate-B POWER EXTENSION tool (`gate_b_extension.py`) — no network, no OpenAI,
no real corpus, no checkpoint. Covers the pure freeze-discipline logic the extension leans on:

  - `extension_letter` is a VERBATIM mirror of `evaluate.apply_gates`' function-local `b_leg` (which
    cannot be imported). The mirror-needs-a-test rule (CLAUDE.md) is discharged HERE: the mirror is
    pinned against the REAL frozen `metrics.json` + `preregistration.json` — feeding the frozen
    `gate_B_diff_inconsistent_miss` must reproduce half-width 0.050302 -> "underpowered / inconclusive",
    and must equal `apply_gates(...)["B"]["miss"]` field-for-field (the real b_leg output).
  - `plan_resume` splits the extension set into (done, todo) with keep-last dedup, and refuses a foreign
    question_id (a corrupt ledger must never be silently extended).
  - `assert_choice_ranges` (§23-H56 hardening note 2) fails loud on an out-of-range cached choice.
  - `build_extension_freeze` refuses an out-of-range n_ext or a drifted first-500 order.
  - `require_extension_freeze` teeth (frozen:true + committed-clean + bind match), driven by FakeGit.
"""

import json
import os

import pytest

import gate_b_extension as gx
from data_loader import FitbQuestion, load_json_strict
from evaluate import apply_gates
from fitb_order import _order_sha256
from test_evaluate_emission import FakeGit

H26 = os.path.dirname(os.path.dirname(__file__))
DELTA = 0.05


# --------------------------------------------------------------------------- #
# extension_letter — the b_leg mirror, pinned against the FROZEN record + apply_gates
# --------------------------------------------------------------------------- #
def test_extension_letter_mirrors_apply_gates_on_the_frozen_record():
    metrics = load_json_strict(os.path.join(H26, "metrics.json"))
    prereg = load_json_strict(os.path.join(H26, "preregistration.json"))
    gates = apply_gates(metrics, prereg)                       # the REAL b_leg caller

    miss = gx.extension_letter(metrics["gate_B_diff_inconsistent_miss"], DELTA)
    half = gx.extension_letter(metrics["gate_B_diff_inconsistent_half"], DELTA)
    assert miss == gates["B"]["miss"]                          # field-for-field == the real b_leg output
    assert half == gates["B"]["half"]
    # the frozen verdict this whole extension exists to close: underpowered by +0.000302
    assert miss["half_width"] == pytest.approx(0.050302, abs=1e-6)
    assert miss["state"] == "underpowered / inconclusive"
    assert miss["non_inferiority"] is True                     # location passes; only power fails
    assert half["state"] == "pass"                             # the conservative convention is powered-pass


def test_extension_letter_synthetic_legs():
    # pass: located above -delta AND powered (half-width <= delta)
    p = gx.extension_letter({"low": 0.02, "high": 0.06, "point": 0.04, "b": 10}, DELTA)
    assert p["powered"] and p["non_inferiority"] and p["state"] == "pass"
    # fail: powered but located below -delta
    f = gx.extension_letter({"low": -0.08, "high": -0.02, "point": -0.05, "b": 10}, DELTA)
    assert f["powered"] and not f["non_inferiority"] and f["state"] == "fail"
    # underpowered: half-width > delta (the boundary — hw == delta is still powered)
    u = gx.extension_letter({"low": -0.02, "high": 0.101, "point": 0.04, "b": 10}, DELTA)
    assert not u["powered"] and u["state"] == "underpowered / inconclusive"
    edge = gx.extension_letter({"low": 0.0, "high": 0.10, "point": 0.05, "b": 10}, DELTA)
    assert edge["half_width"] == pytest.approx(0.05) and edge["powered"] and edge["state"] == "pass"


# --------------------------------------------------------------------------- #
# plan_resume — (done, todo) split, keep-last dedup, foreign-row refusal
# --------------------------------------------------------------------------- #
def _q(i):
    return FitbQuestion(f"q{i}", ("r",), ("a", "b", "c", "d"), 0, "11")


def _rows(qid, *, k, orders=("forward", "reverse"), arm="image_only", snapshot="snap"):
    return [
        {"arm": arm, "question_id": qid, "order": o, "sample_index": s, "choice": 0,
         "retried": 0, "dropped": False, "model_snapshot": snapshot,
         "system_fingerprint": None, "payload_log_sha256": None}
        for o in orders for s in range(k)
    ]


def test_plan_resume_splits_done_and_todo():
    ext = [_q(500), _q(501), _q(502)]
    rows = _rows("q500", k=2) + _rows("q501", k=2, orders=("forward",))  # 501 missing reverse -> todo
    done, todo = gx.plan_resume(rows, ext, k_samples=2)
    assert [q.set_id for q in done] == ["q500"]
    assert [q.set_id for q in todo] == ["q501", "q502"]                  # 501 partial + 502 absent


def test_plan_resume_keep_last_dedup_makes_a_rerun_idempotent():
    ext = [_q(500)]
    rows = _rows("q500", k=2) + _rows("q500", k=2)                        # a re-run appended a 2nd copy
    done, todo = gx.plan_resume(rows, ext, k_samples=2)
    assert [q.set_id for q in done] == ["q500"] and todo == []           # deduped to complete, not doubled


def test_plan_resume_refuses_a_foreign_question():
    ext = [_q(500)]
    rows = _rows("q999", k=2)                                             # outside the frozen extension set
    with pytest.raises(ValueError, match="outside the frozen"):
        gx.plan_resume(rows, ext, k_samples=2)


# --------------------------------------------------------------------------- #
# assert_choice_ranges — §23-H56 hardening note 2 (corrupt cached choice fails loud)
# --------------------------------------------------------------------------- #
def test_assert_choice_ranges_passes_in_range_and_null():
    qs = [_q(0)]                                                          # 4 candidates -> [0,4)
    rows = _rows("q0", k=1)
    rows[0]["choice"] = 3
    rows.append({**rows[0], "order": "reverse", "choice": None})          # null (dropped) is fine
    gx.assert_choice_ranges(rows, qs)                                     # no raise


def test_assert_choice_ranges_fails_out_of_range():
    qs = [_q(0)]
    rows = _rows("q0", k=1)
    rows[0]["choice"] = 4                                                 # == n_candidates -> out of [0,4)
    with pytest.raises(ValueError, match="out of range"):
        gx.assert_choice_ranges(rows, qs)


def test_assert_choice_ranges_skips_unknown_id_and_foreign_arm():
    qs = [_q(0)]
    foreign_id = _rows("q999", k=1)                                       # not in qs -> left to membership guards
    foreign_id[0]["choice"] = 99
    foreign_arm = _rows("q0", k=1, arm="text_attribute")
    foreign_arm[0]["choice"] = 99
    gx.assert_choice_ranges(foreign_id + foreign_arm, qs)                 # neither is range-checked -> no raise


# --------------------------------------------------------------------------- #
# build_extension_freeze — one-shot power freeze assembly + its refusals (pure core)
# --------------------------------------------------------------------------- #
def _order(questions, *, n_full):
    return {"seed": 123, "n_questions_full": n_full,
            "gate_b_set_ids": [q.set_id for q in questions[:gx.N_ORIGINAL]]}


def _questions(n):
    return [_q(i) for i in range(n)]


def test_build_extension_freeze_happy_path():
    qs = _questions(600)
    order = _order(qs, n_full=600)
    fz = gx.build_extension_freeze(qs, order, n_ext=550, binds={"x": "y"}, frozen_date="2026-07-21")
    assert fz["frozen"] is True and fz["n_original"] == gx.N_ORIGINAL and fz["n_ext"] == 550
    assert fz["extension_new_set_ids"] == [q.set_id for q in qs[gx.N_ORIGINAL:550]]
    assert fz["extension_prefix_sha256"] == _order_sha256(qs[:550])
    assert fz["seed"] == 123 and fz["binds"] == {"x": "y"}


def test_build_extension_freeze_refuses_out_of_range_n():
    qs = _questions(600)
    order = _order(qs, n_full=600)
    with pytest.raises(ValueError, match="must be in"):
        gx.build_extension_freeze(qs, order, n_ext=gx.N_ORIGINAL, binds={}, frozen_date="d")   # not > 500
    with pytest.raises(ValueError, match="must be in"):
        gx.build_extension_freeze(qs, order, n_ext=601, binds={}, frozen_date="d")             # > n_full


def test_build_extension_freeze_refuses_drifted_first_500():
    qs = _questions(600)
    order = _order(qs, n_full=600)
    order["gate_b_set_ids"][0] = "DRIFTED"                                # constructor/seed drift
    with pytest.raises(ValueError, match="do not match the frozen"):
        gx.build_extension_freeze(qs, order, n_ext=550, binds={}, frozen_date="d")


# --------------------------------------------------------------------------- #
# require_extension_freeze — the build-order teeth (frozen:true + committed + bind match)
# --------------------------------------------------------------------------- #
def _write_ext_scaffold(tmp_path, *, frozen=True, drift_order=False):
    """A minimal tmp root with the three bind-checked files + a matching gate_b_extension.json."""
    root = tmp_path / "h26"
    root.mkdir()
    (root / "fitb_order.json").write_text('{"o": 1}', encoding="utf-8")
    (root / "judge_addendum.md").write_text("frozen envelope", encoding="utf-8")
    (root / gx.ORIGINAL_LEDGER).write_text('{"question_id":"x"}\n', encoding="utf-8")
    binds = {
        "fitb_order_file_sha256": gx._file_sha256(str(root / "fitb_order.json")),
        "judge_addendum_file_sha256": gx._file_sha256(str(root / "judge_addendum.md")),
        "original_ledger_sha256": gx._file_sha256(str(root / gx.ORIGINAL_LEDGER)),
    }
    if drift_order:                                                       # a frozen input changed after freeze
        (root / "fitb_order.json").write_text('{"o": 2}', encoding="utf-8")
    (root / gx.EXT_FREEZE).write_text(json.dumps({"frozen": frozen, "n_ext": 1000, "binds": binds}), encoding="utf-8")
    return str(root)


def test_require_extension_freeze_accepts_committed_frozen_with_matching_binds(tmp_path):
    root = _write_ext_scaffold(tmp_path)
    ext = gx.require_extension_freeze(root_dir=root, git=FakeGit(committed=True))
    assert ext["n_ext"] == 1000


def test_require_extension_freeze_refuses_unfrozen(tmp_path):
    root = _write_ext_scaffold(tmp_path, frozen=False)
    with pytest.raises(SystemExit, match="not frozen"):
        gx.require_extension_freeze(root_dir=root, git=FakeGit(committed=True))


def test_require_extension_freeze_refuses_uncommitted(tmp_path):
    root = _write_ext_scaffold(tmp_path)
    with pytest.raises(SystemExit, match="committed-clean"):
        gx.require_extension_freeze(root_dir=root, git=FakeGit(committed=False))


def test_require_extension_freeze_refuses_bind_drift(tmp_path):
    root = _write_ext_scaffold(tmp_path, drift_order=True)               # fitb_order.json changed post-freeze
    with pytest.raises(SystemExit, match="drifted"):
        gx.require_extension_freeze(root_dir=root, git=FakeGit(committed=True))
