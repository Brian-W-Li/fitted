"""C6 sensitivity machinery — the §C.6 popularity-matched re-run, the §C.7 3-seed robustness
footnote, and the §C.5 percentile-bootstrap p (the Holm input).

Lives OUTSIDE `data_loader.py` on purpose: `fitb_order.json` pins `data_loader.py`'s source sha
(`constructor_source_sha256`), so the frozen constructor file cannot grow new code without breaking
the C3 order tripwire. The two `*_popmatched` constructions below MIRROR `build_pairwise` /
`build_outfit_level` line-for-line and add exactly one thing — the frozen §C.6 decile filter:

    the matched negative is drawn same-fine-category, anchor-non-co-occurring, AND within ±1
    popularity-decile of the replaced positive partner, where deciles are computed over the
    split's FULL item-popularity distribution (preregistration.md §C.6, frozen before the
    diagnostic fired).

The §C.6 trigger fired on the real test split (`AUC_pop_outfit` 0.5597 > the 0.55 blind margin),
so the re-run is a MANDATORY C6 deliverable — reported as a sensitivity row only; gate numbers do
not move. `bootstrap_with_replicates` reproduces `metrics.bootstrap_ci`'s exact resample stream
(same rng, same draw order) so the §C.5 two-sided bootstrap p and the emitted CI come from the
same distribution — the derived CI is asserted equal to the emitted one before the p is trusted.
Reference: docs/plans/h26-compatibility-spike-v2.md §11 / §12; preregistration.md §C.5–C.7.
"""

from __future__ import annotations

import random
from collections.abc import Callable, Sequence

import numpy as np

from data_loader import Edge, Item, OutfitPair, SplitData, build_fitb, iter_positive_edges
from metrics import EdgeScore, auc_ci, fitb_ci, paired_auc_diff_ci

N_DECILES = 10


# --------------------------------------------------------------------------- #
# §C.6 popularity deciles (value-based over the split's full item-popularity distribution)
# --------------------------------------------------------------------------- #
def popularity_deciles(split: SplitData) -> tuple[dict[str, int], list[float]]:
    """Assign every split item a popularity decile in [0, 10). Deciles are VALUE-based: the 9
    inner quantile edges of the split's full item-popularity distribution, an item's decile =
    `searchsorted(edges, pop, side="right")` — so equally-popular items always share a decile (no
    arbitrary rank tie-break), at the cost that a heavily-tied distribution (most Polyvore items
    appear in 1 outfit) collapses several deciles onto one value. That collapse is faithful to the
    frozen §C.6 wording ("deciles over the split's full item-popularity distribution") and only
    makes the ±1-decile window WIDER for common items — a looser match, disclosed via the returned
    edges, never a silently harder one."""
    pops = np.array(sorted(split.popularity.values()), dtype=float)
    edges = np.quantile(pops, [k / N_DECILES for k in range(1, N_DECILES)])
    deciles = {
        item: int(np.searchsorted(edges, pop, side="right"))
        for item, pop in split.popularity.items()
    }
    return deciles, [float(e) for e in edges]


def _draw_same_cat_popmatched(
    split: SplitData,
    category_id: str,
    forbidden: set[str],
    rng: random.Random,
    deciles: dict[str, int],
    target_decile: int,
    k: int = 1,
) -> list[str] | None:
    """`data_loader._draw_same_cat` + the §C.6 filter: candidates must sit within ±1 decile of the
    replaced positive partner's decile. None if the matched pool is too small (skip-and-count)."""
    pool = [
        x for x in split.by_cat.get(category_id, [])
        if x not in forbidden and abs(deciles[x] - target_decile) <= 1
    ]
    if len(pool) < k:
        return None
    return rng.sample(pool, k)


def build_pairwise_popmatched(
    split: SplitData, item_index: dict[str, Item], seed: int, deciles: dict[str, int]
) -> tuple[list[Edge], int]:
    """`data_loader.build_pairwise` with the §C.6 popularity-decile match on the drawn negative.
    Same positives, same interleaved [pos, neg, …] contract, same skip-and-count on an exhausted
    (now decile-filtered) pool, same seeded draw order — only the pool filter differs."""
    rng = random.Random(seed)
    edges: list[Edge] = []
    skipped = 0
    for pair in sorted(iter_positive_edges(split), key=lambda p: tuple(sorted(p))):
        i, j = sorted(pair)
        first, second = (i, j) if rng.random() < 0.5 else (j, i)
        neg = None
        for anchor, replaced in ((first, second), (second, first)):
            cat = item_index[replaced].category_id
            forbidden = set(split.cooccur.get(anchor, ())) | {anchor, replaced}
            drawn = _draw_same_cat_popmatched(
                split, cat, forbidden, rng, deciles, deciles[replaced], k=1
            )
            if drawn is not None:
                neg = Edge(a=anchor, b=drawn[0], label=0, anchor=anchor, replaced=replaced)
                break
        if neg is None:
            skipped += 1
            continue
        edges.append(Edge(a=i, b=j, label=1))
        edges.append(neg)
    return edges, skipped


def build_outfit_level_popmatched(
    split: SplitData, item_index: dict[str, Item], seed: int, deciles: dict[str, int],
    retries: int = 8,
) -> tuple[list[OutfitPair], int]:
    """`data_loader.build_outfit_level` with the §C.6 decile match: every corrupted slot's
    replacement must sit within ±1 decile of the ORIGINAL item it replaces (each same-fine-category
    negative is popularity-matched to its replaced positive partner), all §4 constraints kept."""
    rng = random.Random(seed)
    pairs: list[OutfitPair] = []
    skipped = 0
    for o in split.outfits:
        originals = set(o.item_ids)
        negative: list[str] | None = None
        for _ in range(retries):
            order = list(o.item_ids)
            rng.shuffle(order)
            chosen: list[str] = []
            chosen_set: set[str] = set()
            ok = True
            for it in order:
                cat = item_index[it].category_id
                forbidden = originals | chosen_set
                for c in chosen:
                    forbidden |= split.cooccur.get(c, set())
                pick = _draw_same_cat_popmatched(
                    split, cat, forbidden, rng, deciles, deciles[it], k=1
                )
                if pick is None:
                    ok = False
                    break
                chosen.append(pick[0])
                chosen_set.add(pick[0])
            if ok:
                negative = chosen
                break
        if negative is None:
            skipped += 1
            continue
        pairs.append(OutfitPair(set_id=o.set_id, positive=o.item_ids, negative=tuple(negative)))
    return pairs, skipped


# --------------------------------------------------------------------------- #
# §C.5 percentile-bootstrap p — the replicate stream metrics.bootstrap_ci uses, exposed
# --------------------------------------------------------------------------- #
def bootstrap_with_replicates(
    n_clusters: int,
    statistic: Callable[[np.ndarray], float],
    *,
    seed: int,
    b: int = 10_000,
) -> tuple[float, np.ndarray]:
    """The EXACT resample stream of `metrics.bootstrap_ci` (same `np.random.default_rng(seed)`,
    same per-replicate `rng.integers(0, n, n)` draw order), returning `(point, boot)` instead of a
    percentile CI — so the §C.5 two-sided p is computed from the SAME replicates that produced the
    emitted CI. Callers must assert the derived percentile CI equals the emitted one (the guard
    that this duplication has not drifted; `metrics.py` itself is frozen and cannot grow this)."""
    if n_clusters < 1:
        raise ValueError("bootstrap needs >= 1 cluster")
    rng = np.random.default_rng(seed)
    point = statistic(np.arange(n_clusters))
    boot = np.empty(b, dtype=float)
    for i in range(b):
        boot[i] = statistic(rng.integers(0, n_clusters, n_clusters))
    if not np.isfinite(point) or not np.isfinite(boot).all():
        raise ValueError("bootstrap statistic produced a non-finite value")
    return float(point), boot


def two_sided_boot_p(boot: np.ndarray) -> float:
    """The frozen §C.5 formula: `p = 2 * min(Pr*[Δ<=0], Pr*[Δ>=0])`, clamped to [0, 1]. With
    B = 10,000 the resolution floor is 1e-4; a p of exactly 0.0 means no replicate crossed zero
    (report as `< 2/B` in prose, store the formula's value verbatim)."""
    p = 2.0 * min(float(np.mean(boot <= 0.0)), float(np.mean(boot >= 0.0)))
    return min(max(p, 0.0), 1.0)


# --------------------------------------------------------------------------- #
# The two C6 reported blocks (popularity-matched re-run + 3-seed robustness)
# --------------------------------------------------------------------------- #
POPMATCH_RULE = (
    "same_fine_category_anchor_no_cooccurrence_within_pm1_popularity_decile_of_replaced_partner"
)
DECILE_BASIS = "value_deciles_over_split_full_item_popularity_distribution"
GATE_B_SEED_NOTE = (
    "gate B is structurally seed-pinned: its question set is the committed fitb_order.json "
    "(seed-20260629 construction, frozen at C3) and its judge side is the committed "
    "judge_runs.ndjson ledger — a footnote seed cannot re-roll either without re-scoring the "
    "judge, which the frozen order forbids; B's verdict therefore agrees across seeds by "
    "construction and its seed sensitivity is disclosed as not re-measurable in-spike"
)


def _ci_dict(c) -> dict:
    return {"point": c.point, "low": c.low, "high": c.high, "b": c.b}


def compute_popularity_matched(
    split: SplitData,
    item_index: dict[str, Item],
    trained_score: EdgeScore,
    cosine_score: EdgeScore,
    *,
    seed: int,
    b: int = 10_000,
) -> dict:
    """The mandatory §C.6 sensitivity row (the diagnostic fired: AUC_pop_outfit > 0.55): re-draw
    the §4 negatives popularity-matched and recompute the gate-A pair-level AUCs + diff and the
    gate-D outfit-level AUC. REPORTED ONLY — the frozen gates read the headline construction."""
    from evaluate import outfit_pos_neg, pairwise_pos_neg

    deciles, edges_q = popularity_deciles(split)
    pm_edges, n_pair_skipped = build_pairwise_popmatched(split, item_index, seed, deciles)
    pos_tr, neg_tr = pairwise_pos_neg(pm_edges, trained_score)
    pos_zs, neg_zs = pairwise_pos_neg(pm_edges, cosine_score)
    pm_outfits, n_outfit_skipped = build_outfit_level_popmatched(split, item_index, seed, deciles)
    opos, oneg = outfit_pos_neg(pm_outfits, trained_score)
    return {
        "rule": POPMATCH_RULE,
        "decile_basis": DECILE_BASIS,
        "decile_edges": edges_q,
        "n_pair_clusters_kept": len(pm_edges) // 2,
        "n_pair_positives_skipped": n_pair_skipped,
        "n_outfit_pairs_kept": len(pm_outfits),
        "n_outfits_skipped": n_outfit_skipped,
        "AUC_catalog_pair_popmatched": _ci_dict(auc_ci(pos_tr, neg_tr, seed=seed, b=b)),
        "AUC_zero_shot_cosine_popmatched": _ci_dict(auc_ci(pos_zs, neg_zs, seed=seed, b=b)),
        "gate_A_diff_popmatched": _ci_dict(
            paired_auc_diff_ci(pos_tr, neg_tr, pos_zs, neg_zs, seed=seed, b=b)
        ),
        "outfit_auc_popmatched": _ci_dict(auc_ci(opos, oneg, seed=seed, b=b)),
    }


def compute_seed_robustness(
    split: SplitData,
    item_index: dict[str, Item],
    trained_score: EdgeScore,
    cosine_score: EdgeScore,
    headline_metrics: dict,
    gates: dict,
    *,
    seeds: Sequence[int],
    headline_seed: int,
    b: int = 10_000,
) -> dict:
    """The §C.7 3-seed robustness footnote: re-roll the WHOLE negative set (pairwise negatives,
    outfit corruptions, FITB distractors) on each footnote seed and re-read the A/D gate legs; the
    rule requires the gate verdict to agree across all three. The headline seed's values are
    copied from the emitted metrics.json, not recomputed (bit-determinism was proven at emit + the
    C5 cross-check; a recompute would reproduce them exactly). Gate B is seed-pinned by
    construction — see GATE_B_SEED_NOTE. Thresholds come from the frozen preregistration.json
    `gates` block, never re-typed."""
    from data_loader import build_outfit_level, build_pairwise
    from evaluate import fitb_hits, outfit_pos_neg, pairwise_pos_neg

    a_threshold = gates["A"]["threshold"]
    d_floors = {c["metric"]: c["floor"] for c in gates["D"]["conjuncts"]}
    per_seed: list[dict] = []
    for seed in seeds:
        if seed == headline_seed:
            row = {
                "seed": seed,
                "headline": True,
                "gate_A_diff": headline_metrics["gate_A_diff"],
                "outfit_auc": headline_metrics["outfit_auc"],
                "fitb_trained_full": headline_metrics["fitb_trained_full"],
            }
        else:
            edges, _ = build_pairwise(split, item_index, seed)
            pos_tr, neg_tr = pairwise_pos_neg(edges, trained_score)
            pos_zs, neg_zs = pairwise_pos_neg(edges, cosine_score)
            outfit_pairs, _ = build_outfit_level(split, item_index, seed)
            opos, oneg = outfit_pos_neg(outfit_pairs, trained_score)
            questions, _ = build_fitb(split, item_index, seed)
            row = {
                "seed": seed,
                "headline": False,
                "gate_A_diff": _ci_dict(
                    paired_auc_diff_ci(pos_tr, neg_tr, pos_zs, neg_zs, seed=seed, b=b)
                ),
                "outfit_auc": _ci_dict(auc_ci(opos, oneg, seed=seed, b=b)),
                "fitb_trained_full": _ci_dict(
                    fitb_ci(fitb_hits(questions, trained_score), seed=seed, b=b)
                ),
            }
        row["gate_A_pass"] = row["gate_A_diff"]["low"] > a_threshold
        row["gate_D_pass"] = (
            row["outfit_auc"]["low"] >= d_floors["outfit_auc"]
            and row["fitb_trained_full"]["low"] >= d_floors["fitb_trained_full"]
        )
        per_seed.append(row)
    return {
        "rule": gates_footnote_rule(),
        "gate_b_note": GATE_B_SEED_NOTE,
        "per_seed": per_seed,
        "verdicts_agree": (
            len({r["gate_A_pass"] for r in per_seed}) == 1
            and len({r["gate_D_pass"] for r in per_seed}) == 1
        ),
    }


def gates_footnote_rule() -> str:
    return "gate verdict (A/B/D pass/fail) must agree across all 3 seeds"
