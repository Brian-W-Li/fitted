# Fitted — Technical & Product Specification v2

> **Status:** Canonical, editable, living. This document **supersedes** the retired v1.2 PDF,
> `docs/plans/spec-resolutions.md`, and `docs/scope-decisions.md`. Those are retired to history (git
> preserves them); their decisions are folded in here, with the old `R#`/`S#`/`N#` identifiers mapped in
> **Appendix A — Concordance** so existing cross-references still resolve.
>
> **Why v2 exists:** v1.2 was a PDF. We could not edit it, so every decision became an *addendum* in a
> separate ledger, and the doc set drifted. v2 is one editable file with a single home for every decision.
> The addendum pattern is retired: **edit this file in place.**

---

## 0. How to read this document

**Precedence.** This file is authoritative. Where two sentences here conflict, the more specific section
wins, and the conflict is a bug to fix in place (see §22, the doc-lifecycle rules carried over from
`CLAUDE.md`).

**Single-home rule.** Every concept is defined in exactly one section. Other sections *point* (`see §X`),
never restate. Duplication is how docs drift.

**Build-ladder tags.** This is an ambitious architecture built with humble first mechanisms. Every feature
carries a rung so the spec doubles as a build order:

| Tag | Meaning |
|---|---|
| `[NOW]` | Build first. The substrate + the orphan-rescue vertical. Content-only, no learned model, no new data volume required. |
| `[NEXT]` | The behavioral layer. Needs interaction history to mean anything. |
| `[STAGED]` | Needs real data volume or a trained model. The ML dive lives here. |
| `[NORTH-STAR]` | Documented and seam-preserved, not built. Power-user graph editing, calendar, etc. |

**Design posture (carried from the planning work, non-negotiable):**
- *Ambitious architecture, humble mechanisms.* Build the contracts that make sophistication possible;
  delay the algorithms that need data volume we do not have yet.
- *Backend owns structure and ranking; GPT owns style.* GPT never enforces a rule or computes a score.
- *Two-stage separation is sacred:* candidate generation (sampler → GPT) is separate from ranking. No
  step reaches back into a prior step's domain.
- *Personalization must be debuggable.* Every ranking term has a score-breakdown entry and a test proving
  it cannot dominate when it should not.
- *The app stays working at every step.* The legacy recommendation vertical is replaced behind a feature
  flag, not ripped out before its replacement exists (§19).

**Open holes.** Every known gap is registered in **§23 (Open Holes Register)** with a status of
`RESOLVED-HERE`, `OPEN`, or `DEFERRED-TO-<milestone>`. There are no silent holes. If you find one, add it
to §23 and resolve or mark it in the same edit.

---

# PART I — PRODUCT

## 1. Vision & the green-shirt promise

Fitted helps **style-stuck people who own plenty of clothes** wear the better outfits already hiding in
their closet. The user owns pieces they like but keeps dressing from the same small, safe subset because,
in their head, those are the only items with trusted connections.

**The green-shirt story (the product's emotional core):**

> The white hat, white shirt, and white pants feel connected — the user already trusts those combinations,
> so they form a safe cluster. A liked-but-riskier piece (the green shirt) is an **orphan**: in the
> morning it has no trusted edges, so the user retreats to the safe cluster. Fitted gives the green shirt
> *believable connections* under a chosen context, and the ones the user actually wears become trusted.

So Fitted is not only "recommend an outfit." It helps the user **build, see, and correct a personal style
graph**: a network where clothing items are nodes and *style edges* are the wearable connections between
them. Orphan items gain edges; worn edges strengthen; the closet stops feeling like five items.

**The technical centerpiece (the ML dive).** Learning that graph from content + interaction data *is* the
dive: content-based cold-start edges → behavioral edge strengthening → a trained scorer that predicts good
connections (§11, `[STAGED]`). The graph and the ML dive are the same thing.

**Positioning (what we are not).** Not an "AI closet app," not a digital-wardrobe tracker, not a
virtual-try-on or shopping app, not a body/color-analysis quiz. Those are crowded or platform-owned. Our
lane is **translation, diagnosis, and progression**: turning owned clothes + style intent into wearable
outfits, teaching the one move that makes each work, and remembering context without trapping the user.

## 2. The product loop & entry intents

**The loop:** input → backend ranks up to K candidates (`DEFAULT_K=10`) → UI surfaces 2–3 primary
paths/options → one concrete `StyleMove` per surfaced option → scoped feedback → updated style memory → a
better-positioned next option.

**Entry intents** (`RequestIntent`, the request's purpose — see §6 for the field):

| Intent | User says | Rung |
|---|---|---|
| `rescue_item` | "Show me how to wear this piece I avoid." (the green shirt) | `[NOW]` — **the spearhead vertical** |
| `outfit_upgrade` | "Make this bland outfit one step better." | `[NEXT]` |
| `daily` | "Dress me for today." | `[NEXT]` |
| `translate` | "Make my mood board wearable from my closet." | `[STAGED]` |

All four are **modes of one engine**: input → variants → StyleMove → scoped feedback. They differ in what
seeds the candidate pool (a forced item, a base outfit, a routine, a board), not in the pipeline.

**Onboarding — hook first, board second** `[NOW]`. A brand-new user has a half-uploaded closet and no
boards. We do **not** force board/routine setup first (hook-first is the *default*, not a ban — a user who
already knows their lens may optionally pick a board/routine before the first recommendation; §23-H41). The first screen is a one-tap hook —
*"rescue an item you never wear"* / *"upgrade today's fit"* — using an **implicit default lens** (just a
light context the user can set: occasion + constraints). Board creation is offered as step 2, once there is
a closet to ground it. Rationale: fastest first value; matches the green-shirt resonance; a board is
meaningless against an empty closet. *(Resolves the onboarding fork; see §17 for boards.)*

**Cards primary, graph as the reveal** `[NOW]`. The default interface is always outfit cards. The literal
closet-graph visualization is a progressive-disclosure "your closet is coming alive" moment, never the
first screen and never the interface. A graph as the UI loses trust; the metaphor must not become the
product. *(Firm spec rule, not a leaning.)* The rule bars the graph as the **primary dressing interface**,
not as a **secondary** inspection/correction/progress surface — a graph preview, a progress view, or
`[NORTH-STAR]` graph editing may exist behind progressive disclosure (§23-H41).

## 3. Users & the experience ladder

Designing for the user, value arrives as a ladder of felt moments — this is also the build order (§20):

1. **"Fitted gave my green shirt three believable ways to wear it for class."** — content edges + orphan
   rescue. *Day one, cold, no feedback needed.* `[NOW]`
2. **"It remembered the one I wore and is varying it, not repeating it."** — behavioral edges + scoped
   feedback + rotation. `[NEXT]`
3. **"My winter board came back when it got cold."** — dormant boards reviving. `[STAGED]`
4. **"It learned my taste without trapping me."** — the learned edge scorer + anti-capture. `[STAGED]`

**What success feels like:** *"I still look like myself, but less default."* "I used clothes I already
owned." "I finally wore the piece I kept avoiding." "I understood the one thing that made it work." "It
nudged me without making me feel costumed."

**Anti-capture (a product promise, sparingly surfaced)** `[NEXT]`. Personalization is *not easily swayed,
but not hard to move*: feedback accumulates into stable memory; one tap does not yank future
recommendations. The system occasionally offers legible agency — "apply this dislike to this board only or
globally?", "your recent likes are narrowing things — keep exploring?" — but the value is trust, not knobs.

**Neglect modes to design against:** ignoring comfort/mobility/weather/dress-code; assuming the goal is
always boldness; impractical shoes; repeating dirty/unavailable items; turning every gap into a shopping
nudge; over-explaining; narrowing on one dislike; failing partial/sparse/non-standard closets. Concrete
responses: explicit constraints (§6 Lens), backend-assigned path/risk labels (§14), `not_practical` as a
first-class signal (§16), scoped feedback (§16).

## 4. Canonical vocabulary

Single home for every term. Use these exactly; do not coin synonyms.

| Term | Meaning |
|---|---|
| **Board** | The user-facing style direction (`summer cool dude`, `winter cozy`, `clean streetwear`). |
| **StyleProfile** | The internal *compiled* representation of a board (typed traits — §6). |
| **StyleProfileSnapshot** | Immutable request-time copy of the active StyleProfile (enters seed/cache/logs). |
| **Routine** | A recurring real-life context (school, work, errands, weekend, gym, travel). |
| **Lens** | `StyleProfileSnapshot + Routine + current constraints`. The "version of me I am dressing as." |
| **Constraint** | A per-request hard/soft condition: weather, walking, rain, presentable-later, low-effort, dress code, comfort, no-buy. |
| **Closet graph** | The scoped network of item **nodes** and style **edges** under a lens (§11). |
| **StyleEdge** | A wearable connection between two items, scoped to a lens (§11). |
| **Orphan** | A liked item with few/no trusted edges — rarely worn because it has no believable pairings. |
| **Anchor / Bridge / Experiment** | Graph-role of an edge/item under a lens: trusted / one-trusted-one-new / plausible-but-unproven. |
| **Reliable / Bridge / Stretch** | The user-facing option *paths* returned per request (trust/progression lane, not social risk). |
| **Safe / Noticeable / Bold** | Social-risk labels for how visible an option feels (orthogonal to option path). |
| **StyleMove** | The one concrete styling change an option teaches ("anchor the green with cream, keep the white shoe casual"). |
| **Dormant board** | An inactive board that preserves compatibility/trust memory for fast reactivation. |
| **Outfit / OutfitVariant** | A validated set of items in a template (§8); a variant is one outfit under a path/risk label. |
| **GenerationSnapshot** | The immutable record of one request's inputs, candidate pool, shown outfits, and versions — training truth (§15). |

---

# PART II — ARCHITECTURE SPINE

## 5. System shape & principles

The engine is a linear, non-overlapping pipeline (§9). Two stages are separated and never blurred:

- **Candidate generation** — the *sampler* bounds what GPT may choose from; GPT generates candidate
  outfits; the *validator* enforces structure. (Expensive; cached.)
- **Ranking** — the *ranker* decides what the user sees from validated candidates: cooldown, scoring,
  diversity, freshness, fallback. (Cheap; runs per request.)

**Guiding principle:** Sampler bounds → Validator enforces that bound → Ranker decides. GPT performs no
scoring or rule logic; the backend always owns final authority. GPT drift cannot corrupt scoring.

**The replaceable seam (the ML dive plugs here).** The sampler's signal-selection slot and the ranker both
expose a `SignalScorer` seam (§10, §11). Today it is a content/heuristic scorer; the trained graph scorer
swaps in at `[STAGED]` with no other code change. This seam is the single most important structural
deliverable.

**What the engine is *today* vs. the destination** (read this before "style graph" misleads). At `[NOW]`
the engine is a **closet-grounded GPT stylist with structured memory**: GPT composes outfits fenced to the
wardrobe + Lens, the deterministic ranker filters/diversifies/buckets them, and scoped feedback is
remembered. Believability rides on **GPT's styling judgment fenced by the closet** — *not* a learned graph
yet. The **personal style graph** is the brand, the metaphor, and the `[STAGED]` payoff: accumulated feedback
+ a learned compatibility model (§11) is what the data *grows into*. Same engine, different rungs — not the
same moment. *(Seam caveat: "no other code change" holds only if the seam is the right shape — see §23-H28.)*

## 6. Data model

The deployed Mongo schemas (`fitted/models/*.ts`) are the **starting state**, not a constraint. v2 enriches
them. Migration notes mark what changes. Everything below is the target.

**Data-model posture** (governs every `[NEXT]`/`[STAGED]` shape below). These three rules make most
"closed-set" foreclosures **reversible by default**, so they need *not* be hunted exhaustively — a specific
instance is decided at its owning milestone against these rules, and stragglers are caught on sight in §23:

1. **Additive & raw-preserving.** Every user-facing enum / closed set / bucket (constraints, weather,
   feedback reasons, board & routine status, learning scopes…) is **additive**, and **no single field
   conflates two concepts** (rating ≠ reason; temperature ≠ environment). Store the **raw/declared** signal
   beside any derived bucket — the derived value is replaceable, the raw is not.
2. **Inferences are drafts.** Anything inferred or auto-derived (routine, board, scope generalization,
   profile) is **suggested/draft** until explicit confirmation or repeated support; it never silently steers.
3. **Events are append-only with lineage.** Feedback/intent events are append-only and linked by id (target
   outfit, `plannedFor`, derived-from); copies/derivations carry provenance so they don't overtrain.

*(This posture subsumes §23-H34/H35/H36 and the recurring "a closed set could be richer" finding class; it
governs the **resolution direction** of H29 (snapshot storage shape) and H37 (scope vocab), whose actual
resolution is **deferred to M4** — H29 still needs real snapshot-schema design (rule 1 covers its
scores/visual, not its rejected-candidate capture). The irreversible foreclosures — discarding raw data, or
breaking a stored identity/format — are the only kind worth pre-empting, and are guarded by rule 1 + the
key/snapshot holes, §7/§15/§23-H29/H30.)*

### 6.1 WardrobeItem `[NOW]`
The node of the closet graph. Deployed schema is already rich
(`category`, `subCategory`, `pattern`, `colors[]`, `seasons[]`, `occasions[]`, `layerRole`, `brand`, `fit`,
`size`, `isAvailable`, `isFavorite`, `lastWornAt`, `tags[]`). v2 adds/normalizes:

- **`clothingType` extended from `["top","bottom"]` → `["top","bottom","dress","outer_layer","shoes"]`.**
  *Migration:* the field already exists (`WardrobeItem.ts:7`, default `"top"`, indexed) but is **never read
  by the recommend routes** — one-piece/outer/shoes are string-matched at request time over
  `category`/`name`/`subCategory` (`recommend/route.ts:241,550,etc.`). v2 makes `clothingType` first-class,
  **backfills** existing rows from the string-match logic, and the engine reads `clothingType` directly.
  The string-grep path is deleted at cutover (§19). This is a **consolidation, not a new capability** —
  the deployed app already handles dresses, just not via the enum. *(Build note: the engine reads
  `clothingType` at `[NOW]`, but rows are reliably populated only after the M4 backfill `[NEXT]`; until then
  the adapter falls back to the string-match logic it will replace.)*
- **Richer style ontology** `[STAGED]`: `silhouette`, `formality`, `material/texture`, `garmentRole`
  (base_top, base_bottom, one_piece, outer, mid, shoe, and future accessory/bag/belt/hat), `warmth (0–10)`,
  per-field `confidence`, `reviewed` flag. Added additively; `[NOW]` uses only what exists + `clothingType`.
  Accessories and under-layers are explicitly future garment roles (§8).

### 6.2 Board / StyleProfile / StyleProfileSnapshot `[NOW]` text · `[STAGED]` visual
- **Board**: `{id, userId, name, source: text|visual|mixed|imported|inferred, status: active|archived,
  currentVersion}`.
- **StyleProfileVersion** (immutable; board edit mints a new one): a **small typed compiled schema** —
  `{palette, aestheticKeywords, silhouetteHints, fitHints, formalityRange, seasonality, negativeCues,
  embedding[STAGED], compilerVersion}`. **Only the compiled schema** enters prompt/cache/ranking/training;
  raw board input is stored separately. *(Resolves the "StyleProfile = vague blob" risk: a version is not
  done until two compilers produce the same schema and the engine consumes only that schema.)*
- **StyleProfileSnapshot**: the immutable copy taken at request time and stored in the GenerationSnapshot.
- *Active-profile semantics:* one global active profile in v1; routine-attached profiles are `[NORTH-STAR]`.
  The single active profile is only the **v1 default selection** — every request/feedback snapshot may still
  carry `boardId`/`styleProfileId`/immutable version/confidence when present, so "which version of me" is
  never lost (§23-H38).
- *Board status:* `active | archived` today; a third **`dormant`** state (or a `DormantBoardState` carrying
  freshness/exposure reset + revival summary) is the seam for §17 seasonal revival — distinct from archive
  (§23-H35).

### 6.3 Routine & Lens `[NOW]` explicit · `[STAGED]` inferred
- **Routine**: `{id, userId, name, source: explicit|calendar|inferred, confidence, schedule?,
  defaultStyleProfileId?, contextLabels[]}`. v1 ships **explicit** routines only. Inferred/calendar routines
  are `[STAGED]`/`[NORTH-STAR]` and must *suggest* confirmation, never silently steer. Explicit beats
  inferred by confidence.
- **Lens / RequestContext** (the request-level input the sampler builds and the SignalScorer consumes):
  ```
  RequestContext:
    sessionId: str                 # = userId always (§19); opaque to the seed
    wardrobeVersion: int           # bumps only on a sampler-visible (active) wardrobe change (§18)
    intent: RequestIntent          # rescue_item | outfit_upgrade | daily | translate
    occasion: str                  # normalized verbatim user text (trim/lowercase/collapse-ws) — NOT bucketed
    weather: str                   # canonical bucket from a closed set: hot|mild|cold|indoor|outdoor
    constraints: ConstraintSet     # walking, rain, presentable_later, low_effort, comfortable_shoes, no_buy, dress_code
                                   # ADDITIVE + raw-preserving: respectful constraints (modesty, sensory,
                                   # body-confidence, uniform, budget) get their own value + optional
                                   # user-declared text/provenance, never squeezed into dress_code (§23-H36)
    styleProfileVersion: int|None  # active compiled profile version; None until boards exist
    routineId: str|None            # explicit routine; None in the implicit default lens
    forcedItemId: str|None         # rescue_item: the orphan to include (§12); None otherwise
    baseOutfit: list[str]|None     # outfit_upgrade: items the user already has on; None otherwise
    date: str|None                 # daily re-seed (C1); None until activated
    interaction_count: int         # this user's interaction count; 0 until feedback exists
    # Rule: new fields are ADDITIVE ONLY — never rename or remove the above. The trained scorer (§11)
    # may add fields it needs without touching sampler code.
  ```
  *Why `weather` is a bucket but `occasion` is verbatim:* weather drifts without user intent (raw text
  destabilizes the seed every render); occasion changes only by user intent and must stay text-distinct so
  "job interview" and "office party" never collide in the cache. Raw→canonical normalization is owned by the
  request adapter (§15), not the sampler.

### 6.4 The closet graph — ItemNode & StyleEdge (see §11 for behavior)
- **Edges are stored sparsely**, only for item-pairs that have interaction history; **content
  compatibility is computed on demand by backend scoring functions** at request time, not materialized.
  **Lens is a feature on the interaction, not a separate edge table per lens** — edge-strength-under-a-lens
  is an aggregate query, not duplicated storage. This is what keeps the graph from exploding to O(lenses ×
  n²). *(Resolves the edge-explosion hole, §23-H1.)*

### 6.5 Outfit, OutfitVariant, StyleMove `[NOW]`
- **Outfit** (API response object): `{id, templateType: two_piece|one_piece, items: [{itemId, role}],
  score, scoreBreakdown}`. Items ordered base-roles-first, then outer, then shoes; optional roles omitted
  (no null fields). `templateType` is explicit; the UI never infers it.
- **OutfitVariant**: response-layer wrapper around a validated outfit after Python ranking. The backend
  ranker tags it with an `optionPath` (reliable|bridge|stretch) and a `risk` (safe|noticeable|bold), plus
  its `StyleMove`. These tags are never GPT-emitted fields.
- **StyleMove**: `{moveType, changedItemIds, oneSentence, matchedTraits[], missingTraits[]}`. Every
  StyleMove must reference an actually changed/added item — a semantic guarantee where a baseline outfit
  exists (rescue/upgrade/ranker, §12/§14); the M2 validation boundary checks only the schema and
  `changedItemIds ⊆ outfit items` (H23, §13). `matchedTraits/missingTraits` are populated only
  once a StyleProfile exists (`[NEXT]`); at `[NOW]` a StyleMove is `{moveType, changedItemIds, oneSentence}`. *(StyleMove reverses the v1.2 §21 non-goal
  "recommendation explanations" — a deliberate, recorded reversal; it is core to v2.)*

### 6.6 Feedback & memory
- **OutfitInteraction** (deployed; reused and extended): already carries
  `action ∈ {generated,accepted,rejected,saved,worn,rated}`, `rating`, `perItemFeedback:[{itemId,disliked,
  notes}]`, `context:{weather,temperatureF,location,occasion}`. **Only `accepted`/`rejected` are written
  today.** v2 uses existing `saved/worn/rated` actions and additively extends the enum for
  `planned/packed/corrected` scoped-feedback events (§16). It also adds the
  **lens snapshot + baseKey/fullSig + server-issued outfit id** to each row. Trainable "why" is captured
  only by the structured `FeedbackReason` set (§16); no unstructured blurb is a **training label** — raw /
  corrected user rationale is nonetheless **persisted with provenance** and excluded from training until
  deliberately reviewed/compiled (§23-H34).
- **StyleEdge memory** (§11): `compatibility` (content, derived) + `behavioralStrength` (sparse;
  non-negative in the `[NOW]`/`[NEXT]` layer, signed at `[STAGED]` — H18).
  *The deployed/ v1.2 additive memory (`ItemAffinity`, comboBoost/itemBoost) is **demoted** to the humble
  first implementation of `behavioralStrength` (§14), not a parallel system.*
- **GenerationSnapshot** (new): §15.

### 6.7 Caches (§15)
Two-stage. Candidate cache (expensive) keyed on candidate-stage inputs only; ranking runs per request.

## 7. Canonical keys

Two keys, never conflated (carried from v1.2 §5; trap-guard R10 inline).

- **BaseKey** (core silhouette): one_piece → `dressId`; two_piece → `f"{topId}:{bottomId}"`. Excludes
  outer and shoes. Used for: dislike cooldown, BaseKey variant cap.
- **FullSignature**: `BaseKey + "|outer=" + (outerId|"none") + "|shoes=" + (shoesId|"none")`. Used for:
  dedup within a generation pass, comboBoost/edge matching. Same base + different outer = different outfit.
- **Forward-compat slot rule (§23-H30):** a future optional garment role (accessory/bag/hat/mid-layer —
  §6.1/§8) appends to the FullSignature **only when present**, in fixed canonical order, so existing keys stay
  valid (no migration). BaseKey stays **base-only** for `[NOW]` cooldown/variant-cap; making outer/shoe-defined
  looks a distinct identity is a registered **future** redefinition, not a `[NOW]` behavior.
- **Computed from the SlotMap after normalization** (§8), exactly once per outfit at generation.
- **R10 precondition (trap-guard — do not remove):** keys cannot be length-prefix-encoded (the literal
  format is spec-fixed and tested), so they enforce two preconditions, raising on violation: (1) a valid
  base (one_piece XOR two_piece); (2) no participating itemId contains a reserved char (`:`, `|`, `=`) or
  equals the sentinel `"none"`. Real Mongo ObjectId-hex ids never trigger it (zero false-reject); it is the
  documented contract for any future id source. **Keys are computed once, in Python, never reimplemented in
  TS** (drift hazard); the response carries them and the client echoes them on feedback.

## 8. Outfit structure & SlotMap normalization

**Templates** (carried from v1.2 §6): **two_piece** = 1 base_top + 1 base_bottom + 0–1 outer + 0–1 shoes;
**one_piece** = 1 one_piece (dress/jumpsuit) + 0–1 outer + 0–1 shoes. A one-piece never mixes with a
separate top/bottom. Under-dress layering and accessories are **future garment roles** (§6.1) — new roles +
new SlotMap slots, additive, `[STAGED]`/`[NORTH-STAR]`.

**SlotMap** (internal normalization contract; never in the API response):
`{dress, top, bottom, outer, shoes}`, each `itemId|None`. Every GPT candidate is normalized to a SlotMap
*before* any validation, scoring, or key computation.

**Validation rules** (structural only; never relax, even under fallback). Split across three owners so no
reject is stranded (carried from N3):
- **`normalize_to_slotmap`** owns rejects that are *inexpressible once collapsed*: a **second item for any
  already-filled role** (second base_top/base_bottom/one_piece/outer/shoes) and any **unknown role** — these
  would be silently dropped by last-write-wins, so they must be caught pre-collapse.
- **`is_valid_slotmap`** owns slot-level rejects: mixed templates (dress+top/bottom), empty base, duplicate
  itemId across slots, wrong base count for the template.
- **Step-3 pipeline validator (§13)** owns `itemId not in the sampled pool` — it needs the pool as an input
  the pure `is_valid_slotmap(slotmap)` signature cannot accept.

*Deployed reference (what we replace):* `isValidOutfitStructure` (`recommend/route.ts:601-664`) already
rejects >1 bottom/base_top/one_piece/shoes, one_piece+top/bottom, >1 outer, >2 mid; and **auto-injects a
footwear id** post-LLM (`:583-598`). v2 does **not** carry the auto-injection hack — the sampler/validator
model handles shoes as an optional role honestly.

---

# PART III — THE PIPELINE

## 9. Canonical pipeline order

The single authoritative ordering. Every scoring/diversity mechanism declares its step here before being
added.

| # | Step | Does | Milestone |
|---|------|------|-----------|
| 0 | **Resolve request** | Build the Lens/RequestContext (§6.3): user, wardrobeVersion, intent, occasion, weather bucket, constraints, active profile snapshot, routine, forced item / base outfit | M5 adapter |
| 1 | **Pool prep** | Partition by `clothingType`, per-type caps, 70/30 sampling, derive session seed; forced-item pinning for `rescue_item` belongs to later rescue/lock machinery (§12/§14) | M1 sampler |
| 2 | **GPT generation** | Candidate outfits as role-tagged item lists plus allowed `StyleMove` text only in M2; no scores, ranks, `optionPath`, `risk`, or diagnostic reason fields (§12) | M2 |
| 3 | **Normalize + validate** | Raw → SlotMap; structural validation (§8/§13); compute BaseKey + FullSignature; drop exact FullSignature duplicates in the pass | M0/M2 |
| 4 | **Cooldown / per-request filters** | Drop candidates whose **BaseKey** is in the dislike cooldown buffer; apply regen locks/contextual dislikes (§14, R9) | M3 |
| 5 | **Scoring** | `base + behavioral edge signal − dislikePenalty` (§14); humble v1 = additive (R2), evolves to edge/learned scorer (§11) | M3 |
| 6 | **Ranking & diversity** | BaseKey variant cap → overuse penalty → repetition-window (FullSignature) → fallback ladder if < K → sort by score → tie-break | M3 |
| 7 | **Response + StyleMove** | Outfits[] + backend-assigned `optionPath`/`risk` + StyleMove + scoreBreakdown; cache the candidate stage; write GenerationSnapshot; async log | M5 |

Regen controls (locks + contextual dislikes) are per-request **Step 4** filters with a one-shot constrained
re-entry of Steps 1–3 on starvation (§14, R9).

## 10. Pool preparation / the sampler `[NOW]`

The sampler is the shortlister: `list[WardrobeItem]` + RequestContext → bounded pool GPT may select from.

- **Partition by `clothingType`** (5 types). **Determinism is a contract on input ordering** (R4): sort each
  type's list by `item.id` before any RNG draw; iterate types in fixed enum order; use **one shared
  `random.Random`** seeded by the session seed. *Why it matters:* until a trained scorer exists, 100% of
  traffic rides the seeded-random branch, so the stability promise rides entirely on fixed ordering + one
  RNG. Test with a permuted-input case.
- **Per-type caps** (Appendix B constants): tops 35, bottoms 30, dresses 25, outer 20, shoes 25;
  `MAX_PROMPT_ITEMS = 135` = the cap sum, an **assertion, not a truncation** (never silently drop items).
  At/below cap → include all (scarce categories fully represented).
- **70/30 split over cap** (R6 trap-guard): `random_count = (cap*7 + 5)//10`, `signal_count = remainder`.
  **Integer half-up, float-free — NOT `round(cap*0.7)`** (banker's rounding splits the real caps in opposite
  directions and any TS/numpy reimpl that rounds halves up disagrees with prod). It is a **sampler-owned
  helper, never a config constant.** (The 30% signal share is a deliberate generation-influence ceiling,
  **not a law** — the trained scorer also scores the ranker, so its total influence is not capped at 30%;
  §23-H32.) Value table (all five caps): 35→25, 30→21, 25→18, 20→14, and shoes
  25→18 (dresses and shoes share cap 25).
- **The SignalScorer seam** (the ML plug, R11/R13): the 30% signal slot runs only when
  `interaction_count ≥ MIN_SIGNAL_THRESHOLD (=5)` **AND** `scorer.is_available()`. Otherwise the type's
  signal slot falls back to seeded-random over the id-sorted pool with one of three **behavior-identical,
  log-distinct** reasons: `coldStartSampling` (count < 5), `signalUnavailable` (count ≥ 5 but no scorer),
  `signalScorerFault` (scorer raised / returned non-finite). Behavior-identical fallback is load-bearing:
  data arrival changes only the *log label*, never the outfits, until the trained scorer ships. Per-type
  outcome is a uniform `TypeSampleResult{items, selectionKind: signal|random|includeAll, reason, counts}`
  (R13) so a log never conflates types ("tops cold-started while shoes faulted"). `scorer.is_available()`
  is evaluated **once per request** (model-presence is identical across types) and the boolean passed
  down; a misbehaving `is_available()` (raises or returns non-`True`) is treated as unavailable
  (`signalUnavailable`), never propagated.
- **Candidate request scaling** (post-cap counts): `total_base = tops*bottoms + dresses`;
  `candidateRequested = total_base*3` if ≤5 else `min(40, total_base*3)`. `total_base == 0` →
  `notEnoughItems`, return **before any GPT call**.
- **Duplicate logical item-ids are rejected at the sampler entry**, before partition (R12) — a duplicate id
  collapses the pool lookup and corrupts key equality.

## 11. The edge model & cold-start — the heart `[NOW]` content · `[NEXT]` behavioral · `[STAGED]` learned

This section makes the green-shirt promise real and houses the ML dive.

**A StyleEdge** between two items, under a lens, has exactly two fields:
- **`compatibility`** — content-based; "do these work together stylistically?" Computed by pure Python
  scoring functions from canonical item attributes, compiled StyleProfile traits, and later embeddings /
  learned model output. **In M2, GPT may provide `StyleMove` prose only; future schemas may add closed-set
  diagnostic reason candidates once their owning milestone consumes them, but GPT never emits the
  compatibility score.** Available cold, day one. Not stored densely; computed at request
  time.
- **`behavioralStrength`** — accrued from lived feedback (worn, rated-good, corrected); **sparse** (only
  pairs the user actually touched). *Sign model is tag-dependent (H18):* the `[NOW]`/`[NEXT]` humble layer is
  **non-negative** (positive affinity only — the negative side stays in the separate `dislikePenalty` +
  cooldown, never decrement affinity, R2 — so the two memories can't contradict). A **signed** per-edge
  accumulator (rated-bad −) is the `[STAGED]` graph evolution, adopted only when the learned scorer replaces
  the additive layer.
- **Not edge fields:** `freshness` / `exposure` are computed from the GenerationSnapshot show-history
  (last-shown, show-count) as ranker inputs (§14). Post-wear outcomes are represented by `rating` +
  structured `FeedbackReason`; source records come from GenerationSnapshot and interaction rows. None of
  these become StyleEdge fields. *(Resolves H2: the edge model is strictly TWO fields.)*

**Cold start (why rescue works on a new account):** a new user has zero behavioral edges. GPT proposes
believable candidate completions for the forced item from the bounded pool; pure Python compatibility /
risk scoring ranks and buckets the surviving drafts. No trained model, no feedback required. The user wears
one → a behavioral edge forms → the item de-orphans. *That growth is the visible payoff.*

**Detecting orphans at cold start (H21):** with no behavioral edges yet, "items you never wear" cannot be
edge-defined. The `[NOW]` rescue entry surfaces candidates from signals the deployed schema already has:
zero interactions **and** null/old `lastWornAt`, optionally `isFavorite` (liked-but-unworn = the sharpest
orphan), or an explicit "rarely wear this" mark during onboarding. The exact blend is a rescue-spec tuning
detail; the signal set is fixed here so rescue is never blocked on the graph already existing.

**Graph roles (UI labels, derived):** `anchor` = high compatibility + high behavioralStrength (trusted);
`bridge` = one trusted side + one new; `experiment` = compatible but unproven. These map to the user-facing
option paths `reliable / bridge / stretch`, which the **backend ranker assigns** from a graph/path score.
`risk` (`safe / noticeable / bold`) is assigned separately from social-visibility features. At cold start,
before behavioral edges exist, option path ≈ compatibility/commonness/trusted-anchor availability, while
risk ≈ visibility/boldness of the styling move. The exact cold-start metrics are rescue-spec calls (H20).
**GPT never assigns the path or risk** (§5: GPT does not rank).

**The humble-first behavioral mechanism** `[NEXT]`: the v1.2 additive scorer **is** the first
`behavioralStrength` implementation — `itemBoost (+0.1 × affinityScore, capped at 20)` ≈ node affinity,
`comboBoost (+2.0 on a re-liked FullSignature)` ≈ a full-outfit edge. It ships as the behavioral layer and
evolves into explicit lens-scoped pairwise edges. *(Demotion of R2, not deletion.)* Known risk carried
forward: at the affinity cap a 4-item itemBoost (~+8) can dwarf comboBoost (+2) — **measured in offline
eval, not tuned blind** (levers: lower cap, sublinear affinity, per-item averaging).

**The trained scorer — the dive** `[STAGED]`: learn to rank completions / predict edge strength from
(content features + behavioral history + lens), trained on GenerationSnapshots + feedback. It implements the
same `SignalScorer` protocol (§5/§10) — `is_available()` true once loaded — and/or scores the ranker.
Offline eval: NDCG@k / hit@k on accepted outfits, profile- and routine-conditioned (§21). **Eligibility
gate (before the dive):** the scorer only changes behavior when a request has both ≥5 interactions *and* ≥1
type over cap; if prevalence is low, give the model a second surface (candidate ordering or ranker scoring).
Item-to-item *behavioral/collaborative* similarity is **within-user**, never Amazon-style shared-catalog (private,
unique wardrobes). **A universal *content*-compatibility model** ("does a denim jacket go with a white tee?")
may instead be learned from **public/external outfit corpora** — it is about clothes, not people, so it is
privacy-safe and *not* a cross-user signal, and it is what makes the trained scorer feasible at portfolio
scale (one closet is far too small to learn from), with within-user behavior personalizing that universal
baseline (§23-H26). *(Resolves H3: graph vs additive scoring — additive is the humble behavioral layer; the
learned graph scorer is the staged evolution, plugged at the same seam.)*

## 12. GPT generation & prompt contract `[NOW]`

GPT composes style from structured inputs; it never enforces rules, scores, ranks, or assigns path/risk
labels. It receives the **bounded sampled pool** + the **Lens** (occasion, weather, constraints, compiled
StyleProfile traits) + the **intent**, and returns up to `candidateRequested` outfit drafts in strict JSON:
role-tagged item lists and allowed `StyleMove` text only in M2.

**Hard rules in the system prompt** (carried from v1.2 §16): each outfit is two_piece (1 base_top + 1
base_bottom) XOR one_piece; 0–1 outer, 0–1 shoes; no duplicate items; use only provided item ids; maximize
style cohesion + occasion alignment + diversity; **return strictly valid JSON only**; backend handles all
rejection — do not retry autonomously. The prompt/schema explicitly excludes `score`, `rank`,
`optionPath`, `risk`, `anchor/bridge/experiment`, and any other ranking label. One JSON-repair attempt on
invalid output, then fail gracefully.

**M2 GPT response schema.** M2 pins the first strict LLM boundary to the smallest contract; future fields
are additive only after their owning milestone specs them. The root is an object with exactly
`{"outfits": [...]}`. Strictly valid JSON excludes `NaN`/`Infinity` tokens and duplicate object member names
at any depth — the validator rejects both as invalid JSON before schema validation; a silently last-won
duplicate could mask a forbidden or malformed field. `candidateRequested` is an upper-bound request hint, not an exact requirement: M2 may
validate up to `candidateRequested` candidates when supplied, returning fewer is not invalid, and extra
candidates beyond the bound may be ignored or rejected with a structured reason but must not affect accepted
candidates.

Each outfit candidate object may contain exactly:
- `items` (required): array of item objects.
- `styleMove` (optional): object.

Each item object may contain exactly:
- `itemId`: non-empty string.
- `role`: one of the backend `Role` enum values (`base_top`, `base_bottom`, `one_piece`, `outer_layer`,
  `shoes`).

`styleMove`, if present, may contain exactly:
- `moveType`: non-empty string.
- `changedItemIds`: non-empty array of non-empty strings.
- `oneSentence`: non-empty string.

Explicitly forbidden in M2 GPT output: `score`, `rank`, `optionPath`, `risk`, graph-role labels
(`anchor`/`bridge`/`experiment`), edge/compatibility/`behavioralStrength`, freshness/exposure/cooldown/
fallback fields, `imageUrl`, `warmth`, `matchedTraits`/`missingTraits`, and `diagnosticReason` or diagnostic
reason candidates. Forced-item / locked-item requirements are out of M2 scope: M2 validates only that
`itemId` values are present in the sampled pool; rescue / forced-item missing logic belongs to later
rescue/lock machinery (§14/R9).

**Intent shaping:**
- `rescue_item` `[NOW]`: M1 currently provides generic pool prep only, and M2 validates only sampled-pool
  membership. In the Spearhead/rescue layer, the forced item is pinned into the pool before sampling; the
  prompt instructs every outfit to include it; rescue/lock machinery rejects any candidate missing it
  (§14/R9). **The
  forced item's `clothingType` determines the valid template(s) (H22):** base_top or
  base_bottom → two_piece (the engine must find a complementary base of the other kind); dress → one_piece;
  outer or shoes → *either* template (an optional role layered onto any valid base). **Rescue-insufficient
  case:** if no complementary base can build a valid outfit around the forced item (e.g. the orphan is the
  user's only top and there are no bottoms), return `notEnoughItems` scoped to the rescue (a sharper §10
  zero-case) — never silently drop the forced item. GPT still returns unranked candidate drafts only; the
  Python ranker later buckets survivors into the three user-facing paths: reliable / bridge / stretch.
- `outfit_upgrade`/`daily`/`translate`: seed from base outfit / routine / compiled board respectively.

**Allowed GPT output fields:** in M2, GPT may emit only role-tagged item ids and a `StyleMove` (§6.5,
style reasoning, allowed). Later schemas may add `matchedTraits/missingTraits` or closed-set diagnostic
reason candidates only when their owning milestone consumes them; M2 explicitly forbids them so the first
validator cannot invent public behavior. **`optionPath` (reliable/bridge/stretch), `risk`
(safe/noticeable/bold), graph role (`anchor/bridge/experiment`), score, rank, edge strength, compatibility
score, freshness, exposure, and fallback decisions are assigned or computed only by pure Python backend
functions (H20)**. `imageUrl` is excluded from the GPT payload (token cost — a **deferral, not a principled closure**: a vision-capable generator that sees actual garments stays open for a later milestone, §23-H33); `warmth` is stripped too.

**Prompt-vs-board precedence**: hard constraints (dress code / weather / comfort) > prompt
occasion & formality > active StyleProfile shapes choices *within* the valid context > revealed negative
signal suppresses bad repeats. A casual board never overrides a "formal interview" occasion.

## 13. Normalize + validate `[NOW]`

Carried from v1.2 §13/§8. Normalize each candidate to a SlotMap (§8); reject structurally invalid SlotMaps
(rules in §8); compute BaseKey + FullSignature; drop exact FullSignature duplicates within the pass.
Validation is **structural only and never relaxes**, including under the fallback ladder. **GPT-emitted
`StyleMove` is also boundary-validated (H23, §5 "schema-validate every LLM boundary"):** its `changedItemIds`
must be a subset of the outfit's items; a StyleMove referencing an item not in the outfit fails validation
and is dropped/recorded through a warning channel (the outfit may still stand if structurally valid).
Schema-invalid candidates are discarded candidate-by-candidate where possible; a malformed root/envelope
returns no candidates and a structured root-level rejection. Invalid JSON returns `invalidJson` from the M2
pure parser; the pipeline may attempt the one JSON-format repair allowed by §12, but the pure validator does
not perform network repair. The `itemId not in sampled pool` reject lives here (it needs the pool).

## 14. Cooldown, scoring, ranking, diversity, fallback `[NOW]` structure · `[NEXT]` signal

- **Cooldown buffer** (Step 4): last-10 disliked **BaseKeys**, FIFO; filters out a disliked silhouette
  across all its outer/shoe variants. Derivable from `OutfitInteraction` (no new state).
- **Scoring** (Step 5): `score = baseScore(+1.0) + behavioralSignal − dislikePenalty`. Humble v1
  `behavioralSignal = comboBoost + itemBoost` (§11). `dislikePenalty` is a **positive magnitude**: +0.5 per
  disliked item over the last M=20 interactions (flat, not accumulated), subtracted by the formula.
  **Affinity is non-negative** — a dislike never decrements
  affinity; the negative side is the penalty + cooldown, so the two memories never contradict. Stored
  `dislikePenalty` is a positive magnitude; the formula subtracts it (S4). Negative scores are valid (ranking
  is relative).
- **Ranking & diversity** (Step 6): BaseKey variant cap (max 2 per BaseKey) → overuse penalty
  (`OVERUSE_PENALTY=0.5` per item, subtracted, for each of a candidate's items appearing in more than
  `OVERUSE_THRESHOLD=0.40` of the post-variant-cap candidate survivors; applied only when that survivor pool
  > `OVERUSE_MIN_POOL=15`, so small pools are not punished, B1) → **repetition-window** soft penalty
  (`REPETITION_PENALTY=1.0`, flat, subtracted) on FullSignatures shown in the last 10 (rotation/freshness —
  this is where `[NEXT]` exposure/freshness lives) → fallback ladder if < K → sort by score → tie-break.
- **Tie-break** (deterministic): higher score → prefer least-represented silhouette so far (R3, reorders
  never excludes) → seeded shuffle via `tiebreak_seed(..., generationIndex)`.
- **Fallback ladder** (constraint relaxation, strict order; validation §13 never relaxes): normal → relax
  overuse penalty → relax BaseKey variant cap → relax cooldown (COOLDOWN_PENALTY −2.0, mark
  `relaxedCooldown=true` per outfit; the per-request `relaxedCooldownCount` aggregate is logged (N4 — the
  two are distinct, both kept); prefer silhouette diversity) → return fewer + `insufficientWardrobe` + user
  message.
- **Regen controls** (R9): `dislikedItemIds` and `lockedItemIds` are **Step-4 per-request filters** over
  cached candidates; if locked survivors < K, **one** constrained re-entry of Steps 1–3 (locks pinned into
  the pool before sampling, dislikes excluded), merged into the cached pool (dedup by FullSignature, key
  unchanged). Failure = partial + explicit notice, never a silently dropped lock. **Dropped from the legacy
  regen contract:** `changeTarget` and `feedbackNotes` (the deployed `regenerate/route.ts:349-358` has them;
  locks express the intent, notes persist via the feedback flow). The legacy `regenerate/route.ts` is
  deleted at cutover (§19).

## 15. Response, caching, logging `[NOW]` cache · `[NEXT]` snapshot

- **Response**: `outfits[]` (each with items, backend-assigned `optionPath`/`risk`, StyleMove,
  scoreBreakdown), plus
  `insufficientWardrobe` if triggered, plus baseKey/fullSig per outfit (client echoes them on feedback).
- **Seed** (R1 trap-guard): one **private** `_canonical_seed` primitive + two wrappers (`session_seed` /
  `tiebreak_seed`) so the two seeds cannot drift. **Length-prefix each field by UTF-8 byte count**
  (`f"{len(s.encode('utf-8'))}:{s}"`) before joining, sha256, first 8 bytes → int. A bare `"\x1f"` join
  collides (`join(["a","b\x1fc"]) == join(["a\x1fb","c"])`) and occasion is free text. `date=None` uses a
  typed sentinel (`-:`), distinct from `"None"`/`""`/absence. Never Python's process-salted `hash()`.
- **Two-stage caching** (R1): the cache stores the **expensive upstream stage** (sampled pool + GPT
  candidates) keyed on candidate-stage inputs; **Steps 4–6 run per request** over cached candidates.
  *Candidate-stage key inputs* (the "if this changes, cached GPT candidates are invalid because ___" test
  passes): `sessionId, wardrobeVersion, styleProfileVersion, normalizedOccasion, weatherBucket, intent,
  forcedItemId, date?`. **Routine/ranking-only signals do NOT enter the candidate key** (they only re-rank)
  — this prevents cache-key explosion (C3). **This candidate key is a *superset* of the session-seed
  inputs: v2 deliberately retires the v1.2 `cache_key ≡ seed` invariant (N1) — `intent`, `forcedItemId`,
  and `styleProfileVersion` change what GPT generates, so they must key the candidate cache, but they need
  not enter the sampler seed (the forced item is pinned deterministically; the seed governs the random
  draw within a given intent/profile context). New invariant: `cache key ⊇ seed inputs`. See §23-H16.**
  `generationIndex` is deliberately barred from the key so a
  re-roll re-ranks the *same* cached candidates with a new tie-break (cheap and genuinely different). A new
  dislike vanishes via the Step-4 cooldown on the very next render even on a cache hit; a like re-scores via
  Step 5. **Do not cache Step-5 scores.** TTL 15 min; dislike invalidates the entry (A4); a board edit mints
  a new `styleProfileVersion` and thus a new key.
- **The M5 request adapter** owns raw→canonical normalization (R5: weather bucketing, occasion
  normalization) **and** malformed `WardrobeItem` **wire-value validation** (R12 part 2). The
  `WardrobeItemDocument → fitted_core.WardrobeItem` mapping is the wire boundary where untrusted Mongo data
  enters — it validates types, non-empty ids/strings, and tag-container shape through one predictable error
  channel. The dataclass keeps only its two narrow guards (enum coercion of `clothingType`,
  `warmth ∈ 0..10`) as a last-resort backstop and is **not** the wire boundary (it accepts `warmth=True`,
  since a Python bool is an int — the trap-guard).
- **GenerationSnapshot** (training truth, `[NEXT]`): one immutable record per request — request inputs +
  StyleProfileSnapshot + candidate pool + **shown outfit ids/positions** + model/prompt/scorer versions +
  **interaction-time item feature snapshots**. Feedback binds to a **server-issued outfit id**. *This is the
  minimum durable record set — NOT full event sourcing* (audit rows + snapshots, normal Mongo projections
  for current state). Resolves the exposure-bias and feature-skew gaps before any model trains.
- **Logging** is async, best-effort, never on the critical path.

---

# PART IV — SUBSYSTEMS

## 16. Feedback & learning semantics `[NEXT]`

**Explicit events teach; silence does not.** Learning events: `saved`, `planned`, `packed`, `worn`,
`rated`, `corrected`. **Skipped/ignored options are logging-only, never negative** (a skip is ambiguous —
hurry, mood, UI order). The deployed `OutfitInteraction.action` enum already contains `saved/worn/rated`;
v2 activates those unused values and additively extends the enum for `planned/packed/corrected`.

- **Intent-aware wear semantics:** `wear this today` counts as worn immediately; `save`/`plan` are intent,
  not wear; worn-but-unrated defaults to a gentle weak-positive, never homework.
- **Like/dislike remain the primary explicit teaching actions** (the user-facing learning story stays
  simple). `saved/worn/rated` are weaker, secondary evidence; do not ask the user to constantly classify
  feedback.
- **Feedback reasons** (separate from events): `good/neutral/bad`, `too_boring`, `too_much`,
  `not_practical`, `not_me`, `wrong_context`, `weather_forced`, `necessity`, `too_repetitive`.
  `not_practical` is first-class. These structured reasons are the sole trainable "why" channel for
  feedback; free-form explanation blurbs are not training labels by default — but raw/corrected user rationale is **persisted with provenance** (user explanations are high-trust) and may be compiled into reasons **only after deliberate review** (§23-H34).
- **Scoped memory** `[NEXT]`/`[STAGED]`: feedback attaches to a scope — `outfit` / `board` / `routine` /
  `global`. A dislike under a "minimal workwear" board is not a global dislike. **Default scope in the
  `[NOW]` implicit lens (no board/routine active, H24):** an item dislike ("not me") is `global`; a path/look
  reaction is `outfit`-scoped — those are the only two scopes until B-track introduces boards. Hierarchy for sparse data
  (C2): global prior → profile memory if enough support → routine memory only with explicit/high support →
  content/board similarity fallback. Every scoped score carries a `supportCount`; low-support memory never
  outranks basic quality. Corrections — "right outfit, wrong board/routine" — **move** an edge's scope
  rather than delete it.
- **Anomaly scoping** `[STAGED]`: weather-forced / laundry / travel / illness create a **soft exception** by
  default (do not rewrite a board); suppressible and promotable. `do not learn from this` is an early control.
- **Feedback-authenticity gate (must precede training)** — confirmed real: `POST /api/interactions`
  (`interactions/route.ts:106-230`) authenticates the caller but persists client-supplied `items` and
  `perItemFeedback.itemId` with **no existence/ownership/outfit-membership check** (`:157-163`). Tolerable
  while feedback only feeds a user's own summary; **a dataset-poisoning vector once these rows become
  training labels.** Gate: bind feedback to a server-issued generation/outfit identity and validate item
  existence, ownership, and outfit membership before persistence.

## 17. Boards & routines lifecycle `[NOW]` text · `[STAGED]` dormancy · `[NORTH-STAR]` calendar

- **Text boards first** `[NOW]`: a board from style words / phrases compiles to the typed StyleProfile (§6.2).
  Visual boards (image → VLM/embedding) reuse the same compiler at `[STAGED]`.
- **Board edits change recommendations, gracefully**: an edit mints a new
  `styleProfileVersion` (reproducibility) but preserves *semantic identity* for memory continuity. A graded
  promise: major change (palette/silhouette/formality) refreshes strongly; minor change (a keyword tweak)
  preserves more of the candidate pool. *(The major/minor threshold is OPEN — §23-H5 — default: any
  palette/silhouette/formality change = major.)*
- **Dormancy & seasonal revival** `[STAGED]`: inactive boards **sleep, not decay** — compatibility/trust
  preserved, freshness cooled, exposure reset; reactivation summarizes old anchors + new bridge
  opportunities. Routines adapt faster than boards (behavior vs identity memory).
- **Routine confidence** `[STAGED]`/`[NORTH-STAR]`: explicit > calendar-derived > inferred; inferred
  routines *suggest* creation, never silently steer; calendar integration is gated behind privacy/consent
  (§22, C7) and is `[NORTH-STAR]`.
- **Board version history, forking, recaps, overlap (shared bridges)** are `[NORTH-STAR]`; the data model
  preserves the seam (immutable versions) so they need no rewrite.

## 18. CV / wardrobe ingestion — the W-track `[NEXT]`

Ingestion is **data acquisition for the whole graph** — friction starves the wardrobe, the interactions,
and the trained scorer. It is in scope (amends the CLAUDE.md frontend-redesign exclusion). Deployed today:
synchronous per-item CV via `cv/infer` → external HF Space (`CV_SERVICE_URL`), brittle cold starts.

**Target subsystem:**
- **Async ingestion**: a Mongo-backed job queue + worker on the always-on M5 service. Upload writes the
  image + an item shell; CV runs in the background; the user keeps using recommendations meanwhile.
- **Item states**: `pending_cv → needs_review → active → inactive`, plus `cv_failed_needs_review`. **The
  sampler sees only `active` items.** **`wardrobeVersion` bumps on exactly one transition — the one that
  makes an item sampler-visible (active) — incremented by the API layer, never the client or a DB
  trigger.** Naming this single transition is mandatory (§23-H6); if missed,
  a user adds + reviews items and gets stale recommendations.
- **CV-down never loses an upload**: a 404/timeout drops the item into `needs_review` with whatever partial
  attributes exist; the review form is the recovery path. Ingestion degrades gracefully the same way
  recommendation does (§19).
- **One review surface** = CV-correction form = manual-entry form: chips/suggestions, **named colors not hex
  codes**, review only low-confidence fields.
- **Extractor** `[STAGED]`: leading option is **VLM structured extraction** (JSON-schema output of the §6.1
  attribute set + per-field confidence + an image **embedding** for similarity/cold-start; same
  backend-validates-structure philosophy as the GPT pipeline). Fallback: rehost a CV model on the service
  box. **User correction always overrides model output; the sampler consumes only reviewed/active canonical
  fields**, never raw model guesses. *(This gate governs **human-reviewable** fields; machine-learned
  features such as the per-item **embedding** are a separate class the scorer may consume directly — they
  are not human-correctable, so review does not apply to them, §23-H25.)*
- New ingestion **writes the 5-value `clothingType` natively** (the delivery vehicle for the §6.1
  consolidation; backfill covers historical rows).

## 19. Host integration & what we delete

**Host, not frame (R7).** The old app is a host. Nothing in the new engine bends to old behavior; the
recommendation **vertical is replaced wholesale**, written clean against this spec, behind a
`USE_ML_SHORTLISTER` feature flag with graceful fallback. The working app is preserved at every step.

**Persists as host infrastructure (keep):** Firebase auth, wardrobe CRUD (`wardrobe/route.ts`,
`wardrobe/[id]`, `wardrobe/[id]/image`, `wardrobe/clear`), Mongo plumbing (`lib/mongodb`, `lib/db`),
profile/account UI (`account/page.tsx`), wardrobe UI, the image store (`WardrobeImage`, `lib/imageStorage`,
`images/[imageId]`), sign-in/up + landing + `AuthGate`/`Sidebar`. The CV ingestion surface (`cv/infer`,
`cv/status`, `lib/cvToWardrobeForm`, the add-item upload UI) is kept but revamped by the W-track (§18).

**Replaced wholesale at cutover (delete after the flag flips, verified clean cut — no shared-lib
entanglement):**
| File | Why it dies |
|---|---|
| `app/api/recommend/route.ts` | rewritten against this spec |
| `app/api/recommend/regenerate/route.ts` | folded into one route (R9); it is a near-duplicate of `route.ts` |
| `app/api/preferences/summarize/route.ts` | legacy taste-summary route; v2 uses structured feedback reasons, not generated preference prose |
| `lib/runPersonalizationSummary.ts` (`runPersonalizationSummary`) | legacy personalization-summary helper; no slot in the §12 prompt; §21-class non-goal; contaminates dive lift attribution |
| legacy external-LLM adapter files used only by preference summaries | no v2 consumer after generated preference prose is removed |
| `lib/weather.ts` | single consumer (`recommend/route.ts`); v2 weather is the bucketed Lens field, re-derived clean |
| `models/PreferenceSummary.ts` | legacy generated-preference artifact; no v2 reader |
| The request-time `clothingType` string-grep paths (`route.ts:241,550`, regenerate `:234,557`) | replaced by the first-class `clothingType` enum (§6.1) |
| The footwear auto-injection hack (`route.ts:583-598`) | sampler/validator handle shoes honestly |
| `dashboard/page.tsx` recommendation UI + `history/page.tsx` | rewritten to the §6.5 response + StyleMove |

`OutfitInteraction.ts` is **kept and extended** (§6.6) — it is the training-signal source.

**Sequencing:** freeze the entire old recommendation vertical as the M5 fallback arm; delete the whole arm
at the dive cutover. Deleting before the replacement exists would break the working app — do not.

**Trust-boundary gates (verified real; fix before treating any retained route as trusted):**
- `interactions/route.ts` POST: no ownership check on `items` (§16 gate).
- `account/route.ts`: trusts body `firebaseUid`, **no Authorization-header verification** (unlike every
  other DB route) — anyone can read/modify any account.
- `auth/sync/route.ts`: creates/finds a user from a body-supplied Firebase UID with no ID-token check.
- `images/[imageId]/route.ts`: serves image bytes by ObjectId with no auth/ownership check.
- `cv/infer/route.ts`: external compute with no auth, rate limit, or upload-size cap.
`AuthGate` is a client-side redirect and does **not** protect direct API calls. Gate: verify the Firebase
token, derive identity only from it, enforce ownership, authenticate + rate-limit CV. Release blocker, not
an M0 blocker.

---

# PART V — BUILD & OPERATIONS

## 20. Build ladder (milestones)

The substrate (`ml-system/fitted_core/`, Python, pytest, no DB/keys) has M0–M3 complete (contracts, sampler, the GPT-JSON validation boundary, and the ranker); the rest is forward.

| Stage | Scope | Status / rung |
|---|---|---|
| **M0** | Contracts & pure functions: keys, SlotMap, seed, config, models | ✅ done |
| **M1** | Sampler: partition, caps, 70/30, the SignalScorer seam (`ColdStartSignalScorer`) | ✅ done (M1-1..M1-5 — partition/caps/70-30 seam/candidate scaling/`build_candidate_pool` entry point per §10/§11; pytest green; signal path stubbed until M6) |
| **M2** | SlotMap validation as a pipeline stage + strict GPT-JSON validation | ✅ done (C1–C6 — parse, strict §12 schema, SlotMap/pool validation, keys + exact-FullSignature dedup, StyleMove, candidate bounds; pytest green) |
| **M3** | Ranker: cooldown, scoring (additive humble layer), variant cap, overuse, repetition, fallback, regen controls (over M2's already-deduped accepted candidates — M3 never re-dedups) | ✅ done (C1–C6; §12 mutation-hardened; pytest green) |
| **Spearhead** | **Orphan-item rescue end-to-end**: forced item, lens context, Python-assigned reliable/bridge/stretch variants, StyleMove, like/dislike via the existing `OutfitInteraction`. The snapshot-bound scoped-feedback tail is `[NEXT]`/M4. | `[NOW]` — proves the whole vision |
| **M4** | Data-model migration: `clothingType` →5 + backfill, action enum extension (`planned/packed/corrected`), `ItemAffinity`/`wardrobeVersion`/`sessionId`, GenerationSnapshot, baseKey/fullSig on interactions, feedback-authenticity gate | `[NEXT]` |
| **M5** | Deploy `fitted_core` (Fly.io, always-on, Docker); Next→service `fetch()` behind `USE_ML_SHORTLISTER`; health check + timeout + graceful fallback; two-stage cache; request adapter (normalization); trust-boundary gates | `[NEXT]` |
| **W-track** | Async CV queue + item states + review surface + VLM extraction/embeddings (§18) | `[NEXT]`/`[STAGED]` |
| **B-track** | Text boards → StyleProfile compiler; then visual boards | `[NEXT]` text / `[STAGED]` visual |
| **M6 (the dive)** | Trained edge/graph scorer at the SignalScorer seam; offline NDCG@k; online A/B; behavioral edges → learned (§11) | `[STAGED]` |
| **R-track** | Explicit routines → routine-scoped memory; dormancy/revival; then inferred/calendar | `[STAGED]`/`[NORTH-STAR]` |

The hosting decision (Fly.io, Brian's own service, always-on Docker, no cold starts; separate from the CV
HF Space) and the Python↔TS `fetch()` boundary are settled (carried from the M0/M1 plan).

## 21. Evaluation & metrics

**Three honest levels (this is a portfolio project, not a high-volume product):**
1. deterministic unit/property tests for every contract (pytest);
2. synthetic/replay eval (golden wardrobes + golden requests) for sanity and regressions;
3. real-user metrics as **descriptive evidence, not overclaimed science** (small N).

**Online/product metrics:** time-to-first-useful-outfit; accepted-upgrade / accepted-rescue rate;
just-right vs too_boring/too_much; % recommendations using previously-ignored items; orphan-items-rescued;
no-buy accepted outfits; repeat-session rate after first success; cache hit rate; invalid-JSON / validation
reject / fallback-step distributions; latency p50/p95.

**Offline (the dive):** NDCG@k / hit@k on accepted outfits; **profile- and routine-conditioned acceptance**;
diversity/coverage; novelty-vs-repetition; counterfactuals (global memory vs profile vs routine). Requires
the GenerationSnapshot's exposure/candidate identity, positions, and feature snapshots — interaction rows
alone are selection-biased. **Do not claim model lift unless sample size + exposure logging justify it.**

## 22. Operational safeguards, non-goals, doc lifecycle

**Safeguards:** the truncating cap `MAX_CANDIDATES=40` and the *asserted invariant* `MAX_PROMPT_ITEMS=135`
(= cap sum, never a silent truncation — §10); one JSON-repair attempt;
normalization before validation before scoring; invalid candidates never reach the ranker; all weights as
named constants in one config file (the 70/30 split is the exception — a structural helper, §10/R6); logging
async/best-effort; `wardrobeVersion` bumped only by the API layer on the single activation transition (§18); scoreBreakdown computed
at response time, not persisted; graceful degradation through the fallback ladder before any error.

**Non-goals (still out of scope for the near term — reframed from v1.2 §21):** virtual try-on / avatars
(platform-owned; `[NORTH-STAR]` at most); social wardrobes / community feeds; shopping marketplace /
affiliate (no-buy is the default trust posture; gap diagnosis is diagnosis-only and `[STAGED]`); prescriptive body /
color *quizzes* + objective "fashionability" scoring (non-prescriptive by design — this does **not** bar an
*optional, declared, coarse* body-proportion archetype as a refinable styling prior, nor learned color
*compatibility*; §23-H27); real-time online *training* (continuous gradient updates — a serving-time
**exploration** policy + periodic **batch** retraining is in-scope, §23-H31); full event
sourcing; distributed-systems infrastructure (copy the contracts — candidate/ranking split, durable
snapshots, cache-as-derived — not the machinery). *Reversed from v1.2 non-goals and now in scope:* StyleMove
explanations, attribute-level StyleProfile traits, routine/occasion context — all deliberate, all here.

**Privacy** `[STAGED]` (C7/C10): boards, routines, calendar, wardrobe photos, and interaction logs are
sensitive. Before calendar integration or visual boards: define data minimization, deletion behavior, and
private-by-default. Cross-user **collaborative/behavioral** signals require item canonicalization + consent — out of scope; this
bars collaborative signals, **not** a universal content-compatibility model trained on public outfit data (§23-H26).

**Doc lifecycle (carried from CLAUDE.md):** this file is living — edit stale content in place, no
"superseded by" narrative, no amendment history (git is the archive). Keep **trap-guards** (rationale that
stops a re-mistake — R6 rounding, R1 framing, R10 reserved chars); delete evolution narrative. Conflicts
are bugs, fixed on sight. If the file exceeds ~1,500 lines, spend a session compacting.

## 23. Open Holes Register

Every known gap, with status. No silent holes; add here in the same edit you find one.

| ID | Hole | Status | Resolution / owner |
|---|---|---|---|
| H1 | Edge storage could explode to O(lenses × n²) | **RESOLVED-HERE** | Behavioral edges sparse (interaction pairs only); compatibility computed on demand; lens is a feature on the interaction, not a per-lens edge table (§6.4) |
| H2 | Edge memory can drift into too many sparse dimensions | **RESOLVED-HERE** | StyleEdge stores exactly TWO fields: `compatibility` + `behavioralStrength`. Freshness/exposure are derived ranker inputs; ratings/reasons and source rows remain feedback/snapshot data, not edge fields (§11/§16). |
| H3 | Graph vs the v1.2 additive scorer — two parallel systems? | **RESOLVED-HERE** | Additive scorer = the humble first `behavioralStrength`; learned graph scorer is the staged evolution at the same seam (§11/§14) |
| H4 | Within-day cache stability vs GPT stochasticity (temp>0) — a mid-day cache expiry reruns GPT and yields different candidates | **OPEN** → DEFERRED-M5 | Pick one: promise stability only for the candidate-cache lifetime; persist the candidate stage across the seed-day; or make GPT generation reproducible (seed/snapshot per seed-day). Default lean: candidate-cache lifetime. |
| H5 | Board edit major/minor threshold (graded refresh) **and** the semantic-identity key that carries behavioral memory across `styleProfileVersion`s | **OPEN** → DEFERRED-B-track | Threshold default: any palette/silhouette/formality change = major (strong refresh); keyword-only = minor (preserve pool). The identity-continuity mechanism (the stable key memory binds to, separate from the version) is specced at B-track |
| H6 | The single `wardrobeVersion`-bumping item transition isn't named | **OPEN** → DEFERRED-W-track | The W-track `/spec` must name the one transition meaning "now sampler-visible (active)"; that transition is the only bump. Reconcile `isAvailable` vs `needs_review` vs active. |
| H7 | `generationIndex` lifecycle (ownership, range, increment, reset) undefined — it is the sole input distinguishing a re-roll | **OPEN** → DEFERRED-M5 | M5 defines it; load-bearing for the two-stage cache |
| H8 | Daily-reseed `date` timezone (server-UTC vs user-local) undefined | **OPEN** → DEFERRED-M5 | Must be identical across the Next adapter and the service or seed/cache desync at the day boundary. Default: UTC |
| H9 | M6 eligibility prevalence unknown (needs both ≥5 interactions AND ≥1 type over cap) | **OPEN** → DEFERRED-pre-M6 | Measure % of requests meeting both; if low, give the model a second surface (candidate ordering / ranker) |
| H10 | M4 interaction-time feature snapshots not yet built; mutable wardrobe refs rewrite old feedback's meaning | **OPEN** → DEFERRED-M4 | GenerationSnapshot (§15) persists immutable feature snapshots before interactions become labels; add history tests for edited/deleted items |
| H11 | M4 idempotency/transaction rules (duplicate feedback, affinity updates, concurrent caps, `wardrobeVersion` races) | **OPEN** → DEFERRED-M4 | Define when M4 is specced |
| H12 | M5 graceful-fallback failure semantics under-pinned | **OPEN** → DEFERRED-M5 | Pin: numeric timeout budget; full trigger set (unreachable OR timeout OR schema-invalid/empty); an anti-rot smoke test exercising the fallback arm |
| H13 | Pre-M5 CI / runtime reproducibility (no CI workflow, no runtime pins, `requirements.txt` lower-bounds only) | **OPEN** → DEFERRED-pre-M5 | Cross-runtime CI before M5 integration so serialization/auth/timeout/fallback can't drift between Next and the service |
| H14 | Retained-host cleanup bugs: clear-wardrobe/user-cascade omit some cleanup; image **replacement deletes the old image before the replacement commits** (data-loss ordering) | **OPEN** → DEFERRED-W-track | Fix when the W-track or trust-boundary gate touches these routes |
| H15 | Key-computation locus: keys are Python; `interactions` route is TS | **RESOLVED-HERE** | Compute keys once in Python at generation; response carries them; client echoes on feedback; store verbatim (server recompute optional). Never reimplement in TS (§7) |
| H16 | Candidate cache key ⊋ session-seed inputs — retires the v1.2 R1/N1 `cache_key ≡ seed` invariant | **RESOLVED-HERE** | New rule `cache key ⊇ seed inputs`: `intent`/`forcedItemId`/`styleProfileVersion` key the candidate cache (they change GPT candidates) but need not seed the sampler (§15) |
| H17 | PDF `forceRegenerate=true` disposition undefined, given R1/R9 redefine regenerate as cached re-rank | **OPEN** → DEFERRED-M5 | M5 decides retain/rename/remove; current lean: removed (R9 locks + the `generationIndex` re-roll cover the intent — H7) |
| H18 | `behavioralStrength` sign: §11 said "signed" but §14/R2 keep affinity non-negative | **RESOLVED-HERE** | `[NOW]`/`[NEXT]` non-negative affinity + separate `dislikePenalty`/cooldown (R2); signed per-edge accumulator is the `[STAGED]` graph evolution (§11/§6.6) |
| H19 | Repetition-window shown-history has no `[NOW]` storage home (dropped from the old ledger on consolidation) | **OPEN** → DEFERRED-M4 | M3 consumes shown-history as a pure input (shipped); only the storage home remains — `GenerationSnapshot.shownFullSignatures` (§15, `[NEXT]`) or an interim per-user ring buffer until the snapshot lands |
| H20 | `optionPath`/`risk` were emitted by GPT (violates §5 "GPT never ranks"); cold-start path/risk metrics undefined | **RESOLVED-HERE** (locus) + **OPEN** (metric) → DEFERRED-rescue-spec | Pure Python backend functions assign path/risk/graph-role labels (§11/§12/§14). The M2 GPT schema excludes `optionPath`, `risk`, score, rank, graph role, edge strength, freshness, exposure, fallback decisions, matched/missing traits, and diagnostic reason candidates; future schemas may add trait/reason fields only when their owning milestone consumes them (§12). Cold-start path ≈ compatibility/commonness/trusted-anchor availability; cold-start risk ≈ social visibility/boldness — exact metrics are rescue-spec calls |
| H21 | "Orphan" is edge-defined but no edges exist at cold start | **RESOLVED-HERE** | Cold-start orphan = zero interactions + null/old `lastWornAt` (± `isFavorite`, ± explicit mark); deployed schema already has these fields (§11) |
| H22 | Rescue forced-item → template logic + insufficient case + minimum starter closet | **RESOLVED-HERE** (template/insufficient) + **OPEN** (min closet) → DEFERRED-rescue-spec | `clothingType`→template rule + rescue `notEnoughItems` (§12); the minimum closet for the hook to function (and sub-threshold UX) is a product CALL |
| H23 | GPT-emitted `StyleMove` wasn't boundary-validated | **RESOLVED-HERE** | `StyleMove.changedItemIds ⊆ outfit items`, else dropped (§13, §5 LLM-boundary rule) |
| H24 | Feedback scope undefined when no board/routine is active (`[NOW]`) | **RESOLVED-HERE** | path/look → `outfit`; an item-dislike defaults to the **implicit/default-lens** scope and is promoted to `global` only on **repeated support/confirmation** — one tap never yanks the global profile (anti-capture §3, posture rule 2); board/routine scopes arrive with B-track (§16) |
| H25 | Compatibility/item representation is attribute-only; embeddings are `[STAGED]`; the §18 review gate excludes unreviewable features | **RESOLVED-HERE** → reflect at M4/W-track | Item representation is **extensible** (tags now → embeddings later); scoring consumes a representation, never a fixed tag list. Learned features (per-item embedding) are a **usable scorer class** distinct from human-reviewable canonical fields (§11/§18) |
| H26 | §11 "never shared-catalog" / §22 "cross-user out of scope" would also bar a universal compatibility model | **RESOLVED-HERE** | Split: **behavioral/collaborative** cross-user stays out (privacy); a **universal *content*-compatibility model** trained on **public outfit corpora** is in-scope (clothes, not people) and is what makes the trained scorer feasible at portfolio scale — within-user behavior personalizes it (§11/§22). **Load-bearing for the dive's feasibility** |
| H27 | §22 body/color non-goal would bar a body-type styling signal | **RESOLVED-HERE** | Non-goal = no prescriptive quiz/scan + no objective "fashionability" score. An **optional, declared, coarse body-proportion archetype** as a refinable cold-start styling prior is **in-scope** (behavior reinforces current defaults; a prior enables better-than-default advice); measurements stay optional/out (sizing only) (§22) |
| H28 | The `SignalScorer` seam is item-level (`score(item, context)`) — wrong shape for outfit/pairwise compatibility | **OPEN** → DEFERRED-M5/M6 | Reserve a **second seam shape**: an **outfit/pairwise-level scoring hook on the ranker** (scores a SlotMap / a pair), distinct from the item-level sampler slot. A summed per-item score cannot represent "these clash"; the compatibility dive needs the outfit-level hook to land (§5/§11/§14) |
| H29 | GenerationSnapshot may store only validated/shown candidates + text features (selection-biased, label-only, attribute-only) | **OPEN** → DEFERRED-M4 | Snapshot must persist (a) **continuous** path/risk/compatibility **scores**, not just the 3-way buckets; (b) **rejected + low-ranked** candidates + reasons (negative signal); (c) the **visual** (image ref/embedding), not just text attributes — else the rich-representation + off-policy paths die (§15/§21). Guard the image-replacement data-loss (H14) |
| H30 | `FullSignature` format is spec-locked; new garment roles would force a key migration; BaseKey identity is base-only | **RESOLVED-HERE** (rule) + **OPEN** (identity) | Extension rule: a new optional slot appends **only when present**, fixed canonical order, so existing keys stay valid. BaseKey stays **base-only** for `[NOW]` cooldown/variant-cap; outer/shoe-defined identity is a registered **future** redefinition (§7/§8) |
| H31 | §22 "real-time online training" non-goal could be read to bar exploration | **RESOLVED-HERE** | Out = continuous real-time gradient training. **In-scope**: a serving-time **exploration** policy (sometimes surface an orphan to learn its edges) + **periodic batch** retraining — how orphan-learning + anti-capture work; enables off-policy eval (§21/§22) |
| H32 | The 30% signal slot caps the learned model's influence on *generation* | **RESOLVED-HERE** | The 70/30 split is a deliberate generation-influence ceiling, **not a law**; the trained scorer also scores the ranker, so total influence is not capped at 30% (§10) |
| H33 | §12 strips `imageUrl` from GPT input ("token cost") | **RESOLVED-HERE** (framing) → DEFERRED | The strip is a **cost deferral, not a principled closure**: a vision-capable **generator** (sees garments, not just tags) stays open for a later milestone (§12) |
| H34 | Freeform feedback excluded as a trainable channel (§16/§6.6) | **RESOLVED in §16/§6.6** | Posture rule 1/3: structured reasons stay the labels; raw/corrected rationale is persisted with provenance, excluded from training until reviewed |
| H35 | Dormant boards (§17) have no data home in `active\|archived` (§6.2) | **RESOLVED-seam in §6.2** → DEFERRED-B-track (impl) | Posture rule 1: board status gains `dormant` (or a `DormantBoardState`) |
| H36 | `ConstraintSet` is a fixed closed set (§6.3) | **RESOLVED in §6.3** | Posture rule 1: additive + raw-preserving (optional user-declared constraint text/provenance) |
| H37 | §16 anomaly scoping promises soft exceptions, but the scope vocab is only `outfit/board/routine/global` | **OPEN** → DEFERRED-M4 | Add first-class **`lens`** and **`exception`/`anomaly`** scopes (or split `scopeTarget` + `learningDisposition`) so noisy periods can be quarantined, reviewed, and promoted without rewriting board/routine memory (§16). Scope: M4 adds the scope-vocab **field** additively (posture rule 1); the anomaly-scoping **behavior** stays `[STAGED]` (§16) |
| H38 | "one global active profile in v1" (§6.2) could collapse the lens out of stored memory | **RESOLVED-HERE** | The global active profile is the **v1 default selection only**; every request/feedback snapshot may still carry `boardId`/`styleProfileId`/immutable version/confidence when present, so "which version of me" isn't lost (§6.2/§6.3/§15) |
| H39 | The "remembers it as a personal style rule" loop (appendix C.8) has no rule object | **OPEN** → DEFERRED-`[STAGED]` | Add a deferred **`PersonalStyleRule`/`MemoryLesson`** artifact compiled from repeated scoped feedback (source events + scope), so Progress/Debugger surfaces don't scrape raw interactions (§16/§6.6) |
| H40 | The `[NOW]` product *assumes* GPT styles believably from **text attributes only** (images stripped, §12) — unvalidated | **OPEN** → validate pre-M5 | The `[NOW]` viability bet. Validate empirically on golden wardrobes (believability judged) before relying on text-only generation; if it underdelivers, promote vision-input-to-generator (H33) from deferred to near-term (§12/§21) |
| H41 | §2 "graph never the interface" + "hook first" could harden into bans | **RESOLVED-HERE** | Cards are the **default dressing interface**; a **secondary** graph/progress/`[NORTH-STAR]`-editing surface may exist behind progressive disclosure. Hook-first is the **default**, not a ban on optional lens-first board/routine selection (§2) |

---

## Appendix A — Concordance (old identifiers → v2 home)

So existing references in `m0-m1-substrate.md` and elsewhere still resolve. The old docs are retired; this
map is their forwarding address.

| Old | Was | Now lives in |
|---|---|---|
| R1 | One seed primitive + two wrappers; length-prefix; None sentinel; two-stage cache | §15 (seed + caching) |
| R2 | comboBoost + itemBoost stack; affinity non-negative; magnitude risk | §11 + §14 (demoted to humble behavioral layer) |
| R3 | Fallback "prefer diversity" = tie-break-only | §14 (tie-break) |
| R4 | Determinism = canonical input ordering | §10 (sampler ordering) |
| R5 | `weather` bucketed, `occasion` verbatim | §6.3 (RequestContext) |
| R6 | 70/30 split = sampler helper, integer half-up | §10 (trap-guard) |
| R7 | Host, not frame | §19 |
| R8 | `sessionId = userId`, anonymous dropped | §6.3 / §19 |
| R9 | Regen controls: locks + contextual dislikes, hybrid escalation | §14 |
| R10 | Key reserved-char precondition | §7 (trap-guard) |
| R11 | Scorer availability ≠ interaction_count; 3 log-distinct fallbacks | §10/§11 (the seam) |
| R12 | Duplicate item-ids at sampler entry; wire-validation at M5 adapter | §10 / §15 |
| R13 | Uniform `TypeSampleResult`; `includeAll` selection kind | §10 |
| S4 | `dislikePenalty` stored positive, subtracted | §14 |
| S5 | Cold-start at `< MIN_SIGNAL_THRESHOLD`, not only zero | §10 |
| N1 | cache-key ≡ seed inputs **(retired in v2 → `cache key ⊇ seed inputs`)** | §15 + H16 |
| N2/C1 | Daily re-seed (`+date`) supersedes "stable indefinitely" | §15 + H8 |
| N3 | §13 validation superset, three owners | §8 |
| N4 | `relaxedCooldown` (per-outfit bool) vs `relaxedCooldownCount` (per-request aggregate) — both kept | §14 |

## Appendix B — Config constants (single home, §22)

`DEFAULT_K=10` · per-type caps `TOPS=35, BOTTOMS=30, DRESSES=25, OUTER=20, SHOES=25` ·
`MAX_PROMPT_ITEMS=135` (= cap sum, asserted) · `MAX_CANDIDATES=40` · `MIN_SIGNAL_THRESHOLD=5` ·
`MAX_AFFINITY=20` · `OVERUSE_MIN_POOL=15` · `OVERUSE_THRESHOLD=0.40` · `OVERUSE_PENALTY=0.5` (magnitude, per
overused item, subtracted — S4) · `COOLDOWN_PENALTY=-2.0` (stored
negative, added — S4) · `DISLIKE_PENALTY` magnitude 0.5 (per disliked item, subtracted — S4) ·
`COMBO_BOOST=+2.0` · `ITEM_BOOST_WEIGHT=+0.1` · `BASE_SCORE=+1.0` ·
dislike window `M=20` · cooldown buffer 10 (FIFO) · repetition window 10 ·
`REPETITION_PENALTY=1.0` (flat magnitude on a re-shown FullSignature, subtracted — S4) · cache TTL 15 min. The 70/30 split
is **not** a constant — it is the sampler-owned `random_count` helper (§10/R6). *(Note: deployed K default is
5, not 10; v2 sets 10.)*
