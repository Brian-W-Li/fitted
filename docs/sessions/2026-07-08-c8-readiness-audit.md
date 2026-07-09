# 2026-07-08 — C8-readiness audit (two-track, concurrent-session-safe)

Branch `m5-c5-next-integration`. Ran as a **two-track** session while another session was
**actively writing C8-prep fixes** (auth/images trust boundary). Rule followed: do not overwrite or
reformat the other session's active files — audit + report, patch only clearly-local non-conflicting
lines. Read-only except one README doc line.

## Track A — the other session's C8-prep work (audited, NOT patched by me)

All three known §I residuals are **already implemented by the concurrent session, to a high standard.**
I verified each against source; **no load-bearing defects found.**

| Residual | Implementation (other session's WIP) | Verified |
|---|---|---|
| Image helper: accept `/api/images/…` + `http(s)`, not just `mongo:` | new `lib/imageUrl.ts::resolveImageSrc` (3 forms + rejects `javascript:`/`data:`); wired dashboard+history; `tests/imageUrl.test.ts` | ✅ |
| `auth/sync` must not trust body email | `email = decoded.email` only; email-less token → 400; squat-prevention test in `retainedRouteAuth.test.ts` | ✅ |
| Images-route ownership (not half-wired) | Firebase **session-cookie** path: `lib/session.ts` (verify) + `POST/DELETE /api/auth/session` (mint/clear) + client `lib/sessionCookie.ts`, minted in `AuthGate`/`signin`/`signup`, cleared on logout; images route → 401/404(existence-hidden)/400; behavioral `tests/imagesRouteOwnership.test.ts` | ✅ |

- Confirmed `WardrobeImage.user` exists (`required`, indexed) — the ownership check `doc.user.toString() !== auth.userId` is sound; images don't silently all-404.
- Non-blocking note: `wardrobe/page.tsx` + `account/page.tsx` keep a local `mongo:`-only helper. **Correct** (they consume raw `WardrobeItem.imagePath`, always `mongo:`); could unify with `resolveImageSrc` later for consistency. Not a bug.

## Track B — independent C8-readiness audit (4 parallel lanes)

### Lane 1 — legacy deletion inventory / flag / env  *(all verified against source)*
- **DELETE at C8:** `app/api/recommend/legacy.ts`, `app/api/recommend/regenerate/route.ts` (no prod caller; tests only), `lib/gemini.ts` (**zero real importers** — only a comment in `interactions/route.ts:10`), + the `GEMINI_API_KEY`/`GEMINI_MODEL` env rows.
- **MIGRATE-NOT-DELETE (load-bearing catch):** `lib/weather.ts` — imported by the **kept** `lib/mlRecommend.ts:20,142` (`getWeatherContext`, live weather re-derivation). Deleting it at C8 breaks the live path. **Keep.**
- **`route.ts` must be rewritten, not just have files deleted:** `route.ts:16` imports `legacyRecommend`, `:30` calls it on flag-off. Deleting `legacy.ts` without editing `route.ts` = build break. C8 blocker-if-forgotten (spec-covered, `m5-cutover.md` §19).
- **Gap (important):** no standalone exported degraded-empty-state helper. The flag-off arm currently returns legacy; post-C8 it must return the §A degraded empty state (empty candidates, no `{snapshotId,candidateId}`, HTTP 200 not 503, no snapshot). Today the §A empty state is only built *inline downstream of a service round-trip* in `mlRecommend.ts` (`respondDegraded`/`projectBrowserResponse`). C8 should add a small exported `renderDegraded()` so the flag-off arm can't accidentally emit a bare `{}`/200 or re-invoke the service.
- **Env boundary ✅:** `OPENAI_API_KEY` is read **only** in deletion-bound code (`legacy.ts`, `regenerate/route.ts`, their tests). The kept ML path reads no OpenAI/Gemini key. After C8, Next needs only `ML_SERVICE_URL` + `FITTED_SERVICE_KEY` (+ optional `ML_SERVICE_TIMEOUT_MS`); `OPENAI_API_KEY` becomes **service-side-only**. (`mlRequestAdapter.ts:43` `provider:"openai"` is a config-mirror expectation, not a key read.)

### Lane 2 — test false confidence (5 files tied to C8; verified)
Move/update **with** the legacy code at C8 (do not delete now):
- `recommendationStability.test.ts` — imports the *kept* dispatcher but **never sets `USE_ML_SHORTLISTER`** (grep = 0) so it silently exercises the **legacy** arm; asserts the OpenAI prompt string + 503-on-missing-`OPENAI_API_KEY`. **Rewrite to the §A degraded contract** (the 503 assertion becomes actively wrong post-C8).
- `regenerateExclusion.test.ts` — imports the deleted `regenerate/route.ts`; pins the **overturned** re-rank exclusion semantics. Delete with the route.
- `contextDetection.test.ts`, `feedbackSemantics.test.ts`, `endToEndRecommendationFlow.test.ts` — **self-admitted inline copies** of legacy predicates / pre-C6 dashboard state; exercise **zero** production code (stay green even if the real code is deleted). Move to C8.
- Kept-surface note (NOT C8): `wardrobeFilter.test.ts` is also an inline-mirror fake but of the **kept** wardrobe browse pipeline — rewrite to import the real pipeline; do not bundle with the legacy deletion.
- Real C5–C7 coverage confirmed present: `mlRecommend/mlRequestAdapter/mlServiceClient/mlSnapshot*` behavioral tests, `interactionsBinding.test.ts`, `retainedRouteAuth.test.ts`, `imagesRouteOwnership.test.ts` — all import real modules over real in-memory Mongo.

### Lane 3 — docs staleness
- **PATCHED (safe, local, non-conflicting):** root `README.md` M5 status row `C1-C3 built` → `C1-C7 built, C8 remains`. (README floors line was separately updated to 987 pytest / 546 jest by another actor mid-session — now current.)
- **Report-only (not patched — either legacy-banner-gated or lower priority):**
  - `fitted/docs/database.md:38` — lists `inferredWhy` as a live feedback field (its Gemini writer is deleted) and **omits** the M5 `feedbackReason` structured "why". Legacy-reference doc (banner-gated) → lower severity.
  - `fitted/docs/ML_OVERVIEW.md:5` — title says "(Current Behavior)" but describes the retired CS148 ONNX path; contradicts its own legacy banner.
  - `docs/README.md:15` — overstates `regen-controls.md` as "M5 wiring still uses it"; that doc is SUPERSEDED-for-M5 (its own banner). Repoint to concept-only.

### Lane 4 — C5–C7 trust / replay / degraded (deep trace; verified)
**5 of 6 invariants HOLD (confirmed):** requestId idempotency (partial unique `{user,requestId}` index + early replay check + `E11000` winner re-read; `seedDate` excluded from render identity); **no degenerate-snapshot-on-degraded** (`!result.ok → respondDegraded`, snapshot `_id` discarded; a *paid* degenerate 2xx payload is stored `bindable:false`, feedback rejected `candidate_not_shown`); interactions **append-only** (route exports only GET/POST; `.create()` only; all reducer fields derived from the re-read immutable candidate); auth-sync-before-redirect (signin/signup await + `.ok`-check; `AuthGate` awaits `ensureSessionCookie` before rendering owner-only images); same-action feedback dedup (300s window, set-based signatures). Security surfaces clean: payload allowlist/`RESERVED_PAYLOAD_KEYS` strip, `crossCheckAuthorship`, snapshot immutability/delete guards.

**THE ONE SUBSTANTIVE FINDING — decision item, needs Brian + Fable, NOT unilaterally patched:**
- **Feedback-reducer correction-retraction gap** (`ml-system/fitted_core/reducers.py:116-170`). The dedup key is `(snapshotId, candidateId, action)`, and `accepted`→affinity/liked-signature vs `rejected`→cooldown/dislike are **independent additive channels with no retraction**. So a **like→dislike correction on the same candidate keeps the item's `item_affinity +1` and its `fullSignature` in `liked_full_signatures`, while ALSO adding cooldown/dislike signal** — contradictory personalization state; "current state = disliked" is not honored.
  - **Tension:** history UI (`history/page.tsx:115`) promises *"to change your mind, just react again."* The plan pins append-only **storage** ("corrections are new events, not `findOneAndUpdate`") but is **silent on reducer retraction** — so this is an under-specified contract, not a plan violation.
  - **Why it matters:** the user's mental model (a correction takes effect) isn't met; downstream taste-learning gets both-signs signal for the same item.
  - **Not patched** because reducer semantics is a design call (decision-method: first-principles + Fable) touching `reducers.py` (ml-system, outside the concurrent session) — Brian's to decide.
- Minor residuals (no data-integrity impact): stale comment `RedirectIfAuthenticated.tsx:47` claims a "dashboard resync also runs" (there is none); replay flag reconstruction (`flagsFromDoc`) can show different empty-state copy than the first response (cosmetic); weather-bucket-shift on replay → false-409 → "generate again" (UX only, no double-write, documented `dashboard/page.tsx:1001-1005`).

## Fixes made this session
- `README.md` M5 status row corrected (the only patch; a doc line, no test/build impact).

## Deliberately NOT done (concurrency safety)
- Did **not** run the full `npm test` / `build` — the other session was actively writing test/app files, so a full run would report spurious mid-write errors and waste time. My only change is a doc line needing no test.
- Did **not** patch any Priority-A auth/image file (active in the other session) or any legacy/reducer code (C8 work / design decision).

## Remaining C8 blockers & owed decisions
1. **Rewrite `recommend/route.ts`** flag-off arm to a degraded §A empty state; add an exported `renderDegraded()` helper (no reusable one exists). Blocker-if-forgotten (build breaks on `legacy.ts` deletion).
2. **Delete** `legacy.ts`, `regenerate/route.ts`, `lib/gemini.ts` + `GEMINI_*` env rows. **KEEP `lib/weather.ts`** (kept-path dependency).
3. **Tests:** delete `regenerateExclusion.test.ts`; rewrite `recommendationStability.test.ts` to the degraded contract; move `contextDetection`/`feedbackSemantics`/`endToEndRecommendationFlow` (inline-fake legacy). Separately rewrite `wardrobeFilter.test.ts` (kept surface, not C8).
4. **Docs:** fix `database.md:38` (`feedbackReason` in, `inferredWhy` marked dormant), `ML_OVERVIEW.md:5` title, `docs/README.md:15` regen-controls pointer.
5. **DECISION (Brian + Fable):** feedback-reducer correction retraction — should a later dislike retract an earlier like's affinity/liked-signature for the same candidate? Currently no.
