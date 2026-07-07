import json

import pytest

from fitted_core.config import MIN_SIGNAL_THRESHOLD, REPETITION_PENALTY
from fitted_core.models import ItemType, Role, WardrobeItem
from fitted_core.reducers import AffinitySignalScorer, BehavioralSignals
from fitted_core.rescue import (
    _INSUFFICIENT_AFTER_GENERATION_HINT,
    RenderRequest,
    render,
    render_with_trace,
    rescue,
)
from fitted_core.sampler import ColdStartSignalScorer, SelectionKind
from fitted_core.snapshot import build_snapshot_payload
from tests.helpers import StubGenerator


def _item(item_id: str, item_type: ItemType) -> WardrobeItem:
    return WardrobeItem(item_id, item_id, item_type, warmth=5, image_url=f"{item_id}.jpg")


def _vp(item_id: str, role: Role) -> dict:
    return {"itemId": item_id, "role": role.value}


def _outfit(items: list[tuple[str, Role]], changed: list[str], *, style_move: bool = True) -> dict:
    outfit: dict = {"items": [_vp(item_id, role) for item_id, role in items]}
    if style_move:
        outfit["styleMove"] = {
            "moveType": "style",
            "changedItemIds": list(changed),
            "oneSentence": "A concrete styling idea.",
        }
    return outfit


def _envelope(*outfits: dict) -> str:
    return json.dumps({"outfits": list(outfits)})


def _daily_request(wardrobe: list[WardrobeItem], **kwargs) -> RenderRequest:
    return RenderRequest(
        wardrobe=wardrobe,
        forced_item_id=None,
        occasion="weekday work",
        weather="mild",
        session_id="daily-session",
        wardrobe_version=3,
        intent="daily",
        **kwargs,
    )


def test_daily_render_success_builds_daily_snapshot_payload():
    wardrobe = [_item("t1", ItemType.top), _item("b1", ItemType.bottom), _item("b2", ItemType.bottom), _item("s1", ItemType.shoes)]
    request = _daily_request(wardrobe)
    stub = StubGenerator(
        _envelope(
            _outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]),
            _outfit([("t1", Role.base_top), ("b2", Role.base_bottom)], ["b2"]),
            _outfit([("t1", Role.base_top), ("b1", Role.base_bottom), ("s1", Role.shoes)], ["s1"]),
        )
    )

    trace = render_with_trace(request, stub)
    payload = build_snapshot_payload(
        trace,
        request,
        candidate_cache_key="daily-cache",
        generator_provider="openai",
        generator_model="gpt-5.4-mini",
        generator_temperature=0.5,
    )

    assert stub.call_count == 1
    assert trace.result.not_enough_items is False
    assert trace.candidate_requested == trace.sampler_result.candidate_requested
    assert "Forced item" not in stub.prompts[0].user
    assert "MUST include the forced item" not in stub.prompts[0].system
    assert payload.intent == "daily"
    assert payload.forced_item_id is None
    assert payload.n_surfaced == 3
    assert len(trace.result.variants) == 3
    assert all(variant.items for variant in trace.result.variants)
    assert all(variant.style_move is not None for variant in trace.result.variants)
    assert all(0.0 <= variant.compatibility <= 1.0 for variant in trace.result.variants)
    assert all(0.0 <= variant.visibility <= 1.0 for variant in trace.result.variants)


def test_daily_not_enough_short_circuits_without_generation_but_preserves_prompt_pool_snapshot():
    request = _daily_request([_item("t1", ItemType.top)])
    stub = StubGenerator(_envelope())

    trace = render_with_trace(request, stub)
    payload = build_snapshot_payload(
        trace,
        request,
        candidate_cache_key="daily-empty",
        generator_provider="openai",
        generator_model="gpt-5.4-mini",
        generator_temperature=0.5,
    )

    assert stub.call_count == 0
    assert trace.result.not_enough_items is True
    assert trace.sampler_result is not None
    assert trace.candidate_requested == 0
    assert [item.id for item in trace.prompt_pool] == ["t1"]
    assert trace.attempts == ()
    assert trace.validation is None
    assert trace.rank_audit is None
    assert payload.item_snapshots[0].item_id == "t1"
    assert payload.candidates == ()
    assert payload.shown_candidate_ids == ()
    assert payload.n_surfaced == 0


def test_daily_drops_missing_stylemove_but_does_not_apply_rescue_forced_item_drop():
    wardrobe = [
        _item("t1", ItemType.top),
        _item("b1", ItemType.bottom),
        _item("t2", ItemType.top),
        _item("b2", ItemType.bottom),
    ]
    request = _daily_request(wardrobe)
    result = render(
        request,
        StubGenerator(
            _envelope(
                _outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], [], style_move=False),
                _outfit([("t2", Role.base_top), ("b2", Role.base_bottom)], ["t2"]),
            )
        ),
    )

    assert result.ranked is not None
    assert len(result.ranked.outfits) == 1
    assert result.insufficient_after_generation is True
    assert result.reason_hint == _INSUFFICIENT_AFTER_GENERATION_HINT
    survivor = result.ranked.outfits[0]
    assert survivor.slot_map.top == "t2"
    assert survivor.slot_map.bottom == "b2"


def test_daily_traced_stylemove_drop_uses_render_provenance_in_snapshot_payload():
    wardrobe = [
        _item("t1", ItemType.top),
        _item("b1", ItemType.bottom),
        _item("t2", ItemType.top),
        _item("b2", ItemType.bottom),
    ]
    request = _daily_request(wardrobe)
    malformed_stylemove = {
        "items": [_vp("t1", Role.base_top), _vp("b1", Role.base_bottom)],
        "styleMove": {
            "moveType": "bad",
            "changedItemIds": ["not-in-outfit"],
            "oneSentence": "This names an item outside the outfit.",
        },
    }
    trace = render_with_trace(
        request,
        StubGenerator(
            _envelope(
                malformed_stylemove,
                _outfit([("t2", Role.base_top), ("b2", Role.base_bottom)], ["t2"]),
            )
        ),
    )
    payload = build_snapshot_payload(
        trace,
        request,
        candidate_cache_key="daily-drop",
        generator_provider="openai",
        generator_model="gpt-5.4-mini",
        generator_temperature=0.5,
    )

    assert len(trace.rescue_drops) == 1
    assert trace.rescue_drops[0].drop_stage == "render"
    assert trace.rescue_drops[0].drop_reason == "stylemove_invalid"
    dropped = payload.candidates[0]
    assert dropped.drop_stage == "render"
    assert dropped.drop_reason == "stylemove_invalid"
    assert dropped.shown is False
    assert payload.candidates[1].shown is True


def test_rescue_render_default_is_byte_equal_to_rescue_wrapper():
    wardrobe = [_item("t1", ItemType.top), _item("b1", ItemType.bottom), _item("b2", ItemType.bottom), _item("s1", ItemType.shoes)]
    request = RenderRequest(
        wardrobe=wardrobe,
        forced_item_id="t1",
        occasion="brunch",
        weather="mild",
        session_id="rescue-session",
        wardrobe_version=1,
    )
    canned = _envelope(
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]),
        _outfit([("t1", Role.base_top), ("b2", Role.base_bottom)], ["b2"]),
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom), ("s1", Role.shoes)], ["s1"]),
    )

    assert render(request, StubGenerator(canned)) == rescue(request, StubGenerator(canned))


def test_render_request_intent_and_forced_item_contracts():
    wardrobe = [_item("t1", ItemType.top), _item("b1", ItemType.bottom)]
    with pytest.raises(ValueError, match="forced_item_id is required"):
        RenderRequest(
            wardrobe=wardrobe,
            forced_item_id=None,
            occasion="x",
            weather="mild",
            session_id="s",
            wardrobe_version=1,
            intent="rescue_item",
        )
    with pytest.raises(ValueError, match="forced_item_id must be None"):
        RenderRequest(
            wardrobe=wardrobe,
            forced_item_id="t1",
            occasion="x",
            weather="mild",
            session_id="s",
            wardrobe_version=1,
            intent="daily",
        )
    with pytest.raises(ValueError, match="unsupported render intent"):
        RenderRequest(
            wardrobe=wardrobe,
            forced_item_id=None,
            occasion="x",
            weather="mild",
            session_id="s",
            wardrobe_version=1,
            intent="unknown",
        )
    unsupported = RenderRequest(
        wardrobe=wardrobe,
        forced_item_id=None,
        occasion="x",
        weather="mild",
        session_id="s",
        wardrobe_version=1,
        intent="outfit_upgrade",
    )
    with pytest.raises(NotImplementedError):
        render(unsupported, StubGenerator(_envelope()))


def test_affinity_signal_scorer_opens_daily_sampler_signal_slot_when_threshold_is_met():
    tops = [_item(f"t{i:02d}", ItemType.top) for i in range(50)]
    wardrobe = [*tops, _item("b1", ItemType.bottom)]
    request = _daily_request(wardrobe, interaction_count=MIN_SIGNAL_THRESHOLD)
    stub = StubGenerator(_envelope(_outfit([("t49", Role.base_top), ("b1", Role.base_bottom)], ["t49"])))

    trace = render_with_trace(
        request,
        stub,
        signal_scorer=AffinitySignalScorer({"t49": 10, "t00": 0}),
    )

    assert trace.sampler_result is not None
    top_sample = trace.sampler_result.per_type[ItemType.top]
    assert top_sample.selection_kind is SelectionKind.signal
    assert top_sample.signal_count > 0
    assert "t49" in {item.id for item in top_sample.items}
    assert trace.result.ranked is not None
    assert len(trace.result.ranked.outfits) == 1


def test_behavioral_signals_reach_ranker_context_end_to_end():
    wardrobe = [_item("t1", ItemType.top), _item("b1", ItemType.bottom)]
    request = _daily_request(wardrobe)
    shown_signature = "t1:b1|outer=none|shoes=none"

    trace = render_with_trace(
        request,
        StubGenerator(_envelope(_outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]))),
        behavioral_signals=BehavioralSignals(
            item_affinity={},
            liked_full_signatures=frozenset(),
            shown_full_signatures=(shown_signature,),
            recent_disliked_base_keys=(),
            recent_disliked_item_ids=(),
        ),
    )

    assert trace.rank_audit is not None
    outfit = trace.rank_audit.result.outfits[0]
    assert outfit.full_signature == shown_signature
    assert outfit.breakdown.repetition == -REPETITION_PENALTY


def _sampler_selection_surface(result):
    assert result is not None
    return (
        result.pool,
        result.per_type,
        result.candidate_requested,
        result.prompt_item_count,
        result.not_enough_items,
    )


def test_unavailable_or_below_threshold_signal_scorers_keep_cold_start_selection():
    tops = [_item(f"t{i:02d}", ItemType.top) for i in range(50)]
    wardrobe = [*tops, _item("b1", ItemType.bottom)]
    base = dict(
        wardrobe=wardrobe,
        forced_item_id=None,
        occasion="weekday work",
        weather="mild",
        session_id="daily-cold",
        wardrobe_version=8,
        intent="daily",
    )
    cold_request = RenderRequest(**base, interaction_count=MIN_SIGNAL_THRESHOLD)
    below_threshold_request = RenderRequest(**base, interaction_count=MIN_SIGNAL_THRESHOLD - 1)

    cold_at_threshold = render_with_trace(
        cold_request, StubGenerator(_envelope()), signal_scorer=ColdStartSignalScorer()
    ).sampler_result
    cold_below_threshold = render_with_trace(
        below_threshold_request, StubGenerator(_envelope()), signal_scorer=ColdStartSignalScorer()
    ).sampler_result
    empty_affinity = render_with_trace(
        cold_request, StubGenerator(_envelope()), signal_scorer=AffinitySignalScorer({})
    ).sampler_result
    below_threshold = render_with_trace(
        below_threshold_request,
        StubGenerator(_envelope()),
        signal_scorer=AffinitySignalScorer({"t49": 100}),
    ).sampler_result

    assert empty_affinity == cold_at_threshold
    assert _sampler_selection_surface(below_threshold) == _sampler_selection_surface(
        cold_below_threshold
    )
    assert below_threshold.scorer_available is True
    assert cold_below_threshold.scorer_available is False
