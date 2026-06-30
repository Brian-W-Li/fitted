"""§4 negative-sampling contract invariants for data_loader.

Most tests run on a small synthetic corpus with hand-controlled co-occurrence so the
invariants are deterministic and fast (no 105MB metadata load). Two lightweight checks touch
the real data dir and skip cleanly when it is absent (hermetic CI), plus one slow full-load
smoke test behind the same guard. Reference: docs/plans/h26-compatibility-spike-v2.md §4/§15.
"""

import csv
import inspect
import json
import os

import pytest

import data_loader as dl
from data_loader import (
    Item,
    build_fitb,
    build_outfit_level,
    build_pairwise,
    make_split_data,
    purge_train_overlap,
)

# --------------------------------------------------------------------------- #
# Synthetic corpus
# --------------------------------------------------------------------------- #
# Four garment categories T/B/S (top/bottom/shoes) + A (an excluded accessory category).
_CATS = {"T": "top", "B": "bottom", "S": "shoes", "A": "excluded"}


def _item(item_id: str) -> Item:
    cat = item_id[0].upper()  # "t1" -> category "T"
    return Item(item_id=item_id, category_id=cat, semantic=cat, type=_CATS[cat])


def _index(*item_ids: str) -> dict[str, Item]:
    return {i: _item(i) for i in item_ids}


@pytest.fixture
def test_split():
    """Test split with controlled co-occurrence.

    O1 [t1,b1,s1,a1] (a1 excluded) · O2 [t2,b2,s2] · O3 [t3,b3] · O4 [t1,b4] · O5 [s3,t4]
    · O6 [a1,t2] (1 clothing -> dropped). t1 co-occurs with b1,s1,b4 (two outfits).
    """
    idx = _index("t1", "t2", "t3", "t4", "b1", "b2", "b3", "b4", "s1", "s2", "s3", "a1")
    raw = [
        ("O1", ["t1", "b1", "s1", "a1"]),
        ("O2", ["t2", "b2", "s2"]),
        ("O3", ["t3", "b3"]),
        ("O4", ["t1", "b4"]),
        ("O5", ["s3", "t4"]),
        ("O6", ["a1", "t2"]),
    ]
    return make_split_data("test", raw, idx), idx


# --------------------------------------------------------------------------- #
# Mapping / filtering
# --------------------------------------------------------------------------- #
def test_excluded_items_dropped_and_short_outfits_removed(test_split):
    split, idx = test_split
    assert len(split.outfits) == 5            # O1..O5 kept
    assert split.dropped_outfits == 1         # O6 had 1 clothing item
    assert split.raw_outfits == 6
    # a1 never appears in any kept outfit
    assert all("a1" not in o.item_ids for o in split.outfits)
    # a1 referenced in O1 and O6 -> 2 excluded item slots
    assert split.item_slots_excluded == 2
    assert "A" not in split.by_cat            # excluded category never pooled


# --------------------------------------------------------------------------- #
# Pair-level (gate A)
# --------------------------------------------------------------------------- #
def test_pairwise_same_category_and_anchor_non_cooccurrence(test_split):
    split, idx = test_split
    # Sweep many seeds: a single committed seed can pass by luck even with the §4 rule removed
    # (verified — the anchor-no-cooccurrence mutant survives at seed=7). The rule must hold for
    # EVERY draw, so a rule-removing regression fails at some seed in the sweep.
    for seed in range(50):
        edges, skipped = build_pairwise(split, idx, seed=seed)
        pos = [e for e in edges if e.label == 1]
        neg = [e for e in edges if e.label == 0]
        # balanced 1:1: skipped positives are dropped entirely, not retained as orphan positives
        assert len(pos) == len(neg)
        assert len(neg) > 0
        for e in neg:
            # same fine category as the item it replaced
            assert idx[e.b].category_id == idx[e.replaced].category_id
            assert e.b != e.replaced and e.b != e.anchor
            # b' NEVER co-occurs with the kept anchor anywhere in the split
            assert e.b not in split.cooccur.get(e.anchor, set())
        for e in pos:
            # positives are genuinely co-worn
            assert e.b in split.cooccur.get(e.a, set())


def test_pairwise_is_seed_deterministic(test_split):
    split, idx = test_split
    assert build_pairwise(split, idx, seed=1) == build_pairwise(split, idx, seed=1)
    assert build_pairwise(split, idx, seed=1) != build_pairwise(split, idx, seed=2)


def test_fitb_is_seed_deterministic(test_split):
    split, idx = test_split
    assert build_fitb(split, idx, seed=1) == build_fitb(split, idx, seed=1)
    assert build_fitb(split, idx, seed=1) != build_fitb(split, idx, seed=2)


def test_outfit_level_is_seed_deterministic(test_split):
    split, idx = test_split
    assert build_outfit_level(split, idx, seed=1) == build_outfit_level(split, idx, seed=1)
    assert build_outfit_level(split, idx, seed=1) != build_outfit_level(split, idx, seed=2)


# --------------------------------------------------------------------------- #
# FITB@4 (gate B) — multi-anchor non-co-occurrence
# --------------------------------------------------------------------------- #
def test_fitb_structure_and_multi_anchor_non_cooccurrence(test_split):
    split, idx = test_split
    # Sweep seeds: a single committed seed can pass even with the §4 rule fully removed. (This
    # fixture catches full removal; the narrower retained[:1] multi-anchor truncation is caught by
    # the dedicated trap test below + the real-data guard, not here.) `total` proves the inner
    # asserts actually ran (non-vacuous).
    total = 0
    for seed in range(50):
        questions, _ = build_fitb(split, idx, seed=seed)
        total += len(questions)
        for q in questions:
            assert len(q.candidates) == 4
            assert len(set(q.candidates)) == 4
            answer = q.candidates[q.correct_index]
            assert idx[answer].category_id == q.answer_category
            distractors = [c for i, c in enumerate(q.candidates) if i != q.correct_index]
            assert len(distractors) == 3
            for d in distractors:
                assert idx[d].category_id == q.answer_category   # same category as the answer
                assert d not in q.retained
                # the §4 multi-anchor rule: a distractor co-occurs with NO retained item
                for r in q.retained:
                    assert d not in split.cooccur.get(r, set())
    assert total > 0


def test_fitb_multi_anchor_rule_catches_non_first_retained():
    """The §4 multi-anchor rule must forbid a distractor co-occurring with ANY retained item, not
    just the first. The general fixture can't distinguish 'forbid all retained' from a
    `retained[:1]` truncation; this trap can, so the rule is guarded even in hermetic CI (no
    dataset). O1's t1-question has retained=(b1,s1) where t2 co-occurs with s1 (the NON-first
    retained) but not b1: under `retained[:1]` the pool is exactly {t2,t3,t4} so t2 is admitted as
    a distractor — a hidden false negative. Correct code drops t2 (pool {t3,t4} < 3 → that
    question skips); O3/O4 still yield valid questions so the assertions run (non-vacuous)."""
    idx = _index("t1", "t2", "t3", "t4", "b1", "b2", "s1", "s2")
    split = make_split_data(
        "test",
        [
            ("O1", ["t1", "b1", "s1"]),   # answer t1 -> retained (b1, s1)
            ("O2", ["t2", "s1"]),         # t2 co-occurs with s1 (non-first retained), not b1
            ("O3", ["t3", "b2"]),         # yields a valid question under correct code
            ("O4", ["t4", "s2"]),         # yields a valid question under correct code
        ],
        idx,
    )
    total = 0
    for seed in range(50):
        questions, _ = build_fitb(split, idx, seed=seed)
        total += len(questions)
        for q in questions:
            for d in (c for k, c in enumerate(q.candidates) if k != q.correct_index):
                for r in q.retained:
                    assert d not in split.cooccur.get(r, set()), (
                        "distractor co-occurs with a retained item (multi-anchor rule violated)"
                    )
    assert total > 0   # valid questions ARE built under correct code (non-vacuous)


# --------------------------------------------------------------------------- #
# Outfit-level (gate D)
# --------------------------------------------------------------------------- #
def test_outfit_level_preserves_multiset_and_shares_no_item(test_split):
    split, idx = test_split
    total = 0  # proves the inner asserts ran across the seed sweep (non-vacuous)
    for seed in range(50):
        pairs, _ = build_outfit_level(split, idx, seed=seed)
        total += len(pairs)
        for p in pairs:
            assert len(p.positive) == len(p.negative)
            # category multiset preserved
            assert sorted(idx[i].category_id for i in p.positive) == sorted(
                idx[i].category_id for i in p.negative
            )
            # shares no item with the positive
            assert not (set(p.positive) & set(p.negative))
            # the corrupted items are mutually non-co-occurring (a constructed non-outfit)
            neg = list(p.negative)
            for a_idx, x in enumerate(neg):
                for y in neg[a_idx + 1:]:
                    assert y not in split.cooccur.get(x, set())
    assert total > 0


# --------------------------------------------------------------------------- #
# Split-scoped pools never cross-leak
# --------------------------------------------------------------------------- #
def test_negatives_never_cross_split():
    """A category present in two splits with disjoint items: test negatives must stay in test.

    The fixture is sized so all three constructions are NON-vacuous on the test split — each
    category has 4 members that APPEAR in test outfits and each outfit's items co-occur only
    within their own outfit, so every held-out FITB answer has exactly 3 eligible distractors (an
    earlier 2-item fixture silently yielded 0 FITB questions, making the FITB cross-leak
    assertion vacuous). Note: by_cat is built from items present in outfits, so every member must
    appear in an outfit, not merely in the index."""
    idx = _index(
        "t1", "t2", "t3", "t4",   # test tops
        "b1", "b2", "b3", "b4",   # test bottoms
        "s1", "s2", "s3", "s4",   # test shoes
        "tv1", "tv2", "bv1", "bv2", "sv1", "sv2",   # valid items (same cats, disjoint ids)
    )
    test = make_split_data(
        "test",
        [
            ("OT1", ["t1", "b1", "s1"]),
            ("OT2", ["t2", "b2", "s2"]),
            ("OT3", ["t3", "b3", "s3"]),
            ("OT4", ["t4", "b4", "s4"]),
        ],
        idx,
    )
    # valid split exists with the same categories but different items (item-disjoint guarantee)
    make_split_data("valid", [("OV1", ["tv1", "bv1", "sv1"]), ("OV2", ["tv2", "bv2", "sv2"])], idx)

    test_ids = {i for o in test.outfits for i in o.item_ids}
    edges, _ = build_pairwise(test, idx, seed=11)
    assert len(edges) > 0
    for e in edges:
        assert e.a in test_ids and e.b in test_ids   # never a valid-split item
    # the same split-scoping must hold for FITB distractors and outfit-level corruptions
    questions, _ = build_fitb(test, idx, seed=11)
    assert len(questions) > 0                         # non-vacuous: the FITB arm actually runs
    for q in questions:
        assert all(c in test_ids for c in q.candidates)
    pairs, _ = build_outfit_level(test, idx, seed=11)
    assert len(pairs) > 0
    for p in pairs:
        assert all(i in test_ids for i in p.negative)


# --------------------------------------------------------------------------- #
# Negative-scarcity skip accounting (§4/§15 honesty disclosure)
# --------------------------------------------------------------------------- #
def test_skip_accounting_counts_exhausted_pools():
    """When a category pool cannot supply a negative/distractor the item is dropped and COUNTED
    — the reported scarcity count (§4/§15). Force exhaustion: category T has only the two
    co-worn items t1,t2, so the (t1,t2) edge has no eligible third T-member for either anchor."""
    idx = _index("t1", "t2", "b1", "b2", "b3", "b4")
    split = make_split_data(
        "test", [("O1", ["t1", "t2"]), ("O2", ["b1", "b2"]), ("O3", ["b3", "b4"])], idx
    )
    edges, skipped = build_pairwise(split, idx, seed=1)
    pos = [e for e in edges if e.label == 1]
    neg = [e for e in edges if e.label == 0]
    assert skipped > 0                       # the (t1,t2) edge: no eligible T negative
    assert len(pos) == len(neg)              # skipped positives are not kept in the scored pool
    # FITB / outfit-level also surface their scarcity counts (the T pool can never supply 3)
    _, fitb_skipped = build_fitb(split, idx, seed=1)
    _, outfit_skipped = build_outfit_level(split, idx, seed=1)
    assert fitb_skipped > 0 and outfit_skipped > 0


# --------------------------------------------------------------------------- #
# Duplicate item references within an outfit are de-duplicated (B1 regression)
# --------------------------------------------------------------------------- #
def test_duplicate_item_ids_are_deduplicated():
    """A repeated item_id is a real Polyvore data-entry artifact; left un-deduped it makes a
    singleton co-occurrence pair that crashes build_pairwise and self-pollutes cooccur. The
    loader must drop the duplicate (order-preserving) before the <2-clothing check."""
    idx = _index("t1", "b1", "b2", "s1", "s2")
    split = make_split_data(
        "test",
        [("DUP", ["t1", "b1", "b1"]), ("O2", ["t1", "b2", "s2"]), ("O3", ["b1", "s1"])],
        idx,
    )
    dup = next(o for o in split.outfits if o.set_id == "DUP")
    assert dup.item_ids == ("t1", "b1")          # the repeat collapsed, order preserved
    assert all(i not in s for i, s in split.cooccur.items())   # no item co-occurs with itself
    assert split.popularity["b1"] == 2           # DUP + O3, NOT double-counted within DUP
    edges, _ = build_pairwise(split, idx, seed=1)   # must not raise on the (formerly) dup pair
    assert any(e.label == 0 for e in edges)


def test_strict_json_loader_rejects_duplicate_keys_and_nonfinite(tmp_path):
    dup = tmp_path / "dup.json"
    dup.write_text('{"a": 1, "a": 2}', encoding="utf-8")
    with pytest.raises(ValueError, match="duplicate JSON key"):
        dl.load_json_strict(str(dup))

    nan = tmp_path / "nan.json"
    nan.write_text('{"a": NaN}', encoding="utf-8")
    with pytest.raises(ValueError, match="non-finite JSON constant"):
        dl.load_json_strict(str(nan))


# --------------------------------------------------------------------------- #
# Strict-disjoint purge (§2 headline option)
# --------------------------------------------------------------------------- #
def test_purge_train_overlap_drops_only_overlapping_outfits():
    train_items = {"x1", "x2"}
    raw_test = [
        ("clean1", ["a1", "b1"]),     # no overlap -> kept
        ("dirty", ["a2", "x1"]),      # shares x1 with train -> dropped
        ("clean2", ["a3", "b3"]),     # kept
    ]
    out = purge_train_overlap(raw_test, train_items)
    assert [sid for sid, _ in out] == ["clean1", "clean2"]


# --------------------------------------------------------------------------- #
# Real-data guards (skip cleanly when the local dataset is absent)
# --------------------------------------------------------------------------- #
_HAS_DATA = os.path.isdir(dl.DEFAULT_DATA_ROOT) and os.path.exists(
    os.path.join(dl.DEFAULT_DATA_ROOT, "polyvore_item_metadata.json")
)
_HAS_CATS = os.path.exists(os.path.join(dl.DEFAULT_DATA_ROOT, "categories.csv"))


def test_load_corpus_default_is_headline_strict_disjoint():
    param = inspect.signature(dl.load_corpus).parameters["strict_disjoint"]
    assert param.default is True


@pytest.mark.skipif(not _HAS_CATS, reason="local Polyvore categories.csv absent")
def test_type_map_covers_real_category_vocabulary():
    cats = dl.load_type_map()
    with open(os.path.join(dl.DEFAULT_DATA_ROOT, "categories.csv"), encoding="utf-8") as f:
        for row in csv.reader(f):
            if not row or not row[0].strip():
                continue
            cid = row[0].strip()
            assert cid in cats, f"category_id {cid} missing from type_map.json"
            assert cats[cid]["type"] in (*dl.FIVE_TYPES, dl.EXCLUDED)


@pytest.mark.skipif(not _HAS_DATA, reason="local Polyvore dataset absent")
def test_real_corpus_load_smoke():
    corpus = dl.load_corpus(verbose=False, strict_disjoint=False)
    # the disjoint split sizes shipped in the JSON (read off at load, never hard-split)
    assert corpus.splits["train"].raw_outfits == 16995
    assert corpus.splits["valid"].raw_outfits == 3000
    assert corpus.splits["test"].raw_outfits == 15145
    # constructions run on the real test split and stay self-consistent
    edges, _ = build_pairwise(corpus.splits["test"], corpus.item_index, seed=0)
    assert any(e.label == 0 for e in edges) and any(e.label == 1 for e in edges)


@pytest.mark.skipif(not _HAS_DATA, reason="local Polyvore dataset absent")
def test_strict_disjoint_zeroes_train_test_overlap():
    raw_train = dl.read_raw_outfits(dl.DEFAULT_DATA_ROOT, "train")
    train_items = {i for _, ids in raw_train for i in ids}
    corpus = dl.load_corpus(verbose=False, strict_disjoint=True)
    test_items = {i for o in corpus.splits["test"].outfits for i in o.item_ids}
    assert not (test_items & train_items)                       # literally item-disjoint
    assert corpus.splits["test"].raw_outfits == 15145 - 47      # the 47 purged outfits (§2)


@pytest.mark.skipif(not _HAS_DATA, reason="local Polyvore dataset absent")
def test_real_corpus_no_false_negatives_all_constructions():
    """The load-bearing §4 guarantee, ON THE REAL CORPUS: independently re-derive co-occurrence
    from the kept outfits and assert ZERO false negatives across all three constructions, on
    BOTH the test split (the gate input) AND the train split (the BCE-source path — and the B1
    duplicate-item regression: build_pairwise(train) must not crash). This is the strongest §4
    guard; a synthetic single-seed test can pass with the rule removed, this cannot."""
    corpus = dl.load_corpus(verbose=False)
    idx = corpus.item_index
    for split_name in ("train", "test"):
        split = corpus.splits[split_name]
        # independent co-occurrence rebuild — do NOT trust split.cooccur
        cooc: dict[str, set[str]] = {}
        for o in split.outfits:
            for a_i, a in enumerate(o.item_ids):
                for b in o.item_ids[a_i + 1:]:
                    cooc.setdefault(a, set()).add(b)
                    cooc.setdefault(b, set()).add(a)
        # no item co-occurs with itself (B1: duplicates de-duplicated before indexing)
        assert all(i not in s for i, s in cooc.items()), f"{split_name}: self-co-occurrence (dup leak)"

        edges, skipped = build_pairwise(split, idx, seed=0)   # must NOT crash on train (B1)
        pos = [e for e in edges if e.label == 1]
        neg = [e for e in edges if e.label == 0]
        assert skipped >= 0
        assert len(neg) > 0 and len(pos) == len(neg)
        for e in neg:
            assert idx[e.b].category_id == idx[e.replaced].category_id
            assert e.b not in cooc.get(e.anchor, set())        # no pairwise false negative

        questions, _ = build_fitb(split, idx, seed=0)
        assert len(questions) > 0
        for q in questions:
            assert len(set(q.candidates)) == 4
            answer = q.candidates[q.correct_index]
            for d in (c for k, c in enumerate(q.candidates) if k != q.correct_index):
                assert idx[d].category_id == idx[answer].category_id
                for r in q.retained:
                    assert d not in cooc.get(r, set())         # no FITB false negative

        pairs, _ = build_outfit_level(split, idx, seed=0)
        assert len(pairs) > 0
        for p in pairs:
            assert sorted(idx[i].category_id for i in p.positive) == sorted(
                idx[i].category_id for i in p.negative
            )
            assert not (set(p.positive) & set(p.negative))
            ng = list(p.negative)
            for x_i, x in enumerate(ng):
                for y in ng[x_i + 1:]:
                    assert y not in cooc.get(x, set())         # no outfit-level false negative


@pytest.mark.skipif(not _HAS_DATA, reason="local Polyvore dataset absent")
def test_type_map_type_agrees_with_item_semantics():
    """Coverage (the test above) does not check correctness: a 'top' category whose items are
    semantically bottoms would pass it. Here every NON-excluded category's 5-type must match its
    items' dominant semantic_category — EXCEPT (a) the documented exclusion carve-outs
    (accessory/swim/sleep/lingerie) and (b) rows with an explicit `override_reason` (deliberate
    production-match overrides, e.g. cardigan/track jacket → the app's deriveClothingType label,
    not Polyvore's semantic). Both are single-homed in type_map.json's rows/_policy."""
    from collections import Counter

    cats = dl.load_type_map()
    with open(
        os.path.join(dl.DEFAULT_DATA_ROOT, "polyvore_item_metadata.json"), encoding="utf-8"
    ) as f:
        meta = json.load(f)
    sem_by_cat: dict[str, Counter] = {}
    for m in meta.values():
        sem_by_cat.setdefault(m["category_id"], Counter())[m.get("semantic_category", "")] += 1
    sem_to_type = {
        "tops": "top", "bottoms": "bottom", "shoes": "shoes",
        "outerwear": "outer_layer", "all-body": "dress",
    }
    # Production-match overrides (cardigan, track jacket) deliberately diverge from the Polyvore
    # semantic to match the app's deriveClothingType serving-time label (type_map _policy). Pin
    # them EXACTLY (cid -> type, verified by porting fitted/lib/clothingType.ts over the fine
    # names) so the override_reason key can't silently hide a genuine mistype: a new/changed/wrong
    # override fails here until consciously re-verified against production, not just rubber-stamped.
    EXPECTED_OVERRIDES = {"18": "top", "256": "outer_layer", "289": "outer_layer"}
    actual_overrides = {cid: r["type"] for cid, r in cats.items() if "override_reason" in r}
    assert actual_overrides == EXPECTED_OVERRIDES, (
        f"type_map overrides changed: {actual_overrides} != {EXPECTED_OVERRIDES} — re-verify "
        f"against production deriveClothingType before updating this pin"
    )
    for cid, counter in sem_by_cat.items():
        row = cats[cid]
        if row["type"] == dl.EXCLUDED or "override_reason" in row:
            continue   # excluded carve-out, or a pinned production-match override (asserted above)
        dominant = counter.most_common(1)[0][0]
        assert row["type"] == sem_to_type.get(dominant), (
            f"category_id {cid}: type {row['type']!r} disagrees with dominant semantic {dominant!r}"
        )
