"""C6 — snapshot payload + Option-B trace siblings (plan §14 C6).

Covers: the three discard sites captured by the trace siblings + rescue_with_trace; the public
rescue() path staying byte-stable; deterministic/permutation-stable candidateId; the §8.2-F
content-preservation invariant; diagnostics population; and builder-drift (the snapshot is an
immutable copy — a later item edit cannot alter an already-built itemSnapshot).
"""

import json

import pytest

from fitted_core.models import ItemType, Role, WardrobeItem
from fitted_core.rescue import RescueRequest, rescue, rescue_with_trace
from fitted_core.response import build_variants
from fitted_core.snapshot import (
    CandidatePayload,
    GenerationSnapshotPayload,
    build_snapshot_payload,
)
from fitted_core.validator import validate_gpt_payload, validate_gpt_payload_with_trace
from tests.helpers import StubGenerator


# --- local fixture builders (mirror test_rescue's §12 output shape) ----------


def _item(item_id: str, item_type: ItemType) -> WardrobeItem:
    return WardrobeItem(
        item_id, f"{item_id} name", item_type, warmth=5, image_url=f"{item_id}.jpg",
        style_tags=["solid"], color_tags=["navy"], occasion_tags=["casual"],
    )


def _vp(item_id: str, role: Role) -> dict:
    return {"itemId": item_id, "role": role.value}


def _outfit(items: list[tuple[str, Role]], changed: list[str], *, style_move: bool = True) -> dict:
    outfit: dict = {"items": [_vp(i, r) for i, r in items]}
    if style_move:
        outfit["styleMove"] = {"moveType": "layer", "changedItemIds": list(changed), "oneSentence": "An idea."}
    return outfit


def _envelope(*outfits: dict) -> str:
    return json.dumps({"outfits": list(outfits)})


def _rich_request() -> RescueRequest:
    """A forced-top rescue whose closet supports several distinct candidates."""
    wardrobe = [_item("t1", ItemType.top)]
    wardrobe += [_item(f"b{i}", ItemType.bottom) for i in range(1, 5)]
    wardrobe.append(_item("s1", ItemType.shoes))
    return RescueRequest(
        wardrobe=wardrobe,
        forced_item_id="t1",
        occasion="weekend brunch",
        weather="mild",
        session_id="sess-c6",
        wardrobe_version=2,
        n_surfaced=3,
    )


def _rich_envelope() -> str:
    """Six outfits exercising every disposition: 4 accepted (one scored-but-unshown after the
    3-cell spread), 1 accepted-then-rescue-dropped (no styleMove), 1 validation-rejected (ghost id)."""
    return _envelope(
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]),
        _outfit([("t1", Role.base_top), ("b2", Role.base_bottom)], ["t1"]),
        _outfit([("t1", Role.base_top), ("b3", Role.base_bottom), ("s1", Role.shoes)], ["s1"]),
        _outfit([("t1", Role.base_top), ("b4", Role.base_bottom)], ["t1"]),
        _outfit([("t1", Role.base_top), ("b3", Role.base_bottom)], ["t1"], style_move=False),
        _outfit([("t1", Role.base_top), ("ghost", Role.base_bottom)], ["t1"]),
    )


def _payload(request=None, envelope=None) -> GenerationSnapshotPayload:
    request = request or _rich_request()
    trace = rescue_with_trace(request, StubGenerator(envelope or _rich_envelope()))
    return build_snapshot_payload(
        trace, request, candidate_cache_key="ck-c6", request_id="11111111-1111-4111-8111-111111111111",
        generator_provider="openai", generator_model="gpt-4o", generator_temperature=0.8,
        generator_max_completion_tokens=2200,
    )


# --- trace siblings ----------------------------------------------------------


def test_validate_with_trace_preserves_rejected_outfit_content():
    request = _rich_request()
    payload = json.loads(_rich_envelope())
    pool = request.wardrobe  # superset of the scoped pool is fine for this content test
    trace = validate_gpt_payload_with_trace(payload, pool)
    # the closed result is unchanged...
    assert trace.result == validate_gpt_payload(payload, pool)
    # ...and the FULL parsed outfits survive (the Issue log alone would lose rejected content).
    assert len(trace.parsed_outfits) == 6
    assert trace.parsed_outfits[5]["items"][1]["itemId"] == "ghost"


def test_build_variants_with_trace_keeps_non_selected_variants():
    trace = rescue_with_trace(_rich_request(), StubGenerator(_rich_envelope()))
    ranked = trace.rank_audit.result
    selected, _ = build_variants(ranked, {i.id: i for i in _rich_request().wardrobe}, _rich_request(), 3)
    bt = trace.build_trace
    assert len(bt.selected) == len(selected)
    # 4 ranked survivors, only 3 surfaced → at least one assembled-but-non-selected variant.
    assert len(bt.all_variants) >= len(bt.selected)
    assert len(bt.all_variants) == len(ranked.outfits)


def test_rescue_with_trace_result_is_byte_stable_vs_rescue():
    request = _rich_request()
    traced = rescue_with_trace(request, StubGenerator(_rich_envelope())).result
    plain = rescue(request, StubGenerator(_rich_envelope()))
    assert traced == plain  # the public rescue() contract is untouched (frozen-dataclass equality)


# --- the funnel covers every discard site ------------------------------------


def test_funnel_captures_all_dispositions():
    payload = _payload()
    by_id = {c.candidate_id: c for c in payload.candidates}
    assert len(by_id) == 6  # one candidate per generated outfit

    rejected = [c for c in payload.candidates if c.rejection_codes]
    rescue_dropped = [c for c in payload.candidates if c.drop_stage == "rescue"]
    shown = [c for c in payload.candidates if c.shown]
    scored_unshown = [c for c in payload.candidates if c.score_trace is not None and not c.shown]

    assert rejected, "a validation-rejected candidate must be captured (H29(b))"
    assert all(c.raw_emitted is not None for c in rejected)  # content preserved (§8.2-F)
    assert rescue_dropped and rescue_dropped[0].drop_reason == "rescue_stylemove_invalid"
    assert len(shown) == 3  # n_surfaced
    assert scored_unshown, "a scored-but-unshown / non-selected variant must be captured (H29(a))"
    # the scored-but-unshown candidate kept its continuous scores
    assert scored_unshown[0].score_trace.ranker_score is not None


def test_shown_arrays_match_the_surfaced_set():
    payload = _payload()
    shown = sorted([c for c in payload.candidates if c.shown], key=lambda c: c.shown_position)
    assert payload.n_surfaced == 3
    assert payload.shown_candidate_ids == tuple(c.candidate_id for c in shown)
    assert len(payload.shown_full_signatures) == 3


# --- candidateId: deterministic + permutation-stable -------------------------


def test_candidate_ids_unique_and_deterministic():
    a = _payload()
    b = _payload()
    ids = [c.candidate_id for c in a.candidates]
    assert len(ids) == len(set(ids))  # unique within the snapshot
    assert ids == [c.candidate_id for c in b.candidates]  # deterministic across runs
    assert ids == [f"c{i}" for i in range(6)]  # a pure function of source_index (funnel order)


def test_candidate_id_tracks_source_index_under_permutation():
    # Reorder the GPT outfits: the candidate at a given position keeps that position's id, so the
    # SAME outfit content moves to a different candidateId (id = funnel order, not content).
    env_default = _rich_envelope()
    outfits = json.loads(env_default)["outfits"]
    permuted = _envelope(outfits[5], *outfits[:5])  # move the rejected outfit to the front
    p = _payload(envelope=permuted)
    c0 = next(c for c in p.candidates if c.candidate_id == "c0")
    assert c0.rejection_codes  # the rejected ghost outfit is now at source_index 0


# --- content-preservation invariant ------------------------------------------


def test_content_preservation_rejects_a_bare_candidate():
    with pytest.raises(ValueError, match="content-preservation"):
        CandidatePayload(
            candidate_id="c9", source_attempt_id="a0", source_index=9,
            stage_reached="generated", accepted=False, shown=False,
            rejection_codes=("invalidItems",),  # no items/slot_map, no raw_emitted
        )


def test_content_preservation_allows_raw_emitted_only():
    c = CandidatePayload(
        candidate_id="c9", source_attempt_id="a0", source_index=9,
        stage_reached="generated", accepted=False, shown=False, raw_emitted={"items": []},
    )
    assert c.raw_emitted == {"items": []}


# --- diagnostics -------------------------------------------------------------


def test_diagnostics_populated_from_results():
    d = _payload().diagnostics
    # the sampler reports a TypeSampleResult for every type (R11), not only the present ones.
    assert set(d.sampler_per_type) == {"top", "bottom", "dress", "outer_layer", "shoes"}
    # ...projected to JSON-safe scalars (no embedded WardrobeItem list / SelectionKind enum).
    top = d.sampler_per_type["top"]
    assert isinstance(top["selection_kind"], str) and isinstance(top["item_count"], int)
    assert "items" not in top
    assert d.rejection_histogram  # the ghost outfit contributes a rejection
    # parse nests to match the C5 `parse` sub-schema (a flat shape would be dropped on write).
    assert d.parse == {"parse_success": True, "repair_used": False, "generator_calls": 1}
    # the k-relative ranker flags are carried through (insufficient_wardrobe = len < k, k=10)
    assert d.ranker["insufficient_wardrobe"] is True and "fallback_stage" in d.ranker
    assert d.rescue["not_enough_items"] is False


def test_real_payload_crosses_the_c4_serde():
    # The whole point of the snapshot is to reach Mongo via the C4 wire layer — the produced
    # payload MUST survive to_wire()→JSON→from_wire() (a vars(TypeSampleResult) dump did not).
    import dataclasses

    from fitted_core import snapshot_serde

    payload = _payload()
    wire = snapshot_serde.to_wire(dataclasses.asdict(payload))  # must not raise
    json.dumps(wire)  # finite floats, no non-serializable objects
    # parse nests + cases to the C5 schema shape; the data-Map key survives verbatim.
    assert set(wire["diagnostics"]["parse"]) == {"parseSuccess", "repairUsed", "generatorCalls"}
    assert "outer_layer" in wire["diagnostics"]["samplerPerType"]  # ItemType key not mangled
    # full inverse round-trip (json-normalized so tuple↔list is not spurious).
    normalized = json.loads(json.dumps(dataclasses.asdict(payload)))
    assert snapshot_serde.from_wire(json.loads(json.dumps(wire))) == normalized


# --- builder drift -----------------------------------------------------------


def test_engine_visible_is_an_immutable_copy_of_the_projection():
    request = _rich_request()
    forced = request.wardrobe[0]
    payload = _payload(request=request)
    snap = next(s for s in payload.item_snapshots if s.item_id == forced.id)
    assert snap.engine_visible["type"] == "top"  # ItemType value (serde → clothingType)
    assert snap.engine_visible["warmth"] == forced.warmth

    # Mutating the live item AFTER the payload is built must not alter the captured snapshot.
    forced.style_tags.append("mutated")
    forced.name = "renamed"
    assert "mutated" not in snap.engine_visible["style_tags"]
    assert snap.engine_visible["name"] == "t1 name"


def _overflow_request() -> RescueRequest:
    # 2 bottoms → the rescue candidate bound floors at 6 (n_bottoms*3=6); 3 shoe options let us
    # emit 8 distinct forced-top outfits, so 2 exceed the bound and are sliced with a warning.
    return RescueRequest(
        wardrobe=[
            _item("t1", ItemType.top), _item("b1", ItemType.bottom), _item("b2", ItemType.bottom),
            _item("s1", ItemType.shoes), _item("s2", ItemType.shoes), _item("s3", ItemType.shoes),
        ],
        forced_item_id="t1", occasion="x", weather="mild", session_id="s", wardrobe_version=1,
    )


def _overflow_envelope() -> str:
    outfits = [
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]),
        _outfit([("t1", Role.base_top), ("b2", Role.base_bottom)], ["t1"]),
    ]
    for b in ("b1", "b2"):
        for s in ("s1", "s2", "s3"):
            outfits.append(_outfit([("t1", Role.base_top), (b, Role.base_bottom), (s, Role.shoes)], [s]))
    return _envelope(*outfits)  # 8 distinct outfits


def test_attempt_level_aggregate_warning_is_on_the_attempt_not_a_candidate():
    # 8 distinct outfits > the rescue bound (6) → an aggregate extraCandidatesIgnored warning
    # (candidate_index=None) that belongs to the producing attempt, never a fake candidate (§8.2-E).
    payload = _payload(request=_overflow_request(), envelope=_overflow_envelope())
    attempt = payload.generation_attempts[-1]
    assert "extraCandidatesIgnored" in attempt.aggregate_warning_codes
    assert all("extraCandidatesIgnored" not in c.warning_codes for c in payload.candidates)


def test_attempt_level_repair_retry_captured():
    request = _rich_request()
    # invalid JSON → the single §12 repair → valid: two attempts, the 2nd flagged is_repair.
    stub = StubGenerator(["{ not valid json", _rich_envelope()])
    trace = rescue_with_trace(request, stub)
    payload = build_snapshot_payload(
        trace, request, candidate_cache_key="ck-repair", request_id="11111111-1111-4111-8111-111111111112",
        generator_provider="openai", generator_model="gpt", generator_temperature=0.8,
        generator_max_completion_tokens=2200,
    )
    assert len(payload.generation_attempts) == 2
    assert payload.generation_attempts[0].is_repair is False
    assert payload.generation_attempts[0].parse_issue is not None  # the invalidJson that triggered repair
    assert payload.generation_attempts[1].is_repair is True
    assert payload.generation_attempts[1].payload_parsed is True
    assert payload.diagnostics.parse == {"parse_success": True, "repair_used": True, "generator_calls": 2}


def test_attempt_level_root_rejection_captured_with_zero_candidates():
    request = _rich_request()
    bad_root = json.dumps({"outfits": "not a list"})  # parses, but the root envelope is malformed
    trace = rescue_with_trace(request, StubGenerator(bad_root))
    payload = build_snapshot_payload(
        trace, request, candidate_cache_key="ck-root", request_id="11111111-1111-4111-8111-111111111113",
        generator_provider="openai", generator_model="gpt", generator_temperature=0.8,
        generator_max_completion_tokens=2200,
    )
    assert payload.generation_attempts[-1].root_rejection_code is not None  # a root reject...
    assert payload.candidates == ()  # ...yields zero candidates, never a fabricated one


def test_rank_with_audit_captures_ranker_filtered_candidates():
    # The ranker-filtered disposition (drop_stage="ranker") is unreachable via cold-start rescue
    # (empty locks/dislikes), so exercise the rank_with_audit sibling directly: a contextually
    # disliked candidate is hard-filtered before scoring (no breakdown), with its drop reason.
    from fitted_core.ranker import rank_with_audit
    from tests.test_ranker import _candidate, _ctx

    survivor = _candidate(source_index=0, top="t1", bottom="b1")
    disliked = _candidate(source_index=1, top="t1", bottom="bX")
    audit = rank_with_audit([survivor, disliked], _ctx(contextual_disliked_item_ids=frozenset({"bX"})))

    scored_indexes = {o.source_index for o in audit.scored}
    assert 0 in scored_indexes and 1 not in scored_indexes
    assert {f.candidate.source_index: f.drop_reason for f in audit.filtered} == {
        1: "ranker_contextual_disliked"
    }
    # determinism: the truncated top-k prefix equals the public rank() result, byte-for-byte.
    assert audit.scored[: len(audit.result.outfits)] == audit.result.outfits


def test_not_enough_items_exit_builds_a_degenerate_payload():
    # A forced item with no possible pairing → pre-GPT not_enough_items; the snapshot is still valid.
    request = RescueRequest(
        wardrobe=[_item("t1", ItemType.top)],  # a top with no bottom → no 2-piece possible
        forced_item_id="t1", occasion="x", weather="mild", session_id="s", wardrobe_version=1,
    )
    payload = _payload(request=request, envelope=_envelope())
    assert payload.diagnostics.not_enough_items is True
    assert payload.candidates == ()
    # No prompt was built, but the valid no-spend empty render still preserves the engine-visible
    # wardrobe (forced item included) so the failure is self-explaining. candidateRequested is the
    # honest "no ask" 0 — never None.
    assert [i.item_id for i in payload.item_snapshots] == ["t1"]
    assert payload.diagnostics.candidate_requested == 0
    assert payload.diagnostics.prompt_item_count == 1
    assert payload.generation_attempts == ()


# --- M5 C3: §G.1 echo-through + generator provenance + the §D degenerate builder ------


def _c3_payload(**overrides):
    request = _rich_request()
    trace = rescue_with_trace(request, StubGenerator(_rich_envelope()))
    kwargs = dict(
        candidate_cache_key="ck-c3",
        request_id="31111111-1111-4111-8111-111111111111",
        generator_provider="openai",
        generator_model="gpt-5.4-mini",
        generator_temperature=0.5,
        generator_max_completion_tokens=2200,
    )
    kwargs.update(overrides)
    return build_snapshot_payload(trace, request, **kwargs)


def test_payload_carries_the_g1_echo_through_identity_set():
    payload = _c3_payload(
        parent_snapshot_id="66b1f0000000000000000abc",
        weather_raw="72F sunny",
        location="Santa Barbara, CA",
    )
    assert payload.request_id == "31111111-1111-4111-8111-111111111111"
    assert payload.parent_snapshot_id == "66b1f0000000000000000abc"
    assert payload.weather_raw == "72F sunny"
    assert payload.location == "Santa Barbara, CA"
    assert payload.constraints == {}  # the M5 invariant — always {}


def test_echo_through_defaults_are_root_render_shaped():
    payload = _c3_payload()
    assert payload.parent_snapshot_id is None
    assert payload.weather_raw is None
    assert payload.location is None
    assert payload.constraints == {}


def test_generator_block_carries_the_a6_provenance():
    payload = _c3_payload()
    assert payload.generator == {
        "provider": "openai",
        "model": "gpt-5.4-mini",
        "temperature": 0.5,
        "prompt_version": payload.generator["prompt_version"],
        "max_completion_tokens": 2200,
        "api_surface": "chat_completions",
        "response_format": "json_schema_strict",
        "reasoning_effort": "none",
        "store_mode": "none",
        "prompt_cache_retention": "in_memory",
        "timeout_seconds": 30.0,
        "max_retries": 0,
    }
    assert "finish_status" not in payload.generator  # a clean run leaves it unset (§G)


def test_generator_finish_status_recorded_when_supplied():
    payload = _c3_payload(
        generator_finish_status={"finish_reason": "length", "refused": False}
    )
    assert payload.generator["finish_status"] == {"finish_reason": "length", "refused": False}


def test_attempt_finish_status_maps_from_the_trace():
    from fitted_core.generation import FinishStatus
    from fitted_core.rescue import GenerationAttemptTrace
    from fitted_core.snapshot import _finish_status_dict

    assert _finish_status_dict(None) is None
    assert _finish_status_dict(FinishStatus(finish_reason="length", refusal=None)) == {
        "finish_reason": "length",
        "refusal": None,
    }
    # Stub attempts carry finish_status=None → the payload attempt records None.
    payload = _c3_payload()
    assert all(a.finish_status is None for a in payload.generation_attempts)
    # The mapped GenerationAttemptTrace shape is what _build_attempts consumes.
    assert GenerationAttemptTrace("raw", False, None, True).finish_status is None


def test_abnormal_finish_status_reads_the_producing_attempt():
    from fitted_core.generation import FinishStatus
    from fitted_core.snapshot import abnormal_finish_status

    class _StatusStub:
        """A stub generator exposing per-call finish statuses like OpenAIGenerator."""

        def __init__(self, response: str, statuses):
            self._response = response
            self._statuses = list(statuses)
            self.last_finish_status = None

        def generate(self, prompt):
            self.last_finish_status = self._statuses.pop(0)
            return self._response

    request = _rich_request()
    # Clean run: finish_reason == "stop" → no abnormal status.
    trace = rescue_with_trace(
        request, _StatusStub(_rich_envelope(), [FinishStatus("stop", None)])
    )
    assert abnormal_finish_status(trace) is None
    # Cap-truncated garbage: both attempts return unparseable text, last is "length".
    trace = rescue_with_trace(
        request,
        _StatusStub("{ truncated", [FinishStatus("length", None), FinishStatus("length", None)]),
    )
    assert abnormal_finish_status(trace) == {"finish_reason": "length", "refused": False}
    # Refusal: content empty, refusal text present.
    trace = rescue_with_trace(
        request, _StatusStub("", [FinishStatus("stop", "I can't help with that."),
                                  FinishStatus("stop", "I can't help with that.")])
    )
    assert abnormal_finish_status(trace) == {"finish_reason": "stop", "refused": True}
    # F2: an UNRECOGNIZED non-stop finish_reason (not length/refusal) is still abnormal —
    # abnormal_finish_status is general (finish_reason not in (None,"stop")), pinning it here
    # so a regression narrowing to a {length,refusal} allowlist can't slip the §A.6-6 guard.
    filtered_trace = rescue_with_trace(
        request,
        _StatusStub("{ blocked", [FinishStatus("content_filter", None),
                                  FinishStatus("content_filter", None)]),
    )
    assert abnormal_finish_status(filtered_trace) == {
        "finish_reason": "content_filter", "refused": False
    }
    # Attempt-level provenance also lands on the payload (§A.6 routing half).
    payload = build_snapshot_payload(
        trace, request,
        candidate_cache_key="ck-refusal",
        request_id="31111111-1111-4111-8111-111111111114",
        generator_provider="openai", generator_model="gpt-5.4-mini",
        generator_temperature=0.5, generator_max_completion_tokens=2200,
        generator_finish_status=abnormal_finish_status(trace),
    )
    assert payload.generation_attempts[0].finish_status == {
        "finish_reason": "stop",
        "refusal": "I can't help with that.",
    }
    assert payload.generator["finish_status"] == {"finish_reason": "stop", "refused": True}


def test_engine_failure_closed_sets_and_catalogue_message():
    from fitted_core.snapshot import ENGINE_FAILURE_MESSAGE_MAX_CHARS, EngineFailure

    failure = EngineFailure(stage="pre_generation", code="internal_exception")
    record = failure.to_payload_dict()
    assert record["stage"] == "pre_generation"
    assert record["code"] == "internal_exception"
    assert record["message_truncated"] is False
    assert len(record["message"]) <= ENGINE_FAILURE_MESSAGE_MAX_CHARS
    # G13: the catalogue message never interpolates runtime values (no hex runs, no traceback).
    assert "Traceback" not in record["message"]
    with pytest.raises(ValueError, match="stage"):
        EngineFailure(stage="nonsense", code="unknown")
    with pytest.raises(ValueError, match="code"):
        EngineFailure(stage="unknown", code="nonsense")
    with pytest.raises(ValueError, match="detail keys"):
        EngineFailure(stage="unknown", code="unknown", detail={"message": "no"})
    detailed = EngineFailure(
        stage="validate", code="empty_valid_set", detail={"count": 0}
    ).to_payload_dict()
    assert detailed["detail"] == {"count": 0}


def test_build_degenerate_payload_is_schema_valid_and_carries_identity():
    import dataclasses

    from fitted_core import snapshot_serde
    from fitted_core.snapshot import EngineFailure, build_degenerate_payload

    request = _rich_request()
    payload = build_degenerate_payload(
        request,
        EngineFailure(stage="pre_generation", code="internal_exception"),
        candidate_cache_key="ck-degenerate",
        request_id="31111111-1111-4111-8111-111111111115",
        generator_provider="openai",
        generator_model="gpt-5.4-mini",
        generator_temperature=0.5,
        generator_max_completion_tokens=2200,
        weather_raw="72F sunny",
        location="Santa Barbara, CA",
    )
    # §D: never fabricate an attempt; the failure lives in diagnostics.engine_failure.
    assert payload.generation_attempts == ()
    assert payload.candidates == ()
    assert payload.n_surfaced == 0
    assert payload.diagnostics.engine_failure is not None
    assert payload.diagnostics.engine_failure["stage"] == "pre_generation"
    # The §G.1 identity set rides the degenerate write (the §C.4 index depends on request_id).
    assert payload.request_id == "31111111-1111-4111-8111-111111111115"
    assert payload.session_id == request.session_id
    assert payload.weather_raw == "72F sunny"
    assert payload.constraints == {}
    # Provenance never depends on generation: versions + generator config all present.
    assert payload.fitted_core_version and payload.ranker_config_version
    assert payload.generator["max_completion_tokens"] == 2200
    assert "finish_status" not in payload.generator  # no attempt ran
    # And it crosses the wire: serde maps engine_failure → engineFailure, request_id → requestId.
    wire = snapshot_serde.to_wire(dataclasses.asdict(payload))
    assert wire["diagnostics"]["engineFailure"]["code"] == "internal_exception"
    assert wire["diagnostics"]["engineFailure"]["messageTruncated"] is False
    assert wire["requestId"] == "31111111-1111-4111-8111-111111111115"
    assert wire["parentSnapshotId"] is None
    assert wire["generator"]["maxCompletionTokens"] == 2200
    assert wire["generator"]["responseFormat"] == "json_schema_strict"
    assert wire["generator"]["promptCacheRetention"] == "in_memory"
    assert wire["generator"]["timeoutSeconds"] == 30.0
    assert wire["generator"]["maxRetries"] == 0


def test_build_degenerate_payload_salvages_attempts_from_a_trace():
    from fitted_core.snapshot import EngineFailure, build_degenerate_payload

    request = _rich_request()
    trace = rescue_with_trace(request, StubGenerator(["{ bad", "{ still bad"]))
    payload = build_degenerate_payload(
        request,
        EngineFailure(stage="assemble", code="internal_exception"),
        trace=trace,
        candidate_cache_key="ck-assemble",
        request_id="31111111-1111-4111-8111-111111111116",
        generator_provider="openai",
        generator_model="gpt-5.4-mini",
        generator_temperature=0.5,
        generator_max_completion_tokens=2200,
    )
    # The paid attempts (raw text + repair flag) survive onto the failure row...
    assert len(payload.generation_attempts) == 2
    assert payload.generation_attempts[0].raw_text == "{ bad"
    assert payload.generation_attempts[1].is_repair is True
    # ...with honest parse/spend diagnostics (not the no-trace defaults).
    assert payload.diagnostics.parse == {
        "parse_success": False, "repair_used": True, "generator_calls": 2,
    }
    assert payload.diagnostics.engine_failure["stage"] == "assemble"
    assert payload.candidates == () and payload.n_surfaced == 0
