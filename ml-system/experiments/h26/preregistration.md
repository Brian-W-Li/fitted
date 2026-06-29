# H26 Pre-registration

> **SKELETON (C1).** This file FREEZES AT C2, before any model number exists (§1, §12, §15).
> Until that freeze every value below is a placeholder. The blindness guard is enforced by
> build order: `evaluate.py` refuses to emit any sealed metric unless this file,
> `judge_addendum.md` (C4), **and** `closet_manifest.json` (C2) are all committed (§12 unlock).

## Block 1 — Headline cell (FREEZE AT C2)

The §1 systems thesis + the §9 cost / determinism / availability comparison columns
(trained prior vs per-edge `gpt-5.4-mini` judge, same task).

- _TBD at C2._

## Block 2 — Decision gates (FREEZE AT C2)

The §12 A/B/D thresholds and the frozen analyst choices, fixed before any model number:

- **Gate A** — catalog pair-level AUC ≥ **0.81** floor (disjoint split). _Exact construction TBD at C2._
- **Gate B** — trained FITB ≥ **50%** and `HW ≤ δ` with **δ = 5** FITB pts vs the `gpt-5.4-mini` judge. _TBD at C2._
- **Gate D** — outfit-level AUC (mean-edge score, source-outfit cluster; §4 construction). _TBD at C2._
- **Reported transfer (former gate C — measured, NOT gated)** — catalog→closet reference band
  **0.70 / drop 0.12**; also the M6 re-measure entry condition (§13).

Frozen analyst choices to pin here at C2: head architecture + symmetrization + type-pair
embedding; the item-level ablation head + its ±5% capacity-match (§6); optimizer / grid /
epochs / early-stopping / Torch determinism; the §11 family-wise correction; the pinned HF
model revision SHA + preprocessing hash + dependency lock; the calibration-set spec; and the
pre-registered popularity-confound response (edge **and** outfit-level, §4).

## Frozen seeds & manifests (FREEZE AT C2)

- `type_map.json` — Polyvore fine-category → {5-type | excluded}, one row per fine category
  (§4). **Authored at C1** from the real metadata; frozen here at C2.
- `fitb_manifest.json` — eligibility, held-out-item rule, distractor rule, seed, gate-B vs
  gate-D subset allocation (§12). _TBD at C2._
- `embedding_manifest.json` — embedding-cache freeze (§5). _TBD at C2._
- `closet_manifest.json` — labels + mechanical negatives + label-audit protocol (§10/§14),
  frozen at C2 before the test-metric unlock. _TBD at C2._
