"""Tests for M1-1 (partition) and M1-2 (per-type caps). v2 §10, Appendix A R4.

The permuted-input determinism test is the one that matters: an in-memory
fixture is already in a stable order, so only shuffling the input can prove
partition pins ordering before any RNG draw (R4).
"""

import random

import pytest

from fitted_core.config import MAX_PROMPT_ITEMS
from fitted_core.models import ItemType, WardrobeItem
from fitted_core.sampler import CAP_BY_TYPE, apply_cap, partition


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
