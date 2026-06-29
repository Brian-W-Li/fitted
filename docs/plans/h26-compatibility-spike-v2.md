# H26 Compatibility Spike — Build Doc (v2)

> **Status: Canonical build doc** (finalized 2026-06-28). The canonical pointers (`CLAUDE.md`,
> `docs/Fitted_Spec_v2.md` §20 / §23-H26 / §23-H28, `docs/README.md`) resolve here. The **benchmark definition
> is finalized**; the headline cell (§1) + the four-gate block (§12) — plus the enumerated C2 ratifications
> (artifact format §1, the §4 popularity-confound response, the §12 FITB allocation) — **freeze verbatim into
> `preregistration.md` at C2, before any model number.**
>
> **Production-stylist context (load-bearing for the judge baseline, §8):** the stylist is `gpt-5.4-mini`, an
> OpenAI **mini-tier** model on **text attributes only** (`imageUrl` stripped — spec §12 / §23-H33;
> `recommend/route.ts:450`, `regenerate/route.ts:461`). The H26 judge baseline mirrors it — a mini judge
> hardens the cost bar (§8).

---

## 0. Frame & thesis

H26 is an **offline, zero-user, public-corpus content-compatibility experiment**. It answers three
pre-registered questions and ships a portfolio artifact regardless of how they resolve:

1. **Sharpest demonstrable ML result.** A rigorous, reproducible compatibility benchmark on a public corpus —
   the zero-user fork's strongest standalone ML deliverable.
2. **M6 go/no-go.** Should we train the production compatibility scorer? Decided **mechanically** against
   pre-registered gates (§12), not by eyeball.
3. **H28 seam shape.** Item-level vs pairwise-edge vs whole-outfit-attention — settled **empirically on our
   own data** by a light in-spike ablation (§6), not merely adopted from the literature.

**The honest thesis — parity-but-cheaper, reframed.** `gpt-5.4-mini` is the production stylist, so a
**cost-alone** win is fragile (the next price cut erases it) and arguably already thin. The durable, price-cut-
proof wins of a tiny trained content prior are **(a) bit-determinism, (b) zero serving-time API dependency,
(c) availability at per-edge serving volume where an LLM call per edge is economically/latency-infeasible, and
(d) a native per-edge signal the style graph (§13) is built on.** The benchmark measures whether such a prior
reaches **honest FITB parity with the LLM judge on the same task** (gate B, §12) while buying those four properties.

**A no-go ships as a complete result.** The deliverable is **decoupled from the verdict**: the methodology, the
measured catalog→in-the-wild domain-gap drop, the cost/determinism table, and the settled seam shape all land
either way. `results.md` leads with methodology + the parity story + the drop, and the gate verdict is an
internal M6 decision printed by `evaluate.py` — never framed as "I proved I can't do it."

**Scope guard.** H26 touches **no** `fitted_core/` code and lands **no** seam. It is pure measurement; it
*informs* the post-H26/pre-M5 scorer-seam rung (§23-H28) and the M6 go/no-go, nothing more.

---

## 1. Pre-registration (the spine)

**The frozen block has one design home — the table below — and is committed verbatim as `preregistration.md`**
in a commit **strictly earlier** (git-log-verifiable) than any commit that introduces a model number. §§3–11
explain the *mechanics* of each frozen choice; they do not re-decide it. (The existing spec's drift came from
re-pinning the same value in five competing homes — here the table is the single source the committed file
copies, and `evaluate.py` reads that file, so there is exactly one authority.) **So that "`evaluate.py` reads
that file" is literally enforceable** (not a hand-copied constant that silently drifts from the prose — the
two-authorities trap this single-home rule exists to kill), **the frozen gate thresholds + headline-cell values
carry a machine-readable form `evaluate.py` parses directly** — YAML front-matter in `preregistration.md` or a
sidecar `preregistration.json`; pick one at C2. `judge_addendum.md`'s determinism envelope gets the same
treatment; `fitb_manifest.json` / `closet_manifest.json` / `metrics.schema.json` are already JSON. (The *unlock*
check stays a plain file-existence test — §12; only the *threshold values* need machine-readability.)

**The frozen headline cell** (one cell — no post-hoc selection across a grid; Gelman & Loken's
garden-of-forking-paths makes post-hoc cell choice a multiple-comparisons problem even without conscious
p-hacking):

| Degree of freedom | Frozen value |
|---|---|
| Split | Polyvore Outfits-**D** (item-disjoint), shipped JSON, never re-split |
| Backbone | Marqo-**FashionSigLIP** (ViT-B/16-SigLIP, frozen), L2-normalized image embeddings |
| Modality (headline) | **image** (garment photo embeddings) |
| Trained-head shape | **pairwise, type-conditioned edge head**; outfit score = mean over edges |
| Objective | **pointwise BCE** on positive vs same-fine-category negative edges (margin-ranking = ablation only) |
| Metrics | **pooled pair-level ROC-AUC** (gates A/C) + **outfit-level ROC-AUC** (gate D; §3/§4) + **FITB@4** (hit@1; gate-B + gate-D subsets, §12) |
| Negatives | **same-fine-grained-category**, split-scoped pools (§4) — **AUC: 1:1** · **FITB@4: 3 same-fine-category distractors** |
| Tie policy | a `k`-way top tie scores **`1/k`** (FITB) / **0.5** (AUC, Mann-Whitney convention) |
| Seed | one committed integer constant |
| CI | **95% cluster bootstrap**, percentile, B = 10,000, resampled at the outfit/question unit |
| Judge | **`gpt-5.4-mini`, dated-snapshot rule** (the snapshot production serves; the *specific* date is pinned at C4 in `judge_addendum.md`, **not** frozen here — §8), **temperature 0**, image-only arm, FITB@4 both-orders |

Everything that could be chosen *after* seeing a number lives in that block. The **GPT prompt + determinism
envelope + the specific dated judge snapshot** are frozen *later* (at C4) in a pre-registration addendum
(`judge_addendum.md`), on a held-out human-agreement calibration set, **blind to every trained-head metric** — the judge prompt / K / envelope are
selected **solely against the human-agreement calibration set**, never against the trained head's valid- *or*
test-split numbers (tuning the prompt to flatter the parity gate is the forbidden path). **Blindness is enforced
by build order, not honor system:** C3's **valid-split selection is mechanical** (argmax over the frozen grid; a
convergence/early-stop indicator is the only human-readable C3 output — selecting the checkpoint needs no
inspection of the metric *values*), and **the valid-split metric values stay sealed** alongside **every held-out
*test*-set trained-head number — including the gate-D outfit-level AUC and the gate-B FITB — until the C4 judge
addendum is committed**. **"Sealed" is a concrete artifact contract, not a verbal promise:** C3 writes **only
`selection.json`** — chosen checkpoint id + training config + checkpoint hash + a convergence/early-stop boolean,
**no metric values of any split** — and the valid- and test-split metric *values* are **never materialized to the
committed `metrics.json`** until `evaluate.py` confirms all three unlock files exist (C4); there is no
human-readable metric file before C4. `evaluate.py` refuses to emit any sealed metric unless `preregistration.md`,
`judge_addendum.md`, **and** the frozen `closet_manifest.json` exist (§15 C3/C4, §12).
Everything else freezes at C2, before any model number exists.

**The go/no-go is one mechanical AND-gate** in `evaluate.py` reading `metrics.json` (§12). **Its four gates +
frozen thresholds — A added-value > 0 · B FITB non-inferiority δ = 5 pts · C transfer (closet AUC ≥ 0.70 OR drop
≤ 0.12) · D absolute floor (outfit AUC ≥ 0.81 ∧ FITB ≥ 50%) — are the second committed block of
`preregistration.md`, frozen at C2 with the headline cell above.** `results.md` only restates it.

---

## 2. Dataset & split

**Headline = Polyvore Outfits-D (item-disjoint).** Item-level disjointness is the only Polyvore variant that
blocks the scorer from winning by **memorizing items**, so its AUC/FITB is an honest *generalization* number —
the correct cold-start analog.

- **Counts (verified, arXiv:1803.09196 §3):** 32,140 outfits / 175,485 items; 16,995 train; **15,145 combined
  valid+test** (the paper says "16,995 … for training and 15,145 for testing and validation"; 16,995 + 15,145
  = 32,140 reconciles exactly). The **internal valid-vs-test split is read off the shipped JSON**, not
  re-derived. **C1 prints the actual raw / post-filter / dropped counts at load** — the spec never asserts a
  corpus size in prose (a wrong headline-dataset count is a cheap credibility nick).
- **Non-disjoint variant** (68,306 outfits / 365,054 items, Vasileva 2018) is computed **once as a
  ceiling/sanity readout only** — items recur across splits, so it is the easy regime, never the gate.
- **Disjointness caveat (keep):** item-disjoint ≠ *visual*-disjoint — near-duplicate product photos and brand
  co-occurrence still bleed. Report it as "the strongest publicly-shipped split," not "leakage-free."
- **Attribution (corrected):** the 68,306-outfit / 365,054-item figure is **Vasileva 2018**. **Han 2017
  (Maryland Polyvore)** is a *different, smaller* set — 21,889 outfits (17,316 / 1,497 / 3,076) with
  **random-category** negatives (the easy protocol Vasileva's same-category negatives were built to fix). Do
  not conflate them, and do not headline Maryland.

**Access logistics (a real risk for a solo fork).** The canonical `mvasil/polyvore-outfits` HF dataset is
**gated**: it needs an institutional/research-affiliated email and an academic/non-profit-use agreement. Brian
is a UCSB student, so the `.edu` form should clear — **confirm early, it blocks the honest headline corpus.**
The license tag (CC BY 4.0) covers the *curation/annotations* only; the authors disclaim image copyright
(Polyvore.com shut down 2018). So: **publish numbers + methodology, never redistribute images.** The ungated
`Marqo/polyvore` mirror (Maryland-21K lineage, images + text, outfit groupings preserved) is the **bring-up
fallback** — fine for pipeline wiring and a quick CLIP-embedding smoke test, **never the honest headline**
(it is the easier lineage, no item-disjoint split).

---

## 3. Metrics

**The frozen metric set is three outputs: pooled pair-level (edge) ROC-AUC (gates A/C), outfit-level ROC-AUC (gate D; defined below, §4/§6), and FITB@4 (gate B + gate D).** Taking the pair-level edge AUC first: AUC = the Mann-Whitney U statistic =
`U / (n₁·n₂)` = P(a random positive edge scores above a random negative edge), computed over the **flat pooled
array** of all positive and all negative edge scores. **Never** a per-outfit-averaged AUC: with one positive
and one negative per outfit, a per-outfit AUC degenerates to the within-pair indicator (matched-pair accuracy)
and discards every cross-pair comparison. Chance = **0.50**. Ties count **0.5**.

- A positive **edge** = a co-occurring unordered item pair `{a, b}`; its 1:1 negative = `(a, b′)` with `b′`
  same-fine-category as the replaced endpoint `b` and not co-worn with `a` (§4). The committed seed picks which
  endpoint is the kept anchor.

**FITB@4** = top-1 accuracy choosing the held-out item from **4 candidates** (1 positive + 3 same-fine-category
distractors); chance = **25%**. Hit = the candidate maximizing mean edge-compat with the partial outfit; a
`k`-way top tie scores `1/k` (deterministic, seed-independent — so the co-occurrence sanity baseline scores
exactly 0.25, never leaks candidate-order signal).

**One outfit-level AUC** is computed on the **held-out test set** (the same split the published outfit-level
anchors report — **never** train/valid, which a trained head would partly memorize and inflate the floor) as the
**gate-D absolute-floor input** *and* the
**"literature honest-band" readout** (both compare to the published outfit-level anchors, §6/§12; **positive
vs same-fine-category-corrupted negative outfits — construction in §4 — scored as mean edge-compat (§6), pooled
and cluster-bootstrapped at the source-outfit unit**). The
**pair-level** unit is what gates **A** (added-value) and the **gate-C** domain-gap drop, so the drop stays
pair-level on **every** side (§10) — like-for-like, no unit mismatch. This collapses the existing spec's
three-AUC-flavor surface (outfit-level headline + pair-level drop reference + GPT-restricted pair-level) into
**one pair-level unit (gates A/C) + one outfit-level unit (gate D + the band)**, killing the unit-mismatch trap at
its source rather than guarding it in five places.

**The harness's own metric code is unit-tested** (a wrong metric silently corrupts the whole result — the trust
floor): pooled AUC = 1.0 on perfect separation / ≈0.5 on random; FITB picks the known winner and an all-tied
question scores exactly 0.25; the co-occurrence-is-chance assertion (§4) holds to 0.50 / 0.25; cluster-bootstrap
CI shape. Tests live in `experiments/h26/tests/` and must run green (once the package is built — C1/C2).

---

## 4. Negative-sampling contract (single home)

Stated **once** here; every other section references it (the existing spec restated it in ~6 places and the
audit kept catching "not-in-the-outfit" vs "never-co-occur" drift).

- **Same-fine-grained-category negatives for BOTH AUC and FITB.** Random/loose-category negatives inflate AUC
  into the 0.90s by testing *type-plausibility* (a shoe where a top belongs) instead of *style compatibility*;
  same-category negatives are the genuinely hard setting and make the result comparable to published numbers.
  (Vasileva 2018 §5, verbatim: "replace each item … by randomly selecting another item of the same category";
  FITB distractors are "randomly selected items from the same category as the correct answer.")
- **Anchor-no-cooccurrence:** the negative partner `b′` must be same-fine-category as the replaced item `b`,
  `≠ b`, and **must never co-occur with the anchor `a` anywhere in the split** (just "not in this outfit" is
  insufficient — `b′` could be a genuinely-compatible co-worn partner of `a` from another outfit, mislabeling a
  real positive as a negative). The same rule applies to **training** negatives (so BCE is not trained on false
  negatives) and to the FITB distractors — **but a FITB partial outfit holds *multiple* items, so "the anchor"
  is not single-valued: each FITB distractor must never co-occur with *any* item remaining in the partial outfit
  anywhere in the split (the multi-anchor generalization of the single-edge rule above), not merely with one
  designated anchor — otherwise a distractor co-worn with some retained item is a hidden false negative.
  `test_data_loader.py` asserts the multi-item form.**
- **Split-scoped pools, no cross-leak.** Test negatives drawn only from test; valid-selection negatives from
  valid; train negatives from train. The three pools never cross-leak — `test_data_loader.py` proves it
  (preserves the disjoint guarantee).
- **5-value type space.** Apply the frozen Polyvore-fine-category → 5-value `clothingType`
  (`top` / `bottom` / `dress` / `outer_layer` / `shoes`; the canonical enum, `fitted/lib/clothingType.ts`)
  mapping, **excluding** non-clothing accessories (bags/jewelry/sunglasses) so the type space matches the
  production wardrobe exactly. Outfits left with **< 2 clothing items** after the exclusion have no edge → **dropped**
  (dropped count reported). The **excluded item/edge share is reported** (the literature anchors are
  full-Polyvore figures, so the filtered task's comparability is disclosed, not hidden).

**Outfit-level negatives (the gate-D / literature-band input) — single home, here.** Gate D (§12) and the §6
honest-band readout are **outfit-level**, so they need negative *outfits*, not just negative edges. Construction
(matching Vasileva 2018 §5's compatibility protocol — "replace each item … by randomly selecting another item of
the same category"): each positive **held-out test** outfit yields **one** negative outfit by replacing **every** item with a
**test-scoped** (split-scoped pools, above) same-fine-category item not co-worn with the rest of the corrupted outfit (so the category multiset is preserved
and AUC is not a type-plausibility artifact, exactly as for the edge negatives above); the trained head scores
both as **mean edge-compat over the outfit's edges** (§6); pooled outfit-level ROC-AUC over the {positive,
negative} outfit scores, **cluster-bootstrapped at the source-outfit unit** (`metrics.json` field `outfit_auc`
with its CI). The gate-D `outfit_auc` is therefore a held-out-test generalization number, never a full-corpus
(train-inclusive) figure. *(The exact corruption rule and the accessory-exclusion comparability caveat are confirmed against
Vasileva 2018 Table 5's protocol at C2; if the published compatibility AUC used random-category negatives, this
same-category construction is **harder**, so the gate-D `outfit_auc` reads conservatively below the 0.81 anchor —
disclose, never relax the floor.)*

**Co-occurrence is chance-by-construction — a leak detector, not a baseline rung.** Because the swap leaves the
outfit's category multiset unchanged, any score that is a *function only of the category pair* (category-pair
co-occurrence, category-popularity) scores a positive and its same-category negative **identically** → pooled
AUC ≈ 0.50, FITB ≈ 25%. So co-occurrence is a **unit-test assertion** (a deviation reveals category leakage in the
negative sampler), printed **outside** the reported ladder labeled "harness sanity check (must ≈ chance)" — **never** a
beatable rung, and a margin over it is **never** reported as a result. **Item-popularity is a *separate* confound (NOT chance-by-construction).** A positive partner is a
real co-worn item (selection-biased toward popular items that appear in many outfits); a uniformly-drawn
same-category negative `b′` is on average *less* popular, so an **item**-level "candidate's marginal
outfit-frequency" feature can discriminate positive from negative **without any compatibility signal**. Add an
**item-popularity-only baseline** as a second sanity rung — the category-pair sanity assertion reads ≈ 0.50 and
**misses this**. **The firm rigor now: ONE response must be pre-registered at C2, fixed *before* any number (no
post-hoc fork — choosing the protocol after seeing the diagnostic is the forbidden path).** *Which* response is an
open C2 decision. **Recommended (ratify at C2):** keep the same-fine-category + anchor-no-cooccurrence protocol as
the frozen headline (it matches Vasileva's published protocol → comparable to the anchors), treat the
item-popularity-only baseline as a pre-registered diagnostic, and if it exceeds a **pre-set margin (also fixed at
C2)** over chance, `results.md` labels the headline **"popularity-confounded (disclosed)"** and reports a
pre-specified **popularity-matched-negative sensitivity re-run** — gate numbers don't move. *(Alternative, if
preferred: adopt popularity-matched negatives as the headline protocol outright.)* Either way the response is
frozen at C2, never chosen after the diagnostic. *(This is the same de-confounding rigor §5 applies to the
backbone — it must extend to the negatives.)*

---

## 5. Embedding backbone

**Headline = Marqo-FashionSigLIP**, loaded **frozen** via `open_clip` (`hf-hub:Marqo/marqo-fashionSigLIP`),
L2-normalized image embeddings. The H26 compatibility head is a small trained **pairwise** scorer over that frozen space — it settles the shape of the §23-H28 pairwise/outfit `rank()` hook, **not** the item-level `SignalScorer` sampler seam.

- **Why this backbone (verified, HF model card):** base = ViT-B/16-SigLIP (webli), trained with Generalised
  Contrastive Learning over categories/style/colors/materials/keywords; Category→Product MRR **0.812** vs
  FashionCLIP-2.0 0.741 and the matched WebLI SigLIP ViT-B/16 base 0.751 (HF card; the original FashionCLIP is
  not on the card — the often-quoted 0.776 is Marqo's own *FashionCLIP*, a different model). It is ViT-B/16 (fast, CPU-feasible, deterministic — directly
  serving the cost/latency/determinism thesis). **Verify the emitted embedding dimensionality against the model
  card before fixing the head input** — SigLIP ViT-B/16 is 768-d architecturally, but the card does not state
  it, and both load paths exist (`open_clip` hf-hub; `transformers` `AutoModel` + `trust_remote_code=True`);
  pin whichever actually loads the weights at C2.
- **Frozen-encoder + light head** is the standard, best-precedented transfer-learning hedge for a low-data
  target (freeze for low-data, full-finetune only for high-data), and it is **seam-shape-agnostic** — the
  item-level, pairwise, and attention heads (§6) all train over **one** cached embedding pass.

**De-confounded ablation (a fix over the existing spec).** The existing spec's vanilla-CLIP-B/32 → Marqo-B/16
delta confounds **three** variables — architecture (B/32 vs B/16), pretraining corpus (OpenAI-WIT vs LAION-2B),
and fashion fine-tuning — so it **cannot** isolate "how much fashion-pretraining buys." The fix: include
**Marqo's own matched base — the WebLI SigLIP ViT-B/16 it was actually fine-tuned from** — as an ablation rung;
the **matched-base → FashionSigLIP** delta, **measured on the Polyvore-D compatibility task** (AUC/FITB, not
retrieval), is the clean fashion-fine-tuning value (the HF card already shows the analogous lift on Cat→Product
retrieval MRR, 0.751 → 0.812 — corroborating context, not the spike's number). *(Do **not** substitute the LAION-2B ViT-B/16 CLIP as the "matched" base — it differs
from FashionSigLIP in **both** architecture (CLIP vs SigLIP) **and** corpus (LAION vs WebLI), reintroducing the
very confounds this rung exists to remove.)* Report the generic-CLIP comparison honestly as **"fashion-domain
model vs generic CLIP,"** not "how much fashion-pretraining buys," unless the matched-base rung is run. Ablation
rungs (all frozen, over the one cache): generic CLIP/SigLIP baseline, FashionCLIP-2.0, and the matched WebLI
SigLIP ViT-B/16 base (the fine-tuning-source checkpoint). *(One-line note: GR-Lite/GR-Pro (LookBench, Jan 2026) edge Marqo on retrieval but are newer and
compatibility-transfer-unproven — an optional rung, never the headline.)*

---

## 6. Trained edge head + the seam verdict

**The scorer = a pairwise, type-conditioned edge head over the frozen embedding pair:**
`score(item_i, item_j, type_pair) → float` — a small **2-layer MLP** (pin width/depth at C2; **not** "MLP-or-
bilinear" — one architecture, frozen) on `[emb_i ⊕ emb_j, |emb_i−emb_j|, emb_i*emb_j]` plus a **learned type-pair
embedding** indexed by the *unordered* `{type_i, type_j}` pair (15 pairs over the 5-value space, incl. same-type).
The edge is unordered, so the order-sensitive `emb_i ⊕ emb_j` term is **symmetrized** — `score = ½[f(i,j)+f(j,i)]`
(or a fixed id-canonical endpoint order); pin the choice at C2. **Outfit score = mean aggregation over edges;
FITB = the candidate maximizing mean edge-compat with the partial outfit.** Objective = pointwise **BCE** on
positive vs same-fine-category negative edges (margin-ranking BPR is an ablation-only rung, never the headline —
picking the better objective post-hoc is a forking path). Head hyperparameters / epochs / checkpoint are selected
on a **valid**-split AUC/FITB (built by the identical negative rules, valid-scoped pool) and frozen before any test
cell — the selection is **mechanical argmax over the frozen grid and its valid-metric values stay sealed until the
C4 judge addendum commits** (the §1 judge-blindness guard; no human-visible model number exists pre-C4). **Freeze in `preregistration.md` at C2:** the selection grid, optimizer, epoch budget, early-stopping rule,
tie-breaks, and Torch determinism flags (seed, `deterministic` algorithms); the trained head then ships as a
**committed artifact** — checkpoint hash + training config + manifest path (reproducibility).

**Seam verdict — settled empirically, not just adopted.** Compatibility is **non-transitive** ("compatibility
is not naturally a transitive property, but being nearby is" — Vasileva 2018), so a single shared **item-level**
scalar provably cannot represent it (one shoe matching two mutually-incompatible tops). NGNN (per-edge
node-conditioned interaction + attention aggregation) and OutfitTransformer (whole-outfit self-attention) both
aggregate **pairwise/relational** scores — **none sum per-item scalars**. The literature is unanimous on
pairwise-edge + type-conditioned. **Because every head trains over one frozen embedding cache, H26 runs a
*light* in-spike shape ablation** — an **item-level scalar head** (mean of per-item scalars) vs the
**pairwise-edge head** — so the spike **tests on its own data whether** the pairwise shape beats item-level,
aiming to *close* the "adopts the shape from literature but does not prove it" overclaim the existing spec carries
(a "falsified" claim requires `CI_low(pairwise − item-level) > 0` — the paired-bootstrap CI on the
*pairwise − item-level* difference **wholly above 0**, *not* merely "excludes 0" (a negative CI also excludes 0
but means item-level *won*) — and the item-level head's capacity matched, so a win is attributable to shape not
parameters — §11/§12). **The
item-level arm is pinned at C2 for reproducibility:** a 2-layer MLP `g(emb_item) → scalar` with **outfit score =
mean of per-item scalars**, trained over the **same** frozen embedding cache, **same** optimizer / selection grid
/ epoch budget / early-stopping rule, and selected on the **same** valid split; its hidden width is set so its
**total parameter count is within ±5 % of the pairwise head's** (the capacity match — a pairwise win must not be a
parameter-count win). Both heads are scored on the **identical** test questions and differenced by the §11 paired
cluster bootstrap.
Whole-outfit **attention** stays a genuinely-optional third arm (cheap over the same cache, but data-hungry and
not required to ship). The **pairwise-edge arm is the frozen headline** (the canonical seam shape, §23-H28).

**Pre-registered honest target band (orientation; gate D (§12) pins a hard floor at its 0.81 AUC / 50% FITB bottom — disjoint-split figures read directly from Vasileva 2018 Table 5, "Polyvore Outfits-D" column):**

| Anchor (Polyvore Outfits-D, disjoint, outfit-level) | AUC | FITB@4 |
|---|---|---|
| Chance | 0.50 | 25% |
| SiameseNet (untyped floor) | 0.81 | 51.8% |
| Type-Aware / CSN (Vasileva 2018, best 512-D) | **0.84** | **55.2%** |
| OutfitTransformer (disjoint ceiling) | 0.88 | 59.48% |

A from-scratch CLIP+MLP edge head should land in the **0.84 floor / 0.88 stretch** AUC band and **~55% floor /
~59.5% stretch** FITB. Type-conditioning buys the disjoint **0.81→0.84** AUC gap (SiameseNet → CSN); reaching
0.81 alone does **not** demonstrate the type-conditioning value. *(Cite the **disjoint** column, not non-disjoint:
the non-disjoint Polyvore-Outfits figures are higher — SiameseNet 0.81/52.9%, CSN best 0.86/56.2%.)* These
anchors are **outfit-level, full-Polyvore** figures; the *gated* unit (pair-level, image-only, accessory-filtered)
runs **lower** (aggregation denoises) — orient against the band, do **not** cross-read it against the gated
pair-level numbers. *(Sources: Vasileva 2018 / arXiv:1803.09196 Table 5, read directly; OutfitTransformer
disjoint = arXiv:2204.04812 Tables 1–2.)*

---

## 7. Baseline ladder

The **reported** ladder is exactly **three numbers** on the frozen cell, plus one sanity assertion outside it:

1. **Same-backbone zero-shot cosine** — the **binding non-learned floor.** Cosine of the two frozen
   FashionSigLIP embeddings, no training. This is the *only* baseline that isolates what *training* adds over
   the frozen representation (the published literature numbers measure a different architecture **and** corpus,
   so they cannot be that floor). The trained head must beat **its own backbone's** zero-shot cosine, or the
   lift is the backbone, not the head.
2. **The trained pairwise-edge head** (§6).
3. **The `gpt-5.4-mini` judge** (§8) — the parity target.

Plus, **outside** the ladder: two **harness sanity assertions** (§4) — category-pair co-occurrence (must ≈ chance)
and an **item-popularity-only** baseline (a margin over chance = a popularity confound in the negatives, which the
co-occurrence assertion cannot see).

**Deliberately dropped** (vs the existing spec / a maximalist design): the **headline cell is one frozen point,
not the best of a backbone × modality × difficulty grid** (§1) — the backbone/shape/modality ablation rungs
(§5/§6/§8) still run, but as **pre-registered ablations, never a post-hoc headline selection** (their multiple
CIs are a multiplicity exposure — pre-register a family-wise correction, §11); any permutation p-value on top of
the CI; the co-occurrence row as a reported rung. With a frozen backbone + a shallow head, **seed variance is
negligible against cluster (data) variance** — one headline seed + a **3-seed robustness footnote** suffices.

---

## 8. LLM-as-judge protocol

**Identity — `gpt-5.4-mini`, the model users actually get.** The production stylist serves
`model: "gpt-5.4-mini"` (`recommend/route.ts:450`, `regenerate/route.ts:461`) — upgraded this session from the
now-legacy `gpt-4o-mini` (off OpenAI's current pricing page). **For the judge, pin the dated snapshot** (e.g.
`gpt-5.4-mini-2026-03-17` — confirm the current snapshot at C4), **not** the rolling `gpt-5.4-mini` alias
production uses, and log `system_fingerprint` (reproducibility). A cheap mini judge **hardens** the cost bar (a
mini is already cheap and fast), which is exactly why the durable win is determinism + offline + per-edge
availability, not raw cost — and a more capable judge than the old `gpt-4o-mini` is a *harder, more honest*
parity bar for the trained head. Add **one** cross-family secondary judge (a current frontier multimodal model —
Claude or Gemini) for robustness only, never the headline. *(The rule is "the model users get, pinned **at C4**"
— if production moves to a newer snapshot **before the C4 freeze**, the judge moves with it; **after C4 the dated
snapshot is frozen and does not move**, even if production updates mid-spike.)*

**Parity gate via FITB — the Monte-Carlo AUC arm is CUT.** The existing spec's most expensive accreted
mechanism (N temperature-1 samples per edge × both orders × ~500 edges × text+vision) existed **only** because
gate-3 was pinned to AUC → AUC needs a continuous score → self-reported 0–1 floats tie-degenerate (G-Eval's
round-number bias) → **logprobs are unavailable on image inputs** (verified: OpenAI returns null logprobs when
the payload contains an image; no provider offers a usable image-logprob path). That self-inflicted chain sits
inside a cost-conscious spike. **Break it by making the head-to-head FITB-based:** both the trained head and the
judge do **native forced-choice FITB@4** (no continuous score needed). **The judge runs `gpt-5.4-mini` at
`temperature=0`** — smoke-tested 2026-06-28: the model **accepts arbitrary temperature** (a `temperature=0.5`
probe returns HTTP 200; the "temp-1-only" belief was an untested assumption, now disproven). Temp 0 is the
most stable, strongest LLM baseline (a forced-choice verdict barely moves with temperature), but GPT is still
**not** bit-reproducible at temp 0 (below), so each FITB verdict can drift — a stable per-question
verdict needs a small fixed number of repeated samples + an aggregation rule (the per-question sampling protocol
is frozen at C4 from the pilot's verdict-agreement rate). This is **cheaper than the existing spec's per-edge
Monte-Carlo AUC** (no continuous score, no per-edge product), but it is **not** the literal "1 deterministic
call/question" — re-derive the cost/size claim at C4 (judge at temp 0, small K). The judge's **FITB accuracy vs the trained
head's FITB accuracy** is the parity comparison (gate B, §12). A
GPT **AUC** is reported only as *optional* supporting evidence; if pursued, prefer the text arm (where logprobs
exist) or a Monte-Carlo verdict-fraction. **Escape hatch (frozen at C4):** *if* the pinned snapshot ever returns
logprobs on image inputs, a 1-call logprob-`P(compatible)` replaces Monte-Carlo — so the design is not locked
into N-cost if the limitation lifts.

**Modality — three arms, each measuring one thing** (resolved by the production-input fact in the header:
`gpt-5.4-mini` feeds *text attributes, no images* — spec §12 / §23-H33):

- **image-only** (garment photo, no title) — the **headline parity comparator** (gate B): same modality as the
  trained head (both consume images) **and** a **text-memorization control** (stripping titles removes retrieval
  of memorized Polyvore *titles*; note **visual** memorization of Polyvore product photos can remain — see the
  confound note below). This is the primary judge condition.
- **image+title** — a *measured ablation*; the image-only → image+title gap **estimates the
  memorization/text-lift**.
- **text-attribute** (the structured item fields, no image) — the **production-config reference**. *(What
  `gpt-5.4-mini` actually receives in `route.ts` is **richer than "category + title"**: name, category,
  subCategory, layerRole, colors, pattern, seasons, occasions — mirror those fields.)* Reported for the cost
  story; flagged memorization-confounded on Polyvore.

**Position bias — both orders, consistent-only.** LLM forced-choice judging has large, model-dependent order
bias (MT-Bench swap-consistency: GPT-4 65.0%, GPT-3.5 46.2%, Claude-v1 23.8% — verified, arXiv:2306.05685
Table 2). Run **every** FITB question in both candidate orders (a seeded shuffle + its exact reverse); **count
only verdicts consistent across both orders**; an **inconsistent verdict counts as a miss in the denominator**
(never excluded — excluding the inconsistent subset scores only the easy cases and inflates accuracy). Report a
wrong-vs-excluded **sensitivity table** + the position-flip rate. Budget the 2× call multiplier.

**Determinism — and turn it into the headline win.** The judge runs at **`temperature=0`** (the model accepts any
temperature — smoke-tested 2026-06-28; temp 0 is the lowest-variance, strongest LLM baseline), but even temp 0 is
still **not**
bit-deterministic for GPT-class models anyway (a documented 10k-call experiment yielded ~42 distinct values across
~12 clusters; `system_fingerprint` detects drift but cannot reproduce). So **report the judge's FITB accuracy as a multi-run distribution (mean ±
spread), never a single reproducible point** — and claim the trained scorer's **bit-exact determinism as a
first-class win** alongside cost and offline operation, not a footnote. Pin the dated snapshot, `temperature=0`
(the model accepts any temperature — smoke-tested 2026-06-28), fixed `max_tokens`, structured
`response_format`, a pinned retry budget
(unparseable-after-budget → drop + log; both
models then score the reduced shared question set, preserving like-for-like), and log full payloads +
`system_fingerprint` (**for the closet slice, log image *hashes/refs*, never raw photo bytes; keep all payload
logs gitignored** — §14).

**Memorization confound — the judge's biggest validity threat.** Polyvore is a public, heavily-mirrored 2017+
corpus, high-risk for being in `gpt-5.4-mini` pretraining; **the disjoint split controls intra-benchmark item
leakage but NOT LLM pretraining memorization** (orthogonal). Controls: (a) **image-only is the primary judge
condition** (strips memorized titles — the cleanest *text*-memorization control, though **visual** memorization
of product photos is not removed, and the modality the gate-B parity comparison runs in); (b) **gate B runs on the powered Polyvore image-only set, NOT the closet** — the hand-labeled closet (§10)
is too underpowered (effective-N = the cluster count) to *gate* parity (its FITB CI half-width would dwarf δ, an
unfixable straddle), so it serves as **non-Polyvore corroboration of the parity direction** (reported
descriptively) and as the **gate-C transfer input**; the residual risk that the judge *recognizes* Polyvore
product photos even with titles stripped, if real, **advantages the judge** and so biases gate B
**conservatively against the trained head** — a pass is therefore credible, a fail partly confound-explained;
(c) the image+title ablation estimates the residual text-memorization lift. *(Note: the
often-cited "GPT-4V validated as a fashion judge" is Hirakawa et al., arXiv:2410.23730 — GPT-4V on aesthetic
*preference*, an easier task than pairwise compatibility; cite it as suggestive, not as validation of GPT for
this task.)*

**Powered sample, pilot-gated.** A ~100-Q pilot per arm first (commit pilot CIs + position-flip rate); scale to
~500 only if the pilot CI half-width justifies it (§12's δ check).

---

## 9. Cost / latency / determinism

**Reframe the thesis — the per-edge GPT number is a "why the seam needs a cheap scorer," not a deployed cost
being undercut.** Nobody deploys per-edge `gpt-5.4-mini` judging: scoring one recommendation means
`C(k,2)` edges × candidate completions × 2 orders → **hundreds-to-~1,000 LLM calls per recommendation** — online
infeasible on latency and rate limits regardless of price. So the trained prior's win is **enabling the per-edge
content-compatibility seam to exist at serving time at all** — cheap, deterministic, offline-trainable, no API
dependency — at **honest FITB parity** (gate B) with what the judge reaches on the same task. State this explicitly;
the existing "parity at a fraction of *deployed* per-edge GPT cost" is a strawman because per-edge GPT is never
deployed.

**What to measure.** The **offline experiment** cost (whole-outfit granularity, image `detail: "low"`
~85 tok/image is a **gpt-4o-era** figure — confirm gpt-5.4-mini's actual per-image token accounting at C4, **Batch API 50% off**, **× the temp-0 per-question sample count `K` × 2 candidate orders** per §8)
as **point estimates with the pricing source** — cost is
~deterministic (tokens × published price), so a bootstrap CI on it is theater; statistical machinery applies to
**accuracy only.** Report alongside: the trained head's per-edge inference latency (~ms, CPU), its
**bit-determinism**, and the **GPT judge's measured synchronous per-request latency** (don't assert
"online-infeasible on latency" without measuring it). Pin every price to the **production model's rate**: `gpt-5.4-mini` is **$0.75 / $4.50** per
1M input/output tokens (mid-2026; **Batch/Flex −50%**, **cached-input −90%** on the repeated prompt prefix) —
~3× cheaper than full `gpt-5.4` and the cheap tier the cost thesis rides on, but a **dated** figure (a newer
snapshot or a tier change moves it), so pin it at spike time.

---

## 10. Domain-gap measurement (the load-bearing risk)

The spike's single most load-bearing risk: every cited Polyvore AUC/FITB is on **clean catalog flat-lays**, so
a strong disjoint number is an **upper bound** for messy real phone photos. **The go/no-go treats catalog
accuracy as necessary-not-sufficient and gates on the measured transfer (gate C, §12), and the gate-C input is
the catalog→closet drop / closet AUC — see the closet-power note in tier (2).** Three tiers:

**(1) Public, citable probes — supplementary, NOT the gate.**
   - **Polyvore-D generalization** (the item-disjoint number itself is already a generalization-gap estimate —
     a model that only memorized items would collapse on it).
   - **Pinterest Shop-the-Look / Complete-the-Look (STL/CTL)** scene↔product pairs — **an optional, heavily
     caveated task-shifted upper bound, not the headline and not a gate input.** Train the content prior on clean
     Polyvore catalog items, then evaluate on STL/CTL pairs where the **scene side is genuinely in-the-wild** (a
     real photo) and the product side is a catalog flat-lay — the catalog↔in-the-wild visual gap is the dataset's
     *built-in* axis. CTL public release: 107,895 / 24,960 outfit collages, 454,351 / 109,471 items, 21 categories,
     triplet supervision (Li et al., KDD 2020, arXiv:2006.10792). **Why supplementary, not the gate (decided this
     pass):** it confounds **task shift** (scene↔single-product ≠ within-outfit item-item compatibility) with the
     domain shift it intends to measure, the **scene side is OOD** for a garment-trained edge head (a full scene is
     not a single-garment embedding), and it ships only image **signatures → Pinterest URLs** (no pixels, link-rot).
     So it is at best a loose **(domain + task)** upper bound. **Build it only if** a resolvable-yield check clears
     a pre-set threshold (pin at C5); else drop it — it never gates. If built, **reconstruct same-fine-category
     negatives** to match the Polyvore protocol (with a STL/CTL-21 → 5-type map) or the drop is negative-difficulty-
     confounded, and crop the scene to the garment (which removes the in-the-wild advantage — disclose the tension).

**(2) Corroboration — a single-wardrobe hand-labeled closet probe (no CV).** Real phone photos of Brian's own
worn outfits (the genuine target distribution that public data cannot reach). Hand-label `clothingType` + fine
category (trivial — the owner knows their clothes; **no CV pipeline** — `clothing_cv.py` does not exist and
`CV_SERVICE_URL` has no default). Decompose worn outfits into co-worn **edges**; build **mechanical**
same-fine-category negatives (§4 — *not* hand-curated "looks incompatible," which removes the hard near-
compatible negatives and inflates closet AUC, shrinking the very drop the probe measures); embed with
FashionSigLIP; compute **pair-level closet AUC + closet FITB**. The catalog→closet **drop = pair-level catalog
AUC − pair-level closet AUC** (catalog *minus* closet, so a **positive** drop = accuracy lost on the harder
real-photo domain; this is the sign gate C reads, "drop ≤ floor" §12) — **like-for-like** (the outfit-level
readout is never a term in the drop).
   - **Honest power (keep this rigor):** decomposing ~15–25 outfits into ≥50 edges buys **computability**, not
     power — the **effective sample size is the cluster count** (distinct worn outfits), not the edge count
     (edges from one outfit are near-perfectly correlated). Cluster-bootstrap at the **source-outfit** unit;
     report effective-N = #outfits. So the closet probe is **directional corroboration**, and a power-limited
     no-go is a likely, acceptable outcome.
   - **Label audit (a fix the existing spec lacked):** the single-annotator fine-category labels *drive* the
     same-category negatives, so a mislabel silently produces an easier/invalid negative on the load-bearing
     gate. Add a lightweight second-pass label audit on a sample + a check that **any fine-category used for a
     negative has ≥ N members.** For FITB distractor scarcity, broaden to coarse 5-type then drop the slot; the
     broadened questions are no longer cleanly 25%-chance, so **report the same-fine-category-only subset
     separately.** **This whole closet definition — labels + mechanical negatives + the audit — is `closet_manifest.json`,
     frozen at C2 before any test-metric unlock (§12), so gate C's hard dataset cannot be selected after A/B/D are seen.**

**(3) A second wardrobe is a genuinely-optional stretch** — justified by **`dress`-type coverage** (absent from
a male-only closet) and external validity, **not power** (the marginal CI gain is only ~√2). **Do not pre-build**
the per-wardrobe descriptive-vs-pooled forking-path apparatus, the cross-wardrobe-negative prohibition, or the
gender-confound machinery unless a second wardrobe actually materializes. Single-wardrobe is the baseline
deliverable.

**Popli framing (corrected — verified to the digit, arXiv:2206.05982).** The often-cited 0.52–0.66 figures are
**weak self-supervised pretext-task baselines**, **not** "naive transfer barely beats
chance." Popli's own method reaches **0.84 cross-dataset / 0.82 disjoint**, and **adversarial domain adaptation
adds only +1–3%**, with a supervised ceiling ~0.91. **The lever is "pick a fashion-domain
representation" (which we do — FashionSigLIP), NOT "add adversarial DA."** Popli's setup *is itself* a
domain-transfer study — it learns from **in-the-wild street photos** and transfers to **catalog** images
(Polyvore + Polyvore-D are the eval benchmarks, not a Polyvore→Polyvore-D transfer) — a real-photo→catalog gap
that is an even closer analog to our catalog→closet axis, i.e. direct precedent that this measurement is the
right shape.

---

## 11. Statistics

- **Pooled ROC-AUC** (§3), never per-outfit-averaged.
- **Cluster bootstrap** at the outfit/question unit (a positive and its one-slot-swapped negative, and edges
  from one outfit, are non-independent; resampling pooled scores independently understates the CI and defeats
  the near-gate rule). **Percentile** intervals (not BCa, which is unreliable at low cluster counts), **B = 10,000**
  (cheap over cached scores; the near-gate rule reads CI endpoints, so stable tail quantiles matter). The gate-B
  paired bootstrap should additionally **propagate the judge's temp-0 run-to-run variance** (resample the judge's
  per-question samples jointly with the cluster resample — a two-stage bootstrap — or add the judge run-spread as
  an explicit variance term), else the parity CI understates uncertainty.
- **Difference CIs built at the source of the difference:**
   - Gates **A** (trained − zero-shot floor) and **B** (trained − judge FITB) use a **paired** cluster bootstrap
     — each replicate resamples the **shared** clusters once and scores **both** models on it, then differences
     (they score the *same* items → positively correlated; `Var(X−Y)=Var(X)+Var(Y)−2Cov(X,Y)`, Cov > 0, so
     pairing tightens the CI; an unpaired combine mis-states the width).
   - Gate **C** (catalog − closet drop) combines **two independent** cluster bootstraps (disjoint corpora, no
     shared sample) and is **dominated by the closet term** (the test-split catalog CI is tiny — that side is large-N).
- **One headline seed + a 3-seed robustness footnote** (seed variance ≪ cluster variance with a frozen
  backbone). No permutation p-value on top of the CI. *(The seed governs the negative draw + FITB distractors, so
  the 3 footnote seeds re-roll the whole negative set — pre-register them, and treat the footnote as the check on
  the "seed variance ≪ cluster variance" assertion, not an afterthought.)*
- **Family-wise control across the ablation suite.** The headline cell is one frozen point (§1), but the spike
  reports several CI-adjudicated *ablation* inferences — the shape difference (pairwise − item-level, §6), the
  fashion-fine-tuning delta (matched-base − FashionSigLIP, §5), and the modality gaps (§8). Pre-register a
  family-wise correction at C2 (Holm over the ablation family, or report each at a widened level) so the
  load-bearing "item-level falsified" seam claim is not a 1-in-20 false positive. The four **gates** (A/B/C/D) are
  the decision and are scoped out of this family.

---

## 12. Go/no-go gates, near-gate rule, no-go deliverable

**One mechanical AND-gate** in `evaluate.py` reading `metrics.json` (single source of truth; `results.md`
restates it). `evaluate.py` **refuses to emit or read any held-out *test*-set metric (or any sealed valid-split
value) until `preregistration.md`, the C4 judge addendum (`judge_addendum.md`), and the frozen
`closet_manifest.json` (the gate-C dataset: included outfits, fine-category labels, inclusion/exclusion +
negative-construction + label-audit protocol) all exist on disk** — the build-order enforcement of §1's blindness
(C3 produces a mechanical valid-split selection only — `selection.json`: checkpoint id/config/hash/convergence,
**no metric values** — and `metrics.json` is materialized by `evaluate.py` only after the three unlock files
exist). Freezing
`closet_manifest.json` before the unlock stops gate C's hard dataset from being selected after A/B/D are seen
(local hand-labeling — no photos leave the machine, so it costs no third-party egress):

> **GO** iff **[A]** `CI_low(AUC_trained − AUC_zero-shot-cosine) > 0` (pair-level — training added value over the
> frozen backbone floor) **AND** **[B]** `CI_low(fitb_trained_gateB − fitb_judge_gateB) ≥ −δ` on the **powered Polyvore
> image-only set** (FITB **non-inferiority** vs the `gpt-5.4-mini` image-only judge — at parity or better; A/B
> paired; the closet gives non-Polyvore corroboration, **not** the gate input — §8) **AND** **[C]** the
> catalog→closet **pair-level AUC drop** `CI_high(AUC_catalog_pair − AUC_closet_pair) ≤ 0.12` **OR** the
> **absolute closet pair-level AUC** `CI_low(AUC_closet_pair) ≥ 0.70` (the §10 domain-gap gate; C unpaired; each
> disjunct read CI-wholly-on-the-pass-side per the near-gate rule below) **AND** **[D]** the **absolute accuracy
> floor (cost-independent): `CI_low(outfit_AUC_trained) ≥ 0.81` AND `CI_low(fitb_trained_full) ≥ 50%`** (outfit-level; the `outfit_auc`
> construction — positive vs same-fine-category-corrupted negative outfits, mean-edge score, source-outfit
> cluster — is in §4).

- **[D] is the comparability anchor that closes L1-02.** Relational gates A/B/C alone can pass a weak head that
  merely *ties a weak mini judge* (B) and beats its *own* zero-shot cosine (A); an absolute floor stops that.
  0.81 / 50% are the **disjoint** Vasileva 2018 anchors (untyped SiameseNet 0.81 AUC / 51.8% FITB — §6 band;
  verified against Table 5), so a head clearing D has demonstrably matched a 2018 typed-embedding baseline on the
  hard split. **D gates the outfit-level AUC** (comparable to the outfit-level literature anchors), not the
  pair-level gated unit; FITB@4 is unit-agnostic. **Comparability caveat:** 0.81/50% are full-Polyvore figures and
  this task excludes accessories — report the excluded item/edge share and treat 0.81 as **approximate /
  conservative**; the threshold does **not** move post-hoc (pre-registration), the imperfect comparability is
  disclosed. *(This re-promotes the floor an earlier v2 draft demoted to a non-gate readout — the demotion
  re-opened L1-02; the relational gates A/B/C stay, D is added alongside.)*
- **`FITB_trained` must resolve to two distinctly-named, separately-frozen subsets** so no gate reads an
  ambiguous `FITB_trained` — gate B is judge-cost-limited (the ~500 questions the judge also scores, for
  like-for-like parity) while gate D wants a held-out FITB comparable to the whole-test-set literature anchor.
  **This subset allocation is an open pre-registration decision settled in `fitb_manifest.json` at C2** — it freezes
  *before* any model number, so deferring it to C2 costs no rigor; only the *naming-must-be-distinct* invariant is
  firm now. **Recommended allocation (ratify at C2):** gate D = the **full held-out FITB manifest** (every
  eligible test outfit, one Q — maximal-N, directly comparable to Vasileva's 51.8%); gate B = a **C2-frozen,
  seed-ordered candidate list of up to ~500 questions**. **Resolving the C2-freeze-vs-C4-N tension:** the gate-B
  set is frozen at C2 as an *ordered* list, and the C4 pilot's only degree of freedom is the **prefix length** —
  N is the size of a **deterministic prefix** of that frozen order chosen to reach `HW ≤ δ` (the ~100-Q pilot is
  itself the first prefix of the same order), never a post-hoc re-selection of *which* questions. If the full
  ~500 list still has `HW > δ`, gate B is underpowered → no-go (below). So "test-N moves" means "the prefix
  grows within a C2-frozen ordered set," not "the set is unfrozen at C4." Whichever allocation is chosen,
  `metrics.json` names the two reads distinctly (e.g. `fitb_trained_full` / `fitb_trained_gateB`).
- **δ is pre-committed at C2 on substantive grounds — δ = 5 FITB points** (a 5-point FITB gap is the
  practically-meaningful parity threshold; the disjoint SiameseNet→OutfitTransformer field spans only ~8 FITB
  points, so 5 is already loose, and a tighter δ is not resolvable at feasible N). **Only test-N moves** (as a
  prefix length over the C2-frozen seed-ordered gate-B list, above) to reach
  `HW ≤ δ` against the C4 pilot's observed per-question discordance; **δ itself never moves** (re-fitting δ to the
  achievable noise floor is a forking path). If N is capped (~500) and `HW > δ` still, **gate B = "underpowered /
  inconclusive" → no-go** for the one-way-door dive (never widen δ). One-sided by design — a head that *beats* the
  judge still passes. *(Pre-commit **one FITB question per distinct outfit** on the gate-B set so effective-N = N.)*
- **Gate B note — same model, different modality:** B compares the trained head against `gpt-5.4-mini` in the
  **image-only** arm; **production runs text-attribute, not image** (§8), so B is a same-model / different-modality
  parity test (image-only is the deliberate memorization control + modality-match to the head, §8), not a
  production-config replica.

**Near-gate rule — stated once, here, as a single uniform principle** (the existing spec restated it across
five homes and the conjunct/disjunct logic broke three times): **read every gate off its 95% CI; the conjuncts
(A, B, D) each pass only if their CI is wholly on the pass side (a straddle → fail — and gate B additionally fails
as "underpowered" if its half-width exceeds δ); the gate-C disjunction passes if *either* disjunct's CI is wholly
on the pass side.** `evaluate.py` is the single implementation. *(The gates are
deliberately conservative — a power-limited no-go is the likely, acceptable outcome; conservatism is the
portfolio credibility, and the only legitimate lever on a wide CI is **power**, never gate slack.)*

**No-go ships.** `results.md` leads with methodology + the cost/determinism/offline parity story + the measured
catalog→in-the-wild drop + the **seam-shape verdict** (the §6 pairwise-vs-item-level ablation — pairwise-edge adopted; item-level falsified iff `CI_low(pairwise − item-level) > 0`, the literature-grounded expectation),
with the mechanical go/no-go printed by `evaluate.py` and merely restated. A no-go reads as "the trained content
prior does not reach honest parity / does not transfer the domain gap" — a measured negative + cost table + seam
decision, **never** "I proved I can't do it."

---

## 13. Forward seam constraints (M6 / H28)

Three constraints H26 locks on the post-H26/pre-M5 scorer seam (informs, lands no code):

1. **Shape:** a **pairwise, type-conditioned edge head** `score(item_i, item_j, type_pair) → float` with
   mean (or, later, attention) aggregation, landing as an **additive, default-None pairwise/outfit-level hook on
   `rank()`/`RankerContext`** — a **second, distinct seam** from the item-level `score(item, context) → float`
   sampler slot (`sampler.py:108`), which is **kept** for the behavioral/personalization shortlisting arm
   (canonical §23-H28: "distinct from the item-level sampler slot"). H26's §6 ablation **tests** the
   **per-item-scalar shape for *content* compatibility** (literature-grounded expectation: it is falsified) —
   motivating the pairwise ranker hook — it does **not** remove the sampler seam. (Additive ≠ reopening M3 behavior.)
2. **Cold-start-available:** the universal content prior must work at **zero user interactions** (its whole
   purpose), so it is **exempt from the sampler's `interaction_count ≥ MIN_SIGNAL_THRESHOLD` gate**
   (`sampler.py:251`) and lands on the **ungated ranker/content-scoring surface**, never the interaction-gated
   sampler signal slot (spec §11, already reconciled).
3. **Lens/context input reserved:** the spike's edge head is **context-free** (clean floor comparison), but the
   seam INPUT is **partial-outfit + candidate + lens/context** (the spec §6.3 `RequestContext`: occasion verbatim,
   weather bucket `hot|mild|cold|indoor|outdoor`, routine) so an M6 lens-conditioned head can add a conditioning
   vector later **without re-opening the seam shape.** Context is not baked into the frozen headline; the
   interface must not preclude it.

---

## 14. Privacy / consent (closet photos)

The closet vision arm sends real garment photos to third-party vision APIs (the `gpt-5.4-mini` memorization
control, and — if it scores the closet slice — the §8 cross-family secondary judge, e.g. Claude or Gemini).
Required: **explicit per-owner consent for third-party-API processing** (not just local use; enumerating every
provider the photos reach); a committed
**closet manifest** (item IDs, `clothingType` + fine-category labels, outfit membership, photo **paths +
content hashes** — tamper-evident, `closet_manifest.json`; **frozen at C2 before any test-metric unlock (§12)** —
necessarily before the head ever scores it) while the **photos themselves stay
gitignored**; **anonymized opaque owner IDs** + relative paths; **faces + people blurred** (or cropped out only
where that does not lose the garment's on-body context, plus any identifying PII) **but the garment kept in its
real on-body / as-photographed context** (clutter, lighting,
on-hanger, laid-out) — do **not** crop to a clean garment-only cutout, re-shoot, or clean them into flat-lays,
which would erase the very catalog→real domain gap the probe measures.

---

## 15. Build ladder, files, risks

**Build ladder (light build-and-audit loop per checkpoint: read real files, implement, `pytest` + lint on
touched files, one fresh-context review agent, fix verified findings, close; C6 gets the heavier review pass).**

- **C1 — Scaffold + data loader.** Package skeleton, isolated `requirements.txt`, `.gitignore`, README skeleton;
  `data_loader.py` (Polyvore-D verbatim, counts **printed at load**, 5-type mapping excluding accessories,
  pair-level AUC pairs + FITB@4 with §4 negatives **parameterized by a seed** — tests use a fixture seed; the
  **frozen** seed + the committed `fitb_manifest.json` (eligibility, held-out-item rule, distractor rule, the
  gate-B vs gate-D subset allocation — §12) are generated at **C2**, §1; **outfit-level positive/negative pairs
  for the gate-D AUC — each positive *held-out test* outfit + one test-scoped same-fine-category-corrupted negative, §4**); `tests/test_data_loader.py`
  (same-fine-category 1:1; pair-level `b′` never co-occurs with anchor `a`; FITB 1-positive + 3-same-category
  **each non-co-occurring with every retained partial-outfit item** (§4 multi-anchor rule);
  **each outfit-level negative preserves its positive's category multiset and shares no co-worn item with it**;
  valid/train/test pools never cross-leak; mapping drops non-clothing). Commit `preregistration.md` **skeleton**.
- **C2 — Embeddings + metrics + FREEZE.** `embed.py` (FashionSigLIP frozen + ablation backbones incl. the
  matched WebLI SigLIP ViT-B/16 base, cached); `metrics.py` (pooled pair-level AUC, **outfit-level AUC
  (mean-edge score, source-outfit cluster — the gate-D input, §4)**, FITB@4, cluster bootstrap);
  `tests/test_metrics.py` (known-answer fixtures + co-occurrence-is-chance + item-popularity sanity +
  paired-vs-independent-bootstrap shape). **Freeze `preregistration.md`** — the §1 headline cell **+ the §12 gate
  block (A/B/C/D thresholds; δ = 5; gate-C 0.70 / 0.12; gate-D reads the §4 outfit-AUC construction) + the frozen
  analyst choices** (head architecture + symmetrization + type-pair embedding, **the item-level ablation head +
  its ±5 % capacity-match rule (§6)**, optimizer/grid/epochs/early-stopping/Torch-determinism, the family-wise
  correction §11, the **pinned HF model revision SHA + preprocessing hash + dependency lock**, the calibration-set
  spec, **the `fitb_manifest.json` (eligibility, held-out-item rule, distractor rule, seed, and the gate-B
  vs gate-D subset allocation — the gate-B side as a **seed-ordered candidate list**, prefix-selected at C4, §12), and the frozen pre-registered popularity-confound response (§4)**) — all before any model number.
  **`closet_manifest.json` (the §10/§14 labels + negatives + label-audit protocol — local hand-labeling, no
  photo egress) freezes here too — unconditionally, before any test-metric unlock (§12):** the closet transfer
  probe is in the **minimal headline path** (§15) and **gate C is a hard gate**, so the manifest is a mandatory
  C2 artifact, not a conditional one. (The only path with no closet manifest is the dataset-access-denied
  "blocked — no disjoint headline" degenerate, where **no** gates run at all — §15 risks.)
- **C3 — Baselines + trained head + eval driver.** `baselines.py` (zero-shot cosine floor; co-occurrence sanity
  assertion); `train_head.py` (pairwise-edge head, type conditioning, BCE, valid-selected; **the capacity-matched
  item-level ablation arm**, §6); `evaluate.py` (metric-computation half). **Valid-split selection is mechanical
  (argmax over the frozen grid); C3 writes `selection.json` only — checkpoint id + config + checkpoint hash + a
  convergence/early-stop indicator, *no metric values* — and the valid-split *and* held-out *test*-set metric
  values (gate-D outfit-AUC, gate-A/B pair-level + FITB) are never materialized to `metrics.json` until the C4
  unlock (the §1 blindness guard): no human-visible model number exists at C3 to tune the judge against.**
- **C4 — LLM-as-judge.** `gpt_judge.py` (`gpt-5.4-mini` dated snapshot; **native FITB@4**, both orders,
  consistent-only; image-only / image+title / text-attribute arms; the determinism envelope + logprob
  escape-hatch; **a live API smoke test *re-checking whether image logprobs are available* (§8 verified them
  unavailable at spike-design time; take the logprob escape-hatch only if this re-check finds support) +
  Chat-Completions vs Responses params — the accepted-temperature question is already settled: gpt-5.4-mini takes
  any temperature (smoke-tested 2026-06-28), judge pinned at temp 0**). ~100-Q pilot → powered ~500 if justified. Cost/latency
  table. **Freeze the C4 judge addendum — committed as `judge_addendum.md` with these fields: prompt + prompt hash,
  dated model snapshot, calibration-set manifest + hash, temperature 0 + K-sample rule, both-order policy,
  `max_tokens`, retry/drop policy, payload-logging policy, commit hash — on a calibration set
  disjoint from the gate-B 500 and blind to every trained-head metric (§1). **Order (blindness-critical):** the
  addendum is fixed from the **judge-only** calibration pilot (position-flip + verdict-agreement → the K-sample
  rule + envelope, never the trained head's numbers) and **committed before any gate-B `fitb_trained −
  fitb_judge` comparison is computed**; after the freeze the only post-hoc freedom is the deterministic **prefix
  length N** over the C2-frozen ordered gate-B list (§12), chosen to reach `HW ≤ δ` — never a re-selection of
  questions or a re-tuning of the judge. `evaluate.py` **materializes
  `metrics.json`** (the sealed valid-split values + held-out *test*-set metrics) only once all three of §12's
  unlock files (`preregistration.md` + `judge_addendum.md` + `closet_manifest.json`) are committed** (§1/§12).
- **C5 — Domain gap.** `domain_probe.py` scores the closet from the **already-frozen `closet_manifest.json`** (its
  labels + mechanical negatives + label-audit froze at C2, before the test-metric unlock — §12; only the
  *scoring* runs here): worn outfits → edges; pair-level closet AUC + FITB; catalog→closet drop,
  cluster-bootstrapped (all local FashionSigLIP — gate C needs no third-party API). `stl_ctl_probe.py`
  (Pinterest STL/CTL fetch + **resolvable-yield check**; pair-level scene↔product drop) is the optional
  task-shifted supplement. Run the **optional** GPT closet memorization-control slice. **Precondition (before any
  closet photo leaves for a third-party API): the §14 consent + face/PII redaction are in place** (the manifest
  itself already froze at C2 — local labeling, no egress).
- **C6 — Report + mechanical gate.** Extend `evaluate.py` (gate-application half + the one near-gate rule);
  write `results.md`. **Sub-milestone boundary — heavier review pass** on every `results.md` claim vs
  `metrics.json` before declaring done.

**Files** (all new, under `ml-system/experiments/h26/`; touches no existing code): `README.md`,
`requirements.txt` (isolated), `preregistration.md`, `data_loader.py`, `embed.py`, `embedding_manifest.json`
(the C2 embedding-cache freeze: item order, image hashes, cache hash/path, embedding dim + dtype, normalization,
backbone revision SHA, preprocessing hash — §5), `metrics.py`, `baselines.py`,
`train_head.py`, `gpt_judge.py` (smaller — drops the per-edge continuous-score Monte-Carlo AUC, but keeps the per-question temp-0 sample-and-vote + both-orders), `judge_addendum.md` (the C4 freeze:
judge prompt + prompt hash, dated model snapshot, calibration-set manifest + hash, temperature 0 + K-sample rule,
both-order policy, `max_tokens`, retry/drop policy, payload-logging policy, commit hash — `evaluate.py`'s
test-metric unlock reads it), `judge_runs.ndjson` (the raw judge ledger — one row per question × order × sample:
parsed choice, consistency flag, retry/drop status, model snapshot, `system_fingerprint`, payload-log hash; the
multi-run distribution + two-stage bootstrap read it; raw payloads stay gitignored, §8/§14), `fitb_manifest.json` (the C2 freeze: eligibility, held-out-item rule, distractor
rule, seed, gate-B vs gate-D subset allocation — §12), `stl_ctl_probe.py`, `domain_probe.py`,
`evaluate.py`, `selection.json` (the C3 sealed-selection artifact: checkpoint id/config/hash/convergence, **no
metric values** — §1/§12), `results.md`, `metrics.json` (materialized only at the C4 unlock; + a committed
`metrics.schema.json` — the gate authority needs a schema), `closet_manifest.json` (the §10/§14 manifest, frozen at C2 before the test-metric unlock: item ids,
`clothingType` + fine-category labels, outfit membership, the mechanical-negative + label-audit protocol, photo
paths + content hashes; photos stay gitignored), `tests/`, `.gitignore`. **Frozen — not touched:** all
`fitted_core/`, `ml-system/tests/`, `outfit_recommender.py`, the root `requirements.txt`, everything under
`fitted/`. Test floors unaffected (no core change): **≥715 pytest / ≥366 jest** (751 / 375 today).

**Risks / open questions (settle against measurement, not opinion):**
- Internal valid-vs-test split of the 15,145 non-train outfits — read off the shipped JSON at load.
- `gpt-5.4-mini` exact dated snapshot + confirm it is still what the app serves at spike time.
- FashionSigLIP emitted embedding dim + open_clip-vs-transformers load path — verify at C2 before fixing head
  shape.
- δ is **frozen at C2** (= 5 FITB pts, §12); only the pilot's **N** moves to reach `HW ≤ δ`, never δ — if N caps
  at ~500 and `HW > δ`, gate B is **underpowered → no-go**.
- STL/CTL is **optional + non-gating** (§10): measure resolvable yield first; if below the C5 threshold, **drop it**
  (the closet is the gate-C input regardless).
- **Dataset access:** confirm the `mvasil` gating form early. **A denial = no item-disjoint headline corpus** (the
  ungated Marqo mirror has no disjoint split) → the spike degrades to a **mirror-only methodology artifact,
  mechanically labeled "blocked — no disjoint headline"** in `results.md`; never let a mirror number masquerade as the
  disjoint result.
- **Polyvore negative scarcity:** after accessory-exclusion + same-fine-category + anchor-no-cooccurrence filtering, a
  rare fine-category may lack an eligible negative/distractor — **drop that edge/slot + report the count** (unlikely at
  175k items, but pin the rule; never broaden to coarse type on the AUC set — that re-introduces a category-leaking
  easier negative).
- **Test isolation:** `experiments/h26/tests/` must not leak into the root pytest collection (pin the collection
  scope); H26's isolated deps are not added to the root `requirements.txt`.
- **Scope (ship the verdict):** the **minimal headline path** = FashionSigLIP + the pairwise head + **the
  capacity-matched item-level-vs-pairwise shape ablation (§6 — it settles the H28 seam shape, one of H26's three
  pre-registered deliverables per §0, and canonical §20/§23-H28 require it; not optional)** + the image-only judge
  + the closet transfer probe → gates A/B/C/D. The **backbone** ablation (matched-base fine-tuning delta, §5),
  STL/CTL, the cross-family secondary judge, and a 2nd wardrobe are **stretch** — build them only if the headline
  path ships first.
- **`results.md` framing (keep):** the benchmark measures **co-worn-ness, a proxy** for compatibility (positives are
  co-worn pairs; the mechanical negatives are not-co-worn, *not* human-judged "incompatible") — frame results as a
  co-worn proxy; the judge's "errors" include genuinely-compatible-but-never-co-worn pairs.
