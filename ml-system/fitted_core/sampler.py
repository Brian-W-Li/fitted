"""The M1 shortlister: pool partition, per-type caps, and the 70/30 signal seam (v2 §10/§11).

partition() groups a wardrobe by ItemType and establishes the canonical input
ordering the whole sampler depends on (id-sorted within each type, enum order
across types — v2 §10 / Appendix A R4). apply_cap() applies v2 §10's per-type
ceilings, including the "scarce category fully represented" rule (include all
when at/below cap). sample_type() (M1-3) is the over-cap 70/30 sampler and the
SignalScorer seam M6 plugs into; it returns the uniform TypeSampleResult (R13).
candidate_requested() (M1-4) scales how many outfit drafts to ask GPT for from the
post-cap pool counts.

The over-cap branch of apply_cap still delegates via an injected callback (the
M1-2 interim seam); M1-5's per-type loop will call sample_type() directly and
retire that callback (R13). sample_type() is built standalone here.

Sources: docs/Fitted_Spec_v2.md §10 / §11 / Appendix A R4/R6/R11/R13,
docs/plans/m0-m1-substrate.md §4 (M1-1..M1-4).
"""

import math
import random
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Mapping, Optional, Protocol, Sequence, runtime_checkable

from fitted_core.config import (
    CAP_BOTTOMS,
    CAP_DRESSES,
    CAP_OUTER,
    CAP_SHOES,
    CAP_TOPS,
    MAX_CANDIDATES,
    MIN_SIGNAL_THRESHOLD,
)
from fitted_core.models import ItemType, WardrobeItem

# Per-type pool ceilings (v2 §10), keyed by ItemType so the cap lookup iterates the
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
    """Group a wardrobe by type, id-sorted within each type (v2 §10 / Appendix A R4).

    Every ItemType is present as a key in enum order — a type the wardrobe lacks
    maps to an empty list (feeds the §10 no-tops/no-dresses edge cases). Sorting
    by id here is load-bearing, not cosmetic: pre-M6 prod always rides the
    seeded-random fallback path, and random.sample is reproducible only over a
    fixed input order, so the v2 §10/§15 determinism contract is established here,
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
    """Apply one type's v2 §10 cap.

    At/below cap: include every item (scarce categories fully represented),
    preserving the incoming order — partition() already established id order
    (R4), so this path does not re-sort. Over cap: delegate to `sample_fn` (the
    M1-3 70/30 sampler), which returns exactly `cap` items. A missing sample_fn
    on an over-cap list is a wiring error that raises, never a silent truncation.

    MAX_PROMPT_ITEMS is NOT enforced here by dropping items: the per-type caps
    sum to it by construction, so the prompt ceiling is a cross-type invariant
    asserted in M1-5, not a per-type item-loss step.

    Interim seam (R13): the `(items, cap) -> list` sample_fn shape does NOT match
    sample_type(...) -> TypeSampleResult. M1-3 built sample_type() standalone rather
    than reworking this function; M1-5's per-type loop will call sample_type()
    directly (over cap) and emit an `include_all` TypeSampleResult (at/below cap),
    retiring this list+callback seam (R13).
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


# ============================================================================
# M1-3 — the 70/30 sampler + the SignalScorer seam (v2 §10/§11, R6/R11/R13)
#
# This is the single most important structural deliverable: the slot M6 plugs the
# trained scorer into. Until then 100% of traffic rides the seeded-random fallback,
# so the v2 §10/§15 determinism promise rides entirely on canonical ordering (R4) +
# one shared seeded RNG.
# ============================================================================


@dataclass(frozen=True)
class RequestContext:
    """The M1-consumed subset of the v2 §6.3 RequestContext.

    The canonical schema lives in v2 §6.3 and is built by the M5 adapter (which owns
    raw→canonical normalization, R5); the sampler receives an already-canonical
    context. The full context also carries intent, constraints, style profile,
    routine, forced item, and base outfit — M1 does not interpret those. New fields
    are **additive only** (v2 §6.3), so M5 can extend this without touching the
    sampler. The seed-relevant subset is session_id / wardrobe_version / occasion /
    weather / date (see seed.py); interaction_count gates the signal branch (R11).
    """

    occasion: str  # normalized verbatim user text (R5)
    weather: str  # canonical bucket (R5)
    session_id: str
    wardrobe_version: int
    date: Optional[str] = None  # N2/C1 daily re-seed; None until M5 activates it
    interaction_count: int = 0  # this user's interaction count; 0 until M4 exists


@runtime_checkable
class SignalScorer(Protocol):
    """The replaceable ML seam (v2 §5/§10/§11).

    is_available() is the model-presence gate (R11): the 30% signal slot runs only
    when a scorer is loaded. score() returns a relevance float (higher = more
    relevant). M1 ships ColdStartSignalScorer (never available); M6 plugs in a
    TrainedSignalScorer (available once loaded) with no other sampler change.
    """

    def is_available(self) -> bool: ...

    def score(self, item: WardrobeItem, context: RequestContext) -> float: ...


class ColdStartSignalScorer:
    """M1's scorer: never available, so the 30% signal slot is unreachable.

    Until M6 plugs in a scorer whose is_available() returns True, every type takes a
    seeded-random fallback path. score() must never be called (the is_available()
    gate forecloses it); calling it is a contract violation, so it raises loudly
    rather than returning a sentinel that could silently bias selection.
    """

    def is_available(self) -> bool:
        return False

    def score(self, item: WardrobeItem, context: RequestContext) -> float:
        raise NotImplementedError(
            "ColdStartSignalScorer.score must never be called — is_available() is False"
        )


class SelectionKind(Enum):
    """How a type's pool was selected (R13). Values are the log labels.

    The enum spans all three outcomes so a per-type log is never ambiguous:
    sample_type() (over-cap) emits `signal` or `random`; the under-cap include-all
    branch emits `include_all`.
    """

    signal = "signal"
    random = "random"
    include_all = "includeAll"


# R11 fallback reasons — behavior-identical, log-distinct. Set only on a `random`
# fallback (None for `signal` and `include_all`). Data arrival changes only the
# label, never the outfits, until M6 ships (R11).
COLD_START_SAMPLING = "coldStartSampling"  # interaction_count < MIN_SIGNAL_THRESHOLD
SIGNAL_UNAVAILABLE = "signalUnavailable"  # count >= threshold but no scorer
SIGNAL_SCORER_FAULT = "signalScorerFault"  # scorer raised / returned non-finite


@dataclass(frozen=True)
class TypeSampleResult:
    """One type's sampling outcome (R13).

    A scalar list cannot carry the per-type selection path / fallback reason that
    R11 requires (type A may sample on signal while type B faults to random), so the
    per-type outcome is uniformly this struct. `items` is the final pool for the
    type, **sorted by id** for a byte-stable GPT prompt. For `include_all` (no
    sampling applied) both counts are 0 and len(items) is the truth; for the
    over-cap paths the counts are the 70/30 slot sizes (signal_count == 0 on a
    fallback) and sum to cap.
    """

    items: list[WardrobeItem]
    selection_kind: SelectionKind
    reason: Optional[str]
    random_count: int
    signal_count: int


def random_count(cap: int) -> int:
    """The 70% random-slot size for a cap (R6 trap-guard) — a sampler-owned helper.

    **Integer half-up, float-free: ``(cap*7 + 5)//10`` — NOT ``round(cap*0.7)``.**
    Python's banker's rounding splits the real caps in opposite directions
    (``round(35*0.7)=round(24.5)=24`` but ``round(25*0.7)=round(17.5)=18``), and any
    TS/numpy reimpl that rounds halves up would silently disagree with prod. This is
    deliberately **not** a config constant — it is structural, not a tunable knob.
    Signal-slot size is the remainder ``cap - random_count(cap)``.
    Real caps: 35→25, 30→21, 25→18, 20→14, 25→18.
    """
    return (cap * 7 + 5) // 10


def _is_finite_score(value: object) -> bool:
    """True only for a finite, non-bool real number (R11/R12).

    A Python bool is an int subclass and ``math.isfinite(True)`` is True (the R12
    ``warmth=True`` precedent), so bool is rejected explicitly. A non-numeric or
    non-finite (NaN/±inf) score is a scorer fault.
    """
    if isinstance(value, bool):
        return False
    if not isinstance(value, (int, float)):
        return False
    return math.isfinite(value)


def _seeded_pick(population: list[WardrobeItem], k: int, rng: random.Random) -> list[WardrobeItem]:
    """Draw k items from an id-sorted population via the shared seeded RNG, id-sorted.

    Determinism needs both the seed *and* a fixed input order (R4): ``rng.sample`` is
    reproducible only over a fixed population order, which partition() established.
    The drawn subset is re-sorted by id so the emitted prompt order is byte-stable.
    """
    chosen = rng.sample(population, k)
    chosen.sort(key=lambda it: it.id)
    return chosen


def sample_type(
    items: list[WardrobeItem],
    cap: int,
    *,
    rng: random.Random,
    scorer: SignalScorer,
    context: RequestContext,
    scorer_available: bool,
) -> TypeSampleResult:
    """Sample one **over-cap** type down to exactly ``cap`` items (v2 §10, R6/R11/R13).

    Preconditions: ``len(items) > cap`` and ``items`` is id-sorted (partition's R4
    contract). ``scorer_available`` is ``scorer.is_available()`` **evaluated once per
    request** by the entry point (M1-5) and passed down — model-presence is identical
    across types, so per-type evaluation would be redundant.

    Signal-branch gate (R11): the 30% signal slot runs only when
    ``interaction_count >= MIN_SIGNAL_THRESHOLD`` **AND** ``scorer_available``.
    Otherwise the whole type falls back to **100% seeded-random over the id-sorted
    list** with one of three behavior-identical, log-distinct reasons. When the gate
    opens, the signal slot is the deterministic top-``signal_count`` by
    ``(score desc, id asc)`` (consumes no RNG); the random slot then draws
    ``random_count`` from the **remaining** items via the shared seeded RNG. A scorer
    that raises or returns a non-finite/bool score faults the whole signal slot to
    random (fail-loud, never silent item-dropping bias).
    """
    rc = random_count(cap)  # 70% random slot
    sc = cap - rc  # 30% signal slot

    # --- Gate: cold-start / unavailable → 100% seeded random ---
    if context.interaction_count < MIN_SIGNAL_THRESHOLD:
        return _random_fallback(items, cap, rng, COLD_START_SAMPLING)
    if not scorer_available:
        return _random_fallback(items, cap, rng, SIGNAL_UNAVAILABLE)

    # --- Signal branch: score every item; any fault → 100% seeded random ---
    try:
        scored = [(scorer.score(item, context), item) for item in items]
    except Exception:
        return _random_fallback(items, cap, rng, SIGNAL_SCORER_FAULT)
    if not all(_is_finite_score(s) for s, _ in scored):
        return _random_fallback(items, cap, rng, SIGNAL_SCORER_FAULT)

    # Signal-first: deterministic top-sc by (score desc, id asc) — no RNG consumed.
    scored.sort(key=lambda pair: (-pair[0], pair[1].id))
    signal_items = [item for _, item in scored[:sc]]
    signal_ids = {item.id for item in signal_items}

    # Random slot: draw rc from the remaining id-sorted items (disjoint by construction).
    remaining = [item for item in items if item.id not in signal_ids]
    random_items = _seeded_pick(remaining, rc, rng)

    combined = signal_items + random_items
    combined.sort(key=lambda it: it.id)  # byte-stable emit order
    return TypeSampleResult(combined, SelectionKind.signal, None, random_count=rc, signal_count=sc)


def _random_fallback(
    items: list[WardrobeItem], cap: int, rng: random.Random, reason: str
) -> TypeSampleResult:
    """100% seeded-random selection of ``cap`` items — the shared fallback path (R11).

    All three fallback reasons route through here so they are **behavior-identical**:
    same seed + same id-sorted input → same sampled set, differing only in the logged
    ``reason``. signal_count is 0 by definition on a fallback.
    """
    sampled = _seeded_pick(items, cap, rng)
    return TypeSampleResult(sampled, SelectionKind.random, reason, random_count=cap, signal_count=0)


# ============================================================================
# M1-4 — candidate-request scaling (v2 §10)
# ============================================================================


def candidate_requested(pool: Mapping[ItemType, Sequence[WardrobeItem]]) -> int:
    """How many outfit drafts to request from GPT, from POST-CAP pool counts (v2 §10).

    ``pool`` maps each ItemType to its already-sampled items (the per-type pool M1-5
    assembles from M1-1..M1-3). Only base roles size the request — outer and shoes are
    optional roles layered onto a base, never a base, so they never contribute:

        two_piece_base = n_tops * n_bottoms     # every top can pair with every bottom
        one_piece_base = n_dresses
        total_base     = two_piece_base + one_piece_base

    Scaling: ``total_base <= 5`` → ``total_base * 3`` (no floor — a tiny closet asks
    proportionally fewer); otherwise ``min(MAX_CANDIDATES, total_base * 3)``.

    ``total_base == 0`` (no top+bottom pairing AND no dress — e.g. tops-but-no-bottoms,
    or an empty pool) returns ``0``. That 0 is the signal the M1-5 entry point uses to
    short-circuit to ``notEnoughItems`` **before any GPT call**, never asking GPT for
    zero candidates and running the pipeline on nothing (v2 §10 / §12 edge cases).
    """
    n_tops = len(pool.get(ItemType.top, ()))
    n_bottoms = len(pool.get(ItemType.bottom, ()))
    n_dresses = len(pool.get(ItemType.dress, ()))
    total_base = n_tops * n_bottoms + n_dresses
    if total_base == 0:
        return 0  # notEnoughItems signal — M1-5 returns before any GPT call
    if total_base <= 5:
        return total_base * 3
    return min(MAX_CANDIDATES, total_base * 3)
