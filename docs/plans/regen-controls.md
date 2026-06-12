# Regeneration controls: locks + contextual dislikes

> Design plan (no code yet). The binding decision is **R9** in `spec-resolutions.md` — this doc
> holds execution detail and is consumed by the M3 (ranker) and M5 (wiring) specs. Interview
> with Brian 2026-06-12.

## Goal

Carry the legacy regenerate controls — **item locks** ("keep the jeans") and **contextual
dislikes** ("not this shirt, for this re-roll") — into the v1.2 two-stage-cache architecture,
where regenerate is a re-rank of cached candidates rather than a fresh GPT call.
`changeTarget` and `feedbackNotes` are dropped (R9).

## Success criteria

- [x] R9 recorded in `spec-resolutions.md` with pipeline-step assignments (this session).
- [x] Stale "decide at M3/M5" pointers in `legacy-prospecting.md` §3.1/§5 resolved to R9.
- [ ] M3: pure functions in `fitted_core` with pytest — regen filter, escalation trigger,
      constrained-pool pinning, impossible-lock detection, merge dedup (tests listed below).
- [ ] M5: single recommend route accepts `lockedItemIds`/`dislikedItemIds` + `generationIndex`;
      legacy `regenerate/route.ts` retired; dashboard modal keeps lock checkboxes and per-item
      dislikes, drops the changeTarget dropdown.
- [ ] Observable behavior: a locked re-roll returns K outfits all containing every locked item,
      or fewer plus an explicit notice — never silently fewer (F14 guard).

## Files touched

**Now (design session, done):**
- `docs/plans/spec-resolutions.md` — R9 + Step-4 note under the §1 pipeline table.
- `docs/plans/legacy-prospecting.md` — §3.1 and §5 routing now point to R9.
- `docs/plans/regen-controls.md` — this doc.

**M3 (build, in `ml-system/fitted_core/`):**
- `ranker.py` (new at M3; module name set by the M3 spec) — `apply_regen_filters`, `needs_escalation`.
- `sampler.py` — `build_constrained_pool` (pin variant of M1-5's `build_candidate_pool`).
- `slotmap.py` (M0-4 home) — `contains_locks(slotmap, locked_ids)` containment check.
- `tests/test_regen_controls.py` — new.

**M5 (wiring):**
- `fitted/app/api/recommend/route.ts` — accept the two arrays; escalation orchestration;
  `regenNotice` in the response.
- `fitted/app/api/recommend/regenerate/route.ts` — **deleted** (deletion license; fails the
  M5-cutover survival test; decision recorded here per CLAUDE.md threshold).
- `fitted/app/(app)/dashboard/page.tsx` — regenerate modal: changeTarget dropdown removed;
  locks/dislikes repointed at the single route.

**Frozen:** everything else. No code changes before M3; `outfit_recommender.py` untouched (M6).

## Approach

Regen controls are **per-request parameters to the Steps 4–6 re-rank**, the same class as
`generationIndex` and the cooldown buffer — they never enter `session_seed` or the cache key
(R1 invariant preserved: the cache stores the candidate stage; per-request state shapes what
survives it).

1. **Contextual dislikes — Step 4 filter.** Drop cached candidates containing any
   `dislikedItemIds`. Request-scoped only; the persistent per-item labels are already written
   by `POST /api/interactions` (`perItemFeedback`), so no new label plumbing. (Verified in
   `dashboard/page.tsx:817–890` + `interactions/route.ts:118–162`.)
2. **Locks — Step 4 filter + escalation.** Keep only candidates containing **all**
   `lockedItemIds`. If survivors `< DEFAULT_K` after both filters, **escalate once**: a
   constrained re-entry of Steps 1–3 — locked items **pinned into the pool before sampling**
   (the F14 fix), disliked items excluded, a must-include instruction in the GPT prompt,
   normal Step-3 validation **plus** lock-containment check. Sizing reuses M1-4
   `candidate_requested` / `MAX_CANDIDATES` unchanged.
3. **Merge into the session pool.** Escalation output is appended to the cached candidate
   pool, deduped by FullSignature. One cache entry per session, key unchanged; repeat re-rolls
   with the same lock are then free, and unconstrained re-rolls gain variety. At most one
   escalation per request; growth is bounded by dedup + cache TTL.
4. **Failure = partial + explicit notice.** If escalation still yields `< K` lock-satisfying
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
| Locked item deleted/`isAvailable === false`/not owned | Drop that lock, proceed, include in `regenNotice` | Wardrobe changed since the outfit was shown; honest partial beats hard failure. |
| Structurally impossible lock set (one-piece + top/bottom; two of one slot — §13 rules) | Reject **before** any filtering/GPT spend, explicit §19-style message | Escalation can't fix structure; don't pay for guaranteed-invalid candidates. |
| Survivors < K after filters | One escalation call, merge, re-run Steps 4–6 | The core mechanism. |
| Escalation candidates missing locks / failing validation | Dropped by Step 3 + containment check; may land in partial+notice | Backend never repairs GPT output (F4 lesson). |
| Still < K after escalation | Partial + `regenNotice`; **no second escalation** | Cost bound: max one GPT call per request. |
| Cache miss on a locked re-roll (TTL expired) | Normal Steps 1–3 rebuild, then same filter→escalate path | Mechanism is identical; no special case. |
| Cooldown (Step 4) removes lock-satisfying candidates | Counts toward starvation → escalation; cooldown is **not** bypassed | Dislikes retain final authority (E1). |
| Dislikes alone starve the pool (no locks) | Same escalation path, nothing pinned, dislikes excluded from the pool | One mechanism covers both controls. |

## Out of scope

- `changeTarget` and `feedbackNotes` — dropped from the contract (R9). The dropdown dies at M5.
- Any new persistent state: locks/dislikes live in the request only; no schema changes.
- Lock persistence across sessions or "pinned favorites" semantics (that's §3.7 `isFavorite`, M4).
- Building any of this before M3 — M0/M1/M2 substrate must exist first.
- UI redesign beyond the minimal modal edit at M5.
- Rate limiting of escalation beyond the one-per-request bound (D2 posture unchanged).

## Verification plan

**M3 (pytest, `ml-system/`):**
- `apply_regen_filters`: dislike removal, all-locks containment, combined; determinism
  (pure function, no RNG).
- `needs_escalation`: boundary at `DEFAULT_K` (K-1 → True, K → False).
- `build_constrained_pool`: pinned items present regardless of caps/sampling (the F14
  regression test: a locked item that would lose the sampling lottery still appears);
  disliked items absent; remaining slots respect M1 caps.
- Impossible-lock detection: one-piece + bottom → rejected pre-GPT.
- Merge: FullSignature dedup; pool size monotone non-decreasing; no duplicate signatures.

**M5 (manual + jest):** locked re-roll on a real wardrobe → all returned outfits contain the
lock or a `regenNotice` is present; regenerate route returns 410/removed; modal exercises the
single route. Command: `cd ml-system && pytest` / `cd fitted && npm test`.

## Open questions

None blocking. Deferred to their owners: exact `regenNotice` copy (M5, §19 messaging pass),
must-include prompt wording (M2 prompt design), whether escalation reuses the full
`candidate_requested` count or a smaller constant (M3, default = reuse unchanged).
