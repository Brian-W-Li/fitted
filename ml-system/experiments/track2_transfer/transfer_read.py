"""Reported secondary read: H26 negatives at the disclosed clothingType grain."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from itertools import combinations

import numpy as np

import h26_bridge as h26
from constants import (
    BOOTSTRAP_B, MIN_CATEGORY_DEPTH, PREREG, SECONDARY_CI_LEVEL, SEED,
    TRANSFER_DECISION_MIN, TRANSFER_INTERP_MIN,
)
from scoring import ci_report, edge_scorers


@dataclass(frozen=True)
class TransferPairs:
    user: str
    pairs: tuple
    sources: tuple[str, ...]
    items: dict
    eligible_outfits: int
    skipped_pairs: int
    type_revision_items: tuple[str, ...]


def _build_friend_pairs(bundle, user: str) -> TransferPairs:
    """Certificate eligibility uses all items; H26 draw pools use resolved images.

    Co-occurrences and positives are formed only from transfer-scoreable accepted
    outfits. Every resolved rendered garment participates in the negative pool,
    including garments seen only in rejected/unrated candidates. A repeated
    garment with conflicting photos or types is an explicit input ambiguity.
    """
    from embed_bundle import image_id

    rows = sorted((r for r in bundle.rows if (r.get("user") or "unknown") == user),
                  key=lambda r: (str(r.get("snapshotId", "")), str(r.get("candidateId", ""))))
    depth = defaultdict(set)
    resolved = []
    bindings = defaultdict(set)
    for row in rows:
        for item in row.get("items") or []:
            garment, kind = str(item.get("itemId", "")), item.get("clothingType")
            if kind:
                depth[kind].add(garment)
            if item.get("imageStatus") != "resolved":
                continue
            iid = image_id(item)
            bindings[garment].add((iid, kind))
            resolved.append((garment, iid, kind, item))
    type_revisions = []
    for garment, values in bindings.items():
        if len({iid for iid, _ in values}) > 1:
            raise ValueError(f"secondary garment {garment!r} for {user!r} has conflicting image bindings")
        if len({kind for _, kind in values}) > 1:
            type_revisions.append(garment)

    # A historical clothingType edit with the same immutable image is represented
    # as two typed occurrences. This is label-independent and preserves every row;
    # it neither chooses a preferred historical type nor drops the garment. A photo
    # revision remains ambiguous and aborts above.
    def occurrence_key(garment, iid, kind):
        if garment not in type_revisions:
            return garment
        return f"{garment}::type={kind}::image={iid}"

    items = {}
    for garment, iid, kind, item in resolved:
        items[occurrence_key(garment, iid, kind)] = item
    accepted = sorted((c for c in bundle.clusters if c.user == user and c.arm == "accepted"
                       and any(len(depth[i["clothingType"]]) >= MIN_CATEGORY_DEPTH for i in c.items)),
                      key=lambda c: (c.snapshot_id, c.candidate_id, c.signature))
    index = {key: h26.Item(key, item["clothingType"], item["clothingType"], item["clothingType"])
             for key, item in items.items()}
    raw = [(c.signature, [occurrence_key(str(i["itemId"]), image_id(i), i["clothingType"])
                          for i in c.items]) for c in accepted]
    split = h26.make_split_data(user, raw, index)
    # make_split_data normally indexes only co-worn items. The plan's draw pool
    # is the whole resolved rendered closet, so replace by_cat explicitly.
    by_cat = defaultdict(list)
    for key, item in sorted(index.items()):
        by_cat[item.category_id].append(key)
    split.by_cat = dict(by_cat)
    edges, skipped = h26.build_pairwise(split, index, SEED)
    first_source = {}
    for outfit in split.outfits:
        for pair in combinations(outfit.item_ids, 2):
            first_source.setdefault(frozenset(pair), outfit.set_id)
    pairs, sources = [], []
    for offset in range(0, len(edges), 2):
        positive, negative = edges[offset:offset + 2]
        if (positive.label, negative.label) != (1, 0):
            raise ValueError("H26 pairwise interleaving changed")
        pairs.append((positive, negative))
        sources.append(first_source[frozenset((positive.a, positive.b))])
    return TransferPairs(
        user, tuple(pairs), tuple(sources), items, len(accepted), skipped,
        tuple(sorted(type_revisions)),
    )


def interpret_boundaries(ci: h26.CI | None, n_sources: int) -> dict:
    """Strict boundaries; attempting or deciding a read obeys the 12/25 floors."""
    if ci is None or n_sources < TRANSFER_INTERP_MIN:
        return {"state": "REPORT-ONLY (<12 source-outfits)", "above_chance": None,
                "below_healthy": None, "interpretation": "point only; insufficient source outfits"}
    boundaries = PREREG["secondary_read"]["boundaries"]
    above = ci.low > boundaries["above_chance"]["gt"]
    below = ci.high < boundaries["below_healthy"]["lt"]
    if above and below:
        interpretation = "signal present but degraded"
    elif above:
        interpretation = "consistent with healthy"
    elif below:
        interpretation = "below healthy; not distinguishable from chance at this N"
    else:
        interpretation = "not distinguishable from chance at this N"
    return {
        "state": "DECIDABLE (two-boundary)" if n_sources >= TRANSFER_DECISION_MIN
        else "SUGGESTIVE (coverage-caveated)",
        "above_chance": bool(above), "below_healthy": bool(below),
        "interpretation": interpretation,
    }


def source_outfit_read(pos, neg, sources, *, b: int = BOOTSTRAP_B) -> dict:
    """Flat pair AUC, carrying every source outfit's pairs on each resample."""
    if not (len(pos) == len(neg) == len(sources)):
        raise ValueError("scores and source outfits must be aligned")
    groups = defaultdict(list)
    for index, source in enumerate(sources):
        groups[source].append(index)
    members = [groups[source] for source in sorted(groups)]
    ci = None
    if members:
        pos, neg = np.asarray(pos, float), np.asarray(neg, float)

        def statistic(indices):
            rows = np.concatenate([members[i] for i in indices]).astype(int)
            return h26.auc_pos_neg(pos[rows], neg[rows])

        ci = h26.bootstrap_ci(len(members), statistic, seed=SEED, b=b, alpha=1 - SECONDARY_CI_LEVEL)
    return {
        **(ci_report(ci) if ci else {"point": None, "low": None, "high": None, "b": b}),
        "n_source_outfits": len(members), "n_pairs": len(sources), "unit": "source_outfit",
        "alpha": 1 - SECONDARY_CI_LEVEL,
        **interpret_boundaries(ci, len(members)), "gates_m6": False,
    }


def prepare_transfer(clearance) -> list[TransferPairs]:
    """Validate/build negatives before *any* label scoring in the Look driver."""
    from gate import require_clearance

    bundle = require_clearance(clearance)
    users = sorted(set(bundle.certificate["perUser"]) | bundle.excluded_users)
    return [_build_friend_pairs(bundle, user) for user in users]


def transfer_read(clearance, embeddings, head) -> dict:
    """Run the secondary on the cleared sample; never promote it to the decision."""
    from gate import require_clearance

    bundle = require_clearance(clearance)
    frames = prepare_transfer(clearance)
    trained_pos, trained_neg, cosine_pos, cosine_neg, sources = [], [], [], [], []
    friends, excluded = {}, {}
    for frame in frames:
        trained_edge, cosine_edge = edge_scorers(frame.items, embeddings, head)
        tp = [trained_edge(p.a, p.b) for p, _ in frame.pairs]
        tn = [trained_edge(n.a, n.b) for _, n in frame.pairs]
        cp = [cosine_edge(p.a, p.b) for p, _ in frame.pairs]
        cn = [cosine_edge(n.a, n.b) for _, n in frame.pairs]
        report = {
            "eligible_source_outfits": frame.eligible_outfits,
            "n_source_outfits": len(set(frame.sources)), "n_pairs": len(frame.pairs),
            "skipped_pairs": frame.skipped_pairs,
            "historical_type_revision_items": list(frame.type_revision_items),
            "source_assignment": list(frame.sources),
            "trained_auc": h26.auc_pos_neg(tp, tn) if tp else None,
            "cosine_auc": h26.auc_pos_neg(cp, cn) if cp else None,
        }
        if frame.user in bundle.excluded_users:
            excluded[frame.user] = report
            continue
        friends[frame.user] = report
        trained_pos.extend(tp)
        trained_neg.extend(tn)
        cosine_pos.extend(cp)
        cosine_neg.extend(cn)
        sources.extend((frame.user, source) for source in frame.sources)
    return {
        "trained": source_outfit_read(trained_pos, trained_neg, sources),
        "cosine": source_outfit_read(cosine_pos, cosine_neg, sources),
        "per_friend": friends, "excluded": excluded,
        "skipped_pairs": sum(row["skipped_pairs"] for row in friends.values()),
        "historical_type_revision_policy": "same-image type edits are distinct typed occurrences; image edits abort",
        "negative_grain": "clothingType (coarser than H26 Polyvore fine categories)",
        "draw_pool": "all image-resolved rendered garments within friend",
        "source_assignment": "first source outfit ordered by snapshotId, candidateId, signature",
        "gates_m6": False, "never_promoted_to_primary": True,
    }
