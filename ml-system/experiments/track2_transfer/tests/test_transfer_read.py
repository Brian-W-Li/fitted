"""C5 synthetic mechanical negatives, dependence, and interpretation boundaries."""

from types import SimpleNamespace

import numpy as np
import pytest

from bundle import derive_certificate
import h26_bridge as h26
import transfer_read as t


def item(key, kind, *, resolved=True, image=1):
    return {"itemId": key, "clothingType": kind,
            "imageStatus": "resolved" if resolved else "missing",
            "imageRef": f"mongo:{image:024x}", "imageFile": f"images/{image:024x}.jpg"}


def bundle(rows):
    certificate, clusters = derive_certificate(rows, set())
    return SimpleNamespace(rows=rows, clusters=clusters, certificate=certificate)


def outfit(signature, items, arm="accepted", snapshot=None):
    return {"user": "synthetic-friend", "label": arm, "snapshotId": snapshot or signature,
            "candidateId": signature, "items": items}


def test_negative_uses_same_clothing_type_and_full_resolved_rendered_pool():
    source = bundle([outfit("yes", [item("t1", "top"), item("b1", "bottom")]),
                     outfit("unrated", [item("t2", "top")], arm=None)])
    pairs = t._build_friend_pairs(source, "synthetic-friend")
    assert len(pairs.pairs) == 1
    positive, negative = pairs.pairs[0]
    assert {positive.a, positive.b} == {"t1", "b1"}
    assert negative.b == "t2"
    assert pairs.items[negative.b]["clothingType"] == pairs.items[negative.replaced]["clothingType"]
    assert negative.anchor == "b1"
    assert pairs.skipped_pairs == 0


@pytest.mark.parametrize("missing_user", [None, "absent"])
def test_missing_user_matches_certificate_unknown_identity(missing_user):
    rows = [outfit("yes", [item("t1", "top"), item("b1", "bottom")]),
            outfit("unrated", [item("t2", "top")], arm=None)]
    for row in rows:
        if missing_user == "absent":
            del row["user"]
        else:
            row["user"] = missing_user
    source = bundle(rows)
    assert source.clusters[0].user == "unknown"
    pairs = t._build_friend_pairs(source, "unknown")
    assert pairs.eligible_outfits == 1
    assert len(pairs.pairs) == 1


def test_unresolved_depth_can_qualify_but_draw_shrinkage_is_skipped():
    source = bundle([outfit("yes", [item("t1", "top"), item("b1", "bottom")]),
                     outfit("unrated", [item("t2", "top", resolved=False)], arm=None)])
    pairs = t._build_friend_pairs(source, "synthetic-friend")
    assert pairs.eligible_outfits == 1
    assert pairs.skipped_pairs == 1
    assert pairs.pairs == ()
    assert "t2" not in pairs.items


def test_exhausted_cooccurrence_pool_skips_despite_depth():
    source = bundle([outfit("yes", [item("t1", "top"), item("t2", "top")])])
    pairs = t._build_friend_pairs(source, "synthetic-friend")
    assert pairs.eligible_outfits == 1
    assert pairs.skipped_pairs == 1


def test_deduped_positive_assigned_to_first_source_outfit():
    source = bundle([
        outfit("later", [item("a", "top"), item("b", "bottom")], snapshot="z"),
        outfit("first", [item("a", "top"), item("b", "bottom"), item("c", "shoes")], snapshot="a"),
        outfit("pool", [item("a2", "top"), item("b2", "bottom"), item("c2", "shoes")], arm=None),
    ])
    pairs = t._build_friend_pairs(source, "synthetic-friend")
    assert len(pairs.pairs) == 3
    assert len(set(pairs.sources)) == 1
    assert set(pairs.sources) == {"a|b|c"}


def test_conflicting_image_binding_aborts_explicitly():
    source = bundle([outfit("x", [item("a", "top"), item("b", "bottom")]),
                     outfit("y", [item("a", "top", image=2)], arm=None)])
    with pytest.raises(ValueError, match="conflicting image"):
        t._build_friend_pairs(source, "synthetic-friend")


def test_same_image_historical_type_revision_is_namespaced_without_dropping_rows():
    source = bundle([
        outfit("accepted", [item("edited", "dress"), item("shoe", "shoes")]),
        outfit("historical-edit", [item("edited", "bottom"), item("bottom2", "bottom")], arm=None),
        outfit("pool", [item("dress2", "dress"), item("shoe2", "shoes")], arm=None),
    ])
    pairs = t._build_friend_pairs(source, "synthetic-friend")
    assert pairs.type_revision_items == ("edited",)
    typed = [key for key in pairs.items if key.startswith("edited::type=")]
    assert len(typed) == 2
    assert {pairs.items[key]["clothingType"] for key in typed} == {"dress", "bottom"}
    assert pairs.eligible_outfits == 1


def test_source_outfit_bootstrap_matches_h26_and_not_pair_average():
    pos = np.array([0.4, 0.9, 0.3])
    neg = np.array([0.1, 0.8, 0.2])
    sources = [("a", "outfit1"), ("a", "outfit1"), ("b", "outfit1")]
    groups = [[0, 1], [2]]
    expected = h26.bootstrap_ci(2, lambda idx: h26.auc_pos_neg(
        pos[np.concatenate([groups[i] for i in idx])],
        neg[np.concatenate([groups[i] for i in idx])]), seed=t.SEED, b=200, alpha=0.05)
    result = t.source_outfit_read(pos, neg, sources, b=200)
    assert result["n_source_outfits"] == 2
    assert result["point"] == pytest.approx(7 / 9)
    assert result["point"] != 1.0  # Every matched positive beats its paired negative.
    assert (result["low"], result["high"]) == (expected.low, expected.high)
    assert result["gates_m6"] is False


@pytest.mark.parametrize("n,state", [(11, "REPORT-ONLY"), (12, "SUGGESTIVE"),
                                      (24, "SUGGESTIVE"), (25, "DECIDABLE")])
def test_secondary_floors(n, state):
    result = t.interpret_boundaries(h26.CI(0.61, 0.55, 0.68, 10000), n)
    assert result["state"].startswith(state)
    if n >= 12:
        assert result["above_chance"] and result["below_healthy"]
        assert result["interpretation"] == "signal present but degraded"
    else:
        assert result["above_chance"] is None


def test_boundaries_are_strict_and_secondary_has_no_retired_gate():
    exact = t.interpret_boundaries(h26.CI(0.6, 0.50, 0.70, 10000), 25)
    assert exact["above_chance"] is exact["below_healthy"] is False
    healthy = t.interpret_boundaries(h26.CI(0.7, 0.51, 0.8, 10000), 25)
    assert healthy["interpretation"] == "consistent with healthy"


def test_empty_read_explicit_and_clearance_required():
    assert t.source_outfit_read([], [], [])["point"] is None
    with pytest.raises(Exception, match="clearance|Clearance"):
        t.transfer_read(None, None, None)
