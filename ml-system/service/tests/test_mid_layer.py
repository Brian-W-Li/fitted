"""R23 service request→prompt→validation→shown snapshot integration."""
import pytest

from fitted_core.models import Role
from service.tests.helpers import AUTH, envelope, http, make_app, outfit, regen_body, rescue_body, wire_item


def wardrobe():
    return [wire_item("tee", "top"), wire_item("mid", "top", layerRole="mid"), wire_item("pants", "bottom"), wire_item("shoe", "shoes"), wire_item("jacket", "outer_layer")]


def layered_response(outer=False):
    entries = [("tee", Role.base_top), ("pants", Role.base_bottom), ("mid", Role.mid_layer), ("shoe", Role.shoes)]
    if outer:
        entries.append(("jacket", Role.outer_layer))
    return envelope(outfit(entries, ["mid"]))


@pytest.mark.parametrize("outer", [False, True])
def test_rescue_layered_shown_members_and_snapshot_match(outer):
    app, stub = make_app(layered_response(outer))
    status, body = http(app, "POST", "/render", headers=AUTH, json_body=rescue_body(wardrobe=wardrobe(), lens={"forcedItemId": "tee"}))
    assert status == 200 and body["shown"]
    shown = body["shown"][0]["outfit"]
    assert {e["itemId"] for e in shown["items"]} == {"tee", "mid", "pants", "shoe"} | ({"jacket"} if outer else set())
    assert shown["fullSignature"] == f"tee:pants|outer={'jacket' if outer else 'none'}|shoes=shoe|mid=mid"
    snapshot = next(c for c in body["payload"]["candidates"] if c["candidateId"] == body["shown"][0]["candidateId"])
    assert snapshot["slotMap"]["mid"] == "mid"
    assert snapshot["items"] == shown["items"]
    mid_snapshot = next(i for i in body["payload"]["itemSnapshots"] if i["itemId"] == "mid")
    assert mid_snapshot["engineVisible"]["layerRole"] == "mid"
    assert 'mid_layer' in stub.prompts[0].system
    assert '"layer_role": "mid"' in stub.prompts[0].user


def test_two_top_locks_allow_exactly_one_mid_and_mid_avoid_drops_layered_candidate():
    for marked in ("mid", None):
        closet = wardrobe()
        closet[1]["layerRole"] = marked
        app, stub = make_app(layered_response())
        status, body = http(app, "POST", "/render", headers=AUTH, json_body=regen_body(wardrobe=closet, controls={"lockedItemIds": ["tee", "mid"], "dislikedItemIds": []}))
        assert status == (200 if marked else 400)
        assert bool(body.get("shown")) == bool(marked)
        if not marked:
            assert stub.call_count == 0
    app, _ = make_app(layered_response())
    status, body = http(app, "POST", "/render", headers=AUTH, json_body=regen_body(wardrobe=wardrobe(), controls={"lockedItemIds": [], "dislikedItemIds": ["mid"]}))
    assert status == 200 and not body["shown"]


@pytest.mark.parametrize("bad", ["unknown", "", True, [], {}])
def test_layer_role_unknown_wire_values_reject_pre_spend(bad):
    closet = wardrobe()
    closet[1]["layerRole"] = bad
    app, stub = make_app(layered_response())
    status, _ = http(app, "POST", "/render", headers=AUTH, json_body=rescue_body(wardrobe=closet, lens={"forcedItemId": "tee"}))
    assert status == 400 and stub.call_count == 0


def test_legacy_omitted_layer_role_remains_valid_and_does_not_grant_mid_eligibility():
    closet = wardrobe()
    for i in closet:
        i.pop("layerRole")
    app, _ = make_app(envelope(outfit([("mid", Role.base_top), ("pants", Role.base_bottom)], ["mid"])))
    status, body = http(app, "POST", "/render", headers=AUTH, json_body=rescue_body(wardrobe=closet, lens={"forcedItemId": "mid"}))
    assert status == 200 and body["shown"]
    assert body["shown"][0]["outfit"]["fullSignature"] == "mid:pants|outer=none|shoes=none"



@pytest.mark.parametrize("marked", ["mid", "base"])
def test_two_top_locks_with_matching_eligibility_are_rejected(marked):
    closet = wardrobe()
    closet[0]["layerRole"] = marked
    closet[1]["layerRole"] = marked
    app, stub = make_app(layered_response())
    status, _ = http(app, "POST", "/render", headers=AUTH, json_body=regen_body(wardrobe=closet, controls={"lockedItemIds": ["tee", "mid"], "dislikedItemIds": []}))
    assert status == 400 and stub.call_count == 0


def test_exact_membership_exclusion_includes_mid():
    app, _ = make_app(layered_response())
    status, body = http(app, "POST", "/render", headers=AUTH, json_body=regen_body(wardrobe=wardrobe(), controls={"lockedItemIds": [], "dislikedItemIds": [], "excludedOutfitItemIds": ["tee", "mid", "pants", "shoe"]}))
    assert status == 200 and not body["shown"]
