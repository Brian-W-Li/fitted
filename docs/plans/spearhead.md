# Spearhead — orphan-item rescue (cold-start vertical slice)

> Active milestone plan. Canonical design lives in `docs/Fitted_Spec_v2.md`; this plan points to
> §sections where the canonical spec owns the decision. Build order is the checkpoint ladder in §C.

## Goal

Make rung 1 of the experience ladder (§3) real on the existing pure substrate: given a user-chosen
orphan item, produce ~3 believable, **spread** ways to wear it — day one, cold, no feedback — each
with a StyleMove. This proves the green-shirt promise end-to-end through `fitted_core` and is the seam
the trained scorer (M6) later plugs into.

This plan is written to be implemented by a different session, or split across several — each
checkpoint in §C is a session-sized unit with explicit deps, deliverables, and tests.

---

## A. Scope decisions

1. **Demo boundary** — pure-Python slice. GPT sits behind an injected `Generator` protocol; the pytest
   suite uses a stub, so the pipeline stays deterministic and hermetic. A *separate* real-OpenAI
   `Generator` + CLI is added to eyeball believability (H40). No Next wiring, no deploy, no live OpenAI
   in tests — that stays M5.
2. **Path/risk home** — a new **response module**, not the closed M3 ranker. It consumes `RankerResult`
   and assigns `optionPath`/`risk` post-rank. `ranker.py` is never touched.
3. **Feedback depth** — cold-start only (rung 1). Emit `baseKey`/`fullSignature` so feedback can bind
   later, but the like → affinity → de-orphan loop is M4. No interaction storage here.
4. **Orphan input** — forced item is **given** (`forcedItemId`). Auto-detecting orphans (H21) is later.
5. **Path diversity** — GPT is instructed to return a **range of vibes** (everyday → adventurous) as a
   generation goal; **Python assigns the labels**. Variety is allowed (§12 "maximize diversity"); the §5
   rule that GPT never *ranks/labels* paths holds.
6. **Headline axis** — surface a **2-D spread** across both `optionPath` (reliable/bridge/stretch) *and*
   `risk` (safe/noticeable/bold): target distinct (path, risk) cells so the 3 ways feel genuinely
   different.
7. **Constraints** — **weather + occasion only**. Weather is a **high-priority prompt instruction** (§12
   precedence) and warmth-vs-weather is a **soft scoring penalty** in the response layer — *not* a hard
   pool filter (a hard `warmth` cutoff over a 0–10 scale is brittle and risks false `notEnoughItems`).
   `no_buy` is automatic (owned items only). The richer ConstraintSet defers to B-track/M5.
8. **StyleMove** — **required in the prompt; an outfit missing one (after the single §12 repair) is
   dropped** from the surfaced set. Holds the "I understood the one thing that made it work" promise.

---

## B. Module layout & contracts

Three new modules, role-named to match the existing scaffolding (`sampler`/`validator`/`ranker`). The
GPT seam is its own general module (reused by `daily`/`upgrade`/`translate` later), not buried in
rescue. **Canonical response object is `OutfitVariant` (§6.5), not a rescue-specific name.**

### `generation.py` (new — the general GPT seam, §9 Step 2)

```
class Generator(Protocol):                      # mirrors sampler.SignalScorer's seam style
    def generate(self, prompt: GenerationPrompt) -> str: ...   # returns RAW response text (JSON)

@dataclass(frozen=True)
class GenerationPrompt:                          # what a Generator is handed (pure, serializable)
    system: str
    user: str
    candidate_requested: int                     # upper-bound hint passed through to the validator

class OpenAIGenerator:                           # the ONLY module importing `openai` / doing IO
    def __init__(self, *, model: str, temperature: float, ...): ...
    def generate(self, prompt) -> str: ...       # one §12 JSON-repair retry lives in rescue(), not here
```

- `StubGenerator` (returns canned JSON) lives in `tests/` helpers. A CLI `--dry-run` path uses a small
  non-test fixture generator in `cli.py` or `generation.py`, so runtime code never imports from `tests/`.
- `import openai` is **lazy/local** to `OpenAIGenerator` so `fitted_core` imports with the dep absent.

### `rescue.py` (new — the rescue intent + orchestration)

```
@dataclass(frozen=True)
class RescueRequest:                             # the rescue-layer input; builds the sampler RequestContext
    wardrobe: list[WardrobeItem]
    forced_item_id: str
    occasion: str                                # normalized verbatim (caller/M5 adapter owns R5 normalization)
    weather: str                                 # canonical bucket: hot|mild|cold|indoor|outdoor
    session_id: str
    wardrobe_version: int
    generation_index: int = 0                    # re-roll lever → RankerContext (H7 range/lifecycle is M5)
    k: int = DEFAULT_K
    n_surfaced: int = N_SURFACED
    date: Optional[str] = None

@dataclass(frozen=True)
class RescueResult:
    variants: tuple[OutfitVariant, ...]          # the surfaced set (≤ n_surfaced), spread order
    not_enough_items: bool                       # PRE-GPT structural insufficiency (template can't be built)
    insufficient_after_generation: bool          # POST: GPT/filters/rank left fewer than n_surfaced
    spread_collapsed: bool                        # could not fill distinct (path,risk) cells
    reason_hint: Optional[str]                   # e.g. "add a bottom" — user-facing, never silent
    fallback_stage: Optional[FallbackStage]      # None before rank(); otherwise RankerResult diagnostic

def rescue(request: RescueRequest, generator: Generator) -> RescueResult: ...
```

Internal helpers (all pure except where they call `generator`): `_resolve_shape(forced_type: ItemType) ->
(allowed_templates, valid_types)`, `_check_sufficiency(counts, forced_type) -> Optional[hint]`,
`_scope_pool_to_forced(pool, forced_item, valid_types) -> dict[ItemType, list[WardrobeItem]]` (forced
item's type → exactly `[forced_item]`; invalid types → `[]`; usable sibling types kept as sampled — this is
the rescue "pin," idempotent and duplicate-free by construction), `_flatten_pool(scoped) ->
list[WardrobeItem]` (the `sampled_pool` arg for `validate_gpt_payload`; no duplicate ids by construction),
`_rescue_candidate_requested(scoped, forced_type) -> int`, `_build_prompt(scoped, request, forced_item) ->
GenerationPrompt`, `_drop_invalid(candidates, forced_item.id) -> list[ValidatedCandidate]` (forced-item +
StyleMove presence).

### `response.py` (new — the general response layer, §9 Step 7; the §11/H20 scoring heart)

```
@dataclass(frozen=True)
class OutfitVariant:                             # §6.5 canonical response object
    items: tuple[tuple[str, Role], ...]          # ordered: base roles first, then outer, then shoes (§6.5)
    template: Template
    option_path: OptionPath                      # Enum: reliable | bridge | stretch
    risk: Risk                                   # Enum: safe | noticeable | bold
    style_move: FrozenStyleMove                  # required (decision 8) — never None on a surfaced variant
    score: float                                 # carried from RankedOutfit
    score_breakdown: ScoreBreakdown
    base_key: str
    full_signature: str
    compatibility: float                         # [0,1] cold-start content score (debug/eval; the M6 seam)
    visibility: float                            # [0,1] cold-start boldness score

def compatibility(slot_map, items_by_id, request) -> float: ...     # pure, [0,1] — §G defined form
def visibility(slot_map, items_by_id, request) -> float: ...        # pure, [0,1] — §G defined form
def assign_path(compat: float) -> OptionPath: ...                   # Appendix B threshold buckets
def assign_risk(vis: float) -> Risk: ...
# re-sorts survivors by (ranker_score desc, compatibility desc, full_signature asc), then opens
# distinct (path,risk) cells up to n; returns (variants ≤ n, spread_collapsed). See §G.
def select_spread(
    ranked: RankerResult,
    variants_by_full_signature: Mapping[str, OutfitVariant],
    n: int,
) -> tuple[list[OutfitVariant], bool]: ...
```

`variants_by_full_signature` contains exactly one assembled `OutfitVariant` for each `RankedOutfit` in
`ranked.outfits`; `select_spread` is selection-only and never recomputes scores.

`OptionPath` / `Risk` are new `Enum`s homed in **`response.py`** (only the response layer needs them;
keeping them out of `models.py` preserves the M0 closed contract — nothing in M0–M3 is touched). Values
are the §6.5 labels (`reliable|bridge|stretch`, `safe|noticeable|bold`).

### `config.py` (edited — new constants, same module-level pattern, regression-guarded in `test_config.py`)

C1 adds the Spearhead rescue constants listed in `docs/Fitted_Spec_v2.md` Appendix B, which is the single
home for exact config values. They are **provisional, tuned in C6 eval** — starting points, not law. The
scoring forms in §G define how those constants are consumed.

### NOT touched (M0–M3 closed contracts — consumed, never modified)

`ranker.py`, `sampler.py`, `validator.py`, `keys.py`, `slotmap.py`, `seed.py`, `models.py` (**none**
touched — `OptionPath`/`Risk` are homed in `response.py`, not `models.py`, to keep the M0 contract
closed). The 486 existing tests must stay green and unchanged.

---

## C. Checkpoint ladder (build order)

Mirrors the M2/M3 cadence. Each row is session-sized; deps are strict unless noted parallel-ok.

| C | Deliverable | Depends on | Tests (the gate) |
|---|---|---|---|
| **C1** | `generation.py`: `Generator` protocol, `GenerationPrompt`, `OpenAIGenerator` (lazy `openai` import), `StubGenerator` test helper. `config.py` new constants + `test_config.py` regression (incl. caps-sum still holds). | — | stub returns canned JSON; `fitted_core` imports with `openai` absent; constants present/typed. |
| **C2** | `rescue.py` pre-GPT half: `RescueRequest`, `_resolve_shape`, `_check_sufficiency`, build sampler `RequestContext`, `_scope_pool_to_forced` + `_flatten_pool`, `_rescue_candidate_requested`. | C1 | allowed template(s) + valid_types per `ItemType`; the four insufficiency branches; scoping sets the forced item's type to exactly `[forced_item]`, drops invalid types, keeps siblings, `prompt_item_count ≤ MAX_PROMPT_ITEMS`, flattened pool has **no duplicate ids even when the forced item was also sampled**; rescue count follows the scoped formula including the floor/cap cases (it may exceed the generic sampler count in tiny closets). |
| **C3** | `_build_prompt` (pure) + the prompt artifact (§D). | C1 (parallel with C2) | prompt contains forced-item rule, vibe-range, styleMove-required, every pool id; input items strip `imageUrl`/`warmth` (§12); output-schema instruction (`{itemId, role}` only, no extra/forbidden fields); golden prompt snapshot. |
| **C4** | `rescue()` orchestration: generate → `parse_gpt_json` (one §12 repair) → `validate_gpt_payload` → `_drop_invalid` (forced + StyleMove presence) → `rank`. | C2, C3 | end-to-end with `StubGenerator`; drops candidates missing forced item / StyleMove; repair path; empty-after-filter → `insufficient_after_generation`; determinism (stub, fixed `generation_index`). |
| **C5** | `response.py`: `compatibility`, `visibility` (the §G defined forms), `assign_path`/`assign_risk`, weather penalty + `[0,1]` clamp, `select_spread` (compatibility-led cold ordering), `OutfitVariant` assembly + slot_map→ordered items. Wire into `rescue()`. | C4 | each scoring term at its edge cases (single-item outfit, all-attributes-missing, neutral-only, family clash); purity/determinism; clamp keeps `[0,1]`; bucketing at thresholds; spread spans cells; collapse flag; compatibility-led order under flat ranker scores; item ordering (§6.5); `score == breakdown` sum preserved. |
| **C6** | Eval harness + golden corpus + believability rubric (§E) + `cli.py` demo. H40 measurement run. Doc updates (§F) — **reported, not auto-applied**. | C5 | corpus runs through real validator; metrics computed; CLI prints variants; (believability is manual/descriptive). |

C1–C5 are the shippable engine (fully testable with the stub). C6 is the real-GPT + eval + docs layer.

---

## D. Prompt specification (the believability surface)

The exact wording iterates in C6 eval; this is the **contract** a session must not improvise. Each pool
item is serialized as **read-only input attributes** — `id, name, type, style_tags, color_tags,
occasion_tags, material, formality` (`imageUrl`/`warmth` stripped per §12's GPT-payload rule; `name`
kept — rich styling signal). These input fields are **not** the output schema: GPT echoes back only
`itemId` + `role` (§12), so the prompt must state the attributes are for selection only and must **not**
be copied into the output items — an echoed attribute makes the item object `{itemId, role, …}`, which
the validator rejects as `unknownItemField` and drops the **whole** candidate.

**System prompt (hard rules — carried from §12):**
- You are a personal stylist. Compose outfits **only** from the provided wardrobe items, by their ids.
- Every outfit is **two_piece** (1 base_top + 1 base_bottom) **XOR one_piece** (1 dress); 0–1 outer;
  0–1 shoes; no duplicate items.
- **Every outfit MUST include the forced item id `<forcedItemId>`.**
- Return a **range of vibes** across your outfits — from everyday/expected to adventurous — so the user
  sees genuinely different ways to wear the piece. (Do **not** label, score, or rank them.)
- **Every outfit MUST include a `styleMove`**: the single concrete styling idea that makes it work
  (`moveType`, `changedItemIds` ⊆ the outfit's items, `oneSentence`).
- Respect the weather and occasion given. Treat weather as high-priority styling context.
- Return **strictly valid JSON only**, exactly `{"outfits":[{"items":[{"itemId","role"},...],
  "styleMove":{"moveType","changedItemIds","oneSentence"}}, ...]}`. No prose. Emit **only** these keys —
  every other field is rejected. Do **not** add `score`/`rank`/`optionPath`/`risk`/`vibe`/`label`; the
  "range of vibes" is expressed by the outfits themselves and is **never** annotated with a field; do
  **not** copy item input-attributes into the output items. `styleMove` has **exactly** three keys; an
  item has **exactly** `itemId` + `role` (a present-but-malformed `styleMove` is dropped, and decision 8
  then drops the outfit).

**User message:** the Lens (occasion text, weather bucket), the forced item (called out explicitly),
the bounded pool as the serialized item list, and "return up to `<candidateRequested>` outfits."

**Roles** use the backend `Role` values (`base_top`, `base_bottom`, `one_piece`, `outer_layer`,
`shoes`). The output flows straight into the existing `parse_gpt_json` → `validate_gpt_payload`.

---

## E. Eval harness & H40 (C6)

The strict validator **is the oracle** — most of pressure-testing is automatable.

- **Stress corpus** (`tests/fixtures/corpus/`): sparse closet · monochrome/bland (stresses spread) ·
  high-contrast/colorful · dress-heavy · items with **missing attributes** (CV-failure case) · forced
  item of **each** `ItemType` · the genuinely-hard styling case. Each concrete failure becomes a
  **regression fixture for `StubGenerator`** (live findings flow back into the hermetic suite).
- **Mechanical metrics** (run real generator K× per case → pipe through the validator, histogram
  `IssueCode`): JSON-parse rate; rejection histogram; forced-item-inclusion rate; StyleMove-presence
  rate; id-hallucination rate; structural-validity rate; **spread** = distribution of computed
  (path,risk) cells; run-to-run variance (→ H4); tokens + latency p50/p95 + $/rescue.
- **Prompt A/B**: ablate one lever at a time (vibe-range on/off, zero- vs one-shot, JSON-vs-table item
  serialization, strict-JSON phrasing); pick the variant that maximizes mechanical conformance.
- **Believability rubric** (small-N, human; the irreducible part): stylist-endorse (1–5), StyleMove
  names a real correct reason (1–5), the "bold/stretch" option is a believable stretch not absurd. An
  optional LLM-judge may scale it **only after** validation against the human ratings on a subset.
- **H40 verdict**: if text-only generation underdelivers on believability, the spec's escape hatch is
  to promote a vision-capable generator (H33) — recorded, not built here.

---

## F. Doc-sync impacts (owner: Brian)

This section is the landing checklist only; current design authority is §B/§G and
`docs/Fitted_Spec_v2.md`.

**Pending on-landing** (when the milestone completes; not yet applied):
- **`Fitted_Spec_v2.md` §20** — flip Spearhead → ✅ done; note the **three** new modules
  (`generation`/`rescue`/`response`) + the `Generator` seam.
- **`ml-system/README.md`** — add the rescue vertical + the `Generator` seam to the module list.
- **`docs/README.md`** — move Spearhead from current build target to completed milestone reference.

---

## G. rescue() pipeline (reference — the C2→C5 wiring)

1. **Resolve forced item** — must be in `wardrobe` (else `ValueError`, caller misuse — fail loud like
   the sampler's duplicate-id guard). `ItemType` → **allowed template(s)** + **valid pool types** (H22):
   `top`→`{two_piece}` (needs a bottom; valid types = top, bottom, outer, shoes); `bottom`→`{two_piece}`
   (top, bottom, outer, shoes); `dress`→`{one_piece}` (dress, outer, shoes — drop tops/bottoms);
   `outer_layer`/`shoes`→`{two_piece, one_piece}` (needs *some* valid base; valid types = all five). The
   valid-types set drives both the sufficiency check (step 2) and the pool scoping (step 4).
2. **Sufficiency check** (on full partitioned counts, pre-sampling — capping never removes a non-empty
   type): forced top ⇒ `bottoms ≥ 1`; forced bottom ⇒ `tops ≥ 1`; forced dress ⇒ always ok; forced
   outer/shoes ⇒ `(tops≥1 and bottoms≥1) or dresses≥1`. Fail ⇒ `RescueResult(not_enough_items=True,
   reason_hint=…, fallback_stage=None)` **before any GPT call**. This **is** the H22 min-closet rule.
3. **Pool prep** — `build_candidate_pool(wardrobe, ctx, ColdStartSignalScorer())` for the seeded, capped
   per-type sampling (cold start → signal slot always seeded-random, `interaction_count=0`). Rescue
   **ignores** the sampler's own `candidate_requested`/`not_enough_items` (general-flow values) and
   recomputes both for rescue (step 2 sufficiency, step 5 count).
4. **Scope the pool to the forced item** — `_scope_pool_to_forced(pool, forced_item, valid_types)`: set the
   forced item's own type to **exactly `[forced_item]`** (one base/optional slot can hold only the forced
   item, so its siblings can never co-occur with it), set types that cannot appear in any valid template
   around it to `[]` (forced top/bottom → drop dresses; forced dress → drop tops+bottoms; forced
   outer/shoes → keep all base types), and keep the remaining usable types as sampled. This **is** the
   rescue "pin": the forced item is in the pool by construction, idempotent (a no-op even if it was also
   sampled), and the flattened pool (`_flatten_pool`, the `sampled_pool` arg for the validator) has **no
   duplicate ids** — so `validate_gpt_payload`'s duplicate-id guard never trips. Scoping only *removes*
   items, so `prompt_item_count ≤ MAX_PROMPT_ITEMS` still holds. *(This replaces a general pool full of
   unusable items — e.g. every top/bottom for a forced dress — that would waste tokens and produce
   `mixedTemplate` / forced-item-missing rejects; the bound is now the relevant items only.)*
5. **Rescue `candidate_requested`** — recompute from the **scoped** pool counts (rescue wants only
   forced-item outfits; the sampler's general `total_base*3` over-asks and inflates tokens/repetition).
   Let `complementary` = the count of the *other* base type for a forced base (forced top → scoped
   bottoms; forced bottom → scoped tops), `1` for a forced dress, and `(tops×bottoms)+dresses` over the
   scoped pool for forced outer/shoes (all bases it can layer onto). Then `candidate_requested =
   clamp(complementary*3, MIN_RESCUE_CANDIDATES, MAX_CANDIDATES)` — the floor preserves a 3-cell spread on
   a tiny closet; the cap matches §10. It is an upper-bound hint (§12): asking for more than GPT can build
   is harmless (extras sliced with a warning), so the floor is the load-bearing half.
6. **Build prompt** (§D) → `generator.generate(...)` → raw JSON.
7. **Parse + validate** — `parse_gpt_json` → `validate_gpt_payload(payload, _flatten_pool(scoped),
   candidate_requested)`. The "one §12 repair" on `invalidJson` is a **single re-generation call** owned
   by `rescue()`: re-issue `generator.generate(...)` with a repair-augmented prompt (a `GenerationPrompt`
   whose system text appends "your previous output was not valid JSON — return only strict JSON in the
   required shape"). `GenerationPrompt` carries no slot for the prior raw output, so this is a **blind
   re-generation**, not a diff-repair — sufficient for the JSON-format failure §12 allows. The pure
   validator never does network repair (§13). One retry only; still invalid → graceful fallback. The
   stub makes this path deterministically testable (a canned invalid-then-valid pair; see the
   determinism note in §J).
8. **Filter** — drop candidates whose items omit the forced item, or whose `style_move is None`
   (decisions 8 / §12), **before ranking**.
9. **Rank** — `rank(survivors, ctx)` where `ctx = RankerContext(session_id=request.session_id,
   wardrobe_version=request.wardrobe_version, occasion=request.occasion, weather=request.weather,
   date=request.date, generation_index=request.generation_index, k=request.k)`. All of
   `session_id`/`wardrobe_version`/`occasion`/`weather`/`generation_index` are **required (no default)**
   and keyword-only (ranker.py); the behavioral-signal collections are left at their empty defaults
   (cold start). `request.k` defaults to `DEFAULT_K=10` (see the rescue-`k` note below).
10. **Response** — for every ranked survivor compute `compatibility`/`visibility` (the §G defined forms;
    the weather penalty is already inside `compatibility`), then `assign_path`/`assign_risk`, then
    `select_spread` (below) picks ≤ `n_surfaced` spanning distinct `(path, risk)` cells, then assemble
    `OutfitVariant`s (slot_map → §6.5-ordered items). Output carries **content keys only** (baseKey +
    fullSignature); a server-issued outfit id for feedback binding is H7/M5.

### Cold-start scoring — the heart (§11/H20), a deliberately humble baseline

Pure functions over the outfit's resolved items (`items_by_id[id]` for each filled slot); v1 is
hand-built heuristics (the only option cold — no model, no embeddings) that the M6 scorer replaces at
this seam. The **functional form is fixed here**; only the Appendix B weights/thresholds/taxonomies are
tuned in C6. Both return `[0,1]` (final `max(0.0, min(1.0, x))` clamp). Shared primitives:

- `_norm_label(s)` → `s.strip().lower()`, hyphens/underscores converted to spaces, internal whitespace
  collapsed; all free-string lookups below use this normalized label.
- `_color_families(item)` → the set of families its non-neutral normalized `color_tags` map through
  `COLOR_FAMILIES` (an unmatched non-neutral word → `"other"`); neutral words (in `NEUTRAL_COLORS`)
  contribute no family.
- `_is_neutral(item)` → `True` iff any normalized `color_tag ∈ NEUTRAL_COLORS`.
- `_rank(item)` → `FORMALITY_RANK.get(_norm_label(item.formality))` or `None` (unknown/None never counts).
- `_warmth_band(w)` → `0` if `w < 3`, `1` if `3 ≤ w < 6`, `2` if `w ≥ 6` (the `WEATHER_WARMTH_BAND`
  boundaries); `_target_band(weather)` → `WEATHER_TARGET_BAND.get(weather)` (`0/1/2` for hot/mild/cold,
  `None` for indoor/outdoor).
- pairs = all unordered item pairs; an `n`-item outfit has `C(n,2)` (a lone dress has 0).

**compatibility** = `clamp01( W_NEUTRAL_ANCHOR·neutral + W_COLOR_FAMILY·cohesion + W_FORMALITY_COHERENCE·
formality + W_OCCASION_OVERLAP·occasion − weather_penalty )`, each term in `[0,1]`:
- **neutral** = (# items with a neutral color) / (# items) — a grounding neutral reads as safe/expected.
- **cohesion** = (# cohesive pairs) / (# pairs); a pair is **cohesive** if it shares a family, OR either
  item is neutral, OR either has no color info (missing CV data never penalizes). **0 pairs → 1.0**.
- **formality** = `1 − spread/MAX_FORMALITY_SPREAD` where `spread = max(ranks) − min(ranks)` over items
  with a known `_rank`; **fewer than 2 known ranks → 1.0** (can't measure incoherence).
- **occasion** = (# items "occasion-ok") / (# items); an item is occasion-ok if its `occasion_tags` is
  empty (no signal → don't penalize) OR shares ≥1 whitespace-token with the lensed `occasion` text
  (already trim/lowercased, §6.3); empty lens occasion → 1.0.
- **weather_penalty** = `WEATHER_MISMATCH_PENALTY × max_over_items |_warmth_band(item.warmth) −
  _target_band(weather)|` when `_target_band` is not `None` (hot/mild/cold), else `0`. The **max** (not
  sum) lets one parka-in-July item define the mismatch without compounding; band-distance `0–2` →
  penalty `0–1.0`, and the final clamp keeps compatibility in `[0,1]`.

**visibility** = `clamp01( W_CONTRAST·contrast + W_STATEMENT_TAGS·statement + W_FORMALITY_DISTANCE·
distance )`, orthogonal to compatibility, each term in `[0,1]`:
- **contrast** = (# contrasting pairs) / (# pairs); a pair **contrasts** iff both items are non-neutral,
  both have color info, and their family sets are **disjoint**. **0 pairs → 0.0** (a lone item has no
  pairing contrast; its boldness rides on `statement`).
- **statement** = (# items with a `BOLD_STYLE_TAGS` member in `style_tags`) / (# items).
- **distance** = `spread/MAX_FORMALITY_SPREAD` (the same formality `spread`; **<2 known ranks → 0.0**) —
  mixing dressy + casual registers reads as deliberately noticeable. *(This is the outfit's internal
  formality spread, not "distance from the occasion": there is no formality ontology on the free-text
  occasion side at `[NOW]`; an occasion→formality prior is deferred with the StyleProfile/B-track.)*

- **path** = `assign_path(compatibility)`; **risk** = `assign_risk(visibility)` (the Appendix B threshold
  buckets).

Sanity at the extremes (the §E corpus cases): an all-attributes-missing outfit scores `cohesion =
formality = occasion = 1`, `neutral = 0` → compatibility ≈ `0.75` (minus weather) and `contrast =
statement = distance = 0` → visibility ≈ `0` → it surfaces as **reliable + safe**, the correct humble
default for a featureless outfit.

**Trap-guard — bucket, never gate (protects the ambition's "contextual relationships, not universal
rules," appendix C.2 / §22 non-goal).** These heuristics encode a conventional prior (matchy colors +
coherent formality read as *expected*; clashing colors / register-mixing read as *bolder*). That is
acceptable **only because they position, never forbid**: their sole job is to assign a `(path, risk)`
cell, so a "clashing" outfit surfaces as a believable *stretch + bold* way to wear the item, not a
rejected one. They must **never** become a quality filter or candidate gate — gating on them would impose
exactly the objective-fashionability rule the spec (§22) and the ambition (C.2) bar. Structural validity
(§13) is the only filter; the learned M6 scorer replaces these conventions with contextual, per-user
compatibility at the same seam (the constants are starting points tuned in C6, not law).

### Where cold-start ordering lives (resolved architectural ambiguity)

At cold start the **ranker is nearly inert** — affinity/cooldown/dislike/shown-history all empty, so
candidates score a ~flat `baseScore` and the ranker only dedupes/diversifies; its seeded tie-break order
among flat scores is essentially arbitrary. So `select_spread` does **not** inherit that order — it
re-sorts the ranker's survivors by **`(ranker_score desc, compatibility desc, full_signature asc)`**
before opening cells. This single key reconciles both regimes and stays fully deterministic (no new RNG;
`full_signature` is unique per pass, M2 dedup):
- **cold** (flat ranker scores) → `compatibility` is the effective sort key, so the response layer's
  content score genuinely orders the surfaced outfits;
- **warm** (real ranker scores, `[NEXT]`/M6) → the ranker score leads and `compatibility` is only the
  tie-breaker — it degrades correctly with no code change.

Feeding outfit-level compatibility *into* the ranker is H28's pairwise hook, **deferred to M5/M6**, so
compatibility stays strictly post-rank.

### 2-D spread selection

Over the survivors **re-sorted by `(ranker_score desc, compatibility desc, full_signature asc)`** (above),
greedily take the first that opens a new `(path, risk)` cell, up to `n_surfaced`. If distinct cells can't
be filled (clustered/bland closet), fall back to the top-`n_surfaced` in that same order and set
`spread_collapsed=True`. Fully deterministic (no new RNG); never pads with duplicates.

### Forced-item ↔ ranker interaction (documented, not a code change)

The forced item is in **100%** of rescue candidates, so the ranker's overuse mechanic
(`OVERUSE_THRESHOLD=0.40`, fires when survivors > `OVERUSE_MIN_POOL=15`) flags it in every outfit. The
penalty is **uniform**, so relative ranking is unaffected — accepted as harmless for Spearhead. A
forced-item *exemption* is a future refinement (§23-H42), **not** built here (would reopen the
closed M3 contract).

### Rescue's `k` vs `n_surfaced`, and reading `fallback_stage` (documented, not a code change)

Rescue hands the ranker `k = DEFAULT_K (10)`, **not** `n_surfaced (3)`: `select_spread` needs a *pool*
larger than 3 to choose a spanning spread from, so the ranker should return its full ranked list (≤10)
and rescue spread-selects 3. A consequence is that the ranker's `k`-relative diagnostics fire on healthy
rescues. `RankerResult.insufficient_wardrobe` is `len < 10`, so it is almost always `True` for a small
rescue pool — **rescue therefore ignores it** and derives its own `insufficient_after_generation` as
`len(surfaced) < n_surfaced`. Once ranking is reached, `RescueResult.fallback_stage` is carried straight
from the ranker as a **raw diagnostic of how hard the ranker worked to fill 10**, never a user-facing
rescue-health signal; on pre-rank `not_enough_items` exits it is `None`. For small pools it will commonly
read `variant_cap_relaxed`/`cooldown_relaxed`/`insufficient` even when 3 good variants surfaced — expected,
not a defect.

**Forced-dress sub-case.** A forced dress is the whole `one_piece` base, so every rescue candidate shares
the **same `BaseKey` (`dressId`)** (keys.py). `BASEKEY_VARIANT_CAP=2` then caps normal Step-6 at 2
survivors, and the ranker routinely reaches the `variant_cap_relaxed` rung to re-admit the rest — again
expected for forced-dress, not a degradation (the variants still differ by outer/shoes → different
`compatibility`/`visibility` → different `(path, risk)` cells).

---

## H. Edge cases

| Trigger | Behavior | Why |
|---|---|---|
| Forced item not in wardrobe | `ValueError` before any work | Programming error; fail loud (matches sampler duplicate-id guard) |
| Forced top + 0 bottoms (or forced bottom + 0 tops) | `not_enough_items`, pre-GPT, with hint | Can't build a two_piece around it; never silently drop the forced item (H22) |
| Forced dress, otherwise empty closet | Buildable (one_piece is a complete base) | A dress alone is a valid outfit |
| Forced outer/shoes, no valid base | `not_enough_items` | An optional role can't stand alone |
| Forced item dropped by cap sampling | Pool scoped: forced item's type set to exactly `[forced_item]` | In the pool by construction; flattened pool stays duplicate-free and ≤ `MAX_PROMPT_ITEMS` |
| GPT omits forced item, or omits StyleMove | Candidate dropped (step 8) | Rescue + "explain it" contract (§12 / decision 8) |
| All candidates drop / GPT returns nothing usable | `insufficient_after_generation=True` + message, after the one repair | Graceful, never a 500 |
| Invalid/garbled GPT JSON | `invalidJson` → one §12 repair → still invalid → graceful fallback | §12/§13 contract |
| Closet can't fill distinct (path,risk) cells | top-N in `select_spread`'s re-sorted order, `spread_collapsed=True` | No crash, no duplicate padding |
| Fewer than `n_surfaced` distinct outfits survive | Return 1–2, `insufficient_after_generation=True` | Honest partial |
| Real generator without key / `openai` uninstalled | Clear error in the **CLI path only**; core + stub tests never import `openai` | Hermetic substrate |

---

## I. Out of scope

Live OpenAI in tests; GPT reproducibility/determinism (H4); Next / `USE_ML_SHORTLISTER` wiring; deploy
(all M5). M4 interaction storage, `ItemAffinity`, the like→de-orphan loop, GenerationSnapshot
persistence, server-issued outfit id (H7), feedback-authenticity gate (all M4). Orphan auto-detection
(H21). The richer ConstraintSet beyond weather (B-track/M5). The outfit-level/pairwise ranker hook (H28,
H42). Board/routine scoped feedback, `matchedTraits`/`missingTraits` (no StyleProfile yet — B-track).
Any change to M0–M3 modules.

---

## J. Verification plan

- `cd ml-system && python3 -m pytest -q` — full suite green (the 486 unchanged + new
  `test_generation.py` / `test_rescue.py` / `test_response.py`).
- Per-checkpoint gates: the §C "Tests" column.
- **Determinism:** two identical `rescue(...)` calls compare equal **when the injected stub's output is a
  pure function of its input** (e.g. a `StubGenerator` returning the same canned JSON each call). The
  repair-path stub (canned **invalid-then-valid**) is call-count *stateful* by design, so it is used in
  its own repair test, **not** in the determinism comparison (or each call gets a fresh stub) — otherwise
  the second call would advance past the invalid output.
- **Dependency:** `OpenAIGenerator` + `cli.py` add `openai` to `ml-system/requirements.txt`; the import
  is lazy/local (§B) so the core package + the stub suite import with `openai` absent.
- Manual / H40: `python -m fitted_core.cli --closet tests/fixtures/corpus/green_shirt.json` (needs
  `OPENAI_API_KEY`) → record believability as descriptive evidence; the §E mechanical metrics quantify
  prompt conformance.

## K. Open questions

None blocking the engine (C1–C5). Fixed defaults: H22 min-closet = the insufficiency check; H20 path/risk
= feature-set + 2-D shape fixed (the §G functional forms, Appendix B constants tuned in C6);
forced-item/overuse = accepted uniform, exemption deferred as H42. The carry-forward *risk* (not a
question, validated in C6): whether GPT honors "include the forced item + spread vibes + always emit a
styleMove" from text-only input — the H40 bet, measured on the corpus, not assumed.
