# 2026-07-08 — M5 C5 (behavior-first), seams 1–5 landed

Branch: `m5-c5-next-integration` (NOT merged; `USE_ML_SHORTLISTER` does not exist yet —
no flag flipped, no one-way door crossed). Suite floor now **jest 467** (was 388).

## The mandate honored
Build C5 behavior-first to cure the repo's disease: a green `validateSync` unit suite over
broken behavior with no integration tests. Every seam landed with a BEHAVIORAL test across a
real boundary (real Mongo write→read, a real localhost HTTP round-trip, or the real Python
reducers via subprocess) — never a shape/unit pin. No shape pins were added as guards.

## Done (each committed on the branch, light-reviewed, findings fixed)
- **Brick 1** (`5d78b47a`): test-Mongo harness (`tests/helpers/mongoHarness.ts`, mongodb-memory-server)
  + §G schema additions with round-trip guards — **D-1** `diagnostics.engineFailure`, **D-2** top-level
  `controls`, and the same-class **item-6** generator provenance + `finishStatus` (found by review). Full-payload
  round-trip over `m4b_e2e_snapshot.json` is the class cure.
- **Seam 3** (`5b73c064`): `lib/mlRequestAdapter.ts` (buildLens §F, projectWardrobe §15.2 incl.
  imagePath→imageUrl + tag/name sanitization, GENERATOR_EXPECTATION mirror, buildRenderBody) +
  `lib/mlServiceClient.ts` (callRenderService fetch+timeout+degrade, buildDegradedResponse).
  Tests: cross-runtime key gate vs `contract_fields.json` + a real localhost HTTP round-trip.
- **Seam 4** (`efe02230`): `lib/mlBehavioralRows.ts` (bounded fetch + projection to the reducer grain).
  Test: real Mongo → projection → the ACTUAL Python reducers via `python3` subprocess (stdlib-only, no venv).
- **Seam 5a** (`be8879e5`): `GenerationSnapshot.ts` §G items 1/2/3 (parentSnapshotId; requestId
  required+validated+partial-unique-index; delete guard all 4 paths) + `lib/mlSnapshotWrite.ts`
  (E11000 winner re-read). Real-Mongo idempotency + delete-guard tests.
- **Seam 5b** (`69273229`) + review fixes (`f8292289`): `lib/mlSnapshotValidation.ts`
  (validateSnapshotPayload — G12 scoreTrace algebra, shown-set exactness, content-id coverage,
  items↔slotMap consistency, G11 styleMove/template, G13 engineFailure sanitize). Test grounded in
  the real fixture + a real Mongo write (accept ⇔ persistable) with per-class mutations.

## NEXT: Seam #6 — the live route rewrite (task #6), then the HEAVY audit (task #7)
`fitted/app/api/recommend/route.ts` rewritten IN PLACE behind `USE_ML_SHORTLISTER`, legacy arm
extracted to `fitted/app/api/recommend/legacy.ts` (so C8 commit-2 is a module delete). It assembles
the seam 3–5 building blocks:
1. Firebase auth + ownership; pre-allocate `snapshotId` (new ObjectId).
2. §C.4 requestId idempotency: early read-check + G5 identity match (`request_id_conflict` 409 on a
   reused id with a changed render identity — identity set excludes seedDate); E11000 winner re-read.
3. Regenerate = one route: §C.1 lineage gate — re-read parent by `{_id, user}` (forged/cross-user → 404),
   derive child Lens FROM THE PARENT ROW, compute `generationIndex = parent+1` server-side (never client).
   Root-controls invariant + §C.3 preflight (locked∩disliked, structural-infeasible → 400; closet-can't-
   complete → valid empty; G16 forced-item-deleted → 409).
4. Build behavioralRows (seam 4) + request body (seam 3); call service (seam 3 client).
5. On service failure → §A degraded empty state (discard snapshotId, no write). On success → validate
   (seam 5b) + THE STILL-OWED CHECKS: **G4 authorship cross-check** (payload vs normalized request) +
   **§A shown[].outfit-body cross-check** + **raw-field cap truncation+validation** (assigned to the
   writer here — see mlSnapshotValidation.ts docstring) + shown-identity zip by full_signature.
6. TS merge (`_id`, `user`, `interactionCountAtRequest`, per-item `evidence`) → writeSnapshotWithIdempotency
   (seam 5a). Attach snapshotId + hydrate `displayItems` from `payload.itemSnapshots`. G15 browser allowlist
   (negative leak test). No post-Python DB refetch (H10).
Behavioral tests (jest, real Mongo + a fake in-process service): daily+rescue render+bind; re-roll writes a
lineaged child with the parent's Lens; forged/cross-user parent → 404; duplicate requestId → one snapshot;
G5 conflict → 409; browser response leaks none of `{payload,candidates,rawEmitted,generationAttempts,
diagnostics,generator,itemSnapshots}`. Then the HEAVY multi-lane audit before any thought of the C8 flip.

Read for seam #6: m5-cutover.md §C (all 5 pins), §D (engine-failure boundary), §I (still C6), §A
(shown-identity + G15 + degraded), §G.1 (G4 authorship). Verify line-cites against the real route first.
