"""Trust-floor tests for the metric harness (§3): a wrong metric silently corrupts the whole
result, so every estimator is pinned against a known answer, the two chance-by-construction
sanity properties are asserted exactly, and the bootstrap's paired-vs-unpaired shape is proven.

All synthetic + deterministic (no dataset, no model). The one cross-check against sklearn skips
cleanly when sklearn is absent (hermetic CI). Reference: docs/plans/h26-compatibility-spike-v2.md
§3 (metrics) / §11 (statistics) / §15 (the C2 test list).
"""

import numpy as np
import pytest

from metrics import (
    CI,
    auc_ci,
    auc_pos_neg,
    bootstrap_ci,
    fitb_accuracy,
    fitb_candidate_scores,
    fitb_ci,
    fitb_hit,
    mean_edge_score,
    paired_auc_diff_ci,
    paired_fitb_diff_ci,
    roc_auc,
    unpaired_diff_ci,
)


# --------------------------------------------------------------------------- #
# Pooled AUC — known answers
# --------------------------------------------------------------------------- #
def test_auc_perfect_separation_is_one():
    assert auc_pos_neg([3.0, 4.0, 5.0], [0.0, 1.0, 2.0]) == 1.0


def test_auc_inverted_separation_is_zero():
    assert auc_pos_neg([0.0, 1.0, 2.0], [3.0, 4.0, 5.0]) == 0.0


def test_auc_identical_multisets_is_exactly_half():
    # Two identical score multisets -> AUC is exactly 0.5 (the tie-averaged-rank guarantee). This
    # is the algebra the co-occurrence-is-chance assertion rests on.
    assert auc_pos_neg([1.0, 2.0, 3.0], [3.0, 2.0, 1.0]) == 0.5


def test_auc_single_tie_counts_half():
    # One positive tied with the single negative -> 0.5; a clean win -> 1.0. Confirms ties = 0.5.
    assert auc_pos_neg([1.0], [1.0]) == 0.5
    assert auc_pos_neg([2.0], [1.0]) == 1.0


def test_auc_random_scores_near_half():
    rng = np.random.default_rng(0)
    pos = rng.normal(size=4000)
    neg = rng.normal(size=4000)
    assert 0.47 < auc_pos_neg(pos, neg) < 0.53


def test_roc_auc_label_entry_matches_pos_neg():
    scores = [5.0, 4.0, 3.0, 2.0, 1.0, 0.0]
    labels = [1, 0, 1, 0, 1, 0]
    assert roc_auc(scores, labels) == auc_pos_neg([5.0, 3.0, 1.0], [4.0, 2.0, 0.0])


def test_roc_auc_rejects_stray_labels():
    with pytest.raises(ValueError):
        roc_auc([0.1, 0.2, 0.3], [0, 1, 2])   # a stray label must not be silently dropped


def test_auc_rejects_degenerate_input():
    with pytest.raises(ValueError):
        auc_pos_neg([1.0, 2.0], [])           # no negatives
    with pytest.raises(ValueError):
        auc_pos_neg([], [1.0])                # no positives
    with pytest.raises(ValueError):
        auc_pos_neg([1.0, np.inf], [0.0])     # non-finite


def test_auc_matches_sklearn():
    sklearn_metrics = pytest.importorskip("sklearn.metrics")
    rng = np.random.default_rng(7)
    scores = rng.normal(size=500)
    labels = rng.integers(0, 2, size=500)
    if labels.sum() in (0, len(labels)):  # guarantee both classes
        labels[0], labels[1] = 0, 1
    assert roc_auc(scores, labels) == pytest.approx(
        sklearn_metrics.roc_auc_score(labels, scores), abs=1e-9
    )


# --------------------------------------------------------------------------- #
# FITB@4 — the 1/k tie rule
# --------------------------------------------------------------------------- #
def test_fitb_unique_winner():
    assert fitb_hit([0.1, 0.9, 0.2, 0.3], correct_index=1) == 1.0
    assert fitb_hit([0.1, 0.9, 0.2, 0.3], correct_index=0) == 0.0


def test_fitb_two_way_tie_scores_half():
    assert fitb_hit([0.9, 0.9, 0.2, 0.3], correct_index=0) == 0.5
    assert fitb_hit([0.9, 0.9, 0.2, 0.3], correct_index=1) == 0.5
    assert fitb_hit([0.9, 0.9, 0.2, 0.3], correct_index=2) == 0.0


def test_fitb_all_tied_is_exactly_chance():
    # The deterministic chance score: an all-tied @4 question is exactly 0.25 regardless of where
    # the correct answer sits, so a category-only / co-occurrence scorer can never beat chance by
    # leaking candidate order (§3/§4).
    for correct in range(4):
        assert fitb_hit([0.5, 0.5, 0.5, 0.5], correct_index=correct) == 0.25


def test_fitb_rejects_bad_index_and_nonfinite():
    with pytest.raises(ValueError):
        fitb_hit([0.1, 0.2, 0.3, 0.4], correct_index=4)
    with pytest.raises(ValueError):
        fitb_hit([0.1, np.nan, 0.3, 0.4], correct_index=0)


def test_fitb_accuracy_is_the_mean_and_guards_empty():
    assert fitb_accuracy([1.0, 0.0, 0.5, 0.25]) == pytest.approx(0.4375)
    with pytest.raises(ValueError):
        fitb_accuracy([])
    with pytest.raises(ValueError):
        fitb_accuracy([1.0, np.nan])
    with pytest.raises(ValueError):
        fitb_accuracy([1.0, np.inf])


def test_fitb_ci_brackets_point_reproduces_and_has_real_width():
    # fitb_ci generates the gate-D `CI_low(fitb_trained_full) >= 50%` interval (§12) — a decision
    # CI, so it must be tested with teeth. The strictly-positive-width assertion is the
    # mutation-killer: a wrapper that forgets the resample (hits.mean() instead of
    # hits[idx].mean()) yields a degenerate zero-width CI and would silently mis-gate D.
    hits = np.array([1.0, 1.0, 0.5, 0.0, 0.25, 1.0, 0.0, 0.5, 1.0, 0.0])   # non-constant
    ci_a = fitb_ci(hits, seed=4, b=600)
    ci_b = fitb_ci(hits, seed=4, b=600)
    assert ci_a == ci_b                                  # seed-reproducible
    assert ci_a.point == pytest.approx(hits.mean())      # point = the plain FITB accuracy
    assert ci_a.low <= ci_a.point <= ci_a.high
    assert ci_a.high - ci_a.low > 0.0                    # the resample actually varies the mean
    assert fitb_ci(hits, seed=5, b=600) != ci_a          # a different seed re-rolls the resamples


def test_fitb_ci_constant_hits_collapse_to_zero_width():
    # The complementary anchor: if every question scores the same, there is genuinely no sampling
    # variance, so the CI collapses to the point. (Confirms the width above comes from the data,
    # not from spurious noise in the estimator.)
    ci = fitb_ci(np.full(20, 0.25), seed=1, b=300)
    assert ci.low == ci.high == ci.point == 0.25


def test_fitb_ci_rejects_nonfinite_hits():
    with pytest.raises(ValueError):
        fitb_ci([1.0, np.nan], seed=1, b=10)
    with pytest.raises(ValueError):
        paired_fitb_diff_ci([1.0, 0.0], [1.0, np.inf], seed=1, b=10)


# --------------------------------------------------------------------------- #
# Edge -> outfit / FITB aggregation
# --------------------------------------------------------------------------- #
def test_mean_edge_score_averages_all_pairs():
    # 3 items -> 3 edges. edge_score returns a fixed lookup; mean is the plain average.
    weights = {("a", "b"): 1.0, ("a", "c"): 2.0, ("b", "c"): 3.0}

    def edge(i, j):
        return weights[tuple(sorted((i, j)))]

    assert mean_edge_score(["a", "b", "c"], edge) == pytest.approx(2.0)


def test_mean_edge_score_requires_an_edge():
    with pytest.raises(ValueError):
        mean_edge_score(["solo"], lambda i, j: 1.0)


def test_fitb_candidate_scores_then_hit_picks_compatible():
    # A "true partner" edge scorer: candidate c2 is compatible with both retained items, the
    # others are not. fitb_candidate_scores -> argmax must land on c2.
    compat = {("r1", "c2"), ("r2", "c2")}

    def edge(i, j):
        return 1.0 if tuple(sorted((i, j))) in {tuple(sorted(p)) for p in compat} else 0.0

    scores = fitb_candidate_scores(["r1", "r2"], ["c0", "c1", "c2", "c3"], edge)
    assert scores == [0.0, 0.0, 1.0, 0.0]
    assert fitb_hit(scores, correct_index=2) == 1.0


def test_fitb_candidate_scores_requires_retained():
    with pytest.raises(ValueError):
        fitb_candidate_scores([], ["c0", "c1"], lambda i, j: 1.0)


# --------------------------------------------------------------------------- #
# Chance-by-construction sanity (§4) — exact, both units
# --------------------------------------------------------------------------- #
def _category_only_edge(cat_of):
    """An edge scorer that is a pure function of the unordered category pair (the §4
    co-occurrence/category-popularity family). It carries ZERO item-level compatibility signal, so
    on same-category-multiset negatives it MUST land at chance."""
    def edge(i, j):
        key = tuple(sorted((cat_of[i], cat_of[j])))
        # deterministic per-category-pair value (arbitrary but fixed, run-independent)
        return sum(ord(ch) for ch in "".join(key)) / 100.0

    return edge


def test_pairwise_category_only_score_is_exactly_chance():
    # Each cluster: positive {a,b} vs negative {a,b'} with b' same category as b -> identical
    # category pair -> identical category-only score. The pos and neg pools are identical multisets
    # -> pooled AUC is exactly 0.5. (A deviation reveals category leakage in the negative sampler.)
    cat_of = {"a1": "T", "b1": "B", "b1x": "B", "a2": "T", "b2": "B", "b2x": "B", "s1": "S", "s1x": "S"}
    edge = _category_only_edge(cat_of)
    clusters = [(("a1", "b1"), ("a1", "b1x")), (("a2", "b2"), ("a2", "b2x")), (("a1", "s1"), ("a1", "s1x"))]
    pos = [edge(*p) for p, _ in clusters]
    neg = [edge(*n) for _, n in clusters]
    assert auc_pos_neg(pos, neg) == 0.5


def test_outfit_level_category_only_score_is_exactly_chance():
    # The gate-D leak detector: a category-multiset-preserving corruption scored by a category-only
    # edge function gives identical positive/negative outfit scores -> outfit AUC exactly 0.5.
    cat_of = {
        "t1": "T", "b1": "B", "s1": "S", "t1x": "T", "b1x": "B", "s1x": "S",
        "t2": "T", "b2": "B", "t2x": "T", "b2x": "B",
    }
    edge = _category_only_edge(cat_of)
    outfit_pairs = [
        (("t1", "b1", "s1"), ("t1x", "b1x", "s1x")),   # multiset {T,B,S} preserved
        (("t2", "b2"), ("t2x", "b2x")),                # multiset {T,B} preserved
    ]
    pos = [mean_edge_score(p, edge) for p, _ in outfit_pairs]
    neg = [mean_edge_score(n, edge) for _, n in outfit_pairs]
    assert auc_pos_neg(pos, neg) == 0.5


def test_fitb_category_only_score_is_exactly_chance():
    # The FITB analog of the pair/outfit leak detectors: same-category candidates scored by a
    # category-only edge function all tie -> 0.25, the chance-by-construction value the prereg
    # freezes (metrics.schema fitb_cooccurrence ~= 0.25). Composes _category_only_edge THROUGH
    # fitb_candidate_scores so a tie-handling regression in the scorer is caught end-to-end, not
    # just in fitb_hit's hand-built array (the symmetry the pair/outfit detectors already have).
    cat_of = {"r1": "T", "r2": "B", "c0": "S", "c1": "S", "c2": "S", "c3": "S"}
    edge = _category_only_edge(cat_of)
    scores = fitb_candidate_scores(["r1", "r2"], ["c0", "c1", "c2", "c3"], edge)
    assert len(set(scores)) == 1   # all four same-category candidates score identically -> tie
    for correct in range(4):
        assert fitb_hit(scores, correct_index=correct) == 0.25


def test_item_popularity_signal_lifts_auc_above_chance():
    # Item-popularity is NOT chance-by-construction (§4): a real co-worn positive partner is
    # selection-biased toward popular items, a uniform same-category negative is on average less
    # popular -> a popularity-only score discriminates WITHOUT compatibility signal. Here the
    # positive item always outranks its negative -> AUC > 0.5. This is the confound the
    # co-occurrence assertion above CANNOT see, motivating the separate item-popularity baseline.
    popularity = {"p_hi": 9.0, "p_lo": 1.0}
    pos = [popularity["p_hi"]] * 20    # positives = popular items
    neg = [popularity["p_lo"]] * 20    # negatives = unpopular items
    assert auc_pos_neg(pos, neg) == 1.0   # fully separable on popularity alone
    # and a milder, noisy version still sits clearly above chance
    rng = np.random.default_rng(1)
    pos2 = 6.0 + rng.normal(size=300)
    neg2 = 4.0 + rng.normal(size=300)
    assert auc_pos_neg(pos2, neg2) > 0.6


# --------------------------------------------------------------------------- #
# Cluster bootstrap — shape, reproducibility, paired vs unpaired
# --------------------------------------------------------------------------- #
def test_bootstrap_ci_brackets_point_and_is_reproducible():
    pos = np.linspace(1.0, 2.0, 40)
    neg = np.linspace(0.0, 1.0, 40)
    ci_a = auc_ci(pos, neg, seed=3, b=500)
    ci_b = auc_ci(pos, neg, seed=3, b=500)
    assert ci_a == ci_b                              # same seed -> identical CI
    assert ci_a.low <= ci_a.point <= ci_a.high       # the point sits inside its interval
    assert ci_a.b == 500
    assert auc_ci(pos, neg, seed=4, b=500) != ci_a   # a different seed re-rolls the resamples


def test_bootstrap_ci_validates_inputs():
    with pytest.raises(ValueError):
        bootstrap_ci(0, lambda idx: 0.0, seed=1, b=10)
    with pytest.raises(ValueError):
        auc_ci([1.0, 2.0], [0.0], seed=1, b=10)       # non-1:1 clusters


def test_ci_helpers_straddle_and_half_width():
    ci = CI(point=0.85, low=0.82, high=0.88, b=10_000)
    assert ci.half_width == pytest.approx(0.03)
    assert ci.straddles(0.85) and ci.straddles(0.82) and ci.straddles(0.88)
    assert not ci.straddles(0.90)                    # wholly below -> would PASS a >= gate
    assert not ci.straddles(0.80)                    # wholly above


def test_paired_diff_is_zero_for_identical_models_but_unpaired_is_not():
    # The crisp paired-vs-unpaired contrast: two IDENTICAL models. A paired (shared-resample) diff
    # is exactly 0 on every replicate -> a zero-width CI at 0. An unpaired (independent-resample)
    # diff of the same model against itself has real spread -> a strictly wider, straddling CI.
    # This is why gates A/B use the paired form (§11): pairing removes the shared-data variance.
    pos = np.linspace(1.0, 3.0, 50)
    neg = np.linspace(0.0, 2.0, 50)
    paired = paired_auc_diff_ci(pos, neg, pos, neg, seed=2, b=800)
    assert paired.point == 0.0
    assert paired.half_width == 0.0                  # shared resample -> stat_x(idx) == stat_y(idx)

    def auc_stat(idx):
        return auc_pos_neg(pos[idx], neg[idx])

    unpaired = unpaired_diff_ci(len(pos), auc_stat, len(pos), auc_stat, seed=2, b=800)
    assert unpaired.point == 0.0
    assert unpaired.half_width > 0.0                 # independent resamples -> nonzero spread
    assert unpaired.half_width > paired.half_width


def test_paired_tightens_ci_under_partial_correlation():
    # Beyond the identical-model extreme above: when two FITB hit-vectors share a latent
    # per-question difficulty (the realistic gate case), the paired (shared-resample) difference
    # cancels the shared component and is strictly tighter than an unpaired (independent-resample)
    # difference — the actual reason §11 mandates pairing for gates A/B.
    rng = np.random.default_rng(0)
    d = rng.random(300)                       # shared per-question difficulty in [0, 1]
    trained = d                               # both are valid hit-rate vectors...
    judge = 0.8 * d                           # ...sharing the latent d (positively-correlated diff)
    paired = paired_fitb_diff_ci(trained, judge, seed=11, b=1500)

    def mean_x(idx):
        return float(trained[idx].mean())

    def mean_y(idx):
        return float(judge[idx].mean())

    unpaired = unpaired_diff_ci(len(trained), mean_x, len(judge), mean_y, seed=11, b=1500)
    assert paired.point == pytest.approx(unpaired.point)     # identical point estimate
    assert paired.half_width < unpaired.half_width           # pairing removes the shared variance


def test_paired_fitb_diff_shape():
    # Trained head beats a chance-level judge: per-question hits 1.0 vs ~0.25. The paired
    # difference CI must sit wholly above 0 (so a >= -delta non-inferiority gate passes clearly).
    rng = np.random.default_rng(5)
    n = 200
    trained = np.ones(n)                              # always right
    judge = (rng.random(n) < 0.25).astype(float)     # chance-level
    ci = paired_fitb_diff_ci(trained, judge, seed=9, b=800)
    assert ci.low > 0.0
    assert ci.point == pytest.approx((trained - judge).mean())


def test_paired_diff_requires_aligned_arrays():
    with pytest.raises(ValueError):
        paired_auc_diff_ci([1.0, 2.0], [0.0, 0.5], [1.0], [0.0], seed=1, b=10)
    with pytest.raises(ValueError):
        paired_fitb_diff_ci([1.0, 0.0, 1.0], [1.0, 0.0], seed=1, b=10)
