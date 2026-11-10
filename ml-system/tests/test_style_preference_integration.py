"""Actual core/HTTP final-selection checks with authored feedback and stub generation."""
from copy import deepcopy
from dataclasses import replace
import math

import pytest

from fitted_core.models import ItemType, Role, WardrobeItem
from fitted_core.ranker import RankerContext, rank
from fitted_core.rescue import RenderRequest, render_with_trace
from fitted_core.snapshot import build_snapshot_payload
from fitted_core.validator import validate_gpt_payload
from service.tests.helpers import AUTH, envelope, http, make_app, outfit, render_body, wire_item
from tests.helpers import StubGenerator
from tests.test_style_preferences import CONTEXT, relationship_data


STYLE = {"boardId": "c"*24, "profileId": "a"*24, "profileVersion": 1, "boardLabel": "Campus",
         "routineId": "b"*24, "routineVersion": 1, "routineLabel": "Class",
         "learningEnabled": True, "compiled": {"aestheticKeywords": ["relaxed"], "palette": [], "patterns": [], "fits": []},
         "memoryRevision": 1, "weather": "unspecified"}
SCOPE = {**CONTEXT, "profileId": STYLE["profileId"], "routineId": STYLE["routineId"]}


def case(*, layer=False):
    rows, candidates = relationship_data()
    for row in rows:
        row["context"] = dict(SCOPE)
    wardrobe, outputs = [], []
    role_map = {"top": Role.base_top, "bottom": Role.base_bottom, "shoes": Role.shoes, "outer": Role.outer_layer}
    for prefix, candidate in zip(("a", "b", "c", "d"), candidates):
        for item in candidate["items"]:
            item["id"] = prefix+"-"+item["role"]
        if layer and prefix == "a":
            candidate["items"].append({"id": "layer", "role": "outer", "subtype": "jacket", "colors": ["gray"]})
        for item in candidate["items"]:
            kind = "outer_layer" if item["role"] == "outer" else item["role"]
            wardrobe.append(WardrobeItem(item["id"], item["id"], ItemType(kind), 5, "", subtype=item["subtype"],
                                        color_tags=item["colors"], fit=item.get("fit"), pattern=item.get("pattern")))
        outputs.append(outfit([(item["id"], role_map[item["role"]]) for item in candidate["items"]], [candidate["items"][0]["id"]]))
    request = RenderRequest(wardrobe=wardrobe, forced_item_id=None, occasion="Class", weather="mild", intent="daily",
                            session_id="owner", wardrobe_version=1, style_context=dict(STYLE), preference_rows=tuple(rows),
                            weather_signals={"rain": layer, "wind": False})
    return request, envelope(*outputs), outputs


def test_actual_three_card_membership_changes_and_zero_learner_comparison_uses_same_candidates():
    request, payload, _ = case()
    trace = render_with_trace(request, StubGenerator(payload))
    metadata = trace.preference_metadata
    assert len(trace.result.variants) == 3 and metadata["status"] == "fitted_experimental"
    assert set(metadata["shownFullSignatures"]) != set(metadata["baselineShownFullSignatures"])
    assert metadata["shownFullSignatures"] == [variant.full_signature for variant in trace.result.variants]
    assert all(abs(outfit.breakdown.preference) <= .5 for outfit in trace.rank_audit.scored)
    for outfit in trace.rank_audit.scored:
        b = outfit.breakdown
        assert outfit.score == b.base+b.combo+b.item+b.dislike+b.overuse+b.repetition+b.cooldown+b.preference
    baseline = render_with_trace(replace(request, style_context={**STYLE, "learningEnabled": False}), StubGenerator(payload))
    assert metadata["baselineShownFullSignatures"] == [variant.full_signature for variant in baseline.result.variants]
    assert len(trace.attempts) == len(baseline.attempts) == 1


def test_missing_opposite_context_and_required_unknown_use_complete_baseline():
    request, payload, _ = case()
    other = replace(request, style_context={**STYLE, "profileId": "e"*24})
    trace = render_with_trace(other, StubGenerator(payload))
    assert trace.preference_metadata["reason"] == "insufficient_evidence"
    assert trace.preference_metadata["shownFullSignatures"] == trace.preference_metadata["baselineShownFullSignatures"]
    request.wardrobe[0].subtype = None
    unknown = render_with_trace(request, StubGenerator(payload))
    assert unknown.preference_metadata["reason"] == "unknown_required_features"
    assert all(outfit.breakdown.preference == 0 for outfit in unknown.rank_audit.scored)


def test_actual_controls_source_exclusion_and_reserved_layer_survive_learning():
    request, payload, _ = case(layer=True)
    trace = render_with_trace(request, StubGenerator(payload))
    assert any(variant.slot_map.outer == "layer" for variant in trace.result.ranked.outfits)
    assert any(any(role == Role.outer_layer for _, role in variant.items) for variant in trace.result.variants)
    avoided = render_with_trace(replace(request, disliked_item_ids=("a-top",)), StubGenerator(payload))
    assert all("a-top" not in [ident for ident, _ in variant.items] for variant in avoided.result.variants)
    source = tuple(ident for ident, _ in trace.result.variants[0].items)
    excluded = render_with_trace(replace(request, excluded_outfit_item_ids=source), StubGenerator(payload))
    assert all(frozenset(ident for ident, _ in variant.items) != frozenset(source) for variant in excluded.result.variants)


def test_signed_term_enters_before_base_variant_cap_and_top_k_and_survives_diversity():
    wardrobe = [WardrobeItem("t", "Top", ItemType.top, 5, ""), WardrobeItem("b", "Bottom", ItemType.bottom, 5, "")]
    wardrobe += [WardrobeItem(f"s{n}", "Shoe", ItemType.shoes, 5, "") for n in range(3)]
    generated = {"outfits": [outfit([("t", Role.base_top), ("b", Role.base_bottom), (f"s{n}", Role.shoes)], ["t"]) for n in range(3)]}
    candidates = validate_gpt_payload(generated, wardrobe, 3).candidates
    context = RankerContext(session_id="owner", wardrobe_version=1, occasion="Class", weather="mild", generation_index=0, k=1)
    baseline = rank(candidates, context)
    target = next(candidate for candidate in candidates if candidate.full_signature != baseline.outfits[0].full_signature)
    learned = rank(candidates, replace(context, preference_deltas={target.full_signature: .4}))
    assert learned.outfits[0].full_signature == target.full_signature
    assert learned.outfits[0].breakdown.preference == .4
    with pytest.raises(ValueError):
        replace(context, preference_deltas={target.full_signature: math.inf})


def service_case():
    request, generated, _ = case()
    raw = [wire_item(item.id, item.type.value, subtype=item.subtype, colorTags=item.color_tags,
                     fit=item.fit, pattern=item.pattern) for item in request.wardrobe]
    body = render_body(sessionId="owner", wardrobe=raw, protocolVersion=2, styleContext=dict(STYLE),
                       preferenceRows=list(request.preference_rows), lens={"occasion": "Class"})
    return body, generated


def test_service_protocol2_binds_actual_preference_and_captured_subtype():
    body, generated = service_case()
    app, generator = make_app(generated)
    status, result = http(app, "POST", "/render", headers=AUTH, json_body=body)
    assert status == 200 and generator.call_count == 1
    assert result["protocolVersion"] == 2 and result["styleContext"] == STYLE
    assert result["preference"]["status"] == "fitted_experimental", result
    assert set(result["preference"]["baselineShownFullSignatures"]) != set(result["payload"]["shownFullSignatures"])
    assert result["preference"]["shownFullSignatures"] == result["payload"]["shownFullSignatures"]
    assert all(item["engineVisible"].get("subtype") for item in result["payload"]["itemSnapshots"])
    for entry in result["shown"]:
        b = entry["outfit"]["scoreBreakdown"]
        assert entry["outfit"]["score"] == sum(b.values())
    assert "coefficients" not in result["preference"] and "items" not in result["preference"]


@pytest.mark.parametrize("responses", ["not-json", '{"outfits":[]}'])
def test_protocol_context_echoes_on_valid_empty_attempt_outcomes(responses):
    body, _ = service_case()
    app, _ = make_app(responses)
    status, result = http(app, "POST", "/render", headers=AUTH, json_body=body)
    assert status == 200 and result["shown"] == []
    assert result["protocolVersion"] == 2 and result["styleContext"] == STYLE
    assert result["preference"]["status"] == "abstained"


def test_protocol_context_echoes_when_generator_raises_and_audit_degrades():
    class Raising:
        def generate(self, prompt):
            raise RuntimeError("synthetic failure")
    body, _ = service_case()
    app, _ = make_app(generator=Raising())
    status, result = http(app, "POST", "/render", headers=AUTH, json_body=body)
    assert status == 200 and result["shown"] == [] and result["degenerate"] is True
    assert result["protocolVersion"] == 2 and result["styleContext"] == STYLE
    assert result["preference"]["reason"] == "selection_not_reached"


@pytest.mark.parametrize("mutate", [
    lambda body: body.pop("protocolVersion"),
    lambda body: body.update(preferenceRows=[{}]),
    lambda body: body.update(preferenceRows=[{}]*2001),
    lambda body: body["preferenceRows"][0]["context"].update(ownerId="other"),
    lambda body: body["wardrobe"][0].update(subtype="x"*61),
])
def test_service_rejects_malformed_learning_inputs_before_generator(mutate):
    body, generated = service_case()
    mutate(body)
    app, generator = make_app(generated)
    status, result = http(app, "POST", "/render", headers=AUTH, json_body=body)
    assert status == 400 and result["error"]["code"] == "contract_invalid"
    assert generator.call_count == 0
