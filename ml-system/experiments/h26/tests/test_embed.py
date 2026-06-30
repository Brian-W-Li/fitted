"""Hermetic tests for embed.py's pure surface — the backbone registry, the HF split mapping, and
the manifest field shape. The heavy model load + parquet stream are network/torch-gated and
covered by `python embed.py` (the smoke), not here; embed.py's lazy torch import keeps `import
embed` cheap so these run in plain CI. Reference: docs/plans/h26-compatibility-spike-v2.md §5/§15.
"""

import hashlib
import json

import numpy as np
import pytest

import embed
from embed import (
    BACKBONES,
    HEADLINE,
    HF_SPLIT_FOR,
    Backbone,
    LoadedBackbone,
    _accept_image_hash,
    _manifest,
    _stack_in_corpus_order,
    _write_manifest_preserving_freeze,
)

_VALID_ROLES = {"headline", "ablation_matched_base", "ablation_generic", "ablation_fashionclip"}


# --------------------------------------------------------------------------- #
# Backbone registry invariants
# --------------------------------------------------------------------------- #
def test_exactly_one_headline_and_it_is_fashionsiglip():
    headlines = [k for k, b in BACKBONES.items() if b.role == "headline"]
    assert headlines == [HEADLINE] == ["fashionsiglip"]
    assert BACKBONES[HEADLINE].open_clip_id == "hf-hub:Marqo/marqo-fashionSigLIP"
    assert BACKBONES[HEADLINE].hf_repo == "Marqo/marqo-fashionSigLIP"


def test_registry_keys_and_roles_are_consistent():
    for key, bk in BACKBONES.items():
        assert bk.key == key                          # the dict key is the backbone's own key
        assert bk.role in _VALID_ROLES
        # hf_repo is set iff the weights come from a hf-hub repo (the SHA-pinnable backbones)
        assert (bk.hf_repo is not None) == bk.open_clip_id.startswith("hf-hub:")
        # built-in weights carry a pretrained tag; hf-hub weights do not
        assert (bk.pretrained is not None) != bk.open_clip_id.startswith("hf-hub:")


def test_matched_base_is_the_webli_siglip_not_laion():
    # The matched-base rung MUST be the WebLI SigLIP ViT-B/16 FashionSigLIP was fine-tuned from
    # (the clean fashion-fine-tuning delta). Substituting a LAION-2B CLIP would differ in BOTH
    # architecture and corpus, reintroducing the confounds the rung exists to remove (§5).
    base = next(b for b in BACKBONES.values() if b.role == "ablation_matched_base")
    assert base.open_clip_id == "ViT-B-16-SigLIP"
    assert base.pretrained == "webli"
    assert "laion" not in (base.pretrained or "").lower()


# --------------------------------------------------------------------------- #
# HF parquet split mapping (build-doc §2: HF's split is `validation`, ours is `valid`)
# --------------------------------------------------------------------------- #
def test_hf_split_mapping():
    assert HF_SPLIT_FOR == {"train": "train", "valid": "validation", "test": "test"}


# --------------------------------------------------------------------------- #
# Manifest field shape (the embedding_manifest_fashionsiglip.json freeze record)
# --------------------------------------------------------------------------- #
def _loaded(revision="c56244cc", preprocess="fb80278d"):
    return LoadedBackbone(
        backbone=BACKBONES[HEADLINE], model=None, preprocess=None,
        revision_sha=revision, preprocess_hash=preprocess, device="cpu",
    )


def test_manifest_has_the_freeze_fields():
    # _manifest hashes the matrix CONTENT (not the .npy file), so no file needs to exist.
    ids = ["a", "b", "c"]
    hashes = {"a": "h1", "b": "h2", "c": "h3"}
    matrix = np.zeros((3, 768), dtype=np.float32)
    man = _manifest(_loaded(), ids, hashes, matrix,
                    "embeddings_fashionsiglip.npy", "fashionsiglip_ids.json", "fashionsiglip_hashes.json")
    # everything the freeze pins (§5/§15) must be present and correct
    assert man["backbone_key"] == "fashionsiglip"
    assert man["revision_sha"] == "c56244cc"
    assert man["preprocess_hash"] == "fb80278d"
    assert man["embedding_dim"] == 768
    assert man["dtype"] == "float32"
    assert man["normalization"] == "l2"
    assert man["n_items"] == 3
    assert man["device"] == "cpu"
    assert man["image_hashes_path"] == "fashionsiglip_hashes.json"
    assert man["embeddings_path"] == "embeddings_fashionsiglip.npy"
    # exact-value pins: a wrong-bytes mutation (unordered hashes, wrong ids encoding) still yields a
    # 64-char hex string, so length checks have no teeth — pin the actual hashes.
    assert man["image_hashes_sha256"] == hashlib.sha256(b"h1h2h3").hexdigest()
    assert man["ids_list_sha256"] == hashlib.sha256(json.dumps(ids).encode()).hexdigest()
    assert man["embeddings_content_sha256"] == hashlib.sha256(
        np.ascontiguousarray(matrix).tobytes()
    ).hexdigest()


def test_manifest_image_hash_summary_is_order_sensitive():
    # The image-hash summary must depend on the per-item content hashes IN id order, so a swapped
    # or altered image is detectable.
    ids = ["a", "b"]
    matrix = np.zeros((2, 768), dtype=np.float32)
    m1 = _manifest(_loaded(), ids, {"a": "h1", "b": "h2"}, matrix, "e.npy", "i.json", "h.json")
    m2 = _manifest(_loaded(), ids, {"a": "h2", "b": "h1"}, matrix, "e.npy", "i.json", "h.json")
    assert m1["image_hashes_sha256"] != m2["image_hashes_sha256"]


# --------------------------------------------------------------------------- #
# Corpus-order re-key + fail-loud (§2 integrity; extracted pure so it is hermetically testable)
# --------------------------------------------------------------------------- #
def test_stack_in_corpus_order_realigns_regardless_of_parquet_order():
    # The parquet streams ids in arbitrary order; the matrix MUST be aligned to item_ids order so
    # row i is item_ids[i]'s embedding (the C3 id->row contract). A misalignment here silently
    # corrupts every downstream score.
    by_id = {
        "b": np.full(4, 2.0, np.float32),
        "a": np.full(4, 1.0, np.float32),
        "c": np.full(4, 3.0, np.float32),
    }
    matrix, missing = _stack_in_corpus_order(by_id, ["a", "b", "c"])
    assert missing == []
    assert matrix.shape == (3, 4) and matrix.dtype == np.float32
    assert [matrix[0, 0], matrix[1, 0], matrix[2, 0]] == [1.0, 2.0, 3.0]  # corpus order, not dict order


def test_stack_in_corpus_order_reports_missing_ids():
    # The §2 fail-loud guard: a requested id absent from the parquet returns (None, missing) so
    # build_cache raises rather than silently shipping a short/zero-filled cache.
    matrix, missing = _stack_in_corpus_order({"a": np.zeros(4, np.float32)}, ["a", "b", "c"])
    assert matrix is None
    assert missing == ["b", "c"]


# --------------------------------------------------------------------------- #
# Freeze-verify on overwrite (§D one-way-door contract: C3 build_cache must NOT clobber the C2 config)
# --------------------------------------------------------------------------- #
def _committed(tmp_path, **over):
    base = {
        "backbone_key": "fashionsiglip", "open_clip_id": "hf-hub:Marqo/marqo-fashionSigLIP",
        "pretrained": None, "revision_sha": "AAA", "preprocess_hash": "P", "embedding_dim": 768,
        "dtype": "float32", "normalization": "l2", "device": "cpu",
        "_README": "doc", "_freeze": {"x": 1}, "n_items": None, "embeddings_path": None,
    }
    base.update(over)
    path = str(tmp_path / "embedding_manifest_fashionsiglip.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(base, f)
    return path


def test_write_manifest_raises_on_frozen_config_drift(tmp_path):
    # A drifted revision_sha (a different backbone weight) must RAISE and leave the committed C2
    # freeze untouched — the §D "enforced, not git-historical" guarantee. Without this, a C3
    # build_cache run would silently overwrite the frozen revision/preprocess.
    path = _committed(tmp_path)
    fresh = {"backbone_key": "fashionsiglip", "open_clip_id": "hf-hub:Marqo/marqo-fashionSigLIP",
             "pretrained": None, "revision_sha": "BBB", "preprocess_hash": "P", "embedding_dim": 768,
             "dtype": "float32", "normalization": "l2", "device": "cpu", "n_items": 5}
    with pytest.raises(RuntimeError, match="freeze drift"):
        _write_manifest_preserving_freeze(path, fresh)
    with open(path, encoding="utf-8") as f:
        assert json.load(f)["revision_sha"] == "AAA"  # committed freeze NOT overwritten


def test_write_manifest_rejects_corrupt_committed_manifest(tmp_path):
    path = str(tmp_path / "embedding_manifest_fashionsiglip.json")
    with open(path, "w", encoding="utf-8") as f:
        f.write('{"revision_sha": "AAA", "revision_sha": "BBB"}')
    fresh = {
        "backbone_key": "fashionsiglip", "open_clip_id": "hf-hub:Marqo/marqo-fashionSigLIP",
        "pretrained": None, "revision_sha": "AAA", "preprocess_hash": "P", "embedding_dim": 768,
        "dtype": "float32", "normalization": "l2",
    }
    with pytest.raises(ValueError, match="duplicate JSON key"):
        _write_manifest_preserving_freeze(path, fresh)

    with open(path, "w", encoding="utf-8") as f:
        f.write('{"revision_sha": NaN}')
    with pytest.raises(ValueError, match="non-finite JSON constant"):
        _write_manifest_preserving_freeze(path, fresh)


def test_write_manifest_merges_cache_and_preserves_docs(tmp_path):
    # On a matching config, the regenerated cache fields fill the staged nulls and the C2-recorded
    # documentation (_README/_freeze) survives the overwrite; `device` is recorded-not-verified so a
    # GPU one-time pass (cpu -> mps) is allowed (FC-4).
    path = _committed(tmp_path)
    fresh = {"backbone_key": "fashionsiglip", "open_clip_id": "hf-hub:Marqo/marqo-fashionSigLIP",
             "pretrained": None, "revision_sha": "AAA", "preprocess_hash": "P", "embedding_dim": 768,
             "dtype": "float32", "normalization": "l2", "device": "mps",
             "n_items": 5, "embeddings_path": "embeddings_fashionsiglip.npy"}
    out = _write_manifest_preserving_freeze(path, fresh)
    assert out["n_items"] == 5 and out["embeddings_path"] == "embeddings_fashionsiglip.npy"
    assert out["_README"] == "doc" and out["_freeze"] == {"x": 1}  # C2 docs survive the overwrite
    assert out["device"] == "mps"                                  # recorded device updates freely


def test_populated_cache_fields_are_immutable(tmp_path):
    path = _committed(
        tmp_path,
        n_items=5,
        ids_path="ids.json",
        ids_list_sha256="a" * 64,
        image_hashes_path="image_hashes.json",
        image_hashes_sha256="b" * 64,
        embeddings_path="embeddings.npy",
        embeddings_content_sha256="c" * 64,
    )
    fresh = {"backbone_key": "fashionsiglip", "open_clip_id": "hf-hub:Marqo/marqo-fashionSigLIP",
             "pretrained": None, "revision_sha": "AAA", "preprocess_hash": "P", "embedding_dim": 768,
             "dtype": "float32", "normalization": "l2", "device": "mps",
             "n_items": 5, "ids_path": "ids.json", "ids_list_sha256": "a" * 64,
             "image_hashes_path": "image_hashes.json", "image_hashes_sha256": "b" * 64,
             "embeddings_path": "embeddings.npy", "embeddings_content_sha256": "d" * 64}
    with pytest.raises(RuntimeError, match="embedding cache freeze drift"):
        _write_manifest_preserving_freeze(path, fresh)


def test_build_cache_preflights_freeze_before_writing_cache_files(tmp_path, monkeypatch):
    root = tmp_path / "root"
    out = tmp_path / "cache"
    root.mkdir()
    out.mkdir()
    ids = ["a", "b"]
    hashes = {"a": "h1", "b": "h2"}
    matrix = np.zeros((2, 768), dtype=np.float32)
    matrix[:, 0] = 1.0

    monkeypatch.setattr(embed, "ROOT_DIR", str(root))
    monkeypatch.setattr(embed, "load_backbone", lambda key, device="cpu": _loaded("AAA", "P"))
    monkeypatch.setattr(
        embed,
        "iter_parquet_items",
        lambda splits, wanted_ids, streaming=True: ((iid, object(), hashes[iid]) for iid in ids),
    )
    monkeypatch.setattr(embed, "embed_images", lambda loaded, imgs, batch_size=64: matrix[:len(imgs)])

    npy_path = out / "embeddings_fashionsiglip.npy"
    ids_path = out / "fashionsiglip_ids.json"
    hashes_path = out / "fashionsiglip_hashes.json"
    npy_path.write_bytes(b"old-npy")
    ids_path.write_text('"old-ids"', encoding="utf-8")
    hashes_path.write_text('"old-hashes"', encoding="utf-8")

    manifest_path = _committed(
        root,
        n_items=2,
        ids_path="fashionsiglip_ids.json",
        ids_list_sha256=hashlib.sha256(json.dumps(ids).encode()).hexdigest(),
        image_hashes_path="fashionsiglip_hashes.json",
        image_hashes_sha256=hashlib.sha256(b"h1h2").hexdigest(),
        embeddings_path="embeddings_fashionsiglip.npy",
        embeddings_content_sha256="c" * 64,
    )
    before_manifest = open(manifest_path, encoding="utf-8").read()

    with pytest.raises(RuntimeError, match="embedding cache freeze drift"):
        embed.build_cache(ids, key=HEADLINE, out_dir=str(out), batch_size=2, splits=("test",))

    assert npy_path.read_bytes() == b"old-npy"
    assert ids_path.read_text(encoding="utf-8") == '"old-ids"'
    assert hashes_path.read_text(encoding="utf-8") == '"old-hashes"'
    assert open(manifest_path, encoding="utf-8").read() == before_manifest


def test_write_manifest_no_existing_file_writes_fresh(tmp_path):
    path = str(tmp_path / "embedding_manifest_new.json")
    fresh = {"revision_sha": "AAA", "n_items": 3}
    assert _write_manifest_preserving_freeze(path, fresh) == fresh
    with open(path, encoding="utf-8") as f:
        assert json.load(f) == fresh


def test_write_manifest_can_require_existing_freeze(tmp_path):
    path = str(tmp_path / "embedding_manifest_fashionsiglip.json")
    with pytest.raises(RuntimeError, match="missing committed C2 embedding freeze"):
        _write_manifest_preserving_freeze(path, {"revision_sha": "AAA"}, require_existing=True)


def test_duplicate_item_ids_must_have_identical_image_hashes():
    seen = {}
    assert _accept_image_hash("item1", "hash-a", seen, "test") is True
    assert _accept_image_hash("item1", "hash-a", seen, "test") is False
    with pytest.raises(RuntimeError, match="conflicting parquet image bytes"):
        _accept_image_hash("item1", "hash-b", seen, "test")


def test_backbone_is_frozen_dataclass():
    # registry entries must be immutable so a stray mutation can't silently re-point a backbone
    bk = BACKBONES[HEADLINE]
    assert isinstance(bk, Backbone)
    try:
        bk.open_clip_id = "hf-hub:evil/model"
    except Exception as e:
        assert "frozen" in str(e).lower() or isinstance(e, (AttributeError,))
    else:
        raise AssertionError("Backbone should be a frozen dataclass")
    # sanity: embed module exposes the headline loader entrypoint
    assert hasattr(embed, "load_backbone")
