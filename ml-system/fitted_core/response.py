"""The response layer — ranked outfits → user-facing rescue variants (v2 §6.5/§11; C5).

The §9 Step-7 response layer and the §11/H20 cold-start scoring heart. It is the **general**
response surface (reused by `daily`/`upgrade`/`translate` later), not rescue-specific — so the
dependency is strictly one-way (`rescue` → `response`, never back): this module imports only the
closed M0–M3 contracts (`models`, `ranker`) and `config`, never the rescue layer. The lens fields
it reads (occasion + weather) arrive through the `LensRequest` Protocol, which `RescueRequest`
satisfies structurally — so no rescue import is needed.

Two responsibilities (spearhead.md §B/§G step 10):

1. **Cold-start scoring** — `compatibility` / `visibility`: pure, `[0,1]` content scores over an
   outfit's resolved items. v1 is hand-built heuristics (the only option cold — no model, no
   embeddings) that the trained M6 scorer replaces at this same seam. The **functional form is
   fixed** in spearhead.md §G; only the Appendix B weights/thresholds/taxonomies (in `config`) are
   tuned in C6. `assign_path`/`assign_risk` bucket the two scores into the §6.5 `(optionPath, risk)`
   labels GPT is forbidden to emit (§5: GPT never ranks).

   **Trap-guard — bucket, never gate (spearhead.md §G).** These heuristics encode a conventional
   prior (matchy colors + coherent formality read as *expected*; clashing colors / register-mixing
   read as *bolder*). That is acceptable **only because they position, never forbid**: their sole
   job is to assign a `(path, risk)` cell, so a "clashing" outfit surfaces as a believable *stretch
   + bold* way to wear the item, not a rejected one. They must **never** become a quality filter or
   candidate gate — structural validity (§13) is the only filter (ambition appendix C.2 / §22).

2. **Variant assembly + 2-D spread** — `OutfitVariant` (the §6.5 response object) wraps a ranked
   outfit with its `optionPath`/`risk`/scores; `select_spread` picks ≤ `n_surfaced` survivors
   spanning distinct `(path, risk)` cells; `build_variants` is the §G step-10 orchestrator the
   rescue layer calls.

Sources: docs/Fitted_Spec_v2.md §6.5/§11/§12 (H20), docs/plans/spearhead.md §B/§G step 10.
"""

import itertools
from dataclasses import dataclass
from enum import Enum
from typing import Mapping, Optional, Protocol

from fitted_core.config import (
    BOLD_STYLE_TAGS,
    COLOR_FAMILIES,
    FORMALITY_RANK,
    MAX_FORMALITY_SPREAD,
    NEUTRAL_COLORS,
    PATH_RELIABLE_MIN,
    PATH_STRETCH_MAX,
    RISK_BOLD_MIN,
    RISK_SAFE_MAX,
    W_COLOR_FAMILY,
    W_CONTRAST,
    W_FORMALITY_COHERENCE,
    W_FORMALITY_DISTANCE,
    W_NEUTRAL_ANCHOR,
    W_OCCASION_OVERLAP,
    W_STATEMENT_TAGS,
    WEATHER_MISMATCH_PENALTY,
    WEATHER_TARGET_BAND,
    WEATHER_WARMTH_BAND,
)
from fitted_core.models import Role, SlotMap, Template, WardrobeItem
from fitted_core.ranker import FrozenStyleMove, RankedOutfit, RankerResult, ScoreBreakdown
from fitted_core.scorer import OutfitScore


# ============================ response-layer label enums ============================


class OptionPath(Enum):
    """The user-facing option path (§6.5). Assigned post-rank from `compatibility`.

    Homed **here, not in `models.py`** (spearhead.md §B): only the response layer needs these
    labels, so keeping them out of the M0 contract preserves the closed M0–M3 surface (nothing
    in M0–M3 is touched). Member *values* are the §6.5 wire labels; the M5 adapter maps with no
    translation table (same convention as `ranker.FallbackStage`).
    """

    reliable = "reliable"
    bridge = "bridge"
    stretch = "stretch"


class Risk(Enum):
    """The user-facing risk band (§6.5). Assigned post-rank from `visibility`."""

    safe = "safe"
    noticeable = "noticeable"
    bold = "bold"


# ============================ the lens the scorer reads ============================


class LensRequest(Protocol):
    """The lens fields the response layer reads — occasion + weather (decision 7).

    A structural Protocol, **not** an import of `rescue.RescueRequest`: it keeps the dependency
    one-way (`rescue` → `response`) and documents exactly the two lens fields the cold-start
    scoring consumes. `RescueRequest` (and any future daily/upgrade request) satisfies it by
    shape. Only weather + occasion are carried — the richer ConstraintSet defers to B-track/M5.
    """

    occasion: str
    weather: str


# ============================ the §6.5 canonical response object ============================


@dataclass(frozen=True)
class OutfitVariant:
    """One ranked outfit wrapped for the response (v2 §6.5; spearhead.md §B).

    The response-layer object: a validated, ranked outfit plus the backend-assigned
    `option_path`/`risk` (post-rank, never GPT-emitted — §5/§12) and the two cold-start content
    scores they were bucketed from. `items` is ordered base-roles-first, then outer, then shoes
    (§6.5), optional roles omitted. `style_move` is **never `None`** on a surfaced variant
    (decision 8 dropped the `None` upstream in `rescue._drop_invalid`). `score`/`score_breakdown`
    are carried verbatim from the `RankedOutfit` (so `score == Σ breakdown`, N4, still holds), and
    `base_key`/`full_signature` are emitted so M4 can bind later feedback to the exact outfit.
    `compatibility`/`visibility` are the `[0,1]` debug/eval scores (the M6 seam, §11).
    """

    items: tuple[tuple[str, Role], ...]
    template: Template
    option_path: OptionPath
    risk: Risk
    style_move: FrozenStyleMove
    score: float
    score_breakdown: ScoreBreakdown
    base_key: str
    full_signature: str
    compatibility: float
    visibility: float


# ============================ §G shared scoring primitives ============================


def _clamp01(x: float) -> float:
    """Clamp to `[0,1]` — the final guard on both scores (spearhead.md §G)."""
    return max(0.0, min(1.0, x))


def _norm_label(s: str) -> str:
    """Normalize a free string for taxonomy lookup (spearhead.md §G `_norm_label`).

    `strip().lower()`, hyphens/underscores → spaces, then internal whitespace collapsed. Every
    free-string lookup below (colors, style tags, formality, occasion tokens) goes through this,
    so the `config` taxonomies (guaranteed lowercase in `test_config`) match a CV-varied input.
    """
    s = s.strip().lower().replace("-", " ").replace("_", " ")
    return " ".join(s.split())


def _norm_color_tags(item: WardrobeItem) -> list[str]:
    """The item's normalized, non-empty color tags (the basis for every color predicate)."""
    return [n for n in (_norm_label(t) for t in item.color_tags) if n]


def _is_neutral(item: WardrobeItem) -> bool:
    """`True` iff any normalized color tag is a neutral (spearhead.md §G `_is_neutral`).

    A grounding neutral reads as safe/expected — it anchors `compatibility` and excludes the item
    from `visibility`'s contrast (a neutral never clashes).
    """
    return any(t in NEUTRAL_COLORS for t in _norm_color_tags(item))


def _has_color_info(item: WardrobeItem) -> bool:
    """`True` iff the item carries any color tag — missing CV data must never penalize (§G)."""
    return bool(_norm_color_tags(item))


# Invert config's family → {colors} map to color → family for O(1) lookup. Families are
# disjoint by design; an unmatched non-neutral word maps to "other" (spearhead.md §G).
_COLOR_TO_FAMILY: dict[str, str] = {
    color: family for family, colors in COLOR_FAMILIES.items() for color in colors
}


def _color_families(item: WardrobeItem) -> set[str]:
    """The set of color families the item's **non-neutral** tags map through (spearhead.md §G).

    Neutral words contribute no family; an unmatched non-neutral word → `"other"`. A non-neutral
    item with color info therefore always has a non-empty family set (at least `{"other"}`).
    """
    return {
        _COLOR_TO_FAMILY.get(t, "other")
        for t in _norm_color_tags(item)
        if t not in NEUTRAL_COLORS
    }


def _rank(item: WardrobeItem) -> Optional[int]:
    """The item's formality rank, or `None` when unknown/absent (spearhead.md §G `_rank`).

    An unknown or `None` formality never counts toward the spread (so a featureless outfit reads
    as formality-coherent, not incoherent).
    """
    if item.formality is None:
        return None
    return FORMALITY_RANK.get(_norm_label(item.formality))


# Warmth-band boundaries derived from config (not re-typed): hot's upper bound (3) and mild's
# upper bound (6) are the §G `_warmth_band` thresholds. `cold` is (6,10) but warmth maxes at 10,
# so the band is `>= 6`, not a half-open range — hence the threshold form, not range membership.
_WARMTH_BAND_HOT_MAX = WEATHER_WARMTH_BAND["hot"][1]
_WARMTH_BAND_MILD_MAX = WEATHER_WARMTH_BAND["mild"][1]


def _warmth_band(warmth: int) -> int:
    """Bin a 0–10 warmth into `0/1/2` (spearhead.md §G `_warmth_band`)."""
    if warmth < _WARMTH_BAND_HOT_MAX:
        return 0
    if warmth < _WARMTH_BAND_MILD_MAX:
        return 1
    return 2


def _target_band(weather: str) -> Optional[int]:
    """The lens weather's desired warmth band — `None` for indoor/outdoor (no penalty, §G)."""
    return WEATHER_TARGET_BAND.get(weather)


def _filled_slot_ids(slot_map: SlotMap) -> tuple[str, ...]:
    """The non-`None` slot ids in canonical order (dress → top → bottom → outer → shoes).

    Mirrors `ranker._filled_slot_ids` / `keys.py`. Order is irrelevant to the (unordered-pair,
    per-item) scoring, but fixed so item resolution is deterministic.
    """
    return tuple(
        item_id
        for item_id in (
            slot_map.dress,
            slot_map.top,
            slot_map.bottom,
            slot_map.outer,
            slot_map.shoes,
        )
        if item_id is not None
    )


def _resolve_items(
    slot_map: SlotMap, items_by_id: Mapping[str, WardrobeItem]
) -> list[WardrobeItem]:
    """The outfit's filled slots resolved to `WardrobeItem`s (every id is in the pool ⊆ wardrobe)."""
    return [items_by_id[item_id] for item_id in _filled_slot_ids(slot_map)]


def _formality_spread(items: list[WardrobeItem]) -> Optional[int]:
    """`max(rank) − min(rank)` over items with a known formality, or `None` when < 2 are known.

    Shared by both formality terms: `compatibility`'s coherence (`1 − spread/MAX`) and
    `visibility`'s distance (`spread/MAX`). Fewer than 2 known ranks → incoherence is unmeasurable
    (spearhead.md §G).
    """
    ranks = [r for r in (_rank(item) for item in items) if r is not None]
    if len(ranks) < 2:
        return None
    return max(ranks) - min(ranks)


# ============================ compatibility (the cold-start content score) ============================


def _neutral_anchor(items: list[WardrobeItem]) -> float:
    """Share of items carrying a grounding neutral (spearhead.md §G `neutral`)."""
    return sum(1 for item in items if _is_neutral(item)) / len(items)


def _color_cohesion(items: list[WardrobeItem]) -> float:
    """Share of cohesive pairs (spearhead.md §G `cohesion`); **0 pairs → 1.0**.

    A pair is cohesive if it shares a family, OR either item is neutral, OR either has no color
    info (missing CV data never penalizes). A lone dress (0 pairs) is trivially cohesive.
    """
    pairs = list(itertools.combinations(items, 2))
    if not pairs:
        return 1.0
    cohesive = sum(1 for a, b in pairs if _pair_is_cohesive(a, b))
    return cohesive / len(pairs)


def _pair_is_cohesive(a: WardrobeItem, b: WardrobeItem) -> bool:
    if _is_neutral(a) or _is_neutral(b):
        return True
    if not _has_color_info(a) or not _has_color_info(b):
        return True
    return bool(_color_families(a) & _color_families(b))  # shares a family


def _formality_coherence(items: list[WardrobeItem]) -> float:
    """`1 − spread/MAX_FORMALITY_SPREAD`; **< 2 known ranks → 1.0** (spearhead.md §G `formality`)."""
    spread = _formality_spread(items)
    if spread is None:
        return 1.0
    return 1.0 - spread / MAX_FORMALITY_SPREAD


def _occasion_overlap(items: list[WardrobeItem], occasion: str) -> float:
    """Share of occasion-ok items (spearhead.md §G `occasion`); **empty lens occasion → 1.0**.

    An item is occasion-ok if its `occasion_tags` is empty (no signal → don't penalize) OR shares
    ≥1 whitespace token with the lensed occasion text. Token overlap, not exact tag equality, so a
    "weekend brunch" lens matches a "brunch" tag.
    """
    lens_tokens = set(_norm_label(occasion).split())
    if not lens_tokens:
        return 1.0
    ok = sum(1 for item in items if _item_occasion_ok(item, lens_tokens))
    return ok / len(items)


def _item_occasion_ok(item: WardrobeItem, lens_tokens: set[str]) -> bool:
    if not item.occasion_tags:
        return True  # no signal → never penalize
    item_tokens: set[str] = set()
    for tag in item.occasion_tags:
        item_tokens.update(_norm_label(tag).split())
    return bool(item_tokens & lens_tokens)


def _weather_penalty(items: list[WardrobeItem], weather: str) -> float:
    """`PENALTY × max_over_items |warmth_band − target_band|`, else `0` (spearhead.md §G).

    The **max** (not sum) lets one parka-in-July item define the mismatch without compounding;
    band distance `0–2` → penalty `0–1.0`, and `compatibility`'s final clamp absorbs the rest.
    `indoor`/`outdoor` weather has no target band → no penalty.
    """
    target = _target_band(weather)
    if target is None:
        return 0.0
    max_distance = max(abs(_warmth_band(item.warmth) - target) for item in items)
    return WEATHER_MISMATCH_PENALTY * max_distance


def compatibility(
    slot_map: SlotMap, items_by_id: Mapping[str, WardrobeItem], request: LensRequest
) -> float:
    """Cold-start content compatibility in `[0,1]` (spearhead.md §G; the M6 seam, §11).

    `clamp01( W_NEUTRAL_ANCHOR·neutral + W_COLOR_FAMILY·cohesion + W_FORMALITY_COHERENCE·formality
    + W_OCCASION_OVERLAP·occasion − weather_penalty )`. Pure (a function of the resolved items +
    lens only) and deterministic. The four per-family weights sum to 1.0 (`test_config`), so the
    weighted sum lands in `[0,1]` before the clamp; the weather penalty can push it below 0, which
    the clamp absorbs.
    """
    items = _resolve_items(slot_map, items_by_id)
    raw = (
        W_NEUTRAL_ANCHOR * _neutral_anchor(items)
        + W_COLOR_FAMILY * _color_cohesion(items)
        + W_FORMALITY_COHERENCE * _formality_coherence(items)
        + W_OCCASION_OVERLAP * _occasion_overlap(items, request.occasion)
        - _weather_penalty(items, request.weather)
    )
    return _clamp01(raw)


# ============================ visibility (the cold-start boldness score) ============================


def _color_contrast(items: list[WardrobeItem]) -> float:
    """Share of contrasting pairs (spearhead.md §G `contrast`); **0 pairs → 0.0**.

    A pair contrasts iff both items are non-neutral, both have color info, and their family sets
    are disjoint. A lone item has no pairing contrast — its boldness rides on `statement`.
    """
    pairs = list(itertools.combinations(items, 2))
    if not pairs:
        return 0.0
    contrasting = sum(1 for a, b in pairs if _pair_is_contrasting(a, b))
    return contrasting / len(pairs)


def _pair_is_contrasting(a: WardrobeItem, b: WardrobeItem) -> bool:
    if _is_neutral(a) or _is_neutral(b):
        return False
    if not _has_color_info(a) or not _has_color_info(b):
        return False
    return _color_families(a).isdisjoint(_color_families(b))


def _statement_tags(items: list[WardrobeItem]) -> float:
    """Share of items carrying a `BOLD_STYLE_TAGS` member (spearhead.md §G `statement`)."""
    return sum(1 for item in items if _has_bold_tag(item)) / len(items)


def _has_bold_tag(item: WardrobeItem) -> bool:
    return any(_norm_label(tag) in BOLD_STYLE_TAGS for tag in item.style_tags)


def _formality_distance(items: list[WardrobeItem]) -> float:
    """`spread/MAX_FORMALITY_SPREAD`; **< 2 known ranks → 0.0** (spearhead.md §G `distance`).

    The outfit's *internal* formality spread — mixing dressy + casual registers reads as
    deliberately noticeable. (Not "distance from the occasion": there is no formality ontology on
    the free-text occasion side at `[NOW]`, §G.)
    """
    spread = _formality_spread(items)
    if spread is None:
        return 0.0
    return spread / MAX_FORMALITY_SPREAD


def visibility(
    slot_map: SlotMap, items_by_id: Mapping[str, WardrobeItem], request: LensRequest
) -> float:
    """Cold-start boldness in `[0,1]`, orthogonal to compatibility (spearhead.md §G).

    `clamp01( W_CONTRAST·contrast + W_STATEMENT_TAGS·statement + W_FORMALITY_DISTANCE·distance )`.
    Pure and deterministic. `request` is part of the fixed seam signature but is **unused** at
    `[NOW]`: cold-start visibility is lens-independent (the M6 scorer may consume the lens here).
    The three weights sum to 1.0 (`test_config`), so the sum lands in `[0,1]` before the clamp.
    """
    del request  # lens-independent at [NOW]; kept for the fixed scorer-seam signature
    items = _resolve_items(slot_map, items_by_id)
    raw = (
        W_CONTRAST * _color_contrast(items)
        + W_STATEMENT_TAGS * _statement_tags(items)
        + W_FORMALITY_DISTANCE * _formality_distance(items)
    )
    return _clamp01(raw)


# ============================ path / risk bucketing ============================


def cold_start_scorer(
    slot_map: SlotMap, items_by_id: Mapping[str, WardrobeItem], request: LensRequest
) -> OutfitScore:
    """The cold-start `OutfitScorer` occupant (m5-cutover.md §E; the §23-H28 seam).

    Wraps the two pure content functions into the `scorer.OutfitScore` shape the snapshot
    producer exercises at M5. `signal_score` is `None` (reserved for the trained M6 scorer).
    Both scores are `[0,1]`-clamped by construction (the M5 invariant: finite, non-null
    compatibility AND visibility for every scored candidate). Pure and deterministic — the
    producer computes the same values the response path buckets `optionPath`/`risk` from, so
    shown-candidate `scoreTrace` values are unchanged.
    """
    return OutfitScore(
        compatibility=compatibility(slot_map, items_by_id, request),
        visibility=visibility(slot_map, items_by_id, request),
        signal_score=None,
    )


def assign_path(compat: float) -> OptionPath:
    """Bucket `compatibility` into an `OptionPath` (spearhead.md §G / Appendix B thresholds).

    `compat ≥ PATH_RELIABLE_MIN → reliable`; `compat ≤ PATH_STRETCH_MAX → stretch`; the band
    between is `bridge`. The config guard keeps `PATH_STRETCH_MAX < PATH_RELIABLE_MIN`, so the
    middle band always exists.
    """
    if compat >= PATH_RELIABLE_MIN:
        return OptionPath.reliable
    if compat <= PATH_STRETCH_MAX:
        return OptionPath.stretch
    return OptionPath.bridge


def assign_risk(vis: float) -> Risk:
    """Bucket `visibility` into a `Risk` (spearhead.md §G / Appendix B thresholds).

    `vis ≥ RISK_BOLD_MIN → bold`; `vis ≤ RISK_SAFE_MAX → safe`; the band between is `noticeable`.
    """
    if vis >= RISK_BOLD_MIN:
        return Risk.bold
    if vis <= RISK_SAFE_MAX:
        return Risk.safe
    return Risk.noticeable


# ============================ variant assembly + 2-D spread ============================


def _ordered_items(slot_map: SlotMap) -> tuple[tuple[str, Role], ...]:
    """`(itemId, Role)` pairs ordered base-roles-first, then outer, then shoes (§6.5).

    Optional roles are omitted (no null fields). A valid base is one_piece (a dress) XOR two_piece
    (top + bottom); `is_valid_slotmap` already guaranteed exactly one of those.
    """
    ordered: list[tuple[str, Role]] = []
    if slot_map.dress is not None:
        ordered.append((slot_map.dress, Role.one_piece))
    else:
        if slot_map.top is not None:
            ordered.append((slot_map.top, Role.base_top))
        if slot_map.bottom is not None:
            ordered.append((slot_map.bottom, Role.base_bottom))
    if slot_map.outer is not None:
        ordered.append((slot_map.outer, Role.outer_layer))
    if slot_map.shoes is not None:
        ordered.append((slot_map.shoes, Role.shoes))
    return tuple(ordered)


def _assemble_variant(
    outfit: RankedOutfit, items_by_id: Mapping[str, WardrobeItem], request: LensRequest
) -> OutfitVariant:
    """Wrap one `RankedOutfit` into an `OutfitVariant` (spearhead.md §G step 10).

    Computes `compatibility`/`visibility` (the weather penalty is already inside compatibility),
    buckets them into `option_path`/`risk`, and carries `score`/`breakdown`/keys verbatim. The
    `style_move` is asserted non-`None`: `rescue._drop_invalid` dropped any candidate without one
    (decision 8), so a `None` here would be an upstream contract violation, not a routine case.
    """
    style_move = outfit.style_move
    assert style_move is not None, (
        "a surfaced variant must carry a StyleMove (decision 8 drops None before ranking)"
    )
    compat = compatibility(outfit.slot_map, items_by_id, request)
    vis = visibility(outfit.slot_map, items_by_id, request)
    return OutfitVariant(
        items=_ordered_items(outfit.slot_map),
        template=outfit.template,
        option_path=assign_path(compat),
        risk=assign_risk(vis),
        style_move=style_move,
        score=outfit.score,
        score_breakdown=outfit.breakdown,
        base_key=outfit.base_key,
        full_signature=outfit.full_signature,
        compatibility=compat,
        visibility=vis,
    )


def select_spread(
    ranked: RankerResult,
    variants_by_full_signature: Mapping[str, OutfitVariant],
    n: int,
) -> tuple[list[OutfitVariant], bool]:
    """Pick ≤ `n` variants spanning distinct `(path, risk)` cells (spearhead.md §G; selection-only).

    Re-sorts the ranker's survivors by **`(ranker_score desc, compatibility desc, full_signature
    asc)`** — the single key that reconciles both regimes (spearhead.md §G "Where cold-start
    ordering lives"): cold (flat ranker scores) → `compatibility` is the effective sort key; warm
    (real ranker scores, M6) → the ranker score leads and `compatibility` only breaks ties. Then
    greedily takes the first variant that opens a new `(path, risk)` cell, up to `n`.

    When distinct cells can't be filled (clustered/bland closet), it falls back to the top-`n` in
    that same order — and `spread_collapsed` reports it: `True` iff two surfaced variants share a
    cell (a duplicate cell had to pad the set). Fully deterministic (no new RNG — `full_signature`
    is unique per pass, M2 dedup), never recomputes a score, never pads with a duplicate variant.
    """
    ordered = sorted(
        (variants_by_full_signature[outfit.full_signature] for outfit in ranked.outfits),
        key=lambda v: (-v.score, -v.compatibility, v.full_signature),
    )

    selected: list[OutfitVariant] = []
    opened_cells: set[tuple[OptionPath, Risk]] = set()
    # First pass — greedily open distinct (path, risk) cells in the re-sorted order.
    for variant in ordered:
        if len(selected) >= n:
            break
        cell = (variant.option_path, variant.risk)
        if cell not in opened_cells:
            selected.append(variant)
            opened_cells.add(cell)

    # Fill — fewer than n distinct cells available: pad with the next-best remaining (duplicate
    # cells), still in the re-sorted order; never re-selects an already-chosen variant.
    if len(selected) < n:
        chosen = {variant.full_signature for variant in selected}
        for variant in ordered:
            if len(selected) >= n:
                break
            if variant.full_signature not in chosen:
                selected.append(variant)
                chosen.add(variant.full_signature)

    spread_collapsed = len({(v.option_path, v.risk) for v in selected}) < len(selected)
    return selected, spread_collapsed


def build_variants(
    ranked: RankerResult,
    items_by_id: Mapping[str, WardrobeItem],
    request: LensRequest,
    n: int,
) -> tuple[tuple[OutfitVariant, ...], bool]:
    """The §G step-10 orchestrator: assemble every ranked survivor, then spread-select ≤ `n`.

    Returns `(variants, spread_collapsed)`. Builds exactly one `OutfitVariant` per `RankedOutfit`
    (keyed by `full_signature`, unique per pass), then `select_spread` chooses the surfaced set.
    The rescue layer calls this; `ranked.outfits` empty → `((), False)`.
    """
    variants_by_full_signature = {
        outfit.full_signature: _assemble_variant(outfit, items_by_id, request)
        for outfit in ranked.outfits
    }
    selected, spread_collapsed = select_spread(ranked, variants_by_full_signature, n)
    return tuple(selected), spread_collapsed


# ============================================================================
# M4b C6 — Option-B trace sibling (additive; the closed build_variants is untouched)
# ============================================================================


@dataclass(frozen=True)
class BuildVariantsTrace:
    """``build_variants`` + EVERY assembled variant (M4b C6 — the non-selected-variant capture).

    ``build_variants`` returns only the spread-SELECTED variants; the non-selected ones (built
    from the same ranked pool, each carrying its own cold-start ``compatibility``/``visibility`` —
    the H29(a) signal the snapshot must keep) are discarded. ``all_variants`` is every assembled
    ``OutfitVariant`` (one per ranked survivor, keyed by ``full_signature``); ``selected`` is the
    surfaced subset (== ``build_variants``'s first return — same pure assembly + ``select_spread``).
    Additive: the closed ``build_variants`` is untouched; this re-runs its two pure steps.
    """

    selected: tuple[OutfitVariant, ...]
    spread_collapsed: bool
    all_variants: tuple[OutfitVariant, ...]


def build_variants_with_trace(
    ranked: RankerResult,
    items_by_id: Mapping[str, WardrobeItem],
    request: LensRequest,
    n: int,
) -> BuildVariantsTrace:
    """``build_variants`` + every assembled variant, incl. the non-selected ones it discards."""
    variants_by_full_signature = {
        outfit.full_signature: _assemble_variant(outfit, items_by_id, request)
        for outfit in ranked.outfits
    }
    selected, spread_collapsed = select_spread(ranked, variants_by_full_signature, n)
    return BuildVariantsTrace(
        selected=tuple(selected),
        spread_collapsed=spread_collapsed,
        all_variants=tuple(variants_by_full_signature.values()),
    )
