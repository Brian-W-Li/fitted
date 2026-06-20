"""Canonical key derivation — BaseKey + FullSignature (v2 §7).

Two keys are used throughout the system and must never be substituted for each
other (v2 §7): BaseKey identifies a *silhouette* (dislike-cooldown match, variant
cap); FullSignature identifies a specific *variant* including optional outer/shoes
(deduplication). Both are computed from a SlotMap **after normalization** (v2 §7/§8)
— these functions assume an already-validated SlotMap.

Two preconditions raise ``ValueError`` (v2 Appendix A R10 — an R1-class
collision guard the spec-fixed literal key format cannot length-prefix away):

1. **Structural validity** — the SlotMap must have a valid one_piece XOR
   two_piece base (delegated to ``is_valid_slotmap``). Keys are computed inside
   pipeline Step 3, after validation; a structurally invalid base is a caller bug.
2. **Reserved-character / sentinel guard** — every *participating* itemId must
   not contain ``:``, ``|``, or ``=`` and must not equal the sentinel ``"none"``.
   Without this, ``topId="a:b", bottomId="c"`` collides with
   ``topId="a", bottomId="b:c"`` (both → ``"a:b:c"``), and an itemId literally
   equal to ``"none"`` collides a filled slot with an empty one (``|outer=none``).

Real ids are Mongo ObjectId hex (24 chars, ``[0-9a-f]``) so the guard never fires
in production (zero false-reject risk); it is the documented contract for any
future id source. See docs/Fitted_Spec_v2.md §7 / Appendix A R10.
"""

from fitted_core.models import SlotMap
from fitted_core.slotmap import is_valid_slotmap

# Reserved by the literal key format (v2 §7): the BaseKey pair separator,
# the FullSignature field separator, and the key=value separator.
_RESERVED_CHARS = (":", "|", "=")
# The literal stand-in for an unfilled optional slot (v2 §7). A real id equal to
# this would collide with an empty slot.
_NONE_SENTINEL = "none"


def _guard_id(item_id: str) -> None:
    """Raise ValueError if ``item_id`` would corrupt a key (R10 precondition 2)."""
    if item_id == _NONE_SENTINEL:
        raise ValueError(
            f"itemId equals the reserved sentinel {_NONE_SENTINEL!r}; "
            "would collide an empty optional slot with a filled one"
        )
    for ch in _RESERVED_CHARS:
        if ch in item_id:
            raise ValueError(
                f"itemId {item_id!r} contains reserved character {ch!r}; "
                "would corrupt the key string (R10)"
            )


def _require_valid_base(slotmap: SlotMap) -> None:
    """Raise ValueError if ``slotmap`` has no valid base (R10 precondition 1)."""
    valid, code = is_valid_slotmap(slotmap)
    if not valid:
        # ``is_valid_slotmap``'s second element is an IssueCode (M2 plan D7); surface
        # its human-readable .value here. This message is never asserted on.
        raise ValueError(f"keys require a normalized, valid SlotMap: {code.value}")


def base_key(slotmap: SlotMap) -> str:
    """BaseKey — the core silhouette key (v2 §7).

    one_piece → ``dressId``; two_piece → ``f"{topId}:{bottomId}"``. Excludes
    outer_layer and shoes by design (same dress + different jacket = same BaseKey).
    Guards the *base* itemId(s) only (R10).
    """
    _require_valid_base(slotmap)
    if slotmap.dress is not None:
        _guard_id(slotmap.dress)
        return slotmap.dress
    _guard_id(slotmap.top)
    _guard_id(slotmap.bottom)
    return f"{slotmap.top}:{slotmap.bottom}"


def full_signature(slotmap: SlotMap) -> str:
    """FullSignature — the variant-level key (v2 §7).

    ``BaseKey + "|outer=" + (outerId OR "none") + "|shoes=" + (shoesId OR "none")``.
    Guards base + outer + shoes itemIds (R10). Same base pairing + different
    outer = different FullSignature (the v2 §7 invariant).
    """
    bk = base_key(slotmap)  # validates the base and guards the base ids
    if slotmap.outer is not None:
        _guard_id(slotmap.outer)
    if slotmap.shoes is not None:
        _guard_id(slotmap.shoes)
    outer = slotmap.outer if slotmap.outer is not None else _NONE_SENTINEL
    shoes = slotmap.shoes if slotmap.shoes is not None else _NONE_SENTINEL
    return f"{bk}|outer={outer}|shoes={shoes}"
