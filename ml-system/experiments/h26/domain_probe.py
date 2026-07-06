"""The C5 domain-gap probe — score the frozen closet through the sealed head (§10/§14/§15-C5).

Reads the **already-frozen, committed** `closet_manifest.json` (its labels + taxonomy mapping +
label-audit froze before the C4 test-metric unlock — §12; only the *scoring* happens here) and
computes the reported-not-gated catalog→closet transfer:

  1. **Closet edges** — worn outfits decomposed through the *identical* §4 construction the catalog
     uses (`data_loader.build_pairwise` on a closet-shaped `SplitData`): distinct co-worn positives,
     one same-fine-category anchor-non-co-occurring negative each, exhausted pools skip-and-count.
     Coarsened items (null `polyvore_category_id` — no Polyvore fine-category analog) get sentinel
     singleton categories so they can never be drawn as a negative or treated as same-category with
     each other (the null-pool trap); clusters whose positive touches one are partitioned out and
     **reported separately** (the manifest's frozen `coarsening_policy`, §10 taxonomy match).
  2. **Closet embeddings** — the manifest's photos (sha256-verified against the frozen
     `photo_sha256`) embedded through the SAME frozen FashionSigLIP backbone as the catalog cache
     (revision + preprocess hash asserted against the committed embedding manifest — the drop must
     be measured inside one frozen space). All local; **no third-party API** (§14).
  3. **`AUC_closet_pair`** — pooled pair-level AUC over the main (categorized) clusters,
     cluster-bootstrapped at the **source-outfit** unit (§10/§11: edges from one worn outfit are
     near-perfectly correlated; effective-N = #outfits, reported with the coverage caveat).
  4. **`catalog_closet_drop`** — `AUC_catalog_pair − AUC_closet_pair`, the §11 unpaired combine of
     two independent bootstraps (catalog resamples its (pos,neg) pair clusters; closet resamples
     worn outfits). The catalog side re-scores the strict-disjoint test pairs through the sealed
     checkpoint and must reproduce the emitted `metrics.json` `AUC_catalog_pair` **exactly** (a
     bit-determinism cross-check binding this probe to the C4 emission).
  5. **Closet FITB** — `build_fitb` on the closet split; a category needs ≥4 members for a strict
     question, so a small closet yields zero questions (skip-and-count, reported null — the §15
     scarcity rule, never broadened).

Writes `closet_metrics.json` (scalar-only: item ids + CIs + counts; no photo-derived text — §14),
which `evaluate.py merge-closet` folds into `metrics.json` (stage C5). The **egress code-gate**
(§15-C5) is `assert_egress_consent`: any code path that would transmit a closet photo to a
third-party API must call it first and fails loud unless `_consent.third_party_api_processing` is
true AND the provider is enumerated — the optional GPT closet memorization-control slice is
therefore refused under the committed manifest (consent false) and recorded as skipped. Reference:
docs/plans/h26-compatibility-spike-v2.md §10 / §11 / §14 / §15-C5.
"""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from data_loader import (
    Corpus,
    Edge,
    Item,
    SplitData,
    build_fitb,
    build_pairwise,
    load_json_strict,
    make_split_data,
)
from evaluate import (
    ROOT_DIR,
    SEED,
    closet_referential_checks,
    head_edge_scorer,
    iter_pairwise_clusters,
    pairwise_pos_neg,
)
from metrics import CI, EdgeScore, auc_pos_neg, bootstrap_ci, fitb_ci, unpaired_diff_ci

CLOSET_METRICS = "closet_metrics.json"
# Sentinel category prefix for coarsened items (null polyvore_category_id). A sentinel category is a
# singleton containing only its own item, so _draw_same_cat can never draw from it (the item itself
# is always forbidden) — a coarsened endpoint is never replaced, and two coarsened items are never
# treated as same-category (the null-pool trap: keying by_cat on None would silently pool them).
COARSENED_PREFIX = "__coarsened__"


class ClosetProbeError(RuntimeError):
    """The domain probe refused to run — a frozen-artifact bind failed (photo bytes, backbone
    revision, checkpoint sha, label slip) or an egress path lacked consent. Fail loud; never score
    against a drifted or unconsented input."""


# --------------------------------------------------------------------------- #
# §14 egress code-gate + §15-C5 label-slip cross-check
# --------------------------------------------------------------------------- #
def assert_egress_consent(closet: dict, provider: str) -> None:
    """The §15-C5 code-gate: any code path about to transmit a closet photo to a third-party API
    MUST call this first. Refuses unless `_consent.third_party_api_processing` is true AND
    `provider` is enumerated in `providers_photos_may_reach`. The committed manifest carries
    consent=false, so every egress path (e.g. the optional GPT memorization-control slice) is
    mechanically refused — not honor-system."""
    consent = closet["_consent"]
    if not consent["third_party_api_processing"]:
        raise ClosetProbeError(
            f"closet photo egress to {provider!r} refused: _consent.third_party_api_processing is "
            f"false (§14 — the closet probe is local-only under the committed manifest)"
        )
    if provider not in consent["providers_photos_may_reach"]:
        raise ClosetProbeError(
            f"closet photo egress to {provider!r} refused: provider not enumerated in "
            f"_consent.providers_photos_may_reach {consent['providers_photos_may_reach']} (§14)"
        )


def label_slip_check(closet: dict, type_map: dict[str, dict]) -> None:
    """The §15-C5 label-integrity cross-check: every categorized closet item's `clothing_type` must
    equal `type_map[polyvore_category_id].type`. Neither `closet_manifest.schema.json` (enum + regex
    only) nor the C4 referential check (id existence only) catches a slip, which would silently
    mis-condition the head's type-pair embedding on the closet. Coarsened (null-category) items are
    exempt — they have no Polyvore row to check; their `coarsening_note` is the disclosure."""
    for it in closet["items"]:
        cid = it["polyvore_category_id"]
        if cid is None:
            continue
        row = type_map.get(cid)
        if row is None:
            raise ClosetProbeError(
                f"closet item {it['item_id']!r}: polyvore_category_id {cid!r} absent from type_map.json"
            )
        if row["type"] != it["clothing_type"]:
            raise ClosetProbeError(
                f"closet item {it['item_id']!r}: label slip — clothing_type {it['clothing_type']!r} "
                f"!= type_map[{cid}].type {row['type']!r} (§15-C5; would mis-condition the type-pair "
                f"embedding)"
            )


# --------------------------------------------------------------------------- #
# Closet -> the §4 machinery (item index, split, construction, partition)
# --------------------------------------------------------------------------- #
def closet_item_index(closet: dict) -> dict[str, Item]:
    """Resolve the manifest items into `data_loader.Item`s. Categorized items keep their Polyvore
    `category_id` (the SAME fine-category negative grain as the catalog — §10 taxonomy match);
    coarsened items get a per-item sentinel category (see COARSENED_PREFIX note)."""
    index: dict[str, Item] = {}
    for it in closet["items"]:
        cid = it["polyvore_category_id"]
        index[it["item_id"]] = Item(
            item_id=it["item_id"],
            category_id=cid if cid is not None else f"{COARSENED_PREFIX}{it['item_id']}",
            semantic=it["clothing_type"],
            type=it["clothing_type"],
        )
    return index


def is_coarsened(item: Item) -> bool:
    return item.category_id.startswith(COARSENED_PREFIX)


def closet_split(closet: dict, index: dict[str, Item]) -> SplitData:
    """The closet as a `SplitData` through the IDENTICAL loader path the catalog uses
    (`make_split_data`): co-occurrence / category / popularity indices, all closet-scoped."""
    raw = [(o["set_id"], list(o["item_ids"])) for o in closet["outfits"]]
    return make_split_data("closet", raw, index)


@dataclass(frozen=True)
class ClosetClusters:
    """The §4 pairwise construction over the closet, partitioned per the manifest's frozen
    coarsening policy. `main` clusters (both positive endpoints categorized) feed
    `AUC_closet_pair` + the drop; `coarsened` clusters (positive touches a sentinel-category item)
    are reported separately. `outfit_of_cluster` assigns each cluster its positive's FIRST source
    outfit (manifest order) — the §10/§11 bootstrap unit."""

    main: list[tuple[Edge, Edge]]
    coarsened: list[tuple[Edge, Edge]]
    n_skipped: int
    main_outfits: list[str]        # aligned to `main`: assigned source outfit per cluster
    coarsened_outfits: list[str]   # aligned to `coarsened`


def build_closet_clusters(split: SplitData, index: dict[str, Item], seed: int) -> ClosetClusters:
    """Run `build_pairwise` verbatim (like-for-like with the catalog), then partition + assign
    source outfits. Asserts no negative edge ever contains a sentinel-category drawn item (the
    construction guarantees it — a sentinel pool can never yield a draw — but the §10 taxonomy
    contract is load-bearing enough to verify, not assume)."""
    edges, n_skipped = build_pairwise(split, index, seed)
    clusters = iter_pairwise_clusters(edges)
    first_outfit: dict[frozenset, str] = {}
    for o in split.outfits:
        ids = o.item_ids
        for i_pos, a in enumerate(ids):
            for b in ids[i_pos + 1:]:
                first_outfit.setdefault(frozenset((a, b)), o.set_id)
    main: list[tuple[Edge, Edge]] = []
    coarsened: list[tuple[Edge, Edge]] = []
    main_outfits: list[str] = []
    coarsened_outfits: list[str] = []
    for pos, neg in clusters:
        # neg.b is always the DRAWN item (build_pairwise puts the kept anchor in neg.a); the drawn
        # item must never be sentinel-categorized. The anchor MAY be coarsened (a coarsened
        # positive whose categorized endpoint was replaced) — that is the reported slice, not a bug.
        if is_coarsened(index[neg.b]):
            raise ClosetProbeError(
                f"negative draw produced a coarsened item {neg.b!r} — the sentinel-category "
                f"invariant broke (§10: a coarsened item must never be a same-category negative)"
            )
        outfit = first_outfit[frozenset((pos.a, pos.b))]
        if is_coarsened(index[pos.a]) or is_coarsened(index[pos.b]):
            coarsened.append((pos, neg))
            coarsened_outfits.append(outfit)
        else:
            main.append((pos, neg))
            main_outfits.append(outfit)
    return ClosetClusters(
        main=main, coarsened=coarsened, n_skipped=n_skipped,
        main_outfits=main_outfits, coarsened_outfits=coarsened_outfits,
    )


# --------------------------------------------------------------------------- #
# Outfit-clustered closet AUC (§10/§11 — the source-outfit bootstrap unit)
# --------------------------------------------------------------------------- #
def outfit_clustered_auc_ci(
    clusters: Sequence[tuple[Edge, Edge]],
    outfits_of: Sequence[str],
    edge_score: EdgeScore,
    *,
    seed: int,
    b: int = 10_000,
) -> tuple[CI, np.ndarray, np.ndarray, list[list[int]]]:
    """Pooled pair-level AUC over `clusters`, cluster-bootstrapped at the **source-outfit** unit
    (§10: edges from one worn outfit are near-perfectly correlated, so the resample unit is the
    worn outfit, not the (pos,neg) pair — effective-N = #outfits). Returns
    `(ci, pos_scores, neg_scores, outfit_groups)` where `outfit_groups[g]` lists the cluster
    indices assigned to outfit group `g` (the resample frame — every group carries >= 1 cluster,
    so any replicate has >= 1 positive and >= 1 negative)."""
    if not clusters:
        raise ClosetProbeError("no kept closet clusters — nothing to bootstrap")
    pos = np.array([edge_score(p.a, p.b) for p, _ in clusters], dtype=float)
    neg = np.array([edge_score(n.a, n.b) for _, n in clusters], dtype=float)
    group_ids = sorted(set(outfits_of))
    groups = [[k for k, o in enumerate(outfits_of) if o == g] for g in group_ids]

    def stat(idx: np.ndarray) -> float:
        members = np.concatenate([groups[g] for g in idx]).astype(int)
        return auc_pos_neg(pos[members], neg[members])

    return bootstrap_ci(len(groups), stat, seed=seed, b=b), pos, neg, groups


# --------------------------------------------------------------------------- #
# Frozen-space closet embedding (§5/§10 — same backbone, sha-verified photos)
# --------------------------------------------------------------------------- #
def verify_photo_hashes(closet: dict, root_dir: str = ROOT_DIR) -> list[str]:
    """Every manifest photo must exist and byte-match its frozen `photo_sha256` — the closet froze
    before the unlock, so scoring different pixels would silently unbind the transfer probe from
    its pre-registered dataset. Returns the photo paths in `items` order."""
    paths: list[str] = []
    for it in closet["items"]:
        path = os.path.join(root_dir, it["photo_path"])
        if not os.path.exists(path):
            raise ClosetProbeError(f"closet photo {it['photo_path']!r} is absent (item {it['item_id']!r})")
        with open(path, "rb") as f:
            sha = hashlib.sha256(f.read()).hexdigest()
        if sha != it["photo_sha256"]:
            raise ClosetProbeError(
                f"closet photo {it['photo_path']!r} sha256 {sha} != the frozen photo_sha256 of item "
                f"{it['item_id']!r} — the photo bytes changed after the manifest froze"
            )
        paths.append(path)
    return paths


def embed_closet(closet: dict, root_dir: str = ROOT_DIR):
    """Embed the sha-verified closet photos through the frozen headline backbone, asserting the
    loaded revision + preprocess hash equal the committed embedding manifest's (the catalog cache's
    space) — a drifted backbone would corrupt the drop with a space mismatch, not a domain gap.
    Returns an in-memory `EmbeddingCache` over the closet item ids. Local-only (§14)."""
    from embed import HEADLINE, EmbeddingCache, cache_manifest_path, embed_images, load_backbone
    from PIL import Image, ImageOps

    frozen = load_json_strict(cache_manifest_path(HEADLINE, root_dir))
    loaded = load_backbone(HEADLINE, device="cpu")
    for field_name, got in (("revision_sha", loaded.revision_sha), ("preprocess_hash", loaded.preprocess_hash)):
        if frozen[field_name] != got:
            raise ClosetProbeError(
                f"backbone {field_name} drift: loaded {got} != frozen {frozen[field_name]} "
                f"(embedding_manifest — the closet must embed in the catalog cache's exact space)"
            )
    paths = verify_photo_hashes(closet, root_dir)
    ids = [it["item_id"] for it in closet["items"]]
    # exif_transpose is load-bearing: real phone photos carry EXIF orientation (all 13 committed
    # closet photos are orientation=6, i.e. stored rotated 90°) and PIL does NOT apply it on open —
    # without this the backbone embeds sideways garments and the measured "domain gap" is silently
    # confounded with a pure rotation artifact. Decode policy is C5 scoring code; the frozen
    # photo_sha256 binds are over the BYTES and are untouched by it.
    images = [ImageOps.exif_transpose(Image.open(p)).convert("RGB") for p in paths]
    matrix = embed_images(loaded, images)
    if matrix.shape != (len(ids), frozen["embedding_dim"]):
        raise ClosetProbeError(f"closet embedding shape {matrix.shape} != ({len(ids)}, {frozen['embedding_dim']})")
    return EmbeddingCache(
        key=HEADLINE, ids=ids, matrix=matrix, index={i: k for k, i in enumerate(ids)},
        dim=int(matrix.shape[1]), manifest=frozen,
    )


# --------------------------------------------------------------------------- #
# Sealed-checkpoint load + the catalog side of the drop
# --------------------------------------------------------------------------- #
def load_sealed_pairwise_head(root_dir: str = ROOT_DIR):
    """Load the pairwise checkpoint from `checkpoints/` and BIND it to the sealed `selection.json`
    (`checkpoint_sha256` content hash). The checkpoint blob is gitignored-regenerable; the sha bind
    is what makes scoring it equivalent to the emit's in-memory re-derivation (§C.4 bit-determinism,
    proven at emit). Fails loud on a mismatch — re-run `train_head.py` to regenerate."""
    import torch

    from train_head import PairwiseEdgeHead, checkpoint_sha256

    selection = load_json_strict(os.path.join(root_dir, "selection.json"))
    ckpt_path = os.path.join(
        root_dir, "checkpoints",
        f"pairwise_edge_{selection['training_config']['config_id']}_seed{selection['training_config']['seed']}.pt",
    )
    if not os.path.exists(ckpt_path):
        raise ClosetProbeError(
            f"sealed checkpoint blob {os.path.basename(ckpt_path)!r} is absent — regenerate it "
            f"deterministically with train_head.py (the blob is gitignored; selection.json holds the sha)"
        )
    state = torch.load(ckpt_path, weights_only=True)
    sha = checkpoint_sha256(state)
    if sha != selection["checkpoint_sha256"]:
        raise ClosetProbeError(
            f"checkpoint {os.path.basename(ckpt_path)!r} sha {sha} != sealed selection.json "
            f"checkpoint_sha256 {selection['checkpoint_sha256']} — a stale/foreign blob; regenerate"
        )
    head = PairwiseEdgeHead()
    head.load_state_dict(state)
    return head, selection


def catalog_pair_scores(
    corpus: Corpus, edge_score: EdgeScore, *, seed: int
) -> tuple[np.ndarray, np.ndarray]:
    """Re-score the strict-disjoint catalog test pairs (the §4 construction at the frozen seed)
    through the sealed head — the catalog side of the drop's unpaired combine. The caller must
    cross-check the pooled AUC of these arrays against the emitted `metrics.json`."""
    edges, _ = build_pairwise(corpus.splits["test"], corpus.item_index, seed)
    pos, neg = pairwise_pos_neg(edges, edge_score)
    return np.asarray(pos, dtype=float), np.asarray(neg, dtype=float)


# --------------------------------------------------------------------------- #
# The probe (assembly + closet_metrics.json)
# --------------------------------------------------------------------------- #
def _ci(c: CI) -> dict:
    return {"point": c.point, "low": c.low, "high": c.high, "b": c.b}


def _file_sha256(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def run_probe(root_dir: str = ROOT_DIR, *, b: int = 10_000, seed: int = SEED) -> dict:
    """The full C5 probe. Heavy (torch + the built cache + ~2 min of catalog scoring + the drop
    bootstrap); everything upstream of scoring fails loud before any compute is spent."""
    import torch

    from data_loader import load_headline_corpus, load_type_map
    from embed import HEADLINE, load_cache
    from train_head import set_determinism

    # NOTE: the corpus / catalog cache / type_map load from the package defaults while the closet
    # artifacts honor `root_dir` — the probe is only ever run at the real package root, and the
    # sha/point cross-checks below refuse a mixed world anyway.
    closet_path = os.path.join(root_dir, "closet_manifest.json")
    closet = load_json_strict(closet_path)
    reference = load_json_strict(os.path.join(root_dir, "closet_category_reference.json"))
    closet_referential_checks(closet, reference)
    type_map = load_type_map()
    label_slip_check(closet, type_map)

    metrics_path = os.path.join(root_dir, "metrics.json")
    if not os.path.exists(metrics_path):
        raise ClosetProbeError("metrics.json is absent — the C4 emission must run before the C5 probe")
    emitted = load_json_strict(metrics_path)

    # Scoring env: single-thread + deterministic algorithms — the emit scored under this exact
    # state (train_one_config pins it), so the catalog cross-check below can demand bit-equality.
    set_determinism(seed)

    index = closet_item_index(closet)
    split = closet_split(closet, index)
    clusters = build_closet_clusters(split, index, seed)
    if not clusters.main:
        raise ClosetProbeError(
            "zero main (categorized) closet clusters survived the §4 construction — no "
            "AUC_closet_pair is computable; the transfer probe needs at least one"
        )

    head, selection = load_sealed_pairwise_head(root_dir)
    closet_cache = embed_closet(closet, root_dir)
    closet_score = head_edge_scorer(head, closet_cache, index)

    ci_closet, pos_clo, neg_clo, groups = outfit_clustered_auc_ci(
        clusters.main, clusters.main_outfits, closet_score, seed=seed, b=b
    )

    # Coarsened slice — reported separately per the manifest's frozen coarsening_policy (§10).
    # Descriptive POINT only: <= a handful of source outfits cannot carry a meaningful CI.
    coarsened_auc = None
    if clusters.coarsened:
        cpos = [closet_score(p.a, p.b) for p, _ in clusters.coarsened]
        cneg = [closet_score(n.a, n.b) for _, n in clusters.coarsened]
        coarsened_auc = auc_pos_neg(cpos, cneg)

    # Closet FITB — strict §4 (a question needs 3 same-category distractors); a small closet
    # yields none. Skip-and-count, never broadened (§15 scarcity rule / §E).
    questions, fitb_skipped = build_fitb(split, index, seed)
    fitb_closet = None
    if questions:
        from evaluate import fitb_hits

        fitb_closet = _ci(fitb_ci(fitb_hits(questions, closet_score), seed=seed, b=b))

    # Catalog side + the bit-determinism cross-check binding this probe to the C4 emission.
    corpus = load_headline_corpus(verbose=False)
    catalog_cache = load_cache(HEADLINE)
    catalog_score = head_edge_scorer(head, catalog_cache, corpus.item_index)
    pos_cat, neg_cat = catalog_pair_scores(corpus, catalog_score, seed=seed)
    point_cat = auc_pos_neg(pos_cat, neg_cat)
    if point_cat != emitted["AUC_catalog_pair"]["point"]:
        raise ClosetProbeError(
            f"re-scored catalog AUC {point_cat!r} != emitted metrics.json AUC_catalog_pair.point "
            f"{emitted['AUC_catalog_pair']['point']!r} — the sealed checkpoint/cache/corpus no longer "
            f"reproduce the C4 emission; the drop would mix two different heads. (The check demands "
            f"bit-equality, which holds on the machine + torch build that emitted metrics.json; a "
            f"different machine/torch version can also trip it.)"
        )

    def stat_catalog(idx: np.ndarray) -> float:
        return auc_pos_neg(pos_cat[idx], neg_cat[idx])

    def stat_closet(idx: np.ndarray) -> float:
        members = np.concatenate([groups[g] for g in idx]).astype(int)
        return auc_pos_neg(pos_clo[members], neg_clo[members])

    drop = unpaired_diff_ci(len(pos_cat), stat_catalog, len(groups), stat_closet, seed=seed, b=b)

    # The optional GPT closet memorization-control slice (§10/§15-C5) is gated on §14 consent —
    # exercise the code-gate for real and record the actual disposition, rather than asserting a
    # refusal that never mechanically happened.
    try:
        assert_egress_consent(closet, "openai")
        gpt_slice_disposition = "consented but deliberately not run (optional §10 supplement)"
    except ClosetProbeError as refusal:
        gpt_slice_disposition = f"refused by assert_egress_consent: {refusal}"

    # Per-category pool sizes actually usable for negatives (§10 label-audit "≥ N members" check,
    # disclosed rather than thresholded — a 13-item closet has pools of 1-3 by construction).
    pool_sizes = {
        cid: len(items) for cid, items in sorted(split.by_cat.items())
        if not cid.startswith(COARSENED_PREFIX)
    }

    doc = {
        "_meta": {
            "stage": "C5",
            "seed": seed,
            "checkpoint_sha256": selection["checkpoint_sha256"],
            "closet_manifest_sha256": _file_sha256(closet_path),
            "embedding_revision_sha": closet_cache.manifest["revision_sha"],
            "catalog_auc_point_crosscheck": point_cat,
            "torch_num_threads": torch.get_num_threads(),
        },
        "AUC_closet_pair": _ci(ci_closet),
        "catalog_closet_drop": _ci(drop),
        "counts": {
            "n_items": len(closet["items"]),
            "n_items_coarsened": sum(1 for it in closet["items"] if it["polyvore_category_id"] is None),
            "n_worn_outfits": len(closet["outfits"]),
            "n_distinct_positive_pairs": len(clusters.main) + len(clusters.coarsened) + clusters.n_skipped,
            "n_kept_main_clusters": len(clusters.main),
            "n_kept_coarsened_clusters": len(clusters.coarsened),
            "n_skipped_no_negative": clusters.n_skipped,
            "effective_n_outfits": len(groups),
            "negative_category_pool_sizes": pool_sizes,
        },
        "coarsened_slice": {
            "policy": closet["_taxonomy"]["coarsening_policy"],
            "items": [it["item_id"] for it in closet["items"] if it["polyvore_category_id"] is None],
            "n_clusters": len(clusters.coarsened),
            "n_source_outfits": len(set(clusters.coarsened_outfits)),
            "auc_point_descriptive_no_ci": coarsened_auc,
        },
        "fitb_closet": {
            "ci": fitb_closet,
            "n_questions": len(questions),
            "n_skipped_lt3_distractors": fitb_skipped,
            "note": "strict §4 FITB needs >= 4 same-fine-category members; skip-and-count, never "
                    "broadened to coarse type (§15 scarcity rule)",
        },
        "clusters": [
            {
                "positive": sorted((p.a, p.b)),
                "negative": [n.a, n.b],
                "replaced": n.replaced,
                "source_outfit": outfit,
                "coarsened": coarse,
            }
            for coarse, cluster_list, outfit_list in (
                (False, clusters.main, clusters.main_outfits),
                (True, clusters.coarsened, clusters.coarsened_outfits),
            )
            for (p, n), outfit in zip(cluster_list, outfit_list)
        ],
        "label_slip_check": "pass",
        "egress": {
            "third_party_api_processing": closet["_consent"]["third_party_api_processing"],
            "gpt_closet_memorization_slice": gpt_slice_disposition,
        },
        "coverage_caveat": (
            "closet-side CI is a percentile bootstrap over the source-outfit unit; coverage at this "
            "few clusters is weak — read directionally against the §12 reference band "
            "(drop <= 0.12 / closet AUC >= 0.70), never as a precise instrument (§10/§11)"
        ),
    }
    out_path = os.path.join(root_dir, CLOSET_METRICS)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1)
    return doc


def main() -> None:
    doc = run_probe()
    c = doc["counts"]
    print(f"[h26 C5] closet: {c['n_items']} items / {c['n_worn_outfits']} worn outfits -> "
          f"{c['n_distinct_positive_pairs']} distinct positives, {c['n_kept_main_clusters']} kept main "
          f"clusters (+{c['n_kept_coarsened_clusters']} coarsened, {c['n_skipped_no_negative']} skipped), "
          f"effective-N = {c['effective_n_outfits']} outfits")
    a, d = doc["AUC_closet_pair"], doc["catalog_closet_drop"]
    print(f"[h26 C5] AUC_closet_pair = {a['point']:.4f} [{a['low']:.4f}, {a['high']:.4f}]")
    print(f"[h26 C5] catalog_closet_drop = {d['point']:.4f} [{d['low']:.4f}, {d['high']:.4f}]")
    print(f"[h26 C5] fitb_closet: {doc['fitb_closet']['n_questions']} questions "
          f"({doc['fitb_closet']['n_skipped_lt3_distractors']} skipped)")
    print(f"[h26 C5] wrote {CLOSET_METRICS} — merge with `python evaluate.py merge-closet`")


if __name__ == "__main__":
    main()
