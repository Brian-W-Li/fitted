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
The faithful existing-wardrobe lifecycle walkthrough remains required; its first
request is verified below. The complete synthetic whole-app regression passes.

The complete public app web regression passed 1,746 tests with ten skips; Python
core/service passed 1,251 tests. A subsequent focused spec review reproduced an older
Routine refinement using the newer semantic label. The resolver now retains the old
meaning while preserving current cosmetic renames; the affected 163-test regression
passed after the fix. TypeScript passes on the final candidate. The production build
and focused browser journey passed before that narrow resolver fix; targeted lint and
focused navigation/frozen-pin guards pass. Exact code/test checkpoint `6faeb021` passed both
[hosted conformance](https://github.com/Brian-W-Li/fitted/actions/runs/42760690478)
(web tests/type/lint, Python and documentation) and the
[complete hosted browser journey](https://github.com/Brian-W-Li/fitted/actions/runs/42760690552).
The full local compiled journey also passed. Earlier hosted failures exposed stale
weather-disclosure expectations, a test reload before visible wear acknowledgement,
and a platform-specific screenshot path. Their focused regressions and harness-only
corrections are retained in Git; they did not change application runtime behavior.

The earlier broad private-checkout Python study guards correctly rejected changed
production fingerprints; their frozen evidence was not rewritten or exported.
Local results, hosted CI and product benefit remain separate evidence.

## Private local verification tooling

A separate local-only browser mode now validates a checksum-pinned captured subset,
verifies original photo bytes and paths, materializes an isolated owner and replays
intact drafts from an explicitly supplied preserved bank. Input/photo paths must stay
outside the running checkout and explicitly forbidden export roots. The replay mode
is exclusive and fails closed; no provider or synthetic fallback is used. Contract
fixtures in this repository are synthetic. Actual private inputs, photos, provenance
receipts, reports and screenshots stay outside Git and public workflow artifacts.

The compiled private first-request checkpoint passed locally: saved direction/situation
controls, default-off opt-in, one real application request, captured context, zero
imported support, intact original drafts, displayed garment membership and decoded
photos. A separate private preparation receipt verifies raw source coordinates and
object equality; the generic loader alone verifies the prepared input. This is not
fresh styling, whole-closet parity or evidence of taste improvement. Screenshot labels
are harness annotations, not production UI. Setup controls currently push the results
far below the fold; result accessibility needs a focused review.

Independent source review found no remaining blocker in this bounded test slice;
Node/Python checks cover checksum/MIME/path guards, correction metadata, owner binding,
exclusive mode and label-independent intact-draft selection. Generic tooling checkpoint
`426bfd77` passed exact hosted [conformance](https://github.com/Brian-W-Li/fitted/actions/runs/42761992072)
and the [complete browser regression](https://github.com/Brian-W-Li/fitted/actions/runs/42761992296).
It changes verification tooling, not production feature behavior. Local checks also
pass: nine Node fixture contracts, the integrated Python core/service regression,
TypeScript, lint with existing warnings, and focused documentation guards. The
coordinator retains private run locations and unrelated dirty-file inventory outside
this public export. This documentation-only follow-up preserves that verified runtime.

## Remaining work and next actions

Explicit scoped item/composition instructions are not implemented. Ordinary complete
history accumulation, private feedback/undo/profile/control/correction journeys,
planning/wear navigation and narrow-screen assessment remain open. The complete
synthetic lifecycle regression passes locally and on hosted CI. Human usefulness
is unestablished. Personal-account browser work awaits the user's own sign-in;
isolated local tests do not require it.

1. Verify the next bounded private slice through complete generated history and six
   distinct clearly authored reactions, then review the subsequent request's resolved
   evidence. Activation or membership change is not required for collection proof.
2. Continue the remaining private correction/undo/isolation/navigation checks in focused
   slices; keep private evidence out of the export.
3. Implement remaining scoped instructions through a focused specification/code/review/
   test/documentation cycle; address result accessibility in a separate bounded pass.
   No paid calls or deployment are authorized; the full goal remains incomplete.
