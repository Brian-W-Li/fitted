"""M3 ranker contract tests (v2 §14/§9, docs/plans/m3-ranker.md).

**Checkpoint C1** — the public surface (``FallbackStage`` values, the result/context shapes),
the output-immutability snapshot helpers (``_freeze_style_move`` / ``_filled_slot_ids``), the
``RankerContext`` construction guards (``generation_index`` real-int, ``k`` type/value), the
reducer-contract guards (window lengths N14, affinity sign N10), and the empty/degenerate
short-circuit (N15).

**Checkpoint C2** — the Step-4 per-request hard filters via ``_apply_step4_filters`` (lock /
contextual-dislike / cooldown), the cooldown-relax reserve vs non-relaxable drops (N3), and the
lock-starvation diagnostic (``locked_survivor_count`` / ``insufficient_locked_candidates``, N3/N8).

**Checkpoint C3** — the Step-5 additive scoring helper ``_score_candidate`` (base / combo /
itemBoost(clamp) / dislike), the signed ``ScoreBreakdown``, ``score == Σ deltas``, and the
dominance cases (§5/§7).

**Checkpoint C4** — the Step-6 diversity helpers: ``_apply_variant_cap`` (top-2 by pre-penalty
score, N5), ``_compute_overuse_set`` (once over post-cap survivors, strict gate/threshold,
N1/N2/Q1), ``_rescore_with_diversity`` (signed overuse + flat repetition, Q1/Q2), and their
composition ``_apply_step6_diversity``.

**Checkpoint C5** — public non-empty ``rank()`` assembly: fallback ladder, deterministic
tie-break, truncate-to-k, output snapshots, and final ``RankerResult`` flags.

**Checkpoint C6** — milestone closeout: the one §12 mutant the C1–C5 suite left uncovered
(M3 must never re-dedup FullSignatures — M2 already did, §9 step 3) plus two end-to-end
``rank()`` cases the per-helper tests never drove through the public entry point (overuse
applied at the ``none`` stage; a non-empty pool hard-filtered to zero via the main path,
distinct from the literal-empty short-circuit, N15).

Assert on values, flags, and types — never on exception prose.
"""

import itertools
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


def _with_style_move(cand: ValidatedCandidate, style_move: StyleMove) -> ValidatedCandidate:
    return ValidatedCandidate(
        source_index=cand.source_index,
        slot_map=cand.slot_map,
        template=cand.template,
        base_key=cand.base_key,
        full_signature=cand.full_signature,
        style_move=style_move,
    )


def _result_signatures(result: ranker.RankerResult) -> list[str]:
    return [outfit.full_signature for outfit in result.outfits]


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


@pytest.mark.parametrize(
    "field",
    [
        "shown_full_signatures",
        "recent_disliked_base_keys",
        "recent_disliked_item_ids",
        "liked_full_signatures",
        "contextual_disliked_item_ids",
        "locked_item_ids",
    ],
)
@pytest.mark.parametrize("scalar", ["sig-A", b"sig-A", bytearray(b"sig-A")])
def test_context_rejects_bare_string_signal_collections(field, scalar):
    # A bare str/bytes would coerce to per-character fragments (tuple("sig-A") ->
    # ('s','i','g','-','A')) and every membership signal would silently fail OPEN —
    # the M5 reducer-boundary trap. Must fail loud at construction instead.
    with pytest.raises(TypeError, match=field):
        _ctx(**{field: scalar})


@pytest.mark.parametrize(
    "field",
    [
        "shown_full_signatures",
        "recent_disliked_base_keys",
        "recent_disliked_item_ids",
        "liked_full_signatures",
        "contextual_disliked_item_ids",
        "locked_item_ids",
    ],
)
def test_context_rejects_non_string_signal_elements(field):
    with pytest.raises(TypeError, match=field):
        _ctx(**{field: ["ok", 7]})


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


@pytest.mark.parametrize("bad_key", [1, None, ("t1",)])
def test_non_string_affinity_key_raises_type_error(bad_key):
    # Same fail-open class as the bare-str collection guard: a non-str key never matches
    # any candidate's item ids, so the boost would silently contribute nothing.
    with pytest.raises(TypeError, match="item_affinity keys"):
        ranker.rank([], _ctx(item_affinity={bad_key: 1.0}))


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


# ------------------------ rank(): public non-empty assembly (C5) ------------------------


def test_rank_non_empty_returns_sorted_ranker_result():
    ctx = _ctx(item_affinity={"t1": 20, "t2": 10}, k=2)
    low = _candidate(source_index=0, top="t0", bottom="b0", base_key="bk0", full_signature="sig-low")
    high = _candidate(source_index=1, top="t1", bottom="b1", base_key="bk1", full_signature="sig-high")
    mid = _candidate(source_index=2, top="t2", bottom="b2", base_key="bk2", full_signature="sig-mid")

    result = ranker.rank([low, high, mid], ctx)

    assert _result_signatures(result) == ["sig-high", "sig-mid"]
    assert len(result.outfits) == ctx.k
    assert result.fallback_stage is FallbackStage.none
    assert result.insufficient_wardrobe is False
    assert result.relaxed_cooldown_count == 0
    assert result.locked_survivor_count == 3
    assert result.insufficient_locked_candidates is False
    assert all(
        outfit.score
        == (
            outfit.breakdown.base
            + outfit.breakdown.combo
            + outfit.breakdown.item
            + outfit.breakdown.dislike
            + outfit.breakdown.overuse
            + outfit.breakdown.repetition
            + outfit.breakdown.cooldown
        )
        for outfit in result.outfits
    )


# ---- personalization: the three ADDITIVE signals must change rank ORDER (not just breakdown) ----
# The affinity sort is covered above (test_rank_non_empty_returns_sorted_ranker_result) and the
# cooldown hard-filter below. These pin that combo-boost / repetition / soft-dislike each flip the
# ORDER of two otherwise-tied candidates through the PUBLIC rank() — the "feedback demonstrably
# changes the surfaced ranking" guard the suite previously proved only as ScoreBreakdown deltas.
# Baseline (no signals) is deterministically ["sigB","sigA"]; each test flips it.

_PERSO_A = dict(source_index=0, top="ta", bottom="ba", base_key="bkA", full_signature="sigA")
_PERSO_B = dict(source_index=1, top="tb", bottom="bb", base_key="bkB", full_signature="sigB")


def test_personalization_baseline_order_is_deterministic():
    a, b = _candidate(**_PERSO_A), _candidate(**_PERSO_B)
    assert _result_signatures(ranker.rank([a, b], _ctx(k=2))) == ["sigB", "sigA"]


def test_liked_full_signature_combo_boost_lifts_rank():
    a, b = _candidate(**_PERSO_A), _candidate(**_PERSO_B)
    # sigA (the baseline loser) becomes the liked combo → it overtakes sigB.
    result = ranker.rank([a, b], _ctx(k=2, liked_full_signatures={"sigA"}))
    assert _result_signatures(result) == ["sigA", "sigB"]
    assert result.outfits[0].breakdown.combo == config.COMBO_BOOST
    assert result.outfits[1].breakdown.combo == 0.0


def test_shown_full_signature_repetition_penalty_sinks_rank():
    a, b = _candidate(**_PERSO_A), _candidate(**_PERSO_B)
    # sigB (the baseline winner) was shown recently → the repetition penalty drops it below sigA.
    result = ranker.rank([a, b], _ctx(k=2, shown_full_signatures=("sigB",)))
    assert _result_signatures(result) == ["sigA", "sigB"]
    sig_to_rep = {o.full_signature: o.breakdown.repetition for o in result.outfits}
    assert sig_to_rep["sigB"] == -config.REPETITION_PENALTY
    assert sig_to_rep["sigA"] == 0.0


def test_recent_disliked_item_soft_penalty_sinks_rank():
    a, b = _candidate(**_PERSO_A), _candidate(**_PERSO_B)
    # sigB contains item tb, freshly soft-disliked → the −DISLIKE_PENALTY drops it below sigA.
    result = ranker.rank([a, b], _ctx(k=2, recent_disliked_item_ids=("tb",)))
    assert _result_signatures(result) == ["sigA", "sigB"]
    sig_to_dislike = {o.full_signature: o.breakdown.dislike for o in result.outfits}
    assert sig_to_dislike["sigB"] == -config.DISLIKE_PENALTY
    assert sig_to_dislike["sigA"] == 0.0


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
    # literal-empty case — the helper preserves a distinct cooldown-relax reserve (literal-empty
    # input has no reserve), and C5 may return a cooldown-relaxed fewer-than-k result.
    cand = _candidate(top="t1", bottom="b1")
    ctx = _ctx(recent_disliked_base_keys=("t1:b1",))
    result = ranker._apply_step4_filters([cand], ctx)
    assert result.survivors == ()
    assert result.cooldown_reserve == (cand,)

    ranked = ranker.rank([cand], ctx)
    assert _result_signatures(ranked) == [cand.full_signature]
    assert ranked.outfits[0].relaxed_cooldown is True
    assert ranked.fallback_stage is FallbackStage.insufficient
    assert ranked.insufficient_wardrobe is True


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


# ============================ Step 6 — diversity (C4, §6 step 5) ============================
#
# Small builders for diversity pools: each candidate gets a distinct base_key / full_signature
# (so the variant cap is a no-op) unless a test explicitly shares them.


def _scored(cand: ValidatedCandidate, ctx: RankerContext | None = None) -> ranker._ScoredCandidate:
    """Run C3 scoring on one candidate with a default (or supplied) context."""
    return ranker._score_candidate(cand, ctx if ctx is not None else _ctx())


def _scored_pool_all_with_item(n: int, item: str) -> list[ranker._ScoredCandidate]:
    """``n`` distinct-BaseKey candidates that all fill ``item`` in the top slot (frequency 100%)."""
    ctx = _ctx()
    return [
        _scored(
            _candidate(
                source_index=i, top=item, bottom=f"b{i}", base_key=f"bk{i}", full_signature=f"sig{i}"
            ),
            ctx,
        )
        for i in range(n)
    ]


def _scored_pool_item_in_k(total: int, k_with_item: int, item: str) -> list[ranker._ScoredCandidate]:
    """``total`` distinct-BaseKey candidates; the first ``k_with_item`` fill ``item`` in the top slot."""
    ctx = _ctx()
    pool = []
    for i in range(total):
        top = item if i < k_with_item else f"y{i}"
        pool.append(
            _scored(
                _candidate(
                    source_index=i, top=top, bottom=f"b{i}", base_key=f"bk{i}", full_signature=f"sig{i}"
                ),
                ctx,
            )
        )
    return pool


# ------------------------ variant cap (N5/N6) ------------------------


def test_variant_cap_keeps_top_two_by_pre_penalty_score():
    # Three variants of one BaseKey "t1:b1" (distinct outer). Affinity on the outer items sets
    # distinct Step-5 scores: o1=+1.0, o2=+0.5, o3=0 → keep o1, o2; drop the 3rd (o3).
    ctx = _ctx(item_affinity={"o1": 10, "o2": 5})  # o3 absent → 0
    c1 = _candidate(source_index=0, top="t1", bottom="b1", outer="o1")
    c2 = _candidate(source_index=1, top="t1", bottom="b1", outer="o2")
    c3 = _candidate(source_index=2, top="t1", bottom="b1", outer="o3")
    survivors = ranker._apply_variant_cap([_scored(c, ctx) for c in (c1, c2, c3)])
    kept = {sc.candidate.full_signature for sc in survivors}
    assert len(survivors) == 2
    assert kept == {c1.full_signature, c2.full_signature}  # top-2 by score
    assert c3.full_signature not in kept  # 3rd+ dropped


def test_variant_cap_keeps_distinct_full_signatures_within_cap():
    # Two same-BaseKey variants with distinct FullSignatures, only two of them → both survive
    # (the cap collapses *count*, never distinct signatures within the cap).
    c1 = _candidate(source_index=0, top="t1", bottom="b1", outer="o1")
    c2 = _candidate(source_index=1, top="t1", bottom="b1", outer="o2")
    survivors = ranker._apply_variant_cap([_scored(c) for c in (c1, c2)])
    assert len(survivors) == 2
    assert {sc.candidate.full_signature for sc in survivors} == {c1.full_signature, c2.full_signature}


def test_variant_cap_does_not_use_source_index():
    # Three same-BaseKey, equal scores, FullSignatures whose canonical order (z>m>a) differs from
    # source order. Canonical full_signature keeps {a, m}; a source_index tie-break would keep the
    # two lowest indices {z(0), a(1)} — so dropping z proves source_index is not the key.
    c0 = _candidate(source_index=0, top="t1", bottom="b1", base_key="bk", full_signature="z")
    c1 = _candidate(source_index=1, top="t1", bottom="b1", base_key="bk", full_signature="a")
    c2 = _candidate(source_index=2, top="t1", bottom="b1", base_key="bk", full_signature="m")
    survivors = ranker._apply_variant_cap([_scored(c) for c in (c0, c1, c2)])
    kept = {sc.candidate.full_signature for sc in survivors}
    assert kept == {"a", "m"}
    assert "z" not in kept


def test_variant_cap_deterministic_on_equal_scores_via_canonical_order():
    # Permuting the input order never changes which survive — the canonical (full_signature) order
    # is total, so the surviving set is permutation-invariant. (No seed is consulted: this is the
    # C4 canonical helper order, not the C5 seeded tie-break.)
    cands = [
        _candidate(source_index=i, top="t1", bottom="b1", base_key="bk", full_signature=fs)
        for i, fs in enumerate(["z", "a", "m"])
    ]
    scored = [_scored(c) for c in cands]
    for perm in itertools.permutations(scored):
        survivors = ranker._apply_variant_cap(list(perm))
        assert {sc.candidate.full_signature for sc in survivors} == {"a", "m"}


# ------------------------ overuse set: gate + threshold (N1/N2/Q1) ------------------------


def test_overuse_gate_not_applied_at_exactly_min_pool():
    # Exactly OVERUSE_MIN_POOL survivors, an item in 100% of them → still empty: the gate is a
    # strict `> OVERUSE_MIN_POOL`, so a pool of exactly the floor is never punished (B1).
    pool = _scored_pool_all_with_item(config.OVERUSE_MIN_POOL, "x")
    assert ranker._compute_overuse_set(pool) == frozenset()


def test_overuse_gate_applied_one_above_min_pool():
    # One past the floor (OVERUSE_MIN_POOL + 1), same 100%-frequency item → now overused.
    pool = _scored_pool_all_with_item(config.OVERUSE_MIN_POOL + 1, "x")
    assert ranker._compute_overuse_set(pool) == frozenset({"x"})


def test_overuse_item_at_exactly_threshold_not_overused():
    # Pool of 20, item in exactly 8 → 8/20 = 0.40 = OVERUSE_THRESHOLD, not strictly greater → not
    # overused. (Distinct bottoms each appear once, far below threshold.)
    pool = _scored_pool_item_in_k(20, 8, "x")
    assert ranker._compute_overuse_set(pool) == frozenset()


def test_overuse_item_above_threshold_overused():
    # Pool of 20, item in 9 → 9/20 = 0.45 > 0.40 → overused.
    pool = _scored_pool_item_in_k(20, 9, "x")
    assert ranker._compute_overuse_set(pool) == frozenset({"x"})


def test_overuse_set_collects_all_over_threshold_items_once():
    # Computed once over the given survivors, the set is exactly every item over the strict
    # threshold: x in 9/20 (0.45) and z in 11/20 (0.55) overused; w in exactly 8/20 (0.40) is not.
    ctx = _ctx()
    pool = []
    for i in range(20):
        top = "x" if i < 9 else "z"  # x:9, z:11
        bottom = "w" if i < 8 else f"b{i}"  # w:8 (==40%)
        pool.append(
            _scored(
                _candidate(
                    source_index=i, top=top, bottom=bottom, base_key=f"bk{i}", full_signature=f"sig{i}"
                ),
                ctx,
            )
        )
    assert ranker._compute_overuse_set(pool) == frozenset({"x", "z"})


def test_overuse_pool_is_post_variant_cap_not_pre_cap():
    # 10 candidates share BaseKey "pop" and item "x"; 14 have distinct BaseKeys without x.
    # Pre-cap (24 candidates): x in 10/24 (0.42) → overused. After the variant cap, "pop" collapses
    # to 2, so x is in only 2/16 (0.125) of the 16-survivor pool → NOT overused. The composition
    # must use the post-cap denominator, so no survivor carries an overuse penalty for x.
    ctx = _ctx()
    popular = [
        _candidate(source_index=i, top="x", bottom=f"pb{i}", base_key="pop", full_signature=f"pop{i}")
        for i in range(10)
    ]
    unique = [
        _candidate(
            source_index=10 + i, top=f"ut{i}", bottom=f"ub{i}", base_key=f"u{i}", full_signature=f"u{i}sig"
        )
        for i in range(14)
    ]
    scored = [_scored(c, ctx) for c in (*popular, *unique)]

    # Pre-cap x is overused; post-cap (still a >15 pool) it is not — isolating the denominator.
    assert "x" in ranker._compute_overuse_set(scored)
    survivors = ranker._apply_variant_cap(scored)
    assert len(survivors) == 16
    assert "x" not in ranker._compute_overuse_set(survivors)

    diversified = ranker._apply_step6_diversity(scored, ctx)
    assert all(sc.breakdown.overuse == 0.0 for sc in diversified)


# ------------------------ overuse penalty application (Q1, N13) ------------------------


def test_overuse_penalty_per_overused_filled_item():
    # Two of the candidate's filled items are in the overuse set → −OVERUSE_PENALTY each; an item
    # not in the set (s1) is not counted.
    scored = _scored(_candidate(top="t1", bottom="b1", shoes="s1"))
    rescored = ranker._rescore_with_diversity(scored, frozenset({"t1", "b1"}), _ctx())
    assert rescored.breakdown.overuse == pytest.approx(-config.OVERUSE_PENALTY * 2)


def test_overuse_counts_optional_outer_and_shoes():
    # N13 — overuse frequency ranges over every filled slot, including optional outer + shoes.
    scored = _scored(_candidate(top="t1", bottom="b1", outer="o1", shoes="s1"))
    rescored = ranker._rescore_with_diversity(scored, frozenset({"o1", "s1"}), _ctx())
    assert rescored.breakdown.overuse == pytest.approx(-config.OVERUSE_PENALTY * 2)


def test_no_overuse_penalty_when_no_overlap():
    scored = _scored(_candidate(top="t1", bottom="b1"))
    rescored = ranker._rescore_with_diversity(scored, frozenset({"x9"}), _ctx())
    assert rescored.breakdown.overuse == 0.0


# ------------------------ repetition penalty (Q2) ------------------------


def test_repetition_penalty_when_full_signature_shown():
    scored = _scored(_candidate(full_signature="sig-A"))
    rescored = ranker._rescore_with_diversity(
        scored, frozenset(), _ctx(shown_full_signatures=("sig-A",))
    )
    assert rescored.breakdown.repetition == -config.REPETITION_PENALTY


def test_repetition_penalty_flat_over_shown_duplicates():
    # A FullSignature shown several times still costs the flat penalty once — recency-invariant (Q2).
    scored = _scored(_candidate(full_signature="sig-A"))
    rescored = ranker._rescore_with_diversity(
        scored, frozenset(), _ctx(shown_full_signatures=("sig-A", "sig-A", "sig-A"))
    )
    assert rescored.breakdown.repetition == -config.REPETITION_PENALTY


def test_no_repetition_penalty_when_not_shown():
    scored = _scored(_candidate(full_signature="sig-A"))
    rescored = ranker._rescore_with_diversity(
        scored, frozenset(), _ctx(shown_full_signatures=("sig-OTHER",))
    )
    assert rescored.breakdown.repetition == 0.0


# ------------------------ signed-delta bookkeeping (N4) ------------------------


def test_combo_plus_repetition_nets_through_signed_deltas():
    # A re-liked FullSignature that was also recently shown: combo (+2) and repetition (−1) both
    # land as signed deltas; the net stays positive (Q2): base(1) + combo(2) − repetition(1) = 2.
    cand = _candidate(full_signature="sig-A")
    ctx = _ctx(liked_full_signatures={"sig-A"}, shown_full_signatures=("sig-A",))
    rescored = ranker._rescore_with_diversity(_scored(cand, ctx), frozenset(), ctx)
    b = rescored.breakdown
    assert b.combo == config.COMBO_BOOST
    assert b.repetition == -config.REPETITION_PENALTY
    assert rescored.score == pytest.approx(
        config.BASE_SCORE + config.COMBO_BOOST - config.REPETITION_PENALTY
    )
    assert rescored.score > 0


def test_c4_score_equals_sum_of_signed_deltas():
    # After Step-6 penalties the property holds: score == Σ signed breakdown deltas, and the C3
    # terms (base/combo/item/dislike/cooldown) are preserved while overuse + repetition are added.
    cand = _candidate(top="t1", bottom="b1", outer="o1", full_signature="sig-A")
    ctx = _ctx(item_affinity={"t1": 5}, shown_full_signatures=("sig-A",))
    rescored = ranker._rescore_with_diversity(_scored(cand, ctx), frozenset({"o1"}), ctx)
    b = rescored.breakdown
    assert rescored.score == (
        b.base + b.combo + b.item + b.dislike + b.overuse + b.repetition + b.cooldown
    )
    assert b.overuse == -config.OVERUSE_PENALTY  # o1 overused → 1 item
    assert b.repetition == -config.REPETITION_PENALTY
    assert b.item == pytest.approx(config.ITEM_BOOST_WEIGHT * 5)  # C3 term preserved


def test_rescore_preserves_cooldown_delta_from_c3():
    # A cooldown-relaxed C3 score keeps its COOLDOWN_PENALTY delta through Step-6 rescoring; a
    # normal candidate keeps cooldown 0.
    cand = _candidate(top="t1", bottom="b1")
    relaxed = ranker._score_candidate(cand, _ctx(), relaxed_cooldown=True)
    rescored = ranker._rescore_with_diversity(relaxed, frozenset(), _ctx())
    assert rescored.breakdown.cooldown == config.COOLDOWN_PENALTY

    normal = _scored(cand)
    assert ranker._rescore_with_diversity(normal, frozenset(), _ctx()).breakdown.cooldown == 0.0


# ------------------------ C4 stays inside its scope (no C5) ------------------------


def test_c4_diversity_does_not_truncate_to_k():
    # Six distinct-BaseKey candidates all survive the variant cap; the diversified pool is NOT
    # truncated to k (C5 owns truncate-to-k) and yields _ScoredCandidate, not assembled output.
    ctx = _ctx(k=2)
    cands = [
        _candidate(source_index=i, top=f"t{i}", bottom=f"b{i}", base_key=f"bk{i}", full_signature=f"sig{i}")
        for i in range(6)
    ]
    diversified = ranker._apply_step6_diversity([_scored(c, ctx) for c in cands], ctx)
    assert len(diversified) == 6
    assert all(isinstance(sc, ranker._ScoredCandidate) for sc in diversified)


def test_c4_helpers_do_not_make_public_rank_assemble():
    # The C4 diversity helper remains an internal scored-candidate transform; public RankedOutfit
    # assembly is owned by rank() in C5.
    diversified = ranker._apply_step6_diversity([_scored(_candidate())], _ctx())
    assert len(diversified) == 1
    assert isinstance(diversified[0], ranker._ScoredCandidate)


# ==================== mutation-coverage gaps (pre-C5, C1–C4) ====================
#
# Four focused tests closing mutants the existing suite leaves alive: a lock+cooldown
# double-failure leaking into the reserve, the variant cap running on post-diversity instead
# of Step-5 score, _compute_overuse_set ignoring optional slots in its frequency count, and
# C4 sneaking in a C5-style global sort.


def test_lock_failure_with_cooldown_is_not_reserved():
    # Gap 1 (N3): a candidate failing BOTH lock and cooldown is a non-relaxable drop — the lock
    # failure dominates, so it must NOT land in the cooldown-relax reserve (only solely-cooldown
    # drops are relaxable). Distinct from the existing contextual+cooldown non-relaxable test.
    cand = _candidate(top="t1", bottom="b1")  # base_key "t1:b1", items {t1, b1}; lacks "missing"
    result = ranker._apply_step4_filters(
        [cand],
        _ctx(
            locked_item_ids=frozenset({"missing"}),  # fails lock (item absent)
            recent_disliked_base_keys=("t1:b1",),  # also fails cooldown
        ),
    )
    assert result.survivors == ()
    assert result.cooldown_reserve == ()  # lock failure is non-relaxable, even with cooldown
    assert result.locked_survivor_count == 0  # never cleared the lock filter


def test_variant_cap_uses_step5_score_not_post_diversity_score():
    # Gap 2 (N5): the cap keeps the top-2 by Step-5 (pre-penalty) score, applied BEFORE repetition.
    # A,B win on Step-5 (item 2.0) over C (1.5); A,B are also in the shown window, so a mutant that
    # capped on the post-repetition score (A,B → 1.0, below C's 1.5) would keep C and drop a winner.
    ctx = _ctx(
        item_affinity={"oA": 10, "oB": 10, "oC": 5},  # Step-5: A=B=2.0, C=1.5
        shown_full_signatures=("A", "B"),  # repetition would sink A,B only AFTER the cap
    )
    a = _candidate(source_index=0, top="t1", bottom="b1", outer="oA", base_key="bk", full_signature="A")
    b = _candidate(source_index=1, top="t1", bottom="b1", outer="oB", base_key="bk", full_signature="B")
    c = _candidate(source_index=2, top="t1", bottom="b1", outer="oC", base_key="bk", full_signature="C")
    diversified = ranker._apply_step6_diversity([_scored(x, ctx) for x in (a, b, c)], ctx)
    kept = {sc.candidate.full_signature for sc in diversified}
    assert kept == {"A", "B"}  # Step-5 winners survive the cap...
    assert "C" not in kept  # ...the Step-5 loser is dropped (cap precedes repetition)


def test_compute_overuse_set_counts_optional_outer_slot():
    # Gap 3 (N13): _compute_overuse_set's frequency count ranges over every filled slot, so an
    # optional OUTER item over the threshold is overused. Distinct from the existing test that only
    # checks an outer/shoe is penalized when already handed to _rescore_with_diversity in the set.
    ctx = _ctx()
    pool = []
    for i in range(20):  # > OVERUSE_MIN_POOL; distinct top/bottom so only the outer can be overused
        outer = "o" if i < 12 else None  # o in 12/20 = 0.60 > 0.40
        pool.append(
            _scored(
                _candidate(
                    source_index=i,
                    top=f"t{i}",
                    bottom=f"b{i}",
                    outer=outer,
                    base_key=f"bk{i}",
                    full_signature=f"sig{i}",
                ),
                ctx,
            )
        )
    assert "o" in ranker._compute_overuse_set(pool)


def test_c4_diversity_does_not_globally_sort():
    # Gap 4: C4 must not start C5's global score sort. Distinct-BaseKey candidates fed in deliberate
    # non-score order (1.0, 3.0, 2.0) come out in the SAME order — a global descending sort would
    # yield [sig1, sig2, sig0]. Also pins no truncation to k.
    ctx = _ctx(item_affinity={"t1": 20, "t2": 10}, k=2)  # scores: c0=1.0, c1=3.0, c2=2.0
    c0 = _candidate(source_index=0, top="t0", bottom="b0", base_key="bk0", full_signature="sig0")
    c1 = _candidate(source_index=1, top="t1", bottom="b1", base_key="bk1", full_signature="sig1")
    c2 = _candidate(source_index=2, top="t2", bottom="b2", base_key="bk2", full_signature="sig2")
    diversified = ranker._apply_step6_diversity([_scored(x, ctx) for x in (c0, c1, c2)], ctx)
    order = [sc.candidate.full_signature for sc in diversified]
    assert order == ["sig0", "sig1", "sig2"]  # input order preserved — no global score sort (C5's job)
    assert len(diversified) == 3  # not truncated to k=2


# ============================ C5 fallback + tie-break + assembly ============================


def test_rank_variant_cap_relaxed_re_admits_third_basekey_variant():
    ctx = _ctx(k=3)
    c0 = _candidate(source_index=0, top="t1", bottom="b1", outer="o0", base_key="bk", full_signature="sig-a")
    c1 = _candidate(source_index=1, top="t1", bottom="b1", outer="o1", base_key="bk", full_signature="sig-b")
    c2 = _candidate(source_index=2, top="t1", bottom="b1", outer="o2", base_key="bk", full_signature="sig-c")

    result = ranker.rank([c0, c1, c2], ctx)

    assert result.fallback_stage is FallbackStage.variant_cap_relaxed
    assert result.insufficient_wardrobe is False
    assert set(_result_signatures(result)) == {"sig-a", "sig-b", "sig-c"}


def test_rank_variant_cap_relaxation_keeps_overuse_relaxed():
    # Cumulative fallback: by the time the ladder reaches variant_cap_relaxed, the overuse
    # penalty has already been dropped and must stay dropped. The post-cap pool is 17 (>15),
    # with top item "x" in every survivor, so normal diversity would penalize x.
    ctx = _ctx(k=18)
    singleton_bases = [
        _candidate(
            source_index=i,
            top="x",
            bottom=f"b{i}",
            base_key=f"x:b{i}",
            full_signature=f"sig-u{i}",
        )
        for i in range(15)
    ]
    shared_base = [
        _candidate(
            source_index=15 + i,
            top="x",
            bottom="shared",
            outer=f"o{i}",
            base_key="x:shared",
            full_signature=f"sig-shared-{i}",
        )
        for i in range(3)
    ]

    result = ranker.rank([*singleton_bases, *shared_base], ctx)

    assert result.fallback_stage is FallbackStage.variant_cap_relaxed
    assert len(result.outfits) == 18
    assert all(outfit.breakdown.overuse == 0.0 for outfit in result.outfits)


def test_rank_cooldown_relaxed_re_admits_only_cooldown_reserve():
    survivor = _candidate(source_index=0, top="t0", bottom="b0", base_key="safe", full_signature="safe")
    cooldown_only = _candidate(
        source_index=1, top="t1", bottom="b1", base_key="cool", full_signature="cool"
    )
    contextual_too = _candidate(
        source_index=2,
        top="t2",
        bottom="b2",
        shoes="bad",
        base_key="cool-contextual",
        full_signature="cool-contextual",
    )
    ctx = _ctx(
        k=2,
        recent_disliked_base_keys=("cool", "cool-contextual"),
        contextual_disliked_item_ids=frozenset({"bad"}),
    )

    result = ranker.rank([survivor, cooldown_only, contextual_too], ctx)

    assert result.fallback_stage is FallbackStage.cooldown_relaxed
    assert _result_signatures(result) == ["safe", "cool"]
    relaxed = result.outfits[1]
    assert relaxed.relaxed_cooldown is True
    assert relaxed.breakdown.cooldown == config.COOLDOWN_PENALTY
    assert result.relaxed_cooldown_count == 1
    assert "cool-contextual" not in _result_signatures(result)


def test_rank_cooldown_relaxation_never_relaxes_locks():
    survivor = _candidate(source_index=0, top="lock", bottom="b0", base_key="safe", full_signature="safe")
    cooldown_only_but_missing_lock = _candidate(
        source_index=1, top="t1", bottom="b1", base_key="cool", full_signature="cool"
    )
    ctx = _ctx(k=2, locked_item_ids=frozenset({"lock"}), recent_disliked_base_keys=("cool",))

    result = ranker.rank([survivor, cooldown_only_but_missing_lock], ctx)

    assert result.fallback_stage is FallbackStage.insufficient
    assert _result_signatures(result) == ["safe"]
    assert result.relaxed_cooldown_count == 0
    assert result.locked_survivor_count == 1
    assert result.insufficient_locked_candidates is True


def test_rank_insufficient_returns_fewer_than_k():
    result = ranker.rank([_candidate(full_signature="only")], _ctx(k=3))

    assert _result_signatures(result) == ["only"]
    assert result.fallback_stage is FallbackStage.insufficient
    assert result.insufficient_wardrobe is True
    assert result.relaxed_cooldown_count == 0


def test_relaxed_cooldown_count_is_post_truncation_emitted_count():
    survivor = _candidate(source_index=0, top="t0", bottom="b0", base_key="safe", full_signature="safe")
    cooldowns = [
        _candidate(
            source_index=i + 1,
            top=f"t{i}",
            bottom=f"b{i}",
            base_key=f"cool-{i}",
            full_signature=f"cool-{i}",
        )
        for i in range(3)
    ]
    ctx = _ctx(k=2, recent_disliked_base_keys=tuple(c.base_key for c in cooldowns))

    result = ranker.rank([survivor, *cooldowns], ctx)

    assert result.fallback_stage is FallbackStage.cooldown_relaxed
    assert len(result.outfits) == 2
    assert sum(1 for outfit in result.outfits if outfit.relaxed_cooldown) == 1
    assert result.relaxed_cooldown_count == 1


def test_tiebreak_generation_index_reorders_true_ties_only():
    cands = [
        _candidate(source_index=0, top="ta", bottom="ba", base_key="bk-a", full_signature="sig-a"),
        _candidate(source_index=1, top="tb", bottom="bb", base_key="bk-b", full_signature="sig-b"),
        _candidate(source_index=2, top="tc", bottom="bc", base_key="bk-c", full_signature="sig-c"),
    ]

    result0 = ranker.rank(cands, _ctx(generation_index=0, k=3))
    result1 = ranker.rank(cands, _ctx(generation_index=1, k=3))

    assert _result_signatures(result0) == ["sig-b", "sig-a", "sig-c"]
    assert _result_signatures(result1) == ["sig-c", "sig-a", "sig-b"]


def test_tiebreak_leaves_non_tied_order_stable_across_generation_index():
    ctx0 = _ctx(generation_index=0, item_affinity={"t-high": 20, "t-mid": 10}, k=3)
    ctx1 = _ctx(generation_index=1, item_affinity={"t-high": 20, "t-mid": 10}, k=3)
    cands = [
        _candidate(source_index=0, top="t-low", bottom="b-low", base_key="bk-low", full_signature="low"),
        _candidate(source_index=1, top="t-high", bottom="b-high", base_key="bk-high", full_signature="high"),
        _candidate(source_index=2, top="t-mid", bottom="b-mid", base_key="bk-mid", full_signature="mid"),
    ]

    assert _result_signatures(ranker.rank(cands, ctx0)) == ["high", "mid", "low"]
    assert _result_signatures(ranker.rank(cands, ctx1)) == ["high", "mid", "low"]


def test_tiebreak_is_permutation_invariant():
    cands = [
        _candidate(source_index=0, top="ta", bottom="ba", base_key="bk-a", full_signature="sig-a"),
        _candidate(source_index=1, top="tb", bottom="bb", base_key="bk-b", full_signature="sig-b"),
        _candidate(source_index=2, top="tc", bottom="bc", base_key="bk-c", full_signature="sig-c"),
    ]

    expected = _result_signatures(ranker.rank(cands, _ctx(k=3)))
    for perm in itertools.permutations(cands):
        assert _result_signatures(ranker.rank(list(perm), _ctx(k=3))) == expected


def test_tiebreak_spreads_basekeys_greedily_within_tie_group():
    cands = [
        _candidate(source_index=0, top="t1", bottom="b1", base_key="bk-a", full_signature="sig-a1"),
        _candidate(source_index=1, top="t2", bottom="b2", base_key="bk-a", full_signature="sig-a2"),
        _candidate(source_index=2, top="t3", bottom="b3", base_key="bk-b", full_signature="sig-b1"),
        _candidate(source_index=3, top="t4", bottom="b4", base_key="bk-c", full_signature="sig-c1"),
    ]

    result = ranker.rank(cands, _ctx(generation_index=0, k=4))

    assert _result_signatures(result) == ["sig-a2", "sig-c1", "sig-b1", "sig-a1"]


def test_tiebreak_never_uses_source_index():
    cands = [
        _candidate(source_index=0, top="tz", bottom="bz", base_key="bk-z", full_signature="sig-z"),
        _candidate(source_index=1, top="ta", bottom="ba", base_key="bk-a", full_signature="sig-a"),
        _candidate(source_index=2, top="tm", bottom="bm", base_key="bk-m", full_signature="sig-m"),
    ]

    result = ranker.rank(cands, _ctx(generation_index=0, k=3))

    assert _result_signatures(result) == ["sig-m", "sig-a", "sig-z"]


def test_rank_output_snapshots_slotmap_and_style_move():
    move_ids = ["t1"]
    move = StyleMove(move_type="swap", changed_item_ids=move_ids, one_sentence="Try the sharper tee.")
    cand = _with_style_move(_candidate(top="t1", bottom="b1", full_signature="sig"), move)

    result = ranker.rank([cand], _ctx(k=1))
    outfit = result.outfits[0]
    cand.slot_map.top = "MUTATED"
    move_ids.append("b1")
    move.changed_item_ids.append("extra")

    assert outfit.slot_map is not cand.slot_map
    assert outfit.slot_map.top == "t1"
    assert outfit.style_move is not None
    assert outfit.style_move.changed_item_ids == ("t1",)
    assert isinstance(result.outfits, tuple)


# ==================== C6 — mutation hardening + closeout coverage ====================
#
# Closes the one §12 mutant the C1–C5 suite left uncovered (M3 re-deduping FullSignatures),
# plus two end-to-end rank() cases the per-helper tests never exercised through the public
# entry point: overuse applied at the `none` stage, and a non-empty pool hard-filtered to
# zero through the main path (distinct from the literal-empty short-circuit, N15).


def test_rank_does_not_re_dedup_full_signature():
    # §12 guard: M2 already drops exact-FullSignature duplicates in its pass (§9 step 3); M3
    # trusts that and must NEVER re-dedup. Two candidates sharing a FullSignature — a
    # contract-violating input M3 itself never produces, but exactly what a re-dedup mutant
    # would collapse — must BOTH reach the output. Distinct scores keep them in separate tie
    # groups, so the assertion is independent of the seeded tie-break.
    high = _candidate(source_index=0, top="t1", bottom="b1", base_key="bk0", full_signature="dup")
    low = _candidate(source_index=1, top="t2", bottom="b2", base_key="bk1", full_signature="dup")
    result = ranker.rank([high, low], _ctx(item_affinity={"t1": 10}, k=2))
    assert _result_signatures(result) == ["dup", "dup"]  # both survive — no re-dedup
    assert {outfit.source_index for outfit in result.outfits} == {0, 1}


def test_rank_non_empty_all_hard_filtered_returns_zero_via_main_path():
    # A non-empty candidate list whose only candidate is dropped by a NON-relaxable filter
    # (contextual dislike) leaves zero survivors AND an empty cooldown reserve, so the fallback
    # ladder exhausts to an empty pool. This is the main-path zero-output case — distinct from
    # the literal-empty short-circuit (N15) and from the cooldown-only reserve case (which
    # re-admits one outfit). rank() must assemble an empty result without raising.
    cand = _candidate(top="t1", bottom="b1", shoes="bad")
    result = ranker.rank([cand], _ctx(contextual_disliked_item_ids=frozenset({"bad"})))
    assert result.outfits == ()
    assert result.fallback_stage is FallbackStage.insufficient
    assert result.insufficient_wardrobe is True
    assert result.relaxed_cooldown_count == 0
    assert result.insufficient_locked_candidates is False  # no locks were requested


def test_rank_overuse_penalty_applied_at_none_stage():
    # End-to-end overuse through rank() at the `none` stage: a survivor pool just past the gate
    # (OVERUSE_MIN_POOL + 1, distinct BaseKeys so the variant cap is a no-op) with one item far
    # over the 40% threshold. With k below the clean-outfit count, the emitted top-k must include
    # overused outfits carrying a negative overuse delta — and because the penalty is score-only
    # (never drops a candidate) the stage stays `none`, never relaxing (the overuse_relaxed rung
    # cannot be reached by an overused-but-full pool).
    pool_size = config.OVERUSE_MIN_POOL + 1
    clean = 3  # < k below, so the emitted top-k necessarily includes overused outfits
    cands = [
        _candidate(
            source_index=i,
            top=("x" if i >= clean else f"clean{i}"),  # x fills (pool_size - clean) of the pool
            bottom=f"b{i}",
            base_key=f"bk{i}",
            full_signature=f"sig{i}",
        )
        for i in range(pool_size)
    ]
    result = ranker.rank(cands, _ctx(k=5))
    assert result.fallback_stage is FallbackStage.none  # overuse is score-only, never relaxes
    assert result.insufficient_wardrobe is False
    assert len(result.outfits) == 5
    assert any(
        outfit.breakdown.overuse == pytest.approx(-config.OVERUSE_PENALTY)
        for outfit in result.outfits
    )
