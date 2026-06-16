# Codex Handoff

<!--
CODEx INSTRUCTIONS - keep this block, replace everything below it as needed.

This file is an ephemeral write-and-delete handoff for Claude, not a living review log.
When routing a new review, replace the prior handoff body instead of appending history.

Codex default posture:
- Review only unless Brian explicitly asks for edits.
- Prefer concrete findings with owner, severity, file/line, and fix.
- Separate verified defects from future-spec routing notes.
- Treat docs/plans/spec-resolutions.md as binding unless Brian says otherwise.
-->

## Current Handoff For Claude: M1-1/M1-2 Review

Review target: `ml-system/fitted_core/sampler.py`, `ml-system/tests/conftest.py`, and
`ml-system/tests/test_sampler.py` for M1-1 partition and M1-2 cap semantics.

Verification: `cd ml-system && .venv/bin/python -m pytest` passed with **85 tests**.

### Verdict

M1-1/M1-2 are implemented and mostly sound. I did not find a runtime bug in the built
`partition()` / `apply_cap()` behavior. The main issue is a contract seam decision before M1-3
and M1-5.

### Verified Correct

- `partition()` groups all five `ItemType`s, preserves enum key order, and sorts each bucket by
  `item.id`. This satisfies R4 under R12's future duplicate-id rejection at the M1-5 entry.
- The permutation-invariance test is real: `over_cap_wardrobe` is built in descending id order,
  then shuffled before comparison, so it is not accidentally pre-sorted.
- `apply_cap()` uses `len(items) <= cap`, so `len == cap` includes all and does not sample.
- Over-cap without a sampler raises instead of silently truncating. This matches the plan:
  `MAX_PROMPT_ITEMS` is an invariant, not an order-dependent item-loss step.
- Absence of `random_count()` is correct in this chunk. R6 assigns it to M1-3.

### Findings To Address

1. **Contract-risk: `apply_cap` is list-only, while M1-3 now returns `TypeSampleResult`.**

   `sampler.py` defines `SampleFn = Callable[[list[WardrobeItem], int], list[WardrobeItem]]`,
   and `apply_cap()` validates `len(sampled)`. The plan now says M1-3 `sample_type(...)`
   returns a `TypeSampleResult` carrying `items`, `mode`, `reason`, `random_count`, and
   `signal_count`.

   Fix: decide before M1-3 whether `apply_cap()` is deliberately item-only and M1-5 calls
   `sample_type()` directly for over-cap types when it needs metadata, or whether `apply_cap()`
   should return a result object compatible with `TypeSampleResult`. Do not let M1-5 unwrap
   `.items` and lose per-type mode/reason metadata.

2. **Test-gap: `CAP_BY_TYPE` tests can miss swapped caps.**

   Current tests check key coverage and sum to `MAX_PROMPT_ITEMS`, but a top/bottom cap swap
   would keep the sum at 135 and still pass.

   Fix: add an exact mapping test:
   `top=35`, `bottom=30`, `dress=25`, `outer_layer=20`, `shoes=25`.

3. **Test-gap: wrong-count sampler guard should test over-return too.**

   The code correctly rejects `len(sampled) != cap`, but tests only cover `cap - 1`.
   Over-return is the dangerous prompt-ceiling failure.

   Fix: add a `cap + 1` sample function case.

4. **Test-gap: at-cap branch should prove it does not call a provided sampler.**

   The boundary behavior is correct, but a stronger regression test would pass a raising
   `sample_fn` at `len(items) == cap` and assert it is not called.

5. **Doc-drift: M1-3 still has stale `signal_fn` wording.**

   `m0-m1-substrate.md` now uses `scorer, context` and `TypeSampleResult`, but later M1-3 text
   still says `signal_fn` / `signal_fn.is_available()`.

   Fix: replace remaining `signal_fn` references with `scorer`, aligned with the once-per-request
   availability decision.

### Suggested Next Action

Resolve finding 1 first, then patch the small tests/doc wording in the same M1 cleanup pass.
