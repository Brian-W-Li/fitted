"""Bounded removable-layer choice, independent of warmth scoring or learned taste.

Eligibility is decided after structural validation and exact user controls. Category
only establishes a removable outer option; it does not establish protection.
"""
from typing import Callable, Collection, Mapping, Optional, Sequence, TYPE_CHECKING, TypeVar

from fitted_core.models import ItemType, Role, SlotMap

if TYPE_CHECKING:
    from fitted_core.rescue import RenderRequest
    from fitted_core.response import LensRequest, OutfitVariant
    from fitted_core.validator import ValidatedCandidate

T = TypeVar("T")

OFFERED_NOTE = 'An optional removable layer is included. Rain and wind protection are unknown; check the garment and conditions before relying on it.'
GAP_NOTE = 'No eligible removable-layer option was found for these conditions. Rain and wind protection are unknown.'


def normalize_weather_signals(value: object) -> Optional[dict[str, bool]]:
    if value is None:
        return None
    if not isinstance(value, Mapping) or set(value) != {"rain", "wind"}:
        raise ValueError("weather_signals must contain exactly rain and wind")
    if any(type(value[key]) is not bool for key in ("rain", "wind")):
        raise ValueError("weather_signals rain and wind must be strict booleans")
    return {"rain": bool(value["rain"]), "wind": bool(value["wind"])}


def positive_conditions(request: "LensRequest") -> bool:
    signals = getattr(request, "weather_signals", None)
    return bool(signals and (signals["rain"] or signals["wind"]))


def needs_layer_choice(request: "LensRequest") -> bool:
    return request.weather in {"mild", "cold"} and positive_conditions(request)


def _item_ids(slots: SlotMap) -> frozenset[str]:
    return frozenset(i for i in (slots.dress, slots.top, slots.bottom, slots.mid, slots.outer, slots.shoes) if i)


def exclude_source_membership(
    request: "RenderRequest", candidates: Sequence["ValidatedCandidate"]
) -> tuple[list["ValidatedCandidate"], tuple["ValidatedCandidate", ...]]:
    excluded = frozenset(request.excluded_outfit_item_ids)
    survivors, drops = [], []
    for candidate in candidates:
        slots = candidate.slot_map
        ids = _item_ids(slots)
        (drops if excluded and ids == excluded else survivors).append(candidate)
    return survivors, tuple(drops)


def eligible_signatures(
    request: "RenderRequest", candidates: Sequence["ValidatedCandidate"]
) -> frozenset[str]:
    if not needs_layer_choice(request):
        return frozenset()
    # request wardrobe is already the service's owned, available collection.
    outers = {item.id for item in request.wardrobe if item.type == ItemType.outer_layer}
    excluded = frozenset(request.excluded_outfit_item_ids)
    locks = set(request.locked_item_ids)
    avoids = set(request.disliked_item_ids)
    if request.forced_item_id:
        locks.add(request.forced_item_id)
    eligible = []
    for candidate in candidates:
        slots = candidate.slot_map
        ids = _item_ids(slots)
        if slots.outer in outers and locks <= ids and not avoids.intersection(ids) and ids != excluded:
            eligible.append(candidate.full_signature)
    return frozenset(eligible)


def reserve_choice(
    ordered: Sequence[T], limit: int, eligible: Collection[str], signature: Callable[[T], str]
) -> tuple[T, ...]:
    """Retain one best eligible member without increasing the existing budget.

    Input order owns quality and deterministic ties. Only the last budget position
    changes when no eligible member was already retained. The full funnel remains
    available in the reordered tail for audit capture.
    """
    ordered = list(ordered)
    if any(signature(value) in eligible for value in ordered[:limit]):
        return tuple(ordered)
    chosen = next((value for value in ordered if signature(value) in eligible), None)
    if chosen is not None:
        ordered.remove(chosen)
        ordered.insert(min(limit - 1, len(ordered)), chosen)
    return tuple(ordered)


def layer_choice(request: "LensRequest", variants: Sequence["OutfitVariant"]) -> dict[str, Optional[str]]:
    if not needs_layer_choice(request):
        return {"status": "off", "note": None}
    offered = any(any(role == Role.outer_layer for _, role in variant.items) for variant in variants)
    if offered:
        return {"status": "offered", "note": OFFERED_NOTE}
    return {"status": "gap", "note": GAP_NOTE}
