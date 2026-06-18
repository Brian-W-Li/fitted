# Session Logs

Short end-of-session notes so the next session — likely days apart given the 4–8 hr/wk cadence — can pick up cleanly.

## Convention

- One file per session: `YYYY-MM-DD.md`. If multiple sessions in one day, suffix `-1`, `-2`.
- Exception: `RECOVERY.md` is a temporary crash/critically-low-usage scratch file. Overwrite it
  when needed; fold durable history into a dated session note later.
- Keep them short and **future-facing**. Per CLAUDE.md's *past goes to commits; future stays in docs* rule: a session note records **state** (what now exists, what to do next), not the **story** (what changed, why we chose X over Y, review history) — that belongs in the commit message. The point is recovery, not narrative.
- Most useful field: **Next session: start here**. Don't skip it.

## Template

```md
# YYYY-MM-DD Session

## Goal
What you set out to do (1 sentence).

## What landed
Concrete current state after the session — files that now exist, decisions now in effect.
What *is*, not how it got there. One line each.

## Next session: start here
The first 1–2 things to do when you sit back down. Be specific
("read `docs/Fitted_Spec_v2.md:554`" beats "look at feedback semantics").

## Follow-ups
*(optional)* Things noticed but deliberately deferred — what, where (file + section), why
parked. Omit the heading if there are none.
```

Dropped from the old template: **Decisions / why** (the rationale is past — it belongs in the
commit that landed the decision) and **Blockers / open questions** (open items are deferred work
— list them under *Follow-ups* or fold the actionable ones into *Next session*).

## When to skip a log

If you just read a few files and made no state changes, skip it. Logs track state changes, not reading sessions.
