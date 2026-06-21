"""M3 ranker contract tests (v2 §14/§9, docs/plans/m3-ranker.md).

**Checkpoint C1** — the public surface (``FallbackStage`` values, the result/context shapes),
the output-immutability snapshot helpers (``_freeze_style_move`` / ``_filled_slot_ids``), the
``RankerContext`` construction guards (``generation_index`` real-int, ``k`` type/value), the
reducer-contract guards (window lengths N14, affinity sign N10), and the empty/degenerate
short-circuit (N15).

**Checkpoint C2** — the Step-4 per-request hard filters via ``_apply_step4_filters`` (lock /
contextual-dislike / cooldown), the cooldown-relax reserve vs non-relaxable drops (N3), and the
lock-starvation diagnostic (``locked_survivor_count`` / ``insufficient_locked_candidates``, N3/N8).
C3 adds scoring helpers; diversity / fallback / tie-break land in C4–C5 — a non-empty candidate
list still raises ``NotImplementedError``.

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


def _candidate(
    *,
    source_index: int = 0,
    top: str | None = "t1",
    bottom: str | None = "b1",
    dress: str | None = None,
    outer: str | None = None,
    shoes: str | None = None,
    base_key: str | None = None,
    full_signature: str | None = None,
) -> ValidatedCandidate:
    """A structurally-valid ValidatedCandidate; override slots/keys by keyword.

    Defaults to a simple two-piece (t1 + b1). Pass ``dress=...`` (with ``top=None, bottom=None``)
    for a one-piece — the builder then derives a ``one_piece`` template and a dress BaseKey.
    ``base_key`` / ``full_signature`` default to the keys.py format derived from the slots but
    can be pinned directly for filter tests.
    """
    slot_map = SlotMap(dress=dress, top=top, bottom=bottom, outer=outer, shoes=shoes)
    if dress is not None:
        derived_base, template = dress, Template.one_piece
    else:
        derived_base, template = f"{top}:{bottom}", Template.two_piece
    bk = base_key if base_key is not None else derived_base
    if full_signature is None:
        out = outer if outer is not None else "none"
        sho = shoes if shoes is not None else "none"
        full_signature = f"{bk}|outer={out}|shoes={sho}"
    return ValidatedCandidate(
        source_index=source_index,
        slot_map=slot_map,
        template=template,
        base_key=bk,
        full_signature=full_signature,
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


# ------------------------ rank(): non-empty still raises (C2) ------------------------


def test_rank_non_empty_raises_not_implemented():
    # C3 added scoring helpers; non-empty public assembly still waits for C4–C5; a non-empty input
    # that fully survives the filters must still raise rather than fabricate a ranking.
    with pytest.raises(NotImplementedError):
        ranker.rank([_candidate()], _ctx())


# ------------------------ Step 4 — lock filter (C2, §6 step 3) ------------------------


def test_lock_filter_requires_all_locked_ids():
    has_both = _candidate(source_index=0, top="t1", bottom="b1")  # {t1, b1}
    missing = _candidate(source_index=1, top="t2", bottom="b1")  # missing t1
    result = ranker._apply_step4_filters(
        [has_both, missing], _ctx(locked_item_ids=frozenset({"t1", "b1"}))
    )
    assert result.survivors == (has_both,)
    assert result.locked_survivor_count == 1


def test_lock_filter_multiple_locks_partial_match_excluded():
    full = _candidate(source_index=0, top="t1", bottom="b1", outer="o1")  # {t1, b1, o1}
    partial = _candidate(source_index=1, top="t1", bottom="b1")  # {t1, b1} — no o1
    result = ranker._apply_step4_filters(
        [full, partial], _ctx(locked_item_ids=frozenset({"t1", "o1"}))
    )
    assert result.survivors == (full,)
    assert result.locked_survivor_count == 1


def test_lock_filter_counts_optional_outer_and_shoes():
    cand = _candidate(top="t1", bottom="b1", outer="o1", shoes="s1")
    # A lock on the optional outer + shoes ids matches because filled-slot ids include them.
    kept = ranker._apply_step4_filters([cand], _ctx(locked_item_ids=frozenset({"o1", "s1"})))
    assert kept.survivors == (cand,)
    assert kept.locked_survivor_count == 1
    # A lock on an id the candidate lacks excludes it.
    dropped = ranker._apply_step4_filters([cand], _ctx(locked_item_ids=frozenset({"s2"})))
    assert dropped.survivors == ()
    assert dropped.locked_survivor_count == 0


# ------------------------ Step 4 — contextual dislike (C2, §6 step 3) ------------------------


def test_contextual_dislike_removes_candidate_with_disliked_item():
    clean = _candidate(source_index=0, top="t1", bottom="b1")
    dirty = _candidate(source_index=1, top="t1", bottom="b2", shoes="s9")  # contains s9
    result = ranker._apply_step4_filters(
        [clean, dirty], _ctx(contextual_disliked_item_ids=frozenset({"s9"}))
    )
    assert result.survivors == (clean,)
    # A contextual drop is non-relaxable — never held in the cooldown-relax reserve (N3).
    assert dirty not in result.cooldown_reserve
    assert result.cooldown_reserve == ()


def test_contextual_drop_is_non_relaxable_even_if_also_cooldown():
    # Fails BOTH contextual and cooldown → non-relaxable (contextual dominates); must NOT be
    # reserved, since only solely-cooldown drops are relaxable (N3).
    cand = _candidate(top="t1", bottom="b1", shoes="s9")
    result = ranker._apply_step4_filters(
        [cand],
        _ctx(
            contextual_disliked_item_ids=frozenset({"s9"}),
            recent_disliked_base_keys=("t1:b1",),
        ),
    )
    assert result.survivors == ()
    assert result.cooldown_reserve == ()


# ------------------------ Step 4 — cooldown (C2, §6 step 3, §7) ------------------------


def test_cooldown_removes_all_variants_of_disliked_base_key():
    # Two variants share base_key "t1:b1" (different outer); cooldown filters by BaseKey, so
    # both go — across all outer/shoe variants (§7) — while a different silhouette survives.
    v1 = _candidate(source_index=0, top="t1", bottom="b1", outer="o1")
    v2 = _candidate(source_index=1, top="t1", bottom="b1", outer="o2")
    other = _candidate(source_index=2, top="t3", bottom="b3")
    result = ranker._apply_step4_filters(
        [v1, v2, other], _ctx(recent_disliked_base_keys=("t1:b1",))
    )
    assert result.survivors == (other,)
    # Cooldown-only drops are tracked as relaxable for C5, but NOT re-admitted in C2.
    assert result.cooldown_reserve == (v1, v2)


# ------------------------ Step 4 — lock-starvation diagnostic (C2, N3/N8) ------------------------


def test_locked_survivor_count_is_after_lock_before_contextual_and_cooldown():
    # The candidate clears the lock filter but is then dropped by a contextual dislike — it
    # still counts toward locked_survivor_count (measured after the lock filter alone).
    cand = _candidate(top="t1", bottom="b1", shoes="s9")
    result = ranker._apply_step4_filters(
        [cand],
        _ctx(locked_item_ids=frozenset({"t1"}), contextual_disliked_item_ids=frozenset({"s9"})),
    )
    assert result.locked_survivor_count == 1
    assert result.survivors == ()
    assert result.cooldown_reserve == ()  # contextual drop is non-relaxable


def test_locked_survivor_count_includes_cooldown_dropped_candidate():
    # Clears the lock filter, dropped only by cooldown → counts toward the lock survivors AND
    # is held in the relaxable reserve.
    cand = _candidate(top="t1", bottom="b1")
    result = ranker._apply_step4_filters(
        [cand], _ctx(locked_item_ids=frozenset({"t1"}), recent_disliked_base_keys=("t1:b1",))
    )
    assert result.locked_survivor_count == 1
    assert result.survivors == ()
    assert result.cooldown_reserve == (cand,)


def test_insufficient_locked_candidates_true_when_lock_survivors_below_k():
    cand = _candidate(top="t1", bottom="b1")
    result = ranker._apply_step4_filters([cand], _ctx(locked_item_ids=frozenset({"t1"}), k=5))
    assert result.locked_survivor_count == 1
    assert result.insufficient_locked_candidates is True  # 1 < 5


def test_insufficient_locked_candidates_false_when_enough_lock_survivors():
    cands = [_candidate(source_index=i, top="t1", bottom=f"b{i}") for i in range(3)]
    result = ranker._apply_step4_filters([*cands], _ctx(locked_item_ids=frozenset({"t1"}), k=2))
    assert result.locked_survivor_count == 3
    assert result.insufficient_locked_candidates is False  # 3 >= 2


def test_insufficient_locked_candidates_false_when_no_locks():
    cand = _candidate(top="t1", bottom="b1")
    result = ranker._apply_step4_filters([cand], _ctx(k=5))  # no locks requested
    assert result.insufficient_locked_candidates is False


# ------------------------ Step 4 — all-filtered-out vs literal-empty (C2, N15/N3) ------------------------


def test_all_filtered_out_non_empty_does_not_collapse_to_empty_path():
    # All candidates cooldown-dropped: non-empty input, zero survivors. This is NOT the
    # literal-empty case — public rank() still raises (no C5 relaxation yet), and the helper
    # preserves a distinct cooldown-relax reserve (literal-empty input has no reserve).
    cand = _candidate(top="t1", bottom="b1")
    ctx = _ctx(recent_disliked_base_keys=("t1:b1",))
    with pytest.raises(NotImplementedError):
        ranker.rank([cand], ctx)
    result = ranker._apply_step4_filters([cand], ctx)
    assert result.survivors == ()
    assert result.cooldown_reserve == (cand,)


# ============================ Step 5 — additive scoring (C3, §6 step 4) ============================


def test_score_base_only():
    # No combo, no affinity, no dislike, not relaxed → score is exactly BASE_SCORE; every other
    # delta is 0.
    scored = ranker._score_candidate(_candidate(), _ctx())
    b = scored.breakdown
    assert b.base == config.BASE_SCORE
    assert b.combo == 0.0
    assert b.item == 0.0
    assert b.dislike == 0.0
    assert b.overuse == 0.0
    assert b.repetition == 0.0
    assert b.cooldown == 0.0
    assert scored.score == config.BASE_SCORE


def test_combo_boost_when_full_signature_liked():
    cand = _candidate(full_signature="sig-A")
    scored = ranker._score_candidate(cand, _ctx(liked_full_signatures={"sig-A"}))
    assert scored.breakdown.combo == config.COMBO_BOOST
    assert scored.score == config.BASE_SCORE + config.COMBO_BOOST


def test_no_combo_boost_when_full_signature_not_liked():
    cand = _candidate(full_signature="sig-A")
    scored = ranker._score_candidate(cand, _ctx(liked_full_signatures={"sig-OTHER"}))
    assert scored.breakdown.combo == 0.0
    assert scored.score == config.BASE_SCORE


def test_item_boost_sums_over_all_filled_slots():
    cand = _candidate(top="t1", bottom="b1")
    scored = ranker._score_candidate(cand, _ctx(item_affinity={"t1": 5, "b1": 3}))
    assert scored.breakdown.item == pytest.approx(config.ITEM_BOOST_WEIGHT * (5 + 3))
    assert scored.score == pytest.approx(config.BASE_SCORE + config.ITEM_BOOST_WEIGHT * 8)


def test_item_boost_includes_optional_outer_and_shoes():
    # N13 — itemBoost ranges over every filled slot, not just the base top/bottom.
    cand = _candidate(top="t1", bottom="b1", outer="o1", shoes="s1")
    ctx = _ctx(item_affinity={"t1": 1, "b1": 2, "o1": 4, "s1": 8})
    scored = ranker._score_candidate(cand, ctx)
    assert scored.breakdown.item == pytest.approx(config.ITEM_BOOST_WEIGHT * (1 + 2 + 4 + 8))


def test_missing_affinity_contributes_zero():
    # b1 has no affinity entry → contributes 0; only t1 counts.
    cand = _candidate(top="t1", bottom="b1")
    scored = ranker._score_candidate(cand, _ctx(item_affinity={"t1": 7}))
    assert scored.breakdown.item == pytest.approx(config.ITEM_BOOST_WEIGHT * 7)


def test_affinity_over_max_is_clamped():
    # Over-cap affinity is clamped to MAX_AFFINITY *inside M3* (N10); b1 (no entry) adds 0.
    cand = _candidate(top="t1", bottom="b1")
    scored = ranker._score_candidate(
        cand, _ctx(item_affinity={"t1": config.MAX_AFFINITY + 100})
    )
    assert scored.breakdown.item == pytest.approx(config.ITEM_BOOST_WEIGHT * config.MAX_AFFINITY)


def test_finite_float_affinity_scores_correctly():
    # A finite positive float affinity is accepted and scored (item_affinity widened to int|float).
    cand = _candidate(top="t1", bottom="b1")
    scored = ranker._score_candidate(cand, _ctx(item_affinity={"t1": 3.5}))
    assert scored.breakdown.item == pytest.approx(config.ITEM_BOOST_WEIGHT * 3.5)


def test_dislike_penalty_per_distinct_disliked_item():
    # Decision A (plan §6/§7): two distinct disliked items in the outfit → penalty scales,
    # −DISLIKE_PENALTY each.
    cand = _candidate(top="t1", bottom="b1")
    scored = ranker._score_candidate(cand, _ctx(recent_disliked_item_ids=("t1", "b1")))
    assert scored.breakdown.dislike == pytest.approx(-config.DISLIKE_PENALTY * 2)


def test_dislike_penalty_single_disliked_item():
    cand = _candidate(top="t1", bottom="b1")
    scored = ranker._score_candidate(cand, _ctx(recent_disliked_item_ids=("t1",)))
    assert scored.breakdown.dislike == pytest.approx(-config.DISLIKE_PENALTY)


def test_dislike_penalty_flat_over_window_duplicates():
    # A single disliked item repeated across the window counts ONCE — "flat, not accumulated" (§14):
    # the set() over the window dedups multiplicity.
    cand = _candidate(top="t1", bottom="b1")
    scored = ranker._score_candidate(cand, _ctx(recent_disliked_item_ids=("t1", "t1", "t1")))
    assert scored.breakdown.dislike == pytest.approx(-config.DISLIKE_PENALTY)


def test_no_dislike_penalty_when_no_overlap():
    cand = _candidate(top="t1", bottom="b1")
    scored = ranker._score_candidate(cand, _ctx(recent_disliked_item_ids=("x9",)))
    assert scored.breakdown.dislike == 0.0


def test_cooldown_zero_for_normal_scoring():
    scored = ranker._score_candidate(_candidate(), _ctx())
    assert scored.breakdown.cooldown == 0.0


def test_cooldown_is_cooldown_penalty_when_relaxed():
    # A cooldown-relaxed re-admit carries COOLDOWN_PENALTY as the signed delta — already −2.0
    # (S4), added not negated.
    scored = ranker._score_candidate(_candidate(), _ctx(), relaxed_cooldown=True)
    assert scored.breakdown.cooldown == config.COOLDOWN_PENALTY
    assert config.COOLDOWN_PENALTY < 0
    assert scored.score == config.BASE_SCORE + config.COOLDOWN_PENALTY


def test_overuse_and_repetition_are_zero_in_c3():
    # Step-6 diversity terms are not scored per isolated candidate; C3 leaves them 0 even when the
    # window/affinity inputs C4 will consume are populated.
    cand = _candidate(top="t1", bottom="b1", full_signature="sig-A")
    ctx = _ctx(shown_full_signatures=("sig-A",), item_affinity={"t1": 5})
    scored = ranker._score_candidate(cand, ctx)
    assert scored.breakdown.overuse == 0.0
    assert scored.breakdown.repetition == 0.0


@pytest.mark.parametrize("relaxed", [False, True])
def test_score_equals_sum_of_signed_deltas(relaxed):
    # Property (N4/§7): score == base+combo+item+dislike+overuse+repetition+cooldown, summed in
    # canonical field order, across a mixed case (combo + clamped affinity + multi-item dislike).
    cand = _candidate(top="t1", bottom="b1", outer="o1", shoes="s1", full_signature="sig-A")
    ctx = _ctx(
        liked_full_signatures={"sig-A"},
        item_affinity={"t1": config.MAX_AFFINITY + 5, "o1": 3, "s1": 1},  # t1 clamped
        recent_disliked_item_ids=("b1", "s1"),  # two distinct disliked items
    )
    scored = ranker._score_candidate(cand, ctx, relaxed_cooldown=relaxed)
    b = scored.breakdown
    assert scored.score == (
        b.base + b.combo + b.item + b.dislike + b.overuse + b.repetition + b.cooldown
    )
    # Signs for this case: positive combo + item, negative dislike, cooldown iff relaxed.
    assert b.combo > 0 and b.item > 0 and b.dislike < 0
    assert (b.cooldown < 0) == relaxed


def test_one_piece_scoring_uses_dress_slot():
    # Explicit one-piece: dress set, top/bottom None; itemBoost ranges over dress + shoes (N13).
    cand = _candidate(dress="d1", top=None, bottom=None, shoes="s1")
    scored = ranker._score_candidate(cand, _ctx(item_affinity={"d1": 6, "s1": 2}))
    assert scored.breakdown.item == pytest.approx(config.ITEM_BOOST_WEIGHT * (6 + 2))
    assert scored.score == pytest.approx(config.BASE_SCORE + config.ITEM_BOOST_WEIGHT * 8)


# ---------------- dominance (§5/§7): each term cannot dominate when it should not ----------------


def test_combo_alone_does_not_outrank_more_positive_evidence():
    # A lone comboBoost (+2) must not outrank a candidate with strictly more positive evidence
    # and no penalties (§7): here B has combo AND item evidence, so B >= A.
    a = ranker._score_candidate(
        _candidate(full_signature="A"), _ctx(liked_full_signatures={"A"})
    )
    b = ranker._score_candidate(
        _candidate(top="t1", bottom="b1", full_signature="B"),
        _ctx(liked_full_signatures={"B"}, item_affinity={"t1": 10}),
    )
    assert b.score >= a.score


def test_dislike_penalty_is_bounded_by_item_count():
    # |dislike| can never exceed DISLIKE_PENALTY * (number of filled slots) (§7 "bounded by item count").
    cand = _candidate(top="t1", bottom="b1", outer="o1", shoes="s1")  # 4 filled slots
    filled = ranker._filled_slot_ids(cand.slot_map)
    scored = ranker._score_candidate(cand, _ctx(recent_disliked_item_ids=tuple(filled)))
    assert scored.breakdown.dislike == pytest.approx(-config.DISLIKE_PENALTY * len(filled))
    assert abs(scored.breakdown.dislike) <= config.DISLIKE_PENALTY * len(filled)


def test_cooldown_sinks_relaxed_outfit_below_unrelaxed_peer():
    # Identical inputs: the cooldown-relaxed scoring lands exactly COOLDOWN_PENALTY below its
    # unrelaxed peer (§7 — cooldown sinks a relaxed outfit).
    cand = _candidate(top="t1", bottom="b1")
    ctx = _ctx(item_affinity={"t1": 4})
    unrelaxed = ranker._score_candidate(cand, ctx)
    relaxed = ranker._score_candidate(cand, ctx, relaxed_cooldown=True)
    assert relaxed.score == pytest.approx(unrelaxed.score + config.COOLDOWN_PENALTY)
    assert relaxed.score < unrelaxed.score


def test_four_item_item_boost_can_exceed_combo_boost_documented_exception():
    # DOCUMENTED, eval-tracked exception (§7/§11): at the affinity cap a 4-item itemBoost (~+8)
    # CAN exceed a lone comboBoost (+2). Pinned visibly here (not hidden by a test pretending it
    # can't happen) so the offline-eval levers (lower cap / sublinear affinity / averaging) stay
    # on the radar.
    combo_only = ranker._score_candidate(
        _candidate(top="t1", bottom="b1", full_signature="C"),
        _ctx(liked_full_signatures={"C"}),
    )
    four_item_capped = ranker._score_candidate(
        _candidate(top="t1", bottom="b1", outer="o1", shoes="s1"),
        _ctx(item_affinity={k: config.MAX_AFFINITY for k in ("t1", "b1", "o1", "s1")}),
    )
    assert four_item_capped.breakdown.item == pytest.approx(
        config.ITEM_BOOST_WEIGHT * config.MAX_AFFINITY * 4
    )
    assert four_item_capped.score > combo_only.score
