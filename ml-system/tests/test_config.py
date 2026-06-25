"""M0-1 regression guard: pin the spec-mandated constant values.

The caps-sum assert is the load-bearing one — it stops a later edit from
silently desyncing the per-type caps from MAX_PROMPT_ITEMS (plan §3, M0-1).
"""

import pytest

from fitted_core import config


def test_candidate_and_prompt_ceilings():
    assert config.MAX_CANDIDATES == 40
    assert config.MAX_PROMPT_ITEMS == 135


def test_per_type_cap_values():
    # Pin each cap individually (v2 §10). The sum guard below alone passes under a
    # compensating drift (e.g. 36/29/... still = 135) that would change M1-3's per-type
    # 70/30 split — these values are what random_count() is tested against.
    assert config.CAP_TOPS == 35
    assert config.CAP_BOTTOMS == 30
    assert config.CAP_DRESSES == 25
    assert config.CAP_OUTER == 20
    assert config.CAP_SHOES == 25


def test_per_type_caps_sum_to_prompt_ceiling():
    caps = (
        config.CAP_TOPS,
        config.CAP_BOTTOMS,
        config.CAP_DRESSES,
        config.CAP_OUTER,
        config.CAP_SHOES,
    )
    assert sum(caps) == config.MAX_PROMPT_ITEMS


def test_sampler_constants():
    assert config.MIN_SIGNAL_THRESHOLD == 5


def test_default_k():
    assert config.DEFAULT_K == 10


def test_m3_ranker_constants():
    # M3 scoring / diversity / cooldown / window constants (v2 §14 / Appendix B), pinned
    # here per v2 §22 (one config file). Values are the single source of truth the ranker
    # and its tests are written against; a silent edit to any would shift ranking behavior.
    assert config.BASE_SCORE == 1.0
    assert config.COMBO_BOOST == 2.0
    assert config.ITEM_BOOST_WEIGHT == 0.1
    assert config.MAX_AFFINITY == 20
    assert config.DISLIKE_PENALTY == 0.5
    assert config.COOLDOWN_PENALTY == -2.0  # stored NEGATIVE (S4) — the sign is the contract
    assert config.BASEKEY_VARIANT_CAP == 2
    assert config.OVERUSE_MIN_POOL == 15
    assert config.OVERUSE_THRESHOLD == 0.40
    assert config.OVERUSE_PENALTY == 0.5
    assert config.REPETITION_PENALTY == 1.0
    assert config.DISLIKE_WINDOW_SIZE == 20
    assert config.COOLDOWN_BUFFER_SIZE == 10
    assert config.REPETITION_WINDOW_SIZE == 10


def test_m3_penalty_sign_discipline():
    # Sign discipline is load-bearing (S4): the penalties the score formula SUBTRACTS are
    # stored as positive magnitudes; only COOLDOWN_PENALTY is stored negative (added). A
    # sign-flip mutant on COOLDOWN_PENALTY (positive, or any of the magnitudes negative) fails.
    assert config.DISLIKE_PENALTY > 0
    assert config.OVERUSE_PENALTY > 0
    assert config.REPETITION_PENALTY > 0
    assert config.COOLDOWN_PENALTY < 0


# --- Spearhead rescue constants (v2 Appendix B; spearhead.md §B/§G) -------------
# These are PROVISIONAL (tuned in C6), so the C5-consumed scoring weights/taxonomies are
# guarded by type + structural invariant, not exact value — only the C2-consumed counts
# (which rescue._rescue_candidate_requested is written against) are pinned exactly.


def test_spearhead_rescue_count_constants_pinned():
    assert config.N_SURFACED == 3
    assert config.MIN_RESCUE_CANDIDATES == 6
    # The clamp in _rescue_candidate_requested inverts if the floor exceeds the cap.
    assert config.MIN_RESCUE_CANDIDATES <= config.MAX_CANDIDATES


def test_spearhead_taxonomies_present_typed_and_lowercase():
    assert isinstance(config.NEUTRAL_COLORS, frozenset)
    assert isinstance(config.BOLD_STYLE_TAGS, frozenset)
    assert isinstance(config.COLOR_FAMILIES, dict)
    assert all(isinstance(fam, frozenset) for fam in config.COLOR_FAMILIES.values())
    assert isinstance(config.FORMALITY_RANK, dict)
    assert all(isinstance(rank, int) for rank in config.FORMALITY_RANK.values())
    # Free-string lookups normalize to lowercase (§G _norm_label), so the keys must be
    # lowercase or a normalized item color/tag can never match.
    assert all(s == s.lower() for s in config.NEUTRAL_COLORS)
    assert all(s == s.lower() for s in config.BOLD_STYLE_TAGS)
    assert all(c == c.lower() for fam in config.COLOR_FAMILIES.values() for c in fam)
    assert all(k == k.lower() for k in config.FORMALITY_RANK)


def test_spearhead_formality_spread_matches_rank_table():
    # §G normalizes the formality spread by MAX_FORMALITY_SPREAD; the largest possible
    # spread is (max rank − min rank). Add a rank 6 without bumping this and the term can
    # exceed 1 before §G's clamp — this guard catches that drift.
    ranks = config.FORMALITY_RANK.values()
    assert config.MAX_FORMALITY_SPREAD == max(ranks) - min(ranks)


def test_spearhead_scoring_weights_typed_bounded_and_normalized():
    weights = (
        config.W_NEUTRAL_ANCHOR,
        config.W_COLOR_FAMILY,
        config.W_FORMALITY_COHERENCE,
        config.W_OCCASION_OVERLAP,
        config.W_CONTRAST,
        config.W_STATEMENT_TAGS,
        config.W_FORMALITY_DISTANCE,
    )
    assert all(isinstance(w, float) for w in weights)
    assert all(0.0 <= w <= 1.0 for w in weights)
    # Each scored family's weights sum to 1.0 by design (§G): the weighted sum lands in
    # [0,1] before the final clamp01. Provisional values move in C6, but re-tuning should
    # preserve this family-sum invariant (or update this guard deliberately) — same posture
    # as the caps-sum guard above.
    compat = (
        config.W_NEUTRAL_ANCHOR
        + config.W_COLOR_FAMILY
        + config.W_FORMALITY_COHERENCE
        + config.W_OCCASION_OVERLAP
    )
    visibility = config.W_CONTRAST + config.W_STATEMENT_TAGS + config.W_FORMALITY_DISTANCE
    assert compat == pytest.approx(1.0)
    assert visibility == pytest.approx(1.0)


def test_spearhead_bucket_thresholds_ordered():
    # The middle band (bridge / noticeable) exists only when the lower-bucket max sits below
    # the upper-bucket min. Pure structural invariant, independent of the provisional values.
    assert 0.0 <= config.PATH_STRETCH_MAX < config.PATH_RELIABLE_MIN <= 1.0
    assert 0.0 <= config.RISK_SAFE_MAX < config.RISK_BOLD_MIN <= 1.0


def test_spearhead_weather_band_constants():
    assert config.WEATHER_WARMTH_BAND == {"hot": (0, 3), "mild": (3, 6), "cold": (6, 10)}
    assert config.WEATHER_TARGET_BAND == {"hot": 0, "mild": 1, "cold": 2}
    assert isinstance(config.WEATHER_MISMATCH_PENALTY, float)
