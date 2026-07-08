"""The outfit/rank-scorer seam (§23-H28; m5-cutover.md §E, C4).

The **shape M6's trained scorer implements** — declared here as a small, dependency-light
contract so the snapshot producer can *exercise* it at M5 without any trained model, and M6
can swap a real occupant in with no producer change.

This is the **outfit/pairwise-level** seam (scores a whole ``SlotMap`` under a lens), NOT the
item-level ``sampler.SignalScorer`` (the behavioral/personalization slot). The literature is
unanimous that outfit compatibility is pairwise/edge-level + type-conditioned — a summed
per-item scalar cannot represent "these clash" (Vasileva 2018 / NGNN / OutfitTransformer,
spec §23-H28) — so the two seams stay distinct.

**M5 scope (producer trace only):** an ``OutfitScorer`` is called while building a snapshot to
populate ``scoreTrace.compatibility/visibility`` for every scored candidate; it does **not**
influence rank order (that additive ``RankerContext`` hook is M6 entry work). The cold-start
occupant is ``response.cold_start_scorer`` (it wraps the pure ``compatibility``/``visibility``
content functions); keeping the Protocol here — with ``LensRequest`` referenced only under
``TYPE_CHECKING`` — avoids a runtime import cycle with ``response`` (``response → scorer`` at
runtime; ``scorer → response`` only for type-checkers).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Mapping, Optional, Protocol

from fitted_core.models import SlotMap, WardrobeItem

if TYPE_CHECKING:  # avoids a runtime cycle — response imports OutfitScore from here
    from fitted_core.response import LensRequest


@dataclass(frozen=True)
class OutfitScore:
    """One outfit's continuous scores (m5-cutover.md §E — the ``scoreTrace`` seam).

    ``compatibility``/``visibility`` are the ``[0,1]`` cold-start content scores (the M6
    seam); ``signal_score`` is reserved for the trained M6 scorer and is ``None`` at
    cold-start. The **M5 invariant** (§E): an occupant returns finite, non-null ``[0,1]``
    ``compatibility`` **and** ``visibility`` for every scored candidate — a future scorer
    lacking visibility must fall back to the cold-start visibility before writing.
    """

    compatibility: float
    visibility: float
    signal_score: Optional[float] = None


class OutfitScorer(Protocol):
    """Score a whole outfit under a lens (m5-cutover.md §E; §23-H28 seam shape).

    The M6 trained scorer implements this exact shape. The seam INPUT is
    ``(slot_map, items_by_id, request)`` — the partial/whole outfit + the resolvable pool +
    the lens/context — so a lens-conditioned, whole-outfit attention head can land at M6
    without changing the call site.
    """

    def __call__(
        self,
        slot_map: SlotMap,
        items_by_id: Mapping[str, WardrobeItem],
        request: "LensRequest",
    ) -> OutfitScore: ...
