"""Deterministic seed derivation (spec §3.3, §10.4, appendix C1).

One private canonical primitive, two named wrappers — so the §3.3 session seed and
the §10.4 tie-break seed (= session seed + generationIndex) cannot drift
(spec-resolutions R1).

Encoding — **length-prefix each field, by UTF-8 byte length**, then concatenate.
A bare delimiter join collides (``join(["a", "b\\x1fc"]) == join(["a\\x1fb", "c"])``)
and both ``occasion`` (free text) and ``sessionId`` can contain any delimiter, so
the delimiter approach is unsafe. Length-prefix framing is injective for arbitrary
field content. The byte length (not Python ``len()``) is used so any other runtime
(the M5 TS adapter) reproduces the same seed for non-BMP text, where Python char
count and JS string length disagree.

``date=None`` (C1 not yet active) frames to a typed sentinel ``"-:"`` — distinct
from ``"4:None"`` (date="None"), ``"0:"`` (date=""), and ``"1:0"`` (date="0"). A
byte length is never negative, so ``-`` cannot occur in a real field's frame.

Uses ``hashlib.sha256`` (stable across processes/runs), never Python's
process-salted builtin ``hash()``. The first 8 bytes give a 64-bit seed for a
dedicated ``random.Random`` instance (never the global RNG).

Sources: spec §3.3/§10.4/C1, docs/plans/m0-m1-substrate.md M0-5, spec-resolutions R1.
"""

import hashlib
import random
from typing import Optional, Union

# Canonical input order (spec-resolutions R1):
#   sessionId, wardrobeVersion, occasion, weather, date, generationIndex
_Field = Union[str, int, None]


def _frame(value: _Field) -> str:
    """Length-prefix one field by its UTF-8 byte length; None → typed sentinel."""
    if value is None:
        return "-:"  # sentinel — no valid byte length is negative
    s = value if isinstance(value, str) else str(value)
    return f"{len(s.encode('utf-8'))}:{s}"


def _canonical_seed(
    *,
    session_id: str,
    wardrobe_version: int,
    occasion: str,
    weather: str,
    date: Optional[str],
    generation_index: Optional[int],
) -> int:
    """Private primitive — frame all six fields in canonical order, hash, truncate.

    Truncating SHA-256 to 64 bits is **not** collision-free (birthday bound); the
    framing is injective but the hash is not. This is acceptable per spec §3.3 ("no
    security requirement") — the seed only needs to be stable and well-distributed.
    """
    fields = (session_id, wardrobe_version, occasion, weather, date, generation_index)
    canonical = "".join(_frame(f) for f in fields)
    digest = hashlib.sha256(canonical.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


def session_seed(
    *,
    session_id: str,
    wardrobe_version: int,
    occasion: str,
    weather: str,
    date: Optional[str] = None,
) -> int:
    """§3.3 session seed — no generationIndex. Used by sampling (M1) and the M5 cache key.

    ``date`` defaults to None (C1 daily re-seed inactive until M5). All args are
    **keyword-only**: ``occasion`` and ``weather`` are both ``str`` and adjacent, so a
    positional swap would silently compute a *wrong but valid* seed — the one error
    class that corrupts the §3.1 determinism promise with nothing failing. Naming is
    enforced; the M5 TS adapter has no keyword-only equivalent, so it must guard the
    same field order by other means.
    """
    return _canonical_seed(
        session_id=session_id,
        wardrobe_version=wardrobe_version,
        occasion=occasion,
        weather=weather,
        date=date,
        generation_index=None,
    )


def tiebreak_seed(
    *,
    session_id: str,
    wardrobe_version: int,
    occasion: str,
    weather: str,
    date: Optional[str] = None,
    generation_index: int,
) -> int:
    """§10.4 tie-break seed — session inputs + generationIndex (used by the M3 tie-break).

    Keyword-only for the same reason as ``session_seed`` (adjacent same-typed fields).
    """
    return _canonical_seed(
        session_id=session_id,
        wardrobe_version=wardrobe_version,
        occasion=occasion,
        weather=weather,
        date=date,
        generation_index=generation_index,
    )


def seeded_rng(seed: int) -> random.Random:
    """A dedicated, reproducible RNG (never the global ``random`` module state)."""
    return random.Random(seed)
