"""Named constants for the Fitted v2 recommendation substrate.

V2 Appendix B mandates that every weight and threshold live as a named constant in
one config file. These are plain module-level values (uppercase ints/floats) —
no JSON/env layer, since env-overridability is not a v2 requirement and would
only add parsing surface.

Sources:
  - docs/Fitted_Spec_v2.md §22 / Appendix B
  - docs/plans/m0-m1-substrate.md §1.5    (constant inventory)
"""

import hashlib
import json

# --- Recommendation output size ---
DEFAULT_K = 10  # v2 Appendix B — outfits returned per request

# --- Pool sampling: per-type caps (v2 §10) ---
# Each clothing type is capped before sampling so one oversized category can't
# crowd out the prompt. These caps MUST sum to MAX_PROMPT_ITEMS (regression-
# guarded in test_config.py) so the documented prompt ceiling never desyncs.
CAP_TOPS = 35
CAP_BOTTOMS = 30
CAP_DRESSES = 25
CAP_OUTER = 20
CAP_SHOES = 25

MAX_PROMPT_ITEMS = 135  # v2 §10 — total items the prompt may carry (= sum of caps)

# --- Candidate generation (v2 §10 / Appendix B) ---
MAX_CANDIDATES = 40  # max outfit candidates requested from GPT

# v2 §10's 70/30 split is NOT a config constant — it's structural, not a tunable knob (R6).
# It lives as the sampler-owned random_count(cap) helper: (cap*7+5)//10, integer half-up.

# --- Signal path ---
MIN_SIGNAL_THRESHOLD = 5  # v2 Appendix B

# --- M3 ranker: scoring · diversity · cooldown · windows (v2 §14 / Appendix B) ---
# Single home for every M3 weight, threshold, and window length (v2 §22). Sign
# discipline (S4) is load-bearing: COOLDOWN_PENALTY is stored *negative* and added by
# the formula; every other penalty is stored as a positive magnitude and *subtracted*.
# The per-outfit ScoreBreakdown then carries the already-signed delta, so a mutant that
# stores COOLDOWN_PENALTY positive (or subtracts it) must fail a test. Pinned in
# test_config.py.

# Scoring terms (§11/§14)
BASE_SCORE = 1.0  # +1.0 floor every candidate starts at
COMBO_BOOST = 2.0  # +2.0 added on a re-liked FullSignature
ITEM_BOOST_WEIGHT = 0.1  # ×0.1 per point of clamped item affinity, added
MAX_AFFINITY = 20  # upper clamp on per-item affinity before itemBoost (clamped inside M3)
DISLIKE_PENALTY = 0.5  # magnitude, subtracted per disliked item in the window (flat — S4)
COOLDOWN_PENALTY = -2.0  # stored NEGATIVE and added (S4) — for cooldown-relaxed re-admits

# Diversity (§14)
BASEKEY_VARIANT_CAP = 2  # max candidates kept per BaseKey (top-2 by pre-penalty score)
OVERUSE_MIN_POOL = 15  # overuse gate fires only when post-variant-cap survivors > this
OVERUSE_THRESHOLD = 0.40  # an item in > this fraction of survivors is "overused"
OVERUSE_PENALTY = 0.5  # magnitude, subtracted per overused item (S4)
REPETITION_PENALTY = 1.0  # flat magnitude, subtracted on a re-shown FullSignature (S4)

# Reducer-supplied window sizes (N14) — M3 guards len ≤ these and never truncates;
# the M4/M5 reducer owns windowing.
DISLIKE_WINDOW_SIZE = 20  # recent disliked item ids (dislikePenalty window, §14 "M=20")
COOLDOWN_BUFFER_SIZE = 10  # recent disliked BaseKeys (cooldown buffer, FIFO)
REPETITION_WINDOW_SIZE = 10  # recently shown FullSignatures (repetition window)

# --- Spearhead rescue (cold-start response layer, v2 Appendix B) ----------------
# Provisional C6 tuning inputs, NOT universal fashion law (spearhead.md §A/§G): their
# sole job is to position an outfit in a (path, risk) cell — they never gate/filter a
# candidate (the §G "bucket, never gate" trap-guard; structural validity is the only
# filter). The scoring forms that consume them are fixed in spearhead.md §G; only these
# weights/thresholds/taxonomies move in C6 eval. Free-string lookups go through the
# response layer's `_norm_label` (trim, lowercase, hyphen/underscore→space, collapse
# whitespace) before exact match; unmatched non-neutral colors map to "other".

# Surfaced set + rescue candidate floor (consumed by rescue.py at C2)
N_SURFACED = 3  # ways-to-wear surfaced per rescue (the 2-D (path,risk) spread target)
MIN_RESCUE_CANDIDATES = 6  # floor on the rescue candidate_requested — preserves a 3-cell
# spread on a tiny closet; clamped against MAX_CANDIDATES (must stay ≤ it, guarded below)

# Color / style taxonomies (consumed by response.py at C5)
NEUTRAL_COLORS = frozenset(
    {"black", "white", "gray", "grey", "navy", "beige", "cream", "tan", "khaki", "denim"}
)
BOLD_STYLE_TAGS = frozenset(
    {"bold", "statement", "bright", "graphic", "print", "pattern", "neon", "sequin"}
)
COLOR_FAMILIES: dict[str, frozenset[str]] = {
    "warm": frozenset(
        {"red", "orange", "yellow", "coral", "peach", "gold", "mustard", "burgundy", "maroon", "rust", "brown"}
    ),
    "cool": frozenset(
        {"blue", "green", "teal", "cyan", "purple", "violet", "lavender", "mint", "olive"}
    ),
    "pink": frozenset({"pink", "magenta", "fuchsia", "rose", "salmon"}),
}

# Formality ladder + its normalizer. MAX_FORMALITY_SPREAD MUST equal the table's
# (max rank − min rank) so the §G `spread / MAX_FORMALITY_SPREAD` term stays in [0,1]
# before the clamp — regression-guarded in test_config.py (add a rank 6 without bumping
# this and the guard fails). Unknown/None formality is unranked and never counts (§G).
FORMALITY_RANK: dict[str, int] = {
    "loungewear": 0,
    "lounge": 0,
    "casual": 1,
    "smart casual": 2,
    "business casual": 2,
    "business": 3,
    "workwear": 3,
    "formal": 4,
    "cocktail": 4,
    "black tie": 5,
}
MAX_FORMALITY_SPREAD = 5

# Cold-start scoring weights (§G). Each scored term is in [0,1]; the per-family weights
# sum to 1.0 by design, so the weighted sum lands in [0,1] before §G's final clamp01.
W_NEUTRAL_ANCHOR = 0.25  # compatibility: grounding-neutral share
W_COLOR_FAMILY = 0.25  # compatibility: color-family cohesion
W_FORMALITY_COHERENCE = 0.25  # compatibility: formality coherence (1 − spread)
W_OCCASION_OVERLAP = 0.25  # compatibility: occasion-tag overlap with the lens
W_CONTRAST = 0.4  # visibility: contrasting-pair share
W_STATEMENT_TAGS = 0.4  # visibility: statement-tag share
W_FORMALITY_DISTANCE = 0.2  # visibility: formality spread (register mixing)

# Path/risk bucket thresholds (§G / Appendix B). Ordering is structural — the STRETCH/
# SAFE max must sit below the RELIABLE/BOLD min so the middle (bridge/noticeable) band
# exists; guarded in test_config.py.
PATH_RELIABLE_MIN = 0.66  # compatibility ≥ this → reliable
PATH_STRETCH_MAX = 0.40  # compatibility ≤ this → stretch; between → bridge
RISK_BOLD_MIN = 0.66  # visibility ≥ this → bold
RISK_SAFE_MAX = 0.33  # visibility ≤ this → safe; between → noticeable

# Weather warmth bands (§G weather penalty). WARMTH_BAND bins an item's 0–10 warmth into
# 0/1/2; TARGET_BAND is the lens weather's desired band (None for indoor/outdoor → no
# penalty). Penalty = WEATHER_MISMATCH_PENALTY × max band-distance over the outfit's items.
WEATHER_WARMTH_BAND: dict[str, tuple[int, int]] = {"hot": (0, 3), "mild": (3, 6), "cold": (6, 10)}
WEATHER_TARGET_BAND: dict[str, int] = {"hot": 0, "mild": 1, "cold": 2}
WEATHER_MISMATCH_PENALTY = 0.5

# --- Provenance / versioning (M4b C4, spec §15.1 group C) ----------------------
# Every GenerationSnapshot stores a (fittedCoreVersion, promptVersion, rankerConfigVersion)
# triple so the M6 trainer never conflates behaviorally-distinct corpora. Each constant
# covers a different axis (the full policy is the comment block in fitted_core/__init__.py):
#   - fitted_core.__version__  → coarse, hand-bumped semver (substrate *logic* changes)
#   - PROMPT_VERSION           → prompt *text* changes (a reword shifts generations with no code change)
#   - RANKER_CONFIG_VERSION    → auto sha256 over THIS module's Appendix B constants (catches a
#                                one-constant tuning change __version__/PROMPT_VERSION would miss)

# Bump on ANY edit to the §D rescue prompt text (rescue._build_system_prompt /
# rescue._build_user_message — the only prompt builders today). Hand-maintained and
# orthogonal to __version__; forgetting to bump it is the silent failure the policy warns of.
PROMPT_VERSION = "spearhead-d.v1"


def _canonical_for_digest(obj: object) -> object:
    """JSON ``default`` hook: render a (frozen)set deterministically for the digest.

    Sorting makes the digest invariant to set-member iteration order. Every Appendix B
    value is a JSON primitive, a tuple of ints (json renders tuples as ordered arrays),
    a (frozen)set of strings, or a dict of those — so this single hook covers the whole
    namespace; anything else is an un-anticipated constant shape and must fail loudly.
    """
    if isinstance(obj, (frozenset, set)):
        return sorted(obj)
    raise TypeError(f"un-digestible config constant of type {type(obj).__name__}")


def _compute_ranker_config_version() -> str:
    """sha256 over every Appendix B tuning constant in this module (auto-provenance).

    Reads the module globals at *call* time so a single constant move — one a coarse
    hand-bumped ``__version__`` would miss — still shifts the digest (the spec §8.2-C
    "one-constant tuning change is still caught" guarantee; tested by monkeypatching a
    constant and recomputing). Includes only ``UPPER_SNAKE`` names; excludes the two
    version strings (``PROMPT_VERSION`` is its own axis; the digest can't include itself)
    and private/dunder names. Canonical serialization (sorted keys + ``_canonical_for_digest``)
    keeps the digest byte-stable across runs and processes.
    """
    excluded = {"PROMPT_VERSION", "RANKER_CONFIG_VERSION"}
    constants = {
        name: value
        for name, value in globals().items()
        if name.isupper() and not name.startswith("_") and name not in excluded
    }
    payload = json.dumps(constants, sort_keys=True, default=_canonical_for_digest)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


RANKER_CONFIG_VERSION = _compute_ranker_config_version()
