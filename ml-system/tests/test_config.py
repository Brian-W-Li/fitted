"""M0-1 regression guard: pin the spec-mandated constant values.

The caps-sum assert is the load-bearing one — it stops a later edit from
silently desyncing the per-type caps from MAX_PROMPT_ITEMS (plan §3, M0-1).
"""

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


def test_forward_declared_constants():
    # Owned by M3 but pinned here per v2 §22 (one config file). Without this guard an
    # accidental edit to either value passes today — no test references them yet.
    assert config.MAX_AFFINITY == 20
    assert config.OVERUSE_MIN_POOL == 15
