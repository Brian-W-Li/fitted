"""C5 tests — the response layer (spearhead.md §C C5 gate, §G step 10 + cold-start scoring).

Gate: each scoring term at its edge cases (single-item outfit, all-attributes-missing,
neutral-only, family clash); purity/determinism; clamp keeps `[0,1]`; bucketing at thresholds;
spread spans cells; collapse flag; compatibility-led order under flat ranker scores; item
ordering (§6.5); `score == breakdown` sum preserved through the response layer.

Hermetic: the end-to-end tests inject a `StubGenerator` — no live OpenAI, ever (§A/§I). The
scoring tests pass a `SimpleNamespace` lens (occasion + weather), exercising the `LensRequest`
Protocol decoupling — `response.py` never imports the rescue layer.
"""

import json
from types import SimpleNamespace

import pytest

from fitted_core.config import (
    PATH_RELIABLE_MIN,
    PATH_STRETCH_MAX,
    RISK_BOLD_MIN,
    RISK_SAFE_MAX,
    W_CONTRAST,
    W_STATEMENT_TAGS,
)
from fitted_core.models import ItemType, Role, SlotMap, Template, WardrobeItem
from fitted_core.ranker import FrozenStyleMove, ScoreBreakdown
from fitted_core.response import (
    OptionPath,
    OutfitVariant,
    Risk,
    _ordered_items,
    _target_band,
    _warmth_band,
    assign_path,
    assign_risk,
    build_variants,
    compatibility,
    select_spread,
    visibility,
)
from fitted_core.rescue import RescueRequest, rescue
from tests.helpers import StubGenerator


# ============================================================================
# helpers — items, lens, score inputs
# ============================================================================


def _item(
    item_id: str,
    *,
    item_type: ItemType = ItemType.top,
    warmth: int = 5,
    colors=(),
    styles=(),
    occasions=(),
    formality=None,
) -> WardrobeItem:
    return WardrobeItem(
        item_id,
        item_id,
        item_type,
        warmth=warmth,
        image_url=f"{item_id}.jpg",
        color_tags=list(colors),
        style_tags=list(styles),
        occasion_tags=list(occasions),
        formality=formality,
    )


def _by_id(*items: WardrobeItem) -> dict:
    return {item.id: item for item in items}


def _lens(occasion: str = "", weather: str = "indoor") -> SimpleNamespace:
    """A minimal LensRequest — only occasion + weather are read (the Protocol surface)."""
    return SimpleNamespace(occasion=occasion, weather=weather)


# ============================================================================
# compatibility — each term at its edge cases (§G)
# ============================================================================


def test_compatibility_all_attributes_missing_is_humble_reliable():
    # The §G sanity case: a featureless outfit scores cohesion = formality = occasion = 1,
    # neutral = 0 → 0.75, and surfaces as the correct humble default (reliable + safe).
    top, bottom = _item("t"), _item("b", item_type=ItemType.bottom)
    sm = SlotMap(top="t", bottom="b")
    compat = compatibility(sm, _by_id(top, bottom), _lens())
    vis = visibility(sm, _by_id(top, bottom), _lens())
    assert compat == pytest.approx(0.75)
    assert vis == 0.0
    assert assign_path(compat) is OptionPath.reliable
    assert assign_risk(vis) is Risk.safe


def test_compatibility_neutral_only_is_max():
    top = _item("t", colors=["black"])
    bottom = _item("b", item_type=ItemType.bottom, colors=["white"])
    sm = SlotMap(top="t", bottom="b")
    # neutral 1.0, cohesion 1.0 (both neutral), formality 1.0, occasion 1.0 → 1.0
    assert compatibility(sm, _by_id(top, bottom), _lens()) == pytest.approx(1.0)


def test_compatibility_family_clash_kills_cohesion():
    top = _item("t", colors=["red"])  # warm family
    bottom = _item("b", item_type=ItemType.bottom, colors=["blue"])  # cool family
    sm = SlotMap(top="t", bottom="b")
    # neutral 0, cohesion 0 (disjoint families, neither neutral), formality 1, occasion 1 → 0.5
    assert compatibility(sm, _by_id(top, bottom), _lens()) == pytest.approx(0.5)


def test_compatibility_missing_color_info_never_penalizes_cohesion():
    # One item has color, the other has none (CV failure) → the pair is cohesive (§G).
    top = _item("t", colors=["red"])
    bottom = _item("b", item_type=ItemType.bottom)  # no color tags
    sm = SlotMap(top="t", bottom="b")
    # cohesion 1.0 despite the lone colored item → compat 0.75 (neutral 0)
    assert compatibility(sm, _by_id(top, bottom), _lens()) == pytest.approx(0.75)


def test_compatibility_formality_coherence_lowers_with_spread():
    # Black-Tie (rank 5) + Casual (rank 1) → spread 4 → coherence 0.2 (and the formatting also
    # proves _norm_label maps "Black-Tie" → the "black tie" rank key, else only 1 rank is known).
    top = _item("t", formality="Black-Tie")
    bottom = _item("b", item_type=ItemType.bottom, formality="Casual")
    sm = SlotMap(top="t", bottom="b")
    # neutral 0, cohesion 1.0 (no color), coherence 0.2, occasion 1.0 → 0.25*(0+1+0.2+1) = 0.55
    assert compatibility(sm, _by_id(top, bottom), _lens()) == pytest.approx(0.55)


def test_compatibility_occasion_token_overlap():
    top = _item("t", occasions=["weekend brunch"])
    bottom = _item("b", item_type=ItemType.bottom, occasions=["black tie"])
    sm = SlotMap(top="t", bottom="b")
    lens = _lens(occasion="brunch with friends")
    # top shares "brunch" → ok; bottom shares no token → not ok; occasion = 1/2 = 0.5
    # neutral 0, cohesion 1.0, formality 1.0 (no formality field), occasion 0.5 → 0.625
    assert compatibility(sm, _by_id(top, bottom), lens) == pytest.approx(0.625)


def test_compatibility_empty_lens_occasion_is_full_credit():
    top = _item("t", occasions=["gym"])
    bottom = _item("b", item_type=ItemType.bottom, occasions=["formal"])
    sm = SlotMap(top="t", bottom="b")
    # empty lens occasion → occasion term 1.0 regardless of item tags (§G)
    assert compatibility(sm, _by_id(top, bottom), _lens(occasion="")) == pytest.approx(0.75)


# ============================================================================
# visibility — contrast / statement / distance (§G)
# ============================================================================


def test_visibility_family_clash_is_contrast():
    top = _item("t", colors=["red"])
    bottom = _item("b", item_type=ItemType.bottom, colors=["blue"])
    sm = SlotMap(top="t", bottom="b")
    vis = visibility(sm, _by_id(top, bottom), _lens())
    assert vis == pytest.approx(W_CONTRAST)  # 1 contrasting pair / 1 pair → W_CONTRAST·1
    assert assign_risk(vis) is Risk.noticeable


def test_visibility_neutral_pair_does_not_contrast():
    top = _item("t", colors=["black"])  # neutral → never contrasts
    bottom = _item("b", item_type=ItemType.bottom, colors=["red"])
    sm = SlotMap(top="t", bottom="b")
    assert visibility(sm, _by_id(top, bottom), _lens()) == 0.0


def test_visibility_statement_tag_share():
    top = _item("t", styles=["graphic"])  # graphic ∈ BOLD_STYLE_TAGS
    bottom = _item("b", item_type=ItemType.bottom)
    sm = SlotMap(top="t", bottom="b")
    # statement = 1/2 = 0.5; contrast 0 (no color info); distance 0
    assert visibility(sm, _by_id(top, bottom), _lens()) == pytest.approx(W_STATEMENT_TAGS * 0.5)


def test_visibility_formality_distance():
    top = _item("t", formality="black tie")  # rank 5
    bottom = _item("b", item_type=ItemType.bottom, formality="casual")  # rank 1
    sm = SlotMap(top="t", bottom="b")
    # distance = spread/MAX = 4/5 = 0.8; contrast 0, statement 0 → W_FORMALITY_DISTANCE·0.8
    assert visibility(sm, _by_id(top, bottom), _lens()) == pytest.approx(0.2 * 0.8)


def test_color_tags_are_normalized_before_lookup():
    top = _item("t", colors=["RED"])
    bottom = _item("b", item_type=ItemType.bottom, colors=["Blue"])
    sm = SlotMap(top="t", bottom="b")
    # uppercase/mixed-case normalize → warm vs cool → contrast still fires
    assert visibility(sm, _by_id(top, bottom), _lens()) == pytest.approx(W_CONTRAST)


def test_unmatched_colors_collapse_to_other_family_cohesive_not_contrasting():
    # Two non-neutral colors that match no COLOR_FAMILIES entry both map to "other" (§G), so
    # they share the "other" family → cohesive, and their family sets are not disjoint → no
    # contrast. Locks the documented unmatched-color branch of _color_families (the CV-emits-an-
    # odd-label case) — distinct from the missing-color path (no color info at all).
    top = _item("t", colors=["chartreuse"])
    bottom = _item("b", item_type=ItemType.bottom, colors=["mauve"])
    sm = SlotMap(top="t", bottom="b")
    ibid = _by_id(top, bottom)
    # cohesion 1.0 (shared "other"), neutral 0, formality 1.0, occasion 1.0 → 0.75
    assert compatibility(sm, ibid, _lens()) == pytest.approx(0.75)
    assert visibility(sm, ibid, _lens()) == 0.0  # {"other"} vs {"other"} not disjoint → no contrast


# ============================================================================
# single-item outfit (lone dress) — the 0-pairs edge (§G)
# ============================================================================


def test_lone_dress_single_item_has_no_pair_terms():
    dress = _item("d", item_type=ItemType.dress)
    sm = SlotMap(dress="d")
    compat = compatibility(sm, _by_id(dress), _lens())
    vis = visibility(sm, _by_id(dress), _lens())
    # 0 pairs → cohesion 1.0, contrast 0.0; neutral 0; formality 1.0; occasion 1.0
    assert compat == pytest.approx(0.75)
    assert vis == 0.0
    assert assign_path(compat) is OptionPath.reliable
    assert assign_risk(vis) is Risk.safe


def test_lone_neutral_dress_is_max_compatibility():
    dress = _item("d", item_type=ItemType.dress, colors=["navy"])
    sm = SlotMap(dress="d")
    # neutral 1.0, cohesion 1.0 (0 pairs), formality 1.0, occasion 1.0 → 1.0
    assert compatibility(sm, _by_id(dress), _lens()) == pytest.approx(1.0)


# ============================================================================
# weather penalty — bands, max-not-sum, indoor no-op, clamp (§G)
# ============================================================================


def test_weather_band_thresholds():
    assert _warmth_band(0) == 0
    assert _warmth_band(2) == 0
    assert _warmth_band(3) == 1  # boundary → mild band
    assert _warmth_band(5) == 1
    assert _warmth_band(6) == 2  # boundary → cold band
    assert _warmth_band(10) == 2  # max warmth → cold band (range membership would miss this)


def test_target_band_indoor_outdoor_have_no_penalty_band():
    assert _target_band("hot") == 0
    assert _target_band("mild") == 1
    assert _target_band("cold") == 2
    assert _target_band("indoor") is None
    assert _target_band("outdoor") is None


def test_weather_penalty_applies_for_warm_clothes_in_hot_weather():
    top = _item("t", warmth=9)  # band 2
    bottom = _item("b", item_type=ItemType.bottom, warmth=8)  # band 2
    sm = SlotMap(top="t", bottom="b")
    ibid = _by_id(top, bottom)
    # indoor → no penalty (0.75); cold (target 2, dist 0) → 0.75; hot (target 0, dist 2 → -1.0) → clamp 0.0
    assert compatibility(sm, ibid, _lens(weather="indoor")) == pytest.approx(0.75)
    assert compatibility(sm, ibid, _lens(weather="cold")) == pytest.approx(0.75)
    assert compatibility(sm, ibid, _lens(weather="hot")) == 0.0


def test_weather_penalty_uses_max_not_sum():
    # Two band-2 items in mild (target 1): MAX band-distance is 1 → penalty 0.5 → 0.25. If it
    # summed (2 → 1.0), compat would clamp to 0.0 — so 0.25 proves it is the max, not the sum.
    top = _item("t", warmth=9)
    bottom = _item("b", item_type=ItemType.bottom, warmth=7)
    sm = SlotMap(top="t", bottom="b")
    assert compatibility(sm, _by_id(top, bottom), _lens(weather="mild")) == pytest.approx(0.25)


# ============================================================================
# clamp + purity/determinism
# ============================================================================


def test_scores_stay_in_unit_interval_under_extremes():
    top = _item("t", colors=["red"], styles=["neon"], formality="black tie", warmth=10)
    bottom = _item(
        "b", item_type=ItemType.bottom, colors=["blue"], styles=["graphic"],
        formality="loungewear", warmth=10,
    )
    sm = SlotMap(top="t", bottom="b")
    ibid = _by_id(top, bottom)
    for weather in ("hot", "mild", "cold", "indoor", "outdoor"):
        lens = _lens(occasion="gala dinner", weather=weather)
        assert 0.0 <= compatibility(sm, ibid, lens) <= 1.0
        assert 0.0 <= visibility(sm, ibid, lens) <= 1.0


def test_scoring_is_pure_and_deterministic():
    top = _item("t", colors=["red"], formality="casual")
    bottom = _item("b", item_type=ItemType.bottom, colors=["white"], formality="business")
    sm = SlotMap(top="t", bottom="b")
    ibid = _by_id(top, bottom)
    lens = _lens(occasion="work", weather="mild")
    assert compatibility(sm, ibid, lens) == compatibility(sm, ibid, lens)
    assert visibility(sm, ibid, lens) == visibility(sm, ibid, lens)


# ============================================================================
# assign_path / assign_risk — bucketing at the thresholds (§G / Appendix B)
# ============================================================================


def test_assign_path_thresholds():
    assert assign_path(1.0) is OptionPath.reliable
    assert assign_path(PATH_RELIABLE_MIN) is OptionPath.reliable  # >= → reliable
    assert assign_path(PATH_RELIABLE_MIN - 1e-9) is OptionPath.bridge
    assert assign_path(PATH_STRETCH_MAX + 1e-9) is OptionPath.bridge
    assert assign_path(PATH_STRETCH_MAX) is OptionPath.stretch  # <= → stretch
    assert assign_path(0.0) is OptionPath.stretch


def test_assign_risk_thresholds():
    assert assign_risk(1.0) is Risk.bold
    assert assign_risk(RISK_BOLD_MIN) is Risk.bold  # >= → bold
    assert assign_risk(RISK_BOLD_MIN - 1e-9) is Risk.noticeable
    assert assign_risk(RISK_SAFE_MAX + 1e-9) is Risk.noticeable
    assert assign_risk(RISK_SAFE_MAX) is Risk.safe  # <= → safe
    assert assign_risk(0.0) is Risk.safe


# ============================================================================
# _ordered_items — §6.5 base-first ordering
# ============================================================================


def test_ordered_items_two_piece_base_then_outer_then_shoes():
    sm = SlotMap(top="t", bottom="b", outer="o", shoes="s")
    assert _ordered_items(sm) == (
        ("t", Role.base_top),
        ("b", Role.base_bottom),
        ("o", Role.outer_layer),
        ("s", Role.shoes),
    )


def test_ordered_items_one_piece_dress_first():
    sm = SlotMap(dress="d", shoes="s")
    assert _ordered_items(sm) == (("d", Role.one_piece), ("s", Role.shoes))


def test_ordered_items_omits_absent_optionals():
    sm = SlotMap(top="t", bottom="b")
    assert _ordered_items(sm) == (("t", Role.base_top), ("b", Role.base_bottom))


# ============================================================================
# select_spread — 2-D spread, collapse, cold/warm ordering (§G)
# ============================================================================


def _variant(
    full_sig: str, *, score: float, compat: float, path: OptionPath, risk: Risk
) -> OutfitVariant:
    """A minimal OutfitVariant for select_spread tests — only score/compat/path/risk/sig matter."""
    return OutfitVariant(
        items=(("x", Role.base_top),),
        template=Template.two_piece,
        option_path=path,
        risk=risk,
        style_move=FrozenStyleMove(move_type="m", changed_item_ids=("x",), one_sentence="s"),
        score=score,
        score_breakdown=ScoreBreakdown(
            base=score, combo=0.0, item=0.0, dislike=0.0, overuse=0.0, repetition=0.0, cooldown=0.0
        ),
        base_key="bk",
        full_signature=full_sig,
        compatibility=compat,
        visibility=0.0,
    )


def _spread(variants: list[OutfitVariant], n: int):
    """Run select_spread with a fake RankerResult (only full_signature is read off its outfits)."""
    ranked = SimpleNamespace(
        outfits=tuple(SimpleNamespace(full_signature=v.full_signature) for v in variants)
    )
    by_sig = {v.full_signature: v for v in variants}
    return select_spread(ranked, by_sig, n)


def test_select_spread_spans_distinct_cells_and_prefers_spread_over_score():
    v1 = _variant("s1", score=1.0, compat=0.9, path=OptionPath.reliable, risk=Risk.safe)
    v2 = _variant("s2", score=1.0, compat=0.8, path=OptionPath.reliable, risk=Risk.safe)  # dup cell
    v3 = _variant("s3", score=1.0, compat=0.7, path=OptionPath.bridge, risk=Risk.noticeable)
    v4 = _variant("s4", score=1.0, compat=0.6, path=OptionPath.stretch, risk=Risk.bold)
    selected, collapsed = _spread([v1, v2, v3, v4], 3)
    assert collapsed is False
    # v2 is skipped for spread even though its compatibility (0.8) beats v4's (0.6) — diversity wins.
    assert [v.full_signature for v in selected] == ["s1", "s3", "s4"]
    assert len({(v.option_path, v.risk) for v in selected}) == 3


def test_select_spread_collapses_when_cells_cluster():
    v1 = _variant("s1", score=1.0, compat=0.9, path=OptionPath.reliable, risk=Risk.safe)
    v2 = _variant("s2", score=1.0, compat=0.8, path=OptionPath.reliable, risk=Risk.safe)
    v3 = _variant("s3", score=1.0, compat=0.7, path=OptionPath.reliable, risk=Risk.safe)
    selected, collapsed = _spread([v1, v2, v3], 3)
    assert collapsed is True  # only 1 distinct cell available → padded with duplicates
    assert [v.full_signature for v in selected] == ["s1", "s2", "s3"]  # top-n in re-sorted order
    assert len({(v.option_path, v.risk) for v in selected}) == 1


def test_select_spread_compatibility_led_under_flat_ranker_scores():
    # Cold start: ranker scores are flat (all 1.0) → compatibility is the effective sort key (§G).
    v_lo = _variant("a", score=1.0, compat=0.3, path=OptionPath.stretch, risk=Risk.safe)
    v_hi = _variant("b", score=1.0, compat=0.9, path=OptionPath.reliable, risk=Risk.bold)
    v_mid = _variant("c", score=1.0, compat=0.6, path=OptionPath.bridge, risk=Risk.noticeable)
    selected, collapsed = _spread([v_lo, v_hi, v_mid], 3)
    assert [v.compatibility for v in selected] == [0.9, 0.6, 0.3]
    assert collapsed is False


def test_select_spread_ranker_score_leads_when_scores_differ():
    # Warm regime: a real (higher) ranker score wins over higher compatibility — degrades correctly.
    v_high_score = _variant("a", score=5.0, compat=0.1, path=OptionPath.reliable, risk=Risk.safe)
    v_low_score = _variant("b", score=1.0, compat=0.9, path=OptionPath.bridge, risk=Risk.bold)
    selected, _ = _spread([v_low_score, v_high_score], 2)
    assert selected[0].full_signature == "a"  # ranker score leads; compatibility only tie-breaks


def test_select_spread_full_signature_breaks_exact_ties():
    v_b = _variant("bbb", score=1.0, compat=0.5, path=OptionPath.bridge, risk=Risk.safe)
    v_a = _variant("aaa", score=1.0, compat=0.5, path=OptionPath.bridge, risk=Risk.bold)
    selected, _ = _spread([v_b, v_a], 2)
    assert [v.full_signature for v in selected] == ["aaa", "bbb"]  # full_signature ascending


def test_select_spread_fewer_than_n_is_not_a_collapse():
    # Two distinct-celled variants, n=3: the spread worked; the pool was just thin (count, not cell).
    v1 = _variant("s1", score=1.0, compat=0.9, path=OptionPath.reliable, risk=Risk.safe)
    v2 = _variant("s2", score=1.0, compat=0.6, path=OptionPath.bridge, risk=Risk.bold)
    selected, collapsed = _spread([v1, v2], 3)
    assert len(selected) == 2
    assert collapsed is False


def test_select_spread_empty_pool():
    selected, collapsed = _spread([], 3)
    assert selected == []
    assert collapsed is False


# ============================================================================
# end-to-end — rescue() surfaces OutfitVariants (hermetic, StubGenerator only)
# ============================================================================


def _vp(item_id: str, role: Role) -> dict:
    return {"itemId": item_id, "role": role.value}


def _outfit(items: list, changed: list, *, style_move: bool = True) -> dict:
    out: dict = {"items": [_vp(iid, role) for iid, role in items]}
    if style_move:
        out["styleMove"] = {
            "moveType": "layer", "changedItemIds": list(changed), "oneSentence": "Do the thing.",
        }
    return out


def _envelope(*outfits: dict) -> str:
    return json.dumps({"outfits": list(outfits)})


def _rich_wardrobe() -> list:
    return [
        _item("t1", colors=["green"], styles=["solid"], occasions=["casual"], formality="casual", warmth=4),
        _item("b1", item_type=ItemType.bottom, colors=["white"], occasions=["casual"], formality="casual"),
        _item("b2", item_type=ItemType.bottom, colors=["red"], occasions=["formal"], formality="business"),
        _item("s1", item_type=ItemType.shoes, colors=["white"], warmth=3),
    ]


def _rich_request() -> RescueRequest:
    return RescueRequest(
        wardrobe=_rich_wardrobe(), forced_item_id="t1", occasion="casual", weather="mild",
        session_id="sess-c5", wardrobe_version=1,
    )


def _three_outfits() -> str:
    return _envelope(
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]),
        _outfit([("t1", Role.base_top), ("b2", Role.base_bottom)], ["t1"]),
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom), ("s1", Role.shoes)], ["s1"]),
    )


def test_rescue_surfaces_outfit_variants_with_path_risk_and_scores():
    result = rescue(_rich_request(), StubGenerator(_three_outfits()))
    assert len(result.variants) == 3
    for v in result.variants:
        assert isinstance(v, OutfitVariant)
        assert isinstance(v.option_path, OptionPath)  # path/risk live ONLY at the response layer
        assert isinstance(v.risk, Risk)
        assert v.style_move is not None  # decision 8 — every surfaced variant explains itself
        assert any(item_id == "t1" for item_id, _ in v.items)  # forced item preserved in assembly
        assert 0.0 <= v.compatibility <= 1.0
        assert 0.0 <= v.visibility <= 1.0
        # score == Σ breakdown deltas (N4) preserved verbatim through the response layer.
        bd = v.score_breakdown
        assert v.score == pytest.approx(
            bd.base + bd.combo + bd.item + bd.dislike + bd.overuse + bd.repetition + bd.cooldown
        )


def test_rescue_variants_preserve_section_6_5_item_ordering():
    result = rescue(_rich_request(), StubGenerator(_three_outfits()))
    shoe_variants = [v for v in result.variants if any(r is Role.shoes for _, r in v.items)]
    assert shoe_variants  # the t1+b1+s1 outfit surfaced
    roles = [role for _, role in shoe_variants[0].items]
    assert roles == [Role.base_top, Role.base_bottom, Role.shoes]  # base-first, then shoes (§6.5)


def test_rescue_variants_carry_keys_matching_ranked_outfits():
    result = rescue(_rich_request(), StubGenerator(_three_outfits()))
    ranked_sigs = {o.full_signature for o in result.ranked.outfits}
    for v in result.variants:
        assert v.base_key  # emitted for later feedback binding (M4)
        assert v.full_signature in ranked_sigs  # variants wrap exactly the ranked survivors


def test_rescue_keeps_ranked_alongside_variants():
    # C5 is additive: ranked (the full ≤k pool select_spread chose from) is retained, not replaced.
    result = rescue(_rich_request(), StubGenerator(_three_outfits()))
    assert result.ranked is not None
    assert len(result.variants) <= len(result.ranked.outfits)
    assert isinstance(result.spread_collapsed, bool)


def test_rescue_forced_dress_one_piece_variant_ordering():
    wardrobe = [
        _item("d1", item_type=ItemType.dress, colors=["navy"], formality="cocktail"),
        _item("o1", item_type=ItemType.outer_layer, colors=["black"]),
        _item("s1", item_type=ItemType.shoes, colors=["black"]),
    ]
    request = RescueRequest(
        wardrobe=wardrobe, forced_item_id="d1", occasion="dinner", weather="cold",
        session_id="sess-dress", wardrobe_version=1,
    )
    canned = _envelope(
        _outfit([("d1", Role.one_piece)], ["d1"]),
        _outfit([("d1", Role.one_piece), ("s1", Role.shoes)], ["s1"]),
        _outfit([("d1", Role.one_piece), ("o1", Role.outer_layer)], ["o1"]),
    )
    result = rescue(request, StubGenerator(canned))
    assert len(result.variants) == 3
    for v in result.variants:
        assert v.items[0] == ("d1", Role.one_piece)  # the dress leads every one_piece variant
        assert v.template is Template.one_piece


def test_rescue_pre_gpt_exit_has_empty_variants_and_no_collapse():
    request = RescueRequest(
        wardrobe=[_item("t1")], forced_item_id="t1", occasion="x", weather="mild",
        session_id="s", wardrobe_version=1,
    )
    result = rescue(request, StubGenerator("never used"))
    assert result.not_enough_items is True
    assert result.ranked is None
    assert result.variants == ()
    assert result.spread_collapsed is False


def test_rescue_single_survivor_is_insufficient_but_not_collapsed():
    single = _envelope(_outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]))
    result = rescue(_rich_request(), StubGenerator(single))
    assert len(result.variants) == 1
    assert result.insufficient_after_generation is True  # 1 < n_surfaced
    assert result.spread_collapsed is False  # a single variant cannot share a cell


def test_rescue_with_variants_is_deterministic():
    a = rescue(_rich_request(), StubGenerator(_three_outfits()))
    b = rescue(_rich_request(), StubGenerator(_three_outfits()))
    assert a == b
    assert a.variants == b.variants  # OutfitVariants compare equal (frozen, pure scores)
