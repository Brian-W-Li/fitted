"""M3 ranker contract tests (v2 §14/§9, docs/plans/m3-ranker.md).

**Checkpoint C1 — config + result/context model.** Covers the public surface
(``FallbackStage`` values, the result/context shapes), the output-immutability snapshot
helpers (``_freeze_style_move`` / ``_filled_slot_ids``), the ``RankerContext`` construction
guards (``generation_index`` real-int, ``k`` type/value), the reducer-contract guards
(window lengths N14, affinity sign N10), and the empty/degenerate short-circuit (N15).
The Steps 4–6 behavior (filters / scoring / diversity / fallback / tie-break) lands in
C2–C5 — here, a non-empty candidate list must raise ``NotImplementedError``.

Assert on values, flags, and types — never on exception prose.
"""

from types import MappingProxyType

import pytest

from fitted_core import config, ranker
from fitted_core.models import SlotMap, StyleMove, Template
from fitted_core.ranker import FallbackStage, FrozenStyleMove, RankerContext
from fitted_core.validator import ValidatedCandidate


# ------------------------------ fixtures / builders ------------------------------


def _ctx(**overrides) -> RankerContext:
    """A valid RankerContext with sensible defaults; override any field by keyword."""
    base = dict(
        session_id="user1",
        wardrobe_version=1,
        occasion="brunch",
        weather="mild",
        generation_index=0,
    )
    base.update(overrides)
    return RankerContext(**base)


def _candidate(source_index: int = 0) -> ValidatedCandidate:
    """A minimal structurally-valid two-piece ValidatedCandidate."""
    return ValidatedCandidate(
        source_index=source_index,
        slot_map=SlotMap(top="t1", bottom="b1"),
        template=Template.two_piece,
        base_key="t1:b1",
        full_signature="t1:b1|outer=none|shoes=none",
        style_move=None,
    )


# ------------------------------ FallbackStage ------------------------------


def test_fallback_stage_exact_values():
    assert FallbackStage.none.value == "none"
    assert FallbackStage.overuse_relaxed.value == "overuseRelaxed"
    assert FallbackStage.variant_cap_relaxed.value == "variantCapRelaxed"
    assert FallbackStage.cooldown_relaxed.value == "cooldownRelaxed"
    assert FallbackStage.insufficient.value == "insufficient"


def test_fallback_stage_members_exact():
    # No extra/missing rungs — the ladder order matches §14.
    assert [s.value for s in FallbackStage] == [
        "none",
        "overuseRelaxed",
        "variantCapRelaxed",
        "cooldownRelaxed",
        "insufficient",
    ]


# ------------------------ snapshot helpers (output immutability §4) ------------------------


def test_freeze_style_move_snapshots_changed_ids_to_tuple():
    move = StyleMove(move_type="swap", changed_item_ids=["a", "b"], one_sentence="x")
    frozen = ranker._freeze_style_move(move)
    assert isinstance(frozen, FrozenStyleMove)
    assert frozen.changed_item_ids == ("a", "b")
    assert isinstance(frozen.changed_item_ids, tuple)
    assert frozen.move_type == "swap"
    assert frozen.one_sentence == "x"


def test_freeze_style_move_passes_none_through():
    assert ranker._freeze_style_move(None) is None


def test_style_move_mutation_after_snapshot_does_not_affect_frozen():
    ids = ["a", "b"]
    move = StyleMove(move_type="swap", changed_item_ids=ids, one_sentence="x")
    frozen = ranker._freeze_style_move(move)
    # Mutate the original list (and via the StyleMove, which aliases the same list) after
    # the snapshot — the frozen tuple must be unaffected.
    ids.append("c")
    move.changed_item_ids.append("d")
    assert frozen.changed_item_ids == ("a", "b")


def test_filled_slot_ids_canonical_order():
    sm = SlotMap(dress="d1", outer="o1", shoes="s1")
    assert ranker._filled_slot_ids(sm) == ("d1", "o1", "s1")
    sm2 = SlotMap(top="t1", bottom="b1", outer="o1", shoes="s1")
    assert ranker._filled_slot_ids(sm2) == ("t1", "b1", "o1", "s1")


def test_filled_slot_ids_snapshot_unaffected_by_later_slotmap_mutation():
    sm = SlotMap(top="t1", bottom="b1", shoes="s1")
    snap = ranker._filled_slot_ids(sm)
    assert snap == ("t1", "b1", "s1")
    # Mutate the SlotMap after the snapshot — the tuple snapshot must not change.
    sm.top = "MUTATED"
    sm.outer = "x9"
    assert snap == ("t1", "b1", "s1")


# ------------------------ RankerContext: generation_index guard (N7/H7) ------------------------


def test_context_missing_generation_index_raises():
    with pytest.raises(TypeError):
        RankerContext(session_id="s", wardrobe_version=1, occasion="o", weather="w")


def test_context_none_generation_index_raises():
    with pytest.raises(TypeError):
        _ctx(generation_index=None)


def test_context_bool_generation_index_raises():
    # bool is an int subclass; it must be rejected before the int check.
    with pytest.raises(TypeError):
        _ctx(generation_index=True)
    with pytest.raises(TypeError):
        _ctx(generation_index=False)


def test_context_non_int_generation_index_raises():
    with pytest.raises(TypeError):
        _ctx(generation_index="0")
    with pytest.raises(TypeError):
        _ctx(generation_index=1.0)


def test_context_accepts_real_int_generation_index():
    ctx = _ctx(generation_index=7)
    assert ctx.generation_index == 7


# ------------------------ RankerContext: k guard (N16) ------------------------


def test_context_k_defaults_to_default_k():
    assert _ctx().k == config.DEFAULT_K


def test_context_bool_k_raises():
    with pytest.raises(TypeError):
        _ctx(k=True)


def test_context_non_int_k_raises():
    with pytest.raises(TypeError):
        _ctx(k=1.0)
    with pytest.raises(TypeError):
        _ctx(k="5")


def test_context_non_positive_k_raises():
    with pytest.raises(ValueError):
        _ctx(k=0)
    with pytest.raises(ValueError):
        _ctx(k=-3)


# ------------------------ RankerContext: collection normalization (§4) ------------------------


def test_context_normalizes_collections_to_immutable_forms():
    ctx = _ctx(
        shown_full_signatures=["a", "b"],
        recent_disliked_base_keys=["bk"],
        recent_disliked_item_ids=["id"],
        liked_full_signatures={"x"},
        contextual_disliked_item_ids={"c"},
        locked_item_ids={"l"},
        item_affinity={"i": 3},
    )
    assert isinstance(ctx.shown_full_signatures, tuple)
    assert isinstance(ctx.recent_disliked_base_keys, tuple)
    assert isinstance(ctx.recent_disliked_item_ids, tuple)
    assert isinstance(ctx.liked_full_signatures, frozenset)
    assert isinstance(ctx.contextual_disliked_item_ids, frozenset)
    assert isinstance(ctx.locked_item_ids, frozenset)
    assert isinstance(ctx.item_affinity, MappingProxyType)


def test_context_item_affinity_is_read_only_copy():
    src = {"i": 3}
    ctx = _ctx(item_affinity=src)
    assert ctx.item_affinity["i"] == 3
    # Independent of the caller's dict ...
    src["i"] = 99
    assert ctx.item_affinity["i"] == 3
    # ... and read-only.
    with pytest.raises(TypeError):
        ctx.item_affinity["i"] = 0


# ------------------------ reducer-contract guards: window lengths (N14) ------------------------


def test_windows_at_limit_pass():
    # At-limit windows pass the guard (len == constant is not "> constant"); the empty
    # candidate list then short-circuits to an insufficient result without raising.
    ctx = _ctx(
        shown_full_signatures=tuple(f"fs{i}" for i in range(config.REPETITION_WINDOW_SIZE)),
        recent_disliked_base_keys=tuple(f"bk{i}" for i in range(config.COOLDOWN_BUFFER_SIZE)),
        recent_disliked_item_ids=tuple(f"id{i}" for i in range(config.DISLIKE_WINDOW_SIZE)),
    )
    result = ranker.rank([], ctx)
    assert result.insufficient_wardrobe is True


def test_repetition_window_over_limit_raises():
    ctx = _ctx(
        shown_full_signatures=tuple(f"fs{i}" for i in range(config.REPETITION_WINDOW_SIZE + 1))
    )
    with pytest.raises(ValueError):
        ranker.rank([], ctx)


def test_cooldown_buffer_over_limit_raises():
    ctx = _ctx(
        recent_disliked_base_keys=tuple(f"bk{i}" for i in range(config.COOLDOWN_BUFFER_SIZE + 1))
    )
    with pytest.raises(ValueError):
        ranker.rank([], ctx)


def test_dislike_window_over_limit_raises():
    ctx = _ctx(
        recent_disliked_item_ids=tuple(f"id{i}" for i in range(config.DISLIKE_WINDOW_SIZE + 1))
    )
    with pytest.raises(ValueError):
        ranker.rank([], ctx)


# ------------------------ reducer-contract guards: affinity sign (N10) ------------------------


def test_bool_affinity_raises_type_error():
    # bool is an int subclass; an affinity value must be a real (non-bool) number, so a bool
    # is a reducer type error, not a "1"/"0" affinity. Rejected before the numeric/sign check.
    with pytest.raises(TypeError):
        ranker.rank([], _ctx(item_affinity={"x": True}))
    with pytest.raises(TypeError):
        ranker.rank([], _ctx(item_affinity={"x": False}))


def test_non_numeric_affinity_raises_type_error():
    with pytest.raises(TypeError):
        ranker.rank([], _ctx(item_affinity={"x": "5"}))
    with pytest.raises(TypeError):
        ranker.rank([], _ctx(item_affinity={"x": None}))


def test_non_finite_affinity_raises_value_error():
    # NaN / ±inf are numeric but invalid (NaN slips `< 0`, inf survives the C3 clamp) — they
    # raise ValueError (numeric-but-invalid), not TypeError, and are caught before the sign check.
    for bad in (float("nan"), float("inf"), float("-inf")):
        with pytest.raises(ValueError):
            ranker.rank([], _ctx(item_affinity={"x": bad}))


def test_negative_affinity_raises():
    # A negative *real number* is reducer-contract misuse → ValueError (not a type error);
    # cover both int and float so the numeric guard passes through to the sign check.
    with pytest.raises(ValueError):
        ranker.rank([], _ctx(item_affinity={"x": -1}))
    with pytest.raises(ValueError):
        ranker.rank([], _ctx(item_affinity={"x": -0.5}))


def test_over_max_affinity_accepted_in_c1():
    # The upper clamp to MAX_AFFINITY is applied at scoring (C3), not here — an over-cap
    # affinity is accepted in C1 and never raises. A positive float is a valid real number.
    assert ranker.rank([], _ctx(item_affinity={"x": config.MAX_AFFINITY + 100})).insufficient_wardrobe is True
    assert ranker.rank([], _ctx(item_affinity={"x": 3.5})).insufficient_wardrobe is True


# ------------------------ rank(): empty/degenerate short-circuit (N15) ------------------------


def test_rank_empty_no_locks_returns_insufficient_result():
    result = ranker.rank([], _ctx())
    assert result.outfits == ()
    assert result.fallback_stage is FallbackStage.insufficient
    assert result.insufficient_wardrobe is True
    assert result.relaxed_cooldown_count == 0
    assert result.locked_survivor_count == 0
    assert result.insufficient_locked_candidates is False


def test_rank_empty_with_locks_sets_lock_starvation_diagnostic():
    # Zero candidates cannot satisfy a requested lock (N3) — the diagnostic is not
    # suppressed on the empty path.
    result = ranker.rank([], _ctx(locked_item_ids=frozenset({"lock1"})))
    assert result.outfits == ()
    assert result.locked_survivor_count == 0
    assert result.insufficient_locked_candidates is True
    assert result.insufficient_wardrobe is True


# ------------------------ rank(): non-empty raises in C1 ------------------------


def test_rank_non_empty_raises_not_implemented_in_c1():
    # Steps 4–6 land in C2–C5; a non-empty input must raise rather than fabricate a ranking.
    with pytest.raises(NotImplementedError):
        ranker.rank([_candidate()], _ctx())
