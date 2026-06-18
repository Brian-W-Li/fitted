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
    SelectionKind,
    apply_cap,
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


# --- M1-2: apply_cap (§10) ---


def _items(type_: ItemType, n: int) -> list[WardrobeItem]:
    return [
        WardrobeItem(id=f"x{i:03d}", name=f"x{i}", type=type_, warmth=5, image_url=f"x{i}.jpg")
        for i in range(n)
    ]


def test_apply_cap_below_cap_includes_all_in_order():
    items = _items(ItemType.top, 3)
    assert apply_cap(items, cap=10) == items


def test_apply_cap_below_cap_returns_a_copy_not_the_input_list():
    # The include-all path returns list(items), a copy — `==` alone passes even if the
    # input were aliased. Pin the copy so callers may mutate capped results independently.
    items = _items(ItemType.top, 3)
    result = apply_cap(items, cap=10)
    assert result == items
    assert result is not items


def test_apply_cap_at_cap_includes_all():
    items = _items(ItemType.top, 10)
    assert apply_cap(items, cap=10) == items


def test_apply_cap_at_cap_does_not_call_sample_fn():
    # At/below cap must never invoke the sampler — a raising sample_fn proves the
    # boundary is len <= cap, not len < cap.
    items = _items(ItemType.top, 10)

    def boom(its, cap):
        raise AssertionError("sample_fn must not be called at/below cap")

    assert apply_cap(items, cap=10, sample_fn=boom) == items


def test_apply_cap_over_cap_delegates_to_sample_fn():
    items = _items(ItemType.top, 40)
    take_first = lambda its, cap: its[:cap]
    result = apply_cap(items, cap=35, sample_fn=take_first)
    assert len(result) == 35
    assert result == items[:35]


def test_apply_cap_over_cap_without_sample_fn_raises():
    items = _items(ItemType.top, 40)
    with pytest.raises(ValueError, match="requires a sample_fn"):
        apply_cap(items, cap=35)


def test_apply_cap_rejects_sample_fn_that_under_returns():
    items = _items(ItemType.top, 40)
    short = lambda its, cap: its[: cap - 1]  # one short
    with pytest.raises(ValueError, match="expected exactly cap"):
        apply_cap(items, cap=35, sample_fn=short)


def test_apply_cap_rejects_sample_fn_that_over_returns():
    # Over-return is the dangerous case: it would breach the per-type cap and the
    # MAX_PROMPT_ITEMS ceiling. The len(sampled) != cap guard must catch it too.
    items = _items(ItemType.top, 40)
    over = lambda its, cap: its[: cap + 1]  # one too many
    with pytest.raises(ValueError, match="expected exactly cap"):
        apply_cap(items, cap=35, sample_fn=over)


def test_capped_pool_never_exceeds_max_prompt_items(over_cap_wardrobe):
    # Every type is over cap here, so the summed capped pool hits exactly the
    # per-type cap sum == MAX_PROMPT_ITEMS. Asserted as an invariant, never
    # enforced by truncation (the caps sum to it by construction).
    buckets = partition(over_cap_wardrobe)
    take_first = lambda its, cap: its[:cap]
    total = sum(
        len(apply_cap(items, CAP_BY_TYPE[t], sample_fn=take_first))
        for t, items in buckets.items()
    )
    assert total == MAX_PROMPT_ITEMS
    assert total <= MAX_PROMPT_ITEMS


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
