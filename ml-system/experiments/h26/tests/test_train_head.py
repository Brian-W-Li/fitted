"""Tests for the trained heads + the C3 sealed-selection emission.

The load-bearing pins: (1) the two heads' parameter counts EXACTLY match the frozen
`preregistration.json` analyst pins (795,617 / 788,481 — the §C.2 capacity match), (2) the grid +
optimizer copy the frozen mirror (not re-decided here), (3) training is bit-for-bit deterministic from
the seed (the trust floor — `selection.json` must reproduce), and (4) the emitted `selection.json`
validates against `selection.schema.json` and leaks **no metric value of any split** (the §1 blindness
invariant). Synthetic + deterministic; the heads/training run on a tiny cache so the suite is fast.
Reference: docs/plans/h26-compatibility-spike-v2.md §6 / §C.1–C.4 / §1 / §15.
"""

import hashlib
import json
import os

import jsonschema
import numpy as np
import pytest
import torch
from synthetic import make_cache, make_corpus

import data_loader as dl
import train_head as th
from data_loader import build_pairwise
from train_head import (
    GRID,
    ItemLevelHead,
    PairwiseEdgeHead,
    TrainResult,
    build_edge_tensors,
    build_selection,
    checkpoint_sha256,
    manifest_hashes,
    param_count,
    pooled_pair_auc,
    run,
    score_edge_tensors,
    select_over_grid,
    train_one_config,
    type_pair_index,
    validate_selection,
)

H26 = os.path.dirname(os.path.dirname(__file__))
SEED = 20260629
FAST = {"max_epochs": 2}  # keep the synthetic training loop short


def _frozen_pins() -> dict:
    return dl.load_json_strict(os.path.join(H26, "preregistration.json"))["analyst_pins"]


# --------------------------------------------------------------------------- #
# Head shapes: the frozen one-way-door arithmetic (§C.1 / §C.2)
# --------------------------------------------------------------------------- #
def test_param_counts_match_the_frozen_mirror():
    pins = _frozen_pins()
    assert param_count(PairwiseEdgeHead()) == pins["edge_head"]["param_count"] == 795617
    assert param_count(ItemLevelHead()) == pins["item_level_ablation_head"]["param_count"] == 788481
    # the capacity match itself (a pairwise win must not be a parameter-count win — §C.2)
    pw, il = param_count(PairwiseEdgeHead()), param_count(ItemLevelHead())
    assert abs(il - pw) / pw <= pins["item_level_ablation_head"]["capacity_match_tolerance"]


def test_grid_and_optimizer_copy_the_frozen_mirror():
    opt = _frozen_pins()["optimizer"]
    assert len(GRID) == opt["n_configs"] == 6
    assert sorted({c["learning_rate"] for c in GRID}) == sorted(opt["lr_grid"])
    assert sorted({c["weight_decay"] for c in GRID}) == sorted(opt["weight_decay_grid"])
    assert th.BATCH_SIZE == opt["batch_size"] and th.MAX_EPOCHS == opt["max_epochs"]
    assert th.EARLY_STOP_PATIENCE == opt["early_stop_patience"] and th.SEED == opt["seed"] == SEED


def test_type_pair_index_is_unordered_and_covers_0_to_14():
    seen = set()
    for a in dl.FIVE_TYPES:
        for b in dl.FIVE_TYPES:
            i = type_pair_index(a, b)
            assert i == type_pair_index(b, a)              # unordered
            seen.add(i)
    assert seen == set(range(15))                          # 15 distinct incl. same-type diagonal
    assert type_pair_index("top", "top") != type_pair_index("top", "bottom")


def test_heads_are_symmetric_in_endpoint_order():
    ei, ej = torch.randn(8, 768), torch.randn(8, 768)
    pair = torch.randint(0, 15, (8,))
    for head in (PairwiseEdgeHead(), ItemLevelHead()):
        assert torch.allclose(head(ei, ej, pair), head(ej, ei, pair), atol=1e-6)


def test_pairwise_feature_block_layout_is_frozen():
    # Param count + symmetry are BOTH invariant under a feature-math typo (e.g. dropping the .abs() or
    # `*`->`+`), so pin the §C.1 concat directly: the five blocks must be emb_i, emb_j, |emb_i-emb_j|,
    # emb_i⊙emb_j, type-pair — in that order, in the right slices. This is the only test that would
    # catch a silent corruption of the frozen headline feature.
    head = PairwiseEdgeHead()
    ei = torch.tensor([[1.0, -2.0, 3.0] + [0.0] * 765])
    ej = torch.tensor([[0.5, 1.0, -1.0] + [0.0] * 765])
    pair = torch.tensor([3])
    feat = head._feature(ei, ej, pair)
    assert feat.shape == (1, 3104)                            # 4·768 + 32
    d = 768
    assert torch.equal(feat[:, :d], ei)                       # emb_i
    assert torch.equal(feat[:, d:2 * d], ej)                  # emb_j
    assert torch.allclose(feat[:, 2 * d:3 * d], (ei - ej).abs())  # |emb_i-emb_j| (catches a dropped .abs())
    assert torch.allclose(feat[:, 3 * d:4 * d], ei * ej)      # emb_i⊙emb_j (catches *->+)
    assert torch.equal(feat[:, 4 * d:], head.type_emb(pair))  # the 32-d type-pair block
    assert feat[0, 2 * d].item() == pytest.approx(0.5)        # |1 - 0.5|
    assert feat[0, 3 * d].item() == pytest.approx(0.5)        # 1 * 0.5


# --------------------------------------------------------------------------- #
# Edge tensors + scoring
# --------------------------------------------------------------------------- #
def test_build_edge_tensors_shapes_labels_and_type_pairs():
    corpus = make_corpus(seed=0)
    cache = make_cache(corpus.item_index)
    edges, _ = build_pairwise(corpus.splits["test"], corpus.item_index, SEED)
    t = build_edge_tensors(edges, cache, corpus.item_index)
    assert len(t) == len(edges)
    assert t.ei.shape == (len(edges), 768) and t.ei.dtype == torch.float32
    assert t.pair.dtype == torch.int64 and int(t.pair.min()) >= 0 and int(t.pair.max()) <= 14
    assert set(t.label.tolist()) <= {0.0, 1.0}
    # the type-pair index of edge 0 matches the items' types
    e0 = edges[0]
    expect = type_pair_index(corpus.item_index[e0.a].type, corpus.item_index[e0.b].type)
    assert int(t.pair[0]) == expect


def test_score_edge_tensors_batched_equals_unbatched():
    corpus = make_corpus(seed=0)
    cache = make_cache(corpus.item_index)
    edges, _ = build_pairwise(corpus.splits["test"], corpus.item_index, SEED)
    t = build_edge_tensors(edges, cache, corpus.item_index)
    head = PairwiseEdgeHead()
    s_small = score_edge_tensors(head, t, batch=7)
    s_big = score_edge_tensors(head, t, batch=10_000)
    np.testing.assert_allclose(s_small, s_big, atol=1e-6)
    assert pooled_pair_auc(head, t) == pytest.approx(
        __import__("metrics").auc_pos_neg(s_big[t.label.numpy() == 1], s_big[t.label.numpy() == 0])
    )


# --------------------------------------------------------------------------- #
# Determinism — the trust floor
# --------------------------------------------------------------------------- #
def test_training_is_bit_for_bit_deterministic():
    corpus = make_corpus(seed=0)
    cache = make_cache(corpus.item_index)
    edges, _ = build_pairwise(corpus.splits["train"], corpus.item_index, SEED)
    vedges, _ = build_pairwise(corpus.splits["valid"], corpus.item_index, SEED)
    t = build_edge_tensors(edges, cache, corpus.item_index)
    v = build_edge_tensors(vedges, cache, corpus.item_index)
    r1 = train_one_config(PairwiseEdgeHead, t, v, GRID[0], "grid_0", seed=SEED, max_epochs=3)
    r2 = train_one_config(PairwiseEdgeHead, t, v, GRID[0], "grid_0", seed=SEED, max_epochs=3)
    assert checkpoint_sha256(r1.best_state) == checkpoint_sha256(r2.best_state)  # identical weights
    assert r1.valid_auc == r2.valid_auc and r1.best_epoch == r2.best_epoch


def test_checkpoint_sha256_is_64hex_and_content_sensitive():
    a = PairwiseEdgeHead()
    th.set_determinism(SEED)
    b = PairwiseEdgeHead()  # a different random init
    sha_a = checkpoint_sha256(a.state_dict())
    assert len(sha_a) == 64 and all(c in "0123456789abcdef" for c in sha_a)
    assert sha_a != checkpoint_sha256(b.state_dict())          # a weight change moves the hash
    assert sha_a == checkpoint_sha256({k: v.clone() for k, v in a.state_dict().items()})


# --------------------------------------------------------------------------- #
# Mechanical argmax selection (§C.4 — tie breaks to the lowest grid index)
# --------------------------------------------------------------------------- #
def test_argmax_selection_breaks_ties_to_lowest_index():
    rs = [
        TrainResult(f"grid_{i}", {}, {}, valid_auc=a, best_epoch=0, converged=True, epochs_run=1)
        for i, a in enumerate([0.70, 0.70, 0.60])
    ]
    assert max(rs, key=lambda r: r.valid_auc).config_id == "grid_0"  # the select_over_grid contract


def test_select_over_grid_returns_the_argmax_winner():
    corpus = make_corpus(seed=0)
    cache = make_cache(corpus.item_index)
    edges, _ = build_pairwise(corpus.splits["train"], corpus.item_index, SEED)
    vedges, _ = build_pairwise(corpus.splits["valid"], corpus.item_index, SEED)
    t = build_edge_tensors(edges, cache, corpus.item_index)
    v = build_edge_tensors(vedges, cache, corpus.item_index)
    winner, results = select_over_grid(PairwiseEdgeHead, t, v, seed=SEED, **FAST)
    assert len(results) == 6
    assert winner is max(results, key=lambda r: r.valid_auc)
    assert winner.config_id in {f"grid_{i}" for i in range(6)}


# --------------------------------------------------------------------------- #
# selection.json — schema-valid, hash-bound, and METRIC-FREE (the §1 blindness contract)
# --------------------------------------------------------------------------- #
def _selection_schema() -> dict:
    with open(os.path.join(H26, "selection.schema.json"), encoding="utf-8") as f:
        return json.load(f)


def _stub_winner() -> TrainResult:
    return TrainResult(
        config_id="grid_3", config={"learning_rate": 3e-4, "weight_decay": 1e-4},
        best_state={}, valid_auc=0.8137, best_epoch=12, converged=True, epochs_run=18,
    )


def test_build_selection_validates_against_the_schema():
    sel = build_selection(_stub_winner(), "a" * 64, cache_key="fashionsiglip", seed=SEED, root_dir=H26)
    jsonschema.Draft202012Validator(_selection_schema()).validate(sel)  # raises on any violation
    assert sel["training_config"]["head"] == "pairwise_type_conditioned_edge"
    assert sel["training_config"]["config_id"] == "grid_3"
    assert sel["converged"] is True and sel["early_stop_epoch"] == 12


def test_selection_manifest_hashes_bind_the_real_frozen_artifacts():
    sel = build_selection(_stub_winner(), "b" * 64, cache_key="fashionsiglip", seed=SEED, root_dir=H26)
    mh = sel["manifest_hashes"]
    for field_name, fname in th.MANIFEST_HASH_FILES.items():
        with open(os.path.join(H26, fname), "rb") as f:
            assert mh[field_name] == hashlib.sha256(f.read()).hexdigest()
    assert manifest_hashes(H26) == mh                           # the helper and the emitted dict agree


def test_selection_leaks_no_metric_value():
    # The blindness invariant: every numeric value in selection.json is a non-metric (seed, the two
    # hyperparameters, batch/epoch/patience counts, the early-stop epoch) — the winner's actual valid
    # AUC (0.8137) must NOT appear anywhere, and the schema structurally bans any metric-named field.
    winner = _stub_winner()
    sel = build_selection(winner, "c" * 64, cache_key="fashionsiglip", seed=SEED, root_dir=H26)

    def numbers(obj):
        if isinstance(obj, bool):
            return []
        if isinstance(obj, (int, float)):
            return [obj]
        if isinstance(obj, dict):
            return [n for v in obj.values() for n in numbers(v)]
        if isinstance(obj, list):
            return [n for v in obj for n in numbers(v)]
        return []

    nums = set(numbers(sel))
    assert winner.valid_auc not in nums                        # the sealed valid metric did not leak
    allowed = {SEED, 3e-4, 1e-4, th.BATCH_SIZE, th.MAX_EPOCHS, th.EARLY_STOP_PATIENCE, 12}
    assert nums <= allowed, f"unexpected numeric value(s) in selection.json: {nums - allowed}"


def test_validate_selection_rejects_a_metric_leak():
    # A selection carrying a metric-NAMED field must be REFUSED before it is written — the schema's
    # patternProperties is the enforcement, not an honor system.
    leaky = build_selection(_stub_winner(), "d" * 64, cache_key="fashionsiglip", seed=SEED, root_dir=H26)
    leaky["valid_auc"] = 0.8137                                 # a forbidden metric-named field
    with pytest.raises(jsonschema.ValidationError):
        validate_selection(leaky, root_dir=H26)


def test_validate_selection_rejects_a_metric_value_inside_an_id_field():
    # The sealedString $ref bans a metric word OR an embedded decimal INSIDE checkpoint_id / config_id /
    # optimizer — not just a metric-NAMED key. So a checkpoint_id that smuggles "auc0.81" (a number) or
    # a config_id carrying "loss" is refused. This exercises the sealedString rule directly, so a schema
    # regression that drops the $ref would FAIL this test (the metric-named-key test above would not).
    base = build_selection(_stub_winner(), "e" * 64, cache_key="fashionsiglip", seed=SEED, root_dir=H26)
    embedded_decimal = {**base, "checkpoint_id": "fashionsiglip_pairwise_auc0.81_seed20260629"}
    with pytest.raises(jsonschema.ValidationError):
        validate_selection(embedded_decimal, root_dir=H26)
    metric_word = {**base, "training_config": {**base["training_config"], "config_id": "grid_3_loss"}}
    with pytest.raises(jsonschema.ValidationError):
        validate_selection(metric_word, root_dir=H26)


# --------------------------------------------------------------------------- #
# End-to-end run on a synthetic cache (NO real cache, NO repo pollution)
# --------------------------------------------------------------------------- #
def test_run_emits_schema_valid_selection_and_no_metrics_json(tmp_path):
    corpus = make_corpus(seed=0)
    cache = make_cache(corpus.item_index)
    out = tmp_path / "out"
    ckpt = tmp_path / "ckpt"
    out.mkdir()
    result = run(
        cache, corpus, seed=SEED, root_dir=H26, out_dir=str(out), checkpoint_dir=str(ckpt),
        write=True, train_kwargs=FAST,
    )
    jsonschema.Draft202012Validator(_selection_schema()).validate(result.selection)
    assert os.path.exists(result.selection_path)
    assert not os.path.exists(out / "metrics.json")            # C3 materializes NO metrics
    assert os.path.exists(result.checkpoint_paths["pairwise"])
    assert os.path.exists(result.checkpoint_paths["item_level"])  # the §C.2 ablation checkpoint for C6


def test_run_is_reproducible_bit_for_bit(tmp_path):
    corpus = make_corpus(seed=0)
    cache = make_cache(corpus.item_index)
    r1 = run(cache, corpus, seed=SEED, root_dir=H26, write=False, train_kwargs=FAST)
    r2 = run(cache, corpus, seed=SEED, root_dir=H26, write=False, train_kwargs=FAST)
    assert r1.selection == r2.selection                        # identical sealed artifact, incl. checkpoint_sha256
    assert r1.selection["checkpoint_sha256"] == r2.selection["checkpoint_sha256"]
