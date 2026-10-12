"""R23 explicit mid-layer eligibility, identity and exact-control regressions."""
import pytest

from fitted_core.models import ItemType, IssueCode, Role, SlotMap, WardrobeItem
from fitted_core.keys import base_key, full_signature
from fitted_core.validator import validate_gpt_payload
from fitted_core.sampler import CAP_BY_TYPE, ColdStartSignalScorer, RequestContext, build_candidate_pool
from fitted_core.rescue import _scope_pool_to_pins
from fitted_core.response import _ordered_items
from fitted_core.ranker import _copy_slot_map, _filled_slot_ids


def item(item_id, item_type="top", layer_role=None):
    return WardrobeItem(item_id, item_id, item_type, 5, "", layer_role=layer_role)


def candidate(*entries):
    return {"items": [{"itemId": i, "role": r} for i, r in entries]}


@pytest.mark.parametrize("outer", [None, "jacket"])
def test_layered_outfit_validates_exact_members_keys_and_style_move(outer):
    pool = [item("tee"), item("sweater", layer_role="mid"), item("pants", "bottom"), item("shoe", "shoes"), item("jacket", "outer_layer")]
    entries = [("tee", "base_top"), ("pants", "base_bottom"), ("sweater", "mid_layer"), ("shoe", "shoes")]
    if outer:
        entries.append((outer, "outer_layer"))
    draft = candidate(*entries)
    draft["styleMove"] = {"moveType": "layer", "changedItemIds": ["sweater"], "oneSentence": "Wear the sweater over the tee."}
    result = validate_gpt_payload({"outfits": [draft]}, pool)
    assert not result.rejections and not result.warnings
    accepted = result.candidates[0]
    assert accepted.slot_map.mid == "sweater"
    assert accepted.base_key == "tee:pants"
    assert accepted.full_signature == f"tee:pants|outer={outer or 'none'}|shoes=shoe|mid=sweater"
    assert accepted.style_move.changed_item_ids == ["sweater"]
    assert _ordered_items(accepted.slot_map)[2] == ("sweater", Role.mid_layer)
    assert "sweater" in _filled_slot_ids(accepted.slot_map)
    assert _copy_slot_map(accepted.slot_map).mid == "sweater"


def test_mid_as_sole_top_preserves_unlayered_signature():
    pool = [item("sweater", layer_role="mid"), item("pants", "bottom")]
    result = validate_gpt_payload({"outfits": [candidate(("sweater", "base_top"), ("pants", "base_bottom"))]}, pool)
    assert result.candidates[0].full_signature == "sweater:pants|outer=none|shoes=none"
    assert result.candidates[0].slot_map.mid is None
    assert base_key(SlotMap(top="tee", bottom="pants", mid="sweater")) == "tee:pants"


@pytest.mark.parametrize("role", [None, "base", "outer"])
def test_unmarked_or_ineligible_top_cannot_be_mid(role):
    pool = [item("tee"), item("sweater", layer_role=role), item("pants", "bottom")]
    result = validate_gpt_payload({"outfits": [candidate(("tee", "base_top"), ("pants", "base_bottom"), ("sweater", "mid_layer"))]}, pool)
    assert not result.candidates
    assert result.rejections[0].code == IssueCode.role_type_mismatch


@pytest.mark.parametrize("entries,code", [
    ([("tee", "base_top"), ("pants", "base_bottom"), ("m1", "mid_layer"), ("m2", "mid_layer")], IssueCode.duplicate_role_slot),
    ([("dress", "one_piece"), ("m1", "mid_layer")], IssueCode.mixed_template),
    ([("m1", "base_top"), ("pants", "base_bottom"), ("m1", "mid_layer")], IssueCode.duplicate_item_id),
    ([("m1", "base_top"), ("pants", "base_bottom"), ("m2", "mid_layer")], IssueCode.role_type_mismatch),
    ([("tee", "base_top"), ("pants", "base_bottom"), ("shoe", "mid_layer")], IssueCode.role_type_mismatch),
])
def test_layer_structural_and_eligibility_rejections(entries, code):
    pool = [item("tee"), item("pants", "bottom"), item("dress", "dress"), item("m1", layer_role="mid"), item("m2", layer_role="mid"), item("shoe", "shoes")]
    result = validate_gpt_payload({"outfits": [candidate(*entries)]}, pool)
    assert not result.candidates
    assert result.rejections[0].code == code


def test_signature_dedup_distinguishes_mid_and_checks_reserved_mid_ids():
    pool = [item("tee"), item("pants", "bottom"), item("m1", layer_role="mid"), item("m2", layer_role="mid")]
    drafts = [candidate(("tee", "base_top"), ("pants", "base_bottom")), candidate(("tee", "base_top"), ("pants", "base_bottom"), ("m1", "mid_layer")), candidate(("tee", "base_top"), ("pants", "base_bottom"), ("m2", "mid_layer"))]
    result = validate_gpt_payload({"outfits": drafts}, pool)
    assert len(result.candidates) == 3
    assert len({c.full_signature for c in result.candidates}) == 3
    with pytest.raises(ValueError):
        full_signature(SlotMap(top="tee", bottom="pants", mid="bad|id"))


def test_candidate_item_bound_is_five():
    draft = candidate(*[(str(i), "base_top") for i in range(6)])
    result = validate_gpt_payload({"outfits": [draft]}, [])
    assert result.rejections[0].code == IssueCode.invalid_items


def test_pins_keep_layer_partner_and_solo_mid_without_broadening_legacy_pool():
    tee, other, mid = item("tee"), item("other"), item("mid", layer_role="mid")
    pool = {ItemType.top: [tee, other, mid]}
    assert _scope_pool_to_pins(pool, [tee])[ItemType.top] == [mid, tee]
    assert _scope_pool_to_pins(pool, [mid])[ItemType.top] == [mid, other, tee]
    assert _scope_pool_to_pins(pool, [tee, mid])[ItemType.top] == [mid, tee]
    assert _scope_pool_to_pins({ItemType.top: [tee, other]}, [tee])[ItemType.top] == [tee]


def test_top_sampling_retains_both_groups_with_no_cap_growth_or_input_order_drift():
    context = RequestContext(session_id="r23", wardrobe_version=1, occasion="casual", weather="mild", date="2026-10-11", interaction_count=0)
    wardrobe = [item(f"t{i:03}") for i in range(300)] + [item("mid", layer_role="mid"), item("pants", "bottom")]
    result = build_candidate_pool(wardrobe, context, ColdStartSignalScorer())
    tops = result.pool[ItemType.top]
    assert len(tops) == CAP_BY_TYPE[ItemType.top]
    assert any(i.layer_role == "mid" for i in tops)
    assert any(i.layer_role != "mid" for i in tops)
    assert [i.id for i in tops] == [i.id for i in build_candidate_pool(list(reversed(wardrobe)), context, ColdStartSignalScorer()).pool[ItemType.top]]
