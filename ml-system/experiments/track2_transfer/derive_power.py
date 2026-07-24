"""Re-derivation of the Track-2 catalog->closet re-measure power arithmetic.

This is the *owned* derivation for `preregistration.md` (the 2026-07-20 merit audit checked its
Hanley-McNeil half-widths and yield model directionally; this session re-derives them from scratch
and this file is the reproducible source). Pure standard library on purpose (only `math`): the
result is arithmetic, not a simulation, so it must run anywhere with zero heavy deps and no venv.

Run: `python derive_power.py`  -> prints the frozen tables + writes `power_derivation.json`
(the machine-readable numbers `preregistration.json` mirrors and `tests/test_preregistration.py`
pins). `main(out_path=...)` lets that test re-derive into a tmp file and assert byte-for-byte
equality against the committed artifact WITHOUT overwriting the frozen one (the CLI default still
writes the committed location, so `python derive_power.py` is byte-identical to before).

The three questions it answers, each stated in the doc:

  1. Own the half-widths: at AUC=0.70, balanced n_pos=n_neg=N, the 95% CI half-width is
     0.133 / 0.115 / 0.093 at N=30 / 40 / 60 (re-derived from scratch; confirms + sharpens the merit
     audit's directional +/-0.09-0.13 band).
  2. Show the inherited `CI_low(AUC_closet) >= 0.70` floor read is STRUCTURALLY undecidable: to
     pass it you need a point estimate >= 0.70 + half_width, which at every achievable N sits ABOVE
     the in-domain catalog ceiling (0.7315 pair-AUC, H26 results.md sec.3) -- the pass bar exceeds
     the theoretical best case.
  3. Show the inherited `CI_high(drop) <= 0.12` read fails even at a PERFECT transfer (true drop 0):
     CI_high = drop_point + half_width(drop) ~ half_width(closet), which exceeds 0.12 at N<=30
     always and ~half the time at N=40.

Then it derives the replacement rule's decidability: the minimum balanced-N to EXCLUDE the chance
boundary 0.50 (CI_low(AUC) > 0.50) at a range of true AUC point values -- the decidable boundary the
prereg adopts.
"""

from __future__ import annotations

import json
import math
import os

# --- Anchors (all read from H26, not re-measured here) ------------------------------------------
CATALOG_PAIR_AUC = 0.7315  # in-domain trained-head pair-AUC ceiling (results.md sec.3, sec.6 table)
CHANCE = 0.50
HEALTHY_FLOOR = 0.70  # the inherited (now-retired-as-gate) closet-AUC floor
DROP_HEALTHY_MAX = 0.12  # the inherited (now-retired-as-gate) drop ceiling
Z95 = 1.959963984540054  # two-sided 95% normal quantile


def hanley_mcneil_se(auc: float, n_pos: int, n_neg: int) -> float:
    """Hanley & McNeil (1982) large-sample SE of a single AUC.

    SE = sqrt[ ( A(1-A) + (n_pos-1)(Q1 - A^2) + (n_neg-1)(Q2 - A^2) ) / (n_pos * n_neg) ]
    with Q1 = A/(2-A), Q2 = 2A^2/(1+A). This is the exponential-score approximation; it is the
    standard analytic AUC SE and the right planning instrument here (a cluster bootstrap on real
    data will read at least this wide -- clustering only inflates it, so HM is the OPTIMISTIC bound
    on precision, which is the honest direction for a "can this even decide?" argument).
    """
    q1 = auc / (2.0 - auc)
    q2 = 2.0 * auc * auc / (1.0 + auc)
    a2 = auc * auc
    num = auc * (1.0 - auc) + (n_pos - 1) * (q1 - a2) + (n_neg - 1) * (q2 - a2)
    return math.sqrt(num / (n_pos * n_neg))


def half_width(auc: float, n_pos: int, n_neg: int) -> float:
    return Z95 * hanley_mcneil_se(auc, n_pos, n_neg)


def min_balanced_n_to_exclude(boundary: float, true_auc: float, n_cap: int = 400) -> int | None:
    """Smallest balanced N (= n_pos = n_neg) with CI_low(true_auc) > boundary, i.e.
    true_auc - Z95*SE > boundary. None if not reached by n_cap. Assumes the point estimate lands
    at true_auc (a planning idealization -- realized data adds sampling scatter)."""
    if true_auc <= boundary:
        return None
    for n in range(2, n_cap + 1):
        if true_auc - half_width(true_auc, n, n) > boundary:
            return n
    return None


def main(out_path: str | None = None) -> dict:
    out: dict = {"anchors": {
        "catalog_pair_auc": CATALOG_PAIR_AUC, "chance": CHANCE,
        "healthy_floor": HEALTHY_FLOOR, "drop_healthy_max": DROP_HEALTHY_MAX, "z95": Z95,
    }}

    # (1) Half-width table (balanced) at the AUC values that matter -------------------------------
    ns = [12, 15, 20, 25, 30, 40, 60, 80, 120]
    aucs = [0.55, 0.60, 0.65, 0.70]
    hw_table = {f"{a:.2f}": {str(n): round(half_width(a, n, n), 4) for n in ns} for a in aucs}
    out["half_width_balanced"] = {"ns": ns, "aucs": aucs, "table": hw_table}

    print("=" * 78)
    print("(1) 95% CI half-width, Hanley-McNeil, balanced n_pos = n_neg = N")
    print("    (owned re-derivation: AUC=0.70 -> 0.133/0.115/0.093 at N=30/40/60; audit's dir. band was +/-0.09-0.13)")
    print("-" * 78)
    header = "AUC \\ N | " + " ".join(f"{n:>6}" for n in ns)
    print(header)
    for a in aucs:
        row = f"  {a:.2f}  | " + " ".join(f"{half_width(a, n, n):>6.3f}" for n in ns)
        print(row)

    # (2) Structural undecidability of the CI_low(AUC_closet) >= 0.70 floor ------------------------
    print("\n" + "=" * 78)
    print("(2) Inherited floor read CI_low(AUC_closet) >= 0.70 is STRUCTURALLY undecidable")
    print("    pass needs point >= 0.70 + half_width; compare to catalog ceiling 0.7315")
    print("-" * 78)
    floor_rows = []
    print("   N | half_width@0.70 | required point | exceeds catalog 0.7315?")
    for n in [30, 40, 60, 80, 120]:
        hw = half_width(HEALTHY_FLOOR, n, n)
        required = HEALTHY_FLOOR + hw
        exceeds = required > CATALOG_PAIR_AUC
        floor_rows.append({"n": n, "half_width_at_0.70": round(hw, 4),
                           "required_point_to_pass": round(required, 4),
                           "exceeds_catalog_ceiling": exceeds})
        print(f" {n:>3} |     {hw:.4f}      |    {required:.4f}    | {'YES -> unpassable' if exceeds else 'no'}")
    out["floor_read_undecidable"] = floor_rows

    # (3) Drop read CI_high(drop) <= 0.12 fails even at a perfect transfer (true drop 0) ----------
    # drop = AUC_catalog - AUC_closet, two INDEPENDENT bootstraps. The catalog term is powered
    # (H26: 44,627 pairs, half_width ~ 0.003). Var(drop) = Var(cat) + Var(closet) ~ Var(closet).
    hw_catalog = 0.003  # H26 catalog pair-AUC 95% half-width (results.md sec.3: [0.7284,0.7345])
    print("\n" + "=" * 78)
    print("(3) Inherited drop read CI_high(drop) <= 0.12 fails even at true drop 0")
    print("    at true drop 0: CI_high = 0 + half_width(drop); P(pass) via drop_point ~ N(0, SE^2)")
    print("-" * 78)
    drop_rows = []
    print("   N | half_width(drop) | CI_high@drop_pt=0 | P(CI_high <= 0.12) at true drop 0")
    for n in [20, 25, 30, 40, 60, 80]:
        se_closet = hanley_mcneil_se(HEALTHY_FLOOR, n, n)
        se_drop = math.sqrt(se_closet ** 2 + (hw_catalog / Z95) ** 2)
        hw_drop = Z95 * se_drop
        # pass iff drop_point + hw_drop <= 0.12  ->  drop_point <= 0.12 - hw_drop
        thresh = DROP_HEALTHY_MAX - hw_drop
        # drop_point ~ N(0, se_drop^2); P(drop_point <= thresh) = Phi(thresh/se_drop)
        z = thresh / se_drop
        p_pass = 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))
        drop_rows.append({"n": n, "half_width_drop": round(hw_drop, 4),
                          "p_pass_at_true_drop_zero": round(p_pass, 3)})
        note = "IMPOSSIBLE (hw>0.12)" if hw_drop > DROP_HEALTHY_MAX else f"{p_pass:.2f}"
        print(f" {n:>3} |      {hw_drop:.4f}      |      {hw_drop:.4f}       | {note}")
    out["drop_read_fails_at_zero"] = {"half_width_catalog": hw_catalog, "rows": drop_rows}

    # (4) Replacement: minimum balanced-N to EXCLUDE the chance boundary 0.50 --------------------
    print("\n" + "=" * 78)
    print("(4) Replacement decidability: min balanced-N with CI_low(AUC) > 0.50 (chance boundary)")
    print("    (idealized: point estimate = true AUC; realized data adds scatter)")
    print("-" * 78)
    excl = {}
    print(" true AUC | min N per arm to exclude 0.50 | total labeled (2N)")
    for a in [0.55, 0.58, 0.60, 0.62, 0.65, 0.70, 0.7315]:
        n = min_balanced_n_to_exclude(CHANCE, a)
        excl[f"{a:.4f}"] = n
        shown = f"{n}" if n is not None else "unreachable"
        tot = f"{2*n}" if n is not None else "-"
        print(f"  {a:.4f} | {shown:>27} | {tot:>17}")
    out["min_n_to_exclude_chance"] = excl

    # also the symmetric read: min N to exclude the 0.70 upper boundary from BELOW (CI_high < 0.70)
    print("\n min balanced-N with CI_high(AUC) < 0.70 (below-healthy boundary), by true AUC:")
    excl_hi = {}
    for a in [0.50, 0.55, 0.58, 0.60, 0.62, 0.65]:
        # CI_high = a + Z95*SE < 0.70 ; symmetric to the exclude-from-above form
        n_found = None
        for n in range(2, 401):
            if a + half_width(a, n, n) < HEALTHY_FLOOR:
                n_found = n
                break
        excl_hi[f"{a:.4f}"] = n_found
        shown = f"{n_found}" if n_found is not None else "unreachable"
        print(f"  true AUC {a:.4f} -> min N per arm = {shown}")
    out["min_n_to_exclude_healthy_from_below"] = excl_hi

    if out_path is None:
        here = os.path.dirname(os.path.abspath(__file__))
        out_path = os.path.join(here, "power_derivation.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\nwrote {out_path}")
    return out


if __name__ == "__main__":
    main()
