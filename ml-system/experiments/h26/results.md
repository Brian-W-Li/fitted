# H26 results — a trained pairwise compatibility prior vs a per-edge LLM judge

> **Status: COMPLETE (stage C6, 2026-07-05).** Offline, zero-user, public-corpus experiment
> (Polyvore Outfits-**Disjoint**). Mechanical verdict (frozen A∧B∧D gate, printed by
> `evaluate.py verdict` and only *restated* here): **NO-GO** — gate B lands
> **"underpowered / inconclusive"** by the pre-registered letter (section 2), while gates
> A and D pass and the gate-B CI sits wholly on the *pass* side. Every number in this file is
> read from `metrics.json` (stage C6, `_meta.git_commit 446cc9c0`), re-derived from the
> committed `judge_runs.ndjson` ledger, or measured locally and dated (head latency via the
> committed `bench_head.py`; judge cost/latency from the gitignored, non-regenerable
> `raw_payloads/` logs); the design is frozen in `preregistration.md`/`.json` +
> `judge_addendum.md` (all sha-bound in `metrics.json._meta`).
> Spec: `docs/plans/h26-compatibility-spike-v2.md`.

## 1. The systems decision (the headline)

**The thesis is a systems decision, not a quality contest: when does a tiny specialized model
beat a per-edge LLM call?** `gpt-5.4-mini` is Fitted's production stylist, so quality-superiority
over it was never the claim, and a cost-alone win would be fragile (the next price cut erases
it). The question is: at **per-edge serving volume** — the dense style graph, where scoring a
closet means every pairwise edge — is a trained content prior the right tool over an LLM call
per edge?

Nobody deploys per-edge GPT judging: scoring one recommendation means `C(k,2)` edges × candidate
completions × 2 orders — hundreds of LLM calls per recommendation — so the per-edge LLM column
below is a **"why the seam needs a cheap scorer"** baseline, not a deployed cost being undercut.
The trained prior's win is that it lets the per-edge compatibility seam **exist at serving time
at all**. The benchmark's role is only to show the cheap option is *good enough* — honest FITB parity
(fill-in-the-blank: pick the held-out item among 4 candidates) with the judge on the same task; the decision turns on the four durable,
price-cut-proof properties: **(a) bit-determinism, (b) zero serving-time API dependency,
(c) availability at per-edge volume, (d) a native per-edge signal the style graph is built on.**
One honesty note: properties (a)–(d) belong to *any* local embedding scorer — including the
untrained zero-shot cosine rung (section 3) — so the systems argument alone does not require
the trained head; what training adds is the measured accuracy margin (gate A, the +10-point
FITB lift, and the only outfit-level AUC evidence in the artifact).

| Property | Trained pairwise prior (795,617 params) | Per-edge `gpt-5.4-mini-2026-03-17` judge |
|---|---|---|
| **Accuracy** (the qualifying bar, not the headline) | gate-B FITB **61.8%** [57.5, 66.2]; full-test FITB 62.1%; outfit AUC 0.845 | gate-B FITB **34.8%** [30.6, 39.0] (inconsistent = miss) / 54.1% consistent-only — details section 4 |
| **Cost** | ~0 marginal (embed once per item at ingestion; 3.2 MB checkpoint + 256 MB embedding cache; whole training one-time, CPU-hours) | $0.75/$4.50 per 1M tok (OpenAI published rate, mid-2026 — dated): measured **≈$0.0041/question** (6 calls × ~839 prompt + ~12 completion tok); the whole 4,647-call spike cost **$3.17** |
| **Latency** | **0.108 ms/edge** batch-1 single-thread CPU; **16.5 µs/edge** batched (~61k edges/s) — `bench_head.py` → committed `bench_head.json` (dated, machine-dependent) | **0.735 s/call median** sync (p90 1.01 s; payload-mtime deltas, n=4,642); one FITB question = 6 sequential calls ≈ 4.4 s |
| **Determinism** | **bit-exact** — the C5/C6 pipeline re-derives and *asserts* CI-for-CI equality on every run | **not reproducible even at temp 0**: 23.0% of same-input (question, order) K=3 sample groups disagree internally (230/1,000; 18.0% on parsed choices alone, the rest involve an unparseable sample — pure run-to-run nondeterminism), plus 35.6% of questions (177/497) flip verdict across candidate order (position bias); `system_fingerprint` returned null (drift not even detectable that way) |
| **Per-edge serving availability** | yes — a 200-item closet = 19,900 edges ≈ **0.33 s** batched on a laptop CPU | no — the same graph at K=3 × 2 orders = ~119k calls ≈ **$82 list-price sync + ~24 h sequential** per re-score (extrapolated from the measured FITB-call cost/latency: an edge prompt carries fewer images and Batch pricing halves the cost, while parallelizing runs into API rate limits at this volume — the order of magnitude is the point) |

The fourth win — (d) — is structural: the per-edge score is the native signal the style graph
(build doc §13) aggregates; the LLM column has no per-edge artifact to build a graph from at all.

**A no-go ships as a complete result.** Everything above lands regardless of the gate; the
verdict is an internal M6 decision, and section 2 states it in full: gate B fails on the
pre-registered *power* condition (half-width over δ by +0.000302 at the frozen N = 500 cap),
not on the location of the estimate. The letter is applied verbatim — no δ-widening, no
point-estimate reading.

## 2. The mechanical verdict (A ∧ B ∧ D)

Frozen thresholds parsed from `preregistration.json` (never re-typed); every conjunct passes
only if its 95% CI is wholly on the pass side. Printed by `evaluate.py verdict`; restated:

| Gate | Read | Result | State |
|---|---|---|---|
| **A** — training adds value over the frozen backbone | `CI_low(AUC_catalog_pair − AUC_zero_shot_cosine) > 0` | +0.0995 [+0.0969, +0.1022] | **PASS** |
| **B** — FITB non-inferiority vs the image-only judge, δ = 0.05 | miss-convention paired diff; powered iff half-width ≤ δ | +0.2696 [+0.2213, +0.3219]; **half-width 0.050302 > δ by +0.000302** | **UNDERPOWERED / INCONCLUSIVE → NO-GO** |
| B cross-check (inconsistent = 0.5) | same legs, conservative convention | +0.0915 [+0.0463, +0.1398]; half-width 0.046793 ≤ δ | powered, pass |
| **D** — absolute accuracy floor | `CI_low(outfit_auc) ≥ 0.81` ∧ `CI_low(fitb_trained_full) ≥ 0.50` | 0.8454 [0.8408, 0.8498]; 0.6210 [0.6127, 0.6291] | **PASS** |
| **Verdict** | GO iff A ∧ B ∧ D | | **NO-GO** |

**The gate-B letter-check, disclosed in full.** The adjudicating (inconsistent = miss) diff's
half-width exceeds the frozen δ = 0.05 by **+0.000302** at the frozen N = 500 gate-B cap.
Pre-registered rule (`preregistration.md` §B): N is capped, δ never widens, and a half-width
over δ at the cap = "underpowered / inconclusive" = no-go. Applied verbatim. The CI-location
condition (`CI_low ≥ −δ`) is met, with the interval wholly above +δ; the power condition
(half-width ≤ δ) is not — and per the letter, power alone decides B. The two conventions disagree
on *state* (miss: underpowered; half: powered-pass) — under the frozen rule (build doc §12) the miss convention
adjudicates, and the "B-pass is conservative" reading is moot since B did not pass.

**Vacuity guard:** the judge is decisively non-vacuous — `fitb_judge_gateB` CI_low 0.3058 >
0.25 chance@4 — so gate B was a real leg, not a trivial pass against a chance-level judge.

Reported-not-gated (former gate C): the catalog→closet transfer (section 6) is outside its healthy
band and is an **M6 re-measure entry condition**, per the frozen demotion (build doc §12).

## 3. Accuracy ladder (catalog, held-out disjoint test)

Pair-level = pooled AUC over positive vs same-fine-category, anchor-non-co-occurring negative
edges (44,627 cluster pairs); outfit-level = each real outfit vs a fully-corrupted negative
(EVERY slot replaced same-fine-category, category multiset preserved, mutually
non-co-occurring; 13,899 pairs); FITB@4 full = 13,895 questions. Cluster bootstrap, B = 10,000, seed 20260629.

Two framing facts before the numbers. **Ground truth is co-worn-ness, a proxy for
compatibility** — positives are co-worn pairs; the mechanical negatives are not-co-worn, never
human-judged "incompatible" — so every accuracy below (both models') is accuracy on the proxy
task. And the purged split is **the strongest publicly-shipped split, not "leakage-free"**:
item-disjoint is not visual-disjoint (near-duplicate product photos + brand co-occurrence still
bleed; the shipped files also share 84 items / 47 outfits with train — 0.12% — which the strict
purge removes). The headline carries the pre-registered **"popularity-confounded (disclosed)"**
label (section 7). The frozen *reported ladder* is exactly three rungs — zero-shot cosine →
trained head → judge (section 4); the popularity row below is a **sanity diagnostic outside the
ladder**, and the item-level row is the pre-registered shape ablation (section 5), shown here
for context.

| Rung | Pair AUC | Outfit AUC | FITB@4 (full test) |
|---|---|---|---|
| Chance | 0.50 | 0.50 | 25% |
| Item-popularity only (diagnostic, outside the ladder) | 0.5282 [0.5265, 0.5298] | 0.5597 [0.5552, 0.5642] | 28.6% [28.2, 29.0] |
| Zero-shot FashionSigLIP cosine | 0.6319 [0.6294, 0.6345] | — | 52.1% [51.3, 52.9] |
| Item-level scalar head (ablation, section 5) | 0.5155 [0.5134, 0.5176] | 0.4987 [0.4931, 0.5042] | 24.5% [23.8, 25.2] |
| **Trained pairwise head (headline)** | **0.7315** [0.7284, 0.7345] | **0.8454** [0.8408, 0.8498] | **62.1%** [61.3, 62.9] |

Honest context on the training lift: the zero-shot cosine rung — no training at all — already
clears gate D's 50% FITB floor on its own. What training buys over the raw backbone is gate A's
+0.0995 pair-AUC margin and a +10.0-point FITB lift (62.1 vs 52.1); its outfit-level AUC has no
zero-shot counterpart in the artifact (never measured), so no outfit-level zero-shot claim is
made.

**Anchor comparability (read §6 of the build doc before citing these against the literature).**
The Vasileva 2018 disjoint anchors (SiameseNet 0.81/51.8%, CSN 0.84/55.2%, OutfitTransformer
0.88/59.48%) are **full-Polyvore, outfit-level** figures. This task **excludes accessories**:
the 5-type map drops 65 of the shipped metadata's 159 fine categories (Vasileva's published negative grain counts 153) — **43.2% of test item slots** — and 1,198 of
15,098 test outfits fall below 2 items after exclusion (the strict item-disjoint rule had
already purged 47 of the shipped 15,145; 13,900 outfits remain). Gate D therefore treats 0.81 as *approximate*, the
direction of the residual incomparability is **not assumed conservative**, and the headline
62.1% FITB / 0.845 outfit AUC must **not** be cross-read against OutfitTransformer's 59.48% —
the excluded-accessory question mix and our outfit-corruption negative differ from the
published protocol. The band is orientation, not a leaderboard.

## 4. Gate B in depth — the judge parity evidence

**Protocol (frozen in `judge_addendum.md`, blind before any gate-B number):**
`gpt-5.4-mini-2026-03-17`, image-only arm (the modality-matched, text-memorization-controlled
headline condition), temperature 0, K = 3 samples per candidate order × both orders (forward +
exact reverse), plurality vote per order, question = hit iff both orders agree on the held-out
item; order-inconsistent = miss in the denominator (the adjudicating convention), judge-dropped
(unparseable after 2 retries) = excluded like-for-like. The envelope was tuned solely against
a 4-person human panel's consensus labels, disjoint from every gated question, and frozen
before any trained-vs-judge comparison existed. Panel detail (pre-registered disclosures): the
100-question draw was coherence-filtered + visual-QC'd, so the calibration claim is human
consensus **on coherent, wearable-outfit questions**, not raw Polyvore; consensus = unique
plurality over confident votes (≥ 2 confident, abstention allowed); **88 questions reached
consensus, 12 dropped (all ties — the disclosed disagreement signal)**; inter-annotator
agreement **46.5%** vs 25% chance is the measured human ceiling; per-labeler skip rates
2% / 7% / 0% / 15%; realized garment mix of the 88 answers (5-type grain): 25 bottom / 22 top /
21 shoes / 11 outer_layer / 9 dress, across 72 distinct fine categories.

**The judge is a multi-run distribution, never a single reproducible point.** Each question's
verdict is an aggregate of 6 temp-0 calls; the `fitb_judge_gateB` CI below is
**question-sampling (cluster) uncertainty only**. The judge's temp-0 run-to-run spread is
carried by the **two-stage paired bootstrap** (cluster resample × per-question judge-sample
resample) inside the gated `gate_B_diff_*` quantities — cite those, not the judge point, for
the parity decision. Measured spread: **230 of the 1,000 (question, order) groups (23.0%) had
the K = 3 same-input temp-0 samples disagree internally** (180/1,000 on parsed choices alone);
83 of 3,000 samples (across 56 questions) stayed unparseable after exhausting the retry
budget of 2 (290 calls needed a retry), and only 3
questions lost an entire order and were excluded. The post-freeze gate-B pilot prefix
(`gate-b --n 100`) ran first and re-confirmed the judge above chance on gated questions
(38/65 consistent = 58.5%, Wilson CI-low 0.463 > 0.25; flip 34/100) before the scale-up to the
frozen 500 cap.

Gate-B set: the frozen 500-question prefix of `fitb_order.json` → 3 judge-dropped → **497
shared questions** scored by both models.

| Read | Trained head | Judge |
|---|---|---|
| FITB@4, inconsistent = miss (adjudicating) | **61.8%** [57.5, 66.2] | **34.8%** [30.6, 39.0] |
| FITB@4, inconsistent = 0.5 (cross-check) | — | 52.6% |
| FITB@4, inconsistent excluded (wrong-vs-excluded sensitivity) | 63.8% (204/320 — the same questions) | 54.1% (173/320) |
| Position-flip (order-inconsistent) rate | 0 (deterministic) | **35.6%** (177/497) |

**Bias accounting (pre-registered, §12 of the build doc).** Two biases pull opposite ways and
the net was never assumed: possible visual memorization of Polyvore product photos advantages
the *judge* (biases B against the head — image-only already strips title memorization); the
inconsistent = miss rule handicaps the *judge* (biases B toward the head). The direction of
the result is robust to the convention choice — the head leads under both conventions
(+27.0 pts miss / +9.2 pts half, both CIs wholly positive), and on the judge-consistent 320 —
the paired read on the judge's own best subset, same denominator — the head scores 63.8% vs
the judge's 54.1% — so the parity *direction* does not hinge on the handicap. The 35.6% flip rate is itself a finding for the determinism column: an
order-flippable verdict is not a deployable per-edge signal.

**Coherence-sliced sensitivity (preregistration §C.8; reported, never gating).** 65/500 gate-B
questions (13.0%) are flagged incoherent under the mechanical 5-type rule (Polyvore boards,
not wearable outfits). The full pre-registered read set (all in
`metrics.json.coherence_sensitivity`):

| Slice | gate-B diff (miss) | gate-B diff (half) | judge inconsistency | gate-D full FITB |
|---|---|---|---|---|
| coherent (435) | +0.2702 [+0.2125, +0.3233] | +0.0901 [+0.0416, +0.1409] | 36.0% | 61.9% |
| flagged (65) | +0.2656 [+0.1563, +0.4219] | +0.1016 [−0.0078, +0.2266] | 32.8% | 63.4% |

The coherent-slice adjudicating state equals the headline state (underpowered at δ; states
agree), so the pre-committed "coherence-sensitive" label is **not** applied. The hypothesized
judge-balk mechanism did not materialize — flagged-slice inconsistency is *lower*.

**What K = 3 bought.** The pilot K-sweep (K ∈ {2,3,5} on the calibration set) was
indistinguishable on human-agreement within sample noise → the pre-registered prefer-K = 3
anchor stood (K = 2 rejected on parse-drop robustness). Frozen above-chance readout at the
pilot: image-only 52.7% (Wilson CI-low 0.3979 > 0.25).

## 5. Seam-shape verdict (build doc §6): item-level is falsified on our data

The pre-registered light ablation trains a capacity-matched **item-level scalar head**
(788,481 params vs the pairwise head's 795,617 — within ±5%, so a pairwise win is not a
parameter-count win) on the same frozen embeddings, same grid, same selection rule.

Result — outcome (i) of the two pre-stated readings: **pairwise − item-level pair AUC
= +0.2160 [+0.2124, +0.2195]**, Holm-adjusted two-sided bootstrap p **< 2/B (< 0.0002;
stored value 0.0 — no replicate of 10,000 crossed zero; executed ablation family m = 1, so
Holm = raw)**. `CI_low > 0` at family-wise α = 0.05 → **the item-level shape is independently
falsified on our data**, corroborating the literature-unanimous pairwise choice
(Vasileva/NGNN/OutfitTransformer). The item-level head is at or below chance on every
outfit-level read (outfit AUC 0.4987, FITB 24.5%) — a single shared per-item scalar cannot
represent non-transitive compatibility, and on this data it demonstrably does not. (The
near-chance result is consistent both with that representational limit and with the shared
selection grid simply not favoring the scalar architecture — which is exactly why the claim is
scoped "on our data", never "in general".)
The M6/H28 seam commitment stays **pairwise/edge-level** (`rank()`/`RankerContext` hook,
Spec §23-H28); the sampler's item-level `SignalScorer` slot remains the
behavioral/personalization seam, not the compatibility seam.

## 6. Catalog→closet transfer (reported, not gated — the former gate C)

13 items / 19 worn outfits from one real closet (owner-labeled, mechanical same-fine-category
negatives, photos never leave the machine — third-party egress refused by the committed
consent flag). The bootstrap resamples at the **source-outfit** unit, not the edge count:
**effective-N = 6 distinct worn outfits**, carrying the 8 kept main pair-clusters (25 of 39
positive pairs skipped for lack of a valid same-category negative; the 2 null-category
crewnecks' 6 coarsened clusters are
partitioned out per the frozen coarsening policy and read 0.33 descriptively, no CI). Closet
FITB: **0 strict questions** (no fine category has ≥4 members; 19 skipped — pre-computed
thinness, skip-and-count, never broadened).

| Read | Value | Reference band (build doc §12) | Band read |
|---|---|---|---|
| `AUC_closet_pair` (CI_low) | 0.5625 [0.2857, 0.7500] | healthy if CI_low ≥ 0.70 | **outside band** |
| `catalog_closet_drop` (CI_high) | +0.1690 [−0.0193, +0.4476] | healthy if CI_high ≤ 0.12 | **outside band** |

Read **directionally only**: percentile-bootstrap coverage at 6 source outfits is weak (the
committed `coverage_caveat`), the point drop (0.17 AUC lost, catalog − closet) itself sits
outside the pre-set healthy band (≤ 0.12), the closet-AUC CI contains chance (0.50) as well as
the healthy floor, and the drop CI straddles both "no drop" and "severe drop". This is exactly why the transfer was
demoted from a gate to a **reported finding + M6 entry condition**: a single-wardrobe closet
cannot power a veto, and M6 must re-measure it on powered real-ingestion data (W-track) before
the trained scorer commits to production. The one transferable engineering lesson: all 13 phone
photos carried EXIF orientation 6 and PIL ignores EXIF on open — the first probe run embedded
sideways garments (AUC 0.4375 → 0.5625 after `exif_transpose`). The M4/W-track ingestion path
must normalize EXIF orientation before any embedding.

Also disclosed: the closet is a summer-subset (no cold-weather outfits), one owner, menswear
only — friend closets (3–5) are the pre-identified next transfer measurement
(2026-07-05 merit review).

## 7. Sensitivity & robustness annex

**Popularity confound — "popularity-confounded (disclosed)", and the matched re-run is a
no-op.** The pre-registered diagnostic fired: outfit-level popularity-only AUC 0.5597 > the
0.55 blind margin (edge-level 0.5282 did not fire; popularity-only FITB is 28.6%, barely above
chance). The mandatory preregistration-§C.6 popularity-matched re-run executed verbatim — and the frozen rule
is **vacuous on this corpus**: 95.6% of test items appear in exactly one outfit, so all nine
value-decile edges equal 1.0, every item lands in the same decile, the ±1-decile filter
excludes nothing, and the matched construction reproduces the headline negatives **bit-for-bit**
(all four re-run CIs identical to the headline fields; `decile_edges` in `metrics.json` is the
disclosure). Consequence, stated plainly: **the popularity confound is disclosed, not
controlled.** The headline gates are unaffected by construction (gate numbers never move on a
sensitivity row), but no popularity-matched robustness claim can be made from this corpus; the
mitigating evidence is indirect (the popularity-only rungs sit far below every trained rung).

**Negative-sampler leak detector.** The category-co-occurrence scorer is asserted ≈ chance
(0.50 edge / 0.25 FITB / 0.50 outfit, fail-loud) inside every metric-suite run — `metrics.json`
existing means it passed; a deviation would have aborted emission.

**Seed robustness (preregistration §C.7).** The whole negative set re-rolled on the 3 pre-registered seeds;
the frozen rule requires the gate verdict to agree across all three. It does — **verdicts_agree
= true**:

| Seed | gate-A diff | outfit AUC | FITB full | A / D |
|---|---|---|---|---|
| 20260629 (headline, copied not recomputed) | +0.0995 [+0.0969, +0.1022] | 0.8454 | 0.6210 | pass / pass |
| 20260630 | +0.1010 [+0.0983, +0.1036] | 0.8418 | 0.6187 | pass / pass |
| 20260701 | +0.1024 [+0.0998, +0.1051] | 0.8429 | 0.6098 | pass / pass |

Note the frozen rule string says "A/B/D", but gate B is **structurally seed-pinned** — its
question set is the committed `fitb_order.json` and its judge side is the committed ledger, so
a footnote seed cannot re-roll it without re-scoring the judge (which the frozen order
forbids). B's seed sensitivity is therefore disclosed as not re-measurable in-spike
(`seed_robustness.gate_b_note`); the computed agreement covers A and D.

## 8. Dispositions — pre-registered or planned items that did not run

- **STL/CTL (Pinterest) task-shifted probe:** not built — the stretch was never attempted, so
  the C2-frozen resolvable-yield check was never run. No claim is made either way.
- **image+title / text-attribute judge arms:** not run (cost scope; the ledger is image-only).
  The image-only→image+title memorization-lift estimate is therefore **forgone**, and the
  memorization confound is bounded only by the image-only control + the bias-accounting in section 4.
- **Matched-base backbone rung (the fine-tuning delta):** not run (the frozen
  headline-ships-first budget rule; it was a stretch arm). With the modality arms above also
  unrun, the executed §C.5 Holm family is **m = 1** (the seam shape diff alone), per the frozen
  "executed rungs only" membership rule — this is the basis of section 5's Holm = raw claim.
- **BPR margin-ranking objective / whole-outfit attention arm:** not run (ablation-only rungs;
  BCE + the pairwise-edge shape were the frozen headline).
- **Non-disjoint easy-regime readout:** not computed (headline-first; a ceiling/sanity readout
  in the build doc, bound by nothing frozen).
- **Second wardrobe:** did not materialize (tier-3 stretch; single-wardrobe was the baseline
  deliverable).
- **Cross-family secondary judge (Claude/Gemini):** not run; it was robustness-only in the
  build doc and never entered the frozen pre-registration.
- **Logprob escape hatch:** not re-checked at C4 (`rechecked_at_C4: false`); the K-sample
  Monte-Carlo path ran as designed.
- **GPT AUC (optional supporting evidence):** not pursued; the parity comparison is FITB-native
  by design.

## 9. Limitations & threats to validity

1. **Gate B is a power miss at a frozen cap** — the honest reading is "not confirmed at δ =
   0.05 with N = 500", not "parity refuted"; every point estimate and both convention CIs favor
   the head.
2. **The judge is a mini-tier model in a non-production modality.** Production serves
   text-attributes to `gpt-5.4-mini`; gate B ran the image-only arm (deliberate modality match
   + memorization control). B is a same-model different-modality parity test, and
   parity-not-superiority against a *mini* judge was the pre-set bar.
3. **Item-disjoint is not visual-disjoint, and neither controls LLM pretraining
   memorization.** The purged split is the strongest publicly-shipped split, not "leakage-free"
   (near-duplicate product photos + brand co-occurrence bleed across items — section 3);
   judge-side visual memorization of Polyvore photos, if present, favors the judge (section 4
   bias accounting).
4. **The popularity confound is disclosed, not controlled** (section 7) — the matched re-run is
   structurally vacuous on this corpus.
5. **The human panel is small and temporally skewed**: 4 labelers, 46.5% agreement ceiling,
   and the corpus's 2017-era aesthetics (skinny cuts, dated palettes) surfaced during labeling —
   consensus labels partly reflect dated fashion. The same boundary applies to the **trained
   head itself**, which learned 2017 Polyvore co-occurrence: the shipped prior inherits dated
   taste. M6 personalization (real user feedback) is the escape for both.
6. **Transfer is directional only** (effective-N = 6; section 6) and currently reads outside the
   healthy band — an unresolved risk carried forward as the M6 entry condition, not resolved
   by this spike.
7. **Prices and snapshots are dated** (mid-2026: $0.75/$4.50 per 1M; `gpt-5.4-mini-2026-03-17`;
   null `system_fingerprint` behavior) — the cost column moves with the market; the
   determinism/availability columns do not.
8. **Accessory exclusion** (43.2% of test item slots) bounds anchor comparability (section 3).
9. **Ground truth is a co-worn proxy** (section 3): both models' "errors" include
   genuinely-compatible-but-never-co-worn pairs, so every accuracy — including the gate-B
   margin — is accuracy on the proxy task, not on human-judged compatibility.

## 10. What M6 inherits

- **The seam question is answered for our data**: the item-level shape is independently
  falsified (section 5); the seam stays pairwise/edge-level. The H28 hook stays as reserved;
  the sampler `SignalScorer` slot stays behavioral.
- **The go/no-go**: NO-GO by the letter — the trained-scorer M6 dive does not proceed on H26's
  authority alone. The two levers that could flip it, both pre-identified: **power** (a larger
  judged question budget shrinks the 0.0003 half-width overshoot — the cap was a cost choice,
  not a data limit; 13,395 frozen-ordered questions remain unjudged) and the **transfer entry
  condition** (re-measure the catalog→closet drop on powered real-ingestion data / friend
  closets before any production commitment). The power lever is **built + frozen**:
  `gate_b_extension.py` (freeze/run/analyze) judges questions `[500:N_ext]` of the SAME frozen
  order into a SEPARATE `judge_runs_extension.ndjson` (keep-last, resume-safe) and analyzes the
  concatenated ledger under the SAME sealed letter into `metrics_extension.json` — the frozen
  N=500 record stays byte-identical (§23-H56). Frozen at **N_ext=1000** (projected half-width
  ~0.0356, survives a 25% variance-inflation stress ≤ δ); the paid `run` (~$2) is pending.
  Optional-stopping is disclosed: the extension was decided after the N=500 result and N_ext is
  fixed once by power math (never "extend until it passes"). Under the NO-GO, the untrained zero-shot cosine
  remains a deployable fallback for the seam — it shares all four systems properties; section 3
  states exactly what the trained head adds over it.
- **Ingestion requirements surfaced**: EXIF orientation normalization (section 6); real-photo
  embedding cost is per-item-once and trivially batchable.
- **The judge protocol** (frozen envelope, two-order K-sample collapse, scalar-only ledger) is
  reusable as-is for any future LLM-baseline comparison.

## 11. Reproducibility

Everything below `ml-system/experiments/h26/`. Gitignored heavy artifacts (photos, the
embedding cache, checkpoints) regenerate deterministically; the judge's `raw_payloads/` logs
are the one dated, **non**-regenerable local artifact — the committed scalar `judge_runs.ndjson`
ledger is what preserves the judge run in git.

- **Frozen inputs**: `preregistration.md`/`.json`, `fitb_manifest.json`, `fitb_order.json`,
  `embedding_manifest_fashionsiglip.json`, `type_map.json`, `judge_addendum.md`
  (prompt sha `56347c30…`), `closet_manifest.json`, `calibration_set.json` (sha `7425af3b…`),
  `selection.json` (checkpoint `grid_0`, sha `a172be27…`).
- **Committed outputs**: `judge_runs.ndjson` (3,000 scalar rows, sha bound in
  `metrics.json._meta.judge_ledger_sha256`), `closet_metrics.json`, `metrics.json` (stage C6).
- **Pipeline** (each stage re-derives and bit-asserts its predecessor's numbers before
  writing): `build_cache_and_select.py` → `run_judge.py pilot` → freeze `judge_addendum.md` →
  `run_judge.py gate-b --n 100` (above-chance prefix) → `gate-b --n 500` →
  `run_judge.py emit --n 500` → `domain_probe.py` +
  `evaluate.py merge-closet` → `evaluate.py finalize` → `evaluate.py verdict`.
- **Determinism binds that ran**: re-derived checkpoint sha == sealed `selection.json`; re-scored
  catalog AUC == emitted (C5 and C6); item-level checkpoint bound by exact CI reproduction; seam
  Holm p computed from the *same* replicate stream as the emitted CI (asserted equal first).
- **Measured ops numbers**: head latency via the committed `bench_head.py` → `bench_head.json`
  (machine + date recorded); judge cost/latency re-derived from the payload logs' `usage`
  fields + file mtimes (dated, local-only).
- **Suite**: 320 pytest green / 1 skipped (opt-in live-judge smoke), hermetic (no network, no
  spend); `pytest tests/` from this directory.
