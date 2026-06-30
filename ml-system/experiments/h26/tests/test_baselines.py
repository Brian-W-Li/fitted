"""Tests for the non-learned baselines + the two §C.6 sanity diagnostics.

The zero-shot cosine floor is the only baseline that isolates what training adds (gate A), and the
two diagnostics are the harness's leak/confound guards — so they are pinned with the same trust-floor
rigor as `metrics.py`. Synthetic + deterministic (a small Polyvore-shaped corpus, random L2 vectors).
Reference: docs/plans/h26-compatibility-spike-v2.md §7 / §4 / §C.6.
"""

import numpy as np
import pytest
from synthetic import make_cache, make_corpus

from baselines import (
    LeakCheck,
    category_cooccurrence_counts,
    category_cooccurrence_edge_scorer,
    cooccurrence_leak_check,
    cosine_edge_scorer,
    popularity_edge_scores,
    popularity_outfit_scores,
)
from data_loader import Edge, Item, OutfitPair, build_fitb, build_outfit_level, build_pairwise
from evaluate import iter_pairwise_clusters
from metrics import auc_pos_neg

SEED = 20260629


# --------------------------------------------------------------------------- #
# Zero-shot cosine floor
# --------------------------------------------------------------------------- #
def test_cosine_is_normalized_dot_and_symmetric():
    cache = make_cache(make_corpus(seed=0).item_index, seed=0)
    edge = cosine_edge_scorer(cache)
    a, b = cache.ids[0], cache.ids[1]
    assert edge(a, b) == pytest.approx(float(np.dot(cache.vec(a), cache.vec(b))))
    assert edge(a, b) == pytest.approx(edge(b, a))            # cosine is symmetric
    assert edge(a, a) == pytest.approx(1.0)                   # L2-normalized self-similarity == 1
    assert -1.0001 <= edge(a, b) <= 1.0001                    # bounded (cosine of unit vectors)


# --------------------------------------------------------------------------- #
# Category co-occurrence — the leak detector (must read chance by construction)
# --------------------------------------------------------------------------- #
def test_category_cooccurrence_counts_are_symmetric_unordered_pairs():
    # Two hand-built outfits sharing a top->bottom co-occurrence: the count keys on the unordered
    # category pair, so (top,bottom) and (bottom,top) are one key.
    item_index = {
        "t1": Item("t1", "TOP", "top", "top"), "b1": Item("b1", "BOT", "bottom", "bottom"),
        "t2": Item("t2", "TOP", "top", "top"), "b2": Item("b2", "BOT", "bottom", "bottom"),
    }
    from data_loader import make_split_data
    split = make_split_data("x", [("o1", ["t1", "b1"]), ("o2", ["t2", "b2"])], item_index)
    counts = category_cooccurrence_counts(split, item_index)
    assert counts[frozenset(("TOP", "BOT"))] == 2                # both outfits co-wear top+bottom
    scorer = category_cooccurrence_edge_scorer(split, item_index)
    assert scorer("t1", "b1") == scorer("b1", "t1") == 2.0       # unordered, value = the pair count


def test_cooccurrence_leak_reads_chance_on_real_negatives():
    # The load-bearing §C.6 assertion: a category-only scorer on the §4 same-fine-category negatives
    # reads chance EXACTLY (edge 0.50, FITB 0.25) and ≈chance at outfit level. A deviation would mean
    # the negative sampler leaked a category signal.
    corpus = make_corpus(seed=2)
    ii = corpus.item_index
    split = corpus.splits["test"]
    edges, _ = build_pairwise(split, ii, SEED)
    questions, _ = build_fitb(split, ii, SEED)
    outfit_pairs, _ = build_outfit_level(split, ii, SEED)
    leak = cooccurrence_leak_check(split, ii, iter_pairwise_clusters(edges), questions, outfit_pairs)
    assert leak.edge_auc == 0.50
    assert leak.fitb_acc == 0.25
    assert leak.outfit_auc == pytest.approx(0.50, abs=1e-2)
    leak.assert_chance()                                        # the assertion itself must pass


def test_leak_check_assert_chance_raises_on_deviation():
    # A leaked edge AUC (a category signal in the negatives) must fail loud, not pass silently.
    with pytest.raises(AssertionError, match="edge AUC"):
        LeakCheck(edge_auc=0.62, fitb_acc=0.25, outfit_auc=0.50).assert_chance()
    with pytest.raises(AssertionError, match="FITB"):
        LeakCheck(edge_auc=0.50, fitb_acc=0.40, outfit_auc=0.50).assert_chance()
    with pytest.raises(AssertionError, match="outfit AUC"):
        LeakCheck(edge_auc=0.50, fitb_acc=0.25, outfit_auc=0.65).assert_chance()
    LeakCheck(edge_auc=0.50, fitb_acc=0.25, outfit_auc=0.5005).assert_chance()  # within outfit tol


# --------------------------------------------------------------------------- #
# Item-popularity — the confound diagnostic (the pinned §C.6 score form)
# --------------------------------------------------------------------------- #
def test_popularity_edge_reads_varying_endpoint_not_the_anchor():
    # The §C.6 edge form: the positive's score is pop(replaced) (the original co-worn partner that the
    # negative swapped out), the negative's is pop(b') (the draw). The shared anchor (a) cancels — it
    # never enters either score even though it is more popular here.
    pos = Edge(a="anchor", b="partner", label=1)
    neg = Edge(a="anchor", b="bprime", label=0, anchor="anchor", replaced="partner")
    popularity = {"anchor": 99, "partner": 5, "bprime": 1}
    pos_s, neg_s = popularity_edge_scores([(pos, neg)], popularity)
    assert pos_s == [5.0] and neg_s == [1.0]                    # pop(partner) vs pop(bprime); anchor ignored


def test_popularity_edge_lifts_auc_when_positives_are_popular():
    # Selection bias: real co-worn partners are popular, uniform same-category negatives less so -> a
    # popularity-only score discriminates without any compatibility signal (the §4 confound the
    # co-occurrence leak detector cannot see).
    clusters = [
        (Edge("a", f"p{k}", 1), Edge("a", f"n{k}", 0, anchor="a", replaced=f"p{k}"))
        for k in range(30)
    ]
    popularity = {f"p{k}": 8 for k in range(30)} | {f"n{k}": 1 for k in range(30)}
    pos_s, neg_s = popularity_edge_scores(clusters, popularity)
    assert auc_pos_neg(pos_s, neg_s) == 1.0                     # fully separable on popularity alone


def test_popularity_edge_requires_a_negative_with_replaced():
    # A malformed negative (missing its §4 `replaced` endpoint) must fail loud — the diagnostic is
    # meaningless without the varying endpoint.
    bad = Edge(a="x", b="y", label=0)  # no anchor/replaced
    with pytest.raises(ValueError, match="replaced"):
        popularity_edge_scores([(Edge("x", "y", 1), bad)], {"x": 1, "y": 1})


def test_popularity_outfit_is_mean_item_popularity():
    op = OutfitPair(set_id="o", positive=("p1", "p2"), negative=("n1", "n2"))
    popularity = {"p1": 4, "p2": 6, "n1": 1, "n2": 3}
    pos_s, neg_s = popularity_outfit_scores([op], popularity)
    assert pos_s == [5.0] and neg_s == [2.0]                    # mean(4,6)=5 ; mean(1,3)=2


def test_popularity_handles_items_absent_from_split():
    # An item with no recorded popularity scores 0 (split-scoped, like the negatives it interrogates).
    pos_s, neg_s = popularity_outfit_scores(
        [OutfitPair("o", ("known",), ("unknown",))], {"known": 7}
    )
    assert pos_s == [7.0] and neg_s == [0.0]
