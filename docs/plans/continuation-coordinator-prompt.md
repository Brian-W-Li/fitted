# Continuation-coordinator prompt (next session)

> Authored 2026-07-20 at the 97%-usage pause. Paste the block below into a fresh session verbatim.
> Delete this file when the session completes (RECOVERY.md's cleanup rules apply to it too).

---

You are the coordinator session continuing the Track-2 pre-recruit work. Start by reading
`docs/sessions/RECOVERY.md` (the pause state — nothing was in flight) and CLAUDE.md. Standing
constraint for the WHOLE session: `ml-system/experiments/h26/gate_b_extension.py` is a parallel
session's uncommitted in-flight work — never touch, stage, or commit it; never `git add -A`.

Work these stages IN ORDER — each gates the next:

**Stage 1 — the audit review (verify before deploying).** Execute the charter in
`docs/plans/audit-review-prompt.md` (the block under its `---`) verbatim, with this addendum: also
sanity-check the prereg commit `7ae9ebb5`'s doc fold-ins (Spec §20 M6 row, runbook §8 checklist
item 1, CLAUDE.md, the frozen `ml-system/experiments/track2_transfer/preregistration.md`/`.json`)
for internal contradictions — and treat post-`fd5b1448` supersessions (e.g. README floors now
below the actual ≥793 jest / ≥1098 ml-system pytest / ≥308 experiments) as fix-on-sight truth
refreshes, not defects of `fd5b1448`. Mutation-testing (its lane 1) mutates real sources: run it
serially, never overlapping lanes that read or test the same files, and restore sources after each
mutation. Fix-and-commit confirmed small issues on main; structural findings get reported and
appended to `docs/sessions/2026-07-20-merit-live-dynamics-audit.md`, not silently rewritten. Do
NOT proceed to stage 2 until the review's fixes are committed and the full suites + tsc + eslint
are green.

**Stage 2 — push + redeploy BOTH halves (runbook §8 pre-recruit checklist item 2).** Only after
stage 1: push main, redeploy the web half (Vercel) AND the Fly render service (it still runs a
pre-`217a6ee3` build) per the ops notes in `docs/plans/m5-c8-half2-runbook.md` §8. Fly MUST end at
exactly 1 machine — verify with `fly scale show` (Fly auto-adds an HA machine on deploy; scale it
back). Then run the ONE sanctioned post-deploy gate: the runbook's gauntlet render →
`bindable:true` → erase → corpus readback 0 orphans (this spends ~1¢ and MUST erase after; run it
once). No other TRACK2_LIVE_OK driver.

**Stage 3 — the cron monitor (checklist item 3)** per runbook §8, then close the loop: check off
completed checklist items in runbook §8, fold durable history into a dated session note, clear
`docs/sessions/RECOVERY.md` back to its unfilled template, delete this prompt file and
`docs/plans/audit-review-prompt.md`, and commit+push as the closing act (verify `git status` shows
only the untracked gate-B file).

Explicitly NOT this session's job (report as remaining, don't attempt): Brian's gate-B power
extension (his parallel session; reconcile §23-H56 only when it lands), staggered friend
onboarding, and recruiting. If usage runs low mid-stage, stop at a stage boundary and re-write
RECOVERY.md per CLAUDE.md's backstop.
