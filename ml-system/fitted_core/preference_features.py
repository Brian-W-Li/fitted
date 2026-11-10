"""Captured app-traits.v1 facts; no names, images, IDs or guessed attributes.

IDs establish composition/support only. Missing groups are removed from the whole
request, never filled with a known category or scored differently per candidate.
The dictionaries, role cells and color relationship meanings are schema contents.
"""
from dataclasses import dataclass
import hashlib
import json
import re
from typing import Mapping, Sequence

FEATURE_VERSION = "app-traits.v1"
ROLES = ("top", "bottom", "mid", "outer", "shoes")
OPTIONAL_ROLES = ("mid", "outer", "shoes")
TOP_SUBTYPES = ("t_shirt", "shirt", "polo", "sweater", "sweatshirt", "hoodie",
                "cardigan", "blazer", "jacket", "coat", "turtleneck")
BOTTOM_SUBTYPES = ("jeans", "pants", "cargos", "chinos", "shorts", "skirt", "joggers")
SHOE_SUBTYPES = ("sneakers", "boots", "sandals", "dress_shoes", "loafers")
SUBTYPES = TOP_SUBTYPES + BOTTOM_SUBTYPES + ("dress", "jumpsuit") + SHOE_SUBTYPES
ROLE_SUBTYPES = {"top": TOP_SUBTYPES, "bottom": BOTTOM_SUBTYPES,
                 "mid": TOP_SUBTYPES, "outer": TOP_SUBTYPES, "shoes": SHOE_SUBTYPES}
COLORS = ("black", "white", "off_white", "cream", "beige", "tan", "khaki", "gray",
          "light_gray", "charcoal", "blue_gray", "navy", "blue", "light_blue", "denim",
          "teal", "cyan", "green", "olive", "mint", "red", "burgundy", "maroon", "orange",
          "yellow", "mustard", "pink", "magenta", "purple", "violet", "brown", "rust")
PATTERNS = ("solid", "striped", "plaid", "floral", "graphic")
FITS = ("slim", "regular", "relaxed", "oversized")
ALIASES = {"grey": "gray", "light_grey": "light_gray", "blue_grey": "blue_gray",
           "tshirt": "t_shirt", "t_shirts": "t_shirt", "dress_shoe": "dress_shoes"}
# Captured shade vocabulary, corresponding to the engine's declared neutral and
# warm/cool/pink taxonomy. light_blue is explicitly cool, never a substring guess.
NEUTRALS = frozenset(("black", "white", "gray", "navy", "beige", "cream", "tan", "khaki",
                      "denim", "off_white", "blue_gray", "light_gray", "charcoal"))
COLOR_FAMILIES = {
    "warm": frozenset(("red", "orange", "yellow", "mustard", "burgundy", "maroon", "rust", "brown")),
    "cool": frozenset(("blue", "light_blue", "green", "teal", "cyan", "purple", "violet", "mint", "olive")),
    "pink": frozenset(("pink", "magenta")),
}
RELATIONSHIPS = ("shared_exact", "both_neutral", "neutral_chromatic", "same_chromatic_family", "different_chromatic_family")


class FeatureError(ValueError):
    """Unsupported facts yield baseline; caller must not fabricate replacements."""


def normalize(value):
    if not isinstance(value, str):
        return None
    token = re.sub(r"[\s_-]+", "_", value.strip().lower())
    return ALIASES.get(token, token)


@dataclass(frozen=True)
class Channel:
    name: str
    roles: tuple[str, ...]
    groups: tuple[str, ...]


def _dictionary():
    channels = []
    for role in ROLES:
        if role in OPTIONAL_ROLES:
            channels.append(Channel(f"{role}.present", (role,), ()))
        for attribute, values in (("subtype", ROLE_SUBTYPES[role]), ("color", COLORS),
                                  ("pattern", PATTERNS), ("fit", FITS)):
            channels.extend(Channel(f"{role}.{attribute}:{value}", (role,), (f"{role}.{attribute}",))
                            for value in values)
    for left, right, attribute, values in (("top", "bottom", "fit", FITS),
                                           ("top", "mid", "fit", FITS),
                                           ("top", "bottom", "pattern", PATTERNS)):
        channels.extend(Channel(f"{left}_{right}.{attribute}:{a}/{b}", (left, right),
                                (f"{left}.{attribute}", f"{right}.{attribute}"))
                        for a in values for b in values)
    channels.extend(Channel(f"top_bottom.color:{relation}", ("top", "bottom"), ("top.color", "bottom.color"))
                    for relation in RELATIONSHIPS)
    return tuple(channels)


CHANNELS = _dictionary()
assert len(CHANNELS) <= 512
GROUPS = tuple(f"{role}.{attribute}" for role in ROLES for attribute in ("subtype", "color", "pattern", "fit"))
SCHEMA_DIGEST = hashlib.sha256(json.dumps({
    "version": FEATURE_VERSION, "channels": [(c.name, c.roles, c.groups) for c in CHANNELS],
    "aliases": ALIASES, "neutrals": sorted(NEUTRALS),
    "families": {key: sorted(value) for key, value in COLOR_FAMILIES.items()},
}, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def capture_items(raw: Sequence[Mapping]) -> dict[str, dict]:
    if not isinstance(raw, (list, tuple)) or not 2 <= len(raw) <= len(ROLES):
        raise FeatureError("unsupported_composition")
    result, ids = {}, set()
    for item in raw:
        if not isinstance(item, Mapping):
            raise FeatureError("invalid_captured_facts")
        role, ident = item.get("role"), item.get("id")
        if role not in ROLES or role in result or not isinstance(ident, str) or not ident or len(ident) > 256 or ident in ids:
            raise FeatureError("unsupported_composition")
        coarse = item.get("clothingType")
        expected = {"top": "top", "bottom": "bottom", "mid": "top", "outer": "outer_layer", "shoes": "shoes"}[role]
        if coarse is not None and coarse != expected:
            raise FeatureError("role_type_mismatch")
        subtype = normalize(item.get("subtype"))
        subtype = subtype if subtype in ROLE_SUBTYPES[role] else None
        color_input = item.get("colors")
        colors = None
        if isinstance(color_input, (list, tuple)) and 0 < len(color_input) <= 32:
            normalized = [normalize(value) for value in color_input]
            if all(color in COLORS for color in normalized):
                colors = tuple(sorted(set(normalized)))
        pattern, fit = normalize(item.get("pattern")), normalize(item.get("fit"))
        result[role] = {"id": ident, "subtype": subtype, "color": colors,
                        "pattern": pattern if pattern in PATTERNS else None,
                        "fit": fit if fit in FITS else None}
        ids.add(ident)
    if "top" not in result or "bottom" not in result:
        raise FeatureError("unsupported_composition")
    return result


def common_groups(compositions: Sequence[dict]) -> tuple[tuple[str, ...], tuple[str, ...]]:
    included = []
    for group in GROUPS:
        role, attribute = group.split(".")
        known = all(role not in composition or composition[role][attribute] is not None for composition in compositions)
        if role in ("top", "bottom") and attribute in ("subtype", "color") and not known:
            raise FeatureError("unknown_required_features")
        if known:
            included.append(group)
    return tuple(included), tuple(group for group in GROUPS if group not in included)


def encode(composition: dict, groups: Sequence[str]) -> dict[str, float]:
    """Sparse values over a request-wide projection; known absence is exactly zero."""
    groups = frozenset(groups)
    values = {}
    for role, item in composition.items():
        if role in OPTIONAL_ROLES:
            values[f"{role}.present"] = 1.0
        for attribute in ("subtype", "pattern", "fit"):
            if f"{role}.{attribute}" in groups:
                values[f"{role}.{attribute}:{item[attribute]}"] = 1.0
        if f"{role}.color" in groups:
            colors = item["color"]
            for color in colors:
                values[f"{role}.color:{color}"] = 1.0 / len(colors)
    for left, right, attribute in (("top", "bottom", "fit"), ("top", "mid", "fit"), ("top", "bottom", "pattern")):
        if left in composition and right in composition and f"{left}.{attribute}" in groups and f"{right}.{attribute}" in groups:
            values[f"{left}_{right}.{attribute}:{composition[left][attribute]}/{composition[right][attribute]}"] = 1.0
    if "top.color" in groups and "bottom.color" in groups:
        left, right = set(composition["top"]["color"]), set(composition["bottom"]["color"])
        ln, rn = left <= NEUTRALS, right <= NEUTRALS
        lf = {name for name, colors in COLOR_FAMILIES.items() if colors & left}
        rf = {name for name, colors in COLOR_FAMILIES.items() if colors & right}
        relations = {
            "shared_exact": bool(left & right), "both_neutral": ln and rn,
            "neutral_chromatic": (ln and not rn) or (rn and not ln),
            "same_chromatic_family": bool(lf & rf),
            # Known chromatic sets must be disjoint, rather than selecting an
            # arbitrary first color from a multicolor garment.
            "different_chromatic_family": bool(lf and rf and not lf & rf),
        }
        values.update({f"top_bottom.color:{name}": 1.0 for name, active in relations.items() if active})
    return values


def supported_channels(rows, vectors, labels, groups):
    """Known contrasts and >=2 distinct active garments per participating role.

    The active examples need not occur in both label classes. All retained groups
    are observed in both classes by the common projection and class-support gate.
    """
    groups = frozenset(groups)
    supported = []
    if len(set(labels)) != 2:
        return ()
    for channel in CHANNELS:
        if not set(channel.groups) <= groups:
            continue
        values = [vector.get(channel.name, 0.0) for vector in vectors]
        if not values or min(values) == max(values):
            continue
        active = [row for row, value in zip(rows, values) if value != 0.0]
        if all(len({row[role]["id"] for row in active if role in row}) >= 2 for role in channel.roles):
            supported.append(channel.name)
    return tuple(supported)
