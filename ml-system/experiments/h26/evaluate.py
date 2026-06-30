"""Metric-computation half of the eval driver (C3) — wiring, NO emission (§3/§6/§11/§15).

This module turns a frozen embedding cache + a strict-disjoint corpus + a trained head into the
**in-memory** CI suite the gates read: it scores the §4 eval sets (`build_pairwise` / `build_fitb` /
`build_outfit_level`) with the trained pairwise head, its zero-shot cosine floor, and the
capacity-matched item-level ablation, then runs the `metrics.py` cluster-bootstrap CIs — the gate-A
added-value, gate-D outfit-AUC + FITB, the pinned pair-level seam diff (`AUC_catalog_pair −
AUC_pair_item_level`, §C.2), and the §C.6 popularity diagnostics — plus the co-occurrence leak-detector
assertion.

**Blindness boundary (load-bearing — §1/§12/§15):** C3 is the *computation* half **only**. It returns
`MetricSuite` objects in memory and is exercised on synthetic fixtures by the tests; it **never writes
`metrics.json`, never prints an AUC/FITB value, and never commits a model number.** The held-out
test-set metric values stay sealed until the **C4 four-file unlock** (`preregistration.md` +
`preregistration.json` + `judge_addendum.md` + a validated `closet_manifest.json`) — at which point a
*separate* C4/C6 emission half (not built here) validates + hash-records the unlock files, binds the
sealed C3 `selection.json`, and first materializes `metrics.json`. Reference:
docs/plans/h26-compatibility-spike-v2.md §3 / §6 / §11 / §12 / §15 (artifact dataflow).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from baselines import (
    LeakCheck,
    cooccurrence_leak_check,
    cosine_edge_scorer,
    popularity_edge_scores,
    popularity_outfit_scores,
)
from data_loader import (
    Corpus,
    Edge,
    FitbQuestion,
    Item,
    OutfitPair,
    build_fitb,
    build_outfit_level,
    build_pairwise,
)
from embed import EmbeddingCache
from metrics import (
    CI,
    EdgeScore,
    auc_ci,
    fitb_candidate_scores,
    fitb_ci,
    fitb_hit,
    mean_edge_score,
    paired_auc_diff_ci,
)


# --------------------------------------------------------------------------- #
# Edge scoring (a trained head as an EdgeScore callable; the cosine floor lives in baselines)
# --------------------------------------------------------------------------- #
def head_edge_scorer(head, cache: EmbeddingCache, item_index: dict[str, Item]) -> EdgeScore:
    """Wrap a trained head (`PairwiseEdgeHead` or `ItemLevelHead`) into the `(i, j) -> float` callable
    `metrics.py` consumes, scoring over the frozen embeddings + the unordered type pair. The head is
    symmetric, so the per-pair score is memoized on the sorted pair (one forward per distinct edge —
    the FITB/outfit aggregations revisit edges). torch is imported lazily so the pure wiring below
    stays importable without it."""
    import torch

    from train_head import type_pair_index

    head.eval()
    memo: dict[tuple[str, str], float] = {}

    def edge(i: str, j: str) -> float:
        key = (i, j) if i <= j else (j, i)
        cached = memo.get(key)
        if cached is not None:
            return cached
        ei = torch.from_numpy(cache.vec(i)[None, :])
        ej = torch.from_numpy(cache.vec(j)[None, :])
        pair = torch.tensor([type_pair_index(item_index[i].type, item_index[j].type)])
        with torch.no_grad():
            val = float(head(ei, ej, pair).item())
        memo[key] = val
        return val

    return edge


# --------------------------------------------------------------------------- #
# Edge list -> aligned cluster scores (the §11 cluster units)
# --------------------------------------------------------------------------- #
def iter_pairwise_clusters(edges: Sequence[Edge]) -> list[tuple[Edge, Edge]]:
    """Pair `build_pairwise`'s strictly-interleaved `[pos, neg, pos, neg, …]` list into
    `(positive, negative)` clusters — the §11 pair-level bootstrap unit. Asserts the interleaving so a
    loader change that breaks it fails loud rather than silently mis-aligning the paired CIs."""
    if len(edges) % 2 != 0:
        raise ValueError(f"pairwise edges must be an even interleaved [pos, neg, …] list, got {len(edges)}")
    clusters = list(zip(edges[0::2], edges[1::2]))
    for pos, neg in clusters:
        if pos.label != 1 or neg.label != 0:
            raise ValueError("pairwise edges are not interleaved positive,negative (build_pairwise contract)")
    return clusters


def pairwise_pos_neg(edges: Sequence[Edge], edge_score: EdgeScore) -> tuple[list[float], list[float]]:
    """Aligned `(pos_scores, neg_scores)` over the pair clusters — `pos[k]`/`neg[k]` are the same
    cluster, so `auc_ci` / `paired_auc_diff_ci` resample at the (positive, negative) pair unit (§11)."""
    clusters = iter_pairwise_clusters(edges)
    pos = [edge_score(p.a, p.b) for p, _ in clusters]
    neg = [edge_score(n.a, n.b) for _, n in clusters]
    return pos, neg


def outfit_pos_neg(
    outfit_pairs: Sequence[OutfitPair], edge_score: EdgeScore
) -> tuple[list[float], list[float]]:
    """Aligned `(pos_scores, neg_scores)` for the gate-D outfit-level AUC: each outfit scored as the
    mean edge-compat over its edges (§6), positive vs its same-category-corrupted negative (§4).
    Cluster = the source outfit (§11)."""
    pos = [mean_edge_score(op.positive, edge_score) for op in outfit_pairs]
    neg = [mean_edge_score(op.negative, edge_score) for op in outfit_pairs]
    return pos, neg


def fitb_hits(questions: Sequence[FitbQuestion], edge_score: EdgeScore) -> list[float]:
    """Per-question FITB@4 credit: each candidate scored by mean edge-compat with the partial outfit,
    `fitb_hit` reads the argmax with the `1/k` tie rule (§3). Cluster = the question (§11)."""
    return [
        fitb_hit(fitb_candidate_scores(q.retained, q.candidates, edge_score), q.correct_index)
        for q in questions
    ]


# --------------------------------------------------------------------------- #
# The in-memory metric suite (NO emission — §1/§15)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class MetricSuite:
    """Every CI the gates + diagnostics read, computed in memory (NOT written to `metrics.json` —
    that unlocks at C4). Field names mirror `metrics.schema.json` so the C4 emission half maps them
    1:1. The valid-split selection metric is NOT here — it stayed sealed inside `train_head` (§1)."""

    # Gate A (added value) — pair-level
    AUC_catalog_pair: CI
    AUC_zero_shot_cosine: CI
    gate_A_diff: CI
    # Gate D (absolute floor) — outfit-level + full FITB
    outfit_auc: CI
    fitb_trained_full: CI
    # Baseline ladder readout
    fitb_zero_shot_cosine: CI
    # Seam ablation (§6/§C.2) — the pinned pair-level falsification metric + descriptive readouts
    AUC_pair_item_level: CI
    seam_diff_pairwise_minus_item_level: CI
    outfit_auc_item_level: CI
    fitb_item_level_full: CI
    # Popularity-confound diagnostics (§C.6)
    AUC_pop_edge: CI
    AUC_pop_outfit: CI
    # Co-occurrence leak detector (§C.6 — must read chance)
    leak: LeakCheck


def compute_metric_suite(
    cache: EmbeddingCache,
    corpus: Corpus,
    pairwise_head,
    item_level_head,
    *,
    seed: int,
    split: str = "test",
    b: int = 10_000,
    assert_leak: bool = True,
    leak_outfit_tol: float = 1e-3,
) -> MetricSuite:
    """Wire the held-out `split` (default test) through the §4 constructions and compute every CI the
    A/D gates + the seam ablation + the popularity diagnostics need (gate B's judge arm is C4).

    Returns an in-memory `MetricSuite` — it does **not** write `metrics.json` or print a number (the
    §1 blindness boundary; the C4 unlock owns emission). `assert_leak=True` runs the co-occurrence
    leak-detector assertion (a pure check on the *negative sampler*, independent of the model — it
    holds for any correct §4 construction), failing loud if the negatives leaked a category signal."""
    split_data = corpus.splits[split]
    item_index = corpus.item_index

    edges, _ = build_pairwise(split_data, item_index, seed)
    questions, _ = build_fitb(split_data, item_index, seed)
    outfit_pairs, _ = build_outfit_level(split_data, item_index, seed)
    clusters = iter_pairwise_clusters(edges)

    trained = head_edge_scorer(pairwise_head, cache, item_index)
    item_level = head_edge_scorer(item_level_head, cache, item_index)
    cosine = cosine_edge_scorer(cache)

    # Pair-level (gate A + the seam diff)
    pos_tr, neg_tr = pairwise_pos_neg(edges, trained)
    pos_zs, neg_zs = pairwise_pos_neg(edges, cosine)
    pos_il, neg_il = pairwise_pos_neg(edges, item_level)
    auc_catalog = auc_ci(pos_tr, neg_tr, seed=seed, b=b)
    auc_zero_shot = auc_ci(pos_zs, neg_zs, seed=seed, b=b)
    gate_a = paired_auc_diff_ci(pos_tr, neg_tr, pos_zs, neg_zs, seed=seed, b=b)
    auc_item = auc_ci(pos_il, neg_il, seed=seed, b=b)
    seam = paired_auc_diff_ci(pos_tr, neg_tr, pos_il, neg_il, seed=seed, b=b)

    # Outfit-level (gate D + item-level descriptive)
    opos_tr, oneg_tr = outfit_pos_neg(outfit_pairs, trained)
    opos_il, oneg_il = outfit_pos_neg(outfit_pairs, item_level)
    outfit_auc = auc_ci(opos_tr, oneg_tr, seed=seed, b=b)
    outfit_auc_item = auc_ci(opos_il, oneg_il, seed=seed, b=b)

    # FITB (gate D full + cosine ladder readout + item-level descriptive)
    fitb_tr = fitb_ci(fitb_hits(questions, trained), seed=seed, b=b)
    fitb_zs = fitb_ci(fitb_hits(questions, cosine), seed=seed, b=b)
    fitb_il = fitb_ci(fitb_hits(questions, item_level), seed=seed, b=b)

    # Popularity-confound diagnostics (§C.6 — no embeddings)
    pop = split_data.popularity
    pe_pos, pe_neg = popularity_edge_scores(clusters, pop)
    po_pos, po_neg = popularity_outfit_scores(outfit_pairs, pop)
    auc_pop_edge = auc_ci(pe_pos, pe_neg, seed=seed, b=b)
    auc_pop_outfit = auc_ci(po_pos, po_neg, seed=seed, b=b)

    # Leak detector (§C.6 — must read chance; a check on the negative sampler, not the model)
    leak = cooccurrence_leak_check(split_data, item_index, clusters, questions, outfit_pairs)
    if assert_leak:
        leak.assert_chance(outfit_tol=leak_outfit_tol)

    return MetricSuite(
        AUC_catalog_pair=auc_catalog,
        AUC_zero_shot_cosine=auc_zero_shot,
        gate_A_diff=gate_a,
        outfit_auc=outfit_auc,
        fitb_trained_full=fitb_tr,
        fitb_zero_shot_cosine=fitb_zs,
        AUC_pair_item_level=auc_item,
        seam_diff_pairwise_minus_item_level=seam,
        outfit_auc_item_level=outfit_auc_item,
        fitb_item_level_full=fitb_il,
        AUC_pop_edge=auc_pop_edge,
        AUC_pop_outfit=auc_pop_outfit,
        leak=leak,
    )


def main() -> None:
    """C3 stops at the metric-computation half: the wiring above is a library exercised by the tests on
    synthetic fixtures. Running it on the real cache + sealed checkpoint to materialize `metrics.json`
    (with the held-out test-set numbers) is **gated to the C4 four-file unlock** (§12/§15) — there is no
    C3 entrypoint that emits or prints a model number (the §1 blindness boundary)."""
    print(
        "[h26 C3] evaluate.py is the metric-computation half (library only). metrics.json emission + "
        "the A∧B∧D gate verdict unlock at C4 after the four unlock files validate (§12/§15). No "
        "test-set number is materialized at C3."
    )


if __name__ == "__main__":
    main()
