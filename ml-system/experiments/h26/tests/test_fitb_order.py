"""Tests for the C3 gate-B FITB order materialization (build doc §12).

The committed `fitb_order.json` is the blindness tripwire C4's prefix selection binds to: the
seed-ordered FITB question list, hashed BEFORE any model number. These pin that the materialization is
deterministic (reproduces bit-for-bit from the seed), that the gate-B set is genuinely a PREFIX of the
frozen order (not a re-selection), and that `verify_fitb_order` fails loud on any drift. Mostly
synthetic + hermetic; one real-data round-trip skips cleanly when the gated dataset is absent.
Reference: docs/plans/h26-compatibility-spike-v2.md §12 / §15.
"""

import json
import os

import pytest
from synthetic import make_corpus

from data_loader import DEFAULT_DATA_ROOT, build_fitb
from fitb_order import (
    SEED,
    _order_sha256,
    load_headline_corpus,
    materialize_fitb_order,
    verify_fitb_order,
)

H26 = os.path.dirname(os.path.dirname(__file__))


def test_materialize_is_deterministic_and_carries_no_metric():
    corpus = make_corpus(seed=0)
    o1 = materialize_fitb_order(corpus, root_dir=H26)
    o2 = materialize_fitb_order(corpus, root_dir=H26)
    assert o1 == o2                                            # bit-for-bit reproducible from the seed
    assert o1["seed"] == SEED and len(o1["order_sha256"]) == 64
    # no metric value anywhere (the §1 blindness boundary — only ids, counts, hashes, provenance)
    blob = json.dumps(o1)
    assert "auc" not in blob.lower() and "fitb_trained" not in blob


def test_gate_b_is_a_prefix_of_the_frozen_order():
    # gate B must be the FIRST cap questions of the same seed-ordered construction, never a re-selection
    # (build doc §12) — so its set_ids equal the head of the full build_fitb order and its hash equals
    # the hash of that prefix.
    corpus = make_corpus(seed=0)
    order = materialize_fitb_order(corpus, root_dir=H26)
    questions, _ = build_fitb(corpus.splits["test"], corpus.item_index, SEED)
    cap = order["gate_b_cap"]
    assert order["gate_b_set_ids"] == [q.set_id for q in questions[:cap]]
    assert order["gate_b_order_sha256"] == _order_sha256(questions[:cap])
    assert order["n_gate_b"] == min(cap, order["n_questions_full"])


def test_verify_passes_on_faithful_order_and_raises_on_drift():
    corpus = make_corpus(seed=0)
    order = materialize_fitb_order(corpus, root_dir=H26)
    verify_fitb_order(order, corpus, root_dir=H26)            # faithful -> no raise
    # a corpus whose questions differ (a different outfit set) must fail the re-derivation
    other = make_corpus(seed=1)
    with pytest.raises(ValueError, match="fitb_order drift"):
        verify_fitb_order(order, other, root_dir=H26)


def test_verify_detects_a_tampered_order_hash():
    corpus = make_corpus(seed=0)
    order = materialize_fitb_order(corpus, root_dir=H26)
    order["order_sha256"] = "0" * 64                          # tamper: claim a different order
    with pytest.raises(ValueError, match="order_sha256"):
        verify_fitb_order(order, corpus, root_dir=H26)


def test_committed_fitb_order_provenance_binds_the_frozen_sources():
    # Hermetic: the committed fitb_order.json's source-hash provenance must bind the CURRENT frozen
    # artifacts (constructor_source_sha256 -> data_loader.py, fitb_manifest_sha256 -> fitb_manifest.json,
    # type_map_sha256 -> type_map.json). A stale provenance hash (e.g. after a data_loader.py edit that
    # was re-frozen everywhere except here) is exactly the drift this guard catches.
    import hashlib

    committed = json.load(open(os.path.join(H26, "fitb_order.json"), encoding="utf-8"))
    for field, fname in (
        ("constructor_source_sha256", "data_loader.py"),
        ("fitb_manifest_sha256", "fitb_manifest.json"),
        ("type_map_sha256", "type_map.json"),
    ):
        with open(os.path.join(H26, fname), "rb") as f:
            assert committed[field] == hashlib.sha256(f.read()).hexdigest(), f"{field} stale vs {fname}"


def test_committed_fitb_order_reproduces_from_real_data():
    # The committed fitb_order.json must reproduce from the real strict-disjoint corpus (the artifact is
    # the real C3 tripwire). Skips cleanly when the gated dataset is not present (hermetic CI).
    if not os.path.exists(os.path.join(DEFAULT_DATA_ROOT, "disjoint", "test.json")):
        pytest.skip("gated Polyvore dataset not present")
    committed = json.load(open(os.path.join(H26, "fitb_order.json"), encoding="utf-8"))
    corpus = load_headline_corpus(verbose=False)
    verify_fitb_order(committed, corpus, root_dir=H26)        # the committed hashes re-derive exactly
