"""M3 ranker — pipeline Steps 4–6 over M2-validated candidates (v2 §14/§9).

Turns M2's ``list[ValidatedCandidate]`` into the final ranked ``outfits`` (≤ K):
per-request hard filters (cooldown / contextual dislike / lock), the humble additive
score, diversity (variant cap → overuse → repetition), the fallback ladder, and a
deterministic tie-break — emitting a per-outfit signed ``ScoreBreakdown`` plus the
state flags M5 needs. Pure substrate: **no DB, no GPT, no IO, no candidate creation.**
M3 only drops and reorders.

**Milestone scope (M3 C1–C4).** C1 landed the public surface (``rank`` signature,
``FallbackStage``, ``ScoreBreakdown``, ``RankedOutfit``, ``RankerResult``, ``RankerContext``),
the output-immutability snapshot helpers, the ``RankerContext`` construction guards
(``generation_index`` real-int, ``k``), the reducer-contract guards (window lengths N14 +
affinity sign N10), and the literal empty/degenerate short-circuit (N15). **C2 adds the
Step-4 per-request hard filters** (cooldown / contextual-dislike / lock) and the
lock-starvation diagnostic as the internal ``_apply_step4_filters`` helper. **C3 adds the
Step-5 additive scoring helper** (``_score_candidate``: signed ``base`` / ``combo`` / ``item`` /
``dislike`` / ``cooldown`` deltas summing to ``score``, N4/N10/N13). **C4 adds the Step-6 diversity
helpers** — BaseKey ``_apply_variant_cap`` (top-2 by pre-penalty score, N5), ``_compute_overuse_set``
(once over post-cap survivors, gate/threshold strict, N1/N2/Q1), and ``_rescore_with_diversity``
(signed overuse + flat repetition deltas, Q1/Q2), composed by ``_apply_step6_diversity``. **The
fallback ladder and tie-break (C5) remain unimplemented**, so ``rank()`` does not yet assemble a
result — a *non-empty* candidate list still raises ``NotImplementedError`` rather than emit a
partial ranking.

Error-model convention (package ``__init__.py``): expected, data-driven failures return
a value (the empty/degenerate result is *not* an error); caller-contract violations raise.
So an oversize window, a negative affinity, a mistyped ``k``/``generation_index`` raise;
an empty candidate list returns an insufficient ``RankerResult`` (M2 "empty is valid").

Sources: docs/Fitted_Spec_v2.md §7/§9/§11/§14/§15, docs/plans/m3-ranker.md.
"""

import math
from dataclasses import dataclass, field
from enum import Enum
from types import MappingProxyType
from typing import Mapping, Optional, Sequence

from fitted_core.config import (
    BASE_SCORE,
    BASEKEY_VARIANT_CAP,
    COMBO_BOOST,
    COOLDOWN_BUFFER_SIZE,
    COOLDOWN_PENALTY,
    DEFAULT_K,
    DISLIKE_PENALTY,
    DISLIKE_WINDOW_SIZE,
    ITEM_BOOST_WEIGHT,
    MAX_AFFINITY,
    OVERUSE_MIN_POOL,
    OVERUSE_PENALTY,
    OVERUSE_THRESHOLD,
    REPETITION_PENALTY,
    REPETITION_WINDOW_SIZE,
)
from fitted_core.models import SlotMap, StyleMove, Template
from fitted_core.validator import ValidatedCandidate


# ============================ result / context model ============================


class FallbackStage(Enum):
    """The deepest constraint-relaxation rung the fallback ladder reached (N11, §14).

    Member *names* are snake_case; *values* are camelCase wire labels (same convention
    as ``models.IssueCode`` / ``sampler.SelectionKind``) so the M5 response layer maps
    them with no translation table. ``none`` = served at full constraint; ``insufficient``
    = the ladder was exhausted and fewer than ``k`` outfits remain.
    """

    none = "none"
    overuse_relaxed = "overuseRelaxed"
    variant_cap_relaxed = "variantCapRelaxed"
    cooldown_relaxed = "cooldownRelaxed"
    insufficient = "insufficient"


@dataclass(frozen=True)
class FrozenStyleMove:
    """Immutable snapshot of a ``StyleMove`` for ranked output (§4 output immutability).

    ``models.StyleMove.changed_item_ids`` is a *mutable* ``list``; a ``RankedOutfit`` must
    not alias it, or a caller mutating the input after ``rank()`` returns could silently
    rewrite a result. This carries a ``tuple`` copy instead. Field names mirror
    ``StyleMove``; M3 never re-validates the move (M2 already boundary-checked it, H23).
    """

    move_type: str
    changed_item_ids: tuple[str, ...]
    one_sentence: str


@dataclass(frozen=True)
class ScoreBreakdown:
    """Signed per-term deltas that sum exactly to ``RankedOutfit.score`` (N4, §5/§7).

    The debuggability contract (§5): one delta per scoring term, and
    ``score == base + combo + item + dislike + overuse + repetition + cooldown``.
    Sign storage (S4): ``COOLDOWN_PENALTY`` is stored negative and *added*, so ``cooldown``
    is already negative (or 0); ``DISLIKE_PENALTY`` / ``OVERUSE_PENALTY`` /
    ``REPETITION_PENALTY`` are positive magnitudes that the formula subtracts, so
    ``dislike`` / ``overuse`` / ``repetition`` are stored here as **negative** deltas.
    (Populated from C3 on; C1 only pins the shape.)
    """

    base: float
    combo: float
    item: float
    dislike: float
    overuse: float
    repetition: float
    cooldown: float


@dataclass(frozen=True)
class RankedOutfit:
    """One ranked outfit in the final output (≤ ``k`` of these per ``RankerResult``).

    ``source_index`` is carried from the ``ValidatedCandidate`` (its position in the
    original ``outfits`` array) and is **never** a tie-break key (N6). Output immutability
    (§4): ``style_move`` is a ``FrozenStyleMove`` (not a live ``StyleMove``), and the
    assembling checkpoint (C5) passes a defensive copy of ``slot_map`` — so mutating any
    input after ``rank()`` returns cannot change a result. ``score`` equals the sum of the
    ``breakdown`` deltas (N4). (Assembled from C5 on; C1 only pins the shape.)
    """

    source_index: int
    slot_map: SlotMap
    template: Template
    base_key: str
    full_signature: str
    style_move: Optional[FrozenStyleMove]
    score: float
    breakdown: ScoreBreakdown
    relaxed_cooldown: bool


@dataclass(frozen=True)
class RankerResult:
    """``rank()`` output — ≤ ``k`` ranked outfits plus the state flags M5 needs (N11/N3).

    ``outfits`` is a ``tuple`` in final ranked order. ``fallback_stage`` is the deepest
    relaxation rung reached; ``insufficient_wardrobe`` is set when the final count is below
    ``k`` (including 0). ``relaxed_cooldown_count`` is the number of *emitted* outfits with
    ``relaxed_cooldown=True`` (post-truncation, N11). ``locked_survivor_count`` /
    ``insufficient_locked_candidates`` are the lock-starvation diagnostic (N3): M3 reports,
    M5 owns the constrained re-entry.
    """

    outfits: tuple[RankedOutfit, ...]
    fallback_stage: FallbackStage
    insufficient_wardrobe: bool
    relaxed_cooldown_count: int
    locked_survivor_count: int
    insufficient_locked_candidates: bool


@dataclass(frozen=True, kw_only=True)
class RankerContext:
    """Per-request seed inputs + pre-reduced behavioral signals for ``rank()`` (§4, Q4/H19).

    **Keyword-only (N7).** ``generation_index`` is required but carries no default and must
    sit after the defaulted seed fields, which only ``kw_only=True`` allows; it also guards
    the same adjacent-same-typed-field hazard ``seed.py`` guards (``occasion``/``weather``
    are both ``str``) — a positional swap would compute a wrong-but-valid seed silently.

    **Signals are pre-reduced (Q4/H19), never raw ``OutfitInteraction`` rows, and already
    windowed (N14).** The M4/M5 reducer owns storage and windowing; M3 does membership /
    flat math over these collections and *guards* their length, never truncating.

    Construction guards (``__post_init__``): ``generation_index`` must be a real, non-``bool``
    ``int`` (the sole re-roll lever feeding ``tiebreak_seed`` — a silently-wrong value
    corrupts the §15 determinism promise, H7); ``k`` must be a non-``bool`` ``int`` > 0.
    The collection inputs are normalized to immutable forms here; their *length*/​*sign*
    are guarded at ``rank()`` entry (§6 step 1), not here.
    """

    # seed inputs (for tiebreak_seed — §15)
    session_id: str
    wardrobe_version: int
    occasion: str
    weather: str
    date: Optional[str] = None
    generation_index: int  # REQUIRED, no default (N7/H7) — a real int; guarded below
    k: int = DEFAULT_K  # N16; M5 may override
    # pre-reduced signals (Q4/H19 — never raw OutfitInteraction; already windowed, N14)
    item_affinity: Mapping[str, int | float] = field(default_factory=dict)  # itemId → affinityScore
    liked_full_signatures: frozenset[str] = frozenset()  # comboBoost set
    shown_full_signatures: Sequence[str] = ()  # repetition window (≤ REPETITION_WINDOW_SIZE)
    recent_disliked_base_keys: Sequence[str] = ()  # cooldown buffer (≤ COOLDOWN_BUFFER_SIZE)
    recent_disliked_item_ids: Sequence[str] = ()  # soft-penalty window (≤ DISLIKE_WINDOW_SIZE)
    contextual_disliked_item_ids: frozenset[str] = frozenset()  # regen hard filter
    locked_item_ids: frozenset[str] = frozenset()  # regen lock filter

    def __post_init__(self) -> None:
        self._validate_generation_index()
        self._validate_k()
        self._normalize_collections()

    def _validate_generation_index(self) -> None:
        """Require a real, non-``bool`` ``int`` (N7/H7).

        The field has no default, so a *missing* ``generation_index`` is already a
        ``TypeError`` from the dataclass. But a bare annotation does not reject ``None`` or
        a ``bool`` (``isinstance(True, int)`` is ``True``), and this is the only re-roll
        input feeding ``tiebreak_seed`` — so reject ``None`` and ``bool`` explicitly,
        *before* the ``int`` check, mirroring ``validator._resolve_candidate_requested``.
        Range/lifecycle (lower bound, increment, reset) is M5's (H7); M3 only insists on a
        real int.
        """
        gi = self.generation_index
        if gi is None:
            raise TypeError("generation_index must be a non-bool int, got None")
        if isinstance(gi, bool):
            raise TypeError("generation_index must be a non-bool int, got bool")
        if not isinstance(gi, int):
            raise TypeError(
                f"generation_index must be a non-bool int, got {type(gi).__name__}"
            )

    def _validate_k(self) -> None:
        """Require a non-``bool`` ``int`` > 0 (N16).

        ``k`` defaults to ``DEFAULT_K`` but is caller-supplied, so guard it the same way
        (``bool`` rejected before ``int``, since ``isinstance(True, int)`` is ``True``):
        wrong *type* → ``TypeError``; ``k <= 0`` → ``ValueError`` (a non-positive request is
        caller misuse — there is no outfit budget to fill).
        """
        k = self.k
        if isinstance(k, bool):
            raise TypeError("k must be a non-bool int, got bool")
        if not isinstance(k, int):
            raise TypeError(f"k must be a non-bool int, got {type(k).__name__}")
        if k <= 0:
            raise ValueError(f"k must be a positive int, got {k}")

    def _normalize_collections(self) -> None:
        """Freeze the signal collections so a caller's later mutation can't reach in (§4).

        Frozen dataclass, so normalize via ``object.__setattr__``. Ordered windows →
        ``tuple`` (order preserved — recency-faithful membership); unordered id sets →
        ``frozenset``; ``item_affinity`` → a ``MappingProxyType`` over a private copy
        (read-only view, independent of the caller's dict).
        """
        object.__setattr__(self, "shown_full_signatures", tuple(self.shown_full_signatures))
        object.__setattr__(self, "recent_disliked_base_keys", tuple(self.recent_disliked_base_keys))
        object.__setattr__(self, "recent_disliked_item_ids", tuple(self.recent_disliked_item_ids))
        object.__setattr__(self, "liked_full_signatures", frozenset(self.liked_full_signatures))
        object.__setattr__(
            self, "contextual_disliked_item_ids", frozenset(self.contextual_disliked_item_ids)
        )
        object.__setattr__(self, "locked_item_ids", frozenset(self.locked_item_ids))
        object.__setattr__(self, "item_affinity", MappingProxyType(dict(self.item_affinity)))


# ===================== snapshot helpers (output immutability — §4) =====================


def _freeze_style_move(style_move: Optional[StyleMove]) -> Optional[FrozenStyleMove]:
    """Defensively snapshot a ``StyleMove`` for ranked output (§4 / §12 mutation-hardening).

    ``StyleMove.changed_item_ids`` is a mutable ``list``; copy it to a ``tuple`` so a caller
    mutating the input ``StyleMove`` after ``rank()`` returns cannot rewrite the output.
    ``None`` passes through (the common case — most candidates carry no move).
    """
    if style_move is None:
        return None
    return FrozenStyleMove(
        move_type=style_move.move_type,
        changed_item_ids=tuple(style_move.changed_item_ids),
        one_sentence=style_move.one_sentence,
    )


def _filled_slot_ids(slot_map: SlotMap) -> tuple[str, ...]:
    """The non-``None`` item ids of a ``SlotMap``, in canonical slot order (§4).

    The tuple-backed snapshot scoring runs membership / intersection math over (C3) —
    never a live ``SlotMap`` reference, so a later input mutation cannot rewrite a result.
    Canonical order ``dress → top → bottom → outer → shoes`` mirrors ``keys.py`` /
    ``slotmap.py``.
    """
    return tuple(
        item_id
        for item_id in (
            slot_map.dress,
            slot_map.top,
            slot_map.bottom,
            slot_map.outer,
            slot_map.shoes,
        )
        if item_id is not None
    )


# ================= Step 4 — per-request hard filters (§6 step 3, N3/N8) =================


@dataclass(frozen=True)
class _Step4Result:
    """The Step-4 hard-filter outcome (C2 — internal plumbing toward C3/C5).

    Three independent per-candidate predicates partition the input (§6 step 3): ``survivors``
    pass lock **and** contextual-dislike **and** cooldown; ``cooldown_reserve`` are candidates
    dropped **solely** by cooldown (still passing lock + contextual) — the re-admission pool
    the C5 ``cooldown_relaxed`` rung draws from (N3). A candidate failing a lock or contextual
    dislike is a **non-relaxable** drop and appears in *neither* tuple (those filters never
    relax — N3). ``locked_survivor_count`` / ``insufficient_locked_candidates`` are the
    lock-starvation diagnostic, measured **after the lock filter alone** — before contextual /
    cooldown removal — so a candidate that clears the lock but is later contextual/cooldown
    dropped still counts (M3 reports; M5 owns the constrained re-entry).
    """

    survivors: tuple[ValidatedCandidate, ...]
    cooldown_reserve: tuple[ValidatedCandidate, ...]
    locked_survivor_count: int
    insufficient_locked_candidates: bool


def _apply_step4_filters(
    candidates: Sequence[ValidatedCandidate], context: RankerContext
) -> _Step4Result:
    """Apply the Step-4 per-request hard filters (§6 step 3, N3/N8).

    Classify each candidate by **three independent predicates** (evaluation order is
    irrelevant — the classification is set-based):

    - **lock** — its filled-slot ids ⊇ ``locked_item_ids`` (trivially true with no locks);
    - **contextual** — its filled-slot ids are disjoint from ``contextual_disliked_item_ids``
      (the *hard* dislike filter — distinct from the soft ``recent_disliked_item_ids`` of C3);
    - **cooldown** — its ``base_key`` is not in ``recent_disliked_base_keys`` (BaseKey, §7 —
      filters a disliked silhouette across *all* its outer/shoe variants).

    Filled-slot ids span every filled slot, **including optional outer/shoes**
    (``_filled_slot_ids``). A candidate passing lock + contextual is a **survivor** when it
    also passes cooldown, else it is held in the cooldown-relax **reserve** (dropped *solely*
    by cooldown — re-admittable at the C5 ``cooldown_relaxed`` rung). A candidate failing lock
    or contextual is a non-relaxable drop, reserved nowhere. ``locked_survivor_count`` counts
    candidates passing the lock filter **alone** (before contextual/cooldown); locks never
    silently drop — M3 only reports, M5 owns the constrained re-entry (N3).

    **No scoring, sorting, variant cap, penalty, or fallback here** — that is C3–C5. C2 never
    re-admits the reserve; it only preserves it so C5 can relax without reworking C2.
    """
    locked = context.locked_item_ids
    contextual = context.contextual_disliked_item_ids
    cooldown_keys = set(context.recent_disliked_base_keys)  # membership only; order irrelevant

    survivors: list[ValidatedCandidate] = []
    cooldown_reserve: list[ValidatedCandidate] = []
    locked_survivor_count = 0
    for candidate in candidates:
        filled = set(_filled_slot_ids(candidate.slot_map))
        passes_lock = locked <= filled  # frozenset ⊆ set; empty locked ⊆ anything (no-op filter)
        passes_contextual = filled.isdisjoint(contextual)
        passes_cooldown = candidate.base_key not in cooldown_keys

        if passes_lock:
            locked_survivor_count += 1
        if passes_lock and passes_contextual:
            # Solely-cooldown drops are relaxable (reserve); everything else here is a survivor.
            (survivors if passes_cooldown else cooldown_reserve).append(candidate)
        # Failing lock or contextual → non-relaxable drop: reserved nowhere (N3).

    insufficient_locked = bool(locked) and locked_survivor_count < context.k
    return _Step4Result(
        survivors=tuple(survivors),
        cooldown_reserve=tuple(cooldown_reserve),
        locked_survivor_count=locked_survivor_count,
        insufficient_locked_candidates=insufficient_locked,
    )


# ===================== Step 5 — additive scoring (§6 step 4, N4/N10/N13) =====================


@dataclass(frozen=True)
class _ScoredCandidate:
    """A candidate paired with its Step-5 additive score + signed ``ScoreBreakdown`` (C3 plumbing).

    Internal only — C4 will sort these by ``score`` for the BaseKey variant cap, C5 will
    assemble them into ``RankedOutfit``s. C3 produces them but never orders, caps, or assembles
    (that is C4–C5). ``score`` is the exact sum of ``breakdown``'s signed deltas in canonical
    field order (N4); the Step-6 diversity terms (``overuse`` / ``repetition``) are always 0
    here, and ``cooldown`` is 0 unless a cooldown-relaxed re-admit is being scored (C5 sets
    ``relaxed_cooldown=True``).
    """

    candidate: ValidatedCandidate
    score: float
    breakdown: ScoreBreakdown


def _breakdown_total(breakdown: ScoreBreakdown) -> float:
    """Sum the signed ``ScoreBreakdown`` deltas in canonical field order (N4, §7).

    Order ``base → combo → item → dislike → overuse → repetition → cooldown`` is fixed so the
    total is reproducible bit-for-bit (float addition is not associative). ``_score_candidate``
    and the ``score == Σ deltas`` property test both sum in this exact order, so they agree to
    the last ULP.
    """
    return (
        breakdown.base
        + breakdown.combo
        + breakdown.item
        + breakdown.dislike
        + breakdown.overuse
        + breakdown.repetition
        + breakdown.cooldown
    )


def _score_candidate(
    candidate: ValidatedCandidate,
    context: RankerContext,
    *,
    relaxed_cooldown: bool = False,
) -> _ScoredCandidate:
    """Compute the Step-5 additive score + signed ``ScoreBreakdown`` for one candidate (§6 step 4).

    The humble additive layer (R2, §11/§14):
    ``score = BASE_SCORE + comboBoost + itemBoost − dislikePenalty (+ cooldown)``, every term a
    signed delta in the ``ScoreBreakdown`` so ``score == Σ deltas`` (N4). Per term:

    - **base** — ``BASE_SCORE`` (+1.0), the floor every candidate starts at.
    - **combo** — ``COMBO_BOOST`` (+2.0) iff the FullSignature was re-liked (the full-outfit
      edge, §11), else 0. Keyed on FullSignature (§7), never BaseKey.
    - **item** — ``ITEM_BOOST_WEIGHT × Σ_slots min(affinity, MAX_AFFINITY)`` over **every filled
      slot** including optional outer/shoes (N13); an absent item contributes 0; the affinity is
      clamped to ``MAX_AFFINITY`` **inside M3** (N10 — never trust an over-cap input). The
      ``rank()``-entry guard already proved affinities non-negative, so ``item ≥ 0``.
    - **dislike** — ``−DISLIKE_PENALTY × |{filled ids} ∩ set(recent_disliked_item_ids)|``: a flat
      −0.5 per *distinct* disliked item in the outfit. ``set(window)`` dedups window multiplicity
      (a single item shown many times counts once — "flat, not accumulated", §14); the count of
      *distinct disliked items in the outfit* is what scales it (§7 "bounded by item count").
      Stored as a negative delta.
    - **overuse / repetition** — always 0 here. They are Step-6 diversity terms (C4) computed
      over the post-variant-cap survivor pool, not over one isolated candidate.
    - **cooldown** — ``COOLDOWN_PENALTY`` (already −2.0, the signed delta — *not* negated, S4/N4)
      iff ``relaxed_cooldown`` (a C5 cooldown-relaxed re-admit); else 0. Normal C3 scoring is 0.

    Pure: no sorting, capping, overuse/repetition, fallback, or tie-break (those are C4–C5).
    Negative scores are valid — ranking is relative (§14).
    """
    filled = _filled_slot_ids(candidate.slot_map)

    base = BASE_SCORE
    combo = COMBO_BOOST if candidate.full_signature in context.liked_full_signatures else 0.0
    # itemBoost: per filled slot, clamp the affinity to MAX_AFFINITY (upper clamp inside M3, N10);
    # an item with no affinity entry contributes 0. Ranges over all filled slots incl. outer/shoes (N13).
    item = ITEM_BOOST_WEIGHT * sum(
        min(context.item_affinity.get(item_id, 0), MAX_AFFINITY) for item_id in filled
    )
    # dislikePenalty: flat −0.5 per *distinct* disliked item in the outfit. set() on the window
    # dedups multiplicity; the intersection size is the distinct disliked-item count (§14/§7).
    disliked_in_outfit = set(filled) & set(context.recent_disliked_item_ids)
    dislike = -DISLIKE_PENALTY * len(disliked_in_outfit)
    overuse = 0.0  # Step-6 diversity term (C4) — never scored per isolated candidate.
    repetition = 0.0  # Step-6 diversity term (C4).
    cooldown = COOLDOWN_PENALTY if relaxed_cooldown else 0.0  # already negative (S4); never negated.

    breakdown = ScoreBreakdown(
        base=base,
        combo=combo,
        item=item,
        dislike=dislike,
        overuse=overuse,
        repetition=repetition,
        cooldown=cooldown,
    )
    return _ScoredCandidate(
        candidate=candidate,
        score=_breakdown_total(breakdown),
        breakdown=breakdown,
    )


# ===================== Step 6 — diversity (§6 step 5, N1/N2/N5/Q1/Q2) =====================


def _apply_variant_cap(
    scored: Sequence[_ScoredCandidate],
) -> tuple[_ScoredCandidate, ...]:
    """Keep the top ``BASEKEY_VARIANT_CAP`` candidates per ``base_key`` (N5, §14).

    The first diversity gate: at most ``BASEKEY_VARIANT_CAP`` (2) variants of any one BaseKey
    survive, so a single silhouette cannot crowd the output across its outer/shoe variants.
    "Top" is by **Step-5 pre-penalty score** — the C3 ``_ScoredCandidate.score``, *before* the
    Step-6 overuse/repetition penalties are applied — keeping the *highest*-scoring, not the
    lowest (N5). The cap runs before those penalties, so ``sc.score`` here is exactly the Step-5
    score.

    Determinism without ``source_index`` (N6): within a BaseKey group the survivors are the first
    ``BASEKEY_VARIANT_CAP`` under the canonical order ``(-score, full_signature)`` — score
    descending, ``full_signature`` ascending as the tie-break. ``full_signature`` is unique per
    pass (M2 dedup), so the order is total and the surviving *set* is permutation-invariant. This
    is **not** the C5 seeded tie-break (that resolves the final emission order among true score
    ties); it is only the local rule for which 2 variants of a BaseKey advance.

    Distinct FullSignatures of one BaseKey both survive up to the cap. Variant-cap-dropped
    candidates are simply absent from the result — C5 owns any ``variant_cap_relaxed`` re-admission.
    No overuse/repetition penalty, no global sort, no truncation to ``k`` here.
    """
    by_base_key: dict[str, list[_ScoredCandidate]] = {}
    for sc in scored:
        by_base_key.setdefault(sc.candidate.base_key, []).append(sc)

    survivors: list[_ScoredCandidate] = []
    for group in by_base_key.values():
        # Canonical: highest pre-penalty score first, full_signature ascending as the tie-break
        # (never source_index — N6). full_signature is unique, so this order is total.
        group.sort(key=lambda sc: (-sc.score, sc.candidate.full_signature))
        survivors.extend(group[:BASEKEY_VARIANT_CAP])
    return tuple(survivors)


def _compute_overuse_set(
    survivors: Sequence[_ScoredCandidate],
) -> frozenset[str]:
    """Item ids appearing in **more than** ``OVERUSE_THRESHOLD`` of ``survivors`` (N1/N2/Q1, §14).

    Computed **once** over the **post-variant-cap survivor pool** (N1 — the pool is candidate
    survivors, never a wardrobe input). Gated (B1): only when the survivor count is **strictly
    greater than** ``OVERUSE_MIN_POOL`` (15) — a pool of exactly 15 yields the empty set, so small
    pools are never punished. An item is overused only when its survivor-frequency is **strictly
    greater than** ``OVERUSE_THRESHOLD`` (0.40); an item in *exactly* 40% of survivors is **not**
    overused. Frequency counts each survivor once per item it fills, over every filled slot
    (incl. optional outer/shoes, ``_filled_slot_ids``).

    Returns a single immutable set the caller applies uniformly. M3 never recomputes it: the C5
    ``overuse_relaxed`` rung *drops* the penalty, it never re-derives the set (N2).
    """
    pool_size = len(survivors)
    if pool_size <= OVERUSE_MIN_POOL:  # strict gate: fire only when pool > OVERUSE_MIN_POOL (B1)
        return frozenset()

    counts: dict[str, int] = {}
    for sc in survivors:
        for item_id in _filled_slot_ids(sc.candidate.slot_map):
            counts[item_id] = counts.get(item_id, 0) + 1
    return frozenset(
        item_id
        for item_id, count in counts.items()
        # strict: an item in exactly OVERUSE_THRESHOLD of survivors is not overused.
        if count / pool_size > OVERUSE_THRESHOLD
    )


def _rescore_with_diversity(
    scored: _ScoredCandidate,
    overuse_set: frozenset[str],
    context: RankerContext,
) -> _ScoredCandidate:
    """Apply the Step-6 overuse + repetition penalties to one C3-scored candidate (Q1/Q2, §6 step 5).

    Adds the two Step-6 diversity deltas onto the candidate's existing C3 breakdown, leaving every
    other term (``base`` / ``combo`` / ``item`` / ``dislike`` / ``cooldown``) untouched — ``cooldown``
    keeps whatever C3 stored (0 for a normal candidate; only a C5 cooldown-relaxed re-admit carries
    ``COOLDOWN_PENALTY``). Both new deltas are stored **negative** (the constants are positive
    magnitudes, S4):

    - **overuse** — ``−OVERUSE_PENALTY × |{filled ids} ∩ overuse_set|``: a flat −0.5 per *overused*
      item the candidate fills, over every filled slot incl. optional outer/shoes (N13).
    - **repetition** — ``−REPETITION_PENALTY`` iff the candidate's ``full_signature`` is in
      ``shown_full_signatures``, else 0. **Flat, once per candidate, recency-invariant** (Q2): a
      FullSignature shown many times still costs −1.0 once, never per appearance.

    ``score`` is rebuilt as the sum of the signed deltas in canonical order (``_breakdown_total``),
    so ``score == Σ breakdown`` still holds (N4).
    """
    filled = _filled_slot_ids(scored.candidate.slot_map)
    overused_count = sum(1 for item_id in filled if item_id in overuse_set)
    overuse = -OVERUSE_PENALTY * overused_count
    # Flat membership (recency-invariant): present-or-not in the shown window, not a count (Q2).
    repetition = (
        -REPETITION_PENALTY
        if scored.candidate.full_signature in context.shown_full_signatures
        else 0.0
    )

    old = scored.breakdown
    breakdown = ScoreBreakdown(
        base=old.base,
        combo=old.combo,
        item=old.item,
        dislike=old.dislike,
        overuse=overuse,
        repetition=repetition,
        cooldown=old.cooldown,
    )
    return _ScoredCandidate(
        candidate=scored.candidate,
        score=_breakdown_total(breakdown),
        breakdown=breakdown,
    )


def _apply_step6_diversity(
    scored: Sequence[_ScoredCandidate],
    context: RankerContext,
) -> tuple[_ScoredCandidate, ...]:
    """Run Step-6 diversity over the C3-scored pool (§6 step 5, N1/N2/N5/Q1/Q2).

    Composition, in order: (1) BaseKey **variant cap** (top-2 by pre-penalty score); (2) compute
    the **overuse set** once over the post-cap survivors; (3/4) apply the **overuse** and
    **repetition** penalties to each survivor, (5) rebuilding ``score`` so it still equals the sum
    of the signed breakdown deltas (N4). Returns the diversified, re-scored survivor pool.

    Deliberately **partial** (C4 scope): no fallback ladder, no cooldown re-admission, no global
    sort, no truncation to ``k``, no ``RankerResult`` assembly, no re-admission of variant-cap-dropped
    candidates — those are C5. The overuse set is computed *after* the variant cap, so the cap's
    drops change the denominator (N1).
    """
    survivors = _apply_variant_cap(scored)
    overuse_set = _compute_overuse_set(survivors)
    return tuple(_rescore_with_diversity(sc, overuse_set, context) for sc in survivors)


# ============================== public entry point ==============================


def _guard_reducer_inputs(context: RankerContext) -> None:
    """Validate the reducer-supplied collection inputs (§6 step 1, N14/N10).

    Window inputs arrive **already windowed** (the M4/M5 reducer owns windowing); M3 guards
    ``len ≤`` the window constant and **never truncates** — silent truncation would hide an
    upstream reducer bug and make the window size ambiguous across the Python/TS boundary
    (``sampler.py`` assert precedent). Affinities must be **real, non-``bool``, finite numbers**
    that are **non-negative** — a ``bool`` or non-numeric value is a reducer type error
    (``TypeError``); a negative *or non-finite* (NaN/±inf) value is reducer-contract misuse
    (``ValueError``): a dislike lowers score only via ``dislikePenalty`` / cooldown, never a
    negative ``itemBoost`` (§11/R2). The only affinity transform M3 applies is the *upper*
    clamp to ``MAX_AFFINITY`` at scoring (C3). All are caller-contract violations that raise.
    """
    if len(context.shown_full_signatures) > REPETITION_WINDOW_SIZE:
        raise ValueError(
            f"shown_full_signatures length {len(context.shown_full_signatures)} exceeds "
            f"REPETITION_WINDOW_SIZE={REPETITION_WINDOW_SIZE} (the reducer owns windowing; M3 never truncates)"
        )
    if len(context.recent_disliked_base_keys) > COOLDOWN_BUFFER_SIZE:
        raise ValueError(
            f"recent_disliked_base_keys length {len(context.recent_disliked_base_keys)} exceeds "
            f"COOLDOWN_BUFFER_SIZE={COOLDOWN_BUFFER_SIZE} (the reducer owns windowing; M3 never truncates)"
        )
    if len(context.recent_disliked_item_ids) > DISLIKE_WINDOW_SIZE:
        raise ValueError(
            f"recent_disliked_item_ids length {len(context.recent_disliked_item_ids)} exceeds "
            f"DISLIKE_WINDOW_SIZE={DISLIKE_WINDOW_SIZE} (the reducer owns windowing; M3 never truncates)"
        )
    for item_id, affinity in context.item_affinity.items():
        # bool is an int subclass — isinstance(True, int) is True — so reject it before the
        # numeric check (mirrors the package's bool-rejection precedents). The numeric guard
        # then makes the `< 0` comparison well-defined (a non-number `< 0` would raise an
        # opaque TypeError; surface a clear one instead).
        if isinstance(affinity, bool):
            raise TypeError(f"item_affinity[{item_id!r}] must be a non-bool number, got bool")
        if not isinstance(affinity, (int, float)):
            raise TypeError(
                f"item_affinity[{item_id!r}] must be a non-bool number, got {type(affinity).__name__}"
            )
        # NaN / ±inf are numeric but invalid: NaN slips the sign check (`nan < 0` is False)
        # and inf would survive the C3 upper clamp. Reject before the sign check (ValueError —
        # numeric-but-invalid value, not a type error).
        if not math.isfinite(affinity):
            raise ValueError(
                f"item_affinity[{item_id!r}]={affinity} is not finite; affinity must be a finite number"
            )
        if affinity < 0:
            raise ValueError(
                f"item_affinity[{item_id!r}]={affinity} is negative; affinity is non-negative "
                "(a dislike lowers score via dislikePenalty/cooldown, never a negative itemBoost — §11/R2)"
            )


def rank(candidates: Sequence[ValidatedCandidate], context: RankerContext) -> RankerResult:
    """Steps 4–6 over M2-validated candidates. Pure: no DB, no GPT, no IO.

    Returns ≤ ``context.k`` ranked outfits + per-outfit ``ScoreBreakdown`` + the state flags
    M5 needs (fallback stage, insufficient-wardrobe, lock-starvation diagnostic). Never
    creates a candidate; never relaxes M2 validation.

    **M3 C1–C4 scope.** ``rank`` itself implements the reducer-contract guards (§6 step 1) and
    the empty/degenerate short-circuit (§6 step 2). C2 added the Step-4 hard filters
    (``_apply_step4_filters``); C3 added the Step-5 scoring helper (``_score_candidate``); C4 added
    the Step-6 diversity helpers (``_apply_step6_diversity`` and its parts) — all verified directly.
    Assembling a non-empty result still needs the fallback ladder and the tie-break (C5), so a
    **non-empty** ``candidates`` list raises ``NotImplementedError`` rather than emit a partial
    ranking.
    """
    # Step 1 — reducer-contract guards. Run *before* the empty short-circuit (§6 order), so a
    # malformed signal input surfaces loudly even on the zero-candidate path.
    _guard_reducer_inputs(context)

    # Step 2 — empty/degenerate short-circuit (N15). Zero candidates is valid input (M2 "empty
    # is valid" precedent): return an empty insufficient result, never raise. The lock-starvation
    # diagnostic is NOT suppressed here (N3) — zero candidates cannot satisfy a requested lock,
    # so insufficient_locked_candidates is True whenever locks were requested and there is an
    # outfit budget (k > 0, always true post-construction guard).
    if not candidates:
        locked_survivor_count = 0
        insufficient_locked = bool(context.locked_item_ids) and locked_survivor_count < context.k
        return RankerResult(
            outfits=(),
            fallback_stage=FallbackStage.insufficient,
            insufficient_wardrobe=True,
            relaxed_cooldown_count=0,
            locked_survivor_count=locked_survivor_count,
            insufficient_locked_candidates=insufficient_locked,
        )

    # Non-empty output assembly needs the fallback ladder + tie-break (C5). C2 added the Step-4 hard
    # filters (_apply_step4_filters), C3 the Step-5 scoring helper (_score_candidate), and C4 the
    # Step-6 diversity helpers (_apply_step6_diversity), but a non-empty candidate list cannot yet be
    # ordered/assembled, so rank() does not build a result here — raise rather than fabricate one.
    raise NotImplementedError(
        "rank() output assembly needs the fallback ladder + tie-break (M3 C5); C2–C4 added the "
        "Step-4 hard filters (_apply_step4_filters), Step-5 scoring (_score_candidate), and Step-6 "
        "diversity (_apply_step6_diversity), but rank() cannot yet order or assemble a non-empty list"
    )
