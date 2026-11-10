# Current direction and work

## Selected goal

Build one personal styling loop in the actual application: editable saved style
directions and supported contextual taste learning that can affect subsequently
displayed owned outfits. Preserve rescue, exploration, adaptation, planning, explicit
wear, correction, ownership and deletion. The [implementation specification](plans/personal-styling-loop.md)
owns the bounded design; [the canonical spec](Fitted_Spec_v2.md) and
[appendix C.0/C.8](Fitted_Spec_v2_recovered_appendix.md) own the ambition.

## Current review checkpoint

Brian requires focused implementation followed by bug hunts, independent specification
review against actual code and edge cases, meaningful tests and owning-document updates
before further production features. This checkpoint records that cycle. It is not a
release or a claim that the complete goal is finished.

The coordinator remains in its existing checkout. This public checkout is an explicit
app-only review/export candidate, not a second coordinator. Private experiment tools,
participant/wardrobe records, credentials and private branch ancestry are excluded.
The branch `codex/style-memory-baseline` descends from public main
`70eef88a972bfb215ef367dd1e2d950617a71d7a`. Both Vercel configurations suppress its
deployment. No provider spending, deployment or participant collection is authorized.

The previously saved baseline remains in Git. Code checkpoint `91a25045` passed
[baseline hosted conformance](https://github.com/Brian-W-Li/fitted/actions/runs/42750741014)
and the [baseline hosted browser journey](https://github.com/Brian-W-Li/fitted/actions/runs/42750740975).
Those runs predate these feature changes and do not verify this checkpoint.

## Implemented locally and reviewed

- Versioned text style directions and user-declared situations, selection/defaults,
  scoped opt-in, archive/restore/erase and Home controls.
- Owner-bound captured request context, exact replay, revision-fenced admission,
  superseded receipts and retained-source visibility across proposal/plan/wear.
- Complete bounded feedback resolution, typed learning inclusion/exclusion and
  separate item-memory/exposure semantics.
- A bounded experimental relationship learner in the actual selection pipeline,
  with signed score persistence, safe baseline fallback and a same-pool comparator.

Independent reviews reproduced evidence-window ordering, optional-payload overflow,
superseded provenance and deletion defects. Regression checks cover the fixes. In
particular, erased content cannot restore from the styled Home cache; erasure after
snapshot admission blocks fresh acknowledgement; and acknowledged Home erasure clears
displayed cards/actions/cache. Archive, renaming and retained old semantic versions
preserve the original captured labels. Uncertain restores stay hidden and cannot
replace a newer result.

## Current verification and limits

The compiled focused application journey passed: visible direction/situation creation,
reload and opt-in, actual Next-to-Python generation, displayed garment membership,
ordinary feedback, History exclusion/inclusion and saved-proposal labels. An authored
relationship fixture with disjoint query garments changed displayed membership against
its captured zero-learner comparator; removing its support recomputed the current
baseline. Its first eligible cold numerical import timed out honestly, then a separate
explicit new request activated learning. No production automatic retry was introduced.

The activation fixture pre-seeds abbreviated synthetic historical captures and submits
reactions/dispositions through the real APIs. Its collecting path uses ordinary
generated snapshots and the actual History UI. These checks demonstrate mechanisms;
they do not prove that ordinary use accumulates equivalent complete training history,
that human taste predictions improve, or that fresh provider generations are good.
The faithful existing-wardrobe walkthrough remains required; the complete synthetic
whole-app regression now passes locally.

The complete public app web regression passed 1,746 tests with ten skips; Python
core/service passed 1,251 tests. A subsequent focused spec review reproduced an older
Routine refinement using the newer semantic label. The resolver now retains the old
meaning while preserving current cosmetic renames; the affected 163-test regression
passed after the fix. TypeScript passes on the final candidate. The production build
and focused browser journey passed before that narrow resolver fix; targeted lint and
focused navigation/frozen-pin guards pass. Hosted conformance for `ac0c9fbf` passed.
Its first full browser run reached the saved proposal, then failed because the harness
waited for intentionally collapsed weather text without opening the disclosure. The
harness opens it before and after reload, and 14 focused proposal tests pass,
including hidden-then-visible provenance checks. A second hosted run found the same
old assertion in the unworn planned-proposal path; all three checks now open the
disclosure. The complete compiled local browser journey subsequently passed, including
rescue, exploration/adaptation, plans, actual wear/correction/deletion, feedback,
photo ownership and the collecting/activated styling loop. Hosted conformance for the
first test-only follow-up passed. Final hosted browser verification remains pending;
application runtime code and deployment guards are unchanged. That hosted run then
exposed a separate harness acknowledgement race at photo correction: it reloaded after
HTTP 200/database commit but before the UI consumed the response and cleared its pending
command. The intentionally safe retry state was correct. The harness now waits for
visible acknowledgement and the refreshed correction control. A new deferred-body
remount regression plus affected wear-form tests passed (11 tests); no production
recovery behavior changed. The next full hosted browser outcome remains pending.
The earlier broad private-checkout Python study guards correctly rejected changed
production fingerprints; their frozen evidence was not rewritten or exported.
Local results, hosted CI and product benefit remain separate evidence.

## Remaining work and next actions

Explicit scoped item/composition instructions are not implemented. The faithful
existing-wardrobe walkthrough and its narrower-screen assessment remain open.
The complete synthetic lifecycle browser regression passes locally, with final hosted
verification pending. Human usefulness is unestablished.

1. Finish the current app-only regression and bounded review checkpoint; save it on
   GitHub with its limitations stated and inspect hosted checks separately.
2. Preserve the observed synthetic mechanism evidence while closing the remaining
   ordinary-history, faithful-wardrobe and existing-journey verification gaps.
3. Select the next focused implementation slice from the owning specification, with
   a review/test/documentation cycle before broadening again. Release requires separate
   authorization; no paid calls or deployment are part of this checkpoint.
