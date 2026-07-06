# M5 pre-flight / definition-of-ready audit (2026-07-06)

FORWARD-looking audit: not "is the built state correct" (CP0–CP8 answered that) but
"is M5 buildable from the current spec without a design wall or an unresolved one-way
door mid-cutover?" Deliverable: a written M5-readiness VERDICT (GO / GO-WITH-CONDITIONS /
NOT-READY) with named blockers. Append per lane, never rewrite.

## Baseline

- **git HEAD:** `fd888626` — "docs(§19/§23): reconcile Codex independent audit". Tree CLEAN, main.
- **Floors (from CP0–CP8 close):** core 752 / h26 304 (+1 skip) / jest 377.
- **Rules:** verify every finding against source (file:line); zero OpenAI/network spend
  (pip-audit's public advisory lookup sanctioned by the brief, mirroring CP5's npm audit);
  sealed H26 artifacts immutable; commit on main; max 3 agents in flight.

## Lane plan

1. SPEC-BUILDABILITY — the OPEN M5-owned hole SET: mutual consistency + collective sufficiency + §20-row cross-check.
2. ONE-WAY DOORS — H49/H29(H48)/H10/H50: pinned vs open; ranked by cost-if-wrong.
3. PROMPT↔VALIDATOR↔SCHEMA — end-to-end runtime-seam trace (generation.py ↔ validator ↔ §15.1 snapshot).
4. CONTRACT ROUND-TRIP UNDER LOAD — many varied payloads through Python→serde→Mongoose validateSync.
5. LIVE-BEHAVIOR SANITY — run rescue e2e with a stub Generator; human-judgment eyeball.
6. FOLDED SUB-CHECKS — pip-audit + cold-setup README path.

---

## LANE 1 — Spec-buildability (the M5-owned hole SET)

Outcome: **no design WALL, but 3 sufficiency gaps (2 registered as new holes H57/H58; 1 sharpened
into H12) + 1 coupled-decision note. The set is mutually consistent except one genuine tension
(H12 ↔ §15.1 provenance-required). M5 needs the `/spec` pass canon already mandates — with this
docket, the `/spec` has everything it needs; without these registrations it would have hit two of
the gaps mid-build.** Every claim below read-verified against source.

**The OPEN M5-owned set enumerated** (from §23 + §19 + §20 M5 row): H4 (cache-lifetime stability,
lean named) · H7 (generationIndex, cheap sketch in readiness §4.4) · H8 (seedDate UTC, near-resolved)
· H11 (append-only reducer — design pinned, PENDING-impl) · H12 (fallback semantics, under-pinned)
· H13 (CI — real undone work, an entry prereq) · H17 (forceRegenerate, lean named) · H19 (reducer —
contract fully pinned §15.1) · H10/H29 (live write — pinned + 2 obligations) · H48/H49/H50 (one-way
doors, lane 2) · H51 (cache locus, open) · H54 (delete guard, pinned mechanical) · H55 (generator
defaults, pinned direction) · §19 trust-boundary + client-side gates (all enumerated with fixes) ·
H45 (card UI not itemized) · the §20-row interim cache-invalidation choice (named in the row).

### Findings

- **L1-F1 (IMPORTANT — registered as H57): the daily-intent engine surface is specced nowhere.**
  The §20 M5 row's headline deliverable — "rewrite of recommend/regenerate routes against this spec" —
  implies serving the **daily** intent (the deployed dashboard's main flow), and §19 deletes the legacy
  vertical at cutover. But `fitted_core`'s only end-to-end orchestrator is the rescue vertical:
  `rescue()`/`rescue_with_trace()` (`rescue.py:646/:849`), `RescueRequest.forced_item_id` is a
  **required** field (`rescue.py:87`), `build_snapshot_payload(trace: RescueTrace, request:
  RescueRequest, …)` is rescue-typed (`snapshot.py:491-493`), and the payload hard-codes
  `intent="rescue_item"` (`snapshot.py:523`, comment acknowledges "M5: parameterize"). The pipeline
  pieces are intent-generic (sampler/generation/validator/ranker), but the composed daily orchestrator +
  its trace + the snapshot-producer generalization are **new Python surface** no doc itemizes. The M5
  `/spec` must scope it explicitly: build the daily orchestrator, or cut over rescue-first and keep the
  legacy arm for daily (which contradicts §19's delete list) — a decision currently specced nowhere.
- **L1-F2 (IMPORTANT — registered as H58): the Next→service contract has no spec home.** `fitted_core`
  has **no HTTP layer** (no service module exists; verified module listing) and no request-direction wire
  contract: §15.1/`snapshot_serde` cover only the snapshot-payload direction, §15.2 covers item-field
  renames but not the request envelope (endpoint surface, wire casing for `RescueRequest`/wardrobe,
  error format). **Service auth is presupposed but never specced** — the only mentions are H12's
  "auth-to-service" trigger and H13's "serialization/auth … can't drift". An unauthenticated always-on
  Fly.io endpoint that calls OpenAI is an open LLM-spend proxy. Also folds in the readiness §4.1 IOU
  (§23 had no home for it): the §15.2-parallel **Lens adapter table** — intent routing, the weather
  raw→bucket threshold rule, constraints sourcing — is authored nowhere.
- **L1-F3 (IMPORTANT — H12 sharpened in place): the set's one genuine mutual inconsistency.** H12's
  recommended engine-never-ran resolution ("TS writes a degenerate `provenance=unavailable` snapshot")
  is **unsatisfiable against the C4 schema**: `GenerationSnapshot.ts` hard-requires `fittedCoreVersion`
  (`:286`), all four `generator` subfields incl. `temperature: Number` (`:294-301`), and `scorer.kind`
  enum(`cold_start|trained`) (`:311`) — there is no `unavailable` representation, and §15.1's rationale
  ("nullable provenance ⇒ unrecoverable provenance") pulls the opposite direction. The `/spec` must pick:
  sentinel values (corrupts M6 stratification semantics), a schema widening (+ `schemaVersion` posture),
  or no-snapshot-on-service-unreachable (contradicts §15.1 "every render attempt writes"). Registered
  into H12's text so the decision is visible pre-`/spec`, not discovered mid-build.
- **L1-F4 (report-only): H49+H51+H4 are one coupled design decision, not three.** Cache locus (H51)
  determines the cache entry's required value shape; H49's recommended fix ("persist the attempt trace
  *in the cache entry*") constrains that shape; H4's stability promise sets the entry's lifetime
  semantics. Mutually consistent — no contradiction — but they must be resolved as a unit in the
  `/spec` (cross-ref added to H51). H50+H7 are the same kind of pair and already cross-referenced.

**§20 M5-row deliverable ↔ design-pinned cross-check:** Fly.io deploy → **H58 (new)**; health/timeout/
fallback → H12 (+F3); two-stage cache → concept pinned, locus H51 + hit-provenance H49 open; request
adapter → item-half pinned (§15.2), Lens-half **H58**; trust-boundary gates → pinned (§19); live
snapshot write/binding → pinned (§15.1/§14.5) + doors; FEEDBACK_DEDUP_WINDOW → pinned (H11); route
rewrite → **H57 (new)**; delete cutover arm → pinned (§19); entry prereqs H13/H7/H8 → H13 is real
undone work, H7/H8 cheap with sketched resolutions.

---

## LANE 2 — One-way doors (rank by cost-if-wrong)

Outcome: **of the five "resolve before the first live write" doors, 3 are genuinely OPEN decisions
(H49, H50, H48 — exactly the `/spec` docket) and 2 are PINNED with only implementation risk (H10,
H54). None is a stall-wall: each open door has a recommended resolution already sketched in canon.**

| Rank | Door | Pinned? | Cost-if-wrong (corpus is irreversible once filling) |
|---|---|---|---|
| 1 | **H49 cache-hit provenance** | **OPEN** (recommendation sketched, not adopted) | HIGHEST — re-rolls over a warm cache are plausibly the most common early render; every hit-snapshot gets permanently false generation provenance (empty `generationAttempts[]` reads "no generation" / a copied `generator` block describes a render up to TTL-old); undetectable + un-fixable post-hoc |
| 2 | **H50 render idempotency** | **OPEN** (two shapes offered, tied to H7) | HIGH-MED — duplicate immutable siblings skew the off-policy distribution toward flaky connections and split feedback across sibling `snapshotId`s; post-hoc dedup is fuzzy at best |
| 3 | **H48 scored-but-unshown breakdowns** | **OPEN** (explicit either/or) | MED — variant-cap losers' Step-5 breakdowns are genuinely unrecoverable (they depend on request-time behavioral projections not snapshotted), but content survives, the response-layer sibling (compat/vis) IS recoverable offline (pure fns of engineVisible+lens), and the early corpus has ~zero behavioral signal, so the loss window's value is low |
| 4 | **H10 no-post-Python-refetch** | **PINNED** (§15.1 "stored verbatim, no post-call refetch"; Python side has the C6 drift test) | HIGH if violated (silent feature skew = the exact corruption the snapshot exists to prevent) but this is build-fidelity risk, not an open decision — M5 adds the TS-merge-side test |
| 5 | **H54 delete guard** | **PINNED** (mechanical: add `pre(["deleteOne","deleteMany"])`) | LOW — no delete caller exists today |

Adjacent pinned write-integrity items (implementation, not decisions): the R5
normalize-before-snapshot trap-guard (§15) and the H29 obligation-2 central TS validation helper
before `.create()` (§23-H29).

---

## LANE 3 — Prompt ↔ validator ↔ snapshot-schema alignment (agent + my source spot-verify)

Outcome: **the runtime seam is structurally CLEAN — no prompt↔validator drift anywhere.** I
re-verified the agent's load-bearing cites myself (prompt block `rescue.py:415-428` vs validator
allow/forbid sets `validator.py:234-246` — exact match; `response.py:301-312` empty-occasion→1.0;
`response.py:220-222` unknown-weather→no-op; `route.ts:450-456` `gpt-5.4-mini`/`temperature: 0.5`).

- **Clean (evidence, not silence):** prompt asks for exactly the envelope the validator allows
  (`{"outfits":[{"items":[{itemId,role}],"styleMove":{...}}]}`, exact-key checks aligned); §12
  "GPT never ranks" exclusions enforced both sides; candidate-count bound single-sourced; the
  role/slot vocabulary matches four ways (models↔prompt↔slotmap↔TS enum); every enum crossing the
  wire matches; every TS-required field has a documented author (Python or the §14.5 TS merge);
  serde renames verified field-by-field; content-preservation invariant enforced at payload build.
- **H55 premise confirmed** against current source (`gpt-4o` + `max_tokens`-only, `generation.py:71/:101`)
  **+ one new same-class delta folded into H55:** default `temperature=0.8` vs production `0.5` —
  M5 must choose explicitly.
- **The R5 trap's exact failure shape sharpened (fed lane 4's probes):** Python tolerates empty
  occasion (scores 1.0) and unknown weather (penalty no-ops) — generation *succeeds and serves*,
  then the best-effort snapshot insert alone rejects → silent training-row loss on exactly the
  renders §15.1 wants captured. Mitigant found: the legacy `TemperatureHint` union is byte-identical
  to the Mongo `weather` enum, so straight wiring is safe; the live trap is empty/whitespace occasion.
- **Converges independently with H57** (agent's IMPORTANT-2 = the same rescue-only
  `build_snapshot_payload` gap I registered from lane 1 — two independent reads, same hole).
- **Legacy-prompt divergence (informational):** the deployed prompt's envelope
  (`itemIds/confidence/reason/mode`, `notEnoughItems` root) is 100%-rejected by the v2 validator —
  M5 must swap prompt+parse+validation as one unit; conscious behavioral deltas to accept: v2 shoes
  optional (legacy footwear auto-inject dies per §19), no `mid_layer` role in v2, computed candidate
  clamp vs legacy client-supplied `maxOutfits=5`.
- NITs: `admittedViaFallbackStage` never authored (already a CP4 chip / §23-H29-adjacent);
  `samplerPerType` snake_case inner keys (already documented in the §14.5 forward-compat note).

---

## LANE 4 — Contract round-trip under load (agent harness; artifact re-verified)

Outcome: **54/54 realistic varied payloads validate end-to-end (Python `rescue_with_trace` →
`build_snapshot_payload` → `snapshot_serde.to_wire` → the real Mongoose `validateSync` with the
§14.5 TS merge); the ONLY failures are the 3 deliberate R5 probes. Zero real contract bugs.**
I re-verified the result artifact myself (`ts_results.json`: Counter {('pass','valid'): 54,
('r5_fail','invalid'): 3}) — exact Mongoose errors pinned for the M5 adapter:

| Probe | Error |
|---|---|
| weather `"72F sunny"` | `weather` kind=enum |
| weather `""` | `weather` kind=required |
| occasion `""` | `occasion` kind=required |

Coverage: all 5 weather buckets · all 5 ItemTypes forced · closets 2→160 items (types over caps) ·
unicode/CJK/emoji/reserved/8000-char/NUL strings · candidate counts 0/1/many/over-bound(9 & 46>40)
· duplicates · ghost-id/no-styleMove/forbidden-field mixes · repair-success · repair-fail→empty-shown
· both pre-GPT `not_enough_items` exits (fully-empty required arrays validate — the
`default: undefined` design holds) · extreme ints. Zero Python-side crashes anywhere.

Two adjacent observations (not bugs): **whitespace-only occasion `"   "` PASSES Mongoose
`required`** — the M5 adapter must trim-check itself (folded into H58's Lens-adapter scope);
item ids containing `| : =` hit the documented R10 key precondition and reject gracefully
(not a live risk — deployed ids are ObjectId hex). Temp jest harness deleted; repo clean.

---

## LANE 5 — Live-behavior sanity (I ran + eyeballed it myself)

Ran `python -m fitted_core.cli --corpus-dir tests/fixtures/corpus --dry-run` — all 12 golden
cases end-to-end on the real pipeline (replay generators, zero API).

**Reads RIGHT (human judgment, not assertions):**
- Compositions are believable across the board (neon tee grounded by black jeans; emerald dress +
  red heels as a jewel-tone bridge; parka-over-shorts surfaced as a deliberate stretch with
  compat driven to 0.00 — bucket-not-gate behaves exactly as designed).
- StyleMoves name *real* styling reasons ("Black jeans let the neon tee be the only loud thing in
  the room") — the §5 promise reads genuine, not template-filled.
- Path/risk labels track intuition (floral midi + boots = stretch; CV-failure featureless items →
  humble reliable/safe 0.75 default with `spread_collapsed=True` honestly flagged).
- Degenerate paths are honest: 3× duplicate → 1 survivor + `insufficient_after_generation=True`;
  hallucinated id kills only its own outfit (`itemOutsideSampledPool`); no-bottoms closet
  short-circuits PRE-GPT with a useful "add a bottom" hint; forced-shoe drop works (1 dropped).

**Two findings from LOOKING (what tests don't give you):**
- **IMPORTANT (doc trap-guard landed in §15.1): `fallback_stage=insufficient` on EVERY healthy
  render.** Verified semantics at `ranker.py:657-696`: the ladder is exhausted whenever the pool
  < `k=DEFAULT_K=10`, and rescue deliberately keeps `k > n_surfaced=3` so `select_spread` has a
  pool — so on realistic closets, near-every live snapshot's `diagnostics.ranker.fallbackStage`
  will read `"insufficient"` and `insufficient_wardrobe=True` while the render is perfectly
  healthy. Not a code bug (M3 semantics are fill-to-`k` by design) but a corpus-diagnostics trap:
  an M6 reader / the §21 fallback-distribution metric would read 100%-degraded. **Fixed as a §15.1
  reading-rule trap-guard** (key render health on `nSurfaced`/`spreadCollapsed`, never
  `fallbackStage` alone; M5 `/spec` may add a distinct render-health flag).
- **Note (by-design, recorded for M5 expectations): `score=1.00` uniform on every candidate** —
  the additive behavioral layer is empty at zero interactions, so day-1 live ranking is purely
  content spread + seeded tie-break, and early-corpus `scoreBreakdown`s are constant. Correct
  cold-start posture (§11 humble layer); just don't let the M5 demo read it as a scoring bug.

---

## LANE 6 — pip-audit + cold setup (agent; phantom-dep claim re-verified, fix landed)

- **pip-audit:** h26 venv + pinned requirements + fresh core resolution all CLEAN. One finding:
  torch 2.12.0 in `ml-system/.venv` carries CVE-2025-3000 (LOW, local-only `torch.jit.script`) —
  and it is **dead weight**: nothing outside `experiments/h26/` imports torch (h26's own venv pins
  clean 2.12.1). Root cause verified myself: `ml-system/requirements.txt:12-17` installed a heavy
  CV block (numpy/Pillow/torch/transformers/rembg) for **`clothing_cv.py`, a file that does not
  exist in the tree** (git grep: only the requirements comment + an h26-plan line saying it doesn't
  exist). **FIXED: dropped the phantom block** — kills the sole CVE surface + several hundred MB of
  dead cold-install weight; the documented run path (752-test suite, demo, lazy `openai`) needs none of it.
- **Cold setup: every README-documented step WORKS from the current tree** in a fresh venv —
  `pip install -r` ✓, core pytest **752 ✓** (floor met), demo `outfit_recommender.py` ✓, jest
  **377 ✓**; `.env`-gated steps verified statically (env sample complete). Soft gap (report-only):
  README cites the h26 304-count as a rigor stat but documents no run path for that suite (needs
  h26's own requirements/venv); the number itself re-verified true (**304+1 skip ✓**). One-line
  README addition optional at M5.

---

## VERDICT — M5 readiness

**GO-WITH-CONDITIONS.** M5 is buildable: the substrate's runtime seam is clean end-to-end (lane 3),
the cross-language contract holds under 54 varied realistic loads (lane 4), the pipeline's live
behavior reads sensibly to a human eye (lane 5), and cold setup + deps are healthy (lane 6). No
design WALL was found. But M5 may **not** proceed straight to code — the conditions:

1. **The `/spec` pass is mandatory, with a now-explicit docket** (canon already required the pass;
   this audit filled its agenda): pin the three OPEN one-way doors **H49 → H50 → H48** (in that
   cost order) before the first live snapshot write; resolve **H57** (the daily-intent orchestrator —
   the largest newly-registered gap: the M5 row's headline deliverable currently has no engine
   surface behind it); author **H58** (service API + auth — auth is a *spend-safety* gate: an open
   Fly.io endpoint is an OpenAI-spend proxy — plus the Lens adapter table with the trim-check);
   settle the **H12 ↔ §15.1 provenance tension** (the degenerate-snapshot recommendation is
   unsatisfiable against the C4 schema as-is); treat **H49+H51+H4 as one coupled cache decision**;
   make the H28 scorer-hook timing call; choose generator model/temperature explicitly (H55).
2. **Entry prereqs stand:** H13 CI (real undone work — the only prereq needing build effort),
   H7 + H8 (cheap, resolutions already sketched).
3. **Pinned-not-open items to carry into the build checklist** (no `/spec` debate needed): H54
   delete guard, H10 TS-merge no-refetch test, H29 central TS validation helper, R5
   validate-or-log-and-skip (+ trim-check), H11 append-only rewrite of the interactions route,
   §19 trust-boundary + client-side gates, H17 removal lean, autoIndex off in prod (§14.5).

**No NOT-READY blocker exists**; every named gap has a sketched resolution and a home. The fastest
safe path: run `/spec m5-cutover` next session with this note + §23 as the opening docket.

**Session actions:** registered H57 + H58; sharpened H12 (schema tension), H51 (coupled-decision
note), H55 (temperature delta); landed the §15.1 fallbackStage reading-rule trap-guard; fixed
`ml-system/requirements.txt` phantom CV block. Floors re-confirmed cold: core 752 / h26 304 (+1
skip) / jest 377. Zero OpenAI spend; sealed H26 artifacts untouched.
