# Friend-facing fixes — fresh-session prompt/plan

> Paste this into a `/clear`-ed session. It is the execution plan for fixing the friend-facing backlog
> found during the 2026-07-18/19 Track-2 gauntlet. Scope grounded by a deep source review; every item
> carries a file:line. **Single home for the backlog is now THIS doc**; runbook §8 points here.

## You are
Picking up a fix session on **Fitted** (monorepo `/Users/Brian/Documents/fitted`: Next app in `fitted/`,
Python render service in `ml-system/`). **Deployed + live:** Vercel `fitted-three.vercel.app` (web) +
Fly `fitted-render-service` (Python, **must stay 1 machine**) + Atlas **M0** (free tier). Goal of Track 2:
collect 3–5 friend closets → M6/H26 image-embedding re-measure, so **feedback-label + corpus integrity is
sacred**. Current live build ≈ `414dca7b`. Floors: **721 jest / 1095 pytest** (grow, never pin).

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
