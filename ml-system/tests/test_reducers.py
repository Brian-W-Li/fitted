from datetime import datetime, timedelta, timezone

from fitted_core import config, reducers
from fitted_core.models import ItemType, WardrobeItem
from fitted_core.reducers import (
    AffinitySignalScorer,
    COUNTED_ACTIONS,
    FEEDBACK_DEDUP_WINDOW,
    INTERACTION_ROWS_SCAN_LIMIT,
    REDUCER_CONFIG_VERSION,
    REJECTED_ACTION,
    REPETITION_WINDOW_SNAPSHOTS,
    BehavioralSignals,
    _compute_reducer_config_version,
    reduce_behavioral_signals,
    reduce_interaction_rows,
    reduce_snapshot_rows,
)
from fitted_core.sampler import RequestContext


def _ts(offset_seconds: int) -> datetime:
    return datetime(2026, 7, 1, tzinfo=timezone.utc) + timedelta(seconds=offset_seconds)


def test_reduce_interaction_rows_maps_actions_and_skips_unbound_or_excluded_rows():
    rows = [
        {
            "snapshotId": "s1",
            "candidateId": "c1",
            "action": "accepted",
            "createdAt": _ts(10),
            "items": ["t1", "b1"],
            "fullSignature": "sig-1",
        },
        {
            "snapshotId": "s2",
            "candidateId": "c2",
            "action": "rejected",
            "createdAt": _ts(9),
            "baseKey": "base-2",
            "perItemFeedback": [
                {"itemId": "t2", "disliked": True},
                {"itemId": "b2", "disliked": False},
            ],
        },
        {
            "snapshotId": "s3",
            "candidateId": "c3",
            "action": "saved",
            "createdAt": _ts(8),
            "items": ["ignored"],
            "fullSignature": "ignored",
        },
        {
            "candidateId": "legacy",
            "action": "accepted",
            "createdAt": _ts(7),
            "items": ["poison"],
            "fullSignature": "poison",
        },
    ]

    signals = reduce_interaction_rows(rows)

    assert signals == BehavioralSignals(
        item_affinity={"t1": 1, "b1": 1},
        liked_full_signatures=frozenset({"sig-1"}),
        shown_full_signatures=(),
        recent_disliked_base_keys=("base-2",),
        recent_disliked_item_ids=("t2",),
    )


def test_accepted_item_affinity_dedups_only_counted_projection_within_window():
    rows = [
        {
            "snapshotId": "s1",
            "candidateId": "c1",
            "action": "accepted",
            "createdAt": _ts(FEEDBACK_DEDUP_WINDOW),
            "items": ["t1"],
            "fullSignature": "sig-latest",
        },
        {
            "snapshotId": "s1",
            "candidateId": "c1",
            "action": "accepted",
            "createdAt": _ts(0),
            "items": ["t1"],
            "fullSignature": "sig-older-duplicate",
        },
        {
            "snapshotId": "s1",
            "candidateId": "c1",
            "action": "accepted",
            "createdAt": _ts(-(FEEDBACK_DEDUP_WINDOW + 1)),
            "items": ["t1"],
            "fullSignature": "sig-outside-window",
        },
    ]

    signals = reduce_interaction_rows(rows)

    assert signals.item_affinity == {"t1": 2}
    assert signals.liked_full_signatures == frozenset(
        {"sig-latest", "sig-older-duplicate", "sig-outside-window"}
    )


def test_reduce_snapshot_rows_keeps_recent_order_dedups_and_truncates_to_ranker_window():
    rows = [
        {"nSurfaced": 2, "shownFullSignatures": ["sig-a", "sig-b"]},
        {"nSurfaced": 1, "shownFullSignatures": ["sig-a", "sig-c"]},
        {"nSurfaced": 0, "shownFullSignatures": ["ignored"]},
        {"nSurfaced": 1, "shownFullSignatures": [f"sig-{i}" for i in range(50)]},
    ]

    shown = reduce_snapshot_rows(rows)

    assert shown[:3] == ("sig-a", "sig-b", "sig-c")
    assert len(shown) == config.REPETITION_WINDOW_SIZE
    assert len(shown) == len(set(shown))
    assert "ignored" not in shown


def test_reduce_behavioral_signals_combines_interactions_and_snapshots():
    signals = reduce_behavioral_signals(
        [
            {
                "snapshotId": "s1",
                "candidateId": "c1",
                "action": "accepted",
                "createdAt": _ts(1),
                "items": ["t1"],
                "fullSignature": "liked",
            }
        ],
        [{"nSurfaced": 1, "shownFullSignatures": ["shown"]}],
    )

    assert signals.item_affinity == {"t1": 1}
    assert signals.liked_full_signatures == frozenset({"liked"})
    assert signals.shown_full_signatures == ("shown",)


def test_affinity_signal_scorer_requires_positive_finite_affinity():
    scorer = AffinitySignalScorer({"zero": 0, "negative": -1, "nan": float("nan")})
    assert scorer.is_available() is False

    scorer = AffinitySignalScorer({"t1": 2, "bad": True})
    item = WardrobeItem("t1", "top", ItemType.top, warmth=5, image_url="t1.jpg")
    other = WardrobeItem("b1", "bottom", ItemType.bottom, warmth=5, image_url="b1.jpg")
    ctx = RequestContext("occasion", "mild", "session", 1, interaction_count=5)

    assert scorer.is_available() is True
    assert scorer.score(item, ctx) == 2
    assert scorer.score(other, ctx) == 0.0


def test_reducer_config_version_moves_independently_from_ranker_config(monkeypatch):
    before = _compute_reducer_config_version()
    ranker_before = config._compute_ranker_config_version()

    import fitted_core.reducers as reducers_mod

    monkeypatch.setattr(reducers_mod, "INTERACTION_ROWS_SCAN_LIMIT", 501)

    assert _compute_reducer_config_version() != before
    assert config._compute_ranker_config_version() == ranker_before


def test_exported_reducer_version_matches_current_digest():
    assert REDUCER_CONFIG_VERSION == _compute_reducer_config_version()


def test_action_mapping_constants_move_reducer_digest(monkeypatch):
    before = _compute_reducer_config_version()
    monkeypatch.setattr(reducers, "COUNTED_ACTIONS", COUNTED_ACTIONS | {"saved"})
    assert _compute_reducer_config_version() != before

    monkeypatch.setattr(reducers, "COUNTED_ACTIONS", COUNTED_ACTIONS)
    monkeypatch.setattr(reducers, "REJECTED_ACTION", "thumbs_down")
    assert _compute_reducer_config_version() != before


def test_reducer_constants_stay_out_of_ranker_config_module():
    assert not hasattr(config, "INTERACTION_ROWS_SCAN_LIMIT")
    assert not hasattr(config, "FEEDBACK_DEDUP_WINDOW")
    assert not hasattr(config, "REPETITION_WINDOW_SNAPSHOTS")
    assert INTERACTION_ROWS_SCAN_LIMIT == 500
    assert FEEDBACK_DEDUP_WINDOW == 300
    assert REPETITION_WINDOW_SNAPSHOTS == 50


def test_interaction_scan_limit_bounds_counted_rows():
    rows = [
        {
            "snapshotId": f"s{i}",
            "candidateId": f"c{i}",
            "action": "accepted",
            "createdAt": _ts(i),
            "items": [f"i{i}"],
            "fullSignature": f"sig-{i}",
        }
        for i in range(INTERACTION_ROWS_SCAN_LIMIT + 1)
    ]

    signals = reduce_interaction_rows(rows)

    assert f"i{INTERACTION_ROWS_SCAN_LIMIT - 1}" in signals.item_affinity
    assert f"i{INTERACTION_ROWS_SCAN_LIMIT}" not in signals.item_affinity


def test_snapshot_scan_limit_bounds_repetition_rows():
    rows = [{"nSurfaced": 0, "shownFullSignatures": [f"ignored-{i}"]} for i in range(49)]
    rows.append({"nSurfaced": 1, "shownFullSignatures": ["last-within-limit"]})
    rows.append({"nSurfaced": 1, "shownFullSignatures": ["past-limit"]})

    shown = reduce_snapshot_rows(rows)

    assert shown == ("last-within-limit",)
    assert "past-limit" not in shown


def test_dedup_counts_middle_event_when_only_adjacent_to_older_duplicate():
    rows = [
        {
            "snapshotId": "s1",
            "candidateId": "c1",
            "action": "accepted",
            "createdAt": _ts(FEEDBACK_DEDUP_WINDOW * 2 + 2),
            "items": ["t1"],
            "fullSignature": "latest",
        },
        {
            "snapshotId": "s1",
            "candidateId": "c1",
            "action": "accepted",
            "createdAt": _ts(FEEDBACK_DEDUP_WINDOW + 1),
            "items": ["t1"],
            "fullSignature": "middle",
        },
        {
            "snapshotId": "s1",
            "candidateId": "c1",
            "action": "accepted",
            "createdAt": _ts(1),
            "items": ["t1"],
            "fullSignature": "older",
        },
    ]

    assert reduce_interaction_rows(rows).item_affinity == {"t1": 2}


def test_missing_created_at_never_counts_affinity_but_keeps_liked_signatures():
    rows = [
        {
            "snapshotId": "s1",
            "candidateId": "c1",
            "action": "accepted",
            "items": ["t1"],
            "fullSignature": "one",
        },
        {
            "snapshotId": "s1",
            "candidateId": "c1",
            "action": "accepted",
            "items": ["t1"],
            "fullSignature": "two",
        },
    ]

    signals = reduce_interaction_rows(rows)
    assert signals.item_affinity == {}
    assert signals.liked_full_signatures == frozenset({"one", "two"})


def test_unparsable_created_at_never_counts_affinity():
    rows = [
        {
            "snapshotId": "s1",
            "candidateId": "c1",
            "action": "accepted",
            "createdAt": "not-a-date",
            "items": ["t1"],
            "fullSignature": "one",
        },
    ]

    signals = reduce_interaction_rows(rows)
    assert signals.item_affinity == {}
    assert signals.liked_full_signatures == frozenset({"one"})


def test_numeric_created_at_is_not_accepted_for_affinity_counting():
    rows = [
        {
            "snapshotId": "s1",
            "candidateId": "c1",
            "action": "accepted",
            "createdAt": 1_800_000_000,
            "items": ["t1"],
            "fullSignature": "one",
        },
        {
            "snapshotId": "s1",
            "candidateId": "c1",
            "action": "accepted",
            "createdAt": 1_800_001_000,
            "items": ["t1"],
            "fullSignature": "two",
        },
    ]

    assert reduce_interaction_rows(rows).item_affinity == {}


def test_excluded_worn_action_contributes_nothing():
    row = {
        "snapshotId": "s1",
        "candidateId": "c1",
        "action": "worn",
        "createdAt": _ts(1),
        "items": ["t1"],
        "fullSignature": "sig",
    }

    signals = reduce_interaction_rows([row])
    assert signals.item_affinity == {}
    assert signals.liked_full_signatures == frozenset()


def test_rejected_caps_cooldown_and_disliked_item_windows():
    rows = [
        {
            "snapshotId": f"s{i}",
            "candidateId": f"c{i}",
            "action": REJECTED_ACTION,
            "createdAt": _ts(i),
            "baseKey": f"base-{i}",
            "perItemFeedback": [{"itemId": f"i{i}", "disliked": True}],
        }
        for i in range(max(config.COOLDOWN_BUFFER_SIZE, config.DISLIKE_WINDOW_SIZE) + 5)
    ]

    signals = reduce_interaction_rows(rows)

    assert len(signals.recent_disliked_base_keys) == config.COOLDOWN_BUFFER_SIZE
    assert len(signals.recent_disliked_item_ids) == config.DISLIKE_WINDOW_SIZE
    assert signals.recent_disliked_base_keys[0] == "base-0"
    assert signals.recent_disliked_item_ids[0] == "i0"
