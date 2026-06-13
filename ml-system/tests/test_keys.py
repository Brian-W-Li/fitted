"""M0-3 contract tests — BaseKey + FullSignature (spec §5, spec-resolutions R10).

Covers the exact spec string examples, the §5.3 key-responsibility invariant
(same dress + different outer ⇒ same BaseKey, different FullSignature), and the
R10 preconditions (invalid base, reserved chars, the "none" sentinel id).
"""

import pytest

from fitted_core.keys import base_key, full_signature
from fitted_core.models import SlotMap


# --- Exact spec examples (§5.1/§5.2) ---

def test_base_key_two_piece():
    assert base_key(SlotMap(top="abc", bottom="def")) == "abc:def"


def test_base_key_one_piece():
    assert base_key(SlotMap(dress="ghi")) == "ghi"


def test_full_signature_outer_no_shoes():
    sm = SlotMap(top="abc", bottom="def", outer="ghi")
    assert full_signature(sm) == "abc:def|outer=ghi|shoes=none"


def test_full_signature_bare_two_piece():
    sm = SlotMap(top="abc", bottom="def")
    assert full_signature(sm) == "abc:def|outer=none|shoes=none"


def test_full_signature_one_piece_full():
    sm = SlotMap(dress="ghi", outer="jkl", shoes="mno")
    assert full_signature(sm) == "ghi|outer=jkl|shoes=mno"


# --- §5.3 key-responsibility invariant (conflating them is called a bug) ---

def test_same_dress_different_outer_same_basekey_different_fullsig():
    a = SlotMap(dress="ghi", outer="jacketA")
    b = SlotMap(dress="ghi", outer="jacketB")
    assert base_key(a) == base_key(b)  # same silhouette
    assert full_signature(a) != full_signature(b)  # distinct variant


# --- R10 precondition 1: structurally invalid base raises ---

@pytest.mark.parametrize("slotmap", [
    SlotMap(),                              # empty — no base
    SlotMap(dress="d1", top="t1"),          # mixed templates
    SlotMap(top="t1"),                      # incomplete two_piece
])
def test_invalid_base_raises(slotmap):
    with pytest.raises(ValueError):
        base_key(slotmap)
    with pytest.raises(ValueError):
        full_signature(slotmap)


# --- R10 precondition 2: reserved char / sentinel in a participating itemId raises ---

@pytest.mark.parametrize("bad_id", ["a:b", "a|b", "a=b", "none"])
def test_reserved_or_sentinel_id_in_base_raises(bad_id):
    with pytest.raises(ValueError):
        base_key(SlotMap(dress=bad_id))
    with pytest.raises(ValueError):
        base_key(SlotMap(top=bad_id, bottom="ok"))


@pytest.mark.parametrize("bad_id", ["a:b", "a|b", "a=b", "none"])
def test_reserved_or_sentinel_id_in_optional_slots_raises(bad_id):
    # outer/shoes are guarded only by full_signature (base ids by base_key).
    with pytest.raises(ValueError):
        full_signature(SlotMap(top="t1", bottom="b1", outer=bad_id))
    with pytest.raises(ValueError):
        full_signature(SlotMap(top="t1", bottom="b1", shoes=bad_id))


def test_base_key_ignores_reserved_char_in_optional_slots():
    # BaseKey is the silhouette key — it excludes outer/shoes (§5.1), so a reserved
    # char in those slots must NOT make base_key raise (only full_signature guards
    # them, per R10). Pins that base_key reads only the base ids.
    assert base_key(SlotMap(top="t1", bottom="b1", outer="a:b", shoes="c|d")) == "t1:b1"


def test_objectid_shaped_ids_never_trip_the_guard():
    # Real ids are 24-char ObjectId hex — zero false-reject risk (R10).
    sm = SlotMap(top="0123456789abcdef01234567", bottom="89abcdef0123456789abcdef")
    assert base_key(sm) == "0123456789abcdef01234567:89abcdef0123456789abcdef"
