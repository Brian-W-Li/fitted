"""M0-4 contract tests — normalize_to_slotmap + is_valid_slotmap (v2 §8/§13).

The densest correctness surface in M0. Split by owner is the point: the
normalizer-owned rejects (duplicate role-owned slot, unknown role) are
*inexpressible* as a collapsed SlotMap, so they can only be tested through the raw
role-tagged input; the slot-level rejects are tested on SlotMaps directly.
"""

import pytest

from fitted_core.models import IssueCode, SlotMap, Template
from fitted_core.slotmap import is_valid_slotmap, normalize_to_slotmap, template_of


# ============================ normalize_to_slotmap ============================

# --- valid shapes round-trip into the expected slots ---

def test_normalize_one_piece():
    sm, reason = normalize_to_slotmap([{"itemId": "d1", "role": "one_piece"}])
    assert reason is None
    assert sm == SlotMap(dress="d1")


def test_normalize_two_piece_with_outer_and_shoes():
    sm, reason = normalize_to_slotmap([
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "b1", "role": "base_bottom"},
        {"itemId": "o1", "role": "outer_layer"},
        {"itemId": "s1", "role": "shoes"},
    ])
    assert reason is None
    assert sm == SlotMap(top="t1", bottom="b1", outer="o1", shoes="s1")


# --- normalizer-owned rejects: a duplicate of EACH of the five role-owned slots ---

@pytest.mark.parametrize("role", [
    "base_top", "base_bottom", "one_piece", "outer_layer", "shoes",
])
def test_normalize_rejects_duplicate_role(role):
    # A second item for an already-seen role would be silently overwritten — reject.
    sm, code = normalize_to_slotmap([
        {"itemId": "x1", "role": role},
        {"itemId": "x2", "role": role},
    ])
    assert sm is None
    assert code is IssueCode.duplicate_role_slot


def test_normalize_rejects_unknown_role():
    sm, code = normalize_to_slotmap([{"itemId": "x1", "role": "mid_layer"}])
    assert sm is None
    assert code is IssueCode.unknown_role


def test_normalize_empty_list_defers_emptiness_to_is_valid():
    # Boundary contract (N3): the empty-outfit reject belongs to is_valid_slotmap,
    # NOT the normalizer. normalize([]) must succeed with an empty SlotMap so the
    # slot-level validator owns the rejection — pin it so a refactor can't move it.
    sm, code = normalize_to_slotmap([])
    assert code is None and sm == SlotMap()
    valid, vcode = is_valid_slotmap(sm)
    assert not valid and vcode is IssueCode.empty_base


# ============================== is_valid_slotmap ==============================

# --- every valid shape (one_piece, two_piece, each ± outer/shoes) ---

@pytest.mark.parametrize("slotmap", [
    SlotMap(dress="d1"),
    SlotMap(dress="d1", outer="o1"),
    SlotMap(dress="d1", shoes="s1"),
    SlotMap(dress="d1", outer="o1", shoes="s1"),
    SlotMap(top="t1", bottom="b1"),
    SlotMap(top="t1", bottom="b1", outer="o1"),
    SlotMap(top="t1", bottom="b1", shoes="s1"),
    SlotMap(top="t1", bottom="b1", outer="o1", shoes="s1"),
])
def test_is_valid_accepts_valid_shapes(slotmap):
    valid, reason = is_valid_slotmap(slotmap)
    assert valid and reason is None


# --- every slot-level invalid shape ---

@pytest.mark.parametrize("slotmap,code", [
    (SlotMap(dress="d1", top="t1"), IssueCode.mixed_template),
    (SlotMap(dress="d1", bottom="b1"), IssueCode.mixed_template),
    (SlotMap(), IssueCode.empty_base),
    (SlotMap(outer="o1", shoes="s1"), IssueCode.empty_base),  # optionals only, no base
    (SlotMap(top="t1"), IssueCode.incomplete_two_piece),
    (SlotMap(bottom="b1"), IssueCode.incomplete_two_piece),
    (SlotMap(top="dup", bottom="dup"), IssueCode.duplicate_item_id),
    (SlotMap(top="t1", bottom="b1", shoes="t1"), IssueCode.duplicate_item_id),
])
def test_is_valid_rejects_invalid_shapes(slotmap, code):
    valid, vcode = is_valid_slotmap(slotmap)
    assert not valid
    assert vcode is code


# ================================ template_of ================================

def test_template_of_one_piece():
    assert template_of(SlotMap(dress="d1")) is Template.one_piece


def test_template_of_two_piece():
    assert template_of(SlotMap(top="t1", bottom="b1")) is Template.two_piece


def test_template_of_invalid_raises():
    with pytest.raises(ValueError):
        template_of(SlotMap(dress="d1", top="t1"))
