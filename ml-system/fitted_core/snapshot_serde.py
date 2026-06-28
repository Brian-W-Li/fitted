"""Cross-language wire layer for the GenerationSnapshot contract (M4b C4).

The GenerationSnapshot is authored on both sides of the M5 service boundary (plan §8.4):
Python issues keys / scores / dispositions + each item's ``engineVisible`` projection;
TS persists the merged Mongoose doc. Python is snake_case; Mongo / the wire is camelCase.
This module is the *only* place the two casings meet, and it enforces the boundary
guarantees the spec §15.1 / plan §8.4 pin:

  - **finite floats only** — ``NaN`` / ``Infinity`` never cross (they are not valid JSON
    and would silently poison a trained scorer's features),
  - **opaque-string ids** — item / candidate ids cross as plain ``str``; a Mongo
    ``ObjectId`` (or any non-string) under an id key is rejected here, never serialized
    into a populatable ref (H10 — nothing may re-hydrate a mutated live item).

**Only structural field *names* are re-cased.** Two classes of key are NOT field names and
must survive byte-for-byte, or the stored training truth is corrupted:

  - the partition-key rename ``type`` → ``clothingType`` (and the other engineVisible
    renames) apply **only inside an ``engine_visible`` object** — a generic snake→camel
    converter would leave ``type`` alone, but a blanket map application would rewrite any
    ``type`` key anywhere; scoping it to ``engine_visible`` is what keeps it honest;
  - **data-valued Map fields** (``constraints``, ``samplerPerType``, the rejection/warning
    histograms) are keyed by *data* — an ``ItemType`` like ``outer_layer``, an ``IssueCode``
    value, an arbitrary constraint name — and **verbatim Mixed blobs** (``rawEmitted``,
    ``rawAttributes``, ``styleProfileSnapshot``, ``generatorVisible``) are stored as-emitted.
    Re-casing ``outer_layer`` → ``outerLayer`` would silently diverge the wire from the
    ``ItemType`` member value (member names = wire values, §15.2). Inside these fields the
    serde preserves keys exactly while still validating floats / serializability.

``to_wire`` / ``from_wire`` are pure, recursive, and inverse on the contract's field names
— a payload survives ``to_wire`` → JSON → ``from_wire`` byte-equal (modulo float canonical
form). The engineVisible field map is listed in full below (spec §15.1: "list all of these,
not only the three tags").

**The mechanical snake↔camel pair is only inverse for names whose every segment starts with
a letter** (matching ``^[a-z][a-z0-9]*(_[a-z][a-z0-9]*)*$``). A segment that starts with a
non-letter — a digit-after-underscore (``gpt_4o`` → ``gpt4o`` → ``gpt4o``), a trailing
underscore, or a double underscore — silently loses its word boundary and would corrupt the
stored training truth. Rather than overstate the guarantee, ``_map_key`` *enforces* it: a
structural key that does not round-trip raises at author time, so a future field like
``gpt_4o_score`` fails loud instead of mangling the wire. (engineVisible renames go through the
explicit table, and data-Map / Mixed keys go through the ``opaque`` path — neither is subject to
this constraint; it binds only mechanically-converted structural field names.)
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

# engineVisible snake↔camel field map (spec §15.1, plan §8.2-D / C4). Listed in FULL — not
# only the three tags — so this is the single authoritative shape of the projection.
# ``type`` → ``clothingType`` and ``image_url`` → ``imageUrl`` are the load-bearing renames a
# generic converter misses; the tags are mechanical but pinned here for one source of truth.
# Applied ONLY within an ``engine_visible`` object (see ``_ENGINE_VISIBLE_PARENT_KEYS``).
ENGINE_VISIBLE_TO_WIRE: dict[str, str] = {
    "name": "name",
    "type": "clothingType",
    "warmth": "warmth",
    "style_tags": "styleTags",
    "color_tags": "colorTags",
    "occasion_tags": "occasionTags",
    "material": "material",
    "formality": "formality",
    "image_url": "imageUrl",
}
ENGINE_VISIBLE_FROM_WIRE: dict[str, str] = {v: k for k, v in ENGINE_VISIBLE_TO_WIRE.items()}

# The parent keys whose immediate child object is an engineVisible projection. The special
# renames above apply only one level under one of these — never to a bare ``type`` elsewhere.
_ENGINE_VISIBLE_PARENT_KEYS: frozenset[str] = frozenset({"engine_visible", "engineVisible"})

# Keys whose values cross as opaque strings (never an ObjectId / populatable ref — H10).
# Both casings are listed so the guard fires in either transform direction (the key_context
# handed to the guard is the *source* key — snake on to_wire, camel on from_wire).
_ID_KEYS: frozenset[str] = frozenset(
    {
        "itemId", "item_id",
        "candidateId", "candidate_id",
        "snapshotId", "snapshot_id",
        "sourceAttemptId", "source_attempt_id",
        "attemptId", "attempt_id",
        "forcedItemId", "forced_item_id",
    }
)

# Fields whose VALUE is a sequence of opaque-string ids/signatures. The scalar _ID_KEYS guard
# above cannot reach list elements, so a numeric entry in shownCandidateIds / shownFullSignatures
# / changedItemIds / baseOutfitItemIds would otherwise cross the wire as a number and weaken the
# M5 snapshot/feedback identity contract (§15.1). Both casings listed (key_context is the SOURCE
# key — snake on to_wire, camel on from_wire), same convention as _ID_KEYS.
_ID_SEQUENCE_KEYS: frozenset[str] = frozenset(
    {
        "shownCandidateIds", "shown_candidate_ids",
        "shownFullSignatures", "shown_full_signatures",
        "changedItemIds", "changed_item_ids",
        "baseOutfitItemIds", "base_outfit_item_ids",
    }
)

# Fields whose VALUE is opaque to the casing pass: a Map keyed by data (ItemType /
# IssueCode value / arbitrary constraint name) or a verbatim Mixed blob (raw GPT / CV
# payloads, the embedded style-profile snapshot). The field name itself IS re-cased; only
# its nested keys are preserved byte-for-byte (floats / serializability are still checked).
# Both casings listed. Source: plan §8.3 (every Map / Mixed field in the snapshot schema).
# When C6/M5 adds a new data-Map or Mixed field, register it here or its keys get mangled.
_OPAQUE_VALUE_KEYS: frozenset[str] = frozenset(
    {
        "constraints",
        "sampler_per_type", "samplerPerType",
        "rejection_histogram", "rejectionHistogram",
        "warning_histogram", "warningHistogram",
        "raw_emitted", "rawEmitted",
        "raw_attributes", "rawAttributes",
        "style_profile_snapshot", "styleProfileSnapshot",
        "generator_visible", "generatorVisible",
    }
)


def _snake_to_camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in rest)


def _camel_to_snake(name: str) -> str:
    out: list[str] = []
    for ch in name:
        if ch.isupper():
            out.append("_")
            out.append(ch.lower())
        else:
            out.append(ch)
    return "".join(out)


def _map_key(key: str, *, to_wire: bool, in_engine: bool) -> str:
    if in_engine:
        table = ENGINE_VISIBLE_TO_WIRE if to_wire else ENGINE_VISIBLE_FROM_WIRE
        mapped = table.get(key)
        if mapped is not None:
            return mapped
    # Mechanical conversion is only inverse when every segment starts with a letter (see the
    # module docstring). Guard the structural key here so a non-round-tripping name (a future
    # ``gpt_4o_score`` etc.) fails loud at author time instead of silently corrupting the wire.
    if to_wire:
        camel = _snake_to_camel(key)
        if _camel_to_snake(camel) != key:
            raise ValueError(
                f"structural field name {key!r} is not round-trip-safe through the snake↔camel "
                f"wire converter (a segment starts with a non-letter — digit-after-underscore, "
                f"trailing/double underscore). Rename it, list it in ENGINE_VISIBLE_TO_WIRE, or "
                f"nest it under an opaque-value parent."
            )
        return camel
    snake = _camel_to_snake(key)
    if _snake_to_camel(snake) != key:
        raise ValueError(
            f"wire field name {key!r} is not round-trip-safe through the snake↔camel converter; "
            f"a malformed or unexpected wire key reached from_wire."
        )
    return snake


def _convert(
    value: Any,
    *,
    to_wire: bool,
    key_context: str | None = None,
    opaque: bool = False,
    in_engine: bool = False,
    id_sequence_element: bool = False,
) -> Any:
    """Recursively re-case keys and validate the boundary guarantees.

    ``key_context`` is the *source* key the value sat under (for id-string enforcement and
    error messages). ``opaque`` (inside a data-Map / Mixed blob) preserves nested keys
    verbatim; ``in_engine`` (immediately inside an ``engine_visible`` object) enables the
    engineVisible rename table. ``id_sequence_element`` distinguishes a plural-id field's
    outer container from its string elements. Ordering matters: the id guard runs before
    type dispatch, and the ``bool`` check precedes the ``int``/``float`` branches
    (``bool`` ⊂ ``int``).
    """
    if not opaque and key_context in _ID_KEYS and value is not None and not isinstance(value, str):
        raise ValueError(
            f"id field {key_context!r} must cross the wire as an opaque string, "
            f"got {type(value).__name__}: {value!r}"
        )
    if not opaque and key_context in _ID_SEQUENCE_KEYS:
        if value is None:
            if id_sequence_element:
                raise ValueError(
                    f"id-sequence field {key_context!r} must hold opaque strings, "
                    "got element NoneType: None"
                )
            return None
        if id_sequence_element:
            if not isinstance(value, str):
                raise ValueError(
                    f"id-sequence field {key_context!r} must hold opaque strings, "
                    f"got element {type(value).__name__}: {value!r}"
                )
        else:
            if not isinstance(value, (list, tuple)):
                raise ValueError(
                    f"id-sequence field {key_context!r} must be a list/tuple of opaque strings, "
                    f"got {type(value).__name__}: {value!r}"
                )
            return [
                _convert(
                    v,
                    to_wire=to_wire,
                    key_context=key_context,
                    opaque=opaque,
                    in_engine=in_engine,
                    id_sequence_element=True,
                )
                for v in value
            ]
    if isinstance(value, bool):
        return value
    if isinstance(value, Mapping):
        result: dict[str, Any] = {}
        for raw_key, raw_val in value.items():
            if opaque:
                # data/blob keys are preserved byte-for-byte; values stay opaque too
                result[raw_key] = _convert(
                    raw_val,
                    to_wire=to_wire,
                    key_context=raw_key,
                    opaque=True,
                )
                continue
            result[_map_key(raw_key, to_wire=to_wire, in_engine=in_engine)] = _convert(
                raw_val,
                to_wire=to_wire,
                key_context=raw_key,
                opaque=raw_key in _OPAQUE_VALUE_KEYS,
                in_engine=raw_key in _ENGINE_VISIBLE_PARENT_KEYS,
            )
        return result
    if isinstance(value, (list, tuple)):
        return [
            _convert(v, to_wire=to_wire, key_context=key_context, opaque=opaque, in_engine=in_engine)
            for v in value
        ]
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(
                f"non-finite float at the wire boundary (key={key_context!r}): {value!r}"
            )
        return value
    if value is None or isinstance(value, (int, str)):
        return value
    # Anything else (ObjectId, datetime, set, custom object) cannot cross the JSON wire —
    # rejected even inside an opaque blob (a raw payload may not smuggle a non-JSON value).
    raise TypeError(
        f"value of type {type(value).__name__} is not wire-serializable (key={key_context!r})"
    )


def to_wire(payload: Mapping[str, Any]) -> dict[str, Any]:
    """snake_case Python payload → camelCase wire dict, validated.

    Re-cases structural field names (engineVisible renames within an ``engine_visible``
    object, mechanical snake→camel otherwise), preserves data-Map / Mixed keys verbatim,
    and raises on a non-finite float or a non-string id anywhere in the structure.
    """
    return _convert(dict(payload), to_wire=True)


def from_wire(wire: Mapping[str, Any]) -> dict[str, Any]:
    """camelCase wire dict → snake_case Python payload, validated.

    The inverse of :func:`to_wire` on the contract's field names; the same boundary guards
    apply (a malformed wire doc is rejected, never silently coerced).
    """
    return _convert(dict(wire), to_wire=False)
