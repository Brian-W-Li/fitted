"""SlotMap normalization + structural validity (spec §6.3, §13).

Two responsibilities, split by *what a single-valued SlotMap can express*:

- ``normalize_to_slotmap`` collapses GPT's role-tagged item list
  (``[{itemId, role}]``, the §4.2/§16 output schema) into a named-slot SlotMap.
  It owns every reject that becomes *inexpressible* once collapsed — a **duplicate
  assignment to any role-owned slot** and an **unknown role** — because each of the
  five roles maps to exactly one slot, so a second item for an already-seen role
  would be silently overwritten (last-write-wins), emitting a valid-looking SlotMap
  with an item erased. These cannot be caught downstream; they must be caught here.

- ``is_valid_slotmap`` enforces the §6.3 *slot-level* rules a SlotMap can hold:
  one_piece XOR two_piece base, no mixed templates, no empty base, no duplicate
  itemId across slots.

§13 is the authoritative validation superset, split across three owners
(spec-resolutions N3): (a) duplicate role-owned slot + unknown role → here,
pre-collapse; (b) mixed templates / empty / duplicate itemId → ``is_valid_slotmap``;
(c) itemId-not-in-sampled-pool → the M2 Step-3 validator (needs the pool, which the
pure ``is_valid_slotmap(slotmap)`` signature cannot accept). Matches the legacy
route's per-role counts at fitted/app/api/recommend/route.ts:628-648.

Sources: spec §6.3/§13, docs/plans/m0-m1-substrate.md M0-4, spec-resolutions N3.
"""

from typing import Mapping, Optional, Sequence

from fitted_core.models import Role, SlotMap, Template

# Each role owns exactly one SlotMap slot (§6.2 → §6.3). This mapping is what makes
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
) -> tuple[Optional[SlotMap], Optional[str]]:
    """Collapse a role-tagged item list into a SlotMap, with an error channel.

    ``items`` is GPT's outfit ``items`` array: a sequence of ``{itemId, role}``
    mappings (§4.2). Returns ``(SlotMap, None)`` on success or ``(None, reason)``
    when a role is unknown or a role-owned slot would be assigned twice.

    Scope (M0-narrow): this owns the *pre-collapse* rejects only. **Assumes M2's
    strict JSON-schema pass (§8.3, pipeline Step 2) has already run**, so each entry
    is a well-formed mapping with present fields — field-presence, non-empty-id, and
    entry-shape validation are M2's job, not here. An empty list is *not* rejected
    here (it collapses to an empty SlotMap that ``is_valid_slotmap`` rejects as "no
    base role" — N3 assigns the empty-outfit reject to the slot-level validator).
    """
    assignments: dict[str, object] = {}
    for entry in items:
        role_raw = entry.get("role")
        try:
            role = Role(role_raw)
        except ValueError:
            return None, f"unknown or unrecognised role value: {role_raw!r}"
        slot = _ROLE_TO_SLOT[role]
        if slot in assignments:
            return None, (
                f"duplicate assignment to role-owned slot {slot!r} "
                f"(role {role.value!r}); the second item would be silently dropped"
            )
        assignments[slot] = entry.get("itemId")
    return SlotMap(**assignments), None


def is_valid_slotmap(slotmap: SlotMap) -> tuple[bool, Optional[str]]:
    """Structural validity over the slot-level §6.3/§13 rules.

    Valid: (dress set, top/bottom null → one_piece) XOR (top+bottom set, dress
    null → two_piece), plus optional outer/shoes. Returns ``(True, None)`` or
    ``(False, reason)``.
    """
    has_dress = slotmap.dress is not None
    has_top = slotmap.top is not None
    has_bottom = slotmap.bottom is not None

    if has_dress and (has_top or has_bottom):
        return False, "mixed templates: dress combined with top/bottom"
    if not (has_dress or has_top or has_bottom):
        return False, "no base role (empty outfit)"
    if not has_dress and not (has_top and has_bottom):
        return False, "incomplete two_piece base (need both top and bottom)"

    ids = [v for v in (slotmap.dress, slotmap.top, slotmap.bottom, slotmap.outer, slotmap.shoes)
           if v is not None]
    if len(ids) != len(set(ids)):
        return False, "duplicate itemId appearing in more than one slot"
    return True, None


def template_of(slotmap: SlotMap) -> Template:
    """Derive the template of a *valid* SlotMap (§6.1). Raises on an invalid base."""
    valid, reason = is_valid_slotmap(slotmap)
    if not valid:
        raise ValueError(f"template_of requires a valid SlotMap: {reason}")
    return Template.one_piece if slotmap.dress is not None else Template.two_piece
