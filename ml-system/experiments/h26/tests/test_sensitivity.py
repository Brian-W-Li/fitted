"""Tests for the C6 sensitivity machinery (§C.5 bootstrap-p / §C.6 popularity-matched / §C.7 seeds).

Hermetic on the shared synthetic corpus + random L2 caches. The load-bearing pins: the popmatched
constructions keep EVERY §4 constraint (same fine category, anchor-no-cooccurrence, split-scoped)
and add the ±1-decile match; `bootstrap_with_replicates` reproduces `metrics.bootstrap_ci`'s exact
resample stream (the §C.5 p must come from the same replicates as the emitted CI); the seed-
robustness block copies the headline seed verbatim and reads pass/fail off the frozen gates dict.
"""

import numpy as np
import pytest

import sensitivity as sn
from baselines import cosine_edge_scorer
from data_loader import iter_positive_edges
from metrics import bootstrap_ci
from synthetic import make_cache, make_corpus


@pytest.fixture(scope="module")
def corpus():
    return make_corpus(seed=3, items_per_cat=12, n_per_split=60)


@pytest.fixture(scope="module")
def split(corpus):
    return corpus.splits["test"]


@pytest.fixture(scope="module")
def scorers(corpus):
    trained = cosine_edge_scorer(make_cache(corpus.item_index, seed=1))
    cosine = cosine_edge_scorer(make_cache(corpus.item_index, seed=2))
    return trained, cosine


# --------------------------------------------------------------------------- #
# Deciles
# --------------------------------------------------------------------------- #
def test_popularity_deciles_monotone_and_tie_stable(split):
    deciles, edges = sn.popularity_deciles(split)
    assert set(deciles) == set(split.popularity)
    assert len(edges) == 9 and edges == sorted(edges)
    for i in deciles.values():
        assert 0 <= i < sn.N_DECILES
    # value-based: equal popularity -> equal decile; higher popularity -> never a lower decile
    items = sorted(split.popularity, key=lambda x: split.popularity[x])
    for a, b in zip(items, items[1:]):
        if split.popularity[a] == split.popularity[b]:
            assert deciles[a] == deciles[b]
        else:
            assert deciles[a] <= deciles[b]


# --------------------------------------------------------------------------- #
# Popularity-matched §4 constructions
# --------------------------------------------------------------------------- #
def test_popmatched_pairwise_keeps_every_s4_constraint(split, corpus):
    deciles, _ = sn.popularity_deciles(split)
    edges, skipped = sn.build_pairwise_popmatched(split, corpus.item_index, 20260629, deciles)
    assert edges and len(edges) % 2 == 0
    positives = iter_positive_edges(split)
    for pos, neg in zip(edges[0::2], edges[1::2]):
        assert pos.label == 1 and neg.label == 0
        assert frozenset((pos.a, pos.b)) in positives
        # same fine category as the replaced partner
        assert corpus.item_index[neg.b].category_id == corpus.item_index[neg.replaced].category_id
        # anchor-no-cooccurrence + not the anchor/replaced themselves
        assert neg.b not in split.cooccur.get(neg.anchor, set())
        assert neg.b not in (neg.anchor, neg.replaced)
        # the §C.6 filter: within ±1 decile of the replaced positive partner
        assert abs(deciles[neg.b] - deciles[neg.replaced]) <= 1
    assert len(edges) // 2 + skipped == len(positives)


def test_popmatched_pairwise_skips_when_no_decile_match(corpus):
    """Force a pool where the only same-category candidates are far in popularity: the unmatched
    §4 draw would keep the edge, the matched draw must skip-and-count it."""
    from data_loader import Item, make_split_data

    idx = {
        "t_a": Item("t_a", "T1", "top", "top"),
        "t_pop": Item("t_pop", "T1", "top", "top"),
        "b_1": Item("b_1", "B1", "bottom", "bottom"),
        "b_2": Item("b_2", "B1", "bottom", "bottom"),
    }
    raw = [("s1", ["t_a", "b_1"])] + [(f"s{k}", ["t_pop", "b_2"]) for k in range(2, 12)]
    split2 = make_split_data("test", raw, idx)
    # popularity: t_a=1, t_pop=10 -> far apart in the value distribution {1,1,1,10}
    deciles, _ = sn.popularity_deciles(split2)
    assert abs(deciles["t_pop"] - deciles["t_a"]) > 1
    edges, skipped = sn.build_pairwise_popmatched(split2, idx, 7, deciles)
    # positive (t_a, b_1): replacing t_a -> only t_pop (decile-far) -> refused; replacing b_1 ->
    # only b_2, which co-occurs with... b_2 never co-occurs with t_a, but check decile: b_1=1,
    # b_2=10 -> far -> refused. positive (t_pop, b_2): replacements t_a/b_1 are decile-far too.
    assert edges == [] and skipped == len(iter_positive_edges(split2))


def test_popmatched_outfit_level_matches_each_slot(split, corpus):
    deciles, _ = sn.popularity_deciles(split)
    pairs, skipped = sn.build_outfit_level_popmatched(split, corpus.item_index, 20260629, deciles)
    assert pairs
    for op in pairs:
        assert len(op.negative) == len(op.positive)
        assert not set(op.positive) & set(op.negative)
        # the negative is built in a SHUFFLED slot order (mirroring build_outfit_level), so match
        # replacements to originals by category: the multiset is preserved and each replacement
        # sits within ±1 decile of a same-category original it could have replaced
        cat = lambda x: corpus.item_index[x].category_id  # noqa: E731
        assert sorted(map(cat, op.positive)) == sorted(map(cat, op.negative))
        for repl in op.negative:
            same_cat_originals = [o for o in op.positive if cat(o) == cat(repl)]
            assert any(abs(deciles[repl] - deciles[o]) <= 1 for o in same_cat_originals)
        # replacements mutually non-co-occurring (the §4 constructed-non-outfit rule)
        for i, a in enumerate(op.negative):
            for b in op.negative[i + 1:]:
                assert b not in split.cooccur.get(a, set())
    assert len(pairs) + skipped == len(split.outfits)


# --------------------------------------------------------------------------- #
# §C.5 bootstrap p — must ride the SAME replicate stream as metrics.bootstrap_ci
# --------------------------------------------------------------------------- #
def test_bootstrap_with_replicates_reproduces_metrics_ci():
    rng = np.random.default_rng(11)
    vals = rng.standard_normal(40) + 0.3

    def stat(idx):
        return float(vals[idx].mean())

    point, boot = sn.bootstrap_with_replicates(len(vals), stat, seed=99, b=500)
    ci = bootstrap_ci(len(vals), stat, seed=99, b=500)
    lo, hi = np.quantile(boot, [0.025, 0.975])
    assert point == ci.point and float(lo) == ci.low and float(hi) == ci.high, (
        "bootstrap_with_replicates drifted from metrics.bootstrap_ci's resample stream — the "
        "§C.5 p would no longer come from the emitted CI's distribution"
    )


def test_two_sided_boot_p():
    assert sn.two_sided_boot_p(np.array([0.1, 0.2, 0.3])) == 0.0
    assert sn.two_sided_boot_p(np.array([-1.0, 1.0])) == 1.0
    p = sn.two_sided_boot_p(np.array([-1.0, 1.0, 1.0, 1.0]))
    assert p == pytest.approx(0.5)


# --------------------------------------------------------------------------- #
# The two reported C6 blocks
# --------------------------------------------------------------------------- #
def test_compute_popularity_matched_block(split, corpus, scorers):
    trained, cosine = scorers
    block = sn.compute_popularity_matched(
        split, corpus.item_index, trained, cosine, seed=20260629, b=200
    )
    assert block["rule"] == sn.POPMATCH_RULE and block["decile_basis"] == sn.DECILE_BASIS
    assert block["n_pair_clusters_kept"] + block["n_pair_positives_skipped"] == len(
        iter_positive_edges(split)
    )
    assert block["n_outfit_pairs_kept"] + block["n_outfits_skipped"] == len(split.outfits)
    for key in ("AUC_catalog_pair_popmatched", "AUC_zero_shot_cosine_popmatched",
                "gate_A_diff_popmatched", "outfit_auc_popmatched"):
        ci = block[key]
        assert ci["low"] <= ci["point"] <= ci["high"] and ci["b"] == 200


def _gates():
    return {
        "A": {"threshold": 0.0},
        "D": {"conjuncts": [
            {"metric": "outfit_auc", "floor": 0.81},
            {"metric": "fitb_trained_full", "floor": 0.5},
        ]},
    }


def test_compute_seed_robustness_copies_headline_and_reads_gates(split, corpus, scorers):
    trained, cosine = scorers
    headline = {
        "gate_A_diff": {"point": 0.10, "low": 0.09, "high": 0.11, "b": 10000},
        "outfit_auc": {"point": 0.84, "low": 0.83, "high": 0.85, "b": 10000},
        "fitb_trained_full": {"point": 0.62, "low": 0.61, "high": 0.63, "b": 10000},
    }
    block = sn.compute_seed_robustness(
        split, corpus.item_index, trained, cosine, headline, _gates(),
        seeds=[20260629, 20260630], headline_seed=20260629, b=100,
    )
    assert block["gate_b_note"] == sn.GATE_B_SEED_NOTE
    rows = {r["seed"]: r for r in block["per_seed"]}
    assert rows[20260629]["headline"] is True
    # the headline row is COPIED from metrics.json, never recomputed
    assert rows[20260629]["gate_A_diff"] == headline["gate_A_diff"]
    assert rows[20260629]["gate_A_pass"] is True and rows[20260629]["gate_D_pass"] is True
    re_rolled = rows[20260630]
    assert re_rolled["headline"] is False
    for key in ("gate_A_diff", "outfit_auc", "fitb_trained_full"):
        ci = re_rolled[key]
        assert ci["low"] <= ci["point"] <= ci["high"]
    # pass booleans genuinely read the gates dict: a random-cosine "trained" scorer on a random
    # cache cannot clear the 0.81 outfit floor, so the re-rolled seed fails D and the verdicts
    # disagree with the synthetic passing headline
    assert re_rolled["gate_D_pass"] is False
    assert block["verdicts_agree"] is False
