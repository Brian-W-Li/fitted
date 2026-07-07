# C1+C2 review punch list — 2026-07-06

> EXECUTED 2026-07-06 — every item implemented by Codex and independently re-verified
> (source reads + empirical mutant re-runs). Kept as the review record; see
> `2026-07-06-m5-c1-c2-build.md` for the session note.

Fresh-context multi-lane review of the uncommitted M5 C1/C2 work (fitted_core generalization +
reducers) plus a coherence audit of `docs/plans/m5-cutover.md`. Every item below was verified
against source, not inferred. Line numbers are as of this review — **re-verify before editing,
they drift.** Suite baseline: 804 pytest passed.

Verdict: no crash-class defects; code is structurally sound and golden byte-identity holds.
Blocking items are small and precise. Suggested sequence: Part A + Part B together as the C1/C2
close-out commit; Part C as its own spec commit **before C3 starts**.

---

## Part A — code fixes (blocking the C1/C2 commit)

### A1. BLOCKER — reducers read the wrong wire field: `itemIds` → `items`
- `ml-system/fitted_core/reducers.py:146` reads `row.get("itemIds")`.
- The pinned §H projection (`m5-cutover.md` ~line 750) and the Mongo schema
  (`fitted/models/OutfitInteraction.ts:26`) both say the field is **`items`**.
- `tests/test_reducers.py` hardcodes `"itemIds"` in every fixture row, so the suite is green
  while a spec-conformant C3 service passing `items` would produce a silently empty affinity
  map — the personalization seam never opens.
- Fix: change the reducer to `row.get("items")` and update every test fixture in the same edit.

### A2. IMPORTANT — action-mapping constants are excluded from the REDUCER_CONFIG_VERSION digest
- `reducers.py:27-28`: `_COUNTED_ACTIONS` / `_REJECTED_ACTION` are underscore-prefixed, so the
  digest filter (`not name.startswith("_")`, line ~52) skips them — yet they encode the §H
  action→signal mapping, the most load-bearing reducer config. Evidence it's a slip:
  `_canonical_for_digest`'s frozenset branch is dead code unless these frozensets were meant to
  be hashed (all currently-hashed constants are ints).
- Failure: promoting `saved`/`worn` to counted later (§H line ~746 explicitly anticipates this)
  forks corpus affinity semantics under a byte-identical `reducer_config_version`.
- Fix: rename to `COUNTED_ACTIONS` / `REJECTED_ACTION` (public, digested). Add a test asserting
  an action-set mutation moves the digest (see B7).

### A3. IMPORTANT — `MODEL_PRICING` missing the new default model
- `ml-system/fitted_core/evaluation.py:298-304` has no `gpt-5.4-mini` entry while
  `cli.py`'s default model is now `gpt-5.4-mini` → a default real eval run silently reports
  `est_cost_usd=None` (the §E $/render telemetry vanishes, no error).
- Fix: add `"gpt-5.4-mini": (0.75, 4.50)` — verify current rates at the OpenAI pricing page
  before committing.

### A4. DECISION+FIX — daily `n_surfaced` hard-raise contradicts the spec letter
- `rescue.py:155-156` raises when `intent="daily"` and `n_surfaced != N_SURFACED`; spec §B
  (~line 278) says the pin is decided **but** "the field stays request-settable if the product
  call changes".
- Review lean (adopt unless Brian overrides): **drop the raise** — the dataclass default of 3
  already implements the pin; the raise adds nothing but a coupling to rescue's shared
  `N_SURFACED` constant (tune rescue's later and daily's pin silently moves).
- Whichever way: reconcile code and spec sentence in the same pass (conflicts are bugs).

### A5. IMPORTANT — daily drops carry rescue-branded, append-only provenance
- Daily StyleMove drops are recorded with `drop_reason="rescue_stylemove_invalid"`
  (`rescue.py:~991`) and producer `drop_stage="rescue"` (`snapshot.py:~307`) on
  `intent="daily"` payloads (runtime-confirmed). The dropStage/dropReason code sets are OPEN,
  append-only (`GenerationSnapshot.ts:107`) — this taxonomy freezes at the first live write (C5).
- Fix: introduce an intent-neutral code (e.g. `stylemove_invalid`, stage `render`) used by the
  daily path now, **keeping rescue's existing codes byte-identical on the rescue path** (golden
  corpus must not shift). If instead the shared-code naming is kept deliberately, record that
  decision in the spec §B.

### A6. NIT — stale PROMPT_VERSION policy comment
- `ml-system/fitted_core/config.py:152-154`: the comment still says rescue's two builders are
  "the only prompt builders today" — false since `_build_daily_system_prompt` /
  `_build_daily_user_message` landed. The comment IS the guardrail against the silent failure
  it names (forgetting to bump on a prompt edit).
- Fix: update the comment to name all four builders. Note the standing policy: one shared
  `PROMPT_VERSION` covers both intents' prompt texts (conservative-safe; `intent` in the
  payload disambiguates). If per-intent versions are wanted instead, that's a spec change —
  don't do it silently.

### A7. DECISION+FIX — the validator depth guard is un-specced and untested
- `ml-system/fitted_core/validator.py`: new `MAX_JSON_NESTING_DEPTH=512` +
  `_exceeds_max_json_depth` on the closed M2 module. No spec sentence asks for it; no test
  touches it (disabling it survives the suite). It IS genuinely useful — it covers hostile
  depths between ~513 and the interpreter recursion limit that previously parsed and leaked
  into downstream validation.
- Review lean: **keep it** — add the test (B8) and one sentence to the m5-cutover §A
  service-side bounds noting the engine-side depth guard. If not keeping, revert the
  validator.py change entirely.

---

## Part B — test additions (spec acceptance gaps + surviving mutants)

Empirical basis: mutation testing was run against the suite; every "survives" below was
demonstrated, not guessed.

1. **BLOCKER (§B acceptance):** render with `AffinitySignalScorer({})` (and separately with a
   non-empty scorer + `interaction_count < MIN_SIGNAL_THRESHOLD`) and assert the sampler output
   is **byte-identical** to the cold-scorer run. Currently missing entirely; the R11
   availability-vs-count contract is unproven at the sampler level.
2. **BLOCKER (§H acceptance):** feed `> INTERACTION_ROWS_SCAN_LIMIT` rows and assert rows past
   the bound contribute nothing. Deleting the `islice`/slice survives the current suite. Same
   for the `REPETITION_WINDOW_SNAPSHOTS` bound in `reduce_snapshot_rows` (>50 rows).
3. **IMPORTANT:** malformed-StyleMove drop on the **traced** daily path
   (`_render_daily_with_trace`) — the C3 service's actual snapshot path. No-op'ing the drop
   there survives today. Mirror the existing untraced test; also assert the drop lands in
   `rescue_drops` and the resulting payload.
4. **IMPORTANT:** honest partial — in the existing daily drop test (1 survivor < 3), assert
   `insufficient_after_generation is True` and `reason_hint` is the insufficient hint. One free
   assertion.
5. **IMPORTANT:** asymmetric dedup fixture — the current 3-row window test passes with the
   comparison flipped. Add a fixture where flipped logic yields a different count.
6. **IMPORTANT:** `assert "ignored" not in shown` in the `nSurfaced > 0` filter test — the
   filter is currently vacuously tested (removing it survives).
7. **IMPORTANT:** pin the exported constant: `assert reducers.REDUCER_CONFIG_VERSION ==
   _compute_reducer_config_version()`; assert the (renamed, A2) action-set constants move the
   digest; add residency asserts (`assert not hasattr(config, "INTERACTION_ROWS_SCAN_LIMIT")`
   etc.) so the constants-migrated-to-config.py mutant dies.
8. **IMPORTANT (with A7):** depth-guard boundary test — 512-deep accepted, 513-deep rejected
   as `invalid_json` via the guard (runtime-probed values; verify at test time).
9. **NITS:** daily `n_surfaced` pin (if A4 keeps the raise); a literal `worn` row contributing
   nothing; `COOLDOWN_BUFFER_SIZE` / `DISLIKE_WINDOW_SIZE` caps; missing-`createdAt` dedup
   semantics (treated always-duplicate — pin it as deliberate, see C-nits); `interaction_count`
   bool/negative guards; one direct §6.5 shape assert on `result.variants` in the daily
   success test.

---

## Part C — spec edits (`docs/plans/m5-cutover.md`), own commit before C3

### C-B1. BLOCKER — `sessionId` is absent from the entire wire/adapter contract
- The §A request JSON (lines ~177-200) carries no session/user identifier, yet
  `RenderRequest.session_id` is required, `build_snapshot_payload` requires it, it is the FIRST
  field of the §C.1 `candidate_cache_key`, and D2's "same Lens → same sampled pool" promise
  requires a re-roll to reuse the parent's.
- Fix (three small edits): add `"sessionId"` to the §A wire request (pin: = the user id per R8,
  `GenerationSnapshot.ts:261`, derived by Next from the verified token — never client-supplied);
  add a §F Lens-adapter row; add `sessionId` to §C.1's derived-from-parent list.

### C-B2. BLOCKER — no checkpoint plumbs the §H reducer outputs into the ranker
- §A (~139-141) says the service runs the reducers "to build the RankerContext signals"; §E
  persists those collections at C4 — but `render()` accepts only `signal_scorer`,
  `_build_ranker_context` builds every behavioral collection empty (untouched by C1), and no
  ladder entry owns the plumbing. As specced, the behavioral layer (repetition window —
  which D2's regenerate design leans on — dislike-invalidation, comboBoost) ships permanently
  cold with all tests green.
- Fix: pin a `behavioral_signals: Optional[BehavioralSignals] = None` param on
  `render`/`render_with_trace` flowing into `_build_ranker_context` (defaults preserve golden
  byte-identity), assign it to a checkpoint (natural home: a small C2b/C4 item in fitted_core),
  and add an acceptance case (a repetition-window signature present in `behavioral_signals`
  measurably penalizes a matching candidate end-to-end).

### C-I1. IMPORTANT — §C.1 derived-from-parent list omits `intent` and `forcedItemId`
- Lines ~364-366 derive only occasion/weather/weatherRaw/location/constraints/seedDate. Both
  omitted fields are `candidate_cache_key` inputs and engine-behavior inputs; §F's
  dispatch-on-`forcedItemId`-presence rule applied to the pinned regen body
  `{requestId, parentSnapshotId, controls}` classifies EVERY rescue re-roll as daily.
- Fix: add `intent` + `forcedItemId` to the derived-from-parent list; note the child inherits
  the parent's intent verbatim.

### C-I2. IMPORTANT — caller-bug vs internal-failure classification has no pinned mechanism
- §D classifies guard-raises/duplicate-ids as caller bugs (no snapshot), but as landed they
  fire mid-`render()` alongside genuine internal failures. Two concrete traps: (a) the wire
  pins two intents while `RenderRequest` accepts four and `render()` raises
  `NotImplementedError` on the other two — uncaught, that's a degenerate corpus row for a
  caller bug; (b) a rescue re-roll after the forced item was deleted from the live wardrobe
  raises mid-pipeline (§C.3 preflights *locked* items but not the *forced* item).
- Fix: pin that the service pre-validates the request (intent ∈ implemented set; forced item
  present in wardrobe for rescue; RenderRequest construction inside the pre-validation
  boundary) and returns `contract_invalid` / stable 400 pre-generation; add the
  missing-forced-item case to the §C.3 preflight list.

### C-I3. IMPORTANT — behavioralRows pass-through serialization unpinned
- Reducers read wire-camelCase keys verbatim and require string ids / ISO dates; every other
  boundary uses the snake↔camel serde. A C3 implementer applying the serde convention — or
  passing raw lean docs (ObjectId/Date objects) — zeroes every signal silently.
- Fix: one pinned sentence in §A/§H: behavioralRows pass to the reducers **verbatim camelCase,
  no serde conversion; Next serializes ObjectId→hex string and Date→ISO-8601 (JSON.stringify
  defaults) before the POST; numeric epoch forms are NOT supported.** Consider also deleting
  the reducer's numeric-epoch branch (`_parse_created_at` seconds interpretation) — a
  JS `Date.getTime()` milliseconds value would shrink the dedup window 1000×, silently.

### C-I4. IMPORTANT — `max_completion_tokens` cap has no value and no config home
- Required provenance (§G `required: true`) and the H60 spend bound, but "900" is illustrative,
  no Appendix-B constant exists, the open-questions list doesn't name it, and the landed
  generator defaults to **uncapped** (`generation.py`: `max_completion_tokens=None`).
- Fix: pin the value + home (service config/env, single source of truth) and add it to the C3
  deliverables/acceptance explicitly.

### C-I5. IMPORTANT — no service-side pre-spend weather/occasion validation
- §A's service-side bounds are length/size clamps only; the Mongoose weather enum would reject
  a drifted raw-weather value **after** the GPT call — money spent, no corpus row.
- Fix: add weather-bucket membership + non-blank occasion to the §A service-side input
  validation (`contract_invalid`, pre-generation).

### C-I6. IMPORTANT — duplicate-`requestId` winner-response reconstruction unpinned
- On E11000 the loser "returns the winner's shown set" — which must be rebuilt from the stored
  `candidates[]`, a second hand-rolled candidate→§6.5 mapping with no golden (the exact class
  the §A `variant_to_wire` pin exists to prevent).
- Fix: pin the reconstruction source (stored candidates + itemSnapshots, same hydration helper
  as the live path) and add a shape-equality acceptance (retry response ≡ winner response).

### C-nits (fold into the same spec pass)
1. Absorb landed shape into §B: `RenderRequest` is an alias of `RescueRequest`; `render`
   dispatches TO `rescue` (not wrappers-over-render); daily prompt builders live in
   `rescue.py` (C1 touches line says `generation.py`).
2. Line ~496: parenthetical says "`$exists` never matches" — the pinned filter is
   `$type:"string"`; the exact confusion the spec trap-guards elsewhere. Fix the name.
3. §Verification re-dispose list (~line 1177) names 11 holes; §J disposes ~24 — sync the lists
   (H7/H8/H10/H11/H19/H29/H45/H54/H55/H59/H60 absent from Verification).
4. v2 §20's M5 row lists "H13 cross-runtime CI green" as an ENTRY prereq; the plan builds that
   CI at C8 — extend the scheduled §20-row rewrite to the entry-prereqs sentence.
5. C2's inherited "a fetch asking beyond the limit fails" acceptance can't exist until C5;
   reword per checkpoint (C2 = the reducer slice bound; C5 = the fetch bound).
6. Pin the dedup missing-`createdAt` semantics as deliberate (always-duplicate,
   fail-closed under-count).
7. §H "last COOLDOWN_BUFFER_SIZE" wording vs the landed distinct-N dedup of cooldown baseKeys
   (strictly wider coverage; ranker is set-membership so never narrower) — pin the distinct-N
   semantics in the spec wording.

---

## Verified clean (do not re-litigate)

Daily short-circuit trace shape matches §B exactly (sampler pool populated even at
`candidate_requested == 0`); traced/untraced daily siblings result-equal on all four shapes
(runtime-probed); snapshot payload builds + serde-round-trips for both daily shapes; RNG/
determinism clean (fresh seeded RNG per call; seed excludes interaction_count/intent); all 33
`RescueRequest(` construction sites survive the new validation; golden byte-identity holds
(fixture diff = two version constants only); ranker consumers are membership-only so reducer
ordering can't flip results; window bounds match the ranker guards exactly;
`AffinitySignalScorer` satisfies the `SignalScorer` protocol; §G.1 field-ownership table
matches landed `snapshot.py`; all spec schema line-pins verified against the TS models.
