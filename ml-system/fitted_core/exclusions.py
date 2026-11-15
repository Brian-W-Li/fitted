"""Explicit owner-resolved exclusions; finite hard policy, never inferred taste.

Next authenticates ownership and resolves scope/revisions. This pure boundary verifies
canonical identity and exact request binding, including inert unavailable targets.
"""
from dataclasses import dataclass, field
import hashlib
import json
import re
from typing import Iterable, Literal, Mapping

VERSION = "explicit-exclusions.v1"
MAX_PER_KIND_SCOPE = 20
MAX_ENTRIES = 80
MAX_REVISION = 9007199254740991
_HEX = re.compile(r"^[0-9a-f]{24}$")
_DIGEST = re.compile(r"^[0-9a-f]{64}$")
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_ULID = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")


def canonical_digest(value: Mapping) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii")).hexdigest()


@dataclass(frozen=True)
class ExclusionEntry:
    id: str
    revision: int
    scope: Literal["saved", "request"]
    kind: Literal["item", "combination"]
    item_ids: tuple[str, ...]

    def to_wire(self) -> dict:
        return {"id": self.id, "revision": self.revision, "scope": self.scope,
                "kind": self.kind, "itemIds": list(self.item_ids)}


@dataclass(frozen=True)
class ExplicitExclusions:
    request_id: str
    saved_ref: tuple[str, int] | None
    entries: tuple[ExclusionEntry, ...]
    digest: str
    excluded_item_ids: frozenset[str] = field(init=False, repr=False)
    excluded_combinations: frozenset[frozenset[str]] = field(init=False, repr=False)

    def __post_init__(self):
        object.__setattr__(self, "excluded_item_ids", frozenset(entry.item_ids[0] for entry in self.entries if entry.kind == "item"))
        object.__setattr__(self, "excluded_combinations", frozenset(frozenset(entry.item_ids) for entry in self.entries if entry.kind == "combination"))

    def to_wire(self) -> dict:
        return {"version": VERSION, "requestId": self.request_id,
                "savedRef": None if self.saved_ref is None else {"id": self.saved_ref[0], "revision": self.saved_ref[1]},
                "entries": [entry.to_wire() for entry in self.entries], "digest": self.digest}


def _shape(value, keys, label):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError(f"{label} must contain exactly {', '.join(sorted(keys))}")


def _id(value, label):
    if not isinstance(value, str) or not _HEX.fullmatch(value):
        raise ValueError(f"{label} must be a canonical 24-hex ID")
    return value


def _revision(value, label):
    if type(value) is not int or not 1 <= value <= MAX_REVISION:
        raise ValueError(f"{label} must be a positive safe integer")
    return value


def normalize_explicit_exclusions(raw, request_id=None) -> ExplicitExclusions | None:
    if raw is None:
        return None
    if isinstance(raw, ExplicitExclusions):
        raw = raw.to_wire()
    _shape(raw, {"version", "requestId", "savedRef", "entries", "digest"}, "explicitExclusions")
    if raw["version"] != VERSION:
        raise ValueError("explicitExclusions.version is unsupported")
    ident = raw["requestId"]
    if not isinstance(ident, str) or not (_UUID.fullmatch(ident) or _ULID.fullmatch(ident)):
        raise ValueError("explicitExclusions.requestId must be a canonical UUIDv4 or ULID")
    if request_id is not None and ident != request_id:
        raise ValueError("explicitExclusions.requestId does not match this render request")
    ref = raw["savedRef"]
    if ref is not None:
        _shape(ref, {"id", "revision"}, "explicitExclusions.savedRef")
        ref = (_id(ref["id"], "savedRef.id"), _revision(ref["revision"], "savedRef.revision"))
    rows = raw["entries"]
    if not isinstance(rows, list) or len(rows) > MAX_ENTRIES:
        raise ValueError("explicitExclusions.entries must contain at most 80 entries")
    entries, counts, semantics = [], {}, set()
    for row in rows:
        _shape(row, {"id", "revision", "scope", "kind", "itemIds"}, "explicitExclusions entry")
        eid = _id(row["id"], "entry.id")
        revision = _revision(row["revision"], "entry.revision")
        scope, kind, ids = row["scope"], row["kind"], row["itemIds"]
        if scope not in ("saved", "request") or kind not in ("item", "combination"):
            raise ValueError("explicitExclusions entry scope/kind is invalid")
        if scope == "saved" and ref is None:
            raise ValueError("saved exclusions require savedRef")
        if not isinstance(ids, list) or not 1 <= len(ids) <= (1 if kind == "item" else 5):
            raise ValueError("item exclusions need exactly one ID; combinations need 1–5 IDs")
        ids = [_id(value, "entry.itemIds") for value in ids]
        if ids != sorted(set(ids)):
            raise ValueError("entry.itemIds must be unique and canonically sorted")
        meaning = (scope, kind, tuple(ids))
        if meaning in semantics:
            raise ValueError("duplicate exclusion meaning in the same scope")
        semantics.add(meaning)
        counts[scope, kind] = counts.get((scope, kind), 0) + 1
        if counts[scope, kind] > MAX_PER_KIND_SCOPE:
            raise ValueError("at most 20 exclusions of each kind per scope")
        entries.append(ExclusionEntry(eid, revision, scope, kind, tuple(ids)))
    if [entry.id for entry in entries] != sorted({entry.id for entry in entries}):
        raise ValueError("exclusion entry IDs must be unique and canonically sorted")
    digest = raw["digest"]
    if not isinstance(digest, str) or not _DIGEST.fullmatch(digest):
        raise ValueError("explicitExclusions.digest must be a canonical SHA-256")
    unsigned = {key: value for key, value in raw.items() if key != "digest"}
    if canonical_digest(unsigned) != digest:
        raise ValueError("explicitExclusions.digest does not match its canonical policy")
    return ExplicitExclusions(ident, ref, tuple(entries), digest)


def exclusion_reason(policy: ExplicitExclusions | None, item_ids: Iterable[str]) -> str | None:
    if policy is None:
        return None
    ids = frozenset(item_ids)
    if policy.excluded_item_ids.intersection(ids):
        return "explicit_item_excluded"
    if ids in policy.excluded_combinations:
        return "explicit_combination_excluded"
    return None


def is_excluded(policy: ExplicitExclusions | None, item_ids: Iterable[str]) -> bool:
    return exclusion_reason(policy, item_ids) is not None


def filled_item_ids(candidate) -> frozenset[str]:
    slots = candidate.slot_map
    return frozenset(value for value in (slots.top, slots.bottom, slots.dress, slots.mid, slots.outer, slots.shoes) if value is not None)


def filter_candidates(policy: ExplicitExclusions | None, candidates):
    survivors, drops = [], []
    for candidate in candidates:
        reason = exclusion_reason(policy, filled_item_ids(candidate))
        if reason is None:
            survivors.append(candidate)
        else:
            drops.append((candidate, reason))
    return survivors, tuple(drops)


def validate_pins(policy: ExplicitExclusions | None, pins: Iterable[str]) -> None:
    if policy is not None and policy.excluded_item_ids.intersection(pins):
        raise ValueError("a kept or forced item conflicts with an explicit item exclusion")
