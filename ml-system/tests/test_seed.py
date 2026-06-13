"""M0-5 contract tests — seed derivation (spec §3.3/§10.4/C1, spec-resolutions R1).

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

from fitted_core.seed import (
    _canonical_seed,
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
        "user1", 3, "brunch", "mild", None, None
    )
    assert tiebreak_seed(**_BASE, generation_index=7) == _canonical_seed(
        "user1", 3, "brunch", "mild", None, 7
    )


def test_session_and_tiebreak_share_the_base():
    # Same non-gi inputs land the same base in the primitive; the seeds differ only
    # because tiebreak fills the generationIndex slot.
    assert session_seed(**_BASE) == _canonical_seed("user1", 3, "brunch", "mild", None, None)
    assert tiebreak_seed(**_BASE, generation_index=0) != session_seed(**_BASE)


def test_length_prefix_framing_guard():
    # A bare "\x1f" join would make these two distinct tuples collide; length-prefix
    # framing keeps them distinct. This test fails against the wrong implementation.
    a = session_seed("user1", 3, "a", "b\x1fc")
    b = session_seed("user1", 3, "a\x1fb", "c")
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
    assert session_seed("u", 1, "💎", "mild") == 16995489292698255755


def test_seeded_rng_reproducibility():
    seed = session_seed(**_BASE)
    r1, r2 = seeded_rng(seed), seeded_rng(seed)
    assert [r1.random() for _ in range(5)] == [r2.random() for _ in range(5)]
