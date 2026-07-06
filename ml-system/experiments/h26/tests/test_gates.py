"""Tests for the C6 gate-application half (§12/§15-C6) — `evaluate.apply_gates` + finalize guards.

`apply_gates` is pure (metrics dict + the frozen preregistration.json in, verdict structure out),
so the near-gate rule, the gate-B power sub-rule (the letter-check), the vacuity guard, the
descriptive transfer bands, and the pre-committed disclosure labels are all pinned hermetically.
One test reads the REAL committed artifacts to pin the letter-check outcome on the actual data:
the adjudicating (inconsistent = miss) gate-B diff half-width exceeds the frozen δ = 0.05 — by
~3e-4 — so gate B reads "underpowered / inconclusive" and the mechanical verdict is NO-GO, applied
verbatim per preregistration.md §B (δ never widens; N is capped), with the margin disclosed.
"""

import json
import os

import pytest

import evaluate as ev
from data_loader import load_json_strict
from evaluate import UnlockError

H26 = os.path.dirname(os.path.dirname(__file__))


@pytest.fixture(scope="module")
def prereg():
    return load_json_strict(os.path.join(H26, "preregistration.json"))


def _ci(point, low, high, b=10000):
    return {"point": point, "low": low, "high": high, "b": b}


def _metrics(**overrides):
    """A synthetic all-gates-pass metrics dict; tests override single fields to flip one leg."""
    m = {
        "gate_A_diff": _ci(0.10, 0.09, 0.11),
        "gate_B_diff_inconsistent_miss": _ci(0.02, -0.02, 0.06),   # HW 0.04 <= delta, low >= -delta
        "gate_B_diff_inconsistent_half": _ci(0.01, -0.03, 0.05),
        "fitb_judge_gateB": _ci(0.55, 0.52, 0.58),
        "outfit_auc": _ci(0.84, 0.83, 0.85),
        "fitb_trained_full": _ci(0.62, 0.61, 0.63),
        "catalog_closet_drop": _ci(0.05, 0.01, 0.10),
        "AUC_closet_pair": _ci(0.75, 0.72, 0.78),
        "AUC_pop_edge": _ci(0.52, 0.51, 0.53),
        "AUC_pop_outfit": _ci(0.54, 0.53, 0.55),
        "seam_diff_pairwise_minus_item_level": _ci(0.21, 0.20, 0.22),
        "seam_holm_adjusted_p": 0.0001,
    }
    m.update(overrides)
    return m


def test_all_pass_verdict_go(prereg):
    v = ev.apply_gates(_metrics(), prereg)
    assert v["verdict"] == "GO"
    assert v["A"]["pass"] and v["B"]["pass"] and v["D"]["pass"]
    assert v["B"]["miss"]["state"] == "pass" and not v["B"]["vacuous"]
    assert v["reported_transfer"]["drop"]["within_band"]
    assert v["reported_transfer"]["closet_floor"]["within_band"]
    assert not v["popularity_confounded_disclosed"]
    assert v["seam"]["item_level_falsified"]


def test_gate_a_straddle_fails(prereg):
    v = ev.apply_gates(_metrics(gate_A_diff=_ci(0.02, -0.01, 0.05)), prereg)
    assert not v["A"]["pass"] and v["verdict"] == "NO-GO"


def test_gate_b_power_subrule_underpowered_is_no_go(prereg):
    """The letter-check shape: CI_low clears -delta decisively (the head even BEATS the judge)
    but half_width > delta at the cap -> 'underpowered / inconclusive' -> NO-GO (§B verbatim)."""
    v = ev.apply_gates(
        _metrics(gate_B_diff_inconsistent_miss=_ci(0.27, 0.22, 0.33)), prereg  # HW 0.055
    )
    assert v["B"]["miss"]["state"] == "underpowered / inconclusive"
    assert v["B"]["miss"]["non_inferiority"] is True   # not an accuracy miss — a power miss
    assert not v["B"]["pass"] and v["verdict"] == "NO-GO"
    assert v["B"]["power_margin_miss"] == pytest.approx(0.055 - prereg["gates"]["B"]["delta"])


def test_gate_b_inferior_fails(prereg):
    v = ev.apply_gates(
        _metrics(gate_B_diff_inconsistent_miss=_ci(-0.08, -0.12, -0.04)), prereg
    )
    assert v["B"]["miss"]["state"] == "fail" and v["verdict"] == "NO-GO"


def test_gate_b_vacuity_flag(prereg):
    v = ev.apply_gates(_metrics(fitb_judge_gateB=_ci(0.26, 0.24, 0.28)), prereg)
    assert v["B"]["vacuous"] is True  # judge CI_low <= chance@4 -> parity claim uninformative
    assert v["verdict"] == "GO"       # the frozen A^B^D gate itself does not change (§B)


def test_gate_d_floor_reads_ci_low(prereg):
    v = ev.apply_gates(_metrics(outfit_auc=_ci(0.82, 0.805, 0.835)), prereg)
    assert not v["D"]["legs"]["outfit_auc"]["pass"] and v["verdict"] == "NO-GO"
    v2 = ev.apply_gates(_metrics(fitb_trained_full=_ci(0.51, 0.49, 0.53)), prereg)
    assert not v2["D"]["legs"]["fitb_trained_full"]["pass"] and v2["verdict"] == "NO-GO"


def test_transfer_bands_are_descriptive_not_gating(prereg):
    v = ev.apply_gates(
        _metrics(catalog_closet_drop=_ci(0.29, 0.10, 0.47), AUC_closet_pair=_ci(0.44, 0.27, 0.63)),
        prereg,
    )
    assert not v["reported_transfer"]["drop"]["within_band"]
    assert not v["reported_transfer"]["closet_floor"]["within_band"]
    assert v["verdict"] == "GO"  # the transfer never enters the AND-gate (§12)


def test_popularity_label_reads_blind_margin(prereg):
    v = ev.apply_gates(_metrics(AUC_pop_outfit=_ci(0.56, 0.555, 0.565)), prereg)
    assert v["popularity_confounded_disclosed"] is True


def test_coherence_sensitive_label_compares_slice_state(prereg):
    coh = {"gate_B_diff_inconsistent_miss_coherent": _ci(-0.08, -0.12, -0.04)}  # slice FAILS
    v = ev.apply_gates(_metrics(coherence_sensitivity=coh), prereg)
    assert v["coherent_slice_gate_b_state"] == "fail"
    assert v["coherence_sensitive_disclosed"] is True  # headline passes, slice disagrees (§C.8)
    same = {"gate_B_diff_inconsistent_miss_coherent": _ci(0.02, -0.01, 0.05)}
    v2 = ev.apply_gates(_metrics(coherence_sensitivity=same), prereg)
    assert v2["coherence_sensitive_disclosed"] is False


def test_seam_claim_requires_both_legs(prereg):
    v = ev.apply_gates(_metrics(seam_holm_adjusted_p=0.2), prereg)
    assert not v["seam"]["item_level_falsified"]
    v2 = ev.apply_gates(
        _metrics(seam_diff_pairwise_minus_item_level=_ci(0.01, -0.01, 0.03)), prereg
    )
    assert not v2["seam"]["item_level_falsified"]


def test_apply_gates_on_the_real_committed_artifacts(prereg):
    """Pin the letter-check on the REAL data: the adjudicating miss-convention diff's half-width
    exceeds delta by ~3e-4 at the frozen N=500 cap, so gate B reads 'underpowered / inconclusive'
    and the mechanical verdict is NO-GO — while A and D pass, the half-convention cross-check is
    powered-and-passing, and the judge is decisively non-vacuous. (Closet/transfer fields change
    with the C5 probe, so no transfer-band outcome is pinned here.)"""
    metrics = load_json_strict(os.path.join(H26, "metrics.json"))
    v = ev.apply_gates(metrics, prereg)
    assert v["A"]["pass"] is True
    assert v["D"]["pass"] is True
    assert v["B"]["miss"]["non_inferiority"] is True
    assert v["B"]["miss"]["state"] == "underpowered / inconclusive"
    assert 0 < v["B"]["power_margin_miss"] < 0.001  # over budget by ~3e-4, disclosed not waved away
    assert v["B"]["half"]["state"] == "pass"        # the conservative cross-check is powered
    assert v["B"]["vacuous"] is False
    assert v["verdict"] == "NO-GO"
    assert v["popularity_confounded_disclosed"] is True


# --------------------------------------------------------------------------- #
# finalize guards (the cheap refusals; the bind refusals share merge's tested comparison)
# --------------------------------------------------------------------------- #
def test_finalize_refuses_before_c5(tmp_path):
    root = tmp_path / "h26"
    root.mkdir()
    (root / "metrics.json").write_text(json.dumps({"_meta": {"stage": "C4"}}))
    with pytest.raises(UnlockError, match="requires stage C5"):
        ev.finalize_metrics(str(root))


def test_finalize_refuses_when_metrics_absent(tmp_path):
    root = tmp_path / "h26"
    root.mkdir()
    with pytest.raises(UnlockError, match="emit .* merge-closet"):
        ev.finalize_metrics(str(root))


# --------------------------------------------------------------------------- #
# the verdict CLI read (print_verdict_from_files + the main() dispatch)
# --------------------------------------------------------------------------- #
def test_verdict_refuses_before_finalize(tmp_path):
    root = tmp_path / "h26"
    root.mkdir()
    (root / "metrics.json").write_text(json.dumps({"_meta": {"stage": "C5"}}))
    with pytest.raises(UnlockError, match="requires the finalized stage C6"):
        ev.print_verdict_from_files(str(root))


def test_verdict_refuses_when_metrics_absent(tmp_path):
    root = tmp_path / "h26"
    root.mkdir()
    with pytest.raises(UnlockError, match="emit .* before verdict"):
        ev.print_verdict_from_files(str(root))


def test_verdict_cli_on_the_real_finalized_artifacts(capsys):
    """Pin the CLI surface on the REAL finalized file (stage C6): `evaluate.py verdict` prints the
    letter-check NO-GO — gate B UNDERPOWERED / INCONCLUSIVE with the ~3e-4 margin disclosed — plus
    the finalize-only footers (seam Holm p + the 3-seed robustness line). Values beyond the pinned
    letter-check are asserted as PRESENT, not re-pinned (sensitivity blocks are reported-only)."""
    metrics = load_json_strict(os.path.join(H26, "metrics.json"))
    if metrics["_meta"]["stage"] != "C6":
        pytest.fail("metrics.json is not finalized (stage C6) — run `evaluate.py finalize` (§15-C6)")
    ev.main(["verdict"])
    out = capsys.readouterr().out
    assert "MECHANICAL VERDICT (A AND B AND D): NO-GO" in out
    assert "state: UNDERPOWERED / INCONCLUSIVE" in out
    assert "power letter-check: half-width exceeds delta by" in out
    assert "Seam (§C.2): Holm p =" in out
    assert "3-seed robustness footnote:" in out
