"""Tests for the C5 domain probe + the evaluate.py merge (§10/§14/§15-C5).

Hermetic: the pure closet machinery (sentinel categories, the §4 construction partition, the
source-outfit bootstrap, the label-slip + consent + photo-hash guards) runs on synthetic closets
with injected scores — no torch, no backbone, no photos beyond tmp files. The merge tests reuse
the `test_evaluate_emission` unlock-dir helpers (an emitted stage-C4 metrics.json + FakeGit) and
assert the bind-verification refusal matrix: a probe scored against a different checkpoint /
manifest / catalog world must never fold into the gated artifact.
"""

import hashlib
import json
import os
import shutil

import pytest

import domain_probe as dp
import evaluate as ev
from data_loader import build_fitb
from evaluate import UnlockError
from test_evaluate_emission import (
    _COPY,
    FakeGit,
    _addendum_md,
    _calibration_json,
    _closet,
    _frozen_envelope,
    _gate_b,
    _suite,
)
from train_head import manifest_hashes

H26 = os.path.dirname(os.path.dirname(__file__))


# --------------------------------------------------------------------------- #
# Synthetic closet (2 coarsened outer layers + categorized tops/bottoms/shoes)
# --------------------------------------------------------------------------- #
def _probe_closet():
    """Shaped like the real manifest: singleton shoes worn everywhere, a 3-member top category
    (the only replaceable pool), and two null-category (coarsened) outer layers that co-occur with
    disjoint halves of the closet — so a null-keyed pool would tempt drawing one as the other's
    same-category negative (the trap the sentinel categories must close)."""
    def item(iid, typ, cid, note=None):
        return {"item_id": iid, "clothing_type": typ, "polyvore_category_id": cid,
                "fine_label_human": f"{iid} garment", "photo_path": f"closet/{iid}.jpg",
                "photo_sha256": "0" * 64, "coarsening_note": note}

    items = [
        item("t1", "top", "21"), item("t2", "top", "21"), item("t3", "top", "21"),
        item("b1", "bottom", "237"), item("b2", "bottom", "237"),
        item("s1", "shoes", "268"),
        item("x1", "outer_layer", None, note="crewneck worn as outer; no Polyvore analog"),
        item("x2", "outer_layer", None, note="crewneck worn as outer; no Polyvore analog"),
    ]
    outfits = [
        {"set_id": "o01", "item_ids": ["t1", "b1", "s1"]},
        {"set_id": "o02", "item_ids": ["t2", "b2", "s1"]},
        {"set_id": "o03", "item_ids": ["t1", "b2", "x1", "s1"]},
        {"set_id": "o04", "item_ids": ["t2", "b1", "x2", "s1"]},
        {"set_id": "o05", "item_ids": ["t3", "b1", "s1"]},
    ]
    return _closet(["21", "237"], items=items, outfits=outfits)


@pytest.fixture
def closet():
    return _probe_closet()


@pytest.fixture
def clusters(closet):
    index = dp.closet_item_index(closet)
    split = dp.closet_split(closet, index)
    return dp.build_closet_clusters(split, index, seed=20260629), index, split


# --------------------------------------------------------------------------- #
# Sentinel categories + the null-pool trap
# --------------------------------------------------------------------------- #
def test_closet_item_index_sentinels(closet):
    index = dp.closet_item_index(closet)
    assert index["t1"].category_id == "21" and not dp.is_coarsened(index["t1"])
    assert dp.is_coarsened(index["x1"]) and dp.is_coarsened(index["x2"])
    # per-item sentinels: the two coarsened items must NOT share a category (the null-pool trap)
    assert index["x1"].category_id != index["x2"].category_id


def test_coarsened_items_never_drawn_as_negatives(clusters):
    cc, index, _ = clusters
    for pos, neg in cc.main + cc.coarsened:
        assert not dp.is_coarsened(index[neg.b]), (
            f"drawn negative {neg.b} is coarsened — sentinel invariant broke on {pos}"
        )
        # specifically: x1 and x2 never negative-paired with each other
        assert {neg.a, neg.b} != {"x1", "x2"}


def test_partition_main_vs_coarsened_and_outfit_assignment(clusters):
    cc, index, _ = clusters
    for pos, _neg in cc.main:
        assert not (dp.is_coarsened(index[pos.a]) or dp.is_coarsened(index[pos.b]))
    assert cc.coarsened, "the synthetic closet must produce at least one kept coarsened cluster"
    for pos, _neg in cc.coarsened:
        assert dp.is_coarsened(index[pos.a]) or dp.is_coarsened(index[pos.b])
    # first-source-outfit assignment (manifest order): (t2, b2) first co-occurs in o02 and
    # (t1, b2) in o03 — both KEPT clusters, so the assertions genuinely fire
    assignments = {frozenset((pos.a, pos.b)): outfit for (pos, _neg), outfit in zip(cc.main, cc.main_outfits)}
    assert assignments[frozenset(("t2", "b2"))] == "o02"
    assert assignments[frozenset(("t1", "b2"))] == "o03"
    # every coarsened cluster's positive comes from an outfit containing x1/x2
    assert set(cc.coarsened_outfits) <= {"o03", "o04"}


def test_construction_is_deterministic(closet):
    index = dp.closet_item_index(closet)
    split = dp.closet_split(closet, index)
    a = dp.build_closet_clusters(split, index, seed=20260629)
    b = dp.build_closet_clusters(split, index, seed=20260629)
    assert a == b


# --------------------------------------------------------------------------- #
# Guards: label slip, consent, photo hashes
# --------------------------------------------------------------------------- #
def test_label_slip_check_passes_and_fails(closet):
    type_map = {"21": {"type": "top"}, "237": {"type": "bottom"}, "268": {"type": "shoes"}}
    dp.label_slip_check(closet, type_map)  # consistent -> no raise
    slipped = json.loads(json.dumps(closet))
    slipped["items"][0]["clothing_type"] = "bottom"  # t1 mislabeled
    with pytest.raises(dp.ClosetProbeError, match="t1.*label slip|label slip.*t1"):
        dp.label_slip_check(slipped, type_map)
    with pytest.raises(dp.ClosetProbeError, match="absent from type_map"):
        dp.label_slip_check(closet, {"21": {"type": "top"}})


def test_egress_consent_gate(closet):
    with pytest.raises(dp.ClosetProbeError, match="third_party_api_processing is false"):
        dp.assert_egress_consent(closet, "openai")
    consented = json.loads(json.dumps(closet))
    consented["_consent"]["third_party_api_processing"] = True
    consented["_consent"]["providers_photos_may_reach"] = ["openai"]
    dp.assert_egress_consent(consented, "openai")  # enumerated -> allowed
    with pytest.raises(dp.ClosetProbeError, match="not enumerated"):
        dp.assert_egress_consent(consented, "anthropic")


def test_verify_photo_hashes(tmp_path, closet):
    root = tmp_path / "h26"
    (root / "closet").mkdir(parents=True)
    small = _probe_closet()
    small["items"] = small["items"][:1]
    small["outfits"] = [{"set_id": "o01", "item_ids": ["t1", "t2"]}]  # schema-shape only
    photo = root / "closet" / "t1.jpg"
    photo.write_bytes(b"not-a-real-jpeg-but-bytes-suffice-for-hashing")
    small["items"][0]["photo_sha256"] = hashlib.sha256(photo.read_bytes()).hexdigest()
    assert dp.verify_photo_hashes(small, str(root)) == [str(photo)]
    photo.write_bytes(b"EDITED after the manifest froze")
    with pytest.raises(dp.ClosetProbeError, match="photo bytes changed"):
        dp.verify_photo_hashes(small, str(root))
    os.remove(photo)
    with pytest.raises(dp.ClosetProbeError, match="absent"):
        dp.verify_photo_hashes(small, str(root))


def test_embed_closet_applies_exif_orientation(tmp_path, monkeypatch):
    """Real phone photos carry EXIF orientation (all 13 committed closet photos are
    orientation=6) and PIL does NOT apply it on open — embed_closet must exif_transpose before
    embedding or the backbone scores sideways garments (the C5 review blocker). Pin: a tall image
    saved with orientation=6 (stored rotated) must reach the embedder upright (taller than wide)."""
    import numpy as np
    from PIL import Image

    root = tmp_path / "h26"
    (root / "closet").mkdir(parents=True)
    # a 60x120 (w x h) upright image, stored as its 120x60 rotated form + orientation=6, the way
    # phones write portrait shots
    stored = Image.new("RGB", (120, 60), (10, 200, 30))
    exif = Image.Exif()
    exif[274] = 6  # Orientation: rotate 90 CW to display
    photo = root / "closet" / "t1.jpg"
    stored.save(photo, format="JPEG", exif=exif)
    import hashlib as _hl
    closet = _probe_closet()
    closet["items"] = closet["items"][:1]
    closet["items"][0]["photo_sha256"] = _hl.sha256(photo.read_bytes()).hexdigest()

    seen_sizes = []

    def fake_load_backbone(key, device="cpu"):
        class L:
            revision_sha = "rev"
            preprocess_hash = "pre"
        return L()

    def fake_embed_images(loaded, images, batch_size=64):
        seen_sizes.extend(im.size for im in images)
        return np.ones((len(images), 4), dtype=np.float32)

    import embed as embed_mod
    monkeypatch.setattr(embed_mod, "load_backbone", fake_load_backbone)
    monkeypatch.setattr(embed_mod, "embed_images", fake_embed_images)
    monkeypatch.setattr(
        embed_mod, "cache_manifest_path", lambda key, rd: str(root / "manifest.json")
    )
    (root / "manifest.json").write_text(
        json.dumps({"revision_sha": "rev", "preprocess_hash": "pre", "embedding_dim": 4})
    )
    cache = dp.embed_closet(closet, str(root))
    assert seen_sizes == [(60, 120)], (
        f"embedder received {seen_sizes} — EXIF orientation was not applied (expected the upright "
        f"60x120, not the stored 120x60)"
    )
    assert cache.ids == ["t1"]


# --------------------------------------------------------------------------- #
# Outfit-clustered AUC (the §10/§11 source-outfit bootstrap unit)
# --------------------------------------------------------------------------- #
def _scored(scores):
    """An EdgeScore over explicit per-pair values (unordered)."""
    def edge(i, j):
        return scores[frozenset((i, j))]
    return edge


def test_outfit_clustered_auc_perfect_separation(clusters):
    cc, _index, _split = clusters
    scores = {}
    for pos, neg in cc.main:
        scores[frozenset((pos.a, pos.b))] = 1.0
        scores[frozenset((neg.a, neg.b))] = 0.0
    ci, pos_arr, neg_arr, groups = dp.outfit_clustered_auc_ci(
        cc.main, cc.main_outfits, _scored(scores), seed=7, b=200
    )
    assert ci.point == 1.0 and ci.low == 1.0 and ci.high == 1.0
    assert len(pos_arr) == len(neg_arr) == len(cc.main)
    assert len(groups) == len(set(cc.main_outfits))  # effective-N = #distinct source outfits
    assert sorted(k for g in groups for k in g) == list(range(len(cc.main)))


def test_outfit_clustered_auc_resamples_at_outfit_unit(clusters):
    cc, _index, _split = clusters
    # one outfit's clusters inverted -> replicates that draw it more/less move the AUC -> a
    # non-degenerate CI. Guards the statistic actually resampling GROUPS, not flat clusters.
    bad_outfit = cc.main_outfits[0]
    scores = {}
    for (pos, neg), outfit in zip(cc.main, cc.main_outfits):
        hit = outfit != bad_outfit
        scores[frozenset((pos.a, pos.b))] = 1.0 if hit else 0.0
        scores[frozenset((neg.a, neg.b))] = 0.0 if hit else 1.0
    ci, _p, _n, groups = dp.outfit_clustered_auc_ci(
        cc.main, cc.main_outfits, _scored(scores), seed=7, b=500
    )
    assert len(groups) > 1
    assert ci.low < ci.high, "inverting one outfit must produce a non-degenerate outfit-level CI"


def test_outfit_clustered_auc_refuses_empty():
    with pytest.raises(dp.ClosetProbeError, match="no kept closet clusters"):
        dp.outfit_clustered_auc_ci([], [], lambda i, j: 0.0, seed=7)


def test_outfit_clustered_auc_exact_replicate_frame():
    """Pin the §10/§11 resample unit EXACTLY: 3 clusters in 2 outfit groups (o1 carries two — the
    real closet has such outfits) must bootstrap as `rng.integers(0, 2, 2)` draws over GROUPS whose
    members move together, reproduced here by a hand-rolled reference. A flat per-cluster mutant
    (`rng.integers(0, 3, 3)`) draws a different stream and fails. Heterogeneous scores so distinct
    draws give distinct AUCs; the point estimate is also pinned as the pooled all-cluster AUC."""
    import numpy as np

    from data_loader import Edge
    from metrics import auc_pos_neg

    clusters = [
        (Edge("a1", "b1", 1), Edge("a1", "n1", 0, anchor="a1", replaced="b1")),
        (Edge("a2", "b2", 1), Edge("a2", "n2", 0, anchor="a2", replaced="b2")),
        (Edge("a3", "b3", 1), Edge("a3", "n3", 0, anchor="a3", replaced="b3")),
    ]
    outfits_of = ["o1", "o1", "o2"]
    scores = {
        frozenset(("a1", "b1")): 0.9, frozenset(("a1", "n1")): 0.1,
        frozenset(("a2", "b2")): 0.2, frozenset(("a2", "n2")): 0.7,
        frozenset(("a3", "b3")): 0.8, frozenset(("a3", "n3")): 0.3,
    }
    ci, pos, neg, groups = dp.outfit_clustered_auc_ci(
        clusters, outfits_of, _scored(scores), seed=7, b=400
    )
    assert groups == [[0, 1], [2]]  # sorted group ids: o1 -> clusters 0,1; o2 -> cluster 2
    assert ci.point == auc_pos_neg(pos, neg)
    # hand-rolled reference of the SAME stream metrics.bootstrap_ci uses, over the 2 GROUPS
    rng = np.random.default_rng(7)
    boot = np.empty(400)
    for i in range(400):
        members = np.concatenate([groups[g] for g in rng.integers(0, 2, 2)]).astype(int)
        boot[i] = auc_pos_neg(pos[members], neg[members])
    lo, hi = np.quantile(boot, [0.025, 0.975])
    assert (ci.low, ci.high) == (float(lo), float(hi)), (
        "outfit-unit bootstrap did not reproduce the group-resample reference stream — a flat "
        "per-cluster resample (the mutant this pins against) draws rng.integers(0, 3, 3) instead"
    )


# --------------------------------------------------------------------------- #
# Closet FITB: strict §4 -> zero questions on a thin closet (skip-and-count)
# --------------------------------------------------------------------------- #
def test_closet_fitb_zero_questions_on_thin_closet(clusters):
    _cc, index, split = clusters
    questions, skipped = build_fitb(split, index, seed=20260629)
    assert questions == [] and skipped == len(split.outfits), (
        "a closet whose largest category has 3 members cannot yield a strict 3-distractor FITB "
        "question; every outfit must be skipped-and-counted, never broadened (§15 scarcity rule)"
    )


# --------------------------------------------------------------------------- #
# merge_closet_metrics — bind verification + refusal matrix
# --------------------------------------------------------------------------- #
@pytest.fixture
def merged_root(tmp_path):
    """An unlock dir with an EMITTED stage-C4 metrics.json (the test_evaluate_emission happy path)
    plus a closet_metrics.json whose binds all match — the merge happy-path input."""
    root = tmp_path / "h26"
    root.mkdir()
    for name in _COPY:
        shutil.copy(os.path.join(H26, name), root / name)
    cal_bytes = json.dumps(_calibration_json()).encode("utf-8")
    (root / "calibration_set.json").write_bytes(cal_bytes)
    (root / "judge_addendum.md").write_text(
        _addendum_md(_frozen_envelope(cal_sha=hashlib.sha256(cal_bytes).hexdigest())), encoding="utf-8"
    )
    ref = json.load(open(root / "closet_category_reference.json", encoding="utf-8"))
    cat_ids = list(ref["categories"])[:2]
    (root / "closet_manifest.json").write_text(json.dumps(_closet(cat_ids)), encoding="utf-8")
    selection = {
        "checkpoint_id": "fashionsiglip_pairwise_edge_grid_0_seed20260629",
        "checkpoint_sha256": "f" * 64,
        "training_config": {"head": "pairwise_type_conditioned_edge", "optimizer": "adam",
                            "seed": 20260629, "config_id": "grid_0",
                            "selection_metric": "valid_pooled_pair_level_roc_auc"},
        "converged": True, "early_stop_epoch": 7,
        "manifest_hashes": manifest_hashes(str(root)),
    }
    (root / "selection.json").write_text(json.dumps(selection), encoding="utf-8")
    metrics = ev.emit_metrics(_suite(), _gate_b(), root_dir=str(root), git=FakeGit())
    closet_sha = hashlib.sha256((root / "closet_manifest.json").read_bytes()).hexdigest()
    closet_metrics = {
        "_meta": {
            "stage": "C5", "seed": 20260629,
            "checkpoint_sha256": "f" * 64,
            "closet_manifest_sha256": closet_sha,
            "catalog_auc_point_crosscheck": metrics["AUC_catalog_pair"]["point"],
        },
        "AUC_closet_pair": {"point": 0.68, "low": 0.40, "high": 0.92, "b": 10000},
        "catalog_closet_drop": {"point": 0.17, "low": -0.07, "high": 0.45, "b": 10000},
        "counts": {"n_kept_main_clusters": 8, "effective_n_outfits": 6},
    }
    (root / "closet_metrics.json").write_text(json.dumps(closet_metrics), encoding="utf-8")
    return str(root)


def _rewrite_closet_meta(root, **overrides):
    path = os.path.join(root, "closet_metrics.json")
    doc = json.load(open(path, encoding="utf-8"))
    doc["_meta"].update(overrides)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f)


def test_merge_happy_path(merged_root):
    merged = ev.merge_closet_metrics(merged_root, git=FakeGit())
    assert merged["_meta"]["stage"] == "C5"
    assert merged["AUC_closet_pair"]["point"] == 0.68
    assert merged["catalog_closet_drop"]["high"] == 0.45
    expected_sha = hashlib.sha256(
        open(os.path.join(merged_root, "closet_metrics.json"), "rb").read()
    ).hexdigest()
    assert merged["_meta"]["closet_metrics_sha256"] == expected_sha
    on_disk = json.load(open(os.path.join(merged_root, "metrics.json"), encoding="utf-8"))
    assert on_disk == merged
    # the merged doc re-validates against the schema (stage C5 REQUIRES the closet fields)
    ev._validate_against_schema(
        merged, os.path.join(merged_root, "metrics.schema.json"), what="merged metrics"
    )


def test_merge_is_idempotent(merged_root):
    first = ev.merge_closet_metrics(merged_root, git=FakeGit())
    again = ev.merge_closet_metrics(merged_root, git=FakeGit())
    assert again == first


def _assert_merge_refused(root, match):
    before = open(os.path.join(root, "metrics.json"), "rb").read()
    with pytest.raises(UnlockError, match=match):
        ev.merge_closet_metrics(root, git=FakeGit())
    assert open(os.path.join(root, "metrics.json"), "rb").read() == before, (
        "a refused merge must leave metrics.json untouched"
    )


def test_merge_refuses_checkpoint_mismatch(merged_root):
    _rewrite_closet_meta(merged_root, checkpoint_sha256="a" * 64)
    _assert_merge_refused(merged_root, "different from the sealed selection")


def test_merge_refuses_closet_manifest_mismatch(merged_root):
    _rewrite_closet_meta(merged_root, closet_manifest_sha256="a" * 64)
    _assert_merge_refused(merged_root, "different from the unlock record")


def test_merge_refuses_catalog_point_mismatch(merged_root):
    _rewrite_closet_meta(merged_root, catalog_auc_point_crosscheck=0.123456)
    _assert_merge_refused(merged_root, "does not reproduce the emitted")


def test_merge_refuses_freeze_drift_since_emission(merged_root):
    # a freeze file edited between emit and merge -> the fresh unlock hashes no longer match the
    # ones metrics.json recorded -> refuse (the closet fields must bind the SAME freeze)
    md = os.path.join(merged_root, "preregistration.md")
    with open(md, "a", encoding="utf-8") as f:
        f.write("\n<!-- drifted after emission -->\n")
    _assert_merge_refused(merged_root, "changed since the C4 emission")


def test_merge_refuses_when_closet_metrics_absent(merged_root):
    os.remove(os.path.join(merged_root, "closet_metrics.json"))
    _assert_merge_refused(merged_root, "closet_metrics.json is absent")


def test_merge_refuses_when_metrics_absent(merged_root):
    os.remove(os.path.join(merged_root, "metrics.json"))
    with pytest.raises(UnlockError, match="C4 emission must run"):
        ev.merge_closet_metrics(merged_root, git=FakeGit())
