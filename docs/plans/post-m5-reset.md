# Post-M5 reset — the trust-restoration campaign

> **COMPLETED 2026-07-16.** R0 + Session B + Track 1 all executed (per-item DONE markers inline);
> off the default reading list; kept as the campaign reference. Original 2026-07-08 shaping context
> follows.
>
> Status: **SHAPED + ready to execute (Brian, 2026-07-08).** Precondition MET — M5 is complete
> (C8 half-1 + half-2 validated locally; [[project_m5_c8_2026_07_08]]) and was built behavior-first
> (the test-Mongo harness + D-1/D-2 round-trip guards landed at C5 — `generationSnapshotRoundTrip.test.ts`;
> so §4's top-2 silent-break risks are already CLOSED, and the inventory below needs a refresh against
> the now-live post-C8 code as the campaign's first act).
>
> **Mission (Brian's framing).** The repo should read top-down — **ambition → the v2 spec → the smaller
> docs → code → tests**, each current, consistent, and right-sized. Today it isn't: docs are stale / out of
> order / oversized, and — the ROOT cause — **decisions have no order or process**, so implementations keep
> shipping latent issues (behavioral bugs, omissions; the commit history is a trail of "found another one"),
> eroding trust even in the core specs and their relationship to everything else. Failure modes to hunt and
> kill: **stale tests asserting decided-against behavior; green-washing** (a session under-reads context and
> flips a test to match broken code — asserting the *opposite* of the intended behavior just to go green);
> **silent omissions**. Restore the hierarchy of trust AND fix the decision process so it stops recurring.
> **Constraint: NO NEW DOCS.** Consolidate into existing homes, delete, right-size — adding files IS the disease.
>
> **Audit method: combined Codex + Claude, cross-model ([[feedback_cross_model_review]]).** Every
> diagnostic/verification pass runs BOTH a Claude heavy multi-lane audit (parallel subagents on distinct
> lanes + a Fable synthesis for merit/design calls) AND a Codex pass on the same scope (Brian-run, or a
> scoped prompt this session emits for him to run and fold back), then reconciles the two ledgers —
> un-anchored eyes catch the author's blind spots, and absence-shaped defects need framing-free reviewers.
>
> **Step 0 (sequencing): decide whether to merge M5 → `main` first** (the branch is ~23 commits ahead).
> Recommended: merge, so the codebase-wide reset + the doc "military reset" (R4) reconcile against the
> canonical trunk, not a feature branch.
>
> **Bloat is measured, not vibes:** `m5-cutover.md` is ~2,260 lines (CLAUDE.md's compaction ceiling is
> 1,500); `docs/sessions/` is ~43 files / ~5,000 lines; `docs/plans/` ~12 files / ~7,400 lines. R4 owns the cut.

## 1. Why this exists — the diagnosis

The repo's tests are **unit-only**. Nobody ever scaffolded the test pyramid (unit → integration →
end-to-end/behavioral). Unit tests assert *shape against hand-written fixtures*: they pass whenever the
fixture matches the code, and say nothing about whether the *real other side* agrees or whether the
*behavior actually happens*. That is precisely how this codebase repeatedly shipped a **green suite over a
broken/drifted seam** (the `itemIds`/`items` dead affinity seam; `sessionId` absent from the wire; the
behavioral layer shipping cold). Every prior correction session — and the 2026-07-08 contract-cure commit
`c1787f7b` — was a *shape* bandaid on a *behavioral* disease.

Proof it's structural, not cosmetic: a 2026-07-08 sweep catalogued **~35 cross-layer/cross-runtime drift
surfaces** (places one fact lives in ≥2 hand-maintained representations); **~22 are fully unguarded**
(divergence → green suite). Two are **confirmed live data-loss defects** that *no* unit/shape/`validateSync`
test can catch — only a behavioral round-trip (write→read a real Mongo doc) does. See `m5-cutover.md` §J
D-1/D-2 and the inventory in §4 below.

Second, orthogonal problem Brian raised: **legibility.** As the codebase grows, holding it in one head (or
one LLM context) degrades — which itself causes the hasty, partial fixes. The ~35 drift surfaces are also
~35 duplications, so collapsing them cuts *both* drift and cognitive load. Legibility is a first-class reset
goal, not a nicety.

## 2. The principle (what replaces the bandaids)

**Behavioral integration tests derived from the ambition are the cure.** Each user-observable promise the
ambition makes gets ONE end-to-end test across real boundaries (real Mongo round-trip, real service call).
That is O(behaviors), not O(field-pairs), it's anchored to the ambition (not the code-as-built), and it
catches drift in *any* layer because it asserts the observable outcome. Shape/conformance pins (incl. the
committed `contract.py`) are **demoted to localizers** — they tell you *which* field drifted after a
behavioral test fails; they are not the guard.

Hard constraint: **you can't retrofit this onto unbuilt code.** The TS integration surface (request builder,
Mongo projection, response consumer, snapshot writer) doesn't exist until C5; there is no test-Mongo harness.
So the behavioral suite is a **C5-forward discipline** + one enabling investment (a `mongodb-memory-server`-
style harness). M5 must be finished behavior-first before the whole-codebase reset.

## 3. Proposed reset (multi-session, each with a goal) — PENDING BRIAN

Precondition **MET** (M5 done; harness + D-1/D-2 guards landed at C5 — see banner). As separate goaled
sessions (each a combined Codex+Claude audit per the banner method):

- **R0 — Diagnostic refresh (do first; DIAGNOSE, don't fix; NO new doc).** Re-verify the state against
  now-live post-C8 code (the §4 inventory predates C5–C8: legacy retired, D-1/D-2 guarded, one integration
  smoke exists) across three tracks — code drift, test trust (stale / green-washed / fake-mirror suites),
  doc bloat + conflict. Combined Codex+Claude; every finding source-verified. Output: **update §4 of THIS
  doc in place** with the current, deduplicated, severity-graded findings + a proposed session-by-session
  order. No separate ledger file.

- **R1 — Legibility / architecture map.** A concise "how the whole system fits together" doc + reading order;
  identify the sprawl and the legacy/v2 dual-arm to retire post-cutover. Goal: the codebase is digestible in
  one pass. (Do this first — it makes R2–R4 cheaper and safer.)
- **R2 — Test pyramid + behavioral suite.** Formalize the harness; write the ambition-derived behavioral
  integration/e2e tests (one per promised behavior); establish the pyramid as standing policy. Goal: every
  ambition promise has a behavioral guard; most of the 35 shape surfaces become non-load-bearing.
- **R3 — Structural de-duplication.** Collapse the drift surfaces (single source of truth / generate-not-
  mirror where warranted; retire the legacy path). Goal: fewer representations → less drift AND less
  cognitive load.
- **R4 — Doc "military reset."** The ambition↔code↔docs bidirectional reconciliation, run against the now-LIVE
  behavior (not paper); compact `m5-cutover.md` (<1500) and the spec. Goal: docs state current verified truth,
  conflict-free, small.

Sequencing rationale: legibility first (so I can hold it), then the behavioral safety net (so de-dup is safe),
then de-dup, then the doc reset against a system that's both live and legible. Interleaving R2/R3 is fine.

## 4. R0 verified findings (2026-07-09) — the current state

Re-verified against now-live post-C8 code (M5 merged to `main`; every finding opened at `file:line` by
Claude — four claim-verification lanes + a Fable calibration seat + an adversarial code-first break-it pass
emulating independent cross-model error-hunting, run in-session since Codex is unavailable). **The headline: the
2026-07-08 alarm (~35 surfaces / ~22 unguarded / 2 data-loss defects) does not survive verification** — its
specific items (D-1/D-2, the "unrenderable" top-5) were closed by C5–C8 *while being built*. **But the
adversarial break-it pass then found NEW defects the four claim-lanes structurally could not — including one
blocker (§4.1b B1) and three important-grade holes.** That is the load-bearing lesson: claim-verification
(does the stated guard exist?) and code-first fault-injection (construct an input that breaks it) find
*different* bug classes — the split is exactly why R2's behavioral suite is worth building. Net: the old alarm
was stale, but the diagnosis is NOT "all clear" — the adversarial pass found real defects. **Per Brian's
"find an issue, fix an issue," the blockers + several importants were FIXED in this R0 session (§4.5), each
with a behavioral test + a fresh-eyes review pass (0 findings); the remainder is registered for the reset
sessions.** Floors grew: pytest 1060→1072, jest 516→522.

### 4.0 Closed by verification — the alarm, retired
- **D-1 `engineFailure` + D-2 `controls`** (the two "confirmed data-loss defects"): **CLOSED**, both backed
  by a real write→read behavioral guard over in-memory Mongo (`generationSnapshotRoundTrip.test.ts:113-192`,
  `mongoHarness.ts`). Payload↔schema is 27/27 fields; no new drop found.
- **"service clamps vs absent Mongoose `maxlength` → closet permanently unrenderable"** (top-5 #3, the
  scariest): **STALE for the length fields** — the C5 adapter *sanitizes* name/tags/imageUrl
  (`mlRequestAdapter.ts` `sanitizeTags`/name-slice/over-cap-`imageUrl`→`""`). **But the unrenderable failure
  mode itself is NOT fully closed** — the adversarial pass found the same "one bad row → whole closet
  degraded" shape survives for the *unsanitized* fields (clothingType/warmth/scalar-colors, §4.1b A-cluster).
- **`keys.py`↔`app.py` key-safe id** (top-5 #5): **moot cross-runtime** — key validation is Python-only
  (`app.py:212`); the TS side mints zero keys (grep empty). No mirror to drift.
- **clothingType unknown→`"top"`** (top-5 #4): still present (`clothingType.ts:25-29`) but **intentional**
  (deployed-parity default, W-track-deferred), not silent corruption.
- **Test trust NET-IMPROVED at the merge**: all 4 deleted tests were **replaced** by real behavioral tests
  (3 were themselves fake inline-mirrors of the overturned re-rank/disliked-filter logic).

### 4.1 Code / test residuals (verified) — small, real
- **[important] T1 — `wardrobeFilter.test.ts:37-60` is a fake inline-mirror.** Local `applyPipeline()`
  reimplements the wardrobe filter/search/sort; never imports `page.tsx` (no exported pipeline exists), so a
  regression can't redden it. Display-only, no data risk. → fix (extract + import real unit) or delete.
- **[important] C1 — adapter↔service numeric clamps hand-duplicated, unpinned.**
  `mlRequestAdapter.ts:71-78` mirrors `config.py:87-91` (name/tag/tag-count/imageUrl caps); values match
  today, no equality test. Loosen an adapter cap without the service → the service rejects the *whole* render
  `contract_invalid`, degrading that closet. → cross-runtime equality test.
- **[important] C2 — cross-runtime format regexes hand-duplicated, unpinned.** ObjectId/UUIDv4/ULID/seedDate
  patterns live independently at `app.py:74-79`, `GenerationSnapshot.ts:315-316`, `mlRequestAdapter.ts:229`,
  `interactions.ts:41`; byte-identical today, nothing asserts they match. → equality test.
- **[important] C3 — the round-trip guard is defect-specific, not class-closing.**
  `generationSnapshotRoundTrip.test.ts:201-218` asserts only the `generator` block survives; the
  candidate/diagnostics body is written but never survival-asserted. The whole "no new data-loss" claim rests
  on this one test being a *fence*. → extend to full-payload assertion (cheap; upgraded from minor per Fable).
- **[minor] C4 — enum value-set mirrors self-consistent but cross-runtime-unpinned:** weather, intent
  (schema is a superset), optionPath/risk, clothingType, Role, action — each validated per-runtime, none
  asserted TS==Python. The `ENGINE_FAILURE` vocab is the one correctly three-way pinned (the model to copy).
  → fold equality tests into C1/C2's file where cheap.
- **[minor] C5 — generator `timeoutSeconds`/`maxRetries` schema-`required` but Python omits when `None`**
  (`GenerationSnapshot.ts:383-384` ↔ `snapshot.py:843-846`); not live (config pins finite values). → note only.

### 4.1b Adversarial break-it findings (verified) — what the claim-lanes missed
Code-first fault-injection on the M5 trust boundary + data-integrity + reducer paths. Every one re-opened at
`file:line` by me after the agents reported.
- **[blocker, latent] B1 — `engineVisible` numerics are never validated; `±Infinity` persists into immutable
  training truth.** `validateSnapshotPayload`'s itemSnapshots loop (`mlSnapshotValidation.ts:205-210`) checks
  only `itemId`; it never inspects `engineVisible`. `warmth` is `{ type: Number, required: true }` with no
  bound (`GenerationSnapshot.ts:219`). Mongoose rejects `NaN` (CastError) but **stores `Infinity` silently**
  (empirically confirmed) — `warmth` is the live ranker feature, so a non-finite value poisons the corpus M6
  will train on. Latent today (warmth is keyword-derived at a controlled ingestion path, zero users) but the
  validator is the *sole* guard and has the hole. → validate `engineVisible` numerics (finite + `warmth ∈
  [0,10]`) in the helper; regression fixture = a payload with `warmth: Infinity`.
- **[important] B2 — `scoreTrace.rankerScore` escapes the finite check when there's no breakdown.**
  `validateScoreTrace` early-returns at `:126` (`if (!trace.scoreBreakdown) return;`); `rankerScore` is only
  checked at `:133`, inside the with-breakdown branch. compat/vis ARE guarded breakdown-less (`:122-123`) —
  the asymmetry is the bug. → move the finite check ahead of the early return.
- **[important] B3 — `scoreTrace.signalScore` is validated on no path at all** (`:117-138`) — and it's the
  reserved slot for the M6 scorer's output (the literal label M6 consumes). `Infinity` persists unguarded on
  both sides. → add a finite check.
- **[important] A-cluster — one malformed wardrobe row makes the WHOLE closet unrenderable. [FIXED §4.7]** The
  adapter's stated intent ("sanitize so one bad row can't break the render") is only half-applied: `clothingType`
  is passed through raw (`mlRequestAdapter.ts:179` → the service rejects the whole render on a stale/undefined
  value), while a bad `warmth` (`:170-172`) or a scalar `colors` (`sanitizeTags:138`) *throws* — and
  `projectWardrobe:198` is a plain `.map`, so any one throw kills all items. All three are plausible on
  CV-derived / legacy / user-edited data. → per-item resilience (fail or drop only the bad row, not the
  closet); test = several good items + one bad-`clothingType`/`warmth`/scalar-`colors` row.
- **[minor, latent] C1 — `accepted` + `perItemFeedback:[{itemId:X, disliked:true}]` gives X `+1` affinity
  and records no dislike.** The reducer's accepted branch (`reducers.py:133-136`) grants affinity and
  `continue`s, never reading `perItemFeedback` (read only in the rejected branch, `:148-160`); the route
  (`interactions.ts`) accepts `perItemFeedback` on any action. Unreachable from today's UI (dislikes post
  `action:"rejected"`), so latent. → route rejects per-item dislikes on a non-rejected action, or the reducer
  honors them.
- **[sub-minor, noted]** cross-candidate BaseKey cooldown is a recency window, not latest-state (a just-liked
  silhouette can stay cooled, `reducers.py:138-146`); same-millisecond latest-state relies on `_id`
  monotonicity that isn't guaranteed across serverless instances (`reducers.py:108-127`). Both effectively
  unreachable via the live UI; recorded, not scheduled.
- **Verified CLEAN under attack (convergence evidence, worth stating):** feedback binding is **not
  spoofable** — `{items,baseKey,fullSignature,occasion}` are re-derived server-side from the `{_id,user}`-
  scoped snapshot, never client-echoed; a cross-user snapshot 404s; a candidate must be in `shownCandidateIds`
  *and* `candidates`. **Append-only holds** (production writes are `.create()`-only, no update/delete/upsert in
  `fitted/lib` or `mlRecommend.ts`). `mlServiceClient` is robust (non-200 never parsed as success;
  timeout/abort/malformed-JSON all fold to `service_unavailable`). Repetition window has no off-by-one.

### 4.2 Doc residuals (verified) — the bulk, and the top of the hierarchy
- **[blocker: misleading truth] D1 — `CLAUDE.md` "Current focus" says M5 is "mid-build, C5 next / C1–C4
  landed."** M5 is C1–C8 done. The **root of the ambition→spec→docs→code hierarchy is stale**; every session
  bootstraps from it. → rewrite to "M5 C1–C8 done (cloud deploy deferred); next = post-M5 reset."
- **[important] D2 — Spec §23 `H7:1230` / `H8:1231` / `H61:1284` still read "→ implement at Cn" though
  shipped** (H61 live at `reducers.py:82-117`). → flip to IMPLEMENTED (Cn) + code cite. This is the exact
  process failure §4.3 names.
- **[important] D3 — `m5-cutover.md` is unmarked-completed, 2261 lines, and carries a stale precedence
  clause** ("this plan wins until the spec rewrite lands" — the rewrite landed: spec §15 = "no runtime cache
  — D2"). → `> COMPLETED` banner + delete the clause. **Retiring exempts it from the length standard — do
  NOT spend a session compacting a doc nobody re-reads** (git is the archive); rehome only its ~5 forward
  trap-guards (⚠ C5 mirror obligation, ladder-sequencing invariant) if they aren't already live in the spec.
- **[important] D4 — Spec §23 resolved-hole rows carry review-history narrative** ("Codex read …",
  "Fable-reviewed …"); spec is 1393/1500, near the compaction trigger. → trim past-oriented provenance
  opportunistically while flipping D2; keep trap-guards.
- **[minor] D5 — `post-m4-readiness.md` completed/superseded, unmarked.** → `> COMPLETED` banner.
- **[minor, measured] D6 — 43 session notes (5082 lines) / 12 plans (7433).** Session notes are write-mostly
  by design (leave them); completed plans already carry banners except D3/D5. → no dedicated session.

### 4.3 Process root cause (Brian's real target) — proposed as CLAUDE.md edits, NOT a new doc
Recurrence mechanism, verified in the findings above: (i) decisions recorded as "→ implement at Cn" never get
flipped when Cn lands — no definition-of-done closes the loop (D2 is the live example); (ii) cross-layer facts
(enums/clamps/regexes) get hand-copied into N places with no single-home-or-equality-test rule (C1/C2/C4);
(iii) some tests reimplement logic inline (T1). **Fable's sharpening (adopted): do NOT add a 4th prose rule** —
CLAUDE.md *already* says "conflicts are bugs / single-home" and the staleness happened anyway; prose enforced
by discipline dies under context pressure, steps in the executed build-and-audit loop survive. Propose:
- **P1 (the one highest-leverage change) — wire decision-status closure into the per-checkpoint
  definition-of-done:** a checkpoint isn't done until a grep for its checkpoint/hole ID across docs returns
  **zero forward-looking statements** ("→ implement", "Cn next"). Mechanical step, not a virtue to remember.
- **P2 — cross-layer-fact rule that compiles to a test:** a fact that must agree across runtimes gets a
  single generated source OR a cross-runtime equality test in the *same* checkpoint that introduces the copy.
- **P3 — test-reality rule that compiles to a test:** a test imports and exercises the real unit; inline
  reimplementation (a "mirror") is prohibited.
- **General principle to write down:** rules that compile to CI-shaped artifacts survive; prose rules
  enforced by discipline don't.

### 4.4 Proposed execution order — REVISES the §3 R1–R4 arc (pending Brian's shaping)
Fable's calibration: the campaign was sized to the alarm; the alarm's root cause ("unit-only pyramid") was
substantially cured *during* C5–C8 (the behavioral harness + real-Mongo tests exist; fake tests replaced;
feedback→output proven). **Collapse five sessions to two, and cut the rest:**
- **Session A (short; do first — merge gate already satisfied):** D1 CLAUDE.md rewrite + D2 §23 status flips +
  D4 narrative trim + D3 m5-cutover banner/clause + D5 banner + the P1–P3 process edits. Cheap, top-of-
  hierarchy, load-bearing for everything downstream — doc-truth first.
- **Session B: EXECUTED 2026-07-16 — see §4.7.** The code/test residuals NOT already fixed in R0 (§4.6) — the
  **A-cluster** per-item resilience (after its Fable read), **W2-4a** interactions rate limit, and the
  test-hardening batch (T1 wardrobeFilter + C1/C2/C4 equality tests + C3 full-body round-trip). The blockers
  (B1/B2/B3, W2-2a/2b, W2-3a) + W2-1a + C1-reducer were already fixed (§4.5).
- **CUT — R1 (standalone legibility map):** a map that lives anywhere is a new doc in disguise (violates the
  hard constraint) and goes stale. Legibility is delivered *as* the CLAUDE.md hierarchy fix (Session A).
- **CUT — R3 as a session:** cross-runtime facts mostly can't cheaply share a source; equality tests are the
  correct tool and land in Session B.
- **CUT — R4 heavy compaction:** retire `m5-cutover.md` with a banner (D3) instead of compacting it; trim §23
  opportunistically (D4); leave the session notes.

### 4.5 Fixed in this R0 session (2026-07-09) — verified + tested + reviewed
All landed on `main` with a behavioral test and a 0-finding fresh-eyes review of the diff.
- **B1/B2/B3 (blocker) — corpus-integrity finite guards.** `mlSnapshotValidation.ts` now rejects non-finite/
  out-of-[0,10] `engineVisible.warmth` and non-finite `rankerScore`/`signalScore` on a breakdown-less trace
  (`mlSnapshotValidation.test.ts` +4).
- **W2-2a (blocker) — service type-confusion → 500.** `app.py` isinstance-guards the intent/weather/
  clothingType/model membership checks + an overflow-safe `_exact_number` for temperature/timeout; malformed
  types now return `400 contract_invalid` (`test_render_contract.py` parametrized, +10).
- **W2-2b (minor) — unbounded ints.** `config.MAX_WIRE_INT` ceiling on generationIndex/wardrobeVersion/
  interactionCountAtRequest.
- **W2-3a (blocker-class) — LLM role↔type.** `validator.py` cross-checks GPT's assigned role against the
  pooled item's authoritative `ItemType` (new `IssueCode.role_type_mismatch`); a hallucinated
  {top-item, role:base_bottom} is now rejected, not persisted (`test_validator.py` +2).
- **W2-1a (important) — parentSnapshotId case.** `mlRecommend.ts` canonicalizes it so an uppercase-hex
  re-roll retry replays the winner instead of a wrong 409 (`mlRecommend.test.ts` +1).
- **C1-reducer (minor) — perItemFeedback on `accepted`.** `interactions.ts` rejects it (a reject-time channel)
  so a disliked item can't silently gain +1 affinity (`interactionsBinding.test.ts` +1).
- **Doc-truth + process:** D1 (CLAUDE.md "Current focus" → M5 done), D2 (§23 H7/H8/H61 → IMPLEMENTED),
  D3 (m5-cutover `> COMPLETED` banner + stale-precedence-clause delete), and the P1–P3 process rules added to
  CLAUDE.md's build-and-audit loop (decision-status closure grep step; cross-runtime-fact-needs-a-test;
  test-imports-the-real-unit).

### 4.6 Registered (still deferred after Session B) — with disposition
- **W2-1b — reviewed, correct-as-is, NOT a bug.** A Mongo read blip → 500 is defensible; the never-5xx
  contract is about the *Python service* path — degrading a DB outage to an empty state would render a
  fake-empty closet. Left as-is by decision.
- **[minor, cosmetic] structuralLockError preempts the drop-escalation for a MULTI-invalid-clothingType pin
  set.** Two+ locked/forced pins all stored with an empty/invalid `clothingType` collide on the `""` slot in
  `structuralLockError` (`mlRecommend.ts`) → `400 controls_structurally_infeasible` with a confusing empty-slot
  message, instead of the design-intended `422 control_item_unusable`/`forced_item_unusable`. Both are hard
  rejects (no spend, no write) — legibility only, not a resilience/data hole. A single invalid-clothingType pin
  is handled correctly. (Found in the Session-B A-cluster audit.)
- **[CLOSED — Track 1, 2026-07-16] Mongoose role/candidate enums cross-runtime-pinned.** The
  `GenerationSnapshot.ts` candidate `role`/`stageReached`/`template`/`optionPath`/`risk` enums are now
  pinned TS==Python: `service/contract.py` `CROSS_RUNTIME_SCHEMA_ENUMS` DERIVES the value-sets from the
  live `fitted_core` ontology (`Role`/`Template`/`OptionPath`/`Risk` + `snapshot.CANDIDATE_STAGES`) into
  `contract_fields.json` `crossRuntime.schemaEnums`; `crossRuntimeContract.test.ts` pins the Mongoose
  schema `enumValues` to it and `test_render_contract.py::test_cross_runtime_schema_enums_derive_from_fitted_core`
  pins the Python side, so a one-sided edit reddens a suite instead of write-rejecting a valid candidate.
- **Minors (unchanged):** W2-1c/1d (uppercase forced/control id wrong-error; missing-vs-empty occasion 400/200
  split), W2-3b (dotted/`$` Map-key guard, latent on hex ids), W2-4b/c/d (cookie revocation, CV MIME trust,
  sync 500), C5 (generator timeout omit-when-None), D4 (§23 review-history trim). **D5 (post-m4-readiness
  COMPLETED banner) — DONE (Track 1, 2026-07-16).**

### 4.7 Session B (2026-07-16) — EXECUTED
Built behavior-first, heavy-audited (4 parallel lanes + a regression-of-fixes pass), full suites green.
Floors grew: **jest 522→577, pytest 1072→1074**.
- **A-cluster — DONE (degrade, Fable-ruled).** Per-item drop for per-garment faults, envelope faults still
  reject, a control-referenced dropped row escalates to `422 forced_item_unusable`/`control_item_unusable`
  (`mlRequestAdapter.ts` `tryProjectWardrobeItem`/`projectWardrobe`→`{wire,dropped}`; `mlRecommend.ts`
  escalation). No coercion; the engine's `notEnoughItems` is the floor. Spec §15.2 reconciled to drop-not-sink.
- **T1 — DONE.** Pipeline extracted to `lib/wardrobeDisplayPipeline.ts`; `wardrobe/page.tsx` calls it;
  `wardrobeFilter.test.ts` imports the real unit (fake mirror killed).
- **C3 — DONE.** `generationSnapshotRoundTrip.test.ts` now fences the full candidate/itemSnapshots/diagnostics
  body + a non-empty `ranker.itemAffinity` survival proof (Mongoose `minimize` of empty objects is benign).
- **C1/C2/C4 — DONE.** `contract.py cross_runtime_mirror()` generates the `crossRuntime` block of
  `contract_fields.json` (clamps/enums DERIVED from config/ItemType, format vectors literal); TS
  `crossRuntimeContract.test.ts` + Python `test_cross_runtime_*` pin both sides; TS id/format regexes
  single-homed in `lib/formats.ts`; clothingType single-homed into the Mongoose schemas; service-only clamps
  documented.
- **W2-4a — DONE.** Per-user token bucket in `interactions.ts` (`INTERACTION_RATE_LIMIT_CAPACITY`, injectable
  clock, `__resetInteractionRateLimit`), 429 before any DB work.
- **Audit-found + fixed (drift the punch-list didn't name):** (a) `warmth` must be an INTEGER 0..10 — Next
  accepted a fractional row the service rejects → whole-closet sink; predicate now matches the service. (b)
  requestId `REQUEST_ID_RE` had a blanket `/i` that accepted a LOWERCASE ULID the service/Mongoose reject
  (route-accepted-then-storage-rejected) → split, ULID uppercase-only. (c) Python format regexes `.match`→
  `.fullmatch` so a trailing `\n` (which `$` allowed) is rejected, matching JS `$`. (d) weather/clothingType
  Mongoose schema enums pinned to the mirror. (e) `MAX_ID_CHARS` mislabel corrected (it IS re-declared
  Next-side, regex-redundant).

### 4.8 Track 1 (2026-07-16) — EXECUTED: finish the trust net
The last shape-fixture surfaces converted to real behavior + the named cross-runtime residual pinned.
Behavior-first; heavy-audited (4 parallel fresh-context lanes — test-trust, correctness, security,
cross-runtime — + a Fable read on the one design call). Floors grew: **jest 577→604, pytest 1074→1075**.
- **The 4 DB-mocked route suites → BEHAVIORAL over real in-memory Mongo (`mongoHarness`).**
  `wardrobePostIngestion`/`wardrobeEditIngestion` now seed a real `User`+item, drive the real POST/PATCH,
  and READ THE ROW BACK (the live schema's clothingType-enum/warmth-bound/strict-strip is exercised, not a
  captured mock arg); `wardrobeImageUpload` runs the REAL `uploadWardrobeImage` so an upload actually
  persists a `WardrobeImage` + repoints the item (and the old-image-cleanup-on-replace path); `apiCvInferRoute`
  runs the REAL `verifyFirebaseUser` over real Mongo (only the external CV `fetch` stays mocked). Negative
  tests now prove the side-effect was prevented (`countDocuments===0` / row-unchanged), not just the status.
- **3 untested routes now covered behaviorally.** `auth/session` (the httpOnly `__session` cookie
  mint/clear boundary — ZERO test before; asserts the cookie is the *minted* value, httpOnly, path/maxAge,
  and NO cookie on the 401 paths); `cv/status` (all env/probe branches, no-network on not_configured);
  `wardrobe/clear` (the destructive route path — auth gate + cross-user isolation: only the caller's rows
  deleted, another user's survive; unknown-user 401 deletes nothing).
- **The cross-runtime role/candidate enum residual — PINNED both runtimes.** `[CLOSED]` above (§4.6):
  `GenerationSnapshot.ts` candidate `role`/`stageReached`/`template`/`optionPath`/`risk` enums are now pinned
  TS==Python via `contract.py CROSS_RUNTIME_SCHEMA_ENUMS` (DERIVED from `Role`/`Template`/`OptionPath`/`Risk`
  + the new `snapshot.CANDIDATE_STAGES` authority) → `contract_fields.json crossRuntime.schemaEnums`; a TS
  test pins the Mongoose `enumValues`, a Python test pins the derivation. Lane-proven load-bearing in all 4
  drift directions.
- **Legacy `category`/`subCategory` vs 5-value `clothingType` (the design call) — SPLIT to the W-track,
  Fable-confirmed.** There is no active correctness bug (§6.1/§15.1: the two are intentionally separate —
  display/CV vocab vs engine slot-partition; category is storage-only). The genuine reconciliation (surface
  + let users correct `clothingType`; then migrate the UI filter key) IS H52 rung-2 = the W-track review
  surface, which is spec-first — and doing the "cheap" filter-key migration *before* correction exists is
  strictly worse (a mis-derived item vanishes from every filter with no recourse). Recorded as scope in
  Spec §18 (H52 rung-2) + a trap-guard comment at the `deriveClothingType` seam; no mapping test (the
  disagreement is intentional — a test would freeze a false invariant).
- **Audit convergence + residuals named (not "all clean").** All 4 lanes returned zero load-bearing
  findings on the source; each proved its guard reddens on a real injected drift/bypass. One reliability
  concern (a cross-user test seen returning 200 on 2 *cold* runs) was investigated — **not reproduced in 22
  clean cold runs + the full suite in both `--runInBand` and default-parallel modes** — and attributed to
  concurrent audit-lane fault-injection contaminating the shared tree during the run (the security lane was
  live-dropping the route's `user:` scope at the time); the suites use the repo's proven harness idiom.
  Non-load-bearing observations left as-is: the storage-cap 413 test's secondary `imagePath===undefined`
  assertion (carried by the `countDocuments===0` proof); the single-item `DELETE /api/wardrobe/[id]` handler
  has no dedicated cross-user test (mirrors the proven PATCH/image scoping). The audit process itself
  surfaced a meta-lesson: subagents' "clean git status" self-reports are unreliable — the tree was
  reconciled by direct inspection, not by trusting the lanes.

**Why the campaign is worth it (the real justification):** not portfolio ROI — **trust in the process holding
long-term.** The recurrence mechanism in §4.3 is what erodes it: every "found another one" commit is a small
withdrawal from confidence that the ambition→spec→docs→code→tests hierarchy means what it says. Sessions A+B
plus the P1 closure step stop the withdrawals cheaply. (Getting 3–5 friend closets toward M6 is a separate,
independently good thing — not a substitute for, or an argument against, fixing the process.)
