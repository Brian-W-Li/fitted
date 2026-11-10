# Retained hygiene check reference

This file explains existing repository guards. It is not an active sprint, a reading prerequisite, or an instruction to restart the former campaign. [The roadmap](../ROADMAP.md) selects work; [the documentation map](../README.md) owns lifecycle. Detailed campaign evolution and retired Claude procedures remain in Git.

## 1. Purpose

Prefer one owner for each fact. Compute checkout state from Git/source/tools when needed; keep authored scope, decisions and honest proof limits in the roadmap. A deployment timestamp is not verification of a deployed commit. File recency cannot decide product priority.

Size is information, not correctness. Smaller documentation that loses an important contract is worse; a larger clear design may be justified. Do not turn a hygiene metric into an automatic deletion or an endless audit.

## 2. Issue classification

[DEFECTS.md](../DEFECTS.md) owns the defect/design classifier. Spec §23 owns design gaps. Registers are triage inputs, not a requirement to fix every historical row before product work.

## 3. Safe retirement

[The documentation map](../README.md#retirement-and-preservation) owns extraction and deletion procedure. Preserve frozen/hash-bound evidence. Keep a rationale only where it prevents a concrete mistake; Git owns completed execution history. Do not create archive copies to evade retirement.

## 4. Tool-neutral workflow

[AGENTS.md](../../AGENTS.md) owns operating rules. Skills under `.agents/skills/` and direct scripts under `scripts/workflow/` are the supported entry points. A prompt describing a read-only role does not enforce permissions; verify actual tool boundaries. A checker must report failure truthfully, not turn a second failure into success. Removed Claude hooks are historical implementation details.

## 5. Executable checks

[The hygiene suite](../../fitted/tests/hygiene/repoHygiene.hygiene.ts) defines enforcement. [The baseline](../../fitted/tests/repoHygiene.baseline.json) is the sole numeric owner; do not copy suite floors, marker totals or size figures into guides.

- Register vocabulary/ID uniqueness, path citations and active maintained navigation check location and truth. Active guidance has a zero-broken-path requirement; archives retain a ratcheted debt count. Path checks do not establish semantic consistency or validate every fragment.
- SHA pins protect preregistrations and the full recovered story appendix. A new frozen artifact must add its pin with its freeze; do not update an old hash to conceal a change.
- Markdown deletion receipts must name surviving destinations that resolve at the relevant commit; this public guard requires the receipt in the deletion commit. Private historical reconciliation additionally supports an explicit descendant receipt. The tests own the exact parsing format.
- Volatile-marker guards keep changeable status out of AGENTS and plan banners. The roadmap is the owner of authored current scope/evidence; printed entry-point bytes are not a default instruction to read the whole spec or a historical plan.
- Suite-floor checking invokes child application/Python/experiment checks. It is not a focused documentation-only run. Count floors are a regression alarm, not evidence of styling quality; review justified test retirement explicitly rather than hiding failures by deleting/skipping tests.
- Printed size/shape metrics do not block; session count has no zero-file target because specifically cited historical records may remain useful. The historical campaign-liveness check still requires this file while any enforced target is unmet, so compaction preserves its path and contract. Eventual deletion requires a deliberate change to that check and repair of its citations, not a raised baseline.

For documentation-only changes, run the focused command used by [documentation CI](../../.github/workflows/conformance.yml). The full `npm run hygiene` and direct hygiene script invoke the broader checks, including child suites. Read [AGENTS.md](../../AGENTS.md) for proportional application validation.
