# Post-M4 Forward-Readiness & Pre-Mortem

> **Purpose.** Forward-looking pre-mortem run after M4 + the doc-consolidation session. Everything M4 and
> earlier was *backward*-looking ("is what we built sound? — yes, see the 2026-06-26 post-audit"). This
> session is purely *forward*: is the project ready for, and correctly pointed at, the next rungs
> (**H26 spike → M5 cutover → M6 dive → writeup**)? The substrate's modules were built in isolation and
> **there is no live integrated path yet**, so the integration has never been exercised whole.
>
> **This doc is the inheritance for the H26 `/spec` and the M5 `/spec`.** It is a readiness ledger, not a
> canonical decision home — every *resolution* still lands in `Fitted_Spec_v2.md` (§23 holes) or the
> milestone plan. New holes opened by this session: **H49, H50, H51** (+ H28/H12 sharpened). See §23.
>
> **Concurrent reconciliation (2026-06-27).** A parallel Codex independent-read session committed `b8dc6052`
> + `a61a3801` while this audit ran, opening **H47** (warmth re-derivation on edit — resolved) and **H48**
> (variant-cap-dropped candidates lose `ScoreBreakdown` — OPEN, M5) and adding M5 notes to H11 (legacy
> `interactions` route must become append-only) and H29 (a central TS validation helper for the raw-caps).
> Those reads are **complementary** to this one — no conflict. This session's L2-04 (scored-but-unshown
> compat/visibility) is the **response-layer sibling of the same class as Codex's H48** and is folded there.
>
> Method: 7 cold-context parallel audit lanes (models split judgment→Opus / mechanical→Sonnet) → an
> adversarial refuter round (killed 2 false positives, right-sized 3) → a between-lane completeness critic
> (4 new verified gaps). **Every load-bearing finding was re-verified against source by the main loop before
> landing here** (per [[feedback_verify_before_answering]]/[[feedback_citation_accuracy]]). Fable was down →
> dual-read substitute (deep in-session pass + the cold-context refuter, both converging). Date 2026-06-27.

---

## 0. Convergence & headline

**No blocker in committed code.** The substrate ships dormant; every finding below is an **M5-wiring
decision** or a **forward-design gap**, not a defect in the M4 code (independently re-confirmed by the
refuter — Round-1 lanes 2/4/5/7 found 0 current-code blockers; Lane 5 found the substrate *remarkably clean*
against degenerate real-closet distributions). The two real classes of risk are:

1. **The unbuilt M5 cache/snapshot/cross-runtime layer has under-specified seams** that, if wired wrong,
   silently corrupt the immutable training corpus (a one-way door). Five must be **decided before the first
   live snapshot write**: H49 (cache-hit snapshot provenance), H50 (render idempotency), H51 (cache locus +
   cross-runtime seed), plus the generator/interaction-count provenance dual-authorities (§3).
2. **The H26 experiment's decision rule and domain-gap measurement are spinnable** — a flawed design would
   produce a *misleading* portfolio result. The pre-registration sketch (§2) hardens it.

**Sequencing unchanged: consolidation → H26 → M5.** H26 is correctly first — it is zero-user-runnable, needs
*none* of the snapshot/cache machinery, and is the project's sharpest demonstrable result. (Completeness
critic R2C-06 reinforces this: M5's heaviest snapshot work serves a feedback arm the spec itself marks
`[STAGED]`/`[NORTH-STAR]` on a zero-user fork, so M5's snapshots will be *unlabeled* — argues for a *minimal*
M5 snapshot write now, full funnel capture deferred until labels can accrue; §4.)

---

## 1. The 7 lanes — verdicts (source-verified)

| Lane | Scope | Verdict |
|---|---|---|
| L1 | H26 experiment pre-mortem | **2 design blockers + literature corrections** — methodology *numbers/split are sound*, the *decision rule + domain probe* are spinnable. → §2 |
| L2 | End-to-end integration trace (rescue vertical) | Rescue path **genuinely composes** (2 e2e tests green); findings are M5-wiring provenance seams. → §3 |
| L3 | M6 eval-data sufficiency (one-way door) | **No total-absence gap**; every named-metric field present. Risks are schema-slots-with-no-writer. → §4 |
| L4 | M5 cutover readiness (adapter IOUs / prereqs) | Request-side (Lens) adapter under-tabled; H7/H8 cheap, H12 under-pinned, H13 a real gate. → §4 |
| L5 | Degenerate-wardrobe robustness | **Substrate clean** — 0 blockers, all zero-cases route to `not_enough_items` pre-GPT; scoring divide-by-zero-free. → §5 |
| L6 | Portfolio backward-design | Drive toward the **H26 cost-parity result**; reframe §1's dive claim. → §6 |
| L7 | Python↔TS serde contract parity | **Bridge IS tested** (asdict→to_wire, 2 tests); enums/casing/ids all correct. 1 required-field M5-merge obligation. → §3 |

---

## 2. LANE 1 — H26 spike pre-registration (fold into the H26 `/spec`)

The research note (`docs/sessions/2026-06-26-m4a-post-audit.md` §"H26 spike — research") is **honest and
literature-anchored** — the headline band (≈0.82–0.86 AUC / 52–55% FITB) is verified against Vasileva
disjoint (0.84 / 55.2%), the disjoint split is item-level (correct cold-start analog), FITB@4/chance-25% is
the standard protocol, and pairwise/edge is the right seam shape. **Do not "fix" those.** The flaws are in
the *decision rule* and the *domain-gap measurement* — exactly where a misleading result originates.

### 2.1 Pre-registration sketch

- **Dataset / split unit.** Polyvore Outfits-**D** (disjoint), the *shipped* train/valid/test JSON — do not
  re-split. Report the disjoint corpus's **own** counts (~32k outfits / ~175k items), **not** the
  non-disjoint 68k/261k (a conflation in the note — L1-04). State the residual leakage caveat: item-disjoint
  ≠ visual-disjoint (near-dup product photos + brand co-occurrence still bleed) — "strongest publicly-shipped
  split," not "leakage-free" (L1-05).
- **Metrics (exact).** Compatibility **AUC** on the disjoint split, negatives = same-**fine-grained**-category
  replacement, **1:1**, per-outfit, chance 0.50. **FITB@4** = 1 positive removed + **3 same-category**
  negatives, hit@1, chance **25%**. Pin same-category for *both* (the note pins it only for AUC — L1-11).
- **Baseline ladder (frozen before tuning, identical disjoint test set):** random → co-occurrence/popularity
  → zero-shot CLIP-cosine → trained CLIP+MLP edge head → **GPT-4o-as-judge** (text-attribute AND vision).
- **Pre-committed go/no-go (single headline cell = disjoint AUC@same-fine-category + disjoint FITB@4):**
  1. **Sanity gate:** trained head beats co-occurrence AND zero-shot-CLIP (else no-go — adds nothing).
  2. **Accuracy floor (HARD, cost-independent):** AUC **≥ 0.81** (≥ the 2018 Siamese baseline — the note's
     ≥0.80 sits *below* Siamese, L1-10) and FITB **≥ 50%**. Below this = no-go **even if cheaper**.
  3. **Head-to-head vs GPT-judge:** within **Δ ≤ 0.03 AUC** of GPT-judge (parity) → *then* cost/latency/
     determinism decides go.
  4. **Domain-gap gate (HARD, separate measurement):** on a **labeled** closet-like probe, AUC **≥ 0.70**
     (or catalog→closet drop ≤ 0.12). Fail → no-go on the trained-scorer dive regardless of in-corpus numbers.
- **On a no-go, ship the result** — the negative + the per-request cost/latency table + the measured
  domain-gap drop. (§20's H26 row already commits to this.)

### 2.2 The two design blockers (these void the result if unfixed)

- **L1-01 BLOCKER — the domain probe must be a *labeled measurement*, not a glance.** The note's probe ("run
  the trained scorer over Amazon photos / a few of Brian's closet items") has **no compatibility/FITB ground
  truth**, so it cannot compute the gap — it's an eyeball, and the dive's single load-bearing claim
  (catalog→closet transfer; Popli 2022 shows naive transfer collapses to 0.52–0.66 AUC) stays unvalidated.
  Fix: hand-label 50–100 FITB questions from messy/phone-photo outfits, compute the same metric, gate on it.
- **L1-02 BLOCKER — the "beats-OR-cost-wins" rule makes "go" near-automatic.** A trained head is *trivially*
  cheaper/faster/deterministic than any LLM call, so the cost disjunct is always true — a useless-but-cheap
  0.80 model passes. Fix: accuracy floor is a **hard AND-gate** independent of cost (§2.1 rule 2–3); cost
  only adjudicates *after* accuracy parity.

### 2.3 Important methodology corrections (the `/spec` re-verifies the literature)

- **L1-03** — the note's "random ~0.84 vs category-aware ~0.65 same Bi-LSTM" mis-pairs numbers: 0.84 is the
  *type-aware* model (a different model), not a random-negative Bi-LSTM. The honest protocol-sensitivity
  example is Han's Bi-LSTM ~0.90 (random) → ~0.65 (same-category), *same model*.
- **L1-06** — GPT-4o-judge position-bias control: randomizing once is insufficient (GPT flips on ~⅓ of
  swapped pairs, and FITB@4 is 4-way so it compounds). Evaluate **both/all orders, count consistent verdicts
  only**; report a small human-agreement calibration.
- **L1-07** — the cost claim is hand-wavy ("free", "$/1k-edges"). Pre-register: fixed prompt-token budget,
  **$/request and p50/p95 latency at realistic edges-per-request**, marginal (inference) vs amortized
  (training+embedding) both stated, Batch-API caveat. The real argument is the volume math (n²/2 edges ×
  candidates × requests makes LLM-per-edge infeasible), not "free."
- **L1-08** — GPT-4o likely saw Polyvore in pretraining → its judge accuracy on actual Polyvore test items
  may be memorization-inflated. State as a confound; consider a non-Polyvore labeled slice for the GPT arm.
- **L1-09** — ~40 reportable cells across the ladder × {AUC,FITB} × {text,vision} × {disjoint,non-disjoint};
  pre-register **one headline cell + one go/no-go comparison**, report CIs + the GPT-eval sample size.
- **L1-12** — running GPT-4o over the full disjoint test set (× 4 vision tiles × both orders) is real $ +
  hours; budget a **powered sample** (~500 FITB Qs) with CIs separately from the 1–2-day training estimate.
- **L1-13** — OutfitTransformer 0.93/67.1% is the *non-disjoint* ceiling; cite the **disjoint** figures
  (~59.5% FITB) next to a disjoint experiment.

---

## 3. LANE 2/7 — integration & the M5 provenance dual-authorities

The rescue vertical composes end-to-end (the `dataclasses.asdict(payload) → snapshot_serde.to_wire → TS
schema` bridge is exercised by `test_m4_e2e_fixture.py` + `m4bSnapshotContract.test.ts`; enums, snake↔camel,
`type`→`clothingType` scoping, opaque ids/Maps all verified correct — L7 "confirmed correct"). The findings
are M5-wiring seams where **two independent authorities can produce a valid-but-lying immutable snapshot** —
the worst failure for a training corpus because it is silent.

- **IMPORTANT — generator provenance is unenforced (L2-02, refuter CONFIRMED).** `build_snapshot_payload`
  takes `generator_provider/model/temperature` as **free caller kwargs** (`snapshot.py:491-498/530-535`),
  decoupled from the `Generator` that produced the text (`OpenAIGenerator` stores `_model`/`_temperature`
  privately, has **no `provider` field at all**, no public accessor; no test asserts equality). §15.1 makes
  this block "required, non-null … so M6 can stratify by generator (an off-policy confound)." **M5 must derive
  the `generator{}` block from the live `Generator` instance** (add a read-only `provenance` property), or
  assert equality at the call site — never pass independent literals.
- **IMPORTANT (label-only, refuter OVERSTATED→right-sized) — interaction-count single-source rule
  (L2-03/L3-01/L7-02).** The engine hardcodes `interaction_count=0` (`rescue.py:215`; `RescueRequest` has no
  such field), while the TS `interactionCountAtRequest` is **required, no default, no Python producer** —
  supplied entirely by the M5 merge (documented *only* in `m4bSnapshotContract.test.ts:withM5Merge`, not in
  `snapshot.py` or the §14.5 handoff). Two separate concerns:
  - *(a) insert correctness:* if M5's TS merge omits `interactionCountAtRequest`, **every snapshot insert
    fails** Mongoose validation (the single most-likely insert-time failure, L7). Fix: document the merge
    obligation in `GenerationSnapshotPayload`'s docstring + the M5 handoff; reproduce `withM5Merge` exactly.
  - *(b) provenance consistency:* pre-M6 the count is **label-only** (the sampler's signal slot is
    unreachable — `ColdStartSignalScorer.is_available()` is always `False`, `sampler.py:251-254`), so the
    *outfits* are faithful regardless. But if M5 fills the snapshot field with the user's real DB count while
    the sampler rides 0, the field contradicts `diagnostics.samplerPerType[*].reason` (`coldStartSampling`).
    Fix: **pin `interactionCountAtRequest` to exactly the value the sampler used**; to use the real count,
    thread it through `RescueRequest → _build_request_context` simultaneously (then the gate logs
    `signalUnavailable`, behavior-identical).
- **MINOR (refuter OVERSTATED→polish) — scored-but-unshown lose `compatibility`/`visibility` (L2-04).**
  `build_variants_with_trace` builds `all_variants` from `ranked.outfits` only (`response.py:608-611`, ≤k=10),
  but `rank_audit.scored` can hold up to `MAX_CANDIDATES=40`; a candidate scored beyond rank-10 gets
  `rankerScore`+`scoreBreakdown` but null compat/vis. **§15.1 is NOT violated** (`compatibility?`/`visibility?`
  are optional; `scoreTrace` *is* populated) and it is **fully recoverable** (both are pure deterministic
  functions of `engineVisible`+lens, both preserved). **Folds into the concurrent Codex `H48`** (variant-cap-
  dropped candidates losing `ScoreBreakdown`) as the response-layer sibling of the same scored-but-unshown-
  trace class. Fix: a one-line §15.1 caveat ("compat/vis precomputed only for the top-k; train-time-
  recomputable for the tail"), or M5 builds variants over all scored / resolves H48 to cover the tail.
- **MINOR — `admittedViaFallbackStage` defined-but-never-written (L2-05/L7-03);** `samplerPerType` inner
  keys stay snake_case inside the opaque Map (`samplerPerType.top.selection_kind`, not `selectionKind` — a
  latent reader trap, L2-07). M5/M6 populate or drop; document the casing.
- **CHIP — single-intent substrate (L2-08).** `build_snapshot_payload` hardcodes `intent="rescue_item"`;
  `rescue()` is the only orchestrator. `daily/upgrade/translate` need a new request type, orchestrator,
  prompt, and parameterized `intent`/`forced_item_id` (the inline TODO at `snapshot.py:523` flags it).
- **DROPPED (refuter false-positive) — `evidence.image` "one-way door."** The engine **strips images at
  `[NOW]`** (`rescue.py:335-344`, H33) — the snapshot conditions on derived attributes (preserved in
  `engineVisible`), not pixels. The image hash/version gap is a **registered, W-track-deferred seam**
  (§15.1, H10/H14/H33), not a silent loss; H26 trains on public Polyvore anyway. *No action.* (If/when the
  W-track CV lands and a closet-personalized visual model is in scope, capturing `evidence.image.imageRef =
  WardrobeImage._id` + a write-time content hash is the cheap permanent floor — `WardrobeImage` has no hash/
  version column today. Noted for the W-track, not M5.)
- **DROPPED (refuter false-positive) — weather "silent mis-score then crash."** Correct for all 5 valid
  buckets; the failure path requires the M5 adapter to violate its own R5 bucketing contract, and even then
  nothing is stored (the TS enum rejects at insert). At most an optional `fitted_core`-side assertion in
  `build_snapshot_payload` that `weather ∈ {hot,mild,cold,indoor,outdoor}` to fail early+local. *Optional.*

---

## 4. LANE 3/4 + completeness — M5 cutover readiness

### 4.1 Request-side (Lens) adapter — the largest unscoped M5 surface (L4-01, refuter right-sized)

§6.3 **is** the canonical `RequestContext` home and tables every field + its normalization rule (occasion =
verbatim trim/lc/collapse-ws; weather = 5-bucket; `wardrobeVersion` from `User`, const 0; `interaction_count`
0). So the adapter is specced at the *schema* level — but there is **no §15.2-style deployed-source→Lens
table**, and two transforms are un-tabled: the **weather temp→bucket threshold rule** and **intent routing**.
The genuine IOU-missing fields (no safe default): `intent` and the rescue `forcedItemId` *route* (H45) — the
rescue engine is fully built but **no deployed route feeds it**. Everything else IOU-missing has a valid
cold-start default (constraints empty, baseOutfit/date None, `interaction_count`/`item_affinity`/
`liked_full_signatures`/cooldown all 0/empty; those projections are M5 deliverables). **M5 `/spec` must
author the §15.2-parallel Lens adapter table** (deployed body field → Lens field → transform) as a
definition-of-ready artifact, and decide the rescue route + intent routing rule.

### 4.2 The between-lane one-way-door gaps (NEW — must be DECIDED before the first live snapshot write)

These fell *between* the lanes: the cache is unbuilt (Lane 4's adapter focus), the snapshot is heavily
audited (Lane 3's schema focus), and nobody owned where they meet.

- **H49 BLOCKER-for-M5-write — cache-hit snapshot provenance undefined (R2C-01).** §15.1 requires "one
  snapshot = one render (per `generationIndex`) … re-roll siblings … independently complete," with a
  **required `generationAttempts[]`** and **required non-null `generator`** and per-candidate `sourceAttemptId`
  links. But §15 says a **cache hit skips generation** ("Steps 4–6 run per request over cached candidates").
  So a re-roll over a warm cache must write a complete independent snapshot for a render in which **no
  generation occurred** — and the contract never defines what `generationAttempts[]`/`generator`/`createdAt`/
  `sourceAttemptId` mean on a hit. Corruptions: empty `generationAttempts[]` → candidates with no
  `sourceAttemptId` + falsely reads "no generation" to M6; or copying the cache entry's `generator` → the
  snapshot's `promptVersion`/`temperature`/`createdAt` describe a render up to 15 min earlier. **M5 must pin
  cache-hit snapshot semantics before any live write** (recommended: copy the originating render's
  `generator`+`generationAttempts[]`, document `createdAt ≠` generation time, and persist the attempt trace
  *in the cache entry*; add a cache-hit branch to the `sourceAttemptId` rule).
- **H50 IMPORTANT — snapshot-render idempotency unhomed (R2C-04).** The snapshot `_id` is TS-pre-allocated;
  `requestId` is inert until H7. H11 dedups **feedback** rows (read-time, append-only, *rejects* upsert); H7
  is the re-roll lever. **Neither owns "two renders, same inputs, two snapshots."** A double-submit/retry at
  the same `generationIndex` writes two semantically-identical *immutable* snapshots, silently inflating the
  off-policy corpus (over-representing flaky-connection users — the exact distribution M6 off-policy eval
  depends on), un-dedup-able after the fact. **M5 must define `requestId` together with `generationIndex`
  (H7 closure)** as a client render-idempotency token + the write's collision behavior (first-write-wins on
  `{requestId}`, or accept-and-mark for a read-time `{sessionId,requestId}` reducer — mirroring H11's posture,
  not a write-path unique index).
- **H51 IMPORTANT — cache locus + cross-runtime seed/cache-key reproduction (R2C-02).** `seed.py` commits a
  TS-reproduction obligation ("any other runtime … reproduces the same seed", "Used by … **the M5 cache
  key**", "the M5 TS adapter must guard the same field order") and the seed is a **64-bit int** (exceeds JS
  `Number`'s 2⁵³ safe range). But §15's cache key is keyed on **inputs** (a *superset* of seed inputs), **not
  the seed value**, and the **cache locus (Next-side vs service-side) is undefined**. If the cache lives
  Next-side, TS must reimplement `_frame` (UTF-8 *byte* length not JS `.length`; the `-:` None sentinel;
  field order) — re-introducing the exact injectivity/precision bug the framing prevents, and **asymmetric
  with H15** (which bans reimplementing §7 keys in TS — the seed is silently exempted). **M5 must (i) decide
  the cache locus; (ii) if Next-side, add a cross-runtime conformance test of the TS cache-key reimpl against
  Python golden vectors (non-BMP occasion, None/empty/"0" date, reserved chars) — fold into H13's CI;
  (iii) reconcile `seed.py`'s over-claiming "reproduces the same seed" comment if the cache key never needs
  the seed *value*.**

### 4.3 H28 is not physically reserved — the M6 seam needs a ladder rung (R2C-03 — sharpens H28)

H28 says "reserve a second seam: an outfit/pairwise-level scoring hook **on the ranker**." But the ranker
reserves **nothing** — `RankerContext` (`ranker.py:161-188`) carries only seed inputs + pre-reduced
behavioral signals; `rank(candidates, context)` has no scorer param (the sampler *does* reserve its seam via
`SignalScorer`/`ColdStartSignalScorer`). H26 is an **offline** spike — it settles the seam *shape* but
produces no ranker code seam. **§20's ladder omits the rung between H26 and M5 that adds the additive
default-None outfit-level hook to `rank()`/`RankerContext` + re-pins M3 tests** (additive ≠ reopen,
distinct from H42's behavior-changing exemption). Sharpen H28 to say the reservation is *not yet in code*.

### 4.4 Prereq scoping (L4 Task B)

- **H7 (generationIndex lifecycle)** — CHEAP (one-session): start 0 on a fresh candidate-cache key, increment
  on re-roll, reset when the key changes; `ranker.py` already validates it. Now also load-bearing for **H50**.
- **H8 (seedDate timezone)** — CHEAP, near-resolved (default UTC); lock it + share one date helper across the
  Next adapter and the service.
- **H12 (graceful-fallback)** — **IMPORTANT, under-pinned (confirmed):** the timeout **value is unnamed**
  (no Appendix B constant), the trigger set is only sketched ("unreachable OR timeout OR schema-invalid/
  empty" — missing service 5xx, auth-to-service, parse-OK-contract-fail, rate-limit), and the **engine-never-
  ran snapshot question is open** (§15.1 decides in-engine failures write a snapshot, but service-unreachable
  has no Python payload to build one from). Recommend: **name a timeout constant in Appendix B**, enumerate
  the full trigger set, and have **TS write a degenerate snapshot with provenance=`unavailable`** so the
  failure corpus stays complete (consistent with §15.1's "every render attempt").
- **H13 (cross-runtime CI)** — a real **gate** (low design-risk, real setup): pytest + jest + the cross-
  language fixture test, pinned runtimes. Now also the home for **H51**'s conformance test. Resolve before M5.

### 4.5 R2C-05 — `rankerConfigVersion` conflates generation-shaping and ranking constants (MINOR→IMPORTANT at M6)

`RANKER_CONFIG_VERSION` is a sha256 over **every** `UPPER_SNAKE` in `config.py` (`config.py:182-189`) —
including the **generation-shaping** caps (`CAP_*`, `MAX_CANDIDATES`, `MIN_SIGNAL_THRESHOLD`) that decide
*which items reach GPT*, plus the rescue/response cold-start weights. A cap change is a generation-distribution
change but bumps `rankerConfigVersion`, **not** `generator.promptVersion`. So the provenance triple is jointly
sufficient to detect *that* something changed but not to attribute a corpus shift to the generation vs ranking
axis. Documentation fix now (sharpen §15.1: an M6 reader must treat the **whole triple** as the joint
generation+ranking key, not `generator.promptVersion` as "the generation axis"); a hash split only matters
once training starts.

---

## 5. LANE 5 — degenerate-wardrobe robustness (CLEAN)

Ran the real sampler/validator/ranker/rescue against 11 pathological cases via the test helpers. **0 blockers,
0 important.** Every zero-item-type routes to `not_enough_items` **pre-GPT** (`candidate_requested=0`); shoes
optional (no forced injection); caps hold under 150-tops lopsidedness (`MAX_PROMPT_ITEMS` is an asserted
invariant); duplicate ids raise a named `ValueError` at sampler entry (R12); null-signal items
(warmth=0, no tags) score divide-by-zero-free (compat=0.75, vis=0.0); rescue's `_check_sufficiency` returns a
user-facing hint + `ranked=None` when the forced item has no buildable complement (H22). The one MINOR
(L5-08): reserved-char ids (`:`/`|`/`=`/`"none"`) are caught at the validator as `keyPreconditionFailed`
(both R10 guards present) — **zero production risk** (Mongo ObjectIds are `[0-9a-f]`); the only consequence of
a future non-Mongo id source bypassing the M5 adapter guard is the item becoming silently unselectable, not a
crash. CHIP: `warmth=True` (bool) passes the dataclass guard as int=1 — spec-documented M5-adapter
responsibility. **Recommendation: none required; the substrate's input-robustness is a portfolio strength to
state honestly.**

---

## 6. LANE 6 — portfolio direction (strategic, for Brian to decide)

- **Drive toward ONE artifact: the H26 universal content-compatibility result** — AUC@category-aware-negatives
  + FITB@4 vs GPT-4o-as-judge with a $/latency table. It is zero-user-runnable, turns "the ML dive" from a
  *plan* into a *number*, settles the H28 seam shape from the model side, and sits *on top of* the delivered
  substrate (using the Spearhead §E run as its GPT-4o cost baseline) — all three artifacts compose into one
  story instead of competing.
- **What's demonstrable TODAY:** (a) the deterministic substrate + 706-pytest story (verified this session),
  (b) the Spearhead §E live-eval (100% parse / forced-item inclusion, $0.0046/rescue, p50 2.6s/p95 5.1s) —
  but frame (b) as **GPT-4o conformance + harness rigor**, the *baseline*, never "my trained model." Needs
  H26: the cost-parity number (NOT YET RUN). Needs M5: anything live.
- **Sharpest reframing (L6-02, aligns with the 2026-06-26 ambition verdict):** lead the writeup with the
  delivered substrate + exposure-bias-aware eval methodology as the depth; frame the personal style graph as
  *motivation*; scope "the ML dive" to the **universal content prior (cost/latency parity, not quality-
  superiority)** — the behavioral personal-graph is honestly `[NORTH-STAR]`/synthetic-only on a zero-user
  fork. §1:69-71 ("the graph and the ML dive are the same thing") is the line a writeup inherits first;
  recommend splitting it (not a unilateral spec edit). **Do NOT cut:** §2 "graph never the interface", §5
  honest labeling, §21 anti-overclaim, the GenerationSnapshot full-funnel rigor, the contract-first split.
- **R2C-06 (effort-allocation):** M5's heaviest work (the live three-site funnel capture + H29/H43 one-way-
  door machinery) serves M6's *feedback* arm, which the spec marks `[STAGED]`/`[NORTH-STAR]` on a no-users
  fork — so M5's snapshots will be **unlabeled**. Recommend **splitting M5**: (a) the service cutover
  (`USE_ML_SHORTLISTER`, route rewrite, request adapter, trust gates, a **minimal** snapshot = identity +
  provenance + shown set) as the load-bearing deploy; (b) the **full** funnel capture deferred until a
  feedback-generating deployment exists. **Land the one-way-door *decisions* (H49/H50/H51) in the spec now**
  (cheap, prevents schema regret) but don't gate the cutover on building capture machinery for an unlabeled
  corpus.

---

## 7. Prioritized punch list

**Before the H26 `/spec` (the immediate next rung):**
1. Fold §2's pre-registration sketch into the H26 plan; make the **accuracy floor a hard cost-independent
   gate** (L1-02) and the **domain probe a labeled measurement** (L1-01). Correct the literature mis-pairings
   (L1-03/04/13). *These are the difference between a defensible result and a spinnable one.*

**Before the M5 `/spec` / first live snapshot write (decide, don't necessarily build):**
2. **H49** cache-hit snapshot provenance — *blocker for a correct live write.*
3. **H50** render idempotency (with H7's `requestId`/`generationIndex` closure).
4. **H51** cache locus + cross-runtime seed conformance (fold the test into H13).
5. Generator + interaction-count **provenance single-source** rules (§3) — pin in the M5 plan + the
   `GenerationSnapshotPayload` docstring (the `withM5Merge` insert obligation is the #1 insert-time failure).
6. The **§15.2-parallel Lens adapter table** + intent routing + weather temp→bucket rule (§4.1).
7. **H12** timeout constant + full trigger set + engine-never-ran snapshot decision; **H13** CI gate.
8. The **additive ranker scoring hook** rung between H26 and M5 (§4.3 / H28).
9. Consider the **M5 scope split** (§6 / R2C-06).

**Cheap doc sharpenings (do on sight):** §15.1 caveat for scored-but-unshown compat/vis (§3); §15.1 note that
the provenance triple is the *joint* generation+ranking key (§4.5); H28 "not yet reserved in code."

---

## Appendix — lane agent IDs (this session, for continuation)

L1 H26 `a14870f494fa73cdd` · L2 integration `aee2f0d481d9e377f` · L3 eval-data `aa2825af27f94121c` ·
L4 M5-cutover `a30840404ccffd07a` · L5 degenerate `a56027815f648407c` · L6 portfolio `a071fcbbf1bfbbfc7` ·
L7 serde `a9ed8de6d783d6061` · R2 refuter `a40c2cb0e89878043` · R2 completeness `af390097629b3b72b`.
