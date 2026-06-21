"""Named constants for the Fitted v2 recommendation substrate.

V2 Appendix B mandates that every weight and threshold live as a named constant in
one config file. These are plain module-level values (uppercase ints/floats) —
no JSON/env layer, since env-overridability is not a v2 requirement and would
only add parsing surface.

Sources:
  - docs/Fitted_Spec_v2.md §22 / Appendix B
  - docs/plans/m0-m1-substrate.md §1.5    (constant inventory)
"""

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
