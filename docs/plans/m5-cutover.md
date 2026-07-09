# M5 — Live cutover (`USE_ML_SHORTLISTER`)

> Slug: `m5-cutover`. Owns the live GenerationSnapshot write and the wholesale replacement of the
> legacy recommendation vertical. Decisions D1–D7 and every §-contract below are **locked**; the
> 2026-07-06/07 review-and-hardening history lives in git, not here. `docs/plans/regen-controls.md`
> is historical/superseded.
> Where this plan and `Fitted_Spec_v2.md` §15/§6.7 disagree on caching/regenerate, **this plan wins**
> until the scheduled same-commit spec rewrite lands (§C.5 / Verification).
> **Reading list for implementation:** this doc + `docs/Fitted_Spec_v2.md` (§12/§15/§15.1/§15.2/§16/§19/
> §20/§23) + `docs/plans/m4-data-model-migration.md` §8/§14.5 for substrate history only. On any
> Python↔TS merge-boundary/authorship conflict, this plan's §G.1 wins for M5 live writes.

## Steering bias (Brian, 2026-07-06)

**Move as close to the ambition as possible within the v2 spec's limits.** Two priorities: (1) build the
features on the ladder **and** the daily flow so the app is genuinely functional (breadth — the app must
work end-to-end); (2) **when a design choice arises, pick the option that advances the ambition** — the
lens-first personal style graph, the green-shirt promise, the M6 trained-scorer dive, and the honest
training corpus that feeds them. This already shapes the milestone (the daily orchestrator makes the app
whole; the feedback gate + reducers light up the behavioral layer live; the H28 seam lands + is exercised;
the corpus stays honest) and it re-steered **D7** from "defer the scorer seam" to "land it", and **§B**
from a cold sampler slot to the first real `SignalScorer` occupant. "Within the v2 spec's limits" still
holds: seams marked `[STAGED]` (§16 scoped-memory *behavior* — the merit-review hold at N≈1 users) stay
staged; landing a *seam* is ambition-forward, activating unproven *behavior* is not.

## Goal

Deploy `fitted_core` as an always-on Fly.io service, wire the Next app to it behind `USE_ML_SHORTLISTER`,
and **replace the legacy recommend/regenerate vertical wholesale** — serving both **daily** and **rescue**
intents on the new engine, writing an immutable `GenerationSnapshot` per rendered response, and binding
feedback to `{snapshotId, candidateId}`. **Regenerate = one constrained fresh generation** writing a child
snapshot with lineage (§C). When the flag flips, the entire legacy arm (§19 delete list) is deleted, not
migrated.

## Canonical references (verify line-cites before editing — they drift)

| What | Where | Note |
|---|---|---|
| Snapshot contract | `Fitted_Spec_v2.md` §15.1; `m4-data-model-migration.md` §8 | v2 wins on conflict |
| Request adapter (item map) | §15.2 | M5 authors the **Lens** half (§F below) |
| Feedback semantics | §16; `m4…` §11.1 | append-only + read-time dedup |
| M5 inherits/owns | `m4…` §14.5 | symbol-and-path concrete |
| Holes | §23 H4/H7/H8/H10/H11/H12/H13/H16/H17/H19/H28/H29/H45/H48/H49/H50/H51/H54/H55/H57/H58/H59/H60 | dispositions in §J |
| Rescue engine (generalize) | `ml-system/fitted_core/rescue.py`, `snapshot.py`, `response.py`, `ranker.py` | signatures in §B/§E |
| Legacy vertical (delete) | `.../regenerate/route.ts` (whole file) + the legacy **arm** inside the rewritten `recommend/route.ts` | §19 delete list — the M5 route itself is never deleted (C8) |
| Snapshot model | `fitted/models/GenerationSnapshot.ts` | §G additions |
| Interaction model + route | `fitted/models/OutfitInteraction.ts`, `fitted/app/api/interactions/route.ts` | §H/§I |
| Wire serde | `ml-system/fitted_core/snapshot_serde.py` | `to_wire`/`from_wire` |

## Decisions locked (the `/spec` docket, resolved; D2 revised by the 2026-07-06 targeted eval)

| # | Decision | Resolution | Holes |
|---|---|---|---|
| **D1** | M5 scope | **Full cutover.** Build the intent-generalized daily orchestrator so "today's outfit" works on `fitted_core`; delete the legacy vertical wholesale. Both intents on the new engine. | H57 |
| **D2** | Candidate cache + regenerate | **Kill the separate TTL cache** (the `GenerationSnapshot` is the durable candidate store). **Regenerate = one constrained fresh generation** writing a **child snapshot** (`parentSnapshotId`, `generationIndex+1`, its own `generator`/`generationAttempts[]`) — full mechanics, determinism scope, and the re-surface residual in §C. **Trap-guard (why re-rank was overturned — do not rebuild it):** re-ranking the parent's candidates cannot deliver "genuinely different" — `select_spread` re-sorts deterministically by `(-score, -compatibility, full_signature)` (`response.py:528-531`), laundering the tie-break out of the surfaced set; rotation rode only the repetition penalty and died at pool exhaustion (identical outfits forever on a ≤k pool); and the `survivors < k` escalation fired a GPT call on every small-closet re-roll anyway. A fresh generation costs ~$0.01 at `gpt-5.4-mini` pricing, reuses the R9 machinery M5 builds regardless, and gives the corpus real per-render attempts (H49 dissolves). A re-rank/cache layer is a legitimate **future** optimization at scale — do not pre-build it. | H4, H16, H17, H49, H51 |
| **D3** | Engine-failure fallback | **Snapshot iff a valid engine payload reached the Next writer.** Engine-internal failures → the **service** degrades to a degenerate payload (§D — provenance is derivable from request + module constants, so it is satisfiable even pre-generation). No payload → **no snapshot** + graceful non-bindable response + availability counter. No nullable / unavailable-provenance widening; the only additive schema changes are the explicit §G/§I fields. | H12 |
| **D4** | Trust-boundary gates | **Close all §19 gates** (backend + client-side). | §19, H11 |
| **D5** | Service architecture | **Stateless pure-function service.** Next fetches all inputs from Mongo, passes them in; the service runs the pure pipeline + reducers, returns the payload; **Next allocates `snapshotId`, validates, owns all writes.** The **service holds `OPENAI_API_KEY`**; Next stops needing it **once the legacy vertical is deleted at C8** (until then the flag-off legacy arm still calls OpenAI in Next). Because the key lives service-side, the **independent spend bounds live service-side too** (§A). | H58 |
| **D6** | Generator params + **API contract** | `gpt-5.4-mini`; the full API surface is pinned in **§A.6** and **landed at C1/C3**: Chat Completions + strict `json_schema` Structured Outputs (default), `reasoning_effort="none"`, `store:false`, `prompt_cache_retention="in_memory"`, `timeout=30s`, `max_retries=0`, `max_completion_tokens` (never `max_tokens`), refusal/truncation surfaced → the §D degenerate corpus; temperature is **not** hard-depended-on (§A.6 point 7). **Service-owned config** (§A): the service authors provenance from its own config; the wire `generator` object is an exact-match-validated **expectation**, never control — mismatch → `contract_invalid`, never clamped. The cap + full API-surface provenance are recorded in the `generator` block (§G/§A.6). | H55, H60 |
| **D7** | Scorer-seam hook | **Land it at M5** (ambition-forward), in two honest moves: declare the `OutfitScorer` type, and **exercise it in the snapshot producer** (`build_snapshot_payload`, which has items via `trace.prompt_pool`) to populate `scoreTrace.compatibility/visibility` for **every scored candidate** (unifies **H48**); first occupant = the existing cold-start `compatibility`/`visibility`. **The ranker is untouched → M3 byte-identical.** The rank-**order** hook (a precomputed per-candidate signal on `RankerContext`, preserving item-blindness) is **reserved for M6** (§E) — cold-start compat must not reorder the shipped ranker. The H48-headline store-vs-recover call is **decided: store (option (a))** — see §E for the corrected recoverability rationale. | H28, H48 |

## Success criteria (verifiable)

- `USE_ML_SHORTLISTER=true` → dashboard **daily** flow and **rescue** flow both render `fitted_core`-produced
  outfits via the Fly.io service. **Flag semantics are phase-dependent — do not collapse the two `false`
  cases (they mean different things at different points in the ladder):**

  | Phase | `flag=false` | `flag=true` + service reachable | `flag=true` + service failure (unreachable/timeout/5xx/auth/rate-limit/contract-fail) |
  |---|---|---|---|
  | **C5–C7** (legacy still present) | **Legacy vertical** (rollback/reference behavior — real `outfits[]`) | M5 render + snapshot | **New-contract degraded empty state** (§A) — never legacy, never 500 |
  | **post-C8** (legacy deleted) | **New-contract degraded empty state** (§A) — the flag's only remaining job is outage degradation | M5 render + snapshot | **New-contract degraded empty state** (§A) |

  So `false` ≠ "degraded" universally: through C7 it is the **legacy** arm; only after the C8 deletion does
  `false` collapse into the same degraded empty state a service failure produces. The degraded empty state
  (`shown: []`, `displayItems: []`, `bindable:false`, stable reason code, no feedback controls) is **never a
  500**.
- Every render where a valid payload reaches Next writes exactly one immutable `GenerationSnapshot`; shown
  variants carry `{snapshotId, candidateId}` (service-zipped by `full_signature`, helper-cross-checked —
  §A shown-identity pin); **the written document, read back, carries every §G.1 echo-through field**
  (`requestId` above all — the idempotency index is blind to documents that lack it, and blank/null ids are
  invalid live-write sentinels, not retry tokens). A re-roll runs
  **one constrained fresh generation** and writes
  a **child** snapshot with **its own** `generator` + `generationAttempts[]`, `generationIndex = parent+1`
  **computed server-side from an ownership-verified parent re-read, with the Lens derived from the parent
  row** (§C.1 — client lineage claims are never trusted), `parentSnapshotId` set to the parent, and the
  R9 `controls` that shaped it stored on the row (§G).
- **A duplicate `requestId` yields exactly one snapshot** (the §C.4 partial unique index + `E11000`
  winner-re-read), and the duplicate request returns the winner's shown set.
- Feedback (`POST /api/interactions`) is **append-only**, binds to `{snapshotId, candidateId}`, server
  re-reads the candidate, and rejects `candidateId ∉ shownCandidateIds` or `perItemFeedback.itemId ⊄`
  candidate items. The GET populate is user-scoped.
- The service rejects any request without the shared secret; **after C8 deletion** `OPENAI_API_KEY` exists only
  as a Fly.io/service secret, not in Next's env. During C5-C7 the flag-off legacy arm may still require the
  Next key. The service enforces its **own** generator allowlist, text clamps, token cap, and rate ceiling
  (§A) — never trusting Next's clamps alone.
- **Sampler-side personalization has a real occupant:** with `interaction_count ≥ MIN_SIGNAL_THRESHOLD`
  and a non-empty affinity projection, the sampler's per-type `selection_kind` is `signal` (the
  `AffinitySignalScorer`, §B/§H). **Byte-identity is keyed on scorer *availability*, not on count** —
  the precise three-case semantics (unavailable ⇒ byte-identical; available-below-threshold ⇒ cold
  selection surface + `scorer_available=True` diagnostic, *not* full byte-identity) live in §B and the
  edge-case table; never write a "count < 5 ⇒ byte-identical" acceptance.
- The `OutfitScorer` type is declared in a **new scorer module** and exercised **in the snapshot producer**
  (`build_snapshot_payload(..., outfit_scorer=…)` → `_build_candidates`), populating
  `scoreTrace.compatibility/visibility` for **all** scored candidates (cold-start occupant). **The closed M3
  `rank()` is untouched → its M0–M3 golden tests stay byte-identical.** The order-influence `RankerContext`
  field is **M6, not M5** (§E). Variant-cap losers carry their Step-5 breakdown (H48 headline, option (a)).
- All §19 backend + client gates closed, each with a covering test.
- **The ladder invariant holds at every checkpoint boundary:** the app renders + binds feedback
  end-to-end in at least one mode (legacy flag-off through C5; new-contract flag-on from C6); the flag
  flips only after the UI speaks the new contract.
- Legacy vertical removed; no dead paths behind the flag. Cross-runtime CI (H13) green.
- Suite floors grow (current after C4 hardening: **ml-system 984 / h26 305+1skip / jest 388** —
  floors, not pins).

## A. Service architecture + wire contract (D5 / H58)

```
Browser ─▶ Next route (one recommend route)                   Fly.io service (fitted_core, stateless)
            1. Firebase auth + ownership
            2. requestId idempotency read-check (§C.4)
            3. pre-allocate snapshotId (new ObjectId)
            4. request adapter: §15.2 item map + §F Lens table
            5. fetch behavioral rows from Mongo (§H, bounded)
            6. POST /render  ──────────────────────────▶   POST /render   (X-Fitted-Service-Key)
            7. central TS payload validation (§G helper) ◀──   clamp+validate → reducers → sampler →
            8. write GenerationSnapshot via .create()          §12 gen(GPT) → validator → rank_with_audit
               (E11000 ⇒ re-read winner, §C.4)                 → response → {payload, shown[]}
            9. return shown[] + {snapshotId, candidateId}
```

**One endpoint.** A regenerate is a `/render` call with `parentSnapshotId` + `generationIndex` + the R9
`controls` set (§C) — there is no `/rerank` endpoint and no cached candidate store.

**The snapshot write is blocking, on the critical path (v2 §15 reconciled to this posture).**
Step 8 is *awaited before* the step-9 browser response, never fire-and-forget: the §C.4 `E11000`
winner-re-read (a duplicate `requestId` must return the *winner's* shown set, not the loser's) and the
degrade-on-write-failure arm (§D) both require the `.create()` outcome inside the request handler. A
failed/rejected write ⇒ the §A degraded empty state, never a returned `{snapshotId, candidateId}` bound to
a row that never persisted. The old v2 logging-style write posture is retired; telemetry/counters may remain
best-effort, but the GenerationSnapshot row is not. The added Mongo write latency is negligible on this fork
(near-empty collections, solo scale).

- **Service is a pure function** (no DB creds). Next queries Mongo for wardrobe + **raw** behavioral rows and
  passes them in as `behavioralRows`; **the service runs the §H reducers over those raw rows** to build the
  `RankerContext` signals + the sampler's `AffinitySignalScorer` (the reducers are Python — C2 — so they must
  run service-side, not Next-side). This keeps all writes in Next's auth boundary and makes the service
  deterministic + testable. **The service holds `OPENAI_API_KEY`.**
- **Auth:** shared-secret header `X-Fitted-Service-Key` (Fly.io secret + Next env). The service rejects a
  missing/wrong key with `401`. **Assume the hostname is public** — Fly TLS certs land in Certificate
  Transparency logs the day they are issued, so obscurity carries zero weight; only the secret gates.
  **Rotation:** the service accepts two keys (`SERVICE_KEY_CURRENT` / `SERVICE_KEY_NEXT`) so rotation is a
  set-next → flip-Next → clear-old sequence with no deploy-order coupling.
- **Service-side spend bounds (the key lives here, so the defense lives here — never trust Next's H60
  clamps alone):**
  - **Generator config is service-owned; the wire `generator` is a cross-checked expectation, never
    control.** The service runs generation with **its own** configured params — model from its allowlist
    (`{"gpt-5.4-mini"}`), `temperature=0.5` (D6), `max_completion_tokens` from its own config (H55/H60) —
    and the payload's `generator` provenance block is authored **from that config**, never from the wire.
    The wire object is validated by **exact match** against the service config across the **full static
    API surface** — `provider`, `model` in allowlist, `temperature ==` the configured value,
    `maxCompletionTokens ==` the configured cap, AND `apiSurface`/`responseFormat`/`reasoningEffort`/
    `storeMode`/`promptCacheRetention`/`timeoutSeconds`/`maxRetries` each `==` the configured value (the
    same constants the service builds the client from and authors into the `generator` provenance block);
    a mismatch → `contract_invalid` **pre-spend**, before the generator is built — it means Next's
    expectation and the service's reality have drifted, which must fail loudly (never after a paid call has
    already authored a provenance row that lies about what produced it), not be clamped into silence.
    Single-valued surface fields that can only drift into an *unsanctioned* value (e.g. `reasoningEffort`,
    `promptCacheRetention`) additionally fail `/readyz` closed at config load; the multi-valued ones
    (`responseFormat`, `timeoutSeconds`, `maxRetries`) can drift while `/readyz` stays green, so the wire
    exact-match is the load-bearing pre-spend guard for those. (No
    `[0,2]` clamp: clamping *is* client control, contradicting D6's service-side enforcement.) **The cap
    is provenance too:** `max_completion_tokens` changes truncation/parse-fail/candidate distributions,
    so it is recorded in the payload's `generator` block (§G item 6) for M6 stratification.
  - **Input clamps + pre-spend Lens validation — with NUMERIC constants, not concepts (G7).** Length-clamp
    every body-controlled text field, reject blank/whitespace-only `occasion`, reject any `weather` bucket
    outside `hot|mild|cold|indoor|outdoor`, and cap the `wardrobe` array + total request body size at the
    ASGI layer. These checks run **before generation**; relying on Mongoose enum/required failures after the
    GPT call is spend leakage and yields no corpus row. **The clamp constants (service-config/env, one home
    in the service config module + mirrored Next-side; values are defaults, tuned at C3/C5 — the
    load-bearing part is they are *concrete and tested at the boundary*, not adjectives):**

    | Constant | Default | Guards |
    |---|---|---|
    | `MAX_OCCASION_CHARS` | 200 | `occasion` text |
    | `MAX_WEATHER_RAW_CHARS` | 120 | `weatherRaw` text |
    | `MAX_LOCATION_CHARS` | 120 | `location` text |
    | `MAX_WARDROBE_ITEMS` | 2000 | request `wardrobe[]` length (the engine still per-type-caps to `MAX_PROMPT_ITEMS=135`; this bounds the *request*) |
    | `MAX_REQUEST_BODY_BYTES` | 1_048_576 (1 MiB) | total POST body at the ASGI layer |
    | `MAX_CONTROL_IDS` | 50 | each of `controls.lockedItemIds` / `dislikedItemIds` length |
    | `MAX_PER_ITEM_FEEDBACK` | 20 | `perItemFeedback[]` length (C6 route) |
    | `FEEDBACK_REASON_RAW_TEXT_MAX_CHARS` | 500 | `feedbackReason.rawText` + `perItemFeedback.notes` (already §I) |
    | `MAX_JSON_NESTING_DEPTH` | 512 | hostile-but-parseable JSON depth → `invalidJson` before downstream walk |

    Text fields are **rejected when over-length** (not silently truncated — a truncated occasion would be a
    corrupt Lens); array/body caps **reject** over-bound requests as `contract_invalid` (no snapshot).
    **Boundary + over-bound tests (each constant):** exactly-at-limit passes, limit+1 rejects. **M5
    constraints posture:** `lens.constraints` must be `{}`; any non-empty map is `contract_invalid` before
    generation and writes no snapshot. Constraints stay in the wire/schema as the v2 placeholder, not corpus
    truth until engine-active.
  - **Rate ceiling:** a simple in-process token bucket per instance. **Its blast-radius bound is
    per-instance × instance-count, so it is only a "known rate" if the deploy is actually single-instance —
    which C3 must pin, not assume (audit-2026-07-07):** the C3 `fly.toml` sets a single machine
    (`min_machines_running=1`, no autoscale, single region; Fly HA otherwise provisions ≥2 machines and each
    runs its own bucket, silently doubling the ceiling — https://fly.io/docs/launch/scale-count/). If the
    service is ever scaled out, the per-instance bucket is no longer the global bound; the **monthly OpenAI
    project cap is the hard backstop regardless** (below).
  - **Hard budget:** a monthly spend cap on the OpenAI project (dashboard setting, zero code) — the
    backstop if everything above fails.
- **Framework:** a minimal ASGI app (FastAPI acceptable). One module `ml-system/service/app.py` importing
  `fitted_core`; **`fitted_core` gains no HTTP dependency** (the service wraps it).
- **Readiness endpoint `GET /readyz` (G9 — zero OpenAI spend, no auth-key required so the Fly health check
  can hit it).** It asserts the service can serve a real render *before* traffic arrives — **without calling
  OpenAI**: (1) `import fitted_core` succeeds (the module graph loads); (2) required config/env is present and
  well-formed — `OPENAI_API_KEY` **exists** (never logged/returned), both service keys
  (`SERVICE_KEY_CURRENT`, and `SERVICE_KEY_NEXT` if set), the generator allowlist (`{"gpt-5.4-mini"}`), the
  token cap `M5_MAX_COMPLETION_TOKENS` (a positive int) + `DAILY_MAX_CANDIDATES`, the §A.6
  API surface / `reasoningEffort` / `responseFormat` / `storeMode` / `promptCacheRetention` /
  `timeoutSeconds` / `maxRetries`; (3) the version constants resolve (`fitted_core_version`,
  `prompt_version`, `ranker_config_version`, `reducer_config_version`). Returns `200 {"ready":true,
  "versions":{…}}` or `503 {"ready":false,"reason":"<which check>"}` — **the body never contains secret
  values**, only presence booleans. Wire it as the **Fly `[[http_service.checks]]` health check** so a
  mis-configured machine never takes traffic, and assert it green in the **C8 pre-flip** checklist. A
  `GET /healthz` liveness (process-up, no config assertions) is optional; `/readyz` is the load-bearing one.

### A.6 Generator API contract (D6 — **LANDED across `generation.py` + C3 service config, 2026-07-07**)

The full OpenAI call surface is pinned — API surface, structured-output mode, reasoning effort,
storage/cache modes, timeout/retry policy, and refusal/truncation handling all change spend, parse-fail rate,
and corpus shape.
Grounded in the official OpenAI docs (Responses/Structured-Outputs/Reasoning guides, read 2026-07-07).

**Decision (recorded in provenance):**
- **API surface = Chat Completions for M5** (the tested `generation.py` path). **Scope of "H40 stays valid"
  (precise): it covers the *API surface* (Chat Completions) + the *model family*, NOT the response-format
  mode** — H40 ran `response_format={"type":"json_object"}` uncapped (the pre-hardening
  `OpenAIGenerator`), so adopting
  strict `json_schema` (point 1) **and** the token cap (point 3) are both *deltas H40 did not measure*, folded
  into the same pre-C5 token-budget run + the C8 daily/rescue mechanical read (never assumed to transfer).
  Fitted's generation is **single-turn and stateless** (the service is a pure function; no `previous_response_id`,
  no tool chain), so the Responses API's headline advantage — cross-turn reasoning-context reuse / statefulness —
  **does not apply to this workload**. The **Responses API is a registered, sanctioned alternative** (OpenAI
  recommends it for new GPT-5.x work); it becomes attractive only if multi-turn/tool use lands. If adopted, the
  output-cap param is `max_output_tokens` (not `max_completion_tokens`) and structured output is
  `text.format:{type:"json_schema", strict:true}` (not `response_format`) — provenance records which surface ran.

**Mandatory regardless of surface (each landed with a covering fake-client test in `test_generation.py`):**
1. **Structured output: strict `json_schema` (`strict:true`) is the default — LANDED.** The §12 envelope
   **fits** strict-mode constraints, so `generation.py` ships `OUTFITS_ENVELOPE_SCHEMA` (every object
   `additionalProperties:false` + all-keys-required; `role` pinned to the closed `Role` enum, **derived,
   never re-typed**; the "up to N" ask stays prose, not `maxItems` — a per-request schema would defeat
   OpenAI's compiled-schema caching) and `OpenAIGenerator` defaults to
   `response_format="json_schema_strict"`, with `"json_object"` as the constructor-selected sanctioned
   fallback. Strict mode guarantees **schema adherence** (no omitted key, no hallucinated enum), not
   semantics — **the §13 validator stays the strict boundary**. The mode is provenance
   (`responseFormat: "json_schema_strict" | "json_object"`).
2. **`reasoning_effort` sent explicitly at the model's accepted lowest — LANDED as `"none"`** (verified
   accepted on real `gpt-5.4-mini` by the H26 judge, pinned there 2026-07-01 as the model default).
   Bounded composition from a fixed item list gains nothing from deep reasoning, and an unset/high effort
   risks **reasoning tokens eating the output cap** (see 3). `reasoning_effort=None` omits the param — the
   escape hatch for non-reasoning models (e.g. a gpt-4o eval rerun rejects it). Chat Completions path:
   top-level `reasoning_effort`; Responses path: `reasoning:{effort}`.
3. **Output cap sized to the ASK first, reasoning headroom second; `max_tokens` is never sent** (GPT-5.x
   rejects it — use `max_completion_tokens` / `max_output_tokens`). **The dominant cap consumer is the
   *output* — the number of outfits the prompt asks for — NOT reasoning tokens** (with `reasoning_effort`
   low, reasoning is near-zero). A §12 outfit with real Mongo ObjectId ids costs **~130–170 output
   tokens**, so the sampler's general daily count (`min(MAX_CANDIDATES=40, total_base×3)`) would need
   ~5,000–6,800 output tokens and truncate mid-JSON under any sane cap — every normal-closet daily render
   would parse-fail to a §D degenerate: spend with zero positive corpus. **LANDED (C1):
   `DAILY_MAX_CANDIDATES=12`** (`config.py`, inside the auto-hashed `RANKER_CONFIG_VERSION` namespace) —
   the daily render path caps its LLM ask via `rescue._daily_candidate_requested`, mirroring rescue's own
   `_rescue_candidate_requested` override (**no closed M0–M3 module reopened**; the sampler count still
   sizes the *pool*); the capped value rides `GenerationPrompt.candidate_requested`, so the "Return up to
   N" ask and the validator bound are the same number **by construction**. Generating ~12 drafts to
   surface 3 keeps the ranker/`select_spread` spread ample. **The cap is then set to hold that ask**
   (≈2,200 for a 12-ask — **never a flat 900 against a 40-outfit ask**); the load-bearing invariant
   `cap ≥ ask × per-outfit-tokens + reasoning_headroom` is proven empirically on real `gpt-5.4-mini`
   **before C5** (the pre-C5 gate below — lower the ceiling or raise the cap until it fits). *Trap-guard:*
   H40's mechanical read ran **uncapped** (`--max-completion-tokens` unset → `None`), so "the H40 numbers
   stay valid" does **not** extend to any cap value — the pair must be validated together.
4. **OpenAI storage/cache surfaces are pinned separately — LANDED.** `store:false` disables storage of the
   completion output for OpenAI distillation/evals products; it is **not** the whole retention contract.
   Chat Completions also exposes `prompt_cache_retention`, whose default depends on the org's data-retention
   policy (official docs, re-read 2026-07-07). M5 therefore sends
   `prompt_cache_retention:"in_memory"` explicitly and records `promptCacheRetention:"in_memory"` in the
   generator block. Trap-guard: never restate `store:false` as "no OpenAI-side retention" by itself; the
   correct claim is **no distillation/evals storage plus no extended 24h prompt-cache retention**. If the
   model/API ever rejects `in_memory`, the pre-C5 live surface gate must either block the flip or make a
   versioned spec/schema/provenance change; the M5 service allowlist rejects `24h`.
5. **OpenAI SDK timeout/retry policy is bounded — LANDED.** The official Python SDK defaults are not safe for
   the M5 service envelope: requests time out after **10 minutes** by default and connection/408/409/429/5xx
   errors are retried **twice** by default. M5 sets `timeout=30.0` and `max_retries=0` on the OpenAI client so
   one live render cannot outlive the C5 Next timeout by minutes or perform hidden SDK retries after Next has
   already degraded. The values are service-owned constants (`OPENAI_TIMEOUT_SECONDS`,
   `OPENAI_MAX_RETRIES`), `/readyz` rejects malformed constants, and every snapshot records
   `timeoutSeconds` + `maxRetries` in `generator{}`. The service readiness gate rejects non-finite/<=0
   timeouts. The pre-C5 live surface gate may raise/lower the timeout
   with measured evidence, but must keep it below the eventual `SERVICE_TIMEOUT_MS` envelope and update
   provenance/tests in the same change.
6. **Refusal + truncation are engine failures on a *valid* request → the §D degenerate corpus, never a silent
   empty and never a crash, and never the `contract_invalid` envelope** (the request was valid; a paid-but-no-JSON
   outcome is exactly §D's "internal engine failure on a valid request"). Detection, per surface:
   Chat Completions → `choices[0].finish_reason == "length"` (truncated) and non-null `message.refusal`;
   Responses → `status == "incomplete"` + `incomplete_details.reason == "max_output_tokens"`, and a
   `type:"refusal"` output item. **Any non-`stop` finish_reason routes to the degenerate corpus (C4 docket
   (b), ratified — code already generalizes: `abnormal_finish_status`, `snapshot.py`, treats
   `finish_reason not in {None, "stop"}` as abnormal, NOT a narrow `{length, refusal}` allowlist).** The
   rule is general on purpose: an unrecognized non-stop completion (`content_filter`, any future reason) is
   still a paid-but-no-clean-JSON outcome the corpus must record — narrowing to a fixed set would let a new
   reason slip through as a false "healthy empty". So any of {incomplete/length, refusal, **any other
   non-stop finish_reason**, empty-parse-with-nonzero-usage} routes to
   the degenerate payload with the finish/refusal status recorded in `generationAttempts[]` (the money *was*
   spent — it is a real attempt, not a no-attempt raise). This is the same repair-then-degenerate path §12/§D
   already own; A.6 only pins that **refusal and cap-truncation join parse-fail** as its triggers.
   **LANDED (C1, the surfacing half):** `OpenAIGenerator` exposes a per-call
   `last_finish_status: FinishStatus(finish_reason, refusal)` (never discarding them at
   `message.content`), and the traced orchestrator captures it per attempt on
   `GenerationAttemptTrace.finish_status` (read immediately after each `generate()`, so a repair retry
   never overwrites attempt 1's status; `None` for stubs/replays). **C3 owns the routing half** — mapping
   the captured status into `generationAttempts[]`/`generator.finishStatus` provenance and the degenerate
   dispatch. **Usage telemetry is observational only:** `OpenAIGenerator.last_usage` feeds eval/cost
   reports, never render success; missing/partial SDK usage data leaves `last_usage=None` and must not raise
   after a paid response has valid content/finish status.
7. **Temperature is not load-bearing.** The general GPT-5 reasoning-model rule restricts `temperature` to the
   default (1); the repo's own 2026-06-28 smoke test showed `gpt-5.4-mini` accepted `temperature=0.5`. Official
   docs are silent, so **do not build a hard dependency**: the pre-C5 live surface gate must prove the
   configured `temperature=0.5` is still accepted by `gpt-5.4-mini`; if it is rejected, update the service
   config/tests/provenance to the model default before any live write. Re-roll novelty rides the
   sampler/repetition/cooldown layer + whatever sampling the model allows (§C), not a specific temperature.

**Provenance (extends the §G `generator` subschema):** every write records `apiSurface`
(`"chat_completions" | "responses"`), `responseFormat` (`"json_schema_strict" | "json_object"`),
`reasoningEffort` (string), `storeMode` (`"none"` — no distillation/evals storage),
`promptCacheRetention` (`"in_memory"` today — no extended 24h prompt-cache retention),
`timeoutSeconds` + `maxRetries`, the output-cap
**name + value** (`maxCompletionTokens` today; `maxOutputTokens`
if Responses), and the run's **finish status** (`finishReason`/`status` + any `incompleteReason`/`refusal`
flag) — so M6 can stratify by generation surface and the boundary has a durable record of paid-but-degenerate
runs. These are additive to the existing `generator{provider, model, temperature, maxCompletionTokens}` block.

### Wire contract

**Field sets are code-enforced — single source of truth (do not restate them elsewhere).** The
required/optional key set at every request boundary lives in **`ml-system/service/contract.py`** as
named frozensets (`RENDER_BODY_REQUIRED`, `CONTROLS_REQUIRED`, `LENS_REQUIRED`/`LENS_OPTIONAL`,
`WARDROBE_ITEM_REQUIRED`/`_OPTIONAL`, `BEHAVIORAL_ROWS_OPTIONAL`, `GENERATOR_REQUIRED`). The parser
(`service/app.py`) references them; `test_render_contract.py` pins them three ways — the canonical
`render_body()` fixture must equal them exactly, every required field is proven enforced pre-spend,
and the language-neutral mirror **`service/contract_fields.json`** must match the module. This is the
guard the M5 build lacked: the field-drift class (`sessionId` absent from the wire) now reddens the
suite instead of hiding in green. The **row grain** (`itemIds` vs `items`, inside `behavioralRows`
rows the parser treats as opaque) is owned by `contract.py`'s `REDUCER_ROW_READS` — the Python test
proves the reducer *consumes* those names; the C5 jest projection test proves Next *emits* them (gate
below). **The JSON block below is illustrative of types + semantics only** — membership is owned by
`contract.py`, so edit the field set there and the mirror, never here.

> **C5 acceptance gate (cross-runtime).** The Next adapter that builds this body ships a jest test that
> loads `service/contract_fields.json` and asserts, from `wireBoundaries`, its emitted keys equal
> `request`'s required set (and each nested object equals its boundary). **Separately, the C5 Mongo
> `behavioralRows` projection must emit exactly the `reducerRowReads` names** (`interactionRow` /
> `perItemFeedback` / `snapshotRow`) — this is where the `itemIds`/`items` drift lives (the row grain the
> wire parser treats as opaque). The Python side is only a *localizer* here: `test_declared_row_reads_drive_live_signals`
> catches a *rename* of a declared read but NOT a new undeclared one (see its docstring). The real row-grain
> guard is the **C5 behavioral round-trip** — a real Mongo projection driven through the service asserting the
> observable personalization behavior — which fails on a projection/reducer name mismatch regardless of which
> side drifted (post-M5 test-pyramid work, `docs/plans/post-m5-reset.md`). One contract file both runtimes
> target is the plumbing; the behavioral test is the cure.

`POST /render` request (camelCase, mirrors the snapshot Lens + engine inputs):
```jsonc
{
  "snapshotId": "<TS ObjectId hex>",          // TS-preallocated (§15.1 identity)
  "requestId": "<client idempotency token>",   // §C.4 — UUIDv4/ULID minted once per Generate action, reused on retry
  "sessionId": "<verified user id>",            // Next-derived from Firebase auth, never client-supplied; feeds R8 seeds/keys
  "intent": "daily" | "rescue_item",
  "generationIndex": 0,                        // NEXT-computed: 0 first render; parent+1 on a re-roll
                                               //   (§C.1 lineage gate — never taken from the client)
  "parentSnapshotId": null,                    // re-rolls only; ownership-verified by Next pre-service (§C.1)
  "controls": { "lockedItemIds": [], "dislikedItemIds": [] },  // R9 regen controls; preflight §C.3
  "lens": { "occasion": "<verbatim>", "weather": "hot|mild|cold|indoor|outdoor",
            "weatherRaw": "<str?>", "location": "<str?>", "forcedItemId": "<id?>",
            "seedDate": "<required UTC YYYY-MM-DD>", "constraints": { } }, // M5 requires {}; non-empty is rejected
  "wardrobe": [ { /* engineVisible projection §15.2: id,name,clothingType,warmth,colorTags,
                     occasionTags,styleTags[],material?,formality?,imageUrl */ } ],
  "wardrobeVersion": 0,
  "interactionCountAtRequest": 0,              // → RequestContext.interaction_count (NOT hard-0, §B)
  "behavioralRows": { /* §H RAW rows the SERVICE reduces: recentSnapshots[] (shownFullSignatures+nSurfaced+
                         createdAt+_id, H19 window) + interactionRows[] (BOUNDED, §H projection) */ },
  "generator": { "provider": "openai", "model": "gpt-5.4-mini", "temperature": 0.5,
                 "maxCompletionTokens": 2200 } // exact service cap `M5_MAX_COMPLETION_TOKENS` — ASK-SIZED (§A.6 point 3), NOT a flat 900; sized to hold the daily ask ceiling × ~170 + headroom, tuned pre-C5
  // ^ Next's EXPECTATION, exact-match-validated against the service's own config (§A) — the service
  //   generates and records provenance from its own config, never from this object
}
```
`POST /render` response: `{ "payload": <GenerationSnapshotPayload wire dict, to_wire()>, "shown":
[ { "candidateId": "<payload candidate id>", "outfit": <§6.5 OutfitVariant wire> } ], "flags": { "notEnoughItems":
false, "insufficientAfterGeneration": false, "spreadCollapsed": false, "reasonHint": null },
"degenerate": false }` — the `flags` object carries the `RescueResult`/`RenderResult` user-facing state
(the honest-partial / add-a-{type} UX needs it; the payload's `diagnostics` copy is for the corpus, not
the client path).

**`reasonHint` convention (C4 docket (a), pinned).** `flags.reasonHint` speaks TWO registers by render
outcome. **The register is decidable from the browser allowlist alone** (`degenerate`/`engineFailure` are
NOT in it — G15): **prose register iff any healthy flag is true** (`notEnoughItems` OR
`insufficientAfterGeneration`) → a **content-specific English hint** (e.g. "add a bottom to build an outfit
around this top"), genuinely-variable user advice; **machine-code register iff all three healthy flags are
false and `reasonHint` is non-null** → a **stable code** the client maps to localized copy. An *unrecognized*
code maps to generic error copy (client-side default — needed regardless of this milestone). The **exception
arms** (`app.py` :822/:864, an actual crash — `EngineFailure` recorded) emit `reasonHint="engine_failure"`
(the one constant — never `str(exception)`, never an English sentence), joining the degraded browser-response
machine-code family (`service_unavailable`/`contract_invalid`/`rate_limited`/`auth_failed`, below).

**A `degenerate:true` render is NOT automatically the machine-code register (trap-guard, anti-F1).** The
third path — generation completed with no exception but surfaced zero outfits (parse-fail-after-repair,
refusal-as-empty, cap-truncation, empty-valid-set) — is `degenerate:true` yet correctly carries
`insufficientAfterGeneration=true` + the **prose** "try regenerating" hint (`rescue.py` §H). It threw nothing,
`engineFailure` is None, `generationAttempts` ARE recorded; it is model-produced-nothing, not engine-crashed,
and its remedy is the regenerate CTA — so flattening it into `engine_failure` would falsify a flag, break the
honest-partial continuity (1-of-3 vs 0-of-3 survivors share cause + remedy), and misroute the user. The
crash-vs-garbage distinction the corpus needs lives in `diagnostics` (`engineFailure` vs
`generationAttempts`/`finishStatus`), never in `flags`.

**Degraded browser response (C5/C6 — Next-only, no payload).** When the service is unreachable, times out,
returns `5xx`, rejects auth/rate-limit, or returns `contract_invalid` after a service call, Next discards the
preallocated `snapshotId` and returns a new-contract empty state to the browser: `{ "shown": [],
"displayItems": [], "bindable": false, "flags": { "reasonHint": "service_unavailable" | "contract_invalid"
| "rate_limited" | "auth_failed", ... } }`. It carries **no** `{snapshotId,candidateId}`, renders an empty
state, and hides feedback controls. It is never legacy-shaped `outfits[]` and never a corpus row.

**Shown-identity pin (load-bearing — this is the feedback-binding token).** `OutfitVariant` carries no
candidate id (verified `response.py:107-130`); the candidate ids live on `payload.candidates[]`, issued
over the deterministic **funnel / `source_index`** order, while the surfaced variants arrive in
**`select_spread`** order (`response.py:528-531`) — the two differ whenever ranking reorders generation
order, so an index-zip of a wire `shown[]` variant against `payload.candidates[]` mis-binds. (Note the
payload's `shownCandidateIds` *is* built in `select_spread` order — `shown_position` is assigned from
`enumerate(build_trace.selected)`, `snapshot.py:342`, then sorted at `:515-516` — so an index-zip
against **that** list would coincidentally align; the danger is the candidates array, and relying on either
coincidence is not a contract.) Pinned instead: **the service zips each
surfaced variant to its payload candidate by `full_signature`** (unique per pass — M2 dedup), asserts
the mapping is 1:1 and total, and emits `candidateId` on every `shown[]` entry. **Next attaches the
top-level `snapshotId`** to each entry for the client (`{snapshotId, candidateId}` per rendered
variant). The §G validation helper **cross-checks** the wire `shown[].candidateId` sequence equals
`payload.shownCandidateIds` (order + length + `== nSurfaced`) before writing — a mismatch is
`contract_invalid`, never a silent mis-bind. Never zip by array index across the wire.

**Outfit serialization pin (C3 — `<§6.5 OutfitVariant wire>` is not self-serializing).** `OutfitVariant` is a
snake_case Python dataclass with enum and dataclass children (`items` role enums, `Template`/
`OptionPath`/`Risk`, `FrozenStyleMove`, `ScoreBreakdown` — verified `response.py:107-130`); `to_wire()`
covers only the snapshot payload. C3 ships an explicit **`variant_to_wire(variant) -> dict`** (in
`snapshot_serde.py`, same key-conversion conventions): camelCase §6.5 wire shape — `items` as
`[{itemId, role}, …]` with role enum **`.value` strings**, `templateType: variant.template.value`
(never a `template` field), `optionPath`/`risk` as enum values, `styleMove` with every
`FrozenStyleMove` field camelCased, `score` + `scoreBreakdown` (all seven term keys), `baseKey`,
`fullSignature`, `compatibility`, `visibility`. Golden wire-conformance vectors (incl. enum values,
object-shaped items, `templateType`, no stray `template`, and a populated styleMove) join the
cross-runtime CI set — never let each implementer hand-roll the mapping.

**Display source = the persisted candidate, never the `shown[].outfit` echo (load-bearing — closes a
body-divergence hole the `full_signature` zip does NOT close).** `full_signature` is derived from **item
ids only** — `base_key` (`top:bottom` or `dress`) + `|outer=<id>|shoes=<id>` (verified `keys.py:77-91`).
It does **not** cover `styleMove`, `optionPath`, `risk`, `score`, or role assignment. So the §A
`full_signature` zip proves the shown variant and the persisted candidate share an **item set**, but a
buggy/compromised service could emit a `shown[].outfit` whose **body** (the StyleMove card the user
actually reads — "the one thing that made it work" — or its `risk`/`optionPath`) differs from the persisted
`payload.candidates[candidateId]` while the signatures still match. What the user saw, what the corpus
stores, and what history later renders would then diverge, all with green binding checks. **Pin:** the shown
card's entire body is **resolved from the persisted candidate** `payload.candidates[candidateId]` (the same
object feedback binds to and history renders), never from `shown[].outfit`. Concretely, after TS validates
the payload:
- the UI card's `styleMove`/`optionPath`/`risk`/`items`+roles come from `payload.candidates[candidateId]`;
- item **display fields** (`name`, `clothingType`, `colorTags`, `imageUrl`) are joined from the validated
  `payload.itemSnapshots[]` (the same corpus record — no post-Python DB refetch, no client echo) into a
  UI-only sibling `displayItems: [{itemId, role, name, clothingType, colorTags, imageUrl}]`. `displayItems`
  is presentation scaffolding and is never used for binding or reducers.
- **`shown[].outfit`, if carried on the wire at all, is treated as untrusted and cross-checked, not
  displayed:** the §G helper asserts each wire `shown[].outfit` body **equals** its bound
  `payload.candidates[candidateId]` field-for-field (`items`+roles, `templateType`, `optionPath`, `risk`,
  every `styleMove` field, `fullSignature`) — any mismatch is `contract_invalid`, no write, no mis-render.
  (M5 may drop `shown[].outfit` from the wire entirely and carry only ordered `candidateId`s + `flags`; if
  it stays for one-request rendering it is verify-only.) A **swapped-body mutant** — a `shown[].outfit` with
  the bound candidate's `full_signature`/items but a different `styleMove`/`risk` — must be rejected.

The §6.5 identity shape stays unchanged (`items: [{itemId, role}]`). If any shown item id is missing from
`itemSnapshots`, the TS helper rejects `contract_invalid` before writing. History GET uses the same
snapshot join + `payload.candidates[]`/`itemSnapshots` source for bound cards, never denormalized
interaction-row content. This display rule is only the UI subset: the §G helper independently validates
**every** candidate content id (`items[]` and `slotMap`) against `itemSnapshots[]`, so unshown/negative
training rows cannot carry unrecoverable item references while the browser path still looks healthy.

**Browser-response allowlist (G15 — the browser gets a projected UI object, NEVER the corpus payload).** The
service `/render` response (`{payload, shown[], flags, degenerate}`) is a **server-only** artifact: Next
validates + persists it, then returns to the browser an **explicit allowlist** — `{ shown: [{snapshotId,
candidateId, displayItems, styleMove, optionPath, risk, templateType}], flags: {notEnoughItems,
insufficientAfterGeneration, spreadCollapsed, reasonHint}, bindable: true }` (a re-roll adds
`generationIndex`/`parentSnapshotId` for the client's lineage display). **What must NEVER reach browser
state:** the raw `payload`, `payload.candidates[].rawEmitted` (raw GPT text), `generationAttempts[]`,
`diagnostics{}` (internals incl. `engineFailure`, `ranker` signal collections), `itemSnapshots[]` wholesale,
`generator{}` provenance, `candidateCacheKey`, and any unshown/dropped candidate. **Negative Jest test
(load-bearing, not just a positive shape test):** serialize the browser response + the persisted client
state and assert **none** of `{payload, candidates, rawEmitted, generationAttempts, diagnostics,
engineFailure, generator, candidateCacheKey, itemSnapshots}` appears as a key anywhere in the tree — a
whitelist-diff, so a future field added to the service response does not silently leak. (Corpus internals in
the browser are both a data-shape leak and a training-signal leak — a user could read the negative-candidate
set.)

**Error envelope** (all non-2xx): `{ "error": { "code": "auth|rate_limit|contract_invalid|
internal", "message": "<str>" } }`. **`parse_fail` is deliberately NOT an envelope code (corpus-purity —
do not re-add):** a **GPT-output** parse-fail-after-repair — **and equally a model refusal or a
cap-truncated/incomplete response (§A.6)** — is a *valid-request engine failure* → the service
returns a **degenerate payload (2xx) that Next writes as a snapshot** (§D), never a non-2xx that would drop
the negative corpus. A malformed **request body / too-deep request JSON** (the only *input*-side parse
problem) is a caller bug → `contract_invalid`, folded into that code. `internal` is the last-resort 500 for
an uncaught service crash. Transport failures (unreachable / timeout) never reach an envelope —
Next catches them (§D). The H12 trigger set maps: `unreachable|timeout` → Next catch; `5xx|auth|rate_limit`
→ envelope with those codes; `parse-OK-but-contract-fail` → `contract_invalid`; **GPT-output parse-fail —
and model refusal / cap-truncated-incomplete (§A.6) — → degenerate 2xx payload + snapshot, never the envelope.**

## B. Daily orchestrator (D1 / H57)

Generalize the rescue vertical to an intent-generic orchestrator. **Real current signatures** (verified):

```python
# rescue.py today — generalized without breaking the RescueRequest import sites:
RenderRequest = RescueRequest  # fields include intent, Optional forced_item_id, interaction_count
def render(request: RenderRequest, generator: Generator, *, signal_scorer=None,
           behavioral_signals=None) -> RenderResult: ...
def render_with_trace(request: RenderRequest, generator: Generator, *, signal_scorer=None,
                      behavioral_signals=None) -> RenderTrace: ...
def rescue(request: RescueRequest, generator: Generator, *, signal_scorer=None,
           behavioral_signals=None) -> RescueResult: ...  # dispatch target for rescue_item
```

**Deliverables:**
- `RenderRequest` (generalizes `RescueRequest`): add `intent: str` (values `"daily"|"rescue_item"|
  "outfit_upgrade"|"translate"` — fitted_core uses a plain `str`, verified `snapshot.py:144`; the TS enum
  lists all four; add an `Intent` `Literal`/validation if desired), make `forced_item_id: Optional[str]`
  (a `__post_init__` guard: **required iff `intent == "rescue_item"`**), add `interaction_count: int = 0`
  (feeds `RequestContext.interaction_count` — no longer hard-`0`). Keep the existing k / n_surfaced /
  generation_index validators. **Daily's `n_surfaced` is pinned = 3** (decided, not inherited: the
  `(path×risk)` spread argument holds for daily too; implemented as the default, **not** a hard dataclass raise, so the
  field stays request-settable if the product call changes). *(Cost trap-guard — surfaced ≠ generated:
  `n_surfaced=3` bounds only the UI-surfaced count; per-render **generation** cost is set by the LLM ask,
  which §A.6 point 3 caps at `DAILY_MAX_CANDIDATES=12` — never claim "surfacing 3 halves cost".)*
  `RenderRequest` satisfies the `LensRequest` Protocol by
  shape (occasion+weather) — verified: the Protocol docstring already anticipates "any future daily/upgrade
  request".
- `render(request, generator, *, signal_scorer=None, behavioral_signals=None) -> RenderResult` and
  `render_with_trace(request, generator, *, signal_scorer=None, behavioral_signals=None) -> RenderTrace` dispatch on
  `request.intent`. **Rescue path** = today's `rescue`/`rescue_with_trace` behavior (forced-item scoping +
  sufficiency). **Daily path** = full-pool sample (§10, no forced-item scoping) → **pre-GPT
  `not_enough_items` short-circuit** (the sampler reports `not_enough_items` when `requested == 0`,
  verified `sampler.py:483`; daily mirrors rescue's no-spend intent — and both no-spend exits now
  preserve the same evidence: `candidate_requested=0` (the honest "no ask", never `None`) and a
  `trace.prompt_pool` / itemSnapshots carrying the engine-visible wardrobe the engine considered, with
  `generationAttempts[]`/`candidates[]`/shown arrays empty. The one structural difference: daily's
  understocked exit runs the sampler first so `sampler_result` is present and its pool is the preserved
  prompt_pool, whereas rescue's pre-GPT *structural* sufficiency exit short-circuits **before** sampling
  (`sampler_result=None`) and preserves the wardrobe itself in request order) — **no generator call, no spend**,
  `flags.notEnoughItems=true`, a **valid non-degenerate payload** with `nSurfaced=0`, snapshot written) →
  §12 generation (daily
  prompt) → validator → **intent-generic StyleMove drop (below)** → `rank_with_audit` → response. Keep
  `rescue`/`rescue_with_trace` as rescue-item entrypoints over the same substrate (their M0–Spearhead
  tests stay green). `signal_scorer=None` defaults to `ColdStartSignalScorer()` and
  `behavioral_signals=None` leaves `RankerContext` at its empty defaults — the wrappers and all goldens stay
  byte-identical. The candidate *pool* comes from the standard M1 scaling (§10 — daily has no forced-item
  scoping); the paid GPT ask is capped at `DAILY_MAX_CANDIDATES` (§A.6 point 3 — landed).
- **`_drop_invalid` split (landed C1) — the StyleMove drop is intent-generic, the forced-item drop is
  rescue-only.** *Trap-guard (crash class — why the split must never be undone):*
  `response._assemble_variant` **hard-asserts** a non-null `style_move` on every surfaced variant
  (verified `response.py:490-493`); M2 leaves `style_move=None` on absent-or-malformed moves and the
  ranker is StyleMove-agnostic — so a daily path without the pre-rank StyleMove drop
  (`_drop_missing_style_move`) **AssertionErrors on the first malformed StyleMove**. Requiring the
  StyleMove stays (the "one thing that made it work" promise) — the contract is dropping the candidate,
  never letting `None` reach assembly, and never weakening the assert. **Taxonomy pin:** rescue keeps the
  existing `dropStage="rescue"` / `dropReason="rescue_*"` codes for byte-stability; daily StyleMove drops
  use intent-neutral `dropStage="render"` / `dropReason="stylemove_invalid"` so the append-only candidate
  taxonomy does not freeze rescue-branded provenance onto daily rows.
- **Sampler signal slot — wire the real occupant, don't just re-label the fallback.** *Trap-guard:* the
  slot opens only when `interaction_count ≥ MIN_SIGNAL_THRESHOLD` **AND** `scorer.is_available()`
  (`sampler.py:247/:260-262`), and `ColdStartSignalScorer.is_available()` is hard-`False` (`:140-141`) —
  so passing the cold scorer with a real count only flips the log label (`coldStartSampling` →
  `signalUnavailable`, R11), it never opens the slot. M5 therefore ships **`AffinitySignalScorer`** (C2,
  in `reducers.py`): `is_available() = bool(self._affinity)`, `score(item, ctx) =
  self._affinity.get(item.id, 0.0)` over the §H `item_affinity` projection the service already computes.
  Deterministic (the slot picks the top-`signal_count` by score, `sampler.py:250`); new-user and golden
  paths unchanged (the count/availability gates stay closed for them). This is the designed occupant of
  the item-level behavioral seam (`sampler.py:116-118`) — the sampler-side half of "personalization comes
  alive", alongside the ranker's `RankerContext` signals. **The service passes it for BOTH intents** (C3):
  rescue's pre-scoping sample personalizes the same way; only the injection *default* is cold, so the
  rescue wrappers and every golden stay byte-identical.
  **Why this activation is inside the steering-bias limit (not the [STAGED] hold):** the humble additive
  behavioral layer (`item_affinity`/comboBoost/itemBoost) is spec-`[NEXT]` (§11/§14 "[NEXT] signal"), the
  layer v1.2 already shipped and the merit review kept — activating it on schedule is landing the ambition,
  not activating *unproven* behavior. The held-`[STAGED]` thing is the §16 **scoped-memory promotion**
  (`scopeTarget`/`learningDisposition` support-gated generalization at N≈1), which M5 does **not** turn on
  (fields exist, behavior stays staged). Distinct layers, distinct rungs.
- **Daily prompt** (new, `generation.py`/`rescue.py` prompt builders): mirror the rescue system/user prompt
  structure, drop the forced-item framing — "build N believable outfits for `{occasion}` / `{weatherBucket}`
  from this wardrobe". Same §12 JSON envelope + validator (no schema drift — the validator is intent-generic).
  **Pre-cutover mechanical read required at C8** (§Verification): H40's 100%-mechanical numbers are
  rescue-prompt × gpt-4o; the daily prompt × `gpt-5.4-mini` is two simultaneous deltas — measure before the
  flag flips, don't assume transfer.
- `build_snapshot_payload(trace, request, *, …)` — **C1 LANDED this:** the annotations are now the generic
  `RenderTrace`/`RenderRequest` (`RenderTrace = RescueTrace`, `RenderRequest = RescueRequest` aliases) and
  the producer reads `intent=request.intent` (was hard-coded `"rescue_item"`; verified at `snapshot.py`).
  Nothing else in the producer changes (the funnel is intent-generic).

**Acceptance:** pytest — daily `render` end-to-end on a golden wardrobe (fake `Generator`) produces a valid
§6.5 response + a payload with `intent="daily"`; a too-small daily closet short-circuits pre-GPT (**zero
generator calls**, `not_enough_items=True`, `sampler_result` present with `candidate_requested=0`,
itemSnapshots preserving the engine-visible wardrobe considered, empty attempts/candidates/shown,
`nSurfaced=0`); a daily candidate with
`style_move=None` is **dropped
pre-rank** (never reaches `_assemble_variant` — no AssertionError; honest partial if the drop leaves
`< n_surfaced`); rescue path byte-identical to the pre-generalization
`rescue`/`rescue_with_trace` (golden corpus dry-run unchanged); `RenderRequest(intent="rescue_item")` with
no `forced_item_id` raises; with `interaction_count ≥ 5` **and** a non-empty `AffinitySignalScorer`, at
least one type's `selection_kind == signal` and the top-affinity item is selected; with an empty affinity
map the sampler output is byte-identical to cold; with a non-empty scorer but count < 5 the selected pool and
per-type fallback surface match cold while `scorer_available` remains true as a diagnostic.

## C. Regenerate = constrained fresh generation with lineage (D2)

The re-roll runs the **full render pipeline again** — one GPT call — under the same Lens. Novelty comes
from GPT sampling stochasticity (`temperature=0.5` **where the model accepts it — §A.6; if gpt-5.4-mini
restricts temperature to 1, higher temperature only *increases* variety, so the story holds either way and
temperature is not load-bearing**) plus the live behavioral layer: the §H repetition window
penalizes re-showing what the chain already surfaced, and cooldown/contextual filters enforce
dislike-invalidation natively. No cache, no re-rank path, no copy-forward provenance. **Named residual
(observe at the C8 smoke, don't pre-build):** in the worst case (an immediate re-roll with no mid-chain
interaction, so behavioral inputs are unchanged — §C.1 Precision) the re-roll's prompt is byte-identical to
the parent's (same pool, same Lens), so a mode-collapsed generator could re-emit near-identical candidate
sets and re-create the exhaustion loop with spend attached. **Two dispositions pin this so the residual is managed,
not just named (Fable):**
- **Verify the *promise*, not only the plumbing.** Every pin below tests re-roll lineage/provenance/index,
  but nothing asserts the re-roll actually *differs*. A deterministic pytest can't (the fake `Generator` is
  scripted), so the **C8 live smoke adds a descriptive re-roll-differs observation** (§Verification): on the
  golden/live wardrobe, a re-roll's `shownFullSignatures` set is compared to its parent's and the overlap
  reported — descriptive, like H40's mechanical read, never a hard gate (a small closet can legitimately
  re-surface). This is the only place the "genuinely different" promise is exercised end-to-end.
- **The avoid-list lever, if adopted, ships as a `prompt_version` bump — never a silent mid-corpus change.**
  The cheap lever if the smoke shows collapse: append the chain's shown item-id combinations to the re-roll
  prompt as an explicit avoid-list (the service already holds them via `behavioralRows`). Because the prompt
  text changes, it lands as a **new `PROMPT_VERSION`** (recorded in `generator.promptVersion` provenance,
  which M6 already stratifies on) — so the corpus stays honestly versioned, not era-split behind a stable
  version string. Decide adopt-or-not at C8 from observed behavior; either way the provenance is truthful.
Re-ranking must
never mutate a parent — the shipped guards forbid it anyway (verified `GenerationSnapshot.ts:481-483`).
Five contract pins:

1. **Lineage + `generationIndex` (H7) — server-derived, never client-trusted.** The client's regenerate
   request carries **only** `{requestId, parentSnapshotId, controls}` (the client holds the snapshotId —
   it is the feedback-binding token). **Next then enforces the lineage gate before calling the service:**
   re-read the parent by `{_id: parentSnapshotId, user}` (**ownership enforced** — a nonexistent or
   cross-user parent → stable 404, pre-service, no spend); **derive the child's Lens verbatim from the
   parent row** (`sessionId`, `intent`, `forcedItemId`, occasion, weather, weatherRaw, location, constraints,
   seedDate — M5 constraints are always `{}` because non-empty constraints are rejected until the engine
   consumes them; D2's "same Lens, same `session_seed` → same **seeded-random** draw" is *enforced by
   construction* (scoped to the seeded-random 70%; the signal-slot 30% rides live affinity — see the
   Precision note below), not hoped from a client echo;
   the wardrobe **and** the behavioral rows are fetched live (only the Lens fields are frozen from the
   parent), so wardrobe deletions **and** new dislikes both reflect — dislike-invalidation rides
   `behavioralRows`/§H, never the wardrobe fetch, per the Precision note below); and **compute
   `generationIndex = parent.generationIndex + 1` server-side** — a client-supplied `generationIndex`
   or Lens/intent/forced item on a re-roll is ignored (the wire fields exist for first renders and for
   Next→service, both inside the trust boundary; the *client* is not). First render `= 0`. The child stores
   `parentSnapshotId` in a **new §G field (does not exist today; verified absent)**. `generationIndex` stays barred from any key/seed input except `tiebreak_seed` (already
   wired via `RankerContext`, verified); the **sampler** seed (`session_seed`) excludes it, so a re-roll's
   **seeded-random draw is deterministic across the chain** and the fresh GPT draw is the variety source.
   **Precision (Fable, do not mis-test):** "same sampled pool" is exact only for the **seeded-random 70%**
   and only **given unchanged behavioral inputs**. The signal-slot 30% is filled live by the
   `AffinitySignalScorer` (§B), so a between-render interaction that shifts `item_affinity` or crosses the
   `MIN_SIGNAL_THRESHOLD` gate legitimately re-composes that slot — an **intended, additional** novelty
   source alongside dislike-invalidation, never a determinism bug. Behavioral inputs are therefore **fetched
   fresh on every re-roll and never frozen to force pool-identity** (freezing them would kill the
   dislike-invalidation D2 depends on); any pool-stability test asserts the seeded-random draw's determinism
   under **fixed** behavioral inputs, not identity across a chain where the user interacted mid-chain.
   `candidateCacheKey` stays a service-computed input hash and keeps the existing **non-unique**
   `{user, candidateCacheKey, generationIndex}` sibling index (verified `GenerationSnapshot.ts:495`); it
   remains `required` (verified `:262`). **Semantics (pinned): a *Lens-chain key*, NOT an
   "identical-input" key** — it groups renders sharing the same session-stable Lens inputs; the R9
   `controls` (locks/dislikes) and behavioral rows **deliberately do not enter it**, though they change
   what generation produces (a locked re-roll stays in its parent's Lens chain, so sibling grouping
   survives mid-chain control changes; per-render input precision lives in the snapshot's own
   `controls`/lineage fields, never in this key). **Algorithm (pinned — the field is required, so an
   implementer must not invent it):** `candidate_cache_key()` = full sha256 hex over the `_frame`
   length-prefix framing (reuse `seed.py`'s `_frame`/`_canonical_seed` machinery — same injectivity +
   `None`-sentinel discipline §15 already pins) of the canonical ordered fields
   `(session_id, wardrobe_version, occasion, weather, intent, forced_item_id, seed_date)`. **No
   `generationIndex`** (siblings must share the key); **no `controls`/behavioral rows** (the Lens-chain
   semantics above); **no `constraints` at M5** because non-empty constraints are rejected rather than
   stored as inert provenance; **no `styleProfileVersion` until B-track adds the field** (a later field addition
   re-keys future rows only — cross-era grouping is not a promise). Lives beside `session_seed` in
   `seed.py` with golden vectors mirroring the C8 conformance set (non-BMP occasion, `None`/empty/`"0"`
   date); `build_snapshot_payload` keeps taking it as the caller-supplied param (verified
   `snapshot.py:495`); fix `seed.py:64`'s stale "M5 cache key" docstring in the same commit. **Lands at
   C3, not C4** — the service cannot call `build_snapshot_payload` without it (the builder requires the
   kwarg), so C3's "/render returns a valid payload" acceptance depends on it. Explicit parent-ref is
   the lineage truth, never key coincidence.
2. **Own provenance.** The child snapshot carries **its own** `generator` block + `generationAttempts[]`
   from its own generation run. H49 (cache-hit provenance / copy-forward semantics) **dissolves** — there
   is no render without a generation, so `createdAt` is generation time and `sourceAttemptId` always
   resolves against real attempts.
3. **Regen controls (R9 / H59).** `controls.lockedItemIds` / `controls.dislikedItemIds` are per-request
   fields. **One `normalizedControls`, computed once, drives generation AND persistence (F6 — no divergence
   between what shaped the render and what the corpus records).** The service normalizes the request controls
   exactly once — **reject blank/whitespace elements, reject non-string ids (serde `_ID_SEQUENCE_KEYS`),
   dedup, and order-normalize** (a stable sort so the persisted arrays are canonical, not client-order-
   dependent) — and that **same** `normalizedControls` object is what (a) scopes the sampled pool + builds
   the "every outfit must include…" prompt + drives the Step-4 dislike filter, **and** (b) is authored onto
   the payload's `controls` field (§G). Persisting the raw client arrays while generating from a deduped set
   (or vice-versa) would make the corpus mis-explain the render — forbidden. **`controls` is present on every
   M5 write:** a first/non-regen render carries `{lockedItemIds:[], dislikedItemIds:[]}` (empty, not absent —
   §G `required`+default), so "no controls" is an explicit corpus statement, never inferred from a missing
   subdoc. **Root-controls invariant (service-enforced, pre-spend): controls are regenerate-LINEAGE only —
   a root render (null parent / `generationIndex=0`) must carry EMPTY controls; non-empty `lockedItemIds`/
   `dislikedItemIds` on a parentless render is `contract_invalid` before any wardrobe preflight or GPT spend.**
   Non-empty controls belong to a re-roll (`generationIndex > 0` with a `parentSnapshotId`). This is
   defense-in-depth: C5 derives controls server-side from the regenerate UI and only ever onto a child, but
   the service must not accept a root controlled render even if that derivation drifts. **The dividing line
   is REQUEST-DECIDABILITY (Fable 2026-07-07): a control set that can never
   yield a valid outfit *regardless of the closet* is a caller bug the client can and must prevent →
   `contract_invalid`; a well-formed set the *actual wardrobe can't complete* is a valid EMPTY render,
   not a caller bug.** **Preflight — the request-decidable contradictions run over `normalizedControls`
   before any GPT spend** (the rescue `forcedItemId`-absent check also runs pre-spend but is a §D
   **input-validation** concern, counted there): (1) `locked ∩ disliked ≠ ∅`, and the rescue
   `forcedItemId ∈ disliked` (the implicit-lock ∩ dislike) → stable `400`, never empty-success;
   (2) a locked or disliked id absent from the live wardrobe → stable `400` (a stale control shaped
   nothing, so it must not be persisted as if it did — **but see §J: under request-decidability this is
   arguably a `409` deleted-item state-conflict, not a caller bug; open**); (3) **a structurally
   infeasible lock set → stable `400` with a reason code** — the template algebra via `clothingType`:
   at most one lock per slot (`top`/`bottom`/`dress`/`outer`/`shoes`), and a locked `dress` mutually
   exclusive with a locked `top`/`bottom` (two locked shoes, or dress+top, can never co-occupy a valid
   slot map, *closet-independent*). **The closet-DEPENDENT completion case is NOT a `400`.** A
   well-formed effective pin set (`lockedItemIds` + rescue `forcedItemId`) the wardrobe can't complete —
   a locked top with no non-disliked bottom, a dislike set that removes every base — is decidable only
   with the server wardrobe + the engine grammar, so it is a **valid `not_enough_items` empty render**
   (200, snapshot row written, no spend), identical in category to the no-controls understocked-closet
   path. The **engine** owns it: `rescue._controls_leave_no_buildable_outfit` short-circuits pre-GPT
   over the lock-scoped-minus-disliked pool (after the sampler / `_check_sufficiency` already cleared
   the understocked case), returning the not-enough result with a **distinct discriminator hint**
   (`_CONTROLS_UNBUILDABLE_HINT` — "your locks/dislikes rule out every outfit" vs the understocked
   "add a top and bottom, or a dress") so the corpus + UI can tell the two `nSurfaced=0` classes apart.
   Rationale (Fable): a `400` here fires on a bug-free client (race: the only bottom is deleted in
   another tab while a top is locked — every control was valid when chosen), contradicts the G16
   forced-item-deleted `409`-not-caller-bug precedent, and drops a self-describing corpus row
   (`controls` serialize on the snapshot) that is exactly the hard-negative boundary signal M6 wants;
   write-and-filter is reversible, drop-at-write is a one-way door.
   **Forced-item availability preflight (G16 — the rescue-specific pre-spend check, distinct from the lock
   checks).** For `intent="rescue_item"`, the `forcedItemId` must exist in the live wardrobe **before** any
   GPT spend. This bites hardest on a **rescue re-roll**: the child's `forcedItemId` is derived from the
   **parent row** (§C.1), so the user may re-roll a rescue whose forced garment they **deleted** since the
   original render. Resolution: a stable **`409 { error: { code: "forced_item_unavailable" } }` before the
   service call — no snapshot, no spend** (a deleted forced item is a legitimate state change, not a caller
   bug, so `409` not `contract_invalid`; but like a caller bug it writes no corpus row — a rescue of a
   nonexistent item has no meaning). **C6 renders clear UI copy** ("That item is no longer in your closet —
   pick another to rescue") rather than a generic error, and the pending-render envelope (F10) is cleared.
   **Test:** a rescue parent whose `forcedItemId` no longer exists in the live wardrobe → `409
   forced_item_unavailable`, zero generator calls, no snapshot; the first-render equivalent (launch rescue on
   an item deleted between select and submit) resolves identically. **Locks** generalize the rescue
   forced-item pin:
   orchestration scopes the sampled pool so every locked item is pinned in (the `_scope_pool_to_forced`
   pattern), the prompt instructs "every outfit must include …", and a post-validate drop removes
   candidates missing the locked set (mirror `_drop_invalid`) — locks are never enforced inside the
   closed sampler (§14 R9 invariant: no M0–M3 module reopens). **Dislikes** feed
   `contextual_disliked_item_ids` (the Step-4 hard filter). If filtering leaves fewer than `n_surfaced`,
   return the honest partial + notice (`insufficient_after_generation` pattern) — never a silently
   dropped lock, never a second GPT call.
4. **Idempotency (H50).** `requestId` (already a schema field, verified `:264`) becomes real:
   - **Partial unique index** (§G): `{user: 1, requestId: 1}` with
     `partialFilterExpression: { requestId: { $type: "string" } }` plus schema/helper rejection of
     missing/null/blank/malformed/overlong live-write ids — first-write-wins **enforced**, not hoped.
     Accepted shape: UUID v4 or ULID, max 64 ASCII chars, minted by the browser and validated by Next
     **before** any service call. Use `$type` here (not
     `$exists`) so null/malformed sentinels do not become indexed retry keys; use validation for `""`
     because the index filter is not the string-normalization layer. *Trap-guard:* the §16/H11
     "no write-path unique index" rule protects **feedback rows** (where
     duplicate events are meaningful); a render snapshot is one-per-render **by definition** (§15.1), so a
     same-`requestId` duplicate is a retry artifact. The index forecloses nothing — a legit repeat render
     mints a new `requestId`. An index-less read-check-then-create has a TOCTOU window spanning the whole
     render latency and catches nothing under a double-click.
   - **Write path:** on `E11000` the route re-reads the winner by `{user, requestId}` and returns its
     shown set — idempotent response, one corpus row. Reconstruction source is the stored snapshot
     (`candidates[]` + `itemSnapshots[]`), using the same candidate→§6.5 hydration helper as the live response
     path; no client echo and no second hand-rolled mapper. Acceptance: retry response shape/order equals the
     winning response.
   - **Render-identity match — a reused `requestId` for a *different* render is a CONFLICT, not a retry
     (G5).** A `requestId` is a per-Generate-action idempotency token; a genuine retry carries the **same
     render identity**. So **both** the early read-check **and** the `E11000` winner re-read must **compare
     the stored winner's normalized render identity to the incoming request** — the **client-controlled +
     deterministic** request-shaping set
     `{user, intent, occasion, weather, weatherRaw, location, forcedItemId, constraints,
     wardrobeVersion, generationIndex, parentSnapshotId, normalizedControls}` (NOT the live-fetched wardrobe/
     behavioral rows — those legitimately drift between a render and its replay). **`seedDate` is
     DELIBERATELY EXCLUDED (G5 trap-guard):** it is **server-clock-derived** (§F) and is not carried in the
     F10 envelope, so a genuine first-render retry that straddles **00:00 UTC** would recompute a *different*
     `seedDate` and a false `409` would fire on a legit retry. Every other field is client-stable, or
     deterministic-from-immutable-parent (`generationIndex`; on a re-roll the frozen Lens incl. `seedDate`),
     or inert (`wardrobeVersion=0`) — `seedDate` is the sole non-reconstructible field, so it cannot gate
     conflict detection. (A new Generate action always mints a new `requestId`, so a same-`requestId` request
     with identical client fields but a rolled-over `seedDate` is unambiguously a retry, never a distinct
     render.) *(Deferred determinism nicety: mint `seedDate` once per action into the F10 envelope + reuse on
     resume, so the replayed pool is byte-identical — unnecessary for correctness since the winner's own
     `seedDate` is what persists.)* **Exact match → replay the
     winner** (true idempotent retry). **Mismatch → stable `409 { error: { code: "request_id_conflict" } }`,
     NO service call, NO write** — a client bug or a token-reuse attack must not silently receive another
     render's result nor overwrite/alias it. (This is distinct from the F10 in-flight case, where the
     identity *matches* and the extra generation is dropped by the index.) Acceptance: a second POST reusing
     a live `requestId` with a changed Lens/controls/parent → `409 request_id_conflict`, no snapshot, no GPT
     call; a second POST with identical identity → the winner's shown set.
   - **Early read-check** (step 2 in §A): a best-effort spend guard that catches completed-render retries
     before calling the service (and applies the G5 identity comparison — a completed row with a mismatched
     identity short-circuits to `409` pre-service). It does **not** bound in-flight duplicates — the index does.
   - **Client minting rule (load-bearing):** `requestId` is minted **once per user Generate action** and
     reused by any retry of that action; the button is disabled while a render is in flight. A per-click
     token defeats the entire mechanism.
   - **Durable pending-render envelope (F10 — in-memory `requestId` does NOT survive a reload/lost
     response).** The in-flight `requestId` lives only in React state; a page reload, a tab crash, or a
     dropped HTTP response mid-render loses it, so the user's retry mints a *new* `requestId` — a second GPT
     spend and no idempotent replay of the first (the whole §C.4 index buys nothing across a reload). **C6
     persists a pending-render envelope** in durable client storage (the dashboard already uses
     `sessionStorage['fitted_dashboard_state']`, verified `:52/:57/:70` — same mechanism, a sibling key)
     **before** issuing the fetch: `{requestId, intent, parentSnapshotId?, normalizedControls, lensSummary}`.
     It is **cleared only after** a **hydrated success** (the snapshot response rendered) **or an explicit
     user abandon** — never on unmount alone. On load, if an un-cleared envelope exists, the app **resumes
     with the same `requestId`** or offers an explicit "discard". **What the same-`requestId` resume buys
     (do NOT overclaim "no second spend" — the edge-case table's two reload rows carry the same bound):**
     one snapshot per `requestId`, always (index + `E11000` winner-re-read); a reload *after* completion
     replays the winner via the early read-check — no second GPT call; a reload while the render is still
     *in flight* re-calls the service — **one extra GPT generation** (the loser's `.create()` hits `E11000`
     and is dropped), bounded by the §A rate ceiling + monthly cap. The envelope prevents the *worse*
     new-`requestId` double-commit, not all double-spend. **Optional stronger fix (registered, not built at
     M5):** a short-TTL server-side in-flight lease on `{user, requestId}` — closes the in-flight
     double-generation window; deferred at solo scale.
     (Client storage is a best-effort convenience layer, not a trust boundary — the server-side index remains
     the actual idempotency guarantee; the envelope ensures the client *presents the same token* after a reload.)
5. **Determinism promise + spec reconciliation (H4/H16/H17).** *Snapshots are immutable; every generation
   — first render or re-roll — is a fresh draw.* **ALREADY-DONE (2026-07-07 post-C4 audit):** every v2 cache
  home now reflects the cache kill: §5's cache bullet ("Candidate generation … Expensive; cached"), **§9's
  canonical-pipeline-order table Step 7 ("cache the candidate stage" + "async log" + the "M5 cache/snapshot"
  milestone cell — the snapshot write is blocking, not "async log", §A pin)**, §6.7, **§14's R9
  cached-candidate/merge wording**, §15's two-stage-cache paragraphs, the §20
  M5-row "two-stage cache" deliverable, Appendix A's R1/N1 forwarding text, and Appendix B's cache-TTL
  constant (**already struck this session — see Verification's ALREADY-DONE note**). Note the spend consequence honestly:
   re-roll cost is linear in clicks (~$0.01 each), bounded by pin 4 + the §A rate ceiling + the UI debounce.

**Acceptance (C4, pytest + service tests):** a re-roll request produces a child render whose payload has
its own attempts, `generation_index = parent+1`; a contradictory `locked ∩ disliked` request returns the
stable error pre-generation; a **structurally infeasible** lock set (two locked shoes; locked dress +
locked top — *closet-independent* co-occupancy) returns the stable `400` with **zero generator calls**;
a **closet-can't-complete** control set (locked top with no non-disliked bottom; forced optional + locked
top with no bottom; dislikes remove every base from an otherwise-buildable wardrobe) returns a **valid
`not_enough_items` empty render** — 200, snapshot written, **zero generator calls**, the
`_CONTROLS_UNBUILDABLE_HINT` discriminator distinct from the understocked hint — *never* a `400` (§C.3
request-decidability, Fable); an already-understocked closet stays the normal not-enough-items render; a
candidate missing a locked item is
dropped post-validation; a disliked
item never appears in the child's surfaced set (Step-4). **(TS-side at C5:** `parentSnapshotId` stored +
serde round-trip; duplicate-`requestId` concurrent writes yield one snapshot + the loser returns the
winner's shown set.)

## D. Engine-failure boundary (D3 / H12)

The boundary must be **observable**, and the degenerate payload must be constructable at **every**
internal failure point — including before generation runs.

- **Boundary:** a snapshot is written **iff a parseable, adapter-valid engine payload reached the Next
  writer** (matches the R5 pre-write validation boundary already in §15). Not the unobservable "did the
  engine run".
- **Invalid request ≠ engine failure (corpus-purity boundary, pinned).** A request that fails the
  service's **input validation** — unsupported intent (anything outside the implemented M5 set
  `daily|rescue_item`), clamp violations, blank occasion, invalid weather bucket, `reject_duplicate_ids` on
  the wardrobe, malformed shapes, missing/absent rescue `forcedItemId`, or a `RenderRequest` guard raise
  (construction happens inside the pre-validation boundary) — is a **caller bug**: it
  returns the `contract_invalid` error envelope, **no payload, no snapshot** (Next logs + counts it; a
  TS adapter bug must surface as a loud 4xx to fix, never become a training-corpus row). **Degenerate
  payloads are reserved for internal engine failures on a VALID request** — a sampler/ranker bug
  mid-pipeline, GPT parse-fail-after-repair, an empty valid set.
  - **Third category — a *state conflict* (G5, G16): also no row, but a `409`, not `contract_invalid`.** A
    duplicate `requestId` with a changed render identity (`request_id_conflict`, §C.4/G5) and a rescue whose
    `forcedItemId` existed on the parent but was **deleted** from the wardrobe (`forced_item_unavailable`,
    §C.3/G16) are neither a malformed request (the request is well-formed) nor an engine failure (nothing
    ran). They resolve to a **stable `409` before any spend, no snapshot** — the "no row" side matches a
    caller bug, but the `409` code distinguishes "your request conflicts with current state" from "your
    request is malformed". This keeps the corpus clean (no meaningful render happened) without mislabeling a
    legitimate state change as a caller bug.
- **Service owns degrade-to-payload — and provenance never depends on generation.** Every
  provenance-required field is derivable from the request + module constants (`fitted_core_version`,
  `prompt_version`, `ranker_config_version` are constants; `generator` is the service's own config (§A —
  never the wire object); `scorer` is config) — so a schema-valid degenerate payload is constructable even
  for internal failures **before** any GPT call (a sampler/ranker bug on a validated request). *Trap-guard:*
  never reason "generation didn't run ⇒ provenance unknown ⇒ no snapshot" — that routes recordable
  internal failures to the no-snapshot arm and loses the failure corpus §15.1 wants.
- **Recording loci (three, never fabricate an attempt):**
  - **attempt-only** failure (parse-fail-after-repair, empty valid set, **a model refusal, or a
    cap-truncated/incomplete response — §A.6: money was spent, so it IS a real attempt**) → recorded in
    `generationAttempts[]` as today; arrays present, possibly empty candidates; the refusal/`finish_reason`/
    `status` is captured in the attempt's finish-status provenance (§A.6/§G); `engineFailure` absent.
  - **no-attempt** internal failure (pre-GPT raise, caught internal exception) → **empty**
    `generationAttempts[]` (required-may-be-empty, `GenerationSnapshot.ts:323-327`) + the failure record
    in a named `diagnostics.engineFailure` field — **the full shape is §G item 4** (closed-set
    `stage`/`code`, the bounded fixed-catalogue sanitized `message`, structured `detail{itemId, count}`,
    `messageTruncated`), never just an ad-hoc `{stage, code, message}`. §8.2-E's "never forced into
    fake candidates/attempts" applies to attempts too.
  - **trace-salvaged assembly** failure (post-render `build_snapshot_payload`/zip/serde crash) →
    `diagnostics.engineFailure` with `stage="assemble"` **and normally non-empty** `generationAttempts[]`
    — the real paid attempts plus best-effort trace-salvaged `itemSnapshots`/diagnostics
    (`candidateRequested`/`promptItemCount`/sampler/ranker/rescue/scorer). Both-present is a VALID
    shape; C5's validation must accept it, and no cleanup may "normalize" it to either other locus.
    Last-resort salvage failures may still have `stage="assemble"` with **empty** attempts (for example
    when attempt mapping or fallback serialization is the crashing substep); that shape is also valid as
    long as `diagnostics.parse.generatorCalls` carries the observed spend count.
- **`diagnostics.engineFailure` needs an explicit home in all three layers (trap-guard — Mongoose
    strict mode silently strips unknown subdoc paths, so a missing schema field loses the failure
    corpus with every test green):** (1) `DiagnosticsPayload` gains `engine_failure: Optional[dict] =
    None` (`snapshot.py` — lands at C3 with the degenerate builder); (2) `snapshot_serde` maps
    `engine_failure ↔ engineFailure`; (3) the TS diagnostics subschema gains a named
    `engineFailure: { stage: String, code: String, message: String }` subdoc (`_id:false`, optional) —
    the fourth §G addition. Acceptance must **read the field back** after a write, never trust
    write-success.
  - **`build_degenerate_payload(request, failure)` is a C3 deliverable** — `build_snapshot_payload`
    requires a `RenderTrace` (= the `RescueTrace` alias, verified `snapshot.py`), which a pre-trace exception doesn't have.
    It carries the **full §G.1 identity/echo-through set** — in particular `request_id`: a degenerate
    write without it escapes the §C.4 partial unique index (`$type:"string"` never matches) and duplicates on
    retry, exactly the failure mode the index exists to stop.
  - Known micro-gap, recorded not fixed: a generator exception mid-trace-capture
    (`rescue._generate_and_parse_with_trace`) loses
    the in-flight attempt's raw text; the failure is recorded via `diagnostics.engineFailure` only.
- **Next's rule stays dumb.** Payload ⇒ validate + write; no payload ⇒ log + increment an availability
  counter + return the §A degraded empty state + **discard the pre-allocated `snapshotId`** (degraded
  responses carry no `{snapshotId, candidateId}`).
- **Named residual gap.** Generation ran but the response was lost in transit (money spent, no row) is
  unrecorded — rare, zero-user, un-bindable. Written into §15.1 as a known gap class.
- **Constants:** `SERVICE_TIMEOUT_MS` in Appendix B (value tuned at C5). Trigger set: unreachable OR timeout
  OR 5xx OR auth-fail OR rate-limit OR parse-OK-contract-fail.
- **Host timeout must dominate the service timeout (G6 — else the platform kills the function mid-render and
  the degrade logic never runs).** The Next recommend route runs on a serverless host with a hard
  **`maxDuration`** (Vercel default is short — ~10s on hobby; renders take ~5–15s for the GPT call). If
  `maxDuration ≤ SERVICE_TIMEOUT_MS`, the platform aborts the function **before** the fetch timeout fires, so
  Next never reaches its `AbortController` catch → the browser gets an opaque platform 500 (a lost response +
  possible paid-but-unrecorded generation), not the §A degraded empty state. **Pin (C5), ordering invariant —
  the fetch timeout is NOT the only thing inside `maxDuration` (G6):** the route also spends **pre-service**
  time (Firebase token verify + the wardrobe & bounded behavioral-row Mongo reads + adapter + helper
  validation, §A steps 1–7) *and* the post-service write/re-read. So the full inequality is
  `PRE_SERVICE_BUDGET_MS + SERVICE_TIMEOUT_MS + MONGO_WRITE_REREAD_MARGIN_MS < route maxDuration`. C5 sets
  the route's `maxDuration`
  (Next route segment config, e.g. `export const maxDuration = 60` — **note Vercel Hobby caps `maxDuration`
  at 60s, so there is no room to just raise it; the sub-budgets are carved out below 60s**) and sets
  `SERVICE_TIMEOUT_MS` below `maxDuration − PRE_SERVICE_BUDGET_MS − MONGO_WRITE_REREAD_MARGIN_MS`, with
  headroom. **C8 pre-flip** asserts the deployed `maxDuration` still satisfies the inequality (a
  platform-plan change can silently lower it). **Test:** a **fake slow service** (delays past
  `SERVICE_TIMEOUT_MS` but within `maxDuration`) → Next's own timeout fires, returns the §A degraded empty
  state, discards the pre-alloc `snapshotId` — proving the abort is handled by Next, not the platform.

**Acceptance:** an injected **post-generation** engine failure yields a degenerate payload recording the
failure in `generationAttempts[]`; an injected **pre-generation internal** failure (including a
reducer/scorer/generator-construction raise — the guard starts at the first post-validation statement)
yields a degenerate payload with empty attempts + `diagnostics.engineFailure` set; an injected
**assembly** failure yields `stage="assemble"` + salvaged attempts/itemSnapshots, and the explicit
attempt-salvage-fails case still yields `stage="assemble"` with empty attempts + an honest
`generatorCalls` count — all
validate + write; an **invalid request** yields `contract_invalid` + no payload + no snapshot; an
injected transport failure yields no snapshot + a non-bindable degraded response + a counter tick; an
anti-rot smoke test exercises all the arms.

## E. The H28 scorer seam (D7) — calls decided; basis noted

Verified: `compatibility(slot_map, items_by_id, request: LensRequest) -> float` and `visibility(...)`
(`response.py:338/:406`) are **already written to the scorer-seam signature**. The **ranker is deliberately
items-blind** — `rank()`/`rank_with_audit(candidates, context)` take no `items_by_id` (`ranker.py:118`);
the **snapshot producer** is where items live (`RenderTrace.prompt_pool`; the field is defined in `rescue.py`
— re-grep the symbol, the cite drifted with C1). The
seam lands in two honest, minimal moves; order-influence defers to M6:

```python
# 1. Declare the type (new scorer module) — the shape M6's trained scorer implements:
class OutfitScorer(Protocol):
    def __call__(self, slot_map: SlotMap, items_by_id: Mapping[str, WardrobeItem],
                 request: LensRequest) -> OutfitScore: ...   # OutfitScore(compatibility: float,
                                                             #   visibility: float, signal_score: float | None)
```

- **Exercise it in the producer (M5), resolving the H48 *sibling* (response-layer tail).** Extend
  `snapshot._build_candidates` steps 5–6 (`snapshot.py` "ranker funnel" + "response funnel" blocks,
  ~`:423-462` — today step 6 attaches compat/vis **only** for candidates present in
  `trace.build_trace.all_variants`, i.e. ≤k, which is exactly the H48 tail) to compute
  compat/vis for **every candidate carrying a Step-5 breakdown — `trace.rank_audit.scored` ∪ the
  Step-4-passing variant-cap losers in `.filtered`** (the headline set below; the scoreTrace surface must
  be uniform: breakdown ⇒ compat/vis, or the corpus rows are unevenly explainable), calling the `outfit_scorer` over
  `(ro.slot_map, items_by_id, request)` with `items_by_id` built from `trace.prompt_pool`. Shown-candidate
  values are unchanged (same pure functions). Wire it as a
  `build_snapshot_payload(..., outfit_scorer=cold_start_scorer)` param. **M5 invariant:** the cold-start
  occupant returns finite non-null `[0,1]` compatibility **and** visibility for every scored candidate; a
  future scorer that lacks visibility must use the cold-start visibility fallback before writing.
  **The closed M3 `rank()` public
  output is untouched → its M0–M3 golden tests stay byte-identical.**
- **H48 *headline*: DECIDED — store (option (a)).** `rank_with_audit` files **variant-cap-dropped
  candidates** in `.filtered` with **no `ScoreBreakdown`** (verified `ranker.py:933`/`:994-998`) though the
  cap sorted them by `-score`. M5 preserves the losers' Step-5 breakdown by re-running `_score_candidate`
  over Step-4-passing `filtered` candidates inside `rank_with_audit` (deterministic, additive trace field;
  `rank()` untouched; `rank_with_audit`'s `scored`/`result` unchanged). **Corrected recoverability
  rationale (trap-guard — why option (b) was rejected):** the Step-5 breakdown depends on the
  `RankerContext` behavioral signals (`item_affinity`, `liked_full_signatures`, dislike windows), which
  the snapshot does **not** store verbatim — offline recovery would mean re-running reducers as-of
  `createdAt` across reducer-version, window-constant, and scan-limit drift. "Deterministically
  recoverable" is true only for compat/vis (pure content functions); it fails for Step-5 the moment live
  feedback exists. Storage cost: 7 floats per loser, ≤ ~6KB at the 40-candidate ceiling — nowhere near the
  raw caps (`GenerationSnapshot.ts:27-29`).
- **Persist the reduced behavioral context (cheap audit-proofing, C4):** record the reduced
  `RankerContext` signal collections (affinity map, liked sigs, windows — small, bounded by §H) in
  `diagnostics.ranker` (`Mixed`, additive) so *every* stored score is recomputable from the row alone —
  exact off-policy context for M6, no reducer re-runs.
- **Reserve the order-influence hook for M6 (stated, not silently dropped).** For the trained scorer to
  change **rank order**, its per-outfit scores ride into the ranker as a **precomputed per-candidate
  compatibility signal on `RankerContext`** (mirroring how `item_affinity` is precomputed by the caller and
  consumed additively — **preserving item-blindness**). Additive, landed at M6 when trained scores exist
  (ranking on cold-start compat at M5 would both change shipped behavior and rank on a weak signal).
  M5 writes `scorer.kind="cold_start"` and `available=true` only on rows where at least one candidate
  actually received `scoreTrace.compatibility/visibility`; no-candidate / no-scoring rows stay false.
- **`scorer` block semantics (pinned — the schema names the fields but nothing pins the referent,
  verified spec §15.1:768 + `GenerationSnapshot.ts:311-322`, and there are now TWO scorers in play):**
  the snapshot `scorer{kind, modelId, available}` block is the **outfit/rank-scorer provenance axis**
  (this H28 seam), and `available` means **"an `OutfitScorer` occupant was exercised over this render
  and populated `scoreTrace.compatibility/visibility` for all scored candidates"** — explicitly NOT
  "influenced rank order". Rank-order influence is readable only from `kind="trained"` (+ the M6
  `RankerContext` signal recorded in `diagnostics.ranker`); an M6 corpus reader must never infer order
  influence from `available` alone. The **sampler** `SignalScorer`'s state (the §B
  `AffinitySignalScorer`) lives in `diagnostics.scorerAvailable` + the per-type `selection_kind` —
  never in the `scorer` block. The C4 producer exercise flips it to `true` only for rows with actual
  scored candidates; not-enough-items and parse-fail rows remain `available=false`. Pin this semantic
  into spec §15.1's field list at the C4/C5 doc-reconciliation.
- **Honest tradeoff (say it, don't paper over it):** the §5 "trained scorer swaps in with no other code
  change" ideal collides with the ranker's deliberate item-blindness. M5 lands the *type* + a *real
  exercise* (both H48 instances stored → corpus complete); M6 adds the additive `RankerContext` order
  signal — additive, and correctly timed (you don't rank on scores you don't have).

**Decision basis (substitute dual-read per CLAUDE.md):** the seam locus, order-vs-trace-only timing, and
the H48 store-vs-recover call were made by two independent converging passes — the 2026-07-06 `/spec`
session and the 2026-07-06 targeted senior eval (both source-grounded). No separate C4 Fable read is
scheduled; escalate only if implementation surfaces a new seam-shape question.

**Acceptance:** `scoreTrace.compatibility/visibility` populated for **all** scored candidates (a
scored-but-unshown candidate carries non-null compat/vis — the H48-sibling mutation test); a
variant-cap-dropped candidate carries its Step-5 breakdown **and non-null compat/vis** (the H48-headline
test — uniform surface); `diagnostics.ranker`
carries the reduced signal collections; a golden test asserts the closed M3 `rank()` output byte-identical.

## F. Lens adapter table (H58 — authored nowhere before; parallel to §15.2)

The M5 request adapter maps the deployed request → the service `lens` object. Item-field renames are §15.2;
this is the **Lens half**.

| Service `lens` field | Deployed source | Transform |
|---|---|---|
| `sessionId` | verified Firebase user id | Next-derived inside the auth boundary; never accepted from the browser. It feeds `RenderRequest.session_id`, `session_seed`, `candidate_cache_key`, and `GenerationSnapshot.sessionId`. |
| `occasion` | `eventDescription` / occasion text | verbatim, **trim-check** (whitespace-only `"   "` PASSES Mongoose `required`, verified pre-flight lane 4 — the adapter must **reject** it as `contract_invalid`, never trim-and-proceed, else a blank-occasion snapshot; matches the edge-case table) |
| `weather` (bucket) | `getWeatherContext` raw → bucket | R5 bucketing: temp/condition → `hot|mild|cold|indoor|outdoor`. Refactor the adapter/helper to return `{weatherBucket, weatherRaw}`; the legacy `TemperatureHint` union is byte-identical to the Mongo enum (pre-flight lane 3) so straight wiring is safe; **un-bucketed raw throws Mongoose enum on write** → bucket *before* the payload is built |
| `weatherRaw` / `location` | raw weather / geo | pass-through (nullable) |
| `intent` | route + request shape | `/recommend` daily flow → `"daily"`; a forced-item rescue request → `"rescue_item"` (routing rule — the one route dispatches on the presence of `forcedItemId`) |
| `forcedItemId` | rescue request | pass-through; **required iff `intent="rescue_item"`** (mirrors `RenderRequest`) |
| `seedDate` | server clock | **required UTC** `YYYY-MM-DD` (H8) — identical string computed Next-side and passed in (the service does not read a clock; determinism); missing/null is `contract_invalid` |
| `constraints` | request knobs | **M5 defers constraints behavior.** The adapter sends `{}` and rejects any non-empty request map before the service call; the service independently rejects non-empty maps too. H36 becomes engine-active only when prompt/ranker/key semantics are implemented together. |

**Wire-validation (R12 part 2):** this adapter is the trust boundary — non-empty ids/strings, tag-container
shape, one predictable error channel; **reject invalid Lens/request fields before any service call or write,
and never let Mongoose become the first validator mid-write.**

## G. Schema additions (`fitted/models/GenerationSnapshot.ts`)

Six concrete schema changes — **four new fields/field-groups** (`parentSnapshotId`, `engineFailure`,
`controls`, and the **generator-provenance additions** — item #6: `maxCompletionTokens` +
`apiSurface`/`responseFormat`/`reasoningEffort`/`storeMode`/`promptCacheRetention`/
`timeoutSeconds`/`maxRetries`/`finishStatus`, §A.6), **one existing-field tightening**
(item #2, `requestId`, which exists today as optional/unvalidated **and becomes `required`** — §C.4/F7),
and **one delete guard** (item #3, middleware, not a field); the model is otherwise
M4b-complete:

```ts
// 1. Lineage pointer (C5 — does NOT exist today; verified absent):
parentSnapshotId: { type: Schema.Types.ObjectId, ref: "GenerationSnapshot" }, // null on root renders
// serde: add parent_snapshot_id ↔ parentSnapshotId to snapshot_serde._ID_KEYS (ObjectId→string opacity, H10)

// 2. Render idempotency (§C.4 / H50 / F7 — requestId exists today as optional/unvalidated; M5 makes it
//    REQUIRED. Safe because every M5 write carries it (first render + re-roll mint client-side; the §D
//    degenerate builder carries request_id) and there are no legacy rows (M4a wipe). `required:true` closes
//    the "document written without the field ⇒ invisible to the partial index" hole at the schema layer,
//    below the app-level validation — defense in depth. C5 must update any M4b fixture/test that creates a
//    GenerationSnapshot without a requestId to supply a valid one):
requestId: {
  type: String,
  required: true,
  validate: {
    validator: (v: string) =>
      v.length <= 64 &&
      (
        /^[0-9A-HJKMNP-TV-Z]{26}$/.test(v) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
      ),
    message: "requestId must be a UUIDv4 or ULID",
  },
},
GenerationSnapshotSchema.index(
  { user: 1, requestId: 1 },
  { unique: true, partialFilterExpression: { requestId: { $type: "string" } } },
);

// 3. Delete guard (H54 — the immutability contract has update/replace/save guards but NO delete guard;
//    verified absent). Redaction (redacted:true) is the only sanctioned removal.
//    Trap-guard (verified against mongoose's own docs, schema.js pre() jsdoc): pre('deleteOne') alone
//    registers QUERY middleware only — Document#deleteOne() needs {document:true}, and
//    findOneAndDelete/findByIdAndDelete fire their own 'findOneAndDelete' hook. All three registrations
//    or the guard has bypasses:
const NO_DELETE = () => {
  throw new Error("GenerationSnapshot is immutable training truth; use redaction, never delete");
};
GenerationSnapshotSchema.pre(["deleteOne", "deleteMany", "findOneAndDelete"], NO_DELETE); // query paths
GenerationSnapshotSchema.pre("deleteOne", { document: true, query: false }, NO_DELETE);   // doc.deleteOne()

// 4. Engine-failure record (§D — strict mode otherwise silently strips the write). G13: `message` is
//    BOUNDED + SANITIZED, and `stage`/`code` are CLOSED sets — a corpus row must never carry a stack trace,
//    a prompt/request body, or a secret (they leak into training truth + logs and can be huge):
//    inside the diagnostics subschema:
engineFailure: {
  type: new Schema(
    {
      // closed vocab (service-enforced; the helper rejects out-of-set values):
      stage: { type: String, enum: ["sample", "generate", "parse", "validate", "rank", "assemble",
                                    "pre_generation", "unknown"] },
      code: { type: String, enum: ["parse_fail", "empty_valid_set", "refusal", "truncated",
                                   "internal_exception", "sampler_error", "ranker_error", "unknown"] },
      // human-readable, but a FIXED-CATALOGUE string keyed by {stage, code} (e.g. "GPT output failed JSON
      // repair") — NO interpolated runtime values. Bounded; forbidden to contain stack frames / prompt /
      // request body / key-shaped substrings.
      message: { type: String, maxlength: ENGINE_FAILURE_MESSAGE_MAX_CHARS }, // = 300
      // structured detail (an itemId, a count) lives HERE, NOT interpolated into `message` — so the message
      // sanitizer never has to reason about a legitimate 24-hex ObjectId (which "looks like" a long hex run):
      detail: {
        type: new Schema(
          { itemId: { type: String }, count: { type: Number } }, // itemId validated as 24-hex ObjectId
          { _id: false },
        ),
      },
      messageTruncated: { type: Boolean, default: false }, // set if the source message was clipped to fit
    },
    { _id: false },
  ),
},
// G13 sanitize (trap-guard — do NOT interpolate runtime values into `message`; that is exactly what makes a
// hex/secret filter fight a legitimate 24-hex `itemId`): the SERVICE picks `message` from a fixed catalogue
// (never `str(exception)`, never raw model text, never a runtime substring) and puts any structured detail in
// `detail{itemId, count}`. The TS helper rejects a `message` that exceeds the cap uncut, contains
// `Traceback`/`  File "`, or matches a key-shaped pattern (`sk-`, or a base64/hex run **longer than 24
// chars** — so a 24-hex ObjectId in `detail.itemId` is never mistaken for a key) as `contract_invalid`.
// `detail.itemId` is validated as a 24-hex ObjectId (not run through the free-text key filter).

// 5. R9 controls (§C.3 — locks scope the pool+prompt, dislikes hard-filter Step-4; the exact inputs
//    that shaped a render MUST be in its row or the corpus can't explain it. Verified absent from the
//    section-B Lens fields today. Python-authored from the SINGLE normalizedControls that also shaped
//    generation (§C.3 F6 — never a raw client echo). PRESENT ON EVERY M5 WRITE: `required:true` + a
//    default so a first/non-regen render stores `{lockedItemIds:[], dislikedItemIds:[]}`, never an absent
//    subdoc (an absent `controls` is indistinguishable from "locks were dropped" — the corpus must state
//    "no controls" explicitly)):
controls: {
  type: new Schema(
    { lockedItemIds: { type: [String], default: [] }, dislikedItemIds: { type: [String], default: [] } },
    { _id: false },
  ),
  required: true,
  default: () => ({ lockedItemIds: [], dislikedItemIds: [] }),
},

// 6. Generation cap + API-surface provenance (service-owned config that changes truncation/parse-fail/
//    candidate distributions — M6 must stratify by it; additive-required is safe pre-first-write, §A.6):
//    inside the generator subschema:
maxCompletionTokens: { type: Number, required: true }, // cap VALUE; `maxOutputTokens` name if Responses
apiSurface: { type: String, enum: ["chat_completions", "responses"], required: true },
responseFormat: { type: String, enum: ["json_schema_strict", "json_object"], required: true },
reasoningEffort: { type: String, required: true }, // e.g. "none"/"minimal" (§A.6)
storeMode: { type: String, enum: ["none"], default: "none", required: true }, // G14 — no OpenAI distillation/evals storage
promptCacheRetention: { type: String, enum: ["in_memory"], required: true }, // §A.6 — M5 rejects extended 24h prompt-cache retention
timeoutSeconds: { type: Number, required: true }, // §A.6 — OpenAI SDK timeout; bounds service spend/latency
maxRetries: { type: Number, required: true }, // §A.6 — OpenAI SDK retries; 0 for M5 live render
// finish status of the run (truncation/refusal detection, §A.6/§D) — optional (a clean run leaves it unset):
finishStatus: {
  type: new Schema(
    { finishReason: { type: String }, status: { type: String }, incompleteReason: { type: String },
      refused: { type: Boolean } },
    { _id: false },
  ),
},
```

**Central TS payload validation helper (H29 — before every `.create()`).** The Mongoose schema accepts docs
a serde payload never produces but a TS writer bug could: `scoreTrace.compatibility/visibility` are plain
`Number` with **no `[0,1]` validator** (verified `GenerationSnapshot.ts:49-50`), and `shownCandidateIds`/`shownFullSignatures`/
`nSurfaced` have no cross-validator. The helper validates: finite numbers; `compatibility`/`visibility ∈
[0,1]`; `candidateId` uniqueness; **exact** shown-set equality, not subset (`shownCandidateIds` and
`shownFullSignatures` equal candidates with `shown=true` sorted by contiguous `shownPosition=0..n-1`, and
`nSurfaced` equals the length); `itemSnapshots[].itemId` uniqueness; candidate `items[]` ↔ `slotMap`
consistency; **every candidate content id** (`items[].itemId` and `slotMap` values, shown or unshown) has a
matching `itemSnapshots[]` row; **`shown[].outfit`-body equality** (when the wire carries it: each shown
variant body equals its bound `payload.candidates[candidateId]` field-for-field — items+roles,
`templateType`, `optionPath`, `risk`, every `styleMove` field, `fullSignature` — §A display-source pin);
**scoreTrace coverage + algebra (G12): the coverage key is "was SCORED", NOT "reached ranking".** A
candidate carries a `scoreTrace` **iff it has a `scoreBreakdown`** — i.e. it is in the ranker's `scored` set
**or** a §E-rescored variant-cap loser. **Trap-guard (verified `snapshot.py:310-326`): `rank_audit.filtered`
candidates get `stageReached="ranked"` + `dropStage="ranker"` but NO breakdown/compat/vis — a candidate
hard-dropped at Step-4 legitimately has no `scoreTrace`, so keying coverage on `stageReached ∈ {ranked,
shown}` would FALSELY reject a valid payload.** For every candidate that **does** carry a `scoreBreakdown`,
the helper requires it **complete**: `compatibility` and `visibility` finite ∈ [0,1] (the §E uniform-surface
guarantee — a scored candidate always gets compat/vis), a `scoreBreakdown` with ALL SEVEN signed terms
present + finite (`base, combo, item, dislike, overuse, repetition, cooldown`, verified `ranker.py:108-114`),
`rankerScore` finite, AND `rankerScore == base+combo+item+dislike+overuse+repetition+cooldown` within a float
epsilon (the N4 exact-sum invariant, `ranker.py:97-100`). A candidate **with** a breakdown that is missing a
term, has out-of-[0,1] compat/vis, or a term-sum mismatch → `contract_invalid`, no write; a breakdown-less
drop is untouched**; **StyleMove/template semantics
(G11): any candidate carrying a `styleMove` is validated exactly — non-blank `moveType` + `oneSentence`,
`changedItemIds` non-empty + unique, **every `changedItemIds` value ∈ the candidate's own `items` ids** (the
H23 `changed_item_ids ⊆ outfit items` invariant re-asserted at the TS boundary, `models.py:160`), and
`templateType` matches the template **derived from `slotMap`** (`one_piece` iff a `dress` slot is set;
`two_piece` iff `top`+`bottom` set) — a styleMove referencing a non-candidate item or a `templateType`
inconsistent with `slotMap` → `contract_invalid`**;
raw-field caps (`RAW_*_CAP_BYTES` + hash + truncation flag). Writes via
`.create()` / pre-allocated-`_id` insert only — **never `bulkWrite`** (bypasses the immutability middleware, verified
`:384-385`). The merge boundary is pinned field-by-field in §G.1 — "the Python payload authors everything
else" was **false as previously written** (the payload lacked five live M5 schema fields) and that class
of gap fails silently.

### G.1 Field-ownership merge boundary (pinned field-by-field)

| Owner | Fields |
|---|---|
| **Python payload — existing** (verified `snapshot.py:135-165`) | `sessionId`, `candidateCacheKey`, `generationIndex`, `intent`, `occasion`, `weather`, `forcedItemId`, `wardrobeVersion`, `seedDate`, `fittedCoreVersion`, `generator{}`, `rankerConfigVersion`, `scorer{}`, `itemSnapshots[]`, `generationAttempts[]`, `candidates[]`, `diagnostics{}`, `shownCandidateIds`, `shownFullSignatures`, `nSurfaced`, `spreadCollapsed` |
| **Python payload — GAINS at C3** (echo-through of the wire request, so the payload stays the single validated artifact; lands with the serde mappings because `build_degenerate_payload` needs them) | `requestId`, `parentSnapshotId`, `weatherRaw`, `location`, `constraints` — plus `diagnostics.engineFailure` (§D). **M5 invariant:** `constraints` is always `{}`; non-empty constraints are rejected rather than stored as inert provenance. **Mechanism:** caller-supplied kwargs on `build_snapshot_payload`/`build_degenerate_payload` (the existing `candidate_cache_key` pattern — "supplied by the caller, M5 knows them", verified `snapshot.py:495+`); `RenderRequest` stays the pure engine request, no HTTP-layer fields |
| **Python payload — GAINS at C4** (authored from `RenderRequest` — engine input, not HTTP echo: locks shape the pool + prompt; dislikes shape the Step-4 hard filter and pre-spend feasibility only unless the future avoid-list prompt lever bumps `PROMPT_VERSION`) | `controls{lockedItemIds, dislikedItemIds}` (empty arrays on non-regen renders). (the **generator provenance block** — `generator.maxCompletionTokens` + `apiSurface`/`responseFormat`/`reasoningEffort`/`storeMode`/`promptCacheRetention`/`timeoutSeconds`/`maxRetries`/`finishStatus`, §A.6 — lands at **C3**; the service authors the whole generator block from its own config + the run's finish status, from its first payload) |
| **TS merge adds — exactly four** | `_id` (= pre-allocated `snapshotId`), `user` (ObjectId), `interactionCountAtRequest`, per-item `evidence{}` |
| **Absent on M5 writes** (nullable B-track fields, no writer yet) | `baseOutfitItemIds`, `routineId`, `lens{}` (styleProfile block) |
| **DROPPED (C4 docket (c) — the `.ts` line removal defers to C5)** | `admittedViaFallbackStage` (`GenerationSnapshot.ts:112`) — an M4b-draft per-candidate field with **no Python writer, no spec §15.1 home, and no planned writer** (unlike the reserved B-track fields, which have future writers). Its signal — which fallback rung the render reached — is already captured render-level in `diagnostics.ranker.fallbackStage`; per-candidate admission-stage tracking would require re-plumbing the closed ranker for negligible corpus value, and a permanently-null field invites a false read. Decision now (doc); the schema-line removal is a `fitted/` edit sequenced with C5's `GenerationSnapshot.ts` §G additions. |

- **Serde:** `parent_snapshot_id` joins `_ID_KEYS` (ObjectId→string opacity, H10). **`request_id` must
  NOT join `_ID_KEYS`** — it is a client-minted plain string token, not an ObjectId. `weather_raw`/
  `location` are standard key renames; **`constraints` is a DATA-keyed map** — serde preserves its keys
  verbatim (the `samplerPerType` convention), never case-converts them. **Already provisioned:**
  `constraints` is registered in `snapshot_serde._OPAQUE_VALUE_KEYS` **today** (verified `snapshot_serde.py`),
  so C3 adds only the payload *field* on `GenerationSnapshotPayload` — it must **NOT** re-register the serde
  key (that work is landed; re-adding it duplicates). `controls.locked_item_ids` /
  `controls.disliked_item_ids` join `_ID_SEQUENCE_KEYS` in both casings (`lockedItemIds`/
  `dislikedItemIds`) so non-string lock/dislike ids fail at the service boundary instead of becoming
  inert or mismatched persisted controls; the request/controls validator also rejects blank string
  elements (they are not real wardrobe ids).
- **Authorship cross-check (helper — G4, HIGH; the payload is authored by the *service*, but Next is the
  authority for the request identity + config, so the helper re-asserts EVERY request-derived / server-owned
  field against the SAME normalized request object Next built, before `.create()`).** A service bug or a
  compromised service that mangles any of these must fail **loud** (`contract_invalid`, no write), never
  silently persist a corpus row that lies about what produced it. Exact-equality checks against the
  normalized request:
  - **Identity/Lens (Next supplied them):** `sessionId`, `intent`, and every Lens field — `occasion`,
    `weather`, `weatherRaw`, `location`, `forcedItemId`, `seedDate`, `constraints` (`== {}` at M5) —
    `wardrobeVersion`, `requestId`, `parentSnapshotId`.
  - **Server-derived control fields:** `generationIndex` equals the value **Next computed** (0 first render;
    ownership-verified `parent.generationIndex + 1` on a re-roll, §C.1 — never the client's), and `controls`
    equals the **`normalizedControls`** Next/service used to shape generation (§C.3 F6 — not a raw echo).
  - **`generator{}` provenance block** equals Next's known service expectation field-for-field — `model` ∈
    allowlist, `temperature`, `maxCompletionTokens`, `apiSurface`, `responseFormat`, `reasoningEffort`,
    `storeMode`, `promptCacheRetention`, `timeoutSeconds`, `maxRetries` — so a service that authored a *different* generator block than it validated on the wire is
    caught (the §A exact-match validates the wire expectation; this validates the *persisted provenance*).
  - **`candidateCacheKey`** cannot be recomputed in TS (it is a Python `seed.py` sha256 over the canonical
    Lens fields, §C.1) — so the helper validates it **structurally** (64-char lowercase hex, non-empty) AND,
    on a **re-roll**, asserts it **equals the parent row's `candidateCacheKey`** (the Lens-chain invariant:
    siblings share the key, §C.1). A first render gets the structural check only.
  This is stricter than the earlier "requestId + parentSnapshotId only" cross-check, which left ~10
  request-derived fields unvalidated — exactly the silent-corpus-lie class this boundary exists to stop.
- **Trap-guard (silent idempotency death):** the §C.4 partial unique index filters on
  `requestId: { $type: "string" }` — a document written **without** the field or with `null` is invisible
  to the index, and malformed/blank strings would become shared retry sentinels if validation were weakened.
  **F7 hardens this at the schema layer:** `requestId` is now `required:true` (§G item #2), so a missing/null
  requestId is rejected by Mongoose `required` **before** it can slip past the partial filter — the `$type`
  filter is kept (defense in depth + it matches the C8 pre-flip index-existence assertion). Even so,
  C5 acceptance must read the written document back and assert a UUIDv4/ULID, never trust write-success.

**Acceptance:** jest — delete guard rejects **all four delete paths** (`Model.deleteOne`/`deleteMany`,
`doc.deleteOne()`, `findOneAndDelete`/`findByIdAndDelete`); the helper rejects each invalid class
(non-finite, out-of-[0,1], dup candidateId, inconsistent/non-contiguous shown set, subset-only shown-set
mutants, oversized raw, shown-identity mismatch §A, **`shown[].outfit`-body divergence from the bound
candidate (swapped-body mutant §A)**, duplicate/missing `itemSnapshots`, candidate
`items`/`slotMap` drift, any candidate item id missing from `itemSnapshots`, missing/null/blank/malformed/
overlong `requestId` on a live write, non-empty `constraints`, **a mismatched authorship field —
`sessionId`/`intent`/Lens/`wardrobeVersion`/`generationIndex`/`controls`/`generator{}`/malformed
`candidateCacheKey` (G4)**, **a SCORED candidate (one carrying a `scoreBreakdown`) with incomplete/out-of-[0,1]/bad-sum `scoreTrace`
(G12), while a Step-4-`dropStage="ranker"` breakdown-less drop is NOT required to carry one**, **a `styleMove` referencing a non-candidate item or a `templateType` inconsistent with `slotMap`
(G11)**, **and an `engineFailure` with an over-long/stack-trace/secret-shaped `message` or an out-of-set
`stage`/`code` (G13)**); `parentSnapshotId` round-trips through serde as an opaque string; controls
id arrays reject non-string elements through serde and blank elements through request validation; two
concurrent same-`{user,requestId}` `.create()`s yield one document + a caught `E11000`; **a written document read
back carries every §G.1 echo-through field** (`requestId`, `parentSnapshotId` on re-rolls, `weatherRaw`/
`location`, and `constraints:{}`), **`controls` present on every write (empty arrays on a first render,
populated + matching the `normalizedControls` that shaped generation on a regen child),
`generator.maxCompletionTokens` + `apiSurface`/`responseFormat`/`reasoningEffort`/`storeMode`/
`promptCacheRetention`/`timeoutSeconds`/`maxRetries` (§A.6; `finishStatus` when abnormal)
on every write, and `diagnostics.engineFailure` on a degenerate write**.

## H. Reducers (H19 repetition-window; H11 feedback-dedup; the behavioral projections)

Pure functions the **service** runs over the **raw `behavioralRows`** Next passes in (§A) — Next fetches the
rows from Mongo, the service reduces them (the reducers are Python). They produce `RankerContext`'s
pre-reduced signal fields (verified names): `item_affinity: Mapping[str,int|float]`,
`liked_full_signatures: frozenset[str]`, `shown_full_signatures: Sequence[str]`,
`recent_disliked_base_keys`, `recent_disliked_item_ids` — plus the sampler's `AffinitySignalScorer` (§B).
(`contextual_disliked_item_ids` / `locked_item_ids` come from the request `controls`, never the reducers.)
**Serialization pin:** `behavioralRows` crosses the service boundary as verbatim camelCase JSON, with no
`snapshot_serde` snake↔camel conversion. Next serializes ObjectIds to hex strings and Dates to ISO-8601
strings before POSTing; numeric epoch timestamps are not accepted (milliseconds vs seconds would silently
change the dedup window).

- **Action → signal mapping (pinned; the reducers' contract):**

  | Interaction row | Signal contribution |
  |---|---|
  | `action="accepted"` | `item_affinity` **+1 per outfit item** (after dedup, below); `fullSignature` → `liked_full_signatures`. **Proxy boundary:** accepted = explicit approval/like, NOT proof the outfit was worn. |
  | `action="rejected"` | `baseKey` → cooldown buffer (most-recent distinct `COOLDOWN_BUFFER_SIZE` base keys); **disliked item ids = `perItemFeedback[].itemId` where `disliked=true` ONLY** — an outfit-level dislike never marks every item (a wrong-vibe outfit ≠ five bad garments) |
  | `saved`/`worn`/`rated`/`planned`/`packed`/`corrected`/`generated` | **excluded from v1 reducers** — §16 keeps them distinct outcome/event labels with `[NEXT]` weights; registered here so the exclusion is a decision, not a silent drop or an invitation to reinterpret `accepted` as `worn` |

- **Bounded scan (no unbounded read anywhere).** `interactionRows` are fetched last-`INTERACTION_ROWS_SCAN_LIMIT`
  by `{user, createdAt: -1, _id: -1}` (deterministic same-millisecond tie-break; index exists,
  verified `OutfitInteraction.ts:106`; default **500**, tuned at
  C2), projected to `{action, createdAt, snapshotId, candidateId, baseKey, fullSignature, items,
  perItemFeedback.itemId, perItemFeedback.disliked}` — nothing else crosses the wire. **Deliberate
  semantic:** affinity/liked-sigs become recency-scoped rather than lifetime (clamped at `MAX_AFFINITY=20`
  anyway) — decided, not accidental. Unbound legacy-shaped rows (no `snapshotId`) are skipped by the
  reducers (the M4a wipe means none exist, but the guard is one line).
- **Repetition-window reducer (H19, §15.1/§14.5).** Read the user's most-recent `REPETITION_WINDOW_SNAPSHOTS`
  snapshots **with `nSurfaced > 0`** by `{user, createdAt, _id}` (most-recent-first; `_id` tie-break),
  bounded scan, walk `shownFullSignatures` most-recent-first, dedup keeping first, truncate to
  `REPETITION_WINDOW_SIZE` (**the shipped M3 ranker sig-cap `=10` in `config.py` — NOT a new reducer
  constant; distinct from `REPETITION_WINDOW_SNAPSHOTS=50`, the number of snapshot docs read**). Output an
  **ordered `Sequence[str]`** (the ranker normalizes to a tuple), **not a
  set**.
- **Feedback-dedup reducer (H11, §16).** The `item_affinity` counted projection collapses rows sharing
  `{snapshotId, candidateId, action}` within `FEEDBACK_DEDUP_WINDOW` to one counted event. Missing or
  unparsable `createdAt` is fail-closed and treated as duplicate for counted projection. Set/recency
  projections (`liked_full_signatures`, cooldown) are idempotent under duplication — no dedup. Interaction
  writes are **append-only** (§I).
- **Constants (Appendix B trap-guard — mechanism pinned):** `REPETITION_WINDOW_SNAPSHOTS`,
  `FEEDBACK_DEDUP_WINDOW`, `INTERACTION_ROWS_SCAN_LIMIT` are **reducer** config with their **own
  provenance axis**. Mechanism: the constants live in **`reducers.py` itself** (their own module
  namespace) with a `REDUCER_CONFIG_VERSION` auto-hash digest over *that module's* `UPPER_SNAKE` globals
  (same `_compute_*` pattern as `config.py:171-190`), including the public action-mapping constants
  `COUNTED_ACTIONS` / `REJECTED_ACTION`; **`config.py` is not touched** — its
  `RANKER_CONFIG_VERSION` hashes *every* `UPPER_SNAKE` global in its module with only a two-name
  exclusion set (verified), so placing reducer constants there folds them into ranker provenance (a
  scan-limit tune would shift `rankerConfigVersion` though ranking never changed). Record
  `reducer_config_version` **inside `diagnostics.ranker`** (Mixed — no schema change) alongside the §E
  persisted signal collections, so every stored signal carries its reducer provenance.

**Acceptance:** pytest — the repetition reducer is recency-faithful + dedup-correct + window-bounded; the
dedup reducer collapses in-window retries but counts genuine repeats; missing/unparsable `createdAt`
rows never count `item_affinity` but still contribute idempotent `liked_full_signatures`; the affinity/cooldown projections
match hand-computed golden rows **per mapping-table line** (an `accepted` row boosts, a `rejected` row
cools the baseKey and dislikes only per-item-marked ids, a `worn` row contributes nothing); the scan bound
is enforced by reducer slicing (rows beyond `INTERACTION_ROWS_SCAN_LIMIT` /
`REPETITION_WINDOW_SNAPSHOTS` contribute nothing; C5 owns DB fetch-limit + sort/tie-break tests); an unbound row is skipped.

## I. Trust-boundary gates (D4 — close all §19)

- **Feedback-authenticity gate + append-only interactions (H11/§16) — the route contract and its UI
  callers move atomically (both land at C6; the dashboard posts `{itemIds, action}` and history calls
  PATCH/DELETE today, so rewriting the route alone strands them).** `interactions/route.ts`: bind to
  `{snapshotId, candidateId}`; **server re-read** the candidate from the snapshot (never trust echoed
  content); reject `candidateId ∉ shownCandidateIds` and `perItemFeedback.itemId ⊄` candidate items; enforce
  ownership. **Persistence source pin (the re-read is for *writing*, not just validating):** the client
  sends only `{snapshotId, candidateId, action, perItemFeedback?, feedbackReason?}`; the row's `items`,
  `baseKey`, `fullSignature`, and occasion context are **derived server-side from the re-read candidate +
  its snapshot** and persisted from that derivation — never from a client echo. These are exactly the
  fields the §H reducers consume (`item_affinity`, `liked_full_signatures`, cooldown keys); persisting
  client-supplied values would let a forged POST poison the behavioral layer even with the binding checks
  passing. (Today's POST persists client `itemIds` verbatim — verified `route.ts:161-167` — and the
  schema requires `items`, so the derivation is mandatory, not optional.)
  - **Action allowlist — M5 accepts only `accepted|rejected` (G8).** The `OutfitInteraction.action` enum has
    9 values (`generated|accepted|rejected|saved|worn|rated|planned|packed|corrected`, verified
    `OutfitInteraction.ts:30-41`), but only `accepted`/`rejected` are consumed by the §H v1 reducers and only
    those two have a real M5 UI surface (like/dislike). `accepted` is the M5 approval proxy, **not**
    a worn-outcome label; when `worn`/`saved`/`rated` get real surfaces later they remain distinct events in
    the corpus. The C6 POST **explicitly allows only
    `{accepted, rejected}`**; any other value → stable `400 invalid_action`, **no row** — the other seven stay
    schema-reserved until a real surface exists (planned/packed = the routine/packing B-track; saved/worn/
    rated = later). Without this, a forged POST could write `worn`/`corrected` rows the reducers silently
    ignore but that still pollute the corpus + the `{user, items}` index. Test: each disallowed action → 400,
    no write; `accepted`/`rejected` → written.
  - **Feedback item-ref ObjectId seam (G10).** `OutfitInteraction.items` and `perItemFeedback.itemId` are
    `ObjectId` refs to `WardrobeItem` (verified `OutfitInteraction.ts:26/:5`), while the snapshot candidate's
    `items` carry **string** itemIds. The route derives `items` from the **re-read candidate** and, per id:
    (1) it is a well-formed 24-char ObjectId hex, (2) it appears in the re-read candidate's own item set
    (⇒ in the snapshot's `itemSnapshots`, which are the user's owned wardrobe at generation time — so
    ownership is inherited from the authenticated snapshot, not re-queried), and (3) `perItemFeedback.itemId`
    ∈ that same candidate item set (the existing `⊄ candidate items` reject, now also ObjectId-hex-validated).
    A non-hex / non-candidate / cross-snapshot itemId → `400`, no row. **Fixtures use real 24-hex ObjectId
    strings** (a placeholder like `"item1"` would pass a lax test but fail the real `ObjectId` cast at write).
  Make writes **append-only** — corrections are new events, not `findOneAndUpdate`/
  `findOneAndDelete` (verified present at `:313`/`:260` — both handlers removed); write via `.create()`/
  `.save()` so the co-presence `pre('validate')` guard fires (verified it does not fire on
  `findOneAndUpdate`). **The Gemini `inferredWhy` write-back is deleted with the route rewrite** (decided
  2026-07-06): `interactions/route.ts:211` mutates a row post-insert (`findByIdAndUpdate`) against the
  append-only posture, and the field is **write-only dead weight** — grep-verified no UI or API consumer
  reads it (the GET response never returns it). The `inferredWhy` column stays (historical rows harmless,
  additive schema); `lib/gemini.ts` + the `GEMINI_API_KEY` env row go at C8 with the legacy deletion. The
  structured `FeedbackReason` channel (§16) is the "why" home, and C6 gives it an explicit schema home
  (never `metadata`, never `inferredWhy`):

  ```ts
  const FEEDBACK_REASON_CODES = [
    "good", "neutral", "bad", "too_boring", "too_much", "not_practical",
    "not_me", "wrong_context", "weather_forced", "necessity", "too_repetitive",
  ] as const;
  const FEEDBACK_REASON_RAW_TEXT_MAX_CHARS = 500; // same route cap as perItemFeedback.notes

  const FeedbackReasonSchema = new Schema(
    {
      codes: [{ type: String, enum: [...FEEDBACK_REASON_CODES] }],
      rawText: { type: String, maxlength: FEEDBACK_REASON_RAW_TEXT_MAX_CHARS },
      source: { type: String, enum: ["user"], default: "user" },
    },
    { _id: false, timestamps: false },
  );

  feedbackReason: { type: FeedbackReasonSchema, default: undefined },
  ```

  The route validates/dedupes `feedbackReason.codes` against the closed §16 set, caps `rawText` at 500
  chars, and writes the subdocument only when at least one code or non-empty `rawText` exists; bad codes are `400`, not
  silently dropped. M5 reducers ignore `feedbackReason` in v1 (the action table in §H stays authoritative);
  future training can read structured `codes`, while `rawText` stays provenance until reviewed/compiled
  (§23-H34). **Scope the GET populate** —
  `.populate({path:"items", select:"name category colors imagePath"})` (verified `:67-71`) is the §19
  cross-user read primitive: add a `match:{user:userId}` or validate `items` ownership on POST (verified POST
  persists client `itemIds` with no ownership check, `:161-167`).
- **Retained-route auth (verified real).** `account/route.ts` (trusts body `firebaseUid`, no header verify) ·
  `auth/sync/route.ts` (body UID, no ID-token check) · `images/[imageId]/route.ts` (serves bytes, no
  ownership) · `cv/infer/route.ts` (no auth/rate-limit/size-cap). Gate: verify the Firebase token, derive
  identity only from it, enforce ownership, authenticate + rate-limit CV.
  - **C7 STATUS (2026-07-08):** `account` + `auth/sync` now derive identity ONLY from the verified token
    (body `firebaseUid` ignored; token-derived uid/email; behavioral tests in `retainedRouteAuth.test.ts`);
    `cv/infer` requires auth + a 10 MiB size cap + a per-user in-process rate ceiling (`lib/rateLimit.ts`).
  - **✅ CLOSED (images-route ownership — Firebase session cookie, 2026-07-08).** The image bytes are
    rendered by `<img src="/api/images/<id>">` tags, which cannot carry an `Authorization: Bearer`
    header — so ownership is enforced via a Firebase **session cookie** (the browser attaches it
    automatically on same-origin requests). Chosen over signed URLs: smaller blast radius (no change to
    any image-URL producer / the frozen C5 projection / the Python-authored `engineVisible.imageUrl`).
    Mechanism: `POST /api/auth/session` mints an httpOnly session cookie from a fresh ID token
    (`adminAuth.createSessionCookie`); `lib/session.ts` `verifySessionCookieUser` verifies it LOCALLY
    (`verifySessionCookie(cookie, checkRevoked=false)` — no per-image Firebase round-trip) → the Mongo
    user; the images route then serves iff `WardrobeImage.user === user` (a non-owner → `404`, existence
    not revealed; missing/invalid cookie → `401`; malformed id → `400`). Cookie minted at sign-in/sign-up
    + in `AuthGate` (freshness-gated, awaited before owner-only images render) and cleared on logout
    (`lib/sessionCookie.ts`). Behavioral test: `tests/imagesRouteOwnership.test.ts`. Registered follow-up
    (not built): `checkRevoked=true` for immediate logout-revocation, at the cost of a backend call per
    image.
- **Route rewrite guards.** `locked ∩ disliked ≠ ∅` preflight (H59 — §C.3; stable 400/409, no
  empty-success); **the §C.1 lineage gate** (parent ownership re-read; server-derived Lens +
  `generationIndex` — client lineage claims are never trusted); clamp all body-controlled text/array
  fields (H60/D6) — Next-side, **duplicated service-side per §A**.
- **Client-side state gates.** Namespace `fitted_dashboard_state` by uid + clear on logout (verified global
  key `:52`, restored `:637`, not cleared `:666`); fix redirect-before-sync (`RedirectIfAuthenticated`);
  fix `AddItemModal` save-loss (closes on failed save, `:403`/`:1342`); return stable 400s on malformed ids;
  **C6 already owns the load-bearing render state**: Generate disabled while a render is in flight +
  `requestId` minted per action + **the durable pending-render envelope that survives a reload/lost response
  (§C.4 F10)**.

**Acceptance:** jest per gate — unauth/cross-user requests rejected; POST-then-GET no longer leaks a victim
item; a contradictory lock set 400s; a double-tap feedback may append two rows but is one reducer-counted
affinity event inside `FEEDBACK_DEDUP_WINDOW`; the PATCH/
DELETE interaction handlers are gone (405/404); no code path updates an interaction row post-insert;
**a POST echoing forged `items`/`baseKey`/`fullSignature` persists the server-derived values, not the
echo** (read the row back); `feedbackReason.codes` valid values persist, invalid values 400, and `rawText`
is capped + stored only in the structured subdocument; **an `action` outside `{accepted, rejected}` → `400
invalid_action`, no row (G8); a non-ObjectId-hex or non-candidate `items`/`perItemFeedback.itemId` → `400`,
no row, and fixtures use real 24-hex ObjectId strings (G10)**.

## Build ladder (checkpoints)

Light build-and-audit loop per checkpoint (read real files first, implement, `pytest`/`tsc`/`eslint` on
touched, one fresh-context review agent). **Heavy loop before C5 (first live write) and at C8 (flag flip /
legacy deletion)** per CLAUDE.md.

> **✅ C1+C2 COMPLETE, including the 2026-07-07 reopening against this hardened spec.** The original build
> (commits `b2877b85`+`2ef165c6`) plus the reconciliation pass landed: the `DAILY_MAX_CANDIDATES=12` daily
> ask ceiling (§A.6 point 3), the C1 generator core (`strict json_schema` default,
> `reasoning_effort="none"`, `store:false`, `prompt_cache_retention="in_memory"`,
> `max_completion_tokens`, finish/refusal surfaced via `FinishStatus` →
> `GenerationAttemptTrace.finish_status`), and the empirical mutant checks on both daily
> call sites. **✅ C3 COMPLETE (2026-07-07, incl. post-review hardening rounds: service-owned
> `timeout=30s`/`max_retries=0` provenance, blank-imageUrl acceptance + the fly.toml deploy-context pin;
> the §D assembly-failure degenerate arm + the token-cap hard ceiling/floor + the digest-pinned base image +
> explicit service prompt-cache/readiness gates).** C4 is complete below. **✅ C5 COMPLETE** (Next-side
> integration — adapter/client/projection/snapshot write/validation + route rewrite behind
> `USE_ML_SHORTLISTER`; commits through `c1c6cdcc`). **✅ C6 COMPLETE** (`7c469e39` — feedback gate +
> append-only interactions + §6.5 UI contract, daily AND rescue). **✅ C7 COMPLETE** (`e48af7dc` —
> retained-route auth + client-state trust-boundary gates; C8-prep image/email/ownership fixes in
> `326e0d61`). **✅ C8 half-1 COMPLETE** (key-independent legacy retirement, this session): the legacy
> recommender + `regenerate/route.ts` + `lib/gemini.ts` deleted, `recommend/route.ts` rewritten to the
> M5 dispatcher (flag-OFF → `renderDegraded()` §A empty state), the now-unused `openai`/`@google/generative-ai`
> npm deps + `GEMINI_*` env rows removed, and the `OutfitInteraction.action` enum trimmed to
> `accepted|rejected|planned|packed`. Current suite floors: **≥1049 pytest** (`pytest tests service/tests`) /
> **516 jest** (jest rebaselined 546→516: 3 legacy suites removed — 2 pure inline-fakes
> (`feedbackSemantics`/`endToEndRecommendationFlow`, zero production code) + `regenerateExclusion`, which
> drove the now-deleted `regenerate` route (died with its subject, not a fake) — net of added real coverage:
> engineFailure persistence, flag-routing, and `contextDetection` repointed to the live `bucketFromSummary`;
> the disliked-exclusion contract those covered now lives in the controls path, guarded by
> `mlRecommend`/`mlRequestAdapter` tests). Next: **C8 half-2** (the
> live flip — Fly deploy + pre-flip gates + `USE_ML_SHORTLISTER=true` + live-key smoke; needs infra/keys).

**Ladder sequencing invariant (trap-guard — the second-eval High finding, recalibrated for no legacy
users):** at every checkpoint boundary the app must render **and** bind feedback end-to-end in at least
one mode — legacy flag-off through C5; new-contract flag-on from C6 on. Concretely: a server contract
change and its UI callers land in the **same** checkpoint (C6 = interactions route + dashboard/history
rewrite together), and **the flag flips only after the UI speaks the new contract** — never rewrite a route
at Cn and its caller at Cn+2. There is no old-user migration promise: after C6 the UI speaks the §6.5
contract only; legacy code is rollback/reference scaffolding until C8 deletion, not a compatibility target.

#### C1 — Daily orchestrator + generator params (fitted_core) — ✅ DONE (incl. the 2026-07-07 reconciliation)
**Landed:** the intent-generic `render`/`render_with_trace` entrypoints over `RenderRequest`
(`rescue.py`; injection params `signal_scorer=`/`behavioral_signals=` default cold — goldens
byte-identical); the daily prompt builders + the pre-GPT `not_enough_items` short-circuit (§B); the
intent-generic StyleMove drop split (§B taxonomy: daily `dropStage="render"`/`dropReason="stylemove_invalid"`,
rescue codes unchanged); `build_snapshot_payload` intent parameterization (`snapshot.py`); the C1 §A.6
generator core in `generation.py` (strict-schema default, `reasoning_effort="none"`, `store:false`,
`prompt_cache_retention="in_memory"`, `max_completion_tokens`, `FinishStatus` surfacing; C3 service config
constructs the live generator with bounded SDK `timeout`/`max_retries` and records them in provenance);
and **`DAILY_MAX_CANDIDATES=12`** (`config.py`) applied
via `_daily_candidate_requested` in **both** daily paths — hermetic tests inspect
`GenerationPrompt.candidate_requested` (no API call) and both single-call-site revert mutants were run
empirically and fail the suite. *(The **empirical** token-budget validation on real `gpt-5.4-mini` — a
worst-case daily ask completes within `M5_MAX_COMPLETION_TOKENS`, `finish_reason != "length"` — remains a
**C3/pre-C5 gate** (§A.6 point 3), where the key is provisioned; it MUST pass before the C5 first live
write. C1/C2 stayed hermetic.)*

#### C2 — Reducers + AffinitySignalScorer as pure functions (fitted_core) — ✅ DONE
**Landed:** `ml-system/fitted_core/reducers.py` — the §H reducers, `AffinitySignalScorer`, the
action→signal mapping, the `BehavioralSignals` bundle, and the reducer constants
(`REPETITION_WINDOW_SNAPSHOTS=50`/`FEEDBACK_DEDUP_WINDOW=300`/`INTERACTION_ROWS_SCAN_LIMIT=500`) under
their own `REDUCER_CONFIG_VERSION` digest — `config.py` untouched per the §H mechanism pin. Acceptance
held: a reducer-constant bump shifts `REDUCER_CONFIG_VERSION` and not `RANKER_CONFIG_VERSION`
(monkeypatch-verified both directions); every `BehavioralSignals` field is exercised end-to-end through
`RankerContext` (repetition penalty, itemBoost, comboBoost, dislike penalty, cooldown re-admit — one test
per field, so a single-field plumbing drop fails).

#### C3 — Stateless HTTP service (ml-system/service) — ✅ DONE (2026-07-07)
**Landed:** `ml-system/service/` (`app.py` + `config.py` + `tests/` + pinned `Dockerfile`/`fly.toml`/
`requirements.txt`), the §G.1 payload gains on `snapshot.py` (`request_id`/`parent_snapshot_id`/
`weather_raw`/`location`/`constraints` + `DiagnosticsPayload.engine_failure` +
`GenerationAttemptPayload.finish_status` + the §A.6 generator provenance block) with
`build_degenerate_payload` + the `EngineFailure` closed-set/catalogue record, the serde
`parent_snapshot_id` `_ID_KEYS` entry + `variant_to_wire()` §6.5 goldens, and `seed.py
candidate_cache_key()` with golden vectors. Checkpoint-local decisions (all inside the §A license):
- **Framework = hand-rolled minimal ASGI, no FastAPI** (§A sanctions it): two routes with fully custom
  envelopes either way; the hermetic suite stays dependency-free; `uvicorn` (pinned) serves it.
- **C3 controls posture:** any **non-empty** `controls` array → `contract_invalid` until C4 activates the
  regen vertical (accepting locks the engine doesn't yet consume would be an F6 corpus lie); the
  `MAX_CONTROL_IDS` bound is tested now, the at-limit-passes half becomes meaningful at C4.
- **Service-side clamp additions in the G7 spirit** (prompt-reaching item text is spend surface the §A
  table didn't cover): `MAX_SESSION_ID_CHARS=128`, `MAX_ID_CHARS=64`, `MAX_ITEM_NAME_CHARS=200`,
  `MAX_ITEM_TAG_CHARS=60`, `MAX_ITEM_TAGS=25`, `MAX_ITEM_ATTR_CHARS=60`, `MAX_IMAGE_URL_CHARS=2048`;
  behavioralRows lengths are bounded to the §H scan constants; wardrobe item ids are rejected
  pre-spend if they violate the §7/R10 key precondition (`none` sentinel or `:|=` reserved chars). Rate ceiling named:
  `RATE_LIMIT_BURST=5`, `RATE_LIMIT_REFILL_PER_SECOND=0.2` (12/min/instance).
  **⚠ C5 mirror obligation:** the deployed model caps NONE of these (`name` has no maxlength;
  `colors` elements are untrimmed) — C5's adapter/route must enforce the same clamps Next-side
  (filter blank tag elements per §15.2 R12; reject/cap over-long names at ingestion or adapter),
  else a stored-but-over-clamp item makes a closet permanently unrenderable through the service.
- **No-image items are legitimate (deployed-model fact, post-review fix):** `WardrobeItem.imageUrl`/
  `imagePath` are both optional and §15.2 pins the adapter mapping `imageUrl → else imagePath →
  else ""` — the service accepts a **blank** `imageUrl` (field still required + capped; the engine
  never prompts on it, H33) and stores it verbatim engineVisible. Empty tag arrays likewise
  (deployed `[]` defaults; `styleTags` has no column until W-track). Both integration facts are
  pinned by service tests.
- **Deploy context is pinned by construction (post-review fix):** the Fly config lives at
  **`ml-system/fly.toml`** with `dockerfile = "service/Dockerfile"`, so the build context is always
  `ml-system/` (the directory containing BOTH `fitted_core/` and `service/`); `ml-system/.dockerignore`
  keeps `experiments/`/venvs/test assets out of the context. Deploy = `cd ml-system && fly deploy`.
  A CI dry `docker build` joins the C8 Commit-2 workflow.
- **Strict service JSON (post-review fix):** request-body parsing rejects duplicate object keys and
  non-finite constants (`NaN`/`Infinity`/`-Infinity`) before validation/spend. Python's default
  `json.loads` accepts both classes; M5 treats them as malformed JSON, not shape-valid caller data.
- **Service-side `forcedItemId`-absent → `contract_invalid`** (the §D input-validation locus); the
  user-facing `409 forced_item_unavailable` state-conflict arm stays Next-side at C5/C6 (§C.3/G16).
- **Degenerate response flag:** `degenerate = engineFailure present OR (attempts non-empty AND
  nSurfaced==0)`; a pre-GPT `not_enough_items` exit is a valid empty render, never degenerate.
- **§D "every internal failure point" covers the FULL post-validation span (post-review-2 + -3 fixes):**
  the degenerate guard opens at the first statement after validation — a reducer/scorer/
  generator-construction raise on a valid request is a no-attempt `stage="pre_generation"` degenerate
  payload, never a bare 500 with no Next-writable row (cache key + provenance compute first, as pure
  functions of the validated request + service config, so the §G.1 identity set always rides the
  failure row). A `build_snapshot_payload`/shown-zip/serde crash AFTER generation degrades to a
  `stage="assemble"` degenerate payload — `build_degenerate_payload(trace=…)` salvages the real paid
  attempts (raw text + finish status), the `itemSnapshots` engine-visible pool, and the full
  trace-derived diagnostics (`candidateRequested`/`promptItemCount`/sampler/ranker/rescue/scorer),
  each substep behind its own guard; if a salvage substep itself fails, the row still ships with the
  recoverable subset (including the observed `generatorCalls`). Fault-injection tests cover each stage individually, incl. the
  salvage-itself-fails nesting.
- **Spend-envelope bounds come in pairs (post-review-2 + -3 fixes):** `M5_MAX_COMPLETION_TOKENS` is
  rejected above `MAX_COMPLETION_TOKENS_CEILING=10_000` **and below
  `MIN_COMPLETION_TOKENS_FLOOR=2200`** (config + `/readyz` 503, boundary-tested both ends) — a
  fat-fingered Fly secret must neither silently uncap per-request output nor leave the service
  ready-but-unusable with a cap every real render truncates under; the pre-C5 empirical gate re-tunes
  default + floor together. `/readyz` also gates the code-owned §A.6 surface constants
  (`GENERATOR_API_SURFACE`/`GENERATOR_RESPONSE_FORMAT`/`GENERATOR_REASONING_EFFORT`/
  `GENERATOR_STORE_MODE`/`GENERATOR_PROMPT_CACHE_RETENTION` **=`"in_memory"` only**/`OPENAI_TIMEOUT_SECONDS`/
  `OPENAI_MAX_RETRIES`), so a deploy cannot pass health while writing false generator provenance. The Docker base is
  pinned to a patch tag + index digest (`python:3.12.12-slim@sha256:…`), not a mutable minor tag.
- **⚠ C5 schema ripple (trap-guard):** the TS `GenerationAttemptSchema` has NO `finishStatus` path —
  strict mode would silently strip the §A.6 per-attempt finish/refusal provenance the payload now
  carries. C5 must add an optional `finishStatus {finishReason, refusal}` subdoc (`_id:false`) to the
  attempts subschema alongside the §G item-6 generator additions, and read it back in acceptance.

**Touches:** new `ml-system/service/app.py`, `Dockerfile`, `fly.toml`, `ml-system/service/tests/`;
`snapshot.py` + `snapshot_serde.py` (**the §G.1 payload gains: `DiagnosticsPayload.engine_failure` +
the five echo-through kwargs (`request_id`, `parent_snapshot_id`, `weather_raw`, `location`,
`constraints`, plus the §A.6 generator provenance from the service's own config —
`generator.max_completion_tokens` + `api_surface`/`response_format`/`reasoning_effort`/
`store_mode`/`prompt_cache_retention`/`timeout_seconds`/`max_retries`/`finish_status`, §G)
+ their serde mappings incl. `_ID_KEYS += parent_snapshot_id` (the DATA-keyed
`constraints` opaque-key is **already** in `snapshot_serde._OPAQUE_VALUE_KEYS` — C3 adds the payload field
only, not the serde key) — the degenerate builder needs the full identity set, §D**); `seed.py`
(**`candidate_cache_key()` + golden vectors + the stale "M5 cache key" docstring fix, §C.1 — the
service cannot build a payload without it**). **Deliverables:** §A wire contract + auth (two-key) + error envelope
and service-owned `M5_MAX_COMPLETION_TOKENS` (an **ask-sized** cap + a **daily ask ceiling** so the cap holds
the ask, §A.6 point 3 — never a flat 900; both validated on real `gpt-5.4-mini` before C5) config/env exact-match validation
+ **the §A service-side bounds** (generator exact-match validation, service-owned token cap **+ the numeric
input-clamp constants §A/G7**, text/body clamps, rate ceiling **+ the `fly.toml` single-machine pin so the
per-instance token bucket IS the global bound — `min_machines_running=1`, no autoscale, §A**);
**the `GET /readyz` readiness endpoint (§A/G9 — no OpenAI spend, wired as the Fly health check)**;
**pinned runtime/deps (G3): the `Dockerfile` pins a specific Python (landed: a patch tag + index
digest, `python:3.12.12-slim@sha256:…` — a bare minor tag is mutable), and the
service ships a `requirements.txt`/lockfile pinning `openai`, `uvicorn`, and the transitive set to
exact versions (`==`, not `>=`; no `fastapi` — the landed service is minimal ASGI) — a floating `openai`
SDK could silently change the §A.6 params
(`max_completion_tokens`/`reasoning_effort`/refusal shape) under the plan; reproducible builds are
load-bearing for a corpus-producing service. `fitted_core`'s own deps stay unchanged**;
**OpenAI storage/cache/state mode pinned (§A.6/G14): the Chat Completions call sets `store: false`
(no distillation/evals storage; **landed at C1**, `generation.py`) **and** sends
`prompt_cache_retention:"in_memory"` (no extended 24h prompt-cache retention; landed in the C1/C3
foundation hardening after the official-doc re-read); **the OpenAI SDK client sets `timeout=30.0` and
`max_retries=0`** (bounded service latency/spend; official SDK defaults are 10 minutes + two retries).
No `previous_response_id`, no conversation state,
no OpenAI retrieval dependence (and if the Responses API is ever adopted, the same stateless posture must be
pinned on that surface). The chosen modes are recorded in `generator`
(`storeMode:"none"`, `promptCacheRetention:"in_memory"`, `timeoutSeconds:30.0`, `maxRetries:0`)**; `OPENAI_API_KEY` server-side; `/render` calling `render_with_trace` +
`to_wire` + **the §A shown-identity zip (by `full_signature`, candidateId on every shown entry) + the
§A `variant_to_wire()` outfit serializer**; **the §A.6 refusal/truncation-incomplete detection routing a
paid-but-no-JSON run to the §D degenerate payload (recorded in `generationAttempts[]` with the finish
status), never a silent empty and never `contract_invalid`**;
**`build_degenerate_payload(request, failure)`** (§D — carries the §G.1 identity set incl. `request_id`).
**Acceptance:** integration test with a fake
`Generator` — `/render` returns a valid payload+shown with **`shown[].candidateId` equal to
`payload.shownCandidateIds` in order**, **including a fixture where `payload.candidates[]`
(funnel / `source_index`) order ≠ `select_spread` order — i.e. the top-scored shown variant is NOT the
first-generated candidate — so a naïve index-zip of `shown[]` against `payload.candidates[]` would
mis-bind, while the §A `full_signature` zip still binds each `candidateId` correctly** (else the
acceptance can't distinguish the pinned zip from a broken index zip); missing `X-Fitted-Service-Key` → 401; a
disallowed `generator.model`, a `generator.temperature` ≠ the service's configured value, **or
`generator.maxCompletionTokens` ≠ the service's configured cap** →
`contract_invalid` (never clamped); the payload's `generator` block is authored from the service config,
not echoed from the wire; an overlong `occasion` (`MAX_OCCASION_CHARS+1`) / over-bound `wardrobe` / over-size
body / over-long `controls` array → `contract_invalid` and the exactly-at-limit case passes (**G7 boundary
tests**); non-empty `lens.constraints` →
`contract_invalid`; malformed JSON including duplicate object keys or `NaN`/`Infinity` tokens →
`contract_invalid` before spend; **`GET /readyz` returns `200 {"ready":true}` with all config/keys/§A.6 surface constants/versions present and
zero OpenAI spend, and `503` when a required env/config/static generator-surface constant is missing or unsanctioned, without ever returning a secret value
(G9)**; a fake OpenAI client sees `max_completion_tokens`, **not** `max_tokens`, **the configured lowest-available
`reasoning_effort`, `store:false`, `prompt_cache_retention`, bounded `timeout`/`max_retries`, and the structured-output mode (§A.6/G14)**; **a fake client returning a refusal or a
cap-truncated/`incomplete` response → a degenerate payload + snapshot with the finish status recorded (§A.6/§D),
never a silent empty and never `contract_invalid`**; **a duplicate-id wardrobe, a §7/R10 key-invalid wardrobe id,
or another input-validation failure → `contract_invalid` with NO payload** (§D corpus purity — never a degenerate
snapshot); injected
post-generation failure → degenerate payload with attempts; injected pre-generation failure → degenerate
payload with empty attempts + `diagnostics.engineFailure`; the `candidate_cache_key()` golden vectors
pass; the `variant_to_wire()` §6.5 wire-conformance goldens pass (enum values, styleMove, breakdown
keys, object-shaped `items`, `templateType`, and no `template` field). **Dependencies:** C1 (needs `render`) + C2
(the service runs the §H reducers over `behavioralRows`). Set the OpenAI project's monthly budget cap
(dashboard) when the key is provisioned. **Pre-C5 empirical gate (§A.6 point 3, audit-2026-07-07 blocker):**
with the real key, run a worst-case **daily** ask (`DAILY_MAX_CANDIDATES` outfits, real ObjectId ids) and a
worst-case **rescue** ask on `gpt-5.4-mini` and confirm both complete within `M5_MAX_COMPLETION_TOKENS`
(`finish_reason != "length"`, non-empty parseable JSON); if either truncates, lower the ask ceiling or raise
the cap until it fits — this MUST hold before the C5 first live write, else every real render degenerates.
The gate's output re-tunes the **whole spend-envelope trio together** (`DEFAULT_MAX_COMPLETION_TOKENS`,
`MIN_COMPLETION_TOKENS_FLOOR`, and the ask ceiling — one edit in `service/config.py`): the floor is what
`/readyz` enforces against a fat-fingered under-cap, so a gate that raises the default without raising the
floor re-opens the ready-but-unusable hole.

#### C4 — Regenerate vertical + the H28 seam (fitted_core + service) — ✅ DONE (2026-07-07)
Landed hermetically (fake `Generator` only, no live/paid calls): `fitted_core/scorer.py` (`OutfitScore` +
`OutfitScorer` protocol); `response.cold_start_scorer` adapter; the `snapshot._build_candidates` scorer
exercise over every scored candidate (H48 sibling) ∪ the Step-4-passing variant-cap losers (H48 headline,
each carrying its Step-5 breakdown + a `rankerScore == Σ terms` self-consistent score); `ranker.rank_with_audit`
additive `_FilteredCandidate.score_breakdown` (closed `rank()`/`result`/`scored` byte-identical); the §C.3
regen vertical (`RenderRequest.locked_item_ids`/`disliked_item_ids`, `_scope_pool_to_pins` generalizing the
forced-item pin, the prompt lock line, `_drop_missing_locked_items`, dislikes → `contextual_disliked_item_ids`);
the service preflight for the **request-decidable contradictions** (`locked ∩ disliked` + `forced ∈
disliked`; control-id-in-wardrobe; structural co-occupancy feasibility) → `contract_invalid` pre-spend,
while the **closet-can't-complete** case is the engine's pre-GPT `_controls_leave_no_buildable_outfit`
short-circuit → a valid `not_enough_items` empty render (§C.3 request-decidability, Fable); the payload
`controls` field + `diagnostics.ranker` reduced-signals + `reducer_config_version`; serde
`_ID_SEQUENCE_KEYS` (controls) + `_OPAQUE_VALUE_KEYS` (`item_affinity`). Suite floor grew 952 → **987
pytest**; build-and-audit loop converged clean over multiple passes (capped-loser `rankerScore`;
forced-item-disliked preflight; `scorer.available`-only-when-scored; accept-time `styleMove` retention;
`seedDate` required; and the buildability re-categorization to valid-empty). The C4 docket (a–d) is
resolved in §A / §A.6 / §J / §G.1 + spec §15.1. **Original build notes below.**

**Touches:** new scorer module (`OutfitScorer` protocol + cold-start occupant), `snapshot.py`
(`build_snapshot_payload` `outfit_scorer=` param + `_build_candidates` full-scored compat/vis population),
`ranker.py` (H48-headline: attach the Step-5 `ScoreBreakdown` to variant-cap losers in
the `rank_with_audit` trace — the closed M3 `rank()` is **not** touched), `response.py` (cold-start scorer
adapter), `rescue.py`/service (the §C constrained fresh-gen regenerate: lock-scoped pool + prompt pin +
post-validate lock drop + **the three-check preflight incl. structural feasibility, §C.3**),
`snapshot.py`/`snapshot_serde.py` (**payload gains `controls` — authored from `RenderRequest`'s new
locked/disliked fields — + serde mapping incl. `_ID_SEQUENCE_KEYS` for `lockedItemIds`/`dislikedItemIds`,
§G.1**),
`diagnostics.ranker` signal + `reducer_config_version` persistence (§E/§H). Post-C4 hardening requires
locked/disliked ids to be live wardrobe ids and makes `seedDate` required at the service boundary; routes a
closet-can't-complete control set to the **engine's valid `not_enough_items` short-circuit** (no spend, a
snapshot row is still written — never a `contract_invalid`, §C.3 request-decidability); records
`scorer.available=true` only when scoring actually populated a candidate trace; and keeps an accepted
candidate's validated `styleMove` even when it is later dropped by Step-4/diversity filters. (The §G.1 echo-through
payload fields + serde mappings + the `candidate_cache_key()` helper landed at C3.) **Deliverables:** §C
(pins 1–3, 5) + §E. **Acceptance:** §C + §E. **Dependencies:** C1, C2
(`REDUCER_CONFIG_VERSION` for the diagnostics record), C3.

#### C5 — Next-side integration  [HEAVY AUDIT before + after] — ✅ DONE
**Touches:** `fitted/app/api/recommend/route.ts` **rewritten in place** (one route; same path as the
legacy file — flag-on → the M5 vertical, flag-off → the legacy behavior, **extracted to a clearly-named
legacy module** (e.g. `fitted/app/api/recommend/legacy.ts`) called from the flag-off arm, so C8 commit 2
is a module deletion + one-line arm removal, never a surgical excision of the live route), `fitted/lib/`
request adapter + service client, `fitted/models/GenerationSnapshot.ts` (§G additions incl. the partial
unique index), `fitted/lib/` payload-validation helper. **Deliverables:** `USE_ML_SHORTLISTER` flag; §F Lens
adapter + §15.2 item map; `snapshotId` pre-allocation; §C.4 idempotency (requestId UUIDv4/ULID validation,
early read-check + `E11000` winner-re-read); service `fetch()` + `SERVICE_TIMEOUT_MS` + the §A new-contract
degraded empty state (§D); central TS validation helper (§G); snapshot
`.create()`; delete guard (§G/H54); no-post-Python-refetch test (H10, including browser `displayItems`
hydration from `payload.itemSnapshots`); regenerate folded into the one route
with **the §C.1 lineage gate** (parent re-read by `{_id, user}`, Lens derived from the parent row,
`generationIndex` computed server-side — never client pass-through); **the §A shown-identity cross-check +
snapshotId attach + display hydration**; **§G.1 read-back assertions**. **Acceptance:** jest — daily + rescue
render write a valid snapshot with `{snapshotId,candidateId}` on variants (zip cross-checked, §A); a
re-roll writes a child with `parentSnapshotId` + its own attempts **and the parent's Lens**; a forged or
cross-user `parentSnapshotId` → stable 404 with no service call; a client-supplied `generationIndex` on
a re-roll is ignored (the child's index is `parent+1` regardless); duplicate valid `requestId` **with
identical render identity** → one snapshot; **a duplicate `requestId` with a *changed* Lens/controls/parent →
`409 request_id_conflict`, no service call, no write (G5)**; missing/null/blank/malformed/overlong `requestId` is rejected before any service call/write;
non-empty `constraints` is rejected; **a fake slow service (past `SERVICE_TIMEOUT_MS`, within `maxDuration`)
→ Next's own timeout fires and returns the §A degraded empty state, discarding the pre-alloc `snapshotId`
(G6)**; **the successful browser response + persisted client state contain none of `payload`/`candidates`/
`rawEmitted`/`generationAttempts`/`diagnostics`/`generator`/`itemSnapshots` (G15 negative allowlist)**;
a degraded arm writes no snapshot and returns the §A degraded empty
state, never legacy `outfits[]`; the
helper rejects each invalid class, including subset-only/inexact shown arrays, duplicate/missing
`itemSnapshots`, candidate `items`/`slotMap` drift, and **any** candidate item id (shown or unshown) missing
from `itemSnapshots`; the browser response carries `displayItems` sourced from `itemSnapshots` **and the
card body (styleMove/risk/optionPath/items) sourced from `payload.candidates[candidateId]`, never
`shown[].outfit`; a swapped-body `shown[].outfit` (matching `full_signature`, differing styleMove) is
rejected `contract_invalid` (§A display-source pin)**; **written documents read back
carry `requestId` + every §G.1 echo-through field** (the idempotency index is dead without them);
`tsc --noEmit` + `eslint` clean on touched.
**Dependencies:** C3, C4, C2.

#### C6 — Feedback gate + append-only interactions + UI contract cutover, **daily AND rescue** (Next) — ✅ DONE
**Touches:** `fitted/app/api/interactions/route.ts` (gate + PATCH/DELETE removal + Gemini write-back
removal), `fitted/models/OutfitInteraction.ts` (`feedbackReason` schema addition; binding fields already exist),
**`dashboard/page.tsx` + `history/page.tsx` (the UI rewrite — moved here from C8 per the ladder
invariant: the dashboard renders legacy `outfits[]` with `itemIds/confidence/reason` and posts feedback
as `{itemIds, action, occasion}` (verified `:24-29`/`:748-752`), history calls DELETE/PATCH (verified
`:143`/`:165`) — route, feedback API, and callers are one contract cutover)**, **plus a rescue launch
surface (F2): the wardrobe view (`(app)/wardrobe/page.tsx`) and/or dashboard gain an item-select →
"rescue this item" affordance — verified NO `forcedItemId`/rescue UI exists in the app today (grep
`forcedItemId`/`rescue` over `fitted/app` returns nothing), so rescue is net-new UI, not a rewrite.**
**Deliverables:** §I feedback gate + append-only + GET populate scoping + `feedbackReason` validation;
**dashboard rewritten to the
§6.5 response + StyleMove card (H45), minting one UUIDv4/ULID `requestId` per Generate action, reusing it
on retries, disabling Generate while a render is in flight, **persisting a durable pending-render envelope
(`{requestId, intent, parentSnapshotId?, normalizedControls, lensSummary}`) in `sessionStorage` before the
fetch and clearing it only on hydrated success or explicit discard so `requestId` survives a reload/lost
response (§C.4 F10)**, and posting `{snapshotId, candidateId}` feedback — **no legacy response
compat branch**; stale persisted dashboard state may be dropped/renamespaced because there are no old
users); **history rewritten append-only** (the remove/move affordances die in the same commit as
PATCH/DELETE — corrections are new events; **card data source: the GET
response server-joins the bound candidate's content — `styleMove`/`optionPath`/`risk`/items — via the
row's `{snapshotId, candidateId}` at read time** (the `{snapshotId, candidateId}` index exists, verified
`OutfitInteraction.ts:107`); no denormalized write, and the join is user-scoped like the populate); the
persisted dashboard state
shape follows the new contract and uses `displayItems` hydrated from snapshot `itemSnapshots` (not legacy
`itemIds`/`confidence`/`reason`); **the StyleMove card body renders from `payload.candidates[candidateId]`,
never a `shown[].outfit` echo (§A display-source pin, F1)**. **Rescue must be user-reachable, not API-only
(F2):** ship (1) an **item-select/launch** entry point — pick a wardrobe item, launch a rescue render that
sends `forcedItemId` on the `/api/recommend` request (the one route dispatches `intent="rescue_item"` on
`forcedItemId` presence, §F); (2) rescue results render the **same §6.5 + StyleMove card** as daily, with
every surfaced outfit containing the forced item (server-enforced §B/§C.3 — the UI just renders it); (3)
**re-roll from a rescue parent** reuses the one re-roll path — the child's Lens (incl. `forcedItemId`) is
derived server-side from the rescue parent row (§C.1), so a rescue re-roll stays a rescue and writes a
lineaged child; (4) **feedback on a rescue outfit binds `{snapshotId, candidateId}`** exactly like daily.
The existing dashboard `RegenerateModal` (locks + `changeTarget`, verified `:390-576`) is rewritten to the
R9 `controls` shape (`lockedItemIds`/`dislikedItemIds`) and drives the same server re-roll for both intents.
*Window note:* from C6, the supported app path requires flag-on
(snapshots must exist); flag-off is rollback/reference only until C8 deletion, not a user-facing UI mode.
**Acceptance:** §I; flag-on — **daily**: dashboard renders §6.5 + StyleMove card, mints/reuses one requestId per
Generate action, disables duplicate in-flight renders, hides feedback controls on the degraded empty
state, and like/dislike posts `{snapshotId, candidateId}`; **lost-response/reload test (F10): a reload
resumes the SAME `requestId` from the persisted pending-render
envelope — a reload *after* completion replays the winner with no second GPT call; a reload *in flight* still
yields exactly one snapshot (index/`E11000`) at the cost of at most one extra generation — and the envelope
clears only after a hydrated success or an explicit discard (never a *new* `requestId`)**; **rescue**: item-select launches a rescue render,
every surfaced outfit shows the forced item, a rescue re-roll writes a lineaged child that keeps
`forcedItemId`, and feedback on a rescue outfit binds + appends; valid structured `feedbackReason` persists through POST/read-back; **no
legacy-shaped response branch and no `itemIds`-bound POST path remain**; history is append-only with no
PATCH/DELETE call sites (grep + jest). **Dependencies:** C5 (needs live snapshots to bind against).

#### C7 — Close remaining §19 gates (Next) — ✅ DONE
**Touches:** `account/route.ts`, `auth/sync/route.ts`, `images/[imageId]/route.ts`, `cv/infer/route.ts`, the
new recommend route (H59/H60), `dashboard/page.tsx`, `wardrobe/page.tsx`, `(app)/RedirectIfAuthenticated.tsx`,
`signin/page.tsx`. **Deliverables:** §I retained-route auth + route-rewrite guards + remaining client-side
state gates (requestId minting/debounce already landed with the C6 UI contract). **Acceptance:** §I.
**Dependencies:** C5 (route rewrite lands there).

#### C8 — Cutover  [HEAVY AUDIT; **two commits**]
> **Re-sequenced into two key-gated halves (2026-07-08).** The plan's original order was flip→delete; it
> was split so the **key-independent deletion lands first**. This is safe here because **this fork is
> undeployed** (production runs the team repo) — there are no live users to serve degraded-empty while the
> flag is still off, and flag-OFF → §A degraded empty state is precisely the post-deletion rollback story.
> - **✅ half-1 — legacy retirement (DONE, this session; no deploy/key):** deleted `regenerate/route.ts`,
>   the legacy module, `lib/gemini.ts`; rewrote `recommend/route.ts` to the M5 dispatcher with an exported
>   `renderDegraded()` for the flag-OFF §A empty state; removed the now-unused `openai`/`@google/generative-ai`
>   npm deps + `GEMINI_*` env rows; trimmed the `action` enum to `accepted|rejected|planned|packed`; migrated/
>   rewrote the legacy tests (deleted 3 legacy suites — 2 inline-fakes + `regenerateExclusion` whose
>   subject route was deleted; repointed `contextDetection` to the live
>   `bucketFromSummary`; rewrote `recommendationStability` to the flag/degraded contract) + added the
>   engineFailure-persistence test. Heavy-audited before commit. **CLAUDE.md env-table:** Gemini row removed;
>   the `OPENAI_API_KEY`→service-side reconciliation (drop the Next row, add `ML_SERVICE_URL`/`FITTED_SERVICE_KEY`)
>   is **owed at half-2** with the flip.
> - **⏳ half-2 — the live flip (REMAINS; needs infra/keys):** everything below (Fly deploy, the pre-flip
>   gates G1/G2/G9 + index-existence + H13 conformance, the daily+rescue mechanical read, `USE_ML_SHORTLISTER=true`,
>   the live-key smoke, the CI workflow YAML). The "Commit 2 — deletion" body below is **already done by half-1**.
>   **Executable checklist:** `docs/plans/m5-c8-half2-runbook.md` (turnkey copy-paste commands, expected outputs,
>   rollback). **Staged ahead (key-independent):** the H13 CI gate (`.github/workflows/conformance.yml`), the
>   `.env.sample` half-2 block, and G2 (OpenAI $10 cap + alert, project `cssEnjbkDMOuCfMqzDuGdtLP`, done 2026-07-08).
>   **F3 mechanical read DONE — BOTH intents (2026-07-08, `gpt-5.4-mini`):** daily (`--intent daily`, built
>   this session) + rescue, run live. Every generating case: parse 1.00, StyleMove 1.00, rescue forced-inclusion
>   1.00; 0 hallucinated/schema rejections (only correct duplicate-dedup); ~$0.16 total. Numbers in runbook §4.
>   F3 is a pre-flip gate satisfied; remaining half-2 = the deploy + flip + live smoke (infra/keys).

**Commit 1 — flip + smoke:** Fly.io deploy; **index disposition (disambiguates m4 §14.5's "autoIndex off
on the M5 service" note — the Python service has no Mongo; Next is the only Mongo client):** keep
`autoIndex:true` + `db.ts` `Model.init()` at M5 (solo scale, near-empty collections — boot-time index
builds are cheap and are what actually creates the §G indexes; verified `mongodb.ts` `autoIndex:true` +
`db.ts` init list); `autoIndex:false` is a **scale-time optimization, registered not built**. **Pre-flip
index-existence check (mandatory):** assert via `listIndexes` on `generationsnapshots` that the
`{user, requestId}` unique index exists in the live Atlas DB with
`partialFilterExpression: { requestId: { $type: "string" } }` before flipping — an absent or stale
`$exists`-only unique index is silent idempotency death / sentinel-collision risk (the §G.1 trap class:
every write succeeds, or bad blank/null writes collide unpredictably);
**cross-runtime conformance (H13) green BEFORE the flip (F8):** both suites (Python + jest) **and** the
seed/serde + `variant_to_wire()` golden-vector conformance check pass in CI before `USE_ML_SHORTLISTER`
flips — the wire contract the flip depends on is validated *ahead* of the flip, not after it. (The CI
*workflow file* may land with the commit-2 cleanup, but the conformance **tests must be green as a pre-flip
gate**; H13 is a flip prerequisite, not a post-deletion deliverable.)
**The pre-flip mechanical read — daily AND rescue, both through the M5 service (F3):** extend the
**Spearhead-C6**/H40 eval CLI to run **both intents** against the running M5 path — the daily intent (new
daily prompt) **and** the rescue intent (rescue prompt) — because M5 stacks two deltas the old H40 numbers
don't cover: **(a) the model changed** (H40 was `gpt-4o`; M5 is `gpt-5.4-mini`) and **(b) rescue now flows
through the new service + §A.6 API surface**, so rescue's numbers are no more transferable than daily's.
~5 runs per intent on the golden wardrobe with the real `gpt-5.4-mini`; **daily gates** — parse rate,
hallucinated ids, schema-rejection rate; **rescue gates additionally — forced-item inclusion** (the forced
item appears in every surfaced outfit) **and StyleMove presence** (no candidate reaches assembly with a
null/malformed move, §B); believability stays descriptive per H40. **Capture the legacy baseline numbers**
(the writeup's "before").
**Three more mandatory pre-flip gates — each a *verified* fact, not a stated intent (audit-2026-07-07):**
- **Fly single-instance proof (G1).** `fly scale show` (or `fly machine list`) confirms **exactly one Machine
  and no autoscale** for the service app before the flip — the §A rate ceiling's "known rate" bound is only
  true single-instance. If the deploy is ever >1 machine, the in-process token bucket is **not** the global
  limiter and a **shared durable limiter is required first** (registered fallback: a Mongo/Redis-backed
  counter; not built while single-instance holds). Paste the `fly scale show` output into the cutover record.
- **OpenAI project budget proof (G2).** A dated manual confirmation records: the **project id**, the **monthly
  budget cap value**, the **alert threshold** (e.g. 80%), and who/when confirmed it in the OpenAI dashboard —
  the hard-backstop is only real once it is *set and screenshotted*, not merely "should be set". No code; a
  checklist line with the four fields filled in.
- **`/readyz` green (G9).** Hit the deployed service's `GET /readyz` and confirm `200 {"ready":true}` (config/
  keys/allowlist/cap/versions all present, zero OpenAI spend) before the flip; a `503` blocks the flip.
flip `USE_ML_SHORTLISTER=true`; live smoke — **the UI already speaks the new contract (C6), so the smoke
exercises dashboard daily + rescue + re-roll + bound feedback end-to-end, not just the route**.
**Commit 2 — deletion:** delete the §19 list — **`recommend/regenerate/route.ts` (whole file) + the
flag-off legacy arm of the rewritten `recommend/route.ts`** (the C5 legacy module + its one-line call
site; **the M5 route file itself is NEVER deleted** — it IS the live endpoint; post-deletion flag-off =
degraded empty state per the rollback story), legacy prompt-weather use (retain/refactor the M5
weather-bucket adapter; do **not** move weather/network work into the Python service), `lib/gemini.ts`, the
string-grep/footwear-inject paths (exact lines in §19; spot-verified pre-rewrite: `inferItemType`
recommend `:472` / regen `:484`, footwear auto-inject recommend `:512-527` / regen `:511-525` — these
live inside the extracted legacy module after C5), **the CI workflow *file* for H13** (the cross-runtime
conformance **tests** were already green as a Commit-1 pre-flip gate — F8; landing the workflow YAML with
the cleanup commit is fine, gating the flip on green tests is the load-bearing part), CLAUDE.md env-table
update (Gemini row removed; `OPENAI_API_KEY` moves to the service).
**Rollback story (pinned):** post-deletion, `flag=false` means **degraded empty state**, not legacy — the
flag's remaining job is service-outage degradation; rollback = git revert of commit 2 + redeploy.
**Deliverables:** cross-runtime conformance (Python + jest + a seed/serde + `variant_to_wire()` conformance
check on golden vectors — non-BMP occasion, None/empty/"0" date, reserved chars; assert no TS seed reimpl
exists, or add the H51 golden-vector test if one does) **— green as a Commit-1 pre-flip gate (F8), the CI
workflow file landing with the Commit-2 cleanup**; the **daily + rescue** pre-flip mechanical read (F3);
legacy deletion; flag flip + live smoke.
**Acceptance:** live smoke — daily + rescue render in the running app, one snapshot per render, a re-roll
writes a lineaged child, append-only feedback binds; flag-off returns the §A degraded empty state; no dead
code paths.
**Dependencies:** C5, C6, C7.

## Edge cases

| Trigger | Behavior | Why |
|---|---|---|
| Service unreachable / timeout / 5xx / auth-fail / rate-limit (no payload) | §A degraded empty state (`shown:[]`, `bindable:false`); **no snapshot**; counter/log; discard pre-alloc `snapshotId` | D3 — no payload reached the writer |
| Engine ran, produced invalid/empty (parse-fail-after-repair, empty valid set) | **Service** returns a degenerate payload (failure in `generationAttempts[]`); Next writes it | D3 — the negative corpus §15.1 wants |
| Request fails service input validation (dup ids, malformed shape, guard raise) | `contract_invalid` envelope; **no payload, no snapshot** — Next logs + counts the caller bug | §D corpus-purity boundary |
| **Internal** engine failure before any generation attempt (reducer/scorer/generator-construction/sampler/ranker bug on a valid request) | Degenerate payload, **empty** attempts + `diagnostics.engineFailure` (`stage="pre_generation"`); Next writes it | §D recording loci — never fabricate an attempt; the guard opens at the first post-validation statement |
| **Internal** assembly failure AFTER a successful render (`build_snapshot_payload`/zip/serde crash) | Degenerate payload with `stage="assemble"` `engineFailure` **and normally** the salvaged real attempts + `itemSnapshots` + trace diagnostics; if a salvage substep itself fails, the row keeps the recoverable subset + observed `generatorCalls`; Next writes it | §D recording loci — both-present is a valid shape, but not the only valid `assemble` shape; money spent, pool + shaping context preserved whenever recoverable |
| Generation ran, response lost in transit | Unrecorded (money spent, no row); degraded response | D3 named residual gap |
| Re-roll (regenerate) | One constrained fresh generation; child snapshot with own attempts, `generationIndex+1`, `parentSnapshotId` | D2 |
| Re-roll with `locked ∩ disliked ≠ ∅` | Stable 400/409 pre-generation, never empty-success | §C.3 / H59 |
| Locked/disliked item no longer in the live wardrobe | Stable 400 (control did not shape the live render, so it is not persisted as if it did) | §C.3 |
| Post-lock/dislike filtering leaves < `n_surfaced` | Honest partial + notice; never a silent lock drop, never a second GPT call | §C.3 / R9 |
| Lock/dislike controls leave no buildable non-disliked outfit before GPT (closet-dependent) | **Valid `not_enough_items` empty render** — 200, snapshot written, **zero generator calls**, `_CONTROLS_UNBUILDABLE_HINT` discriminator; NOT a `400` | §C.3 request-decidability — engine short-circuit, same category as the understocked closet, corpus keeps the self-describing row |
| Double-clicked Generate (same valid `requestId`) | One snapshot (partial unique index); loser returns the winner's shown set | §C.4 / H50 |
| Reload after the render COMPLETED, then retry | Same `requestId` from the envelope → early read-check finds the winner → idempotent replay, **no second GPT spend** | §C.4 / F10 |
| Reload while the render is still IN FLIGHT, then retry | Same `requestId` → **one snapshot** (index + `E11000` winner-re-read), but **one extra GPT generation** runs (early read-check can't see an uncommitted render); bounded by the rate ceiling + monthly cap. The envelope still prevents the worse *new-requestId* double-commit | §C.4 / F10 — the honest bound; a server in-flight lease would close it (deferred) |
| Missing/null/blank/malformed/overlong `requestId` on a live write | `contract_invalid` before service call/write; no shared retry sentinel | §C.4 / §G helper |
| Missing/null/malformed `seedDate` | `contract_invalid`; no service call/write | H8 — daily reseed/key provenance is required, never date-inert |
| Same live `requestId` reused for a DIFFERENT render (changed Lens/controls/parent) | Stable `409 request_id_conflict` — no service call, no write, no wrong-winner replay | §C.4 / G5 |
| Rescue re-roll whose `forcedItemId` was deleted from the wardrobe | Stable `409 forced_item_unavailable` pre-spend; no snapshot; clear UI copy | §C.3 / G16 |
| Feedback `action` outside `{accepted, rejected}` | Stable `400 invalid_action`; no row (other 7 enum values reserved) | §I / G8 |
| Non-empty `constraints` at M5 | `contract_invalid`; no service call/write from Next, and service independently rejects if reached | Constraints are deferred until prompt/ranker/key semantics are engine-active |
| Feedback `candidateId ∉ shownCandidateIds` / item not in candidate | Reject | §16 authenticity gate |
| `feedbackReason.codes` contains an unknown code | Stable 400; no row written | §16 closed structured-reason set |
| Any candidate (`items[]`/`slotMap`, shown or unshown) references an item missing from `itemSnapshots` | `contract_invalid`; no snapshot write, no unrecoverable training row or unhydratable browser card | §A hydration pin + §G helper |
| Raw weather `weatherRaw="72F sunny"` at the adapter | **Bucket** it → `hot\|mild\|cold\|indoor\|outdoor` (a normal transform that always resolves to one bucket); the bucketed value + `weatherRaw` are both carried | §F R5 bucketing — a *successful* render, not a rejection |
| `weather` bucket value outside `hot\|mild\|cold\|indoor\|outdoor` (adapter bug / hostile body) | **`contract_invalid` before generation; no service call, no snapshot** — a caller/adapter bug must surface loudly, never a corpus row | §A input validation / §D corpus purity (relying on the Mongoose enum failing *after* the GPT call is spend leakage) |
| Blank/whitespace `occasion=""` / `occasion="   "` at the adapter | **`contract_invalid` before generation; no service call, no snapshot** — NOT "validate-and-skip". Whitespace-only PASSES Mongoose `required` (pre-flight lane 4), so the adapter/service must reject it explicitly | §A blank-occasion reject / §D corpus purity — a blank-occasion snapshot would be an unexplainable Lens row |
| Daily intent, no forced item | Full-pool sample; daily prompt; no forced-item scoping; real `interaction_count` | D1 |
| Daily closet too small (sampler `not_enough_items`) | Pre-GPT short-circuit: no generator call, `flags.notEnoughItems=true`, valid empty snapshot with engine-visible itemSnapshots written | §B — preserves corpus truth while never spending on an impossible render |
| Large daily closet (`total_base×3 > DAILY_MAX_CANDIDATES`) | Daily render caps the GPT ask at `DAILY_MAX_CANDIDATES=12` (landed C1), so output fits `M5_MAX_COMPLETION_TOKENS` — no truncation; ranker/spread still choose 3 | §A.6 point 3 — the truncation-blocker guard; without it the up-to-40 ask truncates under any sane cap |
| `interaction_count ≥ 5` + non-empty affinity | Sampler signal slot **opens** (`AffinitySignalScorer`); ranker behavioral layer active from §H signals | §B — personalization comes alive on both seams; NOT the trained scorer (M6) |
| Empty affinity / cold scorer (`is_available()==False`, any count) | Sampler `sampler_result` **byte-identical** to cold | R11 — byte-identity is keyed on availability |
| `interaction_count < 5` + **non-empty** affinity (available but below threshold) | Selection **surface** matches cold, but `scorer_available=True` (diagnostic differs — **not** full byte-identity) | §B / `test_render.py::test_unavailable_or_below_threshold_signal_scorers_keep_cold_start_selection` — availability ≠ count |
| Daily candidate with missing/malformed StyleMove | Dropped pre-rank (intent-generic drop); honest partial if `< n_surfaced` | §B — `_assemble_variant` hard-asserts non-null; `None` must never reach assembly |
| Structurally infeasible lock set — *closet-independent co-occupancy* (two locked shoes; locked dress + locked top) | Stable `400` with reason code, **zero generator calls** | §C.3 request-decidable contradiction (a caller bug the client must prevent) |
| Closet-can't-complete control set (locked top with no non-disliked bottom; forced optional + locked top with no bottom; dislikes remove every base from an otherwise-buildable wardrobe) | **Valid `not_enough_items` empty render** — 200, snapshot written, **zero generator calls** (engine short-circuit), never `400` | §C.3 request-decidability (Fable) — closet-dependent, so a valid empty state, not a caller bug |
| Legacy-shaped response after C6 | Unsupported by the UI contract; no compat branch, no feedback post path | No old users; legacy code is rollback/reference only until C8 deletion |
| Wire `shown` ids ≠ `payload.shownCandidateIds` (order/length) | `contract_invalid` at the helper — no write, no mis-bind | §A shown-identity pin |
| `shown[].outfit` body ≠ bound `payload.candidates[candidateId]` (styleMove/risk/optionPath/items) | `contract_invalid` at the helper; the card renders from the **persisted candidate**, never the wire echo | §A display-source pin — `full_signature` is item-ids only, so the zip alone can't catch a swapped body |

## Mutation-hardening (each test must fail a naive mutant)

- Flip `rank()` to read `outfit_scorer` → an M3 golden test must go red (proves the M5 no-order-change guard).
- File a variant-cap loser in `.filtered` with no preserved Step-5 breakdown → the H48-headline corpus-completeness test must fail.
- Drop setting `parentSnapshotId` on a re-roll child → the lineage test must fail.
- Reuse the parent's `generationIndex` on the child → the identity test must fail.
- Remove the `{user, requestId}` partial unique index, change its filter back to `$exists`-only, allow
  missing/null/blank/malformed/overlong live `requestId`, or remove the `E11000` winner-re-read → the concurrent double-write /
  sentinel-rejection tests must fail.
- Accept a wardrobe item id containing a §7/R10 reserved key char (`:|=`) or the `none` sentinel at the
  C3 service boundary → the pre-spend contract-invalid test must fail (never spend and later blame GPT).
- Parse request JSON with Python defaults (accept duplicate object keys or non-finite constants) → the
  malformed-body tests must fail; a hidden `NaN`/duplicate key must never reach generation.
- Remove the `locked ∩ disliked` preflight → the contradictory-controls 400 test must fail.
- Route a pre-attempt engine failure to the no-snapshot arm (or fabricate an attempt for it) → the failure-corpus test must fail.
- Skip the degenerate-payload arm (write nothing on engine-internal failure) → the failure-corpus test fails.
- Move the reducer/scorer/generator construction back outside the §D degenerate guard → the reducer-raise
  fault-injection test must fail (a bare 500 with no payload, zero generator calls).
- Strip the assembly-arm trace salvage (empty `itemSnapshots`/default diagnostics on a `stage="assemble"`
  row with a live trace) → the salvage read-back test must fail (`candidateRequested`/`promptItemCount`/
  `scorerAvailable` must carry trace truth).
- Have C5's snapshot validation reject (or "normalize") a `stage="assemble"` `engineFailure` that coexists
  with **non-empty** `generationAttempts[]`, or reject a last-resort `stage="assemble"` row solely because
  attempt salvage failed and attempts are empty while `generatorCalls>0` → the assembly-shape acceptance
  tests must fail (`assemble` is a valid §D locus, not a contradiction).
- Set `M5_MAX_COMPLETION_TOKENS` to a tiny positive value (floor−1) and have `/readyz` stay green → the
  floor boundary test must fail (ready-but-unusable: every render truncates).
- Remove the `INTERACTION_ROWS_SCAN_LIMIT` bound → the bounded-fetch test must fail.
- Make `AffinitySignalScorer.is_available()` return `True` on an empty map (or call `.score()` when unavailable) → the guard tests must fail.
- Count a `rejected` outfit's unmarked items as disliked → the mapping-table golden test must fail.
- Remove the occasion trim-check → the whitespace-occasion **rejection** test must fail (a snapshot gets written — Mongoose `required` accepts `"   "`; §D wants `contract_invalid` + no write).
- Bucket an invalid `weather` enum instead of rejecting it, or route a blank-occasion/invalid-weather request to a degenerate snapshot instead of `contract_invalid` → the corpus-purity edge tests must fail (§F/§D — these are caller bugs, not engine failures).
- Accept a non-empty `constraints` map → the M5-deferred-constraints test must fail (never store inert
  constraint provenance).
- Pass raw weather text through as `weather` or delete the M5 weather-bucket adapter with the legacy arm →
  the bucket-table / no-service-network tests must fail.
- Remove the GET populate scoping → the cross-user-read test must fail.
- Weaken the payload helper's `[0,1]` check → an out-of-range compat write test must fail.
- Re-add an in-place interaction update (PATCH-style or an `inferredWhy`-style write-back) → the append-only test must fail.
- Remove the intent-generic StyleMove drop from the daily path → the malformed-StyleMove daily test must fail (AssertionError reaches `_assemble_variant`).
- Drop `request_id` (or any §G.1 echo-through field) from the payload/persisted document → the read-back test must fail — and the concurrent-duplicate test, since the partial index no longer matches.
- Reorder the wire `shown[]` (or emit one fewer entry) without touching `payload.shownCandidateIds` → the shown-identity cross-check must fail.
- Emit a `shown[].outfit` whose `full_signature`/items match the bound candidate but whose `styleMove`/`risk`/`optionPath` differ (the swapped-body mutant), or hydrate the card from `shown[].outfit` instead of `payload.candidates[candidateId]` → the body-equality cross-check / display-source test must fail (the `full_signature` zip alone cannot catch this — signatures are item-ids only).
- Weaken exact shown-set validation back to subset membership, allow duplicate/non-contiguous `shownPosition`,
  or let `shownFullSignatures` drift from the shown candidates → the shown-set helper tests must fail.
- Strip `engineFailure` from the diagnostics subschema → the pre-generation failure **read-back** test must fail (strict mode silently drops the path — write-success alone proves nothing).
- Bump a reducer constant → `REDUCER_CONFIG_VERSION` must shift and `RANKER_CONFIG_VERSION` must **not** (catches the constants-moved-into-`config.py` mutant, where the bump would shift ranker provenance).
- Remove the structural **co-occupancy** lock preflight → the two-locked-shoes / dress+top `400` tests must fail (a generator call would fire).
- Turn the engine's controls-buildability short-circuit into a `contract_invalid` (or drop it so it spends) → the closet-can't-complete valid-empty tests must fail: a locked-top-with-no-bottom / dislike-exhausts-base render must be a **200 `not_enough_items`** with a snapshot + the `_CONTROLS_UNBUILDABLE_HINT` discriminator + **zero generator calls**, never a `400` and never a spend (§C.3 request-decidability).
- Reintroduce a legacy-shaped response branch or an `itemIds`-bound feedback post path after C6 → the UI
  contract / no-legacy-feedback tests must fail.
- Ship rescue as an API-only path — no item-select/launch UI, or a rescue outfit that can't be re-rolled
  (lineage from the rescue parent) or feedback-bound from the UI → the C6 rescue-reachable acceptance must fail (F2 — rescue is a user-facing intent, not just a service endpoint).
- Remove any one of the **four** delete-guard paths (query `deleteOne`/`deleteMany`/`findOneAndDelete`, or the `{document:true}` `doc.deleteOne()` variant — §G acceptance covers all four) → its jest rejection case must fail.
- Add `GenerationSnapshot.bulkWrite`, `GenerationSnapshot.collection.delete*`, or raw `generationsnapshots`
  delete calls outside an approved maintenance script → the static guard test must fail.
- Make the service clamp-or-obey a mismatched wire `generator.temperature` or `generator.maxCompletionTokens`
  instead of rejecting → the exact-match `contract_invalid` test must fail.
- Send `max_tokens` to OpenAI instead of `max_completion_tokens` → the fake-client generation test must fail.
- Let missing/partial OpenAI `usage` telemetry raise after a successful response → the generator telemetry
  critical-path test must fail (`last_usage` becomes `None`; content + finish status still return).
- Route a model refusal or a cap-truncated/`incomplete` response to a silent empty (or to `contract_invalid`) instead of the §D degenerate payload, or drop the `apiSurface`/`responseFormat`/`reasoningEffort`/`finishStatus` provenance from the generator block → the §A.6 refusal/truncation-degenerate and generator-provenance read-back tests must fail.
- Omit `reasoning_effort` (or set it high) / send bare `json_object` when the §12 envelope fits strict `json_schema` → the §A.6 generator-contract tests must fail.
- Let the daily GPT ask use the raw `min(40, total_base×3)` instead of capping at `DAILY_MAX_CANDIDATES`, or set `M5_MAX_COMPLETION_TOKENS` below `ask × per-outfit-tokens` → the daily-ask-ceiling test / pre-C5 token-budget validation must fail (the cutover would truncate every normal-closet daily render — audit-2026-07-07 blocker).
- Cross-check only `requestId`/`parentSnapshotId` (drop the G4 authorship cross-check of `sessionId`/`intent`/Lens/`wardrobeVersion`/`generationIndex`/`controls`/`generator{}`/`candidateCacheKey`) → the authorship-drift tests must fail (a service that mangles any request-derived field must `contract_invalid`).
- Replay the winner for a same-`requestId` POST with a *different* render identity (changed Lens/controls/parent) instead of `409 request_id_conflict` → the G5 conflict test must fail (wrong-winner returned).
- **Inverse (guards the false-409):** include `seedDate` in the G5 render-identity comparison → a first-render retry straddling 00:00 UTC must NOT `409` — the same-client-fields-different-`seedDate` replay test must fail if `seedDate` is compared.
- Accept a feedback `action` outside `{accepted, rejected}` at the C6 POST → the G8 allowlist test must fail (reserved actions must 400).
- Persist a feedback `items`/`perItemFeedback.itemId` that is non-ObjectId-hex or not in the re-read candidate's items → the G10 ObjectId-seam test must fail.
- Skip the G11 StyleMove/template checks (allow a `styleMove.changedItemIds` value not in the candidate, or `templateType` inconsistent with `slotMap`) → the StyleMove/template helper test must fail.
- Write a **scored** candidate (one carrying a `scoreBreakdown`) with incomplete compat/vis, a missing `scoreBreakdown` term, out-of-[0,1] compat/vis, or `rankerScore != Σ(7 terms)` → the G12 algebra test must fail. **Inverse mutant (guards the false-reject):** require a `scoreTrace` on a Step-4-`dropStage="ranker"` (breakdown-less) candidate → a valid-payload test must fail (the helper must NOT demand a trace on unscored drops).
- Store an `engineFailure.message` over `ENGINE_FAILURE_MESSAGE_MAX_CHARS`, containing a stack trace / prompt / key-shaped substring, or a `stage`/`code` outside the closed set → the G13 sanitize tests must fail.
- **Inverse (guards the false-reject of a legit failure row):** interpolate a runtime `itemId` into `engineFailure.message` (instead of the `detail{itemId}` field) → the failure-corpus test must fail (a valid 24-hex ObjectId trips the hex-run filter and the degenerate write is lost — G13); a 24-hex `detail.itemId` must persist fine.
- Leak `payload`/`candidates`/`rawEmitted`/`generationAttempts`/`diagnostics`/`generator`/`itemSnapshots` into the browser response or client state → the G15 negative-allowlist test must fail.
- Skip the G16 forced-item availability preflight (spend a GPT call on a rescue re-roll whose forced item was deleted) → the `forced_item_unavailable` 409 / zero-generator-call test must fail.
- Send an over-bound `occasion`/`wardrobe[]`/body/`controls` array (limit+1) and have it pass → the G7 boundary/over-bound clamp tests must fail.
- Send `store:true` (or omit `store`), omit/mis-set `prompt_cache_retention`, or drop
  `storeMode`/`promptCacheRetention` from provenance → the G14 storage/cache-mode tests must fail.
- Let the OpenAI SDK inherit its 10-minute default timeout or automatic retries, or drop
  `timeoutSeconds`/`maxRetries` from provenance → the §A.6 timeout/retry tests must fail.
- Take `generationIndex` (or the Lens) from the client on a re-roll, or skip the parent `{_id, user}` ownership re-read → the lineage-gate tests must fail (forged parent 404; ignored client index).
- Drop `controls` from a regen child's payload/document, **omit `controls` on a first/non-regen render
  (must be `{lockedItemIds:[], dislikedItemIds:[]}`, not absent)**, **persist the raw client control arrays
  instead of the single `normalizedControls` that shaped generation (dedup/blank-reject/order-normalize)**,
  accept numeric elements through serde, or accept blank elements through controls validation → the
  controls-present-on-every-write / normalized-controls / regen-corpus read-back / controls-id tests must fail.
- Emit a snake_case field, tuple-shaped `items`, `template` instead of `templateType`, or any renamed/dropped field from `variant_to_wire()` → the §6.5 wire-conformance golden must fail.
- Write a degenerate snapshot for an input-validation (`contract_invalid`) failure → the corpus-purity test must fail.
- Call the generator on a `not_enough_items` daily pool, or drop the engine-visible itemSnapshots from that
  row → the no-spend / daily-empty-trace tests must fail.
- Omit `maxCompletionTokens` from the generator provenance block → the schema `required` + payload-helper tests must fail.
- Omit `formality` from the request-adapter `engineVisible` object (even while null at M5) → the §15.2
  projection golden must fail.
- Remove full-funnel itemSnapshot coverage (checking only shown items), allow duplicate `itemSnapshots`, or
  let candidate `items[]` and `slotMap` disagree → the corpus-completeness helper tests must fail.
- Persist a client-echoed `items`/`baseKey`/`fullSignature` on an interaction row (instead of the server derivation) → the forged-echo read-back test must fail.
- Store `feedbackReason` in `metadata`/`inferredWhy`, silently drop an unknown reason code, or persist uncapped `rawText` → the structured-reason tests must fail.
- Hydrate dashboard/history cards from legacy `itemIds` echoes, a post-Python DB refetch, or denormalized interaction-row content instead of `payload.itemSnapshots` → the display-source test must fail.
- Deduplicate double-tap feedback at write time instead of append-only write + read-time reducer collapse →
  the feedback append/dedup tests must fail.
- Hold `requestId` only in React state (no durable pending-render envelope), or clear the envelope on
  unmount instead of on hydrated-success/explicit-discard → the lost-response/reload idempotency test must
  fail (a reload mints a new `requestId` and double-spends, §C.4 F10).

## Out of scope

- **A re-rank / candidate-cache layer for regenerate** — a future optimization to reintroduce at scale,
  informed by live usage data (the overturned D2 half; see the D2 trap-guard). Registered, not built.
- **W-track async CV queue / state machine** (merit hold). M5 uses existing ingestion + the `engineVisible`
  projection; `material`/`formality`/`styleTags` stay empty until the W-track.
- **The trained scorer itself** (M6). M5 lands + exercises the hook (§E) but writes `scorer.kind="cold_start"`;
  training + order-influence is M6, gated by re-powering H26.
- **§16 scoped-memory behavior** (`[STAGED]`, merit hold at N≈1). Fields exist (M4a); promotion behavior held.
- **GenerationSnapshot redaction/retention** (H43, Privacy). Seam reserved; delete-guard added (§G); cascade
  not wired.
- **The shareable before/after rescue card** (H45 growth artifact) — post-M5, activates with the someday-launch.
- **`wardrobeVersion` bump wiring** (H6, W-track). Stays inert (constant 0); freshness rides fresh
  generation + the per-request cooldown/repetition signals.
- **Image-replacement delete-before-commit ordering** (H14, W-track).
- **Engine-active constraints** (H36) — M5 rejects non-empty maps so the corpus never claims inactive
  dress-code/weather/comfort rules shaped an outfit.

## Verification plan

- **Python:** `cd ml-system && pytest tests service/tests` — orchestrator, reducers + mapping
  table + scan bound, AffinitySignalScorer, regenerate pins (including over-cap multi-lock scoping), seam,
  non-null compat/vis for every scored candidate, daily insufficient-wardrobe empty trace with itemSnapshots,
  service bounds. Floor grows from 833 (post-C1+C2 reconciliation).
- **Service:** integration tests (fake `Generator`) — auth rejection, generator-allowlist rejection,
  generator exact-match rejection incl. `maxCompletionTokens`, fake OpenAI call uses `max_completion_tokens`
  not `max_tokens`, non-empty `constraints` rejection, degenerate payload (both recording loci), `/render`
  incl. the re-roll shape.
- **TS:** `cd fitted && npm test && npx tsc --noEmit && npx eslint <touched>` — payload helper (incl. the
  §A shown-identity cross-check), snapshot write **+ §G.1 read-back assertions**, idempotency index +
  malformed/overlong requestId rejection before service call, degraded empty-state shape,
  feedback gate, structured `feedbackReason`, append-only (incl. no `inferredWhy` write-back), the C6 UI
  contract (new-shape render + requestId mint/reuse + in-flight debounce + `displayItems` from
  `itemSnapshots` + no legacy response branch), all §19 gates, weather bucket table tests, static guards
  against `GenerationSnapshot.bulkWrite` / raw snapshot deletes, adapter round-trip (reuse the pre-flight
  54-payload corpus + the 3 R5 probes). Floor grows from 387.
- **Cross-runtime conformance (H13) — green as a C8 Commit-1 PRE-FLIP gate (F8):** both suites (Python +
  jest) + a seed/serde conformance check on golden vectors (incl. the §A `variant_to_wire()` §6.5 wire
  vectors) pass before `USE_ML_SHORTLISTER` flips; the CI workflow file lands with the Commit-2 cleanup.
- **Pre-flip mechanical read — daily AND rescue (C8 commit 1, F3):** the Spearhead-C6/H40 eval CLI extended
  to run **both** intents through the M5 service — parse rate / hallucinated ids / schema-rejection on the
  real `gpt-5.4-mini` (two deltas vs H40: model `gpt-4o`→`gpt-5.4-mini` **and** rescue now flows through the
  new service/§A.6 surface); **rescue additionally gates forced-item inclusion + StyleMove presence**;
  believability descriptive.
- **Live smoke:** deploy to Fly.io, **assert the `{user, requestId}` partial unique index exists in live
  Atlas with the exact `$type:"string"` filter (`listIndexes`, pre-flip — C8)**, flip
  `USE_ML_SHORTLISTER=true`, drive daily + rescue + a re-roll
  in the running app, confirm one snapshot per render + a lineaged child + `{snapshotId,candidateId}` +
  append-only feedback; flip off → §A degraded empty state. **Re-roll-differs observation (descriptive, §C):**
  compare the re-roll's `shownFullSignatures` set to the parent's and report the overlap — never a hard gate
  (a small golden closet may legitimately re-surface), but the one end-to-end exercise of the "genuinely
  different" promise; if collapse shows, the §C avoid-list lever (a `PROMPT_VERSION` bump) is the response.
- **Doc reconciliation (same commits as C4/C5, unless marked ALREADY-DONE):**
  **ALREADY-DONE (2026-07-07 post-C4 audit):** every v2 cache home rewritten for the cache kill **and**
  the fresh-generation regenerate (§5 cache bullet, **§9 pipeline-order table Step 7**, §6.7, §14 R9
  cached-candidate/merge wording, §15's two-stage-cache paragraphs, the §20-M5-row — **incl. its stale
  "two-stage cache" deliverable AND its "pick + state an explicit interim invalidation"
  wardrobeVersion/TTL clause, both dead under the cache-kill (freshness rides fresh generation +
  cooldown/repetition)** —, Appendix A R1/N1, Appendix B cache TTL);
  **ALREADY-DONE (same pass):** **§15.1's "a snapshot is written for
  every render attempt" clause softened to "every render where a valid payload reached the writer"** + the
  transport-loss residual gap recorded (D3/§D); **§15's snapshot-write posture reconciled from
  "async/best-effort, never on the critical path" to the M5 blocking-validated-idempotent write (§A pin)
  — the pre-alloc `snapshotId` + shown binding + `E11000` winner-re-read depend on it**;
  **remaining C5 same-commit reconciliation:** **§15.1's identity/provenance/score fields gain the M5
  tightenings** (`requestId` is UUIDv4/ULID live-write idempotency **and becomes schema-`required` — F7**;
  the §15.1 "once H7 closes" attribution
  corrected to **H50**; `generator.maxCompletionTokens` is
  required provenance **plus the §A.6 API-surface/storage-cache/timeout provenance
  `apiSurface`/`responseFormat`/`reasoningEffort`/`storeMode`/`promptCacheRetention`/
  `timeoutSeconds`/`maxRetries`/`finishStatus` — F9**, scored candidates have non-null finite compat/vis when `scorer.available=true`);
  **§12's generation contract + §9's Step-2 gain the §A.6 pin (F9): the real OpenAI surface is Chat
  Completions + strict `json_schema` structured output (fallback `json_object`), explicit lowest-available
  `reasoning_effort`, `max_completion_tokens` never `max_tokens`, refusal/cap-truncation → the §D degenerate
  corpus — the spec must not imply bare `json_object` is the only mode; §10's candidate-request-scaling
  bullet gains the same disambiguation (the sampler count sizes the pool; the daily paid ask is capped at
  `DAILY_MAX_CANDIDATES=12`, already pointed to from Appendix B)**;
  **§15.1's `scorer` field list gains the §E semantics pin**
  (`available` = scoreTrace populated, never rank-order influence);
  **§6.6's "the M5 request adapter recomputes `item_affinity`/`liked_full_signatures`/cooldown" locus
  corrected to "Next fetches raw append-only rows; the service's Python §H reducers recompute at request
  time" (the projection-not-stored principle is unchanged — only the who/where)**;
  **§20 M1-row's "signal path stubbed until M6" corrected — the behavioral occupant (`AffinitySignalScorer`
  + `RankerContext` signals) activates at M5; only the *trained* scorer waits for M6 (§14 is `[NEXT]` signal,
  not `[STAGED]`)**;
  the `candidateCacheKey` algorithm
  (§C.1) recorded where §15's superseded cache bullet dies; §F Lens table added parallel to §15.2
  (including M5's reject-non-empty-constraints posture); §20/H28 updated so M5 = producer scoreTrace seam
  and M6 = rank-order hook; §20's M5 row entry-prereq wording reconciled so H13 cross-runtime conformance is **green before the C8
  flip (a pre-flip gate, F8)**, not an M5-entry gate; `docs/plans/regen-controls.md` marked superseded or rewritten
  for fresh generation/no cache/no drop-lock behavior; **§21's "cache hit rate" product metric struck (no
  cache to hit post-D2)**; H4/H7/H8/H10/H11/H12/H16/H17/H19/H28/H29/**H45**/H48/H49/
  H50/H51/H54/H55/H57/H58/H59/H60 re-disposed in §23 (§J) — **incl. H16 reworded so `candidateCacheKey`
  groups a *Lens-chain* (siblings share it despite differing `controls`), NOT "identical-input renders";
  H45's "React card UI … not itemized in the M5 row" corrected (C6 itemizes the dashboard §6.5 + StyleMove
  card rewrite); and
  H57's stale "hard-codes `intent=rescue_item`" current-state text updated (C1 landed `intent=request.intent`)**.
  **ALREADY-DONE (this session, 2026-07-06):** Appendix B's reducer constants reconciled to the landed C2
  values — `REPETITION_WINDOW_SNAPSHOTS=50` (was a stale `20`), `FEEDBACK_DEDUP_WINDOW=300`,
  `INTERACTION_ROWS_SCAN_LIMIT=500` — with the single home moved to `reducers.py`/`REDUCER_CONFIG_VERSION`
  and the cache-TTL constant struck.

## §J. Hole dispositions (reconcile §23 as C-work lands)

Resolved-by-M5: H7 (§C.1), H8 (UTC, §F), H12 (§D), H17 (removed — every regenerate IS a fresh generation;
the flag is subsumed, §C), **H49 (DISSOLVED — no render without its own generation, so cache-hit/copy-forward
provenance semantics have no referent, §C.2)**, **H50 (partial unique index on `{user, requestId}` with
`partialFilterExpression: { requestId: { $type: "string" } }`, UUIDv4/ULID live `requestId` validation,
`E11000` winner-re-read, and the client minting rule, §C.4 — the earlier "not a write-path unique index"
phrasing conflated the feedback-row append-only rule with render idempotency; corrected)**, H51 (worst
branch dies — no cache in any runtime, D2/§C), **H13 (cross-runtime conformance — NOT an M5-*entry*
prereq, but a C8 **pre-flip gate**: the tests are green before `USE_ML_SHORTLISTER` flips (Commit 1, F8),
the CI workflow file lands with the Commit-2 cleanup; the §20-M5-row "entry: H13 green" wording is
reconciled to "green before the flip", Verification)**, H55/H60 (§A/D6/§F), H57 (§B), H58 (§A/§F), H59 (§C.3), H54
(§G), H10 (serde opacity §G + no-post-Python-refetch §A/C5), H29 (§G), H11 (append-only §I + dedup reducer
§H), H19 (§H), H48 (**both instances decided**: sibling stored via the §E producer exercise; headline
stored via option (a) — basis: converged dual-pass 2026-07-06). **C4 docket dispositions (2026-07-07):**
(a) the §D **engine-failure arms'** `reasonHint` (the two `app.py` exception arms — NOT the zero-survivor
third path, which keeps `insufficientAfterGeneration` + its prose hint) is the stable machine code
`"engine_failure"` (§A); (b) any non-`stop`
`finish_reason` routes to the degenerate corpus (§A.6 point 6, ratifying the shipped code); (c)
`admittedViaFallbackStage` is DROPPED (§G.1 — no writer/home; `.ts` removal deferred to C5). Reworded: H4/H16 (§C.5 determinism — no
cache; snapshots immutable, generations fresh). **Landed at C4 (2026-07-07):** H28 (the producer-side
`OutfitScorer` exercise + `scoreTrace` population is in code; the rank-order hook stays M6) and H48 (both
instances now in code — the sibling via the §E producer exercise, the headline via the additive
`_FilteredCandidate.score_breakdown` in `rank_with_audit`). Resolved-design / pending C6 delivery: H45 (route + StyleMove card **+ the item-select/launch rescue UI
delivered at C6** — moved from C8 by the ladder sequencing invariant, so rescue is user-reachable not
API-only, F2; only the shareable before/after growth card is deferred post-M5). Deferred: H6 (W-track), H43
(Privacy).

**OPEN (Fable refinement 2, 2026-07-07) — stale-control-id category.** The §C.3 preflight currently `400`s
a `lockedItemIds`/`dislikedItemIds` id absent from the live wardrobe. Under the request-decidability
principle that governs the buildability call, a *stale* control id is **not** request-decidable (it needs
the server wardrobe) and is producible by a bug-free client via a delete/edit race — exactly the shape the
G16 forced-item-deleted case resolves as a **`409` state conflict, not a caller bug**. So the consistent
end-state is likely: a stale **lock** → `409` (or route to the valid-empty buildability path, since a lock
on a vanished item can't be honored); a stale **dislike** → **drop it from `normalizedControls`** (it
shaped nothing, so neither `400` nor persist-as-lie). Kept as `400` for now (a strong desync signal during
M5 bring-up, and it guards the buildability logic's "control ids resolve" assumption); revisit when C5's
client control-lifecycle is real. Whichever way it lands, the buildability decision above is unaffected.

**CONFIRMED DEFECTS (cross-layer drift-inventory sweep 2026-07-08) — pre-registered for C5, source-verified.
Fix with BEHAVIORAL ROUND-TRIP tests (write→read a real Mongo doc), never shape-only — a `validateSync`
over a healthy golden cannot catch a silent field-strip.** The committed `GenerationSnapshot.ts` schema
disagreed with the committed Python payload it is the write target for:
- **D-1 `diagnostics.engineFailure` silent-drop (HIGH — data loss) — FIXED (C5 first brick).** Python emits
  `diagnostics.engineFailure` (`snapshot.py:145`, on every §D failure/degenerate write); the Mongoose
  `diagnostics` sub-schema had no `engineFailure` field and the model runs default `strict:true`, so it was
  stripped on insert — the entire §D failure corpus lost. Added as a declared sub-schema (with the closed
  `ENGINE_FAILURE_STAGES`/`ENGINE_FAILURE_CODES` mirror + `ENGINE_FAILURE_MESSAGE_MAX_CHARS`), guarded by
  `tests/generationSnapshotRoundTrip.test.ts` (write a degenerate snapshot → read `engineFailure` back
  non-null; out-of-set stage/code rejected on write).
- **D-2 top-level `controls` silent-drop (HIGH — corpus loss) — FIXED (C5 first brick).** Python emits
  top-level `controls` (`snapshot.py:188`, "present on EVERY write", §G.1 F6); the root schema had no
  `controls` field → stripped. Added as `required:true` + default; round-trip test asserts populated controls
  read back AND that a first render stores `{lockedItemIds:[], dislikedItemIds:[]}` (present, never absent).
- **Same-class item-6 strip (HIGH — provenance loss) — FIXED alongside D-1/D-2.** The identical silent-strip
  class: the `generator` provenance block carried only the four M4 base fields, so §G-item-6 additions
  (`maxCompletionTokens`/`apiSurface`/`responseFormat`/`reasoningEffort`/`storeMode`/`promptCacheRetention`/
  `timeoutSeconds`/`maxRetries`) + `generator.finishStatus` + `generationAttempts[].finishStatus` were all
  stripped on a real write. Added per §G item 6; guarded by a **full-payload round-trip test** that loads the
  committed `m4b_e2e_snapshot.json` fixture, writes it, and asserts every generator provenance field survives
  read-back (the class cure — a healthy golden written and read back, so no future field can hide behind the
  `validateSync`-only contract test). Test-Mongo harness landed at `tests/helpers/mongoHarness.ts`.
- Related unguarded cross-runtime surfaces feeding the same C5 work (full inventory + the ~35-surface catalogue
  in `docs/plans/post-m5-reset.md`): the §A response envelope + `flags` keys (hand-built `app.py:_flags`, no
  single source), the clothingType 5-value set coercing unknown→"top" (`fitted/lib/clothingType.ts`), the
  `action`-value map (rename in `OutfitInteraction.ts` silently empties affinity), the service `MAX_*` clamps
  vs absent Mongoose `maxlength` (the existing "⚠ C5 mirror obligation" above), and the `keys.py`↔`app.py`
  hand-duplicated key-safe id rule. These are guarded by the **behavioral round-trip suite**, not per-field pins.

## Open questions

None blocking. Deferred with a home:
- `SERVICE_TIMEOUT_MS` numeric value — tuned at C5. Reducer values are pinned in `reducers.py`
  (`FEEDBACK_DEDUP_WINDOW=300`, `INTERACTION_ROWS_SCAN_LIMIT=500`, `REPETITION_WINDOW_SNAPSHOTS=50`) and
  the daily ask ceiling is landed (`DAILY_MAX_CANDIDATES=12`, `config.py`). Still open:
  `M5_MAX_COMPLETION_TOKENS` **landed as C3 service config** (`service/config.py`
  `DEFAULT_MAX_COMPLETION_TOKENS=2200`, env-overridable within `MIN_COMPLETION_TOKENS_FLOOR=2200` ..
  `MAX_COMPLETION_TOKENS_CEILING=10_000` — `/readyz` 503s outside the band) but the **pre-C5 empirical
  validation is still owed**: the (cap, ask-ceiling) pair proven on real `gpt-5.4-mini` **before C5**
  (the cap must hold the ask, or every daily render truncates; lower the ceiling or raise the cap until
  it fits — and re-tune default + floor together, §A.6 point 3).
- ~~The §A rate-ceiling value~~ **named at C3**: `RATE_LIMIT_BURST=5` /
  `RATE_LIMIT_REFILL_PER_SECOND=0.2` per instance (`service/config.py`), global only under the fly.toml
  single-machine pin; the monthly OpenAI project cap is the hard backstop.
- ~~ASGI framework~~ **decided at C3**: hand-rolled minimal ASGI (no FastAPI), `uvicorn` pinned to serve.
- **New M5 constants (2026-07-07) — all have inline homes + defaults; values tuned at their checkpoint, the
  load-bearing part is they are *concrete + boundary-tested*, not adjectives:** the §A/G7 input-clamp set
  (`MAX_OCCASION_CHARS`/`MAX_WEATHER_RAW_CHARS`/`MAX_LOCATION_CHARS`/`MAX_WARDROBE_ITEMS`/
  `MAX_REQUEST_BODY_BYTES`/`MAX_CONTROL_IDS`/`MAX_PER_ITEM_FEEDBACK`), `ENGINE_FAILURE_MESSAGE_MAX_CHARS=300`
  (§G/G13), the route `maxDuration` + `PRE_SERVICE_BUDGET_MS` + `MONGO_WRITE_REREAD_MARGIN_MS` ordering vs
  `SERVICE_TIMEOUT_MS` (§D/G6), and the §A rate-ceiling value. Service-side ones live in the C3 service-config
  module; route/Next ones in C5.
- **⚠ CAPACITY:** ~1,865 lines after the 2026-07-07 compaction pass (audit narrative folded into commits;
  header/banner/D2/D6/F10 dedup'd) — still over the CLAUDE.md ~1,500 per-doc ceiling, but the remainder is
  contract-dense (wire contract, §G schema, edge cases, mutation list), not narrative. The natural next
  shrink is retiring checkpoint sections to `> COMPLETED` stubs as C3–C8 land; do not cut contracts to hit
  the number.
