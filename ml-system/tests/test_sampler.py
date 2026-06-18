"""Tests for M1-1 (partition) and M1-2 (per-type caps). v2 §10, Appendix A R4.

The permuted-input determinism test is the one that matters: an in-memory
fixture is already in a stable order, so only shuffling the input can prove
partition pins ordering before any RNG draw (R4).
"""

import random

import pytest

from fitted_core.config import MAX_PROMPT_ITEMS, MIN_SIGNAL_THRESHOLD
from fitted_core.models import ItemType, WardrobeItem
from fitted_core.sampler import (
    COLD_START_SAMPLING,
    SIGNAL_SCORER_FAULT,
    SIGNAL_UNAVAILABLE,
    CAP_BY_TYPE,
    ColdStartSignalScorer,
    RequestContext,
    SamplerResult,
    SelectionKind,
    _sample_one_type,
    build_candidate_pool,
    candidate_requested,
    partition,
    random_count,
    sample_type,
)


# --- M1-1: partition (§10, R4) ---


def test_partition_groups_by_type(demo_wardrobe):
    buckets = partition(demo_wardrobe)
    assert [it.id for it in buckets[ItemType.top]] == ["t1", "t2", "t3"]
    assert [it.id for it in buckets[ItemType.bottom]] == ["b1", "b2", "b3"]
    assert [it.id for it in buckets[ItemType.shoes]] == ["s1", "s2"]


def test_partition_includes_every_type_even_when_empty(demo_wardrobe):
    # The demo wardrobe has no dresses or outer layers by design; those types
    # must still be present as empty lists (§10 no-dresses edge case).
    buckets = partition(demo_wardrobe)
    assert set(buckets.keys()) == set(ItemType)
    assert buckets[ItemType.dress] == []
    assert buckets[ItemType.outer_layer] == []


def test_partition_key_order_is_enum_order(demo_wardrobe):
    assert list(partition(demo_wardrobe).keys()) == list(ItemType)


def test_partition_sorts_each_type_by_id(over_cap_wardrobe):
    buckets = partition(over_cap_wardrobe)
    for items in buckets.values():
        ids = [it.id for it in items]
        assert ids == sorted(ids)


def test_partition_is_permutation_invariant(over_cap_wardrobe):
    # R4: same input set, any input order -> identical partition. The fixture is
    # built in descending-id order, so a shuffle genuinely reorders it.
    shuffled = list(over_cap_wardrobe)
    random.Random(1234).shuffle(shuffled)
    assert shuffled != over_cap_wardrobe  # guard: the shuffle actually moved things
    assert partition(shuffled) == partition(over_cap_wardrobe)


# --- M1-2: per-type caps + the shared `_items` helper (§10) ---
# (The M1-2 interim `apply_cap(items, cap, sample_fn)` callback seam was retired at
# M1-5, R13 — cap behaviour is now covered through build_candidate_pool below.)


def _items(type_: ItemType, n: int) -> list[WardrobeItem]:
    return [
        WardrobeItem(id=f"x{i:03d}", name=f"x{i}", type=type_, warmth=5, image_url=f"x{i}.jpg")
        for i in range(n)
    ]


def test_cap_by_type_covers_every_type():
    assert set(CAP_BY_TYPE.keys()) == set(ItemType)
    assert sum(CAP_BY_TYPE.values()) == MAX_PROMPT_ITEMS


def test_cap_by_type_maps_each_type_to_its_own_cap():
    # Key-coverage + sum-to-135 alone pass under a swapped mapping (e.g. top->30,
    # bottom->35 keeps the sum). Pin the exact per-type mapping so a mis-wired
    # CAP_BY_TYPE entry is caught.
    assert CAP_BY_TYPE[ItemType.top] == 35
    assert CAP_BY_TYPE[ItemType.bottom] == 30
    assert CAP_BY_TYPE[ItemType.dress] == 25
    assert CAP_BY_TYPE[ItemType.outer_layer] == 20
    assert CAP_BY_TYPE[ItemType.shoes] == 25


# ============================================================================
# M1-3: sample_type — 70/30 sampler + SignalScorer seam (§10/§11, R6/R11/R13)
# ============================================================================


def _ctx(interaction_count: int) -> RequestContext:
    return RequestContext(
        occasion="brunch", weather="mild", session_id="u1",
        wardrobe_version=1, interaction_count=interaction_count,
    )


class _LowerIdRanksHigher:
    """Available scorer with distinct scores: "x000" ranks highest, "x039" lowest.

    score = -int(id digits), so (score desc, id asc) ranks by ascending id — making
    the deterministic signal slot a known, assertable set.
    """

    def is_available(self):
        return True

    def score(self, item, context):
        return -float(int(item.id[1:]))


class _Raises:
    def is_available(self):
        return True

    def score(self, item, context):
        raise RuntimeError("scorer boom")


class _Returns:
    """Available scorer returning a fixed bad value (NaN / inf / bool)."""

    def __init__(self, value):
        self._value = value

    def is_available(self):
        return True

    def score(self, item, context):
        return self._value


# --- helpers + seam objects ---


def test_random_count_real_caps_integer_half_up():
    # R6 trap-guard: integer half-up, NOT banker's rounding. These are the 70% values.
    assert random_count(35) == 25
    assert random_count(30) == 21
    assert random_count(25) == 18
    assert random_count(20) == 14
    assert random_count(10) == 7  # cap 10 -> 7 random + 3 signal


def test_cold_start_scorer_never_available_and_score_raises():
    s = ColdStartSignalScorer()
    assert s.is_available() is False
    # score() must never be called once is_available() gates it — raising is the contract.
    with pytest.raises(NotImplementedError):
        s.score(_items(ItemType.top, 1)[0], _ctx(0))


def test_selection_kind_spans_all_three_outcomes():
    # R13: the enum must span signal/random/include_all so a per-type log is never
    # ambiguous. include_all is produced by the M1-5 per-type loop, not sample_type.
    assert {k.value for k in SelectionKind} == {"signal", "random", "includeAll"}


# --- fallback reasons (R11): behavior-identical, log-distinct ---


@pytest.mark.parametrize("count", [0, 4, MIN_SIGNAL_THRESHOLD - 1])
def test_cold_start_fallback_below_threshold(count):
    items = _items(ItemType.top, 40)
    res = sample_type(items, 35, rng=random.Random(7), scorer=ColdStartSignalScorer(),
                      context=_ctx(count), scorer_available=False)
    assert res.selection_kind is SelectionKind.random
    assert res.reason == COLD_START_SAMPLING
    assert res.signal_count == 0 and res.random_count == 35
    assert len(res.items) == 35


def test_signal_unavailable_fallback_at_threshold_without_scorer():
    # Count meets the threshold but the scorer isn't available (M4->M6 window).
    items = _items(ItemType.top, 40)
    res = sample_type(items, 35, rng=random.Random(7), scorer=ColdStartSignalScorer(),
                      context=_ctx(MIN_SIGNAL_THRESHOLD), scorer_available=False)
    assert res.selection_kind is SelectionKind.random
    assert res.reason == SIGNAL_UNAVAILABLE


@pytest.mark.parametrize("scorer", [
    _Raises(),
    _Returns(float("nan")),
    _Returns(float("inf")),
    _Returns(float("-inf")),
    _Returns(True),  # bool is an int subclass; isfinite(True) is True — must still fault
])
def test_signal_scorer_fault_fallback(scorer):
    items = _items(ItemType.top, 40)
    res = sample_type(items, 35, rng=random.Random(7), scorer=scorer,
                      context=_ctx(MIN_SIGNAL_THRESHOLD), scorer_available=True)
    assert res.selection_kind is SelectionKind.random
    assert res.reason == SIGNAL_SCORER_FAULT
    assert res.signal_count == 0 and len(res.items) == 35


def test_three_fallbacks_are_behavior_identical_same_seed():
    # The load-bearing R11 invariant: data arrival changes only the log label, never
    # the outfits, until M6. All three fallbacks route through one seeded path.
    items = _items(ItemType.top, 40)
    cold = sample_type(items, 35, rng=random.Random(99), scorer=ColdStartSignalScorer(),
                       context=_ctx(0), scorer_available=True)
    unavail = sample_type(items, 35, rng=random.Random(99), scorer=ColdStartSignalScorer(),
                          context=_ctx(MIN_SIGNAL_THRESHOLD), scorer_available=False)
    fault = sample_type(items, 35, rng=random.Random(99), scorer=_Raises(),
                        context=_ctx(MIN_SIGNAL_THRESHOLD), scorer_available=True)
    ids = lambda r: [it.id for it in r.items]
    assert ids(cold) == ids(unavail) == ids(fault)
    assert {cold.reason, unavail.reason, fault.reason} == {
        COLD_START_SAMPLING, SIGNAL_UNAVAILABLE, SIGNAL_SCORER_FAULT,
    }


# --- signal branch (R11): signal-first, disjoint random remainder ---


def test_signal_branch_70_30_split_and_signal_first():
    items = _items(ItemType.top, 40)  # ids x000..x039
    res = sample_type(items, 35, rng=random.Random(3), scorer=_LowerIdRanksHigher(),
                      context=_ctx(MIN_SIGNAL_THRESHOLD), scorer_available=True)
    assert res.selection_kind is SelectionKind.signal
    assert res.reason is None
    assert res.signal_count == 10 and res.random_count == 25  # 35 -> 25 random + 10 signal
    result_ids = [it.id for it in res.items]
    assert len(result_ids) == 35
    assert len(set(result_ids)) == 35  # no duplicates across signal + random slots
    # Signal-first: the deterministic top-10 by (score desc, id asc) = x000..x009 must
    # all survive (they consume no RNG and are picked before the random slot).
    top_signal = {f"x{i:03d}" for i in range(10)}
    assert top_signal.issubset(set(result_ids))
    # Random slot is disjoint from the signal slot, drawn from the remainder.
    random_slot = set(result_ids) - top_signal
    assert len(random_slot) == 25
    assert random_slot.issubset({f"x{i:03d}" for i in range(10, 40)})
    # Emit order is id-sorted (byte-stable prompt).
    assert result_ids == sorted(result_ids)


def test_split_sizes_at_cap_10():
    # Plan §4 M1-3: over-cap cap=10 -> 7 random + 3 signal with an available scorer.
    items = _items(ItemType.top, 12)
    res = sample_type(items, 10, rng=random.Random(1), scorer=_LowerIdRanksHigher(),
                      context=_ctx(MIN_SIGNAL_THRESHOLD), scorer_available=True)
    assert res.random_count == 7 and res.signal_count == 3
    assert len(res.items) == 10


# --- determinism (R4): same seed -> same set ---


def test_signal_branch_determinism_same_seed():
    items = _items(ItemType.top, 40)
    kw = dict(scorer=_LowerIdRanksHigher(), context=_ctx(MIN_SIGNAL_THRESHOLD),
              scorer_available=True)
    a = sample_type(items, 35, rng=random.Random(42), **kw)
    b = sample_type(items, 35, rng=random.Random(42), **kw)
    assert [it.id for it in a.items] == [it.id for it in b.items]


def test_fallback_determinism_same_seed():
    items = _items(ItemType.top, 40)
    kw = dict(scorer=ColdStartSignalScorer(), context=_ctx(0), scorer_available=False)
    a = sample_type(items, 35, rng=random.Random(42), **kw)
    b = sample_type(items, 35, rng=random.Random(42), **kw)
    assert [it.id for it in a.items] == [it.id for it in b.items]


# ============================================================================
# M1-4: candidate_requested — candidate-request scaling (§10)
# ============================================================================


def _pool(*, n_tops=0, n_bottoms=0, n_dresses=0, n_outer=0, n_shoes=0):
    # Post-cap per-type pool. candidate_requested only reads lengths, so reusing the
    # `x%03d` ids across types is harmless here.
    return {
        ItemType.top: _items(ItemType.top, n_tops),
        ItemType.bottom: _items(ItemType.bottom, n_bottoms),
        ItemType.dress: _items(ItemType.dress, n_dresses),
        ItemType.outer_layer: _items(ItemType.outer_layer, n_outer),
        ItemType.shoes: _items(ItemType.shoes, n_shoes),
    }


def test_candidate_requested_zero_when_no_base():
    # tops but no bottoms, no dresses -> total_base 0 -> 0 (the notEnoughItems signal).
    assert candidate_requested(_pool(n_tops=5)) == 0


def test_candidate_requested_zero_on_empty_pool():
    assert candidate_requested(_pool()) == 0


def test_candidate_requested_tiny_no_floor():
    # tops=1,bottoms=1 -> total_base 1 -> 3 (proportionally fewer, no floor).
    assert candidate_requested(_pool(n_tops=1, n_bottoms=1)) == 3


def test_candidate_requested_boundary_at_5():
    # total_base == 5 -> 15 (the <=5 branch). tops=5,bottoms=1.
    assert candidate_requested(_pool(n_tops=5, n_bottoms=1)) == 15


def test_candidate_requested_just_over_boundary():
    # total_base == 6 -> 18 (>5 branch, still under the ceiling). tops=6,bottoms=1.
    assert candidate_requested(_pool(n_tops=6, n_bottoms=1)) == 18


def test_candidate_requested_ceiling_at_max_candidates():
    # total_base*3 > 40 -> exactly MAX_CANDIDATES (40). tops=10,bottoms=10 -> 100 -> 40.
    assert candidate_requested(_pool(n_tops=10, n_bottoms=10)) == 40


def test_candidate_requested_dresses_contribute_independently():
    # Dresses-only (no top*bottom pairing): total_base 4 -> 12.
    assert candidate_requested(_pool(n_dresses=4)) == 12
    # Dresses add on top of the two_piece base: 2*2 + 2 = 6 -> 18.
    assert candidate_requested(_pool(n_tops=2, n_bottoms=2, n_dresses=2)) == 18


def test_candidate_requested_ignores_outer_and_shoes():
    # outer/shoes are optional roles, never a base -> they never change total_base.
    assert candidate_requested(_pool(n_tops=1, n_bottoms=1, n_outer=9, n_shoes=9)) == 3


# ============================================================================
# M1-5: build_candidate_pool — the sampler entry point (§10/§15, R4/R11/R12)
# ============================================================================


class _CountingScorer:
    """Records is_available() calls; unavailable, so score() is never reached."""

    def __init__(self, available=False):
        self.availability_checks = 0
        self._available = available

    def is_available(self):
        self.availability_checks += 1
        return self._available

    def score(self, item, context):
        raise AssertionError("score() must not be called when unavailable")


class _AvailabilityRaises:
    def is_available(self):
        raise RuntimeError("is_available boom")

    def score(self, item, context):
        raise AssertionError("score() must not be called")


def test_build_pool_happy_path_demo_wardrobe(demo_wardrobe):
    # All types under cap -> every per_type result is include_all; pool == full wardrobe.
    res = build_candidate_pool(demo_wardrobe, _ctx(0), ColdStartSignalScorer())
    assert isinstance(res, SamplerResult)
    assert set(res.per_type) == set(ItemType)
    assert all(r.selection_kind is SelectionKind.include_all for r in res.per_type.values())
    assert all(r.reason is None for r in res.per_type.values())
    assert res.prompt_item_count == len(demo_wardrobe) == 8
    assert all(len(res.pool[t]) <= CAP_BY_TYPE[t] for t in ItemType)
    # candidate_requested: total_base = 3 tops * 3 bottoms + 0 dresses = 9 -> min(40, 27) = 27.
    assert res.candidate_requested == 27
    assert res.not_enough_items is False
    assert res.scorer_available is False  # ColdStartSignalScorer is the default stub


def test_build_pool_rejects_duplicate_ids_before_partition():
    wardrobe = [
        WardrobeItem("dup", "a", ItemType.top, warmth=5, image_url="a.jpg"),
        WardrobeItem("dup", "b", ItemType.bottom, warmth=5, image_url="b.jpg"),
    ]
    with pytest.raises(ValueError, match="duplicate logical item id"):
        build_candidate_pool(wardrobe, _ctx(0), ColdStartSignalScorer())


def test_build_pool_evaluates_is_available_exactly_once(over_cap_wardrobe):
    # Five over-cap types, but availability is a per-request property: checked once and
    # the boolean passed down (R11), never re-evaluated per type.
    scorer = _CountingScorer(available=False)
    build_candidate_pool(over_cap_wardrobe, _ctx(0), scorer)
    assert scorer.availability_checks == 1


def test_build_pool_is_available_exception_treated_as_unavailable(over_cap_wardrobe):
    # A raising is_available() must not propagate; the safe state is "no signal".
    res = build_candidate_pool(over_cap_wardrobe, _ctx(MIN_SIGNAL_THRESHOLD), _AvailabilityRaises())
    assert res.scorer_available is False
    parts = partition(over_cap_wardrobe)
    over_cap_types = [t for t in ItemType if len(parts[t]) > CAP_BY_TYPE[t]]
    assert over_cap_types  # guard: the fixture really is over cap
    # count >= threshold but unavailable -> every over-cap type falls back as signalUnavailable.
    for t in over_cap_types:
        assert res.per_type[t].selection_kind is SelectionKind.random
        assert res.per_type[t].reason == SIGNAL_UNAVAILABLE


def test_build_pool_unavailable_scorer_falls_back_in_every_over_cap_type(over_cap_wardrobe):
    # Default stub path: ColdStartSignalScorer (unavailable) + zero interactions -> every
    # over-cap type cold-starts (seeded random fallback); the boolean reached every type.
    res = build_candidate_pool(over_cap_wardrobe, _ctx(0), ColdStartSignalScorer())
    assert res.scorer_available is False
    parts = partition(over_cap_wardrobe)
    for t in ItemType:
        if len(parts[t]) > CAP_BY_TYPE[t]:
            assert res.per_type[t].selection_kind is SelectionKind.random
            assert res.per_type[t].reason == COLD_START_SAMPLING
            assert len(res.per_type[t].items) == CAP_BY_TYPE[t]


def test_build_pool_not_enough_items_short_circuit():
    # Tops but no bottoms and no dresses -> total_base 0 -> candidate_requested 0 -> flagged
    # (the signal the M5 caller uses to skip GPT entirely).
    res = build_candidate_pool(_items(ItemType.top, 3), _ctx(0), ColdStartSignalScorer())
    assert res.candidate_requested == 0
    assert res.not_enough_items is True


def test_build_pool_prompt_item_count_never_exceeds_max(over_cap_wardrobe):
    # Every type over cap -> summed pool hits exactly the cap sum == MAX_PROMPT_ITEMS, the
    # cross-type invariant (caps sum to it; never enforced by truncation).
    res = build_candidate_pool(over_cap_wardrobe, _ctx(0), ColdStartSignalScorer())
    assert res.prompt_item_count == MAX_PROMPT_ITEMS
    assert res.prompt_item_count <= MAX_PROMPT_ITEMS


def test_apply_cap_callback_seam_is_retired():
    # R13: the M1-2 interim apply_cap(items, cap, sample_fn) callback seam no longer
    # exists, so it cannot control entry-point behaviour — build_candidate_pool's
    # per-type loop is the only cap path now.
    import fitted_core.sampler as sampler_mod
    assert not hasattr(sampler_mod, "apply_cap")
    assert not hasattr(sampler_mod, "SampleFn")


def test_build_pool_deterministic_same_context(over_cap_wardrobe):
    # Same context -> same session seed -> one shared RNG -> identical sampled pool (R4).
    ctx = _ctx(0)
    a = build_candidate_pool(over_cap_wardrobe, ctx, ColdStartSignalScorer())
    b = build_candidate_pool(over_cap_wardrobe, ctx, ColdStartSignalScorer())
    for t in ItemType:
        assert [it.id for it in a.pool[t]] == [it.id for it in b.pool[t]]
    assert a.candidate_requested == b.candidate_requested


# ============================================================================
# M1 mutation-hardening pass — close gaps where a wrong implementation survives
# (these target specific mutants; see the audit report). No new behavior.
# ============================================================================


class _TruthyAvailable:
    """is_available() returns a truthy NON-True value; score() is a finite float.

    Pins the strict ``is True`` availability resolution: a ``bool(...)`` mutant would
    accept this as available, this scorer makes that observable.
    """

    def is_available(self):
        return 1  # truthy, but not literally True

    def score(self, item, context):
        return 1.0


def _one_type(items, cap):
    # _sample_one_type with the default stub scorer (unavailable, count 0 -> fallback
    # on the over-cap path). Isolates the cap/include-all boundary the retired apply_cap
    # used to own.
    return _sample_one_type(
        items, cap, rng=random.Random(0), scorer=ColdStartSignalScorer(),
        context=_ctx(0), scorer_available=False,
    )


# --- candidate_requested: the min() ceiling activation boundary (A) ---


def test_candidate_requested_cap_activation_boundary():
    # The ceiling activates exactly when total_base*3 > MAX_CANDIDATES(40): total_base
    # 13 -> 39 (uncapped), 14 -> 42 -> 40 (capped). The 6->18 and 100->40 cases leave
    # this transition untested; a near-boundary off-by-one would survive without this.
    assert candidate_requested(_pool(n_dresses=13)) == 39
    assert candidate_requested(_pool(n_dresses=14)) == 40


# --- sample_type: fallback id-ordering + log-label literals (B) ---


def test_fallback_result_items_are_id_sorted():
    # The fallback path's ONLY id-sort is inside _seeded_pick — the signal branch
    # re-sorts `combined`, so it can't cover this. A byte-stable prompt needs the
    # fallback sorted too; a dropped sort here would survive every other test.
    items = _items(ItemType.top, 40)
    res = sample_type(items, 35, rng=random.Random(7), scorer=ColdStartSignalScorer(),
                      context=_ctx(0), scorer_available=False)
    result_ids = [it.id for it in res.items]
    assert result_ids == sorted(result_ids)


def test_fallback_reason_constants_match_spec_log_labels():
    # The three log labels are a v2 §10 contract (analytics keys off them). sample_type
    # tests compare against the constants, so a string-value rename would survive — pin
    # the literals here.
    assert COLD_START_SAMPLING == "coldStartSampling"
    assert SIGNAL_UNAVAILABLE == "signalUnavailable"
    assert SIGNAL_SCORER_FAULT == "signalScorerFault"


def test_signal_slot_forces_top_scorers_across_seeds():
    # Robust signal-first (R11): the top signal_count scorers are force-included with NO
    # RNG, so they appear in EVERY seed's result; lower scorers ride the random slot and
    # vary. n >> cap so the random slot cannot accidentally cover the top scorers under a
    # wrong (ascending / lowest-first) selection — this makes the kill seed-independent,
    # unlike the single-seed subset assertion above which only happens to catch it.
    items = _items(ItemType.top, 100)  # x000 highest score ... x099 lowest
    cap = 10  # sc=3 signal, rc=7 random
    results = [
        sample_type(items, cap, rng=random.Random(s), scorer=_LowerIdRanksHigher(),
                    context=_ctx(MIN_SIGNAL_THRESHOLD), scorer_available=True)
        for s in range(8)
    ]
    top3 = {"x000", "x001", "x002"}
    for r in results:
        assert r.selection_kind is SelectionKind.signal
        assert r.signal_count == 3 and r.random_count == 7
        assert top3.issubset({it.id for it in r.items})  # forced — present every seed
    # Guard: the random slot genuinely varies across seeds, so "always present" above is
    # a real signal-slot property, not a constant pool.
    assert len({tuple(it.id for it in r.items) for r in results}) > 1


# --- build_candidate_pool integration (C) ---


def test_build_pool_truthy_non_true_is_available_treated_unavailable(over_cap_wardrobe):
    # R11: availability resolution is strict `is True`; a truthy-but-not-True result is
    # NOT confirmed availability -> treated unavailable. A `bool(...)` mutant would flip
    # scorer_available to True here (and sample on signal); pin it to False.
    res = build_candidate_pool(over_cap_wardrobe, _ctx(MIN_SIGNAL_THRESHOLD), _TruthyAvailable())
    assert res.scorer_available is False


def test_build_pool_seed_depends_on_context(over_cap_wardrobe):
    # build must thread the request context into the session seed (R4); a build that
    # hardcoded or ignored its seed inputs would return the same pool for different
    # contexts. (Per-field seed sensitivity itself is covered in test_seed.)
    base = _ctx(0)  # occasion="brunch"
    other = RequestContext(
        occasion="gala", weather=base.weather, session_id=base.session_id,
        wardrobe_version=base.wardrobe_version, interaction_count=0,
    )
    a = build_candidate_pool(over_cap_wardrobe, base, ColdStartSignalScorer())
    b = build_candidate_pool(over_cap_wardrobe, other, ColdStartSignalScorer())
    a_ids = [it.id for t in ItemType for it in a.pool[t]]
    b_ids = [it.id for t in ItemType for it in b.pool[t]]
    assert a_ids != b_ids


# --- apply_cap retirement: equivalent behavior covered via _sample_one_type (D) ---


def test_sample_one_type_below_cap_includes_all_as_copy():
    # Below cap -> include_all, items unchanged, returned as a COPY (callers may mutate
    # independently). Migrates the retired apply_cap below-cap + copy coverage.
    items = _items(ItemType.top, 3)
    res = _one_type(items, 10)
    assert res.selection_kind is SelectionKind.include_all
    assert res.reason is None
    assert res.signal_count == 0 and res.random_count == 0
    assert [it.id for it in res.items] == [it.id for it in items]
    assert res.items is not items  # a copy, not the partition bucket


def test_sample_one_type_at_cap_includes_all():
    # Boundary: len == cap is include-all (the `<=` boundary), NOT sampled. A `<` mutant
    # would route this to sample_type and mislabel it random/signal.
    items = _items(ItemType.top, 10)
    res = _one_type(items, 10)
    assert res.selection_kind is SelectionKind.include_all
    assert len(res.items) == 10


def test_sample_one_type_over_cap_delegates_to_sample_type():
    # Over cap -> sample_type path (here the cold-start fallback): exactly cap items,
    # labeled random (not include_all). Migrates the retired apply_cap over-cap coverage.
    items = _items(ItemType.top, 11)
    res = _one_type(items, 10)
    assert res.selection_kind is SelectionKind.random
    assert res.reason == COLD_START_SAMPLING
    assert len(res.items) == 10
