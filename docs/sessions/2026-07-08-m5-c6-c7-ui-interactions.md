# 2026-07-08 — M5 C6 + C7: UI + interactions cutover

Branch `m5-c5-next-integration`. Started from `c1c6cdcc` (the frozen C5 baseline). C5 (route + libs +
`GenerationSnapshot` §G schema) was left intact — treated as frozen; not rewritten.

## What landed (C6 — feedback gate + append-only interactions + UI contract cutover)

- **`models/OutfitInteraction.ts`** — added `FEEDBACK_REASON_CODES` (closed §16 set) +
  `FeedbackReasonSchema` + the `feedbackReason` field. The structured "why" home (never `metadata`,
  never the deleted Gemini `inferredWhy`).
- **`lib/apiAuth.ts`** (new) — shared `verifyFirebaseUser(request)` → `{userId}` | `{error,status}`.
  Identity from the verified token only.
- **`lib/interactions.ts`** (new, INJECTABLE) — `postInteraction`/`getInteractions` + `prodInteractionDeps`.
  POST binds `{snapshotId, candidateId}`, re-reads the candidate from the immutable snapshot, derives
  `items`/`baseKey`/`fullSignature`/occasion server-side (anti-poison), gates G8 (action allowlist
  `accepted|rejected`) + G10 (24-hex ObjectId + candidate membership) + shownCandidateIds membership +
  ownership + append-only `.create()`. GET is user-scoped and joins the bound candidate content +
  `itemSnapshots` display fields via `{snapshotId, candidateId}`.
- **`app/api/interactions/route.ts`** — thin GET+POST over the injectable core. **DELETE + PATCH removed**
  (append-only → automatic 405). **Gemini `inferredWhy` write-back removed** (`lib/gemini.ts` now dead,
  deleted at C8).
- **`app/(app)/dashboard/page.tsx`** — full rewrite to the §6.5 / G15 browser projection. requestId minted
  once per Generate action + reused on resume; Generate disabled while in flight; **F10 durable
  pending-render envelope** in `sessionStorage` (persisted before the fetch, cleared only on hydrated
  success / completed-degraded / stable 4xx, KEPT on a network throw); `resumePending` re-sends the same
  requestId + frozen Lens. Feedback binds `{snapshotId, candidateId}`. StyleMove card body from
  `candidates[candidateId]`; feedback controls hidden when `bindable===false`. RegenerateModal → R9
  `{lockedItemIds, dislikedItemIds}` controls → one re-roll (parentSnapshotId + controls; server derives
  intent/Lens). Storage namespaced by uid + cleared on logout.
- **`app/(app)/history/page.tsx`** — rewrite: append-only (move/remove/PATCH/DELETE affordances gone);
  cards render from the GET-joined candidate content.
- **`app/(app)/wardrobe/page.tsx`** — rescue-launch affordance: "✨ Build an outfit around this" →
  `/dashboard?rescue=<id>&name=<name>` → the dashboard sends `forcedItemId` (intent=rescue_item).

## What landed (C7 — trust-boundary + client-state gates)

- **`account` + `auth/sync`** — identity from the verified token only (body `firebaseUid` ignored;
  `auth/sync` verifies the token directly since the user may not exist yet). Client callers
  (`account/page.tsx`, `signin`, `signup`) now send `Authorization: Bearer`.
- **`cv/infer`** — auth required (401 before any work) + 10 MiB size cap (413) + per-user in-process rate
  ceiling (`lib/rateLimit.ts`, new). Client CV call now sends the token.
- **`images/[imageId]`** — malformed-id → stable 400. **Ownership NOT closed** — see residual below.
- **`RedirectIfAuthenticated`** — syncs (idempotent) before redirecting → no redirect-before-sync race.
- **`wardrobe` AddItemModal save-loss** — the modal stays open on a failed save (input preserved);
  `onSave` returns `false` on failure and no longer clears edit/add state on failure.

## Tests (behavioral, over real in-memory Mongo where persistence matters)

- `tests/interactionsBinding.test.ts` (new, 17) — the feedback boundary over real Mongo (forged-echo →
  server-derived read-back; G8/G10; ownership; degenerate-unbindable; feedbackReason; append-only).
- `tests/retainedRouteAuth.test.ts` (new, 7) — account/auth-sync identity-from-token over real Mongo
  (mocks only the connect + token-verify seams; models are real).
- `tests/apiCvInferRoute.test.ts` — updated for auth; + 401 + 413 gate tests.
- `tests/interactionPersistence.test.ts` — DELETED (tested the dead itemIds contract).
- **Floors: 535 jest / 30 suites green; tsc clean; eslint clean on all touched (the wardrobe file's 2
  pre-existing `any` errors at ~L1490 are not in touched code).**

## Residuals / not done (C8-only or registered)

- **Images-route ownership (registered pre-C8 gate, plan §I).** `<img>` tags can't carry a Bearer header,
  so per-request ownership needs a Firebase **session cookie** or **signed image URLs**. Separable infra;
  documented in `m5-cutover.md` §I with the recommended fix (session cookies). Low exposure at solo scale.
- **Weather-freeze residual (dashboard `buildRootBody` comment).** The F10 envelope freezes the request
  INPUTS (occasion + geo); with geo present the route re-resolves weather live, so a long-delayed reload
  crossing a weather-bucket boundary could false-409 the replay → degrades to "generate again", not a lost
  render. A fully-frozen resolved bucket is a post-M5 nicety.
- **F10 reload behavior is client-only** — not jest-testable in the node env; the server idempotency it
  relies on IS tested (mlRecommend.test.ts). No `next build` was run (env-dependent); tsc + the Suspense
  wrapper cover the client boundary.

## STOPPED before C8 (per instructions)
Did NOT: flip `USE_ML_SHORTLISTER`, deploy, provision keys, or run live OpenAI budget/token gates.
The pre-C5 empirical token gate + Fly deploy + budget confirmation remain C8, needing Brian + a real key.
