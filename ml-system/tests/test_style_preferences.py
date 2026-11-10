"""Mechanism/lifecycle evidence only; authored binary labels are not human benefit."""
from copy import deepcopy
import random
import time

import numpy as np
import pytest

from fitted_core import preferences as policy
from fitted_core.preference_features import (
    CHANNELS, COLORS, FEATURE_VERSION, SCHEMA_DIGEST, capture_items, common_groups,
    encode, normalize, supported_channels,
)


CONTEXT = {"ownerId": "owner", "profileId": "campus", "profileVersion": 1,
           "routineId": "classes", "routineVersion": 1, "weather": "unspecified"}


def outfit(ident, top_fit="slim", bottom_fit="slim", *, prefix=None):
    prefix = prefix or ident
    return {"id": ident, "items": [
        {"id": f"{prefix}-top", "role": "top", "subtype": "shirt", "colors": ["white"],
         "pattern": "solid", "fit": top_fit},
        {"id": f"{prefix}-bottom", "role": "bottom", "subtype": "pants", "colors": ["blue"],
         "pattern": "solid", "fit": bottom_fit},
        {"id": f"{prefix}-shoe", "role": "shoes", "subtype": "sneakers", "colors": ["gray"]},
    ]}


def observation(candidate, n, *, action="accepted", **extra):
    return {"id": f"vote-{n:04}", "snapshotId": f"snapshot-{n}", "candidateId": candidate["id"],
            "createdAt": f"2026-11-09T{n//3600:02}:{n//60%60:02}:{n%60:02}.000Z",
            "action": action, "context": dict(CONTEXT), "learningEnabled": True,
            "learningDisposition": "normal", "items": deepcopy(candidate["items"]), **extra}


def relationship_data():
    # Repeated relation, entirely disjoint garment identities. Marginal fit and
    # item counts are balanced; only the predefined fit interaction explains XOR.
    rows = []
    n = 0
    for repeat in range(3):
        for tf in ("slim", "relaxed"):
            for bf in ("slim", "relaxed"):
                n += 1
                rows.append(observation(outfit(f"train-{n}", tf, bf), n,
                                        action="accepted" if tf != bf else "rejected"))
    candidates = [outfit("query-ss", "slim", "slim"), outfit("query-rr", "relaxed", "relaxed"),
                  outfit("query-sr", "slim", "relaxed"), outfit("query-rs", "relaxed", "slim")]
    return rows, candidates


def evaluate(rows=None, candidates=None, **kwargs):
    default_rows, default_candidates = relationship_data()
    return policy.evaluate_preferences(default_rows if rows is None else rows,
                                       default_candidates if candidates is None else candidates,
                                       kwargs.pop("context", CONTEXT), enabled=kwargs.pop("enabled", True), **kwargs)


def solve_controls(rows, candidates, *, interaction):
    """Same facts/labels/regularization, with only the declared feature ablation."""
    training = [capture_items(row["items"]) for row in rows]
    pool = [capture_items(candidate["items"]) for candidate in candidates]
    groups, _ = common_groups(training+pool)
    vectors = [encode(row, groups) for row in training]
    queries = [encode(row, groups) for row in pool]
    labels = [float(row["action"] == "accepted") for row in rows]
    active = supported_channels(training, vectors, labels, groups)
    if not interaction:
        active = tuple(name for name in active if not name.startswith(("top_bottom.", "top_mid.")))
    matrix = [[1., *(row.get(name, 0.) for name in active)] for row in vectors]
    weights, _, _ = policy._fit(matrix, labels, np, policy._Budget())
    return [sum(weight*row.get(name, 0.) for name, weight in zip(active, weights[1:])) for row in queries]


def test_authored_interaction_transfers_to_disjoint_garments_with_actual_selection_opportunity():
    rows, candidates = relationship_data()
    result = evaluate(rows, candidates)
    assert result.status == "fitted_experimental", result
    assert result.support == 12 and result.likes == result.dislikes == 6
    assert result.feature_version == FEATURE_VERSION
    assert result.schema_digest == SCHEMA_DIGEST and len(result.evidence_digest) == 64
    assert result.gradient_norm <= policy.GRADIENT_TOLERANCE
    assert set(result.deltas) == {row["id"] for row in candidates}
    assert result.deltas["query-sr"] > result.deltas["query-ss"]
    assert result.deltas["query-rs"] > result.deltas["query-rr"]
    assert all(abs(delta) <= .5 for delta in result.deltas.values())
    old_ids = {item["id"] for row in rows for item in row["items"]}
    assert old_ids.isdisjoint(item["id"] for candidate in candidates for item in candidate["items"])
    # Four alternatives competing for three slots; baseline stable order has one
    # liked relation outside the display, and the model makes room for it.
    baseline = [row["id"] for row in candidates[:3]]
    ranked = sorted(candidates, key=lambda row: -result.deltas[row["id"]])[:3]
    assert {row["id"] for row in ranked} != set(baseline)


def test_attribute_item_and_fixed_shuffled_controls_do_not_explain_xor():
    rows, candidates = relationship_data()
    unary = solve_controls(rows, candidates, interaction=False)
    full = solve_controls(rows, candidates, interaction=True)
    assert max(unary)-min(unary) < 1e-12
    assert full[2] > full[0] and full[3] > full[1]
    # Exact item-memory has no support on unseen garment identities.
    liked = {item["id"] for row in rows if row["action"] == "accepted" for item in row["items"]}
    assert [sum(item["id"] in liked for item in row["items"]) for row in candidates] == [0]*4
    shuffled = deepcopy(rows)
    labels = [row["action"] for row in shuffled]
    random.Random(11).shuffle(labels)  # one fixed seed, never best/worst search
    for row, label in zip(shuffled, labels):
        row["action"] = label
    control = solve_controls(shuffled, candidates, interaction=True)
    # This authored shuffle does not preserve both intended positive contrasts.
    assert not (control[2] > control[0] and control[3] > control[1])


def test_schema_normalization_sets_and_known_absence():
    assert len(CHANNELS) <= 512 and len({c.name for c in CHANNELS}) == len(CHANNELS)
    assert normalize(" Light-Grey ") == "light_gray"
    assert normalize("Tshirts") == "tshirts"  # no unlisted stemming
    candidate = outfit("a")
    candidate["items"][0]["colors"] = ["white", "off white", "white", "light gray"]
    facts = capture_items(candidate["items"])
    groups, _ = common_groups([facts])
    values = encode(facts, groups)
    assert facts["top"]["color"] == ("light_gray", "off_white", "white")
    assert values["top.color:white"] == values["top.color:off_white"] == values["top.color:light_gray"] == 1/3
    assert "mid.present" not in values


def test_optional_unknown_is_removed_request_wide_from_training_and_candidates():
    rows, candidates = relationship_data()
    candidates[0]["items"][0]["fit"] = None
    result = evaluate(rows, candidates)
    assert "top.fit" in result.removed_groups
    assert not any(".fit:" in name and name.startswith(("top.", "top_bottom.", "top_mid.")) for name in result.active_channels)
    assert set(result.deltas.values()) == {0.0}
    assert result.reason == "no_learned_contrast"


@pytest.mark.parametrize("mutation,reason", [
    (lambda c: c["items"][0].update(colors=[]), "unknown_required_features"),
    (lambda c: c["items"][0].update(colors=["white", "unknown"]), "unknown_required_features"),
    (lambda c: c["items"][0].update(subtype="sneakers"), "unknown_required_features"),
    (lambda c: c["items"][0].update(role="dress"), "unsupported_composition"),
])
def test_required_unknown_and_dress_abstain_entire_request(mutation, reason):
    rows, candidates = relationship_data()
    mutation(candidates[0])
    result = evaluate(rows, candidates)
    assert result.reason == reason
    assert set(result.deltas.values()) == {0.0}


def test_unknown_training_facts_also_abstain_and_ids_names_are_not_predictors():
    rows, candidates = relationship_data()
    original = evaluate(rows, candidates)
    renamed = deepcopy(rows)
    for row in renamed:
        for item in row["items"]:
            item.update(id="different-"+item["id"], name="Not a measured formality or fit fact", notes="Ignore this")
    assert evaluate(renamed, candidates).deltas == original.deltas
    rows[0]["items"][0]["colors"] = ["unknown"]
    assert evaluate(rows, candidates).reason == "unknown_required_features"


def test_latest_exception_across_snapshots_precedes_composition_eligibility():
    rows, candidates = relationship_data()
    later = deepcopy(rows[0])
    later.update(id="later-exception", snapshotId="later-snapshot", createdAt="2026-11-09T01:00:00Z",
                 learningDisposition="exception")
    resolved, _, cutoff = policy.resolve_observations(rows+[later], CONTEXT)
    assert len(resolved) == 11 and rows[0]["id"] not in {row["id"] for row in resolved}
    assert cutoff == later["createdAt"]
    # A later opted-out request likewise cannot resurrect the older normal vote.
    later.update(learningDisposition="normal", learningEnabled=False)
    assert len(policy.resolve_observations(rows+[later], CONTEXT)[0]) == 11


def test_disposition_amendments_apply_without_renewing_vote_and_do_not_revive_on_clear():
    rows, _ = relationship_data()
    amendments = [{"id": "disposition-1", "eventKind": "learning_disposition", "reactionId": rows[0]["id"],
                   "dispositionRevision": 1, "learningDisposition": "exception"},
                  {"id": "clear-reason", "eventKind": "reason_amendment", "reactionId": rows[0]["id"]}]
    resolved, digest, cutoff = policy.resolve_observations(rows+amendments, CONTEXT)
    assert len(resolved) == 11 and cutoff == rows[-1]["createdAt"]
    amendments.append({**amendments[0], "id": "disposition-2", "dispositionRevision": 2, "learningDisposition": "normal"})
    restored, changed_digest, same_cutoff = policy.resolve_observations(rows+amendments, CONTEXT)
    assert len(restored) == 12 and digest != changed_digest and cutoff == same_cutoff


def test_flip_removal_duplicate_retries_and_source_visibility_recompute():
    rows, candidates = relationship_data()
    repeated = rows+[deepcopy(rows[0])]
    assert evaluate(rows, candidates).deltas == evaluate(repeated, candidates).deltas
    flip = deepcopy(rows[0])
    flip.update(id="flip", createdAt="2026-11-09T01:00:00Z", action="accepted")
    resolved, _, _ = policy.resolve_observations(rows+[flip], CONTEXT)
    assert len(resolved) == 12 and rows[0]["id"] not in {row["id"] for row in resolved}
    assert evaluate(rows[1:], candidates).support == 11
    rows[0]["visible"] = False
    assert evaluate(rows, candidates).support == 11


@pytest.mark.parametrize("change", [
    {"ownerId": "other"}, {"profileId": "formal"}, {"profileVersion": 2},
    {"routineId": "interview"}, {"routineVersion": 2}, {"weather": "mild"},
])
def test_owner_intention_version_routine_and_weather_isolation(change):
    result = evaluate(context={**CONTEXT, **change})
    assert result.reason == "insufficient_evidence" and result.support == 0
    assert set(result.deltas.values()) == {0.0}


def test_no_silent_optin_legacy_enrollment_and_cheap_disabled_numpy_not_loaded(monkeypatch):
    def forbidden():
        raise AssertionError("NumPy must remain lazy")
    monkeypatch.setattr(policy, "_load_numpy", forbidden)
    assert evaluate(enabled=False).reason == "disabled"
    assert evaluate(rows=[]).reason == "insufficient_evidence"
    assert evaluate(context=None).reason == "unsupported_context"
    rows, candidates = relationship_data()
    for row in rows:
        row["learningEnabled"] = False
    assert evaluate(rows, candidates).support == 0


def test_under_support_single_class_and_single_garment_cannot_unlock():
    rows, candidates = relationship_data()
    assert evaluate(rows[:5], candidates).reason == "insufficient_evidence"
    for row in rows:
        row["action"] = "accepted"
    assert evaluate(rows, candidates).reason == "insufficient_evidence"
    rows, candidates = relationship_data()
    for row in rows:
        row["items"][0]["id"] = "the-only-top"
        row["items"][1]["id"] = "the-only-bottom"
    # Shoes retain distinct compositions, but cannot establish top/bottom trait support.
    assert evaluate(rows, candidates).reason == "unsupported_candidate_contrast"


def test_partition_complete_ledger_then_cap_and_amendment_age():
    rows = []
    for n in range(1, 211):
        rows.append(observation(outfit(f"scope-{n}"), n, action="accepted" if n%2 else "rejected"))
    for n in range(211, 800):
        rows.append(observation(outfit(f"other-{n}"), n, context={**CONTEXT, "profileId": "other"}))
    resolved, _, _ = policy.resolve_observations(rows, CONTEXT)
    assert len(resolved) == 200
    assert resolved[0]["id"] == "vote-0210" and resolved[-1]["id"] == "vote-0011"
    assert policy.evaluate_preferences(rows*3, relationship_data()[1], CONTEXT, enabled=True).reason == "ledger_bound_exceeded"


def test_missing_runtime_failed_solve_nonconvergence_and_deadline_are_zero(monkeypatch):
    def missing():
        raise ImportError("optional NumPy missing")
    monkeypatch.setattr(policy, "_load_numpy", missing)
    assert evaluate().reason == "numerical_runtime_missing"
    monkeypatch.setattr(policy, "_load_numpy", lambda: np)
    with monkeypatch.context() as local:
        def fail(*args):
            raise np.linalg.LinAlgError("failed solve")
        local.setattr(np.linalg, "solve", fail)
        result = evaluate()
        assert result.reason == "solver_failure" and set(result.deltas.values()) == {0.0}
    with monkeypatch.context() as local:
        local.setattr(policy, "MAX_ITERATIONS", 0)
        assert evaluate().reason == "non_convergence"
    ticks = iter([0., .2, .3, .4, .5, .6])
    timed = evaluate(cpu_clock=lambda: next(ticks), wall_clock=lambda: 0.)
    assert timed.reason == "learner_timeout" and set(timed.deltas.values()) == {0.0}


def test_malformed_optional_inputs_and_active_channel_bound_fail_closed(monkeypatch):
    assert policy.evaluate_preferences([], [None], CONTEXT, enabled=True).reason == "invalid_candidates"
    assert policy.evaluate_preferences([], [{"id": []}], CONTEXT, enabled=True).reason == "invalid_candidates"
    assert evaluate(rows=[{"id": "bad", "snapshotId": "s", "candidateId": "c", "createdAt": "not a date"}]).reason == "invalid_vote_time"
    monkeypatch.setattr(policy, "MAX_ACTIVE_CHANNELS", 1)
    result = evaluate()
    assert result.reason == "active_channel_bound_exceeded" and set(result.deltas.values()) == {0.0}


def test_maximum_solver_shape_runtime_rehearsal():
    # Deterministic maximum matrix dimensions, independent of any personal labels.
    # Also verifies the agreed solver/budget is feasible on this local runtime.
    rng = np.random.default_rng(20261109)
    matrix = rng.integers(0, 2, size=(200, 129)).astype(float)
    matrix[:, 0] = 1.
    labels = (matrix[:, 1] + matrix[:, 2] - matrix[:, 3] > 1).astype(float)
    budget = policy._Budget()
    weights, iterations, norm = policy._fit(matrix, labels, np, budget)
    cpu, wall = budget.elapsed()
    assert len(weights) == 129 and iterations <= 25 and norm <= 1e-6
    assert cpu <= .100 and wall <= .250
