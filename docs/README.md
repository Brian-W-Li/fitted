# Fitted Documentation Map

This directory mixes active v2 planning docs with CS148-era and deployed-app history. For future-looking work,
read by authority level, not by filename age or folder location.

## Read first for future work

- `../CLAUDE.md` - repo operating guide and default reading list for AI/code sessions.
- `Fitted_Spec_v2.md` - canonical product and technical spec. This wins over every older doc.
- `plans/m3-ranker.md` - completed M3 ranker plan (C1-C6; milestone closed 2026-06-21); reference. See the §11 checkpoint table for per-checkpoint detail.
- `plans/m2-validator.md` - completed M2 validator plan; reference.
- `plans/m0-m1-substrate.md` - completed M0/M1 substrate plan; historical context.
- `plans/regen-controls.md` - R9 regeneration-controls design note; M3 notes are superseded by
  `plans/m3-ranker.md`, but M5 wiring still uses it for locked/contextual re-roll behavior.
- Other active `plans/*.md` files only when they are the current milestone or are directly referenced by
  `Fitted_Spec_v2.md`.
- Latest dated file in `sessions/` only when resuming recent work.

## Read only for product ambition/history

- `Fitted_Spec_v2_recovered_appendix.md` - preserved brainstorm/user-story/north-star material. Useful for
  discussing the soul of the product, not for implementation authority.
- `CODEX_HANDOFF.md` - ephemeral handoff scratchpad. Its current body says where canonical context lives.

## Retired or historical

Do not use these for future-looking product or architecture guidance:

- `DESIGN.md` - CS148-era app architecture document.
- `RECOMMENDATION_MODEL.md` - old GPT/Gemini recommendation-route design, originally `NEW_DESIGN.md`.
- `MANUAL.md` - old external manual link.
- `scope-decisions.md` - retired ledger folded into `Fitted_Spec_v2.md`.
- `plans/spec-resolutions.md` - retired v1.2 addendum ledger folded into `Fitted_Spec_v2.md`.
- `plans/legacy-prospecting.md` - code archaeology. Read only when a current plan explicitly asks for old-route
  evidence.

## Archive directories outside `docs/`

- `../team/` and `../meetings/` are CS148 archives. They are not relevant to v2 direction or implementation.
- `../fitted/docs/` documents the old deployed app. For code changes, prefer source files over those docs.
- `../ml-system/outfit_recommender.py` and `../ml-system/mlWhatWeAreGoingTodo` are legacy reference material;
  current work is `../ml-system/fitted_core/`.
