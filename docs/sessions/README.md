# Session Logs

Short end-of-session notes so the next session — likely days apart given the 4–8 hr/wk cadence — can pick up cleanly.

## Convention

- One file per session: `YYYY-MM-DD.md`. If multiple sessions in one day, suffix `-1`, `-2`.
- Keep them short. 1–2 paragraphs per heading. The point is recovery, not narrative.
- Update by appending in real time, or write at the end of the session — either works.
- Most useful field: **Next session: start here**. Don't skip it.

## Template

```md
# YYYY-MM-DD Session

## Goal
What you set out to do (1 sentence).

## What landed
Concrete outputs — files written, commits, decisions made.

## Decisions / why
Anything chosen over alternatives that future-you might second-guess.

## Blockers / open questions
Things to resolve before continuing. Link issues or files.

## Next session: start here
The first 1–2 things to do when you sit back down. Be specific
("read `lib/runPersonalizationSummary.ts:42`" beats "look at personalization").
```

## When to skip a log

If you just read a few files and made no decisions, skip it. Logs should track state changes, not reading sessions.
