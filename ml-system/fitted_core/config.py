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

# --- Forward-declared: owned by later milestones, kept here per v2 Appendix B ---
MAX_AFFINITY = 20  # used in M3
OVERUSE_MIN_POOL = 15  # used in M3
