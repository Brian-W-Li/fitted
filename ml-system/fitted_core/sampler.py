"""Pool partition + per-type caps — the first half of the M1 shortlister (spec §7.1–7.2).

partition() groups a wardrobe by ItemType and establishes the canonical input
ordering the whole sampler depends on (id-sorted within each type, enum order
across types — spec-resolutions R4). apply_cap() applies §7.2's per-type
ceilings, including the "scarce category fully represented" rule (include all
when at/below cap).

The over-cap branch delegates to the 70/30 signal sampler (M1-3, not yet built)
via an injected callback, so this module stays decoupled from the signal seam
and its TypeSampleResult struct.

Sources: docs/Fitted_Refactor_v1.2_Spec.pdf §7.1/§7.2,
docs/plans/m0-m1-substrate.md §4 (M1-1/M1-2), docs/plans/spec-resolutions.md R4.
"""

from typing import Callable, Optional

from fitted_core.config import (
    CAP_BOTTOMS,
    CAP_DRESSES,
    CAP_OUTER,
    CAP_SHOES,
    CAP_TOPS,
)
from fitted_core.models import ItemType, WardrobeItem

# Per-type pool ceilings (§7.2), keyed by ItemType so the cap lookup iterates the
# same fixed enum order as partition (R4). These sum to MAX_PROMPT_ITEMS — the
# regression guard for that sum lives in test_config.py.
CAP_BY_TYPE: dict[ItemType, int] = {
    ItemType.top: CAP_TOPS,
    ItemType.bottom: CAP_BOTTOMS,
    ItemType.dress: CAP_DRESSES,
    ItemType.outer_layer: CAP_OUTER,
    ItemType.shoes: CAP_SHOES,
}

# The over-cap sampler seam: (items, cap) -> exactly `cap` items. M1-3 supplies
# the real 70/30 signal/random implementation; apply_cap only needs the shape.
SampleFn = Callable[[list[WardrobeItem], int], list[WardrobeItem]]


def partition(wardrobe: list[WardrobeItem]) -> dict[ItemType, list[WardrobeItem]]:
    """Group a wardrobe by type, id-sorted within each type (spec §7.1, R4).

    Every ItemType is present as a key in enum order — a type the wardrobe lacks
    maps to an empty list (feeds the §19 no-tops/no-dresses edge cases). Sorting
    by id here is load-bearing, not cosmetic: pre-M6 prod always rides the
    seeded-random fallback path, and random.sample is reproducible only over a
    fixed input order, so the §3.1 determinism contract is established here,
    before any RNG draw touches the data (R4).

    Coupling note: this permutation-invariance holds only because M1-5 rejects a
    wardrobe with duplicate logical ids before partition (R12). Under duplicate
    ids the id-sort is stable, so tied items keep input order — partition alone is
    not permutation-invariant. The R12 reject upstream is load-bearing for R4 here.
    """
    buckets: dict[ItemType, list[WardrobeItem]] = {t: [] for t in ItemType}
    for item in wardrobe:
        buckets[item.type].append(item)
    for items in buckets.values():
        items.sort(key=lambda it: it.id)
    return buckets


def apply_cap(
    items: list[WardrobeItem],
    cap: int,
    sample_fn: Optional[SampleFn] = None,
) -> list[WardrobeItem]:
    """Apply one type's §7.2 cap.

    At/below cap: include every item (scarce categories fully represented),
    preserving the incoming order — partition() already established id order
    (R4), so this path does not re-sort. Over cap: delegate to `sample_fn` (the
    M1-3 70/30 sampler), which returns exactly `cap` items. A missing sample_fn
    on an over-cap list is a wiring error that raises, never a silent truncation.

    MAX_PROMPT_ITEMS is NOT enforced here by dropping items: the per-type caps
    sum to it by construction, so the prompt ceiling is a cross-type invariant
    asserted in M1-5, not a per-type item-loss step.

    Interim seam (R13): the `(items, cap) -> list` sample_fn shape does NOT match
    M1-3's sample_type(items, cap, rng, scorer, context) -> TypeSampleResult. Per
    R13 the per-type outcome is uniformly a TypeSampleResult (include-all is a
    first-class selection path), so at M1-3 this function is reworked to return one
    (or is absorbed into the M1-5 per-type loop) and this list+callback seam goes away.
    """
    if len(items) <= cap:
        return list(items)
    if sample_fn is None:
        raise ValueError(
            f"over-cap type ({len(items)} > cap {cap}) requires a sample_fn (M1-3 sampler)"
        )
    sampled = sample_fn(items, cap)
    if len(sampled) != cap:
        raise ValueError(
            f"sample_fn returned {len(sampled)} items, expected exactly cap={cap}"
        )
    return sampled
