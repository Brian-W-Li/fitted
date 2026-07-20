# Friend-facing fixes — plan + backlog

> The execution plan for the friend-facing backlog found during the 2026-07-18/19 Track-2 gauntlet.
> **Single home for the backlog is THIS doc**; runbook §8 points here.

## STATUS — Phases 1–3 IMPLEMENTED 2026-07-19 (Fable-reviewed, audited, green) + REVIEW-PASS 2026-07-19

Built + tested + heavy-audited (3 parallel lanes: creative red-team + correctness/cross-runtime +
security/trust-boundary; every finding verified against source). A **second, independent review pass**
(4 fresh-context lanes: security/trust-boundary, cross-runtime latest-state, test-quality/mutation,
spec↔code+doc fidelity) found **no blockers and no corpus/security/cross-runtime defects** — every
corpus-write path (POST derivation, DELETE-all-rows, latest-state collapse) has behavioral coverage; the
DELETE door is IDOR/injection-safe (query-string strings, user-scoped, ObjectId-cast). It applied five
non-blocking fixes: (1) a canonical-spec + code-comment accuracy bug — the disliked **cooldown** is
interaction-driven, not snapshot-driven (only the repetition window is snapshot-driven); (2) an
occasion-persist closure-stale clobber in the dashboard reconcile (round-trips the saved occasion now,
display-only); (3) extracted+tested `buildActionByKey` (the reconcile adapter — closes the TEST-1
field-name/key-format drift risk); (4) hardened the Python shared-fixture sort to parse instants (was a
raw string compare that could silently diverge from the JS ms-compare); (5) de-duped a floor-count restate
in runbook §8. Floors grew **721→758 jest / 1095→1096 pytest**; tsc/eslint(0 err)/`npm run build` clean.
**Committed on `main` (`abc0ba19` + `64b15825`); NOT yet deployed — Brian's call.**

- **PHASE 1 — History curation (D-1/D-2/#4): DONE.** `DELETE /api/interactions` (`deleteInteraction`) is
  the sanctioned curation door — user-scoped native-driver hard-delete of EVERY row for a
  `{snapshotId,candidateId}` binding; cross-user → 404; idempotent (404==done client-side). **Flip =
  appended opposite action** via POST (append-only intact). History deduped to per-candidate latest-state
  (`lib/latestFeedbackState.ts`) — one card per outfit; the NEW-C two-card bug is gone. #4: reachability
  raised to the **full per-user corpus** (2000-row cap), matching the M6 export's reach so nothing
  trainable is un-curatable. **Trap-guards:** delete removes ALL rows for the binding (latest-only would
  resurrect a superseded action); snapshots NEVER touched (deleting a `rejected` un-blocks that signature
  — expected, not a regression). Cross-runtime latest-state pinned equal (TS helper == export CJS picker
  == Python reducer) by one shared fixture, incl. the action-gate (planned/packed can't win) + whitespace
  parity. Homed in spec §16 + §23-H11/H54.
- **PHASE 2 — dislike-reason data-loss (D-3): DONE.** Fable picked **(b) durable enrich**: `useDislikeEnrich`
  hook HOLDS the composed reasons and retries on failure (per-card affordance) instead of the pre-fix
  silent drop. **Trap-guard:** in-session ONLY (no cross-load persist) — persisting would widen the
  stale-supersede window; do not add it. The dashboard also reconciles restored chips vs server
  latest-state (`lib/feedbackReconcile.ts`) to close the dislike→flip-in-History→return re-entry.
- **PHASE 3 — friend UX: DONE.** F6 (CV-honest default), F7 (de-jargon), F8 (auth-error tone — **+ signup,
  same leak**), F9 (`error.tsx`/`not-found.tsx`), F10 (empty-state wardrobe link), F11 (HEIC-aware reject),
  F13 (regenerate-replaces hint), F14 (lock-error tone → `lib/recommendCopy`), F16 (partial-render hint),
  NEW-A (event hint). **F12 verified** (replace works + D2-correct; clear-to-nothing intentionally absent —
  photos are the corpus).

## WHOLE-CODEBASE SWEEP 2026-07-19 (5 fresh-context lanes over the 18th+19th window vs baseline 1e13ed5b)

Ran after the commit above to answer "did the 18th+19th window make anything WORSE, and any leftover
errors anywhere." Lanes: dashboard-feedback regression, wardrobe-ingestion regression, core-recommend+API
sweep, data-integrity+erasure whole-app, history/interactions cross-consumer. **Result: no regressions,
both sacred promises (append-only corpus + account-erasure) hold, core value path untouched + hardened.**
The 18th's REQFIELDS-1 actually *improved* corpus safety (category is now a required select — no silent
mis-slotted item). Two small fixes applied + tested (floor 758→759 jest):
- **PERF-1 (regression, fixed):** the History GET `find` was unprojected — up to 2000 full interaction rows
  pulled per view (and per dashboard restore-reconcile) vs baseline's 50-row cap. Added `.select(...)` to
  the 6 fields actually read. ~40× less M0 wire read.
- **CLEAR-1 (pre-existing, fixed):** `referencedImageIds` didn't hex-validate the id tail, so a crafted
  `imagePath="mongo:garbage"` could CastError the clear-wardrobe `$nin` → 500 *after* items deleted
  (partial clear). Added a hex guard mirroring the item-delete path + `parseImageId`; regression test added.
- **DEPLOY (config, not code):** every core-flow misconfig fails *silently* to a degraded empty state, so a
  mistyped env var = zero friend yield with no alarm. Pre-friend checklist now in runbook §8.

## KNOWN RESIDUALS (bounded, non-corrupting or astronomically rare — registered, not fixed)
- **TOCTOU-1 (latent, pre-existing)** — item-delete / clear-wardrobe check "image not referenced" then
  delete; a render persisting a snapshot that references it in that window leaves the fresh outfit's image
  side `unresolved` in the export. One image, corpus-only, needs delete-during-in-flight-render. Inherent
  to the D2 design; not worth a lock at study scale.
- **ERASE-SELFHEAL-1 (latent, pre-existing)** — the in-flight erasure self-heal (`interactions.ts` +
  `mlRecommend.ts`) deletes ALL of a user's rows when a single `User.exists` read returns false; a
  false-negative read would over-delete a live corpus. Impossible on single-node Atlas M0; revisit only if
  read-replicas are ever added.
- **CURATE-1** — a History flip-to-dislike is reasonless (no modal there), so a flip-flop (dislike→like→
  dislike) loses the original `feedbackReason`. The LABEL stays correct (rejected); only the optional
  "why" is lost. Fixing = carry-forward the latest same-sign reason in the collapse (changes the pinned
  H61 rule) — deferred; not worth it at study scale.
- **CURATE-2** — cross-instance clock skew could give a slow enrich an older `createdAt` than its one-tap,
  dropping the "why". NTP keeps Vercel clocks ~sub-ms; label stays correct. Rare + silent; registered.
- **CURATE-3** — two-tab / in-flight-enrich-across-navigation conflicting curation resolves last-write-wins
  (append-after-delete has no tombstone). Requires two tabs or an abnormally slow enrich + immediate
  cross-page flip. Bounded; a refetch-after-curation would tidy the view but not change the resolution.
- **TEST-1 (narrowed after the review pass)** — no full `DashboardInner` mount test. The reconcile
  ADAPTER (`buildActionByKey`: GET payload → `{snapshotId}:{candidateId}` map) is now unit-tested and
  keys off the shared `feedbackKey`, so a response-field/key-format drift reddens a test rather than
  silently reopening the stale-chip vector. What still rides on inspection: the mount FIRE CONDITION
  (no-pending-envelope ∧ saved-result) and the `prev !== baseResult` identity guard — glue that only
  reads/updates local state; triple-verified correct, corpus-safe (a mislabel is impossible under
  append-only + latest-state). A ~15-line RTL mount test would close the remainder; deferred.
- **CURATE-4 (minor, non-corpus)** — the History `curationErrorMessage` copy + the `res.status !== 404`
  idempotency branch have no unit test (`historyCuration.test.tsx` covers the happy path only). Friend-
  facing copy, not a corpus path; registered.

## You are
Picking up a fix session on **Fitted** (monorepo `/Users/Brian/Documents/fitted`: Next app in `fitted/`,
Python render service in `ml-system/`). **Deployed + live:** Vercel `fitted-three.vercel.app` (web) +
Fly `fitted-render-service` (Python, **must stay 1 machine**) + Atlas **M0** (free tier). Goal of Track 2:
collect 3–5 friend closets → M6/H26 image-embedding re-measure, so **feedback-label + corpus integrity is
sacred**. Deploy state lives only in runbook §8 (single home). Floors: **784 jest / 1097 pytest** (grow, never pin).

## Read first
`CLAUDE.md` (conventions, append-only invariant, build-and-audit loop), `docs/Fitted_Spec_v2.md`
§6.5/§6.6/§16/§23 (feedback posture, H10/H29/H43/H54/H61), runbook `docs/plans/m5-c8-half2-runbook.md` §8.
Key files: `fitted/lib/interactions.ts`, `fitted/app/api/interactions/route.ts`,
`fitted/models/OutfitInteraction.ts`, `fitted/app/(app)/history/page.tsx`,
`fitted/app/(app)/dashboard/page.tsx` (feedback handlers ~870–963), `fitted/lib/mlBehavioralRows.ts`,
`ml-system/fitted_core/reducers.py`, `fitted/scripts/exportTrack2Core.cjs`, `fitted/models/User.ts`
(cascade) + `fitted/app/api/account/route.ts` (the sanctioned native-driver delete door).

---

## PHASE 1 — History curation cluster (MUST-FIX; build as ONE unit, shared files + tests)

These three are one coupled problem. **Get a Fable read on the design calls (below) before coding.**

**D-1 — Curation endpoint + UI (flip / remove / delete).** Today `interactions/route.ts` is GET+POST only
(no DELETE/PATCH); History (`history/page.tsx:9–14`) is read-only append-only cards. Add the ability to,
from History: **flip** a like↔dislike, **remove** a reaction, and **genuinely hard-delete** feedback (the
"little bro added 5 reactions → they must cease to exist" case).
- **Flip = append the opposite action.** The reducer (`reducers.py:81–131`) is per-candidate latest-state
  (`{createdAt:-1,_id:-1}`) and the export uses the same rule → **zero engine change**, already H61-correct.
- **Hard-delete = literal row delete** via the **sanctioned native-driver door**
  `OutfitInteraction.db.collection("outfitinteractions").deleteMany({ _id, user })` — the exact pattern in
  `interactions.ts:273` + `User.ts:53–56`. There is **no cached/derived affinity** (PreferenceSummary was
  ripped in M4a; affinity recomputes from the log every request), so a delete is consistent by construction
  — reducer + export simply stop seeing the row.
- **Do NOT touch snapshots** on flip/delete — they're immutable training truth (H10/H29). Deleting feedback
  correctly reverts that candidate's label to `null` (shown-but-unrated); it does NOT un-surface a repeated
  outfit (repetition/cooldown is snapshot-driven, not interaction-driven).

**D-2 — History dedup (NEW-C, folds in here).** `getInteractions` (`interactions.ts:367–375`) returns the
**raw append-only log** — the ONLY view not collapsing to latest-state (reducer + export both collapse per
`{snapshotId,candidateId}`). Result: a one-tap dislike + its "tell us why" show as **two** cards; post-flip a
candidate would show in both tabs. Fix: dedup the History query to latest-state per `{snapshotId,candidateId}`
using the **export's explicit `createdAt`-then-`_id` rule** (not sort-as-truth). **Pin reducer↔export↔History
"latest" equality with ONE shared fixture/test** — three independent latest-state impls exist today; that's
the cross-runtime-drift disease CLAUDE.md warns about.

**#4 — History reachability window (MUST-FIX; the reviewer's catch).** `getInteractions:364–367` filters
`createdAt ≥ 1 month` + `HISTORY_LIMIT=50` per tab. Friends collect over weeks → older feedback **drops off
History and becomes un-curatable**, defeating D-1 for the exact accumulation the study wants. Raise/remove the
time filter for the curation view; paginate instead of a hard 50-cap; keep the lean projection.

**Design calls for Fable/Brian (settle before coding):**
1. `remove a reaction` = hard-delete that row (recommended — no neutral action exists in `COUNTED_ACTIONS`,
   adding one is scope creep), while `flip` = append and `delete` = hard-delete. Confirm this 2-write/1-delete split.
2. Confirm delete/flip never mutate the bound snapshot (recommended: never).

**Trust boundary (non-negotiable):** scope every delete by `{ _id, user }`; rate-limit via the existing
`interactions.ts:56` token bucket; route through the native-driver door so the append-only `pre('validate')`
guard stays intact on all non-sanctioned paths. **Add a behavioral test: a cross-user delete 404s.**

---

## PHASE 2 — Dislike reason data-loss + double-write (D-3; Fable call)

`dashboard/page.tsx`: `handleDislike` (~:940) posts a reasonless `rejected` immediately; `handleSaveDislike`
(~:958) posts a **second** `rejected` with the reason codes. H61 collapses them (reason row wins) so training
isn't double-counted — **but the enrich POST has no retry/local-persist**; on failure the reason is **lost**
(the observed "no reason saved" case). The structured `feedbackReason` codes are the **sole trainable "why"
channel** (§16) → real M6 label loss. Secondary: 2 rows/dislike eats the 500-row reducer scan window
(`mlBehavioralRows.ts:25`) + the 2000-row/user cap.
- **Fix (Fable call):** (a) send the reason on the **first** dislike POST when the modal is used → one write,
  kills the duplicate row AND the data-loss window AND reclaims budget; keep one-tap-only as a single
  reasonless row. vs (b) keep two writes but make the enrich POST durable (retry/queue). (a) is cleaner but
  trades the "a dislike costs the same as a like" symmetry the split was built for.

---

## PHASE 3 — SHOULD-FIX (friend UX; batch as copy/polish, light audit loop each)
- **F6** CV-optimistic window (`wardrobe:648–650`) → default `cvUnavailable=true`.
- **F13** regenerate on a rated card silently replaces the list (`dashboard`) — add a hint / confirm.
- **F16** partial render (1–2 of 3) drops the insufficient hint (`dashboard:~1055`).
- **F10** `notEnoughItems` empty state has no `/wardrobe` link.
- **F14** raw lock errors (`mlRecommend.ts:246`) leak engineer tone.
- **F9** add `error.tsx` / `not-found.tsx` boundary.
- **F12** verify edit can replace/clear a stored photo (`wardrobe:1103–1119`, likely D2-intended).
- **Copy batch:** F7 "style-matching experiment" jargon (`wardrobe:1123`), F8 dev-toned auth errors
  (`signin:15,30`), NEW-A "…and any constraints" event hint, F15 pre-GPT "not enough" copy, F11 HEIC reject
  (`wardrobe:395`).

## PHASE 4 — Infra decision (Brian's call, not code)
**NEW-D:** History cold-load is Atlas M0 cold-connect latency (already applied `autoIndex:false` in prod,
`mongodb.ts:38`; no further code lever). Decide: pay **M2 ~$9/mo** (far faster connects) for the study window
vs accept multi-second first-loads. `maxPoolSize:5` is fine for 3–5 friends.

## OBSERVE — do NOT "fix" (set expectations instead)
- **NEW-B** risk axis (safe/noticeable/bold) is visibility-driven (`response.py:361–410`) → a neutral closet
  reads all "safe"; the 2-D spread collapses to 1-D. By design; demo value depends on closet variety.
- Weather invisible in output (cosmetic); **F17** engineFailure vocab collapse (corpus keeps detail).

---

## Discipline (do without re-prompting)
Build-and-audit loop per CLAUDE.md: read real files first (line-cites drift), match team style, per-checkpoint
`npm test` + `npx tsc --noEmit` + `eslint` on touched + one fresh-context review agent; **heavy loop before the
curation cutover** (it's a new trust-boundary endpoint that mutates/deletes user data). Behavioral tests over
real in-memory Mongo (write→read-back), not mocks. **Verify every subagent finding against source yourself.**
Commit on `main` (solo fork). Deploy: web `cd fitted && npx vercel --prod`, service `cd ml-system && fly deploy`
then `fly scale show` **= 1**; NEVER vercel-deploy the repo root. Get a **Fable read** on the two D-1 design
calls + the D-3 write-count tradeoff before coding. **M6-corpus check:** the export handles curation for free
(hard-delete → gone; flip → latest-state picks newest) — the only export work is the D-2 shared-fixture test.
