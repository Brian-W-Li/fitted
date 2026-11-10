"""Explicit local-only replay of intact preserved drafts. No provider or synthetic fallback.

This module never reads preference labels or rewrites prose/membership. The caller
has separately verified photos; this generator pins the exact private input bytes.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat

_HEX = re.compile(r"^[a-f0-9]{24}$")
_SHA = re.compile(r"^[a-f0-9]{64}$")
_ROLES = {"base_top", "base_bottom", "mid_layer", "one_piece", "outer_layer", "shoes"}
_CHECKOUT = Path(__file__).resolve().parents[2]


def _require(condition, message):
    if not condition:
        raise ValueError("private replay: " + message)


def _keys(value, expected, message):
    _require(isinstance(value, dict) and set(value) == set(expected), message)


def _pool_ids(prompt):
    markers = ("Build believable outfits for this occasion and weather from this wardrobe:\n",
               "Wardrobe items available for these outfits (attributes are for selection only):\n")
    for marker in markers:
        if marker in prompt.user:
            rows, _ = json.JSONDecoder().raw_decode(prompt.user.split(marker, 1)[1])
            _require(isinstance(rows, list) and all(isinstance(row, dict) and isinstance(row.get("id"), str) and _HEX.fullmatch(row["id"]) for row in rows), "invalid explicit request pool")
            return {row["id"] for row in rows}
    raise ValueError("private replay: explicit wardrobe pool missing")


class PrivateReplayGenerator:
    def __init__(self, input_path, audit_path, expected_sha256):
        _require(isinstance(input_path, str) and Path(input_path).is_absolute(), "absolute input required")
        filename = Path(input_path).resolve(strict=True)
        _require(not filename.is_relative_to(_CHECKOUT), "input belongs outside checkout")
        info = filename.stat()
        _require(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077 and 0 < info.st_size <= 16*1024*1024, "private input permissions/size invalid")
        raw = filename.read_bytes()
        self.input_digest = hashlib.sha256(raw).hexdigest()
        _require(isinstance(expected_sha256, str) and _SHA.fullmatch(expected_sha256) and self.input_digest == expected_sha256, "input checksum mismatch")
        data = json.loads(raw)
        _keys(data, ("version", "provenance", "photoRoot", "wardrobe", "drafts", "factualCorrections"), "unsupported input fields")
        _require(data["version"] == "private-wardrobe-replay.v1", "unsupported schema")
        provenance = data["provenance"]
        _keys(provenance, ("kind", "capturedAt", "subsetCount", "currentClosetParity", "labelsImported", "operatorFeedbackOnly", "caveats", "sourceDigests"), "unsupported provenance")
        _require(provenance["currentClosetParity"] is False and provenance["labelsImported"] is False and provenance["operatorFeedbackOnly"] is True, "replay/feedback boundary required")
        digests = provenance["sourceDigests"]
        _require(isinstance(digests, dict) and 0 < len(digests) <= 32 and all(isinstance(value, str) and _SHA.fullmatch(value) for value in digests.values()), "source digests required")
        wardrobe = data["wardrobe"]
        _require(isinstance(wardrobe, list) and 2 <= len(wardrobe) <= 2000 and provenance["subsetCount"] == len(wardrobe), "subset mismatch")
        for item in wardrobe:
            _keys(item, ("id", "name", "clothingType", "subCategory", "colors", "pattern", "fit", "layerRole", "warmth", "isAvailable", "photoPath", "photoSha256", "photoMime"), "unsupported captured fact fields")
            _require(isinstance(item["name"], str) and 0 < len(item["name"]) <= 200 and item["clothingType"] in {"top", "bottom", "dress", "outer_layer", "shoes"}, "invalid captured garment")
            _require(all(item[field] is None or isinstance(item[field], str) and 0 < len(item[field]) <= 60 for field in ("subCategory", "pattern", "fit")), "unknowns must remain explicit")
            _require(isinstance(item["colors"], list) and len(item["colors"]) <= 25 and all(isinstance(value, str) and 0 < len(value) <= 60 for value in item["colors"]), "invalid full color set")
            _require(item["layerRole"] in (None, "base", "mid", "outer") and type(item["warmth"]) is int and 0 <= item["warmth"] <= 10 and type(item["isAvailable"]) is bool, "invalid captured role/warmth/availability")
            _require(isinstance(item["photoPath"], str) and isinstance(item["photoSha256"], str) and _SHA.fullmatch(item["photoSha256"]) and item["photoMime"] in {"image/png", "image/jpeg", "image/webp"}, "invalid captured photo metadata")
        ids = [item.get("id") for item in wardrobe if isinstance(item, dict)]
        _require(len(ids) == len(wardrobe) and all(isinstance(item, str) and _HEX.fullmatch(item) for item in ids) and len(set(ids)) == len(ids), "unique wardrobe IDs required")
        self.wardrobe_ids = set(ids)
        corrections = data["factualCorrections"]
        _require(isinstance(corrections, list) and len(corrections) <= 100 and len(json.dumps(corrections).encode()) <= 64*1024, "bounded factual corrections required")
        correction_ids = set()
        for correction in corrections:
            _require(isinstance(correction, dict), "factual correction must be a flat record")
            expected = {"correction_id", "owner_id", "garment_id", "field", "value", "source", "source_ref"}
            if "previous_value" in correction:
                expected.add("previous_value")
            _keys(correction, expected, "unsupported factual correction fields")
            limits = {"correction_id": 128, "owner_id": 128, "source": 500, "source_ref": 2000, "value": 200 if correction["field"] == "name" else 60}
            if "previous_value" in correction:
                limits["previous_value"] = 200
            for field, maximum in limits.items():
                value = correction[field]
                _require(isinstance(value, str) and 0 < len(value) <= maximum and value.strip() and not any(ord(c) < 32 and ord(c) not in (9, 10, 13) or ord(c) == 127 or 0xD800 <= ord(c) <= 0xDFFF for c in value), "factual correction values must be bounded strings")
            _require(isinstance(correction["garment_id"], str) and correction["garment_id"] in self.wardrobe_ids and isinstance(correction["field"], str) and correction["field"] in ("name", "primary_color"), "unsupported factual correction target")
            _require(correction["correction_id"] not in correction_ids, "duplicate factual correction ID")
            correction_ids.add(correction["correction_id"])
        drafts = data["drafts"]
        _require(isinstance(drafts, list) and 0 < len(drafts) <= 2000, "bounded draft bank required")
        source_ids = set()
        for draft in drafts:
            _keys(draft, ("sourceId", "sourceDigest", "jobId", "attemptIndex", "outfitIndex", "outfit"), "unsupported draft fields")
            _require(isinstance(draft["sourceId"], str) and 0 < len(draft["sourceId"]) <= 200 and draft["sourceId"] not in source_ids, "unique source ID required")
            source_ids.add(draft["sourceId"])
            _require(isinstance(draft["sourceDigest"], str) and _SHA.fullmatch(draft["sourceDigest"]) and draft["sourceDigest"] in digests.values(), "unknown source artifact")
            _require("returns" not in digests or draft["sourceDigest"] == digests["returns"], "draft must reference the preserved returns artifact")
            _require(isinstance(draft["jobId"], str) and 0 < len(draft["jobId"]) <= 200 and all(type(draft[field]) is int and draft[field] >= 0 for field in ("attemptIndex", "outfitIndex")), "source coordinates required")
            outfit = draft["outfit"]
            _keys(outfit, ("items", "styleMove"), "unsupported preserved outfit")
            _require(isinstance(outfit["items"], list) and 1 <= len(outfit["items"]) <= 5, "invalid preserved membership")
            members = set()
            for item in outfit["items"]:
                _keys(item, ("itemId", "role"), "invalid preserved member")
                _require(item["itemId"] in self.wardrobe_ids and item["itemId"] not in members and item["role"] in _ROLES, "invalid preserved member")
                members.add(item["itemId"])
            move = outfit["styleMove"]
            _keys(move, ("moveType", "changedItemIds", "oneSentence"), "invalid preserved move")
            _require(isinstance(move["moveType"], str) and isinstance(move["oneSentence"], str) and isinstance(move["changedItemIds"], list) and move["changedItemIds"] and set(move["changedItemIds"]) <= members, "invalid preserved move")
        self.drafts = drafts
        _require(isinstance(audit_path, str) and Path(audit_path).is_absolute(), "absolute private audit path required")
        self.audit_path = Path(audit_path)
        parent = self.audit_path.parent.resolve(strict=True)
        _require(not parent.is_relative_to(_CHECKOUT) and parent.is_dir() and not parent.stat().st_mode & 0o077, "audit directory must be private and outside checkout")
        _require(not self.audit_path.is_symlink(), "audit path cannot be a symlink")

    def generate(self, prompt):
        pool = _pool_ids(prompt)
        _require(pool <= self.wardrobe_ids, "request pool contains uncaptured garments")
        _require(type(prompt.candidate_requested) is int and 0 < prompt.candidate_requested <= 40, "invalid requested cap")
        seen, available = set(), []
        for draft in self.drafts:
            members = frozenset(item["itemId"] for item in draft["outfit"]["items"])
            if members <= pool and members not in seen:
                seen.add(members)
                available.append(draft)
        selected = available[:prompt.candidate_requested]  # first composition, then bounded cap
        record = {"kind": "preserved-draft-replay", "inputSha256": self.input_digest,
                  "poolSha256": hashlib.sha256(json.dumps(sorted(pool)).encode()).hexdigest(),
                  "eligibleDistinctCount": len(available), "requestedCap": prompt.candidate_requested,
                  "selected": [{**{key: row[key] for key in ("sourceId", "sourceDigest", "jobId", "attemptIndex", "outfitIndex")},
                                "outfitSha256": hashlib.sha256(json.dumps(row["outfit"], sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()} for row in selected]}
        flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(self.audit_path, flags, 0o600)
        with os.fdopen(fd, "a") as stream:
            _require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode) and not os.fstat(stream.fileno()).st_mode & 0o077, "audit file permissions invalid")
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")
        return json.dumps({"outfits": [row["outfit"] for row in selected]}, ensure_ascii=False)


def private_replay_from_environment(environment):
    filename = environment.get("FITTED_PRIVATE_REPLAY_INPUT")
    audit = environment.get("FITTED_PRIVATE_REPLAY_AUDIT")
    checksum = environment.get("FITTED_PRIVATE_REPLAY_SHA256")
    if not any((filename, audit, checksum)):
        return None
    _require(bool(filename and audit and checksum) and not environment.get("FITTED_BASELINE_ITEM_IDS"), "private replay mode must be explicit, complete and exclusive")
    return PrivateReplayGenerator(filename, audit, checksum)
