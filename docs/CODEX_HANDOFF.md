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

## Independent Confirmation Review: 2026-06-12

Method: each of the nine headline findings from the broad audit was checked independently by two read-only agents. The conclusions below reconcile both reports. Scope was explicitly separated into:

- current legacy behavior
- the new recommender/CV work that is expected to replace substantial legacy code
- contracts that still matter when those systems are integrated later

No source, test, configuration, or plan file was changed.

## Verdict Summary

| # | Finding | Verdict | Scope |
|---|---|---|---|
| 1 | Duplicate garment roles can be erased by SlotMap normalization | Confirmed | Planned M0-4 defect, not current runtime |
| 2 | Key validity and scorer fallback are underspecified | Confirmed | Planned M0-3/M1 contract defects |
| 3 | Several routes trust client identity or expose unauthenticated work | Confirmed, high severity | Current retained host infrastructure |
| 4 | Feedback is not bound to an issued outfit | Confirmed | Current data-integrity defect; future training risk |
| 5 | Item deletion/editing destroys historical truth | Partially confirmed and corrected | Current history fidelity; future ML durability |
| 6 | Cache TTL conflicts with within-day stability | Confirmed | Planned M5 contract defect |
| 7 | M6 scorer may have no behavioral surface for many requests | Architectural risk confirmed; prevalence unknown | Planned M6 |
| 8 | Some tests copy logic and overstate integration coverage | Confirmed with qualification | Mostly legacy Jest suite |
| 9 | CI/runtime/Fly operational contracts are incomplete | Confirmed with phase qualification | Tooling debt now; M5 release blockers |

## 1. Reject Every Duplicate Role Before SlotMap Construction

**Confirmed by both reviewers. This is a planned M0-4 hole, not a current runtime bug.**

Evidence:

- `ml-system/fitted_core/models.py:38-44,80-88` maps five roles into five single-valued fields.
- `docs/plans/m0-m1-substrate.md:225-245` explicitly rejects and tests duplicate tops/bottoms only.
- The later SlotMap validity checks cannot recover an item already erased by last-write-wins assignment.
- The authoritative PDF §13 rejects duplicate slots and specifically limits outer layers and shoes.
- The legacy recommendation route already counts and rejects duplicate one-piece, outer, and shoe roles at `fitted/app/api/recommend/route.ts:628-648`; this protection must not be lost in the replacement.

Required correction:

> M0-4 must reject a second assignment to any role-owned slot (`base_top`, `base_bottom`, `one_piece`, `outer_layer`, or `shoes`) on the raw role-tagged list before constructing `SlotMap`. Add a rejection test for every duplicated role and for unknown roles.

## 2. Define Key Preconditions and Scorer Availability

**Confirmed by both reviewers. These are prospective integration contracts, not defects in the deployed legacy recommender.**

Key evidence:

- `SlotMap` intentionally permits incomplete/invalid states at `ml-system/fitted_core/models.py:80-88`.
- `docs/plans/m0-m1-substrate.md:209-216` gives key functions any `SlotMap` but defines neither a validity precondition nor invalid-input behavior.
- Validation is a later task at `docs/plans/m0-m1-substrate.md:225-245`.
- `WardrobeItem.id` is an arbitrary Python string at `ml-system/fitted_core/models.py:60`, while the key format reserves delimiters and the `none` sentinel.

Scorer evidence:

- `SignalScorer.score(...) -> float` at `docs/plans/m0-m1-substrate.md:338` cannot represent the documented ColdStart scorer's "no signal" state at line 344.
- The 70/30 branch is selected from `interaction_count` at lines 317-326.
- M4 introduces real interaction counts before M6 installs a trained scorer. A user can therefore reach the threshold while no usable scorer exists.

Required correction:

> Define key functions as accepting only structurally valid SlotMaps and raising `ValueError` otherwise. Either bind IDs explicitly to canonical Mongo ObjectId strings or validate/encode reserved delimiters. Represent scorer availability separately from interaction count. At count 5+, an unavailable, failed, or non-finite scorer must use an explicit seeded-random fallback reason rather than masquerading as signal sampling. Define tie and selection order for deterministic RNG consumption.

## 3. Retained Host Routes Have Concrete Trust-Boundary Defects

**Confirmed by both reviewers, high severity. This is present legacy debt, not merely future Fly work.**

Concrete routes:

- `fitted/app/api/auth/sync/route.ts:12-39` creates/finds users from body-supplied Firebase UID/email without verifying a Firebase ID token.
- `fitted/app/api/account/route.ts:43-76,97-193` reads and modifies accounts selected by body-supplied Firebase UID without authenticating the caller.
- `fitted/app/api/images/[imageId]/route.ts:4-25` returns image bytes by ObjectId without authentication or ownership checks.
- `fitted/app/api/cv/infer/route.ts:32-145` exposes external CV compute without authentication, rate limiting, or an application-level upload-size limit.
- `AuthGate` is a client UI redirect and does not protect direct API requests.

Qualification:

- Recommendation, wardrobe, preferences, and interaction routes do verify bearer tokens. Do not describe the entire API as unauthenticated.
- `/api/cv/status` is public but is a bounded health probe and is not independently a high-severity issue.
- R8's statement in `docs/plans/spec-resolutions.md:266` that every route requires a bearer token is false.

Required integration gate:

> Before retaining these host surfaces through M4/M5, verify Firebase tokens, derive identity only from the verified token, enforce image ownership, and authenticate/rate-limit CV inference. Treat future Next.js-to-Fly service authentication as a separate contract.

## 4. Feedback Authenticity Is Not Enforced

**Confirmed by both reviewers, with narrower wording than "unauthenticated."**

Evidence:

- `fitted/app/api/interactions/route.ts:106-163` authenticates the caller and server-assigns the interaction owner.
- It accepts any nonempty array of castable `itemIds` and persists it without verifying item existence or ownership.
- `perItemFeedback.itemId` is checked only for string type and need not belong to the submitted outfit.
- The ownership-scoped wardrobe query at lines 178+ occurs after persistence and only supports optional inference.
- Mongoose references in `fitted/models/OutfitInteraction.ts` do not enforce foreign keys, ownership, or array membership.
- `fitted/tests/interactionPersistence.test.ts:78-130` encodes direct pass-through and has no foreign-user, nonmember, or issued-outfit rejection case.
- `docs/plans/spec-resolutions.md:329` proposes storing client-echoed keys and accepts the tampering risk.

Current effect:

- An authenticated user can fabricate interaction records and distort their current preference summary.
- Foreign-item metadata may be exposed through populated history if another user's valid item ID is known.

Future effect:

- M4 intends to turn these records into labels and affinity updates.
- M6 may consume them for training. Pooled training would create cross-user dataset-poisoning risk; per-user training still permits self-poisoning.

Required correction:

> Bind feedback to a server-issued generation/outfit identity. Before persistence, validate item existence, authenticated-user ownership, per-item membership in the outfit, and that the outfit was actually issued. Do not carry the current "tamper risk acceptable" resolution into the training path.

## 5. Corrected: Edits and Deletions Degrade History but Normally Do Not Crash It

**Both reviewers corrected the original runtime assertion.**

Confirmed evidence:

- `fitted/models/OutfitInteraction.ts:23-27` stores mutable wardrobe references rather than interaction-time item snapshots.
- `fitted/app/api/wardrobe/[id]/route.ts:51-89` edits the referenced item in place.
- The same route at lines 146-149 hard-deletes items without updating interactions; clear-all at `fitted/app/api/wardrobe/clear/route.ts:21` behaves similarly.
- History populates current wardrobe documents at `fitted/app/api/interactions/route.ts:66-92`.

Correction:

- Under normal Mongoose 8 array-populate behavior, missing referenced documents are omitted and an all-missing array becomes empty. A deleted array reference should not ordinarily produce the previously claimed `null` dereference/500.
- Deletion instead creates incomplete or empty historical outfits.
- Edits retroactively change how old interactions are represented.

Durable ML issue remains confirmed:

- IDs, `baseKey`, and `fullSig` cannot reconstruct the item attributes shown when feedback occurred.
- Soft deletion helps lookup continuity but does not preserve pre-edit features.

Required correction:

> M4 should preserve immutable interaction-time feature snapshots or versioned wardrobe references before interactions become training truth. Add history tests for edited, partially deleted, and fully deleted outfits.

## 6. Planned M5 Cache Does Not Guarantee Within-Day Stability

**Confirmed by both reviewers. This is an M5 design contract issue, not a defect in the current M0 substrate.**

Evidence:

- Current legacy behavior has no recommendation cache or deterministic seed; OpenAI is called with temperature `0.5` at `fitted/app/api/recommend/route.ts:520` and `0.6` at `fitted/app/api/recommend/regenerate/route.ts:527`.
- The PDF §14 specifies a 15-minute cache TTL; Appendix C1 promises stability within the day.
- `docs/plans/spec-resolutions.md:81-87` caches the sampled pool plus stochastic GPT candidates.
- `docs/plans/regen-controls.md:92` reruns Steps 1-3 after cache expiry, including GPT generation.
- The daily seed reproduces the sampled pool, not stochastic GPT output.

Additional unresolved contracts:

- The PDF's `forceRegenerate=true` requires a fresh GPT call, while R1/R9 define ordinary regeneration as cached reranking plus constrained escalation.
- `generationIndex` has no single owner, validation range, retry behavior, increment rule, or reset lifecycle.

Required correction:

> Either promise stability only for the candidate-cache lifetime, retain/persist the candidate stage through the daily seed period, or make candidate generation independently reproducible. Explicitly retain, rename, or remove hard refresh. Define `generationIndex` ownership and replay/reset semantics.

## 7. M6 Model Influence Is Narrow; Real-World Prevalence Is Unknown

**Both reviewers confirmed the architecture risk and rejected the unsupported claim that it will be rare for most users.**

Evidence:

- Per-type caps are defined at `ml-system/fitted_core/config.py:17-23`: 35 tops, 30 bottoms, 25 dresses, 20 outer layers, 25 shoes.
- `docs/plans/m0-m1-substrate.md:298-326` applies sampling only when a type exceeds its cap.
- Only 30% of an eligible type's capped pool is signal-controlled.
- Below five interactions, sampling is 100% random.
- M6 swaps the scorer at this exact seam at `docs/plans/m0-m1-substrate.md:338-350`.

Defensible conclusion:

- At or below every cap, the M6 scorer has no shortlisting decision and replacing the stub is behaviorally inert.
- A request also needs at least five interactions and an available trained scorer.
- The repository contains no production wardrobe histogram or request-level eligibility data. It cannot establish that eligibility is common or rare.

Required measurement:

> Before M6, measure the percentage of recommendation requests with both the interaction threshold and at least one active type over cap. If eligibility is low, add a model-controlled surface such as candidate ordering, GPT-candidate scoring, or downstream ranking.

## 8. Test Assurance Is Uneven, Not Universally Weak

**Confirmed by both reviewers with qualification.**

Copied/simulated test logic:

- `fitted/tests/contextDetection.test.ts:4-34`
- `fitted/tests/feedbackSemantics.test.ts:5-34`
- `fitted/tests/wardrobeFilter.test.ts:37-60`
- `fitted/tests/endToEndRecommendationFlow.test.ts:4-205`

These four files test local copies or contract simulations that can remain green after production drifts. The nominal end-to-end file does not call the UI, routes, Firebase, or MongoDB.

Important qualification:

- Most other test files import real production helpers or route handlers.
- The Python model/config tests directly exercise production code.
- Mocked route tests are useful contract tests, but they are not integration tests.
- Refactoring copied recommendation/Gemini tests has limited return because those paths are scheduled for replacement.

Retained-risk gaps:

- No negative-token tests.
- No cross-user ownership tests.
- Only a minority of API routes are directly exercised.
- `fitted/jest.config.js:10` collects coverage only from `lib/**/*.ts`, excluding routes/pages, and has no threshold.
- Retained wardrobe, authentication, image, interaction, and ownership boundaries need real regression tests.

## 9. Operational Contracts Are Incomplete but Phase-Dependent

**Confirmed by both reviewers. Do not present all of this as an immediate M0 blocker.**

Current tooling evidence:

- No tracked CI workflow exists.
- Neither package declares a Node engine/package manager; no repository Node/Python runtime pin exists.
- `ml-system/requirements.txt` uses lower bounds rather than a resolved lock.
- `ml-system` has no centralized Python project config, formatter, linter, or type checker.
- The Next.js app does have a lockfile, ESLint, strict TypeScript, Jest, and build/lint/test scripts.

Deployment scope:

- The legacy Next.js app is already deployed on Vercel; deployment is not wholly absent.
- Fly integration is planned for M5, so the absence of `fly.toml`, Docker/service artifacts, and a service schema is currently phase-appropriate.
- Before M5 release, the Next.js-to-Fly boundary still needs service authentication, body/schema limits, trusted-field rules, timeout/retry/idempotency behavior, API versioning, credential rotation, readiness/health semantics, and model/treatment logging.
- The current Hugging Face CV service is a separate boundary and should not be conflated with the future Fly recommender.

Timing:

> CI/runtime reproducibility is valid engineering debt now. Fly deployment and authentication contracts become blocking acceptance criteria when M5 is specified. Cross-runtime CI should exist before integration so serialization, auth, timeout, and fallback behavior cannot drift silently.

## Additional Findings From the Broad Audit

These were not part of the nine-item two-agent confirmation exercise, but remain open design-review items:

- Offline M6 evaluation needs exposure/candidate identity, positions, model/treatment version, context, and interaction-time feature snapshots; interaction rows alone are selection-biased.
- M4 needs idempotency/transaction rules for duplicate feedback, affinity updates, interaction PATCH/DELETE, concurrent caps, and wardrobe-version increments.
- The daily reseed date needs an explicit UTC or validated user-timezone contract across Next.js and Fly.
- Clear-wardrobe and user cascade paths omit some image/preference cleanup; image replacement deletes the old image before the replacement is fully committed.

## Recommended Action Order

1. Before M0-3: define key validity and ID-format contracts.
2. Before M0-4: reject duplicate assignment for every role before SlotMap construction.
3. Before M1-3: represent scorer availability and deterministic fallback behavior explicitly.
4. Continue M0-M3 without reopening unrelated legacy architecture.
5. During M4 specification: require issued-outfit feedback binding, snapshots/versioning, and idempotent derived-state updates.
6. Before retaining host infrastructure at integration: fix Firebase identity binding, image ownership, and CV inference authentication/limits.
7. During M5 specification: resolve cache stability, hard refresh, `generationIndex`, service authentication, API contracts, timezone, deployment, and cross-runtime CI.
8. Before M6: measure actual scorer eligibility and define exposure-aware evaluation.
