# H26 Compatibility Spike — Build Doc (v2)

> **Status: Canonical build doc** (finalized 2026-06-28). The canonical pointers (`CLAUDE.md`,
> `docs/Fitted_Spec_v2.md` §20 / §23-H26 / §23-H28, `docs/README.md`) resolve here. The **benchmark definition
> is finalized**; the headline cell (§1) + the three-decision-gate block (§12, A/B/D; the catalog→closet transfer is reported, not gated) — plus the enumerated C2 ratifications
> (artifact format §1, the §4 popularity-confound response, the §12 FITB allocation) — **freeze verbatim into
> `preregistration.md` at C2, before any model number.**
>
> **Production-stylist context (load-bearing for the judge baseline, §8):** the stylist is `gpt-5.4-mini`, an
> OpenAI **mini-tier** model on **text attributes only** (`imageUrl` stripped — spec §12 / §23-H33;
> `recommend/route.ts:450`, `regenerate/route.ts:461`). The H26 judge baseline mirrors it — a mini judge
> hardens the cost bar (§8).
>
> **Build progress (2026-07-01):** **C1–C4 code committed; RUN phase in progress.** C1–C3 = data layer
> (§C1), the C2 pre-registration freeze, C3 baselines + both trained heads + the eval-driver **metric half** +
> the materialized gate-B `fitb_order.json`. **C4 (committed)** = `gpt_judge.py` (native FITB@4 judge, both
> orders, K-sample plurality vote, three arms, scalar-only `judge_runs.ndjson` ledger, two-stage paired
> bootstrap; OpenAI mocked in the hermetic suite), `evaluate.py`'s **emission half** (the four-file unlock
> validator + first `metrics.json`), `judge_addendum.schema.json` + the **scaffold** `judge_addendum.md`,
> the RUN-phase operator tooling (`build_cache_and_select.py` / `live_content.py` / `make_calibration.py` /
> `run_judge.py` / `assemble_closet.py`), the §F panel calibration (`finalize_panel`, ≥3 labelers,
> inter-annotator agreement) with the coherence draw filter (`coherence.py`) + visual-QC exclude list, and
> the §C.8 eval coherence-sensitivity (reported-never-gating). Hermetic suite **244 green / 1 skipped**
> (the opt-in live-judge smoke — a floor, not a pin). **B2 is DONE:** the embedding cache is built (83,178
> scorable ids) and `selection.json` is sealed + committed (winner `grid_0`; `converged:false` at epoch
> 48/50 — if gate D later misses, the frozen epoch budget is the first suspect, and bumping it is a
> pre-registration decision). **`metrics.json` is NOT emitted** — the RUN continues: the 100-question panel
> viewer is generated (local artifact) → Brian's ≥3-person panel labels it → `finalize_panel` →
> `calibration_set.json` committed → the calibration pilot (B1: Brian's key, his shell) → freeze
> `judge_addendum.md` (blind, before any gate-B comparison) → gate-b → `emit` (also needs **B3**
> `closet_manifest.json`, deferred by choice). Then **C5**. Per-checkpoint state is in §15.

---

## 0. Frame & thesis

H26 is an **offline, zero-user, public-corpus content-compatibility experiment**. It answers three
pre-registered questions and ships a portfolio artifact regardless of how they resolve:

1. **Sharpest demonstrable ML result.** A rigorous, reproducible compatibility benchmark on a public corpus —
   the zero-user fork's strongest standalone ML deliverable.
2. **M6 go/no-go.** Should we train the production compatibility scorer? Decided **mechanically** against
   pre-registered gates (§12), not by eyeball.
3. **H28 seam shape.** Item-level vs pairwise-edge vs whole-outfit-attention — **tested on our own data** by a
   light in-spike ablation (§6) to *corroborate* (not merely assume) the literature-unanimous pairwise choice.
   The pairwise headline is adopted on the literature's strength; the ablation reports whether our data
   independently falsifies the item-level shape, and is honest when it cannot at this power (§6/§12).

**The thesis is a systems decision, not a quality contest — _when does a tiny specialized model beat a per-edge
LLM call?_** `gpt-5.4-mini` is the production stylist, so a **cost-alone** win is fragile (the next price cut
erases it) and arguably already thin, and quality-*superiority* over a capable mini judge is explicitly not the
claim. The real question H26 answers is an engineering one: at **per-edge serving volume** (the dense style
graph, §13), is a trained content prior the right tool over a per-edge LLM call? The durable, price-cut-proof
wins that make the answer "yes" are **(a) bit-determinism, (b) zero serving-time API dependency, (c) availability
at per-edge serving volume where an LLM call per edge is economically/latency-infeasible (§9), and (d) a native
per-edge signal the style graph (§13) is built on.** The benchmark's role is to show the cheap option is *good
enough* — that the prior reaches **honest FITB parity with the LLM judge on the same task** (gate B, §12) — so the
decision turns on those four properties, not on accuracy. **The §9 cost/latency/determinism/availability table is
the headline artifact; the AUC/FITB parity number is the evidence the cheap option clears the bar, not the lede.**

**A no-go ships as a complete result.** The deliverable is **decoupled from the verdict**: the methodology, the
measured catalog→in-the-wild domain-gap drop, the cost/determinism table, and the settled seam shape all land
either way. `results.md` leads with the **systems-decision framing + the §9 cost/determinism/availability table**,
then the parity evidence + the drop; the gate verdict is an internal M6 decision printed by `evaluate.py`. A
no-go reads as a **clean engineering verdict** — "the LLM is meaningfully better on the hard split, so the trained
scorer isn't worth M6 yet" — **never** "I proved I can't do it."

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
carry a machine-readable form `evaluate.py` parses directly**: the C2-frozen sidecar
`preregistration.json`. `judge_addendum.md`'s determinism envelope gets the same treatment at C4;
`fitb_manifest.json` / `closet_manifest.json` / `metrics.schema.json` are already JSON. The C4
unlock is **not** mere existence: `evaluate.py` validates the unlock files (including `.md`/`.json`
prereg agreement and `closet_manifest.json` against `closet_manifest.schema.json`), binds the sealed
C3 `selection.json`, and records git blob hashes / sha256s before emitting sealed metrics (§12/§15).

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
| Metrics | **pooled pair-level ROC-AUC** (gate A + the reported catalog→closet transfer, §10/§12) + **outfit-level ROC-AUC** (gate D; §3/§4) + **FITB@4** (hit@1; gate-B + gate-D subsets, §12) |
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
validated against `selection.schema.json`, **no metric values of any split** — and the valid- and test-split metric *values* are **never materialized to the
committed `metrics.json`** until `evaluate.py` validates and records all four unlock files (C4); there is no
human-readable metric file before C4. `evaluate.py` refuses to emit any sealed metric unless `preregistration.md`,
`preregistration.json`, `judge_addendum.md`, **and** the frozen, schema-valid `closet_manifest.json` validate and have their hashes recorded
(including C4 referential checks that every outfit item id is declared and every `polyvore_category_id` exists in
`closet_category_reference.json`; §15 C3/C4, §12).
Everything else freezes at C2, before any model number exists.

**The go/no-go is one mechanical AND-gate** in `evaluate.py` reading `metrics.json` (§12). **Its three decision
gates + frozen thresholds — A added-value > 0 · B FITB non-inferiority δ = 5 pts · D absolute floor (outfit
AUC ≥ 0.81 ∧ FITB ≥ 50%) — are the second committed block of `preregistration.md`, frozen at C2 with the headline
cell above.** The **catalog→closet transfer (the former gate C) is measured-and-reported, not a decision gate**
(§10/§12): a single-wardrobe closet is too underpowered to *veto* on — a ~15–25-cluster CI would straddle,
forcing a no-go for a **power** reason, not a model reason — so its drop + CI are reported descriptively and it
becomes an explicit **M6 re-measure entry condition** on real-ingestion data (the W-track), never an H26 gate.
`results.md` only restates the gate block.

---

## 2. Dataset & split

**Headline = Polyvore Outfits-D, purged to strict item-disjoint.** Item-level disjointness is the only Polyvore
variant that blocks the scorer from winning by **memorizing items**, so its AUC/FITB is an honest
*generalization* number — the correct cold-start analog. *(The shipped `disjoint/` files are only
**near**-disjoint; the headline purges the residual test leak to make this literally true — see the disjointness
caveat below.)*

- **Counts (measured off the shipped JSON at C1):** train **16,995** / valid **3,000** / test **15,145** outfits
  (**35,140** total; 251,008 items in the metadata pool). Valid and test arrive **pre-separated** in the shipped
  `disjoint/` files — there is **no** internal valid-vs-test re-derivation. *(The paper's prose "16,995 … for
  training and 15,145 for testing and validation" counts the **test** set only; the shipped release adds a
  separate 3,000-outfit valid — the shipped data is authoritative.)* **C1 prints the actual raw / post-filter /
  dropped counts at load** — the spec never asserts a corpus size in prose (a wrong headline-dataset count is a
  cheap credibility nick).
- **Non-disjoint variant** (68,306 outfits / 365,054 items, Vasileva 2018) is computed **once as a
  ceiling/sanity readout only** — items recur across splits, so it is the easy regime, never the gate.
- **Disjointness caveat (keep):** item-disjoint ≠ *visual*-disjoint — near-duplicate product photos and brand
  co-occurrence still bleed. Report it as "the strongest publicly-shipped split," not "leakage-free."
- **Shipped-split item leakage (measured at C1) + purge:** the shipped `disjoint/` files are only **near**-disjoint
  — the gated **test** set shares **84 items / 47 outfits (0.12%)** with train, and **valid** shares **25.8%** of
  its items with train. The headline runs `load_corpus(strict_disjoint=True)`, which **purges the 47
  train-overlapping test outfits** (15,145 → **15,098**) so the reported test set is **literally item-disjoint**.
  Valid's overlap is **disclosed, not purged** — valid is sealed-checkpoint-selection only, never the reported
  number. The purge freezes in the C2 pre-registration.
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

**Image source (verified at C1 — read before C2 `embed.py`).** The gated `mvasil/polyvore-outfits` HF repo ships
**no loose `{item_id}.jpg` files**; the images are **embedded in the parquet configs** (`config="disjoint"` /
`"nondisjoint"`, an `image` column of JPEG bytes keyed by `item_id`; ~4.3 GB whole repo, ~1.5 GB for the
`disjoint` config C2 needs). The C1 loader reads only the loose `disjoint/*.json` (outfit structure — no images,
correct, C1 doesn't embed). **C2 `embed.py` must source images from the parquet**
(`load_dataset("mvasil/polyvore-outfits", "disjoint")` → per-item `item_id` + image bytes), **not** from an
`images/` directory. **Split-name note:** the parquet split is `validation` (HF convention), not C1's `valid` —
C2 maps it. The disjoint parquet item-splits (train 71,967 / `validation` 14,657 / test 70,035) match C1's
measured per-split distinct-item counts, so every disjoint-outfit item has its image; C2 should still **assert
per-`item_id` resolution** at embed time (count-match ≠ id-match) and fail loud on a miss. (Earlier confusion —
"images missing" — was the loose-file view; access via the parquet is complete.)

---

## 3. Metrics

**The frozen metric set is three outputs: pooled pair-level (edge) ROC-AUC (gate A + the reported catalog→closet transfer, §10), outfit-level ROC-AUC (gate D; defined below, §4/§6), and FITB@4 (gate B + gate D).** Taking the pair-level edge AUC first: AUC = the Mann-Whitney U statistic =
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
**pair-level** unit is what gates **A** (added-value) and feeds the **reported** catalog→closet domain-gap drop
(§10/§12 — measured, not gated), so the drop stays pair-level on **every** side (§10) — like-for-like, no unit
mismatch. This collapses the existing spec's three-AUC-flavor surface (outfit-level headline + pair-level drop
reference + GPT-restricted pair-level) into **one pair-level unit (gate A + the reported transfer) + one
outfit-level unit (gate D + the band)**, killing the unit-mismatch trap at its source rather than guarding it in
five places.

**The harness's own metric code is unit-tested** (a wrong metric silently corrupts the whole result — the trust
floor): pooled AUC = 1.0 on perfect separation / ≈0.5 on random; FITB picks the known winner and an all-tied
question scores exactly 0.25; the co-occurrence-is-chance assertion (§4) holds to 0.50 / 0.25 at **both** the
pair-level **and** the outfit-level `outfit_auc` (a category-multiset-only score ≈ 0.50 on the corrupted-outfit
negatives — gate D reads `outfit_auc`, so its leak detector is load-bearing too); cluster-bootstrap
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
- **5-value type space.** Apply the Polyvore-fine-category → 5-value `clothingType`
  (`top` / `bottom` / `dress` / `outer_layer` / `shoes`; the canonical enum, `fitted/lib/clothingType.ts`)
  mapping, **excluding** (a) non-garment accessories (bags/jewellery/sunglasses/hats/scarves/accessories),
  (b) swimwear, (c) sleepwear/loungewear sleep-garments, and (d) lingerie/intimates + underwear — so the type
  space matches the production 5-type wardrobe. (Boundary cases kept by design: slippers → shoes — footwear, not
  sleepwear; sports bra → top — athleisure upper garment. Each row carries an `excluded_reason`; the carve-out
  policy + the production-divergence note for ambiguous layering knits, e.g. cardigan, live in `type_map.json`'s
  `_policy`.) **The mapping is an enumerated committed artifact — `type_map.json`, one row per
  Polyvore fine category → {5-type | excluded} — authored at C1 and frozen in the C2 pre-registration (§15)**
  (asserting "frozen" without a concrete table is the drift this single-home rule kills). Outfits left with
  **< 2 clothing items** after the exclusion have no edge → **dropped** (dropped count reported). The **excluded
  item/edge share is reported** (the literature anchors are full-Polyvore figures, so the filtered task's
  comparability is disclosed, not hidden — measured at C1: ~45% of item slots).

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
Vasileva 2018 Table 5's protocol at C2. Our construction is same-fine-category replacement, matching Vasileva's
published protocol (quoted above); the **direction** of any residual incomparability vs the 0.81 anchor —
accessory-exclusion, our outfit-corruption rule, and whether a specific cited anchor used a different negative
protocol — is **not assumed conservative** and is pinned at the C2 confirmation (§12 gate-D caveat). Disclose the
gap; never relax the floor post-hoc.)*

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
**misses this**. **C2-frozen response:** keep the same-fine-category + anchor-no-cooccurrence protocol as
the frozen headline (it matches Vasileva's published protocol → comparable to the anchors), treat the
item-popularity-only baseline as a pre-registered diagnostic with blind margin **0.55 AUC**, and if edge
or outfit popularity AUC exceeds that margin, `results.md` labels the headline
**"popularity-confounded (disclosed)"** and reports a pre-specified **popularity-matched-negative
sensitivity re-run** — gate numbers don't move. The response is frozen at C2, never chosen after the
diagnostic. **The diagnostic + response extend to the gate-D outfit-level
negatives, not just edges/FITB:** full-item-replacement negatives (§4 above) preserve the category multiset but
draw uniformly-sampled (on-average less-popular) replacements for **every** slot, *amplifying* the same
item-popularity confound — so an embedding-mediated popularity signal could lift `outfit_auc` without compatibility
content. The item-popularity-only diagnostic and (if triggered) the popularity-matched-negative sensitivity re-run
therefore apply to the outfit-level negatives as well, frozen at C2 with the edge-level response. *(This is the
same de-confounding rigor §5 applies to the backbone — it must extend to the negatives.)*

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
- **Compute note (the "CPU-feasible" claim is about *serving*, not bring-up).** §9's "ViT-B/16, fast, CPU-
  feasible, ~ms per edge" is the **per-edge serving** latency the thesis rides on. The **one-time** embedding pass
  over the scorable disjoint-corpus items (83,178 ids in the built cache) is a separate up-front cost — a
  multi-hour CPU batch job (minutes on a commodity GPU / free Colab), run **once** and cached
  (`embedding_manifest_fashionsiglip.json`; config freezes at C2, cache-content hashes populate at C3, §15), not on the serving path. Budget it explicitly at C2 bring-up; it is a real
  schedule line for a solo fork, not a hidden free lunch.

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
`score(item_i, item_j, type_pair) → float` — the C2-frozen **2-layer MLP**
`Linear(3104,256) → GELU → Linear(256,1)` on `[emb_i ⊕ emb_j, |emb_i−emb_j|, emb_i*emb_j]`
plus a learned **15×32 unordered type-pair embedding** indexed by `{type_i, type_j}` over the
5-value space (incl. same-type). The edge is unordered, so the order-sensitive `emb_i ⊕ emb_j`
term is symmetrized by the frozen average **`score = ½[f(i,j)+f(j,i)]`**. **Outfit score = mean aggregation over edges;
FITB = the candidate maximizing mean edge-compat with the partial outfit.** Objective = pointwise **BCE** on
positive vs same-fine-category negative edges (margin-ranking BPR is an ablation-only rung, never the headline —
picking the better objective post-hoc is a forking path). Head hyperparameters / epochs / checkpoint are selected
on a **valid**-split AUC/FITB (built by the identical negative rules, valid-scoped pool) and frozen before any test
cell — the selection is **mechanical argmax over the frozen grid and its valid-metric values stay sealed until the
C4 judge addendum commits** (the §1 judge-blindness guard; no human-visible model number exists pre-C4). **Freeze in `preregistration.md` at C2:** the selection grid, optimizer, epoch budget, early-stopping rule,
tie-breaks, and Torch determinism flags (seed, `deterministic` algorithms); the trained head then ships as a
**committed artifact** — checkpoint hash + training config + manifest path (reproducibility).

**Seam verdict — adopted from the literature, corroborated (not settled) on our data.** Compatibility is **non-transitive** ("compatibility
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
parameters — §11/§12). **The ablation is a descriptive corroboration, not a powered decision:** unlike gate B it
carries **no pre-registered MDE / power target** (the published pairwise−item-level gap is small, and the §11
family-wise widening makes a wholly-above-0 CI a high bar), so its two honest outcomes are pre-stated — **(i)**
`CI_low(pairwise − item-level) > 0` → item-level is **independently falsified on our data**; **(ii)** otherwise →
the result is **"consistent with the literature, not independently decisive at this power,"** *never* evidence
item-level won. **Either way the pairwise-edge head is the frozen headline**, adopted on the literature's unanimity
(Vasileva / NGNN / OutfitTransformer); the ablation strengthens that claim under (i) and is reported honestly
under (ii) — it does not flip the headline. This keeps §0's deliverable at "tested on our own data," never the
stronger "settled empirically" the result cannot guarantee. **The
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
disjoint = arXiv:2204.04812 Tables 1–2. The 0.88 stretch ceiling is OutfitTransformer's **image+text** variant;
its **image-only** disjoint AUC is **0.87** — closer to the spike's image-only headline modality, though the band
is outfit-level/full-Polyvore and must not be cross-read against the gated image-only pair-level numbers either
way.)*

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
verdict needs a small fixed number of repeated samples + an aggregation rule. **The K×2 → per-question collapse
is structurally pinned now (only the value of K freezes at C4, from the calibration pilot's verdict-agreement rate — **choose K ≥ 2, prefer K = 3** if cost/latency allows; K = 1 makes the §11 two-stage judge-variance resample vacuous, so a K = 1 override forces `results.md` to drop every judge-run-variance / K-sample-stability claim):** within
each candidate order the K temp-0 samples reduce to that order's verdict by **plurality vote** (any tie for the
top vote count — including 3-/4-way ties, at any K, since FITB@4 is a 4-way choice → that order is "no-decision"); the question is a **hit** iff both orders' plurality verdicts agree *and* pick the
held-out item, a **miss** iff they agree on a wrong item, and **inconsistent** (→ counted as a miss in the
denominator, the position-bias rule below) iff the two orders disagree or either order is "no-decision."
`judge_runs.ndjson` logs one row per question × order × sample with `question_id` + `order` (§15), so the collapse
is reproducible from the ledger. This is **cheaper than the existing spec's per-edge
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
  subCategory, layerRole, colors, pattern, seasons, occasions, and `notes` if present — mirror those fields;
  `id`/`imageUrl` are omitted, no Polyvore analog.)* Reported for the cost story; flagged memorization-confounded
  on Polyvore.

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
~12 clusters; `system_fingerprint` can detect drift but cannot reproduce — **and, verified, `gpt-5.4-mini`
returned a *null* `system_fingerprint` on the 2026-06-28 smoke test, so it is logged opportunistically (may be
null) and is *not* the drift-detection mechanism; the multi-run distribution + the payload logs are**). So
**report the judge's FITB accuracy as a multi-run distribution (mean ±
spread), never a single reproducible point** — and claim the trained scorer's **bit-exact determinism as a
first-class win** alongside cost and offline operation, not a footnote. Pin the dated snapshot, `temperature=0`
(the model accepts any temperature — smoke-tested 2026-06-28), a fixed completion-token cap (**the SDK param is
`max_completion_tokens` — GPT-5.x rejects `max_tokens` with a hard 400; `reasoning_effort` is pinned `"none"` and
`detail:"low"` on every image part — all frozen in the addendum envelope, verified 2026-07-01**), structured
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
descriptively) and as the **catalog→closet transfer-probe input (former gate C, reported not gated — §12)**; the residual risk that the judge *recognizes* Polyvore
product photos even with titles stripped, if real, **advantages the judge** and so biases gate B
**conservatively against the trained head** — a pass is therefore credible, a fail partly confound-explained;
(c) the image+title ablation estimates the residual text-memorization lift. *(Note: the
often-cited "GPT-4V validated as a fashion judge" is Hirakawa et al., arXiv:2410.23730 — GPT-4V on aesthetic
*preference*, an easier task than pairwise compatibility; cite it as suggestive, not as validation of GPT for
this task.)*

**The human-agreement calibration set (defined here — the judge-selection target).** The judge prompt / K /
determinism envelope are tuned **solely** against this set (§1/§15-C4), so it must be pinned, not hand-waved.
Firm invariant (the manifest + hash freeze in `judge_addendum.md` at C4): a **small held-out set of pairwise/FITB
compatibility questions carrying an *actual human* compatibility label** — a **diverse human panel's** forced-choice
compatibility judgments on a sample — **disjoint from the gate-B 500 *and* the gate-D full FITB set** (so judge
tuning never touches a gated question), sized to a pre-set floor (pin at C4; e.g. ≥ ~50 questions). "Human-
agreement" means a human label **on purpose**: it is **not** Polyvore co-occurrence ground-truth (using
co-occurrence would re-import the memorization confound into the very calibration the blindness rests on). Its
**only** use is selecting the judge envelope to best match the human labels; it never scores the trained head.
*(Source corpus — Polyvore image-only items vs closet items — and the exact size are pinned at C4 with the
addendum; the human-label, disjoint-from-gated, and judge-only-use invariants are firm now and freeze in the C2
calibration-set spec, §15.)* **Diverse-panel labeling (amended 2026-07-01, pre-pilot — see preregistration.md §F
+ preregistration.json `calibration_set.amendment_2026_07_01`):** a diverse **≥3-person panel** each labels the
SAME questions and may **abstain** ("not sure" — never guess) on questions outside their competence; the consensus
label is the **unique plurality over confident votes** (kept only with ≥2 confident votes + no tie, else
dropped-and-counted). `results.md` reports **inter-annotator agreement** (average pairwise, abstention-robust —
Fleiss' κ is ill-defined under per-question skips) as the human-agreement ceiling, plus per-labeler skip rate +
the realized garment mix. Labeler ids in the committed `calibration_set.json` (e.g. `per_labeler_skip_rate`) are
**opaque** (`labeler_1`, `labeler_2`, …), mapped from renamed answer files — never real names/emails/initials —
and `finalize_panel` **fails loud on duplicate answer-file stems** (a dup would otherwise silently overwrite a
labeler in the sha-bound artifact). This **replaced** the original single-annotator spec (one owner's taste + an
intra-annotator stability check) to de-noise the judge-selection target on a women's-fashion-heavy corpus where a
lone non-expert labeler can't competently judge much of it; the claim becomes "tracks human consensus (measured
ceiling)," not one owner's taste. **Draw filters (amended 2026-07-01, pre-pilot — preregistration.md §F
amendment #2):** the calibration **draw** keeps only **5-type-coherent** questions (`coherence.py`: ≤1 item per
clothingType over retained + answer, never dress with top/bottom — ~13% of raw Polyvore FITB questions imply a
wear-impossible outfit humans balk at) and skips items on the committed **visual-QC exclude list**
(`calibration_visual_qc.json` — parquet images that contradict their declared garment, e.g. a car for
"trousers"). **The gate-B/gate-D eval sets are NOT filtered** — they stay the standard benchmark (anchor
comparability); `evaluate.py` reports the pre-registered **coherence-sliced sensitivity** instead
(preregistration.md §C.8, `metrics.json.coherence_sensitivity` — reported, never gating). The calibration claim
is therefore "human consensus **on coherent, wearable-outfit questions**."

**Judge-above-chance check (two distinct pilots — the calibration pilot is the precondition; the gate-B pilot prefix gates the scale-up).** "FITB parity vs the
judge" (gate B) is only *informative* if the judge is meaningfully **above chance** at image-based pairwise
compatibility (the §8 memorization note + the Hirakawa caveat both warn the image-only judge could be weak). The **calibration pilot** (`run_judge.py pilot`, **pre-freeze**, ~100 human-panel questions — its
`pilot_summary.correct_vs_polyvore` judge-vs-Polyvore readout fills the envelope's `above_chance_pilot` at freeze)
establishes the judge's image-only FITB is clearly > 25% chance (CI low above chance); the post-freeze
**gate-B pilot prefix** (first 100 of the frozen `fitb_order.json`, on gated benchmark questions) re-confirms above
chance and **gates the scale-up to ~500**. **This does not modify the frozen §12 A∧B∧D gate:** if the judge lands at/near
chance, gate B still computes and **passes trivially** (the trained head clears non-inferiority against a
chance-level judge by a wide margin), but the parity *claim* is **uninformative** — `results.md` reports it as
"gate B passed but vacuous (judge ≈ chance); the decision rests on A∧D." So the pilots' role is to *flag* a vacuous
B and *avoid spending* the ~500-question scale-up on it, never to drop a frozen gate.

**Powered sample, gate-B-prefix-gated.** The **gate-B pilot prefix** (first 100 of the frozen `fitb_order.json`)
runs first (commit its CIs + position-flip rate); scale to
~500 only if that prefix's CI half-width justifies it (§12's δ check).

---

## 9. Cost / latency / determinism / availability

**Reframe the thesis — the per-edge GPT number is a "why the seam needs a cheap scorer," not a deployed cost
being undercut.** Nobody deploys per-edge `gpt-5.4-mini` judging: scoring one recommendation means
`C(k,2)` edges × candidate completions × 2 orders → **hundreds-to-~1,000 LLM calls per recommendation** — online
infeasible on latency and rate limits regardless of price. So the trained prior's win is **enabling the per-edge
content-compatibility seam to exist at serving time at all** — cheap, deterministic, offline-trainable, no API
dependency — at **honest FITB parity** (gate B) with what the judge reaches on the same task. State this explicitly;
the existing "parity at a fraction of *deployed* per-edge GPT cost" is a strawman because per-edge GPT is never
deployed.

**What to measure.** The **offline experiment** cost (whole-outfit granularity, image `detail: "low"` —
**confirmed at C4 (2026-07-01): gpt-5.4-mini is patch-based — 32px patches, ~1,536-patch budget, ×1.62
mini multiplier → a 300×300 Polyvore image = 100 patches × 1.62 = ~162 tok/image at any detail setting** (the
old ~85 was a gpt-4o-era figure; `detail:"low"` is still pinned in the envelope because real closet photos at
high/auto balloon ~15× — C5); a gate-B question ≈ 6 images ≈ ~1.1k input tok/call → pilot ~100 Q ≈ $0.18–0.88
and gate-B 500 Q ≈ $0.88–4.42 across K∈{1..5}, **Batch API 50% off** all cells, **× the temp-0 per-question
sample count `K` × 2 candidate orders** per §8)
as **point estimates with the pricing source** — cost is
~deterministic (tokens × published price), so a bootstrap CI on it is theater; statistical machinery applies to
**accuracy only.** Report alongside: the trained head's per-edge inference latency (~ms, CPU), its
**bit-determinism**, and the **GPT judge's measured synchronous per-request latency** (don't assert
"online-infeasible on latency" without measuring it). Pin every price to the **production model's rate**: `gpt-5.4-mini` is **$0.75 / $4.50** per
1M input/output tokens (mid-2026; **Batch/Flex −50%**, **cached-input −90%** on the repeated prompt prefix) —
~3× cheaper than full `gpt-5.4` and the cheap tier the cost thesis rides on, but a **dated** figure (a newer
snapshot or a tier change moves it), so pin it at spike time.

**The centerpiece artifact — the comparison table `results.md` leads with** (the reframe's legible object;
trained prior vs per-edge `gpt-5.4-mini` judge, both on the same task). Pin its columns at C2 so the table is a
committed deliverable, not an afterthought:

| Property | Trained pairwise prior | Per-edge `gpt-5.4-mini` judge |
|---|---|---|
| **Accuracy (the bar, not the lede)** | FITB / AUC on the frozen cell (§3/§6) | image-only FITB (§8) — honest parity is the *floor*, gate B |
| **Cost** | ~0 marginal ($ per 1M edges ≈ electricity) | $0.75 / $4.50 per 1M tok × `K` samples × 2 orders × `C(k,2)` edges (§9 above) |
| **Latency** | ~ms per edge, CPU (measured) | measured synchronous per-request, ×`C(k,2)` per recommendation |
| **Determinism** | **bit-exact, reproducible** | not bit-reproducible even at temp 0 (§8), null `system_fingerprint` |
| **Per-edge serving availability** | yes — the O(n²) style graph (§13) is queryable at serving time | no — hundreds-to-~1,000 calls/recommendation is online-infeasible |

The fourth durable win — **(d) a native per-edge signal the style graph is built on** (§0/§13) — is a
*structural* property, not a measured column: it is what the "per-edge serving availability" row enables (the
graph substrate), stated in prose, not scored.

---

## 10. Domain-gap measurement (the load-bearing risk)

The spike's single most load-bearing risk: every cited Polyvore AUC/FITB is on **clean catalog flat-lays**, so
a strong disjoint number is an **upper bound** for messy real phone photos. **The go/no-go (A∧B∧D, §12) treats
catalog accuracy as necessary-not-sufficient; the catalog→closet transfer is *measured-and-reported, not a
decision gate*** (the former gate C — a single-wardrobe closet's effective-N cannot power a veto, §12 / tier (2)
below), **its drop + closet AUC reported descriptively against the reference band, and it becomes an explicit M6
re-measure entry condition on real-ingestion data (the W-track) before the trained scorer commits to
production.** Three tiers:

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
     a pre-set threshold (the **threshold freezes at C2** with the rest of the pre-registration; only the measured
     *yield* is computed at C5 — §15); else drop it — it never gates. If built, **reconstruct same-fine-category
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
real-photo domain; this is the sign the reported transfer is read against its band, "drop ≤ 0.12" §12) — **like-for-like** (the outfit-level
readout is never a term in the drop).
   - **Honest power (keep this rigor):** decomposing ~15–25 outfits into ≥50 edges buys **computability**, not
     power — the **effective sample size is the cluster count** (distinct worn outfits), not the edge count
     (edges from one outfit are near-perfectly correlated). Cluster-bootstrap at the **source-outfit** unit;
     report effective-N = #outfits. So the closet probe is **directional corroboration**, and a power-limited
     no-go is a likely, acceptable outcome.
   - **Label audit (a fix the existing spec lacked):** the single-annotator fine-category labels *drive* the
     same-category negatives, so a mislabel silently produces an easier/invalid negative on the load-bearing
     transfer measurement. Add a lightweight second-pass label audit on a sample + a check that **any fine-category
     used for a negative has ≥ N members.** Where a closet fine-category has too few non-co-occurring same-fine-
  category members to draw a valid §4 **AUC** negative, **drop that edge + report the count** (the §15 Polyvore
     scarcity rule). The frozen C2 Polyvore headline FITB gates use **skip-and-count only**; no coarse-5-type
     broadened question enters gates B or D, so every headline FITB question remains cleanly 25%-chance. Any later
     non-gating broadened diagnostic must be reported separately.
   - **Taxonomy match (transfer comparability — a fix this pass):** the catalog→closet drop is like-for-like
     **only if both sides draw same-fine-category negatives from the *same* fine-category taxonomy.** So the
     closet hand-labels must map onto the **same Polyvore fine-category tree** used for the catalog negatives — not
     a coarser ad-hoc personal taxonomy, which would make the closet's same-category negatives systematically
     easier/harder and **confound the very drop being measured.** Pin the closet→Polyvore fine-category mapping in
     `closet_manifest.json`; where the owner's wardrobe has no clean Polyvore-fine-category analog, record the
     coarsening and report those edges separately.
   - **This whole closet definition — labels + the Polyvore-fine-category mapping + mechanical negatives + the
     audit — is `closet_manifest.json`, frozen before the C4 test-metric unlock (§12) — not necessarily at the C2
     design-freeze commit (the labels do not exist until Brian labels his worn outfits), so the transfer probe's
     dataset cannot be selected after A/B/D are seen.**

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
  an explicit variance term), else the parity CI understates uncertainty. **This stage is non-vacuous only at
K ≥ 2** — at K = 1 the inner per-question resample is constant, so the frozen K must be ≥ 2 (§8).
- **Difference CIs built at the source of the difference:**
   - Gates **A** (trained − zero-shot floor) and **B** (trained − judge FITB) use a **paired** cluster bootstrap
     — each replicate resamples the **shared** clusters once and scores **both** models on it, then differences
     (they score the *same* items → positively correlated; `Var(X−Y)=Var(X)+Var(Y)−2Cov(X,Y)`, Cov > 0, so
     pairing tightens the CI; an unpaired combine mis-states the width).
   - The **reported transfer (former gate C; catalog − closet drop)** combines **two independent** cluster
     bootstraps (disjoint corpora, no shared sample) and is **dominated by the closet term** (the test-split
     catalog CI is tiny — that side is large-N). **Percentile-bootstrap coverage at ~15–25 closet clusters is
     weak**, so the closet-side CI is reported with an explicit coverage caveat (effective-N = #outfits) and read
     directionally — never as a precise instrument. This is exactly why the transfer is reported, not gated (§12).
- **One headline seed + a 3-seed robustness footnote** (seed variance ≪ cluster variance with a frozen
  backbone). No permutation p-value on top of the CI. *(The seed governs the negative draw + FITB distractors, so
  the 3 footnote seeds re-roll the whole negative set — pre-register them, and treat the footnote as the check on
  the "seed variance ≪ cluster variance" assertion, not an afterthought. The footnote is a coarse robustness
  signal, not a variance estimate: require the **gate verdict** (A/B/D pass/fail) to agree across all 3 seeds, not
  merely that the point estimates are close — a seed that flips a gate is a finding, not noise.)*
- **Family-wise control across the ablation suite.** The headline cell is one frozen point (§1), but the spike
  reports several CI-adjudicated *ablation* inferences — the shape difference (pairwise − item-level, §6), the
  fashion-fine-tuning delta (matched-base − FashionSigLIP, §5), and the modality gaps (§8). The C2-frozen
  correction is **Holm-Bonferroni at family-wise α = 0.05 over the executed ablation family**, using
  percentile-bootstrap two-sided p-values, so the load-bearing "item-level falsified" seam claim is not a
  1-in-20 false positive. The three decision **gates**
  (A/B/D) are the decision and are scoped out of this family (the reported transfer is descriptive, not a
  CI-adjudicated ablation inference).

---

## 12. Go/no-go gates, near-gate rule, no-go deliverable

**One mechanical AND-gate** in `evaluate.py` reading `metrics.json` (single source of truth; `results.md`
restates it). `evaluate.py` **refuses to emit any held-out *test*-set metric through `metrics.json`
until `preregistration.md`, `preregistration.json`, the C4 judge addendum (`judge_addendum.md`), and the frozen
`closet_manifest.json` (the transfer-probe dataset, former gate C: included outfits, fine-category labels, inclusion/exclusion +
negative-construction + label-audit protocol) are committed, validated, and hash-recorded** — the build-order enforcement of §1's blindness
(C3 produces a mechanical valid-split selection only — `selection.json`: checkpoint id/config/hash/convergence,
**no metric values**, validated against `selection.schema.json`). `metrics.json`'s test-set fields begin emission
(staged C4→C6, §15 artifact-dataflow note) only after the four unlock files pass validation. Freezing
`closet_manifest.json` before the unlock stops the transfer-probe dataset from being selected after A/B/D are seen
(local hand-labeling — no photos leave the machine, so it costs no third-party egress):

> **GO** iff **[A]** `CI_low(AUC_catalog_pair − AUC_zero_shot_cosine) > 0` (pair-level — training added value over
> the frozen backbone floor) **AND** **[B]** `CI_low(fitb_trained_gateB − fitb_judge_gateB) ≥ −δ` on the **powered
> Polyvore image-only set** (FITB **non-inferiority** vs the `gpt-5.4-mini` image-only judge — at parity or better;
> A/B paired; the closet gives non-Polyvore corroboration, **not** the gate input — §8) **AND** **[D]** the
> **absolute accuracy floor (cost-independent): `CI_low(outfit_auc) ≥ 0.81` AND `CI_low(fitb_trained_full) ≥ 50%`**
> (outfit-level; the `outfit_auc` construction — positive vs same-fine-category-corrupted negative outfits,
> mean-edge score, source-outfit cluster — is in §4).
>
> **Reported, not gated — catalog→closet transfer (the former gate C):** `evaluate.py` computes and reports the
> **pair-level AUC drop** `AUC_catalog_pair − AUC_closet_pair` (`CI_high`) and the **absolute closet pair-level
> AUC** `AUC_closet_pair` (`CI_low`) with their CIs, read **descriptively** against the reference band (drop ≤ 0.12
> / closet AUC ≥ 0.70 = healthy transfer; §10; former gate C, unpaired — §11). They do **not** enter the AND-gate — a single-wardrobe
> closet's effective-N (≈ #worn outfits) cannot power a veto, and gating on that CI would force a no-go for a power
> reason, not a model reason. The transfer instead becomes an explicit **M6 entry condition**: M6 re-measures it on
> powered real-ingestion data (the W-track) before committing the trained scorer to production (§13).

- **[D] is the comparability anchor that closes L1-02.** Relational gates A/B alone can pass a weak head that
  merely *ties a weak mini judge* (B) and beats its *own* zero-shot cosine (A); an absolute floor stops that.
  0.81 / 50% are the **disjoint** Vasileva 2018 anchors (untyped SiameseNet 0.81 AUC / 51.8% FITB — §6 band;
  verified against Table 5), so a head clearing D has demonstrably matched a 2018 typed-embedding baseline on the
  hard split. **D gates the outfit-level AUC** (comparable to the outfit-level literature anchors), not the
  pair-level gated unit; FITB@4 is unit-agnostic. **Comparability caveat:** 0.81/50% are full-Polyvore figures and
  this task excludes accessories + uses an outfit-corruption negative — report the excluded item/edge share and
  treat 0.81 as **approximate**; the **direction** of any residual incomparability (accessory-exclusion, our
  outfit-corruption rule, and whether a cited anchor used a different negative protocol) is **not assumed
  conservative** until the C2 Vasileva-protocol confirmation — the floor may read slightly lenient *or* slightly
  strict. The threshold does **not** move post-hoc (pre-registration); the imperfect comparability is disclosed,
  not corrected away. *(This re-promotes the floor an earlier v2 draft demoted to a non-gate readout — the demotion
  re-opened L1-02; the relational gates A/B stay, D is added alongside.)*
- **`FITB_trained` must resolve to two distinctly-named, separately-frozen subsets** so no gate reads an
  ambiguous `FITB_trained` — gate B is judge-cost-limited (the ~500 questions the judge also scores, for
  like-for-like parity) while gate D wants a held-out FITB comparable to the whole-test-set literature anchor.
  **This subset allocation is an open pre-registration decision settled in `fitb_manifest.json` at C2** — it freezes
  *before* any model number, so deferring it to C2 costs no rigor; only the *naming-must-be-distinct* invariant is
  firm now. **C2 allocation:** gate D = the **full held-out FITB manifest** (every eligible test outfit, one Q —
  maximal-N, anchored against Vasileva's 51.8% with the §12 exclusions/protocol caveat); gate B = the first
  up-to-500 questions from a **deterministic seed-ordered construction**. **Resolving the C2-freeze-vs-C4-N tension:**
  C2 freezes the constructor (`data_loader.build_fitb`), seed, strict-disjoint loader, `type_map.json`, and source
  hashes in `fitb_manifest.json`; C3 materializes/hashes the regenerated ordered question list before any model
  number, and C4's only degree of freedom is the **prefix length** — N is the size of a **deterministic prefix** of
  that frozen order chosen to reach `HW ≤ δ` (the **gate-B pilot prefix** is itself the first 100-question prefix of the same order), never
  a post-hoc re-selection of *which* questions. If the full ~500 list still has `HW > δ`, gate B is underpowered
  → no-go (below). So "test-N moves" means "the prefix grows within the frozen ordered construction," not "the set
  is re-selected at C4." Whichever allocation is chosen,
  `metrics.json` names the trained reads distinctly (`fitb_trained_full` / `fitb_trained_gateB`) and the judge read
  as `fitb_judge_gateB` (the gate-B difference is `fitb_trained_gateB − fitb_judge_gateB`).
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
- **Gate B bias accounting — two biases pull opposite ways; the net is not assumed.** The §8 memorization risk (a
  judge that recognizes Polyvore photos) **advantages the judge** → biases B **against** the head (a B-pass is
  then conservative). But the **"inconsistent verdict = miss"** position-bias rule (§8) **handicaps the judge** →
  biases B **toward** GO. These do not obviously cancel, so the spec does **not** claim a single net direction:
  report the gate-B verdict under **both** the `inconsistent = miss` and the `inconsistent = 0.5` conventions (both
  computable from `judge_runs.ndjson`'s per-question consistency flags — §8/§15; the §8 wrong-vs-excluded
  sensitivity table reports alongside), and treat the "B-pass is conservative" reading as holding
  **only if both conventions agree**. The `inconsistent = miss` headline is justified independently as a measure of
  the judge's *deployable* reliability (an order-flippable verdict is not a usable signal) — but that justification
  is stated, not used to wave away the toward-GO bias. A third toward-GO mechanism — the ~13% coherence-flagged
  questions (Polyvore board noise) attenuate a true gap toward parity *and* can inflate the judge's inconsistency
  rate specifically — is covered by the pre-registered **coherence-sliced sensitivity** (preregistration.md §C.8:
  both-convention gate-B diffs + judge inconsistency rate + gate-D FITB per coherent/flagged slice, reported never
  gating, response pre-committed).

**Near-gate rule — stated once, here, as a single uniform principle** (the existing spec restated it across
five homes and the conjunct logic broke three times): **read every decision gate off its 95% CI; the conjuncts
(A, B, D) each pass only if their CI is wholly on the pass side (a straddle → fail — and gate B additionally fails
as "underpowered" if its half-width exceeds δ).** The **reported transfer (former gate C)** is read
**descriptively** against its reference band (drop ≤ 0.12 / closet AUC ≥ 0.70), **not** by the pass/fail CI rule —
it does not gate. `evaluate.py` is the single implementation. *(The gates are
deliberately conservative — and demoting the unpowerable transfer from a veto to a reported finding + an M6 entry
condition is itself that conservatism: the only legitimate lever on a wide CI is **power**, never gate slack, so a
gate that can only ever be a power-limited straddle is reported, not enforced.)*

**No-go ships.** `results.md` leads with the **systems-decision framing + the §9 cost/determinism/availability
table**, then the parity evidence, the measured catalog→in-the-wild drop, and the **seam-shape verdict** (the §6
pairwise-vs-item-level ablation — pairwise-edge adopted on the literature's strength; item-level independently
falsified on our data iff `CI_low(pairwise − item-level) > 0`, else "consistent with literature, not decisive at
this power" — §6), with the mechanical go/no-go (A∧B∧D) printed by `evaluate.py` and merely restated. A no-go
reads as a **clean engineering verdict** — "the LLM is meaningfully better on the hard split (B), or the trained
prior misses the absolute floor (D), so the trained scorer isn't worth M6 yet" — a measured negative + cost table
+ seam decision, **never** "I proved I can't do it." (The catalog→closet transfer is reported either way and
re-decided at M6, not part of the H26 verdict.)

---

## 13. Forward seam constraints (M6 / H28)

Four constraints H26 locks on the post-H26/pre-M5 scorer seam (informs, lands no code):

1. **Shape:** a **pairwise, type-conditioned edge head** `score(item_i, item_j, type_pair) → float` with
   mean (or, later, attention) aggregation, landing as an **additive, default-None pairwise/outfit-level hook on
   `rank()`/`RankerContext`** — a **second, distinct seam** from the item-level `score(item, context) → float`
   sampler slot (`sampler.py:127`), which is **kept** for the behavioral/personalization shortlisting arm
   (canonical §23-H28: "distinct from the item-level sampler slot"). H26's §6 ablation **tests** the
   **per-item-scalar shape for *content* compatibility** (literature-grounded expectation: it is falsified) —
   motivating the pairwise ranker hook — it does **not** remove the sampler seam. (Additive ≠ reopening M3 behavior.)
2. **Cold-start-available:** the universal content prior must work at **zero user interactions** (its whole
   purpose), so it is **exempt from the sampler's `interaction_count ≥ MIN_SIGNAL_THRESHOLD` gate**
   (`sampler.py:260`) and lands on the **ungated ranker/content-scoring surface**, never the interaction-gated
   sampler signal slot (spec §11, already reconciled).
3. **Lens/context input reserved:** the spike's edge head is **context-free** (clean floor comparison), but the
   seam INPUT is **partial-outfit + candidate + lens/context** (the spec §6.3 `RequestContext`: occasion verbatim,
   weather bucket `hot|mild|cold|indoor|outdoor`, routine) so an M6 lens-conditioned head can add a conditioning
   vector later **without re-opening the seam shape.** Context is not baked into the frozen headline; the
   interface must not preclude it.
4. **Transfer is an M6 entry condition, not an H26 gate:** the catalog→closet domain-gap drop (§10/§12) is
   **reported** by H26 (the single-wardrobe closet cannot power a veto) and **decided at M6** — M6 must re-measure
   transfer on **powered real-ingestion data** (the W-track ingestion surface is the eventual source of closet
   photos at volume) before committing the trained scorer to production. H26 hands M6 the honest catalog→closet
   interval + its width as the open question, not a pass/fail.

---

## 14. Privacy / consent (closet photos)

The closet vision arm sends real garment photos to third-party vision APIs (the `gpt-5.4-mini` memorization
control, and — if it scores the closet slice — the §8 cross-family secondary judge, e.g. Claude or Gemini).
Required: **explicit per-owner consent for third-party-API processing** (not just local use; enumerating every
provider the photos reach); a committed
**closet manifest** (item IDs, `clothingType` + fine-category labels, outfit membership, photo **paths +
content hashes** — tamper-evident, `closet_manifest.json`; **frozen before the C4 test-metric unlock (§12)** —
necessarily before the head ever scores it) while the **photos themselves stay
gitignored**; **anonymized opaque owner IDs** (`owner_a`/`owner_01`, never a name/email — `assemble_closet.py` rejects whitespace or email-like owner ids) + relative paths; **faces + people blurred** (or cropped out only
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
  matched WebLI SigLIP ViT-B/16 base; C2 freezes backbone/config, while full cache-content hashes stage to C3
  before training); `metrics.py` (pooled pair-level AUC, **outfit-level AUC
  (mean-edge score, source-outfit cluster — the gate-D input, §4)**, FITB@4, cluster bootstrap);
  `tests/test_metrics.py` (known-answer fixtures + co-occurrence-is-chance + item-popularity sanity +
  paired-vs-independent-bootstrap shape). **Freeze `preregistration.md`** — the §1 headline cell **+ the §12 gate
  block (A/B/D decision thresholds; δ = 5; gate-D reads the §4 outfit-AUC construction; **+ the reported-transfer reference band 0.70 / 0.12, former gate C — measured not gated, §12**) + the frozen
  analyst choices** (head architecture + symmetrization + type-pair embedding, **the item-level ablation head +
  its ±5 % capacity-match rule (§6)**, optimizer/grid/epochs/early-stopping/Torch-determinism, the family-wise
  correction §11, the **pinned HF model revision SHA + preprocessing hash + dependency lock**, the calibration-set
  spec, **the `fitb_manifest.json` (eligibility, held-out-item rule, distractor rule, seed, constructor/source
  hashes, and the gate-B vs gate-D subset allocation — the gate-B side as a deterministic seed-ordered
  construction whose materialized order is hashed at C3 before any model number, prefix-selected at C4, §12), the
  `type_map.json` Polyvore-fine-category → 5-type mapping (§4), and the frozen pre-registered
  popularity-confound response (edge **and** outfit-level, §4)**) — all before any model number.
  **`closet_manifest.json` (the §10/§14 labels + negatives + label-audit protocol — local hand-labeling, no
  photo egress) freezes **before the C4 test-metric unlock** (§12) — necessarily before the head ever scores the
  closet, so no post-hoc dataset selection:** the closet transfer probe is in the **minimal headline path** (§15),
  and although the transfer is **reported, not gated** (§12), it is a load-bearing deliverable **and** the M6
  re-measure entry condition (§13), so freezing its dataset before the unlock still matters. It is a **mandatory
  unlock artifact**, not a conditional one — but it does **not** freeze at the **C2 design-freeze commit**: the
  closet labels do not exist until Brian labels his own worn outfits (he is away from his wardrobe at C2), so the
  C2 commit ships only `closet_manifest.template.json` and the manifest freezes from it before C4. (The only path
  with no closet manifest is the dataset-access-denied "blocked — no disjoint headline"
  degenerate, where **no** gates run at all — §15 risks.)
- **C3 — Baselines + trained head + eval driver.** `baselines.py` (zero-shot cosine floor; co-occurrence sanity
  assertion); `train_head.py` (pairwise-edge head, type conditioning, BCE, valid-selected; **the capacity-matched
  item-level ablation arm**, §6); `evaluate.py` (metric-computation half); `fitb_order.py` (the §12 gate-B order
  materialization). **Valid-split selection is mechanical
  (argmax over the frozen grid); the only files C3 commits are `selection.json` (checkpoint id + config + checkpoint
  hash + a convergence/early-stop indicator) and `fitb_order.json` (the gate-B seed-ordered FITB question list +
  its content hash — the §12 tripwire C4's prefix binds to; needs only the corpus + frozen seed, NOT the embedding
  cache, so it materializes at C3 before any model number). **Both carry *no metric value of any split*** — the
  held-out *test*-set metric values (gate-D outfit-AUC, gate-A/B pair-level + FITB) are never materialized to
  `metrics.json` until the C4 unlock (the §1 blindness guard). Valid-split metric values remain outside
  `metrics.json`; C3 exposes only `selection.json` + `fitb_order.json` provenance, so no human-visible model number
  exists at C3 to tune the judge against.** *(`selection.json` needs the trained checkpoint, so it materializes once
  the one-time embedding cache is built; `fitb_order.json` needs no cache and is committed first.)*
- **C4 — LLM-as-judge.** `gpt_judge.py` (`gpt-5.4-mini` dated snapshot; **native FITB@4**, both orders,
  consistent-only; image-only / image+title / text-attribute arms; the determinism envelope + logprob
  escape-hatch; **a live API smoke test *re-checking whether image logprobs are available* (§8 verified them
  unavailable at spike-design time; take the logprob escape-hatch only if this re-check finds support) +
  Chat-Completions vs Responses params — the accepted-temperature question is already settled: gpt-5.4-mini takes
  any temperature (smoke-tested 2026-06-28), judge pinned at temp 0**). Calibration pilot → freeze → gate-B pilot prefix → powered ~500 if justified. Cost/latency
  table. **Freeze the C4 judge addendum — committed as `judge_addendum.md` with these fields: prompt + prompt hash,
  dated model snapshot, calibration-set manifest + hash, temperature 0 + K-sample rule, both-order policy,
  `max_tokens`, retry/drop policy, payload-logging policy, commit hash — on a calibration set
  disjoint from the gate-B 500 and blind to every trained-head metric (§1). **Order (blindness-critical):** the
  addendum is fixed from the **judge-only** calibration pilot (position-flip + verdict-agreement → the K-sample
  rule + envelope, never the trained head's numbers) and **committed before any gate-B `fitb_trained −
  fitb_judge` comparison is computed**; after the freeze the only post-hoc freedom is the deterministic **prefix
  length N** over the C2-frozen ordered gate-B list (§12), chosen to reach `HW ≤ δ` — never a re-selection of
  questions or a re-tuning of the judge. `evaluate.py` validates the four unlock files, records their git blob
  hashes / sha256s in `metrics.json`, and **first unlocks emission of
  `metrics.json`** (the held-out *test*-set trained-head/judge metrics; closet/transfer
  fields are added at C5 and the file is finalized at C6 — see the artifact-dataflow note) only once all four of §12's
  unlock files (`preregistration.md` + `preregistration.json` + `judge_addendum.md` + schema-valid `closet_manifest.json`, including the
  closet referential checks) are committed** (§1/§12).
  **C4 unlock also mechanically enforces (built — not honor-system):** the judge addendum's determinism
  envelope is schema-validated and must be `frozen:true` (a scaffold is refused — `judge_addendum.schema.json`,
  the `judge_addendum_schema` `preregistration.json` pinned at C4); the bound **human-label calibration
  manifest** (`calibration_set.json`, sha-pinned in the envelope) must be committed + hash-match and its
  `question_ids` are asserted **disjoint from the gate-B set** (hermetic, off the committed `fitb_order.json`)
  and, at emission, the **full gate-D FITB set** (corpus-derived) — §F blindness made mechanical; the **gate-B
  emission arm must equal the frozen `headline_cell.judge.arm`** (`image_only`; the ablation arms report in
  `results.md`, never through the gate); the **ledger snapshot is bound to the freeze** — every consumed
  `judge_runs.ndjson` row's `model_snapshot` must equal the frozen envelope's `model_snapshot`
  (`evaluate.assert_ledger_snapshot`), so a mid-spike production bump or a stray `--snapshot` can't silently
  produce the headline gate-B number off an unfrozen model (§8 dated-snapshot rule); and the scalar
  `judge_runs.ndjson` is **idempotent + completeness-checked** (keep-last dedup on
  `(question_id, arm, order, sample_index)` + exactly-K-per-order) so a resumed judge run cannot silently
  double K or misread an incomplete write as a drop. **Before the expensive `emit` retrain, `evaluate.py` must
preflight the ledger** — `judge_runs.ndjson` must exist and be **committed-clean**
(`RealGit(ROOT_DIR).identity(GATE_B_LEDGER).committed`; a dirty/uncommitted ledger is a hard stop, refused up
front rather than after hours of retrain) — and record its `judge_ledger_sha256` in `metrics.json._meta`, binding
every emitted gate-B number to the exact committed ledger bytes. **The gate-B RUN step carries the same build-order
  teeth as emission:** `run_judge.py gate-b` refuses to score a held-out-test question unless
  `judge_addendum.md` is schema-valid `frozen:true` **and committed-clean**, and it reads the *entire*
  determinism envelope (K, snapshot, `max_tokens`, `retry_budget`) **from the frozen addendum** — there are
  no CLI overrides on `gate-b` — so the judge freeze provably precedes any gated judge number and cannot be
  retro-tuned against one (§1 "enforced by build order, not honor system"). `gate-b` also drift-checks the
  prefix against the frozen `fitb_order.json` (`verify_fitb_order`) **before** any token is spent.
- **C5 — Domain gap.** `domain_probe.py` scores the closet from the **already-frozen `closet_manifest.json`** (its
  labels + mechanical negatives + label-audit froze before the C4 test-metric unlock — §12; only the
  *scoring* runs here): worn outfits → edges; pair-level closet AUC + FITB; catalog→closet drop,
  cluster-bootstrapped (all local FashionSigLIP — the transfer probe needs no third-party API). **Writes
  `closet_metrics.json`, which `evaluate.py` merges into `metrics.json`** (artifact-dataflow note above).
  `stl_ctl_probe.py`
  (Pinterest STL/CTL fetch + **resolvable-yield check**; pair-level scene↔product drop) is the optional
  task-shifted supplement. Run the **optional** GPT closet memorization-control slice. **Precondition (before any
  closet photo leaves for a third-party API): the §14 consent + face/PII redaction are in place** (the manifest
  itself froze before the C4 unlock — local labeling, no egress). **Code-gate (not honor-system): the C5 egress
  code MUST fail loud unless `closet_manifest.json._consent.third_party_api_processing` is true AND every provider
  it would transmit to is enumerated in `providers_photos_may_reach`** — a missing/false consent is a hard stop.
  **Label-integrity cross-check (added 2026-06-30):** `domain_probe.py` must cross-check each closet item's
  `clothing_type` against `type_map[polyvore_category_id].type` and fail loud on a mismatch — neither
  `closet_manifest.schema.json` (enum + regex only) nor the C4 referential check (category-id existence only)
  catches a label slip, which would silently mis-condition the head's type-pair embedding on the closet.
- **C6 — Report + mechanical gate.** Extend `evaluate.py` (gate-application half + the one near-gate rule);
  write `results.md`. **Sub-milestone boundary — heavier review pass** on every `results.md` claim vs
  `metrics.json` before declaring done. **The §4 popularity-matched-negative sensitivity re-run is now a
  MANDATORY C6 deliverable, not conditional:** the pre-registered item-popularity diagnostic fires on the real
  test split (outfit-level popularity-only AUC ≈ 0.56 > the 0.55 blind margin, measured 2026-06-30 — a
  model-independent confound diagnostic computed from popularity counts, not a trained-head metric, so recording
  it carries no §1 blindness concern), so `results.md` carries the §4 "popularity-confounded (disclosed)" label
  and reports the popularity-matched re-run (gate numbers do not move).
  **Reporting note (C6):** `fitb_judge_gateB`'s CI is **question-sampling (cluster) only**; the judge's temp-0
  run-to-run spread lives in the **two-stage `gate_B_diff_*`** (the gated quantities). `results.md` must frame
  `fitb_judge_gateB`'s CI as question-sampling, cite the two-stage diff for the parity decision, and report the
  judge as a **multi-run distribution** (§8/§11), never a single reproducible point.

**Files** (all new, under `ml-system/experiments/h26/`; touches no existing code): `README.md`,
`requirements.txt` (isolated), `preregistration.md`, `data_loader.py`, `embed.py`,
`embedding_manifest_fashionsiglip.json` (the C2 headline embedding **config** freeze: embedding dim + dtype,
normalization, backbone revision SHA, preprocessing hash, dependency lock; item order, image hashes, cache
hash/path, and content hash are populated/verified at C3 before training — §5), `metrics.py`, `baselines.py`,
`train_head.py`, `gpt_judge.py` (smaller — drops the per-edge continuous-score Monte-Carlo AUC, but keeps the per-question temp-0 sample-and-vote + both-orders), `judge_addendum.md` (the C4 freeze:
judge prompt + prompt hash, dated model snapshot, calibration-set manifest + hash, temperature 0 + K-sample rule,
both-order policy, `max_tokens`, retry/drop policy, payload-logging policy, commit hash — `evaluate.py`'s
test-metric unlock reads it), `type_map.json` (the C1-authored, C2-frozen Polyvore-fine-category → {5-type | excluded} mapping, one row per fine
category — §4; the STL/CTL 21→5-type map is a sibling), `judge_runs.ndjson` (the raw judge ledger — one row per
question × order × sample: **`question_id`, `order` (forward/reverse)**, parsed choice, consistency flag,
retry/drop status, model snapshot, `system_fingerprint`, payload-log hash; the K×2 → per-question collapse (§8),
the multi-run distribution + two-stage bootstrap read it, joined on `question_id`; raw payloads stay gitignored,
§8/§14 — **the committed ledger stays scalar-only: opaque `question_id` + choice index + flags, never the judge's
free-text rationale or any photo-derived caption (those route only to the gitignored `raw_payloads/`), so the
closet judge slice cannot leak person-describing text into the public repo**), `fitb_manifest.json` (the C2 freeze: eligibility, held-out-item rule, distractor
rule, seed, constructor/source hashes, gate-B vs gate-D subset allocation — §12),
`fitb_order.py` + `fitb_order.json` (the C3 materialization of the gate-B seed-ordered FITB question list +
its content hash — the §12 tripwire C4's prefix binds to; built from the corpus + frozen seed, NOT the embedding
cache, so committed at C3 before any model number), `stl_ctl_probe.py`, `domain_probe.py`,
`closet_metrics.json` (the C5 intermediate — `domain_probe.py` writes the closet/transfer fields here and
`evaluate.py` merges it into `metrics.json`; artifact-dataflow note above),
`evaluate.py`, `selection.json` (the C3 sealed-selection artifact: checkpoint id/config/hash/convergence, **no
metric values**, validated against `selection.schema.json` — §1/§12), `selection.schema.json`, `results.md`, `metrics.json` (the gate authority's data; first emission unlocked at C4,
closet/transfer fields added at C5, finalized at C6 — see the artifact-dataflow note below), `metrics.schema.json`
(the field-set schema the gate authority needs — skeleton authored at C2 with `metrics.py`, finalized at C6 with
the gate-application half; enumerates the `metrics.json` field set), `closet_manifest.schema.json`,
`closet_manifest.json` (the §10/§14 manifest, frozen before the C4 test-metric unlock — not at the C2 commit, which ships only `closet_manifest.template.json`: item ids,
`clothingType` + fine-category labels + the Polyvore-fine-category mapping (§10), outfit membership, the mechanical-negative + label-audit protocol, photo
paths + content hashes; photos stay gitignored), `tests/`, `.gitignore`. **Frozen — not touched:** all
`fitted_core/`, `ml-system/tests/`, `outfit_recommender.py`, the root `requirements.txt`, everything under
`fitted/`. Test floors unaffected (no core change): **≥715 pytest / ≥366 jest** (comfortably exceeded today;
counts are floors that grow, never pins).

**Artifact dataflow (`metrics.json` write-lifecycle — the gate authority's read contract).** `metrics.json` is
**not** fully written at one checkpoint; its emission is gated and staged: **(C3)** nothing materializes — only
`selection.json` (sealed, no metric values, validated against `selection.schema.json`). **(C4)** once all four unlock files (`preregistration.md` +
`preregistration.json` + `judge_addendum.md` + schema-valid `closet_manifest.json`, including the closet referential
checks) are committed and hash-recorded, `evaluate.py`
**first unlocks emission** of the
held-out *test*-set trained-head/judge fields. Valid-split metric values stay outside `metrics.json`; C3/C4 expose
only the `selection.json` provenance needed to bind the checkpoint. **(C5)** `domain_probe.py` writes
the closet/transfer fields (`AUC_closet_pair` + the catalog→closet drop) — it writes a `closet_metrics.json` that
`evaluate.py` merges, so the closet scoring is a separate script from the gate authority. **(C6)** `evaluate.py`'s
gate-application half reads the finalized file and prints the verdict. The full field set each read needs (all
with CIs): `AUC_catalog_pair`, `AUC_zero_shot_cosine`, `gate_A_diff` (gate A);
`fitb_trained_gateB`, `fitb_judge_gateB`, `gate_B_diff_inconsistent_miss`,
`gate_B_diff_inconsistent_half` (gate B — the paired two-stage bootstrap reads `judge_runs.ndjson` directly, not just the scalar, joined on `question_id`);
`outfit_auc`, `fitb_trained_full` (gate D); `AUC_closet_pair` + the drop (reported transfer). `metrics.schema.json`
enumerates exactly this set.

**Risks / open questions (settle against measurement, not opinion):**
- Valid and test arrive **pre-separated** in the shipped `disjoint/` files (valid 3,000 / test 15,145) — no
  internal split to derive; read off the shipped JSON at load. The headline test set is additionally purged to
  strict item-disjoint (§2, `strict_disjoint=True`).
- `gpt-5.4-mini` exact dated snapshot + confirm it is still what the app serves at spike time.
- FashionSigLIP emitted embedding dim + open_clip-vs-transformers load path — verify at C2 before fixing head
  shape.
- δ is **frozen at C2** (= 5 FITB pts, §12); only the pilot's **N** moves to reach `HW ≤ δ`, never δ — if N caps
  at ~500 and `HW > δ`, gate B is **underpowered → no-go**.
- STL/CTL is **optional + non-gating** (§10): the build-or-drop **threshold freezes at C2** with the rest of the
  pre-registration (only the measured *yield* is computed at C5 — keeps it inside the spec's freeze discipline);
  its 21→5-type map is a C2 artifact sibling of `type_map.json` (§4). If yield is below threshold, **drop it**
  (the closet is the transfer-probe input regardless).
- **Dataset access:** confirm the `mvasil` gating form early. **A denial = no item-disjoint headline corpus** (the
  ungated Marqo mirror has no disjoint split) → the spike degrades to a **mirror-only methodology artifact,
  mechanically labeled "blocked — no disjoint headline"** in `results.md`; never let a mirror number masquerade as the
  disjoint result.
- **Polyvore negative scarcity:** after accessory-exclusion + same-fine-category + anchor-no-cooccurrence filtering, a
  rare fine-category may lack an eligible negative/distractor — **drop that edge/slot + report the count** (unlikely at
  83k scorable items, but pin the rule; never broaden to coarse type on the AUC set — that re-introduces a
  category-leaking easier negative).
- **Test isolation:** `experiments/h26/tests/` must not leak into the root pytest collection (pin the collection
  scope); H26's isolated deps are not added to the root `requirements.txt`. *(Pinned via `ml-system/pytest.ini` +
  `experiments/h26/pytest.ini`, both `testpaths = tests`; `cd ml-system && pytest` and `cd experiments/h26 && pytest`
  are isolated. A config-less `pytest` from the **repo root** still recurses into the spike and errors on its heavy
  deps — run from one of the two pinned dirs.)*
- **Offline eval compute budget (measured at C3 — synthetic-cache timing on the real strict-disjoint test split,
  audit 2026-06-29):** a full `evaluate.compute_metric_suite` pass is **~50 min**, dominated by the **B = 10,000
  cluster bootstrap** (~5 min per pair-level AUC CI — each replicate re-ranks ~89 k pooled scores via
  `scipy.rankdata`; ×~8 pair-level CIs ≈ 40 min) and the **batch-1 `head_edge_scorer`** (~215 k distinct edge
  forwards at ~1 ms each ≈ 7 min). Feasible — completes, ~1 GB RAM, **no OOM** — but the **§C.7 3-seed footnote
  triples it (~2.5 hr)**, so C4–C6 must budget eval wall-clock, not assume it is free. Two **deferrable** speedups
  (neither required for correctness): a batched pre-pass via `train_head.score_edge_tensors` (batch 4096) to replace
  the batch-1 scorer, and a vectorized AUC bootstrap (must reproduce the **same** B = 10,000 numbers; `metrics.py` is
  frozen, so that one re-freezes).
- **Scope (ship the verdict):** the **minimal headline path** = FashionSigLIP + the pairwise head + **the
  capacity-matched item-level-vs-pairwise shape ablation (§6 — it settles the H28 seam shape, one of H26's three
  pre-registered deliverables per §0, and canonical §20/§23-H28 require it; not optional)** + the image-only judge
  + the closet transfer probe → gates A/B/D (+ the reported catalog→closet transfer, former gate C). The **backbone** ablation (matched-base fine-tuning delta, §5),
  STL/CTL, the cross-family secondary judge, and a 2nd wardrobe are **stretch** — build them only if the headline
  path ships first.
- **`results.md` framing (keep):** the benchmark measures **co-worn-ness, a proxy** for compatibility (positives are
  co-worn pairs; the mechanical negatives are not-co-worn, *not* human-judged "incompatible") — frame results as a
  co-worn proxy; the judge's "errors" include genuinely-compatible-but-never-co-worn pairs.
- **`results.md` framing — temporal representativeness / construct validity (keep):** Polyvore is a years-old scrape;
  fashion drifts, so *learned* Polyvore-compatibility ≠ *current* good style (panel feedback surfaced dated aesthetics
  — dominant skinny-cut, off palettes). This is an **external / construct-validity** boundary, **not** an
  internal-validity threat to gates A/B/D: every H26 comparison is *within the same corpus* (head vs zero-shot cosine,
  head vs the LLM judge, head vs the Vasileva Polyvore anchor), so the dataset's dating is a **shared handicap that
  cancels** — it bounds *what the parity number means*, not whether the comparison is fair (§0). Trend currency is
  **not** this prior's job: in the product it enters via the `gpt-5.4-mini` generator (current) + personalization (the
  behavioral `SignalScorer` seam and the M6 lens-first style graph learned from the user's **own** closet — current by
  construction; §13, canonical §20/§23-H28), while the content prior stays the slow-moving *do-these-cohere* signal.
  `results.md` states this as a named limitation and points to M6 personalization as the escape from a stale corpus —
  naming the boundary is a credibility strength, not a wound.
