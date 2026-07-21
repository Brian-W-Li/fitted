# Fitted Documentation Map

This directory mixes active v2 planning docs with CS148-era and deployed-app history. For future-looking work,
read by authority level, not by filename age or folder location.

## Read first for future work

- `../CLAUDE.md` - repo operating guide and default reading list for AI/code sessions.
- `Fitted_Spec_v2.md` - canonical product and technical spec. This wins over every older doc.
- `plans/m4-data-model-migration.md` - **completed M4 reference** (C1–C8 ✅ done; §14 is the ladder, §14.5 the M5-handoff). **H26 is DONE (C1–C6, 2026-07-05; verdict NO-GO by the frozen letter — a gate-B power miss, not an accuracy miss; deliverable `ml-system/experiments/h26/results.md`, completed reference `plans/h26-compatibility-spike-v2.md`). M5 is DONE + deployed** (`plans/m5-cutover.md` completed reference; deployed state + Track 2 ops = `plans/m5-c8-half2-runbook.md` §8). **Current rung: Track 2 friend-closet data collection on the live deployment**, gating the M6/H26 re-measure — sequence per `Fitted_Spec_v2.md` §20.
- `plans/spearhead.md` - completed Spearhead plan: orphan-item rescue cold-start vertical (C1–C6 ladder, done 2026-06-25); reference. The C6/H40 live-eval results are in its §E.
- `plans/m3-ranker.md` - completed M3 ranker plan (C1-C6); reference. See the §11 checkpoint table for per-checkpoint detail.
- `plans/m2-validator.md` - completed M2 validator plan; reference.
- `plans/m0-m1-substrate.md` - completed M0/M1 substrate plan; historical context.
- `plans/regen-controls.md` - **historical** R9 regeneration-controls design note; superseded for M5 by
  `plans/m5-cutover.md` (its own banner says so). Read only for the locked/contextual-dislike *concept*,
  never for the cache/merge/re-rank mechanism (that behavior was overturned at M5).
- Other active `plans/*.md` files only when they are the current milestone or are directly referenced by
  `Fitted_Spec_v2.md`.
- Latest dated file in `sessions/` only when resuming recent work.

## Read only for product ambition/history

- `Fitted_Spec_v2_recovered_appendix.md` - preserved brainstorm/user-story/north-star material. Useful for
  discussing the soul of the product, not for implementation authority.

## Retired or historical

Kept only as forward-lookup indexes (not for product/architecture guidance). Pure CS148/v1.2 archaeology
docs were deleted in the 2026-07-06 doc-compaction — git history preserves them.

- `scope-decisions.md` - retired ledger; maps old R7/R8 identifiers → their `Fitted_Spec_v2.md` homes.
- `plans/spec-resolutions.md` - retired v1.2 addendum ledger; maps R1–R13/S4/S5/N1–N4 → `Fitted_Spec_v2.md`
  (Appendix A concordance).

## Archive directories outside `docs/`

- `../team/` and `../meetings/` are CS148 archives. They are not relevant to v2 direction or implementation.
- `../fitted/docs/` documents the old deployed app. For code changes, prefer source files over those docs.
- `../ml-system/outfit_recommender.py` and `../ml-system/mlWhatWeAreGoingTodo` are legacy reference material;
  current work is `../ml-system/fitted_core/`.
