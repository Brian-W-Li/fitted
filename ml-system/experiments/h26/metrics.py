"""The H26 metric harness — the result's trust floor (§3).

A wrong metric silently corrupts the whole spike, so this module is small, pure, and heavily
unit-tested (`tests/test_metrics.py`). It owns exactly four things the build doc (§3/§6/§11)
pins:

  1. **Pooled pair-level ROC-AUC** — the Mann-Whitney U estimator over the FLAT pooled array of
     all positive and all negative scores, *never* a per-outfit-averaged AUC (with one positive
     and one negative per outfit that degenerates to matched-pair accuracy and discards every
     cross-pair comparison). Chance 0.50; ties count 0.5.
  2. **Outfit-level ROC-AUC** (gate D) — the same pooled estimator, fed outfit scores that are the
     **mean edge-compat over the outfit's edges** (`mean_edge_score`); a positive outfit vs its one
     same-category-multiset-corrupted negative (§4), cluster-bootstrapped at the source-outfit unit.
  3. **FITB@4** — top-1 accuracy choosing the held-out item as the candidate maximizing mean
     edge-compat with the partial outfit; a `k`-way top tie scores `1/k` (deterministic,
     seed-independent — so a category-only score lands exactly at chance, 0.25, and never leaks
     candidate-order signal).
  4. **Cluster bootstrap** — percentile CIs (B = 10,000 by default) resampled at the
     outfit/question/pair unit (§11), with paired (shared-resample) and unpaired (independent-
     resample) difference forms for the gate CIs.

Everything here operates on already-computed *scores* or a caller-supplied `edge_score(i, j)`
callable; it imports no model and no dataset, so the harness is testable in isolation. Reference:
`docs/plans/h26-compatibility-spike-v2.md` §3 (metrics) / §6 (aggregation) / §11 (statistics).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

import numpy as np
from scipy.stats import rankdata

# An edge scorer maps an unordered item pair to a compatibility float. The harness never assumes
# symmetry here — the trained head symmetrizes (§6); the metric just consumes the callable.
EdgeScore = Callable[[str, str], float]


# --------------------------------------------------------------------------- #
# Point metrics
# --------------------------------------------------------------------------- #
def auc_pos_neg(pos_scores: Sequence[float], neg_scores: Sequence[float]) -> float:
    """Pooled pair-level ROC-AUC = Mann-Whitney U / (n_pos * n_neg) = P(random positive scores
    above a random negative), over the flat pool of every positive vs every negative. Ties count
    0.5 (tie-averaged ranks); chance = 0.50; perfect separation = 1.0.

    This is the §3 estimator for BOTH the pair-level AUC (gate A + the reported transfer) and — fed
    outfit scores — the outfit-level AUC (gate D). It is deliberately NOT averaged within
    (positive, negative) pairs."""
    pos = np.asarray(pos_scores, dtype=float)
    neg = np.asarray(neg_scores, dtype=float)
    n_pos, n_neg = len(pos), len(neg)
    if n_pos == 0 or n_neg == 0:
        raise ValueError("AUC needs at least one positive and one negative score")
    if not (np.isfinite(pos).all() and np.isfinite(neg).all()):
        raise ValueError("AUC scores must be finite")
    # Mann-Whitney U from the rank sum of the positives, with tie-averaged ranks (so a tie between
    # a positive and a negative contributes exactly 0.5).
    ranks = rankdata(np.concatenate([pos, neg]))  # method="average" by default
    rank_sum_pos = ranks[:n_pos].sum()
    return float((rank_sum_pos - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg))


def roc_auc(scores: Sequence[float], labels: Sequence[int]) -> float:
    """Pooled ROC-AUC for a labelled score array (label 1 = positive, 0 = negative). Thin entry
    over `auc_pos_neg` for callers holding a flat (scores, labels) pair."""
    scores = np.asarray(scores, dtype=float)
    labels = np.asarray(labels)
    # Reject anything that is not strictly a 0/1 label — silently dropping a stray label is exactly
    # the kind of corruption the §3 trust floor exists to catch.
    if not np.isin(labels, (0, 1)).all():
        raise ValueError("roc_auc labels must all be 0 or 1")
    return auc_pos_neg(scores[labels == 1], scores[labels == 0])


def fitb_hit(candidate_scores: Sequence[float], correct_index: int) -> float:
    """FITB@4 per-question credit: 1.0 if the correct candidate uniquely tops, `1/k` if it is one
    of a `k`-way top tie (so an all-tied question scores exactly 1/len(candidates) — 0.25 at @4 —
    deterministically, never leaking candidate order), 0.0 otherwise. Ties are exact-equality."""
    scores = np.asarray(candidate_scores, dtype=float)
    if not 0 <= correct_index < len(scores):
        raise ValueError(f"correct_index {correct_index} out of range for {len(scores)} candidates")
    if not np.isfinite(scores).all():
        raise ValueError("FITB candidate scores must be finite")
    winners = np.flatnonzero(scores == scores.max())
    return 1.0 / len(winners) if correct_index in winners else 0.0


def fitb_accuracy(per_question_hits: Sequence[float]) -> float:
    """Mean FITB@4 credit over questions (the gate-B / gate-D scalar; chance 0.25 at @4)."""
    hits = np.asarray(per_question_hits, dtype=float)
    if len(hits) == 0:
        raise ValueError("FITB accuracy needs at least one question")
    if not np.isfinite(hits).all():
        raise ValueError("FITB hits must be finite")
    return float(hits.mean())


# --------------------------------------------------------------------------- #
# Edge -> outfit / FITB aggregation (§6: "outfit score = mean over edges")
# --------------------------------------------------------------------------- #
def mean_edge_score(item_ids: Sequence[str], edge_score: EdgeScore) -> float:
    """Outfit compatibility = mean edge-compat over the outfit's C(n,2) unordered edges (§6). The
    gate-D outfit-level AUC scores a positive outfit and its corrupted negative this way.

    FP trap-guard: the sum is floating-point-order-dependent. A category-multiset-preserving
    corruption (§4) is built in a *shuffled* item order, so a category-only score's positive and
    negative outfit scores agree only to ~1e-16, not bit-exactly — the outfit-level
    chance-by-construction leak detector reads ≈0.50, never `== 0.50` (matching §3's "≈0.50"). A
    real-data leak assertion must therefore use a tolerance well under any real leak (e.g. 1e-3),
    not exact equality. Irrelevant to real results: a trained head never produces exact outfit
    ties, so summation order does not move the gate-D AUC."""
    ids = list(item_ids)
    if len(ids) < 2:
        raise ValueError("an outfit needs >= 2 items to have an edge")
    total = 0.0
    n_edges = 0
    for a in range(len(ids)):
        for b in range(a + 1, len(ids)):
            total += edge_score(ids[a], ids[b])
            n_edges += 1
    return total / n_edges


def fitb_candidate_scores(
    retained: Sequence[str], candidates: Sequence[str], edge_score: EdgeScore
) -> list[float]:
    """Each candidate's mean edge-compat with the partial outfit (§3: "the candidate maximizing
    mean edge-compat with the partial outfit"). `fitb_hit` then reads the argmax with the tie rule."""
    rs = list(retained)
    if not rs:
        raise ValueError("FITB needs >= 1 retained item to score candidates against")
    return [sum(edge_score(c, r) for r in rs) / len(rs) for c in candidates]


# --------------------------------------------------------------------------- #
# Cluster bootstrap (§11)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class CI:
    """A point estimate with a percentile bootstrap interval. `b` records the replicate count so a
    reader can see the CI's resolution. The §12 near-gate rule is read DIRECTLY off the bound
    (`ci.low`), **never** via `straddles`: gate A passes iff `ci.low > 0`, gate D iff
    `ci.low >= floor`, gate B iff `ci.low >= -delta` AND `ci.half_width <= delta`. `straddles` is
    only a straddle *detector* (see its note) and is NOT a valid standalone pass predicate for a
    one-sided gate."""

    point: float
    low: float
    high: float
    b: int

    @property
    def half_width(self) -> float:
        """Half the CI width — the gate-B `HW <= delta` power check reads this (§12)."""
        return (self.high - self.low) / 2.0

    def straddles(self, threshold: float) -> bool:
        """True if `threshold` lies inside [low, high] — a straddle *detector*, NOT a gate pass
        predicate.

        A one-sided decision gate must be read DIRECTLY off `ci.low`; `not straddles(t)` is WRONG —
        a CI wholly on the FAIL side also does not contain `t`, so `not straddles(t)` is True and it
        would falsely "pass" (e.g. a gate-A added-value CI entirely below 0 — the head strictly
        worse than its own zero-shot floor — would slip through). `evaluate.py` (C6) reads every gate
        off the bound: gate A `ci.low > 0`; gate D `ci.low >= floor`; gate B `ci.low >= -delta` AND
        `ci.half_width <= delta`. Both inclusive `>=` gates (B and D) would additionally be mis-failed
        by an exactly-on-boundary CI under `straddles`, so neither routes through it. §12."""
        return self.low <= threshold <= self.high


def _percentile_ci(point: float, boot: np.ndarray, b: int, alpha: float) -> CI:
    if not np.isfinite(point) or not np.isfinite(boot).all():
        raise ValueError("bootstrap statistic produced a non-finite value")
    lo, hi = np.quantile(boot, [alpha / 2.0, 1.0 - alpha / 2.0])
    return CI(point=float(point), low=float(lo), high=float(hi), b=b)


def bootstrap_ci(
    n_clusters: int,
    statistic: Callable[[np.ndarray], float],
    *,
    seed: int,
    b: int = 10_000,
    alpha: float = 0.05,
) -> CI:
    """Percentile cluster bootstrap of a single statistic. `statistic(idx)` recomputes the metric
    over the clusters selected by an index array `idx` into `[0, n_clusters)`; the point estimate
    uses `idx = arange(n_clusters)`. Resampling is at the cluster unit (a positive+negative pair, a
    source outfit, or a FITB question — §11), so edges/pairs within one cluster move together and
    the CI does not understate the dependence."""
    if n_clusters < 1:
        raise ValueError("bootstrap needs >= 1 cluster")
    rng = np.random.default_rng(seed)
    point = statistic(np.arange(n_clusters))
    boot = np.empty(b, dtype=float)
    for i in range(b):
        boot[i] = statistic(rng.integers(0, n_clusters, n_clusters))
    return _percentile_ci(point, boot, b, alpha)


def paired_diff_ci(
    n_clusters: int,
    statistic_x: Callable[[np.ndarray], float],
    statistic_y: Callable[[np.ndarray], float],
    *,
    seed: int,
    b: int = 10_000,
    alpha: float = 0.05,
) -> CI:
    """Paired (shared-resample) bootstrap of `stat_x - stat_y`, for the gate-A and gate-B
    difference CIs (§11). Each replicate resamples the SHARED clusters once and scores both models
    on that resample before differencing — they score the same items, so the difference is
    positively correlated and pairing tightens the CI vs an independent combine. Requires both
    statistics share the same cluster indexing (e.g. trained vs zero-shot on the identical pairs).

    NOTE (C4 extension, not built here): gate B must additionally propagate the judge's temp-0
    run-to-run variance — a two-stage bootstrap that resamples the judge's per-question samples
    jointly with the cluster resample (§11). That hook lands at C4 with `gpt_judge.py`; this
    function is the single-source cluster layer it will wrap."""
    return bootstrap_ci(
        n_clusters, lambda idx: statistic_x(idx) - statistic_y(idx), seed=seed, b=b, alpha=alpha
    )


def unpaired_diff_ci(
    n_x: int,
    statistic_x: Callable[[np.ndarray], float],
    n_y: int,
    statistic_y: Callable[[np.ndarray], float],
    *,
    seed: int,
    b: int = 10_000,
    alpha: float = 0.05,
) -> CI:
    """Unpaired bootstrap of `stat_x - stat_y` for the REPORTED catalog->closet transfer (former
    gate C, §10/§12): two independent corpora with no shared sample, so each replicate resamples x
    and y independently. The difference is dominated by the smaller-N closet term, whose
    percentile coverage at ~15-25 clusters is weak — read directionally with the §11 coverage
    caveat, never as a precise instrument (exactly why the transfer is reported, not gated)."""
    if n_x < 1 or n_y < 1:
        raise ValueError("unpaired bootstrap needs >= 1 cluster on each side")
    rng = np.random.default_rng(seed)
    point = statistic_x(np.arange(n_x)) - statistic_y(np.arange(n_y))
    boot = np.empty(b, dtype=float)
    for i in range(b):
        boot[i] = statistic_x(rng.integers(0, n_x, n_x)) - statistic_y(rng.integers(0, n_y, n_y))
    return _percentile_ci(point, boot, b, alpha)


# --------------------------------------------------------------------------- #
# Typed convenience wrappers (the shapes evaluate.py actually calls)
# --------------------------------------------------------------------------- #
def auc_ci(
    pos_scores: Sequence[float], neg_scores: Sequence[float], *, seed: int, b: int = 10_000,
    alpha: float = 0.05,
) -> CI:
    """Cluster-bootstrapped pooled AUC where cluster `k` = the (positive, negative) pair
    `(pos_scores[k], neg_scores[k])` — pair-level (the source-outfit-free pair unit, data_loader
    §C2 note) or outfit-level (the source outfit). Requires 1:1 aligned arrays."""
    pos = np.asarray(pos_scores, dtype=float)
    neg = np.asarray(neg_scores, dtype=float)
    if len(pos) != len(neg):
        raise ValueError("auc_ci expects 1:1 aligned positive/negative clusters")
    return bootstrap_ci(len(pos), lambda idx: auc_pos_neg(pos[idx], neg[idx]), seed=seed, b=b, alpha=alpha)


def fitb_ci(
    per_question_hits: Sequence[float], *, seed: int, b: int = 10_000, alpha: float = 0.05
) -> CI:
    """Cluster-bootstrapped FITB accuracy; cluster = one question (effective-N = #questions, so the
    gate-B set pre-commits one question per distinct outfit — §12)."""
    hits = np.asarray(per_question_hits, dtype=float)
    if len(hits) == 0:
        raise ValueError("FITB CI needs at least one question")
    if not np.isfinite(hits).all():
        raise ValueError("FITB hits must be finite")
    return bootstrap_ci(len(hits), lambda idx: float(hits[idx].mean()), seed=seed, b=b, alpha=alpha)


def paired_auc_diff_ci(
    pos_x: Sequence[float], neg_x: Sequence[float],
    pos_y: Sequence[float], neg_y: Sequence[float],
    *, seed: int, b: int = 10_000, alpha: float = 0.05,
) -> CI:
    """Gate A: paired AUC difference `AUC_x - AUC_y` over the SAME (positive, negative) pair
    clusters (e.g. trained head vs its own zero-shot cosine floor — both score the identical
    pairs)."""
    px, nx = np.asarray(pos_x, float), np.asarray(neg_x, float)
    py, ny = np.asarray(pos_y, float), np.asarray(neg_y, float)
    if not (len(px) == len(nx) == len(py) == len(ny)):
        raise ValueError("paired AUC diff expects all four arrays aligned 1:1 on the same clusters")
    return paired_diff_ci(
        len(px),
        lambda idx: auc_pos_neg(px[idx], nx[idx]),
        lambda idx: auc_pos_neg(py[idx], ny[idx]),
        seed=seed, b=b, alpha=alpha,
    )


def paired_fitb_diff_ci(
    hits_x: Sequence[float], hits_y: Sequence[float], *, seed: int, b: int = 10_000,
    alpha: float = 0.05,
) -> CI:
    """Gate B: paired FITB difference `acc_x - acc_y` over the SAME questions (trained head vs the
    `gpt-5.4-mini` judge, both scoring the identical gate-B question set). The non-inferiority gate
    reads `CI_low >= -delta` (§12)."""
    hx, hy = np.asarray(hits_x, float), np.asarray(hits_y, float)
    if len(hx) != len(hy):
        raise ValueError("paired FITB diff expects per-question hits aligned on the same questions")
    if len(hx) == 0:
        raise ValueError("paired FITB diff needs at least one question")
    if not (np.isfinite(hx).all() and np.isfinite(hy).all()):
        raise ValueError("paired FITB hits must be finite")
    return paired_diff_ci(
        len(hx),
        lambda idx: float(hx[idx].mean()),
        lambda idx: float(hy[idx].mean()),
        seed=seed, b=b, alpha=alpha,
    )
