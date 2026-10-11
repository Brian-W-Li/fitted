"""C4 statistics use only invented scores and synthetic image vectors."""

from dataclasses import replace
import json

import numpy as np
import pytest

import h26_bridge as h26
import scoring as s


def row(user, arm, snapshot, score, signature="synthetic"):
    return s.ScoredCluster(user, arm, snapshot, signature, score)


def example():
    return [row("a", "accepted", "s1", 0.9), row("a", "rejected", "s1", 0.8),
            row("a", "accepted", "s2", 0.7), row("a", "rejected", "s2", 0.1),
            row("b", "accepted", "s1", 0.3), row("b", "rejected", "s1", 0.3)]


def brute(rows):
    values = [float(p.score > n.score) + 0.5 * (p.score == n.score)
              for p in rows for n in rows
              if p.user == n.user and p.arm == "accepted" and n.arm == "rejected"]
    return float(np.mean(values)) if values else np.nan


def test_outfit_mean_not_min_max_and_finite():
    edges = {("a", "b"): 0.1, ("a", "c"): 0.6, ("b", "c"): 0.8}
    assert s.outfit_score(["a", "b", "c"], lambda a, b: edges[a, b]) == 0.5
    with pytest.raises(ValueError):
        s.outfit_score(["a"], lambda a, b: 1)
    with pytest.raises(ValueError, match="finite"):
        s.outfit_score(["a", "b"], lambda a, b: np.nan)


def test_pooled_within_friend_matches_bruteforce_and_label_flip():
    rows = example() + [row("empty-arm", "accepted", "s3", 10)]
    assert s.pooled_within_user_auc(rows) == brute(rows) == 0.7
    assert s.per_friend_auc(rows)["empty-arm"]["auc"] is None
    flipped = [replace(c, arm="rejected") if i == 0 else c for i, c in enumerate(rows)]
    assert s.pooled_within_user_auc(flipped) == brute(flipped)
    assert s.pooled_within_user_auc(flipped) != s.pooled_within_user_auc(rows)
    pos = [c.score for c in rows if c.arm == "accepted"]
    neg = [c.score for c in rows if c.arm == "rejected"]
    assert h26.auc_pos_neg(pos, neg) != s.pooled_within_user_auc(rows)


def test_bootstrap_matches_literal_snapshot_draws_and_count_preservation():
    rows = example()
    got = s.blocked_bootstrap_ci(rows, seed=19, b=100)
    rng = np.random.default_rng(19)
    expected = []
    for _ in range(100):
        sample = []
        for user in ("a", "b"):
            snapshots = sorted({c.snapshot_id for c in rows if c.user == user})
            draw = rng.integers(0, len(snapshots), len(snapshots))
            assert len(draw) == len(snapshots)
            for i in draw:
                sample.extend(c for c in rows if c.user == user and c.snapshot_id == snapshots[i])
        expected.append(brute(sample))
    np.testing.assert_array_equal(got.replicates, expected)
    assert got.snapshots_per_friend == {"a": 2, "b": 1}
    same = s.blocked_bootstrap_ci(rows, seed=19, b=100)
    np.testing.assert_array_equal(got.replicates, same.replicates)
    lo, hi = np.quantile(expected, [0.0125, 0.9875])
    assert (got.ci.low, got.ci.high) == (lo, hi)


def test_snapshot_membership_changes_bootstrap_not_point():
    rows = example()
    changed = [replace(c, snapshot_id="s2" if c.snapshot_id == "s1" else "s1")
               if c.user == "a" and c.arm == "rejected" else c for c in rows]
    assert s.pooled_within_user_auc(changed) == s.pooled_within_user_auc(rows)
    a = s.blocked_bootstrap_ci(rows, b=100)
    b = s.blocked_bootstrap_ci(changed, b=100)
    assert not np.array_equal(a.replicates, b.replicates)


def test_degenerate_drops_disclosed_and_all_degenerate_json_safe():
    rows = [row("a", "accepted", "s1", 1), row("a", "rejected", "s2", 0)]
    result = s.blocked_bootstrap_ci(rows, b=1000)
    assert 400 < result.dropped_replicates < 600
    assert result.report()["degenerate_warning"] is True
    assert result.ci.low == result.ci.high == 1
    all_bad = s.blocked_bootstrap_ci(rows[:1], b=10)
    assert all_bad.dropped_replicates == 10
    assert all_bad.report()["low"] is None
    json.dumps(all_bad.report(), allow_nan=False)


def test_default_is_frozen_10000_at_975_percent():
    result = s.blocked_bootstrap_ci(example())
    assert result.ci.b == 10_000
    assert result.alpha == pytest.approx(0.025)


@pytest.mark.parametrize("point,low,expected", [
    (0.58, 0.55, False), (0.60, 0.50, False), (0.60, 0.501, True),
])
def test_practical_point_floor_and_strict_boundary(point, low, expected):
    verdict = s.primary_verdict(h26.CI(point, low, 0.7, 10000), look=1)
    assert (verdict == "ESTABLISHED") is expected


def test_terminal_and_lofo_downgrade_never_upgrade():
    good = h26.CI(0.7, 0.6, 0.8, 10000)
    bad = h26.CI(0.58, 0.5, 0.65, 10000)
    below = h26.CI(0.49, 0.3, 0.6, 10000)
    assert s.primary_verdict(good, look=1, lofo_ci=below) == "SUGGESTIVE (LOFO-sensitive)"
    assert s.primary_verdict(good, look=1, lofo_ci=bad) == "ESTABLISHED"
    assert s.primary_verdict(bad, look=1, lofo_ci=good) != "ESTABLISHED"
    assert s.primary_verdict(bad, look=2) == "NOT-ESTABLISHED (well-powered null)"
    assert s.primary_verdict(bad, look=1, horizon_reached=True) == "NOT-ESTABLISHED (underpowered)"


def test_horizon_look_one_with_fifty_per_arm_proceeds_to_look_two():
    rows = [row(user, arm, f"{user}-{arm}-{i}", 0.5)
            for user in ("a", "b") for arm in ("accepted", "rejected")
            for i in range(25)]
    result = s.primary_read(rows, look=1, horizon_reached=True, b=20)
    assert result["verdict"] == "NOT-ESTABLISHED (proceed to Look 2)"


def test_lofo_largest_pair_mass_not_total_rows_and_lexicographic_tie():
    rows = [row("a", "accepted", "s", 1) for _ in range(10)]
    rows += [row("a", "rejected", "s", 0)]
    rows += [row(u, arm, "s", 1 if arm == "accepted" else 0)
             for u in ("b", "c") for arm in ("accepted", "rejected") for _ in range(4)]
    result = s.primary_read(rows, look=1, b=50)
    assert result["leave_one_friend_out"]["dropped_friend"] == "b"


def test_bundle_entry_requires_clearance_before_head_call():
    with pytest.raises(Exception, match="clearance|Clearance"):
        s.score_bundle(None, None, None)


@pytest.fixture
def synthetic_clearance(tmp_path):
    from bundle import derive_certificate, load_bundle
    from gate import check_look_trigger

    rows = []
    for friend in ("synthetic-a", "synthetic-b", "synthetic-operator"):
        for arm in ("accepted", "rejected"):
            for n in range(13):
                rows.append({"user": friend, "label": arm, "snapshotId": f"{friend}-{n}",
                             "candidateId": arm, "items": [
                    {"itemId": f"{friend}-{arm}-{n}-{k}", "clothingType": kind,
                     "imageStatus": "resolved", "imageRef": f"mongo:{k:024x}",
                     "imageFile": f"images/{k:024x}.jpg"}
                    for k, kind in ((1, "top"), (2, "bottom"))]})
    certificate, _ = derive_certificate(rows, {"synthetic-operator"})
    certificate["excluded"]["users"]["synthetic-operator"]["reason"] = "operator"
    manifest = {"bundleVersion": "track2-export.v1", "yield": certificate,
                "exclusions": {"operatorAuthIds": ["synthetic-operator-auth"]}}
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    (tmp_path / "training_examples.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    bundle = load_bundle(tmp_path)
    clearance = check_look_trigger(bundle, look=1, as_of="2026-09-26", looks_dir=tmp_path / "looks")
    return clearance


def test_gated_bundle_reports_operator_separately_and_both_rungs(synthetic_clearance):

    class Cache:
        def vec(self, key):
            return np.array([1, 0], np.float32) if int(key, 16) == 1 else np.array([0, 1], np.float32)

    class FakeHead:
        calls = []
        def eval(self):
            return self
        def __call__(self, a, b, pair):
            self.calls.append(int(pair.item()))
            return (a * b).sum() + pair.float().sum() / 100

    head = FakeHead()
    result = s.score_bundle(synthetic_clearance, Cache(), head)
    assert result["primary"]["point"] == result["cosine"]["point"] == 0.5
    assert set(result["primary"]["per_friend"]) == {"synthetic-a", "synthetic-b"}
    assert result["excluded"]["trained"]["synthetic-operator"]["accepted"] == 13
    assert result["excluded"]["pooled"] is False
    assert result["cosine"]["gates_m6"] is False
    assert head.calls and len(set(head.calls)) == 1
    json.dumps(result, allow_nan=False)


def test_direct_score_bundle_rejects_ambiguous_garment_before_any_head_call(synthetic_clearance, tmp_path):
    from bundle import derive_certificate, load_bundle
    from gate import check_look_trigger

    original = synthetic_clearance.bundle
    rows = json.loads(json.dumps(original.rows))
    edited = dict(rows[0]["items"][0])
    edited["imageRef"] = "mongo:000000000000000000000003"
    edited["imageFile"] = "images/000000000000000000000003.jpg"
    rows.append({"user": rows[0]["user"], "label": None,
                 "snapshotId": "synthetic-rephoto", "candidateId": "unrated", "items": [edited]})
    certificate, _ = derive_certificate(rows, original.excluded_users)
    certificate["excluded"]["users"]["synthetic-operator"]["reason"] = "operator"
    manifest = dict(original.manifest)
    manifest["yield"] = certificate
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    (tmp_path / "training_examples.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    bundle = load_bundle(tmp_path)
    clearance = check_look_trigger(bundle, look=1, as_of="2026-09-26", looks_dir=tmp_path / "looks")

    class CountingHead:
        calls = 0
        def eval(self):
            self.calls += 1
            return self
        def __call__(self, *args):
            self.calls += 1
            pytest.fail("ambiguous bundle reached compatibility head")

    head = CountingHead()
    with pytest.raises(ValueError, match="conflicting image"):
        s.score_bundle(clearance, None, head)
    assert head.calls == 0
