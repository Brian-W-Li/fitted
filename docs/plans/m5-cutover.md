# M5 — Live cutover (`USE_ML_SHORTLISTER`)

> Slug: `m5-cutover`. Owns the live GenerationSnapshot write and the wholesale replacement of the
> legacy recommendation vertical. `/spec` interview + decisions recorded 2026-07-06; upgraded to the
> M4 implementability bar the same day; **revised 2026-07-06 after a targeted senior eval** (8 probes
> traced through source, both passes converged): **D2's re-rank half is overturned — regenerate = one
> constrained fresh generation with lineage**; H50 = a partial unique index; §H gains the action→signal
> mapping + a bounded interaction scan; §B wires the sampler signal-slot's first real occupant.
> **Contract-tightened 2026-07-06 (three external review rounds, 22 confirmed findings — all
> spec-precision, trust-boundary, or sequencing; no D# overturned):** C6 owns the UI contract cutover
> (§ladder); §G.1 pins the Python↔TS merge boundary field-by-field; shown-identity zip +
> `variant_to_wire()` pinned (§A); the StyleMove drop goes intent-generic + daily gets the pre-GPT
> `not_enough_items` short-circuit (§B); **regen lineage is server-derived from an ownership-verified
> parent re-read, never client-trusted (§C.1)**; R9 `controls` + `generator.maxCompletionTokens` are
> stored provenance (§G); invalid requests are `contract_invalid`, never corpus rows (§D); C8 deletes
> the legacy **arm**, never the rewritten route file; generator config is service-owned with exact-match
> validation (§A/D6); `candidateCacheKey` = a **Lens-chain key** landing at C3; the delete guard covers
> all four Mongoose delete paths (§G); autoIndex stays on with a mandatory pre-flip index-existence
> check (C8); plus the scorer-semantics / reducer-provenance / `engineFailure`-schema /
> structural-lock-preflight / uniform-scoreTrace pins.
> **Follow-up adversarial-review fixes (2026-07-06):** M5 rejects non-empty `constraints` until they are
> engine-active; `requestId` minting moves into the C6 UI cutover; degraded browser responses get a
> new-contract empty shape; token-cap, weather-bucket, daily-empty-trace, and non-null scoreTrace tests are
> pinned; `regen-controls.md` is historical/superseded.
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
| Holes | §23 H4/H7/H8/H10/H11/H12/H16/H17/H19/H28/H29/H45/H48/H49/H50/H51/H54/H55/H57/H58/H59/H60 | dispositions in §J |
| Rescue engine (generalize) | `ml-system/fitted_core/rescue.py`, `snapshot.py`, `response.py`, `ranker.py` | signatures in §B/§E |
| Legacy vertical (delete) | `.../regenerate/route.ts` (whole file) + the legacy **arm** inside the rewritten `recommend/route.ts` | §19 delete list — the M5 route itself is never deleted (C8) |
| Snapshot model | `fitted/models/GenerationSnapshot.ts` | §G additions |
| Interaction model + route | `fitted/models/OutfitInteraction.ts`, `fitted/app/api/interactions/route.ts` | §H/§I |
| Wire serde | `ml-system/fitted_core/snapshot_serde.py` | `to_wire`/`from_wire` |

## Decisions locked (the `/spec` docket, resolved; D2 revised by the 2026-07-06 targeted eval)

| # | Decision | Resolution | Holes |
|---|---|---|---|
| **D1** | M5 scope | **Full cutover.** Build the intent-generalized daily orchestrator so "today's outfit" works on `fitted_core`; delete the legacy vertical wholesale. Both intents on the new engine. | H57 |
| **D2** | Candidate cache + regenerate | **Kill the separate TTL cache** (the `GenerationSnapshot` is the durable candidate store). **Regenerate = one constrained fresh generation** (same Lens, same `session_seed` → same sampled pool; a fresh GPT draw at `temperature=0.5`; the live repetition window + cooldown/dislike filters supply novelty and dislike-invalidation), writing a **child snapshot** with `parentSnapshotId` + `generationIndex+1` and **its own** `generator`/`generationAttempts[]`. **Trap-guard (why re-rank was overturned):** re-ranking the parent's candidates cannot deliver "genuinely different" — `select_spread` re-sorts deterministically by `(-score, -compatibility, full_signature)` (`response.py:528-531`), laundering the tie-break out of the surfaced set; rotation rode only the repetition penalty and died at pool exhaustion (identical outfits forever on a ≤k pool); and the `survivors < k` escalation fired a GPT call on every small-closet re-roll anyway. A fresh generation costs ~$0.01 at `gpt-5.4-mini` pricing, reuses the R9 constrained-generation machinery M5 builds regardless, and gives the corpus real per-render attempts (H49 dissolves). A re-rank/cache layer is a legitimate **future** optimization to reintroduce at scale, informed by live usage — do not pre-build it. | H4, H16, H17, H49, H51 |
| **D3** | Engine-failure fallback | **Snapshot iff a valid engine payload reached the Next writer.** Engine-internal failures → the **service** degrades to a degenerate payload (§D — provenance is derivable from request + module constants, so it is satisfiable even pre-generation). No payload → **no snapshot** + graceful non-bindable response + availability counter. No nullable / unavailable-provenance widening; the only additive schema changes are the explicit §G/§I fields. | H12 |
| **D4** | Trust-boundary gates | **Close all §19 gates** (backend + client-side). | §19, H11 |
| **D5** | Service architecture | **Stateless pure-function service.** Next fetches all inputs from Mongo, passes them in; the service runs the pure pipeline + reducers, returns the payload; **Next allocates `snapshotId`, validates, owns all writes.** The **service holds `OPENAI_API_KEY`**; Next stops needing it **once the legacy vertical is deleted at C8** (until then the flag-off legacy arm still calls OpenAI in Next). Because the key lives service-side, the **independent spend bounds live service-side too** (§A). | H58 |
| **D6** | Generator params | `gpt-5.4-mini`, `temperature=0.5`, `max_completion_tokens` cap (GPT-5.x rejects `max_tokens`). **Service-owned config** (§A): the service generates and authors provenance from its own config; the wire `generator` object is an exact-match-validated **expectation**, never control — mismatch → `contract_invalid`, never clamped. The token cap is recorded in `generator.maxCompletionTokens` provenance (§G). | H55, H60 |
| **D7** | Scorer-seam hook | **Land it at M5** (ambition-forward), in two honest moves: declare the `OutfitScorer` type, and **exercise it in the snapshot producer** (`build_snapshot_payload`, which has items via `trace.prompt_pool`) to populate `scoreTrace.compatibility/visibility` for **every scored candidate** (unifies **H48**); first occupant = the existing cold-start `compatibility`/`visibility`. **The ranker is untouched → M3 byte-identical.** The rank-**order** hook (a precomputed per-candidate signal on `RankerContext`, preserving item-blindness) is **reserved for M6** (§E) — cold-start compat must not reorder the shipped ranker. The H48-headline store-vs-recover call is **decided: store (option (a))** — see §E for the corrected recoverability rationale. | H28, H48 |

## Success criteria (verifiable)

- `USE_ML_SHORTLISTER=true` → dashboard **daily** flow and **rescue** flow both render `fitted_core`-produced
  outfits via the Fly.io service; `false`/service-down → a **new-contract degraded empty state** (`shown: []`,
  `displayItems: []`, `bindable:false`, stable reason code, no feedback controls), never a 500.
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
  `AffinitySignalScorer`, §B/§H); cold paths (count < 5, or empty affinity) are **byte-identical** to the
  shipped goldens.
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
- Suite floors grow (current: **core 791 / h26 305+1skip / jest 387** — floors, not pins).

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
    The wire object is validated by **exact match** against the service config (`model` in allowlist,
    `temperature ==` the configured value, `maxCompletionTokens ==` the configured cap); a mismatch →
    `contract_invalid` — it means Next's expectation and the service's reality have drifted, which must fail
    loudly, not be clamped into silence. (No
    `[0,2]` clamp: clamping *is* client control, contradicting D6's service-side enforcement.) **The cap
    is provenance too:** `max_completion_tokens` changes truncation/parse-fail/candidate distributions,
    so it is recorded in the payload's `generator` block (§G item 6) for M6 stratification.
  - **Input clamps:** length-clamp every body-controlled text field (`occasion`, `weatherRaw`, `location`)
    and cap the `wardrobe` array length + total request body size at the ASGI layer. **M5 constraints
    posture:** `lens.constraints` must be `{}`; any non-empty map is `contract_invalid` before generation
    and writes no snapshot. Constraints stay in the wire/schema as the v2 placeholder, but they are not
    corpus truth until they are engine-active.
    (Prompt *items* are already structurally capped by the per-type sampler caps ⇒ `MAX_PROMPT_ITEMS`.)
  - **Rate ceiling:** a simple in-process token bucket per instance (stateless service, single instance —
    a crude ceiling is enough; it bounds a leaked-secret blast radius to a known rate).
  - **Hard budget:** a monthly spend cap on the OpenAI project (dashboard setting, zero code) — the
    backstop if everything above fails.
- **Framework:** a minimal ASGI app (FastAPI acceptable). One module `ml-system/service/app.py` importing
  `fitted_core`; **`fitted_core` gains no HTTP dependency** (the service wraps it).

### Wire contract

`POST /render` request (camelCase, mirrors the snapshot Lens + engine inputs):
```jsonc
{
  "snapshotId": "<TS ObjectId hex>",          // TS-preallocated (§15.1 identity)
  "requestId": "<client idempotency token>",   // §C.4 — UUIDv4/ULID minted once per Generate action, reused on retry
  "intent": "daily" | "rescue_item",
  "generationIndex": 0,                        // NEXT-computed: 0 first render; parent+1 on a re-roll
                                               //   (§C.1 lineage gate — never taken from the client)
  "parentSnapshotId": null,                    // re-rolls only; ownership-verified by Next pre-service (§C.1)
  "controls": { "lockedItemIds": [], "dislikedItemIds": [] },  // R9 regen controls; preflight §C.3
  "lens": { "occasion": "<verbatim>", "weather": "hot|mild|cold|indoor|outdoor",
            "weatherRaw": "<str?>", "location": "<str?>", "forcedItemId": "<id?>",
            "seedDate": "<YYYY-MM-DD, UTC?>", "constraints": { } }, // M5 requires {}; non-empty is rejected
  "wardrobe": [ { /* engineVisible projection §15.2: id,name,clothingType,warmth,colorTags,
                     occasionTags,styleTags[],material?,formality?,imageUrl */ } ],
  "wardrobeVersion": 0,
  "interactionCountAtRequest": 0,              // → RequestContext.interaction_count (NOT hard-0, §B)
  "behavioralRows": { /* §H RAW rows the SERVICE reduces: recentSnapshots[] (shownFullSignatures+nSurfaced+
                         createdAt+_id, H19 window) + interactionRows[] (BOUNDED, §H projection) */ },
  "generator": { "provider": "openai", "model": "gpt-5.4-mini", "temperature": 0.5,
                 "maxCompletionTokens": 900 } // illustrative; exact Appendix-B/service config cap
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

**Degraded browser response (C5/C6 — Next-only, no payload).** When the service is unreachable, times out,
returns `5xx`, rejects auth/rate-limit, or returns `contract_invalid` after a service call, Next discards the
preallocated `snapshotId` and returns a new-contract empty state to the browser: `{ "shown": [],
"displayItems": [], "bindable": false, "flags": { "reasonHint": "service_unavailable" | "contract_invalid"
| "rate_limited" | "auth_failed", ... } }`. It carries **no** `{snapshotId,candidateId}`, renders an empty
state, and hides feedback controls. It is never legacy-shaped `outfits[]` and never a corpus row.

**Shown-identity pin (load-bearing — this is the feedback-binding token).** `OutfitVariant` carries no
candidate id (verified `response.py:107-130`), and the payload's shown list is sorted by
`shown_position` (`snapshot.py:516-517`) while the render result carries `select_spread` order — an
index-zip across the wire is a coincidence, not a contract. Pinned instead: **the service zips each
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

**Browser response hydration pin (C5/C6 — display data is not a client echo).** The service response is
identity-first: `variant_to_wire()` carries item identity/roles, not a dashboard-ready card. After TS
validates the payload and before returning to the browser, the Next route hydrates each shown variant from
the validated `payload.itemSnapshots[]` (the same corpus record, no post-Python DB refetch and no client
echo) into a UI-only sibling, e.g. `displayItems: [{itemId, role, name, clothingType, colorTags, imageUrl}]`.
The §6.5 identity shape stays unchanged (`items: [{itemId, role}]`); `displayItems` is presentation
scaffolding and is not used for binding or reducers. If any shown item id is missing from
`itemSnapshots`, the TS helper rejects `contract_invalid` before writing. History GET uses the same
snapshot join + `itemSnapshots` source for bound cards, never denormalized interaction-row content. This
display rule is only the UI subset: the §G helper independently validates **every** candidate content id
(`items[]` and `slotMap`) against `itemSnapshots[]`, so unshown/negative training rows cannot carry
unrecoverable item references while the browser path still looks healthy.

**Error envelope** (all non-2xx): `{ "error": { "code": "auth|rate_limit|parse_fail|contract_invalid|
internal", "message": "<str>" } }`. Transport failures (unreachable / timeout) never reach an envelope —
Next catches them (§D). The H12 trigger set maps: `unreachable|timeout` → Next catch; `5xx|auth|rate_limit`
→ envelope with those codes; `parse-OK-but-contract-fail` → `contract_invalid`.

## B. Daily orchestrator (D1 / H57)

Generalize the rescue vertical to an intent-generic orchestrator. **Real current signatures** (verified):

```python
# rescue.py today — the shape to generalize:
@dataclass  # RescueRequest: wardrobe, forced_item_id: str (REQUIRED), occasion, weather, session_id,
            # wardrobe_version, generation_index=0, k=DEFAULT_K, n_surfaced=N_SURFACED, date=None
def rescue(request: RescueRequest, generator: Generator) -> RescueResult: ...
def rescue_with_trace(request: RescueRequest, generator: Generator) -> RescueTrace: ...
def _build_request_context(request) -> RequestContext:  # pins interaction_count=0  ← M5 must parameterize
```

**Deliverables:**
- `RenderRequest` (generalizes `RescueRequest`): add `intent: str` (values `"daily"|"rescue_item"|
  "outfit_upgrade"|"translate"` — fitted_core uses a plain `str`, verified `snapshot.py:144`; the TS enum
  lists all four; add an `Intent` `Literal`/validation if desired), make `forced_item_id: Optional[str]`
  (a `__post_init__` guard: **required iff `intent == "rescue_item"`**), add `interaction_count: int = 0`
  (feeds `RequestContext.interaction_count` — no longer hard-`0`). Keep the existing k / n_surfaced /
  generation_index validators. **Daily's `n_surfaced` is pinned = 3** (decided, not inherited: the
  `(path×risk)` spread argument holds for daily too, and it halves per-render token/UI cost vs the legacy
  `maxOutfits=5`; the field stays request-settable if the product call changes). `RenderRequest` satisfies
  the `LensRequest` Protocol by shape (occasion+weather) — verified: the Protocol docstring already
  anticipates "any future daily/upgrade request".
- `render(request, generator, *, signal_scorer=None) -> RenderResult` and
  `render_with_trace(request, generator, *, signal_scorer=None) -> RenderTrace` dispatch on
  `request.intent`. **Rescue path** = today's `rescue`/`rescue_with_trace` behavior (forced-item scoping +
  sufficiency). **Daily path** = full-pool sample (§10, no forced-item scoping) → **pre-GPT
  `not_enough_items` short-circuit** (the sampler reports `not_enough_items` when `requested == 0`,
  verified `sampler.py:483`; daily mirrors rescue's no-spend intent but **does not copy rescue's empty
  trace shape**: `sampler_result` is present, `candidate_requested=0`, `trace.prompt_pool` / itemSnapshots
  preserve the canonical engine-visible wardrobe the engine considered, and
  `generationAttempts[]`/`candidates[]`/shown arrays are empty) — **no generator call, no spend**,
  `flags.notEnoughItems=true`, a **valid non-degenerate payload** with `nSurfaced=0`, snapshot written) →
  §12 generation (daily
  prompt) → validator → **intent-generic StyleMove drop (below)** → `rank_with_audit` → response. Keep
  `rescue`/`rescue_with_trace` as thin
  intent-`rescue_item` wrappers over `render` (their M0–Spearhead tests stay green). `signal_scorer=None`
  defaults to `ColdStartSignalScorer()` — the wrappers and all goldens stay byte-identical. Candidate
  count from the standard M1 scaling (§10 — daily has no forced item; use `build_candidate_pool`'s
  scaled ask).
- **Split `_drop_invalid` — the StyleMove drop is intent-generic, the forced-item drop is rescue-only.**
  *Trap-guard (crash class):* `response._assemble_variant` **hard-asserts** a non-null `style_move` on
  every surfaced variant (verified `response.py:490-493`), and the only thing upholding that contract
  today is `rescue._drop_invalid` (`rescue.py:578+`) — a rescue-only step bundling **two** drops (forced
  item + StyleMove presence). M2 leaves `style_move=None` on absent-or-malformed moves and the ranker is
  StyleMove-agnostic, so a daily path without the drop **AssertionErrors on the first malformed
  StyleMove** — exactly the untested daily-prompt × `gpt-5.4-mini` delta the prompt bullet below warns
  about. Fix shape: extract the StyleMove-presence drop into an intent-generic pre-rank step both paths
  run; the forced-item drop stays rescue-only. Requiring the StyleMove stays (the "one thing that made
  it work" promise) — the fix is dropping the candidate, never letting `None` reach assembly, and never
  weakening the assert.
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
- **Daily prompt** (new, `generation.py`/`rescue.py` prompt builders): mirror the rescue system/user prompt
  structure, drop the forced-item framing — "build N believable outfits for `{occasion}` / `{weatherBucket}`
  from this wardrobe". Same §12 JSON envelope + validator (no schema drift — the validator is intent-generic).
  **Pre-cutover mechanical read required at C8** (§Verification): H40's 100%-mechanical numbers are
  rescue-prompt × gpt-4o; the daily prompt × `gpt-5.4-mini` is two simultaneous deltas — measure before the
  flag flips, don't assume transfer.
- `build_snapshot_payload(trace, request, *, …)`: widen the `trace: RescueTrace`/`request: RescueRequest`
  annotations to the generic `RenderTrace`/`RenderRequest`; replace the hard-coded `intent="rescue_item"`
  (`snapshot.py:523`) with `intent=request.intent`. Nothing else in the producer changes (the funnel is
  intent-generic).

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
map or count < 5 the sampler output is byte-identical to cold.

## C. Regenerate = constrained fresh generation with lineage (D2)

The re-roll runs the **full render pipeline again** — one GPT call — under the same Lens. Novelty comes
from GPT stochasticity (`temperature=0.5`) plus the live behavioral layer: the §H repetition window
penalizes re-showing what the chain already surfaced, and cooldown/contextual filters enforce
dislike-invalidation natively. No cache, no re-rank path, no copy-forward provenance. **Named residual
(observe at the C8 smoke, don't pre-build):** the re-roll's prompt is byte-identical to the parent's
(same pool, same Lens), so a mode-collapsed generator could re-emit near-identical candidate sets and
re-create the exhaustion loop with spend attached. The cheap lever, if the live smoke shows it: append
the chain's shown item-id combinations to the re-roll prompt as an explicit avoid-list (the service
already holds them via `behavioralRows`) — decided at C4/C8 from observed behavior. Re-ranking must
never mutate a parent — the shipped guards forbid it anyway (verified `GenerationSnapshot.ts:481-483`).
Four contract pins:

1. **Lineage + `generationIndex` (H7) — server-derived, never client-trusted.** The client's regenerate
   request carries **only** `{requestId, parentSnapshotId, controls}` (the client holds the snapshotId —
   it is the feedback-binding token). **Next then enforces the lineage gate before calling the service:**
   re-read the parent by `{_id: parentSnapshotId, user}` (**ownership enforced** — a nonexistent or
   cross-user parent → stable 404, pre-service, no spend); **derive the child's Lens verbatim from the
   parent row** (occasion, weather, weatherRaw, location, constraints, seedDate — M5 constraints are
   always `{}` because non-empty constraints are rejected until the engine consumes them; D2's "same Lens, same
   `session_seed` → same sampled pool" is *enforced by construction*, not hoped from a client echo;
   only the wardrobe is fetched live, so deletions/new dislikes reflect); and **compute
   `generationIndex = parent.generationIndex + 1` server-side** — a client-supplied `generationIndex`
   or Lens on a re-roll is ignored (the wire fields exist for first renders and for Next→service, both
   inside the trust boundary; the *client* is not). First render `= 0`. The child stores
   `parentSnapshotId` in a **new §G field (does not exist today; verified absent)**. `generationIndex` stays barred from any key/seed input except `tiebreak_seed` (already
   wired via `RankerContext`, verified); the **sampler** seed (`session_seed`) excludes it, so a re-roll
   re-samples the same pool deterministically and the fresh GPT draw is the variety source.
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
   fields. **Preflight (all three checks run before any GPT spend):** `locked ∩ disliked ≠ ∅` → stable
   `400/409`, never empty-success; a locked id absent from the live wardrobe → stable `400`; **a
   structurally infeasible lock set → stable `400` with a reason code** — validate the locked items
   against the template algebra via `clothingType`: at most one lock per slot (`top`/`bottom`/`dress`/
   `outer`/`shoes`), and a locked `dress` is mutually exclusive with a locked `top` or `bottom` (two
   locked shoes, or dress+top, can never co-occupy a valid slot map — without this check the request
   spends the GPT call, the post-validate lock drop then kills every candidate, and the user gets a
   vague empty honest-partial instead of "these locks can't coexist"). **Locks** generalize the rescue
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
     shown set — idempotent response, one corpus row.
   - **Early read-check** (step 2 in §A): a best-effort spend guard that catches completed-render retries
     before calling the service. It does **not** bound in-flight duplicates — the index does.
   - **Client minting rule (load-bearing):** `requestId` is minted **once per user Generate action** and
     reused by any retry of that action; the button is disabled while a render is in flight. A per-click
     token defeats the entire mechanism.
5. **Determinism promise + spec reconciliation (H4/H16/H17).** *Snapshots are immutable; every generation
   — first render or re-roll — is a fresh draw.* Rewrite every v2 cache home **in the same commit as
  C4/C5** (conflicts are bugs): §5's pipeline table ("candidate generation … cached" / Step-7 cache
  wording), §6.7, **§14's R9 cached-candidate/merge wording**, §15's two-stage-cache paragraphs, the §20
  M5-row "two-stage cache" deliverable, Appendix A's R1/N1 forwarding text, and Appendix B's cache-TTL
  constant. Note the spend consequence honestly:
   re-roll cost is linear in clicks (~$0.01 each), bounded by pin 4 + the §A rate ceiling + the UI debounce.

**Acceptance (C4, pytest + service tests):** a re-roll request produces a child render whose payload has
its own attempts, `generation_index = parent+1`; a contradictory `locked ∩ disliked` request returns the
stable error pre-generation; a structurally infeasible lock set (two locked shoes; locked dress + locked
top) returns the stable `400` with **zero generator calls**; a candidate missing a locked item is
dropped post-validation; a disliked
item never appears in the child's surfaced set (Step-4). **(TS-side at C5:** `parentSnapshotId` stored +
serde round-trip; duplicate-`requestId` concurrent writes yield one snapshot + the loser returns the
winner's shown set.)

## D. Engine-failure boundary (D3 / H12)

The boundary must be **observable**, and the degenerate payload must be constructable at **every**
internal failure point — including before generation runs.

- **Boundary:** a snapshot is written **iff a parseable, adapter-valid engine payload reached the Next
  writer** (matches the R5 validate-or-log-and-skip rule already in §15). Not the unobservable "did the
  engine run".
- **Invalid request ≠ engine failure (corpus-purity boundary, pinned).** A request that fails the
  service's **input validation** — clamp violations, `reject_duplicate_ids` on the wardrobe, malformed
  shapes, a `RenderRequest` guard raise (e.g. rescue with no `forced_item_id`) — is a **caller bug**: it
  returns the `contract_invalid` error envelope, **no payload, no snapshot** (Next logs + counts it; a
  TS adapter bug must surface as a loud 4xx to fix, never become a training-corpus row). **Degenerate
  payloads are reserved for internal engine failures on a VALID request** — a sampler/ranker bug
  mid-pipeline, GPT parse-fail-after-repair, an empty valid set.
- **Service owns degrade-to-payload — and provenance never depends on generation.** Every
  provenance-required field is derivable from the request + module constants (`fitted_core_version`,
  `prompt_version`, `ranker_config_version` are constants; `generator` is the service's own config (§A —
  never the wire object); `scorer` is config) — so a schema-valid degenerate payload is constructable even
  for internal failures **before** any GPT call (a sampler/ranker bug on a validated request). *Trap-guard:*
  never reason "generation didn't run ⇒ provenance unknown ⇒ no snapshot" — that routes recordable
  internal failures to the no-snapshot arm and loses the failure corpus §15.1 wants.
- **Recording locus split (never fabricate an attempt):**
  - failure **with** generation attempts (parse-fail-after-repair, empty valid set) → recorded in
    `generationAttempts[]` as today; arrays present, possibly empty candidates.
  - failure **without** an attempt (pre-GPT raise, caught internal exception) → **empty**
    `generationAttempts[]` (required-may-be-empty, `GenerationSnapshot.ts:323-327`) + the failure
    `{stage, code, message}` in a named `diagnostics.engineFailure` field. §8.2-E's "never forced into
    fake candidates/attempts" applies to attempts too.
  - **`diagnostics.engineFailure` needs an explicit home in all three layers (trap-guard — Mongoose
    strict mode silently strips unknown subdoc paths, so a missing schema field loses the failure
    corpus with every test green):** (1) `DiagnosticsPayload` gains `engine_failure: Optional[dict] =
    None` (`snapshot.py` — lands at C3 with the degenerate builder); (2) `snapshot_serde` maps
    `engine_failure ↔ engineFailure`; (3) the TS diagnostics subschema gains a named
    `engineFailure: { stage: String, code: String, message: String }` subdoc (`_id:false`, optional) —
    the fourth §G addition. Acceptance must **read the field back** after a write, never trust
    write-success.
  - **`build_degenerate_payload(request, failure)` is a C3 deliverable** — `build_snapshot_payload`
    requires a `RescueTrace` (verified `snapshot.py:491`), which a pre-trace exception doesn't have.
    It carries the **full §G.1 identity/echo-through set** — in particular `request_id`: a degenerate
    write without it escapes the §C.4 partial unique index (`$exists` never matches) and duplicates on
    retry, exactly the failure mode the index exists to stop.
  - Known micro-gap, recorded not fixed: a generator exception mid-trace-capture (`rescue.py:813`) loses
    the in-flight attempt's raw text; the failure is recorded via `diagnostics.engineFailure` only.
- **Next's rule stays dumb.** Payload ⇒ validate + write; no payload ⇒ log + increment an availability
  counter + return the §A degraded empty state + **discard the pre-allocated `snapshotId`** (degraded
  responses carry no `{snapshotId, candidateId}`).
- **Named residual gap.** Generation ran but the response was lost in transit (money spent, no row) is
  unrecorded — rare, zero-user, un-bindable. Written into §15.1 as a known gap class.
- **Constants:** `SERVICE_TIMEOUT_MS` in Appendix B (value tuned at C5). Trigger set: unreachable OR timeout
  OR 5xx OR auth-fail OR rate-limit OR parse-OK-contract-fail.

**Acceptance:** an injected **post-generation** engine failure yields a degenerate payload recording the
failure in `generationAttempts[]`; an injected **pre-generation internal** failure yields a degenerate
payload with empty attempts + `diagnostics.engineFailure` set — both validate + write; an **invalid
request** yields `contract_invalid` + no payload + no snapshot; an injected transport failure
yields no snapshot + a non-bindable degraded response + a counter tick; an anti-rot smoke test exercises
all four arms.

## E. The H28 scorer seam (D7) — calls decided; basis noted

Verified: `compatibility(slot_map, items_by_id, request: LensRequest) -> float` and `visibility(...)`
(`response.py:338/:406`) are **already written to the scorer-seam signature**. The **ranker is deliberately
items-blind** — `rank()`/`rank_with_audit(candidates, context)` take no `items_by_id` (`ranker.py:118`);
the **snapshot producer** is where items live (`RescueTrace.prompt_pool`, verified `rescue.py:795`). The
seam lands in two honest, minimal moves; order-influence defers to M6:

```python
# 1. Declare the type (new scorer module) — the shape M6's trained scorer implements:
class OutfitScorer(Protocol):
    def __call__(self, slot_map: SlotMap, items_by_id: Mapping[str, WardrobeItem],
                 request: LensRequest) -> OutfitScore: ...   # OutfitScore(compatibility: float,
                                                             #   visibility: float, signal_score: float | None)
```

- **Exercise it in the producer (M5), resolving the H48 *sibling* (response-layer tail).** Extend
  `snapshot._build_candidates` step 6 (`snapshot.py:330-345` — today it attaches compat/vis **only** for
  candidates present in `trace.build_trace.all_variants`, i.e. ≤k, which is exactly the H48 tail) to compute
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
  `scorer.kind="cold_start"`/`available=true` on M5 writes.
- **`scorer` block semantics (pinned — the schema names the fields but nothing pins the referent,
  verified spec §15.1:768 + `GenerationSnapshot.ts:311-322`, and there are now TWO scorers in play):**
  the snapshot `scorer{kind, modelId, available}` block is the **outfit/rank-scorer provenance axis**
  (this H28 seam), and `available` means **"an `OutfitScorer` occupant was exercised over this render
  and populated `scoreTrace.compatibility/visibility` for all scored candidates"** — explicitly NOT
  "influenced rank order". Rank-order influence is readable only from `kind="trained"` (+ the M6
  `RankerContext` signal recorded in `diagnostics.ranker`); an M6 corpus reader must never infer order
  influence from `available` alone. The **sampler** `SignalScorer`'s state (the §B
  `AffinitySignalScorer`) lives in `diagnostics.scorerAvailable` + the per-type `selection_kind` —
  never in the `scorer` block. Today's producer writes `available=False` (verified `snapshot.py:539`);
  it flips to `true` when the C4 producer exercise lands. Pin this semantic into spec §15.1's field
  list at the C4/C5 doc-reconciliation.
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
| `occasion` | `eventDescription` / occasion text | verbatim, **trim-check** (whitespace-only `"   "` PASSES Mongoose `required`, verified pre-flight lane 4 — the adapter must reject/normalize it, else a blank-occasion snapshot) |
| `weather` (bucket) | `getWeatherContext` raw → bucket | R5 bucketing: temp/condition → `hot|mild|cold|indoor|outdoor`. Refactor the adapter/helper to return `{weatherBucket, weatherRaw}`; the legacy `TemperatureHint` union is byte-identical to the Mongo enum (pre-flight lane 3) so straight wiring is safe; **un-bucketed raw throws Mongoose enum on write** → bucket *before* the payload is built |
| `weatherRaw` / `location` | raw weather / geo | pass-through (nullable) |
| `intent` | route + request shape | `/recommend` daily flow → `"daily"`; a forced-item rescue request → `"rescue_item"` (routing rule — the one route dispatches on the presence of `forcedItemId`) |
| `forcedItemId` | rescue request | pass-through; **required iff `intent="rescue_item"`** (mirrors `RenderRequest`) |
| `seedDate` | server clock | **UTC** `YYYY-MM-DD` (H8) — identical string computed Next-side and passed in (the service does not read a clock; determinism) |
| `constraints` | request knobs | **M5 defers constraints behavior.** The adapter sends `{}` and rejects any non-empty request map before the service call; the service independently rejects non-empty maps too. H36 becomes engine-active only when prompt/ranker/key semantics are implemented together. |

**Wire-validation (R12 part 2):** this adapter is the trust boundary — non-empty ids/strings, tag-container
shape, one predictable error channel; **validate-or-log-and-skip, never let Mongoose throw mid-write.**

## G. Schema additions (`fitted/models/GenerationSnapshot.ts`)

Six concrete additions (all additive) plus one existing-field tightening; the model is otherwise
M4b-complete:

```ts
// 1. Lineage pointer (C5 — does NOT exist today; verified absent):
parentSnapshotId: { type: Schema.Types.ObjectId, ref: "GenerationSnapshot" }, // null on root renders
// serde: add parent_snapshot_id ↔ parentSnapshotId to snapshot_serde._ID_KEYS (ObjectId→string opacity, H10)

// 2. Render idempotency (§C.4 / H50 — requestId exists today but is optional/unvalidated):
requestId: {
  type: String,
  validate: {
    validator: (v?: string | null) =>
      v == null ||
      (
        v.length <= 64 &&
        (
          /^[0-9A-HJKMNP-TV-Z]{26}$/.test(v) ||
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
        )
      ),
    message: "requestId must be a UUIDv4 or ULID when present",
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

// 4. Engine-failure record (§D — strict mode otherwise silently strips the write):
//    inside the diagnostics subschema:
engineFailure: {
  type: new Schema(
    { stage: { type: String }, code: { type: String }, message: { type: String } },
    { _id: false },
  ),
},

// 5. R9 controls (§C.3 — locks scope the pool+prompt, dislikes hard-filter Step-4; the exact inputs
//    that shaped a regen render MUST be in its row or the corpus can't explain it. Verified absent
//    from the section-B Lens fields today. Python-authored from RenderRequest (engine input, §G.1);
//    empty arrays on non-regen renders):
controls: {
  type: new Schema(
    { lockedItemIds: { type: [String], default: [] }, dislikedItemIds: { type: [String], default: [] } },
    { _id: false },
  ),
},

// 6. Generation cap provenance (service-owned config that changes truncation/parse-fail/candidate
//    distributions — M6 must stratify by it; additive-required is safe pre-first-write):
//    inside the generator subschema:
maxCompletionTokens: { type: Number, required: true },
```

**Central TS payload validation helper (H29 — before every `.create()`).** The Mongoose schema accepts docs
a serde payload never produces but a TS writer bug could: `scoreTrace.compatibility/visibility` are plain
`Number` with **no `[0,1]` validator** (verified `GenerationSnapshot.ts:49-50`), and `shownCandidateIds`/`shownFullSignatures`/
`nSurfaced` have no cross-validator. The helper validates: finite numbers; `compatibility`/`visibility ∈
[0,1]`; `candidateId` uniqueness; **exact** shown-set equality, not subset (`shownCandidateIds` and
`shownFullSignatures` equal candidates with `shown=true` sorted by contiguous `shownPosition=0..n-1`, and
`nSurfaced` equals the length); `itemSnapshots[].itemId` uniqueness; candidate `items[]` ↔ `slotMap`
consistency; **every candidate content id** (`items[].itemId` and `slotMap` values, shown or unshown) has a
matching `itemSnapshots[]` row; raw-field caps (`RAW_*_CAP_BYTES` + hash + truncation flag). Writes via
`.create()` / pre-allocated-`_id` insert only — **never `bulkWrite`** (bypasses the immutability middleware, verified
`:384-385`). The merge boundary is pinned field-by-field in §G.1 — "the Python payload authors everything
else" was **false as previously written** (the payload lacked five live M5 schema fields) and that class
of gap fails silently.

### G.1 Field-ownership merge boundary (pinned field-by-field)

| Owner | Fields |
|---|---|
| **Python payload — existing** (verified `snapshot.py:135-165`) | `sessionId`, `candidateCacheKey`, `generationIndex`, `intent`, `occasion`, `weather`, `forcedItemId`, `wardrobeVersion`, `seedDate`, `fittedCoreVersion`, `generator{}`, `rankerConfigVersion`, `scorer{}`, `itemSnapshots[]`, `generationAttempts[]`, `candidates[]`, `diagnostics{}`, `shownCandidateIds`, `shownFullSignatures`, `nSurfaced`, `spreadCollapsed` |
| **Python payload — GAINS at C3** (echo-through of the wire request, so the payload stays the single validated artifact; lands with the serde mappings because `build_degenerate_payload` needs them) | `requestId`, `parentSnapshotId`, `weatherRaw`, `location`, `constraints` — plus `diagnostics.engineFailure` (§D). **M5 invariant:** `constraints` is always `{}`; non-empty constraints are rejected rather than stored as inert provenance. **Mechanism:** caller-supplied kwargs on `build_snapshot_payload`/`build_degenerate_payload` (the existing `candidate_cache_key` pattern — "supplied by the caller, M5 knows them", verified `snapshot.py:495+`); `RenderRequest` stays the pure engine request, no HTTP-layer fields |
| **Python payload — GAINS at C4** (authored from `RenderRequest` — engine input, not HTTP echo: locks/dislikes shape the pool, prompt, and Step-4 filter) | `controls{lockedItemIds, dislikedItemIds}` (empty arrays on non-regen renders). (`generator.maxCompletionTokens` lands at **C3** with the other payload gains — the service authors the generator block from its own config from its first payload) |
| **TS merge adds — exactly four** | `_id` (= pre-allocated `snapshotId`), `user` (ObjectId), `interactionCountAtRequest`, per-item `evidence{}` |
| **Absent on M5 writes** (nullable B-track fields, no writer yet) | `baseOutfitItemIds`, `routineId`, `lens{}` (styleProfile block) |

- **Serde:** `parent_snapshot_id` joins `_ID_KEYS` (ObjectId→string opacity, H10). **`request_id` must
  NOT join `_ID_KEYS`** — it is a client-minted plain string token, not an ObjectId. `weather_raw`/
  `location` are standard key renames; **`constraints` is a DATA-keyed map** — serde preserves its keys
  verbatim (the `samplerPerType` convention), never case-converts them. `controls.locked_item_ids` /
  `controls.disliked_item_ids` join `_ID_SEQUENCE_KEYS` in both casings (`lockedItemIds`/
  `dislikedItemIds`) so non-string lock/dislike ids fail at the service boundary instead of becoming
  inert or mismatched persisted controls; the request/controls validator also rejects blank string
  elements (they are not real wardrobe ids).
- **Cross-check (helper):** `payload.requestId == request.requestId` and `payload.parentSnapshotId ==
  request.parentSnapshotId` — a service that mangles an echo-through field is `contract_invalid`.
- **Trap-guard (silent idempotency death):** the §C.4 partial unique index filters on
  `requestId: { $type: "string" }` — a document written **without** the field or with `null` is invisible
  to the index, and malformed/blank strings would become shared retry sentinels if validation were weakened.
  C5 acceptance must read the written document back and assert a UUIDv4/ULID, never trust write-success.

**Acceptance:** jest — delete guard rejects **all four delete paths** (`Model.deleteOne`/`deleteMany`,
`doc.deleteOne()`, `findOneAndDelete`/`findByIdAndDelete`); the helper rejects each invalid class
(non-finite, out-of-[0,1], dup candidateId, inconsistent/non-contiguous shown set, subset-only shown-set
mutants, oversized raw, shown-identity mismatch §A, duplicate/missing `itemSnapshots`, candidate
`items`/`slotMap` drift, any candidate item id missing from `itemSnapshots`, missing/null/blank/malformed/
overlong `requestId` on a live write, and non-empty `constraints`); `parentSnapshotId` round-trips through serde as an opaque string; controls
id arrays reject non-string elements through serde and blank elements through request validation; two
concurrent same-`{user,requestId}` `.create()`s yield one document + a caught `E11000`; **a written document read
back carries every §G.1 echo-through field** (`requestId`, `parentSnapshotId` on re-rolls, `weatherRaw`/
`location`, and `constraints:{}`), **`controls` on a regen child, `generator.maxCompletionTokens`
on every write, and `diagnostics.engineFailure` on a degenerate write**.

## H. Reducers (H19 repetition-window; H11 feedback-dedup; the behavioral projections)

Pure functions the **service** runs over the **raw `behavioralRows`** Next passes in (§A) — Next fetches the
rows from Mongo, the service reduces them (the reducers are Python). They produce `RankerContext`'s
pre-reduced signal fields (verified names): `item_affinity: Mapping[str,int|float]`,
`liked_full_signatures: frozenset[str]`, `shown_full_signatures: Sequence[str]`,
`recent_disliked_base_keys`, `recent_disliked_item_ids` — plus the sampler's `AffinitySignalScorer` (§B).
(`contextual_disliked_item_ids` / `locked_item_ids` come from the request `controls`, never the reducers.)

- **Action → signal mapping (pinned; the reducers' contract):**

  | Interaction row | Signal contribution |
  |---|---|
  | `action="accepted"` | `item_affinity` **+1 per outfit item** (after dedup, below); `fullSignature` → `liked_full_signatures` |
  | `action="rejected"` | `baseKey` → cooldown buffer (last `COOLDOWN_BUFFER_SIZE`); **disliked item ids = `perItemFeedback[].itemId` where `disliked=true` ONLY** — an outfit-level dislike never marks every item (a wrong-vibe outfit ≠ five bad garments) |
  | `saved`/`worn`/`rated`/`planned`/`packed`/`corrected`/`generated` | **excluded from v1 reducers** — §16 calls them weaker secondary evidence with `[NEXT]` weights; registered here so the exclusion is a decision, not a silent drop |

- **Bounded scan (no unbounded read anywhere).** `interactionRows` are fetched last-`INTERACTION_ROWS_SCAN_LIMIT`
  by `{user, createdAt: -1}` (index exists, verified `OutfitInteraction.ts:104`; default **500**, tuned at
  C2), projected to `{action, createdAt, snapshotId, candidateId, baseKey, fullSignature, items,
  perItemFeedback.itemId, perItemFeedback.disliked}` — nothing else crosses the wire. **Deliberate
  semantic:** affinity/liked-sigs become recency-scoped rather than lifetime (clamped at `MAX_AFFINITY=20`
  anyway) — decided, not accidental. Unbound legacy-shaped rows (no `snapshotId`) are skipped by the
  reducers (the M4a wipe means none exist, but the guard is one line).
- **Repetition-window reducer (H19, §15.1/§14.5).** Read the user's most-recent `REPETITION_WINDOW_SNAPSHOTS`
  snapshots **with `nSurfaced > 0`** by `{user, createdAt, _id}` (most-recent-first; `_id` tie-break),
  bounded scan, walk `shownFullSignatures` most-recent-first, dedup keeping first, truncate to
  `REPETITION_WINDOW_SIZE`. Output an **ordered `Sequence[str]`** (the ranker normalizes to a tuple), **not a
  set**.
- **Feedback-dedup reducer (H11, §16).** The `item_affinity` counted projection collapses rows sharing
  `{snapshotId, candidateId, action}` within `FEEDBACK_DEDUP_WINDOW` to one counted event. Set/recency
  projections (`liked_full_signatures`, cooldown) are idempotent under duplication — no dedup. Interaction
  writes are **append-only** (§I).
- **Constants (Appendix B trap-guard — mechanism pinned):** `REPETITION_WINDOW_SNAPSHOTS`,
  `FEEDBACK_DEDUP_WINDOW`, `INTERACTION_ROWS_SCAN_LIMIT` are **reducer** config with their **own
  provenance axis**. Mechanism: the constants live in **`reducers.py` itself** (their own module
  namespace) with a `REDUCER_CONFIG_VERSION` auto-hash digest over *that module's* `UPPER_SNAKE` globals
  (same `_compute_*` pattern as `config.py:171-190`); **`config.py` is not touched** — its
  `RANKER_CONFIG_VERSION` hashes *every* `UPPER_SNAKE` global in its module with only a two-name
  exclusion set (verified), so placing reducer constants there folds them into ranker provenance (a
  scan-limit tune would shift `rankerConfigVersion` though ranking never changed). Record
  `reducer_config_version` **inside `diagnostics.ranker`** (Mixed — no schema change) alongside the §E
  persisted signal collections, so every stored signal carries its reducer provenance.

**Acceptance:** pytest — the repetition reducer is recency-faithful + dedup-correct + window-bounded; the
dedup reducer collapses in-window retries but counts genuine repeats; the affinity/cooldown projections
match hand-computed golden rows **per mapping-table line** (an `accepted` row boosts, a `rejected` row
cools the baseKey and dislikes only per-item-marked ids, a `worn` row contributes nothing); the scan bound
is enforced (a fetch asking beyond the limit fails the test); an unbound row is skipped.

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
  schema requires `items`, so the derivation is mandatory, not optional.) Make writes **append-only** — corrections are new events, not `findOneAndUpdate`/
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
- **Route rewrite guards.** `locked ∩ disliked ≠ ∅` preflight (H59 — §C.3; stable 400/409, no
  empty-success); **the §C.1 lineage gate** (parent ownership re-read; server-derived Lens +
  `generationIndex` — client lineage claims are never trusted); clamp all body-controlled text/array
  fields (H60/D6) — Next-side, **duplicated service-side per §A**.
- **Client-side state gates.** Namespace `fitted_dashboard_state` by uid + clear on logout (verified global
  key `:52`, restored `:637`, not cleared `:666`); fix redirect-before-sync (`RedirectIfAuthenticated`);
  fix `AddItemModal` save-loss (closes on failed save, `:403`/`:1342`); return stable 400s on malformed ids;
  **C6 already owns the load-bearing render state**: Generate disabled while a render is in flight +
  `requestId` minted per action (§C.4).

**Acceptance:** jest per gate — unauth/cross-user requests rejected; POST-then-GET no longer leaks a victim
item; a contradictory lock set 400s; a double-tap feedback may append two rows but is one reducer-counted
affinity event inside `FEEDBACK_DEDUP_WINDOW`; the PATCH/
DELETE interaction handlers are gone (405/404); no code path updates an interaction row post-insert;
**a POST echoing forged `items`/`baseKey`/`fullSignature` persists the server-derived values, not the
echo** (read the row back); `feedbackReason.codes` valid values persist, invalid values 400, and `rawText`
is capped + stored only in the structured subdocument.

## Build ladder (checkpoints)

Light build-and-audit loop per checkpoint (read real files first, implement, `pytest`/`tsc`/`eslint` on
touched, one fresh-context review agent). **Heavy loop before C5 (first live write) and at C8 (flag flip /
legacy deletion)** per CLAUDE.md.

**Ladder sequencing invariant (trap-guard — the second-eval High finding, recalibrated for no legacy
users):** at every checkpoint boundary the app must render **and** bind feedback end-to-end in at least
one mode — legacy flag-off through C5; new-contract flag-on from C6 on. Concretely: a server contract
change and its UI callers land in the **same** checkpoint (C6 = interactions route + dashboard/history
rewrite together), and **the flag flips only after the UI speaks the new contract** — never rewrite a route
at Cn and its caller at Cn+2. There is no old-user migration promise: after C6 the UI speaks the §6.5
contract only; legacy code is rollback/reference scaffolding until C8 deletion, not a compatibility target.

#### C1 — Daily orchestrator + generator params (fitted_core)
**Touches:** `rescue.py` (→ `RenderRequest`/`render`/`render_with_trace` + rescue wrappers + the
`signal_scorer=` injection param + **the `_drop_invalid` split — intent-generic StyleMove drop, §B**),
`snapshot.py` (`build_snapshot_payload` intent parameterization),
`generation.py` (daily prompt + `gpt-5.4-mini`/`0.5`/`max_completion_tokens` defaults, H55), `config.py`
if new prompt constant. **Deliverables:** §B (incl. daily `n_surfaced=3` + the StyleMove-drop split).
**Acceptance:** §B (the
signal-slot cases run at C2 when `AffinitySignalScorer` exists; C1 asserts the injection default keeps
goldens byte-identical). **Dependencies:** none — lands first. Closed M0–Spearhead + M4b suites green.

#### C2 — Reducers + AffinitySignalScorer as pure functions (fitted_core)
**Touches:** new `ml-system/fitted_core/reducers.py` (reducers + `AffinitySignalScorer` + the action→signal
mapping + **the reducer constants `REPETITION_WINDOW_SNAPSHOTS`/`FEEDBACK_DEDUP_WINDOW`/
`INTERACTION_ROWS_SCAN_LIMIT` and their own `REDUCER_CONFIG_VERSION` digest — `config.py` is NOT touched,
per the §H mechanism pin**). **Deliverables:** §H + §B's occupant. **Acceptance:** §H + §B signal-slot
cases; a reducer-constant bump shifts `REDUCER_CONFIG_VERSION` and does **not** shift
`RANKER_CONFIG_VERSION`. **Dependencies:** none (parallel to C1).

#### C3 — Stateless HTTP service (ml-system/service)
**Touches:** new `ml-system/service/app.py`, `Dockerfile`, `fly.toml`, `ml-system/service/tests/`;
`snapshot.py` + `snapshot_serde.py` (**the §G.1 payload gains: `DiagnosticsPayload.engine_failure` +
the five echo-through kwargs (`request_id`, `parent_snapshot_id`, `weather_raw`, `location`,
`constraints`, plus `generator.max_completion_tokens` from the service's own config §G) + their serde
mappings incl. `_ID_KEYS += parent_snapshot_id` and DATA-keyed
`constraints` — the degenerate builder needs the full identity set, §D**); `seed.py`
(**`candidate_cache_key()` + golden vectors + the stale "M5 cache key" docstring fix, §C.1 — the
service cannot build a payload without it**). **Deliverables:** §A wire contract + auth (two-key) + error envelope
+ **the §A service-side bounds** (generator exact-match validation, service-owned token cap,
text/body clamps, rate ceiling); `OPENAI_API_KEY` server-side; `/render` calling `render_with_trace` +
`to_wire` + **the §A shown-identity zip (by `full_signature`, candidateId on every shown entry) + the
§A `variant_to_wire()` outfit serializer**;
**`build_degenerate_payload(request, failure)`** (§D — carries the §G.1 identity set incl. `request_id`).
**Acceptance:** integration test with a fake
`Generator` — `/render` returns a valid payload+shown with **`shown[].candidateId` equal to
`payload.shownCandidateIds` in order**; missing `X-Fitted-Service-Key` → 401; a
disallowed `generator.model`, a `generator.temperature` ≠ the service's configured value, **or
`generator.maxCompletionTokens` ≠ the service's configured cap** →
`contract_invalid` (never clamped); the payload's `generator` block is authored from the service config,
not echoed from the wire; an overlong `occasion` → clamped/rejected; non-empty `lens.constraints` →
`contract_invalid`; a fake OpenAI client sees `max_completion_tokens`, **not** `max_tokens`; **a duplicate-id wardrobe (or other
input-validation failure) → `contract_invalid` with NO payload** (§D corpus purity — never a degenerate
snapshot); injected
post-generation failure → degenerate payload with attempts; injected pre-generation failure → degenerate
payload with empty attempts + `diagnostics.engineFailure`; the `candidate_cache_key()` golden vectors
pass; the `variant_to_wire()` §6.5 wire-conformance goldens pass (enum values, styleMove, breakdown
keys, object-shaped `items`, `templateType`, and no `template` field). **Dependencies:** C1 (needs `render`) + C2
(the service runs the §H reducers over `behavioralRows`). Set the OpenAI project's monthly budget cap
(dashboard) when the key is provisioned.

#### C4 — Regenerate vertical + the H28 seam (fitted_core + service)
**Touches:** new scorer module (`OutfitScorer` protocol + cold-start occupant), `snapshot.py`
(`build_snapshot_payload` `outfit_scorer=` param + `_build_candidates` full-scored compat/vis population),
`ranker.py` (H48-headline: attach the Step-5 `ScoreBreakdown` to variant-cap losers in
the `rank_with_audit` trace — the closed M3 `rank()` is **not** touched), `response.py` (cold-start scorer
adapter), `rescue.py`/service (the §C constrained fresh-gen regenerate: lock-scoped pool + prompt pin +
post-validate lock drop + **the three-check preflight incl. structural feasibility, §C.3**),
`snapshot.py`/`snapshot_serde.py` (**payload gains `controls` — authored from `RenderRequest`'s new
locked/disliked fields — + serde mapping incl. `_ID_SEQUENCE_KEYS` for `lockedItemIds`/`dislikedItemIds`,
§G.1**),
`diagnostics.ranker` signal + `reducer_config_version` persistence (§E/§H). (The §G.1 echo-through
payload fields + serde mappings + the `candidate_cache_key()` helper landed at C3.) **Deliverables:** §C
(pins 1–3, 5) + §E. **Acceptance:** §C + §E. **Dependencies:** C1, C2
(`REDUCER_CONFIG_VERSION` for the diagnostics record), C3.

#### C5 — Next-side integration  [HEAVY AUDIT before + after]
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
a re-roll is ignored (the child's index is `parent+1` regardless); duplicate valid `requestId` → one
snapshot; missing/null/blank/malformed/overlong `requestId` is rejected before any service call/write;
non-empty `constraints` is rejected; a degraded arm writes no snapshot and returns the §A degraded empty
state, never legacy `outfits[]`; the
helper rejects each invalid class, including subset-only/inexact shown arrays, duplicate/missing
`itemSnapshots`, candidate `items`/`slotMap` drift, and **any** candidate item id (shown or unshown) missing
from `itemSnapshots`; the browser response carries `displayItems` sourced from `itemSnapshots`; **written documents read back
carry `requestId` + every §G.1 echo-through field** (the idempotency index is dead without them);
`tsc --noEmit` + `eslint` clean on touched.
**Dependencies:** C3, C4, C2.

#### C6 — Feedback gate + append-only interactions + UI contract cutover (Next)
**Touches:** `fitted/app/api/interactions/route.ts` (gate + PATCH/DELETE removal + Gemini write-back
removal), `fitted/models/OutfitInteraction.ts` (`feedbackReason` schema addition; binding fields already exist),
**`dashboard/page.tsx` + `history/page.tsx` (the UI rewrite — moved here from C8 per the ladder
invariant: the dashboard renders legacy `outfits[]` with `itemIds/confidence/reason` and posts feedback
as `{itemIds, action, occasion}` (verified `:24-29`/`:748-752`), history calls DELETE/PATCH (verified
`:143`/`:165`) — route, feedback API, and callers are one contract cutover)**.
**Deliverables:** §I feedback gate + append-only + GET populate scoping + `feedbackReason` validation;
**dashboard rewritten to the
§6.5 response + StyleMove card (H45), minting one UUIDv4/ULID `requestId` per Generate action, reusing it
on retries, disabling Generate while a render is in flight, and posting `{snapshotId, candidateId}` feedback — **no legacy response
compat branch**; stale persisted dashboard state may be dropped/renamespaced because there are no old
users); **history rewritten append-only** (the remove/move affordances die in the same commit as
PATCH/DELETE — corrections are new events; **card data source: the GET
response server-joins the bound candidate's content — `styleMove`/`optionPath`/`risk`/items — via the
row's `{snapshotId, candidateId}` at read time** (the `{snapshotId, candidateId}` index exists, verified
`OutfitInteraction.ts:107`); no denormalized write, and the join is user-scoped like the populate); the
persisted dashboard state
shape follows the new contract and uses `displayItems` hydrated from snapshot `itemSnapshots` (not legacy
`itemIds`/`confidence`/`reason`). *Window note:* from C6, the supported app path requires flag-on
(snapshots must exist); flag-off is rollback/reference only until C8 deletion, not a user-facing UI mode.
**Acceptance:** §I; flag-on — dashboard renders §6.5 + StyleMove card, mints/reuses one requestId per
Generate action, disables duplicate in-flight renders, hides feedback controls on the degraded empty
state, and like/dislike posts `{snapshotId, candidateId}`; valid structured `feedbackReason` persists through POST/read-back; **no
legacy-shaped response branch and no `itemIds`-bound POST path remain**; history is append-only with no
PATCH/DELETE call sites (grep + jest). **Dependencies:** C5 (needs live snapshots to bind against).

#### C7 — Close remaining §19 gates (Next)
**Touches:** `account/route.ts`, `auth/sync/route.ts`, `images/[imageId]/route.ts`, `cv/infer/route.ts`, the
new recommend route (H59/H60), `dashboard/page.tsx`, `wardrobe/page.tsx`, `(app)/RedirectIfAuthenticated.tsx`,
`signin/page.tsx`. **Deliverables:** §I retained-route auth + route-rewrite guards + remaining client-side
state gates (requestId minting/debounce already landed with the C6 UI contract). **Acceptance:** §I.
**Dependencies:** C5 (route rewrite lands there).

#### C8 — Cutover  [HEAVY AUDIT; **two commits**]
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
**the pre-flip
daily mechanical read** (extend the **Spearhead-C6**/H40 eval CLI to the daily intent — not this plan's
C6; ~5 runs on the golden wardrobe
with the real `gpt-5.4-mini`; gates mechanical — parse rate, hallucinated ids, schema-rejection rate;
believability stays descriptive per H40); **capture the legacy baseline numbers** (the writeup's "before");
flip `USE_ML_SHORTLISTER=true`; live smoke — **the UI already speaks the new contract (C6), so the smoke
exercises dashboard daily + rescue + re-roll + bound feedback end-to-end, not just the route**.
**Commit 2 — deletion:** delete the §19 list — **`recommend/regenerate/route.ts` (whole file) + the
flag-off legacy arm of the rewritten `recommend/route.ts`** (the C5 legacy module + its one-line call
site; **the M5 route file itself is NEVER deleted** — it IS the live endpoint; post-deletion flag-off =
degraded empty state per the rollback story), legacy prompt-weather use (retain/refactor the M5
weather-bucket adapter; do **not** move weather/network work into the Python service), `lib/gemini.ts`, the
string-grep/footwear-inject paths (exact lines in §19; spot-verified pre-rewrite: `inferItemType`
recommend `:472` / regen `:484`, footwear auto-inject recommend `:512-527` / regen `:511-525` — these
live inside the extracted legacy module after C5), CI workflow (H13), CLAUDE.md env-table
update (Gemini row removed; `OPENAI_API_KEY` moves to the service).
**Rollback story (pinned):** post-deletion, `flag=false` means **degraded empty state**, not legacy — the
flag's remaining job is service-outage degradation; rollback = git revert of commit 2 + redeploy.
**Deliverables:** cross-runtime CI (Python + jest + a seed/serde conformance check on golden vectors —
non-BMP occasion, None/empty/"0" date, reserved chars; assert no TS seed reimpl exists, or add the H51
golden-vector test if one does); legacy deletion; flag flip + live smoke.
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
| **Internal** engine failure before any generation attempt (sampler/ranker bug on a valid request) | Degenerate payload, **empty** attempts + `diagnostics.engineFailure`; Next writes it | §D recording-locus split — never fabricate an attempt |
| Generation ran, response lost in transit | Unrecorded (money spent, no row); degraded response | D3 named residual gap |
| Re-roll (regenerate) | One constrained fresh generation; child snapshot with own attempts, `generationIndex+1`, `parentSnapshotId` | D2 |
| Re-roll with `locked ∩ disliked ≠ ∅` | Stable 400/409 pre-generation, never empty-success | §C.3 / H59 |
| Locked item no longer in the live wardrobe | Stable 400 (lock unsatisfiable) | §C.3 |
| Post-lock/dislike filtering leaves < `n_surfaced` | Honest partial + notice; never a silent lock drop, never a second GPT call | §C.3 / R9 |
| Double-clicked Generate (same valid `requestId`) | One snapshot (partial unique index); loser returns the winner's shown set | §C.4 / H50 |
| Missing/null/blank/malformed/overlong `requestId` on a live write | `contract_invalid` before service call/write; no shared retry sentinel | §C.4 / §G helper |
| Non-empty `constraints` at M5 | `contract_invalid`; no service call/write from Next, and service independently rejects if reached | Constraints are deferred until prompt/ranker/key semantics are engine-active |
| Feedback `candidateId ∉ shownCandidateIds` / item not in candidate | Reject | §16 authenticity gate |
| `feedbackReason.codes` contains an unknown code | Stable 400; no row written | §16 closed structured-reason set |
| Any candidate (`items[]`/`slotMap`, shown or unshown) references an item missing from `itemSnapshots` | `contract_invalid`; no snapshot write, no unrecoverable training row or unhydratable browser card | §A hydration pin + §G helper |
| `weather="72F sunny"` / `occasion=""` / `occasion="   "` at the adapter | Bucket weather; trim-check occasion; validate-or-log-and-skip | R5 (pre-flight lane 4: whitespace occasion PASSES Mongoose `required` — adapter must catch) |
| Daily intent, no forced item | Full-pool sample; daily prompt; no forced-item scoping; real `interaction_count` | D1 |
| Daily closet too small (sampler `not_enough_items`) | Pre-GPT short-circuit: no generator call, `flags.notEnoughItems=true`, valid empty snapshot with engine-visible itemSnapshots written | §B — preserves corpus truth while never spending on an impossible render |
| `interaction_count ≥ 5` + non-empty affinity | Sampler signal slot **opens** (`AffinitySignalScorer`); ranker behavioral layer active from §H signals | §B — personalization comes alive on both seams; NOT the trained scorer (M6) |
| `interaction_count ≥ 5`, empty affinity (or < 5) | Sampler byte-identical to cold (`signalUnavailable`/`coldStartSampling` label only) | R11 — availability ≠ count |
| Daily candidate with missing/malformed StyleMove | Dropped pre-rank (intent-generic drop); honest partial if `< n_surfaced` | §B — `_assemble_variant` hard-asserts non-null; `None` must never reach assembly |
| Structurally infeasible lock set (two shoes; dress+top) | Stable `400` with reason code, **zero generator calls** | §C.3 third preflight check |
| Legacy-shaped response after C6 | Unsupported by the UI contract; no compat branch, no feedback post path | No old users; legacy code is rollback/reference only until C8 deletion |
| Wire `shown` ids ≠ `payload.shownCandidateIds` (order/length) | `contract_invalid` at the helper — no write, no mis-bind | §A shown-identity pin |

## Mutation-hardening (each test must fail a naive mutant)

- Flip `rank()` to read `outfit_scorer` → an M3 golden test must go red (proves the M5 no-order-change guard).
- File a variant-cap loser in `.filtered` with no preserved Step-5 breakdown → the H48-headline corpus-completeness test must fail.
- Drop setting `parentSnapshotId` on a re-roll child → the lineage test must fail.
- Reuse the parent's `generationIndex` on the child → the identity test must fail.
- Remove the `{user, requestId}` partial unique index, change its filter back to `$exists`-only, allow
  missing/null/blank/malformed/overlong live `requestId`, or remove the `E11000` winner-re-read → the concurrent double-write /
  sentinel-rejection tests must fail.
- Remove the `locked ∩ disliked` preflight → the contradictory-controls 400 test must fail.
- Route a pre-attempt engine failure to the no-snapshot arm (or fabricate an attempt for it) → the failure-corpus test must fail.
- Skip the degenerate-payload arm (write nothing on engine-internal failure) → the failure-corpus test fails.
- Remove the `INTERACTION_ROWS_SCAN_LIMIT` bound → the bounded-fetch test must fail.
- Make `AffinitySignalScorer.is_available()` return `True` on an empty map (or call `.score()` when unavailable) → the guard tests must fail.
- Count a `rejected` outfit's unmarked items as disliked → the mapping-table golden test must fail.
- Remove the occasion trim-check → the whitespace-occasion write test must fail (Mongoose would accept it).
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
- Weaken exact shown-set validation back to subset membership, allow duplicate/non-contiguous `shownPosition`,
  or let `shownFullSignatures` drift from the shown candidates → the shown-set helper tests must fail.
- Strip `engineFailure` from the diagnostics subschema → the pre-generation failure **read-back** test must fail (strict mode silently drops the path — write-success alone proves nothing).
- Bump a reducer constant → `REDUCER_CONFIG_VERSION` must shift and `RANKER_CONFIG_VERSION` must **not** (catches the constants-moved-into-`config.py` mutant, where the bump would shift ranker provenance).
- Remove the structural lock preflight → the two-locked-shoes 400 test must fail (a generator call would fire).
- Reintroduce a legacy-shaped response branch or an `itemIds`-bound feedback post path after C6 → the UI
  contract / no-legacy-feedback tests must fail.
- Remove any one of the three delete-guard registrations (query `deleteOne`/`deleteMany`/`findOneAndDelete`, or the `{document:true}` variant) → its jest rejection case must fail.
- Add `GenerationSnapshot.bulkWrite`, `GenerationSnapshot.collection.delete*`, or raw `generationsnapshots`
  delete calls outside an approved maintenance script → the static guard test must fail.
- Make the service clamp-or-obey a mismatched wire `generator.temperature` or `generator.maxCompletionTokens`
  instead of rejecting → the exact-match `contract_invalid` test must fail.
- Send `max_tokens` to OpenAI instead of `max_completion_tokens` → the fake-client generation test must fail.
- Take `generationIndex` (or the Lens) from the client on a re-roll, or skip the parent `{_id, user}` ownership re-read → the lineage-gate tests must fail (forged parent 404; ignored client index).
- Drop `controls` from a regen child's payload/document, accept numeric elements through serde, or accept
  blank elements through controls validation → the regen-corpus read-back / controls-id tests must fail.
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
  service bounds. Floor grows from 791.
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
- **Cross-runtime CI (H13):** both suites + a seed/serde conformance check on golden vectors (incl. the
  §A `variant_to_wire()` §6.5 wire vectors).
- **Pre-flip daily mechanical read (C8 commit 1):** the Spearhead-C6/H40 eval CLI extended to the daily intent —
  parse rate / hallucinated ids / schema-rejection on the real `gpt-5.4-mini`; believability descriptive.
- **Live smoke:** deploy to Fly.io, **assert the `{user, requestId}` partial unique index exists in live
  Atlas with the exact `$type:"string"` filter (`listIndexes`, pre-flip — C8)**, flip
  `USE_ML_SHORTLISTER=true`, drive daily + rescue + a re-roll
  in the running app, confirm one snapshot per render + a lineaged child + `{snapshotId,candidateId}` +
  append-only feedback; flip off → §A degraded empty state.
- **Doc reconciliation (same commits as C4/C5):** every v2 cache home rewritten for the cache kill **and**
  the fresh-generation regenerate (§5 pipeline wording, §6.7, §14 R9 cached-candidate/merge wording,
  §15's two-stage-cache paragraphs, the §20-M5-row, Appendix A R1/N1, Appendix B cache TTL);
  **§15.1's "a snapshot is written for
  every render attempt" clause softened to "every render where a valid payload reached the writer"** + the
  transport-loss residual gap recorded (D3/§D); **§15.1's identity/provenance/score fields gain the M5
  tightenings** (`requestId` is UUIDv4/ULID live-write idempotency, `generator.maxCompletionTokens` is
  required provenance, scored candidates have non-null finite compat/vis when `scorer.available=true`);
  **§15.1's `scorer` field list gains the §E semantics pin**
  (`available` = scoreTrace populated, never rank-order influence); the `candidateCacheKey` algorithm
  (§C.1) recorded where §15's superseded cache bullet dies; §F Lens table added parallel to §15.2
  (including M5's reject-non-empty-constraints posture); §20/H28 updated so M5 = producer scoreTrace seam
  and M6 = rank-order hook; `docs/plans/regen-controls.md` marked superseded or rewritten for fresh
  generation/no cache/no drop-lock behavior; H4/H16/H17/H28/H48/H49/H50/H51/H57/H58/H12 re-disposed in §23
  (§J).

## §J. Hole dispositions (reconcile §23 as C-work lands)

Resolved-by-M5: H7 (§C.1), H8 (UTC, §F), H12 (§D), H17 (removed — every regenerate IS a fresh generation;
the flag is subsumed, §C), **H49 (DISSOLVED — no render without its own generation, so cache-hit/copy-forward
provenance semantics have no referent, §C.2)**, **H50 (partial unique index on `{user, requestId}` with
`partialFilterExpression: { requestId: { $type: "string" } }`, UUIDv4/ULID live `requestId` validation,
`E11000` winner-re-read, and the client minting rule, §C.4 — the earlier "not a write-path unique index"
phrasing conflated the feedback-row append-only rule with render idempotency; corrected)**, H51 (worst
branch dies — no cache in any runtime, §D2), H55/H60 (§A/D6/§F), H57 (§B), H58 (§A/§F), H59 (§C.3), H54
(§G), H10 (serde opacity §G + no-post-Python-refetch §A/C5), H29 (§G), H11 (append-only §I + dedup reducer
§H), H19 (§H), H48 (**both instances decided**: sibling stored via the §E producer exercise; headline
stored via option (a) — basis: converged dual-pass 2026-07-06). Reworded: H4/H16 (§C.5 determinism — no
cache; snapshots immutable, generations fresh). Landed-not-resolved: H28 (§E hook lands; trained scorer =
M6). Deferred: H6 (W-track), H43 (Privacy), H45 (route + StyleMove card **delivered at C6** — moved from C8
by the ladder sequencing invariant; only the shareable before/after growth card deferred post-M5).

## Open questions

None blocking. Deferred with a home:
- `FEEDBACK_DEDUP_WINDOW`, `SERVICE_TIMEOUT_MS`, `INTERACTION_ROWS_SCAN_LIMIT` numeric values — tuned at
  C2/C5 (scan-limit default 500); documented in Appendix B, but the reducer constants' **code** home is
  `reducers.py` per the §H mechanism pin (never `config.py`).
- ASGI framework (FastAPI vs minimal) — a C3 implementation call.
