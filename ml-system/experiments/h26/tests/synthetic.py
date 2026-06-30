"""Synthetic corpus + embedding-cache builders shared by the C3 tests.

The C3 modules (`baselines` / `train_head` / `evaluate`) are exercised on a small, fully-synthetic
Polyvore-shaped corpus + a random L2-normalized embedding cache — the same hermetic pattern
`test_metrics.py` / `test_data_loader.py` use. This keeps the tests fast and independent of the gated
dataset + the multi-hour real embedding cache, while running the *identical* code paths
(`make_split_data`, the §4 constructions, the heads, the metric wiring). The cache is 768-d to match
the frozen FashionSigLIP dim the heads are wired to.
"""

from __future__ import annotations

import random

import numpy as np

from data_loader import Corpus, Item, make_split_data
from embed import EmbeddingCache

# A small Polyvore-shaped category space spanning all five clothingTypes, ≥2 categories where it
# matters so same-fine-category negatives exist within a type (§4).
CAT_TYPE = {
    "T1": "top", "T2": "top",
    "B1": "bottom", "B2": "bottom",
    "S1": "shoes", "S2": "shoes",
    "D1": "dress",
    "O1": "outer_layer",
}


def make_item_index(items_per_cat: int = 10) -> dict[str, Item]:
    idx: dict[str, Item] = {}
    for cat, typ in CAT_TYPE.items():
        for k in range(items_per_cat):
            iid = f"{cat}-{k}"
            idx[iid] = Item(item_id=iid, category_id=cat, semantic=typ, type=typ)
    return idx


def _outfits_for_split(
    rng: random.Random, item_index: dict[str, Item], n_outfits: int, start: int
) -> list[tuple[str, list[str]]]:
    cats: dict[str, list[str]] = {}
    for iid, it in item_index.items():
        cats.setdefault(it.category_id, []).append(iid)
    tops = cats["T1"] + cats["T2"]
    bottoms = cats["B1"] + cats["B2"]
    shoes = cats["S1"] + cats["S2"]
    dresses = cats["D1"]
    outers = cats["O1"]
    outfits: list[tuple[str, list[str]]] = []
    for n in range(n_outfits):
        sid = f"set-{start + n}"
        if rng.random() < 0.3:  # a dress-based outfit (dress + shoes [+ outer])
            items = [rng.choice(dresses), rng.choice(shoes)]
            if rng.random() < 0.5:
                items.append(rng.choice(outers))
        else:  # top + bottom + shoes [+ outer]
            items = [rng.choice(tops), rng.choice(bottoms), rng.choice(shoes)]
            if rng.random() < 0.4:
                items.append(rng.choice(outers))
        outfits.append((sid, items))
    return outfits


def make_corpus(seed: int = 0, items_per_cat: int = 10, n_per_split: int = 40) -> Corpus:
    """A synthetic 3-split disjoint-shaped `Corpus`. Items are split-shared (the synthetic corpus does
    not model item-disjointness — the §4 constructions are split-scoped regardless), but every split
    builds its own outfits so each has its own co-occurrence / category / popularity indices."""
    rng = random.Random(seed)
    item_index = make_item_index(items_per_cat)
    type_map = {cat: {"type": typ} for cat, typ in CAT_TYPE.items()}
    splits = {}
    start = 0
    for name in ("train", "valid", "test"):
        raw = _outfits_for_split(rng, item_index, n_per_split, start)
        start += n_per_split
        splits[name] = make_split_data(name, raw, item_index)
    return Corpus(item_index=item_index, type_map=type_map, splits=splits, data_root="<synthetic>")


def make_cache(
    item_index: dict[str, Item], seed: int = 0, dim: int = 768, key: str = "fashionsiglip"
) -> EmbeddingCache:
    """An in-memory `EmbeddingCache` of deterministic random L2-normalized vectors for every item (no
    file I/O — `test_cache.py` covers the manifest round-trip + tamper checks separately)."""
    ids = sorted(item_index.keys())
    rng = np.random.default_rng(seed)
    mat = rng.standard_normal((len(ids), dim)).astype(np.float32)
    mat /= np.linalg.norm(mat, axis=1, keepdims=True)
    index = {iid: i for i, iid in enumerate(ids)}
    manifest = {
        "backbone_key": key, "embedding_dim": dim, "dtype": "float32", "normalization": "l2",
        "n_items": len(ids), "ids_list_sha256": None, "embeddings_content_sha256": None,
    }
    return EmbeddingCache(key=key, ids=ids, matrix=mat, index=index, dim=dim, manifest=manifest)
