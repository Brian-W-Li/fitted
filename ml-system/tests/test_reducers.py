import json
import os
from datetime import datetime, timedelta, timezone

from fitted_core import config, reducers
from fitted_core.models import ItemType, WardrobeItem
from fitted_core.reducers import (
    AffinitySignalScorer,
    COUNTED_ACTIONS,
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


def test_repeated_like_of_one_candidate_counts_once_latest_state():
    """§23-H61: per-candidate latest-state. Three accepts of the SAME candidate (any time gap —
    the retired 300s window no longer matters) contribute ONE affinity increment and only the
    latest (first-seen) row's signature."""
    rows = [
        {
            "snapshotId": "s1",
            "candidateId": "c1",
            "action": "accepted",
            "createdAt": _ts(300),
            "items": ["t1"],
            "fullSignature": "sig-latest",
        },
        {
            "snapshotId": "s1",
            "candidateId": "c1",
            "action": "accepted",
            "createdAt": _ts(0),
            "items": ["t1"],
            "fullSignature": "sig-older",
        },
        {
            "snapshotId": "s1",
            "candidateId": "c1",
            "action": "accepted",
            "createdAt": _ts(-9_999),
            "items": ["t1"],
            "fullSignature": "sig-oldest",
        },
    ]

    signals = reduce_interaction_rows(rows)

    assert signals.item_affinity == {"t1": 1}
    assert signals.liked_full_signatures == frozenset({"sig-latest"})


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


def test_action_signal_mapping_is_the_decided_M5_scope():
    """The §H action→signal mapping, pinned by literal value (not just digest-moves-on-change).

    Only the two explicit verdicts count today: `accepted` → +affinity, `rejected` → −signal.
    The other OutfitInteraction enum actions (generated/saved/worn/rated/planned/packed/corrected)
    deliberately contribute NOTHING at M5 — promoting `saved`/`worn` to counted is an anticipated
    later change that MUST move REDUCER_CONFIG_VERSION (see test below). A dev who believes an
    action should count trips this test and reads the decision before forking corpus semantics."""
    assert COUNTED_ACTIONS == frozenset({"accepted"})
    assert REJECTED_ACTION == "rejected"


def test_action_mapping_constants_move_reducer_digest(monkeypatch):
    before = _compute_reducer_config_version()
    monkeypatch.setattr(reducers, "COUNTED_ACTIONS", COUNTED_ACTIONS | {"saved"})
    assert _compute_reducer_config_version() != before

    monkeypatch.setattr(reducers, "COUNTED_ACTIONS", COUNTED_ACTIONS)
    monkeypatch.setattr(reducers, "REJECTED_ACTION", "thumbs_down")
    assert _compute_reducer_config_version() != before


def test_reducer_constants_stay_out_of_ranker_config_module():
    assert not hasattr(config, "INTERACTION_ROWS_SCAN_LIMIT")
    assert not hasattr(config, "REPETITION_WINDOW_SNAPSHOTS")
    assert INTERACTION_ROWS_SCAN_LIMIT == 500
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


def _bound(snapshot, candidate, action, **extra):
    """A bound feedback row. Rows are passed most-recent-first (the caller's sort); this helper
    keeps the H61 latest-state tests readable — position 0 is the newest event."""
    return {"snapshotId": snapshot, "candidateId": candidate, "action": action, **extra}


def test_like_then_dislike_same_candidate_nets_to_dislike():
    """§23-H61: a like CORRECTED to a dislike on the same candidate leaves NO lingering affinity
    or liked signature; the dislike's cooldown/dislike-window signal stands alone."""
    rows = [
        _bound("s1", "c1", "rejected", baseKey="base-1", fullSignature="sig-1",
               perItemFeedback=[{"itemId": "t1", "disliked": True}]),          # newest = the correction
        _bound("s1", "c1", "accepted", items=["t1", "b1"], fullSignature="sig-1"),  # older = the retracted like
    ]

    signals = reduce_interaction_rows(rows)

    assert signals.item_affinity == {}
    assert signals.liked_full_signatures == frozenset()
    assert signals.recent_disliked_base_keys == ("base-1",)
    assert signals.recent_disliked_item_ids == ("t1",)


def test_dislike_then_like_same_candidate_nets_to_like_and_drops_cooldown():
    """§23-H61: the reverse correction — a dislike changed to a like — drops the cooldown and
    restores affinity + the liked signature (the direction the old reducer also got wrong)."""
    rows = [
        _bound("s1", "c1", "accepted", items=["t1"], fullSignature="sig-1"),   # newest = the like
        _bound("s1", "c1", "rejected", baseKey="base-1", fullSignature="sig-1",
               perItemFeedback=[{"itemId": "t1", "disliked": True}]),          # older = the retracted dislike
    ]

    signals = reduce_interaction_rows(rows)

    assert signals.item_affinity == {"t1": 1}
    assert signals.liked_full_signatures == frozenset({"sig-1"})
    assert signals.recent_disliked_base_keys == ()
    assert signals.recent_disliked_item_ids == ()


def test_waffle_honors_only_the_latest_reaction():
    """§23-H61: like → dislike → like (newest first: like, dislike, like) resolves to the latest
    action (like)."""
    rows = [
        _bound("s1", "c1", "accepted", items=["t1"], fullSignature="sig-1"),   # newest
        _bound("s1", "c1", "rejected", baseKey="base-1", fullSignature="sig-1",
               perItemFeedback=[{"itemId": "t1", "disliked": True}]),
        _bound("s1", "c1", "accepted", items=["t1"], fullSignature="sig-1"),   # oldest
    ]

    signals = reduce_interaction_rows(rows)

    assert signals.item_affinity == {"t1": 1}
    assert signals.liked_full_signatures == frozenset({"sig-1"})
    assert signals.recent_disliked_base_keys == ()


def test_cross_candidate_shared_item_keeps_both_signals():
    """§23-H61: retraction is scoped to {snapshotId, candidateId}. A like of outfit A and a
    dislike of a DIFFERENT outfit B that share item t1 are NOT a contradiction — the item keeps
    its affinity AND enters the dislike window."""
    rows = [
        _bound("s2", "cB", "rejected", baseKey="base-B",
               perItemFeedback=[{"itemId": "t1", "disliked": True}]),          # dislike of B
        _bound("s1", "cA", "accepted", items=["t1", "b1"], fullSignature="sig-A"),  # like of A
    ]

    signals = reduce_interaction_rows(rows)

    assert signals.item_affinity == {"t1": 1, "b1": 1}
    assert signals.liked_full_signatures == frozenset({"sig-A"})
    assert signals.recent_disliked_item_ids == ("t1",)


def test_signature_blocked_when_latest_reaction_to_that_shape_is_reject():
    """§23-H61: `liked_full_signatures` is a set (one sign per shape). When two DIFFERENT
    candidates share a signature and the most-recent reaction to it is a reject, the signature is
    blocked from the liked set — even though the older like still boosts its own items."""
    rows = [
        _bound("s2", "cB", "rejected", baseKey="base-B", fullSignature="shared-sig"),  # newest for shared-sig
        _bound("s1", "cA", "accepted", items=["t1"], fullSignature="shared-sig"),      # older like, same shape
    ]

    signals = reduce_interaction_rows(rows)

    assert "shared-sig" not in signals.liked_full_signatures
    assert signals.item_affinity == {"t1": 1}  # cA's like still boosts its item (per-candidate)


def test_latest_state_honors_caller_order_not_content():
    """§23-H61: the reducer trusts the caller's most-recent-first sort — the FIRST row per
    candidate wins regardless of any createdAt field (determinism rides mlBehavioralRows'
    {createdAt:-1,_id:-1} projection, not a re-sort here)."""
    older_wins_if_resorted = [
        _bound("s1", "c1", "rejected", baseKey="b", createdAt="2999-01-01T00:00:00Z"),  # newest by position
        _bound("s1", "c1", "accepted", items=["t1"], createdAt="1999-01-01T00:00:00Z"),
    ]

    signals = reduce_interaction_rows(older_wins_if_resorted)

    # Position 0 (reject) wins because it is first — the misleading createdAt values are ignored.
    assert signals.item_affinity == {}
    assert signals.recent_disliked_base_keys == ("b",)


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


# --- messy-row guard branches (Lane H hardening) -----------------------------------------
# The wire parser treats behavioralRows rows as OPAQUE dicts, so every shape below can reach
# the reducers from the live wire. Each guard existed but was untested — a mutant deleting it
# passed the whole suite while silently corrupting signals.


def test_non_dict_per_item_feedback_entries_are_skipped_not_crashed():
    rows = [
        {
            "snapshotId": "s1",
            "candidateId": "c1",
            "action": "rejected",
            "createdAt": _ts(10),
            "baseKey": "base-1",
            "perItemFeedback": ["not-a-dict", 42, None, {"itemId": "keep", "disliked": True}],
        },
        {
            "snapshotId": "s2",
            "candidateId": "c2",
            "action": "rejected",
            "createdAt": _ts(9),
            "baseKey": "base-2",
            "perItemFeedback": "a-scalar-not-a-list",  # str is Sequence — must NOT iterate chars
        },
    ]

    signals = reduce_interaction_rows(rows)

    assert signals.recent_disliked_item_ids == ("keep",)
    assert signals.recent_disliked_base_keys == ("base-1", "base-2")


def test_non_int_n_surfaced_rows_are_skipped():
    def row(n_surfaced):
        return {"nSurfaced": n_surfaced, "shownFullSignatures": ["poison"]}

    for bad in (True, 2.5, "3", None, [3]):
        assert reduce_snapshot_rows([row(bad)]) == (), bad
    assert reduce_snapshot_rows([row(1)]) == ("poison",)


def test_bound_row_with_missing_or_blank_action_is_skipped_and_does_not_occupy_the_slot():
    rows = [
        # Newest row for c1: bound but action missing — must NOT supersede the older like.
        {"snapshotId": "s1", "candidateId": "c1", "createdAt": _ts(10), "items": ["x"]},
        {"snapshotId": "s1", "candidateId": "c1", "action": "   ", "createdAt": _ts(9), "items": ["x"]},
        {
            "snapshotId": "s1",
            "candidateId": "c1",
            "action": "accepted",
            "createdAt": _ts(8),
            "items": ["t1"],
            "fullSignature": "sig-1",
        },
    ]

    signals = reduce_interaction_rows(rows)

    assert signals.item_affinity == {"t1": 1}
    assert signals.liked_full_signatures == frozenset({"sig-1"})


def test_non_string_entries_in_items_and_signatures_are_dropped():
    rows = [
        {
            "snapshotId": "s1",
            "candidateId": "c1",
            "action": "accepted",
            "createdAt": _ts(10),
            "items": [1, None, "", "  ", "t1", ["nested"]],
            "fullSignature": "sig-1",
        },
        {
            # items as a scalar string — must NOT count each character as an item id.
            "snapshotId": "s2",
            "candidateId": "c2",
            "action": "accepted",
            "createdAt": _ts(9),
            "items": "abc",
        },
    ]

    signals = reduce_interaction_rows(rows)
    assert signals.item_affinity == {"t1": 1}

    shown = reduce_snapshot_rows(
        [{"nSurfaced": 2, "shownFullSignatures": [7, None, "sig-a", ""]}]
    )
    assert shown == ("sig-a",)


def test_non_string_snapshot_or_candidate_id_is_unbound():
    rows = [
        {"snapshotId": 123, "candidateId": "c1", "action": "accepted", "createdAt": _ts(10), "items": ["poison"]},
        {"snapshotId": "s1", "candidateId": 5, "action": "accepted", "createdAt": _ts(9), "items": ["poison"]},
    ]
    assert reduce_interaction_rows(rows).item_affinity == {}


def test_affinity_scorer_drops_non_string_and_empty_keys():
    scorer = AffinitySignalScorer({"good": 2, "": 5, 7: 3, None: 4})  # type: ignore[dict-item]
    item = WardrobeItem(
        id="good", name="n", type=ItemType.top, warmth=5, image_url="",
        style_tags=[], color_tags=[], occasion_tags=[],
    )
    context = RequestContext(occasion="casual", weather="mild", session_id="s", wardrobe_version=1)
    assert scorer.is_available() is True
    assert scorer.score(item, context) == 2.0


def test_reducing_the_same_rows_twice_is_deterministic():
    rows = [
        {
            "snapshotId": f"s{i}",
            "candidateId": f"c{i}",
            "action": "accepted" if i % 2 else "rejected",
            "createdAt": _ts(100 - i),
            "items": [f"i{i}", "shared"],
            "fullSignature": f"sig-{i}",
            "baseKey": f"base-{i}",
            "perItemFeedback": [{"itemId": f"d{i}", "disliked": True}],
        }
        for i in range(20)
    ]
    snapshots = [{"nSurfaced": 1, "shownFullSignatures": [f"shown-{i}"]} for i in range(10)]

    first = reduce_behavioral_signals(rows, snapshots)
    second = reduce_behavioral_signals([dict(r) for r in rows], list(snapshots))

    assert first == second
    assert tuple(first.item_affinity.items()) == tuple(second.item_affinity.items())


def _load_shared_latest_state_fixture():
    """The SHARED cross-runtime fixture (§23-H61) — the same file the jest pin reads. It lives in the
    Next app tree; the monorepo relative path IS the single-source (one artifact, three consumers)."""
    here = os.path.dirname(__file__)  # ml-system/tests
    path = os.path.normpath(
        os.path.join(here, "..", "..", "fitted", "tests", "fixtures", "latestFeedbackState.fixture.json")
    )
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def test_latest_state_matches_shared_cross_runtime_fixture():
    """Cross-runtime pin (§23-H61): the reducer's latest-state over the SHARED fixture must agree with
    the TS History helper + the CJS export picker (`fitted/tests/latestFeedbackState.test.ts`). If the
    createdAt-then-_id winner rule drifts in any of the three homes, this reddens — stopping the corpus
    label from disagreeing with what the friend saw in History and what the engine acts on."""
    fixture = _load_shared_latest_state_fixture()

    def _created_ms(value: object) -> int:
        # Mirror the JS pickers' `new Date(x ?? 0).getTime()` (NaN→0) rather than a raw STRING compare:
        # a future fixture row with a different ISO format/offset (e.g. `...20Z` vs `...20.000Z`, or a
        # `-04:00` offset) must sort by the SAME instant the JS homes use, or the "one rule, three homes"
        # pin silently dissolves while every suite stays green.
        if not isinstance(value, str) or not value:
            return 0
        try:
            return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            return 0

    # `buildBehavioralRows` sorts {createdAt:-1, _id:-1} before the reducer sees the rows; replicate that
    # sort here (createdAt by parsed instant; _id hex lexicographically) so the reducer's first-seen rule
    # sees the same order the live Mongo query delivers.
    rows = sorted(
        fixture["rows"],
        key=lambda r: (_created_ms(r.get("createdAt")), str(r.get("_id") or "")),
        reverse=True,
    )
    signals = reduce_interaction_rows(rows)
    want = fixture["pythonExpected"]
    assert signals.item_affinity == want["itemAffinity"]
    assert signals.liked_full_signatures == frozenset(want["likedFullSignatures"])
    assert signals.recent_disliked_base_keys == tuple(want["recentDislikedBaseKeys"])
