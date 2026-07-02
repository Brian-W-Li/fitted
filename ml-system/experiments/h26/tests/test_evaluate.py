"""Tests for the metric-computation half of the eval driver.

Pins the cluster wiring (interleaved edges -> aligned pair clusters; outfit/FITB aggregation), the
trained-head edge scorer (symmetric + memoized + matches a direct forward), and the end-to-end
`compute_metric_suite` (valid CIs, the leak detector reads chance, the paired gate-A / seam diffs are
genuinely paired, and — the §1 blindness boundary — NO `metrics.json` is written and no number is
printed). Synthetic + deterministic. Reference:
docs/plans/h26-compatibility-spike-v2.md §3 / §6 / §11 / §12 / §15.
"""

import os

import numpy as np
import pytest
import torch
from synthetic import make_cache, make_corpus
from torch import nn

import evaluate as ev
from baselines import cosine_edge_scorer
from data_loader import Edge, FitbQuestion, OutfitPair, build_pairwise
from evaluate import (
    MetricSuite,
    compute_metric_suite,
    fitb_hits,
    head_edge_scorer,
    iter_pairwise_clusters,
    outfit_pos_neg,
    pairwise_pos_neg,
)
from metrics import CI, auc_pos_neg, paired_auc_diff_ci, unpaired_diff_ci
from train_head import ItemLevelHead, PairwiseEdgeHead

H26 = os.path.dirname(os.path.dirname(__file__))
SEED = 20260629


# --------------------------------------------------------------------------- #
# Cluster wiring
# --------------------------------------------------------------------------- #
def test_iter_pairwise_clusters_pairs_interleaved_pos_neg():
    edges = [Edge("a", "b", 1), Edge("a", "c", 0), Edge("d", "e", 1), Edge("d", "f", 0)]
    clusters = iter_pairwise_clusters(edges)
    assert len(clusters) == 2
    assert clusters[0][0].label == 1 and clusters[0][1].label == 0


def test_iter_pairwise_clusters_rejects_malformed():
    with pytest.raises(ValueError, match="even interleaved"):
        iter_pairwise_clusters([Edge("a", "b", 1)])           # odd length
    with pytest.raises(ValueError, match="interleaved positive,negative"):
        iter_pairwise_clusters([Edge("a", "b", 0), Edge("a", "c", 1)])  # wrong order


def test_pairwise_pos_neg_aligns_clusters():
    edges = [Edge("a", "b", 1), Edge("a", "c", 0)]
    weights = {("a", "b"): 0.9, ("a", "c"): 0.1}

    def edge(i, j):
        return weights[tuple(sorted((i, j)))]

    pos, neg = pairwise_pos_neg(edges, edge)
    assert pos == [0.9] and neg == [0.1]


def test_outfit_and_fitb_wiring():
    op = OutfitPair("o", positive=("a", "b"), negative=("c", "d"))
    q = FitbQuestion("o", retained=("a", "b"), candidates=("x", "y"), correct_index=0, answer_category="C")
    compat = {("a", "x"), ("b", "x")}

    def edge(i, j):
        return 1.0 if tuple(sorted((i, j))) in {tuple(sorted(p)) for p in compat} else 0.0

    pos, neg = outfit_pos_neg([op], edge)
    assert pos == [edge("a", "b")] and neg == [edge("c", "d")]
    assert fitb_hits([q], edge) == [1.0]                       # candidate x is compatible with both retained


# --------------------------------------------------------------------------- #
# Trained-head edge scorer
# --------------------------------------------------------------------------- #
class _CountingHead(nn.Module):
    def __init__(self, inner):
        super().__init__()
        self.inner = inner
        self.calls = 0

    def forward(self, ei, ej, pair):
        self.calls += 1
        return self.inner(ei, ej, pair)


def test_head_edge_scorer_matches_direct_forward_and_is_symmetric():
    corpus = make_corpus(seed=0)
    cache = make_cache(corpus.item_index)
    head = PairwiseEdgeHead()
    scorer = head_edge_scorer(head, cache, corpus.item_index)
    from train_head import type_pair_index
    a, b = cache.ids[0], cache.ids[5]
    ei = torch.from_numpy(cache.vec(a)[None, :])
    ej = torch.from_numpy(cache.vec(b)[None, :])
    pair = torch.tensor([type_pair_index(corpus.item_index[a].type, corpus.item_index[b].type)])
    with torch.no_grad():
        direct = float(head(ei, ej, pair).item())
    assert scorer(a, b) == pytest.approx(direct)
    assert scorer(a, b) == pytest.approx(scorer(b, a))         # symmetric (and memoized on the sorted pair)


def test_head_edge_scorer_memoizes_on_the_unordered_pair():
    corpus = make_corpus(seed=0)
    cache = make_cache(corpus.item_index)
    counting = _CountingHead(ItemLevelHead())
    scorer = head_edge_scorer(counting, cache, corpus.item_index)
    a, b = cache.ids[0], cache.ids[1]
    scorer(a, b)
    scorer(b, a)
    scorer(a, b)
    assert counting.calls == 1                                 # one forward per distinct unordered edge


# --------------------------------------------------------------------------- #
# End-to-end suite (NO emission — the §1 blindness boundary)
# --------------------------------------------------------------------------- #
def test_compute_metric_suite_end_to_end():
    corpus = make_corpus(seed=3)
    cache = make_cache(corpus.item_index)
    suite = compute_metric_suite(
        cache, corpus, PairwiseEdgeHead(), ItemLevelHead(), seed=SEED, split="test", b=300
    )
    assert isinstance(suite, MetricSuite)
    cis = [
        suite.AUC_catalog_pair, suite.AUC_zero_shot_cosine, suite.gate_A_diff, suite.outfit_auc,
        suite.fitb_trained_full, suite.fitb_zero_shot_cosine, suite.AUC_pair_item_level,
        suite.seam_diff_pairwise_minus_item_level, suite.outfit_auc_item_level,
        suite.fitb_item_level_full, suite.AUC_pop_edge, suite.AUC_pop_outfit,
        suite.fitb_popularity,
    ]
    for ci in cis:
        assert isinstance(ci, CI)
        assert ci.low <= ci.point <= ci.high                   # the point sits inside its interval
        assert ci.b == 300
    # the leak detector read chance (a check on the negative sampler, not the model)
    assert suite.leak.edge_auc == 0.50 and suite.leak.fitb_acc == 0.25


def test_gate_a_and_seam_diffs_are_genuinely_paired():
    # The point estimate alone is identical for a paired vs an independent-resample bootstrap, so it
    # cannot prove the gate-A / seam CIs are paired. Recompute with the SAME head and assert the suite's
    # CI is bit-identical to metrics.paired_auc_diff_ci AND differs from the unpaired form — so swapping
    # compute_metric_suite to an independent combine (which would widen CI_low and could flip a gate)
    # would FAIL here, not pass silently.
    corpus = make_corpus(seed=4)
    cache = make_cache(corpus.item_index)
    pw, il = PairwiseEdgeHead(), ItemLevelHead()
    suite = compute_metric_suite(cache, corpus, pw, il, seed=SEED, b=200)
    assert suite.gate_A_diff.point == pytest.approx(
        suite.AUC_catalog_pair.point - suite.AUC_zero_shot_cosine.point
    )
    assert suite.seam_diff_pairwise_minus_item_level.point == pytest.approx(
        suite.AUC_catalog_pair.point - suite.AUC_pair_item_level.point
    )
    # recompute gate A with the same head -> the suite must have used the PAIRED form
    edges, _ = build_pairwise(corpus.splits["test"], corpus.item_index, SEED)
    pos_tr, neg_tr = pairwise_pos_neg(edges, head_edge_scorer(pw, cache, corpus.item_index))
    pos_zs, neg_zs = pairwise_pos_neg(edges, cosine_edge_scorer(cache))
    paired = paired_auc_diff_ci(pos_tr, neg_tr, pos_zs, neg_zs, seed=SEED, b=200)
    assert suite.gate_A_diff == paired                        # bit-identical -> the suite used paired_auc_diff_ci
    px, nx, py, ny = (np.asarray(a) for a in (pos_tr, neg_tr, pos_zs, neg_zs))
    unpaired = unpaired_diff_ci(
        len(px), lambda idx: auc_pos_neg(px[idx], nx[idx]),
        len(py), lambda idx: auc_pos_neg(py[idx], ny[idx]), seed=SEED, b=200,
    )
    assert paired.point == pytest.approx(unpaired.point)      # same point...
    assert (paired.low, paired.high) != (unpaired.low, unpaired.high)  # ...different CI -> the choice is real


def test_compute_metric_suite_writes_nothing_to_metrics_json():
    # C3 is the computation half ONLY: computing the suite must not create OR modify metrics.json (the C4
    # unlock owns emission). Assert THIS CALL writes nothing — snapshot existence + mtime before/after —
    # so the guard stays valid AFTER a legitimate RUN-phase emit has committed a real metrics.json (Task 2;
    # the old unconditional "does not exist" went red the moment emit ran).
    path = os.path.join(H26, "metrics.json")
    before = (os.path.exists(path), os.path.getmtime(path) if os.path.exists(path) else None)
    corpus = make_corpus(seed=5)
    cache = make_cache(corpus.item_index)
    compute_metric_suite(cache, corpus, PairwiseEdgeHead(), ItemLevelHead(), seed=SEED, b=100)
    after = (os.path.exists(path), os.path.getmtime(path) if os.path.exists(path) else None)
    assert after == before, "compute_metric_suite must not create or modify metrics.json"


def test_evaluate_main_prints_no_number(capsys):
    import re
    ev.main()
    out = capsys.readouterr().out
    assert "C4" in out                                         # explains emission is gated to C4
    assert re.search(r"\d+\.\d+", out) is None                 # no decimal (a metric value) is printed
