"""Shared pytest fixtures for the fitted_core substrate.

`demo_wardrobe` re-expresses the legacy outfit_recommender.py demo wardrobe in
the v1.2 5-type schema (plan §1.5 decision 2 — re-express, do NOT migrate the
legacy file in place). The legacy demo modeled only top/bottom/footwear, so this
fixture has no dresses or outer layers by design; the larger over-cap synthetic
wardrobe that exercises sampling lands with M1.
"""

import pytest

from fitted_core.models import ItemType, WardrobeItem


# Legacy ids/colors/styles preserved (outfit_recommender.py __main__); FOOTWEAR
# maps to ItemType.shoes. warmth had no legacy analogue — assigned plausibly.
@pytest.fixture
def demo_wardrobe() -> list[WardrobeItem]:
    return [
        WardrobeItem("t1", "Blue tee", ItemType.top, warmth=4, image_url="t1.jpg",
                     color_tags=["#0066CC"], style_tags=["solid"], occasion_tags=["casual"]),
        WardrobeItem("t2", "White tee", ItemType.top, warmth=4, image_url="t2.jpg",
                     color_tags=["#FFFFFF"], style_tags=["solid"], occasion_tags=["casual"]),
        WardrobeItem("t3", "Black dress shirt", ItemType.top, warmth=5, image_url="t3.jpg",
                     color_tags=["#000000"], style_tags=["solid"], occasion_tags=["business"]),
        WardrobeItem("b1", "Black jeans", ItemType.bottom, warmth=5, image_url="b1.jpg",
                     color_tags=["#000000"], style_tags=["solid"], occasion_tags=["casual"]),
        WardrobeItem("b2", "Blue jeans", ItemType.bottom, warmth=5, image_url="b2.jpg",
                     color_tags=["#0000FF"], style_tags=["solid"], occasion_tags=["casual"]),
        WardrobeItem("b3", "Gray slacks", ItemType.bottom, warmth=5, image_url="b3.jpg",
                     color_tags=["#808080"], style_tags=["solid"], occasion_tags=["business"]),
        WardrobeItem("s1", "White sneakers", ItemType.shoes, warmth=3, image_url="s1.jpg",
                     color_tags=["#FFFFFF"], style_tags=["solid"], occasion_tags=["casual"]),
        WardrobeItem("s2", "Black dress shoes", ItemType.shoes, warmth=3, image_url="s2.jpg",
                     color_tags=["#000000"], style_tags=["solid"], occasion_tags=["business"]),
    ]


# Synthetic wardrobe that exceeds every per-type cap (§7.2: tops 35, bottoms 30,
# dresses 25, outer 20, shoes 25), so the sampler's over-cap path is exercised
# for all five types. Ids are generated in DESCENDING order so insertion order
# != id-sorted order — partition's R4 sort must actually do work to pass.
@pytest.fixture
def over_cap_wardrobe() -> list[WardrobeItem]:
    counts = {
        ItemType.top: 40,
        ItemType.bottom: 35,
        ItemType.dress: 30,
        ItemType.outer_layer: 25,
        ItemType.shoes: 30,
    }
    items: list[WardrobeItem] = []
    for item_type, n in counts.items():
        for i in reversed(range(n)):
            items.append(
                WardrobeItem(
                    id=f"{item_type.value}-{i:03d}",
                    name=f"{item_type.value} {i}",
                    type=item_type,
                    warmth=5,
                    image_url=f"{item_type.value}{i}.jpg",
                )
            )
    return items
