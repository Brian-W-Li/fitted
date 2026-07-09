"""C2 tests — rescue pre-GPT half (spearhead.md §C C2 gate, §G steps 1–5).

Gate: allowed template(s) + valid_types per ItemType; the four sufficiency branches;
scoping pins the forced item to exactly ``[forced_item]``, drops invalid types, keeps
siblings, flattened pool has no duplicate ids even when the forced item was also sampled,
and ``prompt_item_count ≤ MAX_PROMPT_ITEMS``; the scoped candidate count incl. floor/cap
(it may exceed the generic sampler count in tiny closets).
"""

import json

import pytest

from fitted_core.config import MAX_CANDIDATES, MAX_PROMPT_ITEMS, MIN_RESCUE_CANDIDATES, N_SURFACED
from fitted_core.generation import GenerationPrompt
from fitted_core.models import ItemType, Role, SlotMap, StyleMove, Template, WardrobeItem
from fitted_core.ranker import FallbackStage
from fitted_core.rescue import (
    _INSUFFICIENT_AFTER_GENERATION_HINT,
    _REPAIR_INSTRUCTION,
    RescueRequest,
    RescueResult,
    _build_prompt,
    _build_request_context,
    _check_sufficiency,
    _drop_invalid,
    _flatten_pool,
    _partition_counts,
    _repair_prompt,
    _rescue_candidate_requested,
    _resolve_forced_item,
    _resolve_shape,
    _scope_pool_to_pins,
    _serialize_pool_item,
    rescue,
    rescue_with_trace,
)
from fitted_core.sampler import (
    ColdStartSignalScorer,
    build_candidate_pool,
    candidate_requested,
)
from fitted_core.validator import ValidatedCandidate
from tests.helpers import StubGenerator


def _item(item_id: str, item_type: ItemType, warmth: int = 5) -> WardrobeItem:
    return WardrobeItem(item_id, item_id, item_type, warmth=warmth, image_url=f"{item_id}.jpg")


def _scoped_counts(*, tops=0, bottoms=0, dresses=0, outer=0, shoes=0):
    """A scoped-pool dict with the given per-type counts (ids unique across types)."""
    def mk(prefix: str, n: int, t: ItemType) -> list[WardrobeItem]:
        return [_item(f"{prefix}{i}", t) for i in range(n)]

    return {
        ItemType.top: mk("t", tops, ItemType.top),
        ItemType.bottom: mk("b", bottoms, ItemType.bottom),
        ItemType.dress: mk("d", dresses, ItemType.dress),
        ItemType.outer_layer: mk("o", outer, ItemType.outer_layer),
        ItemType.shoes: mk("s", shoes, ItemType.shoes),
    }


# ============================================================================
# §G step 1 — _resolve_shape (H22) + _resolve_forced_item
# ============================================================================


def test_resolve_shape_top_and_bottom_are_two_piece_without_dress():
    for forced_type in (ItemType.top, ItemType.bottom):
        templates, valid = _resolve_shape(forced_type)
        assert templates == frozenset({Template.two_piece})
        assert ItemType.dress not in valid  # a dress can't co-occur in a two_piece
        assert valid == frozenset(
            {ItemType.top, ItemType.bottom, ItemType.outer_layer, ItemType.shoes}
        )


def test_resolve_shape_dress_is_one_piece_without_top_or_bottom():
    templates, valid = _resolve_shape(ItemType.dress)
    assert templates == frozenset({Template.one_piece})
    assert valid == frozenset({ItemType.dress, ItemType.outer_layer, ItemType.shoes})
    assert ItemType.top not in valid and ItemType.bottom not in valid


def test_resolve_shape_outer_and_shoes_allow_either_template_and_all_types():
    for forced_type in (ItemType.outer_layer, ItemType.shoes):
        templates, valid = _resolve_shape(forced_type)
        assert templates == frozenset({Template.two_piece, Template.one_piece})
        assert valid == frozenset(ItemType)


def test_resolve_forced_item_found():
    wardrobe = [_item("a", ItemType.top), _item("b", ItemType.bottom)]
    assert _resolve_forced_item(wardrobe, "b").id == "b"


def test_resolve_forced_item_missing_raises_value_error():
    wardrobe = [_item("a", ItemType.top)]
    with pytest.raises(ValueError):
        _resolve_forced_item(wardrobe, "zzz")


# ============================================================================
# §G step 2 — sufficiency (the H22 min-closet rule), the four branches
# ============================================================================


def test_sufficiency_forced_top_needs_a_bottom():
    assert _check_sufficiency({ItemType.top: 1, ItemType.bottom: 0}, ItemType.top) is not None
    assert _check_sufficiency({ItemType.top: 1, ItemType.bottom: 2}, ItemType.top) is None


def test_sufficiency_forced_bottom_needs_a_top():
    assert _check_sufficiency({ItemType.bottom: 1, ItemType.top: 0}, ItemType.bottom) is not None
    assert _check_sufficiency({ItemType.bottom: 1, ItemType.top: 3}, ItemType.bottom) is None


def test_sufficiency_forced_dress_is_always_buildable():
    assert _check_sufficiency({ItemType.dress: 1}, ItemType.dress) is None
    assert _check_sufficiency({}, ItemType.dress) is None  # even an otherwise-empty closet


def test_sufficiency_forced_outer_or_shoes_needs_some_base():
    for forced_type in (ItemType.outer_layer, ItemType.shoes):
        # no base at all → insufficient
        assert _check_sufficiency({forced_type: 1}, forced_type) is not None
        # only tops (no bottoms, no dress) → still insufficient
        assert _check_sufficiency({ItemType.top: 2}, forced_type) is not None
        # a complete two_piece base → ok
        assert _check_sufficiency({ItemType.top: 1, ItemType.bottom: 1}, forced_type) is None
        # a one_piece base → ok
        assert _check_sufficiency({ItemType.dress: 1}, forced_type) is None


def test_partition_counts(demo_wardrobe):
    counts = _partition_counts(demo_wardrobe)
    assert counts[ItemType.top] == 3
    assert counts[ItemType.bottom] == 3
    assert counts[ItemType.shoes] == 2
    assert counts[ItemType.dress] == 0
    assert counts[ItemType.outer_layer] == 0


# ============================================================================
# §G step 3 — _build_request_context
# ============================================================================


def test_build_request_context_maps_fields_and_pins_cold_start():
    request = RescueRequest(
        wardrobe=[_item("t1", ItemType.top)],
        forced_item_id="t1",
        occasion="brunch",
        weather="mild",
        session_id="sess-1",
        wardrobe_version=7,
        date="2026-06-23",
    )
    ctx = _build_request_context(request)
    assert ctx.occasion == "brunch"
    assert ctx.weather == "mild"
    assert ctx.session_id == "sess-1"
    assert ctx.wardrobe_version == 7
    assert ctx.date == "2026-06-23"
    assert ctx.interaction_count == 0  # cold start (rung 1) — signal slot stays unreachable


def test_rescue_request_defaults():
    request = RescueRequest(
        wardrobe=[_item("t1", ItemType.top)],
        forced_item_id="t1",
        occasion="casual",
        weather="mild",
        session_id="s",
        wardrobe_version=1,
    )
    assert request.generation_index == 0
    assert request.k == 10  # DEFAULT_K — the ranker fill target, NOT n_surfaced
    assert request.n_surfaced == 3
    assert request.date is None


@pytest.mark.parametrize(
    ("value", "exc"),
    [(0, ValueError), (-1, ValueError), (True, TypeError), (1.5, TypeError), ("3", TypeError)],
)
def test_rescue_request_rejects_invalid_n_surfaced(value, exc):
    with pytest.raises(exc, match="n_surfaced"):
        RescueRequest(
            wardrobe=[_item("t1", ItemType.top)],
            forced_item_id="t1",
            occasion="casual",
            weather="mild",
            session_id="s",
            wardrobe_version=1,
            n_surfaced=value,
        )


def test_rescue_request_rejects_n_surfaced_greater_than_k():
    # The surfaced set is drawn FROM the ranked pool of <= k (§G), so n_surfaced > k is an
    # impossible budget — every render would be marked insufficient_after_generation.
    with pytest.raises(ValueError, match="n_surfaced=4 exceeds k=3"):
        RescueRequest(
            wardrobe=[_item("t1", ItemType.top)],
            forced_item_id="t1",
            occasion="casual",
            weather="mild",
            session_id="s",
            wardrobe_version=1,
            k=3,
            n_surfaced=4,
        )


@pytest.mark.parametrize(
    ("value", "exc"),
    [(0, ValueError), (-1, ValueError), (False, TypeError), (1.5, TypeError), ("10", TypeError)],
)
def test_rescue_request_rejects_invalid_k_up_front(value, exc):
    with pytest.raises(exc, match="k"):
        RescueRequest(
            wardrobe=[_item("t1", ItemType.top)],
            forced_item_id="t1",
            occasion="casual",
            weather="mild",
            session_id="s",
            wardrobe_version=1,
            k=value,
        )


@pytest.mark.parametrize("value", [None, True, 1.5, "0"])
def test_rescue_request_rejects_non_int_generation_index_up_front(value):
    with pytest.raises(TypeError, match="generation_index"):
        RescueRequest(
            wardrobe=[_item("t1", ItemType.top)],
            forced_item_id="t1",
            occasion="casual",
            weather="mild",
            session_id="s",
            wardrobe_version=1,
            generation_index=value,
        )


# ============================================================================
# §G step 4 — _scope_pool_to_forced + _flatten_pool (the rescue "pin")
# ============================================================================


def test_scope_pins_forced_drops_invalid_keeps_siblings_no_dupes():
    forced = _item("t1", ItemType.top, warmth=4)
    sibling_top = _item("t2", ItemType.top, warmth=4)
    bottom = _item("b1", ItemType.bottom)
    dress = _item("d1", ItemType.dress)
    shoes = _item("s1", ItemType.shoes)
    # forced item is ALSO present among the sampled tops (the dup-risk case).
    pool = {
        ItemType.top: [forced, sibling_top],
        ItemType.bottom: [bottom],
        ItemType.dress: [dress],
        ItemType.outer_layer: [],
        ItemType.shoes: [shoes],
    }
    scoped = _scope_pool_to_pins(pool, [forced])

    assert scoped[ItemType.top] == [forced]  # pinned to exactly the forced item (t2 dropped)
    assert scoped[ItemType.bottom] == [bottom]  # usable sibling type kept
    assert scoped[ItemType.dress] == []  # invalid type for a forced top dropped
    assert scoped[ItemType.shoes] == [shoes]  # optional kept

    flat = _flatten_pool(scoped)
    ids = [it.id for it in flat]
    assert len(ids) == len(set(ids))  # no duplicate ids even though forced was also sampled
    assert ids.count("t1") == 1
    assert "t2" not in ids and "d1" not in ids


def test_scope_is_idempotent_when_forced_was_not_sampled():
    # Forced item dropped by cap sampling → scoping re-includes it by construction (§H).
    forced = _item("t1", ItemType.top)
    pool = {
        ItemType.top: [],  # forced absent (e.g. cap-dropped)
        ItemType.bottom: [_item("b1", ItemType.bottom)],
        ItemType.dress: [],
        ItemType.outer_layer: [],
        ItemType.shoes: [],
    }
    scoped = _scope_pool_to_pins(pool, [forced])
    assert scoped[ItemType.top] == [forced]
    assert "t1" in {it.id for it in _flatten_pool(scoped)}


def test_scope_forced_dress_drops_tops_and_bottoms_keeps_optionals():
    # A forced dress is a one_piece base → tops AND bottoms can never co-occur (§G step 4).
    forced = _item("d1", ItemType.dress)
    outer = _item("o1", ItemType.outer_layer)
    shoes = _item("s1", ItemType.shoes)
    pool = {
        ItemType.top: [_item("t1", ItemType.top), _item("t2", ItemType.top)],
        ItemType.bottom: [_item("b1", ItemType.bottom)],
        ItemType.dress: [forced, _item("d2", ItemType.dress)],
        ItemType.outer_layer: [outer],
        ItemType.shoes: [shoes],
    }
    scoped = _scope_pool_to_pins(pool, [forced])

    assert set(scoped.keys()) == set(ItemType)  # every type key always present
    assert scoped[ItemType.dress] == [forced]  # pinned, sibling d2 dropped
    assert scoped[ItemType.top] == []  # tops invalid for a forced dress
    assert scoped[ItemType.bottom] == []  # bottoms invalid for a forced dress
    assert scoped[ItemType.outer_layer] == [outer]  # optional role kept
    assert scoped[ItemType.shoes] == [shoes]
    # enum-ordered flatten over a dress base: dress, then optionals only.
    assert [it.id for it in _flatten_pool(scoped)] == ["d1", "o1", "s1"]


def test_scope_forced_outer_pins_outer_keeps_every_base():
    # A forced outer layers onto EITHER template → all five base/optional types stay (§G step 1/4).
    forced = _item("o1", ItemType.outer_layer)
    pool = {
        ItemType.top: [_item("t1", ItemType.top)],
        ItemType.bottom: [_item("b1", ItemType.bottom)],
        ItemType.dress: [_item("d1", ItemType.dress)],
        ItemType.outer_layer: [forced, _item("o2", ItemType.outer_layer)],
        ItemType.shoes: [_item("s1", ItemType.shoes)],
    }
    scoped = _scope_pool_to_pins(pool, [forced])

    assert scoped[ItemType.outer_layer] == [forced]  # pinned, sibling o2 dropped
    assert [it.id for it in scoped[ItemType.top]] == ["t1"]
    assert [it.id for it in scoped[ItemType.bottom]] == ["b1"]
    assert [it.id for it in scoped[ItemType.dress]] == ["d1"]
    assert [it.id for it in scoped[ItemType.shoes]] == ["s1"]
    ids = [it.id for it in _flatten_pool(scoped)]
    assert len(ids) == len(set(ids))  # no duplicate ids
    assert "o2" not in ids


def test_flatten_pool_is_enum_ordered():
    scoped = {
        ItemType.top: [_item("t1", ItemType.top)],
        ItemType.bottom: [_item("b1", ItemType.bottom)],
        ItemType.dress: [_item("d1", ItemType.dress)],
        ItemType.outer_layer: [_item("o1", ItemType.outer_layer)],
        ItemType.shoes: [_item("s1", ItemType.shoes)],
    }
    flat = _flatten_pool(scoped)
    assert [it.type for it in flat] == list(ItemType)


def test_scoped_pool_respects_max_prompt_items_via_real_sampler(over_cap_wardrobe):
    # Integration: build a real over-cap pool, scope it, and confirm the §G invariants hold
    # against the actual sampler output (scoping only removes items → bound preserved).
    forced_id = "top-000"
    request = RescueRequest(
        wardrobe=over_cap_wardrobe,
        forced_item_id=forced_id,
        occasion="casual",
        weather="mild",
        session_id="sess",
        wardrobe_version=1,
    )
    forced = _resolve_forced_item(over_cap_wardrobe, forced_id)
    ctx = _build_request_context(request)
    sampler_result = build_candidate_pool(over_cap_wardrobe, ctx, ColdStartSignalScorer())

    scoped = _scope_pool_to_pins(sampler_result.pool, [forced])
    flat = _flatten_pool(scoped)
    ids = [it.id for it in flat]

    assert len(flat) <= MAX_PROMPT_ITEMS
    assert len(ids) == len(set(ids))  # no duplicate ids
    assert forced_id in ids  # forced item present regardless of cap sampling
    assert scoped[forced.type] == [forced]  # pinned to exactly the forced item
    assert scoped[ItemType.dress] == []  # dresses invalid for a forced top


# ============================================================================
# §G step 5 — _rescue_candidate_requested (formula + floor/cap)
# ============================================================================


def test_rescue_count_forced_top_uses_complementary_bottoms():
    scoped = _scoped_counts(tops=1, bottoms=4)  # scoped top pinned to the forced item
    assert _rescue_candidate_requested(scoped, ItemType.top) == 12  # 4 * 3, within bounds


def test_rescue_count_forced_bottom_uses_complementary_tops():
    scoped = _scoped_counts(tops=10, bottoms=1)
    assert _rescue_candidate_requested(scoped, ItemType.bottom) == 30  # 10 * 3


def test_rescue_count_applies_floor_on_tiny_closet():
    scoped = _scoped_counts(tops=1, bottoms=1)  # forced top, 1 complementary bottom
    # 1 * 3 = 3, clamped UP to the floor.
    assert _rescue_candidate_requested(scoped, ItemType.top) == MIN_RESCUE_CANDIDATES


def test_rescue_count_forced_dress_is_floored():
    scoped = _scoped_counts(dresses=1)  # the forced dress is the only base → complementary = 1
    assert _rescue_candidate_requested(scoped, ItemType.dress) == MIN_RESCUE_CANDIDATES


def test_rescue_count_forced_outer_counts_all_bases_and_caps():
    scoped = _scoped_counts(tops=10, bottoms=10)  # (10*10) + 0 = 100 → 300, capped
    assert _rescue_candidate_requested(scoped, ItemType.outer_layer) == MAX_CANDIDATES


def test_rescue_count_forced_shoes_counts_two_piece_and_one_piece_bases():
    scoped = _scoped_counts(tops=2, bottoms=2, dresses=1)  # (2*2) + 1 = 5 → 15
    assert _rescue_candidate_requested(scoped, ItemType.shoes) == 15


def test_rescue_count_can_exceed_generic_sampler_count_in_tiny_closet():
    # The §G floor is the load-bearing half: a lone forced dress gets 6 (floored) where the
    # generic sampler would ask for only 3 (1 base * 3).
    scoped = _scoped_counts(dresses=1)
    rescue_n = _rescue_candidate_requested(scoped, ItemType.dress)
    generic_n = candidate_requested(scoped)
    assert generic_n == 3
    assert rescue_n == MIN_RESCUE_CANDIDATES
    assert rescue_n > generic_n


# ============================================================================
# §G step 6 / §D — _build_prompt + the prompt artifact (C3)
# ============================================================================
#
# Golden/snapshot-style: assert the prompt *contract surface* (§D) and byte-stability, NOT
# the full string. The exact wording iterates in C6 eval (§D "the exact wording iterates in
# C6"), so pinning the whole prompt would force churn there; the load-bearing guarantee is
# that the §D rules, the forced-item identity, the pool ids, the candidate bound, and the
# imageUrl/warmth strip are all present and stable across identical calls.


def _rich_top(item_id: str = "t1") -> WardrobeItem:
    return WardrobeItem(
        item_id, "Green graphic tee", ItemType.top, warmth=4, image_url="SECRET_t1.png",
        style_tags=["graphic"], color_tags=["green"], occasion_tags=["casual"],
        material="cotton", formality="casual",
    )


def _rich_dress(item_id: str = "d1") -> WardrobeItem:
    return WardrobeItem(
        item_id, "Red wrap dress", ItemType.dress, warmth=3, image_url="SECRET_d1.png",
        style_tags=["statement"], color_tags=["red"], occasion_tags=["cocktail"],
        material="silk", formality="cocktail",
    )


def _forced_top_scope():
    """A scoped pool around a forced top: forced top + 1 bottom + 1 shoes (no dresses)."""
    forced = _rich_top()
    bottom = WardrobeItem("b1", "Blue jeans", ItemType.bottom, warmth=5, image_url="SECRET_b1.png")
    shoes = WardrobeItem("s1", "White sneakers", ItemType.shoes, warmth=3, image_url="SECRET_s1.png")
    scoped = {
        ItemType.top: [forced],
        ItemType.bottom: [bottom],
        ItemType.dress: [],
        ItemType.outer_layer: [],
        ItemType.shoes: [shoes],
    }
    request = RescueRequest(
        wardrobe=[forced, bottom, shoes],
        forced_item_id=forced.id,
        occasion="weekend brunch",
        weather="mild",
        session_id="sess",
        wardrobe_version=1,
    )
    return scoped, request, forced


# --- _serialize_pool_item: the imageUrl/warmth strip (§D / §12) ---


def test_serialize_pool_item_has_exactly_the_gpt_visible_fields():
    item = _rich_top()
    out = _serialize_pool_item(item)
    assert set(out) == {
        "id", "name", "type", "style_tags", "color_tags", "occasion_tags", "material", "formality",
    }
    # imageUrl + warmth are stripped from GPT-visible item data (§12 GPT-payload rule).
    assert "image_url" not in out and "imageUrl" not in out
    assert "warmth" not in out
    assert out["id"] == "t1"
    assert out["type"] == "top"  # the wire value, not the enum repr
    assert out["name"] == "Green graphic tee"  # name kept — rich styling signal (§D)


# --- _build_prompt: shape + determinism ---


def test_build_prompt_returns_generation_prompt():
    scoped, request, forced = _forced_top_scope()
    prompt = _build_prompt(scoped, request, forced)
    assert isinstance(prompt, GenerationPrompt)
    assert isinstance(prompt.system, str) and prompt.system
    assert isinstance(prompt.user, str) and prompt.user


def test_build_prompt_is_deterministic_byte_for_byte():
    scoped, request, forced = _forced_top_scope()
    a = _build_prompt(scoped, request, forced)
    b = _build_prompt(scoped, request, forced)
    assert (a.system, a.user, a.candidate_requested) == (b.system, b.user, b.candidate_requested)


# --- candidate_requested carried + surfaced in the ask ---


def test_build_prompt_carries_and_surfaces_candidate_requested():
    scoped, request, forced = _forced_top_scope()
    prompt = _build_prompt(scoped, request, forced)
    expected = _rescue_candidate_requested(scoped, forced.type)
    assert expected == MIN_RESCUE_CANDIDATES  # 1 bottom → 1*3=3, floored to 6
    assert prompt.candidate_requested == expected
    assert f"Return up to {expected} outfits." in prompt.user  # bound == the ask (no desync)


def test_build_prompt_candidate_requested_is_dynamic_not_hardcoded():
    # Above-floor case: forced top with 5 complementary bottoms → 5*3 = 15 (> floor, < cap).
    # The floored test above coincides with MIN_RESCUE_CANDIDATES, so a count hardcoded to 6
    # would still pass it — this proves the bound is genuinely computed and surfaced verbatim.
    forced = _rich_top()
    bottoms = [
        WardrobeItem(f"b{i}", f"bottom {i}", ItemType.bottom, warmth=5, image_url=f"b{i}.png")
        for i in range(5)
    ]
    scoped = {
        ItemType.top: [forced],
        ItemType.bottom: bottoms,
        ItemType.dress: [],
        ItemType.outer_layer: [],
        ItemType.shoes: [],
    }
    request = RescueRequest(
        wardrobe=[forced, *bottoms],
        forced_item_id=forced.id,
        occasion="work",
        weather="cold",
        session_id="s",
        wardrobe_version=1,
    )
    prompt = _build_prompt(scoped, request, forced)
    assert prompt.candidate_requested == 15
    assert prompt.candidate_requested != MIN_RESCUE_CANDIDATES  # not the floor constant
    assert "Return up to 15 outfits." in prompt.user


# --- forced-item identity present (system rule + user callout) ---


def test_build_prompt_includes_forced_item_identity():
    scoped, request, forced = _forced_top_scope()
    prompt = _build_prompt(scoped, request, forced)
    assert "MUST include the forced item" in prompt.system
    assert forced.id in prompt.system  # the system hard rule names the forced id
    assert forced.id in prompt.user  # the user message calls it out explicitly
    assert forced.name in prompt.user


# --- every pool id is serialized into the prompt ---


def test_build_prompt_includes_every_pool_id():
    scoped, request, forced = _forced_top_scope()
    prompt = _build_prompt(scoped, request, forced)
    for item in _flatten_pool(scoped):
        assert f'"id": "{item.id}"' in prompt.user  # serialized as a read-only input attr


# --- imageUrl / warmth values never leak into the prompt ---


def test_build_prompt_does_not_leak_image_urls():
    scoped, request, forced = _forced_top_scope()
    prompt = _build_prompt(scoped, request, forced)
    full = prompt.system + "\n" + prompt.user
    # The distinctive image_url values are stripped (§12) — none appear anywhere.
    for url in ("SECRET_t1.png", "SECRET_b1.png", "SECRET_s1.png"):
        assert url not in full
    assert "image_url" not in full  # nor the input key


# --- required §D schema rules ---


def test_build_prompt_states_required_schema_rules():
    scoped, request, forced = _forced_top_scope()
    sys = _build_prompt(scoped, request, forced).system
    # strict JSON-only + output schema
    assert "STRICTLY VALID JSON" in sys
    assert '"itemId"' in sys and '"role"' in sys
    assert "EXACTLY two keys" in sys and "EXACTLY three keys" in sys
    # template + styleMove-required + non-empty changedItemIds subset
    assert "two_piece" in sys and "one_piece" in sys
    assert "styleMove" in sys
    assert "NON-EMPTY subset" in sys
    # vibe range (decision 5) but never GPT-labelled
    assert "RANGE of vibes" in sys
    assert "Do NOT label, score, or rank" in sys
    # every backend Role value is offered
    for role in Role:
        assert role.value in sys


def test_build_prompt_forbids_label_and_stripped_fields_in_output():
    scoped, request, forced = _forced_top_scope()
    sys = _build_prompt(scoped, request, forced).system
    # §12 forbidden output fields are named so GPT does not emit them.
    for forbidden in ("optionPath", "risk", "score", "rank", "imageUrl", "warmth"):
        assert forbidden in sys
    # the input attributes must not be echoed into the output items.
    assert "do NOT copy them into the output items" in sys


# --- forced-dress lone-one_piece changedItemIds sub-case (§D) ---


def test_build_prompt_forced_dress_states_lone_dress_changed_ids_rule():
    forced = _rich_dress()
    outer = WardrobeItem("o1", "Denim jacket", ItemType.outer_layer, warmth=6, image_url="o1.png")
    shoes = WardrobeItem("s1", "Heels", ItemType.shoes, warmth=2, image_url="s1.png")
    scoped = {
        ItemType.top: [],
        ItemType.bottom: [],
        ItemType.dress: [forced],
        ItemType.outer_layer: [outer],
        ItemType.shoes: [shoes],
    }
    request = RescueRequest(
        wardrobe=[forced, outer, shoes],
        forced_item_id=forced.id,
        occasion="dinner",
        weather="cold",
        session_id="sess",
        wardrobe_version=1,
    )
    sys = _build_prompt(scoped, request, forced).system
    # the lone-dress instruction is present and pins changedItemIds to [forcedItemId].
    assert "dress alone" in sys
    assert f'["{forced.id}"]' in sys  # the load-bearing contract: pinned to [forcedItemId]
    assert "can never be empty" in sys


def test_build_prompt_non_dress_omits_lone_dress_rule():
    # The lone-one_piece sub-case can only occur for a forced dress, so a forced-top prompt
    # must not carry the dress-alone instruction (kept minimal — §D conditional).
    scoped, request, forced = _forced_top_scope()
    sys = _build_prompt(scoped, request, forced).system
    assert "dress alone" not in sys


def test_build_prompt_lone_dress_pool_is_well_formed():
    # The §H "forced dress, otherwise empty closet" edge: the scoped pool is the dress alone —
    # the actual single-item outfit the dress-alone changedItemIds rule guards. The prompt
    # must still be well-formed: one pool item, forced id present, rule present, count floored.
    forced = _rich_dress()
    scoped = {item_type: [] for item_type in ItemType}
    scoped[ItemType.dress] = [forced]
    request = RescueRequest(
        wardrobe=[forced],
        forced_item_id=forced.id,
        occasion="party",
        weather="indoor",
        session_id="s",
        wardrobe_version=1,
    )
    prompt = _build_prompt(scoped, request, forced)
    assert f'"id": "{forced.id}"' in prompt.user
    assert prompt.user.count('"id":') == 1  # exactly one pool item serialized
    assert "dress alone" in prompt.system
    assert prompt.candidate_requested == MIN_RESCUE_CANDIDATES  # lone dress → 1*3=3, floored


# ============================================================================
# §G steps 7–9 — rescue() orchestration (C4)
# ============================================================================
#
# Hermetic + deterministic: every test injects a StubGenerator — no live OpenAI, ever (§A/§I).
# These tests assert on the C4 surface — the ranked, forced-item + StyleMove-validated survivors
# (RescueResult.ranked). The C5 OutfitVariant surface (path/risk/spread) layered over that same
# ranked field is covered in test_response.py; C5 is purely additive, so these stay valid.


def _vp(item_id: str, role: Role) -> dict:
    """One GPT output item — exactly {itemId, role} (the §12 output schema)."""
    return {"itemId": item_id, "role": role.value}


def _outfit(
    items: list[tuple[str, Role]],
    changed_ids: list[str],
    *,
    move_type: str = "layer",
    sentence: str = "A concrete styling idea.",
    style_move: bool = True,
) -> dict:
    """A §12 candidate: items + (optionally) a valid styleMove over a subset of the outfit ids."""
    outfit: dict = {"items": [_vp(iid, role) for iid, role in items]}
    if style_move:
        outfit["styleMove"] = {
            "moveType": move_type,
            "changedItemIds": list(changed_ids),
            "oneSentence": sentence,
        }
    return outfit


def _envelope(*outfits: dict) -> str:
    """The strict §12 root envelope as a JSON string (what a Generator returns)."""
    return json.dumps({"outfits": list(outfits)})


def _forced_top_request(*, n_bottoms: int = 2, with_shoes: bool = True) -> RescueRequest:
    """A forced-top rescue over a tiny under-cap closet (sampler pool = include_all)."""
    wardrobe = [_item("t1", ItemType.top)]
    wardrobe += [_item(f"b{i}", ItemType.bottom) for i in range(1, n_bottoms + 1)]
    if with_shoes:
        wardrobe.append(_item("s1", ItemType.shoes))
    return RescueRequest(
        wardrobe=wardrobe,
        forced_item_id="t1",
        occasion="weekend brunch",
        weather="mild",
        session_id="sess-c4",
        wardrobe_version=1,
    )


def _three_distinct_outfits() -> str:
    """Three forced-top outfits with distinct FullSignatures (≥ n_surfaced, all valid)."""
    return _envelope(
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]),
        _outfit([("t1", Role.base_top), ("b2", Role.base_bottom)], ["t1"]),
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom), ("s1", Role.shoes)], ["s1"]),
    )


# --- success path: validated + ranked survivors ---


def test_rescue_success_returns_ranked_validated_candidates():
    request = _forced_top_request()
    result = rescue(request, StubGenerator(_three_distinct_outfits()))

    assert isinstance(result, RescueResult)
    assert result.not_enough_items is False
    assert result.ranked is not None
    assert len(result.ranked.outfits) == 3  # three distinct survivors
    for outfit in result.ranked.outfits:
        assert outfit.slot_map.top == "t1"  # every outfit includes the forced item
        assert outfit.style_move is not None  # every outfit carries its StyleMove (decision 8)
    # 3 distinct outfits ≥ n_surfaced → no post-generation shortfall.
    assert result.insufficient_after_generation is False
    assert result.reason_hint is None


# --- caller-contract precondition: duplicate ids fail loud BEFORE the pre-GPT sufficiency exit ---


def test_rescue_raises_on_duplicate_ids_before_the_insufficiency_exit():
    # Forced top + NO bottom is the pre-GPT insufficient case (would return not_enough_items).
    # A duplicate logical id must STILL fail loud (R12): the early guard fires before the
    # sufficiency exit that would otherwise mask the caller misuse on an insufficient closet.
    wardrobe = [
        _item("t1", ItemType.top),
        _item("s1", ItemType.shoes),
        _item("s1", ItemType.shoes),  # duplicate id
    ]
    request = RescueRequest(
        wardrobe=wardrobe,
        forced_item_id="t1",
        occasion="x",
        weather="mild",
        session_id="sess-dup",
        wardrobe_version=1,
    )
    with pytest.raises(ValueError, match="duplicate logical item id"):
        rescue(request, StubGenerator(_three_distinct_outfits()))


def test_rescue_with_trace_also_rejects_duplicate_ids_before_sufficiency():
    wardrobe = [
        _item("t1", ItemType.top),
        _item("s1", ItemType.shoes),
        _item("s1", ItemType.shoes),  # duplicate id
    ]
    request = RescueRequest(
        wardrobe=wardrobe,
        forced_item_id="t1",
        occasion="x",
        weather="mild",
        session_id="sess-dup2",
        wardrobe_version=1,
    )
    with pytest.raises(ValueError, match="duplicate logical item id"):
        rescue_with_trace(request, StubGenerator(_three_distinct_outfits()))


def test_rescue_insufficient_without_dup_still_returns_not_enough_items():
    # Control: the same insufficient closet (forced top, no bottom) WITHOUT a duplicate id returns
    # the graceful not_enough_items — proving the raise above is the dup, not the insufficiency.
    request = _forced_top_request(n_bottoms=0)
    result = rescue(request, StubGenerator(_three_distinct_outfits()))
    assert result.not_enough_items is True


def test_rescue_sufficiency_exit_preserves_engine_visible_prompt_pool():
    # The pre-GPT structural sufficiency exit is a valid no-spend empty render, not a lost row:
    # it must preserve the engine-visible wardrobe (forced item included) so the failure is
    # self-explaining, and record the honest "no ask" candidate_requested=0 (never None) — the
    # same convention the daily understocked branch uses.
    request = _forced_top_request(n_bottoms=0)  # forced top, no bottom → insufficient, + shoes
    stub = StubGenerator(_three_distinct_outfits())

    trace = rescue_with_trace(request, stub)

    assert stub.call_count == 0  # no generator call, no spend
    assert trace.result.not_enough_items is True
    assert [item.id for item in trace.prompt_pool] == ["t1", "s1"]  # engine-visible closet
    assert "t1" in [item.id for item in trace.prompt_pool]  # the forced item is present
    assert trace.candidate_requested == 0  # honest no-ask, never None
    assert trace.attempts == ()
    assert trace.validation is None


def test_rescue_calls_generator_with_a_generation_prompt():
    stub = StubGenerator(_three_distinct_outfits())
    rescue(_forced_top_request(), stub)
    assert stub.call_count == 1
    assert isinstance(stub.prompts[0], GenerationPrompt)


def test_rescue_uses_prompt_candidate_requested_as_validator_bound(monkeypatch):
    import fitted_core.rescue as rescue_mod

    captured: dict = {}
    real = rescue_mod.validate_gpt_payload

    def spy(payload, sampled_pool, candidate_requested):
        captured["bound"] = candidate_requested
        return real(payload, sampled_pool, candidate_requested)

    monkeypatch.setattr(rescue_mod, "validate_gpt_payload", spy)

    stub = StubGenerator(_three_distinct_outfits())
    rescue(_forced_top_request(), stub)

    # The validator bound is exactly the value carried on the prompt the generator was handed —
    # one computation, so the "return up to N" ask and the validator bound can never desync (§G6).
    assert captured["bound"] == stub.prompts[0].candidate_requested


# --- the two Spearhead drops (forced item + StyleMove), end-to-end ---


def test_rescue_drops_candidate_missing_forced_item():
    # Forced SHOES: a valid base-only outfit (t1+b1, no shoes) omits the forced item and is
    # dropped end-to-end, while the shoe-bearing outfit survives.
    wardrobe = [
        _item("t1", ItemType.top),
        _item("b1", ItemType.bottom),
        _item("s1", ItemType.shoes),
    ]
    request = RescueRequest(
        wardrobe=wardrobe, forced_item_id="s1", occasion="dinner", weather="mild",
        session_id="sess", wardrobe_version=1,
    )
    canned = _envelope(
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom), ("s1", Role.shoes)], ["s1"]),
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]),  # omits forced shoes
    )
    result = rescue(request, StubGenerator(canned))
    assert result.ranked is not None
    assert len(result.ranked.outfits) == 1
    assert result.ranked.outfits[0].slot_map.shoes == "s1"


def test_rescue_drops_candidate_missing_style_move():
    request = _forced_top_request(n_bottoms=2, with_shoes=False)
    canned = _envelope(
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]),                # styleMove
        _outfit([("t1", Role.base_top), ("b2", Role.base_bottom)], [], style_move=False),  # none
    )
    result = rescue(request, StubGenerator(canned))
    assert result.ranked is not None
    assert len(result.ranked.outfits) == 1
    assert result.ranked.outfits[0].slot_map.bottom == "b1"  # the styleMove-bearing outfit
    assert result.ranked.outfits[0].style_move is not None


def test_rescue_drops_candidate_with_malformed_style_move():
    # The PRESENT-but-invalid branch (not just absent): a styleMove whose changedItemIds names an
    # id outside the outfit fails M2's H23 subset check, so M2 attaches no StyleMove (style_move
    # stays None) — and decision 8 then drops the whole outfit, exactly as an absent styleMove
    # would. Confirms malformed → None → dropped end-to-end through the validator→rescue handoff.
    request = _forced_top_request(n_bottoms=2, with_shoes=False)
    canned = _envelope(
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]),  # valid styleMove
        # changedItemIds=["b1"] but this outfit is {t1, b2} → b1 ∉ outfit → H23 fail → dropped.
        _outfit([("t1", Role.base_top), ("b2", Role.base_bottom)], ["b1"]),
    )
    result = rescue(request, StubGenerator(canned))
    assert result.ranked is not None
    assert len(result.ranked.outfits) == 1
    assert result.ranked.outfits[0].slot_map.bottom == "b1"  # only the valid-styleMove outfit


# --- _drop_invalid in isolation (unambiguous, no pipeline coupling) ---


def _validated(source_index: int, slot_map: SlotMap, *, style_move) -> ValidatedCandidate:
    """A minimal real ValidatedCandidate for the _drop_invalid unit tests."""
    from fitted_core.keys import base_key, full_signature
    from fitted_core.slotmap import template_of

    return ValidatedCandidate(
        source_index=source_index,
        slot_map=slot_map,
        template=template_of(slot_map),
        base_key=base_key(slot_map),
        full_signature=full_signature(slot_map),
        style_move=style_move,
    )


def test_drop_invalid_keeps_forced_with_style_move():
    sm = StyleMove(move_type="tuck", changed_item_ids=["t1"], one_sentence="Tuck it.")
    keep = _validated(0, SlotMap(top="t1", bottom="b1"), style_move=sm)
    assert _drop_invalid([keep], "t1") == [keep]


def test_drop_invalid_drops_outfit_without_forced_item():
    sm = StyleMove(move_type="tuck", changed_item_ids=["t2"], one_sentence="...")
    no_forced = _validated(0, SlotMap(top="t2", bottom="b1"), style_move=sm)
    assert _drop_invalid([no_forced], "t1") == []


def test_drop_invalid_drops_outfit_without_style_move():
    no_move = _validated(0, SlotMap(top="t1", bottom="b1"), style_move=None)
    assert _drop_invalid([no_move], "t1") == []


def test_drop_invalid_forced_item_in_optional_slot_counts():
    # The forced item filling an OPTIONAL slot (outer/shoes) still counts as present.
    sm = StyleMove(move_type="layer", changed_item_ids=["o1"], one_sentence="...")
    keep = _validated(0, SlotMap(top="t1", bottom="b1", outer="o1"), style_move=sm)
    assert _drop_invalid([keep], "o1") == [keep]


# --- the one §12 repair (parse failure → blind re-generation) ---


def test_rescue_invalid_json_triggers_exactly_one_repair_then_succeeds():
    stub = StubGenerator(["this is not json", _three_distinct_outfits()])
    result = rescue(_forced_top_request(), stub)

    assert stub.call_count == 2  # initial + exactly one repair retry
    # The retry carried the repair-augmented prompt (blind re-generation, §G step 7); the user
    # half and the validator bound are unchanged, so the retry validates against the same bound.
    assert _REPAIR_INSTRUCTION in stub.prompts[1].system
    assert stub.prompts[1].system != stub.prompts[0].system
    assert stub.prompts[1].user == stub.prompts[0].user
    assert stub.prompts[1].candidate_requested == stub.prompts[0].candidate_requested
    # Repair recovered a parseable payload → survivors ranked.
    assert result.ranked is not None
    assert len(result.ranked.outfits) == 3
    assert result.insufficient_after_generation is False


def test_rescue_failed_repair_returns_clean_insufficient_not_a_crash():
    stub = StubGenerator(["not json", "still not json"])
    result = rescue(_forced_top_request(), stub)

    assert stub.call_count == 2  # one repair only — never a third generation
    assert result.not_enough_items is False  # the closet WAS sufficient; GPT failed, not the user
    assert result.ranked is not None
    assert result.ranked.outfits == ()
    assert result.insufficient_after_generation is True
    assert result.reason_hint == _INSUFFICIENT_AFTER_GENERATION_HINT


def test_repair_prompt_is_immutable_copy_with_repair_instruction():
    base = GenerationPrompt(system="SYS", user="USR", candidate_requested=6)
    repaired = _repair_prompt(base)
    assert repaired is not base
    assert base.system == "SYS"  # original untouched (dataclasses.replace over a frozen prompt)
    assert repaired.system.startswith("SYS")
    assert _REPAIR_INSTRUCTION in repaired.system
    assert repaired.user == "USR"
    assert repaired.candidate_requested == 6


# --- insufficient-after-generation is represented honestly ---


def test_rescue_insufficient_after_generation_on_partial_survival():
    # Only 1 valid outfit returned (< n_surfaced=3) → honest partial, not a failure.
    request = _forced_top_request()
    canned = _envelope(_outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]))
    result = rescue(request, StubGenerator(canned))
    assert result.ranked is not None
    assert len(result.ranked.outfits) == 1
    assert result.insufficient_after_generation is True
    assert result.reason_hint == _INSUFFICIENT_AFTER_GENERATION_HINT
    assert N_SURFACED == 3  # the budget this shortfall is measured against


def test_rescue_all_candidates_dropped_is_insufficient_after_generation():
    # A structurally valid envelope with zero outfits → 0 survivors → graceful insufficient.
    result = rescue(_forced_top_request(), StubGenerator(_envelope()))
    assert result.ranked is not None
    assert result.ranked.outfits == ()
    assert result.not_enough_items is False
    assert result.insufficient_after_generation is True


def test_rescue_validator_rejected_candidate_flows_to_insufficient():
    # A VALIDATOR rejection (a hallucinated id outside the scoped pool → itemOutsideSampledPool),
    # distinct from the rescue-level forced-item/StyleMove drops: it never reaches _drop_invalid,
    # yet the pipeline still degrades to a graceful insufficient (0 survivors), never a crash. The
    # forced item IS present here, so the only thing keeping the outfit out is the M2 pool guard.
    request = _forced_top_request()  # pool = {t1, b1, b2, s1}
    canned = _envelope(
        _outfit([("t1", Role.base_top), ("ghost", Role.base_bottom)], ["t1"]),  # ghost ∉ pool
    )
    result = rescue(request, StubGenerator(canned))
    assert result.ranked is not None
    assert result.ranked.outfits == ()
    assert result.not_enough_items is False  # the closet was buildable; GPT hallucinated an id
    assert result.insufficient_after_generation is True


def test_rescue_duplicate_outfits_dedup_to_one_survivor():
    # GPT repeats an identical outfit: M2 dedups on FullSignature (first occurrence wins), so
    # rescue sees ONE survivor, not two — the M2→rescue handoff never double-counts a repeated
    # generation (and the shortfall is then honestly reported, not papered over with a duplicate).
    request = _forced_top_request()
    dup = _outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"])
    result = rescue(request, StubGenerator(_envelope(dup, dup)))
    assert result.ranked is not None
    assert len(result.ranked.outfits) == 1
    assert result.insufficient_after_generation is True  # 1 distinct < n_surfaced


def test_rescue_ranker_fallback_stage_is_diagnostic_only():
    # k=10 but only 3 outfits exist, so the ranker exhausts its ladder and reports
    # fallback_stage=insufficient — yet rescue surfaced its full n_surfaced budget, so its OWN
    # health flag is False (spearhead.md §G "Reading fallback_stage").
    result = rescue(_forced_top_request(), StubGenerator(_three_distinct_outfits()))
    assert result.ranked is not None
    assert len(result.ranked.outfits) == 3
    assert result.ranked.insufficient_wardrobe is True   # ranker's k-relative view (3 < 10)
    assert result.fallback_stage == FallbackStage.insufficient
    assert result.insufficient_after_generation is False  # rescue's own view: 3 ≥ n_surfaced


# --- pre-GPT exits + determinism ---


def test_rescue_pre_gpt_not_enough_items_never_calls_generator():
    # Forced top with zero bottoms → structurally unbuildable (H22) → no GPT call at all.
    request = RescueRequest(
        wardrobe=[_item("t1", ItemType.top)], forced_item_id="t1", occasion="x",
        weather="mild", session_id="s", wardrobe_version=1,
    )
    stub = StubGenerator("never used")
    result = rescue(request, stub)
    assert result.not_enough_items is True
    assert result.ranked is None
    assert result.fallback_stage is None
    assert result.insufficient_after_generation is False
    assert result.reason_hint is not None
    assert stub.call_count == 0  # short-circuited before any generation


def test_rescue_missing_forced_item_raises_value_error():
    request = RescueRequest(
        wardrobe=[_item("t1", ItemType.top), _item("b1", ItemType.bottom)],
        forced_item_id="zzz", occasion="x", weather="mild", session_id="s", wardrobe_version=1,
    )
    with pytest.raises(ValueError):
        rescue(request, StubGenerator(_envelope()))


def test_rescue_is_deterministic_with_a_fixed_stub():
    # A fixed StubGenerator is a pure function of input; the sampler is seeded and the ranker is
    # seeded by the request context — so two identical rescue() calls compare equal (§J).
    request = _forced_top_request()
    a = rescue(request, StubGenerator(_three_distinct_outfits()))
    b = rescue(request, StubGenerator(_three_distinct_outfits()))
    assert a == b


# --- forced-dress end-to-end: the lone-one_piece + shared-BaseKey sub-case (§G/§D) ---


def _forced_dress_request() -> RescueRequest:
    """A forced-dress rescue: a dress + the two optional roles (outer/shoes) it can layer."""
    wardrobe = [
        _item("d1", ItemType.dress),
        _item("o1", ItemType.outer_layer),
        _item("s1", ItemType.shoes),
    ]
    return RescueRequest(
        wardrobe=wardrobe, forced_item_id="d1", occasion="dinner", weather="cold",
        session_id="sess-dress", wardrobe_version=1,
    )


def test_rescue_forced_dress_surfaces_variants_including_the_lone_dress():
    # The forced-dress sub-case (spearhead.md §G "Forced-dress sub-case"): every candidate is the
    # same one_piece base, so they share one BaseKey (dressId). The normal §14 variant cap keeps
    # only BASEKEY_VARIANT_CAP=2 — but the ranker's variant_cap_relaxed rung re-admits the rest,
    # so all distinct dress variants surface. The lone dress (the ONLY single-item outfit that can
    # occur) survives with its [d1] styleMove (§D lone-dress changedItemIds rule).
    canned = _envelope(
        _outfit([("d1", Role.one_piece)], ["d1"]),                            # lone dress
        _outfit([("d1", Role.one_piece), ("s1", Role.shoes)], ["s1"]),        # dress + shoes
        _outfit([("d1", Role.one_piece), ("o1", Role.outer_layer)], ["o1"]),  # dress + outer
    )
    result = rescue(_forced_dress_request(), StubGenerator(canned))

    assert result.ranked is not None
    assert len(result.ranked.outfits) == 3  # variant_cap_relaxed re-admits past the cap of 2
    for outfit in result.ranked.outfits:
        assert outfit.slot_map.dress == "d1"  # the forced dress is in every outfit
        assert outfit.style_move is not None  # decision 8 — every surfaced outfit explains itself
    # All three share one BaseKey (the dressId) — the §G forced-dress sub-case.
    assert len({outfit.base_key for outfit in result.ranked.outfits}) == 1
    # The lone-dress one_piece (no outer, no shoes) is among the survivors, valid styleMove intact.
    lone = [o for o in result.ranked.outfits if o.slot_map.outer is None and o.slot_map.shoes is None]
    assert len(lone) == 1
    assert result.insufficient_after_generation is False  # 3 ≥ n_surfaced


def test_rescue_forced_top_is_in_every_surfaced_variant_across_distinct_basekeys():
    """The green-shirt invariant, asserted end-to-end: a forced TOP appears in EVERY surfaced
    variant even when the variants span DISTINCT BaseKeys (different bottoms) — not just the
    single-BaseKey dress sub-case. Pins §6.4/§H42 "the forced item is in 100% of rescue candidates"
    through the whole rescue() pipeline (pool pin → prompt → post-validate drop → rank → surface)."""
    wardrobe = [
        _item("t1", ItemType.top),
        _item("b1", ItemType.bottom), _item("b2", ItemType.bottom), _item("b3", ItemType.bottom),
    ]
    request = RescueRequest(
        wardrobe=wardrobe, forced_item_id="t1", occasion="brunch", weather="mild",
        session_id="sess-forced-top", wardrobe_version=1, n_surfaced=3,
    )
    canned = _envelope(
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["b1"]),
        _outfit([("t1", Role.base_top), ("b2", Role.base_bottom)], ["b2"]),
        _outfit([("t1", Role.base_top), ("b3", Role.base_bottom)], ["b3"]),
    )
    result = rescue(request, StubGenerator(canned))

    assert result.ranked is not None
    assert len(result.ranked.outfits) >= 2  # multiple distinct variants surface
    assert len({o.base_key for o in result.ranked.outfits}) >= 2  # spanning distinct BaseKeys
    for outfit in result.ranked.outfits:
        assert outfit.slot_map.top == "t1"  # the forced item is in EVERY surfaced variant


def test_rescue_forced_dress_drops_lone_dress_missing_style_move():
    # The inverse of the §D lone-dress rule: a dress-alone outfit whose styleMove is absent leaves
    # M2's style_move None, and decision 8 drops the whole (only) outfit — graceful insufficient,
    # never a crash on the single-item edge.
    canned = _envelope(_outfit([("d1", Role.one_piece)], [], style_move=False))
    result = rescue(_forced_dress_request(), StubGenerator(canned))

    assert result.ranked is not None
    assert result.ranked.outfits == ()
    assert result.not_enough_items is False  # the closet was buildable; the candidate failed
    assert result.insufficient_after_generation is True
