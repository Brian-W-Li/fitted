"""Local browser-fixture contract only. These authored labels are not human evidence."""
import json

from fitted_core.generation import GenerationPrompt
from service.baseline_app import BaselineGenerator, STYLE_QUERY_GROUPS, _fixture
from service.tests.helpers import AUTH, http, make_app, wire_item
from tests.test_style_preference_integration import service_case


def prompt(ids):
    return GenerationPrompt("synthetic", "Build believable outfits for this occasion and weather from this wardrobe:\n" +
                            json.dumps([{"id": ident} for ident in ids]) + "\n\nReturn up to 12 outfits.", 12)


def test_only_complete_explicit_query_groups_are_emitted_and_old_fixture_is_unchanged(monkeypatch):
    monkeypatch.setenv("FITTED_BASELINE_ITEM_IDS", ",".join(f"65000000000000000000000{n}" for n in range(1, 7)))
    generator = BaselineGenerator()
    assert generator.generate(prompt(["ordinary-id"])) == _fixture()
    all_ids = [ident for group in STYLE_QUERY_GROUPS for ident in group]
    rows = json.loads(generator.generate(prompt(all_ids)))["outfits"]
    assert len(rows) == 4
    assert [[item["itemId"] for item in row["items"]] for row in rows] == [list(group) for group in STYLE_QUERY_GROUPS]
    partial = json.loads(generator.generate(prompt([*STYLE_QUERY_GROUPS[0], STYLE_QUERY_GROUPS[1][0]])))["outfits"]
    assert len(partial) == 1
    assert [item["itemId"] for item in partial[0]["items"]] == list(STYLE_QUERY_GROUPS[0])
    # Mentioning an ID outside the wardrobe JSON never activates the query fixture.
    ordinary = prompt(["ordinary-id"])
    assert generator.generate(GenerationPrompt("synthetic", "Occasion: " + all_ids[0] + "\n" + ordinary.user, 12)) == _fixture()


def test_activated_browser_fixture_changes_actual_http_surfaced_membership_on_disjoint_garments():
    body, _ = service_case()
    fits = (("slim", "slim"), ("relaxed", "relaxed"), ("slim", "relaxed"), ("relaxed", "slim"))
    wardrobe = []
    for (top, bottom, shoes), (tf, bf) in zip(STYLE_QUERY_GROUPS, fits):
        wardrobe += [wire_item(top, "top", subtype="shirt", colorTags=["white"], pattern="solid", fit=tf),
                     wire_item(bottom, "bottom", subtype="pants", colorTags=["blue"], pattern="solid", fit=bf),
                     wire_item(shoes, "shoes", subtype="sneakers", colorTags=["gray"])]
    body["wardrobe"] = wardrobe
    app, _ = make_app(generator=BaselineGenerator())
    status, result = http(app, "POST", "/render", headers=AUTH, json_body=body)
    assert status == 200 and len(result["shown"]) == 3
    decision = result["preference"]
    assert decision["status"] == "fitted_experimental", decision
    assert decision["support"] == 12 and decision["likes"] == decision["dislikes"] == 6
    assert set(decision["shownFullSignatures"]) != set(decision["baselineShownFullSignatures"])
    assert decision["shownFullSignatures"] == result["payload"]["shownFullSignatures"]
