# Recovery Scratch

> Temporary handoff for crash recovery or critically-low usage/context. Overwrite this file when
> needed. It is not canonical project documentation; durable history belongs in dated session notes
> and commits.

## Current Request
Paused 2026-07-20 at 97% usage, BEFORE starting the audit-review charter
(`docs/plans/audit-review-prompt.md`). Safe stop.

## Files Touched
None this session (only this file). Zero edits were made before pausing — the session had only
read the charter and checked git state. Working tree clean except the intentionally-untracked
`ml-system/experiments/h26/gate_b_extension.py` (Brian's parallel gate-B session's in-flight
work — never commit or touch it).

## Done
- The 2026-07-20 merit+live+dynamics audit (`fd5b1448`) — session note
  `docs/sessions/2026-07-20-merit-live-dynamics-audit.md`.
- The re-measure prereg session (`7ae9ebb5`) — decision rule FROZEN before any friend label was
  looked at; Fable-reviewed (SHIP-WITH-CHANGES, folded) + an in-session fresh-eyes review that
  reproduced the arithmetic. Floors after it: 793 jest / 1098 ml-system pytest / 308 experiments.

## Partial / Unsafe
Nothing partial, nothing unsafe. All prior work is committed on main.

## Decisions Made
None this session.

## Next 1–3 steps
1. **Run the audit-review session**: paste the block under the `---` in
   `docs/plans/audit-review-prompt.md` into a fresh session verbatim, appending one sentence:
   "Also sanity-check the prereg commit `7ae9ebb5`'s doc fold-ins (Spec §20 M6 row, runbook §8
   item 1, CLAUDE.md) for contradictions, and treat post-fd5b1448 supersessions (e.g. README
   floors now below actual 793 jest) as fix-on-sight, not defects of fd5b1448."
2. **Brian finishes the H26 gate-B power extension** in his parallel session; reconcile §23-H56
   when it lands.
3. **Runbook §8 pre-recruit checklist** (item 1 ✅): push/redeploy BOTH halves (Fly still runs the
   pre-`217a6ee3` build) → staggered onboarding → cron monitor → recruit 3–5 closets.

Why both experiments (for Brian): gate-B repower fixes H26's power miss on the PUBLIC catalog;
the friend re-measure tests whether that skill TRANSFERS to real closets/real taste. Spec §20 M6
entry requires BOTH — neither replaces the other.
