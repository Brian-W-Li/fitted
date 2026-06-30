"""Tests for the frozen embedding-cache reader (`embed.load_cache`).

The cache reader is shared infra: `baselines` / `train_head` / `evaluate` all map item_id -> frozen
embedding through it, so a silent mis-read corrupts every downstream score. These pin the
tamper-evidence (the manifest content/id hashes must match the loaded blobs), the not-yet-built
fail-loud (the cache-content fields are null until `build_cache` runs), and the duplicate-id +
normalization guards. Hermetic — writes a tiny synthetic cache to tmp_path, no torch/network.
Reference: docs/plans/h26-compatibility-spike-v2.md §5.
"""

import hashlib
import json
import os

import numpy as np
import pytest

from embed import load_cache

KEY = "fashionsiglip"


def _l2(mat: np.ndarray) -> np.ndarray:
    return (mat / np.linalg.norm(mat, axis=1, keepdims=True)).astype(np.float32)


def _write_cache(tmp_path, ids, matrix, *, populate=True, **manifest_over) -> str:
    """Write a {manifest, .npy, ids.json} cache triple to tmp_path and return the root dir. The
    manifest's cache hashes are computed exactly as `embed._manifest` does, so a faithful cache loads
    clean and only a deliberate tamper trips a guard."""
    root = str(tmp_path)
    np.save(os.path.join(root, f"embeddings_{KEY}.npy"), matrix)
    with open(os.path.join(root, f"{KEY}_ids.json"), "w", encoding="utf-8") as f:
        json.dump(ids, f)
    manifest = {
        "backbone_key": KEY, "embedding_dim": int(matrix.shape[1]), "dtype": str(matrix.dtype),
        "normalization": "l2",
        "embeddings_path": f"embeddings_{KEY}.npy" if populate else None,
        "ids_path": f"{KEY}_ids.json" if populate else None,
        "n_items": len(ids) if populate else None,
        "ids_list_sha256": hashlib.sha256(json.dumps(ids).encode()).hexdigest() if populate else None,
        "embeddings_content_sha256": hashlib.sha256(
            np.ascontiguousarray(matrix).tobytes()
        ).hexdigest() if populate else None,
    }
    manifest.update(manifest_over)
    with open(os.path.join(root, f"embedding_manifest_{KEY}.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f)
    return root


def test_load_cache_round_trips_and_indexes(tmp_path):
    ids = ["a", "b", "c", "d"]
    mat = _l2(np.arange(4 * 768, dtype=np.float32).reshape(4, 768) + 1.0)
    root = _write_cache(tmp_path, ids, mat)
    cache = load_cache(KEY, cache_dir=root, root_dir=root)
    assert cache.ids == ids and cache.dim == 768
    assert cache.index == {"a": 0, "b": 1, "c": 2, "d": 3}
    assert cache.has("c") and not cache.has("z")
    np.testing.assert_array_equal(cache.vec("c"), mat[2])       # row alignment is id-keyed


def test_load_cache_detects_content_tamper(tmp_path):
    ids = ["a", "b"]
    mat = _l2(np.random.default_rng(0).standard_normal((2, 768)).astype(np.float32))
    root = _write_cache(tmp_path, ids, mat)
    # swap the .npy for different (still normalized) bytes -> content hash mismatch
    other = _l2(np.random.default_rng(1).standard_normal((2, 768)).astype(np.float32))
    np.save(os.path.join(root, f"embeddings_{KEY}.npy"), other)
    with pytest.raises(ValueError, match="embeddings_content_sha256 mismatch"):
        load_cache(KEY, cache_dir=root, root_dir=root)


def test_load_cache_detects_id_order_tamper(tmp_path):
    ids = ["a", "b", "c"]
    mat = _l2(np.random.default_rng(2).standard_normal((3, 768)).astype(np.float32))
    root = _write_cache(tmp_path, ids, mat)
    with open(os.path.join(root, f"{KEY}_ids.json"), "w", encoding="utf-8") as f:
        json.dump(["c", "b", "a"], f)                           # reorder ids without re-hashing
    with pytest.raises(ValueError, match="ids_list_sha256 mismatch"):
        load_cache(KEY, cache_dir=root, root_dir=root)


def test_load_cache_fails_loud_when_not_built(tmp_path):
    # The C2 manifest ships with null cache-content fields; reading before build_cache must point at
    # the one-time pass, not raise a confusing FileNotFound.
    ids = ["a", "b"]
    mat = _l2(np.random.default_rng(3).standard_normal((2, 768)).astype(np.float32))
    root = _write_cache(tmp_path, ids, mat, populate=False)
    with pytest.raises(RuntimeError, match="not built"):
        load_cache(KEY, cache_dir=root, root_dir=root)


def test_load_cache_rejects_duplicate_ids(tmp_path):
    ids = ["a", "b", "a"]                                       # ids is a LIST -> dup not caught by JSON loader
    mat = _l2(np.random.default_rng(4).standard_normal((3, 768)).astype(np.float32))
    root = _write_cache(tmp_path, ids, mat)
    with pytest.raises(ValueError, match="duplicate item_id"):
        load_cache(KEY, cache_dir=root, root_dir=root)


def test_load_cache_rejects_unnormalized_rows(tmp_path):
    ids = ["a", "b"]
    mat = (np.random.default_rng(5).standard_normal((2, 768)) * 3.0).astype(np.float32)  # NOT L2
    root = _write_cache(tmp_path, ids, mat)
    with pytest.raises(ValueError, match="not L2-normalized"):
        load_cache(KEY, cache_dir=root, root_dir=root)


def test_load_cache_rejects_dim_mismatch(tmp_path):
    ids = ["a", "b"]
    mat = _l2(np.random.default_rng(6).standard_normal((2, 768)).astype(np.float32))
    root = _write_cache(tmp_path, ids, mat, embedding_dim=512)  # manifest claims a different dim
    with pytest.raises(ValueError, match="embedding_dim"):
        load_cache(KEY, cache_dir=root, root_dir=root)
