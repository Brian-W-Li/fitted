# Current direction and work

## Selected work — review and solidify

Brian replaced feature building with a review of the existing checkpoint. Keep separate
conclusions for correctness, integration with surrounding journeys, test quality and
mutation sensitivity, and documentation/code/ambition consistency. Fix demonstrated
in-scope defects; do not resume unfinished feature expansion during this review.

The intended product remains quick visual personal styling from owned clothes with
meaningful contextual taste learning. [Spec §§1–3](Fitted_Spec_v2.md#1-vision--the-green-shirt-promise)
and [appendix C.0/C.8](Fitted_Spec_v2_recovered_appendix.md) own that ambition. The
[implementation specification/source index](plans/personal-styling-loop.md) owns the
selected build contract; the [documentation map](README.md) owns authority.

## Scope and baseline

This review covers public-main `70eef88a` through saved checkpoint `09f75841`, plus
the previously local unwired test-policy helper. It includes the earlier app foundations,
saved style memory, contextual feedback/learning, lifecycle integration and test tooling.
The coordinator stays in its existing checkout; this sanitized public worktree is an
explicit publication candidate, not a competing coordinator. Private wardrobe/participant
records, credentials, unrelated experiments and private branch ancestry remain excluded.
Both Vercel configurations suppress deployment of `codex/style-memory-baseline`.
No paid calls, deployment or personal sign-in are authorized by this review.

Previous runtime/tooling checkpoint `426bfd77` passed exact hosted
[conformance](https://github.com/Brian-W-Li/fitted/actions/runs/42761992072) and the
[complete browser regression](https://github.com/Brian-W-Li/fitted/actions/runs/42761992296).
Those results establish the starting point, not the new repairs below.

## Separate review findings

| Check | Finding and disposition | Relevant evidence/use case |
|---|---|---|
| Correctness: deletion | **Reproduced and repaired.** A delayed successful restore could republish an erased outfit after erase acknowledgement while Home had no displayed result. A temporarily unverified hidden cache also survived erasure. Owner/context-scoped cache identity now permits immediate invalidation; retained/archive/unrelated sources remain valid. | `dashboardStyleRestore.review.test.tsx`: delayed restore → erase → late receipt; 503 → erase; archive/unrelated positive controls. Removing pending-source handling kills the regression. |
| Integration: superseded request | **Reproduced and repaired.** A terminal superseded result invited a fresh request while the saved-choice panel still held obsolete versions. Home now requests an acknowledged refresh, preserves previous captured outfits and sends no automatic recommendation. Refresh failure blocks fresh generation until manual read retry; uncertain writes retain exact operation IDs. | `dashboardStyleSuperseded.review.test.tsx`: other-tab semantic edit, explicit next request using refreshed versions; failed refresh/retry; queued refresh during uncertain write. Removing the refresh signal kills the regression. |
| Integration and intended correction | **Reproduced and repaired.** History offered scoped learning controls without identifying their captured direction/situation. Minimal immutable labels and optional versions now accompany the exact reaction; current renames/meaning edits cannot relabel it. | `historyCuration.test.tsx` and real-Mongo `styleLearningAmendments.test.ts`: identical outfit/occasion under two contexts, targeted correction, retained old meaning, legacy/null situation, foreign/erased-source privacy. Removing API/UI summaries kills the new cases. |
| Test quality | **Five blind spots closed.** Invalid create identities, a seventh policy reaction, minority-class minimum, named color relationship meanings and preference ordering before variant caps escaped their earlier checks. The production learner did not need changing. | Actual server transitions validate UI commands; fixed-boundary policy cases and domain-based learner/ranker cases now kill the same non-equivalent mutants. |
| Documentation fidelity | **Reconciled.** Canonical sections denied implemented named-context learning and disagreed about semantic-version continuity. Source maps and the historical baseline description were stale. | Canonical §§5–7/11–17/22, implementation spec §2, root/ML README and database guide now distinguish implemented mechanics, legacy behavior and future design. |
| Ambition and usability | **Still open.** Home's optional setup dominates before request/results; first-request screenshots do not prove prompt access at 390px. | Preserve the hook-first/cards-primary contract. A focused compact/progressive-disclosure layout and real narrow-screen walkthrough remain needed; wording changes do not close this code/UX gap. |

## Test audit and mutation evidence

Tests are assessed against user jobs and failure behavior, not suite counts alone.
The review deliberately introduced semantic faults in isolated copies and retained
normal passing baselines, mutant diffs, commands, non-equivalence witnesses and failure
logs. No active production kernel or frozen evidence was mutated for those experiments.

- The original Python checks caught reversed labels, profile bleed, early exception
  filtering, a zeroed ranking contribution and nonzero abstention. Three other faults
  survived: a single minority-class judgment, reversed chromatic relationships and
  ignoring preference at variant-cap ordering. New use-case tests catch all three.
- The original web checks caught dispatch after owner abort, server-rejected cache
  visibility and discarded uncertain operations. A duplicate Board/profile identity
  survived; the UI test's constant UUID and unconditional success mock admitted a
  command the real state transition rejects. The strengthened tests use distinct
  identities and the actual server transition, including successive creates.
- The draft policy test reused its implementation's target constant, allowing a
  seven-reaction mutation to pass. It now asserts the six-acknowledgement boundary
  independently and rejects an undefined seventh label. The render-budget mutant
  was already caught. This helper remains unwired: no runtime collector or
  `--private-feedback` flag is implemented by these tests.
- Each repaired UI fault has a failing-before/passing-after regression and a focused
  removal mutant. These are targeted manual mutation checks, not an exhaustive
  mutation score or proof of bug absence. One cap mutation whose failure depended
  on floating-point cancellation was discarded; the refined fault has a genuine
  cap-losing candidate witness.

Reproduce focused regressions from `fitted/` with Jest's `jsdom` project and
`styleDirectionPanel`, `dashboardStyleRestore.review`, `dashboardStyleSuperseded.review`
and `historyCuration` paths; real-Mongo history coverage uses the `node` project and
`styleLearningAmendments`. `npm run test:browser-fixtures` runs the synthetic tool
contracts. From `ml-system/`, run `python -m pytest tests/test_style_preferences.py
 tests/test_style_preference_integration.py -q` for the strengthened learning cases.
The coordinator retains the detailed local mutation receipts outside public artifacts.

## Documentation decisions

When code and prose disagreed, the review did not automatically prefer either:

- Stale claims that named profiles/subtype forwarding/scoped eligibility/relationship
  learning were absent were documentation errors. Correct their description while
  preserving the distinction from deployed behavior and useful personal predictions.
- Conservative semantic-version resets are the selected current contract. Graded
  minor/major continuity and richer text/visual compilation remain future design,
  requiring explicit evidence and migration contracts; do not add them to pass prose.
- Missing correction scope and stale refresh behavior were implementation gaps; code
  changed to satisfy the existing intention. Setup-first Home remains an open code/UX
  mismatch rather than a reason to weaken the quick visual ambition.

## Current verification

Code/test checkpoint `88f71e25` passes the full local web regression (1,760 passed,
ten existing skips), Python core/service regression (1,272 passed), all 15 Node fixture
contracts, TypeScript, lint (zero errors; existing warnings) and seven focused
navigation/provenance/frozen-pin documentation guards. The production build and
compiled styling journey pass, including ordinary scoped reactions, History controls,
actual displayed membership, the authored activation fixture and support removal.

The exact saved checkpoint also passed hosted
[conformance](https://github.com/Brian-W-Li/fitted/actions/runs/42766173613) and the
[complete browser regression](https://github.com/Brian-W-Li/fitted/actions/runs/42766173540).
All handles are terminal and local services are closed. This documentation-only
follow-up preserves the verified code/test bytes. Local results, hosted CI and
personal styling benefit remain distinct; targeted mutations are not an exhaustive
proof of bug absence. The review checkpoint is complete with the explicitly open
product/verification boundaries below.

## Remaining build work and release boundary

The larger build goal remains incomplete. Explicit saved scoped item/composition
exclusions, ordinary complete-history feedback accumulation, the remaining faithful
private correction/undo/isolation/plan/wear journey and narrow-screen clarity remain
open. The activated synthetic fixture uses abbreviated historical captures; it does
not establish those missing journeys or personal usefulness.

A prior private first-request rehearsal verified captured photos, intact preserved
candidate membership and zero imported support through the actual compiled app. It
used a declared subset and a preserved candidate bank, not fresh styling or verified
current whole-closet parity. Its input, preparation receipt, reports and photographs
stay private. Owner preferences and operator-authored test labels remain distinct.

Finish the review checkpoint and its verification before selecting more feature work.
No paid calls, participant collection, merge or deployment is part of this checkpoint.
