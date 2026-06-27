"""SlotMap normalization + structural validity (v2 §8, §13).

Two responsibilities, split by *what a single-valued SlotMap can express*:

- ``normalize_to_slotmap`` collapses GPT's role-tagged item list
  (``[{itemId, role}]``, the v2 §12 output schema) into a named-slot SlotMap.
  It owns every reject that becomes *inexpressible* once collapsed — a **duplicate
  assignment to any role-owned slot** and an **unknown role** — because each of the
  five roles maps to exactly one slot, so a second item for an already-seen role
  would be silently overwritten (last-write-wins), emitting a valid-looking SlotMap
  with an item erased. These cannot be caught downstream; they must be caught here.

- ``is_valid_slotmap`` enforces the v2 §8 *slot-level* rules a SlotMap can hold:
  one_piece XOR two_piece base, no mixed templates, no empty base, no duplicate
  itemId across slots.

V2 §13 is the authoritative validation superset, split across three owners
(Appendix A N3): (a) duplicate role-owned slot + unknown role → here,
pre-collapse; (b) mixed templates / empty / duplicate itemId → ``is_valid_slotmap``;
(c) itemId-not-in-sampled-pool → the M2 Step-3 validator (needs the pool, which the
pure ``is_valid_slotmap(slotmap)`` signature cannot accept). Matches the legacy
route's per-role counts in ``isValidOutfitStructure`` (the per-role count block in
fitted/app/api/recommend/route.ts — legacy, slated for M5 deletion; cite by name, not
line, since it drifts).

Sources: docs/Fitted_Spec_v2.md §8/§13 / Appendix A N3,
docs/plans/m0-m1-substrate.md M0-4.
"""

from typing import Mapping, Optional, Sequence

from fitted_core.models import IssueCode, Role, SlotMap, Template

# Each role owns exactly one SlotMap slot (v2 §8). This mapping is what makes
# a second item for an already-assigned role a silent-overwrite hazard.
_ROLE_TO_SLOT = {
    Role.base_top: "top",
    Role.base_bottom: "bottom",
    Role.one_piece: "dress",
    Role.outer_layer: "outer",
    Role.shoes: "shoes",
}


def normalize_to_slotmap(
    items: Sequence[Mapping[str, object]],
) -> tuple[Optional[SlotMap], Optional[IssueCode]]:
    """Collapse a role-tagged item list into a SlotMap, with an error channel.

    ``items`` is GPT's outfit ``items`` array: a sequence of ``{itemId, role}``
    mappings (v2 §12). Returns ``(SlotMap, None)`` on success or ``(None, code)``
    when a role is unknown (``unknownRole``) or a role-owned slot would be assigned
    twice (``duplicateRoleSlot``). The second element is a stable ``IssueCode``, not
    prose (M2 plan Decision D7 — owner-emits-code): this is the single source of truth
    for these two structural rejects, consumed directly by the M2 validator.

    Scope (M0-narrow): this owns the *pre-collapse* rejects only. **Assumes M2's
    strict JSON-schema pass (v2 §12/§13, pipeline Step 2) has already run**, so each entry
    is a well-formed mapping with present fields — field-presence, non-empty-id, and
    entry-shape validation are M2's job, not here. An empty list is *not* rejected
    here (it collapses to an empty SlotMap that ``is_valid_slotmap`` rejects as
    ``emptyBase`` — N3 assigns the empty-outfit reject to the slot-level validator).
    """
    assignments: dict[str, object] = {}
    for entry in items:
        role_raw = entry.get("role")
        try:
            role = Role(role_raw)
        except ValueError:
            return None, IssueCode.unknown_role
        slot = _ROLE_TO_SLOT[role]
        if slot in assignments:
            # A second item for an already-filled role would be silently overwritten
            # (last-write-wins) — inexpressible once collapsed, so reject pre-collapse.
            return None, IssueCode.duplicate_role_slot
        assignments[slot] = entry.get("itemId")
    return SlotMap(**assignments), None


def is_valid_slotmap(slotmap: SlotMap) -> tuple[bool, Optional[IssueCode]]:
    """Structural validity over the slot-level v2 §8/§13 rules.

    Valid: (dress set, top/bottom null → one_piece) XOR (top+bottom set, dress
    null → two_piece), plus optional outer/shoes. Returns ``(True, None)`` or
    ``(False, code)`` where ``code`` is the stable structural ``IssueCode`` for the
    failing rule (M2 plan Decision D7 — owner-emits-code, not prose).
    """
    has_dress = slotmap.dress is not None
    has_top = slotmap.top is not None
    has_bottom = slotmap.bottom is not None

    if has_dress and (has_top or has_bottom):
        return False, IssueCode.mixed_template
    if not (has_dress or has_top or has_bottom):
        return False, IssueCode.empty_base
    if not has_dress and not (has_top and has_bottom):
        return False, IssueCode.incomplete_two_piece

    ids = [v for v in (slotmap.dress, slotmap.top, slotmap.bottom, slotmap.outer, slotmap.shoes)
           if v is not None]
    if len(ids) != len(set(ids)):
        return False, IssueCode.duplicate_item_id
    return True, None


def template_of(slotmap: SlotMap) -> Template:
    """Derive the template of a *valid* SlotMap (v2 §8). Raises on an invalid base."""
    valid, code = is_valid_slotmap(slotmap)
    if not valid:
        raise ValueError(f"template_of requires a valid SlotMap: {code.value}")
    return Template.one_piece if slotmap.dress is not None else Template.two_piece
