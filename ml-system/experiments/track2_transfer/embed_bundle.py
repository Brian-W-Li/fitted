"""The gated, all-images-before-scoring Track-2 embedding leg (plan D3/D7/D8).

Cache rows use immutable image IDs, not garment IDs: a garment may have a
different photo in a later snapshot. No scorer or compatibility head runs here.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
from pathlib import Path

import numpy as np

from bundle import Bundle, BundleError, file_sha256
from constants import FIVE_TYPES
from gate import LookClearance
from h26_bridge import H26_ROOT, HEADLINE, EmbeddingCache, embed_images, load_backbone


class EmbeddingError(BundleError):
    pass


FROZEN_MANIFEST = H26_ROOT / f"embedding_manifest_{HEADLINE}.json"
_FROZEN_FIELDS = (
    "backbone_key", "open_clip_id", "pretrained", "revision_sha",
    "preprocess_hash", "embedding_dim", "dtype", "normalization",
)


def image_id(item: dict) -> str:
    """Resolve the exporter's imageRef forms without conflating garment IDs."""
    ref = item.get("imageRef")
    if isinstance(ref, str):
        if ref.startswith("mongo:"):
            value = ref[len("mongo:"):]
        elif ref.startswith("/api/images/"):
            value = re.split(r"[/?#]", ref[len("/api/images/"):], maxsplit=1)[0]
        else:
            value = ref
        if re.fullmatch(r"[a-fA-F0-9]{24}", value):
            return value
    raise EmbeddingError(f"item {item.get('itemId')!r} has invalid imageRef {ref!r}")


def _inventory(bundle: Bundle) -> tuple[dict[str, Path], dict[str, list[str]]]:
    # All representative primary images, including the separately reported
    # operator, plus all resolved rendered items eligible for a secondary draw.
    items = [item for c in bundle.clusters for item in c.items]
    items += [item for row in bundle.rows for item in row.get("items", [])
              if item.get("imageStatus") == "resolved"]
    paths: dict[str, Path] = {}
    bindings: dict[str, set[str]] = {}
    images_root = (bundle.root / "images").resolve()
    for item in items:
        if item.get("clothingType") not in FIVE_TYPES:
            raise EmbeddingError(f"item {item.get('itemId')!r} has invalid clothingType")
        iid = image_id(item)
        path = bundle.image_path(item)
        if images_root not in path.parents or path.stem != iid:
            raise EmbeddingError(f"image {iid!r} must resolve inside images/ under its image ID")
        if iid in paths and paths[iid] != path:
            raise EmbeddingError(f"image {iid!r} has conflicting imageFile paths")
        paths[iid] = path
        garment = item.get("itemId")
        if not isinstance(garment, str) or not garment:
            raise EmbeddingError("resolved image has no itemId")
        bindings.setdefault(garment, set()).add(iid)
    if not paths:
        raise EmbeddingError("cleared bundle contains no images")
    return dict(sorted(paths.items())), {k: sorted(v) for k, v in sorted(bindings.items())}


def _assert_fields(expected: dict, actual: dict, fields, context: str) -> None:
    for field in fields:
        if field not in expected or field not in actual or expected[field] != actual[field]:
            raise EmbeddingError(f"{context}: {field} drift: {actual.get(field)!r} != {expected.get(field)!r}")


def _validate_matrix(matrix: np.ndarray, count: int, frozen: dict) -> None:
    if matrix.shape != (count, frozen["embedding_dim"]):
        raise EmbeddingError(f"embedding_dim / row count drift: shape {matrix.shape}")
    if str(matrix.dtype) != frozen["dtype"]:
        raise EmbeddingError(f"embedding dtype drift: {matrix.dtype}")
    if frozen["normalization"] != "l2" or not np.isfinite(matrix).all():
        raise EmbeddingError("embeddings must be finite and L2-normalized")
    if not np.allclose(np.linalg.norm(matrix, axis=1), 1.0, atol=1e-4, rtol=0):
        raise EmbeddingError("embeddings are not L2-normalized")


def _matrix_hash(matrix: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(matrix).tobytes()).hexdigest()


def embed_bundle(
    bundle: Bundle,
    clearance: LookClearance,
    *,
    out_dir: str | Path | None = None,
    batch_size: int = 32,
    device: str = "cpu",
) -> EmbeddingCache:
    """Return a complete, validated image cache, or abort without returning one.

    Clearance is checked before any image access. All image bytes are hashed,
    decoded, and EXIF-transposed even on a cache hit; stale/corrupt caches fail
    closed. No partial cache is published on decode or backbone failure.
    The caller may start scoring only after this function returns successfully.
    """
    if not isinstance(clearance, LookClearance) or clearance.bundle is not bundle:
        raise EmbeddingError("embedding requires clearance for this exact bundle")
    if not isinstance(batch_size, int) or isinstance(batch_size, bool) or batch_size < 1:
        raise EmbeddingError("batch_size must be a positive integer")
    # The gate provides stronger issue/content checks as part of C2.
    from gate import require_clearance
    require_clearance(clearance)

    from PIL import Image, ImageOps

    frozen = json.loads(FROZEN_MANIFEST.read_text(encoding="utf-8"))
    paths, bindings = _inventory(bundle)
    ids = list(paths)
    images = []
    hashes = {}
    try:
        # Decode the entire inventory before model work, so a late broken image
        # cannot leave a partially completed scoring input or cache artifact.
        for iid, path in paths.items():
            try:
                raw = path.read_bytes()
                with Image.open(io.BytesIO(raw)) as original:
                    corrected = ImageOps.exif_transpose(original)
                    try:
                        image = corrected.convert("RGB")
                        image.load()
                    finally:
                        corrected.close()
                images.append(image)
                hashes[iid] = hashlib.sha256(raw).hexdigest()
            except (OSError, ValueError, Image.DecompressionBombError) as exc:
                raise EmbeddingError(f"image {iid!r} missing or undecodable: {exc}") from exc

        source = {
            "schema": "track2-embedding-cache.v1",
            "n_items": len(ids),
            "exif_transpose": True,
            "embeddings_path": "bundle.embeddings.npy",
            "manifest_sha256": file_sha256(bundle.root / "manifest.json"),
            "training_examples_sha256": file_sha256(bundle.root / "training_examples.jsonl"),
            "image_ids": ids,
            "image_hashes": hashes,
            "image_files": {iid: str(path.relative_to(bundle.root)) for iid, path in paths.items()},
            "item_image_bindings": bindings,
        }
        destination = Path(out_dir) if out_dir is not None else bundle.root
        manifest_path = destination / "bundle.embedding_manifest.json"
        matrix_path = destination / "bundle.embeddings.npy"
        if manifest_path.exists() or matrix_path.exists():
            if not manifest_path.is_file() or not matrix_path.is_file():
                raise EmbeddingError("incomplete embedding cache; restore or remove both cache files")
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                _assert_fields(frozen, manifest, _FROZEN_FIELDS, "cached backbone")
                _assert_fields(source, manifest, source, "cached bundle")
                matrix = np.load(matrix_path, allow_pickle=False)
                _validate_matrix(matrix, len(ids), frozen)
                if manifest.get("embeddings_content_sha256") != _matrix_hash(matrix):
                    raise EmbeddingError("cached embeddings content hash mismatch")
            except (ValueError, OSError) as exc:
                raise EmbeddingError(f"invalid embedding cache: {exc}") from exc
        else:
            loaded = load_backbone(HEADLINE, device=device)
            loaded_fields = {
                "backbone_key": loaded.backbone.key,
                "open_clip_id": loaded.backbone.open_clip_id,
                "pretrained": loaded.backbone.pretrained,
                "revision_sha": loaded.revision_sha,
                "preprocess_hash": loaded.preprocess_hash,
            }
            _assert_fields(frozen, loaded_fields, loaded_fields, "loaded backbone")
            matrix = embed_images(loaded, images, batch_size=batch_size)
            _validate_matrix(matrix, len(ids), frozen)
            manifest = {
                **{key: frozen[key] for key in _FROZEN_FIELDS}, **source,
                "device": loaded.device,
                "embeddings_content_sha256": _matrix_hash(matrix),
            }
            # Manifest is the completion marker. If a write is interrupted, the
            # incomplete-cache guard above refuses reuse rather than repairing it.
            destination.mkdir(parents=True, exist_ok=True)
            np.save(matrix_path, matrix, allow_pickle=False)
            manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        matrix.flags.writeable = False
        return EmbeddingCache(
            key=HEADLINE, ids=ids, matrix=matrix, index={iid: i for i, iid in enumerate(ids)},
            dim=matrix.shape[1], manifest=manifest,
        )
    finally:
        for image in images:
            image.close()
