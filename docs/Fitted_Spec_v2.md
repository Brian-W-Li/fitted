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
*"rescue an item you never wear"* / *"dress me for today"* — using an **implicit default lens** (just a
light context the user can set: occasion + constraints). Board creation is offered as step 2, once there is
a closet to ground it. Rationale: fastest first value; matches the green-shirt resonance; a board is
meaningless against an empty closet. `outfit_upgrade` remains a later intent, not an M5 launch hook.
*(Resolves the onboarding fork; see §17 for boards.)*

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
2. **"It remembered the one I said yes to — and later the one I actually wore — and is varying it, not
   repeating it."** — M5's humble layer starts with explicit accepted/rejected proxy feedback + rotation;
   real worn/saved/rated outcome memory is a stronger later signal, never silently collapsed into
   `accepted`. `[NEXT]`
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
responses: explicit constraints (§6 Lens), backend-assigned path/risk labels (§11, response-layer), `not_practical` as a
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
  outfits; the *validator* enforces structure. (Expensive.)
- **Ranking** — the *ranker* decides what the user sees from validated candidates: cooldown, scoring,
  diversity, freshness, fallback. (Cheap; runs per request.)

**Guiding principle:** Sampler bounds → Validator enforces that bound → Ranker decides. GPT performs no
scoring or rule logic; the backend always owns final authority. GPT drift cannot corrupt scoring.

**The replaceable seam (the ML dive plugs here).** The sampler's signal-selection slot exposes an item-level
`SignalScorer` seam (§10, §11) for the **behavioral/personalization** scorer; the **content-compatibility** dive
plugs a **distinct** pairwise/outfit-level seam (§23-H28). M5 lands the producer-side half only: an
`OutfitScorer` is exercised while writing snapshots so `scoreTrace.compatibility/visibility` is populated
without changing rank order. The additive rank-order hook on `RankerContext`/`rank()` is reserved for M6 entry;
the trained graph scorer swaps in at `[STAGED]` with no other code change **once that hook lands**. This seam is
the single most important structural deliverable.

**What the engine is *today* vs. the destination** (read this before "style graph" misleads). At `[NOW]`
the engine is a **closet-grounded GPT stylist with structured outputs and stable feedback keys**: GPT
composes outfits fenced to the wardrobe + Lens, the deterministic ranker filters/diversifies them (the
response layer buckets them into path/risk), and the response carries `baseKey`/`fullSignature`; feedback
binds by `{snapshotId,candidateId}` and the server re-reads keys from the GenerationSnapshot (§15). Believability
rides on **GPT's styling judgment fenced by the closet** — *not* a
learned graph yet. The **personal style graph** is the brand, the metaphor, and the `[STAGED]` payoff:
accumulated feedback + a learned compatibility model (§11) is what the data *grows into*. Same engine,
different rungs — not the same moment. *(Seam caveat: "no other code change" holds only if the seam is the
right shape — see §23-H28.)*

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
The node of the closet graph. Deployed schema carries
`category`, `subCategory`, `pattern`, `colors[]`, `seasons[]`, `occasions[]`, `layerRole`, `brand`, `fit`,
`size`, `isAvailable`, `isFavorite`, `lastWornAt`, `tags[]`. v2 adds the fields the engine actually
conditions on, written natively by the rebuilt ingestion (no backfill of existing rows — M4 wipes the
collection clean, since no real users accumulated against this fork; `docs/plans/m4-data-model-migration.md` §14):

- **`clothingType` widened to 5 values** = `["top","bottom","dress","outer_layer","shoes"]` (exact
  underscore wire values = `fitted_core` `ItemType` member names, no translation table). The deployed enum
  was `["top","bottom"]` with a hard-coded coerce-to-top/bottom at the POST handler — both go away at M4
  alongside the request-time string-match classifiers in the recommend routes (§19 deletion table). The new
  ingestion writes the 5-value `clothingType` natively from CV output + the per-item review surface (the
  W-track data-path, §18).
- **`warmth` (int 0–10, required) — the one new engine column M4 adds.** `fitted_core.WardrobeItem`
  *requires* warmth (raises on null/out-of-range), so the engine cannot run without it. M4 persists it as a
  column, **keyword-derived at ingestion** from `category`/`subCategory`/`name` (so it's never null). The
  ranker bins warmth into 3 bands (`response.py` `_warmth_band`), so a coarse keyword map suffices by
  construction. Computed once at write, stored — the §15.2 adapter passes it through with **no read-time
  derivation**, so the stored value is authoritative and must stay correct across edits. The ingestion
  path keeps it so: POST derives it, and **PATCH re-derives it whenever a warmth-driving field
  (`name`/`category`/`subCategory`/`seasons`) changes**, accepting an explicit valid `warmth` as the
  correction override (POST/GET/PATCH responses now expose it). This stops a stale warmth from reaching training truth
  via `engineVisible.warmth` (§15.1). The dedicated user-facing **correction review form** remains the
  W-track's (§18, §23-H47).
- **`material` / `formality` / `styleTags` — deferred to the W-track, NOT M4 columns.** The engine treats
  these as **optional** (`fitted_core.models.py`: `material`/`formality` `Optional`, `styleTags` defaults
  `[]`), and today's CV produces none of them — so adding the columns in M4 would persist three fields
  nothing can fill and nothing reads before the W-track CV. They ship as **one coherent W-track unit** with
  the VLM CV that fills them + the review form that corrects them (§18). **The snapshot `engineVisible`
  contract still carries all three field-slots** (§15.1) — the M5 adapter emits `null`/`[]` for them until
  the columns exist — so the training shape is reserved now without persisting empty columns. When the
  W-track adds them: `material`/`formality` are **freeform, normalized on write** (`_norm_label` idiom);
  `formality`'s effective vocab is the Appendix B `FORMALITY_RANK` keys + `unknown`; a hard enum stays
  unlocked (posture rule 1).
- **`tags` stays as-is** (deployed freeform user/CV annotation, posture rule 1; demoted to snapshot
  `evidence`, storage-only). The curated engine-visible `styleTags` arrives with the W-track (above); the
  `evidence.tags` vs `engineVisible.styleTags` provenance split (§15.1) holds — do not wholesale-copy one
  into the other.
- **Richer style ontology** `[STAGED]`: `silhouette`, `garmentRole`
  (base_top, base_bottom, one_piece, outer, mid, shoe, and future accessory/bag/belt/hat),
  per-field `confidence`, `reviewed` flag. Added additively; `[NOW]` uses only what exists +
  `clothingType` + the four CV fields above. Accessories and under-layers are explicitly future garment
  roles (§8).

### 6.2 Board / StyleProfile / StyleProfileSnapshot `[NEXT]` text · `[STAGED]` visual
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
  *Persisted home (M4/S5):* `wardrobeVersion` is stored on the **User** doc — `User.wardrobeVersion:int`,
  default 0, monotonic — and the request adapter reads it into the Lens. The single bump transition is
  deferred to the W-track (§18/§23-H6); until it is named the value is a constant 0, and pre-existing user
  docs lacking the field coalesce missing→0 at snapshot-write (`docs/plans/m4-data-model-migration.md`
  §10.4).

  *Why `weather` is a bucket but `occasion` is verbatim:* weather drifts without user intent (raw text
  destabilizes the seed every render); occasion changes only by user intent and must stay text-distinct so
  "job interview" and "office party" never collide in the `candidateCacheKey`/seed. Raw→canonical normalization is owned by the
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
- **OutfitVariant**: response-layer wrapper around a validated, ranked outfit. The backend **response
  layer** (post-rank, *not* the closed ranker itself) assigns an `optionPath` (reliable|bridge|stretch)
  and a `risk` (safe|noticeable|bold), and carries the outfit's `StyleMove`, `score`/`scoreBreakdown`, and
  `baseKey`/`fullSignature`. At cold start it also carries the two `[0,1]` content scores it bucketed
  path/risk from — `compatibility` and `visibility` (internal eval / the M6 seam, see §11). None of these
  are GPT-emitted fields.
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
  `planned/packed/corrected` scoped-feedback events (§16) — **additive only: existing actions are never
  renamed or removed** (posture rule 1). It also adds the **`{snapshotId, candidateId}`
  binding** + **server-re-read `baseKey`/`fullSignature`** to each row (all nullable — present iff
  snapshot-bound; pre-M5 legacy rows have none), plus the additive nullable **scope-vocab fields**
  `scopeTarget?` / `learningDisposition?` (the feedback event's attach-point and its disposition; vocab +
  semantics in §16, behavior `[STAGED]`). The immutable lens + item-feature snapshot lives **only** in
  the referenced `GenerationSnapshot` (§15.1), never duplicated on the row; on snapshot-bound feedback the
  server re-reads the candidate from the snapshot and never trusts client-echoed content (S4). Trainable "why" is captured
  only by the structured `FeedbackReason` set (§16); no unstructured blurb is a **training label** — raw /
  corrected user rationale is nonetheless **persisted with provenance** and excluded from training until
  deliberately reviewed/compiled (§23-H34).
- **StyleEdge memory** (§11): `compatibility` (content, derived) + `behavioralStrength` (sparse;
  non-negative in the `[NOW]`/`[NEXT]` layer, signed at `[STAGED]` — H18).
  *The deployed/ v1.2 additive memory (`ItemAffinity`, comboBoost/itemBoost) is **demoted** to the humble
  first implementation of `behavioralStrength` (§14), not a parallel system.*
- **Affinity is a compute-live projection, never stored** (posture rule 1 + 3 applied to behavioralStrength's
  humble layer): Next fetches the raw append-only `OutfitInteraction` rows and the service's Python
  `reducers.py` (`m5-cutover.md` §H) recomputes `item_affinity` / `liked_full_signatures` / the cooldown
  buffer at request time. **No authoritative `ItemAffinity`
  collection** — an incrementally-updated counter is a read-modify-write that can drift from the log, while a
  projection cannot drift (recomputed from the log, consistent by construction; rebuilds clean after H43
  redaction). Materialize to a stored projection only later on measured request cost or an M6 feature-store
  need, with evidence (§14 / plan §7.3).
- **GenerationSnapshot** (new): §15.1.

### 6.7 Caches (§15)
**No runtime candidate cache** (retired at M5 — `m5-cutover.md` D2): the immutable `GenerationSnapshot` is
the durable candidate store; every render is a fresh generation. Semantics home = §15.

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
  TS** (drift hazard); M4 persists them verbatim. Pre-M5 legacy feedback may echo them, but M5
  snapshot-bound feedback echoes `{snapshotId,candidateId}` and the server re-reads keys from the snapshot.

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

*Deployed reference (what we replace):* `isValidOutfitStructure` (`recommend/route.ts:530`) already
rejects >1 bottom/base_top/one_piece/shoes, one_piece+top/bottom, >1 outer, >2 mid; and **auto-injects a
footwear id** post-LLM (`:512-527`). v2 does **not** carry the auto-injection hack — the sampler/validator
model handles shoes as an optional role honestly. *(Legacy-route line numbers drift; grep the symbol if
they slip — these die at the M5 cutover, §19.)*

---

# PART III — THE PIPELINE

## 9. Canonical pipeline order

The single authoritative ordering. Every scoring/diversity mechanism declares its step here before being
added.

| # | Step | Does | Milestone |
|---|------|------|-----------|
| 0 | **Resolve request** | Build the Lens/RequestContext (§6.3): user, wardrobeVersion, intent, occasion, weather bucket, constraints, active profile snapshot, routine, forced item / base outfit | M5 adapter |
| 1 | **Pool prep** | Partition by `clothingType`, per-type caps, 70/30 sampling, derive session seed; intent-specific forced/lock scoping happens outside the closed sampler (§12/§14) | M1 sampler |
| 2 | **GPT generation** | Candidate outfits as role-tagged item lists plus allowed `StyleMove` text only in M2; no scores, ranks, `optionPath`, `risk`, or diagnostic reason fields (§12) | M2 contract · Spearhead call |
| 3 | **Normalize + validate** | Raw → SlotMap; structural validation (§8/§13); compute BaseKey + FullSignature; drop exact FullSignature duplicates in the pass | M0/M2 |
| 4 | **Cooldown / per-request filters** | Drop candidates whose **BaseKey** is in the dislike cooldown buffer; apply regen locks/contextual dislikes (§14, R9) | M3 |
| 5 | **Scoring** | `base + behavioral edge signal − dislikePenalty` (§14); humble v1 = additive (R2), evolves to edge/learned scorer (§11) | M3 |
| 6 | **Ranking & diversity** | BaseKey variant cap → overuse penalty → repetition-window (FullSignature) → fallback ladder if < K → sort by score → tie-break | M3 |
| 7 | **Response + StyleMove** | Outfits[] + backend-assigned `optionPath`/`risk` + StyleMove + scoreBreakdown; blocking GenerationSnapshot write before returning a bindable response | Spearhead labels · M5 snapshot |

Regen controls (locks + contextual dislikes) are per-request **Step 4** filters with a one-shot constrained
re-entry of Steps 1–3 on starvation (§14, R9).

Step 2's generation *call* and Step 7's path/risk *labelling* landed at the Spearhead milestone
(`docs/plans/spearhead.md`, ✅ done — §20); M2 fixed only the generation *contract* (the validation
boundary), and M5 adds Step 7's blocking snapshot write plus the service deploy (no candidate cache — D2).

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
risk scoring ranks and buckets the surviving drafts. No trained model, no feedback required. Spearhead
emits `baseKey`/`fullSignature` so M4 can bind the later wear/like to the exact outfit; once M4 lands, that
feedback forms behavioral edges and the item de-orphans. *That growth is the visible payoff.*

**Detecting orphans at cold start (H21):** with no behavioral edges yet, "items you never wear" cannot be
edge-defined. The `[NOW]` rescue entry surfaces candidates from signals the deployed schema already has:
zero interactions **and** null/old `lastWornAt`, optionally `isFavorite` (liked-but-unworn = the sharpest
orphan), or an explicit "rarely wear this" mark during onboarding. The exact blend is a detection-tuning
detail (deferred with orphan auto-detection, H21 — the Spearhead vertical takes the forced item as
given); the signal set is fixed here so rescue is never blocked on the graph already existing.

**Graph roles (UI labels, derived):** `anchor` = high compatibility + high behavioralStrength (trusted);
`bridge` = one trusted side + one new; `experiment` = compatible but unproven. These map to the user-facing
option paths `reliable / bridge / stretch`, which the **backend response layer assigns** (post-rank, not the closed ranker) from a graph/path score.
`risk` (`safe / noticeable / bold`) is assigned separately from social-visibility features. At cold start,
before behavioral edges exist, option path ≈ compatibility/commonness/trusted-anchor availability, while
risk ≈ visibility/boldness of the styling move. The exact cold-start metric shape is fixed in the rescue spec (`docs/plans/spearhead.md` §G); numeric thresholds are tuned there (H20).
**GPT never assigns the path or risk** (§5: GPT does not rank).

**The humble-first behavioral mechanism** `[NEXT]`: the v1.2 additive scorer **is** the first
`behavioralStrength` implementation — `itemBoost (+0.1 × affinityScore, capped at 20)` ≈ node affinity,
`comboBoost (+2.0 on a re-liked FullSignature)` ≈ a full-outfit edge. It ships as the behavioral layer and
evolves into explicit lens-scoped pairwise edges. *(Demotion of R2, not deletion.)* Known risk carried
forward: at the affinity cap a 4-item itemBoost (~+8) can dwarf comboBoost (+2) — **measured in offline
eval, not tuned blind** (levers: lower cap, sublinear affinity, per-item averaging).

**The trained scorer — the dive** `[STAGED]`: learn to rank completions / predict edge strength from
(content features + behavioral history + lens), trained on GenerationSnapshots + feedback. By **shape** it lands
at two distinct seams (§23-H28): the **content-compatibility** prior on the **additive pairwise/outfit-level
`rank()` hook** (the non-transitive, type-conditioned edge scorer an item-level scalar cannot represent), and the
**behavioral/personalization** signal on the item-level `SignalScorer` protocol (§5/§10), `is_available()` true
once loaded.
Offline eval: NDCG@k / hit@k on accepted outfits, profile- and routine-conditioned (§21). **Eligibility
gate (before the dive):** the **behavioral/personalization** signal only changes sampler behavior when a request
has both ≥5 interactions *and* ≥1 type over cap; if prevalence is low, give the model a second surface (candidate
ordering or ranker scoring). **The universal *content*-compatibility prior (§23-H26/H28) is exempt from the
≥5-interaction gate** — it is cold-start-available by design (its purpose is to work at zero interactions), so it
lands on the ungated ranker/content-scoring surface, *not* the interaction-gated sampler signal slot.
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
  membership. In the Spearhead/rescue layer, after the generic sampled pool is built, the pool is scoped
  around the forced item before prompting/validation; the prompt instructs every outfit to include it;
  rescue/lock machinery rejects any candidate missing it
  (§14/R9). **The
  forced item's `clothingType` determines the valid template(s) (H22):** base_top or
  base_bottom → two_piece (the engine must find a complementary base of the other kind); dress → one_piece;
  outer or shoes → *either* template (an optional role layered onto any valid base). **Rescue-insufficient
  case:** if no complementary base can build a valid outfit around the forced item (e.g. the orphan is the
  user's only top and there are no bottoms), return `notEnoughItems` scoped to the rescue (a sharper §10
  zero-case) — never silently drop the forced item. GPT still returns unranked candidate drafts only; the
  backend **response layer** (post-rank) buckets survivors into the three user-facing paths: reliable / bridge / stretch.
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
- **Regen controls** (R9): `dislikedItemIds` and `lockedItemIds` are per-request **regen controls**.
  **M5 regenerate = one constrained fresh generation** (no candidate cache, no re-rank — `m5-cutover.md`
  §C / D2, which owns the full lineage/idempotency mechanism): locks are enforced by orchestration-scoped
  pools plus validation/filtering outside the closed sampler (dislikes excluded). M5 owns the
  exact lock-scoping shape; invariant: no M0–M3 module reopens. Failure = partial + explicit notice, never
  a silently dropped lock. **Dropped from the legacy
  regen contract:** `changeTarget` and `feedbackNotes` (the deployed `regenerate/route.ts:298-299` destructures them;
  locks express the intent, notes persist via the feedback flow). The legacy `regenerate/route.ts` is
  deleted at cutover (§19).

## 15. Response + the GenerationSnapshot write (no runtime cache — D2) `[NEXT]` snapshot

- **Response**: `outfits[]` (each with items, backend-assigned `optionPath`/`risk`, StyleMove,
  scoreBreakdown), plus `insufficientWardrobe` if triggered. Pre-M5/legacy feedback may still carry
  server-computed `baseKey`/`fullSignature`, but the M5 snapshot-bound feedback identity is
  `{snapshotId,candidateId}` **only**; the server re-reads keys/content from the snapshot and never trusts
  client-echoed keys.
- **Seed** (R1 trap-guard): one **private** `_canonical_seed` primitive + two wrappers (`session_seed` /
  `tiebreak_seed`) so the two seeds cannot drift. **Length-prefix each field by UTF-8 byte count**
  (`f"{len(s.encode('utf-8'))}:{s}"`) before joining, sha256, first 8 bytes → int. A bare `"\x1f"` join
  collides (`join(["a","b\x1fc"]) == join(["a\x1fb","c"])`) and occasion is free text. `date=None` uses a
  typed sentinel (`-:`), distinct from `"None"`/`""`/absence. Never Python's process-salted `hash()`.
- **No runtime candidate cache** (R1 retired at M5 — plan D2, 2026-07-06): every render, including a
  re-roll, is one constrained fresh generation with its own `generator` + `generationAttempts[]` and an
  immutable `GenerationSnapshot`. The durable `candidateCacheKey` field remains, but its M5 meaning is a
  **Lens-chain grouping key**, not a cache lookup key: it is the sha256 frame over
  `(sessionId, wardrobeVersion, occasion, weatherBucket, intent, forcedItemId, seedDate)`; it excludes
  `generationIndex`, `controls`, and behavioral rows so re-roll siblings share the same Lens-chain while
  still writing distinct child snapshots. The old two-stage cache / TTL / cache-hit re-rank semantics are
  intentionally absent; a future scale optimization must be newly specified and must not weaken the
  one-snapshot-per-render corpus contract. See §6.7 and §23-H4/H16/H49/H51.
- **The M5 request adapter** owns raw→canonical normalization (R5: weather bucketing, occasion normalization)
  **and** malformed `WardrobeItem` **wire-value validation** (R12 part 2): the `WardrobeItemDocument →
  fitted_core.WardrobeItem` mapping is the wire boundary where untrusted Mongo data enters, validating types,
  non-empty ids/strings, and tag-container shape through one predictable error channel. The dataclass keeps
  only its two narrow guards (`clothingType` enum coercion, `warmth ∈ 0..10`) as a last-resort backstop and is
  **not** the wire boundary — *trap-guard:* it accepts `warmth=True` (a Python bool is an int). **R5 is
  load-bearing for snapshot-write integrity, not just sampler correctness:** `GenerationSnapshot.ts` marks
  `weather` (5-value enum) and `occasion` `required`, so an un-bucketed/empty value throws a Mongoose
  `ValidationError` mid-write — R5 must complete *before* the snapshot is built, and the adapter rejects
  invalid Lens/request fields before any service call or write, never letting Mongoose be the first validator.
  (`RescueRequest.weather/occasion` are plain `str` — the dataclass does not enforce the bucket, by design.)
- **GenerationSnapshot** (training truth, `[NEXT]`): one immutable record per rendered response — request
  inputs + StyleProfileSnapshot + the full candidate funnel + **shown outfit ids/positions** +
  model/prompt/scorer versions + **immutable item feature snapshots**. Feedback binds to the server-issued
  `{snapshotId,candidateId}` pair. The full cross-language contract is **§15.1**; this bullet is a pointer.
- **Snapshot persistence is blocking at M5:** a bindable response is returned only after the snapshot write
  succeeds or an idempotent duplicate winner is re-read. Telemetry/counters may be best-effort; the
  GenerationSnapshot training row is not.

### 15.1 GenerationSnapshot — the contract `[NEXT]`

The canonical cross-language contract for the immutable training-truth record. **Storage** = a TS Mongoose
model `GenerationSnapshot.ts`; **Python** mirrors the producer half as a frozen dataclass
(`GenerationSnapshotPayload`). Field names below are **camelCase** (wire/Mongo); the Python mirror is
snake_case and the service-boundary serializer maps between them (finite floats only — no `NaN`/`Infinity`;
item/candidate ids as opaque strings; `user` as `ObjectId`). **M4 owns this contract; M5 owns the live
write.** The Mongoose proposal, index/query plan, the writer's 10 deliverables, and all rationale live in
`docs/plans/m4-data-model-migration.md` §8 — not restated here.

**One snapshot = one rendered response** (per `generationIndex`, not per candidate-cache pass; re-roll
siblings share a `candidateCacheKey` but are independently complete). It captures the resolved Lens inputs,
the version/provenance of every component that shaped the render, an immutable feature-copy of every
participating wardrobe item, the **full candidate funnel** (generated → validated → ranked → shown) with
continuous scores and dispositions, and the shown set with positions. **Immutable after insert** — feedback
writes `OutfitInteraction` rows that *reference* it, never mutating it; the only post-insert write is the
redaction seam below. `schemaVersion` (=1) is the additive-evolution lever (posture rule 1); readers branch
on it, and moving a field across the provenance boundary requires a bump.

**A snapshot is written for every render where a valid engine payload reached the writer — including
empty-shown and graceful-degradation renders** (e.g. an unparseable-after-repair generation that shows
nothing still writes a snapshot whose `generationAttempts[]` records the failure and whose shown arrays are
empty; the M5 service produces this degenerate-but-provenance-complete payload, D3). The failure/empty
corpus is the negative signal training wants, so it is never skipped when a payload exists. Consequently
`generationAttempts[]`, `candidates[]`, `itemSnapshots[]`, and `shownCandidateIds[]` are **required arrays
that may be empty** — **absent ≠ empty** (an absent array is an invalid snapshot; an empty one is a valid
degenerate render). **Named residual gap (M5 service hop):** when generation ran but the response was lost
in transit (unreachable/timeout — no payload reaches the writer), no snapshot is written and the render
degrades non-bindably (money may have been spent, no row). This is rare, zero-user, and un-bindable;
recorded here as a known gap class rather than fabricating unknowable provenance (D3/§23-H12).

**Field groups** (`?` = nullable/optional):
- **Identity:** `_id` (the snapshotId — **TS-issued, pre-allocated before the browser response**, so each
  shown variant can carry `(snapshotId, candidateId)`), `schemaVersion`, `user` (`ObjectId` ref User),
  `sessionId` (= user id, R8), `candidateCacheKey`, `generationIndex`, `requestId` (**required** — the
  render-idempotency token, H50; UUIDv4/ULID validated + a partial unique index on `{user, requestId}`,
  m5-cutover.md §C.4/§G item 2), `createdAt`.
- **Request context (the Lens, §6.3):** `intent` enum(`rescue_item|outfit_upgrade|daily|translate`),
  `occasion` (verbatim), `weather` enum(`hot|mild|cold|indoor|outdoor`), `weatherRaw?`/`location?`,
  `constraints` (flexible map — additive, H36), `forcedItemId?`/`baseOutfitItemIds?`/`routineId?`, `lens?`,
  `wardrobeVersion` (field only; bump = W-track/H6), `interactionCountAtRequest`, `seedDate` (required
  UTC `YYYY-MM-DD` at M5; H8).
  **`lens.styleProfileSnapshot?`** is the §6.2 embed seam — the immutable compiled profile itself, not just a
  `styleProfileId`/`version` ref (a bare ref re-creates H10 if a board version is later cascaded away);
  typed/`Mixed`, null until B-track.
- **Provenance / versions — required, non-null on every live write** (nullable provenance ⇒ unrecoverable
  provenance; the backstop for the engine-vs-evidence boundary): `fittedCoreVersion`, `generator`
  (`provider`/`model`/`temperature`/`promptVersion`), `rankerConfigVersion` (a hash of the Appendix B
  constants), `scorer` (`kind` enum(`cold_start|trained`)/`modelId?`/`available`).
  - **`scorer.available` semantic (pinned, M5 cutover §E — two scorers are in play, so the referent must be
    explicit):** the `scorer` block is the **outfit/rank-scorer provenance axis** (the §23-H28 seam), and
    `available:true` means **"an `OutfitScorer` occupant was exercised over this render and populated
    `scoreTrace.compatibility/visibility` for every scored candidate"** — explicitly **NOT** "influenced
    rank order". Rank-order influence is readable only from `kind="trained"` (+ the M6 `RankerContext`
    signal); a corpus reader must never infer order influence from `available` alone. M5 writes
    `kind="cold_start"`/`available:true` on healthy renders (the producer exercises the cold-start
    occupant); a degenerate/no-scoring write leaves `available:false`. The **sampler** `SignalScorer`'s
    state (the behavioral `AffinitySignalScorer`) lives in `diagnostics.scorerAvailable` + per-type
    `selectionKind`, never in this block.
  - **`cvModelVersion?` (data-path provenance, nullable).** Once the W-track CV becomes the *writer* of
    `warmth`/`material`/`formality`/`styleTags` — which land in `engineVisible` as trainable features — a
    CV-model change silently shifts those features' meaning, the same drift the engine version-block guards
    against. (At M4 only `warmth` is written, and by a keyword rule, not CV — so the seam is forward-looking.)
    Reserve `cvModelVersion?` on the itemSnapshot (or snapshot provenance), **null at M4**, wired when the
    W-track rebuilds CV. Additive nullable — cheap to reserve now, expensive to retrofit once the corpus exists.
- **Item feature snapshots:** `itemSnapshots[]`, each `{ itemId (string — never a populatable ref, H10),
  engineVisible{…}, evidence{…}, embeddingRef?/visualFeatureRef? (reserved, H25) }`. **The provenance split
  is load-bearing.** `engineVisible` is *exactly* the `fitted_core.WardrobeItem` projection the engine
  conditioned on — `name`, `clothingType`, `warmth`, `styleTags`/`colorTags`/`occasionTags`, `material`,
  `formality`, `imageUrl` — **true by construction** (the same projection M5 sends to the service, stored
  verbatim, no post-call refetch; the camelCase names are the documented snake↔camel mapping of
  `style_tags`/`color_tags`/`occasion_tags` (a key-rename, no value transform), **plus the engine's
  partition key `type`→`clothingType`** — a *name* rename a generic snake→camel converter will NOT produce,
  carrying the `ItemType` member's string value verbatim (member names = wire values, §15.2) — and
  `image_url`→`imageUrl`; the C4 `snapshot_serde` field map must list all of these, not only the three tags). **engineVisible names
  follow the Python projection / snapshot wire contract, not the deployed `WardrobeItem` field names** — the
  deployed→`fitted_core` renames are the M5 request-adapter's job (§15 R12; full per-field mapping in
  **§15.2**): renames `colors`→`colorTags`, `occasions`→`occasionTags`. **`warmth` is a persisted column**
  on `WardrobeItem` post-M4 (§6.1), passed through directly. **`material`/`formality`/`styleTags` have no
  column until the W-track** (§6.1) — the adapter emits `null`/`[]` for them, so `engineVisible` carries the
  field-slots but they are **empty until W-track CV**. A snapshot reader (M6) must treat an empty value as
  *unmeasured*, never as a negative feature, until `cvModelVersion` (below) marks the full-extraction CV.
  `evidence` is deployed-doc fields the engine **never saw**
  (storage-only: `category`, `subCategory`, `pattern`, `seasons`, `isAvailable`, `isFavorite`, `lastWornAt`,
  `brand`, `fit`, `size`, `layerRole`, `tags`, `rawAttributes?` (bounded, storage-only — raw CV/declared blob,
  posture rule 1), `image{imageRef?/imageVersion?/hash?}` — **ref/version/hash only, never the blob**, H29(c),
  guarding H14).
  - **Trainability rule:** a model claiming to model what the recommendation *conditioned on* trains **only**
    from `engineVisible` + the per-candidate score/identity fields; `evidence`/`embeddingRef` are
    new-capacity inputs whose use changes the off-policy assumptions. Moving a field `evidence`→`engineVisible`
    requires a `schemaVersion` bump.
- **Candidate funnel** (H29(b) — rejected + low-ranked must survive): `generationAttempts[]` (root/attempt
  events — invalid JSON, the §12 repair retry, aggregate warnings — captured here, **never forced into fake
  candidates**) and `candidates[]`, one array spanning generated → validated → ranked → shown. Each
  candidate: `candidateId` (**Python-issued**, unique within the snapshot, over the deterministic funnel
  order), `sourceAttemptId`/`sourceIndex?`, `stageReached`/`accepted`/`shown`/`shownPosition?`,
  `dropStage?`/`dropReason?` (**open, append-only code sets** — not hard enums, so a future reason is not a
  write-rejection foreclosure), `rejectionCodes`/`warningCodes`, content
  (`items`/`slotMap`/`template?`/`baseKey?`/`fullSignature?`/`optionPath?`/`risk?`/`styleMove?`),
  `rawEmitted?` (bounded; no blobs), `scoreTrace?`.
  - **Content-preservation invariant (required):** a **generated, non-accepted** candidate MUST carry at
    least one of {`items`+`slotMap`} or `rawEmitted`; a bare `{candidateId, rejectionCodes}` is **invalid**
    (it loses the negative training signal — the validator's `Issue` carries no outfit content, so
    snapshot-building must retain the parsed candidate content beside the issue log). This includes
    over-limit candidates that trigger `extraCandidatesIgnored`: the trace surface must preserve bounded raw
    or normalized content before validator slicing.
- **Scores (H29(a) — continuous, never just the 3-way path/risk buckets; populated for every *scored*
  candidate, including scored-but-unshown):** `scoreTrace{ compatibility?, visibility? ([0,1] cold-start
  content scores — the M6 seam), rankerScore?, scoreBreakdown?{base,combo,item,dislike,overuse,repetition,
  cooldown}, signalScore? (reserved, trained M6) }`. Request-level `diagnostics` carries the per-type sampler
  result, the ranker/rescue/parse flags, and rejection/warning histograms. **`diagnostics.ranker` also carries
  (M5 cutover §E/§H) `reducerConfigVersion` + the reduced `RankerContext` signal collections that fed the
  ranker — `itemAffinity` (data-keyed map), `likedFullSignatures`, `shownFullSignatures`,
  `recentDislikedBaseKeys`, `recentDislikedItemIds`, `contextualDislikedItemIds` — so every stored score is
  recomputable from the row alone (exact off-policy context for M6, no reducer re-runs across
  reducer-version/window drift), each carrying its reducer provenance.** **Reading-rule trap-guard
  (pre-flight 2026-07-06):** the ranker's `fallbackStage`/`insufficientWardrobe` measure **fill-to-`k`**
  (the ladder is exhausted whenever the pool < `k=DEFAULT_K`, deliberately > `n_surfaced` so
  `select_spread` has a pool — `ranker.py` `_select_fallback_pool`), **not render health** — a healthy
  3-outfit render on a small closet still logs `fallbackStage="insufficient"`. On live closets this will
  be near-constant, so an M6 reader / the §21 fallback-distribution metric must key render health on
  `nSurfaced`/`spreadCollapsed`/`insufficient_after_generation`, never on `fallbackStage` alone; the M5
  `/spec` may alternatively add a distinct render-health flag at write time.
- **Shown history (H19 storage home):** denormalized `shownCandidateIds`/`shownFullSignatures`, `nSurfaced`,
  `spreadCollapsed` — so the repetition-window query reads recent snapshots without unwinding `candidates[]`.
  `shownBaseKeys` is intentionally **not** stored (no `[NOW]` consumer; shown base keys derive from
  `shownCandidateIds` + `candidates[].baseKey`). The snapshot is the raw source; the **M5 reducer** owns the
  window/cap:
  - **Repetition-window reducer (H19 contract; M5 implements).** Deterministic — read the user's most-recent
    `REPETITION_WINDOW_SNAPSHOTS` snapshots **with `nSurfaced > 0`** (empty/failed renders never consume the
    window) by `{user, createdAt, _id}` (most-recent-first; the `_id` tie-break makes same-millisecond
    `createdAt` ties deterministic), under a bounded scan cap, walk their `shownFullSignatures`
    most-recent-first, dedup keeping the first occurrence, truncate to
    `REPETITION_WINDOW_SIZE`. Output is an **ordered `Sequence[str]`** (recency-faithful; the M3 ranker
    normalizes it to a `tuple` — `ranker.py:191`/`:247`), **not** a set. Both constants are in Appendix B —
    `REPETITION_WINDOW_SIZE` is the shipped M3 sig cap (unchanged); `REPETITION_WINDOW_SNAPSHOTS` is the new
    snapshot-read window. The count-based window adapts to usage intensity and is index-bounded; M3 is not
    reopened (plan §9.3/§9.7).
- **Redaction seam (H43):** `redacted` (default false)/`redactedAt?`/`redactionReason?` — the sanctioned
  post-insert mutation for **non-erasure** removal (corpus hygiene, bad batches). **Account deletion is
  erasure, not redaction (Track 2 policy):** the `User` cascade hard-deletes the user's snapshots (the
  single native-driver exception to the delete guard — `User.ts cascadeDeleteUserData`), the account route
  redacts first as a two-phase fail-safe, and the M5 writer re-checks user existence post-persist so an
  in-flight render cannot orphan a row. *Trap-guard:* mark-only retention was rejected for Track 2 because
  redacted rows are already training-excluded, their interaction labels are cascade-deleted anyway, and the
  retained content (item names, occasion text, raw generation text) is not de-identifiable in a small
  cohort — do not reintroduce "redact instead of delete" on the delete path. The PII-null scrub (null
  `occasion`/`location`/`weatherRaw`/raw text, preserve keys/scores/`itemSnapshots`) stays `[STAGED]` as
  the tool for a future **consent-based retention** option, never for the word "delete".

**Identity binding.** On feedback the client echoes `{snapshotId, candidateId}` **only**; the server
**re-reads** the candidate from the snapshot and **never trusts echoed content** — the canonical outfit
`items[]` and keys are **server-set** from the re-read candidate. The authenticity gate (§16) verifies:
snapshot exists ∧ `user` matches caller ∧ `candidateId ∈ shownCandidateIds` (membership) ∧ any optional
client-submitted `perItemFeedback.itemId` ⊆ the candidate's items (per-item feedback targets are the only
client ids and are subset-validated; the outfit composition itself is never echoed).

**Full-funnel capture obligation (writer contract).** The substrate discards funnel signal at three sites —
`rescue()` (rejected pool + attempt trace), `rank()` (scored-but-unshown breakdowns), `build_variants()`
(non-selected variants' content scores). All three must reach the snapshot via **additive, read-only trace
siblings** (`*_with_trace`/`*_with_audit`) that leave the closed `rank()`/`build_variants()`/`rescue()`
public contracts unchanged; the mechanism, decomposition, and tests are owned by M5/S9 (plan §8.4/§8.11).

This is the **minimum durable record set — NOT full event sourcing** (audit rows + snapshots; normal Mongo
projections for current state). It resolves the exposure-bias and feature-skew gaps before any model
trains (§21).

### 15.2 Deployed → `fitted_core` request-adapter mapping (R12) `[NEXT]`

The M5 request adapter maps each deployed `WardrobeItemDocument` (`fitted/models/WardrobeItem.ts`) to a
`fitted_core.WardrobeItem` (`ml-system/fitted_core/models.py`) — the `engineVisible` projection of §15.1.
The adapter is pure renames + pass-throughs, **no read-time derivation** (the warmth derivation moved to the
M4 ingestion write — §6.1). The three deferred fields (`material`/`formality`/`styleTags`) have no column
until the W-track, so the adapter **emits `null`/`[]`** for them — the engine tolerates this (all three are
optional in `models.py`). Raw deployed inputs are preserved verbatim in the snapshot's `evidence{}` (§15.1).

| `fitted_core.WardrobeItem` | deployed source | transform |
|---|---|---|
| `id` | `_id` | `ObjectId` → string |
| `name` | `name` | direct |
| `type` (`ItemType`) | `clothingType` (M4 5-value, written natively) | 1:1 enum pass-through (member names = wire values, `models.py`) |
| `warmth` (int 0–10, **required**) | `warmth` (M4 column; keyword-derived at ingestion) | direct |
| `color_tags` | `colors` | rename |
| `occasion_tags` | `occasions` | rename |
| `style_tags` | — (no column until W-track) | emit `[]` |
| `material` (Optional) | — (no column until W-track) | emit `null` |
| `formality` (Optional) | — (no column until W-track) | emit `null` |
| `image_url` | `imageUrl` | else resolve `imagePath` → `WardrobeImage`; else `""` |

**Wire-validation (R12 part 2)** splits faults by scope (the A-cluster resilience rule). An **envelope**
fault — wardrobe over the request cap, a bad Lens, a control-id array over cap — is rejected through the one
predictable error channel (`contract_invalid`). A per-**item** fault — a non-integer/out-of-range `warmth`
(the service requires int 0..10), a `clothingType` outside the 5-value set, a scalar tag container, a
missing id / blank name — **DROPS that one row, never sinks the render**: one corrupt garment must not cost
the user their whole closet (the render is well-defined without it, and the engine reports `notEnoughItems`
itself if too few survive). Values are **never coerced** (clamping warmth or guessing a clothingType would
fabricate signal the immutable M6 corpus trains on — sanitize removes noise, it does not invent it). A
dropped row that a control explicitly references (`forcedItemId` / locked / disliked) **escalates back to a
hard reject** (the user pointed at that item, and the service rejects a control id absent from the wire
wardrobe). Drops are latent on a clean M4 DB (warmth is keyword-derived at ingestion) but load-bearing for
the messy CV-derived / legacy / hand-edited rows the W-track ingests. When the W-track adds
`material`/`formality`/`styleTags` columns + CV, the three `— ` rows above become direct pass-throughs and
each new per-item column follows the same **drop-not-sink** rule (additive; no adapter redesign).

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
- **Proxy boundary (M5):** `accepted`/`rejected` are explicit preference/proxy signals, not proof of real-world
  wear. The M5 reducers may use `accepted` as the first positive behavioral signal because it is the only
  shipped teaching surface, but future `saved`/`worn`/`rated` surfaces must remain distinguishable labels in
  the corpus and must not reinterpret historical `accepted` rows as wear outcomes.
- **Feedback reasons** (separate from events): `good/neutral/bad`, `too_boring`, `too_much`,
  `not_practical`, `not_me`, `wrong_context`, `weather_forced`, `necessity`, `too_repetitive`.
  `not_practical` is first-class. These structured reasons are the sole trainable "why" channel for
  feedback; free-form explanation blurbs are not training labels by default — but raw/corrected user rationale is **persisted with provenance** (user explanations are high-trust) and may be compiled into reasons **only after deliberate review** (§23-H34).
- **Scoped memory** `[NEXT]`/`[STAGED]`: a feedback event records two additive fields (M4 reserves the
  fields, S6/H37; behavior `[STAGED]`) — **`scopeTarget`** ∈ `outfit` / `board` / `routine` / `global` /
  `lens` (where the feedback attaches) and **`learningDisposition`** ∈ `normal` / `exception` / `do_not_learn`
  (how it is treated). Splitting the two axes is deliberate: a weather-forced dislike is `scopeTarget=outfit`
  **and** `learningDisposition=exception` — a single merged enum could not represent both. A dislike under a
  "minimal workwear" board is not a global dislike. **Default scope in the `[NOW]` implicit lens (no
  board/routine active, H24):** a path/look reaction is `outfit`-scoped; an item dislike ("not me") attaches
  to the implicit/default `lens` scope and is promoted to `global` only on **repeated support/confirmation**.
  **S6 hardens the promotion *rule*** — support-gated and monotonic: promotion requires `supportCount` over a
  threshold, **one tap never yanks the global profile** (anti-capture §3, posture rule 2); the **numeric**
  threshold is `[NEXT]`, set when scoped memory is implemented. `board`/`routine` scopes activate with B-track.
  Hierarchy for sparse data (C2): global prior → profile memory if enough support → routine memory only with
  explicit/high support → content/board similarity fallback. Every scoped score carries a `supportCount`;
  low-support memory never outranks basic quality. Corrections — "right outfit, wrong board/routine" —
  **move** an edge's scope (`scopeTarget`) rather than delete it.
- **Anomaly scoping** `[STAGED]`: weather-forced / laundry / travel / illness set
  `learningDisposition=exception` by default (a **soft exception** — do not rewrite a board); suppressible and
  promotable. `do not learn from this` sets `learningDisposition=do_not_learn`, an early control. The **field**
  is reserved now (S6/H37); the quarantine/promote **behavior** is `[STAGED]`.
- **Duplicate-feedback dedup (H11 forward write-path rule; M5 implements the projection)** — feedback rows
  are **append-only** (every tap persisted with `createdAt`, full lineage, posture rule 3); the write path
  never rejects or upserts duplicates. Affinity is a **compute-live projection** (no stored counter — OQ2),
  so concurrent feedback is two independent inserts with **no read-modify-write to race**. Dedup is a
  **read-time reducer** concern, applied where it matters: the set/recency projections
  (`liked_full_signatures`, the cooldown buffer) are **idempotent under duplication** and need none; the
  **counted** projection (`item_affinity`) resolves to **per-candidate latest-STATE** (§23-H61): rows are
  read most-recent-first (`{createdAt:-1, _id:-1}`) and, for each `{snapshotId, candidateId}`, only the
  **latest** action contributes — a repeated like of one candidate counts **once**, and a like later
  corrected to a dislike **nets to the dislike**; ordering alone does the work (the old 300s
  `FEEDBACK_DEDUP_WINDOW` double-tap window is **retired** — do not reintroduce it). M4 fixed the
  rule/key/read-time locus; M5 landed the latest-state reducer (`ml-system/fitted_core/reducers.py`). Distinct from the (trivial,
  no-live-data) backfill idempotency. Rationale: plan §11.1.
- **Feedback-authenticity gate (must precede training)** — confirmed real: `POST /api/interactions`
  (`interactions/route.ts:106-230`) authenticates the caller but persists client-supplied `items` and
  `perItemFeedback.itemId` with **no existence/ownership/outfit-membership check** (`:157-163`). Tolerable
  while feedback only feeds a user's own summary; **a dataset-poisoning vector once these rows become
  training labels.** Gate: bind feedback to `{snapshotId,candidateId}`; **server-set** the outfit `items[]`
  and keys from the re-read candidate (never the echo), and validate that any client-submitted
  `perItemFeedback.itemId` is ⊆ the candidate's items, before persistence. **Implementation (OQ4, scope-trimmed
  2026-06-26):** M4 adds the **binding fields** (`{snapshotId,candidateId}` + server-re-read
  `baseKey`/`fullSignature`) to the interaction row and defines this full contract; **the gate *functions*
  themselves (existence + ownership + content-key binding + the live `{snapshotId,candidateId}` echo wiring +
  the "actually-shown" membership check, `candidateId ∈ shownCandidateIds`) are all implemented at M5**, where
  the live `interactions/route.ts` route makes them testable for real (building fixture-only halves at M4 just
  produces stubs M5 rewrites). See plan §14 (C7 deferral) + §9.5/OQ4.
- **History curation (Track 2, D-1 — Fable-reviewed)** — the friend-facing surface for fixing feedback (the
  "little bro tapped 5 reactions" case) is two verbs, and neither breaks the append-only posture: **flip** a
  like↔dislike is an *appended opposite action* (a POST — never an in-place edit; §23-H61 latest-state makes
  the newest win), and **remove** is a **sanctioned hard-delete** of EVERY row for one `{snapshotId,
  candidateId}` binding via the native-driver door (`interactions.ts` `deleteInteraction`, user-scoped;
  cross-user → 404). Because affinity is a compute-live projection (no stored counter), a delete is consistent
  by construction — the reducer + M6 export simply stop seeing the rows, reverting that candidate to
  shown-but-unrated (`label=null`). **Snapshots are never touched** (immutable training truth, H10/H29);
  deleting a `rejected` correctly *un-blocks* that candidate's `fullSignature` **and drops its `baseKey` from
  the disliked-cooldown buffer** (both are interaction-derived and recompute from the log — the aversion is
  forgotten, as intended) but does NOT un-surface a repeated outfit: the **repetition window** (recently-shown
  `fullSignatures`) is the snapshot-driven suppression, and it is untouched by a feedback delete. The
  History curation VIEW reads the same per-candidate latest-state (`lib/latestFeedbackState.ts`), pinned equal
  to the reducer + export by one shared fixture. Detail: `docs/plans/friend-facing-fixes.md` PHASE 1.

## 17. Boards & routines lifecycle `[NEXT]` text · `[STAGED]` dormancy · `[NORTH-STAR]` calendar

- **Text boards first** `[NEXT]` (B-track): a board from style words / phrases compiles to the typed StyleProfile (§6.2).
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

**Standing ingestion posture (the yield-vs-integrity rule — canonical home; folded from the retired
honesty-pass + Track-2 friend-ready sessions).** The ingestion surface must serve *usable* data without
coercing it:
- **Required fields = `{name, category}` only** (REQFIELDS-1, `lib/wardrobeValidation.ts`). The engine
  derives a valid `clothingType` from `category` alone and the server accepts items with no `subCategory`
  and no `colors`; `subCategory` + `colors` stay VISIBLE and encouraged (they enrich the stylist prompt)
  but are **not gated**. **Trap-guard: do NOT re-tighten this.** Requiring what the engine doesn't need is
  both a yield tax (an abandoned closet is total loss; a sparse one still yields photos + labels) and a
  small dishonesty. If sparse closets depress like-rate into undecidability, the fix is asking that friend
  to backfill via the edit path — never re-adding required fields.
- **Photo = strong nudge, never a hard block** (D1): the photo is the hero step with an honest
  "won't count toward the experiment" escape hatch. A hard block breeds fake-satisfied data (floor photos /
  abandonment) — the anti-capture failure the ambition forbids.
- **Nudge, honest label, and out-of-band ask — never progress mechanics.** No completion meters, streaks,
  or guilt copy (the anti-capture line). Convenience differentials on the honest-defaults path (e.g.
  "Save & add another" appearing only on the photo-first footer) are the sanctioned nudge shape.

**Scope split — M4 vs the rest of the W-track.** M4 pulled forward only what the engine strictly needs: the
5-value `clothingType` (the deployed coerce-to-top/bottom actively corrupts dresses/outer/shoes) and the
**`warmth` column** (`fitted_core` requires warmth non-null), keyword-derived at ingestion. **Everything
else stays in this W-track**, shipped as coherent units rather than column-now / CV-later / review-later
across three milestones:
- **The `material` / `formality` / `styleTags` columns** + the VLM CV that fills them + the review form that
  corrects them. The engine treats all three as optional and today's CV produces none, so M4 deferred them
  here (the snapshot `engineVisible` contract reserves the field-slots; the adapter emits `null`/`[]` until
  these land — §15.2/§6.1). The VLM CV stamps `cvModelVersion` (§15.1) when it starts writing them.
- **Async job queue, item-state machine, the dedicated review surface, VLM/embedding extraction** — the
  full ingestion subsystem below.

**Target subsystem (downstream of M4):**
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
- **Dedicated review surface** = CV-correction form = manual-entry form: chips/suggestions, **named colors
  not hex codes**, review only low-confidence fields. (M4 ships the data-path defaults in the existing
  upload form; the dedicated review surface lands here.)
- **Taxonomy legibility (H52 rung-2).** Today the UI speaks `category`/`subCategory` (the display/CV
  vocabulary — "what is it called") while the engine partitions on the derived, invisible, uncorrectable
  `clothingType` (the outfit-slot vocabulary — "what slot does it fill"). Keeping both is correct (two
  questions, two fields); the debt is that the engine's field has **no visible bridge**. This W-track owns
  it: **surface `clothingType` and let the owner correct it** in the review surface (the disambiguating
  knob `layerRole` is already consumed by `deriveClothingType`; only the edit UI is unbuilt). **Then, and
  only then, revisit whether the wardrobe UI filter key should migrate `category`→`clothingType`** — doing
  that migration *before* correction exists is strictly worse (it makes a wrong derivation silently
  authoritative, hiding a mis-derived item from every filter with no recourse). Decide the filter-key
  migration here, not before.
- **Extractor** `[STAGED]`: leading option is **VLM structured extraction** (JSON-schema output of the §6.1
  attribute set + per-field confidence + an image **embedding** for similarity/cold-start; same
  backend-validates-structure philosophy as the GPT pipeline). Fallback: rehost a CV model on the service
  box. **User correction always overrides model output; the sampler consumes only reviewed/active canonical
  fields**, never raw model guesses. *(This gate governs **human-reviewable** fields; machine-learned
  features such as the per-item **embedding** are a separate class the scorer may consume directly — they
  are not human-correctable, so review does not apply to them, §23-H25.)*

## 19. Host integration & what we delete

**Host, not frame (R7).** The old app is a host. Nothing in the new engine bends to old behavior; the
recommendation **vertical is replaced wholesale**, written clean against this spec, behind a
`USE_ML_SHORTLISTER` feature flag with graceful fallback. The working app is preserved at every step.

**Persists as host infrastructure (keep):** Firebase auth, wardrobe CRUD (`wardrobe/route.ts`,
`wardrobe/[id]`, `wardrobe/[id]/image`, `wardrobe/clear`), Mongo plumbing (`lib/mongodb`, `lib/db`),
profile/account UI (`account/page.tsx`), wardrobe UI, the image store (`WardrobeImage`, `lib/imageStorage`,
`images/[imageId]`), sign-in/up + landing + `AuthGate`/`Sidebar`; **`lib/weather.ts`** (retained as a v2 engine helper — `lib/mlRecommend.ts`
re-derives the bucketed Lens field via `getWeatherContext`, R5). The CV ingestion surface (`cv/infer`,
`cv/status`, `lib/cvToWardrobeForm`, the add-item upload UI) is kept but revamped by the W-track (§18).

**Deleted in M4 (✅ complete; deletion license, no real users to protect — surfaces below are greppable by name, the deleted code's old line numbers are gone):**
| File / surface | Why it dies |
|---|---|
| `app/api/preferences/summarize/route.ts` | legacy taste-summary route; v2 uses structured feedback reasons, not generated preference prose |
| `lib/runPersonalizationSummary.ts` | legacy personalization-summary helper; no slot in the §12 prompt; §22-class non-goal |
| `models/PreferenceSummary.ts` | legacy generated-preference artifact; no v2 reader |
| `/account` PreferenceSummary UI section + the `account/page.tsx` read | last consumer of the dropped collection |
| `recommend/route.ts` + `regenerate/route.ts` PreferenceSummary calls (`getOrRefreshPreferenceSummary`) | surgical excision; the legacy LLM flow is otherwise preserved until M5 cutover |
| the create-coerce in `wardrobe/route.ts` + the edit-coerce in `wardrobe/[id]/route.ts` + the `"top" \| "bottom"` typing in `wardrobe/page.tsx` + the GET response type in `wardrobe/route.ts` | replaced by the 5-value `clothingType` written natively (§6.1) |

**Deleted at the M5 cutover (✅ executed — C8 half-1, commit `754135a8`, 2026-07-08):**
| File / surface | Why it dies |
|---|---|
| `app/api/recommend/route.ts` | rewritten against this spec |
| `app/api/recommend/regenerate/route.ts` | folded into one route (R9); near-duplicate of `route.ts` |
| The request-time `clothingType` string-grep paths (`route.ts:231`/`inferItemType` `:472`, regenerate `:225`/`:484`) | replaced by the first-class `clothingType` enum (§6.1) |
| The footwear auto-injection hack (`route.ts:512-527`) | sampler/validator handle shoes honestly |
| `dashboard/page.tsx` recommendation UI + `history/page.tsx` | rewritten to the §6.5 response + StyleMove |
| legacy external-LLM adapter files used only by the legacy recommend flow | no v2 consumer after cutover |

`OutfitInteraction.ts` is **kept and extended** (§6.6) — it is the training-signal source.

**Database wipe (M4, executed).** With no real users on this fork, M4 dropped `wardrobeitems`,
`outfitinteractions`, and `preferencesummaries` cleanly rather than backfilling; the §6.1 ingestion rule
covers all future rows and the co-presence guard runs strict from row 0 (folded-out backfill classifier +
rationale: `docs/plans/m4-data-model-migration.md`). Brian re-uploads his test wardrobe through the rebuilt
ingestion (§18); the bolted-on dresses string-match cruft has nothing to migrate.

**Sequencing (executed):** the legacy vertical was the flag-off arm through C7, deleted wholesale at C8
half-1; flag-off now yields the §A degraded empty state, never legacy.

**Trust-boundary gates — CLOSED (M5 C6/C7 + Track 2 audit lanes).** Identity comes only from the verified
Firebase token on every retained DB route (`account`, `auth/sync`); `images/[imageId]` enforces ownership via
the Firebase session cookie (with `nosniff`); `cv/infer` has auth + a per-user rate limit + a 10 MiB size cap;
the `interactions` route enforces the §16 ownership/membership gates plus the post-persist erasure-race check
(§23-H43). Per-account storage is bounded (field/array caps at ingestion, a per-user item ceiling, a per-user
image byte budget, courtesy rate limits) and renders are paced per-user ahead of the service's global bucket.
**Surviving residual (W-track):** `wardrobe/[id]/image` has the `Content-Length` precheck, the storage-layer
5MB cap, and the per-user byte budget, but an absent/lying header still reaches `request.formData()` — true
request-size/streaming enforcement lands with the W-track upload rebuild (ties H14's image-replace ordering).

**Client-side state gates — CLOSED (M5 C6 + Track 2 Lane A).** Dashboard state is uid-namespaced and cleared
on sign-out (`fitted_dashboard_v2:${uid}`); redirect-before-sync awaits the idempotent `/api/auth/sync` before
entering the app; a failed wardrobe save keeps the modal open with input intact; a degraded/empty re-roll
preserves the on-screen outfits. Remaining minor residuals are ledgered in `docs/plans/track2-audit-campaign.md`.

---

# PART V — BUILD & OPERATIONS

## 20. Build ladder (milestones)

The substrate (`ml-system/fitted_core/`, Python, pytest, no DB/keys) has M0–M3, the Spearhead rescue vertical, M4 (data path + dormant snapshot substrate), the H26 spike, and M5 (the live cutover, C1–C8; cloud deploy LIVE 2026-07-16 — `docs/plans/m5-c8-half2-runbook.md` §8) complete. Per-row status below.

| Stage | Scope | Status / rung |
|---|---|---|
| **M0** | Contracts & pure functions: keys, SlotMap, seed, config, models | ✅ done |
| **M1** | Sampler: partition, caps, 70/30, the SignalScorer seam (`ColdStartSignalScorer`) | ✅ done (M1-1..M1-5 — partition/caps/70-30 seam/candidate scaling/`build_candidate_pool` entry point per §10/§11; pytest green; the item-level signal seam's behavioral occupant (`AffinitySignalScorer`, `m5-cutover.md` §B) activates at **M5**, the *trained* scorer at M6) |
| **M2** | SlotMap validation as a pipeline stage + strict GPT-JSON validation | ✅ done (C1–C6 — parse, strict §12 schema, SlotMap/pool validation, keys + exact-FullSignature dedup, StyleMove, candidate bounds; pytest green) |
| **M3** | Ranker: cooldown, scoring (additive humble layer), variant cap, overuse, repetition, fallback, regen controls (over M2's already-deduped accepted candidates — M3 never re-dedups) | ✅ done (C1–C6; §12 mutation-hardened; pytest green) |
| **Spearhead** | **Orphan-item rescue end-to-end**: forced item, lens context, Python-assigned reliable/bridge/stretch variants, StyleMove, and `baseKey`/`fullSignature` emitted for later feedback binding. The snapshot-bound scoped-feedback tail is `[NEXT]`/M4. | ✅ done (C1–C6; three new modules `generation`/`rescue`/`response` over the closed M0–M3 substrate + the `Generator` seam + the C6 `evaluation`/`cli` eval surface; pytest green; C6/H40 live-eval recorded in `docs/plans/spearhead.md` §E) |
| **M4a** (data path — ships partly live) | DB wipe (§19); 5-value `clothingType` (enum widening + native ingestion writes on create+edit, no backfill); the **`warmth` column** (keyword-derived at ingestion — the one engine-required new column; `material`/`formality`/`styleTags` deferred to the W-track, §18); rebuilt wardrobe POST + edit handlers; `wardrobeVersion` field; action-enum + scope-vocab + binding fields on `OutfitInteraction`; **PreferenceSummary ripped wholesale** (collection + summarize endpoint + /account UI + dashboard fetch + recommend/regenerate calls + `db.ts`/`gemini.ts` deps). Verify by re-uploading a test wardrobe. Plan §14 (C1–C3). | ✅ done (C1–C3) |
| **M4b** (snapshot substrate — dormant) | `fitted_core` version constants + serializer; **GenerationSnapshot model/storage/indexes + writer contract** (§15.1, incl. the reserved H43 redaction fields + the `cvModelVersion` seam); Python snapshot payload + Option-B trace wrappers; **`wardrobeimages` cascade-delete** (closes the H14 cascade arm); affinity projection posture (no authoritative `ItemAffinity`). At M4b the snapshot deletion/redaction behavior was deferred (dormant, no users) and the live authenticity gate to M5 (only the §16 contract + the schema seam are M4); the deletion path was later resolved at Track 2 as **erasure** (§23-H43), leaving only the optional PII-null scrub for the Privacy milestone. Ships nothing runnable; value lands at M5. Plan §14 (C4–C8). | ✅ done (C4–C8; ships dormant; M4b-boundary heavy-audited; M5-handoff in plan §14.5) |
| **M5** | Deploy `fitted_core` (Fly.io, always-on, Docker); Next→service `fetch()` behind `USE_ML_SHORTLISTER`; health check + timeout + graceful fallback; request adapter (**§15.2 item projection** = renames/pass-throughs/no read-time derivation; **M5 §F Lens adapter** = request normalization such as weather bucketing, blank-occasion rejection, UTC `seedDate`, and deferred-constraints rejection); trust-boundary gates; **the live GenerationSnapshot write + `{snapshotId,candidateId}` shown-candidate binding / outfit-membership check**; the read-time latest-state reducer (§23-H61; the 300s `FEEDBACK_DEDUP_WINDOW` was retired — ordering does the work); rewrite of recommend/regenerate routes against this spec (regenerate = constrained fresh generation, no cache — D2); delete the M5-cutover arm in §19. **Entry prereqs (definition-of-ready):** H7 `generationIndex` lifecycle defined · H8 `seedDate` timezone fixed (UTC). H13 cross-runtime conformance is a **C8 pre-flip gate** (green before the flag flips), not an entry gate (`m5-cutover.md` §J). **Cross-milestone note:** `wardrobeVersion` (H6, W-track) stays inert (constant 0) at M5; render freshness rides fresh generation + the per-request cooldown/repetition signals, not a cache. | ✅ done (C1–C8 2026-07-08; cloud deploy LIVE 2026-07-16 — `m5-cutover.md` + runbook §8) |
| **W-track (downstream of M4)** | Async CV queue + item states + dedicated review surface + VLM extraction/embeddings (§18). The **data-path persistence layer is M4**; this row covers the remaining async/queue/review surface. | `[NEXT]`/`[STAGED]` |
| **B-track** | Text boards → StyleProfile compiler; then visual boards | `[NEXT]` text / `[STAGED]` visual |
| **H26 compatibility spike** (pre-dive, offline) | Offline **public-corpus** content-compatibility baseline (Polyvore *disjoint* split; AUC@category-aware-negatives + FITB@4 over a frozen **Marqo-FashionSigLIP** image-embedding space; baseline ladder incl. **`gpt-5.4-mini`-as-judge** (FITB-based parity) + its $/latency) — the **zero-user demonstrable ML result** and the **go/no-go** on the trained scorer; **settles the H28 seam shape** (pairwise/edge, not item-level — settled by an in-spike item-level-vs-pairwise ablation, v2 §6, literature-grounded) *before* M5 wires the scorer call. **The thesis is a systems decision — _when does a tiny specialized model beat a per-edge LLM call?_ — not a quality contest (parity, not superiority):** `gpt-5.4-mini` is the production stylist (§5; `recommend/route.ts`, a mini-tier OpenAI model on text attributes), so the defensible win is "a trained compatibility prior reaches the honest hard-split band at a fraction of per-inference cost, with bit-determinism + offline + per-edge availability" (the §9 cost/determinism/availability table is the headline artifact; H26 lands no shortlister integration), and a **no-go still ships a result** as a clean engineering verdict (the negative + the cost table). Standalone — **not gated behind M5 deploy**; it is the **immediate next rung after this consolidation** (consolidation → H26 → M5), slotted before M5 wires the scorer call. Research + recipe in `docs/sessions/2026-06-26-m4a-post-audit.md`; sharpened in §23-H26/H28; **build doc = `docs/plans/h26-compatibility-spike-v2.md`** (v2 adopted + finalized 2026-06-28, audit in `docs/sessions/2026-06-28-h26-v2-spec-heavy-audit.md`). | **✅ DONE (C1–C6, 2026-07-05). Verdict: NO-GO by the frozen letter — gate B "underpowered / inconclusive" (miss-convention half-width 0.050302 > δ=0.05 by +3.02e-4 at the frozen N=500 cap; the CI sits wholly ABOVE +δ — a power miss, not an accuracy miss; the half-convention cross-check is powered and passes); A passes (+0.0995 [+0.0969, +0.1022] pair-AUC over zero-shot), D passes (0.845 outfit AUC / 62.1% FITB vs floors 0.81 / 0.50); judge non-vacuous (CI_low 0.306 > 0.25). Item-level seam shape independently falsified (+0.216 [+0.212, +0.220], Holm p < 2/B) — H28's pairwise choice corroborated on our data. Catalog→closet transfer OUTSIDE the healthy band (effective-N = 6, underpowered — the M6 re-measure entry condition, as pre-registered). Deliverable: `ml-system/experiments/h26/results.md` (systems table + all frozen disclosures); gate authority `metrics.json` (stage C6).** |
| **Scorer-seam shape** (M5 trace seam; M6 rank hook) | M5 lands the **producer-side `OutfitScorer` exercise**: snapshot production computes pairwise/outfit-level cold-start compatibility/visibility for every scored candidate and stores it in `scoreTrace`, without changing rank order. The additive, default-None outfit/pairwise-level scoring hook on `rank()`/`RankerContext` remains the M6 entry seam; the current `SignalScorer` is item-level (`score(item, context)`), the wrong shape for the non-transitive, type-conditioned pairwise compatibility the dive needs (Vasileva 2018 / NGNN / OutfitTransformer). The M6 hook must be **cold-start-available** (not behind the sampler's ≥5-interaction gate — §11): the universal content prior works at zero interactions. **H26 settled the shape (its ablation independently falsified the item-level scalar on our data — pairwise/edge stands); M5 recorded the trace surface and M6 lands rank-order influence when trained scores exist.** | ✅ done for M5 trace seam (`snapshot.py` exercises `OutfitScorer` → `scoreTrace`) · `[STAGED]` for M6 rank hook |
| **M6 (the dive)** | Trained edge/graph scorer — the **content-compatibility prior lands on the §23-H28 additive pairwise/outfit-level `rank()` hook** (the non-transitive, type-conditioned shape the item-level `SignalScorer` sampler slot cannot represent), **gated by the H26 spike above — which returned NO-GO by the frozen letter (a gate-B power miss at the frozen cap, not an accuracy miss), so M6 does not open on H26's authority alone**: entry requires re-powering gate B (extend the judged prefix over the frozen `fitb_order.json`) **and re-measuring the catalog→closet transfer on real-ingestion data** — H26 *reports* that transfer, it does not gate on the underpowered single closet — build doc §12/§13); offline NDCG@k / AUC / FITB on the universal content prior (zero-user, runnable); the **behavioral/personalization** signal (which *does* ride the item-level `SignalScorer` slot) → learned + online A/B is the **user-dependent arm** (`[STAGED]`/`[NORTH-STAR]` on a no-users fork — §11/§23-H9) | `[STAGED]` |
| **R-track** | Explicit routines → routine-scoped memory; dormancy/revival; then inferred/calendar | `[STAGED]`/`[NORTH-STAR]` |

The hosting decision (Fly.io, Brian's own service, always-on Docker, no cold starts; separate from the CV
HF Space) and the Python↔TS `fetch()` boundary are settled (carried from the M0/M1 plan).

**Sequence from here (set 2026-06-27, post-M4 consolidation; amended by M5 cutover review 2026-07-06).** The order was **consolidation → H26 spike ✅ (2026-07-05; NO-GO by the frozen letter — §20 H26 row + `ml-system/experiments/h26/results.md`) → M5 ✅ (C1–C8 2026-07-08; cloud deploy live 2026-07-16)**. M5 landed the producer-side scorer trace seam only; the additive rank-order hook is deferred to M6 entry so cold-start compatibility does not reorder shipped behavior. The legacy recommend/regenerate vertical and the §19 dresses string-match arm were **cut, not migrated**, when `USE_ML_SHORTLISTER` flipped (the open deletion-license premise — no real users — expired when Track 2 went live). **The current rung is Track 2:** 3–5 friend closets through the live deployment (runbook §8) toward the M6/H26 re-measure entry conditions (M6 row above). Post-Track-2, the **W-track** (ingestion surface) and **B-track** (text boards → StyleProfile) are **coequal** — neither blocks the other, and the now-explicit someday-launch path (rejoin the CS-148 team *or* post + advertise to friends) makes the B-track user-facing surface a real downstream destination, not a dead end.

## 21. Evaluation & metrics

**Three honest levels (this is a portfolio project, not a high-volume product):**
1. deterministic unit/property tests for every contract (pytest);
2. synthetic/replay eval (golden wardrobes + golden requests) for sanity and regressions;
3. real-user metrics as **descriptive evidence, not overclaimed science** (small N).

**Online/product metrics:** time-to-first-useful-outfit; accepted-upgrade / accepted-rescue rate;
just-right vs too_boring/too_much; % recommendations using previously-ignored items; orphan-items-rescued;
no-buy accepted outfits; repeat-session rate after first success; invalid-JSON / validation
reject / fallback-step distributions; latency p50/p95.

**Offline (the dive):** NDCG@k / hit@k on accepted outfits; **profile- and routine-conditioned acceptance**;
diversity/coverage; novelty-vs-repetition; counterfactuals (global memory vs profile vs routine). Requires
the GenerationSnapshot's exposure/candidate identity, positions, and feature snapshots — interaction rows
alone are selection-biased. **Do not claim model lift unless sample size + exposure logging justify it.**

## 22. Operational safeguards, non-goals, doc lifecycle

**Safeguards:** the truncating cap `MAX_CANDIDATES=40` and the *asserted invariant* `MAX_PROMPT_ITEMS=135`
(= cap sum, never a silent truncation — §10); one JSON-repair attempt;
normalization before validation before scoring; invalid candidates never reach the ranker; all weights as
named constants in one config file (the 70/30 split is the exception — a structural helper, §10/R6);
**telemetry** logging async/best-effort — but the **GenerationSnapshot training-row write is blocking / on
the critical path** (M5 D2, §15/§9 Step 7), never fire-and-forget; `wardrobeVersion` bumped only by the API
layer on the single activation transition (§18);
`scoreBreakdown` is computed at response time and not persisted as mutable current state, but the immutable
GenerationSnapshot persists per-candidate `scoreTrace.scoreBreakdown` for training truth (§15.1); graceful
degradation through the fallback ladder before any error.

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
private-by-default. **User-delete** cascades `wardrobeitems` + `outfitinteractions` + `wardrobeimages`
(M4b, closing H14's cascade arm) **and — since Track 2 went live — `generationsnapshots`: account
deletion is erasure, the resolved §23-H43 policy** (the M4-era "redaction seam reserved, not wired /
deferred to this milestone" framing expired when real users arrived). What still lands at this Privacy
milestone is only the **non-delete** path: the optional PII-null *scrub* (null free-text, preserve
`itemSnapshots`/keys/scores) as a future **consent-based retention** choice — never the delete path, which
is a hard erase. Cross-user
**collaborative/behavioral** signals require item canonicalization + consent — out of scope; this
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
| H4 | Within-day cache stability vs GPT stochasticity (temp>0) — a mid-day cache expiry reruns GPT and yields different candidates | **DISSOLVED / RESOLVED-DESIGN (M5 plan D2, 2026-07-06; §15 reconciled)** | The runtime candidate cache is removed entirely (`docs/plans/m5-cutover.md` D2): regenerate = one constrained fresh generation with lineage, so there is no cache lifetime to promise stability over. The promise becomes: *snapshots are immutable; every generation — first render or re-roll — is a fresh draw.* |
| H5 | Board edit major/minor threshold (graded refresh) **and** the semantic-identity key that carries behavioral memory across `styleProfileVersion`s | **OPEN** → DEFERRED-B-track | Threshold default: any palette/silhouette/formality change = major (strong refresh); keyword-only = minor (preserve pool). The identity-continuity mechanism (the stable key memory binds to, separate from the version) is specced at B-track |
| H6 | The single `wardrobeVersion`-bumping item transition isn't named | **OPEN** → DEFERRED-W-track | The W-track `/spec` must name the one transition meaning "now sampler-visible (active)"; that transition is the only bump. Reconcile `isAvailable` vs `needs_review` vs active. **M4/S5 adds the persisted `wardrobeVersion` field** (home = `User`, default 0, monotonic; `docs/plans/m4-data-model-migration.md` §10.4) — value constant until this transition is named; the bump itself stays W-track. |
| H7 | `generationIndex` lifecycle (ownership, range, increment, reset) was undefined — it is the lineage/index field distinguishing a re-roll | **IMPLEMENTED (M5 C4/C5, `mlRecommend.ts`)** | M5 defines server ownership: first render index 0; regenerate child index = parent+1 from an ownership-verified parent re-read; client-supplied child index is ignored; duplicate `requestId` identity excludes clock-derived `seedDate` to avoid false conflicts. Load-bearing for re-roll lineage/idempotency (`m5-cutover.md` §C.1/§C.4 — no cache). |
| H8 | Daily-reseed `date` timezone (server-UTC vs user-local) was undefined | **IMPLEMENTED (M5 C5, `mlRequestAdapter.ts` + service `_parse_render_body`)** | M5 fixes `seedDate` as required UTC `YYYY-MM-DD`, computed by the Next adapter and passed to the service; the service does not read a clock and independently rejects missing/null/malformed values. Must be identical across the adapter and service payload or seed/key provenance drifts at the day boundary. |
| H9 | M6 eligibility prevalence unknown (needs both ≥5 interactions AND ≥1 type over cap) | **OPEN** → DEFERRED-pre-M6 | Measure % of requests meeting both; if low, give the model a second surface (candidate ordering / ranker) |
| H10 | M4 interaction-time feature snapshots not yet built; mutable wardrobe refs rewrite old feedback's meaning | **IMPLEMENTED (C5–C7) — live since the C8 flip 2026-07-16** | GenerationSnapshot (§15.1) persists immutable feature snapshots before interactions become labels; the C6 builder-drift test pins that an edited/deleted item cannot alter an already-built `itemSnapshot`. M5 wires the live write + the no-post-Python-refetch rule on the TS merge. Visual hash/versioning remains W-track-dependent (H14/H33). |
| H11 | M4 idempotency/transaction rules (duplicate feedback, affinity updates, concurrent caps, `wardrobeVersion` races) | **RESOLVED — append-only route + read-time reducer LANDED (C6)** | Backfill idempotency trivial (no live data). Forward write-path rule (S6, §16/plan §11.1): feedback rows are **append-only**; dedup is a **read-time reducer** concern in the compute-live affinity projection (no stored counter to race — OQ2). Set/recency projections (`liked_full_signatures`, cooldown) are idempotent under duplication; the **counted** `item_affinity` resolves to **per-candidate latest-state** (§23-H61) — the most-recent action per `{snapshotId, candidateId}` wins; a retry counts once and a correction nets to the latest (the 300s `FEEDBACK_DEDUP_WINDOW` is **retired**, ordering does the work). Write-path unique-index/upsert **rejected** (forecloses append-only events; repeats the §8.8 unique-index trap; flattens repeat-wears). M5 landed the read-time latest-state reducer (§23-H61; no window — ordering does the dedup). **M5 append-only obligation (Codex read 2026-06-27):** the binding co-presence guard is document-`validate`-only, and the **legacy `interactions` route still mutates/deletes rows** (`findOneAndUpdate`/`findOneAndDelete`) — at the M5 cutover, interaction writes must become **append-only** (corrections are new events, not in-place edits/deletes), per the §6.6 append-only-with-read-time-reducer posture, with tests that bound rows can't be partially written through *any* chosen write path. The hole's other sub-parts: concurrent per-type caps are deterministic config (no race); `wardrobeVersion`-bump concurrency rides H6/W-track. **Track 2 curation (D-1, `interactions.ts` `deleteInteraction`):** a *correction* stays append-only — a History flip is an appended opposite action via POST, never an in-place edit — so the "not in-place edits/deletes" rule above is intact; the separately-added `DELETE /api/interactions` is the sanctioned **curation/erasure** door (distinct from a correction): a user-scoped native-driver hard-delete of EVERY row for a `{snapshotId, candidateId}` binding, for retracted/junk labels (the "little bro tapped 5 reactions" case). Consistent by construction (affinity recomputes from the log; the reducer/export simply stop seeing the rows, reverting the candidate to shown-but-unrated); snapshots are never touched (§16 / §23-H61 / friend-facing-fixes.md PHASE 1). |
| H12 | M5 graceful-fallback failure semantics were under-pinned | **RESOLVED-DESIGN (M5 D3/§D)** → C5 writer + C8 smoke | M5 chooses the no-fabrication boundary: **valid engine payload reaches Next → write exactly one snapshot**, including degenerate payloads for engine-internal failures; **no payload** (service unreachable/timeout/5xx/auth/rate-limit/transport loss) → no snapshot, degraded non-bindable response, counter/log. C3 implements the service-side degenerate arms for contract-valid internal failures; C5 owns the Next degraded response and writer behavior; C8 smokes the failure path. The named residual is transport loss after spend: money may be spent but no payload reaches the writer, so no honest row exists (§15.1). |
| H13 | Cross-runtime CI / runtime reproducibility (workflow + pins + conformance) | **RESOLVED — gate EXECUTED (C8 pre-flip green 2026-07-08; live flip 2026-07-16)** | M5 pinned the service runtime/dependencies; both suites ran green as the C8 pre-flip gate, and `.github/workflows/conformance.yml` (which runs exactly the two suites) is live on `main` (`m5-cutover.md` Verification/§J). |
| H14 | Retained-host cleanup bugs: clear-wardrobe/user-cascade omit some cleanup; image **replacement deletes the old image before the replacement commits** (data-loss ordering) | **CLEANUP ARMS CLOSED (M4b C7 user-cascade + 2026-06-27 clear-route)** → IMAGE-REPLACE-ORDERING DEFERRED-W-track | M4b C7 extended the `User.ts` cascade (`cascadeDeleteUserData`) to hard-delete `wardrobeimages` (H43's cascade arm, tested in `userCascade.test.ts`), and the **clear-wardrobe route arm is also closed (2026-06-27 readiness): `DELETE /api/wardrobe/clear` now drops `wardrobeimages` too via the extracted `lib/clearWardrobe.ts` (`wardrobeClear.test.ts`)** — so both cleanup omissions in the hole text are fixed. **(D2/REPLACE-1, Track 2 2026-07-17: item-delete AND clear-wardrobe now KEEP a snapshot-referenced image — `$nin: keepIds` via `lib/imageReferences` — for M6 image-embedding provenance; account-delete still purges ALL, so erasure holds. So clear drops only UNREFERENCED images, not all.)** The GenerationSnapshot redaction seam was **reserved, not wired** in M4; the snapshot delete path landed at Track 2 as **erasure** (§23-H43 RESOLVED), so the `User` cascade now hard-deletes `generationsnapshots` too. Image-replacement ordering bug (delete-before-commit) remains W-track when the upload pipeline gets rebuilt for async |
| H15 | Key-computation locus: keys are Python; `interactions` route is TS | **RESOLVED-HERE** | Compute keys once in Python at generation; persist them verbatim in GenerationSnapshot/OutfitInteraction. Pre-M5 legacy may echo keys, but M5 feedback identity is `{snapshotId,candidateId}` only; the server re-reads keys/content from the snapshot. Never reimplement key logic in TS (§7/§15.1). |
| H16 | Candidate cache key ⊋ session-seed inputs — retires the v1.2 R1/N1 `cache_key ≡ seed` invariant | **RESOLVED-DESIGN (M5 Lens-chain key)** | The runtime cache is gone, so this is no longer a cache lookup invariant. The surviving field is `candidateCacheKey` on `GenerationSnapshot`: a Python-authored Lens-chain grouping key over `(sessionId, wardrobeVersion, occasion, weatherBucket, intent, forcedItemId, seedDate)`. It deliberately excludes `generationIndex`, `controls`, and behavioral rows so re-roll siblings share the Lens-chain while each snapshot keeps its own generation attempts and controls (`m5-cutover.md` §C.1). |
| H17 | PDF `forceRegenerate=true` disposition undefined, given R1/R9 redefine regenerate as cached re-rank | **RESOLVED-DESIGN (M5 plan D2, 2026-07-06)** | Removed/subsumed: under the M5 plan every regenerate IS a fresh generation, so a `forceRegenerate` flag has no referent; R9 locks + `generationIndex` lineage (H7) carry the intent. |
| H18 | `behavioralStrength` sign: §11 said "signed" but §14/R2 keep affinity non-negative | **RESOLVED-HERE** | `[NOW]`/`[NEXT]` non-negative affinity + separate `dislikePenalty`/cooldown (R2); signed per-edge accumulator is the `[STAGED]` graph evolution (§11/§6.6) |
| H19 | Repetition-window shown-history has no `[NOW]` storage home (dropped from the old ledger on consolidation) | **RESOLVED — repetition-window reducer LANDED (C5–C6)** | Home = `GenerationSnapshot.shownFullSignatures` (§15.1), a field on the M4b C5 model. The window/cap reducer contract (§15.1/plan §9.3): read recent `REPETITION_WINDOW_SNAPSHOTS` snapshots, union most-recent-first, dedup, truncate to the shipped `REPETITION_WINDOW_SIZE`, return an ordered `Sequence[str]` (`ranker.py:191`); M5 implements the reducer that reads the window and feeds the ranker. `shownBaseKeys` dropped (no consumer); M3 not reopened. |
| H20 | `optionPath`/`risk` were emitted by GPT (violates §5 "GPT never ranks"); cold-start path/risk metrics undefined | **RESOLVED-HERE** (locus) + **IMPLEMENTED in Spearhead** (shape/metric) | Pure Python backend functions assign path/risk/graph-role labels (§11/§12/§14). The M2 GPT schema excludes `optionPath`, `risk`, score, rank, graph role, edge strength, freshness, exposure, fallback decisions, matched/missing traits, and diagnostic reason candidates; future schemas may add trait/reason fields only when their owning milestone consumes them (§12). Cold-start path ≈ compatibility/commonness/trusted-anchor availability; cold-start risk ≈ social visibility/boldness — built post-rank in `fitted_core/response.py` (`compatibility`/`visibility` → `assign_path`/`assign_risk`, the 2-D `(path×risk)` spread); the functional form is fixed in `docs/plans/spearhead.md` §G and the numeric config constants live in Appendix B (provisional, tuned against golden wardrobes at Spearhead C6). The learned M6 scorer replaces these heuristics at the same seam (§11) |
| H21 | "Orphan" is edge-defined but no edges exist at cold start | **RESOLVED-HERE** | Cold-start orphan = zero interactions + null/old `lastWornAt` (± `isFavorite`, ± explicit mark); deployed schema already has these fields (§11) |
| H22 | Rescue forced-item → template logic + insufficient case + minimum starter closet | **RESOLVED-HERE** (template/insufficient) + **IMPLEMENTED in Spearhead** (min-closet) | `clothingType`→template rule + rescue `notEnoughItems` (§12); the minimum starter closet = the rescue insufficiency check itself, built in `fitted_core/rescue.py` (`_resolve_shape` + `_check_sufficiency`, `docs/plans/spearhead.md` §G steps 1–2): the forced item plus enough to build one valid outfit under its template; sub-threshold returns `not_enough_items` (PRE-GPT, no generation) + an add-a-{type} hint |
| H23 | GPT-emitted `StyleMove` wasn't boundary-validated | **RESOLVED-HERE** | `StyleMove.changedItemIds ⊆ outfit items`, else dropped (§13, §5 LLM-boundary rule) |
| H24 | Feedback scope undefined when no board/routine is active (`[NOW]`) | **RESOLVED-HERE** | path/look → `outfit`; an item-dislike defaults to the **implicit/default-lens** scope (the `lens` `scopeTarget` value, H37) and is promoted to `global` only on **repeated support/confirmation** — one tap never yanks the global profile (anti-capture §3, posture rule 2; S6 hardened the support-gated promotion **rule**, numeric threshold `[NEXT]`); board/routine scopes arrive with B-track (§16) |
| H25 | Compatibility/item representation is attribute-only; embeddings are `[STAGED]`; the §18 review gate excludes unreviewable features | **RESOLVED-HERE** → reflect at M4/W-track | Item representation is **extensible** (tags now → embeddings later); scoring consumes a representation, never a fixed tag list. Learned features (per-item embedding) are a **usable scorer class** distinct from human-reviewable canonical fields (§11/§18) |
| H26 | §11 "never shared-catalog" / §22 "cross-user out of scope" would also bar a universal compatibility model | **RESOLVED-HERE** (split) → **SPIKE COMPLETE (C1–C6, 2026-07-05): catalog feasibility MEASURED — the trained head clears the absolute floors (0.845 outfit AUC / 62.1% FITB, gate D) and adds value over its own backbone (gate A), but the mechanical verdict is NO-GO by the frozen letter (gate B power miss at the frozen N=500 cap) and the catalog→closet transfer reads outside the healthy band on an underpowered single closet — the M6 re-measure entry condition. Deliverable: `ml-system/experiments/h26/results.md`** | Split: **behavioral/collaborative** cross-user stays out (privacy); a **universal *content*-compatibility model** trained on **public outfit corpora** is in-scope (clothes, not people) and is what makes the trained scorer feasible at portfolio scale — within-user behavior personalizes it (§11/§22). **Load-bearing for the dive's feasibility.** **Key unvalidated risk (audit 2026-06-26):** the catalog→real-closet **domain gap** — public corpora are clean flat-lay catalog photos; a real closet is messy phone photos, so the catalog→closet domain gap is **load-bearing and must be measured directly** (Popli 2022 is precedent for *measuring* real-photo↔catalog transfer — its often-cited 0.52–0.66 are weak self-supervised *pretext* baselines, **not** "naive transfer barely beats chance"; Popli's own method reaches 0.84 cross-dataset, so the lever is a fashion-domain representation, which the spike uses). De-risk with a cheap **offline spike** (Polyvore Outfits, **disjoint** split; AUC under category-aware negatives + FITB@4 over a frozen **Marqo-FashionSigLIP** image-embedding space; baseline ladder incl. **`gpt-5.4-mini`-as-judge** on the same items) **before** committing M6 — treating closet-transfer as a *separately probed* risk so a catalog AUC never masquerades as closet performance. Honest target band on the **disjoint** split ≈ 0.81–0.84 AUC / ~52–55% FITB (Vasileva 2018 Table 5: untyped SiameseNet 0.81/51.8%, type-aware CSN 0.84/55.2%). This spike is the demonstrable zero-user ML result; research + recipe in `docs/sessions/2026-06-26-m4a-post-audit.md`, **build doc `docs/plans/h26-compatibility-spike-v2.md`** (v2 adopted 2026-06-28) (the domain-gap drop is measured **pair-level on both sides**; the GPT parity head-to-head is **native forced-choice FITB@4** — the Monte-Carlo pair-level AUC arm is cut, v2 §8 — the headline cell is backbone/modality-frozen, the GPT comparator arm is pinned to image-only, and the category-co-occurrence baseline is a chance-by-construction sanity floor, not a beatable rung). |
| H27 | §22 body/color non-goal would bar a body-type styling signal | **RESOLVED-HERE** | Non-goal = no prescriptive quiz/scan + no objective "fashionability" score. An **optional, declared, coarse body-proportion archetype** as a refinable cold-start styling prior is **in-scope** (behavior reinforces current defaults; a prior enables better-than-default advice); measurements stay optional/out (sizing only) (§22) |
| H28 | The `SignalScorer` seam is item-level (`score(item, context)`) — wrong shape for outfit/pairwise compatibility | **SHAPE SETTLED by H26 (2026-07-05: the in-spike ablation independently falsified the item-level scalar — seam diff +0.216, Holm p < 2/B; pairwise/edge stands)** → M5 landed producer-side `scoreTrace` population; the additive `rank()`/`RankerContext` order hook remains **M6 entry work** | Reserve a **second seam shape**: an **outfit/pairwise-level scoring hook on the ranker** (scores a SlotMap / a pair), distinct from the item-level sampler slot. A summed per-item score cannot represent "these clash"; the compatibility dive needs the outfit-level hook to land (§5/§11/§14). **Empirical backing (audit 2026-06-26):** the compatibility literature is unanimous — Vasileva 2018 (type-conditioned **pairwise** distances; a single shared item-level embedding fails because compatibility is non-transitive), NGNN graph, OutfitTransformer (whole-outfit attention) — outfit compatibility is **pairwise/edge-level + type-conditioned**, outfit score = an *aggregation* over edges, never a summed per-item scalar. The cold-start MVP scorer must therefore be a **pairwise edge function** `f(item_i, item_j, types) → compatibility` (keep the seam INPUT as partial-outfit + candidate + lens/context — the §6.3 `RequestContext`, occasion/weather/routine — so a lens-conditioned, whole-outfit attention head can land at M6). M5 exercises that shape only in snapshot production, populating `scoreTrace.compatibility/visibility` without rank-order influence; cold-start compatibility must not reorder shipped M5 behavior. **Code-state (readiness amended by M5 cutover review 2026-07-06):** the ranker reservation is still conceptual, not yet in code — `RankerContext`/`rank()` carry **no** scorer hook. Landing it is an **additive default-None** outfit-level hook on `rank()`/`RankerContext` at M6 entry (additive ≠ reopen, distinct from H42's behavior-changing exemption). |
| H29 | GenerationSnapshot may store only validated/shown candidates + text features (selection-biased, label-only, attribute-only) | **IMPLEMENTED (C5–C7) — live since the C8 flip 2026-07-16** | §15.1 fixes the snapshot contract: (a) continuous scores in `scoreTrace`, including scored-but-unshown; (b) rejected + low-ranked candidates in `candidates[]`/`generationAttempts[]` with content-preservation; (c) visual ref/hash/embedding seam. M4b built the Mongoose model (raw caps + BSON guard + over-limit preservation, C5) and the Python `GenerationSnapshotPayload` + Option-B `*_with_trace` siblings (C6); M5 wires the live three-site funnel that calls them. **Two M5 obligations surfaced by the Codex read (2026-06-27), both one-way doors — fix before live writes:** (1) **variant-cap-dropped candidates carry a Step-5 score** (`_apply_variant_cap` sorts by `-score`) yet `rank_with_audit` files them in `filtered` with **no `ScoreBreakdown`** — they are *scored-but-unshown* per H29(a), so their Step-5 breakdown is a selection-bias signal currently discarded; M5 must either preserve it (a pre-diversity scored collection) or explicitly scope them out with a recorded rationale (§23-H48). (2) The TS raw-caps + content-preservation invariants are **advisory on the storage side** — the Python builder enforces them but the Mongoose schema accepts an oversized/bare doc, so the M5 live writer needs a **central TS validation helper** (caps/hash/truncation-flag + rejected-candidate content) before `.create()`, not just the Python guard. **Helper checklist widened (Codex forward-audit reconcile 2026-07-06, source-verified):** the schema also accepts semantically-invalid docs a serde-authored payload never produces but a TS-side writer bug could — `scoreTrace` fields are plain `Number` (accepts `Infinity`/out-of-[0,1] compat/vis vs the §15.1 range), and `shownCandidateIds`/`shownFullSignatures`/`nSurfaced` are independent fields with no membership/uniqueness cross-validator (an inconsistent shown set breaks the §16 authenticity gate's membership check). The helper therefore also validates: finite numbers, compat/vis ∈ [0,1], `candidateId` uniqueness, shown-set ⊆ candidates with `shown=true`/signature match, and `nSurfaced` consistency. |
| H30 | `FullSignature` format is spec-locked; new garment roles would force a key migration; BaseKey identity is base-only | **RESOLVED-HERE** (rule) + **OPEN** (identity) | Extension rule: a new optional slot appends **only when present**, fixed canonical order, so existing keys stay valid. BaseKey stays **base-only** for `[NOW]` cooldown/variant-cap; outer/shoe-defined identity is a registered **future** redefinition (§7/§8) |
| H31 | §22 "real-time online training" non-goal could be read to bar exploration | **RESOLVED-HERE** | Out = continuous real-time gradient training. **In-scope**: a serving-time **exploration** policy (sometimes surface an orphan to learn its edges) + **periodic batch** retraining — how orphan-learning + anti-capture work; enables off-policy eval (§21/§22) |
| H32 | The 30% signal slot caps the learned model's influence on *generation* | **RESOLVED-HERE** | The 70/30 split is a deliberate generation-influence ceiling, **not a law**; the trained scorer also scores the ranker, so total influence is not capped at 30% (§10) |
| H33 | §12 strips `imageUrl` from GPT input ("token cost") | **RESOLVED-HERE** (framing) → DEFERRED | The strip is a **cost deferral, not a principled closure**: a vision-capable **generator** (sees garments, not just tags) stays open for a later milestone (§12) |
| H34 | Freeform feedback excluded as a trainable channel (§16/§6.6) | **RESOLVED in §16/§6.6** | Posture rule 1/3: structured reasons stay the labels; raw/corrected rationale is persisted with provenance, excluded from training until reviewed |
| H35 | Dormant boards (§17) have no data home in `active\|archived` (§6.2) | **RESOLVED-seam in §6.2** → DEFERRED-B-track (impl) | Posture rule 1: board status gains `dormant` (or a `DormantBoardState`) |
| H36 | `ConstraintSet` is a fixed closed set (§6.3) | **RESOLVED in §6.3** | Posture rule 1: additive + raw-preserving (optional user-declared constraint text/provenance) |
| H37 | §16 anomaly scoping promises soft exceptions, but the scope vocab is only `outfit/board/routine/global` | **RESOLVED-DESIGN (S6); FIELDS LANDED (M4a C1)** | **Split** chosen (S6, §16/§6.6/plan §11.4): two additive nullable fields on `OutfitInteraction` — **`scopeTarget`** ∈ `outfit/board/routine/global/lens` (the `lens` value also carries H24's implicit/default-lens default) + **`learningDisposition`** ∈ `normal/exception/do_not_learn`. The split is load-bearing: a weather-forced dislike is `scopeTarget=outfit` **and** `learningDisposition=exception` — a merged enum can't represent both. **Fields added at M4a C1 (`OutfitInteraction.ts`, additive nullable, posture rule 1); anomaly-scoping behavior stays `[STAGED]`.** |
| H38 | "one global active profile in v1" (§6.2) could collapse the lens out of stored memory | **RESOLVED-HERE** | The global active profile is the **v1 default selection only**; every request/feedback snapshot may still carry `boardId`/`styleProfileId`/immutable version/confidence when present, so "which version of me" isn't lost (§6.2/§6.3/§15) |
| H39 | The "remembers it as a personal style rule" loop (appendix C.8) has no rule object | **OPEN** → DEFERRED-`[STAGED]` | Add a deferred **`PersonalStyleRule`/`MemoryLesson`** artifact compiled from repeated scoped feedback (source events + scope), so Progress/Debugger surfaces don't scrape raw interactions (§16/§6.6) |
| H40 | The `[NOW]` product *assumes* GPT styles believably from **text attributes only** (images stripped, §12) — unvalidated | **VALIDATED-mechanical (Spearhead C6)** / believability descriptive | The `[NOW]` viability bet, measured at Spearhead C6 on the golden corpus (gpt-4o, `--runs 5`, 55 generations): 100% JSON-parse, 100% forced-item inclusion, 100% StyleMove presence, 0 hallucinated ids, 0 schema failures (full results + cost/latency baseline in `docs/plans/spearhead.md` §E). Text-only generation held mechanically, so vision-input-to-generator (H33) was **not** promoted. Human believability stays **descriptive** (the §E rubric, never a gate); a larger believability read remains worthwhile pre-M5 if the rescue surface ships (§12/§21) |
| H41 | §2 "graph never the interface" + "hook first" could harden into bans | **RESOLVED-HERE** | Cards are the **default dressing interface**; a **secondary** graph/progress/`[NORTH-STAR]`-editing surface may exist behind progressive disclosure. Hook-first is the **default**, not a ban on optional lens-first board/routine selection (§2) |
| H42 | The forced/rescue item is in 100% of rescue candidates, so the ranker's overuse mechanic (§14) flags it in every rescue outfit | **RESOLVED-HERE** (accepted) → DEFERRED (exemption) | Uniform across all rescue candidates → relative ranking unaffected, so accepted as harmless. A forced-item *exemption* signal on the ranker is a future refinement, deferred (would reopen the closed M3 contract); see `docs/plans/spearhead.md` §G |
| H43 | GenerationSnapshot retention / purge / **redaction** on account delete was undefined, in tension with snapshots being immutable training truth (§15) | **RESOLVED (Track 2, 2026-07-16)** — erasure = cascade hard-delete + redact-first fail-safe + writer post-persist orphan check + route phase-3 sweep | Account deletion **erases** the user's snapshots: the `User` cascade (`cascadeDeleteUserData`) hard-deletes `generationsnapshots` alongside items/interactions/images (the single sanctioned native-driver door through the snapshot delete guard), the account route redacts first as a fail-safe, and the in-flight-render race is closed from BOTH sides — the M5 writer self-erases a row persisted for a since-deleted user, and (because the cascade is a *pre*-hook, so a write can land between its sweep and the user row's death while `User.exists` still passes) the route re-runs the cascade as a phase-3 sweep after the user row is gone. Decided Fable-reviewed against the friend promise ("delete me" must be literally true — the UI copy says "permanently deletes … outfit history"): mark-only redaction retained the friend's own text (names, occasions, raw generation text) while buying nothing — redacted rows are training-excluded and their interaction labels were already cascade-deleted. The original zero-users deferral premise expired when Track 2 went live. *Trap-guard:* redaction stays the **non-erasure** removal tool; the `[STAGED]` PII-null scrub is for a future consent-based-retention option, never the delete path (§15.1 redaction seam). *Scope note:* erasure covers every store this project controls (Atlas + Firebase Auth); transient third-party operational retention (Vercel/Fly logs, OpenAI's standard short-window API retention under `store:false`) is outside the erasure boundary and disclosed as such in the friend-facing copy (runbook §8). |
| H44 | §3 anti-capture promises the proactive nudge *"your recent likes are narrowing things — keep exploring?"* — but only the exploration **action** is homed (H31 serving-time policy), not the **detector** that triggers it | **OPEN** → DEFERRED-`[NEXT]` (anti-capture) | The missing piece is a **diversity/entropy-collapse signal** over the user's recent *accepted* outfits (FullSignatures / attribute spread) that decides *when* to surface the nudge. Lives alongside §16 feedback semantics + the H31 exploration policy; `[NEXT]` because it needs accrued behavioral history (post-M5 feedback). Until built, the proactive nudge half of §3 anti-capture has no mechanism — the reactive support-gated promotion (S6 rule + the M4a C1 `scopeTarget`/`learningDisposition` seam fields; behavior still `[STAGED]`, §16) is the only homed half. |
| H45 | §3 rung-1's `[NOW]` felt moment ("three believable ways to wear my green shirt") has a finished **engine** (Spearhead) but needs a laddered **delivery surface** | **IMPLEMENTED (M5 C6)**; shareable card DEFERRED-someday-launch | M5 C6 is the delivery surface: dashboard cards render the §6.5 response, expose StyleMove, provide an item-select/launch rescue UI, support rescue re-roll lineage, and bind feedback by `{snapshotId,candidateId}` (`dashboard/page.tsx` rescue/StyleMove/optionPath rendering + `wardrobe/page.tsx` "Build an outfit around this" launch). This is ambition-load-bearing: rescue must be user-reachable and first-class, not API-only and not hidden behind daily. The distinct **shareable before/after rescue card** — the someday-launch growth-loop artifact (recovered appendix C.4) — remains post-M5 and is decided when the someday-launch path activates. Registered so the flagship `[NOW]` moment isn't read as "engine done = shipped." |
| H46 | The recovered-appendix C.8 six dressing modes map to the ladder (Today→daily, Boards→B-track, Rescue→Spearhead, Lanes→R-track), but neither §20 nor §23 gives the **Debugger** (diagnose why an outfit/board fails) or **Progress** (style-growth view) **surfaces** a dedicated entry (they surface only incidentally — H39's data artifact, H41's progressive-disclosure note) | **`[NORTH-STAR]`** → DEFERRED, seam-preserved | §0 requires `[NORTH-STAR]` features to be *documented + seam-preserved*, not silently dropped. Progress's **data artifact** is already homed (H39 `PersonalStyleRule`/`MemoryLesson`, compiled from scoped feedback); the Debugger surface reuses the same scoped-feedback + `scoreTrace` lineage the GenerationSnapshot already preserves (§15.1). No new schema — registered here so the two modes survive as deferred surfaces, not a quiet narrowing. |
| H47 | `warmth` (§6.1) is **stored, not read-time-derived** (§15.2) and feeds `engineVisible.warmth` (training truth) — but the M4a PATCH/GET/UI neither **expose** it (no user correction) nor **re-derive** it when a warmth-driving field changes (silent staleness); §6.1 had called it "user-correctable" with no mechanism (Codex read 2026-06-27) | **RE-DERIVATION GUARD IMPLEMENTED (2026-06-27)** → correction UI DEFERRED-W-track | PATCH now re-derives warmth from the merged item when a warmth-driving field (`name`/`category`/`subCategory`/`seasons`) changes, and accepts an explicit valid `warmth` override; POST/GET/PATCH expose it (`wardrobeEditIngestion.test.ts` pins re-derivation, explicit-override precedence, out-of-range rejection, and no-op when no driver changes). So stale warmth can no longer reach `engineVisible.warmth` (§15.1) or mis-bin the ranker (`response.py` `_warmth_band`) via an edit — the **M5-blocking data-integrity arm is closed**. The dedicated user-facing **correction review form** is still the W-track's (§18). |
| H48 | `rank_with_audit` files **variant-cap-dropped candidates** in `filtered` with **no `ScoreBreakdown`**, though they carry a Step-5 score (the cap sorts by `-score`) — a *scored-but-unshown* selection-bias signal H29(a) wants preserved (Codex read 2026-06-27) | **IMPLEMENTED at M5 C4 (option (a) — store; producer scorer exercise + ranker trace)** | The cap runs *after* Step-5 scoring (`_apply_variant_cap` orders by `-sc.score`), so the breakdowns exist and are discarded. **Decision: store them (option (a))** — re-run `_score_candidate` over the Step-4-passing `filtered` candidates inside `rank_with_audit` (deterministic, additive trace field; the closed `rank()` untouched; `m5-cutover.md` §E). **Trap-guard (why option (b) was rejected):** "deterministically recoverable offline" is true only for compat/vis (pure content functions of `engineVisible`+lens); the Step-5 breakdown depends on the `RankerContext` behavioral signals, which the snapshot does **not** store verbatim — recovery would mean re-running reducers as-of `createdAt` across reducer-version/window-constant drift, which fails the moment live feedback exists. Storage cost ≈ 7 floats per loser, trivially under the raw caps. **Sibling instance** (response-layer tail: `build_variants_with_trace` precomputes `compatibility`/`visibility` only for the top-`k`, `response.py:608-611`) is resolved in the same commit via the §E producer-side `outfit_scorer` exercise. M5 also persists the reduced `RankerContext` signals in `diagnostics.ranker` so every stored score is recomputable from the row alone. |
| H49 | **Cache-hit snapshot provenance undefined.** §15.1 requires one *independently complete* snapshot per render (required `generationAttempts[]` + non-null `generator` + per-candidate `sourceAttemptId`), but §15 skips generation on a cache hit — so a re-roll over a warm cache must write a complete snapshot for a render where **no generation ran**, and the meaning of those fields on a hit is unspecified (readiness 2026-06-27, R2C-01) | **DISSOLVED (M5 plan D2 overturn, 2026-07-06)** | The M5 plan removed the cached/re-rank render path — regenerate = one constrained fresh generation (`docs/plans/m5-cutover.md` §C), so every snapshot carries its **own** `generator`+`generationAttempts[]`, `createdAt` IS generation time, and no cache-hit render exists for these semantics to describe. The copy-forward recommendation applied to the abandoned re-rank design (git preserves it). |
| H50 | **Snapshot-render idempotency unhomed.** A double-submit / connection-retry at the same `generationIndex` writes two semantically-identical *immutable* snapshots; H11 dedups only feedback rows, H7 is the re-roll lever, `requestId` is inert (readiness 2026-06-27, R2C-04) | **RESOLVED — partial unique index LANDED (C5)** | Duplicate immutable renders silently inflate the off-policy corpus. Mechanism: a **partial unique index** on `{user, requestId}` with `partialFilterExpression: { requestId: { $type: "string" } }`, schema/helper rejection of missing/null/blank/malformed/overlong ids, `E11000` → re-read the winner and return its shown set, and the C6 dashboard mints a UUIDv4/ULID `requestId` **once per Generate action** (reused on retry; button disabled in flight). **Trap-guard:** the earlier "append-only posture, not a write-path unique index" phrasing conflated the H11 **feedback-row** rule (duplicate events are meaningful and must never be write-rejected) with **render** idempotency — a snapshot is one-per-render by definition (§15.1), a same-`requestId` duplicate is a retry artifact, and a legit repeat render mints a new `requestId`, so the index forecloses nothing. An index-less read-check-then-create has a TOCTOU window spanning the whole render latency and catches nothing under a double-click. |
| H51 | **Cache locus + cross-runtime seed/cache-key reproduction undefined.** `seed.py` committed a TS "reproduces the same seed" + "the M5 cache key" obligation (the seed is a 64-bit int > JS `Number`'s 2⁵³ safe range), but §15's key is keyed on inputs, not the seed value, and the cache locus (Next-side vs service-side) was unset (readiness 2026-06-27, R2C-02) | **DISSOLVED / RESOLVED-DESIGN (M5 D2 + C3)** | M5 removes the runtime cache entirely, so no cache locus exists and TS does not reimplement the Python 64-bit seed. The remaining `candidateCacheKey` is a Python-authored Lens-chain grouping field on `GenerationSnapshot`; C3 landed `candidate_cache_key()` with length-prefix framing and golden vectors, and C5 only cross-checks the service-authored value before write. H13's cross-runtime obligation is therefore conformance of the wire/schema contract, not JS reproduction of the seed. Reintroducing a runtime cache later is a new design with its own provenance rules, not a resurrection of this hole. |
| H52 | Item `type` is a **fixed single-valued attribute**, but garments are **context-polysemous** — a cardigan is a `top` worn alone and an `outer_layer` worn over a tee; a track jacket likewise — so any single label is lossy and, taken as the system's "understanding," fights the identify-clothing-the-human-way ambition (§1 vision / §11 edge model) (surfaced from the H26 cardigan typing decision, 2026-06-29) | **RESOLVED-HERE** (framing) → role-resolution DEFERRED (W-track edit / M6 context) | The human-like understanding lives in the **visual embedding + the relational edge graph** — compatibility is pairwise/edge-level, never a per-item type label (§11/H28) — so the fixed 5-type is **coarse plumbing** (outfit-slot structure + a *secondary* type-pair conditioning hint), not where perception sits; the relational layer does **not** suffer the polysemy. Resolution ladder, weakest→most-human: **(1)** CV auto-derive (`deriveClothingType`, today); **(2)** **CV + human edit at ingestion** — the W-track review surface (§18) lets the owner set the role; the disambiguating knob (`layerRole`) is **already consumed** by `deriveClothingType` (`layerRole==="outer"` → `outer_layer`), only the edit UI is unbuilt — **trap-guard for that build:** the correction form must ECHO the human-set `clothingType` in every PATCH it sends, because the route re-derives the type whenever a taxonomy field (`category`/`subCategory`/`layerRole`) changes without an explicit `clothingType` in the body (the Track-2 slot-staleness fix) — an echo-less form would silently clobber human corrections; **(3)** **context-resolved multi-role** (M6+): the item carries `{top, outer_layer}` and the *outfit* picks per-wear (handles "same cardigan, both ways"). H26 cannot see the human signal, so its benchmark uses the fixed label matching production's **no-`layerRole` default** (cardigan → `top`, track jacket → `outer_layer`; `experiments/h26/type_map.json` `override_reason` rows) — the honest single-value approximation; at serving time the model gets the human-verified rung-2 label (cleaner than Polyvore's raw category), so the benchmark *understates* production type quality. Owner: rung 2 = W-track (§18, ties H6/H47 ingestion edits); rung 3 = M6 (ties H25 extensible representation, H28 pairwise seam). |
| H53 | **Ingestion must normalize EXIF orientation before embedding.** H26 found all 13 closet phone photos carried EXIF orientation 6 and PIL ignores EXIF on `Image.open` — the first closet probe embedded sideways garments (closet AUC 0.4375 → 0.5625 after `exif_transpose`) (`experiments/h26/results.md` §6/§10, 2026-07-05) | **OPEN** → RESOLVE-IN-W-TRACK/M6-INGESTION | Silent measurement corruption: any embedding built from un-transposed phone photos scores rotated pixels, roughly halving the real compatibility signal — the exact bug that once halved the closet probe. The M6 catalog→closet re-measure (a pre-registered M6 entry condition) rides the W-track (§18) ingestion path, so that path must call `ImageOps.exif_transpose` (or equivalent) before any CV embedding, with a regression fixture on an orientation-6 image. **The Track 2 photo corpus is orientation-MIXED:** the client downscale bakes orientation into the pixels (`createImageBitmap(..., imageOrientation:"from-image")`), but the small-file skip path and the decode-failure fallback upload the original EXIF-tagged file — so `exif_transpose` at embed time stays mandatory for the re-measure regardless of the downscale. Ties H6/H47 (§18 ingestion). |
| H54 | **GenerationSnapshot has no delete guard.** The immutability contract registers `pre` guards for `updateOne/updateMany/findOneAndUpdate`, `replaceOne/findOneAndReplace`, and `save` (`fitted/models/GenerationSnapshot.ts:481-483`) but **no `pre(["deleteOne","deleteMany"])`** — a raw delete can hard-remove an immutable training snapshot outside the reserved redaction seam (nominated in the 2026-07-02 audit handoff, never promoted) | **RESOLVED — delete guard LANDED (C5/C6)** | One-way-door integrity gap: the "immutable training truth" invariant (H10/H29/H43) is enforced against mutation but not deletion. Harmless today (zero-user fork, no delete caller) but M5 adds the live writer, so M5 adds a `pre(["deleteOne","deleteMany"])` rejection **at the Mongoose layer**. Redaction (`redacted:true`) is the only sanctioned *in-place* mutation; the sole sanctioned **hard-delete** is account-deletion **erasure via the `User` cascade** (native driver, deliberately below this guard — §23-H43 Track 2 policy), so the guard blocks stray deletes without blocking the one legitimate erase. **Residual (test-lane):** the Mongoose guard does not cover *native-driver* deletes (the cascade's own layer), and the source-grep static test that m5-cutover.md's acceptance list envisioned for unsanctioned raw `generationsnapshots` deletes was never built — pre-existing, low-severity (the sole native-driver **`generationsnapshots`** delete caller is the sanctioned cascade — the Track-2 feedback-curation `DELETE /api/interactions` and the POST erasure self-heal are native-driver deletes on **`outfitinteractions`** only, never snapshots, so this guard's scope is unaffected). Distinct from H50 (duplicate *write* idempotency). |
| H55 | **`fitted_core` live-generation defaults were pre-H26 / cross-model-inconsistent.** Pre-M5, `OpenAIGenerator.__init__` defaulted `model="gpt-4o"` / `temperature=0.8` and only supported the `max_tokens` param, while production is `gpt-5.4-mini` (`recommend/route.ts`) and **GPT-5.x rejects `max_tokens`** (the H26 judge already mapped GPT-5.x to `max_completion_tokens`, `experiments/h26/gpt_judge.py`; independent-audit find, verified 2026-07-06) | **RESOLVED (generator core, M5 C1)** → route/service remainder at C3/C5 + H60 | The generator core landed at M5 C1 per the m5-cutover.md §A.6 contract: `OpenAIGenerator` now defaults `model="gpt-5.4-mini"` / `temperature=0.5`, sends the cap as **`max_completion_tokens` (never `max_tokens`)**, defaults to strict `json_schema` Structured Outputs (`json_object` is the sanctioned fallback), sends `reasoning_effort="none"` explicitly (`None` omits the param for non-reasoning models), sends `store:false` for no distillation/evals storage, sends `prompt_cache_retention="in_memory"` so prompt-cache retention does not ride org defaults, constructs the OpenAI SDK client with an explicit bounded timeout and `max_retries=0` for live service use, and surfaces per-call finish/refusal on `last_finish_status` (`ml-system/fitted_core/generation.py`, fake-client-tested in `tests/test_generation.py`). **Still scheduled downstream, not resolved here:** the C3 service consumes `finishStatus` for §D degenerate routing and records the cap + API-surface/cache-mode/timeout-retry provenance in the snapshot `generator` block; the empirical cap↔ask validation on real `gpt-5.4-mini` runs before C5; request-side input/spend bounding is H60. **Trap-guards:** the historical `gpt-4o`/`temperature=0.8` defaults are correct provenance for the Spearhead §E C6 eval — do not retro-edit that record; never reintroduce a `max_tokens` path for GPT-5.x (hard-400s); never inherit the Python SDK's 10-minute/two-retry defaults for the live service; and never restate `store:false` as the entire OpenAI retention contract without the prompt-cache-retention surface. |
| H56 | **Gate-B repower tooling deletes the ledger it is meant to extend.** `run_judge.py` documents *extending* `judge_runs.ndjson` (`:10`) and `gpt_judge.py`'s grouping already supports append/keep-last dedupe (`:421`), yet `_guard_gate_b_ledger` **removes a committed-clean ledger** before a run (`run_judge.py:201`) (independent-audit find, verified 2026-07-06) | **OPEN** → M6-ENTRY-LEVER | Not a safety bug — the delete only fires on a *committed* ledger, so git preserves the paid run (verified CP1a). But it fights the M6 gate-B repower path (`results.md` §10: extend the frozen-ordered judged prefix past N=500 to close the +3.02e-4 power miss): repower wants **append more judged questions**, and the tooling's delete-then-regenerate ergonomics work against that. M6 entry reworks the repower flow to append/keep-last over the existing ledger (the dedupe capability already exists) rather than delete-and-rebuild, so the extension is additive over the frozen prefix. Ties the H26 NO-GO's power lever (§20 M6 row). **Two repower-time interpretation/hardening notes (Codex forward-audit reconcile 2026-07-06 — disposition notes, the sealed prereg is NOT edited):** (1) the prereg's gate-B vacuity guard presupposes a vacuous judge makes B "pass trivially" and never specifies vacuous∧**underpowered**; the code's letter (`verdict = A∧B∧D`, prereg.json's unconditional `underpowered_is_no_go: true`) adjudicates that corner NO-GO. The frozen run's judge was non-vacuous (CI_low 0.3058 > 0.25) so the frozen verdict is untouched; a repower re-run reusing `apply_gates` inherits this letter-reading and must state it, not re-litigate it. (2) cached-ledger row validation is shallow for repower appends — `assert_scalar_only` checks the field set + `choice` int/null only; an out-of-range cached `choice` flows through `collapse_question`'s remap and silently counts as a miss (a bad `order` fails loud via KeyError; noncontiguous `sample_index` is harmless to the plurality). The repower tooling adds a choice-range-vs-`n_candidates` check when it reworks the append flow. |
| H57 | **The daily-intent engine surface was missing before M5.** The §20 M5 row's "rewrite of recommend/regenerate routes" requires serving the **daily** intent (the deployed dashboard's main flow) while §19 deletes the legacy vertical at cutover; the M5 pre-flight gap was that `fitted_core` only had the rescue vertical, a required `forced_item_id`, and a snapshot producer typed/hard-coded to rescue. | **RESOLVED — engine (C1) + route/UI (C5/C6) LANDED** | M5 §B is now the spec home for the intent-generalized engine surface, and C1 implemented the corresponding Python core: `RenderRequest.intent`, optional `forced_item_id` outside `rescue_item`, daily `render`/`render_with_trace` dispatch, and `build_snapshot_payload` writing `intent=request.intent` rather than a rescue constant. The ambition requirement is still product-level, not engine-only: C5 must route daily through the new service and C6 must ship the rescue launch surface, re-roll lineage, StyleMove cards, and bound feedback before cutover. Ties H45 (rescue UI delivery). |
| H58 | **The Next→service contract had no home before M5.** Pre-M5, `fitted_core` had no HTTP layer; §15.1/`snapshot_serde` covered only snapshot-payload direction and §15.2 only item-field renames, leaving endpoints, request casing, auth, error envelopes, and Lens mapping homeless. | **RESOLVED — service (C3) + Next client (C5/C6) LANDED** | M5 §A is now the service contract home (`POST /render`, `GET /readyz`, camelCase request/response, shared-secret `X-Fitted-Service-Key`, service-owned OpenAI key/config, bounded errors/degenerate payloads), and §F owns the §15.2-parallel Lens adapter table. C3 implemented the stateless Python ASGI service with auth before body read, body/depth/input clamps, rate/token bounds, reducers, render, degenerate failure rows, and no-spend readiness. Remaining live app work is not resolved here: C5 wires Next fetching/validation/persistence/idempotency, and C6 wires the daily/rescue UI loop. Ties H12/H13/H51/H60. |
| H59 | **Regenerate must preflight contradictory locks.** The legacy `regenerate` route can accept the same item in `lockedItemIds` and `dislikedItemIds`, leaving the reroll with an impossible constraint set that can degrade into empty-success / wrong-output behavior instead of a predictable client error (forward-audit reconcile 2026-07-06) | **RESOLVED — locked∩disliked preflight LANDED (C5)** (`mlRecommend.ts` rejects the contradictory set) | M5 deletes the legacy route, so do not patch it now; the rewritten recommend/regenerate contract must reject `locked ∩ disliked ≠ ∅` before candidate filtering (400/409 with a stable error envelope), and tests must pin that no empty successful recommendation response is emitted for contradictory per-request controls. Ties H7 (generationIndex/reroll), H49's no-cache fresh-generation provenance, and the §12/R9 regen controls. |
| H60 | **Recommend/regenerate route rewrite must bound user-controlled prompt/spend fields.** The legacy vertical accepts request-body text knobs (`occasion`, style/change notes, feedback/change targets, weather-ish context) and generation options without a centralized length/type clamp or a hard completion-token budget, so a malformed direct API caller can expand prompt size / output spend even though the current fork is not the deployed prod (forward-audit reconcile 2026-07-06) | **RESOLVED — field clamps + token cap LANDED (C5)** (`mlRequestAdapter.ts` §A/G7 clamps + `max_completion_tokens`) | M5's rewritten route/service adapter must validate and clamp all body-controlled text/array fields before they reach the service prompt, set an explicit output-token cap (`max_completion_tokens` for GPT-5.x per H55), and test overlong/ill-typed request bodies plus the cap plumbing. This is distinct from H58 service auth: auth prevents open proxying, while this bounds authenticated or same-user malformed calls. |
| H61 | **Feedback correction/retraction affinity semantics unpinned.** The §H reducer treats `accepted`→(`item_affinity`+1 / `liked_full_signatures`) and `rejected`→(cooldown / dislike windows) as **independent additive channels**, and `item_affinity` dedup keys on `{snapshotId, candidateId, action}` — so a user who likes candidate X and later **corrects to dislike** the same X produces two non-colliding rows: the item keeps its `+1` affinity and stays in `liked_full_signatures` **while also** entering the cooldown/dislike windows. The history UI ("*to change your mind, just react again*") implies a correction takes effect; the reducer does not net it. H11's append-only rule governs **storage** (store a new row, never in-place edit), not reducer **retraction**, so this is genuinely unhomed. | **IMPLEMENTED (M5, `reducers.py`)** | **Per-candidate latest-STATE.** For each `{snapshotId, candidateId}` only the **most-recent action row** contributes to signals — i.e. the first row seen in the most-recent-first scan wins; older rows for that same candidate (incl. same-action repeats) are skipped. A candidate whose winning action is `rejected` also **blocks its `fullSignature`** from `liked_full_signatures` (a `blocked_signatures` set, since a set can't hold both signs). This honors the UI promise ("to change your mind, just react again"), and subsumes the 300s double-count guard (each candidate counts once — the `_is_duplicate_counted_event` window becomes deletable for counted actions). **Grain is exactly `{snapshotId, candidateId}`** — item affinity stays strictly per-candidate, so a like of outfit A and a dislike of a *different* outfit B that share an item keep BOTH signals (legit cross-candidate taste, not a contradiction). Requires the deterministic `{createdAt:-1, _id:-1}` projection sort (already shipped) so same-millisecond ties resolve stably. **M6 obligation:** the M6 labeler MUST use the same latest-state rule so training labels never disagree with serving signals; the discarded history stays available as auxiliary label-churn features. Storage stays append-only (no data loss); netting is read-time. Landed at the reducer (`reduce_interaction_rows`, `reducers.py:81`) with correction/waffle/tie/signature-block tests. |
| H62 | **Dislike-enrich can resurrect a just-curated candidate.** The "tell us why?" enrich is a SECOND `rejected` POST landing ~1-3s after the one-tap dislike (`lib/useDislikeEnrich.ts`). Because `deleteInteraction` hard-deletes every row for a `{snapshotId,candidateId}` binding, an enrich still in flight when the friend REMOVES that card in History simply `.create()`s a fresh `rejected` — resurrecting a curated candidate for the whole enrich round-trip (the flip case is safe; only remove). | **DOCUMENTED — narrowing OPEN (backlog)** | Bounded + recoverable: the row reappears in History (re-curatable) and the dashboard reconcile closes the dashboard-return case, but an M6 export pulled inside the window captures a label the friend believed erased. The `useDislikeEnrich` docblock now states this honestly (was mis-scoped "practically never"). Fix (backlog): an `AbortController` on the enrich POST tied to dashboard component lifetime, aborting the in-flight enrich on navigate/curate. Do NOT add cross-load persistence of held reasons without re-solving this (it widens the window to a routine one). |
| H63 | **Account-DELETE claimed full erasure even when Firebase auth deletion failed.** `DELETE /api/account` swallowed an `adminAuth.deleteUser` throw and returned `{ok:true}`, so a transient Firebase outage left the user's Google email/displayName/photoURL in Firebase Auth (the only residual identity after Mongo is wiped) while telling the user they were fully deleted. | **RESOLVED — honest partial-failure LANDED** (`app/api/account/route.ts`) | The route now retries `deleteUser` once (300ms backoff) and, if it still fails, returns `502 {ok:false, dataDeleted:true, authDeleted:false, error:"auth_deletion_failed"}` — never claiming full erasure while the identity survives. All Mongo data is already gone by then; the user can re-sign-in (`auth/sync` re-creates a fresh empty user, old data does NOT return) and delete again to retry only the auth step. **Client copy LANDED:** the 502 branch now `alert()`s an honest message (`PARTIAL_DELETE_MESSAGE`, `account/page.tsx`) naming the surviving sign-in + the retry path, instead of silently signing out — mount-tested (`accountPartialDelete.test.tsx`, mutation-proven). **Residual (deferred, backlog):** the surviving Firebase Auth identity (email/name/photo) is a *retention* gap, not an *exposure* leak — it is in no app DB, returned by no endpoint, reachable only by that person's own Google login; and token revocation only fires as a side-effect of the (failed) `deleteUser`, so it is not revoked in this path. The only close for the "user never returns to re-delete" case is a durable server-side retry (a background job / cron the project lacks); at 3–5 friends the 502 needs a Firebase outage spanning both attempts at the delete instant — a near-never event — so building that infra is deferred until the study scales. |
| H64 | **GenerationSnapshot's "no blob bytes EVER" boundary is enforced on only 3 raw fields.** `rawText`/`rawEmitted`/`rawAttributes` are byte-capped, but sibling service-authored passthroughs — `itemSnapshots.generatorVisible` (Mixed), `embeddingRef`/`visualFeatureRef` (unbounded String), `diagnostics.ranker`/`diagnostics.rescue` (Mixed) — are uncapped/unvalidated, so a buggy/compromised service could persist a blob into the immutable corpus. | **OPEN — latent (shape decided)** | Latent today: the pinned Python service populates none of these (`snapshot.py` emits only `item_id`+`engine_visible`), so the exploit needs a compromised/severely-buggy service; the 16MB BSON ceiling backstops only the DoS half. Decided fix (land with the next session touching `lib/mlSnapshotMerge.ts`): **reject-if-present** for the three reserved-and-unused fields (mirror how `lens`/`constraints` are M5-gated absent — the stronger invariant), plus a **byte-cap** on `diagnostics.ranker`/`rescue` (legitimately populated → cap not reject). |
| H65 | **No prod index-build/parity mechanism.** `lib/mongodb.ts` sets `autoIndex:false` in prod (correct — avoids cold-load re-sync stalls) but there is no `syncIndexes()` deploy step and no CI/health check that live indexes match the schema, so a FUTURE schema index change silently no-ops in prod. The load-bearing one is the partial-unique `{user,requestId}` idempotency index (H50) — if absent, a concurrent double-submit inserts two corpus rows for one render. | **OPEN — no active break** | A live check confirmed the `{user,requestId}` index currently EXISTS on prod Atlas, so nothing is broken now; erasure is unaffected (cascade deletes by `{user}` regardless). CI-artifact hygiene ("enforce process rules with tests, not discipline"). Trigger: **before the next deploy that changes any model's indexes** — a `scripts/sync_indexes.mjs` runner (`Model.syncIndexes()` per model) + a parity assertion diffing schema-declared vs live indexes. |
| H66 | **Geo weather discarded temperature.** With a location present, `resolveWeatherProd` fetched a rich summary (e.g. "Clear sky, 34°C") then bucketed it via `bucketFromSummary`, a condition-TEXT keyword matcher — the WMO summaries contain no hot/mild/cold keyword except "snow", so every non-snow temperature collapsed to "mild". The bucket is the only temp signal reaching the ranker's `WEATHER_WARMTH_BAND` penalty and the stylist prompt, so a 34°C day was styled/ranked "mild" and the M6 corpus recorded `weather:"mild"` for hot/cold renders. | **RESOLVED — numeric bucketing LANDED** (`lib/weather.ts` + `lib/mlRecommend.ts` `bucketFromTemp`) | `getWeatherContext` now returns `tempC`/`feelsLikeC` (center-slot for the forecast path); the geo path buckets by the NUMBER, feels-like preferred: **cold ≤ 10°C, hot ≥ 24°C, mild between** (aligned to the warmth bands), with a **snow-in-summary → cold** override. `bucketFromSummary` stays the no-geo occasion-text fallback. Fulfills the m5-cutover §F "temp/condition → bucket" mandate (was half-implemented). Thresholds AND the `resolveWeatherProd` geo→`bucketFromTemp` wiring are pinned in `contextDetection.test.ts` (the wiring test is mutation-proven: reverting line 157 to `bucketFromSummary` reddens it). |

---

## Appendix A — Concordance (old identifiers → v2 home)

So existing references in `m0-m1-substrate.md` and elsewhere still resolve. The old docs are retired; this
map is their forwarding address.

| Old | Was | Now lives in |
|---|---|---|
| R1 | One seed primitive + two wrappers; length-prefix; None sentinel (the two-stage cache is retired — M5 D2) | §15 (seed) |
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
| N1 | cache-key ≡ seed inputs **retired; M5 `candidateCacheKey` = Python-authored Lens-chain grouping key, not a runtime cache lookup** | §15 + H16 |
| N2/C1 | Daily re-seed (`+date`) supersedes "stable indefinitely" | §15 + H8 |
| N3 | §13 validation superset, three owners | §8 |
| N4 | `relaxedCooldown` (per-outfit bool) vs `relaxedCooldownCount` (per-request aggregate) — both kept | §14 |

## Appendix B — Config constants (single home, §22)

`DEFAULT_K=10` · per-type caps `CAP_TOPS=35, CAP_BOTTOMS=30, CAP_DRESSES=25, CAP_OUTER=20, CAP_SHOES=25` (the `CAP_` prefix is the live `config.py` name — import by it) · `BASEKEY_VARIANT_CAP=2` (the ranker's first diversity gate — top-2 variants per BaseKey by pre-penalty score, §14) ·
`MAX_PROMPT_ITEMS=135` (= cap sum, asserted) · `MAX_CANDIDATES=40` · `DAILY_MAX_CANDIDATES=12` (M5 C1 —
ceiling on the *daily LLM ask* only; the sampler's `min(40, total_base×3)` sizes the pool, not the paid ask;
rescue keeps its own `_rescue_candidate_requested` override — `m5-cutover.md` §A.6 point 3) ·
`MIN_SIGNAL_THRESHOLD=5` ·
`MAX_AFFINITY=20` · `OVERUSE_MIN_POOL=15` · `OVERUSE_THRESHOLD=0.40` · `OVERUSE_PENALTY=0.5` (magnitude, per
overused item, subtracted — S4) · `COOLDOWN_PENALTY=-2.0` (stored
negative, added — S4) · `DISLIKE_PENALTY` magnitude 0.5 (per disliked item, subtracted — S4) ·
`COMBO_BOOST=+2.0` · `ITEM_BOOST_WEIGHT=+0.1` · `BASE_SCORE=+1.0` ·
dislike window `M=20` · cooldown buffer 10 (FIFO) · `REPETITION_WINDOW_SIZE=10` (sig cap on the ranker's
`shown_full_signatures`) · **Reducer constants — home = `ml-system/fitted_core/reducers.py` (landed M5 C2), NOT `config.py`; the values below are a pointer, not a second home:** `REPETITION_WINDOW_SNAPSHOTS=50`
(S4: recent-snapshot read window for the H19 reducer) · `INTERACTION_ROWS_SCAN_LIMIT=500` (bounded
interaction-row fetch, §16/plan §H). *(The former `FEEDBACK_DEDUP_WINDOW=300` was **retired at M5** —
per-candidate latest-state via `{createdAt:-1,_id:-1}` ordering does the dedup, §23-H61; do not
reintroduce it.)* *(**Provenance trap-guard
(preserved as a forward warning):** these are **reducer** config, not ranker config — they live in
`reducers.py` under their own `REDUCER_CONFIG_VERSION` auto-hash (a scan-limit tune shifts reducer
provenance, never `RANKER_CONFIG_VERSION`). Do **not** move them into `config.py`: `RANKER_CONFIG_VERSION`
auto-hashes every `UPPER_SNAKE` global there and would fold reducer constants into ranker provenance — the
exact accident this split prevents.)* ·
`REPETITION_PENALTY=1.0` (flat magnitude on a re-shown FullSignature, subtracted — S4) ·
**M5 service spend-envelope constants — home = `ml-system/service/config.py` (landed M5 C3), a pointer
not a second home:** `DEFAULT_MAX_COMPLETION_TOKENS` bounded by a `/readyz`-enforced
`MIN_COMPLETION_TOKENS_FLOOR`..`MAX_COMPLETION_TOKENS_CEILING` band (an env cap outside the band → 503:
below-floor is ready-but-unusable truncation, above-ceiling is an uncapped spend envelope); default +
floor + the daily ask ceiling are re-tuned together, and the worst-case capped-ask validation (the cap
proven to hold the full 12-outfit ask) is still owed — tracked as TOKCAP-1, runbook §8. *(The v1.2
candidate-cache TTL is retired — M5 D2 removes the candidate cache entirely, `docs/plans/m5-cutover.md` §C;
there is no cache constant.)* The 70/30 split
is **not** a constant — it is the sampler-owned `random_count` helper (§10/R6). *(Note: deployed K default is
5, not 10; v2 sets 10.)*

**Spearhead rescue constants** (cold-start response layer; provisional C6 tuning inputs, not universal
fashion law):

```
N_SURFACED = 3
MIN_RESCUE_CANDIDATES = 6
NEUTRAL_COLORS = frozenset({"black", "white", "gray", "grey", "navy", "beige", "cream", "tan", "khaki", "denim"})
BOLD_STYLE_TAGS = frozenset({"bold", "statement", "bright", "graphic", "print", "pattern", "neon", "sequin"})
COLOR_FAMILIES = {
    "warm": frozenset({"red", "orange", "yellow", "coral", "peach", "gold", "mustard", "burgundy", "maroon", "rust", "brown"}),
    "cool": frozenset({"blue", "green", "teal", "cyan", "purple", "violet", "lavender", "mint", "olive"}),
    "pink": frozenset({"pink", "magenta", "fuchsia", "rose", "salmon"}),
}
FORMALITY_RANK = {
    "loungewear": 0,
    "lounge": 0,
    "casual": 1,
    "smart casual": 2,
    "business casual": 2,
    "business": 3,
    "workwear": 3,
    "formal": 4,
    "cocktail": 4,
    "black tie": 5,
}
MAX_FORMALITY_SPREAD = 5
W_NEUTRAL_ANCHOR = 0.25
W_COLOR_FAMILY = 0.25
W_FORMALITY_COHERENCE = 0.25
W_OCCASION_OVERLAP = 0.25
W_CONTRAST = 0.4
W_STATEMENT_TAGS = 0.4
W_FORMALITY_DISTANCE = 0.2
PATH_RELIABLE_MIN = 0.66
PATH_STRETCH_MAX = 0.40
RISK_BOLD_MIN = 0.66
RISK_SAFE_MAX = 0.33
WEATHER_WARMTH_BAND = {"hot": (0, 3), "mild": (3, 6), "cold": (6, 10)}
WEATHER_TARGET_BAND = {"hot": 0, "mild": 1, "cold": 2}
WEATHER_MISMATCH_PENALTY = 0.5
```

Free-string lookups for the Spearhead constants use the response-layer `_norm_label` helper: trim,
lowercase, convert hyphens/underscores to spaces, and collapse internal whitespace before exact lookup.
Unknown formality is unranked; unmatched non-neutral colors map to `"other"`; no cold-start score filters a
candidate (§11/H20).
