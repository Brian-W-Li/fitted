"""Bounded class-choice regressions; synthetic metadata, no live model or account writes."""

import json

import pytest

from fitted_core.config import NEUTRAL_COLORS
from fitted_core.models import ItemType, WardrobeItem
from fitted_core.rescue import RenderRequest, render_with_trace
from fitted_core.response import _is_neutral
from tests.helpers import StubGenerator


@pytest.mark.parametrize("color", [
    "off-white", " OFF_WHITE ", "blue-gray", "Blue Grey", "light gray", "light-grey", "charcoal",
])
def test_captured_neutral_shades_match_after_normalization(color):
    item = WardrobeItem("t", "Top", ItemType.top, 5, None, color_tags=[color])
    assert _is_neutral(item)
    assert item.color_tags == [color]  # scoring does not rewrite captured metadata


@pytest.mark.parametrize("color", ["neon gray", "multicolor gray", "blue green", "off-white print"])
def test_unknown_compound_colors_do_not_match_by_substring(color):
    assert not _is_neutral(WardrobeItem("t", "Top", ItemType.top, 5, None, color_tags=[color]))


def _class_case(occasion, *, forced=False):
    rows = [
        ("a-polo", "Off-white pocket polo", "top", 5, ["off-white"]),
        ("b-rugby", "Blue rugby polo", "top", 5, ["blue", "navy", "white"]),
        ("c-tee", "Charcoal graphic tee", "top", 2, ["charcoal", "red", "tan"]),
        ("a-trousers", "Blue-gray straight-leg trousers", "bottom", 5, ["blue-gray"]),
        ("b-joggers", "Navy drawstring joggers", "bottom", 5, ["navy"]),
        ("c-track", "Black track pants", "bottom", 5, ["black", "white"]),
        ("jacket", "White track jacket", "outer_layer", 5, ["white", "black"]),
        ("running", "Gray running sneakers", "shoes", 5, ["gray", "black", "blue"]),
        ("canvas", "Burgundy canvas sneakers", "shoes", 5, ["burgundy", "cream"]),
    ]
    wardrobe = [WardrobeItem(id, name, ItemType(type), warmth, None, color_tags=colors)
                for id, name, type, warmth, colors in rows]
    combinations = [
        ("a-polo", "a-trousers", "running"),
        ("b-rugby", "b-joggers", "running"),
        ("c-tee", "b-joggers", "jacket", "canvas"),
        ("a-polo", "c-track", "jacket", "running"),
    ]
    types = {item.id: item.type.value for item in wardrobe}
    roles = {"top": "base_top", "bottom": "base_bottom", "shoes": "shoes", "outer_layer": "outer_layer"}
    outfits = [{"items": [{"itemId": id, "role": roles[types[id]]} for id in ids],
                "styleMove": {"moveType": "pair", "changedItemIds": [ids[0]],
                              "oneSentence": "Pair these owned pieces."}}
               for ids in combinations]
    request = RenderRequest(
        wardrobe=wardrobe, forced_item_id="a-polo" if forced else None,
        occasion=occasion, weather="mild", session_id="synthetic-class", wardrobe_version=1,
        date="2026-10-11", intent="rescue_item" if forced else "daily",
    )
    return request, json.dumps({"outfits": outfits})


def test_neutral_aliases_restore_generated_trouser_choice_without_selection_policy_change(monkeypatch):
    # Mirrors the observed seam: a generated polo/trouser choice loses to neutral
    # athletic pieces when its captured shade labels miss the neutral lookup.
    request, response = _class_case("Casual outfit for university class")
    with monkeypatch.context() as old:
        old.setattr("fitted_core.response.NEUTRAL_COLORS", NEUTRAL_COLORS - {
            "off white", "blue gray", "blue grey", "light gray", "light grey", "charcoal",
        })
        before = render_with_trace(request, StubGenerator(response))
    after = render_with_trace(request, StubGenerator(response))
    assert len(before.validation.candidates) == len(after.validation.candidates) == 4
    assert len(before.prompt_pool) == len(after.prompt_pool) == len(request.wardrobe)
    assert all("a-trousers" not in {id for id, _ in v.items} for v in before.result.variants)
    assert "a-trousers" in {id for id, _ in after.result.variants[0].items}
    assert all(v.score == 1 for v in after.result.variants)
    assert after.result == render_with_trace(request, StubGenerator(response)).result


@pytest.mark.parametrize("occasion", [
    "Ordinary university class, relaxed everyday clothes",
    "Put-together university class, prefer trousers",
    "Sporty university class, athletic pieces welcome",
])
@pytest.mark.parametrize("forced", [False, True])
def test_requested_class_register_reaches_prompt_with_bounded_styling_guidance(occasion, forced):
    request, response = _class_case(occasion, forced=forced)
    generator = StubGenerator(response)
    trace = render_with_trace(request, generator)
    prompt = generator.prompts[0]
    assert f"Occasion: {occasion}" in prompt.user
    assert "within the user's requested style and level of dress" in prompt.system
    assert "Honor stated garment preferences" in prompt.system
    assert "Vary the base garment combinations" in prompt.system
    assert "do not invent fit, fabric or construction" in prompt.system
    if forced:
        assert all("a-polo" in {id for id, _ in v.items} for v in trace.result.variants)
