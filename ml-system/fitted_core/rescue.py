"""Orphan-item rescue — the pre-GPT half (v2 §11/§12; spearhead.md §G steps 1–5, C2).

The rescue intent: given a user-chosen orphan (``forced_item_id``), build ~3 believable,
spread ways to wear it cold (no feedback). This module owns the rescue-specific pool
shaping that wraps the closed M1 sampler — it **consumes** ``build_candidate_pool`` and
never modifies it (spearhead.md §B "NOT touched").

**C2–C5 scope (this file):** the pure pre-GPT helpers — forced-item resolution,
template/valid-type resolution (H22), the structural sufficiency check (the H22 min-closet
rule), the sampler ``RequestContext`` builder, the forced-item pool "pin"
(``_scope_pool_to_forced`` + ``_flatten_pool``), the rescue-specific candidate count (C2) —
plus ``_build_prompt`` and the §D prompt artifact (C3): a pure ``GenerationPrompt`` builder
over the scoped pool — plus the **C4** ``rescue()`` orchestration + ``RescueResult``: generate
→ ``parse_gpt_json`` (one §12 repair) → ``validate_gpt_payload`` → ``_drop_invalid`` (forced
item + StyleMove presence) → ``rank`` (§G steps 7–9) — plus the **C5** response wiring (§G step
10): ``rescue()`` hands the ranked survivors to ``response.build_variants``, which assembles the
§6.5 ``OutfitVariant``s (``optionPath``/``risk`` via the §G cold-start scoring) and
spread-selects ≤ ``n_surfaced`` spanning distinct ``(path, risk)`` cells. ``rescue()`` is the
only thing here that calls a ``Generator`` (an injected seam — never the network or ``openai``
directly); the path/risk scoring + ``select_spread`` themselves live in ``response.py`` (the
closed M0–M3 ranker is never touched).

Error model (package ``__init__.py``): a forced item absent from the wardrobe is
**caller-contract misuse → ``ValueError``** (matches ``sampler.reject_duplicate_ids``); the
data-driven "can't build around this orphan" outcome is the sufficiency **hint** (routine
control flow, surfaced as ``not_enough_items`` by the C4 orchestration — never a raise).

Sources: docs/Fitted_Spec_v2.md §11/§12 (rescue_item intent, H22), docs/plans/spearhead.md §G.
"""

import json
from dataclasses import dataclass, replace
from typing import Mapping, Optional, Sequence

from fitted_core.config import (
    DAILY_MAX_CANDIDATES,
    DEFAULT_K,
    MAX_CANDIDATES,
    MIN_RESCUE_CANDIDATES,
    N_SURFACED,
)
from fitted_core.generation import FinishStatus, GenerationPrompt, Generator
from fitted_core.models import IssueCode, ItemType, Role, SlotMap, Template, WardrobeItem
from fitted_core.ranker import (
    FallbackStage,
    RankAudit,
    RankerContext,
    RankerResult,
    rank,
    rank_with_audit,
)
from fitted_core.response import (
    BuildVariantsTrace,
    OutfitVariant,
    build_variants,
    build_variants_with_trace,
)
from fitted_core.reducers import BehavioralSignals
from fitted_core.sampler import (
    ColdStartSignalScorer,
    RequestContext,
    SamplerResult,
    SignalScorer,
    build_candidate_pool,
    partition,
    reject_duplicate_ids,
)
from fitted_core.validator import (
    ValidatedCandidate,
    ValidationResult,
    parse_gpt_json,
    validate_gpt_payload,
    validate_gpt_payload_with_trace,
)


@dataclass(frozen=True)
class RescueRequest:
    """The rescue-layer input (spearhead.md §B). Builds the sampler ``RequestContext``.

    ``occasion`` is normalized verbatim and ``weather`` is a canonical bucket
    (``hot|mild|cold|indoor|outdoor``) — the caller / M5 adapter owns R5 normalization,
    mirroring ``sampler.RequestContext``. ``generation_index`` is the re-roll lever (its
    H7 range/lifecycle is M5). ``k`` is the ranker's fill target (``DEFAULT_K=10``, NOT
    ``n_surfaced``: ``select_spread`` needs a pool larger than 3 to choose a spread from —
    spearhead.md §G "Rescue's k vs n_surfaced"); ``n_surfaced`` is the surfaced-set size.
    """

    wardrobe: list[WardrobeItem]
    forced_item_id: Optional[str]
    occasion: str
    weather: str
    session_id: str
    wardrobe_version: int
    generation_index: int = 0
    k: int = DEFAULT_K
    n_surfaced: int = N_SURFACED
    date: Optional[str] = None
    intent: str = "rescue_item"
    interaction_count: int = 0

    def __post_init__(self) -> None:
        self._validate_intent()
        self._validate_generation_index()
        self._validate_k()
        self._validate_n_surfaced()
        self._validate_interaction_count()

    def _validate_intent(self) -> None:
        if not isinstance(self.intent, str):
            raise TypeError(f"intent must be a str, got {type(self.intent).__name__}")
        if self.intent not in _SUPPORTED_INTENTS:
            raise ValueError(f"unsupported render intent {self.intent!r}")
        if self.intent == "rescue_item":
            if not isinstance(self.forced_item_id, str) or not self.forced_item_id.strip():
                raise ValueError("forced_item_id is required for rescue_item intent")
        elif self.forced_item_id is not None:
            raise ValueError(f"forced_item_id must be None for {self.intent} intent")

    def _validate_generation_index(self) -> None:
        gi = self.generation_index
        if gi is None:
            raise TypeError("generation_index must be a non-bool int, got None")
        if isinstance(gi, bool):
            raise TypeError("generation_index must be a non-bool int, got bool")
        if not isinstance(gi, int):
            raise TypeError(
                f"generation_index must be a non-bool int, got {type(gi).__name__}"
            )

    def _validate_k(self) -> None:
        k = self.k
        if isinstance(k, bool):
            raise TypeError("k must be a non-bool int, got bool")
        if not isinstance(k, int):
            raise TypeError(f"k must be a non-bool int, got {type(k).__name__}")
        if k <= 0:
            raise ValueError(f"k must be a positive int, got {k}")

    def _validate_n_surfaced(self) -> None:
        n = self.n_surfaced
        if isinstance(n, bool):
            raise TypeError("n_surfaced must be a non-bool int, got bool")
        if not isinstance(n, int):
            raise TypeError(f"n_surfaced must be a non-bool int, got {type(n).__name__}")
        if n <= 0:
            raise ValueError(f"n_surfaced must be a positive int, got {n}")
        # The surfaced set is selected FROM the ranked pool of ≤ k (§G "Rescue's k vs
        # n_surfaced"), so n_surfaced > k is an impossible budget: the ranker can never
        # return enough and every render would be marked insufficient_after_generation.
        # Fail loud at construction instead of silently degrading every response.
        if n > self.k:
            raise ValueError(
                f"n_surfaced={n} exceeds k={self.k}; the surfaced set is drawn from the "
                "ranked pool of at most k outfits, so this budget can never be met"
            )

    def _validate_interaction_count(self) -> None:
        count = self.interaction_count
        if isinstance(count, bool):
            raise TypeError("interaction_count must be a non-bool int, got bool")
        if not isinstance(count, int):
            raise TypeError(
                f"interaction_count must be a non-bool int, got {type(count).__name__}"
            )
        if count < 0:
            raise ValueError(f"interaction_count must be >= 0, got {count}")


RenderRequest = RescueRequest

_SUPPORTED_INTENTS = frozenset({"daily", "rescue_item", "outfit_upgrade", "translate"})


def _default_signal_scorer(signal_scorer: Optional[SignalScorer]) -> SignalScorer:
    return signal_scorer if signal_scorer is not None else ColdStartSignalScorer()


def _ensure_intent(request: RenderRequest, expected: str) -> None:
    if request.intent != expected:
        raise ValueError(f"{expected} renderer received {request.intent!r} request")


# ============================================================================
# §G step 1 — resolve the forced item + its template/valid-type shape (H22)
# ============================================================================

# The forced item's ItemType fixes the allowed template(s) and the pool types that can
# co-occur with it (spearhead.md §G step 1, v2 §12 H22). The valid-type set drives BOTH
# the sufficiency check (step 2) and the pool scoping (step 4):
#   top/bottom  → two_piece only; usable types are the bases + optionals (NO dress)
#   dress       → one_piece only; usable types are dress + optionals (NO top/bottom)
#   outer/shoes → either template (an optional role layered onto any valid base); all five
# A forced item's OWN type is listed valid here, then step-4 scoping pins it to exactly the
# forced item (its base/optional slot can hold only it, so its siblings can never co-occur).
_BASE_PLUS_OPTIONALS = frozenset(
    {ItemType.top, ItemType.bottom, ItemType.outer_layer, ItemType.shoes}
)
_DRESS_PLUS_OPTIONALS = frozenset({ItemType.dress, ItemType.outer_layer, ItemType.shoes})
_ALL_TYPES = frozenset(ItemType)

_SHAPE_BY_TYPE: dict[ItemType, tuple[frozenset[Template], frozenset[ItemType]]] = {
    ItemType.top: (frozenset({Template.two_piece}), _BASE_PLUS_OPTIONALS),
    ItemType.bottom: (frozenset({Template.two_piece}), _BASE_PLUS_OPTIONALS),
    ItemType.dress: (frozenset({Template.one_piece}), _DRESS_PLUS_OPTIONALS),
    ItemType.outer_layer: (frozenset({Template.two_piece, Template.one_piece}), _ALL_TYPES),
    ItemType.shoes: (frozenset({Template.two_piece, Template.one_piece}), _ALL_TYPES),
}


def _resolve_forced_item(wardrobe: list[WardrobeItem], forced_item_id: str) -> WardrobeItem:
    """Find the forced item in the wardrobe; raise on a missing id (spearhead.md §G step 1).

    Absence is **caller-contract misuse** (a programming error in the rescue caller), so it
    fails loud with ``ValueError`` like the sampler's duplicate-id guard — never a silent
    drop of the forced item the whole rescue is built around.
    """
    for item in wardrobe:
        if item.id == forced_item_id:
            return item
    raise ValueError(
        f"forced_item_id {forced_item_id!r} is not in the wardrobe — rescue() caller misuse"
    )


def _resolve_shape(
    forced_type: ItemType,
) -> tuple[frozenset[Template], frozenset[ItemType]]:
    """``ItemType`` → (allowed templates, valid pool types) for the rescue (H22, §G step 1)."""
    return _SHAPE_BY_TYPE[forced_type]


# ============================================================================
# §G step 2 — structural sufficiency (the H22 min-closet rule, pre-GPT)
# ============================================================================


def _partition_counts(wardrobe: list[WardrobeItem]) -> dict[ItemType, int]:
    """Per-type counts over the **full** wardrobe (pre-sampling) — the §G step-2 input.

    Sufficiency is checked on full partition counts, not the post-cap pool: capping never
    removes a non-empty type (a type with ≥1 item stays ≥1), so the ``≥1`` checks below are
    invariant to sampling — but the full count is the spec-faithful, sampling-independent
    source (spearhead.md §G step 2).
    """
    return {item_type: len(items) for item_type, items in partition(wardrobe).items()}


def _check_sufficiency(
    counts: Mapping[ItemType, int], forced_type: ItemType
) -> Optional[str]:
    """Can a valid outfit be built around the forced item? (H22, spearhead.md §G step 2).

    Returns ``None`` when buildable, else a short **user-facing hint** (never silent). This
    IS the H22 min-closet rule; the C4 orchestration turns a non-``None`` hint into
    ``RescueResult(not_enough_items=True, reason_hint=…, fallback_stage=None)`` **before any
    GPT call**.

    Rules (spearhead.md §G step 2):
      - forced **top**  ⇒ needs ``bottoms ≥ 1`` (something to pair the two_piece with);
      - forced **bottom** ⇒ needs ``tops ≥ 1``;
      - forced **dress** ⇒ always buildable (a one_piece is a complete base);
      - forced **outer/shoes** ⇒ needs SOME valid base: ``(tops≥1 and bottoms≥1) or dresses≥1``.
    """
    tops = counts.get(ItemType.top, 0)
    bottoms = counts.get(ItemType.bottom, 0)
    dresses = counts.get(ItemType.dress, 0)

    if forced_type == ItemType.top:
        if bottoms < 1:
            return "add a bottom to build an outfit around this top"
    elif forced_type == ItemType.bottom:
        if tops < 1:
            return "add a top to build an outfit around this bottom"
    elif forced_type == ItemType.dress:
        return None  # a dress is a complete one_piece base — always buildable
    else:  # outer_layer / shoes — an optional role can't stand alone, needs a base
        if not ((tops >= 1 and bottoms >= 1) or dresses >= 1):
            return "add a top and bottom, or a dress, to layer this onto"
    return None


# ============================================================================
# §G step 3 — build the sampler RequestContext (cold start)
# ============================================================================


def _build_request_context(request: RescueRequest) -> RequestContext:
    """``RescueRequest`` → the sampler's ``RequestContext`` (spearhead.md §G step 3).

    ``interaction_count`` is server-derived from the feedback reducer. At zero the sampler's
    30% signal slot stays unreachable; once M5 passes both enough interactions and an available
    scorer, this context opens the existing sampler seam without changing sampler internals.
    """
    return RequestContext(
        occasion=request.occasion,
        weather=request.weather,
        session_id=request.session_id,
        wardrobe_version=request.wardrobe_version,
        date=request.date,
        interaction_count=request.interaction_count,
    )


# ============================================================================
# §G step 4 — scope the sampled pool to the forced item (the rescue "pin")
# ============================================================================


def _scope_pool_to_forced(
    pool: Mapping[ItemType, list[WardrobeItem]],
    forced_item: WardrobeItem,
    valid_types: frozenset[ItemType],
) -> dict[ItemType, list[WardrobeItem]]:
    """Pin the forced item into the pool and drop unusable types (spearhead.md §G step 4).

    For each ``ItemType``:
      - the forced item's **own type** → exactly ``[forced_item]`` (one base/optional slot
        can hold only the forced item, so its siblings can never co-occur with it; this also
        re-includes the forced item if cap-sampling had dropped it — §H "Forced item dropped
        by cap sampling");
      - a type **not in ``valid_types``** → ``[]`` (it cannot appear in any valid template
        around the forced item — e.g. dresses for a forced top, tops/bottoms for a forced
        dress);
      - any remaining usable type → kept **as sampled**.

    This IS the rescue pin: the forced item is in the pool by construction, the op is
    idempotent (a no-op even if the forced item was also sampled), and the flattened pool
    (``_flatten_pool``) has **no duplicate ids** — so ``validate_gpt_payload``'s duplicate-id
    guard never trips. Scoping only *removes* items, so ``prompt_item_count ≤
    MAX_PROMPT_ITEMS`` still holds.
    """
    scoped: dict[ItemType, list[WardrobeItem]] = {}
    for item_type in ItemType:  # fixed enum order — matches partition/flatten ordering (R4)
        if item_type == forced_item.type:
            scoped[item_type] = [forced_item]
        elif item_type in valid_types:
            scoped[item_type] = list(pool.get(item_type, []))
        else:
            scoped[item_type] = []
    return scoped


def _flatten_pool(scoped: Mapping[ItemType, list[WardrobeItem]]) -> list[WardrobeItem]:
    """Flatten the scoped pool to one list — the ``sampled_pool`` arg for the validator.

    Iterates types in fixed enum order (R4); each type's items are already id-sorted by the
    sampler, so the order is deterministic. No duplicate ids by construction (spearhead.md
    §G step 4): an item has exactly one type, and the forced type holds exactly the single
    forced item.
    """
    flat: list[WardrobeItem] = []
    for item_type in ItemType:
        flat.extend(scoped.get(item_type, []))
    return flat


# ============================================================================
# §G step 5 — rescue-specific candidate count
# ============================================================================


def _rescue_candidate_requested(
    scoped: Mapping[ItemType, list[WardrobeItem]], forced_type: ItemType
) -> int:
    """How many outfit drafts to request from GPT, from the **scoped** pool (§G step 5).

    Rescue wants only forced-item outfits, so it recomputes the count rather than reusing
    the sampler's general ``candidate_requested`` (whose ``total_base*3`` over a full pool
    over-asks and inflates tokens/repetition). ``complementary`` = the number of distinct
    bases the forced item can complete:
      - forced **top** → scoped bottoms (each pairs with the single forced top);
      - forced **bottom** → scoped tops;
      - forced **dress** → ``1`` (the forced dress is the only base);
      - forced **outer/shoes** → ``(tops × bottoms) + dresses`` over the scoped pool.
    Then ``clamp(complementary*3, MIN_RESCUE_CANDIDATES, MAX_CANDIDATES)`` — the **floor** is
    load-bearing (preserves a 3-cell spread on a tiny closet, so the rescue count may exceed
    the generic sampler count); the cap matches §10. It is an upper-bound hint (§12): asking
    for more than GPT can build is harmless (extras sliced with a warning).
    """
    n_tops = len(scoped.get(ItemType.top, ()))
    n_bottoms = len(scoped.get(ItemType.bottom, ()))
    n_dresses = len(scoped.get(ItemType.dress, ()))

    if forced_type == ItemType.top:
        complementary = n_bottoms
    elif forced_type == ItemType.bottom:
        complementary = n_tops
    elif forced_type == ItemType.dress:
        complementary = 1
    else:  # outer_layer / shoes — every base it can layer onto
        complementary = n_tops * n_bottoms + n_dresses

    raw = complementary * 3
    return max(MIN_RESCUE_CANDIDATES, min(MAX_CANDIDATES, raw))


# ============================================================================
# §G step 6 — build the prompt (the §D believability surface, C3)
# ============================================================================

# The Role wire-values, in enum order, listed for GPT (drift-proof: derived from the
# closed Role enum, never re-typed — §D "Roles use the backend Role values"). Output
# items reference an item's id via the `itemId` key (the §12 output schema), distinct
# from the `id` key on the read-only input attributes below.
_ROLE_VALUES = ", ".join(role.value for role in Role)


def _serialize_pool_item(item: WardrobeItem) -> dict[str, object]:
    """One pool item as the §D **read-only input attributes** (spearhead.md §D, §12).

    Exactly the GPT-visible fields — ``id, name, type, style_tags, color_tags,
    occasion_tags, material, formality``. ``image_url`` and ``warmth`` are **stripped**
    (§12's GPT-payload rule: ``imageUrl`` is a token-cost deferral, H33; ``warmth`` is
    Python-only). ``name`` is **kept** — rich styling signal (§D). These attributes are
    for *selection only*; the prompt forbids copying them into the output items (an echoed
    attribute makes the item ``{itemId, role, …}``, which the validator rejects as
    ``unknownItemField`` and drops the whole candidate, §D). ``type`` is the wire value so
    it reads as the same token GPT uses for roles/templates.
    """
    return {
        "id": item.id,
        "name": item.name,
        "type": item.type.value,
        "style_tags": list(item.style_tags),
        "color_tags": list(item.color_tags),
        "occasion_tags": list(item.occasion_tags),
        "material": item.material,
        "formality": item.formality,
    }


def _build_system_prompt(forced_item: WardrobeItem) -> str:
    """The §D system prompt — the hard rules carried from §12 (spearhead.md §D).

    Pure and deterministic: a function of the forced item's id and type only. The
    forced-dress sub-case line is emitted **only** for a forced dress (the lone-``one_piece``
    outfit is the only single-item outfit that can occur), so an empty/absent
    ``changedItemIds`` can't silently drop the dress-alone variant (validator + decision 8).
    """
    lines = [
        "You are a personal stylist. Compose outfits ONLY from the wardrobe items provided, "
        "referencing each item by its id.",
        "",
        "Hard rules for every outfit:",
        f'- Every outfit MUST include the forced item, id "{forced_item.id}".',
        "- Each outfit is either two_piece (exactly 1 base_top + 1 base_bottom) XOR one_piece "
        "(exactly 1 dress); plus optionally 0-1 outer_layer and 0-1 shoes. Never repeat an "
        "item within an outfit.",
        f"- Each item's role is exactly one of: {_ROLE_VALUES}.",
        "- Every outfit MUST include a styleMove — the single concrete styling idea that makes "
        'it work — as {"moveType", "changedItemIds", "oneSentence"}. changedItemIds must be a '
        "NON-EMPTY subset of that outfit's own item ids.",
    ]
    if forced_item.type == ItemType.dress:
        lines.append(
            "- If an outfit is the dress alone (no outer_layer and no shoes), its "
            f'styleMove.changedItemIds must be exactly ["{forced_item.id}"] — it can never '
            "be empty."
        )
    lines += [
        "- Return a RANGE of vibes across your outfits, from everyday/expected to adventurous, "
        "so the user sees genuinely different ways to wear the forced item. Do NOT label, "
        "score, or rank them.",
        "- Respect the given weather and occasion; treat weather as high-priority styling context.",
        "",
        "Output format:",
        '- Return STRICTLY VALID JSON only, no prose, exactly: {"outfits":[{"items":'
        '[{"itemId","role"}, ...], "styleMove":{"moveType","changedItemIds","oneSentence"}}, '
        "...]}.",
        "- Each item object has EXACTLY two keys: itemId (the wardrobe item's id) and role. "
        "styleMove has EXACTLY three keys.",
        "- The item attributes above (name, type, tags, material, formality) are for SELECTION "
        "ONLY — do NOT copy them into the output items.",
        "- Do NOT emit any other field. Forbidden anywhere in the output: score, rank, "
        "optionPath, risk, vibe, label, imageUrl, warmth. Any extra field causes the whole "
        "outfit to be rejected.",
    ]
    return "\n".join(lines)


def _build_user_message(
    request: RescueRequest,
    forced_item: WardrobeItem,
    pool_json: str,
    candidate_requested: int,
) -> str:
    """The §D user message — Lens (occasion + weather), the forced item called out, the
    scoped pool, and the ``candidate_requested`` upper-bound ask (spearhead.md §D).

    Only weather + occasion are carried as context (decision 7: the richer ConstraintSet
    defers to B-track/M5). Pure and deterministic.
    """
    return "\n".join(
        [
            f"Occasion: {request.occasion}",
            f"Weather: {request.weather}",
            "",
            "Forced item — every outfit must include it:",
            f"  id={forced_item.id}, name={forced_item.name}, type={forced_item.type.value}",
            "",
            "Wardrobe items available for these outfits (attributes are for selection only):",
            pool_json,
            "",
            f"Return up to {candidate_requested} outfits.",
        ]
    )


def _build_prompt(
    scoped: Mapping[ItemType, list[WardrobeItem]],
    request: RescueRequest,
    forced_item: WardrobeItem,
) -> GenerationPrompt:
    """Build the rescue ``GenerationPrompt`` from the scoped pool (spearhead.md §D, §G step 6).

    Pure and deterministic — the prompt is a function of (scoped pool, request occasion/
    weather, forced item) only. The scoped pool is flattened in fixed enum/id order
    (``_flatten_pool``), and each item is serialized to the §D read-only attributes
    (``image_url``/``warmth`` stripped), so two identical calls yield byte-identical prompts.

    ``candidate_requested`` is recomputed here from the scoped counts (the §G step-5
    formula) and carried on the returned ``GenerationPrompt`` so the C4 orchestrator passes
    the *same* upper bound to ``validate_gpt_payload`` after generation — never recomputed
    twice and never desynced from the "return up to N" ask in the user message.
    """
    candidate_requested = _rescue_candidate_requested(scoped, forced_item.type)
    pool_items = [_serialize_pool_item(item) for item in _flatten_pool(scoped)]
    pool_json = json.dumps(pool_items, indent=2, ensure_ascii=False)
    return GenerationPrompt(
        system=_build_system_prompt(forced_item),
        user=_build_user_message(request, forced_item, pool_json, candidate_requested),
        candidate_requested=candidate_requested,
    )


def _build_daily_system_prompt() -> str:
    """The daily §D system prompt: same bounded composer, no forced-item contract."""
    lines = [
        "You are a personal stylist. Compose outfits ONLY from the wardrobe items provided, "
        "referencing each item by its id.",
        "",
        "Hard rules for every outfit:",
        "- Each outfit is either two_piece (exactly 1 base_top + 1 base_bottom) XOR one_piece "
        "(exactly 1 dress); plus optionally 0-1 outer_layer and 0-1 shoes. Never repeat an "
        "item within an outfit.",
        f"- Each item's role is exactly one of: {_ROLE_VALUES}.",
        "- Every outfit MUST include a styleMove -- the single concrete styling idea that makes "
        'it work -- as {"moveType", "changedItemIds", "oneSentence"}. changedItemIds must be a '
        "NON-EMPTY subset of that outfit's own item ids.",
        "- Return a RANGE of believable outfits, from everyday/expected to adventurous. Do NOT "
        "label, score, or rank them.",
        "- Respect the given weather and occasion; treat weather as high-priority styling context.",
        "",
        "Output format:",
        '- Return STRICTLY VALID JSON only, no prose, exactly: {"outfits":[{"items":'
        '[{"itemId","role"}, ...], "styleMove":{"moveType","changedItemIds","oneSentence"}}, '
        "...]}.",
        "- Each item object has EXACTLY two keys: itemId (the wardrobe item's id) and role. "
        "styleMove has EXACTLY three keys.",
        "- The item attributes above (name, type, tags, material, formality) are for SELECTION "
        "ONLY -- do NOT copy them into the output items.",
        "- Do NOT emit any other field. Forbidden anywhere in the output: score, rank, "
        "optionPath, risk, vibe, label, imageUrl, warmth. Any extra field causes the whole "
        "outfit to be rejected.",
    ]
    return "\n".join(lines)


def _build_daily_user_message(
    request: RenderRequest,
    pool_json: str,
    candidate_requested: int,
) -> str:
    return "\n".join(
        [
            f"Occasion: {request.occasion}",
            f"Weather: {request.weather}",
            "",
            "Build believable outfits for this occasion and weather from this wardrobe:",
            pool_json,
            "",
            f"Return up to {candidate_requested} outfits.",
        ]
    )


def _daily_candidate_requested(sampler_count: int) -> int:
    """Cap the daily GPT ask at ``DAILY_MAX_CANDIDATES`` (m5-cutover.md §A.6 point 3).

    The sampler's general count (``min(MAX_CANDIDATES=40, total_base*3)``) sizes the candidate
    *pool*, not the paid ask: at ~130–170 output tokens per §12 outfit, an up-to-40 ask needs
    ~5,000–6,800 completion tokens and truncates mid-JSON under any sane
    ``M5_MAX_COMPLETION_TOKENS`` — parse-failing every normal-closet daily render. Daily
    bounds its own LLM ask here, mirroring rescue's ``_rescue_candidate_requested`` override
    (the closed M1 sampler is never reopened); ~10–12 drafts still give the ranker /
    ``select_spread`` ample surplus over ``n_surfaced=3``. The capped value rides
    ``GenerationPrompt.candidate_requested``, so the "Return up to N" ask and the validator
    bound stay the same number by construction.
    """
    return min(sampler_count, DAILY_MAX_CANDIDATES)


def _build_daily_prompt(
    pool: Mapping[ItemType, list[WardrobeItem]],
    request: RenderRequest,
    candidate_requested: int,
) -> GenerationPrompt:
    """Build the daily ``GenerationPrompt`` from the full sampled pool."""
    pool_items = [_serialize_pool_item(item) for item in _flatten_pool(pool)]
    pool_json = json.dumps(pool_items, indent=2, ensure_ascii=False)
    return GenerationPrompt(
        system=_build_daily_system_prompt(),
        user=_build_daily_user_message(request, pool_json, candidate_requested),
        candidate_requested=candidate_requested,
    )


# ============================================================================
# §G steps 7–9 — rescue() orchestration (generate → parse → validate → drop → rank, C4)
# ============================================================================

# The single §12 JSON-repair instruction appended to the system prompt on a blind
# re-generation (spearhead.md §G step 7). ``GenerationPrompt`` carries no slot for the prior
# raw output, so this is a blind re-generation, not a diff-repair — sufficient for the
# JSON-format failure §12 allows.
_REPAIR_INSTRUCTION = (
    "Your previous output was not valid JSON. Return ONLY strict, valid JSON in exactly the "
    "required shape — no prose, no code fences, no trailing commentary."
)

# User-facing hint when generation/filtering/ranking left fewer than ``n_surfaced`` outfits
# (spearhead.md §H "All candidates drop" / "Fewer than n_surfaced survive"). Never silent: an
# honest partial still tells the user what happened, mirroring the pre-GPT sufficiency hint.
_INSUFFICIENT_AFTER_GENERATION_HINT = (
    "couldn't assemble enough distinct ways to wear this item right now — try regenerating"
)


@dataclass(frozen=True)
class RescueResult:
    """The rescue outcome (spearhead.md §B; **C5 response surface**).

    ``variants`` is the surfaced set (≤ ``n_surfaced``, in 2-D spread order) — the §6.5
    ``OutfitVariant``s the response layer (``response.build_variants``) assembled from
    ``ranked.outfits``, each carrying the backend-assigned ``option_path``/``risk`` + the
    cold-start ``compatibility``/``visibility`` scores they bucketed from. ``ranked`` is **retained
    alongside** ``variants`` (not replaced): it is the full ≤ ``k`` ranked pool ``select_spread``
    chose from + the raw ``RankerResult`` diagnostics — richer eval material for C6 than the 3
    surfaced variants, and the C5 response layer is purely additive over the verified C4 surface.
    ``ranked`` is ``None`` **only** on the pre-GPT ``not_enough_items`` exit (which never reaches
    ``rank()``); there ``variants`` is ``()`` and ``spread_collapsed`` is ``False``. The staged
    surface mirrors ``ValidatedCandidate`` (emitted from M2 C4) and ``RankedOutfit`` (from M3 C5).

    Flag semantics (spearhead.md §B / §G "Reading fallback_stage"):
      - ``not_enough_items`` — PRE-GPT structural insufficiency (the H22 min-closet rule): no
        valid template can be built around the forced item, so no GPT call is made.
      - ``insufficient_after_generation`` — POST: generation/filters/rank left fewer than
        ``n_surfaced``. Derived as ``len(ranked.outfits) < n_surfaced`` — rescue's OWN health
        signal, deliberately **not** the ranker's ``insufficient_wardrobe`` (which is ``len < k``
        and so almost always ``True`` for a small rescue pool). ``select_spread`` never pads beyond
        the available variants, so ``len(variants) == min(len(ranked.outfits), n_surfaced)``; this
        flag therefore equals the §G ``len(surfaced) < n_surfaced`` definition.
      - ``spread_collapsed`` — the closet could not fill ``n_surfaced`` distinct ``(path, risk)``
        cells, so two surfaced variants share a cell (spearhead.md §G "2-D spread selection"). A
        response-quality signal, **orthogonal** to ``insufficient_after_generation`` (a count
        signal): a 2-distinct-variant partial is ``spread_collapsed=False`` (the spread worked,
        the pool was just thin). ``False`` on the pre-GPT exit.
      - ``reason_hint`` — user-facing, never silent: the sufficiency hint pre-GPT, or the
        honest-partial hint when ``insufficient_after_generation``.
      - ``fallback_stage`` — carried straight from the ranker as a RAW diagnostic of how hard the
        ranker worked to fill ``k`` (**not** a user-facing rescue-health signal); ``None`` only on
        the pre-GPT exit (before ``rank()``). For a small rescue pool it commonly reads
        ``insufficient``/``variant_cap_relaxed`` even when enough variants surfaced — expected, so
        a caller reads ``insufficient_after_generation``, never this (spearhead.md §G).
    """

    ranked: Optional[RankerResult]
    variants: tuple[OutfitVariant, ...]
    not_enough_items: bool
    insufficient_after_generation: bool
    spread_collapsed: bool
    reason_hint: Optional[str]
    fallback_stage: Optional[FallbackStage]


def _filled_slot_ids(slot_map: SlotMap) -> set[str]:
    """The non-``None`` item ids of a SlotMap (every filled slot, incl. optional outer/shoes)."""
    return {
        item_id
        for item_id in (
            slot_map.dress,
            slot_map.top,
            slot_map.bottom,
            slot_map.outer,
            slot_map.shoes,
        )
        if item_id is not None
    }


def _drop_missing_style_move(candidates: Sequence[ValidatedCandidate]) -> list[ValidatedCandidate]:
    """Drop candidates whose §12 StyleMove did not validate."""
    return [candidate for candidate in candidates if candidate.style_move is not None]


def _drop_missing_forced_item(
    candidates: Sequence[ValidatedCandidate], forced_item_id: str
) -> list[ValidatedCandidate]:
    """Drop candidates that omit the rescue forced item."""
    return [
        candidate
        for candidate in candidates
        if forced_item_id in _filled_slot_ids(candidate.slot_map)
    ]


def _drop_invalid(
    candidates: Sequence[ValidatedCandidate], forced_item_id: str
) -> list[ValidatedCandidate]:
    """Drop survivors that violate the rescue contract (spearhead.md §G step 8, decision 8).

    Two rescue-specific drops over M2-validated candidates, applied **before** ranking:
      - **forced item** — the forced item id must fill one of the outfit's slots; the whole
        rescue is built around it, so an outfit omitting it is meaningless. With a forced base
        (top/bottom/dress) the scoped pool makes this near-automatic; a forced **optional**
        (outer/shoes) is the case this drop actually catches — a valid base-only outfit can omit
        it.
      - **StyleMove presence** — ``style_move`` must be present and valid. M2 attaches a
        ``StyleMove`` only when it passed the §12/H23 boundary, leaving ``None`` when absent OR
        present-but-malformed; decision 8 then drops the whole outfit ("I understood the one
        thing that made it work").

    These are structural, positioning-independent drops — **not** a fashionability gate (the §G
    "bucket, never gate" trap-guard governs the C5 response layer, never this).
    """
    return _drop_missing_style_move(_drop_missing_forced_item(candidates, forced_item_id))


def _repair_prompt(prompt: GenerationPrompt) -> GenerationPrompt:
    """The repair-augmented prompt for the one §12 re-generation (spearhead.md §G step 7).

    Appends the JSON-repair instruction to the (frozen) prompt's system text via
    ``dataclasses.replace`` — an explicit immutable copy, never an in-place mutation. ``user``
    and ``candidate_requested`` are untouched, so the validator bound is identical on the retry.
    """
    return replace(prompt, system=prompt.system + "\n\n" + _REPAIR_INSTRUCTION)


def _generate_and_parse(generator: Generator, prompt: GenerationPrompt) -> Optional[object]:
    """Generate → strict parse, with the single §12 ``invalidJson`` repair (spearhead.md §G step 7).

    Returns the parsed payload, or ``None`` when the output is still unparseable after the one
    repair retry (the graceful-fallback signal — never raises on bad GPT data, §13). The repair
    fires **only** on a parse (``invalidJson``) failure: a payload that parses but fails the §12
    schema is handled downstream by ``validate_gpt_payload`` dropping candidates, never a second
    re-generation (spearhead.md §G/§H). Exactly one retry; the stub makes this path
    deterministically testable via a canned invalid-then-valid pair (§J).
    """
    parsed = parse_gpt_json(generator.generate(prompt))
    if parsed.issue is None:
        return parsed.payload
    # invalidJson → one §12 blind re-generation with the repair-augmented prompt.
    repaired = parse_gpt_json(generator.generate(_repair_prompt(prompt)))
    return repaired.payload  # None when still invalid → graceful fallback


def _build_ranker_context(
    request: RescueRequest,
    behavioral_signals: Optional[BehavioralSignals] = None,
) -> RankerContext:
    """``RescueRequest`` → the M3 ``RankerContext`` (spearhead.md §G step 9).

    The seed inputs are required + keyword-only (ranker.py). Behavioral signals are pre-reduced
    by the M5 reducers; ``None`` leaves the ranker at its empty cold-start defaults.
    """
    kwargs = {
        "session_id": request.session_id,
        "wardrobe_version": request.wardrobe_version,
        "occasion": request.occasion,
        "weather": request.weather,
        "date": request.date,
        "generation_index": request.generation_index,
        "k": request.k,
    }
    if behavioral_signals is not None:
        kwargs.update(
            item_affinity=behavioral_signals.item_affinity,
            liked_full_signatures=behavioral_signals.liked_full_signatures,
            shown_full_signatures=behavioral_signals.shown_full_signatures,
            recent_disliked_base_keys=behavioral_signals.recent_disliked_base_keys,
            recent_disliked_item_ids=behavioral_signals.recent_disliked_item_ids,
        )
    return RankerContext(**kwargs)


def rescue(
    request: RescueRequest,
    generator: Generator,
    *,
    signal_scorer: Optional[SignalScorer] = None,
    behavioral_signals: Optional[BehavioralSignals] = None,
) -> RescueResult:
    """Orchestrate orphan-item rescue end-to-end on the pure substrate (spearhead.md §G).

    Pipeline (spearhead.md §G): resolve the forced item (1) → structural sufficiency (2) →
    cold-start pool (3) → scope to the forced item (4) → build the prompt + recompute the
    candidate bound (5–6) → generate + parse with the one §12 repair (7) → validate against the
    SAME bound + drop forced-item/StyleMove failures (8) → rank (9) → response layer (10):
    wrap the ranked survivors into §6.5 ``OutfitVariant``s (path/risk via the §G cold-start
    scoring) and spread-select ≤ ``n_surfaced`` distinct ``(path, risk)`` cells.

    Determinism: with an injected stub whose output is a pure function of its input and a fixed
    ``generation_index``, the whole pipeline is deterministic — the sampler is seeded, the prompt
    is pure, and the ranker is seeded by the request context (spearhead.md §J). The ``generator``
    is the only impurity; the real ``OpenAIGenerator`` is never imported here.
    """
    _ensure_intent(request, "rescue_item")
    scorer = _default_signal_scorer(signal_scorer)

    # Caller-contract precondition (R12): duplicate logical ids corrupt key equality, so fail loud
    # HERE — before the pre-GPT sufficiency exit, which would otherwise mask the misuse on an
    # insufficient closet by returning not_enough_items. RescueRequest validates the numeric request
    # controls at construction time so the pre-GPT exit cannot mask an invalid budget/index either.
    reject_duplicate_ids(request.wardrobe)

    # Step 1 — resolve the forced item (ValueError on a missing id: caller misuse, fail loud)
    # and its template/valid-type shape (H22).
    forced_item = _resolve_forced_item(request.wardrobe, request.forced_item_id)
    _, valid_types = _resolve_shape(forced_item.type)

    # Step 2 — structural sufficiency (the H22 min-closet rule), on full counts, PRE-GPT. A
    # non-None hint ⇒ no valid template can be built around the forced item ⇒ return before any
    # GPT call (ranked=None, fallback_stage=None — rank() is never reached on this exit).
    hint = _check_sufficiency(_partition_counts(request.wardrobe), forced_item.type)
    if hint is not None:
        return RescueResult(
            ranked=None,
            variants=(),  # no rank() reached → no variants to surface
            not_enough_items=True,
            insufficient_after_generation=False,
            spread_collapsed=False,
            reason_hint=hint,
            fallback_stage=None,
        )

    # Step 3 — cold-start candidate pool (the closed M1 sampler). Rescue ignores the sampler's
    # own general-flow candidate_requested/not_enough_items and recomputes both for rescue.
    sampler_result = build_candidate_pool(
        request.wardrobe, _build_request_context(request), scorer
    )

    # Step 4 — scope the pool to the forced item (the rescue "pin"; duplicate-free by construction).
    scoped = _scope_pool_to_forced(sampler_result.pool, forced_item, valid_types)

    # Steps 5–6 — build the prompt; it computes the rescue candidate bound ONCE and carries it on
    # ``prompt.candidate_requested`` so the prompt ask and the validator bound can never desync.
    prompt = _build_prompt(scoped, request, forced_item)

    # Step 7 — generate + parse, with the single §12 invalidJson repair. None ⇒ still unparseable
    # after the one retry ⇒ no payload (treated as zero survivors below — graceful, never a 500).
    payload = _generate_and_parse(generator, prompt)

    # Step 8 — validate against the SAME bound the prompt asked for (prompt.candidate_requested,
    # never recomputed), then drop forced-item/StyleMove failures (decision 8). A None payload or
    # a fully-rejected payload both collapse to zero survivors.
    if payload is None:
        survivors: list[ValidatedCandidate] = []
    else:
        validation = validate_gpt_payload(
            payload, _flatten_pool(scoped), prompt.candidate_requested
        )
        survivors = _drop_invalid(validation.candidates, forced_item.id)

    # Step 9 — rank (cold start: empty behavioral signals). ``rank([])`` is valid (M2/M3 "empty
    # is valid") and yields an empty, insufficient RankerResult, so the parse-fail and all-dropped
    # paths share this single exit.
    ranked = rank(survivors, _build_ranker_context(request, behavioral_signals))

    # Step 10 — response layer: wrap the ranked survivors into §6.5 OutfitVariants (path/risk via
    # the §G cold-start scoring) and spread-select ≤ n_surfaced spanning distinct (path, risk)
    # cells. items_by_id resolves slot ids → WardrobeItem (every ranked id is in the scoped pool ⊆
    # wardrobe). select_spread re-sorts post-rank (compatibility-led at cold start, §G); the closed
    # ranker is never touched.
    items_by_id = {item.id: item for item in request.wardrobe}
    variants, spread_collapsed = build_variants(
        ranked, items_by_id, request, request.n_surfaced
    )

    # Rescue derives its OWN post-generation health from the surfaced budget, NOT the ranker's
    # k-relative insufficient_wardrobe (spearhead.md §G "Reading fallback_stage").
    insufficient = len(ranked.outfits) < request.n_surfaced
    return RescueResult(
        ranked=ranked,
        variants=variants,
        not_enough_items=False,
        insufficient_after_generation=insufficient,
        spread_collapsed=spread_collapsed,
        reason_hint=_INSUFFICIENT_AFTER_GENERATION_HINT if insufficient else None,
        fallback_stage=ranked.fallback_stage,
    )


# ============================================================================
# M4b C6 — Option-B trace orchestrator (additive; the closed rescue() is untouched)
# ============================================================================


@dataclass(frozen=True)
class GenerationAttemptTrace:
    """One generate→parse attempt — a root/attempt-level event (§8.2-E).

    The raw generation text + whether it was the §12 repair retry + the parse outcome. Maps to a
    snapshot ``generationAttempts[]`` entry; the snapshot writer applies the raw-text byte cap.
    """

    raw_text: str
    is_repair: bool
    parse_issue: Optional[IssueCode]
    payload_parsed: bool
    # §A.6 point 4: the generator's finish/refusal metadata for THIS attempt (None for
    # generators that don't expose it — stubs/replays). The C3 service reads it to route a
    # refused/cap-truncated run to the §D degenerate corpus with the status recorded in
    # `generationAttempts[]`, never a silent empty.
    finish_status: Optional[FinishStatus] = None


@dataclass(frozen=True)
class RescueDrop:
    """A validated candidate dropped by the rescue-specific contract (forced-item / StyleMove)."""

    candidate: ValidatedCandidate
    drop_reason: str
    drop_stage: str = "rescue"


@dataclass(frozen=True)
class RescueTrace:
    """The full rescue funnel for snapshot building (M4b C6, §8.4).

    Bundles the public ``RescueResult`` with every discard site §8.4 names: the generation
    ``attempts`` (raw text), the ``sampler_result`` diagnostics, the validation funnel (rejections
    + warnings + the parsed outfit content for content-preservation), the rescue-specific
    ``rescue_drops``, the ``rank_audit`` (scored-but-unshown breakdowns), and the ``build_trace``
    (non-selected variants). The ``None``/empty members reflect the pre-GPT ``not_enough_items``
    exit (no generation/validation/rank reached). ``result`` is byte-equal to ``rescue()`` under
    the same deterministic generator.
    """

    result: RescueResult
    sampler_result: Optional[SamplerResult]
    prompt_pool: tuple[WardrobeItem, ...]
    candidate_requested: Optional[int]  # the rescue's actual GPT ask (prompt.candidate_requested)
    attempts: tuple[GenerationAttemptTrace, ...]
    validation: Optional[ValidationResult]
    parsed_outfits: tuple[object, ...]
    rescue_drops: tuple[RescueDrop, ...]
    rank_audit: Optional[RankAudit]
    build_trace: Optional[BuildVariantsTrace]


def _generate_and_parse_with_trace(
    generator: Generator, prompt: GenerationPrompt
) -> tuple[Optional[object], tuple[GenerationAttemptTrace, ...]]:
    """``_generate_and_parse`` capturing each attempt's raw text + repair flag (§8.2-E).

    Mirrors the closed ``_generate_and_parse`` exactly (one §12 invalidJson repair) but records the
    raw generation string of every attempt instead of discarding it. The closed function is untouched.

    Each attempt also captures the generator's ``last_finish_status`` (§A.6 point 4) — the
    ``OpenAIGenerator`` sets it per call; generators without the attribute (stubs/replays)
    yield ``None``. Read immediately after each ``generate()`` so a repair retry's status
    never overwrites the first attempt's.
    """
    raw = generator.generate(prompt)
    parsed = parse_gpt_json(raw)
    attempts = [
        GenerationAttemptTrace(
            raw_text=raw,
            is_repair=False,
            parse_issue=parsed.issue.code if parsed.issue is not None else None,
            payload_parsed=parsed.issue is None,
            finish_status=getattr(generator, "last_finish_status", None),
        )
    ]
    if parsed.issue is None:
        return parsed.payload, tuple(attempts)
    raw_repair = generator.generate(_repair_prompt(prompt))
    repaired = parse_gpt_json(raw_repair)
    attempts.append(
        GenerationAttemptTrace(
            raw_text=raw_repair,
            is_repair=True,
            parse_issue=repaired.issue.code if repaired.issue is not None else None,
            payload_parsed=repaired.issue is None,
            finish_status=getattr(generator, "last_finish_status", None),
        )
    )
    return repaired.payload, tuple(attempts)


def _drop_invalid_with_trace(
    candidates: Sequence[ValidatedCandidate], forced_item_id: str
) -> tuple[list[ValidatedCandidate], tuple[RescueDrop, ...]]:
    """``_drop_invalid`` capturing WHICH candidates were dropped + why (decision 8, §8.2-F).

    Same predicates + order as the closed ``_drop_invalid`` (so ``survivors`` is byte-identical),
    but records each dropped candidate with its reason for the snapshot's negative-signal funnel.
    """
    survivors: list[ValidatedCandidate] = []
    drops: list[RescueDrop] = []
    for candidate in candidates:
        if forced_item_id not in _filled_slot_ids(candidate.slot_map):
            drops.append(RescueDrop(candidate, "rescue_forced_item_absent"))
        elif candidate.style_move is None:
            drops.append(RescueDrop(candidate, "rescue_stylemove_invalid"))
        else:
            survivors.append(candidate)
    return survivors, tuple(drops)


def _drop_missing_style_move_with_trace(
    candidates: Sequence[ValidatedCandidate],
) -> tuple[list[ValidatedCandidate], tuple[RescueDrop, ...]]:
    """Daily candidate drop trace: StyleMove is required, but no forced item exists."""
    survivors: list[ValidatedCandidate] = []
    drops: list[RescueDrop] = []
    for candidate in candidates:
        if candidate.style_move is None:
            drops.append(RescueDrop(candidate, "stylemove_invalid", "render"))
        else:
            survivors.append(candidate)
    return survivors, tuple(drops)


def rescue_with_trace(
    request: RescueRequest,
    generator: Generator,
    *,
    signal_scorer: Optional[SignalScorer] = None,
    behavioral_signals: Optional[BehavioralSignals] = None,
) -> RescueTrace:
    """``rescue()`` re-run with the Option-B trace siblings — the full funnel for the snapshot.

    Mirrors ``rescue()``'s 10-step pipeline (spearhead.md §G) but uses the ``*_with_trace`` siblings
    so every discard site is captured. The public ``rescue()`` is untouched; ``RescueTrace.result``
    is byte-equal to ``rescue(request, generator)`` under the same deterministic generator.
    """
    _ensure_intent(request, "rescue_item")
    scorer = _default_signal_scorer(signal_scorer)

    # Caller-contract precondition (R12) — fail loud before the pre-GPT sufficiency exit (mirrors
    # rescue(); the insufficient path would otherwise mask a duplicate-id misuse).
    # RescueRequest already guards the numeric request controls at construction time.
    reject_duplicate_ids(request.wardrobe)

    # Steps 1–2 — resolve the forced item + the PRE-GPT structural sufficiency exit (no GPT call).
    forced_item = _resolve_forced_item(request.wardrobe, request.forced_item_id)
    _, valid_types = _resolve_shape(forced_item.type)
    hint = _check_sufficiency(_partition_counts(request.wardrobe), forced_item.type)
    if hint is not None:
        result = RescueResult(
            ranked=None,
            variants=(),
            not_enough_items=True,
            insufficient_after_generation=False,
            spread_collapsed=False,
            reason_hint=hint,
            fallback_stage=None,
        )
        return RescueTrace(
            result=result,
            sampler_result=None,
            prompt_pool=(),
            candidate_requested=None,
            attempts=(),
            validation=None,
            parsed_outfits=(),
            rescue_drops=(),
            rank_audit=None,
            build_trace=None,
        )

    # Steps 3–6 — cold-start pool, scope to the forced item, build the prompt.
    sampler_result = build_candidate_pool(
        request.wardrobe, _build_request_context(request), scorer
    )
    scoped = _scope_pool_to_forced(sampler_result.pool, forced_item, valid_types)
    prompt_pool = tuple(_flatten_pool(scoped))  # the exact items the engine conditioned on (§8.2-D)
    prompt = _build_prompt(scoped, request, forced_item)

    # Step 7 — generate + parse with the §12 repair, capturing every raw attempt.
    payload, attempts = _generate_and_parse_with_trace(generator, prompt)

    # Step 8 — validate (with the parsed-outfit content trace) + the rescue-specific drops.
    if payload is None:
        validation: Optional[ValidationResult] = None
        parsed_outfits: tuple[object, ...] = ()
        survivors: list[ValidatedCandidate] = []
        rescue_drops: tuple[RescueDrop, ...] = ()
    else:
        validation_trace = validate_gpt_payload_with_trace(
            payload, _flatten_pool(scoped), prompt.candidate_requested
        )
        validation = validation_trace.result
        parsed_outfits = validation_trace.parsed_outfits
        survivors, rescue_drops = _drop_invalid_with_trace(validation.candidates, forced_item.id)

    # Step 9 — rank, capturing the full scored funnel (scored-but-unshown breakdowns).
    rank_audit = rank_with_audit(survivors, _build_ranker_context(request, behavioral_signals))
    ranked = rank_audit.result

    # Step 10 — response layer, capturing every assembled variant (non-selected included).
    items_by_id = {item.id: item for item in request.wardrobe}
    build_trace = build_variants_with_trace(ranked, items_by_id, request, request.n_surfaced)

    insufficient = len(ranked.outfits) < request.n_surfaced
    result = RescueResult(
        ranked=ranked,
        variants=build_trace.selected,
        not_enough_items=False,
        insufficient_after_generation=insufficient,
        spread_collapsed=build_trace.spread_collapsed,
        reason_hint=_INSUFFICIENT_AFTER_GENERATION_HINT if insufficient else None,
        fallback_stage=ranked.fallback_stage,
    )
    return RescueTrace(
        result=result,
        sampler_result=sampler_result,
        prompt_pool=prompt_pool,
        candidate_requested=prompt.candidate_requested,
        attempts=attempts,
        validation=validation,
        parsed_outfits=parsed_outfits,
        rescue_drops=rescue_drops,
        rank_audit=rank_audit,
        build_trace=build_trace,
    )


RenderResult = RescueResult
RenderTrace = RescueTrace

_DAILY_NOT_ENOUGH_HINT = "add a top and bottom, or a dress, to get daily outfit ideas"


def _not_enough_daily_result() -> RenderResult:
    return RenderResult(
        ranked=None,
        variants=(),
        not_enough_items=True,
        insufficient_after_generation=False,
        spread_collapsed=False,
        reason_hint=_DAILY_NOT_ENOUGH_HINT,
        fallback_stage=None,
    )


def _render_daily(
    request: RenderRequest,
    generator: Generator,
    *,
    signal_scorer: Optional[SignalScorer] = None,
    behavioral_signals: Optional[BehavioralSignals] = None,
) -> RenderResult:
    _ensure_intent(request, "daily")
    scorer = _default_signal_scorer(signal_scorer)
    reject_duplicate_ids(request.wardrobe)

    sampler_result = build_candidate_pool(request.wardrobe, _build_request_context(request), scorer)
    if sampler_result.not_enough_items:
        return _not_enough_daily_result()

    prompt = _build_daily_prompt(
        sampler_result.pool,
        request,
        _daily_candidate_requested(sampler_result.candidate_requested),
    )
    prompt_pool = _flatten_pool(sampler_result.pool)
    payload = _generate_and_parse(generator, prompt)
    if payload is None:
        survivors: list[ValidatedCandidate] = []
    else:
        validation = validate_gpt_payload(payload, prompt_pool, prompt.candidate_requested)
        survivors = _drop_missing_style_move(validation.candidates)

    ranked = rank(survivors, _build_ranker_context(request, behavioral_signals))
    items_by_id = {item.id: item for item in request.wardrobe}
    variants, spread_collapsed = build_variants(ranked, items_by_id, request, request.n_surfaced)
    insufficient = len(ranked.outfits) < request.n_surfaced
    return RenderResult(
        ranked=ranked,
        variants=variants,
        not_enough_items=False,
        insufficient_after_generation=insufficient,
        spread_collapsed=spread_collapsed,
        reason_hint=_INSUFFICIENT_AFTER_GENERATION_HINT if insufficient else None,
        fallback_stage=ranked.fallback_stage,
    )


def _render_daily_with_trace(
    request: RenderRequest,
    generator: Generator,
    *,
    signal_scorer: Optional[SignalScorer] = None,
    behavioral_signals: Optional[BehavioralSignals] = None,
) -> RenderTrace:
    _ensure_intent(request, "daily")
    scorer = _default_signal_scorer(signal_scorer)
    reject_duplicate_ids(request.wardrobe)

    sampler_result = build_candidate_pool(request.wardrobe, _build_request_context(request), scorer)
    prompt_pool = tuple(_flatten_pool(sampler_result.pool))
    if sampler_result.not_enough_items:
        return RenderTrace(
            result=_not_enough_daily_result(),
            sampler_result=sampler_result,
            prompt_pool=prompt_pool,
            candidate_requested=sampler_result.candidate_requested,
            attempts=(),
            validation=None,
            parsed_outfits=(),
            rescue_drops=(),
            rank_audit=None,
            build_trace=None,
        )

    prompt = _build_daily_prompt(
        sampler_result.pool,
        request,
        _daily_candidate_requested(sampler_result.candidate_requested),
    )
    payload, attempts = _generate_and_parse_with_trace(generator, prompt)
    if payload is None:
        validation: Optional[ValidationResult] = None
        parsed_outfits: tuple[object, ...] = ()
        survivors: list[ValidatedCandidate] = []
        rescue_drops: tuple[RescueDrop, ...] = ()
    else:
        validation_trace = validate_gpt_payload_with_trace(
            payload, list(prompt_pool), prompt.candidate_requested
        )
        validation = validation_trace.result
        parsed_outfits = validation_trace.parsed_outfits
        survivors, rescue_drops = _drop_missing_style_move_with_trace(validation.candidates)

    rank_audit = rank_with_audit(survivors, _build_ranker_context(request, behavioral_signals))
    ranked = rank_audit.result
    items_by_id = {item.id: item for item in request.wardrobe}
    build_trace = build_variants_with_trace(ranked, items_by_id, request, request.n_surfaced)
    insufficient = len(ranked.outfits) < request.n_surfaced
    result = RenderResult(
        ranked=ranked,
        variants=build_trace.selected,
        not_enough_items=False,
        insufficient_after_generation=insufficient,
        spread_collapsed=build_trace.spread_collapsed,
        reason_hint=_INSUFFICIENT_AFTER_GENERATION_HINT if insufficient else None,
        fallback_stage=ranked.fallback_stage,
    )
    return RenderTrace(
        result=result,
        sampler_result=sampler_result,
        prompt_pool=prompt_pool,
        candidate_requested=prompt.candidate_requested,
        attempts=attempts,
        validation=validation,
        parsed_outfits=parsed_outfits,
        rescue_drops=rescue_drops,
        rank_audit=rank_audit,
        build_trace=build_trace,
    )


def render(
    request: RenderRequest,
    generator: Generator,
    *,
    signal_scorer: Optional[SignalScorer] = None,
    behavioral_signals: Optional[BehavioralSignals] = None,
) -> RenderResult:
    """Generic M5 render entrypoint for implemented intents."""
    if request.intent == "rescue_item":
        return rescue(
            request,
            generator,
            signal_scorer=signal_scorer,
            behavioral_signals=behavioral_signals,
        )
    if request.intent == "daily":
        return _render_daily(
            request,
            generator,
            signal_scorer=signal_scorer,
            behavioral_signals=behavioral_signals,
        )
    raise NotImplementedError(f"{request.intent!r} render intent is not implemented in C1")


def render_with_trace(
    request: RenderRequest,
    generator: Generator,
    *,
    signal_scorer: Optional[SignalScorer] = None,
    behavioral_signals: Optional[BehavioralSignals] = None,
) -> RenderTrace:
    """Generic traced M5 render entrypoint for implemented intents."""
    if request.intent == "rescue_item":
        return rescue_with_trace(
            request,
            generator,
            signal_scorer=signal_scorer,
            behavioral_signals=behavioral_signals,
        )
    if request.intent == "daily":
        return _render_daily_with_trace(
            request,
            generator,
            signal_scorer=signal_scorer,
            behavioral_signals=behavioral_signals,
        )
    raise NotImplementedError(f"{request.intent!r} render intent is not implemented in C1")
