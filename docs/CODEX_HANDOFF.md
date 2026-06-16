# Codex Handoff

## Operating Contract

Codex is a read-only support reviewer for this repository, except this handoff file when
Brian explicitly asks Codex to route findings here.

- Do not edit source code, tests, configuration, plans, or existing documentation unless Brian
  explicitly changes that instruction.
- Review Claude's work for correctness, omissions, regressions, maintainability, and coding
  conventions.
- Review plans and documentation for holes, contradictions, unclear contracts, and downstream
  consequences.
- Act as a sounding board for architecture, implementation choices, and evaluation ideas.
- Distinguish verified findings from suggestions and unresolved questions.

## Post-M0 Review: 2026-06-16

Brian clarified the current direction: the documents are intentionally directional and several
future `/spec` runs are still expected. Treat future M4-M6 issues below as routing notes, not as
claims that M0 should have solved them. The current working assumption is to keep most of the app
shell and host infrastructure, while replacing the recommender system and the CV service if needed.
If a retained surface is later abandoned, the corresponding hardening item can be dropped.

### Verification Snapshot

- `ml-system`: M0 substrate exists in `ml-system/fitted_core/` and is covered by pytest.
  `cd ml-system && .venv/bin/python -m pytest` passed: **73 tests passed**.
- `fitted`: after dependency install, `npm test -- --runInBand` passed: **206 tests passed**.
- `fitted`: `npm run lint` failed: **42 errors, 18 warnings**. Most errors are
  `@typescript-eslint/no-explicit-any` in tests; two are in `app/(app)/wardrobe/page.tsx`.
- `npm install` reported **42 audited vulnerabilities**: 2 low, 30 moderate, 8 high,
  2 critical.
- Worktree was clean after reverting install-only lockfile churn.

### Current Verdict

M0 is implemented and green. The remaining high-value work is:

1. Tighten the M1 sampler API before implementation.
2. Route M4/M5 state, cache, migration, and feedback contracts into their owning `/spec` runs.
3. Decide which host routes survive the refactor; harden and test retained routes before M5.
4. Add status banners or rewrites so legacy docs cannot be mistaken for the v1.2 source of truth.

## Findings For Claude

### 1. M1 Sampler API Still Cannot Carry Its Promised State

**Owner:** M1 `/spec` or immediate M1 implementation pass.  
**Severity:** High.  
**Status:** Must resolve before writing `sampler.py`.

The active plan still says:

```python
sampler.sample_type(items, cap, rng, signal_fn, interaction_count) -> list[WardrobeItem]
```

But the same plan requires per-type signal/random mode, fallback reason, and scorer-fault
handling. A scalar list return cannot say whether one type used signal while another fell back.
Likewise, `SamplerResult` currently has one aggregate fallback reason, which can falsify logs.

Recommended contract:

```python
sample_type(
    items: Sequence[WardrobeItem],
    cap: int,
    rng: random.Random,
    scorer: SignalScorer,
    context: RequestContext,
) -> TypeSampleResult
```

`TypeSampleResult` should carry:

- sampled items
- sampling mode: `signal` or `random`
- optional fallback reason: `coldStartSampling`, `signalUnavailable`, `signalScorerFault`
- counts for random and signal slots when the signal path runs

`SamplerResult` should retain outcomes by `ItemType`, not just one request-level reason.

Also define before coding:

- whether `scorer.is_available()` is evaluated once per request or once per type
- behavior when `is_available()` throws or returns a malformed value
- finite-score validation, excluding booleans
- final canonical output order for the GPT prompt
- whether `RequestContext` is built by the entry point or passed in already normalized

### 2. Retained Auth And Account Routes Trust Body-Supplied Firebase UIDs

**Owner:** retained host hardening, before M5 if these routes survive.  
**Severity:** High.  
**Status:** Verified in code.

`fitted/app/api/auth/sync/route.ts` accepts `{ firebaseUid, email }` from JSON and creates or
returns a Mongo user without verifying a Firebase ID token. `fitted/app/api/account/route.ts`
reads and updates account metadata by body-supplied `firebaseUid`. The account client sends JSON,
not an `Authorization: Bearer <idToken>` header.

Impact: any caller who knows or guesses a Firebase UID can pre-create, read, or patch account
metadata for that UID. This is inconsistent with wardrobe, recommend, preferences, and
interactions routes that derive the Mongo user from a verified bearer token.

Route forward:

- introduce one shared authenticated-user helper for retained API routes
- make account GET/PATCH derive UID from the token, not the body
- make auth sync verify the ID token and bind token UID/email to the created Mongo user
- add tests for unauthenticated requests, invalid token, and token/body UID mismatch

### 3. Wardrobe Images Are Served By Raw ID Without Ownership

**Owner:** retained host hardening, before M5 if Mongo-backed image serving survives.  
**Severity:** High.  
**Status:** Verified in code.

`fitted/app/api/images/[imageId]/route.ts` fetches `WardrobeImage.findById(imageId)` and returns
the bytes without auth. `WardrobeImage` stores `user` and `wardrobeItem`, but the read path ignores
both.

Impact: wardrobe/CV-upload images become bearerless URLs. Any known `mongo:<id>` can be fetched by
another user or after deletion if the image document remains.

Route forward:

- require bearer auth on image reads
- query by `{ _id: imageId, user: userId }`
- consider whether `wardrobeItem` must also exist and belong to the same user
- add negative tests for no token, invalid token, cross-user image ID, and deleted item/image

### 4. Interaction Writes Are Not Safe As Future Training Truth

**Owner:** M4 `/spec`, plus retained route hardening if legacy interactions remain.  
**Severity:** High.  
**Status:** Verified in code.

`POST /api/interactions` verifies auth, but it stores client-supplied `itemIds` directly after
checking only that the array exists. `perItemFeedback` is normalized by shape only. Ownership is
used later only for best-effort Gemini enrichment, after the interaction row has already been
persisted.

Impact: a user can submit nonexistent IDs, foreign-user item IDs, or per-item feedback for items
outside the shown outfit. That poisons history now and becomes dangerous once M4/M6 treat
interactions as affinity, cooldown, or training labels.

Route forward:

- define server-issued generation ID and outfit ID
- store immutable snapshots of item IDs, SlotMap, BaseKey, FullSignature, visible attributes, and
  model/control-arm metadata at issue time
- accept feedback only for issued, unexpired outfits owned by the user
- require `perItemFeedback.itemId` membership in the issued outfit
- define idempotency for duplicate submissions and retry behavior
- decide whether PATCH/DELETE reverses derived affinity or is disallowed after derivation
- add tests for fabricated IDs, foreign IDs, stale/deleted items, and feedback outside the outfit

### 5. M4 Wardrobe Migration And Adapter Need A Total Mapping

**Owner:** M4 or W-track `/spec`.  
**Severity:** High.  
**Status:** Direction is sound; implementation rules are not total yet.

Current Mongo wardrobe rows are not shaped like M0 `WardrobeItem`.

- `fitted/models/WardrobeItem.ts` has `clothingType: enum ["top", "bottom"]`.
- v1.2 requires five types: `top`, `bottom`, `dress`, `outer_layer`, `shoes`.
- Python `WardrobeItem` requires `warmth` and `image_url`.
- Legacy classification can produce `mid_layer`, which has no v1.2 slot.

Route forward:

- define a total mapping from legacy rows to v1.2 rows
- decide mid-layer policy: map to `top`, map to `outer_layer`, quarantine, or deactivate
- define defaults or nullability for `warmth`, image, material, formality, and tag fields
- define seasons-to-warmth mapping
- quarantine ambiguous/unclassifiable rows instead of silently coercing
- emit migration counts by reason
- add adapter/backfill tests, including malformed wire values such as `warmth=True`

### 6. Candidate Cache Ownership Is Undefined

**Owner:** M5 `/spec`.  
**Severity:** High for M5, not an M0/M1 blocker.  
**Status:** Open.

R1 requires two-stage caching of sampled pool plus GPT candidates. R9 later merges constrained
lock-escalation candidates into that same candidate cache. The selected architecture also says Fly
should remain stateless. No durable/shared cache owner is named.

M5 must choose:

- storage owner: Mongo, Redis, Vercel KV, or other
- TTL and daily-reseed behavior
- atomic merge and FullSignature dedup under concurrent regenerations
- entry-size or candidate-count bound
- cache-unavailable fallback
- whether escalation output is appended to the shared session entry or tracked separately

Refine the R1 wording too: candidate-generation inputs should determine the candidate-cache key.
Per-request ranking/filtering inputs should not. Explicitly keep `generationIndex`, locks,
contextual dislikes, cooldown state, and feedback updates out of the candidate-cache key unless
the M5 spec intentionally changes the architecture.

### 7. Regeneration Has Deferred But Load-Bearing M5 Decisions

**Owner:** M5 `/spec`; M3 pure functions can proceed with assumptions.  
**Severity:** Medium/High for M5.  
**Status:** Open; do not leave `regen-controls.md` saying "None blocking" without qualification.

R9 is a good direction: locks and contextual dislikes are per-request filters, and starvation gets
one constrained escalation. The open pieces are M5 lifecycle rules:

- `generationIndex` owner, valid range, increment, retry, replay, and reset behavior
- interaction between 15-minute cache expiry and within-day stability
- whether hard refresh survives, is renamed, or is removed
- concurrent regeneration and duplicate request behavior
- invalid/deleted/unavailable locks
- exact `regenNotice` shape and partial-result precedence

Recommended wording: "M3 pure functions are unblocked; M5 behavior remains blocked on lifecycle
and cache decisions."

### 8. Legacy Docs Still Conflict With v1.2

**Owner:** docs cleanup before the next major handoff.  
**Severity:** Medium.  
**Status:** Verified.

Several docs still read as current architecture even though the M0-M6 plan supersedes them.

Examples:

- `ml-system/README.md` presents `outfit_recommender.py` as the ML system and does not describe
  `fitted_core/` or the M0 pytest suite.
- `docs/RECOMMENDATION_MODEL.md` says per-item feedback is not stored, but current code stores
  `OutfitInteraction.perItemFeedback` and future plans treat it as important negative-label data.
- `docs/RECOMMENDATION_MODEL.md` still describes old shortlisting limits, footwear injection,
  and mid-layer behavior that conflict with v1.2 SlotMap rules.
- `docs/plans/legacy-prospecting.md` still says `extractOccasionBuckets` is a candidate for
  R5 occasion bucketing, but R5 says occasion is normalized verbatim text, not bucketed.

Route forward:

- add "legacy/current/future" banners to design and recommendation docs
- update `ml-system/README.md` with a split between legacy demo and v1.2 substrate
- mark M0 complete in active handoff/planning docs
- correct the R5 legacy-prospecting note: occasion buckets may be legacy evidence or GPT context,
  but seed/cache uses normalized verbatim occasion text

### 9. Test Infrastructure Does Not Yet Protect The Cross-Runtime Plan

**Owner:** testing/CI cleanup before M5.  
**Severity:** Medium.  
**Status:** Verified.

Current state:

- root `npm test` only delegates to `fitted`; it does not run `ml-system` pytest
- no `.github/workflows` directory is present
- Jest coverage only collects `lib/**/*.ts`, excluding API routes, pages, models, and route tests
- some tests inline copies of production logic instead of testing shared code paths
- `requirements.txt` mixes M0 pytest with heavy CV dependencies and uses lower bounds

Route forward:

- add one repo-level test command that runs both runtimes
- add CI once the workflow is stable locally
- expand coverage collection or create explicit route/security suites
- split or lock Python test dependencies enough for reproducible CI
- add M1 tests for partition ordering, duplicate IDs, seeded fallback, 70/30 split, scorer
  availability, scorer faults, and per-type logging outcomes
- add M5 cross-runtime seed/cache tests using the Python golden values before implementing the TS
  adapter/cache key

### 10. `USE_ML_SHORTLISTER` Is A Kill Switch, Not An A/B Design

**Owner:** M5/M6 evaluation `/spec`.  
**Severity:** Medium.  
**Status:** Open.

An environment boolean is useful for cutover and rollback, but it is not a stable online
experiment. If M6 lift is going to be claimed through A/B, define:

- user/session assignment
- treatment version IDs
- exposure logging
- candidate-position logging
- baseline/control window
- minimum sample size or stopping criteria
- guardrail metrics and rollback conditions

### 11. M6 Scorer May Be Inert For Many Users Unless Eligibility Is Measured

**Owner:** M6 evaluation `/spec`.  
**Severity:** Medium.  
**Status:** Open.

The planned trained scorer affects only the 30% signal branch, and only when:

- the user has enough interaction history
- the scorer is available
- at least one item type exceeds its cap, so sampling actually happens

For users with small wardrobes or sparse feedback, M6 may not visibly affect recommendations.
Before treating M6 as the ML-depth deliverable, measure scorer-eligible request prevalence. If
eligibility is low, consider expanding the model-controlled surface to candidate ordering,
candidate scoring/ranking, or another downstream slot that affects more requests.

## Suggested Next Actions

1. Update `m0-m1-substrate.md` M1 signatures/results before implementing M1.
2. Patch docs status: mark M0 complete, add legacy/current/future banners, fix the R5 occasion
   bucketing note.
3. Decide retained host routes for M5; if keeping account/images/interactions, add auth and
   ownership tests before relying on them.
4. Run M4 `/spec` for wardrobe migration plus issued-outfit feedback truth.
5. Run M5 `/spec` for candidate cache ownership, regeneration lifecycle, and cross-runtime seed
   adapter.
