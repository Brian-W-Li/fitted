"""The trained compatibility heads + the C3 sealed-selection emission (§6 / §C.1 / §C.2 / §C.4).

Two heads train over the **one** frozen FashionSigLIP embedding cache (no module re-embeds):

  - **`PairwiseEdgeHead`** — the frozen **headline** shape (§C.1): a type-conditioned edge head
    `score(emb_i, emb_j, {type_i, type_j}) -> logit` on `[emb_i⊕emb_j, |emb_i−emb_j|, emb_i⊙emb_j]`
    (3072-d) ⊕ a learned 15×32 unordered type-pair embedding (3104-d) → `Linear(3104,256) → GELU →
    Linear(256,1)`, symmetrized `½[f(i,j)+f(j,i)]`. **795,617 params.**
  - **`ItemLevelHead`** — the §C.2 capacity-matched ablation (the literature's "single shared
    item-level scalar" the §6 seam test expects to be falsified): `g(emb)` = `Linear(768,1024) → GELU
    → Linear(1024,1)`, per-edge score `½[g(emb_i)+g(emb_j)]`, no type conditioning. **788,481 params**
    (0.90 % under the pairwise head — the ±5 % capacity match, so a pairwise win is not a parameter
    win).

Both train with **pointwise BCE** on §4 positive vs same-fine-category negative edges, the **frozen
6-config Adam grid** (§C.4), max 50 epochs, early-stop patience 5 on the **valid pooled pair-level
ROC-AUC**, and the **mechanical argmax** over the grid selects the checkpoint. Everything is
deterministic from **seed 20260629** (`torch.use_deterministic_algorithms(True)`, single fixed data
order, single-thread reductions) so the selection reproduces **bit-for-bit**.

**Blindness invariant (load-bearing — §1):** C3 writes **only `selection.json`** (checkpoint
id/config/hash + a convergence/early-stop indicator + the manifest-hash binding, validated against
`selection.schema.json`) — **no metric value of any split**. The valid pooled pair-AUC drives the
argmax internally but is never emitted, printed, or committed; no human-visible model number exists
until the C4 four-file unlock materializes `metrics.json`. Reference:
docs/plans/h26-compatibility-spike-v2.md §6 / §C.1–C.4 / §1 (blindness) / §15 (build ladder).
"""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

import numpy as np
import torch
from torch import nn

from data_loader import (
    FIVE_TYPES,
    Corpus,
    Edge,
    Item,
    build_pairwise,
    load_headline_corpus,
)
from embed import EmbeddingCache, HEADLINE, load_cache
from metrics import auc_pos_neg

ROOT_DIR = os.path.dirname(__file__)
SEED = 20260629
EMBED_DIM = 768
N_TYPE_PAIRS = 15
TYPE_PAIR_DIM = 32
PAIRWISE_HIDDEN = 256
ITEM_LEVEL_HIDDEN = 1024
BATCH_SIZE = 1024
MAX_EPOCHS = 50
EARLY_STOP_PATIENCE = 5
SELECTION_METRIC = "valid_pooled_pair_level_roc_auc"

# The C2-frozen 6-config Adam grid (§C.4): LR ∈ {1e-3, 3e-4, 1e-4} (outer) × weight_decay ∈ {0, 1e-4}
# (inner). The enumeration order fixes the grid_0..grid_5 config ids (a tie in valid AUC breaks to the
# LOWEST index — deterministic). The grid + optimizer freeze in preregistration.json; this list copies
# it (it is NOT re-decided here — test_train_head pins it equals the frozen mirror).
GRID: list[dict] = [
    {"learning_rate": lr, "weight_decay": wd}
    for lr in (1e-3, 3e-4, 1e-4)
    for wd in (0.0, 1e-4)
]
DEFAULT_CHECKPOINT_DIR = os.path.join(ROOT_DIR, "checkpoints")  # gitignored (regenerable from the seed)

# The frozen artifacts selection.json binds by hash (§C.4 reproducibility / the C4 unlock check).
MANIFEST_HASH_FILES = {
    "preregistration_json_sha256": "preregistration.json",
    "fitb_manifest_sha256": "fitb_manifest.json",
    "embedding_manifest_sha256": "embedding_manifest_fashionsiglip.json",
    "type_map_sha256": "type_map.json",
}


# --------------------------------------------------------------------------- #
# Type-pair indexing (the unordered 5-type pair -> 0..14)
# --------------------------------------------------------------------------- #
TYPE_INDEX = {t: i for i, t in enumerate(FIVE_TYPES)}  # top0 bottom1 dress2 outer_layer3 shoes4


def type_pair_index(type_i: str, type_j: str) -> int:
    """Map the unordered `{type_i, type_j}` over the 5-value space to a flat index in `[0, 15)` —
    the upper-triangular (incl. diagonal) enumeration over the `FIVE_TYPES` order. Unordered, so
    `type_pair_index(a, b) == type_pair_index(b, a)`; same-type pairs are included (the diagonal)."""
    a, b = sorted((TYPE_INDEX[type_i], TYPE_INDEX[type_j]))
    return a * 5 - a * (a - 1) // 2 + (b - a)


# --------------------------------------------------------------------------- #
# The two heads (§C.1 pairwise headline / §C.2 item-level ablation)
# --------------------------------------------------------------------------- #
class PairwiseEdgeHead(nn.Module):
    """The frozen headline shape (§C.1): a type-conditioned pairwise edge head, symmetrized by the
    frozen `½[f(i,j)+f(j,i)]` average (so no arbitrary endpoint order is baked in). 795,617 params."""

    head_kind = "pairwise_type_conditioned_edge"

    def __init__(
        self, dim: int = EMBED_DIM, n_type_pairs: int = N_TYPE_PAIRS,
        type_dim: int = TYPE_PAIR_DIM, hidden: int = PAIRWISE_HIDDEN,
    ) -> None:
        super().__init__()
        self.type_emb = nn.Embedding(n_type_pairs, type_dim)
        # feature = [emb_i⊕emb_j (2·dim), |emb_i−emb_j| (dim), emb_i⊙emb_j (dim)] (= 4·dim) ⊕ type (type_dim)
        self.mlp = nn.Sequential(
            nn.Linear(4 * dim + type_dim, hidden), nn.GELU(), nn.Linear(hidden, 1)
        )

    def _feature(self, ei: torch.Tensor, ej: torch.Tensor, pair: torch.Tensor) -> torch.Tensor:
        return torch.cat([ei, ej, (ei - ej).abs(), ei * ej, self.type_emb(pair)], dim=-1)

    def forward(self, ei: torch.Tensor, ej: torch.Tensor, pair: torch.Tensor) -> torch.Tensor:
        # symmetrize: only emb_i⊕emb_j is order-sensitive; |·| / ⊙ / the unordered type-pair are not.
        f_ij = self.mlp(self._feature(ei, ej, pair)).squeeze(-1)
        f_ji = self.mlp(self._feature(ej, ei, pair)).squeeze(-1)
        return 0.5 * (f_ij + f_ji)


class ItemLevelHead(nn.Module):
    """The §C.2 capacity-matched item-level ablation: per-item scalar `g(emb)`, per-edge score
    `½[g(emb_i)+g(emb_j)]`, no type conditioning. The literature's single-shared-scalar baseline the
    §6 seam test expects to be falsified. 788,481 params (within ±5 % of the pairwise head)."""

    head_kind = "item_level_scalar"

    def __init__(self, dim: int = EMBED_DIM, hidden: int = ITEM_LEVEL_HIDDEN) -> None:
        super().__init__()
        self.mlp = nn.Sequential(nn.Linear(dim, hidden), nn.GELU(), nn.Linear(hidden, 1))

    def g(self, e: torch.Tensor) -> torch.Tensor:
        return self.mlp(e).squeeze(-1)

    def forward(self, ei: torch.Tensor, ej: torch.Tensor, pair: torch.Tensor) -> torch.Tensor:
        # `pair` is accepted (so the training loop is head-agnostic) but unused — no type conditioning.
        return 0.5 * (self.g(ei) + self.g(ej))


def param_count(module: nn.Module) -> int:
    return sum(p.numel() for p in module.parameters())


# --------------------------------------------------------------------------- #
# Edge -> tensors (over the frozen cache)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class EdgeTensors:
    """The §4 edges of one split as aligned tensors: `ei`/`ej` are the frozen embeddings of each
    edge's endpoints, `pair` the unordered type-pair index, `label` 1=positive / 0=negative."""

    ei: torch.Tensor   # (N, dim) float32
    ej: torch.Tensor   # (N, dim) float32
    pair: torch.Tensor  # (N,) long
    label: torch.Tensor  # (N,) float32

    def __len__(self) -> int:
        return int(self.label.shape[0])


def build_edge_tensors(
    edges: Sequence[Edge], cache: EmbeddingCache, item_index: dict[str, Item]
) -> EdgeTensors:
    """Resolve each §4 edge's endpoints through the frozen cache (fail-loud on a cache miss — the §2
    coverage guarantee) into aligned tensors for training/scoring."""
    if not edges:
        raise ValueError("build_edge_tensors needs at least one edge")
    ei = np.stack([cache.vec(e.a) for e in edges]).astype(np.float32)
    ej = np.stack([cache.vec(e.b) for e in edges]).astype(np.float32)
    pair = np.array(
        [type_pair_index(item_index[e.a].type, item_index[e.b].type) for e in edges], dtype=np.int64
    )
    label = np.array([float(e.label) for e in edges], dtype=np.float32)
    return EdgeTensors(
        ei=torch.from_numpy(ei), ej=torch.from_numpy(ej),
        pair=torch.from_numpy(pair), label=torch.from_numpy(label),
    )


def score_edge_tensors(head: nn.Module, t: EdgeTensors, batch: int = 4096) -> np.ndarray:
    """Score every edge with `head` in eval mode (no grad), batched. Returns the (N,) logit array."""
    head.eval()
    out: list[np.ndarray] = []
    with torch.no_grad():
        for start in range(0, len(t), batch):
            sl = slice(start, start + batch)
            out.append(head(t.ei[sl], t.ej[sl], t.pair[sl]).cpu().numpy())
    return np.concatenate(out) if out else np.empty(0, dtype=np.float32)


def pooled_pair_auc(head: nn.Module, t: EdgeTensors) -> float:
    """The selection metric (§C.4): pooled pair-level ROC-AUC of `head`'s scores over a split's §4
    edges. Computed internally to drive the mechanical argmax; **never emitted** (the §1 blindness
    guard — the valid metric value stays sealed)."""
    scores = score_edge_tensors(head, t)
    labels = t.label.cpu().numpy()
    return auc_pos_neg(scores[labels == 1], scores[labels == 0])


# --------------------------------------------------------------------------- #
# Determinism + training
# --------------------------------------------------------------------------- #
def set_determinism(seed: int = SEED, single_thread: bool = True) -> None:
    """Pin the full Torch determinism envelope (§C.4). `single_thread=True` fixes CPU reduction order
    (the last non-seeded source of float drift in matmul), so the trained weights — hence
    `selection.json` — reproduce **bit-for-bit**. A multi-thread run is faster but only bit-stable
    within one fixed thread count; the headline run is single-thread by contract."""
    torch.use_deterministic_algorithms(True)
    torch.manual_seed(seed)
    if single_thread:
        torch.set_num_threads(1)


def _clone_state(head: nn.Module) -> dict[str, torch.Tensor]:
    return {k: v.detach().clone() for k, v in head.state_dict().items()}


@dataclass
class TrainResult:
    """One config's training outcome. `best_state` is the early-stop-selected checkpoint; `best_epoch`
    the 0-indexed epoch it came from; `converged` True iff early-stopping fired (valid AUC plateaued
    for `patience` epochs) vs hitting `max_epochs` still improving. `valid_auc` is the selection score
    — kept ONLY to drive the argmax in-process; it is NEVER written to `selection.json` (§1)."""

    config_id: str
    config: dict
    best_state: dict[str, torch.Tensor]
    valid_auc: float
    best_epoch: int
    converged: bool
    epochs_run: int


def train_one_config(
    make_head: Callable[[], nn.Module],
    train_t: EdgeTensors,
    valid_t: EdgeTensors,
    config: dict,
    config_id: str,
    *,
    seed: int = SEED,
    batch_size: int = BATCH_SIZE,
    max_epochs: int = MAX_EPOCHS,
    patience: int = EARLY_STOP_PATIENCE,
) -> TrainResult:
    """Train one head/config with pointwise BCE + Adam (§C.4), early-stopping on the valid pooled
    pair-AUC. Re-seeds first so every config starts from the identical weight init + data order — the
    grid isolates the hyperparameter effect and the whole run is reproducible from `seed`."""
    set_determinism(seed)
    head = make_head()
    opt = torch.optim.Adam(
        head.parameters(), lr=config["learning_rate"], weight_decay=config["weight_decay"],
        betas=(0.9, 0.999), eps=1e-8,
    )
    loss_fn = nn.BCEWithLogitsLoss()
    n = len(train_t)
    shuffle_gen = torch.Generator().manual_seed(seed)  # fixed, reproducible epoch-shuffle stream

    best_auc = -float("inf")
    best_state = _clone_state(head)
    best_epoch = 0
    bad = 0
    converged = False
    epochs_run = 0
    for epoch in range(max_epochs):
        epochs_run = epoch + 1
        head.train()
        perm = torch.randperm(n, generator=shuffle_gen)
        for start in range(0, n, batch_size):
            idx = perm[start:start + batch_size]
            opt.zero_grad()
            logit = head(train_t.ei[idx], train_t.ej[idx], train_t.pair[idx])
            loss_fn(logit, train_t.label[idx]).backward()
            opt.step()
        auc = pooled_pair_auc(head, valid_t)
        if auc > best_auc:
            best_auc, best_state, best_epoch, bad = auc, _clone_state(head), epoch, 0
        else:
            bad += 1
            if bad >= patience:
                converged = True
                break
    return TrainResult(
        config_id=config_id, config=dict(config), best_state=best_state, valid_auc=best_auc,
        best_epoch=best_epoch, converged=converged, epochs_run=epochs_run,
    )


def select_over_grid(
    make_head: Callable[[], nn.Module],
    train_t: EdgeTensors,
    valid_t: EdgeTensors,
    *,
    seed: int = SEED,
    grid: Sequence[dict] = GRID,
    **train_kwargs,
) -> tuple[TrainResult, list[TrainResult]]:
    """Train every grid config and pick the **mechanical argmax** of the valid pooled pair-AUC (a tie
    breaks to the LOWEST grid index — deterministic, §C.4). Returns `(winner, all_results)`. The
    argmax reads only the relative ordering of the (sealed) valid AUCs; the winning checkpoint is
    chosen without any human inspecting a metric value (§1)."""
    results = [
        train_one_config(make_head, train_t, valid_t, cfg, f"grid_{i}", seed=seed, **train_kwargs)
        for i, cfg in enumerate(grid)
    ]
    winner = max(results, key=lambda r: r.valid_auc)  # max picks the FIRST max on ties -> lowest index
    return winner, results


# --------------------------------------------------------------------------- #
# Checkpoint hashing + selection.json (the sealed C3 artifact)
# --------------------------------------------------------------------------- #
def checkpoint_sha256(state: dict[str, torch.Tensor]) -> str:
    """A bit-stable content hash of a checkpoint: sorted state-dict keys, each tensor as canonical
    float32 little-endian bytes. Independent of `torch.save`'s pickle framing, so two deterministic
    runs of the same seed produce the **identical** hash — the determinism trust floor (§1/§C.4)."""
    h = hashlib.sha256()
    for key in sorted(state):
        h.update(key.encode("utf-8"))
        arr = np.ascontiguousarray(state[key].detach().cpu().numpy().astype("<f4"))
        h.update(arr.tobytes())
    return h.hexdigest()


def _file_sha256(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def manifest_hashes(root_dir: str = ROOT_DIR) -> dict[str, str]:
    """The sha256 of every frozen artifact `selection.json` binds (§C.4): the prereg JSON mirror, the
    FITB + embedding manifests, and the type map. A drift in any of them changes the binding, so the
    sealed selection can never silently detach from the freeze it was produced under."""
    return {field_name: _file_sha256(os.path.join(root_dir, fname)) for field_name, fname in MANIFEST_HASH_FILES.items()}


def build_selection(
    winner: TrainResult, ckpt_sha: str, *, cache_key: str = HEADLINE, seed: int = SEED,
    root_dir: str = ROOT_DIR,
) -> dict:
    """Assemble the sealed `selection.json` dict for the headline pairwise checkpoint — checkpoint
    id/config/hash + a convergence/early-stop indicator + the manifest-hash binding, and **no metric
    value of any split** (§1). `checkpoint_id`/`config_id`/`optimizer` are sealedStrings (no embedded
    decimal, no metric word); numeric hyperparameters live in their own typed fields."""
    return {
        "checkpoint_id": f"{cache_key}_pairwise_edge_{winner.config_id}_seed{seed}",
        "checkpoint_sha256": ckpt_sha,
        "training_config": {
            "head": PairwiseEdgeHead.head_kind,
            "optimizer": "adam",
            "seed": seed,
            "config_id": winner.config_id,
            "learning_rate": winner.config["learning_rate"],
            "weight_decay": winner.config["weight_decay"],
            "batch_size": BATCH_SIZE,
            "epoch_budget": MAX_EPOCHS,
            "early_stop_patience": EARLY_STOP_PATIENCE,
            "selection_metric": SELECTION_METRIC,
            "deterministic_algorithms": True,
        },
        "converged": winner.converged,
        "early_stop_epoch": winner.best_epoch,
        "manifest_hashes": manifest_hashes(root_dir),
    }


def validate_selection(selection: dict, root_dir: str = ROOT_DIR) -> None:
    """Validate `selection.json` against `selection.schema.json` (the blindness contract: no metric
    values, sealedString ids, the bound manifest hashes). Raises `jsonschema.ValidationError` — so
    `run` refuses to write a selection that would leak a number or drift from the schema."""
    import jsonschema

    schema = _load_schema(os.path.join(root_dir, "selection.schema.json"))
    jsonschema.Draft202012Validator(schema).validate(selection)


def _load_schema(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# --------------------------------------------------------------------------- #
# The C3 run (the real one needs the built cache; the test drives it on a synthetic mini-cache)
# --------------------------------------------------------------------------- #
@dataclass
class C3Run:
    """The full C3 selection outcome. `selection` is the sealed dict written to `selection.json`;
    `pairwise`/`item_level` are the per-head results (kept in-process for the C6 seam diff — the
    item-level checkpoint ships as an ablation, never sealed in `selection.json`, whose schema admits
    only the pairwise head)."""

    selection: dict
    pairwise: TrainResult
    item_level: TrainResult
    selection_path: str | None = None
    checkpoint_paths: dict[str, str] = field(default_factory=dict)


def run(
    cache: EmbeddingCache,
    corpus: Corpus,
    *,
    seed: int = SEED,
    root_dir: str = ROOT_DIR,
    out_dir: str = ROOT_DIR,
    checkpoint_dir: str = DEFAULT_CHECKPOINT_DIR,
    write: bool = True,
    train_kwargs: dict | None = None,
) -> C3Run:
    """Run the C3 selection: build the §4 train/valid edges, train BOTH heads over the frozen grid,
    select each by valid pooled pair-AUC, emit the sealed `selection.json` (pairwise headline), and
    save both checkpoints (gitignored — regenerable from the seed; the item-level one feeds the C6
    seam ablation). Emits **no metric value** (§1).

    `root_dir` is where the frozen artifacts (`selection.schema.json` + the four `manifest_hashes`
    files) live — the binding + schema validation read it. `out_dir` is where `selection.json` is
    written. `write=False` returns the in-memory result without touching disk (the unit-test path)."""
    tk = train_kwargs or {}
    item_index = corpus.item_index
    train_edges, _ = build_pairwise(corpus.splits["train"], item_index, seed)
    valid_edges, _ = build_pairwise(corpus.splits["valid"], item_index, seed)
    train_t = build_edge_tensors(train_edges, cache, item_index)
    valid_t = build_edge_tensors(valid_edges, cache, item_index)

    pairwise, _ = select_over_grid(PairwiseEdgeHead, train_t, valid_t, seed=seed, **tk)
    item_level, _ = select_over_grid(ItemLevelHead, train_t, valid_t, seed=seed, **tk)

    ckpt_sha = checkpoint_sha256(pairwise.best_state)
    selection = build_selection(pairwise, ckpt_sha, cache_key=cache.key, seed=seed, root_dir=root_dir)
    validate_selection(selection, root_dir=root_dir)

    result = C3Run(selection=selection, pairwise=pairwise, item_level=item_level)
    if write:
        os.makedirs(checkpoint_dir, exist_ok=True)
        result.checkpoint_paths = {
            "pairwise": _save_checkpoint(pairwise, checkpoint_dir, "pairwise_edge", seed),
            "item_level": _save_checkpoint(item_level, checkpoint_dir, "item_level", seed),
        }
        result.selection_path = os.path.join(out_dir, "selection.json")
        with open(result.selection_path, "w", encoding="utf-8") as f:
            json.dump(selection, f, indent=2)
    return result


def _save_checkpoint(result: TrainResult, checkpoint_dir: str, head_tag: str, seed: int) -> str:
    path = os.path.join(checkpoint_dir, f"{head_tag}_{result.config_id}_seed{seed}.pt")
    torch.save(result.best_state, path)
    return path


def main() -> None:
    """Materialize the real C3 selection: load the frozen headline cache + the strict-disjoint corpus,
    run the grid, write the sealed `selection.json`. Requires the embedding cache to be **built** (the
    multi-hour `embed.build_cache` one-time pass); `load_cache` fails loud with a pointer otherwise."""
    set_determinism(SEED)
    cache = load_cache(HEADLINE)
    corpus = load_headline_corpus()
    result = run(cache, corpus, seed=SEED)
    sel = result.selection
    # Convergence/early-stop indicator is the ONLY human-readable C3 output (§1) — NO metric value.
    print(f"[h26 C3] selection: {sel['checkpoint_id']} (config {sel['training_config']['config_id']})")
    print(f"[h26 C3] converged={sel['converged']} early_stop_epoch={sel['early_stop_epoch']}")
    print(f"[h26 C3] checkpoint_sha256={sel['checkpoint_sha256']}")
    print(f"[h26 C3] wrote {result.selection_path} (no metric value materialized — C4 unlock owns metrics.json)")


if __name__ == "__main__":
    main()
