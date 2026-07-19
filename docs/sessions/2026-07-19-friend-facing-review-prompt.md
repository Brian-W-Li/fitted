# Review prompt — friend-facing fixes (uncommitted, 2026-07-19)

> Paste into a `/clear`-ed session. This is a **REVIEW** session, not a build session. A prior session
> implemented the friend-facing-fixes backlog (Phases 1–3) but **did NOT commit** — the working tree is
> dirty on purpose so you can review it first. Your job: independently decide if it's commit-worthy, or
> produce a ranked blocker list. **Do not trust the prior session's summary — verify every claim against
> source** (the repo norm: [[feedback_verify_before_answering]], [[feedback_citation_accuracy]]).

## You are
Reviewing uncommitted work on **Fitted** (monorepo `/Users/Brian/Documents/fitted`: Next app in `fitted/`,
Python service in `ml-system/`). **Deployed + live:** Vercel `fitted-three.vercel.app` + Fly
`fitted-render-service` (**must stay 1 machine**) + Atlas **M0**. Track 2 goal: collect 3–5 friend closets
→ M6/H26 image-embedding re-measure, so **feedback-label + corpus integrity is sacred** (a lost/corrupt
label degrades the one-shot measurement, no re-do). Bar is also **"no apparent holes; best-it-can-be for
friends."** Nothing here is deployed; deploy is Brian's (web `npx vercel --prod` from `fitted/`, Fly untouched).

## Read first
`CLAUDE.md` (build-and-audit loop, append-only invariant, doc-lifecycle). `docs/plans/friend-facing-fixes.md`
(the plan + the STATUS/RESIDUALS block the prior session wrote — this is the single backlog home).
`docs/Fitted_Spec_v2.md` §16 + §23-H11/H54/H61 (were edited — check they're accurate + conflict-free).

## What the prior session did (VERIFY each — cite file:line, don't assume)
Working tree: **15 modified + 12 new files, uncommitted.** `git status` / `git diff` to see it all.

**Phase 1 — History curation (D-1/D-2/#4):**
- `fitted/lib/interactions.ts` — `deleteInteraction` (new DELETE curation door): user-scoped native-driver
  hard-delete of ALL rows for one `{snapshotId,candidateId}`; cross-user → 404. `getInteractions` now
  dedups to per-candidate latest-state over the FULL per-user corpus (`HISTORY_SCAN_LIMIT =
  MAX_INTERACTIONS_PER_USER`), dropping the old 1-month/50-cap.
- `fitted/app/api/interactions/route.ts` — added `DELETE` (POST still append-only; a **flip = an appended
  opposite action** via POST, not an edit).
- `fitted/lib/latestFeedbackState.ts` (NEW) — shared latest-state rule (max createdAt, tie-break `_id` hex
  desc), action-gated to {accepted,rejected}, `.trim()` parity with the reducer. Mirrored in
  `scripts/exportTrack2Core.cjs`; pinned equal to the Python reducer by `tests/fixtures/…` +
  `tests/latestFeedbackState.test.ts` + `ml-system/tests/test_reducers.py::test_latest_state_matches_shared…`.
- `fitted/app/(app)/history/page.tsx` — one GET split into tabs; per-card flip + remove (inline-confirm);
  code-aware curation error copy.

**Phase 2 — dislike-reason data-loss (D-3):**
- `fitted/lib/useDislikeEnrich.ts` (NEW) — the enrich hook: HOLDS the "why" + retries on failure (was
  silently dropped). In-session only (deliberate — read the docblock's trap-guard).
- `fitted/lib/feedbackReconcile.ts` (NEW) + `dashboard/page.tsx` — reconcile RESTORED feedback chips vs
  server latest-state on return, closing the dislike→(History)flip→return→"tell us why"→superseding-POST
  corpus corruption. **Scrutinize the dashboard wiring** (below).

**Phase 3 — friend UX:** `dashboard` (F10/F13/F14/F16 + NEW-A), `wardrobe` (F6/F7/F11), `signin`+`signup`
(F8, both), `lib/recommendCopy.ts` (NEW, F14/F15), `app/error.tsx` + `app/not-found.tsx` (NEW, F9).

## HIGHEST-SCRUTINY AREAS (where a real bug would hide — hunt here)
1. **Dashboard reconciliation wiring** (`dashboard/page.tsx` `reconcileFeedbackFromServer` + the restore
   `useEffect`). It was moved to run AFTER `persistResult` to avoid a TDZ; confirm no TDZ/ordering bug
   (it's referenced in the effect BODY, defined later — same lazy-closure pattern as `resumePending`).
   Confirm the **identity guard** (`prev !== baseResult`) truly prevents clobbering a fresh in-session
   mark, and that it can't race a resuming render. **This is client glue with no dashboard-mount test
   (registered as TEST-1)** — decide if that gap is acceptable or write the mount test.
2. **The DELETE trust boundary** (`deleteInteraction`): re-derive that IDOR is impossible (user-scoped
   from token), `candidateId` from the query string can't become a NoSQL operator, ObjectId casts are
   present + required, and 404-on-0 is leak-free. Behavioral tests in `tests/interactionsBinding.test.ts`.
3. **Cross-runtime latest-state agreement** (three impls). Confirm the shared fixture actually exercises a
   same-createdAt `_id` tie-break and the action-gate; confirm the export/History/reducer can never pick
   different winners for co-visible rows.
4. **Append-only coherence**: a flip is an append (not an edit); the DELETE is the only sanctioned
   interaction hard-delete besides the account-erasure cascade + the POST self-heal. Confirm the erasure
   promise still holds and no partial/forged row can be written.

## Already-known residuals — do NOT re-report as new (they're deliberate; see the plan's RESIDUALS block)
CURATE-1 (flip-flop loses the "why"; label stays correct), CURATE-2 (clock-skew reason loss),
CURATE-3 (two-tab / in-flight-enrich-across-nav → last-write-wins), TEST-1 (no dashboard-mount test).
If you think any should be promoted to a blocker, argue it from source.

## Verification (run it; floors GROW, never pin)
```sh
cd fitted && npx tsc --noEmit && npx jest --runInBand && npm run build   # expect: 0 / 755+ pass (10 skip) / build ✓
cd ../ml-system && source .venv/bin/activate && python -m pytest tests service/tests -q   # expect: 1096+ pass
cd ../fitted && npx eslint <touched files>   # expect: 0 errors (img/underscore WARNINGS are pre-existing)
```
Floors this session: **755 jest / 1096 pytest** (were 721/1095). `git stash` if you need a clean baseline.

## Deliverable
A ranked verdict: **commit-worthy** (with the commit message you'd use) OR a blocker list (each with a
file:line + a failing input→wrong output). Reconcile any doc conflict you find in the same pass. If you
apply fixes, re-run the full suite and keep the floors growing. Do not deploy; do not commit without Brian.
