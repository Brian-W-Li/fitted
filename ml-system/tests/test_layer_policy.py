"""R16 adversarial selection and honesty contracts over synthetic closets."""
import dataclasses
import itertools
import json

import pytest

from fitted_core.layer_policy import layer_choice
from fitted_core.models import ItemType, Role, WardrobeItem
from fitted_core.reducers import BehavioralSignals
from fitted_core.rescue import RenderRequest, render, render_with_trace
from fitted_core.snapshot import build_snapshot_payload
from fitted_core.snapshot_serde import to_wire, variant_to_wire
from service.tests.helpers import AUTH, daily_envelope, http, make_app, render_body, wire_item
from tests.helpers import StubGenerator


def behavioral(**overrides):
    args = dict(item_affinity={}, liked_full_signatures=frozenset(), shown_full_signatures=(), recent_disliked_base_keys=(), recent_disliked_item_ids=())
    args.update(overrides)
    return BehavioralSignals(**args)


def item(name, kind, warmth=5):
    return WardrobeItem(name, name, kind, warmth, '')


def outfit(bottom='b1', outer=None, shoe=None, top='t1'):
    parts = [(top, Role.base_top), (bottom, Role.base_bottom)]
    if outer:
        parts.append((outer, Role.outer_layer))
    if shoe:
        parts.append((shoe, Role.shoes))
    return {'items': [{'itemId': name, 'role': role.value} for name, role in parts],
            'styleMove': {'moveType': 'waterproof', 'changedItemIds': [parts[-1][0]],
                          'oneSentence': 'This waterproof wind-resistant outfit keeps you dry and blocks the wind.'}}


def request(intent='daily', **overrides):
    args = dict(wardrobe=[item('t1', ItemType.top), *[item(f'b{i}', ItemType.bottom) for i in range(1, 4)],
                         item('heavy_unknown_jacket', ItemType.outer_layer, 10),
                         item('s1', ItemType.shoes), item('s2', ItemType.shoes)],
                forced_item_id='t1' if intent == 'rescue_item' else None, intent=intent,
                occasion='weekday', weather='mild', weather_signals={'rain': True, 'wind': False},
                session_id='r16', wardrobe_version=1, k=3, n_surfaced=2)
    args.update(overrides)
    return RenderRequest(**args)


def envelope(*candidates):
    return json.dumps({'outfits': candidates})


def layered(variants):
    return [v for v in variants if any(role == Role.outer_layer for _, role in v.items)]


def payload(trace, req):
    return build_snapshot_payload(trace, req, candidate_cache_key='r16', request_id='r16',
                                  generator_provider='stub', generator_model='stub', generator_temperature=0,
                                  generator_max_completion_tokens=2200)


@pytest.mark.parametrize('intent', ['daily', 'rescue_item'])
@pytest.mark.parametrize('traced', [False, True])
@pytest.mark.parametrize('k,n', [(1, 1), (3, 2), (5, 3)])
def test_valid_layer_survives_base_cap_k_and_spread_in_all_paths(intent, traced, k, n):
    req = request(intent, k=k, n_surfaced=n)
    # Sole layer loses both pre-cap and final score ordering without the policy.
    candidates = [outfit(shoe='s1'), outfit(shoe='s2'), outfit(outer='heavy_unknown_jacket'),
                  outfit('b2'), outfit('b3')]
    stub = StubGenerator(envelope(*candidates))
    signals = behavioral(recent_disliked_item_ids=('heavy_unknown_jacket',))
    result = render_with_trace(req, stub, behavioral_signals=signals).result if traced else render(req, stub, behavioral_signals=signals)
    assert len(result.variants) == n
    assert len(result.ranked.outfits) == k
    assert len(layered(result.variants)) == 1
    assert stub.call_count == 1
    assert 'optional removable outer-layer outfit' in stub.prompts[0].user
    assert layer_choice(req, result.variants)['status'] == 'offered'
    assert all('waterproof' not in v.style_move.one_sentence and 'wind-resistant' not in v.style_move.one_sentence for v in result.variants)


@pytest.mark.parametrize('order', list(itertools.permutations(range(3))))
def test_equal_scores_preserve_layer_independent_of_input_order(order):
    candidates = [outfit(shoe='s1'), outfit(shoe='s2'), outfit(outer='heavy_unknown_jacket')]
    req = request(k=1, n_surfaced=1)
    trace = render_with_trace(req, StubGenerator(envelope(*(candidates[i] for i in order))))
    assert layered(trace.result.variants)
    assert trace.rank_audit.scored[0] == trace.result.ranked.outfits[0]
    assert trace.rank_audit.result == trace.result.ranked


@pytest.mark.parametrize('weather,signals', [('hot', {'rain': True, 'wind': False}),
    ('mild', {'rain': False, 'wind': False}), ('cold', None), ('indoor', {'rain': False, 'wind': True})])
def test_hot_dry_and_legacy_have_no_layer_reservation(weather, signals):
    req = request(weather=weather, weather_signals=signals, k=1, n_surfaced=1)
    trace = render_with_trace(req, StubGenerator(envelope(outfit(), outfit('b2', outer='heavy_unknown_jacket'))),
                              behavioral_signals=behavioral(recent_disliked_item_ids=('heavy_unknown_jacket',)))
    assert not layered(trace.result.variants)
    assert layer_choice(req, trace.result.variants) == {'status': 'off', 'note': None}


def test_cold_wind_and_all_layer_candidates_work():
    req = request(weather='cold', weather_signals={'rain': False, 'wind': True})
    trace = render_with_trace(req, StubGenerator(envelope(outfit(outer='heavy_unknown_jacket'), outfit('b2', outer='heavy_unknown_jacket'))))
    assert len(layered(trace.result.variants)) == 2
    assert layer_choice(req, trace.result.variants)['status'] == 'offered'


def test_soft_cooldown_cannot_remove_only_layer():
    req = request(k=1, n_surfaced=1)
    raw = envelope(outfit(outer='heavy_unknown_jacket'), outfit('b2'))
    baseline = render_with_trace(req, StubGenerator(raw))
    layer_base = next(o.base_key for o in baseline.rank_audit.scored if o.slot_map.outer)
    trace = render_with_trace(req, StubGenerator(raw), behavioral_signals=behavioral(recent_disliked_base_keys=(layer_base,)))
    assert layered(trace.result.variants)
    assert trace.result.ranked.outfits[0].relaxed_cooldown
    assert trace.result.ranked.relaxed_cooldown_count == 1
    assert trace.result.ranked.fallback_stage.value == "cooldownRelaxed"
    assert len({o.full_signature for o in trace.rank_audit.scored}) == len(trace.rank_audit.scored)


@pytest.mark.parametrize('mode', ['none', 'unavailable', 'excluded', 'source', 'missing_lock', 'missing_anchor'])
def test_hard_intent_and_owned_available_pool_precede_layer_choice(mode):
    req = request('rescue_item', k=1, n_surfaced=1)
    outer = outfit(outer='heavy_unknown_jacket')
    if mode == 'none':
        outer = outfit()
    elif mode == 'unavailable':
        req = dataclasses.replace(req, wardrobe=[i for i in req.wardrobe if i.type != ItemType.outer_layer])
    elif mode == 'excluded':
        req = dataclasses.replace(req, disliked_item_ids=('heavy_unknown_jacket',))
    elif mode == 'source':
        req = dataclasses.replace(req, excluded_outfit_item_ids=('t1', 'b1', 'heavy_unknown_jacket'))
    elif mode == 'missing_lock':
        req = dataclasses.replace(req, locked_item_ids=('s1',))
    elif mode == 'missing_anchor':
        req = dataclasses.replace(req, wardrobe=[*req.wardrobe, item('t2', ItemType.top)])
        outer = outfit(outer='heavy_unknown_jacket', top='t2')
    stub = StubGenerator(envelope(outer, outfit('b2', shoe='s1')))
    trace = render_with_trace(req, stub)
    assert not layered(trace.result.variants)
    choice = layer_choice(req, trace.result.variants)
    assert choice['status'] == 'gap'
    assert 'unknown' in choice['note']
    assert stub.call_count == 1


def test_source_exclusion_happens_before_k_and_preserves_drop_provenance():
    req = request(k=1, n_surfaced=1, excluded_outfit_item_ids=('t1', 'b1', 'heavy_unknown_jacket'))
    trace = render_with_trace(req, StubGenerator(envelope(outfit(outer='heavy_unknown_jacket'), outfit('b2'))))
    assert len(trace.result.ranked.outfits) == 1
    assert len(trace.result.variants) == 1
    assert trace.result.variants[0].items == (('t1', Role.base_top), ('b2', Role.base_bottom))
    assert any(drop.drop_reason == 'source_membership_excluded' for drop in trace.rescue_drops)


def test_safe_displayed_style_is_persisted_without_rewriting_raw_evidence():
    req = request()
    trace = render_with_trace(req, StubGenerator(envelope(outfit(outer='heavy_unknown_jacket'), outfit('b2'))))
    saved = payload(trace, req)
    wire = to_wire(dataclasses.asdict(saved))
    assert wire['layerChoice']['status'] == 'offered'
    for variant in trace.result.variants:
        candidate = next(c for c in wire['candidates'] if c['fullSignature'] == variant.full_signature)
        assert candidate['styleMove'] == variant_to_wire(variant)['styleMove']
        assert 'waterproof' in candidate['rawEmitted']['styleMove']['oneSentence']
        assert 'waterproof' not in candidate['styleMove']['oneSentence']
        assert candidate['styleMove']['moveType'] != 'waterproof'


@pytest.mark.parametrize('signals', [{'rain': 'true', 'wind': False}, {'rain': 1, 'wind': False},
    {'rain': True}, {'rain': True, 'wind': False, 'snow': True}, [], True])
def test_request_strict_signals_reject_unknown_or_coerced_values(signals):
    with pytest.raises(ValueError):
        request(weather_signals=signals)


@pytest.mark.parametrize('signals', [{'rain': 'true', 'wind': False}, {'rain': 1, 'wind': False},
    {'rain': True}, {'rain': True, 'wind': False, 'snow': True}, [], True, None])
def test_http_bad_signals_are_rejected_before_spend(signals):
    app, stub = make_app(daily_envelope())
    status, body = http(app, 'POST', '/render', headers=AUTH, json_body=render_body(lens={'weatherSignals': signals}))
    assert status == 400
    assert body['error']['code'] == 'contract_invalid'
    assert stub.call_count == 0


def test_http_legacy_missing_signals_remains_readable():
    body = render_body()
    del body['lens']['weatherSignals']
    app, stub = make_app(daily_envelope())
    status, result = http(app, 'POST', '/render', headers=AUTH, json_body=body)
    assert status == 200
    assert result['payload']['layerChoice'] == {'status': 'off', 'note': None}
    assert stub.call_count == 1


def test_http_positive_rain_heavy_unknown_jacket_has_matching_saved_and_shown_style():
    wardrobe = [wire_item('t1', 'top'), wire_item('b1', 'bottom'), wire_item('heavy_unknown_jacket', 'outer_layer', warmth=10)]
    app, stub = make_app(envelope(outfit(outer='heavy_unknown_jacket')))
    status, result = http(app, 'POST', '/render', headers=AUTH, json_body=render_body(wardrobe=wardrobe, lens={'weatherSignals': {'rain': True, 'wind': False}, 'weather': 'mild'}))
    assert status == 200
    assert result['payload']['layerChoice']['status'] == 'offered'
    shown = result['shown'][0]['outfit']
    saved = next(c for c in result['payload']['candidates'] if c['shown'])
    assert saved['styleMove'] == shown['styleMove']
    assert 'waterproof' not in shown['styleMove']['oneSentence']
    assert 'unknown' in result['payload']['layerChoice']['note']
    assert stub.call_count == 1


@pytest.mark.parametrize('outer_name', ['heavy_unknown_jacket', 'synthetic_coat', 'synthetic_overshirt'])
def test_multiple_owned_outer_types_offer_the_best_ranked_valid_layer(outer_name):
    req = request(k=1, n_surfaced=1)
    req = dataclasses.replace(req, wardrobe=[*req.wardrobe, item('synthetic_coat', ItemType.outer_layer, 8),
                                            item('synthetic_overshirt', ItemType.outer_layer, 3)])
    candidates = [outfit(outer=name) for name in ['heavy_unknown_jacket', 'synthetic_coat', 'synthetic_overshirt']]
    trace = render_with_trace(req, StubGenerator(envelope(outfit('b2'), *candidates)),
                              behavioral_signals=behavioral(item_affinity={outer_name: 10}))
    assert len(trace.result.variants) == 1
    assert (outer_name, Role.outer_layer) in trace.result.variants[0].items
    assert layer_choice(req, trace.result.variants)['status'] == 'offered'


def test_zero_spread_budget_does_not_reserve_an_extra_layer():
    from fitted_core.response import select_spread
    req = request()
    trace = render_with_trace(req, StubGenerator(envelope(outfit(outer='heavy_unknown_jacket'))))
    variants = {v.full_signature: v for v in trace.build_trace.all_variants}
    assert select_spread(trace.result.ranked, variants, 0, reserve_layer=True) == ([], False)


def test_rain_styling_actions_match_selected_composition():
    req = request(wardrobe=[item('t1', ItemType.top), item('b1', ItemType.bottom), item('dress', ItemType.dress)])
    dress = {'items': [{'itemId': 'dress', 'role': 'one_piece'}], 'styleMove': {'moveType': 'layer', 'changedItemIds': ['dress'], 'oneSentence': 'Wear a waterproof jacket.'}}
    trace = render_with_trace(req, StubGenerator(envelope(outfit(), dress)))
    for variant in trace.result.variants:
        text = variant.style_move.one_sentence
        assert 'waterproof' not in text and 'jacket' not in text
        assert set(variant.style_move.changed_item_ids) <= {name for name, _ in variant.items}
        if variant.template.value == 'two_piece':
            assert 'front tuck' in text
        else:
            assert 'dress as the base' in text
    assert layer_choice(req, trace.result.variants)['status'] == 'gap'


def test_positive_condition_degenerate_payload_echoes_signals_and_honest_gap():
    req = request()
    stub = StubGenerator(['not json', 'still not json'])
    trace = render_with_trace(req, stub)
    saved = payload(trace, req)
    assert saved.weather_signals == {'rain': True, 'wind': False}
    assert saved.layer_choice['status'] == 'gap'
    assert stub.call_count == 2
    app, service_stub = make_app(['not json', 'still not json'])
    status, result = http(app, 'POST', '/render', headers=AUTH, json_body=render_body(lens={'weatherSignals': {'rain': True, 'wind': False}, 'weather': 'mild'}))
    assert status == 200
    assert result['payload']['weatherSignals'] == {'rain': True, 'wind': False}
    assert result['payload']['layerChoice']['status'] == 'gap'
    assert service_stub.call_count == 2
