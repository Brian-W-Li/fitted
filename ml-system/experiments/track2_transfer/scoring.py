"""Frozen primary read: mean edge scores and snapshot-blocked within-friend AUC.

Only ``score_bundle`` touches bundle labels; it requires a gate-issued clearance.
Statistical helpers consume already-computed scores, allowing synthetic tests.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import date
import json
from typing import Callable, Sequence

import numpy as np

import h26_bridge as h26
from constants import (
    BOOTSTRAP_B, HORIZON, PRIMARY_BOUNDARY, PRIMARY_CI_LEVEL,
    PRIMARY_MIN_LOOK2, PRIMARY_POINT_FLOOR, SEED,
)


@dataclass(frozen=True)
class ScoredCluster:
    user: str
    arm: str
    snapshot_id: str
    signature: str
    score: float

    def __post_init__(self):
        if self.arm not in ("accepted", "rejected"):
            raise ValueError("score arm must be accepted or rejected")
        if not np.isfinite(self.score):
            raise ValueError("outfit score must be finite")


def outfit_score(item_ids: Sequence[str], edge_score: Callable[[str, str], float]) -> float:
    """The H26 mean of all C(n, 2) edges, with non-finite outputs rejected."""
    value = h26.mean_edge_score(item_ids, edge_score)
    if not np.isfinite(value):
        raise ValueError("outfit score must be finite")
    return float(value)


def per_friend_auc(clusters: Sequence[ScoredCluster], users=()) -> dict:
    groups = {user: [] for user in users}
    for cluster in clusters:
        groups.setdefault(cluster.user, []).append(cluster)
    result = {}
    for user, rows in sorted(groups.items()):
        pos = [c.score for c in rows if c.arm == "accepted"]
        neg = [c.score for c in rows if c.arm == "rejected"]
        result[user] = {
            "accepted": len(pos), "rejected": len(neg),
            "pair_mass": len(pos) * len(neg),
            "auc": h26.auc_pos_neg(pos, neg) if pos and neg else None,
            "snapshots": len({c.snapshot_id for c in rows}),
        }
    return result


def pooled_within_user_auc(clusters: Sequence[ScoredCluster]) -> float:
    """Mann–Whitney pairs never cross friends; empty-arm friends add zero mass."""
    friends = per_friend_auc(clusters)
    mass = sum(row["pair_mass"] for row in friends.values())
    if not mass:
        return float("nan")
    return sum(row["auc"] * row["pair_mass"] for row in friends.values()
               if row["pair_mass"]) / mass


@dataclass(frozen=True)
class BlockedBootstrap:
    ci: h26.CI
    dropped_replicates: int
    replicates: np.ndarray
    snapshots_per_friend: dict[str, int]
    alpha: float

    def report(self) -> dict:
        rate = self.dropped_replicates / self.ci.b
        return {
            **ci_report(self.ci), "alpha": self.alpha,
            "unit": "snapshot_blocked_within_friend", "friends_resampled": False,
            "snapshots_per_friend": self.snapshots_per_friend,
            "dropped_replicates": self.dropped_replicates,
            "valid_replicates": self.ci.b - self.dropped_replicates,
            "dropped_fraction": rate,
            "degenerate_warning": rate > 0.01,
            "warning": "More than 1% of bootstrap replicates had no within-friend pairs."
            if rate > 0.01 else None,
        }


def ci_report(ci: h26.CI) -> dict:
    """Emit valid JSON even for an undefined point or wholly degenerate interval."""
    return {key: float(value) if np.isfinite(value) else None
            for key, value in (("point", ci.point), ("low", ci.low), ("high", ci.high))} | {"b": ci.b}


def _snapshot_matrices(clusters: Sequence[ScoredCluster]):
    """Precompute snapshot pair U/mass; multinomial weights reproduce row resampling."""
    groups = defaultdict(lambda: defaultdict(list))
    for cluster in clusters:
        groups[cluster.user][cluster.snapshot_id].append(cluster)
    frames = {}
    for user, snapshots in sorted(groups.items()):
        rows = [snapshots[s] for s in sorted(snapshots)]
        pos = [np.array([c.score for c in row if c.arm == "accepted"]) for row in rows]
        neg = [np.array([c.score for c in row if c.arm == "rejected"]) for row in rows]
        concordance = np.zeros((len(rows), len(rows)))
        for i, p in enumerate(pos):
            for j, n in enumerate(neg):
                concordance[i, j] = (p[:, None] > n).sum() + 0.5 * (p[:, None] == n).sum()
        frames[user] = (concordance, np.array([len(p) for p in pos]),
                        np.array([len(n) for n in neg]))
    return frames


def blocked_bootstrap_ci(
    clusters: Sequence[ScoredCluster], *, seed: int = SEED,
    b: int = BOOTSTRAP_B, alpha: float = 1 - PRIMARY_CI_LEVEL,
) -> BlockedBootstrap:
    """Resample each friend's snapshots, keeping its snapshot count fixed.

    All candidates move with snapshot multiplicity. Degenerate draws remain NaN
    and are dropped only at quantiling. Numpy's default linear percentile
    convention is identical to H26's metric helper.
    """
    if b < 1 or not 0 < alpha < 1:
        raise ValueError("bootstrap requires b >= 1 and 0 < alpha < 1")
    frames = _snapshot_matrices(clusters)
    rng = np.random.default_rng(seed)
    boot = np.full(b, np.nan)
    for replicate in range(b):
        numerator = 0.0
        denominator = 0
        for matrix, pos, neg in frames.values():
            n = len(pos)
            counts = np.bincount(rng.integers(0, n, n), minlength=n)
            numerator += float(counts @ matrix @ counts)
            denominator += int(counts @ pos) * int(counts @ neg)
        if denominator:
            boot[replicate] = numerator / denominator
    valid = boot[np.isfinite(boot)]
    low, high = np.quantile(valid, [alpha / 2, 1 - alpha / 2]) if len(valid) else (np.nan, np.nan)
    ci = h26.CI(pooled_within_user_auc(clusters), float(low), float(high), b)
    return BlockedBootstrap(ci, b - len(valid), boot,
                            {user: len(frame[1]) for user, frame in frames.items()}, alpha)


def primary_verdict(ci: h26.CI, *, look: int, horizon_reached: bool = False,
                    lofo_ci: h26.CI | None = None,
                    min_arm_count: int | None = None) -> str:
    if look not in (1, 2):
        raise ValueError("look must be 1 or 2")
    if ci.low > PRIMARY_BOUNDARY and ci.point >= PRIMARY_POINT_FLOOR:
        if lofo_ci is not None and not lofo_ci.point > PRIMARY_BOUNDARY:
            return "SUGGESTIVE (LOFO-sensitive)"
        return "ESTABLISHED"
    if look == 2:
        return "NOT-ESTABLISHED (well-powered null)"
    if min_arm_count is not None and min_arm_count >= PRIMARY_MIN_LOOK2:
        return "NOT-ESTABLISHED (proceed to Look 2)"
    if horizon_reached:
        return "NOT-ESTABLISHED (underpowered)"
    return "NOT-ESTABLISHED (keep collecting)"


def primary_read(clusters: Sequence[ScoredCluster], *, look: int, users=(),
                 horizon_reached: bool = False, b: int = BOOTSTRAP_B) -> dict:
    bootstrap = blocked_bootstrap_ci(clusters, b=b)
    friends = per_friend_auc(clusters, users)
    largest = min(friends, key=lambda user: (-friends[user]["pair_mass"], user)) if friends else None
    reduced = [c for c in clusters if c.user != largest]
    lofo = blocked_bootstrap_ci(reduced, b=b)
    accepted = sum(c.arm == "accepted" for c in clusters)
    rejected = sum(c.arm == "rejected" for c in clusters)
    return {
        **bootstrap.report(), "cohort_conditional": True, "per_friend": friends,
        "verdict": primary_verdict(bootstrap.ci, look=look, horizon_reached=horizon_reached,
                                    lofo_ci=lofo.ci, min_arm_count=min(accepted, rejected)),
        "leave_one_friend_out": {
            "dropped_friend": largest, "selection": "largest_pair_mass_then_lexicographic_user",
            **lofo.report(), "above_chance": bool(lofo.ci.point > PRIMARY_BOUNDARY),
            "sensitivity_boundary": "point estimate > 0.50",
        },
    }


def edge_scorers(items: dict, embeddings, head):
    """Adapt garment/occurrence keys to image-keyed embeddings for H26's scorers.

    Different photos or clothingTypes of one garment remain different primary
    occurrences. The secondary passes its validated, unambiguous garment map.
    """
    from embed_bundle import image_id

    class ImageView:
        def vec(self, key):
            return embeddings.vec(image_id(items[key]))

    index = {key: h26.Item(key, item["clothingType"], item["clothingType"], item["clothingType"])
             for key, item in items.items()}
    return h26.head_edge_scorer(head, ImageView(), index), h26.cosine_edge_scorer(ImageView())


def score_bundle(clearance, embeddings, head) -> dict:
    """Score only a cleared bundle; production B and alpha are never caller options."""
    from gate import require_clearance
    from embed_bundle import image_id
    from transfer_read import prepare_transfer

    bundle = require_clearance(clearance)
    # A direct caller has the same pre-score ambiguity fence as the Look driver.
    # Preparing mechanical negatives touches no model or compatibility score.
    prepare_transfer(clearance)
    records = {}
    outfit_keys = []
    for cluster in bundle.clusters:
        keys = []
        for item in cluster.items:
            key = json.dumps([image_id(item), item["clothingType"]], separators=(",", ":"))
            records[key] = item
            keys.append(key)
        outfit_keys.append(keys)
    trained_edge, cosine_edge = edge_scorers(records, embeddings, head)
    trained, cosine = [], []
    for cluster, keys in zip(bundle.clusters, outfit_keys):
        metadata = dict(user=cluster.user, arm=cluster.arm, snapshot_id=cluster.snapshot_id,
                        signature=cluster.signature)
        trained.append(ScoredCluster(**metadata, score=outfit_score(keys, trained_edge)))
        cosine.append(ScoredCluster(**metadata, score=outfit_score(keys, cosine_edge)))
    users = bundle.certificate["perUser"]
    excluded = bundle.excluded_users
    horizon = getattr(clearance, "effective_horizon", HORIZON)
    horizon_reached = date.fromisoformat(clearance.as_of) >= date.fromisoformat(str(horizon))
    primary = primary_read([c for c in trained if c.user not in excluded], look=clearance.look,
                           users=users, horizon_reached=horizon_reached)
    reference = primary_read([c for c in cosine if c.user not in excluded], look=clearance.look,
                             users=users, horizon_reached=horizon_reached)
    reference["gates_m6"] = False
    return {
        "primary": primary, "cosine": reference,
        "excluded": {
            "trained": per_friend_auc([c for c in trained if c.user in excluded], excluded),
            "cosine": per_friend_auc([c for c in cosine if c.user in excluded], excluded),
            "pooled": False,
        },
        "cluster_scores": {"trained": [asdict(c) for c in trained],
                           "cosine": [asdict(c) for c in cosine]},
    }
