"""The sole, lazy import bridge into the sealed H26 implementation."""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

H26_ROOT = Path(__file__).resolve().parents[1] / "h26"
if str(H26_ROOT) not in sys.path:
    sys.path.insert(0, str(H26_ROOT))

_SURFACE = {
    "baselines": ("cosine_edge_scorer",),
    "data_loader": ("Item", "Outfit", "SplitData", "build_pairwise", "make_split_data", "FIVE_TYPES", "load_headline_corpus"),
    "domain_probe": ("catalog_pair_scores", "load_sealed_pairwise_head"),
    "embed": ("HEADLINE", "EmbeddingCache", "embed_images", "load_backbone", "load_cache", "cache_manifest_path"),
    "evaluate": ("head_edge_scorer", "SEED"),
    "metrics": ("auc_pos_neg", "bootstrap_ci", "mean_edge_score", "CI"),
    "train_head": ("PairwiseEdgeHead", "checkpoint_sha256", "type_pair_index", "set_determinism"),
}
_MODULE_FOR = {name: module for module, names in _SURFACE.items() for name in names}
__all__ = ["H26_ROOT", *_MODULE_FOR]


def __getattr__(name: str):
    if name not in _MODULE_FOR:
        raise AttributeError(name)
    module = importlib.import_module(_MODULE_FOR[name])
    if Path(module.__file__).resolve().parent != H26_ROOT:
        raise ImportError(f"H26 module name collision: {module.__file__}")
    value = getattr(module, name)
    globals()[name] = value
    return value
