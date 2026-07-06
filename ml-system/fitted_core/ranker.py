"""M3 ranker — pipeline Steps 4–6 over M2-validated candidates (v2 §14/§9).

Turns M2's ``list[ValidatedCandidate]`` into the final ranked ``outfits`` (≤ K):
per-request hard filters (cooldown / contextual dislike / lock), the humble additive
score, diversity (variant cap → overuse → repetition), the fallback ladder, and a
deterministic tie-break — emitting a per-outfit signed ``ScoreBreakdown`` plus the
state flags M5 needs. Pure substrate: **no DB, no GPT, no IO, no candidate creation.**
M3 only drops and reorders.

**Milestone scope (M3 C1–C5).** C1 landed the public surface (``rank`` signature,
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
(signed overuse + flat repetition deltas, Q1/Q2), composed by ``_apply_step6_diversity``. **C5 wires
the fallback ladder, final tie-break, truncate-to-k, and defensive ``RankedOutfit`` assembly** for
public non-empty ``rank()`` calls.

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
from fitted_core.seed import seeded_rng, tiebreak_seed
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

    _SIGNAL_COLLECTION_FIELDS = (
        "shown_full_signatures",
        "recent_disliked_base_keys",
        "recent_disliked_item_ids",
        "liked_full_signatures",
        "contextual_disliked_item_ids",
        "locked_item_ids",
    )

    def _normalize_collections(self) -> None:
        """Freeze the signal collections so a caller's later mutation can't reach in (§4).

        Frozen dataclass, so normalize via ``object.__setattr__``. Ordered windows →
        ``tuple`` (order preserved — recency-faithful membership); unordered id sets →
        ``frozenset``; ``item_affinity`` → a ``MappingProxyType`` over a private copy
        (read-only view, independent of the caller's dict).

        **Bare-``str`` trap-guard (M5 reducer boundary):** a scalar string where a
        collection belongs would coerce silently — ``tuple("sig-A")`` is
        ``('s','i','g','-','A')`` — and every membership check (repetition, cooldown,
        dislike, comboBoost, locks) would fail *open* against char fragments. Reject
        ``str``/``bytes`` containers before coercion and non-``str`` elements after,
        so a reducer type slip fails loud, never silently disables a signal.
        """
        for name in self._SIGNAL_COLLECTION_FIELDS:
            value = getattr(self, name)
            if isinstance(value, (str, bytes, bytearray)):
                raise TypeError(
                    f"{name} must be a collection of strings, got a bare "
                    f"{type(value).__name__} (tuple/frozenset coercion would split it "
                    "into characters and the signal would silently fail open)"
                )
        object.__setattr__(self, "shown_full_signatures", tuple(self.shown_full_signatures))
        object.__setattr__(self, "recent_disliked_base_keys", tuple(self.recent_disliked_base_keys))
        object.__setattr__(self, "recent_disliked_item_ids", tuple(self.recent_disliked_item_ids))
        object.__setattr__(self, "liked_full_signatures", frozenset(self.liked_full_signatures))
        object.__setattr__(
            self, "contextual_disliked_item_ids", frozenset(self.contextual_disliked_item_ids)
        )
        object.__setattr__(self, "locked_item_ids", frozenset(self.locked_item_ids))
        object.__setattr__(self, "item_affinity", MappingProxyType(dict(self.item_affinity)))
        for name in self._SIGNAL_COLLECTION_FIELDS:
            for element in getattr(self, name):
                if not isinstance(element, str):
                    raise TypeError(
                        f"{name} elements must be str, got {type(element).__name__} "
                        "(reducer contract: pre-reduced signals are collections of "
                        "signature/id strings)"
                    )


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


# ===================== C5 — fallback, tie-break, assembly (§6 steps 6–8) =====================


def _drop_overuse_penalty(scored: _ScoredCandidate) -> _ScoredCandidate:
    """Return ``scored`` with the overuse delta removed, preserving every other term (N2)."""
    if scored.breakdown.overuse == 0.0:
        return scored
    old = scored.breakdown
    breakdown = ScoreBreakdown(
        base=old.base,
        combo=old.combo,
        item=old.item,
        dislike=old.dislike,
        overuse=0.0,
        repetition=old.repetition,
        cooldown=old.cooldown,
    )
    return _ScoredCandidate(
        candidate=scored.candidate,
        score=_breakdown_total(breakdown),
        breakdown=breakdown,
    )


def _score_without_overuse(
    scored: _ScoredCandidate,
    context: RankerContext,
) -> _ScoredCandidate:
    """Apply repetition while keeping overuse relaxed (empty overuse set, never recomputed)."""
    return _rescore_with_diversity(scored, frozenset(), context)


def _select_fallback_pool(
    step4: _Step4Result,
    context: RankerContext,
) -> tuple[tuple[_ScoredCandidate, ...], FallbackStage]:
    """Walk the cumulative fallback ladder and return the pool to order/emit (N11).

    Strict order: normal → overuse_relaxed → variant_cap_relaxed → cooldown_relaxed →
    insufficient. Relaxation is cumulative: deeper rungs keep earlier relaxations. Validation,
    locks, and contextual dislikes never relax; cooldown relaxation draws only from
    ``step4.cooldown_reserve``.
    """
    step5_survivors = tuple(_score_candidate(candidate, context) for candidate in step4.survivors)

    normal = _apply_step6_diversity(step5_survivors, context)
    if len(normal) >= context.k:
        return normal, FallbackStage.none

    # overuse_relaxed is a **score-only** rung: it drops the overuse penalty over the *same*
    # post-cap pool, so its count equals `normal`'s — it can never flip the count-based gate that
    # `normal` just failed, hence is unreachable as a *terminal* stage under the current spec. The
    # branch stays as explicit ladder scaffolding (and the overuse drop carries forward cumulatively
    # into the deeper, count-changing rungs below — `_score_without_overuse`).
    overuse_relaxed = tuple(_drop_overuse_penalty(scored) for scored in normal)
    if len(overuse_relaxed) >= context.k:
        return overuse_relaxed, FallbackStage.overuse_relaxed

    variant_cap_relaxed = tuple(
        _score_without_overuse(scored, context) for scored in step5_survivors
    )
    if len(variant_cap_relaxed) >= context.k:
        return variant_cap_relaxed, FallbackStage.variant_cap_relaxed

    cooldown_relaxed = tuple(
        _score_without_overuse(
            _score_candidate(candidate, context, relaxed_cooldown=True),
            context,
        )
        for candidate in step4.cooldown_reserve
    )
    cooldown_pool = (*variant_cap_relaxed, *cooldown_relaxed)
    if len(cooldown_pool) >= context.k:
        return cooldown_pool, FallbackStage.cooldown_relaxed

    return cooldown_pool, FallbackStage.insufficient


def _tiebreak_seeded_rng(context: RankerContext):
    """The per-request seeded RNG for the tie-break (``tiebreak_seed`` over the context, §15)."""
    return seeded_rng(
        tiebreak_seed(
            session_id=context.session_id,
            wardrobe_version=context.wardrobe_version,
            occasion=context.occasion,
            weather=context.weather,
            date=context.date,
            generation_index=context.generation_index,
        )
    )


def _order_final_candidates(
    scored: Sequence[_ScoredCandidate],
    context: RankerContext,
) -> tuple[_ScoredCandidate, ...]:
    """Sort by score descending, then greedily resolve equal-score groups (N6/N12)."""
    rng = _tiebreak_seeded_rng(context)
    score_sorted = sorted(scored, key=lambda sc: sc.score, reverse=True)
    emitted_count: dict[str, int] = {}
    ordered: list[_ScoredCandidate] = []

    index = 0
    while index < len(score_sorted):
        score = score_sorted[index].score
        tie_group: list[_ScoredCandidate] = []
        while index < len(score_sorted) and score_sorted[index].score == score:
            tie_group.append(score_sorted[index])
            index += 1

        group = sorted(tie_group, key=lambda sc: sc.candidate.full_signature)
        priority = {sc.candidate.full_signature: rng.random() for sc in group}
        while group:
            pick = min(
                group,
                key=lambda sc: (
                    emitted_count.get(sc.candidate.base_key, 0),
                    priority[sc.candidate.full_signature],
                    sc.candidate.full_signature,
                ),
            )
            ordered.append(pick)
            base_key = pick.candidate.base_key
            emitted_count[base_key] = emitted_count.get(base_key, 0) + 1
            group.remove(pick)

    return tuple(ordered)


def _copy_slot_map(slot_map: SlotMap) -> SlotMap:
    """Defensively copy a mutable SlotMap for RankedOutfit output (§4 immutability)."""
    return SlotMap(
        dress=slot_map.dress,
        top=slot_map.top,
        bottom=slot_map.bottom,
        outer=slot_map.outer,
        shoes=slot_map.shoes,
    )


def _assemble_ranked_outfit(scored: _ScoredCandidate) -> RankedOutfit:
    """Build the immutable output ``RankedOutfit`` (defensive snapshots; cooldown delta → flag, §4)."""
    candidate = scored.candidate
    relaxed_cooldown = scored.breakdown.cooldown == COOLDOWN_PENALTY
    return RankedOutfit(
        source_index=candidate.source_index,
        slot_map=_copy_slot_map(candidate.slot_map),
        template=candidate.template,
        base_key=candidate.base_key,
        full_signature=candidate.full_signature,
        style_move=_freeze_style_move(candidate.style_move),
        score=scored.score,
        breakdown=scored.breakdown,
        relaxed_cooldown=relaxed_cooldown,
    )


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
        # Keys must be str for the same fail-open reason the signal collections reject
        # non-str elements: a non-str key (e.g. an int id) never matches any candidate's
        # item ids, so the affinity silently contributes nothing.
        if not isinstance(item_id, str):
            raise TypeError(
                f"item_affinity keys must be str item ids, got {type(item_id).__name__}: "
                f"{item_id!r} (a non-str key never matches and the boost silently fails open)"
            )
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

    ``rank`` runs the M3 pipeline in order: reducer-contract guards, empty short-circuit, Step-4
    hard filters, Step-5 scoring, Step-6 diversity/fallback, final deterministic tie-break,
    truncate-to-k, and defensive ``RankedOutfit`` assembly. Relaxation is cumulative and never
    creates candidates or relaxes M2 validation / locks / contextual dislikes.
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

    step4 = _apply_step4_filters(candidates, context)
    pool, fallback_stage = _select_fallback_pool(step4, context)
    ordered = _order_final_candidates(pool, context)
    outfits = tuple(_assemble_ranked_outfit(scored) for scored in ordered[: context.k])
    insufficient_wardrobe = len(outfits) < context.k
    relaxed_cooldown_count = sum(1 for outfit in outfits if outfit.relaxed_cooldown)

    return RankerResult(
        outfits=outfits,
        fallback_stage=fallback_stage,
        insufficient_wardrobe=insufficient_wardrobe,
        relaxed_cooldown_count=relaxed_cooldown_count,
        locked_survivor_count=step4.locked_survivor_count,
        insufficient_locked_candidates=step4.insufficient_locked_candidates,
    )


# ============================================================================
# M4b C6 — Option-B trace sibling (additive; the closed rank() is untouched)
# ============================================================================


@dataclass(frozen=True)
class _FilteredCandidate:
    """A validated candidate that entered ``rank()`` but was dropped BEFORE final scoring.

    These never reach ``ordered`` (the scored funnel), so they carry no ``ScoreBreakdown`` — only
    a ``drop_reason`` (an OPEN, append-only code-set string, §8.2-F). Distinct from the
    scored-but-unshown candidates (``RankAudit.scored[k:]``), which WERE scored then truncated.
    """

    candidate: ValidatedCandidate
    drop_reason: str


@dataclass(frozen=True)
class RankAudit:
    """``rank()`` + the full pre-truncation funnel (M4b C6 — the H29(a) selection-bias capture).

    ``result`` is the byte-stable public ``RankerResult`` (≤ k shown). ``scored`` is EVERY scored
    candidate as a ``RankedOutfit`` in final ranked order — ``scored[:len(result.outfits)]`` are the
    truncated top-k (identical to ``result.outfits``, determinism-guaranteed) and ``scored[k:]`` are
    the scored-but-unshown that the public ``rank()`` discards (their ``ScoreBreakdown`` is the
    selection-bias signal a trained scorer needs). ``filtered`` are candidates dropped by the Step-4
    hard filters / diversity before scoring (no breakdown). Built by RE-RUNNING the closed,
    deterministic ranker steps (seeded by ``context``) — ``rank()`` itself is never touched.
    """

    result: RankerResult
    scored: tuple[RankedOutfit, ...]
    filtered: tuple[_FilteredCandidate, ...]


def _ranker_drop_reason(candidate: ValidatedCandidate, context: RankerContext) -> str:
    """Re-derive why a candidate was dropped before scoring (the Step-4 predicates, §6 step 3).

    Mirrors ``_apply_step4_filters``'s classification; the residual ``diversity_capped`` covers a
    candidate that cleared all three Step-4 predicates but lost the BaseKey variant cap / fallback.
    """
    filled = set(_filled_slot_ids(candidate.slot_map))
    if not (context.locked_item_ids <= filled):
        return "ranker_lock_unsatisfied"
    if not filled.isdisjoint(context.contextual_disliked_item_ids):
        return "ranker_contextual_disliked"
    if candidate.base_key in set(context.recent_disliked_base_keys):
        return "ranker_cooldown_dropped"
    return "ranker_diversity_capped"


def rank_with_audit(candidates: Sequence[ValidatedCandidate], context: RankerContext) -> RankAudit:
    """``rank()`` + the full scored funnel + the pre-scoring drops (Option-B trace, M4b C6).

    Re-runs the closed, deterministic ranker pipeline (``_apply_step4_filters`` →
    ``_select_fallback_pool`` → ``_order_final_candidates``, all seeded by ``context``) to recover
    ``ordered`` — every scored candidate, not just the truncated top-k — then labels the candidates
    that never reached scoring. ``rank()`` is called for the public result and is itself untouched
    (its M0–M3 tests stay byte-stable). Determinism guarantees ``scored[:len(result.outfits)] ==
    result.outfits``.
    """
    result = rank(candidates, context)
    if not candidates:
        return RankAudit(result=result, scored=(), filtered=())
    step4 = _apply_step4_filters(candidates, context)
    pool, _ = _select_fallback_pool(step4, context)
    ordered = _order_final_candidates(pool, context)
    scored = tuple(_assemble_ranked_outfit(scored_candidate) for scored_candidate in ordered)
    scored_source_indexes = {outfit.source_index for outfit in scored}
    filtered = tuple(
        _FilteredCandidate(candidate=candidate, drop_reason=_ranker_drop_reason(candidate, context))
        for candidate in candidates
        if candidate.source_index not in scored_source_indexes
    )
    return RankAudit(result=result, scored=scored, filtered=filtered)
