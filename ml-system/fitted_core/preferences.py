"""Bounded, request-time binary preferences for one explicitly opted-in context.

This is an experimental selector contribution, not calibrated taste confidence.
The caller authenticates ownership, joins visible immutable shown facts, and
checks its memory revision at admission. This pure kernel never calls providers,
reads Mongo, writes parameters, or imports the frozen experimental learners.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import importlib
import json
import math
import time
from typing import Mapping

from fitted_core.preference_features import (
    FEATURE_VERSION, SCHEMA_DIGEST, FeatureError, capture_items, common_groups,
    encode, supported_channels,
)

MODEL_VERSION = "app-binary-ridge-logistic.v1"
POLICY_VERSION = "app-preference-policy.v1"
MAX_LEDGER_ROWS = 2000
MAX_COMPOSITIONS = 200
MAX_CANDIDATES = 256
MAX_ACTIVE_CHANNELS = 128
MIN_SUPPORT = 6
MIN_PER_CLASS = 2
REGULARIZATION = 4.0
MAX_ITERATIONS = 25
MAX_BACKTRACK_HALVINGS = 12
GRADIENT_TOLERANCE = 1e-6
ARMIJO = 1e-4
CPU_BUDGET_SECONDS = .100
WALL_BUDGET_SECONDS = .250
MAX_DELTA = .5
_CONTEXT_KEYS = ("ownerId", "profileId", "profileVersion", "routineId", "routineVersion", "weather")
_DISPOSITIONS = ("normal", "exception", "do_not_learn")


class PreferenceError(ValueError):
    pass


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _digest(value):
    return hashlib.sha256(_canonical(value).encode()).hexdigest()


def _context_key(raw):
    if not isinstance(raw, Mapping):
        return None
    if any(not isinstance(raw.get(key), str) or not raw[key] or len(raw[key]) > 256
           for key in ("ownerId", "profileId", "routineId")):
        return None
    if any(type(raw.get(key)) is not int or raw[key] <= 0 for key in ("profileVersion", "routineVersion")):
        return None
    if raw.get("weather") not in ("cold", "mild", "hot", "unspecified"):
        return None
    return tuple(raw[key] for key in _CONTEXT_KEYS)


def _time_key(row):
    value = row.get("createdAt")
    if not isinstance(value, str) or len(value) > 64:
        raise PreferenceError("invalid_vote_time")
    try:
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            raise ValueError("timezone required")
        return timestamp.astimezone(timezone.utc), row["id"]
    except (ValueError, OverflowError) as exc:
        raise PreferenceError("invalid_vote_time") from exc


def resolve_observations(observations, context):
    """All states -> latest candidate/disposition -> partition -> composition -> eligibility -> cap.

    A later exception/opted-out presentation of a composition suppresses its older
    normal label across snapshots. Disposition edits never refresh the vote time.
    Unknown/legacy contexts are never enrolled by the current context selection.
    """
    target = _context_key(context)
    if target is None:
        raise PreferenceError("unsupported_context")
    if not isinstance(observations, (list, tuple)) or len(observations) > MAX_LEDGER_ROWS:
        raise PreferenceError("ledger_bound_exceeded")
    votes, amendments, seen_ids = {}, [], {}
    for raw in observations:
        if not isinstance(raw, Mapping):
            raise PreferenceError("invalid_observation")
        ident = raw.get("id")
        if not isinstance(ident, str) or not ident or len(ident) > 256:
            raise PreferenceError("invalid_observation_id")
        fingerprint = _canonical(raw)
        if ident in seen_ids:
            if seen_ids[ident] != fingerprint:
                raise PreferenceError("conflicting_observation_id")
            continue
        seen_ids[ident] = fingerprint
        kind = raw.get("eventKind", "reaction")
        if kind == "learning_disposition":
            amendments.append(raw)
            continue
        if kind == "reason_amendment":
            continue
        if kind != "reaction":
            raise PreferenceError("unsupported_event_kind")
        if any(not isinstance(raw.get(key), str) or not raw[key] for key in ("snapshotId", "candidateId")):
            # Unbound historical reactions are not personal-learning evidence.
            continue
        _time_key(raw)
        votes[ident] = dict(raw)
    disposition_states = {}
    for amendment in amendments:
        parent = votes.get(amendment.get("reactionId"))
        if parent is None:
            continue
        revision, disposition = amendment.get("dispositionRevision"), amendment.get("learningDisposition")
        if type(revision) is not int or revision <= 0 or disposition not in _DISPOSITIONS:
            raise PreferenceError("invalid_disposition_amendment")
        previous = disposition_states.get(parent["id"])
        if previous and revision == previous[0] and disposition != previous[1]:
            raise PreferenceError("conflicting_disposition_revision")
        if previous is None or revision > previous[0]:
            disposition_states[parent["id"]] = (revision, disposition)
    latest = {}
    for vote in votes.values():
        if vote["id"] in disposition_states:
            vote["learningDisposition"] = disposition_states[vote["id"]][1]
        # Candidate identity includes owner; the caller's complete owner ledger
        # cannot let an unrelated owner's accidental duplicate ID shadow it.
        scope = _context_key(vote.get("context"))
        owner = scope[0] if scope else None
        key = (owner, vote["snapshotId"], vote["candidateId"])
        if key not in latest or _time_key(vote) > _time_key(latest[key]):
            latest[key] = vote
    composition_states = {}
    scoped = [vote for vote in latest.values() if _context_key(vote.get("context")) == target]
    for vote in scoped:
        raw_items = vote.get("items")
        if not isinstance(raw_items, (list, tuple)) or not 2 <= len(raw_items) <= 5:
            raise PreferenceError("invalid_captured_composition")
        ids = [item.get("id") if isinstance(item, Mapping) else None for item in raw_items]
        if any(not isinstance(ident, str) or not ident for ident in ids) or len(set(ids)) != len(ids):
            raise PreferenceError("invalid_captured_composition")
        key = tuple(sorted(ids))
        if key not in composition_states or _time_key(vote) > _time_key(composition_states[key]):
            composition_states[key] = vote
    states = sorted(composition_states.values(), key=_time_key, reverse=True)
    eligible = [vote for vote in states if vote.get("action") in ("accepted", "rejected")
                and vote.get("learningEnabled") is True
                and vote.get("learningDisposition", "normal") == "normal"
                and vote.get("visible", True) is True][:MAX_COMPOSITIONS]
    # Include suppressed/exception states in provenance so their removal cannot
    # masquerade as an unchanged fit input. Do not copy free-form reasons.
    provenance = [{key: vote.get(key) for key in (
        "id", "snapshotId", "candidateId", "createdAt", "action", "context",
        "learningEnabled", "learningDisposition", "visible", "items")}
        for vote in states]
    cutoff = max((vote["createdAt"] for vote in states), key=lambda value: datetime.fromisoformat(value.replace("Z", "+00:00")), default=None)
    return eligible, _digest([FEATURE_VERSION, SCHEMA_DIGEST, provenance]), cutoff


@dataclass(frozen=True)
class PreferenceResult:
    deltas: dict[str, float]
    status: str
    reason: str
    support: int = 0
    likes: int = 0
    dislikes: int = 0
    feature_version: str = FEATURE_VERSION
    model_version: str = MODEL_VERSION
    policy_version: str = POLICY_VERSION
    schema_digest: str = SCHEMA_DIGEST
    evidence_digest: str | None = None
    evidence_cutoff: str | None = None
    active_channels: tuple[str, ...] = ()
    removed_groups: tuple[str, ...] = ()
    coefficients: tuple[float, ...] = ()
    iterations: int = 0
    gradient_norm: float | None = None
    cpu_seconds: float = 0.0
    wall_seconds: float = 0.0


@dataclass
class _Budget:
    cpu_clock: object = time.process_time
    wall_clock: object = time.monotonic
    cpu_start: float = field(init=False)
    wall_start: float = field(init=False)

    def __post_init__(self):
        self.cpu_start, self.wall_start = self.cpu_clock(), self.wall_clock()

    def elapsed(self):
        return max(0.0, self.cpu_clock()-self.cpu_start), max(0.0, self.wall_clock()-self.wall_start)

    def check(self):
        cpu, wall = self.elapsed()
        if cpu > CPU_BUDGET_SECONDS or wall > WALL_BUDGET_SECONDS:
            raise PreferenceError("learner_timeout")


def _load_numpy():
    return importlib.import_module("numpy")


def _fit(matrix, labels, np, budget):
    """Zero-start damped Newton; at most 25 updates and 12 step halvings."""
    x, y = np.asarray(matrix, dtype=float), np.asarray(labels, dtype=float)
    if x.ndim != 2 or y.shape != (x.shape[0],) or not 0 < x.shape[0] <= MAX_COMPOSITIONS or not 0 < x.shape[1] <= MAX_ACTIVE_CHANNELS + 1:
        raise PreferenceError("invalid_solver_shape")
    if not np.isfinite(x).all() or not np.isfinite(y).all():
        raise PreferenceError("nonfinite_fit")
    w = np.zeros(x.shape[1], dtype=float)
    identity = np.eye(x.shape[1], dtype=float)

    def objective(weights):
        value = float(np.logaddexp(0.0, x @ weights).sum() - y @ (x @ weights)
                      + REGULARIZATION/2 * (weights @ weights))
        if not math.isfinite(value):
            raise PreferenceError("nonfinite_fit")
        return value

    for iteration in range(MAX_ITERATIONS + 1):
        budget.check()
        z = x @ w
        p = .5 * (1.0 + np.tanh(z / 2))
        gradient = x.T @ (p-y) + REGULARIZATION*w
        norm = float(np.max(np.abs(gradient)))
        if not math.isfinite(norm):
            raise PreferenceError("nonfinite_fit")
        if norm <= GRADIENT_TOLERANCE:
            budget.check()
            return tuple(float(value) for value in w), iteration, norm
        if iteration == MAX_ITERATIONS:
            break
        hessian = (x.T * (p*(1-p))) @ x + REGULARIZATION*identity
        try:
            step = np.linalg.solve(hessian, gradient)
        except (ValueError, ArithmeticError, np.linalg.LinAlgError) as exc:
            raise PreferenceError("solver_failure") from exc
        if not np.isfinite(step).all():
            raise PreferenceError("nonfinite_fit")
        slope, before = float(gradient @ step), objective(w)
        if not math.isfinite(slope) or slope <= 0:
            raise PreferenceError("solver_failure")
        for halving in range(MAX_BACKTRACK_HALVINGS + 1):
            budget.check()
            scale = 2.0 ** -halving
            candidate = w-scale*step
            if objective(candidate) <= before-ARMIJO*scale*slope:
                w = candidate
                break
        else:
            raise PreferenceError("line_search_failed")
    raise PreferenceError("non_convergence")


def evaluate_preferences(observations, candidates, context, *, enabled=False,
                         cpu_clock=time.process_time, wall_clock=time.monotonic):
    """Return zero deltas on every abstention; all candidate deltas share one fit.

    candidates: {id, items:[{id,role,subtype,colors,pattern?,fit?,clothingType?}]}.
    observations: immutable reaction rows with the same items plus id, snapshotId,
    candidateId, ISO createdAt, action, context, learningEnabled and disposition.
    Optional learning_disposition amendment rows resolve by reactionId/revision.
    context: ownerId, profileId/profileVersion, routineId/routineVersion, weather.
    None/disabled legacy paths are cheap and do not import NumPy.
    """
    ids = [candidate.get("id") if isinstance(candidate, Mapping) else None for candidate in candidates] if isinstance(candidates, (list, tuple)) else []
    valid_ids = all(isinstance(ident, str) and bool(ident) and len(ident) <= 512 for ident in ids) and len(set(ids)) == len(ids)
    zeros = {ident: 0.0 for ident in ids} if valid_ids else {}
    if enabled is not True:
        return PreferenceResult(zeros, "abstained", "disabled")
    budget = _Budget(cpu_clock, wall_clock)
    metadata = {}

    def fallback(reason):
        cpu, wall = budget.elapsed()
        return PreferenceResult(zeros, "abstained", reason, cpu_seconds=cpu, wall_seconds=wall, **metadata)

    try:
        if not valid_ids or not ids or len(ids) > MAX_CANDIDATES:
            raise PreferenceError("invalid_candidates")
        if _context_key(context) is None:
            raise PreferenceError("unsupported_context")
        rows, digest, cutoff = resolve_observations(observations, context)
        labels = [int(row["action"] == "accepted") for row in rows]
        metadata.update(support=len(rows), likes=sum(labels), dislikes=len(rows)-sum(labels),
                        evidence_digest=digest, evidence_cutoff=cutoff)
        budget.check()
        if len(rows) < MIN_SUPPORT or min(sum(labels), len(rows)-sum(labels)) < MIN_PER_CLASS:
            return fallback("insufficient_evidence")
        training = [capture_items(row["items"]) for row in rows]
        pool = [capture_items(candidate.get("items")) for candidate in candidates]
        groups, removed = common_groups(training+pool)
        metadata["removed_groups"] = removed
        vectors = [encode(row, groups) for row in training]
        queries = [encode(candidate, groups) for candidate in pool]
        active = supported_channels(training, vectors, labels, groups)
        metadata["active_channels"] = active
        if len(active) > MAX_ACTIVE_CHANNELS:
            return fallback("active_channel_bound_exceeded")
        if not active or not any(len({query.get(name, 0.0) for query in queries}) > 1 for name in active):
            return fallback("unsupported_candidate_contrast")
        budget.check()
        try:
            np = _load_numpy()
        except (ImportError, OSError):
            return fallback("numerical_runtime_missing")
        budget.check()
        matrix = [[1.0, *(vector.get(name, 0.0) for name in active)] for vector in vectors]
        weights, iterations, norm = _fit(matrix, labels, np, budget)
        # The fitted intercept calibrates the binary target; it is excluded from
        # the bounded ranking contribution. Unknown groups never enter either side.
        deltas = {ident: MAX_DELTA*math.tanh(sum(weight*query.get(name, 0.0)
                    for name, weight in zip(active, weights[1:]))) for ident, query in zip(ids, queries)}
        if any(not math.isfinite(delta) or abs(delta) > MAX_DELTA for delta in deltas.values()):
            raise PreferenceError("nonfinite_decision")
        budget.check()
        if max(deltas.values()) - min(deltas.values()) <= 1e-12:
            return fallback("no_learned_contrast")
        cpu, wall = budget.elapsed()
        return PreferenceResult(deltas, "fitted_experimental", "supported", coefficients=weights,
                                iterations=iterations, gradient_norm=norm, cpu_seconds=cpu,
                                wall_seconds=wall, **metadata)
    except (PreferenceError, FeatureError) as exc:
        return fallback(str(exc))
    except (ValueError, TypeError, KeyError, OverflowError, ArithmeticError) as exc:
        # Malformed optional learning inputs cannot break the complete baseline.
        return fallback("invalid_preference_input")
