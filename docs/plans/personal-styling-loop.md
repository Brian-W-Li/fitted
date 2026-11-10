# Personal styling loop — implementation specification

Status: selected development goal; critical specification review complete;
feature implementation has not started.
This document owns this bounded implementation contract. The [canonical spec](../Fitted_Spec_v2.md)
owns product ambition and existing contracts; the [roadmap](../ROADMAP.md) owns progress,
the verified code baseline, checks, blockers and release status. Nothing here claims
that a learned model has improved a person's taste predictions.

## 1. Intended result

In the actual Fitted application, a person can return to an editable style direction,
describe today's situation, compare outfits from available owned clothes, and give
ordinary explicit feedback. Later outfits can reflect supported combination preferences
within that direction and situation. The person can correct or remove that support,
switch directions, and keep exploring without losing existing rescue, planning or wear.

Example: return to a campus direction, ask for a relaxed class outfit, reject an outfit
as a taste judgment, and later see a different supported combination influenced by
that judgment. A concern about one shirt's physical fit remains an item concern. A
different direction must not inherit the campus judgment as universal taste.

This advances appendix C.0/C.8's executable style memory. It is not complete visual
boards, automatic style detection, calendar integration, a new standalone site, a
participant study, activation of the frozen catalog head, or a guarantee of improved
human preference accuracy. Those are outside this deliverable.

## 2. Verified starting point and source index

The live walkthrough inspected existing wardrobe, feedback history, garment recall,
saved proposals, exploration controls, plan forms and wear forms. It made no generation
calls or content writes. Fresh model quality and hosted write behavior were not tested.

| Existing owner | What it establishes / extension seam |
|---|---|
| `fitted/app/(app)/dashboard/page.tsx` | Daily/rescue request, pending command, restored result, reactions, sticky keep controls. Freeze profile/context before dispatch; show captured context on restored results. |
| `fitted/app/(app)/memory/VariationForm.tsx` | Saved-situation exploration and new-situation adaptation already exist. Extend context inheritance without rebuilding them. |
| `fitted/lib/mlRecommend.ts` | Owner/lineage admission, replay, wardrobe/history load, service call, snapshot admission and browser projection. |
| `fitted/lib/mlRequestAdapter.ts` | Typed cross-runtime lens/garment mapping. Nonempty constraints are currently rejected; new style fields must be explicit. |
| `fitted/models/GenerationSnapshot.ts` | Immutable inputs/candidates/shown identities and reserved profile fields. Reserved fields do not constitute implemented profiles. |
| `fitted/lib/interactions.ts`, `feedbackAmendments.ts`, `feedbackEvidence.cjs`, `latestFeedbackState.ts` | Snapshot-bound reactions, latest state, correctable reasons and removal. Notes are currently stored but do not steer recommendations. |
| `fitted/lib/mlBehavioralRows.ts` | Bounded owner history projection. Current signals use item IDs, exact signatures and exposure, not attribute learning. |
| `ml-system/service/app.py`, `service/contract_fields.json` | Validated HTTP boundary, behavioral reducers and traced engine dispatch. |
| `ml-system/fitted_core/rescue.py`, `sampler.py`, `generation.py`, `validator.py` | Bounded generation and structural authority; the model call is isolated in generation. |
| `ml-system/fitted_core/ranker.py`, `response.py` | Filtering, score/diversity/truncation and final surfaced selection. The existing experimental selection-score override has no production caller. |
| `fitted/lib/outfitExperience/`, `outfitPlanning/`, `snapshotVisibility.ts` | Suggestions, plans, actual wear, corrected report derivatives and visibility stay distinct. |
| `fitted/lib/ownerWriteFence.ts`, `fitted/models/User.ts`, `userErasure.ts` | Admission fence and owned-data deletion; new storage must participate. |

Garment subtype is stored in Mongo but is **not currently sent to Python**. The
stylist currently consumes declared text attributes, not photo pixels. Optional fit
describes cut; it does not establish personal comfort, construction or layering fit.
The production adapter currently supplies no meaningful formality attribute. The old
experimental feature banks and human answers are not production feature sources.

## 3. One user journey

1. Home offers an optional saved style direction and saved situation, followed by
   today's event/weather inputs. Returning users can reuse their visible selection.
   Starting without either preserves the current cold-start path.
2. Outfit photos/cards and one StyleMove remain primary. Context is summarized
   compactly; detailed provenance is available on demand. All shown options retain
   their actual captured garment membership and exact controls.
3. Like/dislike remains a judgment of that whole outfit. Named-context requests show
   a compact learning setting, defaulting to off until the person explicitly enables
   experimental learning for that profile and situation. The acknowledged setting is
   captured on the request and reaction. No quiz or extra comparison session is required.
4. Optional feedback separates a taste judgment from a temporary situation problem,
   an item concern and an instruction. Temporary/unspecified concerns do not silently
   train the learner. Unchosen cards are not dislikes. Save, plan and wear do not
   produce preference labels.
5. Continue/refine reuses the existing request lineage, keep/avoid and explore
   mechanisms. The next request shows the applicable profile, situation and corrections.
   Learning must reach final selection. A declared reachable fixture must change
   surfaced garment membership; elsewhere policy may change order only or leave the
   set unchanged. Report those outcomes separately; do not force change by raising weights.
6. Feedback can be flipped, excluded from learning or removed in History. The next
   decision is rebuilt from current resolved evidence. Plan and wear remain existing
   optional actions, without being converted to training evidence.

The product must distinguish a declared instruction from an inferred preference.
An item-fit note does not itself ban an item. Offer an explicit action such as
"Leave this piece out next time" with its scope visible; only accepting that action
creates an instruction. Free prose never becomes a hidden exclusion or model label.

## 4. Profile, situation and version contracts

Use the canonical vocabulary: a text **Board** is the user-facing saved style direction;
its **StyleProfile** is the compiled representation, captured by immutable version.
**Routine** is a minimal user-named recurring situation. RequestIntent continues to
mean daily/rescue. No new graph database, calendar or visual-board compiler is required.

- Owner-bound text Board: stable board ID and one stable StyleProfile ID, editable label,
  embedded immutable profile versions, separate raw source and compiled snapshot,
  active/archived status and learning opt-in. No second direction identity system.
  The compiled snapshot has declared aesthetic words and optional declared palette,
  pattern and fit preferences. Preserve unknowns. Do not infer a formality scale or
  physical-fit fact. Only its compiled fields steer generation; retain raw input separately.
  The creation form asks for a label and up to 12 style-word/phrase chips, plus optional
  palette/pattern/cut preferences. The person reviews that same summary before saving.
  Compilation is deterministic validation/normalization of those explicit fields; no
  hidden model call, inferred traits, image compiler or mandatory stylist interview.
- Minimal Routine: stable owner ID, label and semantic version; no inferred schedule.
  A Board may remember an explicitly chosen default Routine, shown on Home.
  A new event can use that selection or choose no saved situation. No text classifier
  silently decides that two occasions are the same context.
- Cosmetic renaming preserves semantic version. Editing description/compiled traits
  creates a new semantic version; old feedback does not transfer automatically.
  The first implementation offers no cross-version carryover.
- Learning partition: owner + profile ID/version + Routine ID/version + canonical
  weather bucket, including an explicit `unspecified` bucket when weather is unknown.
  `unspecified` only shares evidence with itself; it is never guessed to mean mild.
  Missing profile/Routine means no learned influence. A returning person can reuse
  two visible selections without supplying location or manual weather.
  This conservative boundary may abstain often; do not imply broad situational understanding.
- Limits: at most 8 active/32 total Boards and 16 retained semantic versions per profile;
  at most 16 active/32 total Routines and 8 retained versions per Routine. Labels <=60 characters,
  raw description <=500, compiled aesthetic terms <=12 with <=60 characters each.
  Refuse excess with an actionable response; do not silently overwrite history.
- Storage extends existing owner-fenced writes, optimistic revisions and account
  erasure. Implementation must provision and verify any new required indexes; no
  production auto-index assumption. Validate all referenced profile/Routine ownership.

Named partitions use only matching scoped reactions for both existing item/combo
preference terms and the learner. Legacy unscoped feedback remains on the existing
unscoped path and is never silently assigned to a profile. Exposure/repetition may
remain owner-wide, identified as exposure rather than taste. This keeps cross-direction
rotation separate from cross-direction preference transfer.

Home shows learning off, collecting eligible feedback (including current unique like/
dislike support), active for supported traits, or a specific abstention reason. Counts
describe data, not confidence. It must be possible to reach support through ordinary
opted-in use; no separate calibration session is required. Semantic edit warns that
learning stays with the old version. Archive is the normal reversible removal action.

Archive prevents fresh generation but preserves historical read and exact completed
replay. Erase is a separate explicit destructive action whose UI explains that linked
proposals and plans become unavailable. First tombstone the Board/Routine in the
owner-fenced transaction; every source read and admission checks that tombstone, even
if cleanup is interrupted. Then hard-delete affected generation records and dependent
reactions/amendments, release their photo holds through existing lifecycle helpers,
and erase raw/compiled versions, copied context and diagnostics. A redaction flag
alone does not erase embedded content. Minimal tombstones fence late writes/retries.
Independently captured confirmed wear remains readable without the removed source,
contains no copied profile description and retains its actual garment/photo holds.
Account erasure removes all new storage and tombstones. Test interrupted cleanup and
both orderings of erasure versus generation/feedback admission.

## 5. Requests, immutable evidence and concurrency

- Root requests supply IDs and expected versions, not trusted profile contents. The
  server resolves the owner-bound versions and freezes their compiled snapshots.
  Pending commands include the same IDs/versions. Reload cannot silently select newer
  meaning or relabel an old shown result.
- A request ID identifies one command including profile/Routine identity, versions,
  experimental setting and explicit controls. Same ID with changed meaning returns
  conflict. Exact completed retry replays the immutable result without another model call.
  Existing weather replay and parent ownership rules still apply.
  Completed replay resolves captured identity before any active-version requirement:
  archive permits exact replay; erase denies visibility. Uncompleted commands and
  every regenerate/Explore/adapt child require active source context. A duplicate
  winning snapshot is replayed even if the current memory revision has advanced.
- Regenerate and same-situation Explore inherit the captured profile/Routine/version
  and weather. New-situation adaptation preserves the profile by default and requires
  an explicit Routine selection (or none). A deliberate profile change starts a new
  root command, optionally retaining an explicitly selected available anchor.
- Profile/Routine identity participates in new candidate-family keys and RNG seeds,
  with a new key version. Legacy requests/keys retain their original behavior. No key
  change rewrites old snapshots or implies that a candidate cache exists.
- Add typed profile/context and preference inputs to service protocol v2; do not
  hide them in the currently unsupported constraints map. New code reads stored
  snapshot schema v1 with absent preference equal to zero, and schema v2 with the
  new signed term included in score validation. Unchanged old binaries need not read
  new payloads. Paired web/service version mismatch fails before provider spend.
  Update strict allowlists, serde, schemas, score arithmetic and contract mirrors
  together. Paired release/rollback must verify this boundary; no deployment now.
- Capture the exact feature facts, feature/model/policy versions, evidence cutoff and
  digest, learned signed contribution, abstention reason, unpersonalized comparator
  selection and **final surfaced garment IDs/order**. Do not replace existing baseline
  breakdown values with a misleading learned score.
- Read profile versions, opt-in, instructions, dispositions and effective votes in a
  consistent Mongo read transaction with an owner `styleMemoryRevision`. All relevant
  mutations advance that revision in their own owner-fenced transaction: votes,
  flips/removals, eligibility-changing amendments, opt-in, instructions and context
  edit/archive/erase. Exact idempotent no-op retries do not advance it again.
  Snapshot admission compares the expected revision **inside** the transaction that
  touches the owner fence and inserts the result, not in a preceding read.
- Revision drift after dispatch produces a terminal `superseded` command receipt with
  reason `memory_changed`, the original attempts/candidate audit, zero surfaced options
  and no bindable candidate token. Store it under the same unique owner/request ID;
  exact retry replays that receipt without dispatch. UI clears the pending command,
  preserves earlier valid cards, refreshes memory, and offers an explicit new request
  with a new ID. No automatic paid retry. This is not an indefinitely retryable command.
  Edits after admission affect later decisions, not immutable historical suggestions.

## 6. Explicit corrections and constraints

Keep request-only keep/avoid behavior as it exists. An explicit future-use item
exclusion may be saved for one named profile/Routine or applied to the next request
only. It is separately editable/removable, owner-validated and displayed before dispatch.
Instructions bind exact profile/Routine semantic versions and have stable IDs and
revisions. One-request instructions bind a specific newly allocated request ID before
dispatch, survive that command's exact retries, and are never silently assigned to a
later command, child or failure recovery. Persistent instruction edits affect fresh
commands and advance the memory revision; archived versions do not carry instructions.
Whole-combination exclusions use exact unordered membership, not a ban on every member.
Support at most 20 saved item exclusions and 20 saved combination exclusions per
profile/Routine version, with <=5 unique members each. Add a separate server-resolved
typed exclusion list; the existing single Explore-source exclusion is not this list.
Its immutable resolved digest enters command identity/audit, and all fallbacks enforce it.
Do not implement free-text formality, comfort or style instructions as hard guarantees.

Precedence: ownership/availability/structure and exact controls first; then the user's
declared style direction; then bounded learned preference; then existing diversity and
fallback. A conflicting kept/excluded anchor requires a visible correction before any
provider call. Exhaustion returns fewer/no options honestly and never relaxes an explicit
exclusion. An archived/erased profile cannot be used for fresh generation.

## 7. One experimental learner

Implement a new regularized binary outfit-preference learner. Existing isolated
pairwise kernels and frozen results are references, not production imports or labels.
The target is a contextual whole-outfit like/dislike, not wear or satisfaction.

### Evidence and features

Use explicit `learning_disposition` amendments bound to the original current reaction,
with stable operation ID, expected disposition revision and the same owner/snapshot
validation as reason amendments. They append no vote and cannot move its vote time.
History exposes inclusion/exception controls. The resolver applies the latest
disposition before selecting eligible evidence; removals delete its amendments too.

| Effective state | New learner eligibility |
|---|---|
| Plain like/dislike from a captured opted-in named context | `normal`: one whole-outfit binary label |
| Request opted out, unscoped legacy vote, save/plan/wear, or no matching context | Ineligible; enabling later does not silently enroll old rows |
| Item-fit concern, temporary/request concern, or unspecified “something's off” | Append `exception` in the same reason/disposition transaction; no taste label |
| Person explicitly confirms “also reflects my taste here” | Append `normal`, linked to that exact concern/reaction revision |
| Clear a concern | Keep its latest disposition; returning to normal requires an explicit inclusion action |
| Flip reaction | New vote identity and current request opt-in; old amendments do not transfer; any new concern requires its own disposition |

Existing accepted-item affinity semantics remain unchanged by a reservation. The new
learner's eligibility is separate, visible and correctable. Never infer a disposition
from free prose, per-item dislike or a later change of current Board selection.

Resolve latest candidate state and disposition while retaining ineligible states;
partition by captured context; select the latest state per exact composition across
all those states; **then** filter learning eligibility; **then** take the newest 200.
A newer exception on a repeated composition must suppress its older normal label,
even when the two votes bind different snapshots. Each composition contributes once.
Require at least six distinct eligible compositions, at least two likes and two
dislikes. These are provisional anti-capture rules, not statistically validated readiness.

Read the complete owner feedback ledger within its existing 2,000-row admission cap,
including every amendment; apply the exact resolution order above. Do not
reuse the 500 owner-wide-vote shortcut for the learner. Join owned visible source
snapshots with their captured facts. After composition deduplication and eligibility
filtering, use at most the newest 200 compositions by vote time/ID. Amendments do
not refresh vote age. The eligible support displayed by the UI uses this same reducer.

Use feature schema `app-traits.v1`, bounded at 512 channels. Only two-piece outfits
are eligible initially; dresses retain the complete existing baseline. Slot names
are `top,bottom,mid,outer,shoes`. Membership establishes present/absent roles exactly.
Normalize declared tokens by trim/lowercase, hyphen/space to underscore, collapse
repeats; aliases are only `grey=gray`, `light_grey=light_gray`, `blue_grey=blue_gray`,
`tshirt=t_shirt`, `t_shirts=t_shirt`, `dress_shoe=dress_shoes`. Do not stem or inspect names.

Freeze these finite dictionaries:

| Attribute | Values |
|---|---|
| Subtype | t_shirt, shirt, polo, sweater, sweatshirt, hoodie, cardigan, blazer, jacket, coat, turtleneck, jeans, pants, cargos, chinos, shorts, skirt, joggers, dress, jumpsuit, sneakers, boots, sandals, dress_shoes, loafers |
| Color | black, white, off_white, cream, beige, tan, khaki, gray, light_gray, charcoal, blue_gray, navy, blue, light_blue, denim, teal, cyan, green, olive, mint, red, burgundy, maroon, orange, yellow, mustard, pink, magenta, purple, violet, brown, rust |
| Pattern | solid, striped, plaid, floral, graphic |
| Fit/cut | slim, regular, relaxed, oversized |

Subtype mapping uses subCategory and verifies coarse type/role compatibility. Unknown
or incompatible values stay missing. The role/subtype schema enumerates legal cells
from those sets; it never silently coerces a footwear subtype into a top.

- Role-specific declared subtype from an explicit adapter mapping of existing
  category/subCategory; unknown/unmapped values remain missing. No subtype inference
  from garment name. Add this field to the wire and captured inputs before using it.
- Role-specific declared color sets, pattern and cut/fit, with exact finite dictionaries
  above. Multiple colors remain a set; do not invent a
  primary color. Keep white/off-white/light-gray distinct. Unknown values remain missing.
- Predeclared interaction groups: top/bottom fit pairs; base/mid fit pairs; top/bottom
  pattern pairs; and known top/bottom color relationship (shared exact color, both
  neutral, neutral/chromatic, or known same/different chromatic family). Use existing
  declared taxonomies without presenting them as universal aesthetic rules.

Item IDs, garment names, photos, raw reason prose, the engine's compatibility score,
subjective formality and personal physical fit are excluded from predictors. IDs serve
only ownership, deduplication, provenance and support/transfer checks.

An interaction channel must vary in evidence, have observed inputs in both label
classes, and have support spanning at least two distinct garments in each participating
role among its active examples. Unknown inputs are masked, not interpreted as a
negative trait. Active examples may all be likes: an interaction need not be active
in both classes. Unary channels likewise require variation, observed contrasts in
both classes, and >=2 distinct supporting garments in the participating role.

Missingness is a request-wide group decision, never a candidate-specific advantage:
all training rows and all structurally eligible candidates must have known subtype
and a nonempty fully recognized color set for top and bottom, or the request abstains.
For each optional role/attribute group, include it only when every present garment
across those rows/candidates has a known value; otherwise remove that whole group
from both fitting and scoring. A known absent optional role has presence=0 and all
its attribute cells=0; an unknown present attribute is never known absence. Exclude
interactions whenever either input group is excluded. Pattern/fit are optional groups.
Color cells are normalized multi-hot (1 divided by number of declared colors).
Whole-outfit negatives train observed complete groups only; this does not identify
which trait caused a dislike. Multiple-garment support and controls limit, but cannot
eliminate, that confounding. No causal trait explanation is presented to the user.

Thus missing top pattern removes top-pattern and top/bottom-pattern groups for the
whole decision; absent mid-layer is known absence; unknown top color means baseline;
a dress means baseline. If no supported channel varies across candidates, abstain.
Dictionary or missingness changes require a new feature version, never retrospective
reinterpretation of frozen experimental features.

### Fitting and decision policy

Fit deterministically at request time from the bounded resolved ledger; initially
persist no fitted model/cache. Use summed binary cross-entropy plus L2 penalty
`4 * ||weights||² / 2`, including a regularized intercept. Use zero-start damped Newton
with NumPy linear solves (an explicit new service dependency, pinned/tested during
implementation), <=25 iterations and <=12 backtracking halvings per iteration.
Accept an Armijo decrease with coefficient 1e-4; convergence requires gradient-infinity
norm <=1e-6. Reject nonfinite arithmetic, failed solve or non-convergence rather than
returning a partial fit. No stochastic update. Inputs are bounded to <=200 rows and
<=128 supported active channels plus intercept; if support exceeds that cap, abstain
rather than selecting a data-tuned subset. The feature dictionary remains <=512.
Reserve an independent 100ms CPU/250ms wall learner allowance after validated candidate
generation, with deadline checks each iteration; it cannot consume the provider's
dispatch allowance. Rehearse the maximum row/channel case locally before enabling
this default. If it cannot fit within that budget, baseline is served and policy/runtime
must be explicitly revised before claiming useful activation; do not tune on answers.
NumPy is needed for the bounded Hessian solve; do not import the isolated study runtime
or add a general ML framework. Missing numerical runtime must disable only learning.
Failure, unsupported context/schema or timeout means the complete scoped baseline.
Sigmoid outputs are model scores, never calibrated confidence or predicted satisfaction.

Learned adjustment is bounded at +/-0.5 baseline units, using
`0.5 * tanh(supported_trait_logit)` with the intercept excluded from ranking differences.
No tuning on preserved human answers. A model may not overcome a strong exact-outfit
boost; do not increase its bound merely to force a preferred demonstration.

Insert the signed preference term in candidate scoring **before variant caps and
top-K truncation**, with a zero default for legacy/no-model requests. Extend ScoreBreakdown
and both runtimes together. Final spread uses that complete score while retaining
reserved removable layers and hard source-membership exclusions. The response-only
experimental score override is not sufficient if an earlier cutoff loses an alternative.
Run the zero-learner comparator over the identical validated candidates, constraints
and scoped behavioral state. Record comparison provenance without serving extra cards.

No candidate synthesis, additional provider retry or hidden pool expansion is triggered
by disagreement or abstention. If the pool lacks supported alternatives, explain the
limit and preserve the existing request/refinement path.

## 8. Acceptance and review

Acceptance requires the complete local application, not a new preview website:

1. Create/select a profile and Routine; request owned outfits and restore their exact
   captured context after reload. Switching directions does not reuse another's taste.
2. Give ordinary whole-outfit feedback; show final garment membership changing for an
   authored supported relationship preference on new garment IDs, with both item-memory
   and attribute-only controls unable to explain that fixture's distinction. Freeze
   more eligible candidates than display slots, with a genuine competition for one
   slot under the same hard/diversity/layer policy. Include order-only/no-change cases.
3. Correct/remove support and show the recomputed decision; demonstrate insufficient
   evidence, unknown features/context, missing alternatives and optimization failure.
4. Explicit item/combo exclusions alter actual outfits, survive the chosen scope,
   and undo correctly. A saved note alone does not create an invisible ban.
5. Exercise daily/rescue, sticky keeps, same-situation Explore, adaptation, saved plans,
   changed wear, report correction, unavailable garments, source redaction and account
   deletion through existing contracts, including concurrent mutation/admission cases.

Also demonstrate the complete local app with faithful existing-wardrobe photos/facts
and preserved generated candidates: initial outfit choice, actual alternatives,
explicit scoped correction, next displayed garments, undo, profile switching and
plan/wear navigation. Label operator-authored synthetic feedback separately from
preserved human observations. Show whether candidate supply expresses the declared
style distinction and whether cards/actions are understandable at the current narrow
viewport. A synthetic learner fixture alone cannot complete this product walkthrough.
If available human evidence is ineligible or insufficient, show honest abstention;
do not invent labels, convert old pair choices into binary votes or demand a repeat
questionnaire. Human preference improvement remains unestablished until observed.

Tests start with focused pure feature/learner and real-Mongo lifecycle checks, then
one web/Python integrated regression, TypeScript/lint/build, and the compiled synthetic
browser journey. The browser must inspect displayed garments, not only score badges.
Use no-learner, item-memory, attribute-only and fixed shuffled-label controls on the
same synthetic candidates. Synthetic success proves mechanisms, not human benefit.
Preserved personal sessions are development material and remain unchanged; no repeated
questionnaire or population study is a prerequisite for this development deliverable.

Before feature implementation: save a verified app-only baseline on GitHub and resolve
independent reviews of product fit, cross-runtime architecture/lifecycle, ML evidence
and baseline/publication safety. The roadmap records outstanding findings.

Development is local and experimental. Hosted model influence, deployment, provider
spending and new participant collection require their separate explicit authorization.
Fresh generation quality and repeated human usefulness remain unverified until observed;
engineering pass counts must not be presented as taste improvement.

## 9. Critical review disposition

Three independent reviewers read this specification against source and ambition:

| Review focus | Critical changes made after challenge |
|---|---|
| Product and ambition | Reachable unspecified-weather use, visible support state, canonical Board/profile identity, small deterministic setup, honest order/no-change outcomes, and a faithful wardrobe walkthrough beyond synthetic proof. |
| Architecture and lifecycle | Terminal superseded-command replay, atomic revision admission, explicit archive branches, immediate tombstone fencing plus content erasure, bounded instruction scopes and paired protocol compatibility. |
| ML and evidence | Typed learning dispositions, latest composition before eligibility across snapshots, complete bounded history, finite features and shared missingness rules, numerical budget/solver, and an actual competition for a displayed slot. |

Raised critical findings are resolved for the specification stage after bounded
follow-up review. This is not implementation approval or a learning-benefit result.
Candidate supply, numerical runtime, correction/erasure races and complete-app
usefulness remain the acceptance work specified above.
