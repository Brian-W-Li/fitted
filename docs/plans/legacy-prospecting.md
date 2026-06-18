# Legacy Code Prospecting (Step B) — where v1.2 lands, what the old code teaches

> **Historical prospecting note.** Superseded by `docs/Fitted_Spec_v2.md`; keep only as
> legacy/code archaeology. Do not use this as active implementation guidance.

Read-through of the deployed vertical on 2026-06-11 (Fable session): `recommend/route.ts`,
`recommend/regenerate/route.ts`, `interactions/route.ts`, `lib/runPersonalizationSummary.ts`,
`lib/cvToWardrobeForm.ts`, `api/cv/infer/route.ts`, `api/wardrobe/route.ts`,
`models/WardrobeItem.ts`, `models/OutfitInteraction.ts`. Purpose: see where the old code fails
or falls short, what it does that v1.2 *doesn't*, and what's reusable — feeding the M2/M4/M5
and W-track specs. Per CLAUDE.md, none of this is a behavioral baseline; it's evidence and
mapping logic.

---

## 1. Anatomy: what the legacy vertical actually is

`recommend/route.ts` (701 lines) is a single-file pipeline: auth → fetch wardrobe →
**heuristic shortlister** (`shortlistForLLM`: occasion-bucket + temperature scoring, weighted
0.6/0.4, per-category quotas top 25 / bottom 20 / outer 15 / one-piece 10 / footwear 10, max
80 items) → lazy Gemini preference-summary refresh → one OpenAI call (`gpt-4o-mini`, temp 0.5,
`json_object` mode, default `maxOutfits = 5`) → post-hoc footwear injection → structural
validation (`inferItemType` + `isValidOutfitStructure`) → respond. No cache, no retry/repair,
no fallback ladder, no metrics collection (console.info JSON only).

Notable: **the team already half-built a sampler** — `shortlistForLLM` is a v1.2-§7-shaped
thing (partition, quotas, prompt-size bound). Its failures (below) are precisely what §7
fixes, which is good validation that the spec is solving real observed problems.

`regenerate/route.ts` (693 lines) is a **copy-paste fork** of the main route with drift
already visible, plus four features the main route lacks (see §3).

---

## 2. Where the legacy code fails / falls short

Each maps to the v1.2 mechanism that fixes it.

| # | Failure (evidence) | v1.2 fix |
|---|---|---|
| F1 | **Classification logic exists in ≥3 diverging copies.** `shortlistForLLM`'s `byCategory` (route.ts:237–250) vs `inferItemType` (route.ts:543–581) vs the regenerate fork — with *different keyword lists*: "sweater" → `top` in the shortlister but `mid_layer` in validation; "cardigan"/"hoodie" → `outer` in the shortlister but `mid_layer` in validation. | First-class `type` enum (M4 consolidation); one normalizer (M0-4). |
| F2 | **Sweater+jeans is structurally rejected.** Because `inferItemType("sweater") = mid_layer` and two-piece validation demands `baseTops === 1` (route.ts:655), GPT proposing sweater+jeans+shoes gets silently filtered. A normal outfit is invalid by misclassification; user just sees fewer outfits. | Enum `type` set at ingestion, not inferred per-request; hoodie/sweater classification decided once (spec §4.1 hoodie note). |
| F3 | **Shortlist starvation.** Deterministic score-sorted top-N: the same low-scored items *never* enter the prompt, forever, with no randomness and no signal from feedback. | §7.3 70/30 seeded random + signal sampling. |
| F4 | **Footwear injection hack.** If GPT omits footwear, the backend appends the *same* highest-scored shoe to every outfit (route.ts:587–598) — backend silently making a style decision, same shoe regardless of outfit. | Shoes are optional (0–1) in §6; backend never edits GPT output — invalid candidates are rejected, not repaired. |
| F5 | **Silent empty-result failure.** Malformed GPT JSON → `parsed = {outfits: []}` (route.ts:535–537); validation can filter everything; no repair attempt, no fallback, no user-facing distinction from "no outfits possible." | §8.3 single repair attempt; §12 fallback ladder; §19 edge-case messaging. |
| F6 | **No cache, no determinism.** Every render = full OpenAI call (cost), and temp 0.5 with no seed → different outfits every render (the UX flicker). Note: v1.2's §3.1 stability rides on the *cache*, not on GPT determinism — GPT stays stochastic; the cached candidate stage is what makes re-renders stable (R1 two-stage). | §14 caching + session seed. |
| F7 | **Gemini summary refresh awaited in the request path.** `getOrRefreshPreferenceSummary` runs a synchronous Gemini call when ≥5 new interactions exist (route.ts:294–345) — a latency spike on exactly the request after active feedback. | Vertical retired (R7); v1.2 personalization is precomputed additive lookups. |
| F8 | **The training-label pipeline is lossy by design.** `inferredWhy` runs fire-and-forget *after* the response on Vercel serverless; the code itself admits the runtime may kill it (interactions/route.ts:172–175). Labels silently go missing. | M4/W-track: async work belongs on the always-on Fly worker, never post-response serverless. |
| F9 | **`clothingType` lies.** Enum `["top","bottom"]` with **`default: "top"`** (WardrobeItem.ts:7) — every dress, shoe, and jacket row *claims* to be a top. | M4 backfill must ignore `clothingType` entirely and re-derive from `category`/`name`/`subCategory`. |
| F10 | **CV doesn't produce what scoring consumes.** The CV response maps to: category, type→name/subCategory, colors, pattern, layer_role (`cvToWardrobeForm.ts`) — **no occasions, no seasons** (form defaults them empty). So CV-ingested items score occasion-neutral (0.5) and temperature-blind (1.0) forever unless hand-filled. The ingestion pipeline literally doesn't feed the recommender's features. | W-track Move A: extractor must emit the full §4.1 set (occasionTags, warmth, material, formality). Strong evidence for the VLM option beyond uptime. |
| F11 | **`regenerate` is a 693-line fork** with drift (weather fetch missing, different preference instructions, comment rot). | R1 two-stage cache: regenerate = re-rank cached candidates with a new `generationIndex`; no second route body. |
| F12 | **Client-controlled cost.** `maxOutfits` comes from the request body unvalidated (route.ts:370) — a client can ask for arbitrarily many. Echoes spec D2 (no rate limiting). | §7.4 `candidateRequested` is server-computed; K is a server constant; D2 documented. |
| F13 | Auth helper copy-pasted in every route (verify + User lookup, 2 sequential round-trips). Minor. | Factor once in the new vertical. |
| F14 | Regenerate's lock feature breaks silently for low-scored items: `lockedItems = shortlisted.filter(...)` (regenerate) — if a locked item didn't survive the shortlist quota, the lock instruction silently omits it. | Locks are carried forward (R9): locked items are pinned into the pool *before* sampling. |

---

## 3. What the legacy app does that v1.2 does NOT — features at risk

The spec was written against an idealized app; the deployed one grew real features. Each needs
an explicit keep/drop call rather than silent loss.

### 3.1 Outfit regeneration controls — **locks, change-target, contextual dislikes** *(resolved → R9)*
Regenerate accepts `lockedItemIds` ("keep the jeans"), `changeTarget` ("just change the
shoes"), `dislikedItemIds` (exclude these for *this* re-roll), and `feedbackNotes` (free-text
why). v1.2's regenerate is only "new `generationIndex` → new shuffle" — it **cannot express
"keep this item."** **Resolved as R9** (`spec-resolutions.md`, 2026-06-12): locks + contextual
dislikes carried forward as per-request Step-4 filters with one-shot constrained escalation;
`changeTarget` and `feedbackNotes` dropped. Plan: `docs/plans/regen-controls.md`.

### 3.2 Per-item dislike feedback *(keep through M4 — M6 gold)*
`OutfitInteraction.perItemFeedback` records *which pieces* of a rejected outfit the user
disliked, with notes. That's a per-item negative label — strictly richer than the spec's
outfit-level dislike, and exactly what the M6 scorer wants. **M4 must preserve this field**
alongside the new baseKey/fullSig fields.

**M3 design alternative (2026-06-11):** spec §10.3 applies `dislikePenalty` flatly to *every*
item of a disliked outfit. When `perItemFeedback` names the culprits, weight them more and the
innocent co-occupants less — strictly better attribution, zero architectural cost (same Step 5
lookup). Decide at M3; a case where the legacy app was ahead of the spec.

### 3.3 Outfit explanations ("reason") *(UX regression to decide at M2)*
Legacy asks GPT for a per-outfit `reason` shown to the user. Spec §21 lists "recommendation
explanations" as a non-goal and E2 drops confidence. A one-line reason field costs ~nothing,
has no scoring role, and users see it. Decide deliberately at M2: keep as display-only
metadata, or accept the regression.

### 3.4 Mid-layers *(accepted spec regression — surface, don't relitigate silently)*
Legacy supports mid layers (dress + cardigan + jacket; base + sweater + coat; max 2 mids).
v1.2 §6 has **no mid-layer slot** — multi-layer stacking is a §21 non-goal. Layered outfits
get simpler. This is a deliberate spec simplification; recorded here so it's a known trade,
not a surprise.

### 3.5 `isAvailable` *(must survive — adapter-owned)*
Legacy hard-filters `isAvailable !== false` before shortlisting. v1.2's WardrobeItem has no
availability concept. The M5 adapter must exclude unavailable items *before* the sampler —
same slot as the W-track rule "non-active items are invisible to the sampler."

### 3.6 Live weather + event-time forecast *(M5 adapter, two channels)*
Legacy fetches real weather (lat/lon, forecast-vs-live annotation, past-event-time guard) and
feeds free-text `weatherSummary` to GPT. v1.2 seeds on canonical buckets (R5). Resolution
shape: **two channels** — the bucket feeds seed/cache (stability), the free-text summary may
still go to GPT as taste context (it doesn't break caching because cache keys on the bucket).
The forecast/eventTime handling is reusable adapter logic.

### 3.7 `isFavorite` *(new idea — cold-start prior)*
Legacy stores per-item favorites, unused by recommendation. M4 could **seed initial
`ItemAffinity` from favorites** (weak prior), softening cold start for the 30% signal slot.
Cheap, optional; decide at M4.

### 3.8 Rich interaction actions
The enum already has `generated, accepted, rejected, saved, worn, rated` (+ rating 1–5).
Spec uses like/dislike only. Keep the wider enum; `worn`/`saved` are high-value labels if the
UI ever writes them.

### 3.9 Style boarding — **B-track** *(Brian's design sketch, 2026-06-11; staged, post-W-track)*
The CS 148 team considered style boards but ran out of time; the all-male team also lacked
the domain perspective to encode taste themselves — which is the argument *for* boards:
**taste becomes user-declared rather than developer-encoded.**

**Brian's framing (the architectural position):** the board **replaces category 2** of the
§3.10 taxonomy — GPT stops applying its *generic* style priors and instead *interprets the
user's declared aesthetic*. GPT demotes from source-of-taste to interpreter-of-taste.
Likes/dislikes remain category 3 (learned, backend-owned) unchanged. Vision: profile-page
board, either description-based or Pinterest-style (pinned images, themed colors, collage UI
with drag/resize).

**Mechanics (canonical-representation rule applies):** board compiles to a stored
**StyleProfile** (palette, silhouettes, formality range, aesthetic keywords) **at board-edit
time, never request time**. Visual boards extract via VLM — the same machinery as W-track
Move A (one extractor, two consumers; convergence argument for the VLM route). Consumed at:
(a) §16 prompt context (primary — GPT composes toward the declared aesthetic); (b) optionally
the `SignalScorer` seam (cold-start signal at zero interactions — richer sibling of the §3.7
`isFavorite` prior); (c) M6 features. v1 rule: board *contents* are signal, collage *layout*
is expression (size-as-weight is a later experiment).

**Two recorded design consequences:**
1. **`styleBoardVersion` must feed the seed + cache key** (R1 invariant: anything that should
   change results must change a seed/cache input). Monotonic, incremented on board mutation,
   parallel to `wardrobeVersion`. Without it, board edits silently don't refresh outfits.
2. **Declared vs revealed taste conflict (Pinterest aspiration gap) resolves by stage
   separation:** the board shapes **Step 2** (what GPT composes); interactions shape
   **Steps 4–6** (what survives cooldown/scoring/ranking). Declared taste proposes; revealed
   taste disposes; dislikes retain final authority (consistent with E1). M6 can measure the
   aspiration gap (acceptance rate of board-aligned items) — novel eval question.

**Staging (value front-loads; collage UI is the costliest, least-signal part):**
B1 description board (~free: profile text field → StyleProfile prompt slot +
`styleBoardVersion`; everything the Gemini summary attempted, but ground-truth by
declaration); B2 visual board, simple grid (post-W-track, reuses its extractor); B3 collage
UX (drag/resize/themes — expression polish, optional, last). `/spec` B-track when activated.

**Sequencing guard (2026-06-11 recursive review): B1 lands *after* the M5 A/B baseline is
collected, not with M5.** If the new pipeline ships with board context while the old arm has
none, the M5 cost/quality delta conflates shortlister lift with board lift — the same
attribution contamination that retired the Gemini summary (R7). Order: M5 cutover → baseline
numbers → B1.

### 3.10 Historical context (why the rule-based system was abandoned — design lesson, recorded)
Per Brian (2026-06-11): the team deadlocked trying to encode style conventions (oversized
shirts, short-shorts + layering, pattern rules) as backend rules — no consensus existed
because none exists in the domain. The durable lesson, now embodied in the v1.2 thesis:
**structural invariants** (tiny, consensual) are the only rules a backend can own; **style
conventions** (contested) belong to the model; **personal preferences** belong to the
feedback loop. Rule-conflict was a category error, not an engineering failure. Where
structure itself is fuzzy (shirt-worn-as-dress), v1.2 resolves by fiat (`type` is per-item,
backend-set) and defers expressiveness to future roles (§6). The legacy "information doesn't
pass cleanly" problem (F1/F2/F9/F10) is the absence of canonical representations — meaning
re-derived locally at each stage because no shared boundary owned it; M0 exists to fix
exactly this.

---

## 4. Reusable assets (mapping logic, per R7 — reference, not baseline)

- **`temperatureHint` bucket set** `hot|mild|cold|indoor|outdoor` (route.ts:16) **is the R5
  canonical weather bucket set, already in production.** `detectTemperatureHint` (word-boundary
  keyword extraction, route.ts:120–150) + client-provided override is the M5 adapter's
  raw→bucket normalization, nearly verbatim.
- **`inferItemType`** (route.ts:543–581) is the best existing `category/name/subCategory →
  type` derivation — the **M4 backfill's source logic** (used once, offline, then deleted with
  the request-time copies).
- **Legacy validator ↔ §13 overlap**: `itemMap.has(id)` = "itemId not in sampled pool";
  one-piece ⊕ top/bottom exclusion (route.ts:638) = mixed-template reject. The new rules are a
  superset; nothing in the old validator needs preserving beyond what M0-4/M2 already define.
- **`extractOccasionBuckets`** (route.ts:94–118): occasion free-text → closed bucket set.
  **Not used for seed/cache** — R5 resolved occasion to **normalized verbatim user text, never a
  bucket** (bucketing aliases distinct occasions like "job interview"/"office party" into one
  cache key). The bucket set may survive only as *legacy evidence* or as GPT taste context; the
  seed and cache key key on the normalized verbatim occasion. (Was mis-recorded as "R5 says
  canonical buckets" — that rule is weather-only.)
- **CV proxy error UX** (`cv/infer/route.ts`): timeout + "continue manually" messaging and
  structured per-request logging — the *pattern* (not the code) carries into W-track job
  states.

---

## 5. Milestone routing of everything above

| Milestone | Items |
|---|---|
| M2 (GPT stage) | §3.3 reason-field decision; F5 (repair + strict schema) |
| M3 (ranker) | §3.1 regen controls per R9 (filter/escalation/pinning functions; plan: `regen-controls.md`) |
| M4 (data) | F9 backfill (ignore `clothingType`, derive via `inferItemType`); baseKey/fullSig backfill from `items[]`; keep `perItemFeedback` (§3.2); `isFavorite` affinity prior (§3.7); seasons→warmth mapping rule; F8 (labels move off serverless) |
| M5 (integration) | §3.5 isAvailable filter; §3.6 weather two-channel adapter (+ reuse `detectTemperatureHint`); F12 server-owned K; F13 shared auth helper; F11 (regenerate route retired by two-stage cache) |
| W-track | F10 (extractor must emit full §4.1 attributes — evidence for VLM option); F8 pattern (worker owns async) |
| M6 | §3.2 per-item labels as training signal |

---

*Step A (spec/plan hole-finding) is considered at-diminishing-returns pre-code; remaining
holes are milestone-scoped and owned by each milestone's spec. This doc is the Step B
deliverable.*
