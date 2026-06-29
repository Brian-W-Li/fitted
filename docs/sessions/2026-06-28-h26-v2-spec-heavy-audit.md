# 2026-06-28 — H26 v2 spec heavy audit (pre-implementation) + Codex/Gemini merge

Heavy multi-round audit of `docs/plans/h26-compatibility-spike-v2.md` (the fresh-research "v2" rewrite),
**before any implementation**, for the v2-vs-existing build-doc choice. Converged. Then merged a parallel Codex
review (37 findings) + a user-fetched Vasileva Table 5. **No code touched; `fitted_core/` untouched; nothing
committed; only the v2 plan edited.** This note is the durable record (read on demand; not required context).

> **⚠ READ FIRST — temp-1 content below is SUPERSEDED.** Every `temperature=1` / "temp-1-only" / "route temp bug
> → 400" instruction in the R-recommendations and FINALIZATION sections is **overturned by the THIRD PASS section
> at the bottom** (live smoke test 2026-06-28: `gpt-5.4-mini` accepts arbitrary temperature; the judge is **temp
> 0**; the routes keep the model swap at the legacy 0.5/0.6 temps; there is no 400). Those bullets are preserved
> as the historical record of a belief we later disproved — the **THIRD PASS is the canonical state.**

## Method & convergence
- R1: 6 cold-context parallel lanes (A merit · B ML/stats · C consistency · D readiness · E canonical-fidelity ·
  F v2-vs-existing delta) + my own catch-net full read. Fable unavailable → merit used the **dual-read substitute**
  (cold merit agent + my independent read; both → GOOD-WITH-CAVEATS).
- R2: regression-of-fixes lane + fresh catch-net on under-audited §7/§9/§11/§14/§15. Found 2 residue-twins + ripples.
- R3: final convergence regression + residue grep → **zero new load-bearing findings.**
- Then: Codex 37-finding merge (each verified at source) + the Vasileva-table correction.
- **Every quantitative anchor acted on was re-verified at a primary source by the main loop** — never inherited
  from a lane. (Lane B's "verified to the digit" table was itself partly wrong — it inherited the spec's
  disjoint/non-disjoint mislabel; the real table resolved it.)

## VERIFIED FACTS (don't re-derive; primary-sourced)
- **`gpt-5.4-mini`**: real (released 2026-03-17; snapshot `gpt-5.4-mini-2026-03-17` exists). **$0.75 / $4.50** per
  1M in/out; Batch/Flex −50%; cached-input −90%; 400K ctx; structured outputs + image input. ~~**TEMPERATURE=1 ONLY**
  — any other value → 400 (reasoning-class restriction). *Source: OpenAI developer docs.*~~ **← WRONG; CORRECTED
  2026-06-28 (see final section): gpt-5.4-mini accepts ARBITRARY temperature (live smoke test, temp=0.5 → HTTP 200);
  the "OpenAI developer docs" attribution was a mis-record of an untested code comment.**
- **`gpt-4o-mini`**: legacy (off OpenAI's pricing page 2026, still callable, no sunset). $0.15/$0.60.
- **Marqo-FashionSigLIP HF card**: fine-tuned FROM **WebLI SigLIP ViT-B/16** (NOT LAION-2B). Cat→Product MRR:
  FashionSigLIP 0.812, WebLI-SigLIP-B/16 base 0.751, LAION-2B-B/16 0.743, FashionCLIP2.0 0.741. Original FashionCLIP
  not on card; **0.776 = Marqo's own FashionCLIP** (a different model). The clean fine-tuning delta is 0.751→0.812.
- **Polyvore Outfits (Vasileva 2018)**: disjoint (Outfits-D) = **32,140 outfits / 175,485 items** (16,995 train /
  15,145 valid+test); non-disjoint = **68,306 / 365,054** (NOT 261,058). Han 2017 "Maryland" = 21,889 outfits,
  random-category negatives (different, smaller set — don't conflate/headline).
- **Vasileva 2018 Table 5 (user-fetched the real table — Gemini had HALLUCINATED a wrong one):** columns are
  Polyvore Outfits-D (disjoint) | Polyvore Outfits (non-disjoint), each FITB Acc / Compat. AUC.
  - **DISJOINT:** Bi-LSTM+VSE 39.4/0.62 · SiameseNet 51.8/0.81 · CSN best (512-D) **55.2/0.84**.
  - non-disjoint: SiameseNet 52.9/0.81 · CSN best 56.2/0.86.
  - ⇒ The specs' "0.81 SiameseNet / 0.84 Type-Aware (disjoint)" anchors are **correct**. The only error was FITB
    *ranges* (51.8–52.9 / 55.2–55.7) that mixed in non-disjoint — fixed to disjoint points 51.8 / 55.2.
  - **The existing spec's hard floor (AUC≥0.81 ∧ FITB≥50%) is well-calibrated** (0.81 = disjoint untyped SiameseNet;
    50% sits just under its 51.8% disjoint FITB). NOT indefensible.
  - OutfitTransformer disjoint ceiling 0.88 / 59.48% (arXiv:2204.04812) — kept; not re-verified at source.
- **Code state (verified):** `SignalScorer` item-level `score(item, context)` at `sampler.py:108/119`; cold-start
  gate `interaction_count < MIN_SIGNAL_THRESHOLD` at `sampler.py:251`; `ranker.py` reserves no scorer hook;
  `route.ts:450` + `regenerate:461` = `gpt-5.4-mini` (uncommitted swap from `gpt-4o-mini`), images stripped before
  the LLM call; the legacy route partitions by `category` (not 5-value `clothingType`); the LLM payload sends
  name+category+subCategory+layerRole+colors+pattern+seasons+occasions (richer than "category+title").
- **⚠ The gpt-5.4-mini production swap is UNCOMMITTED and the routes still set `temperature: 0.5/0.6`** → every
  recommend/regenerate call would 400. The fork is not deployed (the live app is the team's repo), so no user impact.
  **[CORRECTED 2026-06-28 (final section): gpt-5.4-mini takes ANY temperature — there is NO 400; the routes now keep
  the model swap @ legacy 0.5/0.6 with the false comment removed.]**

## FIXES APPLIED IN PLACE (all in the v2 plan only; ~40 edits across rounds + Codex merge)
Citations/factual: non-disjoint count 365,054; Marqo matched-base → WebLI SigLIP (×3 sites); 0.776 misattribution;
Popli mechanism (street→catalog, not Polyvore→Polyvore-D); §6 disjoint FITB points 51.8/55.2 (+ non-disjoint noted);
the gpt-4o-era ~85-tok/image caveat. Temperature: §8 ×3 + envelope `temperature=1` + §16 caveat + §15 file-list +
§0/§9 "FITB parity". Consistency: §10 domain-drop **sign** (catalog−closet, was reversed); §13 seam "second distinct
seam (sampler slot kept)"; §7 grid reconcile; §11 family-wise-correction bullet + seed note; §3 "AUC unit"; §6
"tests not confirms"; §8 image-only = text-memorization control (×2); §12 modality nuance; §6.3 ref; §16 snapshot
freeze; §8/§14 payload-logs-vs-privacy; §28 production text fields; §31 tense; §32 <2-item drop; §16 items 4/5/6/7/8;
§14 crop (faces/people blurred, garment kept in real context) + consent enumerates recipients; §15 C5 consent
precondition + closet_manifest.json + metrics.schema.json deliverables; §9 GPT synchronous latency readout.
**Canonical docs left untouched** (v2 not adopted; §16 discloses the reconciliations for adoption-time).

## VERDICTS
- **Merit: GOOD-WITH-CAVEATS** (dual-read converged). v2 is net-stronger science than the existing spec, carries
  the honest "determinism/offline/per-edge-availability parity, not quality-superiority" thesis faithfully.
- **§16 delta: 7 improvements · 2 improvement-with-caveat · 1 regression** (the dropped hard floor).
- **Readiness: ready-after-fixes** (the open recommendations below are the remaining contract pins).

## OPEN RECOMMENDATIONS / THINGS TO DO (the merged pile — mine + Codex; design/scope/infra, deliberately NOT auto-applied)

### A. User-owned forking decisions
- **D1 — Adopt v2 or the existing spec as the build doc.** Recommendation: **adopt v2** (stronger science) **after**
  R1+R2 below. The existing spec is `docs/plans/h26-compatibility-spike.md`; on adopt, move the canonical pointers
  (CLAUDE.md, spec §20 H26 row + §23-H26, docs/README.md) from the existing spec to v2 + apply the §16 reconciliations.
- **D2 / R2 — The gpt-5.4-mini production swap.** *[SUPERSEDED — temp-1 myth; see THIRD PASS. Resolved: kept the
  model swap at legacy temps 0.5/0.6, judge = temp 0.]* Either (a) **revert to gpt-4o-mini** (judge mirrors what the code
  actually ran; supports temperature) + revert the canonical/CLAUDE.md gpt-5.4-mini edits, OR (b) **keep gpt-5.4-mini**
  and fix both routes (drop/set temperature=1) + commit with a design note + accept FITB needs K-sample voting at temp 1.

### B. Pre-registration completeness — finish BEFORE freezing `preregistration.md` at C2 (regardless of doc)
- **R1 — Restore the absolute accuracy floor as a GATE** (AUC≥0.81 ∧ FITB≥50%, well-calibrated per the real Vasileva
  table) OR add a judge-competence precondition to gate B. v2's all-relational gates re-open L1-02 (a weak head can
  GO via parity with a weak mini judge). *Top recommendation; Codex #3 + Lanes A/B/F concur.*
- **#2 — Freeze the gate-C numeric floors** (existing spec had closet AUC ≥ 0.70 / drop ≤ 0.12; v2 left them as "pre-set
  floor" placeholders) **and δ.** Pre-register δ on substantive grounds at C2; move only N against the C4 pilot; add an
  explicit "underpowered/inconclusive → no-go" third verdict. (R5 + Codex #2/#5.)
- **#12/#13/#14/#15 — Reproducibility artifacts:** pin HF model revision SHA + preprocessing hash + dependency lock;
  make the trained head a committed artifact (checkpoint hash + training config + manifest path); freeze the
  hyperparameter grid/optimizer/epochs/early-stopping/tie-breaks/Torch determinism (merge with the head-arch pin);
  specify the human-agreement calibration set (size, labeler, disjoint-from-gate-B-500).
- **R3 — Temp-1 judge harness:** the FITB single-call is stochastic → freeze the K-sample + aggregation protocol at C4;
  re-derive the cost/size story (the "much smaller gpt_judge" saving is partial). Add a C4 OpenAI API smoke test
  (Chat-Completions vs Responses params, logprobs-on-image, system_fingerprint, temp support — Codex #18).
- **#6 — metrics.json schema** (gate authority needs one; deliverable added to §15, write the schema at C2/C3).

### C. Design bets to resolve
- **R4 / Codex #7 — STL/CTL:** demote from "headline" to a caveated task-shifted upper-bound supplement (scene↔product
  ≠ whole-outfit; link-rot); gate the build on measured resolvable-yield; specify scene-embedding + 21→5 map + negative
  protocol, or drop to the hand-curated fallback. Consider it as a caveated 3rd gate-C disjunct so transfer isn't purely
  noise-bound.
- **Gate-C structure (Lane B):** the AND-gate forces a foregone no-go because gate C (closet) is unpowerable
  (effective-N = cluster count). Consider making A∧B mechanical, C an advisory risk readout.
- **Head architecture (Codex #14/#22 + Lane D):** pin MLP (not "MLP/bilinear"); type-pair representation + cardinality
  (10 vs 15); edge symmetrization (ordered MLP input over an unordered edge); item-level ablation construction +
  parameter-budget matching; pre-register the family-wise correction for the ablation CIs (now flagged in §11).
- **R7 — item-popularity confound** in negatives: add an item-popularity-only sanity baseline (the category-co-occurrence
  check won't catch it).
- **R8/#24 — Gate-B CI** should propagate the judge's temp-1 run variance (two-stage bootstrap); restore B≥10,000 for
  decisive bounds; restore the co-worn-proxy framing trap-guard. *[temp-1 → read as temp-0 run variance; see THIRD PASS.]*
- **Scope (Lane D/B):** designate an explicit minimal-headline shippable path (FashionSigLIP + pairwise head + image-only
  judge + one transfer probe → gates A/B/C); mark backbone/shape/STL-CTL/secondary-judge/2nd-wardrobe as stretch. Net
  scope likely GREW vs the spec v2 claims to simplify.
- **Codex #25/#30/#33/#34:** Polyvore negative-scarcity fallback after strict filtering; pytest isolation (h26 tests
  can't leak into root suite); mechanical dataset-access "blocked/no-headline" output state (mvasil gating contingency —
  a denial = no disjoint headline corpus); restore the synchronous per-request latency to substantiate "latency-infeasible".

### D. Notes / low-priority
- Codex #1 (adoption pointers) = D1's checklist, not a v2 bug. #29 (legacy category buckets) = M5 concern, minimal H26
  impact. #36 (snapshot syntax) = verified real, fine. #37 (stale cost helpers) = h26 is isolated; verify no silent reuse.

## RECOMMENDED NEXT-STEP SEQUENCE
1. ✅ (done) Persist this record.
2. Decide **D1 (adopt v2)** + **D2/R2 (model swap)**.
3. One focused **"pre-registration finalization" pass**: fold the resolved design bets (Group C) + the freeze-completeness
   cluster (Group B) into the chosen doc, producing the build-ready spec + the frozen `preregistration.md` content. This
   is `/spec`-style finalization, not implementation.
4. Then implement **C1** (scaffold + data loader + loader tests) under the light build-and-audit loop.

## Caution recorded
**Gemini hallucinated Vasileva Table 5** on the first fetch (gave 0.77/0.81 AUC, 36.4%/46.3% FITB — fabricated). The
real table (user-screenshot) confirms the specs' original anchors. Lesson: even a "fetched" secondary read needs a
primary cross-check; the user's screenshot of the actual paper table was the ground truth.

## FINALIZATION (2026-06-28, later — Brian chose "adopt v2" + "run the finalization pass")

v2 is now the **canonical build doc**, finalized to build-ready. Changes (v2 doc only, except the canonical pointer moves):

**Frozen gate block (§1/§12 — the core of `preregistration.md`):**
- **Gate D restored** (absolute floor, cost-independent): **outfit-level AUC ≥ 0.81 ∧ FITB ≥ 50%**, alongside the
  relational A/B/C — closes L1-02 (a weak head can't GO by tying a weak mini judge). 0.81/50% verified well-calibrated
  to the disjoint Vasileva band; gates the outfit-level AUC (FITB unit-agnostic); accessory-exclusion disclosed.
- **Gate-C floors frozen:** closet AUC ≥ 0.70 OR drop ≤ 0.12 (from the existing spec). Gate C stays a hard
  conservative gate (per Brian's earlier ratification).
- **δ = 5 FITB pts pre-committed at C2 on substantive grounds; only N moves to reach HW≤δ; δ never moves;
  N-capped + HW>δ → gate B "underpowered → no-go"** (kills the forking-path). One FITB Q per distinct outfit (N_eff=N).
- §1 registers the gate block as the second committed block of `preregistration.md`; near-gate rule updated to A/B/D conjuncts + C disjunction.

**Design bets resolved (owned, with rationale):**
- **Head-arch pinned:** 2-layer MLP (not "MLP/bilinear"); `[emb_i⊕emb_j, |Δ|, emb_i*emb_j]` symmetrized
  (½[f(i,j)+f(j,i)]); learned type-pair embedding over the 15 unordered 5-type pairs; frozen optimizer/grid/epochs/
  early-stop/Torch-determinism; trained head ships as a committed artifact (hash+config+manifest). Item-level
  ablation arm: g(emb)/mean, capacity-matched, CI-tested.
- **STL/CTL demoted** to an optional, non-gating, task-shifted upper-bound supplement (closet is the gate-C input);
  build only if resolvable-yield clears a C5 threshold.
- **Item-popularity confound** fixed in §4 (it is NOT chance-by-construction) + an item-popularity-only sanity baseline (§7).
- **B = 10,000** restored (decisive tail quantiles); gate-B bootstrap should propagate judge temp-1 run-variance (two-stage). *[temp-1 → temp-0; see THIRD PASS.]*
- **§3** reconciled: outfit-level AUC is gate-D input + band readout; pair-level unit gates A + the gate-C drop.

**Freeze/reproducibility cluster (§5/§6/§8/§11/§15):** pinned HF model revision SHA + preprocessing hash + dep
lock; metrics.schema.json + closet_manifest.json deliverables; family-wise correction over the ablation CIs;
calibration-set spec; K-sample temp-1 judge protocol; pytest isolation; dataset-access "blocked → no-disjoint-headline"
state; Polyvore negative-scarcity drop-rule; co-worn-proxy framing; §9 GPT synchronous latency; §14 crop/consent.

**Adopt-v2 canonical moves:** build-doc pointers moved to v2 in CLAUDE.md, spec §20 (H26 row + scorer-seam rung),
§23-H26, §23-H28, docs/README.md; the **in-spike-ablation conflict reconciled** in §20×2 + §23-H28 (canonical no
longer says "no in-spike ablation"); canonical §23-H26 band corrected to the disjoint 0.81–0.84/52–55%; the prior
`h26-compatibility-spike.md` carries a **RETIRED** banner.

**Still OPEN — one item for Brian:** the gpt-5.4-mini production-route **temp bug** (route.ts/regenerate set temp
0.5/0.6 on a temp-1-only model → 400). *[SUPERSEDED — NOT a bug; see THIRD PASS: gpt-5.4-mini accepts any
temperature, the routes correctly keep 0.5/0.6, there is no 400. This item is CLOSED.]* Decide
keep-gpt-5.4-mini+fix-temp-to-1 vs revert-to-gpt-4o-mini (fork not
deployed → no live impact). **Next implementation step: C1** (scaffold + data_loader + loader tests); freeze
`preregistration.md` at C2.

Boundary: `fitted_core/` untouched; nothing committed. Canonical docs reconciled conflict-free (verified: no stale
old-spec pointer, no "no in-spike ablation" residue).

## THIRD PASS — 2nd Codex review merge + the temp-1-only MYTH (2026-06-28, later still)

A second independent Codex review (6 findings) was merged into the v2 build doc; then a **live API smoke test
overturned this note's own temp-1-only "verified fact"** (struck above). Still **nothing committed**; `fitted_core/`
untouched. Touched: the v2 build doc, the two recommend routes (model swap only), `reference-openai-gpt54mini` +
`MEMORY.md`. Each Codex finding was re-verified at source by the main loop before acting (Codex was clean this round —
no hallucinations).

**Codex's 6 findings — all verified, all fixed in the v2 doc:**
1. *(blocker)* Gate-D **outfit-level AUC was frozen but unimplementable** — no outfit-negative construction / cluster
   unit / metrics field existed. Added the construction as §4's single home (each positive outfit → one negative by
   replacing every item with a same-fine-category non-co-worn item, per the verbatim Vasileva §5 quote; outfit score =
   mean edge-compat; pooled AUC cluster-bootstrapped at the source-outfit unit; `outfit_auc` field) + wired §3, §12
   (`CI_low(outfit_AUC) ≥ 0.81`), §15 (C1/C2 + tests). *(C2 still confirms the exact corruption rule vs Vasileva's
   compatibility protocol; if the published AUC used random-category negatives, ours is harder → conservative floor.)*
2. *(blocker)* The C4 "blind to C3" rule wasn't enforceable. Made it build-order-enforced: C3 emits valid-split
   selection metrics only; held-out test metrics (incl. gate-D / gate-B) stay locked until the C4 judge addendum is
   committed; `evaluate.py` refuses test metrics unless both files exist (§1 / §12 / §15 C3-C4).
3. *(important)* The item-level-vs-pairwise **shape ablation was both a core deliverable** (§0 / §6 / §12 + canonical
   §20 / §23-H28) **and "stretch"** (§15) — a contradiction. Moved it into the minimal headline path; the backbone
   ablation stays stretch.
4. *(important)* "Capacity-matched" item-level head wasn't pinned → pinned at C2: 2-layer MLP `g(emb)→scalar`,
   mean-of-scalars, same cache / optimizer / grid / valid-selection, params within **±5 %** of the pairwise head,
   §11 paired bootstrap.
5. *(important)* temp-1-only asserted as fact but unverified → softened (then debunked — below).
6. *(important)* Header said "Not yet canonical / Brian chooses" and §16 had "→ Reconcile if adopted" to-dos →
   rewrote header to canonical/adopted; converted §16 pointers to Reconciled/Moot (each verified against canonical —
   the shortlist-quality clause and the "no in-spike ablation" residue confirmed absent by grep).

**The temp-1-only MYTH (the headline correction).** A live call to `gpt-5.4-mini-2026-03-17` at `temperature=0.5`
returned **HTTP 200 + a normal completion** (so did temp=1). gpt-5.4-mini accepts **arbitrary temperature** — the
restriction never existed. Origin: an **untested inline comment we added during the uncommitted gpt-4o-mini →
gpt-5.4-mini swap** ("other values return a 400"), **not** inherited from legacy (legacy ran gpt-4o-mini @ 0.5/0.6
with an innocuous "more variety" comment) and **not** in any OpenAI doc (Codex couldn't find it; this note's
"Source: OpenAI developer docs" was a mis-attribution). Lesson: a code comment is not a primary source — measure it.
`system_fingerprint` came back **null** on the call — don't lean on it for reproducibility (noted for C4).

**Consequences (all applied):**
- **Judge reframed to `temperature=0`** across the v2 doc (§1 / §8 / §9 / §11 / §12 / §15 / §16) — lowest-variance,
  strongest, cheapest LLM baseline; a small K-sample stays only for GPT's residual non-determinism (not bit-reproducible
  even at temp 0). Net effect: the spike is *cheaper + cleaner*, and the determinism-headline argument is *stronger*
  (the LLM gets its best shot and still can't be reproduced; the trained head is bit-exact).
- **Routes fixed:** kept the gpt-5.4-mini model swap; reverted `temperature` to the legacy **0.5 (recommend) / 0.6
  (regen)**; deleted the false comment (restored the legacy "more variety" note on regen). The route diff vs HEAD is now
  **only the model swap**.
- **Anchor corrected:** gpt-5.4-mini has **NO temperature restriction** (smoke-tested) — supersedes the struck
  "TEMPERATURE=1 ONLY" line and the "would 400" warning above. Pricing / snapshot unchanged.

**State / next:** the v2 doc is internally consistent + build-ready for C1 (judge model/prompt pin at C4). Immediate
next step = a **3rd Codex pre-implementation review** (prompts prepared this session), then **C1** (scaffold +
`data_loader.py` + loader tests). Nothing committed.
