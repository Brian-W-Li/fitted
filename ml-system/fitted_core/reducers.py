"""M5 C2 feedback reducers and the affinity-backed sampler scorer.

The service owns Mongo queries, auth, projection, and sort order. This module is pure: it
reduces already-projected interaction/snapshot rows into the small deterministic signal
collections consumed by the sampler/ranker substrate.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from itertools import islice
from typing import Any, Iterable, Mapping, Optional, Sequence

from fitted_core import config as core_config
from fitted_core.models import WardrobeItem
from fitted_core.sampler import RequestContext


REPETITION_WINDOW_SNAPSHOTS = 50
INTERACTION_ROWS_SCAN_LIMIT = 500

COUNTED_ACTIONS = frozenset({"accepted"})
REJECTED_ACTION = "rejected"


@dataclass(frozen=True)
class BehavioralSignals:
    """Pre-reduced behavioral state for a render request."""

    item_affinity: Mapping[str, int]
    liked_full_signatures: frozenset[str]
    shown_full_signatures: tuple[str, ...]
    recent_disliked_base_keys: tuple[str, ...]
    recent_disliked_item_ids: tuple[str, ...]


def _canonical_for_digest(obj: object) -> object:
    if isinstance(obj, (frozenset, set)):
        return sorted(obj)
    raise TypeError(f"un-digestible reducer constant of type {type(obj).__name__}")


def _compute_reducer_config_version() -> str:
    excluded = {"REDUCER_CONFIG_VERSION"}
    constants = {
        name: value
        for name, value in globals().items()
        if name.isupper() and not name.startswith("_") and name not in excluded
    }
    payload = json.dumps(constants, sort_keys=True, default=_canonical_for_digest)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


REDUCER_CONFIG_VERSION = _compute_reducer_config_version()


def _truthy_str(value: object) -> Optional[str]:
    if isinstance(value, str) and value.strip():
        return value
    return None


def _as_str_sequence(value: object) -> tuple[str, ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        return ()
    out: list[str] = []
    for item in value:
        text = _truthy_str(item)
        if text is not None:
            out.append(text)
    return tuple(out)


def _is_bound_feedback(row: Mapping[str, Any]) -> bool:
    return _truthy_str(row.get("snapshotId")) is not None and _truthy_str(row.get("candidateId")) is not None


def reduce_interaction_rows(rows: Iterable[Mapping[str, Any]]) -> BehavioralSignals:
    """Reduce most-recent-first bound feedback rows into interaction-derived signals.

    **Per-candidate latest-STATE (§23-H61).** Rows arrive most-recent-first (the caller sorts by
    ``{createdAt:-1, _id:-1}``); for each ``{snapshotId, candidateId}`` only the FIRST row seen —
    its latest action — contributes. Every older row for that candidate (a same-action repeat OR a
    superseded opposite action) is skipped. Consequences:
      - a like later CORRECTED to a dislike on the same candidate nets to the dislike: no lingering
        item affinity, no liked signature — honoring the UI promise ("to change your mind, just
        react again"); the reverse (dislike→like) drops the cooldown symmetrically;
      - a repeated like of one candidate counts ONCE (this subsumes the old 300s double-tap window,
        now retired — ordering alone does the work);
      - a signature whose latest-winning candidate action is ``rejected`` is BLOCKED from
        ``liked_full_signatures`` (a set can't hold both signs; the most recent reaction to that
        shape wins).
    Item affinity stays strictly per-candidate, so a like of one outfit and a dislike of a
    *different* outfit that share an item keep BOTH signals — legitimate cross-candidate taste, not
    a contradiction. Determinism rides the caller's sort; same-``createdAt`` ties resolve on ``_id``.
    """
    item_affinity: dict[str, int] = {}
    signature_action: dict[str, str] = {}  # first-seen (= latest) winning action per signature
    recent_disliked_base_keys: list[str] = []
    recent_disliked_item_ids: list[str] = []
    seen_base_keys: set[str] = set()
    seen_disliked_item_ids: set[str] = set()
    seen_candidates: set[tuple[str, str]] = set()

    for row in islice(rows, INTERACTION_ROWS_SCAN_LIMIT):
        if not _is_bound_feedback(row):
            continue
        snapshot_id = _truthy_str(row.get("snapshotId"))
        candidate_id = _truthy_str(row.get("candidateId"))
        action = _truthy_str(row.get("action"))
        assert snapshot_id is not None and candidate_id is not None
        if action is None:
            continue
        # Only meaningful feedback participates in latest-state. A neutral action (e.g. a future
        # `saved`/`worn`, ignored at M5) must NOT occupy a candidate/signature slot — otherwise a
        # neutral newest row would wrongly supersede an older standing like/dislike. Membership-gated
        # so a later promotion of an action into COUNTED_ACTIONS/REJECTED_ACTION includes it here too.
        if action not in COUNTED_ACTIONS and action != REJECTED_ACTION:
            continue

        candidate_key = (snapshot_id, candidate_id)
        if candidate_key in seen_candidates:
            continue  # a superseded older row — this candidate's latest action already counted
        seen_candidates.add(candidate_key)

        signature = _truthy_str(row.get("fullSignature"))
        if signature is not None and signature not in signature_action:
            signature_action[signature] = action  # first-seen == latest reaction to this shape

        if action in COUNTED_ACTIONS:
            for item_id in _as_str_sequence(row.get("items")):
                item_affinity[item_id] = item_affinity.get(item_id, 0) + 1
            continue

        if action == REJECTED_ACTION:
            base_key = _truthy_str(row.get("baseKey"))
            if (
                base_key is not None
                and base_key not in seen_base_keys
                and len(recent_disliked_base_keys) < core_config.COOLDOWN_BUFFER_SIZE
            ):
                seen_base_keys.add(base_key)
                recent_disliked_base_keys.append(base_key)

            feedback = row.get("perItemFeedback")
            if isinstance(feedback, Sequence) and not isinstance(feedback, (str, bytes, bytearray)):
                for entry in feedback:
                    if not isinstance(entry, Mapping) or entry.get("disliked") is not True:
                        continue
                    item_id = _truthy_str(entry.get("itemId"))
                    if (
                        item_id is not None
                        and item_id not in seen_disliked_item_ids
                        and len(recent_disliked_item_ids) < core_config.DISLIKE_WINDOW_SIZE
                    ):
                        seen_disliked_item_ids.add(item_id)
                        recent_disliked_item_ids.append(item_id)

    liked_full_signatures = frozenset(
        sig for sig, act in signature_action.items() if act in COUNTED_ACTIONS
    )
    return BehavioralSignals(
        item_affinity=item_affinity,
        liked_full_signatures=liked_full_signatures,
        shown_full_signatures=(),
        recent_disliked_base_keys=tuple(recent_disliked_base_keys),
        recent_disliked_item_ids=tuple(recent_disliked_item_ids),
    )


def reduce_snapshot_rows(rows: Iterable[Mapping[str, Any]]) -> tuple[str, ...]:
    """Reduce most-recent-first snapshot rows into the repetition window."""
    shown: list[str] = []
    seen: set[str] = set()
    for row in islice(rows, REPETITION_WINDOW_SNAPSHOTS):
        n_surfaced = row.get("nSurfaced")
        if isinstance(n_surfaced, bool) or not isinstance(n_surfaced, int) or n_surfaced <= 0:
            continue
        for signature in _as_str_sequence(row.get("shownFullSignatures")):
            if signature in seen:
                continue
            seen.add(signature)
            shown.append(signature)
            if len(shown) >= core_config.REPETITION_WINDOW_SIZE:
                return tuple(shown)
    return tuple(shown)


def reduce_behavioral_signals(
    interaction_rows: Iterable[Mapping[str, Any]],
    snapshot_rows: Iterable[Mapping[str, Any]],
) -> BehavioralSignals:
    """Reduce interaction and snapshot projections into one signal bundle."""
    interaction = reduce_interaction_rows(interaction_rows)
    return BehavioralSignals(
        item_affinity=interaction.item_affinity,
        liked_full_signatures=interaction.liked_full_signatures,
        shown_full_signatures=reduce_snapshot_rows(snapshot_rows),
        recent_disliked_base_keys=interaction.recent_disliked_base_keys,
        recent_disliked_item_ids=interaction.recent_disliked_item_ids,
    )


class AffinitySignalScorer:
    """Sampler scorer backed by positive finite item affinity."""

    def __init__(self, item_affinity: Mapping[str, int | float]) -> None:
        clean: dict[str, float] = {}
        for item_id, value in item_affinity.items():
            if not isinstance(item_id, str) or not item_id:
                continue
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                continue
            score = float(value)
            if math.isfinite(score) and score > 0:
                clean[item_id] = score
        self._affinity = clean

    def is_available(self) -> bool:
        return bool(self._affinity)

    def score(self, item: WardrobeItem, context: RequestContext) -> float:
        return self._affinity.get(item.id, 0.0)
