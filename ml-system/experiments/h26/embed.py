"""Frozen image-embedding backbones for the H26 spike (§5).

Headline backbone = **Marqo-FashionSigLIP** (ViT-B/16-SigLIP, frozen), L2-normalized image
embeddings, loaded via `open_clip`. The compatibility head (C3) trains over this frozen space, so
embeddings are computed **once** and cached; `embedding_manifest_fashionsiglip.json` freezes the
C2 backbone/config fields now and receives the C3 cache-content fields (item-id order + per-image
content hashes + cache hash) before training, so a result is reproducible from the manifest alone.

Images come from the gated `mvasil/polyvore-outfits` **parquet** configs — an `image` column of
JPEG bytes keyed by `item_id`, NOT loose `{item_id}.jpg` files (build-doc §2; the C1 loader reads
only the loose `disjoint/*.json` outfit structure). The HF parquet split `validation` maps to our
`valid`.

Ablation backbones (§5, STRETCH — never the headline): the **matched WebLI SigLIP ViT-B/16 base**
FashionSigLIP was fine-tuned from (the clean fashion-fine-tuning delta), a generic CLIP rung
(reported honestly as "fashion-domain vs generic CLIP," not "how much fashion-pretraining buys"
unless the matched base is run), and FashionCLIP-2.0. All train over one cached pass per backbone.

Reference: docs/plans/h26-compatibility-spike-v2.md §5 (backbone) / §2 (parquet image source) / §15.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
from collections.abc import Iterable, Iterator
from dataclasses import dataclass

import numpy as np

from data_loader import load_json_strict

# Heavy deps (torch / open_clip / datasets / PIL / huggingface_hub) are imported lazily inside the
# functions that need them, so importing this module (e.g. for the registry or a manifest read) is
# cheap and does not pull torch.

HF_DATASET = "mvasil/polyvore-outfits"
# HF parquet config "disjoint" splits -> our split names (build-doc §2: `validation` is HF's name).
HF_SPLIT_FOR = {"train": "train", "valid": "validation", "test": "test"}
# Item-level id columns to detect in the parquet — NOT `set_id` (the outfit id); images are keyed
# by item_id (§2). Order = preference.
ID_COLUMNS = ("item_id", "id")
DEFAULT_CACHE_DIR = os.path.join(os.path.dirname(__file__), "embeddings")
ROOT_DIR = os.path.dirname(__file__)  # committed freeze artifacts (manifests) live here, not in the cache


# --------------------------------------------------------------------------- #
# Backbone registry
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Backbone:
    """One frozen embedding backbone. `open_clip_id` is the first arg to
    `open_clip.create_model_from_pretrained` — either a ``hf-hub:owner/repo`` string (then
    `hf_repo` names the repo whose commit SHA pins the weights) or a built-in model name paired with
    a `pretrained` tag (then the open_clip version + tag is the provenance)."""

    key: str
    open_clip_id: str
    role: str                       # "headline" | "ablation_matched_base" | "ablation_generic" | "ablation_fashionclip"
    pretrained: str | None = None   # open_clip pretrained tag for built-in weights (None for hf-hub)
    hf_repo: str | None = None      # the HF repo to resolve a revision SHA from (hf-hub backbones)
    note: str = ""


# The headline is fully wired; the ablations are registered rungs run only if the headline path
# ships first (§15 "minimal headline path"). Do NOT substitute the LAION-2B ViT-B/16 CLIP as the
# "matched" base — it differs from FashionSigLIP in BOTH architecture and corpus (§5), reintroducing
# the confounds the matched-base rung exists to remove.
BACKBONES: dict[str, Backbone] = {
    "fashionsiglip": Backbone(
        key="fashionsiglip",
        open_clip_id="hf-hub:Marqo/marqo-fashionSigLIP",
        hf_repo="Marqo/marqo-fashionSigLIP",
        role="headline",
        note="ViT-B/16-SigLIP, GCL fashion fine-tune of the WebLI SigLIP base; the frozen headline space.",
    ),
    "siglip_webli_base": Backbone(
        key="siglip_webli_base",
        open_clip_id="ViT-B-16-SigLIP",
        pretrained="webli",
        role="ablation_matched_base",
        note="The matched base FashionSigLIP was fine-tuned from; the clean fashion-fine-tuning delta (§5).",
    ),
    "clip_b16_openai": Backbone(
        key="clip_b16_openai",
        open_clip_id="ViT-B-16",
        pretrained="openai",
        role="ablation_generic",
        note="Generic CLIP ViT-B/16; reported as 'fashion-domain vs generic CLIP', NOT the matched base.",
    ),
    "fashionclip2": Backbone(
        key="fashionclip2",
        open_clip_id="hf-hub:Marqo/marqo-fashionCLIP",
        hf_repo="Marqo/marqo-fashionCLIP",
        role="ablation_fashionclip",
        note="Marqo FashionCLIP-2.0; a fashion-domain CLIP ablation rung.",
    ),
}

HEADLINE = "fashionsiglip"


# --------------------------------------------------------------------------- #
# Loading / embedding
# --------------------------------------------------------------------------- #
@dataclass
class LoadedBackbone:
    backbone: Backbone
    model: object            # the frozen open_clip model (eval mode, no grad)
    preprocess: object       # the val image transform
    revision_sha: str        # HF commit SHA (hf-hub) or "<tag>@open_clip-<ver>" provenance
    preprocess_hash: str     # sha256 of the preprocess transform repr (preprocessing reproducibility)
    device: str


def _local_hf_revision(repo: str) -> str | None:
    """The commit the LOCAL hf cache resolved `main` to — the revision whose weights were ACTUALLY
    loaded. Read AFTER a load populates the cache. This is what the embeddings were produced from;
    the remote HEAD (`model_info().sha`) can drift ahead of a stale local cache, so recording the
    remote HEAD would mis-pin the provenance (audit finding)."""
    from huggingface_hub.constants import HF_HUB_CACHE

    ref = os.path.join(HF_HUB_CACHE, f"models--{repo.replace('/', '--')}", "refs", "main")
    if os.path.exists(ref):
        with open(ref, encoding="utf-8") as f:
            return f.read().strip()
    return None


def resolve_revision(backbone: Backbone) -> str:
    """Provenance string pinning the weights, resolved AFTER the model load. For hf-hub backbones:
    the revision the LOCAL cache actually loaded (so the recorded SHA matches the embeddings even if
    remote main has since moved), falling back to the remote HEAD only if the local ref is
    unreadable. For built-in weights: the open_clip `pretrained` tag + open_clip version."""
    import open_clip

    if backbone.hf_repo is not None:
        local = _local_hf_revision(backbone.hf_repo)
        if local is not None:
            return local
        from huggingface_hub import HfApi

        return HfApi().model_info(backbone.hf_repo).sha
    return f"{backbone.pretrained}@open_clip-{open_clip.__version__}"


def load_backbone(key: str = HEADLINE, device: str = "cpu") -> LoadedBackbone:
    """Load a registered backbone FROZEN (eval mode, gradients off). Default device cpu — the
    reproducibility reference the cache is pinned to (recorded in the manifest); a faster device
    (mps/cuda) may be used for the one-time pass but must be recorded, as kernels can differ. The
    revision is resolved AFTER load so it reflects the weights actually downloaded/cached."""
    import open_clip

    bk = BACKBONES[key]
    if bk.pretrained is None:
        model, preprocess = open_clip.create_model_from_pretrained(bk.open_clip_id)
    else:
        model, preprocess = open_clip.create_model_from_pretrained(
            bk.open_clip_id, pretrained=bk.pretrained
        )
    model.eval().to(device)
    for p in model.parameters():
        p.requires_grad_(False)  # frozen; embed_images also runs under no_grad (no global grad flip)
    return LoadedBackbone(
        backbone=bk,
        model=model,
        preprocess=preprocess,
        revision_sha=resolve_revision(bk),
        preprocess_hash=hashlib.sha256(repr(preprocess).encode()).hexdigest(),
        device=device,
    )


def embed_images(
    loaded: LoadedBackbone, pil_images: Iterable, batch_size: int = 64
) -> np.ndarray:
    """Embed PIL images through the frozen backbone, L2-normalized, returned as a float32
    (N, dim) array (rows aligned to the input order). Deterministic: eval mode + no grad + a frozen
    encoder have no stochastic path, so the embedding is a pure function of (image bytes, weights,
    preprocess)."""
    import torch

    batch_imgs: list = []
    out: list[np.ndarray] = []

    def flush() -> None:
        if not batch_imgs:
            return
        x = torch.stack([loaded.preprocess(im) for im in batch_imgs]).to(loaded.device)
        with torch.no_grad():
            emb = loaded.model.encode_image(x).float()
            emb = torch.nn.functional.normalize(emb, dim=-1)
        out.append(emb.cpu().numpy().astype(np.float32))
        batch_imgs.clear()

    for im in pil_images:
        batch_imgs.append(im)
        if len(batch_imgs) >= batch_size:
            flush()
    flush()
    return np.concatenate(out, axis=0) if out else np.empty((0, 0), dtype=np.float32)


def probe_dim(loaded: LoadedBackbone) -> int:
    """Emitted embedding dimensionality — verify against the §5 expectation (ViT-B/16-SigLIP is
    768-d architecturally, but the model card does not state it) BEFORE fixing the C3 head input."""
    from PIL import Image

    return int(embed_images(loaded, [Image.new("RGB", (224, 224), (124, 116, 104))]).shape[1])


# --------------------------------------------------------------------------- #
# Parquet image source (the gated mvasil parquet — build-doc §2)
# --------------------------------------------------------------------------- #
def iter_parquet_items(
    splits: Iterable[str] = ("train", "valid", "test"),
    wanted_ids: set[str] | None = None,
    streaming: bool = True,
    limit: int | None = None,
) -> Iterator[tuple[str, object, str]]:
    """Yield ``(item_id, PIL.Image RGB, sha256_of_raw_jpeg_bytes)`` from the disjoint parquet
    configs. `wanted_ids` filters to the corpus items actually needed; `limit` caps the yield (a
    smoke). The image column is read with `decode=False` so the content hash is over the RAW source
    bytes (tamper-evident), then decoded to PIL for embedding. The id column name is detected
    defensively (count-match != id-match, §2 — callers must still assert full id resolution)."""
    from datasets import Image as HFImage
    from datasets import load_dataset
    from PIL import Image

    n = 0
    for split in splits:
        ds = load_dataset(HF_DATASET, "disjoint", split=HF_SPLIT_FOR[split], streaming=streaming)
        ds = ds.cast_column("image", HFImage(decode=False))
        cols = set(ds.column_names) if ds.column_names else set()
        # Only item-level id columns — NOT `set_id` (the OUTFIT id), which would collapse many items
        # under one key (audit finding). Both branches use the identical candidate tuple.
        id_col = next((c for c in ID_COLUMNS if c in cols), None)
        for row in ds:
            if id_col is None:  # detect from the first row when streaming hides column_names
                id_col = next(c for c in ID_COLUMNS if c in row)
            item_id = str(row[id_col])
            if wanted_ids is not None and item_id not in wanted_ids:
                continue
            raw = row["image"]["bytes"]
            if raw is None:  # decode=False on a path-backed image -> no inline bytes; fail clearly
                raise ValueError(f"item {item_id}: parquet image has no inline bytes (path-backed?)")
            img = Image.open(io.BytesIO(raw)).convert("RGB")
            yield item_id, img, hashlib.sha256(raw).hexdigest()
            n += 1
            if limit is not None and n >= limit:
                return


# --------------------------------------------------------------------------- #
# Cache + manifest (the one-time pass — DEFERRED to C3; full corpus is multi-hour on CPU, §5)
# --------------------------------------------------------------------------- #
def _stack_in_corpus_order(
    by_id: dict[str, np.ndarray], item_ids: list[str]
) -> tuple[np.ndarray | None, list[str]]:
    """Stack per-id embeddings into a (N, dim) matrix aligned to `item_ids` order (the frozen cache
    order), re-keying out of whatever order the parquet streamed in. Returns ``(None, missing)`` if
    any requested id is absent — the §2 fail-loud integrity guard, extracted pure so it is
    hermetically testable (no torch/network)."""
    missing = [i for i in item_ids if i not in by_id]
    if missing:
        return None, missing
    return np.stack([by_id[i] for i in item_ids]).astype(np.float32), []


def _accept_image_hash(item_id: str, image_hash: str, seen_hashes: dict[str, str], split: str) -> bool:
    """Return True for a first-seen item id, False for an identical duplicate, raise on drift.

    The gated parquet can stream the same `item_id` more than once across splits or source rows.
    Same bytes are harmless; different bytes under one id would make the cache first-wins and
    corrupt provenance, so C3 refuses to build.
    """
    prior = seen_hashes.get(item_id)
    if prior is None:
        seen_hashes[item_id] = image_hash
        return True
    if prior != image_hash:
        raise RuntimeError(
            f"item_id {item_id!r} has conflicting parquet image bytes in split {split!r}: "
            f"{prior} vs {image_hash}"
        )
    return False


def build_cache(
    item_ids: list[str], key: str = HEADLINE, out_dir: str = DEFAULT_CACHE_DIR,
    device: str = "cpu", batch_size: int = 64,
    splits: tuple[str, ...] = ("train", "valid", "test"),
) -> dict:
    """Embed every `item_id` (corpus order = the frozen cache order) and write the cache
    (`embeddings_<key>.npy` N x dim float32 + `<key>_ids.json` + `<key>_hashes.json`, all in
    `out_dir`, gitignored/regenerable) plus the committed freeze record
    `embedding_manifest_<key>.json` at the package root. Asserts every requested id resolved (fail
    loud on a miss, §2) and that the matrix is genuinely L2-normalized (so the manifest's
    `normalization: l2` is load-bearing, not a decoupled constant). The HEAVY one-time pass — run at
    C3, not C2."""
    loaded = load_backbone(key, device=device)
    wanted = set(item_ids)
    by_id: dict[str, np.ndarray] = {}
    hashes: dict[str, str] = {}
    seen_hashes: dict[str, str] = {}  # flushed OR buffered — dedup BEFORE re-embedding within a batch
    buf_ids: list[str] = []
    buf_imgs: list = []

    def flush() -> None:
        if not buf_imgs:
            return
        embs = embed_images(loaded, buf_imgs, batch_size=batch_size)
        for iid, e in zip(buf_ids, embs):
            by_id[iid] = e
        buf_ids.clear()
        buf_imgs.clear()

    for iid, img, h in iter_parquet_items(splits=splits, wanted_ids=wanted, streaming=True):
        # `iter_parquet_items` maps HF split names back to our requested split order; for the
        # integrity error message we only need the rough split context, not a logic key.
        split_context = ",".join(splits)
        if not _accept_image_hash(iid, h, seen_hashes, split_context):
            continue
        buf_ids.append(iid)
        buf_imgs.append(img)
        hashes[iid] = h
        if len(buf_imgs) >= batch_size:
            flush()
    flush()

    matrix, missing = _stack_in_corpus_order(by_id, item_ids)
    if missing:
        raise RuntimeError(
            f"{len(missing)} corpus item_ids did not resolve in the parquet (e.g. {missing[:5]})"
        )
    norms = np.linalg.norm(matrix, axis=1)
    if not np.allclose(norms, 1.0, atol=1e-4):
        raise RuntimeError(f"embeddings are not L2-normalized (norm range {norms.min():.4f}..{norms.max():.4f})")

    os.makedirs(out_dir, exist_ok=True)
    npy_path = os.path.join(out_dir, f"embeddings_{key}.npy")
    ids_path = os.path.join(out_dir, f"{key}_ids.json")
    hashes_path = os.path.join(out_dir, f"{key}_hashes.json")
    fresh = _manifest(loaded, item_ids, hashes, matrix, npy_path, ids_path, hashes_path)
    manifest_path = os.path.join(ROOT_DIR, f"embedding_manifest_{key}.json")
    # Preflight the one-way-door contract BEFORE touching cache blobs. A drifted rerun must fail
    # without clobbering the cache files that still match the committed manifest.
    manifest = _merge_manifest_preserving_freeze(
        manifest_path, fresh, require_existing=(key == HEADLINE)
    )
    np.save(npy_path, matrix)
    with open(ids_path, "w", encoding="utf-8") as f:
        json.dump(item_ids, f)
    with open(hashes_path, "w", encoding="utf-8") as f:
        json.dump(hashes, f)  # per-id source-byte hashes (single-item tamper re-verification)
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    return manifest


def _manifest(
    loaded: LoadedBackbone, item_ids: list[str], hashes: dict[str, str],
    matrix: np.ndarray, npy_path: str, ids_path: str, hashes_path: str,
) -> dict:
    """The `embedding_manifest_<key>.json` freeze record (§5/§15): everything needed to reproduce
    and tamper-check the cache. The per-id source-byte hashes live in `<key>_hashes.json`
    (`image_hashes_path`); this manifest carries their order-sensitive SUMMARY plus the embeddings'
    CONTENT hash (over `matrix.tobytes()`, numpy-version-independent, unlike a `.npy` file hash)."""
    ordered_hashes = [hashes[i] for i in item_ids]
    return {
        "backbone_key": loaded.backbone.key,
        "open_clip_id": loaded.backbone.open_clip_id,
        "pretrained": loaded.backbone.pretrained,
        "revision_sha": loaded.revision_sha,
        "preprocess_hash": loaded.preprocess_hash,
        "device": loaded.device,
        "n_items": len(item_ids),
        "embedding_dim": int(matrix.shape[1]),
        "dtype": str(matrix.dtype),
        "normalization": "l2",
        "ids_path": os.path.basename(ids_path),
        "ids_list_sha256": hashlib.sha256(json.dumps(item_ids).encode()).hexdigest(),
        "image_hashes_path": os.path.basename(hashes_path),
        "image_hashes_sha256": hashlib.sha256("".join(ordered_hashes).encode()).hexdigest(),
        "embeddings_path": os.path.basename(npy_path),
        "embeddings_content_sha256": hashlib.sha256(
            np.ascontiguousarray(matrix).tobytes()
        ).hexdigest(),
    }


# Config fields the C2 freeze pins in embedding_manifest_<key>.json. C3's build_cache MUST verify
# the committed values equal the freshly-resolved ones before overwriting — the §D "enforced, not
# git-historical" contract. `device` is deliberately EXCLUDED (recorded, not frozen: a faster
# mps/cuda one-time pass is allowed, §5, and kernels can differ).
FROZEN_VERIFY_FIELDS = (
    "backbone_key", "open_clip_id", "pretrained", "revision_sha",
    "preprocess_hash", "embedding_dim", "dtype", "normalization",
)
STAGED_CACHE_FIELDS = (
    "n_items", "ids_path", "ids_list_sha256", "image_hashes_path",
    "image_hashes_sha256", "embeddings_path", "embeddings_content_sha256",
)


def _merge_manifest_preserving_freeze(path: str, fresh: dict, require_existing: bool = False) -> dict:
    """Return the manifest that may be written to `path`, ENFORCING the C2 config freeze.

    This is intentionally side-effect-free: build_cache calls it before writing cache blobs, so a
    failed freeze/cache check leaves the existing cache files untouched."""
    if require_existing and not os.path.exists(path):
        raise RuntimeError(
            f"missing committed C2 embedding freeze {os.path.basename(path)}; refusing fresh write"
        )
    out = fresh
    if os.path.exists(path):
        committed = load_json_strict(path)
        drift = {
            k: {"committed": committed.get(k), "fresh": fresh.get(k)}
            for k in FROZEN_VERIFY_FIELDS
            if k not in committed or committed.get(k) != fresh.get(k)
        }
        if drift:
            raise RuntimeError(
                f"embedding freeze drift in {os.path.basename(path)}: the committed C2 config no "
                f"longer matches the loaded backbone — {drift}. The frozen config is a one-way door "
                f"(§D); resolve the drift (wrong revision / deps) before re-caching, do not overwrite."
            )
        cache_drift = {
            k: {"committed": committed.get(k), "fresh": fresh.get(k)}
            for k in STAGED_CACHE_FIELDS
            if committed.get(k) is not None and (k not in fresh or committed.get(k) != fresh.get(k))
        }
        if cache_drift:
            raise RuntimeError(
                f"embedding cache freeze drift in {os.path.basename(path)}: staged C3 cache fields "
                f"are already populated and must reproduce exactly — {cache_drift}. Refuse to "
                f"overwrite without an explicit re-freeze."
            )
        out = {**committed, **fresh}  # regenerated cache fields fill the staged nulls; docs survive
    return out


def _write_manifest_preserving_freeze(path: str, fresh: dict, require_existing: bool = False) -> dict:
    """Write `fresh` to `path`, ENFORCING the C2 config freeze (§D — the one-way door). If a
    `FROZEN_VERIFY_FIELDS` value it pins equals the freshly-resolved one and **raise on a mismatch**
    — so a drifted backbone/preprocess/deps can never silently overwrite the frozen config. Cache
    fields that are still null may be populated once at C3; once any staged cache field is non-null,
    a later run must reproduce it exactly unless an explicit re-freeze path is added. Then MERGE the
    regenerated cache fields onto the committed dict so the C2-recorded documentation (`_README`,
    `_freeze`, `preprocess_transform`, `dependency_lock`, `image_source`) survives the overwrite.
    Returns the written dict. Pure I/O + dict ops — hermetically testable, no torch."""
    out = _merge_manifest_preserving_freeze(path, fresh, require_existing=require_existing)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    return out


# --------------------------------------------------------------------------- #
# Smoke (C2 dim/SHA pin) — `python embed.py`
# --------------------------------------------------------------------------- #
def _smoke() -> None:
    """Load the headline backbone, pin the emitted dim + revision SHA + preprocess hash (what the
    freeze needs), and — if the gated parquet is reachable — embed a handful of REAL items to
    validate the parquet->embed path + per-id resolution end-to-end."""
    loaded = load_backbone(HEADLINE, device="cpu")
    dim = probe_dim(loaded)
    print(f"[embed smoke] backbone={loaded.backbone.key} open_clip_id={loaded.backbone.open_clip_id}")
    print(f"[embed smoke] embedding_dim={dim} revision_sha={loaded.revision_sha}")
    print(f"[embed smoke] preprocess_hash={loaded.preprocess_hash[:16]} device={loaded.device}")
    try:
        sample = list(iter_parquet_items(splits=("test",), streaming=True, limit=4))
        embs = embed_images(loaded, [img for _, img, _ in sample])
        norms = np.linalg.norm(embs, axis=1)
        print(f"[embed smoke] parquet OK: {len(sample)} real items, emb shape={embs.shape}, "
              f"L2 norms ~ {np.round(norms, 4).tolist()}")
        print(f"[embed smoke] sample ids={[i for i, _, _ in sample]}")
    except Exception as e:  # gated/offline -> the dim/SHA pin above still stands
        print(f"[embed smoke] parquet skipped ({type(e).__name__}: {str(e)[:120]})")


if __name__ == "__main__":
    _smoke()
