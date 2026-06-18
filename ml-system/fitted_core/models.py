"""Core data contracts for the v2 substrate (§6.1, §8).

Pure data holders — no validation of inter-slot rules lives here. `type` is the
only enumerated field on a wardrobe item in the current substrate; tags are free strings.
SlotMap *validity* (one_piece XOR two_piece, etc.) is
M0-4's job in slotmap.py, deliberately kept off these structs.

Sources: docs/Fitted_Spec_v2.md §6.1/§8, docs/plans/m0-m1-substrate.md §3 (M0-2).
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class ItemType(Enum):
    """The five wardrobe types (v2 §6.1).

    Member order is load-bearing: M1 iterates types in this fixed order to keep
    RNG-consumption order stable (v2 Appendix A R4). Member *names* equal the
    wire values so the M5 Mongo adapter maps with no translation table.
    """

    top = "top"
    bottom = "bottom"
    dress = "dress"
    outer_layer = "outer_layer"
    shoes = "shoes"


class Template(Enum):
    """Outfit silhouette (v2 §8): a dress, or a top+bottom pair."""

    one_piece = "one_piece"
    two_piece = "two_piece"


class Role(Enum):
    """Slot a candidate item fills in GPT's role-tagged output (v2 §8).

    Consumed by M0-4's normalizer when collapsing an item list into a SlotMap.
    """

    base_top = "base_top"
    base_bottom = "base_bottom"
    one_piece = "one_piece"
    outer_layer = "outer_layer"
    shoes = "shoes"


@dataclass
class WardrobeItem:
    """A single wardrobe item (v2 §6.1).

    warmth is a 0–10 weather signal; material/formality are optional CV-derived
    attributes. Tags default empty because an item legitimately may carry none.
    """

    id: str
    name: str
    type: ItemType
    warmth: int
    image_url: str
    style_tags: list[str] = field(default_factory=list)
    color_tags: list[str] = field(default_factory=list)
    occasion_tags: list[str] = field(default_factory=list)
    material: Optional[str] = None
    formality: Optional[str] = None

    def __post_init__(self) -> None:
        # Two narrow guards only — this dataclass is an *internal* contract, not the
        # wire boundary. Full malformed-wire-value validation (empty ids, warmth=True,
        # bad tag containers, one predictable error channel) is the M5 Mongo adapter's
        # job, where untrusted data enters; M0 is not expanded into schema validation
        # (v2 §15 / Appendix A R12). Coerce the one enum field so a raw string `type` from
        # the adapter is rejected here; ItemType(...) raises ValueError on an unknown.
        self.type = ItemType(self.type)
        if not 0 <= self.warmth <= 10:
            raise ValueError(f"warmth must be in 0..10, got {self.warmth}")


@dataclass
class SlotMap:
    """Named-slot representation of one outfit (v2 §8).

    Each slot holds an itemId or None. A valid SlotMap is exactly one base
    template — a dress (one_piece) XOR a top+bottom pair (two_piece) — with
    optional outer/shoes. That invariant is *not* enforced here; M0-4's
    is_valid_slotmap owns it, so this struct can also hold the in-progress and
    rejected shapes the normalizer needs to reason about.
    """

    dress: Optional[str] = None
    top: Optional[str] = None
    bottom: Optional[str] = None
    outer: Optional[str] = None
    shoes: Optional[str] = None
