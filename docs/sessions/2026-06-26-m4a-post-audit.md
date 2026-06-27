# 2026-06-26 — Post-M4a heavy-loop audit (pre-M4b)

Comprehensive multi-lane audit run after M4a (C1–C3) landed, before M4b/C4. Goal: bulletproof the whole
project — code + tests + the doc spine — and land what's load-bearing. Plus a dedicated **ambition-merit**
audit (is the north-star itself a good ambition, not just are we faithful to it).

## Method

Three heavy-loop audit rounds + one ambition-merit panel, all parallel-subagent workflows with an
adversarial-verify pass; **every load-bearing finding re-verified against source by the main loop before any
fix** (per [[feedback_verify_before_answering]]/[[feedback_citation_accuracy]]).

- **Round 1** — Lane 0 (ambition fidelity) framing → 8 parallel lanes (correctness, tests, doc-consistency,
  conciseness, pointers, stale/dead-code, security, forward-readiness) + verify. 17 agents.
- **Round 2** — regression-audit of Round 1 fixes + thorough doc-consistency redo + deep Python mutation pass
  + forward/security 2nd pass. 5 agents.
- **Round 3** — full regression sweep of all session edits + completeness critic (the deployed routes,
  schema-test match, README, fresh ground). 3 agents.
- **Ambition-merit panel** — 4 adversarial critics (product/market, ML-feasibility, architecture/effort,
  portfolio-value) + synthesis. Fable seat was unavailable → main-loop dual-read substitute (per
  [[feedback_decision_method]]).

**Convergence:** Round 1 ~8 load-bearing → Round 2 **1** load-bearing (a doc conflict) → Round 3 **1**
load-bearing (a fix-regression-of-omission — the 7th home of the Round 2 reconciliation). Each round's
regression lane verified the prior round's fixes clean; the Python substrate got two independent clean passes
(0 load-bearing); the final straggler's fix was self-verified as the last of its class (grep: 0 stale phrases,
all 11 redaction-cascade homes agree). Loop converged.

## Outcome

**No blockers. No correctness bugs in the committed M4a code or the closed Python substrate.** 22 fixes landed
(6 code, 16 doc); tests green throughout (jest 288, pytest 666; eslint clean on touched files). The committed
state faithfully serves the north-star (no drift). One strategic finding on **emphasis/sequencing** of the
ambition (below) — for Brian to decide, not unilaterally actioned.

### Fixed — code (M4a hardening)

| # | Fix | Finding |
|---|---|---|
| 1 | `lib/clothingType.ts`: moved unambiguous `slacks` from `DRESS_MODIFIER_EXTRA` into `BOTTOM_KEYWORDS` (bare "slacks" was mis-partitioning to `top`); exported `DRESS_MODIFIER_EXTRA`. Left `oxford/mule/pump/brogue` in the modifier set (deliberately ambiguous — "oxford shirt" is a top). | L1-02 |
| 2 | `tests/deriveWarmth.test.ts`: drift-guard `it.each` now covers `...DRESS_MODIFIER_EXTRA` (was only the rung arrays); added a `slacks`→bottom test. | L2-03 |
| 3 | `lib/wipeGuard.ts` + test: tightened so `localhost`/`127.0.0.1` reject a right-side dot (closes the `localhost.evil.example.com` authorize bypass); `fitted-dev` keeps its subdomain dot-boundary. Strictly fail-closed; all prior cases still allow. | L1-03 |
| 4 | `scripts/seed-test-wardrobe.ts`: added the `isWipeAllowed` host guard — it was the un-gated destructive sibling of `wipe-db.ts`, writing test items onto the **oldest real user** with no host check (shared-Atlas footgun). | L7-01 |
| 5 | `docker-compose.yml`: bound Mongo to `127.0.0.1:27017` (was `0.0.0.0`, unauthenticated dev DB exposed to LAN). | L7-02 |
| 6 | `.env.sample`: blanked the teammate HF-Space `CV_SERVICE_URL` default; fixed the stale Gemini comment. | L6-02 / L6-04 |

### Fixed — docs (canonical-truth reconciliation)

| # | Fix | Finding |
|---|---|---|
| 7 | spec §19: bare `§10`/`§9.1` (point at the *plan*, not spec) → "the M4 plan's §10.3 / §9.1". | L5-01 |
| 8 | spec §8 + §19: refreshed C3-shifted legacy-route cites — `isValidOutfitStructure` :601-664→:530 (was past EOF), footwear inject :583-598→:512-527, recommend `inferItemType`→:472, regenerate →:484 (+:225 string-grep loop, R2-1). | L5-03 / R2-1 |
| 9 | spec §20 ladder: M4a row `[NEXT]` → `✅ done (C1–C3)`. | L6-01 |
| 10 | spec §15.1 + plan C4 serde map: added the engine **partition-key** rename `type`→`clothingType` (a name change a generic snake→camel won't produce) + `image_url`→`imageUrl`; the 3-tag map alone would mis-key the trainable corpus. | L8-01 |
| 11 | `User.ts` cascade cite reconciliation across 5 homes: `:24`/`:30-31` → `:27` hook / `:33-34` deleteMany. | L5-02 |
| 12 | plan §8.4: `rank()` cite `ranker.py:140`→`:834`. plan §8.3: added the `cvModelVersion?` field C5 requires. | L8-02 / L5-04 |
| 13 | **Redaction-cascade triangle** — reconciled to "M4 = `wardrobeimages` cascade only; snapshot redaction reserved-not-wired; §23-H43 = SEAM-RESERVED" across **all** homes: spec §23-H14 (was claiming M4 wires redaction), §19 typo, **and the 7th-home straggler** plan §3 hole-tracker (was still "wires the cascade / RESOLVED-DESIGN"). | R2D-1 / R2D-2 / R3-1 |
| 14 | Orientation docs: CLAUDE.md arc + `ml-system/README.md` + `docs/README.md` updated to "M4a done / M4b next" (+ added the active plan to the README read-first list); CLAUDE.md CV note de-staled. | R2D-3 / R3-4 / L6-02 |
| 15 | **Process:** added **ambition-merit** as a first-class heavy-loop audit lane in CLAUDE.md (merit vs fidelity) + memory [[feedback_audit_ambition_merit]]. | (user directive) |

### Flagged — not fixed (chips / deferred, all non-load-bearing)

- **PATCH handler destructures unused `WardrobeImage`** (`wardrobe/[id]/route.ts:50`) — trivial unused var; pre-existing, in a kept-host file. (F3)
- **Dead `USER_PREFERENCES` prompt rule** in legacy `recommend/route.ts:433` (orphaned by C3; regenerate has none) — legacy route, deleted wholesale at the M5 cutover; don't let a future "simplify" read it as live. (L6-03)
- **Pre-existing `tsc --noEmit` errors** in untouched test files (shared top-level helper names across non-module test files) — not introduced this session; jest is green. (R3-6)
- **`wipeGuard` residuals** (by-design): `fitted-dev.<anything>` still authorizes (intended threat model = accidental shared-Atlas, not crafted hostnames); comma replica-set URIs parse "(unparseable)" → fail-closed; `localhost.localdomain` now refused (safe direction, `FITTED_ALLOW_WIPE=1` escape hatch). (R2-2/R2-3)
- **Weather string used raw in `response.py` scoring** while occasion is normalized — by-design (weather is already a canonical bucket); an M5 forward-compat note, not a bug. (R2C-8)
- **§18 "Deployed today: external HF Space"** — accurate for the *deployed team app* (the W-track baseline); the fork's blank `CV_SERVICE_URL` is a separate concern already captured. Left as-is. (R3-5)
- Known §19 trust-boundary gates (interactions/account/auth-sync/images/cv-infer ownership) + H14 image-replace ordering + the H28 outfit-level seam — all **confirmed still correctly tracked** as M5/W-track-deferred, neither closed nor widened by M4a.

### Held for sign-off (NOT actioned)

- **L4-01 — M4 plan compaction.** The plan is **1750 lines** (single-doc backstop ~1500) and the default
  reading list (CLAUDE.md + spec + plan) is **3222 lines** (backstop ~2000) — both over budget; the plan's own
  §13.2 item 5 flags compaction "due after M4a lands," which it now has. The breach is also load-bearing: §0–§13
  physically still contain superseded prose (`backfill`, `fixtures-only`, "M4 implements the gate functions")
  that §14 reverses, so a top-down reader acts on it before reaching the §14 correction. **Proposed plan
  (needs Brian's go-ahead — a large doc rewrite):** collapse §0–§13 (~1400 lines) to a ~250-line forward-tense
  digest that keeps verbatim only the blocks the live C-ladder references (§8.3 Mongoose sketch, §8.4 Option-B
  + 3 discard sites, §8.8 index plan, §9.3 H19 reducer, §10.2/§10.3 classifier) + the named trap-guards; point
  to the spec for every canonical decision. Est. → plan ~550, reading list ~2000.

## Ambition-merit verdict (the "is it a good ambition?" audit)

Four independent adversarial critics + a main-loop synthesis (Fable substitute). **All four converged on
`sound-with-caveats`** with the *same* core thesis. My synthesis:

**Verdict: a good ambition for its actual goal (portfolio / technical depth), but mis-emphasized — `good-with-refocus`.**

- **Is it good? Yes** — for the stated goal (launch/growth are explicitly out of scope). The green-shirt
  problem is real (full-closet paradox, ~80/20 wear distribution). The *delivered* asset — the contract-first
  candidate/rank-split substrate, deterministic ranker, orphan-rescue vertical, exposure-bias-aware
  GenerationSnapshot design, 666 deterministic tests — is genuine senior-level systems engineering, and the
  honesty discipline (§5 [NOW]-vs-destination, §21 anti-overclaim, the §23 holes register) is research-maturity
  most undergrad portfolios lack. As a *product* it's weaker (single-shot styling is commoditizing via
  GPT-4o/Gemini-with-photos; the moat — accumulated within-user memory — needs the very users that are out of
  scope), but it was never trying to win as a product.
- **Are we going toward it? Yes, faithfully** — no drift (Round 1 fidelity lane); M4a actively *repairs* a
  named brittleness (2-value → 5-value `clothingType`). The risk is not drift; it's **sequencing**.
- **The one real problem (all 4 critics):** an **emphasis inversion**. The spec headlines the unbuilt,
  most-data-dependent part (M6 *learned personal graph from interaction data*) as the centerpiece, while the
  delivered substrate is framed as "humble mechanism." On a no-users fork the behavioral/personal-graph
  learning is data-starved by construction (H9 prevalence ≈ 0) and at [NOW] is honestly not even ML (it's the
  v1.2 additive heuristic). The **feasible** ML dive is the **H26 universal content-compatibility model on
  public corpora** (Polyvore-style) — zero users, privacy-safe, yields a real offline number — but it's
  under-emphasized and rides two unvalidated risks: **H26** (domain transfer from curated flat-lays to real
  messy closets — asserted, not demonstrated) and **H28** (the most-built `SignalScorer` seam is item-level,
  but compatibility is pairwise/outfit-level — the "swaps in with no code change" promise is undercut).
- **Top risks:** (a) "all substrate, never the dive" attrition (solo dev; long ladder M4b→M5→M6 after
  W/B/R tracks); (b) H26 domain-transfer is the single load-bearing claim for the whole dive, unvalidated;
  (c) the H28 seam shape is wrong for the dive and only "reserved/OPEN"; (d) a reviewer reads strong ML framing,
  then finds the ML is a plan / data-starved.
- **Highest-leverage move (all 4 independently recommend):** **de-risk H26 now with a small offline
  public-corpus spike** — train/eval a content-compatibility baseline on a Polyvore-style corpus *before* M6
  (even before M5). One move validates H26 feasibility, empirically resolves the H28 seam shape from the model
  side, converts the centerpiece from "staged ambition" to "demonstrated result" with zero users, and
  de-risks the attrition problem by reaching a real ML number early.
- **Refocus (keep the vision, re-point the spotlight):** for the *portfolio artifact*, lead with the substrate
  + eval methodology as the delivered depth and frame the style graph as the motivating narrative; split §1's
  dive claim so the trainable-at-portfolio-scale contribution = the universal content prior, and the behavioral
  personal-graph is honestly [NORTH-STAR]/synthetic-only on this fork.
- **Do NOT cut:** §2 "graph is never the interface", §5 honest labeling, §21 anti-overclaim, the
  GenerationSnapshot exposure-bias/full-funnel rigor (un-retrofittable + a real differentiator), the
  contract-first split.

These are **strategic recommendations for Brian to decide** — none were baked into the spec unilaterally.

## Test baselines (end of audit)

jest **288 passed** / 16 suites; pytest **666 passed**; eslint clean on touched files.

## H26 spike — research (web-verified, 2026-06-26)

Follow-up to the ambition verdict: scoping the offline public-corpus compatibility experiment that de-risks
H26 + settles the H28 seam shape, with **zero users**. (3-agent research workflow with a fact-check pass; the
verifier corrected 3 drift-prone claims — folded in below.)

**Dataset — primary: Polyvore Outfits (Vasileva et al. 2018, ECCV; arXiv:1803.09196).** ~68k human-curated
outfits / ~261k items, ships compatibility + FITB tasks pre-split with a hard **disjoint** variant (no item
overlap train/test — the honest cold-start analog). License reality: HF tag says CC BY 4.0 but the set is
**gated, research-use-only, with murky underlying image copyright** (Polyvore.com shut 2018) — fine for a
portfolio spike, *not* freely reusable. **Fallback (non-gated):** Maryland Polyvore (Han 2017) via Kaggle/Drive
mirrors, or the Apache-2.0 `Marqo/polyvore` HF copy (item images, but outfit groupings must be reconstructed).
SHIFT15M = features-only (no pixels; good for a temporal-distribution-shift probe, can't touch the photo gap).

**What it measures (pick AUC@category-aware-negatives + FITB@4 as headline):**
- **Compatibility AUC** ↔ the binary edge/validator gate. **Negative-sampling protocol is everything** —
  *random*-item negatives inflate (~0.84) vs *category-aware* negatives (the honest ~0.65 for the same Bi-LSTM).
  Always report the split + negative protocol next to the number or it's meaningless.
- **FITB@4 accuracy** (hit@1 over 4 candidates; chance 25%) ↔ orphan-rescue "pick the completing item."
- **NDCG@k / Recall@k (CIR)** ↔ ranker shortlist ordering (Fitted §21's named metrics). Low absolute (huge
  gallery) — read as relative ordering.
- **Honest target band on the disjoint/hard split:** ≈ **0.82–0.86 AUC, ~52–55% FITB** (Siamese ~0.81 →
  type-aware/Vasileva 0.82 disjoint). Do NOT compare to the inflated ~0.95-AUC/78%-FITB easy-regime papers
  (random-negative Maryland split). OutfitTransformer (WACV 2023, ResNet-18) ~0.93/67.1% is the upper ref a
  from-scratch spike should not expect to match.

**The decisive baseline = GPT-4o-as-JUDGE** (not generator — generation is already validated, Spearhead §E).
Feed GPT-4o the *same* FITB/AUC items (text-attribute AND vision variants, candidate-order randomized for the
known position bias), score head-to-head, and **log GPT's $/1k-edges + latency**. Decision on TWO axes:
the trained scorer wins the dive iff it (a) beats GPT-as-judge on accuracy, OR (b) ties but per-edge
cost/latency/nondeterminism is unacceptable at closet-graph scoring volume (an LLM call *per edge* is slow,
rate-limited, nondeterministic; a trained head is ~ms, free, deterministic — which the spec explicitly values).
It loses (ML-for-ML's-sake) iff GPT-as-judge is more accurate AND cheap enough. GPT-4V reference: aesthetic
Spearman 0.117–0.519 vs human 0.711–0.815 — above chance, below human.

**Seam shape (settles H28): pairwise/edge, NOT item-level.** Every method (Vasileva type-aware pairwise, NGNN
graph, OutfitTransformer attention) scores outfits as an *aggregation over pairwise edges*; a single shared
item-level embedding fails (compatibility is non-transitive). MVP scorer = `f(item_i, item_j, types) →
compat`, outfit score aggregated over edges; keep the seam INPUT as partial-outfit+candidate so a whole-outfit
attention head can land at M6.

**Domain gap (the load-bearing risk): real and large.** Catalog flat-lays ≠ messy closet photos; naive
cross-domain self-supervised transfer barely beats chance (Popli 2022, 0.52–0.66 AUC; recovers to ~0.84 only
with adversarial domain adaptation). Mitigations baked into the recipe: **score over a fashion-CLIP embedding
space** (Marqo-FashionCLIP), not raw pixels (cheapest hedge); add a **named domain probe** (run the
Polyvore-trained scorer over Amazon review photos / a few of Brian's own closet items through Fitted's CV) —
do not assume transfer.

**Minimal recipe (~1–2 days, offline):** frozen CLIP ViT-B/32 (optionally + item text) → MLP head over
`[emb_i, emb_j, |emb_i−emb_j|, emb_i*emb_j]` + a learned type embedding → scalar edge compat; train BCE/BPR on
real co-occurring edges vs **category-aware** negatives; outfit/AUC = mean over edges; report on the **disjoint**
split. Baseline ladder on the identical split: random → co-occurrence/popularity → zero-shot CLIP-cosine →
trained head → GPT-4o-as-judge (+ its $/latency). "It works" = clears co-occurrence + zero-shot-CLIP, reaches
~≥0.80 AUC / FITB well above 25%, AND beats-or-cost-wins vs GPT-as-judge.

**Sequencing:** standalone offline — **not gated behind M5 deploy.** Slot it before/around M4b, and definitely
before M6 commits, because it (a) yields the demonstrable zero-user ML number the portfolio needs, (b) settles
the H28 seam shape that M4b/M5 otherwise wire blind, and (c) gates the go/no-go on the whole trained-scorer
milestone. Integration of the resulting model stays M6. **Now wired into the canonical ladder** (spec §20 row +
CLAUDE.md arc step 4) as `decision-pending → /spec next`.

## Doc compaction plan (HELD for sign-off — its own session)

The named verbosity concern, confirmed by the closeout wave (DH-01/DH-02/DH-04/DH-05/DH-06 + CS1). The **spec
(1267 lines) is UNDER budget**; the overage is **the M4 plan (1753 lines, over the ~1500 single-doc backstop)**,
which pushes the default reading list (CLAUDE.md+spec+plan ≈ **3230**) over the ~2000 ceiling. It's not just
length: §14 (the live build authority, at the *bottom*) supersedes §0–§13, but those ~1400 lines still
physically contain stale "backfill"/"fixtures-only"/"M4 implements the gate functions" prose, neutralized only
by ~7 scattered "§14 wins" banners — a top-down reader acts on stale guidance before reaching the correction.

**Plan (do as a dedicated session — NOT a blind rewrite):**
1. **First, grep §14 for every back-reference into §0–§13** (`§8.2`, `§8.3`, `§8.4`, `§8.8`, `§9.1`, `§9.3`,
   `§10.2`, `§10.3`, …). That set is the **binding keep-or-repoint list** (DH-02 — the earlier draft's keep-list
   missed §8.2 + §9.1, which C5/C6/C1 cite).
2. **KEEP verbatim** (the C-ladder cites them): §8.2 field groups A–K (or repoint to §8.3 + spec §15.1), §8.3
   Mongoose sketch, §8.4 Option-B + the 3 discard sites, §8.8 index plan, §9.1 binding fields + co-presence,
   §9.3 H19 reducer, §10.2 default-to-top rationale, §10.3 classifier table + the adjectival-dress trap-guard;
   plus the named trap-guards (host-not-dbname, re-derive-from-raw). **KEEP §14 entirely.**
3. **DELETE** (pure past/derivation — "past goes to commits"): §0 framing except the one-way-door sentence, §1
   session map, §3 hole-map (dup of spec §23), §4 OQ-log (all resolved), §5 S1 handoff, §6 freeze checklist,
   §8.10/§8.11 verdict+dual-review narrative, §9.0/§9.2/§9.4–9.8/verdicts, §10.0/§10.1/§10.4–10.6/verdicts, §11
   except the dedup trap-guard, §12, §13. Also sweep the ~20 evolution-narrative markers (DH-04: "verdict",
   "signed-off", "Next: S7").
4. **Single-home (DH-06):** the H19 reducer is stated in full in BOTH spec §15.1 and plan §9.3 — make §9.3 point
   to §15.1, not restate.
5. **Dangling refs (DH-05):** the spec cites the plan's S-numbers (S4/S6/S9) + dated-audit annotations; when the
   plan retires post-M4, either keep a tiny S#→§ concordance or repoint the spec refs in the same pass.

**Est.:** plan → ~600–780 lines; reading list → ~2030–2250. To firmly clear 2000, additionally delete the §8.2
prose (largely redundant with the §8.3 sketch + the canonical §15.1 contract) and repoint C5/C6's §8.2-* cites.
**Recommendation:** run as its own focused session before M4b proper (the plan is correct, just long — not
urgent, but it's the one real doc-debt item).

