# 2026-07-08 — Behavioral + test-adequacy + self-consistency audit (post-C7, pre-C8)

Branch `m5-c5-next-integration`. Heavy-loop audit of the M5 vertical from three angles the user
asked for: **behavioral** (does it do what the promise says), **test adequacy vs ambition**, and
**cross-repo self-consistency**. Baseline green: **jest 546 / fitted_core pytest 883** (both re-run
clean this session). 4 parallel lanes + my own focused deep-read catch-net.

## Headline verdicts
- **Behaviorally, all 5 flows CLOSE** (daily, rescue, regenerate, personalization, §6.5 UI) — traced
  through real code, reachable from the real UI, no blocker/important divergence from the promise.
- **Cross-runtime contract: NO DRIFT** across all 7 concepts (enums, action verbs, wire fields,
  constants, generator-expectation mirror, snapshot allowlist). The three-way discipline holds.
- **Code↔spec fidelity: STRONG** — no contract divergences, §-cites accurate in the sample.
- **The one real gap is test-shaped:** the personalization *plumbing* is behaviorally guarded, but
  "feedback demonstrably changes the ranked output" is the one promise **no test fails over**.
- All defects found were **doc-side self-consistency** drift (now mostly fixed) — no code defects.

## Catch-net (my own deep-read — the loop-closure question)
Traced feedback → next generation physically: `interactions.ts:198` writes row → `mlBehavioralRows.ts:133`
fetches → `mlRecommend.ts:390,411` wires into the render body → `service/app.py:798` `reduce_behavioral_signals`
→ `:799` `AffinitySignalScorer(item_affinity)` → `:801` `render_with_trace(signal_scorer, behavioral_signals)`
→ ranker consumes all 5 signals (`ranker.py:482-491`, ungated). **Loop closes; no computed-but-unconsumed
dead-end.** Action strings match (`accepted`/`rejected` ↔ `COUNTED_ACTIONS`/`REJECTED_ACTION`). Verified
the behavioral lane's sampler-dormancy nuance: `sampler.py` gates the `AffinitySignalScorer` on
`interaction_count ≥ MIN_SIGNAL_THRESHOLD(5)` AND a type over cap (35 tops etc.) — so the **sampler-side**
personalization arm is near-dormant for normal under-cap closets, but the **ranker-side** arm is live and
ungated from interaction #1. "Improves over time" is really ranker-driven, immediate.

## Lane findings
1. **Behavioral e2e** — 5/5 flows close. Regenerate confirmed FRESH-generation-with-lineage (no `/rerank`,
   parent-derived fields, `generationIndex=parent+1` written). Degrade + understocked branches honest
   (no 500, no legacy fallthrough, no snapshot on no-payload). Minor: sampler personalization slot rarely
   fires for normal closets (see catch-net).
2. **Test adequacy vs ambition** — coverage matrix:
   - Determinism: **well-guarded** (`test_seed.py:29-62`, `test_ranker.py:881-896`, `test_rescue.py:1095`).
   - Rescue: **well-guarded but composed** — no single e2e assert that the forced item is in *every
     surfaced variant* through `rescue_with_trace`; cold-start visibility asserts in-range, not a
     *distinct* orphan-vs-common bucket.
   - **Personalization: PARTIAL (the key gap).** Half A (DB→reduced signal) strong
     (`mlBehavioralRows.test.ts:229-258`, real cross-runtime). Half B (signal→*changed output*) proven for
     only 2/5 signals (cooldown hard-filter `test_ranker.py:1234`; affinity sort `:426`). Repetition,
     combo-boost, soft-dislike proven only as score-deltas/diagnostics-echo, **never as a rank-order change
     through public `rank()`**. No test drives a real `AffinitySignalScorer(real affinity)` through
     `render_with_trace` and asserts the liked item is preferentially surfaced. **Not overclaimed** (echo
     tests are honestly scoped) — the positive round-trip is simply absent.
   - §6.5 binding: **well-guarded** (`interactionsBinding.test.ts` over real Mongo — forged-echo anti-poison,
     candidate-not-shown gate, append-only, cross-user 404).
   - Three-way wire round-trip: **well-guarded against a REAL Python fixture** (`test_m4_e2e_fixture.py:168`
     fresh-build byte-compare ↔ `generationSnapshotRoundTrip.test.ts:200`), not a hand mock.
   - Degraded/replay: **mostly guarded**; GAP — no e2e test that a `degenerate:true`+`engineFailure`
     service response persists an engineFailure snapshot row through `mlRecommend` (the two "still writes"
     tests are healthy `nSurfaced=0`, not engineFailure).
   - Test-quality through-line: the prior "unit-only pyramid" (2026-07-08 contract-cure note) is genuinely
     improved — 9 jest suites now use real in-memory Mongo, one reaches into the real Python reducers.
     Two naming traps remain (`endToEndRecommendationFlow` / `recommendationStability` are legacy mock
     suites, not e2e/determinism; would stay green if the ML pipeline were deleted — already on the C8 list).
3. **Cross-runtime consistency** — no drift. Minor residual: `OutfitInteraction.action` enum still carries
   ~7 dead legacy values (no write path emits them) — cruft to trim at C8/M6.
4. **Spec-fidelity + doc consistency** — code faithful; defects doc-side (fixed below), plus a stale §23
   register (~10 holes closed by C5–C7 but still marked PENDING) and one genuinely-unregistered hole.

## Fixes made this session (all doc-side self-consistency; no code touched)
- `docs/plans/m5-cutover.md` — status banner reconciled (C5/C6/C7 marked ✅ DONE, "Next checkpoint" C5→C8,
  floors noted). **This was the load-bearing one:** the active plan said "Next checkpoint: C5" and would
  have misdirected a resuming session into re-attempting landed work.
- `docs/Fitted_Spec_v2.md` §23 — **registered H61** (feedback correction/retraction affinity semantics) as
  OPEN → NEEDS-DECISION.
- `README.md` — M5 status row C1-C3→C1-C7 (last turn); floors now 987/546 (updated by another actor).
- `fitted/docs/database.md` — Feedback bullet (`feedbackReason` in, `inferredWhy` marked dormant); index
  line gains the `_id` tie-break.
- `fitted/docs/ML_OVERVIEW.md:5` — title "(Current Behavior)" → "Legacy ONNX ML Path".
- `docs/README.md:15` — regen-controls pointer downgraded to historical/concept-only.

## Follow-ups EXECUTED (same session, after the audit)
- **H61 — DECIDED (Fable-reviewed 2026-07-08), recorded in §23.** Resolution = **per-candidate
  latest-STATE**: for each `{snapshotId, candidateId}` only the most-recent action row contributes;
  a `rejected`-winning candidate also blocks its `fullSignature` from `liked_full_signatures`
  (`blocked_signatures` set). Subsumes the 300s double-count guard; grain stays per-candidate so
  cross-candidate item signal survives; needs the (already-shipped) `{createdAt:-1,_id:-1}` sort; M6
  labeler must use the same rule. **Implementation (the `reducers.py` edit + correction/waffle/tie/
  signature-block tests) is still owed** — this session only recorded the resolved design.
- **§23 bulk reconciliation — DONE.** Status tokens bumped for H10/H11/H19/H29/H50/H54/H57/H58/H59/H60,
  honestly separating "code LANDED (C5–C7)" from "live production write gated on the C8 flag-flip"
  (H10/H29). Verified each against code before bumping (incl. H59 `mlRecommend.ts:373-374`, H60
  `mlRequestAdapter.ts:50,60-67`). Trap-guard prose left intact.

## Fork-A IMPLEMENTED (same session — H61 code + personalization-proof tests)
- **H61 reducer — IMPLEMENTED + fresh-reviewed CORRECT** (`reducers.py`). Per-candidate latest-state via a
  `seen_candidates` gate + first-seen-per-signature `signature_action` map; retired `FEEDBACK_DEDUP_WINDOW`
  + `_is_duplicate_counted_event` + `_parse_created_at` (the 300s window is subsumed by ordering).
  Config-version moved → regenerated `m4b_e2e_snapshot.json` (1-line diff, only `reducerConfigVersion`).
  Review flagged one dormant edge (a neutral `saved`/`worn` occupying a signature slot) → fixed with a
  membership-gated skip of non-meaningful actions. New reducer tests: like→dislike, dislike→like,
  waffle, cross-candidate-shared-item, signature-block, order-honors-caller, repeat-counts-once.
- **Personalization-proof tests (the audit's a/b/c) — DONE, all green:**
  - (b) `rank()`-level ORDER flips for the 3 additive signals (`test_ranker.py`): combo-boost lifts,
    repetition sinks, soft-dislike sinks — each flips the deterministic baseline order (was only proven
    as ScoreBreakdown deltas before).
  - (a) render-level affinity round-trip (`test_c4_scorer_and_controls.py`): `behavioral_signals` item
    affinity changes WHICH outfit surfaces first through the real `render_with_trace`.
  - (c) rescue e2e (`test_rescue.py`): a forced TOP is in EVERY surfaced variant across DISTINCT BaseKeys
    (the green-shirt invariant, previously only asserted for the single-BaseKey dress sub-case).
- Suites after: **pytest 1049 (tests+service) / jest 546**. New floors.

## Still owed (reported, NOT done)
1. **(d) engineFailure-persistence test** (jest, `mlRecommend.test.ts`): drive a `degenerate:true` +
   `diagnostics.engineFailure` service response through `mlRecommend` and assert a snapshot row with that
   `engineFailure` persists (the two existing "still writes" tests are healthy `nSurfaced=0`, not
   engineFailure). Separate degraded-state hardening, independent of the personalization claim.
4. Trim the dead `OutfitInteraction.action` enum values at C8/M6.

## Not done (concurrency/scope)
- No code changed — all findings were doc-side or test-gap (report). No test/build run needed for doc edits.
- Working tree has the doc edits above, uncommitted (branch `m5-c5-next-integration`).
