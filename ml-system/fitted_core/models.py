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


class IssueCode(Enum):
    """Stable, machine-readable codes for every M2 validation outcome (v2 §12/§13).

    Homed here — the lowest shared contract layer — because the structural rejects
    are *owned* by ``slotmap.py`` (M2 plan Decision D7: ``normalize_to_slotmap`` /
    ``is_valid_slotmap`` will return these codes), so the enum must sit in a module
    both ``slotmap.py`` and ``validator.py`` import *down* into. Putting it in
    ``validator.py`` would force an M0→M2 circular import (M2 plan §4 *Module placement*).

    **Append-only contract.** Member *values* are exactly the M2 plan §4 table
    strings; downstream M3/M5 may persist or branch on them, so never rename or
    repurpose a code without a migration. Member *names* are snake_case, values are
    camelCase log labels — same convention as ``sampler.SelectionKind``.

    Severity (rejection vs warning) is **not** stored here; it is a function of the
    code, owned by ``validator._SEVERITY`` / ``validator.severity_of`` (single source
    of truth — M2 plan §4).
    """

    # --- root / envelope (locus: root) ---
    invalid_json = "invalidJson"
    malformed_root = "malformedRoot"
    invalid_outfits = "invalidOutfits"

    # --- candidate / item schema (locus: candidate) ---
    invalid_candidate_shape = "invalidCandidateShape"
    unknown_candidate_field = "unknownCandidateField"
    forbidden_gpt_field = "forbiddenGptField"
    invalid_items = "invalidItems"
    invalid_item_shape = "invalidItemShape"
    unknown_item_field = "unknownItemField"
    invalid_item_id = "invalidItemId"
    invalid_role = "invalidRole"

    # --- SlotMap normalization / structural (owned by slotmap.py, D7) ---
    unknown_role = "unknownRole"
    duplicate_role_slot = "duplicateRoleSlot"
    mixed_template = "mixedTemplate"
    empty_base = "emptyBase"
    incomplete_two_piece = "incompleteTwoPiece"
    duplicate_item_id = "duplicateItemId"

    # --- pool membership / keys / dedup (M2 Step-3 owned) ---
    item_outside_sampled_pool = "itemOutsideSampledPool"
    # GPT's assigned role puts an item in a slot whose required ItemType the item does not have
    # (e.g. a top tagged role=base_bottom). GPT's role is untrusted (§5); the pool carries the
    # authoritative type. Distinct from item_outside_sampled_pool (the id IS in the pool).
    role_type_mismatch = "roleTypeMismatch"
    duplicate_full_signature = "duplicateFullSignature"
    key_precondition_failed = "keyPreconditionFailed"

    # --- StyleMove + aggregate (warning severity) ---
    invalid_style_move_shape = "invalidStyleMoveShape"
    style_move_item_outside_outfit = "styleMoveItemOutsideOutfit"
    duplicate_style_move_changed_ids = "duplicateStyleMoveChangedIds"
    extra_candidates_ignored = "extraCandidatesIgnored"


# The warmth band (v2 §6.1/§15.2): an INTEGER WARMTH_MIN..WARMTH_MAX, 0=coolest 10=warmest.
# Single Python home — the service wire boundary (service/app.py) enforces it via the
# service-config re-export, and the TS side (fitted/lib/warmth.ts) is pinned equal through
# contract_fields.json crossRuntime.clamps. Lives here, NOT in fitted_core/config.py: that
# module auto-hashes its UPPER_SNAKE globals into RANKER_CONFIG_VERSION, and the warmth bound
# is a data-contract fact, not ranker provenance.
WARMTH_MIN = 0
WARMTH_MAX = 10


@dataclass
class WardrobeItem:
    """A single wardrobe item (v2 §6.1).

    warmth is a WARMTH_MIN..WARMTH_MAX weather signal; material/formality are optional
    CV-derived attributes. Tags default empty because an item legitimately may carry none.
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
        if not WARMTH_MIN <= self.warmth <= WARMTH_MAX:
            raise ValueError(f"warmth must be in {WARMTH_MIN}..{WARMTH_MAX}, got {self.warmth}")


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


@dataclass(frozen=True)
class StyleMove:
    """GPT's optional styling-reasoning annotation on an outfit (v2 §6.5/§12).

    Purely a data holder for a *validated* StyleMove — M2's validator
    (``validator._validate_style_move``, lands at C5) owns the boundary checks
    (H23: ``changed_item_ids`` ⊆ outfit items) and only attaches one of these when
    it passes; an invalid StyleMove is dropped via a warning, never stored here.
    Homed in ``models.py`` (M2 plan Decision D7b) as a core contract reused by the
    M3 ranker and M5 response layer. Field names are snake_case; the M5 wire mapping
    (``moveType``/``changedItemIds``/``oneSentence``) is the adapter's job.
    """

    move_type: str
    changed_item_ids: list[str]
    one_sentence: str
