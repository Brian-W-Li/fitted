"""Load, validate, and independently re-derive a Track-2 export certificate."""

from __future__ import annotations

import hashlib
import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from constants import (
    CONCENTRATION_CAP,
    FIVE_TYPES,
    MIN_CATEGORY_DEPTH,
    PRIMARY_MIN_LOOK1,
    TRANSFER_DECISION_MIN,
    TRANSFER_INTERP_MIN,
)


class BundleError(RuntimeError):
    pass


def _strict_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise BundleError(f"duplicate JSON key {key!r}")
        out[key] = value
    return out


def _load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f, object_pairs_hook=_strict_pairs, parse_constant=_reject_constant)


def _reject_constant(value: str) -> None:
    raise BundleError(f"non-finite JSON number {value}")


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line, object_pairs_hook=_strict_pairs, parse_constant=_reject_constant)
            except Exception as exc:
                raise BundleError(f"{path.name}:{lineno}: invalid JSON: {exc}") from exc
            if not isinstance(row, dict):
                raise BundleError(f"{path.name}:{lineno}: row must be an object")
            rows.append(row)
    return rows


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def item_signature(items: Iterable[dict[str, Any]]) -> str:
    return "|".join(sorted(str(i.get("itemId", "")) for i in items))


@dataclass(frozen=True)
class Cluster:
    user: str
    arm: str
    signature: str
    snapshot_id: str
    candidate_id: str
    items: tuple[dict[str, Any], ...]


@dataclass
class Bundle:
    root: Path
    manifest: dict[str, Any]
    rows: list[dict[str, Any]]
    excluded_users: set[str]
    certificate: dict[str, Any]
    clusters: list[Cluster]
    content_hashes: dict[str, str] = field(default_factory=dict)

    @property
    def headline_clusters(self) -> list[Cluster]:
        return [c for c in self.clusters if c.user not in self.excluded_users]

    @property
    def excluded_clusters(self) -> list[Cluster]:
        return [c for c in self.clusters if c.user in self.excluded_users]

    def image_path(self, item: dict[str, Any]) -> Path:
        rel = item.get("imageFile")
        if not isinstance(rel, str) or not rel:
            raise BundleError(f"scoreable item {item.get('itemId')!r} has no imageFile")
        path = (self.root / rel).resolve()
        if self.root.resolve() not in path.parents:
            raise BundleError(f"image path escapes bundle: {rel!r}")
        return path


def _depth(rows: list[dict[str, Any]]) -> dict[str, dict[str, set[str]]]:
    out: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for row in rows:
        user = row.get("user") or "unknown"
        for item in row.get("items") or []:
            clothing_type = item.get("clothingType")
            if clothing_type:
                out[user][str(clothing_type)].add(str(item.get("itemId", "")))
    return out


def derive_certificate(
    rows: list[dict[str, Any]], excluded_users: set[str]
) -> tuple[dict[str, Any], list[Cluster]]:
    _validate_rows(rows)
    depth = _depth(rows)
    raw: dict[str, dict[str, Any]] = {}
    representatives: dict[tuple[str, str, str], Cluster] = {}

    for row in rows:
        user = row.get("user") or "unknown"
        pu = raw.setdefault(user, {
            "accepted": 0, "rejected": 0, "imageUsableAccepted": 0,
            "acceptedSig": set(), "rejectedSig": set(), "transferSig": set(),
            "clothingTypes": set(),
        })
        items = tuple(row.get("items") or [])
        for item in items:
            clothing_type = item.get("clothingType")
            if clothing_type:
                pu["clothingTypes"].add(str(clothing_type))
        image_usable = bool(items) and all(i.get("imageStatus") == "resolved" for i in items)
        scoreable = len(items) >= 2 and image_usable
        arm = row.get("label")
        if arm not in {"accepted", "rejected"}:
            continue
        pu[arm] += 1
        if arm == "accepted" and image_usable:
            pu["imageUsableAccepted"] += 1
        if not scoreable:
            continue
        for item in items:
            ct = item.get("clothingType")
            if ct not in FIVE_TYPES:
                raise BundleError(f"scoreable item has invalid clothingType {ct!r}")
        signature = item_signature(items)
        pu[f"{arm}Sig"].add(signature)
        if arm == "accepted" and any(
            len(depth[user].get(str(i.get("clothingType")), set())) >= MIN_CATEGORY_DEPTH
            for i in items if i.get("clothingType")
        ):
            pu["transferSig"].add(signature)
        cluster = Cluster(
            user=user, arm=arm, signature=signature,
            snapshot_id=str(row.get("snapshotId", "")),
            candidate_id=str(row.get("candidateId", "")), items=items,
        )
        key = (user, arm, signature)
        old = representatives.get(key)
        if old is None or (cluster.snapshot_id, cluster.candidate_id) < (old.snapshot_id, old.candidate_id):
            representatives[key] = cluster

    per_user: dict[str, dict[str, int]] = {}
    for user, v in raw.items():
        per_user[user] = {
            "accepted": v["accepted"],
            "rejected": v["rejected"],
            "imageUsableAccepted": v["imageUsableAccepted"],
            "primaryAcceptedScoreable": len(v["acceptedSig"]),
            "primaryRejectedScoreable": len(v["rejectedSig"]),
            "transferAcceptedScoreable": len(v["transferSig"]),
            "clothingTypeDepth": len(v["clothingTypes"]),
        }
    headline = {u: v for u, v in per_user.items() if u not in excluded_users}
    excluded = {u: v for u, v in per_user.items() if u in excluded_users}
    accepted = sum(v["primaryAcceptedScoreable"] for v in headline.values())
    rejected = sum(v["primaryRejectedScoreable"] for v in headline.values())
    transfer = sum(v["transferAcceptedScoreable"] for v in headline.values())
    image_usable = sum(v["imageUsableAccepted"] for v in headline.values())

    def max_share(total: int, field: str) -> float:
        return max((v[field] for v in headline.values()), default=0) / total if total else 0.0

    a_share = max_share(accepted, "primaryAcceptedScoreable")
    r_share = max_share(rejected, "primaryRejectedScoreable")
    cap_ok = a_share <= CONCENTRATION_CAP and r_share <= CONCENTRATION_CAP
    cert = {
        "friends": len(headline),
        "cohortImageUsableAcceptedOutfits": image_usable,
        "scoreableClusters": {
            "acceptedScoreable": accepted,
            "rejectedScoreable": rejected,
            "transferAcceptedScoreable": transfer,
        },
        "concentration": {
            "acceptedMaxShare": a_share,
            "rejectedMaxShare": r_share,
            "cap": CONCENTRATION_CAP,
            "capOk": cap_ok,
        },
        "primaryRead": {
            "verdict": "DECIDABLE" if accepted >= PRIMARY_MIN_LOOK1 and rejected >= PRIMARY_MIN_LOOK1 and cap_ok
            else "UNDERPOWERED (keep collecting)",
        },
        "transferRead": {
            "state": "DECIDABLE (two-boundary)" if transfer >= TRANSFER_DECISION_MIN
            else "SUGGESTIVE (coverage-caveated)" if transfer >= TRANSFER_INTERP_MIN
            else "REPORT-ONLY (<12 source-outfits)",
        },
        "perUser": headline,
        "excluded": {"users": excluded},
    }
    return cert, sorted(representatives.values(), key=lambda c: (c.user, c.arm, c.signature))


def _assert_certificate_agreement(derived: dict[str, Any], emitted: dict[str, Any]) -> None:
    if not isinstance(emitted, dict):
        raise BundleError("manifest yield must be an object")
    for section in ("scoreableClusters", "perUser"):
        # bool and float compare equal to Python integers; certificate counts must
        # actually be integers, not merely numerically equal.
        def integer_tree_matches(expected, actual):
            if isinstance(expected, dict):
                return isinstance(actual, dict) and expected.keys() == actual.keys() and all(
                    integer_tree_matches(v, actual[k]) for k, v in expected.items()
                )
            return type(actual) is int and actual == expected
        if not integer_tree_matches(derived[section], emitted.get(section)):
            raise BundleError(f"Python/JS certificate disagreement in {section}: {derived[section]!r} != {emitted.get(section)!r}")
    concentration = emitted.get("concentration")
    if not isinstance(concentration, dict):
        raise BundleError("manifest concentration must be an object")
    for key in ("acceptedMaxShare", "rejectedMaxShare", "cap"):
        actual = concentration.get(key)
        if type(actual) not in (int, float) or not math.isfinite(actual) or abs(derived["concentration"][key] - actual) > 1e-9:
            raise BundleError(f"Python/JS concentration disagreement for {key}")
    if derived["concentration"]["capOk"] is not concentration.get("capOk"):
        raise BundleError("Python/JS concentration cap disagreement")


def _validate_rows(rows: list[dict[str, Any]]) -> None:
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            raise BundleError("training example must be an object")
        for key in ("snapshotId", "candidateId"):
            if not isinstance(row.get(key), str) or not row[key]:
                raise BundleError(f"training example requires {key}")
        if row.get("user") is not None and (not isinstance(row["user"], str) or not row["user"]):
            raise BundleError("training example user must be a nonempty string or null")
        identity = (row["snapshotId"], row["candidateId"])
        if identity in seen:
            raise BundleError("duplicate snapshot/candidate: latest-state export required")
        seen.add(identity)
        items = row.get("items")
        if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
            raise BundleError("training example items must be an array of objects")
        ids = [item.get("itemId") for item in items]
        if any(not isinstance(i, str) or not i or "|" in i for i in ids):
            raise BundleError("invalid itemId in training example")
        if len(set(ids)) != len(ids):
            raise BundleError("duplicate itemId in a candidate")
        if row.get("label") not in (None, "accepted", "rejected"):
            raise BundleError("export label must be accepted, rejected, or null")


def manifest_excluded_users(manifest: dict[str, Any]) -> set[str]:
    try:
        users = manifest["yield"]["excluded"]["users"]
    except (KeyError, TypeError) as exc:
        raise BundleError("manifest requires yield.excluded.users") from exc
    if not isinstance(users, dict) or any(
        not isinstance(user, str) or not user or not isinstance(info, dict)
        or info.get("reason") not in ("operator", "test_account")
        for user, info in users.items()
    ):
        raise BundleError("invalid excluded-user identities/reasons")
    return set(users)


def load_bundle(path: str | Path, *, require_agreement: bool = True) -> Bundle:
    root = Path(path).resolve()
    manifest_path = root / "manifest.json"
    examples_path = root / "training_examples.jsonl"
    if not manifest_path.is_file() or not examples_path.is_file():
        raise BundleError("bundle requires manifest.json and training_examples.jsonl")
    hashes = {p.name: file_sha256(p) for p in (manifest_path, examples_path)}
    manifest = _load_json(manifest_path)
    if not isinstance(manifest, dict):
        raise BundleError("manifest must be an object")
    if manifest.get("bundleVersion") != "track2-export.v1":
        raise BundleError(f"unsupported bundleVersion {manifest.get('bundleVersion')!r}")
    rows = _load_jsonl(examples_path)
    excluded = manifest_excluded_users(manifest)
    derived, clusters = derive_certificate(rows, excluded)
    if require_agreement:
        _assert_certificate_agreement(derived, manifest.get("yield") or {})
    if hashes != {p.name: file_sha256(p) for p in (manifest_path, examples_path)}:
        raise BundleError("bundle files changed while loading")
    return Bundle(root=root, manifest=manifest, rows=rows, excluded_users=excluded,
                  certificate=derived, clusters=clusters, content_hashes=hashes)
