"""Freeze-integrity tests for the Track-2 transfer re-measure pre-registration.

Three load-bearing pins:
  1. CROSS-RUNTIME: the export certificate floors (JS, the live consumer in
     fitted/scripts/exportTrack2Core.cjs `CERTIFICATE`) byte-equal preregistration.json
     `export_certificate`. A hand-copied floor that drifts silently is the exact disease the
     CLAUDE.md build-loop bans; this test is the CI-shaped guard the prereg cites.
  2. REPRODUCIBLE DERIVATION: derive_power.py, re-run, reproduces the committed power_derivation.json
     AND the derivation anchors mirrored into preregistration.json — so the "owned arithmetic" claim
     stays true and the two undecidability proofs cannot rot.
  3. .md <-> .json AGREEMENT: the human-authority .md states the same frozen floors the .json carries.
"""

import json
import os
import re

import derive_power

HERE = os.path.dirname(os.path.abspath(__file__))
EXP_DIR = os.path.dirname(HERE)
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(EXP_DIR)))  # track2_transfer -> experiments -> ml-system -> root
PREREG_JSON = os.path.join(EXP_DIR, "preregistration.json")
PREREG_MD = os.path.join(EXP_DIR, "preregistration.md")
EXPORT_CJS = os.path.join(REPO_ROOT, "fitted", "scripts", "exportTrack2Core.cjs")


def _load(path):
    with open(path) as f:
        return f.read()


def _parse_js_certificate(js_text):
    """Extract the CERTIFICATE object literal's numeric fields from the .cjs (no JS engine needed).

    The block is `const CERTIFICATE = { key: <number>, // comment ... };` — parse `key: number`.
    """
    m = re.search(r"const CERTIFICATE = \{(.*?)\};", js_text, re.DOTALL)
    assert m, "CERTIFICATE object not found in exportTrack2Core.cjs"
    body = m.group(1)
    out = {}
    for key, val in re.findall(r"(\w+):\s*([0-9.]+)", body):
        out[key] = float(val) if "." in val else int(val)
    return out


def test_export_certificate_matches_across_runtimes():
    prereg = json.loads(_load(PREREG_JSON))
    ec = prereg["export_certificate"]
    js = _parse_js_certificate(_load(EXPORT_CJS))
    for key in ("primaryDecisionMinPerArm", "transferInterpMin", "transferDecisionMin",
                "perFriendConcentrationCap", "minCategoryDepthForNegative"):
        assert key in js, f"{key} missing from JS CERTIFICATE"
        assert js[key] == ec[key], f"floor drift on {key}: JS={js[key]} vs prereg.json={ec[key]}"


def test_derivation_reproduces_committed_numbers():
    out = derive_power.main()
    # Half-widths at AUC 0.70 confirm the audit's directional band (owned exact values).
    hw = out["half_width_balanced"]["table"]["0.70"]
    assert round(hw["30"], 3) == 0.133
    assert round(hw["40"], 3) == 0.115
    assert round(hw["60"], 3) == 0.093
    # The inherited 0.70 floor is structurally unpassable: required point > catalog ceiling at every N.
    ceiling = out["anchors"]["catalog_pair_auc"]
    for row in out["floor_read_undecidable"]:
        assert row["required_point_to_pass"] > ceiling, f"N={row['n']} should be unpassable"
        assert row["exceeds_catalog_ceiling"] is True
    # The drop read is impossible at N<=30 even at a perfect transfer (half-width alone > 0.12).
    small = [r for r in out["drop_read_fails_at_zero"]["rows"] if r["n"] <= 30]
    assert all(r["half_width_drop"] > 0.12 for r in small)
    # The replacement is decidable at achievable N given a moderate effect.
    excl = out["min_n_to_exclude_chance"]
    assert excl["0.6500"] == 26 and excl["0.7000"] == 14
    assert excl["0.5500"] is None or excl["0.5500"] > 200  # weak effect: not decidable at cohort N


def test_prereg_json_derivation_mirror_agrees():
    prereg = json.loads(_load(PREREG_JSON))
    d = prereg["derivation"]
    assert d["half_width_at_auc_0.70"] == {"n30": 0.133, "n40": 0.115, "n60": 0.093}
    assert d["floor_unpassable"]["catalog_ceiling"] == 0.7315
    assert d["min_n_per_arm_to_exclude_chance"]["0.65"] == 26


def test_md_states_the_frozen_floors():
    md = " ".join(_load(PREREG_MD).split())  # collapse markdown line-wrapping before substring checks
    prereg = json.loads(_load(PREREG_JSON))
    ec = prereg["export_certificate"]
    # The human authority must name the same decision floors (guards md/json drift on the load-bearing numbers).
    assert "25 scoreable clusters" in md
    assert "0.60" in md and "0.50" in md  # point-estimate floor + chance boundary
    assert "2026-10-31" in md  # the horizon
    assert f"≥ {ec['transferInterpMin']} scoreable" in md  # the transfer interpretation floor
