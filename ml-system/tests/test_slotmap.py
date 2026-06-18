"""M0-4 contract tests — normalize_to_slotmap + is_valid_slotmap (v2 §8/§13).

The densest correctness surface in M0. Split by owner is the point: the
normalizer-owned rejects (duplicate role-owned slot, unknown role) are
*inexpressible* as a collapsed SlotMap, so they can only be tested through the raw
role-tagged input; the slot-level rejects are tested on SlotMaps directly.
"""

import pytest

from fitted_core.models import SlotMap, Template
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
    sm, reason = normalize_to_slotmap([
        {"itemId": "x1", "role": role},
        {"itemId": "x2", "role": role},
    ])
    assert sm is None
    assert "duplicate assignment to role-owned slot" in reason


def test_normalize_rejects_unknown_role():
    sm, reason = normalize_to_slotmap([{"itemId": "x1", "role": "mid_layer"}])
    assert sm is None
    assert "unknown or unrecognised role" in reason


def test_normalize_empty_list_defers_emptiness_to_is_valid():
    # Boundary contract (N3): the empty-outfit reject belongs to is_valid_slotmap,
    # NOT the normalizer. normalize([]) must succeed with an empty SlotMap so the
    # slot-level validator owns the rejection — pin it so a refactor can't move it.
    sm, reason = normalize_to_slotmap([])
    assert reason is None and sm == SlotMap()
    valid, vreason = is_valid_slotmap(sm)
    assert not valid and "no base role" in vreason


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

@pytest.mark.parametrize("slotmap,fragment", [
    (SlotMap(dress="d1", top="t1"), "mixed templates"),
    (SlotMap(dress="d1", bottom="b1"), "mixed templates"),
    (SlotMap(), "no base role"),
    (SlotMap(outer="o1", shoes="s1"), "no base role"),  # optionals only, no base
    (SlotMap(top="t1"), "incomplete two_piece"),
    (SlotMap(bottom="b1"), "incomplete two_piece"),
    (SlotMap(top="dup", bottom="dup"), "duplicate itemId"),
    (SlotMap(top="t1", bottom="b1", shoes="t1"), "duplicate itemId"),
])
def test_is_valid_rejects_invalid_shapes(slotmap, fragment):
    valid, reason = is_valid_slotmap(slotmap)
    assert not valid
    assert fragment in reason


# ================================ template_of ================================

def test_template_of_one_piece():
    assert template_of(SlotMap(dress="d1")) is Template.one_piece


def test_template_of_two_piece():
    assert template_of(SlotMap(top="t1", bottom="b1")) is Template.two_piece


def test_template_of_invalid_raises():
    with pytest.raises(ValueError):
        template_of(SlotMap(dress="d1", top="t1"))
