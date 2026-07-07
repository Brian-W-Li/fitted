"""M0-5 contract tests — seed derivation (v2 §15 / Appendix A R1, N2-C1).

Covers determinism, per-field sensitivity (including the C1 ``date`` param and
``generationIndex``), the wrapper/primitive delegation, the length-prefix framing
guard, the typed-None sentinel distinctness, and RNG reproducibility.

NOTE (codex M0 clarifications): no universal collision-freedom property is
asserted — length-prefix framing is injective, but truncating SHA-256 to 64 bits
is not. We test *known framing ambiguities* + ordinary per-field sensitivity. We
also do not assert "session_seed ignores generationIndex" (it does not accept that
argument); instead we assert only tiebreak_seed takes it and both wrappers delegate
to the same canonical primitive.
"""

import pytest

from fitted_core.seed import (
    _canonical_seed,
    candidate_cache_key,
    seeded_rng,
    session_seed,
    tiebreak_seed,
)

# A fixed base tuple of session inputs reused across cases.
_BASE = dict(session_id="user1", wardrobe_version=3, occasion="brunch", weather="mild")


def test_determinism_same_inputs_same_seed():
    assert session_seed(**_BASE) == session_seed(**_BASE)


def test_per_field_sensitivity():
    base = session_seed(**_BASE)
    assert session_seed(**{**_BASE, "session_id": "user2"}) != base
    assert session_seed(**{**_BASE, "wardrobe_version": 4}) != base
    assert session_seed(**{**_BASE, "occasion": "gala"}) != base
    assert session_seed(**{**_BASE, "weather": "cold"}) != base
    assert session_seed(**_BASE, date="2026-06-13") != base  # C1 date param


def test_tiebreak_varies_with_generation_index():
    a = tiebreak_seed(**_BASE, generation_index=0)
    b = tiebreak_seed(**_BASE, generation_index=1)
    assert a != b


def test_wrappers_delegate_to_the_same_primitive():
    # Only tiebreak_seed carries generationIndex; session_seed never does. Both are
    # the canonical primitive with that one slot differing.
    assert session_seed(**_BASE) == _canonical_seed(
        **_BASE, date=None, generation_index=None
    )
    assert tiebreak_seed(**_BASE, generation_index=7) == _canonical_seed(
        **_BASE, date=None, generation_index=7
    )


def test_session_and_tiebreak_share_the_base():
    # Same non-gi inputs land the same base in the primitive; the seeds differ only
    # because tiebreak fills the generationIndex slot.
    assert session_seed(**_BASE) == _canonical_seed(**_BASE, date=None, generation_index=None)
    assert tiebreak_seed(**_BASE, generation_index=0) != session_seed(**_BASE)


def test_length_prefix_framing_guard():
    # A bare "\x1f" join would make these two distinct tuples collide; length-prefix
    # framing keeps them distinct. This test fails against the wrong implementation.
    a = session_seed(session_id="user1", wardrobe_version=3, occasion="a", weather="b\x1fc")
    b = session_seed(session_id="user1", wardrobe_version=3, occasion="a\x1fb", weather="c")
    assert a != b


def test_none_sentinel_distinct_from_lookalike_strings():
    none_ = session_seed(**_BASE, date=None)
    assert none_ != session_seed(**_BASE, date="None")
    assert none_ != session_seed(**_BASE, date="")
    assert none_ != session_seed(**_BASE, date="0")


def test_utf8_byte_framing_golden_value():
    # Pin the exact seed for an input with a non-BMP char. This is the ONLY way a
    # single-runtime test can catch a byte→char framing mutation: both framings are
    # injective in Python (so any "two distinct tuples differ" test passes under
    # both), but they prefix "💎" differently ("4:" vs "1:"), so only a golden value
    # distinguishes them. char-length framing yields 10733744661519570972, not this.
    # The byte-length requirement exists so the M5 TS adapter (JS .length disagrees
    # with Python len() on surrogate pairs) reproduces the same seed.
    assert session_seed(session_id="u", wardrobe_version=1, occasion="💎", weather="mild") == 16995489292698255755


def test_seed_functions_are_keyword_only():
    # The seed inputs include two adjacent str fields (occasion, weather); a positional
    # swap would compute a wrong-but-valid seed silently. Keyword-only forecloses that —
    # lock it so a future edit dropping `*,` is caught.
    import pytest

    with pytest.raises(TypeError):
        session_seed("user1", 3, "brunch", "mild")  # type: ignore[misc]
    with pytest.raises(TypeError):
        tiebreak_seed("user1", 3, "brunch", "mild", generation_index=0)  # type: ignore[misc]


def test_seeded_rng_reproducibility():
    seed = session_seed(**_BASE)
    r1, r2 = seeded_rng(seed), seeded_rng(seed)
    assert [r1.random() for _ in range(5)] == [r2.random() for _ in range(5)]


# --- M5 candidate_cache_key (m5-cutover.md §C.1, C3) --------------------------

# The canonical Lens-chain field set, reused across cases.
_CACHE_BASE = dict(
    session_id="user-1", wardrobe_version=3, occasion="weekend brunch",
    weather="mild", intent="daily", forced_item_id=None, seed_date="2026-07-07",
)


def test_candidate_cache_key_golden_vectors():
    # Frozen goldens mirroring the C8 conformance set (non-BMP occasion; None/""/"0" date).
    # The M5 TS helper can't recompute the key, so these hexes are the cross-runtime anchor:
    # a framing/order/hash change here must be a deliberate, corpus-visible decision.
    assert candidate_cache_key(**_CACHE_BASE) == (
        "6bdb20f05ea388349a617055ddd0c55506ae41a3442a8d7b84f480ed450438cd"
    )
    assert candidate_cache_key(
        **{**_CACHE_BASE, "intent": "rescue_item", "forced_item_id": "66b1f0000000000000000abc"}
    ) == "35ff0226a1f4f2492e0b141898506dfab24c79e8d6738ffff059aae3545766bd"
    non_bmp = dict(
        session_id="user-2", wardrobe_version=0, occasion="夜のデート🎉",
        weather="cold", intent="daily", forced_item_id=None,
    )
    assert candidate_cache_key(**non_bmp, seed_date=None) == (
        "ae64eaa5d3c3ca66686e991f686650ba2b468fe6d45302599d6ba39b8c6384da"
    )
    assert candidate_cache_key(**non_bmp, seed_date="") == (
        "d56fc2de96aa80fdeece38cc3a75aa8c44edd1fd3da3208a4958eebd2b131be9"
    )
    assert candidate_cache_key(**non_bmp, seed_date="0") == (
        "88ddac2698ca63eab3a91449214429f54eb9bd8530744422cc25a4e68bf9b417"
    )


def test_candidate_cache_key_shape_and_per_field_sensitivity():
    base = candidate_cache_key(**_CACHE_BASE)
    assert len(base) == 64 and set(base) <= set("0123456789abcdef")  # full sha256 hex
    for field, value in [
        ("session_id", "user-9"), ("wardrobe_version", 4), ("occasion", "office"),
        ("weather", "cold"), ("intent", "rescue_item"), ("forced_item_id", "abc"),
        ("seed_date", "2026-07-08"),
    ]:
        assert candidate_cache_key(**{**_CACHE_BASE, field: value}) != base, field


def test_candidate_cache_key_is_a_lens_chain_key_not_an_identity_key():
    # §C.1 semantics: siblings in a re-roll chain share the key — generationIndex, controls,
    # and behavioral rows are deliberately NOT inputs, so the function does not accept them.
    with pytest.raises(TypeError):
        candidate_cache_key(**_CACHE_BASE, generation_index=1)  # type: ignore[call-arg]
    with pytest.raises(TypeError):
        candidate_cache_key(*_CACHE_BASE.values())  # keyword-only, like the seeds
