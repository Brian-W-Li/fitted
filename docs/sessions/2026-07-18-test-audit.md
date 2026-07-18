# Test-quality audit — 2026-07-18

Report-only audit of the live jest (`fitted/tests/`) + pytest (`ml-system/{tests,service/tests,experiments/h26/tests}`) suites. Two objectives: (1) current coverage/accuracy incl. mirror-tests and unguarded cross-runtime copies; (2) a history cover-up scan over `8b62d7e4..HEAD` (M4a C1 onward). Every finding below was verified by reading the cited source; discovery scouts were used for fan-out but no scout claim was trusted without a first-hand read.

## Summary

The suites are, on the whole, genuinely strong: the render-service contract, feedback binding, account-delete cascade/erasure, and the app-side authenticity gate are all **behavioral over real in-memory Mongo / real cross-language fixtures**, with pre-spend assertions, at-limit/limit+1 boundary pairs, and a generated single-source mirror (`service.contract` → `contract_fields.json` → `crossRuntimeContract.test.ts`) covering most cross-runtime facts. The **history scan found zero cover-ups** — every bent-shaped test change (deletions, a downward count, a reject→accept flip) traces to a documented, intentional architecture/product change and, in nearly every case, the tests were migrated and *strengthened*.

The real gaps are two: **the M6 training-export core has no automated test at all**, and **four cross-runtime facts are hand-copied outside the guard**, one of which is a textbook rule-1 mirror (a test re-implementing the unit it claims to protect).

**Headline: 3 important, 3 minor. 0 history cover-ups.**

---

## Findings (most severe first)

### 1 [important] `exportTrack2` — the M6 training-export core — has zero automated test
- **Where:** `fitted/scripts/export_track2.mjs` (the `export async function exportTrack2({db,outDir,userFilter})`).
- **Scenario → what goes uncaught:** jest `testMatch` is `**/tests/**/*.test.{ts,tsx}` (verified in `fitted/jest.config.*`); `scripts/` is never collected. The only exerciser is `fitted/scripts/track2-export-roundtrip.mjs`, which is a `.mjs` script (not `.test.`) gated behind `requireLiveOk()` / `TRACK2_LIVE_OK=1` and needs a **live** Atlas + live Next service + Firebase admin. So none of the export's pure logic runs in CI:
  - the §H61 latest-state tie-break (`createdAt`, then `_id` string compare — lines 124-131): a dislike→like→dislike sequence resolving to the wrong event silently mislabels a training row;
  - the `redacted:{$ne:true}` exclusion (line 88): a regression here leaks a **deleted friend's rows into the M6 corpus** — an erasure-promise violation that ships silently;
  - `parseImageId` accepting `mongo:` / `/api/images/` / bare-24-hex forms (lines 77-83): a drift drops every image → all training examples become image-unusable, tanking the yield readout with nothing red;
  - the training-example join (`shownCandidateIds` → candidate → `engineVisible` immutable feature copy, lines 136-176) and the yield/decidability math (`imageUsableAccepted` requires **every** item resolved, lines 191-211).
- **Fix:** `exportTrack2` takes an injectable `db`, so it is unit-testable against `mongodb-memory-server` (already a devDependency; used by the interactions/account-delete suites) with **no live creds**. Add `fitted/tests/exportTrack2.test.ts` seeding snapshots + interactions + images in memory-Mongo and asserting: latest-state collapse on a dislike→like→dislike sequence, redacted-row exclusion, image resolution (incl. one unresolved ref), and the yield-readout counts. This is the one file where the whole Track-2 → M6 bridge lives and it is the least protected.
- **Verified:** read `export_track2.mjs` in full; read `fitted/jest.config` `projects[].testMatch`; confirmed `track2-export-roundtrip.mjs` is a live-gated script (`requireLiveOk()` import) and the sole caller of `exportTrack2`.

### 2 [important] Reducer scan bounds copied TS↔Python with a self-referential test (silent-loss drift)
- **Fact:** `INTERACTION_ROWS_SCAN_LIMIT = 500`, `REPETITION_WINDOW_SNAPSHOTS = 50`.
- **Copies:** Python source `ml-system/fitted_core/reducers.py:22-23` (enforced by the service at `service/app.py`); TS copy `fitted/lib/mlBehavioralRows.ts:25-26`, whose own comment says *"mirror of reducers.INTERACTION_ROWS_SCAN_LIMIT / REPETITION_WINDOW_SNAPSHOTS."*
- **Scenario → what goes uncaught:** the TS guard `fitted/tests/mlBehavioralRows.test.ts:179,191` uses the TS constant **self-referentially** (`Array.from({length: INTERACTION_ROWS_SCAN_LIMIT + 1})` then `toHaveLength(INTERACTION_ROWS_SCAN_LIMIT)`), so if someone edits the TS const to 200 the test still passes (it slices to 200 and asserts 200). These two bounds are **not** in `contract_fields.json` `crossRuntime.clamps` (verified — the clamps set is the 12 G7 text/array caps only). A TS drift **down** silently truncates the behavioral rows the Next projection sends → lost personalization signal with a green suite; a drift **up** is caught only at runtime (the service rejects an over-bound array, `test_render_contract.py:506-507`).
- **Fix:** add both to `service.contract.CROSS_RUNTIME_CLAMPS` (they're already `cfg`/`reducers` attributes) so the existing `contract_fields.json` mirror + `crossRuntimeContract.test.ts` equality assertion extends to them.
- **Verified:** read `reducers.py:22-23`, `mlBehavioralRows.ts:22-27`, `mlBehavioralRows.test.ts:179-212`, and `contract_fields.json.crossRuntime.clamps` (12 keys, neither bound present).

### 3 [important] `GENERATOR_EXPECTATION` (11 fields) hand-copied from Python config, tested against literals
- **Copies:** TS const `fitted/lib/mlRequestAdapter.ts:53-67`; Python source `ml-system/service/config.py:37-46,64` (`GENERATOR_MODEL`/`GENERATOR_TEMPERATURE`/`OPENAI_TIMEOUT_SECONDS`/`OPENAI_MAX_RETRIES`/`DEFAULT_MAX_COMPLETION_TOKENS`, etc.).
- **Scenario → what goes uncaught:** `fitted/tests/mlRequestAdapter.test.ts:112-123` asserts `GENERATOR_EXPECTATION.model === "gpt-5.4-mini"` etc. against **hardcoded string literals**, not against the Python config. So a Python-side config change (e.g. `GENERATOR_TEMPERATURE → 0.7`) reddens nothing on the TS side — the mismatch surfaces only at runtime as a pre-spend `contract_invalid` on **every** render. Loud (so lower blast radius than #2), but per the standing rule it is an unguarded hand-copied mirror; `maxCompletionTokens` is a soft exception (env-band-coupled, could drift within-band).
- **Fix:** add a `crossRuntime.generatorExpectation` value map to `contract_fields.json` (derived from `cfg`) and assert the TS const equals it in `crossRuntimeContract.test.ts`.
- **Verified:** read `mlRequestAdapter.ts:52-67`, `mlRequestAdapter.test.ts:112-123` (literal assertions), `config.py:37-64`, and confirmed no `generatorExpectation`/`GENERATOR_EXPECTATION` key in `contract.py`/`crossRuntimeContract.test.ts`.

### 4 [minor] `deriveWarmth` warmth-band boundaries copied into the test (unguarded cross-runtime, rule 2)
- **Copies:** TS band centers `fitted/lib/deriveWarmth.ts:18-20` (`HOT=2/MILD=5/COLD=8`); Python `_warmth_band` boundaries `ml-system/fitted_core/response.py:205-216` (hot upper = 3, mild upper = 6, from `WEATHER_WARMTH_BAND`).
- **The copy:** `fitted/tests/deriveWarmth.test.ts:19` defines `const band = (w) => (w < 3 ? "hot" : w < 6 ? "mild" : "cold")` and asserts `band(deriveWarmth(...))` lands in the expected bin (lines 24-56). To be precise (correcting an earlier read): this is **not** a rule-1 mirror of `deriveWarmth` — `deriveWarmth` is the real imported unit and *is* exercised, with exact-value assertions (`toBe(5)` etc.). The defect is rule-2: the inline `band()` **hand-copies Python `_warmth_band`'s boundaries (3 / 6)** with no cross-runtime equality guard, so the test asserts warmth-binning consistency against a TS copy of the thresholds, not the real Python function. If Python's band boundaries were retuned, the TS centers would bin wrong in production while this test stays green (and a boundary drift like `HOT_CENTER → 3` would silently misclassify, since Python's `warmth < 3` excludes 3).
- **Fix:** feed the three TS centers through the real Python `_warmth_band` in a cross-runtime test (e.g. a generated `crossRuntime.warmthBandCenters` expectation) rather than the inline `band()`.
- **Verified:** read `deriveWarmth.ts:14-24`, `response.py:200-216`, and `deriveWarmth.test.ts:17-56` (the inline `band()` and its 9 use-sites). Values currently agree (2→0, 5→1, 8→2); latent guard gap, not a live bug — hence minor.

### 5 [minor] `mlSnapshotMerge.test.ts` re-implements the sha256 digest instead of calling the exported unit
- **Where:** `fitted/tests/mlSnapshotMerge.test.ts:13-16` defines `sha256Utf8(value)` as a line-for-line duplicate of the serialize-then-digest body of `capRawField` (`fitted/lib/mlSnapshotMerge.ts:344-347`), and asserts the stored hash `toBe(sha256Utf8(rawText))` (lines 41/46/52).
- **Scenario:** `capRawField` **is exported** (`mlSnapshotMerge.ts:342`) and returns the hash, so the test could call the real unit; instead it recomputes with a copy. Because both hash the *original* value, a truncation/capping bug is still caught — the blind spot is narrow: a change to the serialization convention (e.g. `JSON.stringify` key order) would move production and the test copy together and pass silently. Mild rule-1 partial mirror.
- **Fix:** assert `buildSnapshotDoc`'s stored hash equals `capRawField(rawText, cap).hash` (the real unit), deleting the local `sha256Utf8`.
- **Verified:** read `mlSnapshotMerge.ts:342-347` (exported `capRawField`) and `mlSnapshotMerge.test.ts:1-16,41-52` (local `sha256Utf8`, `capRawField` not imported).

### 6 [minor] `ROLE_TO_SLOT` mapping triplicated with no direct cross-runtime equality guard
- **Copies:** TS `fitted/lib/mlSnapshotValidation.ts:76-82` (`{base_top:"top", base_bottom:"bottom", one_piece:"dress", outer_layer:"outer", shoes:"shoes"}`); Python `ml-system/fitted_core/snapshot.py:303-308` (`_SLOT_ROLE`, inverse) and `ml-system/fitted_core/slotmap.py` (`_ROLE_TO_SLOT`) — also a same-runtime Python duplication.
- **Scenario:** `contract_fields.json` `schemaEnums.role` pins the role **value-set** but not the **mapping** — specifically that `outer_layer→"outer"` (slot name differs from the role) and `one_piece→"dress"`. TS reconstructs the slotMap from wire `items[].role` and cross-checks it against the Python-declared slotMap; a slot-vocabulary drift on either side makes TS reject valid Python snapshots on write (loud, not silent — hence minor). Whether an existing behavioral test catches it depends on fixtures using the real Python slot vocabulary; there is no direct `ROLE_TO_SLOT` equality assertion.
- **Fix:** add a `crossRuntime.roleToSlot` map to the mirror; also collapse the two Python copies to one.
- **Verified:** read all three copies; confirmed the naming divergence (`outer_layer`→`"outer"`) and that `schemaEnums.role` pins only the value-set.

---

## Objective 2 — history cover-up scan (`8b62d7e4..HEAD`)

**No cover-ups found.** Every bent-shaped test change maps to a documented, intentional change, and I verified the three that most resemble a bend:

- **`8218197e` (REQFIELDS-1)** — `wardrobeValidation.test.ts` flips `it("rejects missing type/colors")` → `it("accepts empty/missing type/colors")` / `it("ACCEPTS an item with only name + category")`. This is a genuine validation *loosening*, but it is the Fable-decided relaxation of the required set to `{name, category}` (commit + CLAUDE.md), and the tests were flipped to positive assertions of the new behavior, not deleted. **Legitimate.** (Verified: read the commit diff — reject→accept `it()` renames with matching new positive assertions.)
- **`814f8904`** — headline test-pair count changed **downward** 44,759 → 44,627 with a sha re-freeze. The commit documents it as correcting a near-disjoint count to the frozen strict-disjoint split (both have 38 recurring, coincidentally identical), fixed *before* any model number to preserve the pre-registration property. **Legitimate** — a count correction with a trap-guard, not tolerance-bending. (Verified: read the full commit message + the `data_loader.py`/`preregistration.md` hunks + the sha re-freeze.)
- **`754135a8`** — whole test files deleted (`endToEndRecommendationFlow.test.ts`, `feedbackSemantics.test.ts`, `regenerateExclusion.test.ts`) as part of retiring the legacy recommend vertical behind the `USE_ML_SHORTLISTER` cutover; behaviors migrated to the flag-ON/OFF dispatcher contract. **Legitimate** — dead code + its tests removed together. (Verified via numstat 124+/888- + the known M5 C8 half-1 retirement.)

Other checked-and-cleared: `382c494b` (H61 reducer redesign — value changes reflect the retired 300s dedup window, *adds* personalization-proof tests); `b58ebb5d`/`85e774ce` (H26 single-annotator → diverse panel, a prereg amendment); `116dca38` (run-phase guard *strengthened* from `not exists` to `after == before`). All added skips are environment gates (`skipif(not _HAS_DATA)`, `describe.skip` on absent live URI/key), never a silenced failing test.

---

## Suites checked and cleared (not findings)

- `interactionsBinding.test.ts` — behavioral real-Mongo; forged-echo → server-derived binding, ownership 404, erasure-race 401, per-user rate-limit + storage ceiling, append-only. Strong. (read in full)
- `accountDeleteRoute.test.ts` — behavioral; the string→ObjectId cascade cast (`User.ts:49-52`, the actual erasure-correctness branch) **is** exercised (a hex-string userId flows through `deleteUserWithData`→`User.deleteOne`→hook→cascade, asserting counts→0), plus cross-user isolation + phase-1/3 race arms. (read cascade source + test in full)
- `test_render_contract.py` — excellent: pre-spend `stub.call_count==0`, boundary pairs, non-finite/dup-key/surrogate/depth guards, and the generated single-source mirror covering clamps/enums/formats/wire-field-sets.
- `m4bSnapshotContract.test.ts` + `test_m4_e2e_fixture.py` — the committed Python fixture is drift-guarded by `test_committed_fixture_matches_a_fresh_build` (`committed == _build_e2e_wire()`).
- `mlRecommend.test.ts` — app-side authenticity gate (`crossCheckAuthorship`) failure paths thoroughly covered: sessionId mangle, field mutations, re-roll cacheKey change, swapped-body outfit → all `contract_invalid` degraded, no write.
- `deriveWarmth.test.ts` — clamp `[0,10]` tested as a proper pair (aside from the F4 mirror above).
- `corpusReadback.integration.test.ts:386` — `expect(size).toBeGreaterThanOrEqual(0)` is a deliberate non-assertion (comment: "instrument, not a gate"); live-gated `describe.skip`. Noted, not a defect.
- **`test_ranker.py` ranker weights — investigated and REJECTED as a finding.** A mirror scout flagged the score assertions (`config.ITEM_BOOST_WEIGHT * (5+3)` etc.) as a "coefficient blind spot" (weights supposedly unpinned). Verified false: the weights **are** pinned to literals in `ml-system/tests/test_config.py:60-69` (`BASE_SCORE==1.0`, `ITEM_BOOST_WEIGHT==0.1`, `DISLIKE_PENALTY==0.5`, `OVERUSE_PENALTY==0.5`), so a coefficient drift reddens `test_config.py`. The ranker tests import and call the real `_score_candidate`. Not a mirror. (This is why scout claims were re-read against source — the grep missed `test_config.py`.)

---

## Scope NOT covered (honest convergence)

- **Not deep-read:** `mlServiceClient.test.ts`, `renderResultGuards.test.ts`, `mlSnapshotWrite.test.ts`, `mlSnapshotMerge.test.ts`, `test_render_flow.py`, the full 16-file h26 pytest suite (beyond the skip scan + the two flagged commits), `wardrobePostIngestion`/`wardrobeEditIngestion` (behavioral-vs-mock quality), `recommendationStability.test.ts`, `contextDetection.test.ts`.
- **Not run:** report-only — I did not execute the suites or re-verify the ~1091 pytest / ~690 jest green floors.
- **Cross-runtime:** I confirmed the four unguarded facts above and that the generated mirror covers the 12 clamps / enums / formats / schemaEnums / wireBoundaries; I did not exhaustively diff every field of every wire boundary by hand (the `test_canonical_render_body_fixture_matches_the_contract` + `_every_required_field_is_enforced` pair makes that low-risk).
- **History:** I verified the three highest-signal commits first-hand; the remaining ~189 commits were triaged by numstat + the git scout's hunk-level pass rather than each read in full.
