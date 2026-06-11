"""M0-2 contract tests for the core data model (plan §3, M0-2).

Covers the plan's enumerated cases: construction with/without optionals, warmth
boundaries (0 and 10), unknown `type` rejected, tags accept arbitrary strings.
"""

import pytest

from fitted_core.models import ItemType, Role, SlotMap, Template, WardrobeItem


def test_construct_with_only_required_fields():
    item = WardrobeItem("x1", "Tee", ItemType.top, warmth=5, image_url="x1.jpg")
    # Optionals absent → empty tags, None material/formality.
    assert item.style_tags == []
    assert item.color_tags == []
    assert item.occasion_tags == []
    assert item.material is None
    assert item.formality is None


def test_construct_with_all_optional_fields():
    item = WardrobeItem(
        "x2", "Wool coat", ItemType.outer_layer, warmth=9, image_url="x2.jpg",
        style_tags=["formal"], color_tags=["#222"], occasion_tags=["work"],
        material="wool", formality="formal",
    )
    assert item.material == "wool"
    assert item.formality == "formal"


@pytest.mark.parametrize("warmth", [0, 10])
def test_warmth_accepts_boundaries(warmth):
    item = WardrobeItem("x3", "Item", ItemType.top, warmth=warmth, image_url="x3.jpg")
    assert item.warmth == warmth


@pytest.mark.parametrize("warmth", [-1, 11])
def test_warmth_rejects_out_of_range(warmth):
    with pytest.raises(ValueError):
        WardrobeItem("x4", "Item", ItemType.top, warmth=warmth, image_url="x4.jpg")


def test_type_rejects_unknown_value():
    with pytest.raises(ValueError):
        WardrobeItem("x5", "Item", "cape", warmth=5, image_url="x5.jpg")


def test_type_accepts_wire_string():
    # The M5 adapter hands string types; __post_init__ coerces them to the enum.
    item = WardrobeItem("x6", "Item", "outer_layer", warmth=5, image_url="x6.jpg")
    assert item.type is ItemType.outer_layer


def test_tags_accept_arbitrary_strings():
    item = WardrobeItem(
        "x7", "Item", ItemType.top, warmth=5, image_url="x7.jpg",
        style_tags=["y2k", "🔥 streetwear"], color_tags=["teal", "#00FF00"],
        occasion_tags=["brunch", "first date"],
    )
    assert "🔥 streetwear" in item.style_tags
    assert item.occasion_tags == ["brunch", "first date"]


def test_item_type_members_and_order():
    # Order is load-bearing for R4 (M1 RNG-consumption order).
    assert [t.value for t in ItemType] == ["top", "bottom", "dress", "outer_layer", "shoes"]


def test_template_and_role_members():
    assert {t.value for t in Template} == {"one_piece", "two_piece"}
    assert {r.value for r in Role} == {
        "base_top", "base_bottom", "one_piece", "outer_layer", "shoes",
    }


def test_slotmap_defaults_all_none():
    sm = SlotMap()
    assert (sm.dress, sm.top, sm.bottom, sm.outer, sm.shoes) == (None, None, None, None, None)


def test_slotmap_partial_construction():
    sm = SlotMap(top="t1", bottom="b1", shoes="s1")
    assert sm.top == "t1" and sm.bottom == "b1" and sm.shoes == "s1"
    assert sm.dress is None and sm.outer is None
