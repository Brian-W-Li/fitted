# Codex Handoff

> **Status note (2026-06-20): historical context, not the active M2 source of truth.** This file is the
> retired brainstorm plus the post-M1 / pre-M2 adversarial audit. For **active M2 implementation it is
> superseded by `docs/plans/m2-validator.md`** (the live checkpoint plan) plus the committed code in
> `ml-system/fitted_core/validator.py` + `ml-system/tests/test_validator.py`. **C1 and C2 are now
> implemented and committed** (strict parser, result/issue model, root envelope, candidate/item schema +
> forbidden fields); the audit text below that says "M2 not implemented / no validator files exist" is out
> of date. Canonical product truth remains `docs/Fitted_Spec_v2.md`. **Do not treat this file as the C3
> spec** — read `docs/plans/m2-validator.md` for C3.

<!--
CODEX INSTRUCTIONS - keep this block, replace everything below it as needed.

This file is an ephemeral write-and-delete handoff for Claude, not a living review log.
When routing a new review, replace the prior handoff body instead of appending history.

Codex default posture:
- Review only unless Brian explicitly asks for edits.
- Prefer concrete findings with owner, severity, file/line, and fix.
- Separate verified defects from future-spec routing notes.
- Treat docs/Fitted_Spec_v2.md as canonical unless Brian says otherwise.
-->

## Current State

This brainstorm handoff has been retired after the v2 documentation consolidation.

- Canonical implementation spec: `docs/Fitted_Spec_v2.md`
- Preserved ambition, anecdotes, dream notes, user stories, and north-star concepts:
  `docs/Fitted_Spec_v2_recovered_appendix.md`

The original handoff content was distilled into those files. Git history preserves the pre-retirement
version.

Replace this section with new Codex findings when using this file as a handoff again.

## M2 Validator Handoff - 2026-06-18

This is implementation guidance for Claude, not canonical product truth. Canonical source remains
`docs/Fitted_Spec_v2.md`.

### Current Status

- M1 is complete and pushed.
- M2 is planned but not implemented.
- M2 schema is pinned in `docs/Fitted_Spec_v2.md` by commit `d49073a5`
  (`docs: pin M2 GPT response schema`).
- Pytest baseline from the planning pass: `132 passed`.
- Working tree should be clean before implementation starts.

### Canonical References

- `docs/Fitted_Spec_v2.md` §8: SlotMap structure and validation ownership.
- §9: pipeline Steps 2-3.
- §12: M2 GPT response schema.
- §13: normalize/validate behavior.
- §20: milestone ladder.
- §23: H20/H23.

### Public API Recommendation

- Keep the public API narrow:
  - `parse_gpt_json(raw)`
  - `validate_gpt_payload(payload, sampled_pool, candidate_requested=None)`
- Keep schema helpers private unless reuse becomes necessary.
- Avoid exposing `validate_gpt_schema` as a public-ish API unless implementation proves it necessary.

### Result / Error Model

- Invalid GPT/candidate data returns structured issues, not exceptions.
- Caller-contract misuse can raise.
- Duplicate ids in `sampled_pool` are caller-contract misuse and should raise `ValueError`.
- Use separate rejections and warnings channels, or an explicit severity field.
- Invalid `styleMove` is warning/drop, not candidate rejection.

### `candidateRequested`

- `candidateRequested` is an upper-bound hint, not an exact requirement.
- Fewer candidates is valid.
- Extras beyond the bound must not affect accepted candidates.
- Preferred behavior: validate only up to the bound and emit one aggregate warning such as
  `extraCandidatesIgnored`.
- Avoid noisy per-extra candidate rejections.

### Role / SlotMap Layering

- Schema validates item shape and role presence/string-ness.
- Unknown role coercion/rejection should be delegated to `normalize_to_slotmap` where feasible.
- Avoid duplicating SlotMap structural ownership.

### `sampled_pool` Membership

- Flatten `sampled_pool` to an item-id set.
- Validate only against `sampled_pool`, not the full wardrobe.
- Duplicate `sampled_pool` ids should raise `ValueError`.

### Keys and Dedup Ordering

- Compute `base_key` / `full_signature` only after structural + pool validation.
- Catch `ValueError` from key functions as `keyPreconditionFailed`.
- Exact FullSignature duplicate rejection only.
- Same BaseKey with different FullSignature survives.
- First structurally valid keyed candidate wins.
- StyleMove validity must not affect duplicate selection.
- If duplicate A has invalid StyleMove and duplicate B has valid StyleMove, keep A with warning/drop and
  reject/drop B as duplicate FullSignature.

### StyleMove Behavior

- Valid StyleMove survives.
- Invalid StyleMove is dropped and recorded as a warning.
- Invalid StyleMove does not reject an otherwise valid outfit.
- `changedItemIds` must be a subset of outfit item ids.
- Duplicate `changedItemIds` should make StyleMove invalid and dropped with warning.

### M2 Non-goals

- No ranking.
- No scoring.
- No `optionPath` / `risk` assignment.
- No graph roles.
- No compatibility / `behavioralStrength`.
- No fallback decisions.
- No freshness / exposure / cooldown.
- No cache / `generationIndex`.
- No `GenerationSnapshot`.
- No feedback.
- No forced-item rescue/lock machinery.
- No M3 / M5 / Spearhead behavior.
- No legacy recommender deletion.

### Test Plan Highlights

- Invalid JSON.
- Malformed root.
- Extra root fields.
- Missing/invalid `outfits`.
- Unknown/forbidden fields.
- Malformed items.
- Non-string/empty `itemId`.
- Missing/non-string/unknown role.
- Duplicate role slot.
- Mixed template.
- Empty base.
- Incomplete two-piece.
- Duplicate item id across slots.
- Item outside `sampled_pool`.
- Duplicate `sampled_pool` ids raise `ValueError`.
- Valid one-piece / two-piece / outer / shoes.
- Exact FullSignature duplicate drops second.
- Same BaseKey with different FullSignature survives.
- First duplicate wins even if first has invalid StyleMove and second has valid StyleMove.
- Valid StyleMove survives.
- Invalid StyleMove warning/drop.
- `changedItemIds` outside outfit warning/drop.
- Duplicate `changedItemIds` warning/drop.
- `candidateRequested` fewer/exact/extra behavior.
- Extras do not affect accepted candidates.
- Key `ValueError` becomes `keyPreconditionFailed`.
- Malformed root never partially validates nested candidates.
- Zero valid candidates returns empty candidates plus rejections.

### Mutation-hardening Targets

- Accepting unknown/forbidden fields.
- Treating `candidateRequested` as exact.
- Extras affecting accepted candidates.
- Invalid StyleMove rejecting valid outfit.
- Accepting `changedItemIds` outside outfit.
- Failing duplicate FullSignature reject.
- Deduping by BaseKey.
- Skipping sampled-pool membership.
- Checking global ids instead of `sampled_pool`.
- Allowing `imageUrl` / `warmth` / `matchedTraits` / `missingTraits` / `diagnosticReason`.
- Throwing on candidate-level bad data.
- Partially validating malformed root.
- Computing keys too early.
- Letting key `ValueError` escape.
- Last-write-wins duplicate role slots.

## Post-M1 / Pre-M2 Audit - 2026-06-18

### Current State

- OK: Local `main` is at `d49073a5` (`docs: pin M2 GPT response schema`) and local refs show
  `main` tracking `origin/main` at the same commit. No network fetch was performed.
- OK: Working tree has only `docs/CODEX_HANDOFF.md` modified. No code changes and no accidental edits to
  `docs/Fitted_Spec_v2.md`, `CLAUDE.md`, `docs/README.md`, `ml-system/README.md`, or `ml-system/`.
- OK: Active milestone is M2: strict GPT JSON validation plus SlotMap validation as pipeline Step 3.
- OK: M1 is complete in code: sampler partition/caps, 70/30 `SignalScorer` seam, `candidate_requested`,
  `build_candidate_pool`, `TypeSampleResult`, duplicate-id precondition, shared seeded RNG, and retired
  `apply_cap` seam are present in `ml-system/fitted_core/sampler.py` and covered by tests.
- OK: M2 implementation has not started. There is no `validator.py`, no `test_validator.py`, and no
  `parse_gpt_json` / `validate_gpt_payload` implementation in `ml-system/fitted_core/`.

### Ambition / Spec Accuracy

- OK: `docs/Fitted_Spec_v2.md` still reflects the intended v2 ambition: lens-first personal style graph,
  green-shirt/orphan-item rescue, owned wardrobe + context/lens, bounded sampler pool, GPT composition/prose,
  backend validation/ranking/fallback, and feedback strengthening graph memory over time.
- OK: The GPT/backend split is coherent and repeated in the right places: GPT may compose candidate item
  sets and `StyleMove` prose; backend owns validation, scoring, ranking, fallback, `optionPath`/`risk`,
  graph labels, compatibility/behavioral logic, and feedback/training truth.
- OK: The spec remains ambitious without forcing all ambition into M2. M2 is a boundary milestone; M3/M5,
  Spearhead, M4, and M6 keep ranking, service integration, rescue locks, snapshots, feedback, and trained
  graph scoring out of the validator.
- SHOULD FIX: `StyleMove` ambition has one semantic ambiguity before implementation. §6.5 says every
  `StyleMove` must reference an "actually changed/added item", while M2 only has a standalone candidate
  and cannot know "changed/added" without an intent-specific baseline outfit, forced item, or lock set.
  Claude should not invent a baseline in M2. M2 should enforce only the boundary it can know
  (`changedItemIds` are non-empty strings and subset of outfit ids, plus duplicate handling), and leave the
  semantic baseline check to later response/ranker/rescue code.
- SHOULD FIX: §13's first sentence says "drop exact FullSignature duplicates ... compute BaseKey +
  FullSignature" in that order, while §9 and the handoff imply the implementable order: validate ->
  compute keys -> dedup by FullSignature. Claude should implement compute-before-dedup and treat the §13
  sentence as wording drift to clean up later in the canonical spec.

### Documentation Consistency

- SHOULD FIX: `CLAUDE.md` and `docs/README.md` still route the default/current execution plan to
  `docs/plans/m0-m1-substrate.md`, but that file now has a completed/retired banner and says M2 gets its
  own `/spec` plan before code. This is routing drift, not an M2 code blocker if Claude starts from this
  handoff plus `docs/Fitted_Spec_v2.md`.
- SHOULD FIX: `ml-system/README.md` correctly says M0+M1 are complete and M2 is next, but still pairs
  authoritative design with the completed M0/M1 plan. Later docs cleanup should point active execution
  context away from the retired plan.
- OK: No stale references to `docs/plans/m2-validator.md` are present after the revert. Do not create that
  file in this audit pass.
- OK: No active-doc contradiction found on forbidden M2 GPT fields. The canonical spec consistently
  forbids `score`, `rank`, `optionPath`, `risk`, graph labels, compatibility/behavioral fields,
  freshness/exposure/cooldown/fallback fields, `imageUrl`, `warmth`, `matchedTraits`/`missingTraits`, and
  `diagnosticReason` / diagnostic reason candidates in M2 GPT output.
- OK: The handoff is intentionally more implementation-specific than the canonical spec. Treat it as
  Codex guidance for Claude, not product truth; `docs/Fitted_Spec_v2.md` still wins on conflicts.

### Code vs Docs Consistency

- OK: `models.py` has the five `ItemType` values and five GPT `Role` values expected by §6.1/§8/§12.
- OK: `slotmap.py` matches the three-owner validation split: schema shape is left to M2;
  `normalize_to_slotmap` owns unknown role and duplicate role-slot rejects; `is_valid_slotmap` owns mixed
  templates, empty base, incomplete two-piece, and duplicate item ids across slots.
- OK: `keys.py` matches §7. It computes `BaseKey`/`FullSignature` from a valid SlotMap and raises
  `ValueError` on structural or reserved-id precondition failure. M2 should catch those as candidate
  rejections, not let them escape.
- OK: `sampler.py` emits the M2 inputs: `SamplerResult.pool`, `candidate_requested`, and
  `not_enough_items`. It also rejects duplicate wardrobe ids at sampler entry, making duplicate sampled
  pool ids unreachable through the normal M1 path.
- OK: Existing tests cover the M0/M1 building blocks M2 should reuse. No current public API conflicts with
  the proposed narrow M2 API.
- SHOULD FIX: `ml-system/fitted_core/__init__.py` still describes the package as "M0/M1" and points to the
  M0/M1 plan. This is harmless before M2 code lands, but should be updated when M2 is implemented.

### M2 Readiness / Holes

- OK: The broad M2 contract is implementable from `docs/Fitted_Spec_v2.md` + this handoff: parse JSON,
  validate strict root envelope, validate candidate/item/styleMove fields, normalize to SlotMap, enforce
  sampled-pool membership, compute keys, dedup exact FullSignature, and return structured issues.
- SHOULD FIX: Result object shape is not pinned. The handoff recommends `parse_gpt_json(raw)` and
  `validate_gpt_payload(payload, sampled_pool, candidate_requested=None)`, but does not define dataclass
  names/fields or stable issue-code constants. Claude should pick a minimal explicit result model in M2
  tests before implementing behavior, so downstream M3/M5 code does not depend on ad hoc tuples.
- SHOULD FIX: Stable rejection/warning codes are not fully pinned. Existing names implied by the handoff
  include `invalidJson`, `extraCandidatesIgnored`, and `keyPreconditionFailed`, but M2 also needs stable
  codes for malformed root, candidate schema failure, item schema failure, normalization failure,
  invalid SlotMap, item outside sampled pool, duplicate FullSignature, and invalid StyleMove. Do not assert
  exact human prose in tests.
- SHOULD FIX: Missing `styleMove` behavior is ambiguous. §12 makes `styleMove` optional, and the handoff
  only says invalid `styleMove` is warning/drop. Claude should decide explicitly before coding whether a
  missing `styleMove` is accepted silently or accepted with a warning. It should not reject the candidate
  because the schema says optional.
- SHOULD FIX: Invalid `candidate_requested` caller arguments are not specified. Normal M1 flow should never
  call M2 with `0` because `not_enough_items` short-circuits before GPT, but the public validator should
  still define caller-contract behavior for `0`, negative ints, non-ints, and Python `bool`.
- SHOULD FIX: `candidateRequested` extras need exact behavior in tests. Recommendation: validate only the
  first N candidates, emit one aggregate `extraCandidatesIgnored` warning, and ensure ignored extras do not
  affect accepted candidates, warnings/rejections, or FullSignature dedup state.
- OK: Malformed root behavior is sufficiently specified: no partial nested validation, root-level
  rejection, no candidates.
- OK: Candidate-by-candidate rejection is sufficiently specified for valid roots: bad candidate data should
  not stop later candidates from validating.
- OK: Invalid JSON vs network repair boundary is clear: pure parser returns `invalidJson`; the one repair
  attempt belongs to the later network/GPT caller, not M2 pure validation.
- OK: BaseKey/FullSignature behavior is sufficiently specified for M2: compute after structural + pool
  validation, catch `ValueError` as `keyPreconditionFailed`, dedup exact FullSignature only, preserve same
  BaseKey with different FullSignature, and make first duplicate win independent of StyleMove validity.
- OK: M2/M3 boundary is clear: no ranking, scoring, path/risk assignment, graph roles, cooldown, fallback,
  freshness/exposure, cache, GenerationSnapshot, feedback, forced-item rescue, or legacy-route deletion.

### Recommended Next Action

- SHOULD FIX: Before Claude writes M2 code, use this handoff as the implementation checklist and pin the
  validator result model + issue-code constants in `ml-system/tests/test_validator.py` first.
- SHOULD FIX: Keep M2 in `ml-system/fitted_core/validator.py` with no DB, OpenAI, service, cache, M3
  ranker, or Next.js wiring.
- SHOULD FIX: Commit this handoff before implementation so the working tree is clean except intentional M2
  code/test changes.
- OK: No blocker found that requires editing canonical spec before Claude can implement M2, provided Claude
  follows the clarifications above.

### Deferred Improvements / Parking Lot

- PARKING LOT: Later docs cleanup should reconcile the stale default-reading-list references that still
  call `docs/plans/m0-m1-substrate.md` current even though it is completed.
- PARKING LOT: Later canonical spec cleanup should clarify the `StyleMove` "actually changed/added" owner
  and fix the §13 compute/dedup wording order.
- PARKING LOT: After M2 lands, update `ml-system/fitted_core/__init__.py` and `ml-system/README.md` from
  M0/M1 wording to M0-M2 wording.
- PARKING LOT: Consider promoting any stable M2 issue-code list from implementation tests into the
  canonical spec only if later M3/M5 callers need those codes as public contracts.
