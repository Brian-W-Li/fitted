# H26 Pre-registration — FROZEN AT C2

> **FROZEN 2026-06-29 (C2), before any model number exists.** This file is the **single design
> home** for every choice that could be made after seeing a metric (§1 of the build doc). Once a
> later commit introduces a model number, nothing here may change — it is a **one-way door**.
> `docs/plans/h26-compatibility-spike-v2.md` is the canonical build doc; §§3–11 there explain the
> *mechanics* of each frozen choice and are not re-decided here.
>
> **Machine-readable mirror:** `preregistration.json` carries the gate thresholds + headline-cell
> values + analyst pins that `evaluate.py` parses directly (so a hand-copied constant cannot
> silently drift from this prose — §1). The two must agree; if they ever disagree, **this file is
> the human authority and the divergence is a bug to fix on sight.**
>
> **Build-order blindness guard (enforced, not honor-system — §1/§12):** `evaluate.py` refuses to
> emit any held-out *test*-set metric through `metrics.json` until
> **all four** of `preregistration.md`, `preregistration.json`, `judge_addendum.md` (C4), and a validated
> `closet_manifest.json` (frozen before the C4 unlock, not at this C2 commit) validate and have their
> blob hashes recorded. C3 writes only `selection.json` (checkpoint
> id/config/hash/convergence — **no metric values of any split**) and validates it against
> `selection.schema.json`. No human-visible model number
> exists before the C4 unlock.

---

## A. Headline cell (the one frozen point — no post-hoc selection across a grid)

One cell, frozen whole (Gelman & Loken garden-of-forking-paths: post-hoc cell choice is a
multiplicity problem even without conscious p-hacking — build doc §1).

| Degree of freedom | Frozen value |
|---|---|
| Split | Polyvore Outfits-**D** (item-disjoint), shipped JSON, **`strict_disjoint=True`** (§J), never re-split |
| Backbone | Marqo-**FashionSigLIP** (ViT-B/16-SigLIP, frozen), L2-normalized **image** embeddings, **dim 768** (§D) |
| Modality (headline) | **image** (garment photo embeddings) |
| Trained-head shape | **pairwise, type-conditioned edge head**; outfit score = **mean over edges** (§C.1) |
| Objective | **pointwise BCE** on positive vs same-fine-category negative edges (margin-ranking BPR = ablation only) |
| Metrics | **pooled pair-level ROC-AUC** (gate A + the reported transfer) · **outfit-level ROC-AUC** (gate D) · **FITB@4** hit@1 (gate B + gate D) |
| Negatives | **same-fine-grained-category** (same `category_id`), split-scoped, anchor-no-cooccurrence (§4 / `type_map.json`) — **AUC 1:1** · **FITB@4: 3 distractors** |
| Tie policy | a `k`-way top tie scores **`1/k`** (FITB) / **0.5** (AUC, Mann-Whitney) |
| Seed | **20260629** (one committed integer; governs the negative draw + FITB distractors) |
| CI | **95% cluster bootstrap**, percentile, **B = 10,000**, resampled at the outfit / question / pair unit (§H) |
| Judge | **`gpt-5.4-mini`, dated-snapshot rule**, **temperature 0**, image-only arm, FITB@4 both-orders (the *specific* snapshot + prompt + K freeze later, at C4, in `judge_addendum.md` — §8, **not** here) |

The systems thesis (build doc §0/§9): the headline artifact is the **cost / latency / determinism /
availability** comparison (trained prior vs per-edge `gpt-5.4-mini`), not the AUC/FITB number. The
go/no-go is **A ∧ B ∧ D**; the catalog→closet transfer is **reported, not gated**.

---

## B. Decision gates — the second frozen block (build doc §12)

One mechanical AND-gate in `evaluate.py` reading `metrics.json`. **Near-gate rule (uniform):** read
every gate off its 95% CI; a conjunct passes only if its CI is **wholly on the pass side** (a
straddle → fail). Units are **fractions** throughout (FITB accuracy is a fraction in `metrics.py`,
not a percent); "5 FITB points" = **δ = 0.05**, the gate-D FITB floor "50%" = **0.50**.

> **GO** iff **all three**:
>
> - **[A] Added value (paired).** `CI_low(AUC_catalog_pair − AUC_zero_shot_cosine) > 0` — pair-level;
>   training beat the **frozen backbone's own** zero-shot cosine floor. Paired cluster bootstrap over
>   the shared (positive, negative) pair clusters.
> - **[B] FITB non-inferiority vs the judge (paired).** `CI_low(fitb_trained_gateB − fitb_judge_gateB)
>   ≥ −δ` with **δ = 0.05** (5 FITB pts) on the **powered Polyvore image-only set** — at parity or
>   better. **Power sub-rule:** if the paired-diff `half_width > δ` at the capped N (~500), gate B =
>   **"underpowered / inconclusive" → no-go** (never widen δ). One-sided: a head that *beats* the
>   judge passes. Report the verdict under **both** the `inconsistent = miss` and `inconsistent = 0.5`
>   conventions (§8); "B-pass is conservative" holds only if both agree. **The A ∧ B ∧ D gate
>   adjudicates on the `inconsistent = miss` convention** (the §8 position-bias denominator rule);
>   `inconsistent = 0.5` is the conservative cross-check. **Vacuity guard:** if the C4 judge-above-
>   chance pilot finds the image-only judge ≈ chance, gate B still passes trivially but is labeled
>   **vacuous**, and the GO decision then **rests on A ∧ D** (a chance-level judge makes the parity
>   claim uninformative — §8); the frozen A ∧ B ∧ D gate itself does not change.
> - **[D] Absolute accuracy floor (cost-independent).** `CI_low(outfit_auc) ≥ 0.81` **AND**
>   `CI_low(fitb_trained_full) ≥ 0.50` — outfit-level. `outfit_auc` construction = positive vs
>   same-fine-category-corrupted negative outfits, mean-edge score, source-outfit cluster (§4).
>
> **Verdict = A ∧ B ∧ D.**

**Reported, not gated — catalog→closet transfer (the former gate C).** `evaluate.py` computes and
reports, against a **reference band**, but they do **not** enter the AND-gate:

| Reported transfer quantity | Healthy band (descriptive) |
|---|---|
| pair-level drop `AUC_catalog_pair − AUC_closet_pair` (read `CI_high`) | **drop ≤ 0.12** |
| absolute `AUC_closet_pair` (read `CI_low`) | **closet AUC ≥ 0.70** |

Read directionally with the §H coverage caveat (a single-wardrobe closet's effective-N ≈ #worn
outfits cannot power a veto). This becomes an explicit **M6 re-measure entry condition** on powered
real-ingestion data (the W-track) before the trained scorer commits to production (build doc §13).

**Gate-D comparability caveat (does not move the floor — pre-registration).** **0.81 is the disjoint
Vasileva 2018 untyped-SiameseNet AUC anchor** (Table 5, read directly); the **0.50 FITB floor sits
*below* SiameseNet's 0.518 disjoint FITB anchor** — a deliberately rounded-down floor, **not** itself
an anchor value. Both anchors are **full-Polyvore, outfit-level**; this task excludes accessories and
uses an outfit-corruption negative, so report the excluded item/edge share and treat 0.81 as
**approximate**. The **direction** of any residual incomparability is **not assumed conservative**; it
is confirmed against Vasileva 2018 Table 5's protocol at C2 (§4) and **disclosed, never corrected away
post-hoc**.

---

## C. Frozen analyst pins

### C.1 Trained edge head (the headline shape — build doc §6)
- **Input feature:** `x = [emb_i ⊕ emb_j (1536), |emb_i − emb_j| (768), emb_i ⊙ emb_j (768)]` = **3072-d**.
- **Type conditioning:** a **learned 15-way unordered type-pair embedding**, **dim 32**, indexed by the
  unordered `{type_i, type_j}` over the 5-value space (15 pairs incl. same-type), concatenated → MLP
  input **3104-d**.
- **MLP:** 2-layer — `Linear(3104, 256) → GELU → Linear(256, 1)`. **Hidden width 256** (ratified
  2026-06-29).
- **Symmetrization:** the order-sensitive `emb_i ⊕ emb_j` term is symmetrized by **averaging**:
  `score = ½[f(i,j) + f(j,i)]` (ratified — chosen over a fixed id-canonical order so no arbitrary
  endpoint asymmetry is baked in).
- **Aggregation:** **outfit score = mean over the C(n,2) edges**; **FITB = the candidate maximizing
  mean edge-compat with the partial outfit**.
- **Parameter count (the capacity-match anchor):** 480 (type-pair table 15×32) + 794,880 (L1) + 257
  (L2) = **795,617**.

### C.2 Item-level ablation head (the §6 seam test — capacity-matched, not the headline)
- **Shape:** `g(emb_item) → scalar`, 2-layer MLP `Linear(768, 1024) → GELU → Linear(1024, 1)`;
  per-edge score = **½[g(emb_i) + g(emb_j)]**; **outfit score = mean of per-item scalars** (= the mean
  over edges of that per-edge score — algebraically identical, so the two aggregations agree); FITB =
  the candidate maximizing mean edge-compat (≡ argmax `g`). No pairwise interaction, no type-pair
  embedding (the literature's "single shared item-level scalar" baseline — the shape §6 expects to be
  falsified).
- **Capacity match:** params = 770·H + 1; **H = 1024 → 788,481 params**, **0.90 % under** the pairwise
  head's 795,617 (within the ±5 % rule — a pairwise win must not be a parameter-count win).
- **Training:** the **same** frozen embedding cache, **same** optimizer / 6-config grid / epoch budget
  / early-stopping rule, **same** valid split. Scored on the **identical** test pairs.
- **Seam-comparison metric (PINNED, before any number — closes the forking path AM-1/FC-1):** the seam
  difference **and** its Holm p (§C.5) are computed on the **pooled pair-level ROC-AUC** —
  `AUC_catalog_pair − AUC_pair_item_level`, paired cluster bootstrap over the shared (positive,
  negative) pair clusters. Pair-level is the principled unit: non-transitivity is a *pairwise* property
  (§6's "one shoe matches two mutually-incompatible tops") and pair-level AUC is the headline +
  selection metric. The item-level head's **outfit-level AUC and FITB are reported descriptively** but
  are **not** the falsification statistic — so "falsified" cannot be claimed on whichever of three
  units happens to clear.
- **Seam claim is descriptive corroboration, not a powered gate** (no MDE): **(i)** Holm-adjusted
  `p < 0.05` **and** `CI_low(AUC_catalog_pair − AUC_pair_item_level) > 0` → item-level **independently
  falsified on our data**; **(ii)** otherwise → **"consistent with the literature, not decisive at this
  power"** (never evidence item-level won). **Either way the pairwise-edge head is the frozen
  headline**, adopted on the literature's unanimity (Vasileva / NGNN / OutfitTransformer).

### C.3 Objective
**Pointwise BCE** on positive vs same-fine-category negative edges. Margin-ranking BPR is an
**ablation-only** rung, never the headline (post-hoc objective choice is a forking path).

### C.4 Optimizer + selection grid (identical for both heads — ratified 2026-06-29)
- **Optimizer:** Adam (β1 = 0.9, β2 = 0.999, eps = 1e-8).
- **Grid (6 configs):** LR ∈ {1e-3, 3e-4, 1e-4} × weight_decay ∈ {0, 1e-4}.
- **Batch:** 1024 edges. **Max epochs:** 50. **Early stop:** patience 5 on **valid pooled pair-level
  ROC-AUC**.
- **Selection:** **mechanical argmax** of valid pooled pair-level ROC-AUC over the 6 configs ×
  checkpoints. C3 emits `selection.json` only (no metric values — §1 blindness).
- **Determinism:** `torch.use_deterministic_algorithms(True)`, committed seed **20260629**, single
  fixed data order; the trained head ships as a **committed artifact** (checkpoint hash + training
  config + manifest path).

### C.5 Family-wise correction (the ablation suite — ratified 2026-06-29; build doc §11)
**Holm–Bonferroni at family-wise α = 0.05** over the **executed** ablation family, via
**percentile-bootstrap two-sided p-values** (`p = 2·min(Pr*[Δ≤0], Pr*[Δ≥0])`, clamped to [0,1], from
the paired cluster bootstrap). The seam claim "item-level falsified" requires **Holm-adjusted
`p < 0.05` AND directional `CI_low(AUC_catalog_pair − AUC_pair_item_level) > 0`** (the pair-level-AUC
seam metric pinned in §C.2). The family =
{ shape diff (pair-level AUC, §C.2, **always run**); fashion-fine-tuning delta (matched-base −
FashionSigLIP **on pair-level AUC**, §5, **iff the matched-base rung runs**); each modality gap (FITB,
§8, **iff that judge arm runs**) }. **Family membership is fixed by which rungs are executed — a pre-committed execution
decision (headline-ships-first + budget), never selected on any ablation's own measured value** — so
Holm over the executed set is valid. Report each member's raw p, Holm-adjusted p, and 95 % CI.
**Decision gates A/B/D and the reported transfer are scoped OUT of this family** (they are the
decision / descriptive, not CI-adjudicated ablation inferences).

### C.6 Popularity-confound response (frozen *before* the diagnostic — build doc §4; ratified)
- **Headline protocol stays same-fine-category + anchor-no-cooccurrence** (Vasileva-comparable). **NOT**
  popularity-matched-as-headline.
- **Item-popularity-only baseline = a pre-registered diagnostic** with a **BLIND margin = 0.55** AUC
  (set before any number), applied at **both** the **edge** (`AUC_pop_edge`) and **outfit-level**
  (`AUC_pop_outfit`) negatives.
- **Diagnostic score form (PINNED, so the 0.55 margin compares a defined quantity — FC-5):**
  "popularity" = an item's **split outfit-frequency** (`SplitData.popularity`). The **edge** score, per
  (positive, negative) pair cluster, is the **popularity of the *varying* endpoint** — `pop(replaced)`
  for the positive vs `pop(b′)` for the matched negative (the shared anchor cancels) → pooled
  pair-level AUC; this is exactly the §4 "candidate's marginal outfit-frequency" confound. The
  **outfit** score is the **mean item-popularity over the outfit's items** (positive: originals;
  negative: the replacements) → pooled outfit-level AUC. No backbone embeddings enter either — it is a
  pure popularity baseline.
- **If `AUC_pop_edge > 0.55` OR `AUC_pop_outfit > 0.55`:** `results.md` labels the headline
  **"popularity-confounded (disclosed)"** and reports a **popularity-matched-negative sensitivity
  re-run** — **gate numbers do not move.** The re-run re-draws each same-fine-category negative
  **matched on the replaced positive partner's popularity-decile**, where **deciles are computed over
  the split's full item-popularity distribution**: the negative `b′` is drawn same-fine-category,
  within **±1 decile** of the replaced positive partner's decile, still anchor-non-co-occurring;
  recomputes gate-A / gate-D AUC; reported as a sensitivity row only.
- The category-pair **co-occurrence** score is a **leak detector**, not a baseline rung: it must read
  **≈ 0.50 (edge) / 0.25 (FITB) / 0.50 (outfit-level)** by construction (a deviation = category leakage in the negative sampler); printed
  outside the ladder, never a beatable rung.

### C.7 Seed (ratified 2026-06-29)
- **Headline seed = 20260629** (one integer constant).
- **3-seed robustness footnote** (build doc §11): re-roll the *whole* negative set on
  **{20260629, 20260630, 20260701}**; require the **gate verdict (A/B/D pass/fail) to agree across all
  three** (a seed that flips a gate is a finding, not noise — the footnote is a coarse robustness
  check on "seed variance ≪ cluster variance," not a variance estimate).

### C.8 Coherence-sliced sensitivity (amended in 2026-07-01, pre-pilot — blind; build doc §12)
- **Finding that motivated it (measured before any judge or test-set number existed):** Polyvore sets
  are curatorial boards, not guaranteed wearable outfits. Under the mechanical 5-type rule
  (`coherence.py`: ≤1 item per clothingType over retained + held-out answer, never dress with
  top/bottom), **13/100** of the calibration draw, **65/500 (13.0%)** of the gate-B prefix, and
  **1,964/13,895 (14.1%)** of the gate-D full FITB set are incoherent. The rule deliberately
  over-flags layered tops (~40 of the gate-B 65 are top×2 — the type map folds cardigan/kimono/hoodie
  into `top`); strictly wear-impossible questions are ~5% of gate B.
- **The eval sets are NOT filtered** — gates A/B/D read the standard unfiltered benchmark (the Vasileva
  0.81 / 51.8% anchors were computed on the same unfiltered corpus; filtering would break gate-D
  comparability and soften the floor). Incoherence also **cannot discriminate candidates within a
  question**: FITB distractors are same-fine-category as the answer (§E), so all 4 candidates share the
  clash status (verified 500/500 on the gate-B prefix).
- **Why a sensitivity is still owed — two residual mechanisms, both pushing TOWARD a gate-B pass:**
  (1) near-noise questions attenuate a true trained-vs-judge gap toward parity (a true 5.7-point gap
  reads ≈ 5.0 under a 13% noise slice — at the δ = 5 margin that can flip a fail to a pass); (2) an LLM
  asked to complete an already-complete outfit can answer erratically → order-inconsistent → scored a
  miss (the §B judge handicap), while the trained head has no such failure mode.
- **Pre-registered reads (REPORTED, NEVER GATING; `metrics.json.coherence_sensitivity`):** per slice
  (coherent / flagged) — the gate-B paired diff under **both** inconsistency conventions, the judge's
  inconsistency rate (the balk detector), and the gate-D trained FITB. Slice CIs are null when a slice
  is empty.
- **Pre-committed response (frozen before the diagnostic, like C.6):** if the coherent-slice gate-B
  verdict disagrees with the headline gate-B verdict, `results.md` labels gate B
  **"coherence-sensitive (disclosed)"** — **gate numbers do not move.**

---

## D. Embedding backbone freeze (build doc §5; verified at C2)

Headline = **Marqo-FashionSigLIP**, loaded frozen via `open_clip` (`hf-hub:Marqo/marqo-fashionSigLIP`),
L2-normalized image embeddings. Verified by loading the actual cached weights (`embed.py`):

| Field | Frozen value |
|---|---|
| `open_clip_id` | `hf-hub:Marqo/marqo-fashionSigLIP` |
| **revision SHA** (local cache, the actually-loaded revision) | `c56244cc94f92419e8369fa71efdaf403b124ce8` |
| **embedding dim** | **768** (float32, L2-normalized — norm 1.0) |
| **preprocess sha256** | `fb80278db5fd5efcddc5a736a9095f34ed28da48e270cce5e12df162248404f6` |
| preprocess transform | Resize(224, bicubic, antialias) → ConvertMode → ToTensor → Normalize(0.5, 0.5, 0.5) |
| dependency lock | `requirements.txt` (torch 2.12.1 / open_clip_torch 3.3.0 / timm 1.0.27 / numpy 2.5.0 / scipy 1.18.0) |

- **Image source:** the gated `mvasil/polyvore-outfits` **parquet** `disjoint` config (an `image`
  column of JPEG bytes keyed by `item_id`), **not** loose `{item_id}.jpg` files; HF split `validation`
  maps to our `valid` (build doc §2). Per-`item_id` resolution is asserted at embed time (fail loud on
  a miss).
- **Manifest:** `embedding_manifest_fashionsiglip.json` is the **canonical** embedding freeze record.
  At **C2 it carries config only** (the table above + dim/dtype/normalization); the **cache-content
  fields** (per-image content hashes, `ids_list_sha256`, `image_hashes_sha256`,
  `embeddings_content_sha256`, `n_items`) are `null` and **stage to C3**, when `build_cache` runs the
  one-time pass (a multi-hour CPU batch over ~175k disjoint items — budget it; the pass reveals **no
  compatibility number**, so deferring the cache hashes does not touch the freeze's blindness).
  **C3 contract:** before `build_cache` overwrites the manifest, it must **verify** the freshly
  resolved `revision_sha` / `preprocess_hash` / `embedding_dim` / `dtype` / `normalization` equal the
  C2-frozen values and **fail loud** on a mismatch (the config freeze is enforced, not just
  git-historical). Ablation backbones get their own `embedding_manifest_<key>.json` at C3 — **non-canonical**.

---

## E. Negative-sampling contract + the type map (build doc §4)

The §4 contract (same-fine-category, anchor-no-cooccurrence, split-scoped, no cross-leak; the
multi-anchor FITB rule; the outfit-corruption rule) is **single-homed in build doc §4** and
implemented in `data_loader.py` (proven by `tests/test_data_loader.py`). Frozen artifacts:

- **`type_map.json`** — the Polyvore `category_id` → {5-type | excluded} mapping (one row per
  category; authored at C1, **frozen here**). `category_id` is the same-category equivalence key —
  Vasileva 2018's published **153-category** negative grain (anchor comparability, not "no finer label
  exists," is why). The exclusion carve-out (accessories / swimwear / sleepwear / lingerie) + the two
  production-match overrides (cardigan 18 → top; track jacket 256/289 → outer_layer) are in its
  `_policy`. **The three formerly-"pending C2" rows are now resolved-and-frozen:** set/suit + male suit
  (30/281) → **dress**, coverup (1607) → **outer_layer**, male vest (4457) → **outer_layer**.
- **`fitb_manifest.json`** — eligibility, held-out-item rule, distractor rule, seed, and the gate-B vs
  gate-D allocation (rules + seed, **not** materialized questions — see that file's `_README` +
  `allocation` block).
- **Negative scarcity (frozen rule):** after accessory-exclusion + same-fine-category +
  anchor-no-cooccurrence, an exhausted category pool → **drop that edge/slot + report the count**.
  The C2 Polyvore headline FITB choice is **skip-and-count only** (`fitb_manifest.json`); no
  coarse-5-type broadened question enters gates B or D, so every reported headline FITB question
  remains cleanly chance@4 = 0.25. Never broaden to coarse 5-type on the **AUC** set (that
  re-introduces a category-leaking easier negative).

---

## F. Calibration-set spec (the judge-selection target — build doc §8; invariants frozen at C2)

The judge prompt / K / determinism envelope are tuned **solely** against this set (the manifest + hash
freeze later, at C4, in `judge_addendum.md`). Firm invariants frozen now:

- A **small held-out set of pairwise/FITB compatibility questions carrying an *actual human*
  compatibility label** (a diverse human panel's forced-choice judgments) — **a human label on purpose,
  NOT Polyvore co-occurrence ground-truth** (co-occurrence would re-import the memorization confound into
  the very calibration the blindness rests on).
- **Disjoint from the gate-B ≤500 set *and* the gate-D full FITB set** (judge tuning never touches a
  gated question).
- **Sized to a pre-set floor ≥ ~50 questions** (the exact size + source corpus pin at C4).
- **Diverse panel (≥3 labelers), unique-plurality consensus:** every panelist labels the SAME questions;
  each may **abstain** ("not sure" — never guess) on questions outside their competence. A question's
  consensus label is the **unique plurality over the confident (non-skip) votes**, kept only with **≥2
  confident votes and no tie** — else **dropped-and-counted** (the disclosed disagreement signal). The
  reported human ceiling is **inter-annotator agreement** (average pairwise agreement over co-confident
  votes — abstention-robust; Fleiss' κ is ill-defined under per-question skips). Report per-labeler skip
  rate + the realized garment mix.
- **Source constraint (so the disjointness is satisfiable — FC-6):** because gate D consumes **every
  eligible test outfit** (`fitb_manifest.json`), a Polyvore-sourced calibration set must draw from
  **valid/train** outfits (or test outfits used by no gate-D question); the closet is the other
  admissible source. The exact source corpus + size pin at C4.
- **Only use:** selecting the judge envelope. It **never scores the trained head.**

> **Amendment (2026-07-01, pre-pilot — blind, no p-hacking).** §F originally froze a **single-annotator**
> set ("matched to the owner's taste") with an intra-annotator stability check. It was amended to the
> diverse-panel spec above **before any judge or test-set number existed** (no `metrics.json`, no judge
> run had been executed), so no result could have motivated the change. Cause: a single non-expert labeler
> makes the judge-selection target noisy, and the Polyvore corpus is women's-fashion-heavy while some
> labelers can only competently judge a subset — per-question abstention + a diverse panel route each
> question to competent judges, and the panel yields a measurable human-agreement ceiling. The claim
> shifts from "tracks the owner's taste" to "tracks human consensus (with a measured ceiling)." Mirrored
> in `preregistration.json` `calibration_set`.

> **Amendment #2 (2026-07-01, pre-pilot — blind; same epistemic position as above).** The calibration
> **draw** adds two pre-label filters (no judge or test-set number existed; no panel label had been
> collected):
> 1. **5-type coherence filter** (`coherence.fitb_question_is_coherent`): a question is drawn only if
>    its full outfit (retained + held-out answer) has ≤1 item per clothingType and never combines a
>    dress with a top/bottom. Cause: 13/100 of the unfiltered draw implied a wear-impossible outfit
>    (two pairs of shoes; a dress plus pants; "add a bottom" over an outfit that has one) — humans balk,
>    and their forced-choice labels there are noise, so tuning the judge to them would tune to noise.
>    The rule is deliberately strict (layered-top outfits read incoherent; disclosed in `coherence.py`).
> 2. **Visual-QC exclude list** (`calibration_visual_qc.json`, committed): the operator views EVERY
>    image in the drawn questions; an item whose parquet image contradicts its declared garment
>    (verified instances: a car for "rick owens trousers"; a Gucci shoulder bag for "jersey stirrup
>    leggings"; a sling bag for "suede pencil skirt") is appended with a reason and the draw re-runs
>    (deterministic given the committed list). Metadata mislabels whose image DOES show the named
>    garment (a swimsuit categorized as dress/coverup; scenic worn-garment shots) are NOT excluded —
>    the panel's abstain + plurality-drop machinery is the designed backstop, keeping the list
>    objective rather than taste-based.
>
> The **eval sets are untouched** by both (they stay the standard benchmark — §C.8 reports the
> coherence-sliced sensitivity instead). The calibration claim narrows to "tracks human consensus **on
> coherent, wearable-outfit questions** (with a measured ceiling)" — disclosed in `results.md`.
> Mirrored in `preregistration.json` `calibration_set.amendment_2026_07_01_draw_filters`.

---

## G. STL/CTL optional supplement (build doc §10/§15 — non-gating)

STL/CTL is **optional, stretch, and never a gate input.** The build-or-drop **threshold freezes here**;
only the measured *yield* is computed at C5.

- **Build-or-drop threshold (frozen):** build STL/CTL **only if** a resolvable-yield check clears
  **both** — (a) **≥ 60 %** of sampled CTL outfit collages resolve to ≥ 1 garment-croppable
  scene↔product pair with a valid 21→5-type mapping, **and** (b) **≥ 500** resolvable pairs total. Else
  **drop** (the closet is the transfer-probe input regardless).
- **21→5-type mapping policy (frozen; per-row materialized at C5 iff built):** collapse the CTL 21
  categories to the 5-value `clothingType` by the **same semantic rule** `type_map.json` uses
  (tops→top, bottoms→bottom, all-body→dress, outerwear→outer_layer, shoes→shoes), **excluding**
  bags/jewellery/accessories/hats/swim/sleep/lingerie. The per-category rows need the CTL paper's
  21-category list (not in-repo); they materialize at C5 as `stl_ctl_type_map.json` **mechanically from
  this policy** — no post-hoc choice. If built, reconstruct **same-fine-category negatives** to match
  the Polyvore protocol and crop the scene to the garment (disclose the in-the-wild-advantage tension).

---

## H. Statistics freeze (build doc §11)

- **Pooled ROC-AUC**, never per-outfit-averaged. **Cluster bootstrap**, **percentile** (not BCa),
  **B = 10,000**, resampled at the cluster unit:
  - **pair-level AUC** (gate A, the transfer) → cluster = the **(positive, negative) pair** (positives
    are distinct pairs deduped across outfits, so an edge has no unique source outfit — 38 of 44,627
    strict-disjoint test pairs recur (the headline `strict_disjoint=True` split; pinned here).
  - **outfit-level AUC** (gate D) → cluster = the **source outfit**.
  - **FITB** → cluster = the **question** (one question per distinct outfit ⇒ effective-N = N).
- **Difference CIs at the source:** gates A and B use a **paired** cluster bootstrap (shared resample,
  both models scored, then differenced — pairing tightens the CI). The **reported transfer** combines
  **two independent** bootstraps (disjoint corpora), dominated by the closet term; percentile coverage
  at ~15–25 closet clusters is weak → reported with an explicit coverage caveat, read directionally,
  **never** a precise instrument (exactly why the transfer is reported, not gated).
- **Gate-B two-stage bootstrap (C4):** additionally propagate the judge's temp-0 run-to-run variance
  (resample the judge's per-question samples jointly with the cluster resample) so the parity CI does
  not understate uncertainty.
- **One headline seed + the 3-seed robustness footnote** (§C.7). **No permutation p-value on top of the
  CI.**

---

## J. Disjointness + counts freeze (build doc §2)

- **Counts (measured off the shipped JSON at C1, printed at load — never asserted in prose elsewhere):**
  train **16,995** / valid **3,000** / test **15,145** outfits. Valid + test arrive pre-separated in the
  shipped `disjoint/` files; there is **no** internal valid-vs-test re-derivation.
- **`strict_disjoint=True` (the frozen headline option):** the shipped `disjoint/` split is only
  **near**-disjoint — test shares **84 items / 47 outfits (0.12 %)** with train. The headline **purges
  the 47 train-overlapping test outfits** (15,145 → **15,098**) so the reported test set is **literally
  item-disjoint**. **Valid's larger train overlap (25.8 % of valid items) is disclosed, not purged** —
  valid is sealed-checkpoint-selection only, never the reported number.
- **Disjointness caveat (keep):** item-disjoint ≠ visual-disjoint — near-duplicate product photos +
  brand co-occurrence still bleed, and the disjoint split does **not** control `gpt-5.4-mini`
  pretraining memorization (orthogonal; the image-only judge arm is the text-memorization control, §8).
  Report as "the strongest publicly-shipped split," not "leakage-free."
- **Non-disjoint variant** (Vasileva 2018, 68,306 outfits) is a **ceiling/sanity readout only**, never
  a gate.

---

## K. Unlock / build-order contract (the freeze's teeth — build doc §12/§15)

`metrics.json` is **not** written at one checkpoint; emission is gated and staged:

- **C3:** nothing materializes — only `selection.json` (sealed: checkpoint id/config/hash/convergence,
  **no metric values of any split**), validated against `selection.schema.json`.
- **C4:** once **all four** unlock files (`preregistration.md` + `preregistration.json` +
  `judge_addendum.md` + `closet_manifest.json`) are committed **and validated**
  (`preregistration.json` agrees with the human-authority `.md`; `closet_manifest.json` validates
  against `closet_manifest.schema.json` plus C4 referential checks that every outfit item id is
  declared and every `polyvore_category_id` exists in `closet_category_reference.json`; addendum
  against the C4 addendum schema/hash contract), `evaluate.py` records their git blob hashes /
  sha256s in `_meta.unlock_files`, records the sealed C3 `selection.json` identity in
  `_meta.selection`, and **first unlocks emission** of the held-out test-set trained-head/judge
  fields. Valid-split metric values remain outside `metrics.json`; C3 exposes only `selection.json`
  provenance.
- **C5:** `domain_probe.py` writes `closet_metrics.json` (closet/transfer fields); `evaluate.py` merges.
- **C6:** `evaluate.py`'s gate-application half reads the finalized file and prints the A ∧ B ∧ D
  verdict + the reported transfer.

`metrics.schema.json` enumerates the exact field set each read needs (skeleton at C2 with this freeze,
finalized at C6).

---

*Frozen artifacts committed alongside this file (the C2 freeze set): `preregistration.json`,
`fitb_manifest.json`, `embedding_manifest_fashionsiglip.json`, `metrics.schema.json`,
`selection.schema.json`,
`closet_manifest.schema.json`, `type_map.json`.
`closet_manifest.json` is a **mandatory unlock file** that must freeze **before the C4 test-metric
unlock** (§12/§14 — the load-bearing blindness invariant), enforced by `evaluate.py`'s four-file
unlock gate **plus schema/hash validation**, not by existence alone. It freezes from
`closet_manifest.template.json` then, **not** at this C2 commit: the closet labels do not exist at
the C2 design-freeze (Brian is away from his wardrobe), so it does not block authoring this prereg.
The C2 commit ships only `closet_manifest.template.json` + `closet_manifest.schema.json`.*
