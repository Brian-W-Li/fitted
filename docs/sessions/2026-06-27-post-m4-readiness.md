# 2026-06-27 — Post-M4 forward-readiness & pre-mortem

Forward-looking pre-mortem (no feature work). Question: is the project ready for, and correctly pointed at,
the next rungs **H26 spike → M5 cutover → M6 dive → writeup**? The substrate was built in isolation and has
**no live integrated path yet**, so the integration has never run whole.

**Full output → `docs/plans/post-m4-readiness.md`** (the inheritance for the H26 `/spec` + the M5 `/spec`).
This note is the meta only.

## Method
7 cold-context parallel lanes (judgment→Opus / mechanical→Sonnet): H26 methodology · integration trace ·
M6 eval-data sufficiency · M5 adapter IOUs · degenerate-wardrobe robustness · portfolio backward-design ·
serde contract parity. → adversarial refuter round (killed **2 false positives**, right-sized 3) →
between-lane completeness critic (4 new verified gaps). Every load-bearing finding re-verified against source
by the main loop before landing (Fable down → dual-read substitute). Converged in 2 heavy rounds; remaining
findings are forward *decision* gaps (documentation outputs, not regressable code), so the H26/M5 `/spec`
sessions are the next audit rounds that stress them.

## Outcome
**No blocker in committed code** — substrate ships dormant; Lane 5 found it *remarkably clean* against
degenerate real closets (0 blockers). Two real risk classes: (1) the unbuilt M5 cache/snapshot/cross-runtime
layer has under-specified one-way-door seams; (2) the H26 decision rule + domain probe are spinnable.

- **New §23 holes:** **H49** (cache-hit snapshot provenance) · **H50** (render idempotency) · **H51** (cache
  locus + cross-runtime seed). **Sharpened:** H28 (the pairwise seam is *not yet reserved in code*), H12
  (timeout value still unnamed + engine-never-ran case). L2-04 (scored-but-unshown compat/vis) folded into
  the existing H48.
- **Concurrent reconciliation:** a parallel Codex read committed `b8dc6052`/`a61a3801` (opening H47 warmth +
  H48 variant-cap-breakdown, + H11/H29 M5 notes) *while this ran* — complementary, no conflict; cross-refs
  reconciled in the same pass.
- **Top action before H26:** make the accuracy floor a hard cost-independent gate + the domain probe a
  *labeled* measurement (else the result is spinnable). Pre-registration sketch is in the readiness doc §2.
- **Sequencing unchanged:** consolidation → H26 → M5 (H26 needs none of the snapshot machinery).

Changes are **uncommitted** (docs only: the new readiness plan + §23 edits). No code touched.
