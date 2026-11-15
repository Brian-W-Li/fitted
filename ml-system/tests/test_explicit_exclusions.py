"""Authored hard-exclusion contracts: policy identity, actual selection and no relaxation."""
from copy import deepcopy
from dataclasses import asdict, replace
import hashlib
import json

import pytest

from fitted_core.exclusions import normalize_explicit_exclusions, is_excluded
from fitted_core.layer_policy import eligible_signatures
from fitted_core.models import ItemType, Role, WardrobeItem
from fitted_core.ranker import RankerContext, rank, rank_with_audit
from fitted_core.rescue import RenderRequest, render, render_with_trace
from fitted_core.response import build_variants, selection_pool
from fitted_core.snapshot import build_snapshot_payload
from fitted_core.snapshot_serde import from_wire, to_wire
from fitted_core.validator import validate_gpt_payload
from service.tests.helpers import AUTH, envelope, http, make_app, outfit, render_body, wire_item
from tests.helpers import StubGenerator

REQUEST = "41111111-1111-4111-8111-111111111111"
def ident(number):
    return f"{number:024x}"

T1,T2,B1,B2,O,S,D = [ident(i) for i in range(1,8)]

def entry(number, kind, items, scope="request"):
    return {"id": ident(100+number), "revision": 1, "scope": scope, "kind": kind, "itemIds": sorted(items)}


def policy(*entries, saved_ref=None, request_id=REQUEST):
    value={"version":"explicit-exclusions.v1", "requestId":request_id, "savedRef":saved_ref,
           "entries":sorted(entries,key=lambda row:row["id"])}
    # Independent standard-library construction, not the production digest helper.
    value["digest"]=hashlib.sha256(json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=True).encode("ascii")).hexdigest()
    return value


def resign(value):
    unsigned={k:v for k,v in value.items() if k!="digest"}
    value["digest"]=hashlib.sha256(json.dumps(unsigned,sort_keys=True,separators=(",",":"),ensure_ascii=True).encode("ascii")).hexdigest()
    return value


def wardrobe():
    return [WardrobeItem(i,i,t,5, "", color_tags=("navy",)) for i,t in
            [(T1,ItemType.top),(T2,ItemType.top),(B1,ItemType.bottom),(B2,ItemType.bottom),
             (O,ItemType.outer_layer),(S,ItemType.shoes),(D,ItemType.dress)]]


def draft(top=T1,bottom=B1,outer=None,shoe=None,dress=None):
    items=[(dress,Role.one_piece)] if dress else [(top,Role.base_top),(bottom,Role.base_bottom)]
    if outer: items.append((outer,Role.outer_layer))
    if shoe: items.append((shoe,Role.shoes))
    return outfit(items,[items[0][0]])


def request(raw=None,intent="daily",**overrides):
    args=dict(wardrobe=wardrobe(),forced_item_id=T1 if intent=="rescue_item" else None,
              occasion="Authored hard policy",weather="mild",session_id="owner",wardrobe_version=1,
              intent=intent,explicit_exclusions=raw)
    args.update(overrides)
    return RenderRequest(**args)


def http_body(raw,**overrides):
    return render_body(wardrobe=[wire_item(item.id,item.type.value) for item in wardrobe()],explicitExclusions=raw,**overrides)


def memberships(result):
    return {frozenset(i for i,_ in variant.items) for variant in result.variants}


def test_canonical_policy_roundtrip_and_input_mutation_cannot_change_frozen_policy():
    raw=policy(entry(1,"combination",[T1,B1]),entry(2,"item",[O],"saved"),saved_ref={"id":ident(99),"revision":7})
    frozen=normalize_explicit_exclusions(raw,REQUEST)
    assert frozen.to_wire()==raw
    wire=to_wire({"explicit_exclusions":raw})
    assert wire=={"explicitExclusions":raw} and from_wire(wire)=={"explicit_exclusions":raw}
    raw["entries"][0]["itemIds"].clear()
    assert is_excluded(frozen,[B1,T1]) and is_excluded(frozen,[T2,B2,O])
    assert to_wire({"explicit_exclusions":None})=={}
    with pytest.raises(ValueError): from_wire({"explicitExclusions":None})


def test_combination_is_exact_unordered_membership_not_subset_or_member_ban():
    rules=normalize_explicit_exclusions(policy(entry(1,"combination",[T1,B1]),entry(2,"combination",[D])))
    assert is_excluded(rules,[B1,T1]) and is_excluded(rules,[D])
    assert not is_excluded(rules,[T1]) and not is_excluded(rules,[T1,B2])
    assert not is_excluded(rules,[T1,B1,O]) and not is_excluded(rules,[D,O])
    assert not is_excluded(rules,[T2,B1,S])


@pytest.mark.parametrize("intent",["daily","rescue_item"])
def test_actual_pipeline_honors_exact_combo_keeps_member_and_superset_and_trace_parity(intent):
    raw=policy(entry(1,"combination",[T1,B1]))
    req=request(raw,intent)
    response=envelope(draft(),draft(bottom=B2),draft(outer=O))
    direct=render(req,StubGenerator(response)); traced=render_with_trace(req,StubGenerator(response))
    assert direct==traced.result
    assert memberships(direct)=={frozenset([T1,B2]),frozenset([T1,B1,O])}
    assert any(drop.drop_reason=="explicit_combination_excluded" for drop in traced.rescue_drops)
    assert traced.attempts[0].raw_text==response
    wire=to_wire(asdict(build_snapshot_payload(traced,req,request_id=REQUEST,candidate_cache_key="authored",generator_provider="stub",generator_model="stub",generator_temperature=0,generator_max_completion_tokens=2200)))
    assert wire["explicitExclusions"]==raw


@pytest.mark.parametrize("intent",["daily","rescue_item"])
def test_item_filter_removes_only_target_from_provider_pool_and_never_reenters(intent):
    raw=policy(entry(1,"item",[O]))
    req=request(raw,intent)
    gen=StubGenerator(envelope(draft(outer=O),draft(bottom=B2)))
    trace=render_with_trace(req,gen)
    assert O not in {item.id for item in trace.prompt_pool}
    assert O not in gen.prompts[0].user
    assert memberships(trace.result)=={frozenset([T1,B2])}
    assert trace.attempts[0].raw_text==gen._fixed


@pytest.mark.parametrize("intent,locks",[("rescue_item",()),("daily",(T1,))])
def test_kept_or_forced_item_conflict_never_calls_generator(intent,locks):
    req=request(policy(entry(1,"item",[T1])),intent,locked_item_ids=locks)
    for run in [render,render_with_trace]:
        gen=StubGenerator(envelope(draft()))
        with pytest.raises(ValueError,match="kept or forced"):
            run(req,gen)
        assert gen.call_count==0


def test_combo_shared_anchor_is_not_an_item_conflict():
    raw=policy(entry(1,"combination",[T1,B1]))
    req=request(raw,"rescue_item",locked_item_ids=(B1,))
    gen=StubGenerator(envelope(draft(),draft(outer=O)))
    assert memberships(render(req,gen))=={frozenset([T1,B1,O])}
    assert gen.call_count==1


def test_forbidden_candidates_never_reenter_any_ranker_fallback_or_layer_reservation():
    payload=json.loads(envelope(draft(),draft(outer=O),draft(dress=D),draft(bottom=B2)))
    candidates=validate_gpt_payload(payload,wardrobe(),4).candidates
    raw=policy(entry(1,"combination",[T1,B1]),entry(2,"combination",[T1,B1,O]),entry(3,"combination",[D]))
    frozen=normalize_explicit_exclusions(raw)
    baseline_context=RankerContext(session_id="owner",wardrobe_version=1,occasion="test",weather="mild",generation_index=0,k=20)
    # Every otherwise eligible candidate is cooldown reserved; fallback must reopen only the legal one.
    context=replace(baseline_context,explicit_exclusions=frozen,recent_disliked_base_keys=tuple(dict.fromkeys(c.base_key for c in candidates)))
    result=rank(candidates,context)
    assert len(result.outfits)==1 and frozenset([T1,B2])==frozenset([result.outfits[0].slot_map.top,result.outfits[0].slot_map.bottom])
    assert all(not is_excluded(frozen,[v for v in vars(row.slot_map).values() if v]) for row in result.outfits)
    audit=rank_with_audit(candidates,context)
    assert audit.result==result
    req=request(raw,weather_signals={"rain":True,"wind":False})
    assert eligible_signatures(req,candidates)==frozenset()
    # Defense even against a direct response-layer caller supplying an unfiltered ranked pool.
    unfiltered=rank(candidates,baseline_context)
    assert len(selection_pool(unfiltered,req).outfits)==1
    variants,_=build_variants(unfiltered,{i.id:i for i in wardrobe()},req,3)
    assert {frozenset(i for i,_ in v.items) for v in variants}=={frozenset([T1,B2])}
    all_blocked=policy(*raw["entries"],entry(4,"combination",[T1,B2]))
    assert not rank(candidates,replace(context,explicit_exclusions=normalize_explicit_exclusions(all_blocked))).outfits


def test_forbidden_composition_never_enters_learner_candidate_features(monkeypatch):
    from fitted_core import preferences
    from tests.test_style_preference_integration import STYLE
    seen=[]; original=preferences.evaluate_preferences
    def inspect(rows,candidates,*args,**kwargs):
        seen.extend(candidates)
        return original(rows,candidates,*args,**kwargs)
    monkeypatch.setattr(preferences,"evaluate_preferences",inspect)
    raw=policy(entry(1,"combination",[T1,B1]))
    req=request(raw,style_context={**STYLE,"weather":"mild"})
    trace=render_with_trace(req,StubGenerator(envelope(draft(),draft(bottom=B2))))
    assert len(seen)==1 and {i["id"] for i in seen[0]["items"]}=={T1,B2}
    assert trace.preference_metadata["support"]==0


@pytest.mark.parametrize("mode",["normal","empty","parse_failure","engine_failure"])
def test_http_self_versioned_policy_echoes_and_persists_without_style_protocol_in_all_outcomes(mode):
    raw=policy(entry(1,"combination",[T1,B1]))
    body=http_body(raw)
    response=envelope(draft(),draft(bottom=B2))
    if mode=="empty": response=envelope(draft())
    if mode=="parse_failure": response="not JSON"
    class Broken:
        def generate(self,prompt): raise RuntimeError("authored failure")
    app,gen=make_app(response,generator=Broken() if mode=="engine_failure" else None)
    status,result=http(app,"POST","/render",headers=AUTH,json_body=body)
    assert status==200 and result["explicitExclusions"]==raw and result["payload"]["explicitExclusions"]==raw
    assert "protocolVersion" not in result and "styleContext" not in result
    assert all(frozenset(i["itemId"] for i in row["outfit"]["items"])!=frozenset([T1,B1]) for row in result["shown"])
    if mode!="normal": assert result["shown"]==[]
    if mode=="empty": assert gen.call_count==1
    if mode=="parse_failure": assert gen.call_count==2


def test_all_item_bases_excluded_returns_empty_without_provider_and_keeps_policy():
    raw=policy(*(entry(index,"item",[item]) for index,item in enumerate([T1,T2,D],1)))
    app,gen=make_app(envelope(draft()))
    status,result=http(app,"POST","/render",headers=AUTH,json_body=http_body(raw))
    assert status==200 and not result["shown"] and gen.call_count==0
    assert result["payload"]["explicitExclusions"]==raw and result["explicitExclusions"]==raw


def test_inert_saved_unavailable_targets_are_not_rejected_as_stale_transient_controls():
    raw=policy(entry(1,"item",[ident(900)],"saved"),entry(2,"combination",[ident(901)],"saved"),saved_ref={"id":ident(99),"revision":2})
    app,gen=make_app(envelope(draft()))
    status,result=http(app,"POST","/render",headers=AUTH,json_body=http_body(raw))
    assert status==200 and result["shown"] and gen.call_count==1 and result["explicitExclusions"]==raw


@pytest.mark.parametrize("kind",["forced","locked"])
def test_http_item_pin_conflict_is_contract_invalid_before_provider(kind):
    raw=policy(entry(1,"item",[T1]))
    body=http_body(raw)
    if kind=="forced":
        body["intent"]="rescue_item"; body["lens"]["forcedItemId"]=T1
    else:
        body.update(parentSnapshotId=ident(888),generationIndex=1,controls={"lockedItemIds":[T1],"dislikedItemIds":[]})
    app,gen=make_app(envelope(draft()))
    status,result=http(app,"POST","/render",headers=AUTH,json_body=body)
    assert status==400 and result["error"]["code"]=="contract_invalid" and gen.call_count==0


@pytest.mark.parametrize("mutate",[
    lambda p:p.update(extra=True), lambda p:p.update(version="unknown"),lambda p:p.update(requestId="42222222-2222-4222-8222-222222222222"),
    lambda p:p.update(savedRef={"id":ident(99),"revision":0}),lambda p:p["entries"][0].update(scope="saved"),
    lambda p:p["entries"].append({**p["entries"][0],"id":ident(999)}),
    lambda p:p["entries"][0].update(scope=["request"]),lambda p:p["entries"][0].update(kind=["item"]),
    lambda p:p["entries"][0].update(scope="owner"),lambda p:p["entries"][0].update(kind="pair"),
    lambda p:p["entries"][0].update(revision=True),lambda p:p["entries"][0].update(revision=0),lambda p:p["entries"][0].update(revision=2**53),
    lambda p:p["entries"][0].update(extra=True),lambda p:p["entries"][0].update(itemIds=[T1,T1]),
    lambda p:p["entries"][0].update(itemIds=[T1,B1]),lambda p:p["entries"][0].update(itemIds=[]),
    lambda p:p["entries"][0].update(itemIds=[123]),lambda p:p["entries"].append(deepcopy(p["entries"][0])),
    lambda p:p["entries"][0].update(id="A"*24),lambda p:p.update(entries={}),
])
def test_strict_policy_rejects_malformed_semantics_preprovider_even_with_correct_digest(mutate):
    raw=policy(entry(1,"item",[O])); mutate(raw); resign(raw)
    app,gen=make_app(envelope(draft()))
    status,result=http(app,"POST","/render",headers=AUTH,json_body=http_body(raw))
    assert status==400 and result["error"]["code"]=="contract_invalid" and gen.call_count==0


def test_bad_digest_null_noncanonical_order_and_overflow_reject_preprovider():
    variants=[]
    bad=policy(entry(1,"item",[O])); bad["digest"]="0"*64; variants.append(bad)
    reverse=policy(entry(1,"combination",[T1,B1])); reverse["entries"][0]["itemIds"].reverse(); variants.append(resign(reverse))
    reverse=policy(entry(1,"item",[O]),entry(2,"item",[S])); reverse["entries"].reverse(); variants.append(resign(reverse))
    variants.append(policy(*(entry(i,"combination",[ident(1000+i)]) for i in range(21))))
    variants.append(None)
    for raw in variants:
        app,gen=make_app(envelope(draft()))
        status,result=http(app,"POST","/render",headers=AUTH,json_body=http_body(raw))
        assert status==400 and result["error"]["code"]=="contract_invalid" and gen.call_count==0


def test_each_scope_kind_bound_accepts_80_combined_entries_and_rejects_81_without_truncation():
    rows=[]
    for scope in ("saved","request"):
        for kind in ("item","combination"):
            start=len(rows)
            rows.extend([entry(start+i+1,kind,[ident(1000+start+i)],scope) for i in range(20)])
    raw=policy(*rows,saved_ref={"id":ident(99),"revision":1})
    assert len(normalize_explicit_exclusions(raw).entries)==80
    with pytest.raises(ValueError,match="80"):
        normalize_explicit_exclusions(policy(*rows,entry(500,"item",[ident(2000)]),saved_ref=raw["savedRef"]))


def test_one_piece_exact_exclusion_does_not_ban_same_dress_with_optional_layer():
    raw=policy(entry(1,"combination",[D]))
    req=request(raw)
    response=envelope(draft(dress=D),draft(dress=D,outer=O))
    trace=render_with_trace(req,StubGenerator(response))
    assert memberships(trace.result)=={frozenset([D,O])}
    assert any(drop.drop_reason=="explicit_combination_excluded" for drop in trace.rescue_drops)


def test_snapshot_serde_rejects_policy_bound_to_another_command():
    raw=policy(entry(1,"item",[O]))
    other="42222222-2222-4222-8222-222222222222"
    with pytest.raises(ValueError,match="does not match"):
        to_wire({"request_id":other,"explicit_exclusions":raw})
    with pytest.raises(ValueError,match="does not match"):
        from_wire({"requestId":other,"explicitExclusions":raw})


def test_exclusion_wire_guards_do_not_reinterpret_frozen_raw_blobs():
    raw={"explicit_exclusions":None,"explicitExclusions":"literal authored content","requestId":"literal"}
    wire=to_wire({"raw_emitted":raw})
    assert wire=={"rawEmitted":raw}
    assert from_wire(wire)=={"raw_emitted":raw}
