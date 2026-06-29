# 2026-06-28 — H26 compatibility-spike `/spec` heavy audit (pre-implementation, to convergence)

Heavy build-and-audit loop over `docs/plans/h26-compatibility-spike.md` **before any code is written** — the
immediate next rung in `consolidation → H26 → M5`. The doc had been written, self-audited, then run through a
same-session `/code-review` fix pass (~9 changes) that **reverted the domain-gap gate from a FITB to the §2.1
AUC formulation** and rewired the closet probe to produce AUC. Goal: make it maximally consistent, canonically
faithful, factually correct, and implementer-ready, and find every ripple of those recent edits. **No
implementation.** Edited only the plan + reconciled canonical docs.

## Method & convergence

5 rounds of parallel cold-context lanes + a Round-1 ambition-merit attempt, every load-bearing finding
re-verified against source by the main loop before acting; my own focused full re-reads between rounds as the
catch-net. Fable was **unavailable** → ambition-merit used the dual-read substitute (a cold independent pass +
my in-session synthesis, both converging).

- **R1** — 5 lanes (A/F internal-consistency+lifecycle · B/C fidelity+factual · D cold-readiness · E
  ML-rigor/gameability · G merit[Fable, failed]). ~7 load-bearing + several minor.
- **R2** — regression-of-R1 (mechanical) + rigor re-check of the redesign. Mechanical: **0 regressions**.
  Rigor: 3 new load-bearing (the redesign's own ripples).
- **R3** — regression + final-soundness/cold-readiness. ~6 load-bearing (incl. 1 I introduced in R2).
- **R4** — convergence regression. 1 Important (a gate-3 gloss I introduced in R3) + 2 cheap tightenings.
- **R5** — final convergence regression → **CONVERGED, zero load-bearing.**
- **Merit dual-read** → `good-with-caveats`; closed 1 framing gap.

The `/code-review ultra` cloud DFS pass was **not** launched (session policy: user-triggered + billed; I cannot
launch it). Its independent-catch-net role was served by the 5 cold-context rounds + focused re-reads. **Brian
can run `/code-review ultra` himself** for the cloud multi-agent catch-net if he wants extra assurance.

## Load-bearing findings + fixes (by theme)

**Revert ripples (FITB→AUC gate left FITB-framing behind):**
- Approach item 5, the protocol section title, and the GPT success-criterion still framed the domain-gap
  measurement/gate around FITB → reframed to the pair-level AUC gate with FITB as supporting evidence.

**Domain-gap measurement validity (the strongest cluster — the spike's locked raison d'être):**
- **Unit-mismatch:** catalog AUC was outfit-level (mean over edges) but closet AUC pair-level, so gate-4's
  `catalog→closet drop` subtracted non-comparable quantities and step 5 falsely called them "identical metrics."
  → **The drop is now pair-level on BOTH sides** (a new full-corpus pair-level catalog AUC is the reference);
  the headline/gate-2 AUC stays outfit-level (anchored to the 0.81 outfit-level Siamese literature).
- **Closet-negative bias:** negatives were hand-curated "reads incompatible" (easy-bias) and used a coarse-type
  scarcity fallback the 175k catalog never triggers → both inflate closet AUC, shrink the drop. → mechanical
  same-fine-category negatives, **coarse fallback forbidden for the AUC set** (drop the edge instead); typo fix
  (`b′` is same-category as the **replaced** item `b`, not `a`).
- **Effective-N honesty:** decomposing ~15–25 outfits into ~100 edges buys *computability*, not power —
  effective-N ≈ the ~20 outfit clusters; both gate-4 arms share that floor → **disclosed**; cluster-bootstrap at
  the source-outfit level pinned.
- **Closet-composition selection** (which outfits Brian includes) is un-seeded → **pre-register the closet set
  before scoring.**

**Pre-registration leaks / gameability (anti-spin):**
- Headline cell didn't pin backbone/modality (4-cell grid → post-hoc max-selection) → **frozen FashionCLIP/vision**;
  zero-shot comparator pinned to vanilla CLIP.
- Gate-3 GPT comparator arm unpinned (text arm = memorized titles) → **frozen vision arm**; closet slice is the
  **primary** gate-3 input (in-corpus flagged memorization/leakage-confounded).
- Gate-3 symmetric `|Δ|≤0.03` would mechanically no-go a *better* head → **one-sided `trained ≥ GPT − 0.03`**.
- **CI level + bootstrap B never frozen** — the whole near-gate rule depends on "CI straddles the floor" →
  **95% CI, B=10,000 frozen**; a "Frozen analyst choices" manifest added to the FROZEN block (which is committed
  verbatim as `preregistration.md`, so every DoF must live in it: backbone, modality, BCE objective, valid-split
  selection, seed, CI level/B, comparator backbone, GPT arm, primary slice).
- Training objective BCE/BPR was a slash-choice → **BCE frozen as headline, BPR ablation-only**; head
  hyperparameters selected on the **valid** split, frozen before test.

**GPT-judge AUC arm (gate-3 was uncomputable/mismatched as written):**
- Binary `{compatible}` gave no continuous ROC score → **`p_compatible` ∈ [0,1]**.
- "Both candidate orders" is undefined for a single judgment; gate-3 (AUC) sample never sized → AUC arm pinned
  (both item orders, mean `p_compatible`, no drop) + a **powered AUC sample (~500)** required, pilot-gated.
- **Gate-3 unit-mismatch (regression-of-omission I introduced fixing gate-4):** GPT AUC judged whole outfits
  while the closet trained-head AUC is pair-level → **GPT AUC arm now judges item PAIRS (edges)** → pair-level
  on both slices, like-for-like, *and* the honest per-edge cost unit (aligns with L1-07's volume math).
- Gate-3 in-corpus cell ≠ gate-4 drop reference (one must be GPT's exact ~500-edge sample, the other
  full-corpus) → **separated cells**, gate-3 made **CI-non-inferiority** (95% CI of `(trained−GPT)` ≥ −0.03),
  added to the near-gate rule, and the `evaluate.py`/verification glosses reconciled to the CI form.

**Co-occurrence baseline (overclaim trap):**
- Under same-fine-category negatives the category-pair co-occurrence baseline is **chance-by-construction**
  (AUC≈0.50/FITB≈25%) → relabeled a **harness sanity floor, not a beatable rung** ("don't report a margin over
  it"); Laplace form pinned `(n_both+1)/(n_either+2)`; gate-1's real floor is zero-shot CLIP-cosine.

**Smaller:** per-outfit→pooled-ROC-AUC terminology; negative excludes the original item; degenerate <2-item
outfit skipped; embed.py text-modality = CLIP text encoder; the "0.93/78%" cross-paper pairing split into
0.93/67.1% (OutfitTransformer) vs ~0.95/~78% (easy-regime); "CV_SERVICE_URL removed" → "has no default";
title-strip memorization-control refinement; the F1 reversed-subtraction sign (`catalog − closet`).

**Portfolio framing (merit gap):** the Goal didn't decouple the *deliverable* from the *verdict* → added that a
likely no-go is not a failed spike; the artifact (in-corpus AUC/FITB + GPT head-to-head + cost/volume table +
honest drop) lands either way; `results.md` leads with methodology + cost-parity (pointer to readiness §6 L6-02).

## Canonical reconciliation (conflicts are bugs)

- `Fitted_Spec_v2.md` §20 H26 row status `decision-pending → /spec next` → **`/spec` complete → ready to
  implement** (+ plan pointer); §23-H26 `to be /spec'd` → specced, with the pair-level/frozen/co-occurrence summary.
- `CLAUDE.md` three `/spec-pending` H26 references → `/spec complete` (+ plan pointer).

## ⚠️ FROZEN-block extensions beyond §2.1 — for Brian to ratify at C2 (before `preregistration.md` commits)

The four §2.1 gates + thresholds are reproduced **exactly** (no threshold moved). But the FROZEN block now
**operationalizes well beyond §2.1's literal text** (a `/spec`'s job, but flag-worthy since §2.1 was "locked"):
gate-3 made **one-sided + CI-non-inferiority + vision-arm + closet-primary + pair-level**; gate-4 drop made
**pair-level on both sides**; the **headline backbone/modality, BCE objective, seed, CI level/B** frozen; the
**near-gate rule broadened** to all gates incl. gate-3. None loosens a gate (all tighten/disambiguate). Ratify
when the H26 `/spec` is built — `preregistration.md` is the natural ratification point.

## Ambition-merit verdict — `good-with-caveats` (converges with the 2026-06-26 panel + readiness §6)

Running H26 now, with this hardened design, is the right portfolio/ML bet. The hardening made the *decision*
conservative (expect a gate-4 no-go: gate-2's floor sits at the band's bottom; gate-4 on ~20 clusters; Popli
2022 predicts poor naive transfer) **without making the measurement hollow** — the portfolio artifact lands
regardless of the verdict, and the gate discriminates at the extremes (strong transfer survives a wide CI; the
likeliest poor-transfer outcome fails on merits, not just on power). The pre-registration/CI/cost-math rigor
**is** the differentiator for a zero-user portfolio spike, not over-engineering. Cost-parity is honestly carried
(gate-3 is non-inferiority, explicitly not superiority). The one merit gap — artifact-vs-verdict decoupling —
was closed in the Goal. Frame cost-parity as *oracle-distillation + per-edge volume math* (parity-but-cheap is
the enabling win), and keep the weak-power closet probe (it measures the single most load-bearing product claim).

## Codex independent review round (2026-06-28, after convergence) — 7 findings, all verified + fixed

An external Codex review ran on the converged doc. **All 7 verified true against source** by the main loop
before acting — and 3 were genuine misses by the 5-round lane loop (worth recording so the method improves):

- **[High] Canonical `clothingType` enum names** — the doc used `outerwear`/`footwear` (legacy *input*-category
  names); the canonical enum is **`top`/`bottom`/`dress`/`outer_layer`/`shoes`** (`fitted/lib/clothingType.ts:10`,
  `WardrobeItem.ts:9`, `GenerationSnapshot.ts:181`). Fixed; the type embedding + closet labels would otherwise
  fork. *(My Lane C verified "5-value" but not the exact values — a real factual-fidelity gap.)* Also added a
  **frozen Polyvore-fine-category → 5-value mapping** with non-clothing categories (bags/jewelry/accessories)
  **excluded** so the type space matches the closet.
- **[High] Privacy/commit contradiction** — the late "pre-register the closet set" addition said "commit the
  closet photo set," contradicting the photos-are-gitignored rule. Fixed → commit a **manifest** (item IDs,
  labels, outfit membership, paths, **content hashes**); photos stay gitignored.
- **[High] FITB tie policy unpinned** — the co-occurrence ≈25% claim + hit@1 depend on it. Pinned **fractional
  credit `1/k`** (deterministic; all-tied → exactly 0.25), never argmax-by-candidate-order. Also pinned GPT
  4-way "both orders" = **a seeded shuffle + its exact reverse**, consistent-verdict only.
- **[Med] Pair-level negative anchor constraint missing from loader/tests** — the FROZEN block required `b′` to
  not co-occur with anchor `a`, but the `data_loader`/`tests` rows only said "not in the outfit" (a co-worn
  partner from another outfit would be mislabeled a negative). Fixed both rows + the test.
- **[Med] Gate-4 OR vs near-gate logic bug (I introduced it broadening the near-gate rule)** — "any straddle →
  no-go" treated gate-4's OR-disjuncts like conjuncts, so a clean closet-AUC pass would be overridden by a drop
  straddle. Rewrote the near-gate rule to respect AND/OR structure: conjuncts (gate-2, gate-3) need all-clean;
  the **gate-4 disjunction passes if at least one disjunct's CI is wholly on the pass side**.
- **[Med] GPT prompt pre-registration leak** — the prompt was finalized at C4 *after* C3's trained-head numbers
  exist → could be tuned to flatter gate-3. Fixed → freeze it on a **calibration set blind to the C3 gate cells**
  before scoring any gate edges (a C4 pre-registration addendum, since it needs the data infra).
- **[Low] `docs/README.md:10`** still said `/spec-pending` → reconciled (the third canonical home I'd missed).

## Final state

- `docs/plans/h26-compatibility-spike.md`: 323 → **485 lines** (well under the 1,500 ceiling; growth closes real
  load-bearing gaps). Converged through R5, then the Codex review's 7 findings folded in.
- No code touched — **boundary clean** (`git status`: only the H26 plan + `Fitted_Spec_v2.md` + `CLAUDE.md` +
  `docs/README.md`). Test floors unaffected (suite verified this session: **pytest 751 / jest 375**, matching the
  doc's stated "today" counts and ≥715/≥366 floors).
- **New decision surfaced by Codex (for Brian):** the Polyvore→5-value mapping **excludes** non-clothing items
  (bags/jewelry/accessories) so the type space matches the 5-value closet. Recommended (transfer-faithful — the
  production wardrobe is 5-value clothing only), but the alternative (include accessories as a 6th type) discards
  less Polyvore compatibility signal. Revisit at C1 if desired.
- Not committed, not pushed — left for review.

## 2026-06-28 (later) — Brian ratified the three open decisions; two-wardrobe closet probe landed

Brian accepted the session's recommendations on all three open decisions:

- **Gate conservatism — KEEP FROZEN.** No threshold or near-gate-rule loosening. The conservatism *is* the
  portfolio credibility; a no-go is a shippable result. The only legitimate lever on gate-4's wide CI is
  **power, not slack** — pursued via the closet probe below, not by moving a gate.
- **FROZEN-block extensions beyond §2.1 — RATIFIED.** Every extension listed in the "⚠️ FROZEN-block
  extensions" section above (one-sided CI-non-inferiority gate-3; FashionCLIP/vision headline; vision-arm +
  closet-primary gate-3; pair-level drop on both sides; BCE-headline/BPR-ablation; seed + 95% CI + B=10,000;
  AND/OR-aware near-gate rule) is approved to commit **verbatim in `preregistration.md` at C2**. All
  tighten/disambiguate; none loosens a gate.
- **Polyvore→5-value mapping excludes accessories — CONFIRMED**, and extended to the closet probe: bags/
  jewelry/sunglasses are dropped from *both* wardrobes too, keeping the type space 5-value end-to-end.

**Two-wardrobe closet probe adopted** (Brian has a large closet + access to a consenting friend's female
closet). Converts a real-world asset into the only legitimate lever on gate-4 (cluster count) and buys
closet-side `dress`-type coverage + stronger external validity + a cleaner non-Polyvore GPT control. Plan
edits (closet-probe section only — gates/training/FROZEN block untouched):

- Step 1: assemble as many *distinct* worn outfits as feasible, **target ~30–50 across two wardrobes**
  (mixed-gender), with an explicit **single-wardrobe fallback** (~15–25, original ~20-cluster honesty governs).
- Manifest gains an **owning-wardrobe tag**; `results.md` disclosure: single-wardrobe → two-wardrobe + small-N/
  non-random.
- Honest-power note + the "too few edges" edge case: cluster floor reframed (~20 → ~40 clusters ≈ √2 ≈ 1.4×
  narrower CI, **not** eliminated; power-limited no-go stays likely/acceptable). **Per-wardrobe AUC/drop reported
  descriptively** (surfaces the gender-distribution confound — Polyvore skews women's fashion) but **pooled for
  the gate**; per-wardrobe is never a separate gate input (forking path).
- Step 2: accessories excluded from both closets (Decision 3 extension).
- **Re-read catch (load-bearing):** pooled negatives must be sampled **within the same owner's closet** — a
  cross-person `b′`/FITB distractor is trivially not-co-worn + stylistically further, an *easier* negative that
  would inflate closet AUC and shrink the gate-4 drop. Pinned in step 3 (distractors) + step 4 (AUC negatives).

**No canonical-doc edit needed:** gates/thresholds unchanged; wardrobe count is a manifest/protocol detail below
§2.1's level (which says only "a labeled closet-like probe") and the FROZEN block pins no wardrobe count. Spec
§20/§23-H26 + readiness §2.1 stay consistent. No code touched; floors unaffected (pytest 751 / jest 375). Not
committed.

## 2026-06-28 (later #2) — Codex round 2: 8 findings (4 High / 4 Med), all verified + fixed

All 8 verified true against current source before acting; all load-bearing (several were genuine ML-rigor/
pre-registration gaps the 5-round lane loop + Codex round 1 missed). None forced a canonical edit — all
**tighten** the operationalization of readiness §2.1 (consistent with the ratified FROZEN-extensions posture);
§2.1 pins no backbone/determinism/CI-method, so these are extensions, not conflicts.

- **[High] Gate-1 backbone confound.** Gate-1's zero-shot floor was *vanilla* CLIP while the trained head is
  FashionCLIP → beating it could be pure backbone lift, not head value. Added a **same-backbone FashionCLIP
  zero-shot cosine** rung and made it gate-1's **binding floor** (vanilla = reported ladder rung + the
  backbone-value ablation). Touched 5 floor-statement sites + the C3 build instruction + the FROZEN ladder
  (the C3/ladder updates were the F1 *ripple* — they still said vanilla-only).
- **[High] GPT judge determinism unfrozen.** Froze the **determinism envelope** (dated model snapshot,
  temperature 0, `max_tokens`, structured `response_format`, retry/unparseable-drop policy) at C4 with the
  prompt; pinned that an unparseable-after-budget edge is **dropped+logged** (both models then score the reduced
  shared edge set — preserves like-for-like). Trap-guard added: `p_compatible` needs **no calibration** (ROC-AUC
  is rank-based — only consistent elicitation matters).
- **[High] Accessory-exclusion vs the 0.81 anchor.** 0.81/50% are full-Polyvore literature figures; the 5-value
  filter changes the benchmark. Fix = disclose the **excluded item/edge share** in `results.md` + caveat 0.81 as
  an **approximate, conservative** floor (threshold does *not* move — pre-registration — but comparability is
  disclosed).
- **[High] Unordered-edge endpoint unpinned.** `{a,b}` is unordered but "replace `b`" needs a rule. Froze
  **seeded endpoint selection** (the committed seed picks anchor `a` vs replaced `b`; 1:1 preserved, never two
  negatives per edge) in the FROZEN block + closet protocol + loader test.
- **[Med] Gate-4 edge case contradicted the OR rule.** The "too few edges" edge case said a straddle on *either*
  gate-4 arm = fail (the old conjunctive bug, re-surfaced). Reconciled to the **OR**: fails only if *neither*
  disjunct's CI is wholly on the pass side (noting under-power tends to straddle both since the drop CI is
  closet-dominated, so a no-go is still the typical outcome).
- **[Med] Checkpoint/verification summaries lagged the strict rules.** C1 + the verification harness-self-test
  bullet said only "not in the outfit"; tightened both to the **pair-level never-co-occur** constraint +
  mapping-excludes-accessories + the endpoint seed + co-occurrence **exactly** 0.50/0.25 (implementers follow
  checkpoint bullets).
- **[Med] Difference-CI construction under-specified.** Pinned: gate-3's `(trained−GPT)` CI is a **paired**
  cluster bootstrap (same edge sample resampled once, both models scored on it — they're correlated); gate-4's
  `(catalog−closet)` drop CI combines the **two independent** bootstraps (disjoint samples), closet-dominated.
  Added to the FROZEN CI rule + metrics.py/evaluate.py rows.
- **[Med] Batch-API vs synchronous latency conflated.** The parity thesis needs **synchronous per-request**
  latency, not Batch-API turnaround. Split every cost/latency site into (i) Batch eval cost + wall-clock and
  (ii) the synchronous per-request `$/request` + p50/p95 **parity number**; propagated to gpt_judge/C4/L1-07 +
  the cost-table success criterion + `results.md` row + the verification bullet.

**Self re-read caught 3 ripples** beyond the direct fixes: C3 + the FROZEN baseline ladder still built/listed
vanilla-only zero-shot (F1); the cost-table success criterion + `results.md` row + verification bullet still
carried pre-split latency wording + omitted the exclusion-share (F3/F8 enumeration). All closed.

Doc: 485 → **539 lines** (well under the 1,500 ceiling). No code touched; floors unaffected (pytest 751 / jest
375). Not committed.

## 2026-06-28 (later #3) — Brian delegated the open decisions ("be the expert, decide"); resolved + one research-driven reversal

Brian declined to adjudicate the ML-methodology decisions and told me to research + own them. Resolutions:

- **GPT-judge continuous score — REVERSED my own round-2 default, research-grounded.** Round 2 had pinned
  temperature 0 + a self-reported `p_compatible` float. Research (G-Eval — LLMs emit coarse round-number scores
  → tie-degenerate ROC-AUC; the fix is to score from the model's *probability distribution*) plus the OpenAI API
  limitation that **GPT-4o returns no logprobs on image inputs** (the gate-3 comparator is the *frozen vision
  arm*) means neither a self-reported float nor logprobs works. **Decision: the AUC continuous score = Monte-Carlo
  `P(compatible)`** — the fraction of "compatible" verdicts over **N samples at temperature 1.0**, split across
  both item orders (the logprob-free realization of "use the distribution, not the raw score"; modality-robust,
  tie-resistant). **Temperature split: 0 for FITB** (reproducible discrete choice) / **1.0 for the AUC** (frequency
  estimation needs the natural distribution). N is **pilot-tuned** (score-tie rate vs per-edge cost); the
  N-sampling is *experiment/batch* cost, **not** the parity number (consistent with the F8 split). Also pinned:
  **log `system_fingerprint` + full payloads** (temp 0 ≠ bit-deterministic — infra nondeterminism). Touched 12
  sites (gpt_judge row, C4 schema/determinism/AUC-edge/pilot, frozen choices, success criterion, Approach §4,
  L1-06, verification, the cost edge case).
- **Round-2 FROZEN extensions (F1 gate-1 same-backbone floor, F4 endpoint seed, F7 paired/independent CIs, F2
  determinism) — RATIFIED** (all tighten; commit verbatim in `preregistration.md` at C2).
- **GPT model snapshot — decided:** pin a **dated snapshot** (not the rolling alias) + log `system_fingerprint`,
  fixed at C4 when the infra lands (mechanical).
- **Unfiltered all-types comparability cell — declined.** The F3 excluded-accessory-share disclosure already
  carries the 0.81-anchor comparability honestly; an all-types cell re-opens the 6th-type question for marginal
  gain.
- **Closet cluster target — kept ~30–50**, protocol scales to whatever Brian actually assembles; not blocking
  (the ≥50-edge floor is the hard gate, not the cluster count).

Research sources: G-Eval probability-weighting / tie-reduction; OpenAI logprobs unavailable on vision +
flaky on gpt-4o; LLM-as-judge temperature (temp 0 ≠ deterministic; low-temp + averaging for high-stakes).

Doc: 539 → **542 lines**. No code touched; floors unaffected (pytest 751 / jest 375). Not committed.

## 2026-06-28 (later #4) — Codex round 3: 9 findings (3 High / 5 Med / 1 Low), all verified + fixed; spec reconciled

All 9 verified against source (incl. the `fitted_core` files Codex cited — `sampler.py:251`/`config.py:38` for
the cold-start gate, `sampler.py:119` for the item-level `SignalScorer`). All real. **None needed a code
change** (the sampler's cold-start gate is *correct* for the behavioral signal; the fix is making the content
prior's exemption explicit). Three findings clustered on the seam and forced **canonical spec edits**.

- **[High] F1 — cold-start scorer validated-but-never-used.** The sampler gates the signal slot behind
  `interaction_count ≥ MIN_SIGNAL_THRESHOLD`; a universal *content* prior must be cold-available. §11's
  eligibility gate conflated behavioral-vs-content. **Spec §11 reconciled** (the ≥5-interaction gate is the
  *behavioral* signal; the universal content prior is exempt + lands on the ungated ranker hook); H26 plan +
  §20 + §23-H28 now state the post-H26 hook must be cold-start-available.
- **[High] F2 — "H28 seam-shape confirmation" overclaimed.** H26 runs no pairwise-vs-item-level-vs-attention
  ablation → reworded everywhere to **"adopts (literature-grounded) + stress-tests, does not prove."** Ripple:
  the canonical spec made the same overclaim in **three** places (§20 row, §20 scorer-seam rung, §23-H28: "the
  H26 spike settles it empirically") — all reconciled.
- **[High] F3 — valid-split construction underspecified.** Selection is on valid but only test/train negatives
  were specified. Added the explicit **valid-split AUC/FITB (negatives drawn from valid)** + the three
  **split-scoped negative pools never cross-leak** invariant + tests (train_head row, FROZEN metric, C1, tests/
  row, verification).
- **[Med] F4 — train negatives lacked the no-cooccurrence rule** → could train BCE on false negatives. Applied
  the **anchor-no-cooccurrence rule (train-split scoped)** to train negatives (train_head row + C3).
- **[Med] F5 — mechanical "not-co-worn" labels framed as compatibility truth.** Added a trap-guard: the
  benchmark measures **co-worn-ness, a proxy** for compatibility, not human incompatibility; `results.md` must
  frame it as a co-worn proxy.
- **[Med] F6 — H26 edge omits Lens/context** though production compatibility is lens-scoped. The seam INPUT is
  now **partial-outfit + candidate + lens/context (§6.3 `RequestContext`)** across all four homes (plan ×2, spec
  §20, §23-H28); §11 already listed "lens" in the scorer input. (Ripple caught in re-read: §20/§23-H28 still said
  just "partial-outfit + candidate.")
- **[Med] F7 — FITB inconsistent-verdict denominator unpinned** (could inflate accuracy). Pinned **inconsistent
  = miss (never excluded)** + a wrong-vs-excluded sensitivity table (success criterion, gpt_judge row, C4, L1-06).
- **[Med] F8 — privacy consent narrower than the workflow** (closet photos → OpenAI vision API). Added required
  **explicit third-party-API consent + anonymized opaque owner IDs/paths + garment-only crops** (protocol intro +
  step 7).
- **[Low] F9 — Polyvore counts stale after filtering.** Report **raw + post-filter + dropped share** (Approach 1
  + FROZEN split/unit).

**Ripples caught in the focused re-read** (beyond the direct fixes): F2's overclaim restated in 3 spec homes;
F7's ambiguous wording in the L1-06 literature note; F6's seam-input contract out of sync between plan and the 2
spec homes. All closed.

Spec `Fitted_Spec_v2.md` touched (§11, §20 ×2, §23-H28) — now **1295 lines** (the next compaction watch as it
nears 1,500). H26 plan 542 → **569 lines**. No code touched; floors unaffected (pytest 751 / jest 375). Not
committed.
