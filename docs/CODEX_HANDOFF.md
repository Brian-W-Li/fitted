# Codex Handoff

## Operating Contract

Codex is a read-only support reviewer for this repository.

- Do not edit source code, tests, configuration, plans, or existing documentation.
- Review Claude's work for correctness, omissions, regressions, maintainability, and coding conventions.
- Review plans and documentation for holes, contradictions, unclear contracts, and downstream consequences.
- Act as a sounding board for architecture, implementation choices, and evaluation ideas.
- Avoid substantial implementation work unless Brian explicitly changes this instruction.
- The only standing write permission is this file.
- Distinguish verified findings from suggestions and unresolved questions.

## Directional Review: 2026-06-13

The plan is intentionally being developed direction-first through milestone-specific `/spec`
sessions. Findings below are not demands to fully design M4-M6 now. They are early warnings to
route into the owning specification before implementation reaches the affected boundary.

The previous review's M0/M1 findings are removed because Claude resolved them in the active
plans:

- M0-4 now rejects duplicate assignment to all five role-owned slots before SlotMap collapse.
- R10 now defines key validity and reserved-character preconditions.
- R11 now separates scorer availability from interaction count and defines deterministic
  fallback behavior.

Current verdict: **M0-M3 remain feasible.** The main unresolved work belongs to M2 validation
and the future M4/M5 specifications.

## M0-M3 Implementation Readiness Review

Council review on 2026-06-13 used four independent passes covering contract consistency,
M0/M1 algorithms, M2 validation, and M3 ranking. Codex reconciled the reports against the PDF,
active plans, current source, and tests.

### Readiness Verdict

| Milestone | Verdict | Meaning |
|---|---|---|
| M0 | **GO after minor plan clarifications** | Architecture and task split are sound. Fix the seed-test wording and byte-framing rule while implementing. |
| M1 | **CONDITIONAL GO** | Algorithm is sound, but scorer injection and per-type sampling outcomes must be resolved before freezing the API. |
| M2 | **SPEC FIRST** | Feasible, but current docs are directional and lack an executable schema, validation/result contracts, and repair semantics. |
| M3 | **SPEC FIRST** | Feasible, but current docs do not yet define one deterministic authoritative ranking algorithm. |

The overall M0-M3 foundation passes review. These are localized contract gaps, not reasons to
change the architecture.

### Required Before M0/M1 Implementation

#### M0 clarifications

1. **Seed framing must use UTF-8 byte length**, not Python character count, if another runtime
   may reproduce the seed. Python `len()` and JavaScript string length disagree for non-BMP
   text.
2. Replace the impossible test wording that `session_seed` “ignores `generationIndex`.”
   `session_seed` does not accept that argument. Test instead that only `tiebreak_seed` includes
   it and that both wrappers delegate to the same canonical primitive.
3. Remove the proposed universal seed-collision property. Length-prefix framing is injective,
   but truncating SHA-256 to 64 bits is not. Test known framing ambiguities and ordinary
   per-field sensitivity instead.
4. Reject duplicate wardrobe item IDs before sampling. Duplicate logical IDs would later
   collapse in M2's sampled-item lookup.
5. Decide whether malformed wire-value validation belongs in `WardrobeItem` or the future
   adapter. Current code accepts `warmth=True` and raises incidental `TypeError` for some other
   malformed values. This is narrow and need not expand M0 into full schema validation.

#### M1 API corrections

The documented signatures currently cannot implement the promised scorer seam:

```python
build_candidate_pool(
    wardrobe: Sequence[WardrobeItem],
    context: RequestContext,
    scorer: SignalScorer,
) -> SamplerResult

sample_type(
    items: Sequence[WardrobeItem],
    cap: int,
    rng: random.Random,
    scorer: SignalScorer,
    context: RequestContext,
) -> TypeSampleResult
```

`sample_type` discovers scorer faults, so it cannot return only `list[WardrobeItem]`.
`TypeSampleResult` should carry:

- sampled items
- sampling mode (`signal` or `random`)
- optional fallback reason (`coldStartSampling`, `signalUnavailable`, or
  `signalScorerFault`)

`SamplerResult` should retain outcomes by `ItemType` or aggregate counts. One scalar request
reason is insufficient because one type can use signal successfully while another faults.

Also define:

- evaluate `scorer.is_available()` once per request
- availability exceptions/malformed returns use an explicit fallback
- scores must be finite real numbers, excluding booleans
- final per-type output ordering, since deterministic selection alone does not guarantee
  deterministic GPT prompt order

### Required M2 `/spec`

- Executable strict JSON Schema: required fields, `additionalProperties`, array bounds,
  non-empty IDs, and whether exactly `candidateRequested` outfits are required.
- Raw candidate type retaining mandatory `templateType`.
- Decide whether the single repair attempt covers schema failure only or also an all-candidates
  structurally rejected result; the PDF currently says both.
- Validate sampled-pool membership, role-to-item-type compatibility, and declared template
  versus `template_of(slotmap)`.
- Define deterministic first-wins FullSignature deduplication and canonical response item order.
- Define typed valid-candidate, rejection, and generation-error results with stable reason codes.
- Add M2-specific tests; the current test plan covers only M0/M1.

### Required M3 `/spec`

- Exact scoring and penalty constants, including overuse and repetition-window penalties.
- Deterministic greedy variant-cap/ranking algorithm and canonical pre-tie ordering.
- Exact overuse population and denominator.
- Per-step fallback state table stating whether relaxations are cumulative.
- Placement of final post-fallback dedup and refill behavior.
- Separate hard request filters (contextual dislikes and locks) from relaxable historical
  cooldown.
- Resolve the contradiction: normal fallback Step 4 relaxes cooldown, while regeneration says
  cooldown is never bypassed.
- Constrained-pool pinning rules: pinned items replace sampled items or expand caps, ordering,
  and prompt-ceiling preservation.
- Pure ranker input/output dataclasses, score breakdown, fallback trace, and partial-result
  precedence.

## Findings To Route Forward

### 1. M2 Must Validate Meaning, Not Only Slot Shape

**Owner:** M2 `/spec`. **Status:** early contract hole, not an M0 blocker.

The current plan assigns M2 the sampled-pool membership check, while M0 validates SlotMap
shape. Two semantic checks are still missing:

- A GPT role must match the canonical type of the referenced sampled item:
  `base_top → top`, `base_bottom → bottom`, `one_piece → dress`,
  `outer_layer → outer_layer`, `shoes → shoes`.
- The explicit GPT `templateType` must equal the template derived from the normalized SlotMap.

Without these checks, a sampled dress tagged `base_top`, or a top+bottom candidate declaring
`templateType: one_piece`, can be structurally valid but semantically false. This matters
because the UI contract explicitly says to trust `templateType`, not infer it.

Route into M2:

> The Step-3 validator should receive the sampled item map, validate role/type compatibility,
> validate declared-versus-derived template type, and reject rather than repair either mismatch.
> Add one rejection test per role mismatch and both template mismatch directions.

### 2. Candidate Cache Ownership Is Not Yet Defined

**Owner:** M5 `/spec`. **Status:** blocking only when M5 caching is designed.

R1 caches stochastic GPT candidates, and R9 merges constrained-escalation candidates into that
cache. The selected data path also says Fly remains stateless. Vercel process memory is not a
durable or shared cache, and no Redis/KV/Mongo cache owner is currently named.

The M5 specification needs to choose:

- storage owner and persistence model
- TTL and daily-stability behavior
- atomic merge/dedup under concurrent regeneration
- an actual entry-size or candidate-count bound
- failure behavior when cache storage is unavailable

The statement that growth is bounded by “dedup + TTL” is insufficient: repeated requests with
different lock sets can continue adding distinct FullSignatures until expiry.

### 3. The M4 Wardrobe Migration Needs a Total Mapping

**Owner:** M4/W-track `/spec`. **Status:** direction is sound; migration rules remain open.

The committed Python `WardrobeItem` requires `warmth` and `image_url`, while current Mongo rows
may lack the new attributes and an image. Existing rows may also be classified as
`mid_layer`, which has no destination in the v1.2 five-type enum.

The migration/adapter specification should define:

- mid-layer policy: map to `top`, map to `outer_layer`, mark inactive/review-required, or reject
- defaults or nullability for warmth, image, material, formality, and tag fields
- seasons-to-warmth and legacy-tag mapping
- treatment of ambiguous/unclassifiable rows
- migration counts and a quarantine/review report rather than silent coercion

“Derive via `inferItemType`” is not currently total because that function can return
`mid_layer`.

### 4. Feedback Binding Needs an Issued-Outfit Contract

**Owner:** M4 `/spec`. **Status:** the gate is recorded; its implementable shape is still open.

The ledger correctly says feedback must be bound to a server-issued generation/outfit before it
becomes training truth. The future specification still needs to define:

- generation ID and outfit ID schema
- what exact immutable item/key snapshot is issued
- expiry and replay semantics
- idempotency for duplicate submissions
- validation of item existence, ownership, outfit membership, and per-item feedback membership
- whether interaction PATCH/DELETE reverses derived affinity and liked-signature state, or is
  disallowed after derivation

Current `POST /api/interactions` persists client-supplied item IDs before any ownership or
issued-outfit check. Existing tests encode that pass-through behavior.

### 5. Legacy Interaction History Needs an Eligibility Policy

**Owner:** M4/M6 data `/spec`. **Status:** future-data snapshots are already identified; old
data remains unrecoverable.

Interaction-time snapshots can preserve new feedback, but they cannot reconstruct attributes
for legacy items already edited or deleted. Therefore a blanket backfill of BaseKey,
FullSignature, or training features from current references would overstate label quality.

Route into the data specification:

> Define a historical cutoff and eligibility rules. Exclude or down-rank unverifiable rows,
> record counts by exclusion reason, and report how much usable training data survives. Do not
> silently treat reconstructed legacy state as interaction-time truth.

### 6. `wardrobeVersion` and Derived State Need Atomic Semantics

**Owner:** M4 `/spec`. **Status:** already noted generally; make it an acceptance criterion.

Create, edit, delete, clear, availability changes, interaction writes, interaction PATCH, and
interaction DELETE are separate operations today. The future seed/cache and affinity state
cannot tolerate a committed wardrobe mutation without its version bump, or a duplicated
feedback update that increments affinity twice.

The M4 specification should explicitly cover:

- atomic or transactionally recoverable `wardrobeVersion` increments
- retry/idempotency behavior
- duplicate feedback
- interaction action changes and deletion
- affinity cap updates under concurrency
- repair/reconciliation for partial failures

### 7. Regeneration Has Deferred but Load-Bearing M5 Decisions

**Owner:** M5 `/spec`. **Status:** does not block M3 pure functions.

`regen-controls.md` currently says “None blocking,” but the integrated behavior still depends
on unresolved decisions:

- `generationIndex` owner, range, increment, retry, replay, and reset lifecycle
- 15-minute cache expiry versus within-day stability
- whether hard refresh survives, is renamed, or is removed
- concurrent regeneration and duplicate request behavior
- whether an invalid/deleted lock is dropped or causes a request rejection

Describe these as deferred M5 decisions rather than “none blocking.”

### 8. Retained Host Security Needs Executable Release Gates

**Owner:** W-track/M5 `/spec`. **Status:** current legacy debt; block release of retained
surfaces, not M0-M3.

The affected routes remain:

- `auth/sync` and `account`: body-supplied identity without token binding
- `images/[imageId]`: no authentication or ownership check
- `cv/infer`: no authentication, application upload limit, or rate limit

The current ledger identifies the problem but not the acceptance tests. Before treating these
surfaces as retained trusted infrastructure, require negative-token, cross-user ownership,
upload-limit, and rate-limit tests. Next.js-to-Fly service authentication is a separate M5
contract.

### 9. The “Four Contact Points” Description Is Too Narrow

**Owner:** M4/M5 `/spec`. **Status:** documentation precision issue.

R7 summarizes integration as auth, wardrobe adaptation, `wardrobeVersion`, and interaction
writes. Steps 4-6 also need cooldown history, liked signatures, affinities, shown-signature
history, generation state, and candidate-cache access. The direction can remain stateless Fly,
but then the Next adapter must query and send a defined ranking-state payload.

Replace “the entire integration surface is four contact points” with “four primary host
boundaries,” and let M4/M5 define the full request/state schema.

### 10. The Feature Flag Is Not Yet an A/B Design

**Owner:** M5/M6 evaluation `/spec`. **Status:** future evaluation requirement.

`USE_ML_SHORTLISTER` is currently described as both a kill switch and A/B mechanism. An
environment-wide boolean supports cutover/fallback, but not stable treatment assignment or
online lift measurement.

Before claiming A/B results, define:

- stable user/session assignment
- control and treatment version identifiers
- exposure and candidate-position logging
- baseline window and minimum sample
- quality, latency, and error guardrails
- rollback criteria

Offline evaluation must also retain candidate/exposure identity; interaction rows alone are
selection-biased.

### 11. Current M0 Model Validation Is Permissive

**Owner:** M0-2 follow-up or M5 adapter contract. **Status:** narrow code-quality issue.

`WardrobeItem.__post_init__` accepts `warmth=True` because `bool` is an `int`, while `None` and
string values raise incidental `TypeError` rather than the documented validation error. Empty
IDs/names/image URLs and malformed tag containers are not rejected.

Before the Mongo adapter relies on the dataclass as a boundary, decide whether validation lives
in the adapter or model. Whichever owns it should produce one predictable error channel and
test malformed wire values.

### 12. Active Documentation Still Has Stale Pointers

**Owner:** documentation cleanup; safe to fix opportunistically.

- `legacy-prospecting.md` says R5 uses occasion buckets; R5 actually requires normalized
  verbatim occasion text.
- `regen-controls.md` says “None blocking” despite the deferred M5 decisions above.
- `docs/RECOMMENDATION_MODEL.md` and `ml-system/README.md` still read like active architecture
  even though they describe the legacy pipeline. Add prominent historical/legacy banners or
  retire them from active entry points.
- R1/M0 rationale still mentions anonymous cookie input after R8 removed anonymous sessions.
- The cache-key rule should say that **candidate-generation inputs** must change the cache key.
  Per-request ranking inputs such as locks, contextual dislikes, feedback, and
  `generationIndex` intentionally do not.

## Suggested Sequencing

1. Implement the remaining M0 work after applying the minor seed/input clarifications above.
2. Correct the M1 scorer/result interfaces, then implement M1.
3. Run dedicated M2 and M3 `/spec` sessions before implementing either milestone.
4. In M4 `/spec`, settle migration totality, issued-outfit feedback, historical eligibility,
   snapshots, idempotency, and atomic derived state.
5. In M5 `/spec`, settle cache ownership, full cross-runtime state schema, regeneration
   lifecycle, service auth, failure behavior, and release gates.
6. Before M6 evaluation, measure scorer eligibility and define real exposure-aware A/B and
   offline evaluation contracts.
