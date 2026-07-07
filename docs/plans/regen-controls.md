# Regeneration controls: locks + contextual dislikes

> **SUPERSEDED FOR M5 IMPLEMENTATION.** This note is historical design context for the old v2
> two-stage-cache/re-rank model. `docs/plans/m5-cutover.md` is authoritative for M5: regenerate is one
> constrained fresh generation, no TTL candidate cache, no session-pool merge, lineage is server-derived from
> an ownership-verified parent snapshot, and an unavailable/deleted locked item is a stable pre-service error
> rather than a silently dropped lock. Do not implement the cache/merge/drop-lock behavior below for M5.

> Design note. The binding decision is **R9** in `Fitted_Spec_v2.md` §14 / Appendix A. This doc
> preserves the historical regeneration-control design that preceded the M5 fresh-generation decision.
> The completed M3 ranker
> plan supersedes the old M3 execution notes here. Historically this doc said M5 would own constrained
> Steps 1-3 re-entry, lock pinning, prompt wording, and the now-superseded cache merge. The fresh-generation
> cutover supersedes that cache/merge half. Interview with Brian 2026-06-12.

## Goal

Historical goal: carry the legacy regenerate controls — **item locks** ("keep the jeans") and **contextual
dislikes** ("not this shirt, for this re-roll") — into the v2 two-stage-cache architecture,
where regenerate was modeled as a re-rank of cached candidates rather than a fresh GPT call.
`changeTarget` and `feedbackNotes` are dropped (R9).

## Success criteria

- [x] R9 folded into `Fitted_Spec_v2.md` §14 / Appendix A with pipeline-step assignments.
- [x] M3: completed in the ranker as request-scoped filters/diagnostics over already-built
      candidates; no constrained re-entry, pinning, or merge lives in M3
      (`docs/plans/m3-ranker.md` is authoritative).
- [ ] M5: **superseded by `m5-cutover.md`** — single route accepts `lockedItemIds`/`dislikedItemIds`;
      regenerate is one constrained fresh generation with server-derived lineage; no cached-pool merge.
- [ ] Observable behavior: a locked re-roll returns K outfits all containing every locked item,
      or fewer plus an explicit notice — never silently fewer (F14 guard).

## Files touched

**Now (design session, done):**
- `docs/Fitted_Spec_v2.md` — R9 lives in §14 / Appendix A.
- `docs/plans/regen-controls.md` — this doc.

**M3 (completed; see `docs/plans/m3-ranker.md`):**
- `ranker.py` — request-scoped lock/contextual-dislike filters, lock-starvation diagnostics,
  fallback over existing candidates, and score/rank/diversity behavior.
- No constrained-pool builder, GPT re-entry, prompt pinning, or cache merge. M3 reports the
  need; M5 decides and orchestrates re-entry.

**Historical M5 wiring model (superseded by `m5-cutover.md`):**
- `fitted/app/api/recommend/route.ts` — accept the two arrays; escalation orchestration;
  `regenNotice` in the response.
- M5 service/adapter boundary — if escalation is used, run the constrained Steps 1-3 re-entry,
  keep locked items pinned, exclude contextual dislikes. The cached-pool merge described in the old model is
  superseded; M5 fresh generation writes a child snapshot instead.
- `fitted/app/api/recommend/regenerate/route.ts` — **deleted** (deletion license; fails the
  M5-cutover survival test; decision recorded here per CLAUDE.md threshold).
- `fitted/app/(app)/dashboard/page.tsx` — regenerate modal: changeTarget dropdown removed;
  locks/dislikes repointed at the single route.

**Frozen:** everything else. No code changes before M3; `outfit_recommender.py` untouched (M6).

## Approach

Historical model: regen controls were **per-request parameters to the Steps 4–6 re-rank**, the same class as
`generationIndex` and the cooldown buffer — they never enter `session_seed` or the cache key
(v2 §15 invariant preserved: the cache stores the candidate stage; per-request state shapes what
survives it).

1. **Contextual dislikes — Step 4 filter.** Drop cached candidates containing any
   `dislikedItemIds`. Request-scoped only; the persistent per-item labels are already written
   by `POST /api/interactions` (`perItemFeedback`), so no new label plumbing. (Verified in
   `dashboard/page.tsx:817–890` + `interactions/route.ts:118–162`.)
2. **Locks — Step 4 filter + diagnostic.** M3 keeps only candidates containing **all**
   `lockedItemIds`. If survivors `< DEFAULT_K` after filters, M3 reports starvation; it does
   not fabricate a locked outfit, silently drop a lock, or re-enter Steps 1-3.
3. **Escalation — M5-owned.** If M5 chooses to escalate, it does so at most once with a
   constrained re-entry of Steps 1-3 — locked items **pinned into the pool before sampling**
   (the F14 fix), disliked items excluded, a must-include instruction in the GPT prompt,
   normal Step-3 validation **plus** lock-containment check. Sizing reuses M1-4
   `candidate_requested` / `MAX_CANDIDATES` unchanged unless the M5 spec changes it.
4. **Merge into the session pool — M5-owned.** Escalation output is appended to the cached
   candidate pool, deduped by FullSignature. One cache entry per session, key unchanged;
   repeat re-rolls with the same lock are then free, and unconstrained re-rolls gain variety.
   Growth is bounded by dedup + cache TTL.
5. **Failure = partial + explicit notice.** If escalation still yields `< K` lock-satisfying
   outfits, return what exists with a `regenNotice` ("we couldn't keep [item] in every
   outfit"). Locks are never silently dropped.

**Alternatives rejected** (interview 2026-06-12): *filter-only* (locks too weak — a specific
item appears in ~1–2 of 40 unconstrained candidates, so most locked re-rolls would starve);
*always-regenerate* (legacy behavior; every locked click pays a GPT call and the cache win
evaporates); *lock-keyed cache entries* (bookkeeping multiplies, shared-pool benefit lost);
*changeTarget as soft similarity preference* (dropped instead — locks express the intent, one
less mechanism); *keeping `feedbackNotes`* (UI never sends it on regen; notes already persist
via the feedback flow; the free re-rank has no GPT call to consume text).

## Edge cases

| Trigger | Behavior | Why |
|---|---|---|
| Same id in `lockedItemIds` and `dislikedItemIds` | 400 | Client bug; no sane semantics. |
| Locked item deleted/`isAvailable === false`/not owned | **M5 current:** stable pre-service 400; do not silently drop the lock | `m5-cutover.md` treats a requested lock as user intent and rejects unsatisfiable locks before spend. |
| Structurally impossible lock set (one-piece + top/bottom; two of one slot — v2 §13 rules) | Reject **before** any filtering/GPT spend, explicit §19-style message | Escalation can't fix structure; don't pay for guaranteed-invalid candidates. |
| Survivors < K after filters | M3 reports starvation; M5 may make one escalation call, merge, then re-run Steps 4–6 | M3 reports, M5 owns re-entry. |
| Escalation candidates missing locks / failing validation | Dropped by Step 3 + containment check; may land in partial+notice | Backend never repairs GPT output (F4 lesson). |
| Still < K after escalation | Partial + `regenNotice`; **no second escalation** | Cost bound: max one GPT call per request. |
| Cache miss on a locked re-roll (TTL expired) | Normal Steps 1–3 rebuild, then same filter→escalate path | Mechanism is identical; no special case. |
| Cooldown (Step 4) removes lock-satisfying candidates | Counts toward starvation → escalation; cooldown is **not** bypassed | Dislikes retain final authority. |
| Dislikes alone starve the pool (no locks) | Same escalation path, nothing pinned, dislikes excluded from the pool | One mechanism covers both controls. |

## Out of scope

- `changeTarget` and `feedbackNotes` — dropped from the contract (R9). The dropdown dies at M5.
- Any new persistent state for locks/dislikes: they live in the request only; no schema changes.
- Lock persistence across sessions or "pinned favorites" semantics (related to the `isFavorite` cold-start prior in v2 §11, M4).
- Reopening completed M3 scope: new escalation/pinning/merge behavior belongs to M5 wiring, not the ranker.
- UI redesign beyond the minimal modal edit at M5.
- Rate limiting of escalation beyond the one-per-request bound (D2 posture unchanged).

## Verification plan

**M3 (completed; `ml-system/`):**
- Request filters: dislike removal, all-locks containment, combined behavior, determinism.
- Starvation diagnostics: boundary at `DEFAULT_K` (K-1 → flagged, K → not flagged).
- Non-relaxable controls: locks/contextual dislikes are never silently dropped in fallback.
- M3 has no constrained-pool, GPT re-entry, or merge tests because those behaviors are M5-owned.

**M5 (manual + jest):** locked re-roll on a real wardrobe → all returned outfits contain the
lock or a `regenNotice` is present; constrained re-entry pins locked items and excludes
contextual dislikes; merge dedups by FullSignature; regenerate route returns 410/removed;
modal exercises the single route. Command: `cd ml-system && pytest` / `cd fitted && npm test`.

## Open questions

None blocking. Deferred to their owners: exact `regenNotice` copy (M5, §19 messaging pass),
must-include prompt wording (M5 constrained re-entry spec), whether escalation reuses the full
`candidate_requested` count or a smaller constant (M5, default = reuse unchanged).
