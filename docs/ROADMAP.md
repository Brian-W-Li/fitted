# Current direction and work

## Current direction — keep developing the app

Brian chose to continue building Fitted while the research question about taste
learning remains open. Prioritize a concrete action someone can take with their
wardrobe. The current change connects History to the existing outfit page so a
person can find a rated outfit again and plan or report wearing it. The saved
outfit and existing planning and wear flows own those actions.

This change builds on development checkpoint `768d8959`. The compiled browser
opened the exact original suggestion from History, reached the planning and wear
controls, and navigated back. The focused History, interaction and link checks
passed, including a retained reaction whose underlying outfit was redacted.
Type checking and lint passed with the existing warnings. The development
checkout and coordinator paths are recorded below. The next development choice
can be made from the app itself without collecting more ratings.

## Feedback correction and removal — November 18, 2026

Brian requested a bounded review of which outfits receive corrected feedback,
its sign, and what survives reload. The public development branch is
`codex/style-memory-baseline` in `/private/tmp/fitted-style-memory-baseline`.
Reviewed source [25359170](https://github.com/Brian-W-Li/fitted/commit/25359170a37f8e084fcdd23b053d784a1f326c9b)
builds on `0706d88e`. The coordinator checkout is
`/Users/Brian/.codex/worktrees/s3-outfit-correction/fitted` on
`codex/s3-outfit-learner`. Its unrelated changes and private ancestry stay there.

Home now reconciles restored votes per card when a new vote overlaps the History
read. History keeps an unconfirmed learning retry reachable across Refresh and
reads the saved reaction after an incomplete flip acknowledgement. In regression
tests, the next correction addressed the right reaction whether the flip had
landed or not. Real database checks cover repeated outfits, vote age, removal of
the whole reaction and its amendments, retained exposure and scope boundaries.
Six deliberate faults were caught, including both skipping a neighbor's
correction and overwriting a fresh vote. The [implementation contract](plans/personal-styling-loop.md)
records the user-visible behavior. Independent review checked it against source.

In the compiled synthetic walkthrough a Like for one outfit supported a different
outfit with a slim top and relaxed bottom. Its learned score contribution was
+0.153 before correction, −0.047 after flipping to Dislike and +0.059 after
removal. Likes/dislikes changed 6/6 → 5/7 → 5/6. The matching outfit stayed
visible. A fully relaxed outfit replaced a fully slim outfit after the flip and
the fully slim outfit returned after removal. The zero-learner selection from the
same four candidates contained the same three outfits in all three requests.
The independent private wardrobe replay exercised ordinary concern, clear,
explicit inclusion and direction switching with six operator-authored reactions.
Eligible votes followed 6 → 5 → 5 → 6 → 0 → 6. Private inputs and reports stay local.

Local web regression passed 1,936 tests with ten existing skips. Type checking,
all 38 browser fixture checks and the production browser builds passed. Lint
reported zero errors and 35 existing warnings. Local evidence is under
`.private/app-verification/feedback-correction-2026-11-18/` in the historical
checkout. The review found three user-facing defects and fixed all three. Brian chose to continue development in the existing app. The evidence for taste
learning remains open and can be evaluated in a separately chosen study.

All 13 repository documentation and hygiene checks passed, including the suite
counts, after supplying the checkout's existing local Python environments.
GitHub passed [conformance](https://github.com/Brian-W-Li/fitted/actions/runs/44475048631)
and the [whole-app browser](https://github.com/Brian-W-Li/fitted/actions/runs/44475048659)
on the reviewed source. Source, tests, spec and this entry were mirrored to the
coordinator. The public development checkout is clean at handoff. No known
blocker remains in this slice. No paid generation, merge or deployment occurred.

## Home review complete — November 16, 2026

Brian selected a bounded review of Home correctness, surrounding integration, tests
and documentation. This is not feature expansion. Root remains coordinator in
`/Users/Brian/.codex/worktrees/s3-outfit-correction/fitted`, branch
`codex/s3-outfit-learner`, original HEAD `7a542d46`. Preserve its unrelated dirty files
and private ancestry. The sanitized public checkout is
`/private/tmp/fitted-style-memory-baseline`, branch `codex/style-memory-baseline`.
Starting checkpoint is `303f43d5`, source `f1f1af21`; its
[conformance](https://github.com/Brian-W-Li/fitted/actions/runs/43987197009) and
[whole-app browser](https://github.com/Brian-W-Li/fitted/actions/runs/43987196768)
both passed, verified during this review.

| Separate check | Finding and resolution |
|---|---|
| Correctness | Event time survived owner changes and was not restored with saved/pending requests. Reset it per owner and restore captured time as an absolute local date/time. Include the branch where an older styled source is unavailable or temporarily unverified. Pending wire bodies/IDs remain frozen. |
| Integration | Delayed source verification overwrote a newly authored event/weather/time draft. Restore verified cards and their captured lens, but preserve the request form once edited, including an explicitly cleared occasion. The same rule applies when resuming a pending request. Owner and visibility fences remain intact. |
| Test quality | Added owner-specific restored-result labels, stable rejection, manual-weather clearing, feedback persistence, late restore and pending-draft cases. Nine isolated fault mutations are killed by intended assertions. Twenty-eight legal weather combinations have seeded text/disclosure variations; these are bounded input/interaction tests, not arbitrary-input fuzzing. |
| Documentation/ambition | The selected contract §3.1 now states time ownership and draft-preservation semantics. Removed stale roadmap directives and implementation sequencing. Engineering checks still do not establish human styling or learning benefit. |

Independent correctness, test and documentation reviewers found no remaining blocker
in the bounded repairs. New tests failed on the relevant pre-repair behavior. A mutation
of pending draft hydration initially survived because the targeted case did not enter
that branch; a direct delayed-restore/pending-request regression now catches it.
The original fuzz driver used repeated asynchronous simulated clicks and intermittently
timed out. It now dispatches deterministic form actions; real Tab/Enter behavior is
checked separately in the compiled browser. The failed preliminary run is retained
as failure evidence, not counted as a pass.

Reviewed source is saved on GitHub at `7da28a60`. Final sequential web regression
passes 1,919 tests with ten existing skips. Independent TypeScript, lint (zero errors,
35 existing warnings), all 38 Node fixture contracts and focused documentation guards
pass. The compiled production Home journey passes with phone geometry, natural
keyboard traversal, captured context, synthetic activation and support removal.
The browser harness traverses from the event field with Tab/Shift+Tab through collapsed/open
settings and result links, then verifies Enter focus and retained draft/bindings.
The original Home layout acceptance and synthetic learning/correction checks remain.
No Python/model, database schema, paid provider, deployed app or private record changed.

The reviewed changes are limited to the Home page, three Dashboard test files,
Home edge harness and owning documentation. Source/tests are mirrored to the coordinator;
restricted logs, mutation recipe/results and source receipts belong under historical-root
`.private/app-verification/home-2026-11-16/review/`. No credentials or private wardrobe
records belong in the public export.

Exact-source hosted [conformance](https://github.com/Brian-W-Li/fitted/actions/runs/43991824217)
and [whole-app browser](https://github.com/Brian-W-Li/fitted/actions/runs/43991824256)
both passed on the exact reviewed source. Local services and checks are closed.
The sanitized public checkout is clean after this documentation closeout; the
coordinator retains its unrelated dirty files.

The bounded review has no remaining feature work or known confirmed defect in its
reviewed scope. This is not a bug-free guarantee. The next
product discussion remains actual styling usefulness and contextual learning benefit;
those need separate evidence and scope. No sign-in, new clothing or immediate product
decision is needed from Brian. No paid calls, merge or deployment occurred.

## Review and solidification — November 15, 2026

Historical checkpoint: the remaining faithful wardrobe walkthrough passed in
the compiled local app, and that checkpoint stopped before Home changes. Stage one is saved at `15856f17`.
Its four renders plus the four-render continuation verify original photos/facts,
Fit correction/clear, availability off/restore, Keep/Avoid and sticky/reset controls,
Explore with changed membership, plan create/reschedule/remove/replan, simulated
changed wear, correction, revision-bound adaptation and Undo invalidation. All writes
used the mounted UI and isolated test account. Entire earlier snapshots, closet facts,
photo bytes, plan ledger and zero-feedback boundary are checked. No production code
changed in this continuation. No paid calls, personal sign-in, merge or deployment.

All 36 Node contracts, scoped lint and focused documentation guards pass locally.
Independent source review corrected a plan-acknowledgement race, fallback-weather
expectation and full wear-state invariants. The first complete run exposed an unused
rejected-response body read hanging in the harness; removing it and bounding the
specific 404/unavailable-message check produced a terminal passing rerun. The reviewed final tooling is saved at
`08d4aed6dad1bcfc83a8655f090e70d0f4812546` on `codex/style-memory-baseline`.
Exact-source hosted [conformance](https://github.com/Brian-W-Li/fitted/actions/runs/43783367334)
and [whole-app browser](https://github.com/Brian-W-Li/fitted/actions/runs/43783367202)
both passed. These hosted workflows use synthetic inputs; the private faithful
walkthrough is separate local evidence. The closeout changes documentation only.
The sanitized public checkout is clean at the saved closeout; all owned local services
were closed at that checkpoint. Current authorization and state are owned by the
November 16 review above.

Limits: these are original private photos with preserved draft replay and explicitly
simulated plans/wear with unknown outcome, not fresh styling or owner benefit evidence.
The only shoe appears in every preserved draft, so Keep proves command persistence
and shown consistency rather than a counterfactual omission. Raw Fit clears to empty
while engine unknown returns to null. Restricted reports/audits/screenshots live at
`.private/app-verification/wardrobe-walkthrough-2026-11-15/` in the historical root;
they are excluded from public source and CI. The selected contract §8 owns acceptance.

The subsequent Home work and this review supersede that checkpoint's next-action list.
Its private wardrobe evidence remains a separate completed check.

Brian replaced feature expansion with a review of the delivered checkpoint. This
review was completed at its saved stopping point; the new scope above governs this continuation.
Starting public baseline was `7120bdfc`, code `5981061d`. Reviewed repair code
`98af165bf7da72156946ea5f22f0cebde28bff4d` is saved on `codex/style-memory-baseline`.
The larger product is incomplete; this review does not resume its feature backlog.

| Separate check | Finding and resolution | Evidence / limit |
|---|---|---|
| Production correctness | Captured-context validators disagreed about weather types, labels, keys, Unicode and safe Routine versions. Both now enforce the existing typed boundary. | Nineteen shared literal cases, including valid boundary values; eight web cases and one Python case failed before repair. Legitimate and legacy paths remain separate. |
| Surrounding integration | Hidden-source changed wear could demand hidden saved rules; fresh adaptation could bypass an archived original Routine, including an archive during weather resolution. Independent commands now retain report provenance, discard hidden meaning and validate original activity within the captured owner read. Deleted-member rule Undo is disabled with an explanation. | Real-Mongo admission, erasure/replay and archive-race cases; mounted form/Undo cases; compiled UI/service journey. Keep/avoid uses the existing child-lineage contract, not an invented root exception. |
| Contextual taste isolation | Named reactions leaked into requests with no selected direction. Both reaction-side and source-side named captures are now excluded from the legacy taste projection; visible owner-wide exposure stays separate. | Mixed real-Mongo→Python regression failed six rows versus two before repair; retained positive/negative legacy signals and exposure are checked independently. |
| Test quality | Existing suites survived removal of Routine-version isolation and operation-acknowledgement identity. New real-store/evidence tests kill each fault. Named amendment assertions now check nonempty scoped affinity, not empty global results. | Passing baselines plus isolated non-equivalent mutants. The real service caught lineage/control constraints that the mocked service had accepted; literal wire assertions now cover that gap. |
| Documentation and ambition | Superseded build-next instructions and review history competed with the current handoff. They were retired into Git; owning contracts now describe the repaired boundaries. | Source/test comparison, independent reviewers and documentation guards. Styling-on-demand and contextual personal learning remain the ambition; engineering results do not establish human benefit. |

Final local web regression passes 1,866 tests / ten existing skips. Python core/service
passes 1,336; TypeScript and lint pass (zero errors, 35 warnings); 27 synthetic Node
contracts pass. The compiled production app passed including temporary synthetic source
redaction, retained-wear adaptation, final membership, correction, plans, learning and
deletion. That local browser run preceded only the final legacy-projection refinement,
which has real-Mongo→Python and full web coverage. Hosted checks on the exact final
source both passed: [conformance](https://github.com/Brian-W-Li/fitted/actions/runs/43776584936)
and [whole-app browser](https://github.com/Brian-W-Li/fitted/actions/runs/43776584934).
These hosted checks cover the final legacy projection as well. The documentation-only
closeout retains those exact code/test bytes. Ten existing skips are the explicitly
gated live-corpus and paid-provider smoke suites; neither was enabled. All local/hosted
handles are terminal and owned local ports are closed. No paid calls, personal sign-in,
merge or deployment occurred.

No known confirmed defect remains in the reviewed fixes. This is not a bug-free
certificate or whole-product completion. The faithful private wardrobe walkthrough is now the bounded continuation above.
Home fast entry / 390px use and observed human styling benefit remain separate gaps.

The prior review has no remaining action. Its reviewed checkpoint, hosted checks
and restricted handoff were saved. The wardrobe scope is complete; the current review
above owns the next actions. Provider spend and deployment retain
their separate authorization boundary.

No blocker was found remaining in the reviewed fixes. Coordinator remains
`/Users/Brian/.codex/worktrees/s3-outfit-correction/fitted`, branch
`codex/s3-outfit-learner`, original HEAD `7a542d46`; preserve all preexisting changes
and private ancestry. Public export remains `/private/tmp/fitted-style-memory-baseline`;
123 selected source/test/tooling paths match the reviewed source and wardrobe
continuation. Receipt: `/private/tmp/fitted-wardrobe-export.json`. Current coordinator
inventory has 168 Git status entries (including untracked directories); its full
list is saved with the private wardrobe evidence. Restricted review logs and full dirty
inventory are retained under `.private/app-verification/solidification-2026-11-15/`
in the historical root. Canonical documentation has private history in the coordinator;
reviewed public paragraphs are edited independently, never whole-document copied.

## Retained rationale and evidence owners

[Spec §§1–3](Fitted_Spec_v2.md#1-vision--the-green-shirt-promise) and
[appendix C.0/C.8](Fitted_Spec_v2_recovered_appendix.md) preserve the ambition:
quick visual personal styling from owned clothes, executable intentions and meaningful
contextual taste learning. Memory and rules are foundations, not substitutes.
The [selected implementation contract](plans/personal-styling-loop.md) owns scope,
mechanics and the complete acceptance; an implemented slice is not whole-goal completion.

| Mistake to prevent | Owning contract and executable evidence |
|---|---|
| Relabeling old reactions after a rename, meaning edit or context switch | Implementation contract §§4–5; `styleContext.ts`, `stylePreferenceEvidence.ts` and `styleLearningAmendments.ts`. History keeps captured meaning; semantic versions do not silently share taste. |
| Restoring erased cards or retrying a superseded command as new generation | `dashboardStyleRestore.review.test.tsx` and `dashboardStyleSuperseded.review.test.tsx`; source visibility, owner fencing and explicit refreshed-command admission remain required. |
| Treating concern edits, clear or repeated taps as independent support | Implementation contract §7 and `styleLearningAmendments.test.ts`; clearing details does not re-enroll an exception, and amendments preserve the original vote identity/time. |
| Weak tests allowing invalid readiness, inverted traits or a learned term applied after a cutoff | `test_style_preferences.py` and `test_style_preference_integration.py`; retained domain cases cover minority-class support, named color relationships and competition before the variant cap. Earlier isolated semantic mutations exposed these gaps; passing suites alone were insufficient. |
| Confusing hard instructions with taste, banning every combination member, or carrying a one-request ban forward | Implementation contract §6; `explicitExclusions.test.ts`, `styleExclusionStore.test.ts` and `test_explicit_exclusions.py`. Policy identity, exact membership, Undo and fresh-command scope are separate from feedback. |
| An unrelated wardrobe edit clearing unknown facts or triggering derivation | Canonical spec §18; `wardrobeEditPatch.ts` and `wardrobeEditIngestion.test.ts`. Only deliberately changed metadata is submitted; the server retains derivation authority. |

Ordinary-history, correction/isolation and exclusion rehearsals use new operator-authored
commands and preserved drafts in the compiled app. They are not owner preferences,
fresh styling or demonstrated personal benefit. An activated fit need not change cards;
selection effects must be compared with the same-pool zero-learner baseline. Synthetic
held-out relationship checks and faithful wardrobe rehearsals answer different questions.
The remaining faithful navigation/correction and 390px experience stay within the
implementation contract's acceptance, outside the current review's feature scope.

Historical prototypes and study designs remain separate from the runtime loop. The
frozen catalog head has no serving vote; its failed transfer does not abandon personal
learning. Preserve frozen evidence, private sessions, unknown garment facts and distinct
suggestion/reaction/plan/wear semantics. Canonical §16 and the experiment source records
own those boundaries; no old study or funding handoff authorizes new collection or spend.

Completed execution details, old suite counts and superseded next-step choices remain
in Git rather than this current handoff. Public checkpoints `88f71e25`, `eef874b2` and
`9f2a1538` retain the earlier review, ordinary-collection and correction/isolation history.
The verified baseline and current review actions are recorded only above.
