"""C8 — end-to-end data-contract composition (plan §14 C8).

Proves the M4b seam composes WITHOUT a live route or the authenticity gate (both M5):

    seeded WardrobeItem rows (post-C2 shape: 5-value clothingType + warmth)
        → rescue_with_trace → build_snapshot_payload   (C6)
        → snapshot_serde.to_wire                        (C4)
        → a camelCase GenerationSnapshot wire doc
        → an OutfitInteraction {snapshotId, candidateId, baseKey, fullSignature} binding (C1)
          that round-trips back to the snapshot candidate's server-re-read keys.

The wire doc is also frozen as a committed fixture (``fixtures/m4b_e2e_snapshot.json``) that the
TS side validates against the real C5 Mongoose schema (``fitted/tests/m4bSnapshotContract.test.ts``)
— the cross-language half of this same seam. This test guards that the fixture stays in sync with
a fresh build, so the two languages can never silently diverge.
"""

import dataclasses
import json
import pathlib

from fitted_core.models import ItemType, Role, WardrobeItem
from fitted_core.rescue import RescueRequest, rescue_with_trace
from fitted_core.snapshot import build_snapshot_payload
from fitted_core import snapshot_serde
from tests.helpers import StubGenerator

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "m4b_e2e_snapshot.json"


def _item(item_id: str, item_type: ItemType, warmth: int) -> WardrobeItem:
    # post-C2 shape: a 5-value clothingType + a keyword-derived warmth (here: seeded directly).
    return WardrobeItem(
        item_id, f"{item_id} name", item_type, warmth=warmth, image_url=f"https://img/{item_id}.png",
        style_tags=["solid"], color_tags=["navy"], occasion_tags=["casual"],
    )


def _vp(item_id: str, role: Role) -> dict:
    return {"itemId": item_id, "role": role.value}


def _outfit(items: list[tuple[str, Role]], changed: list[str], *, style_move: bool = True) -> dict:
    outfit: dict = {"items": [_vp(i, r) for i, r in items]}
    if style_move:
        outfit["styleMove"] = {"moveType": "layer", "changedItemIds": list(changed), "oneSentence": "An idea."}
    return outfit


def _e2e_request() -> RescueRequest:
    return RescueRequest(
        wardrobe=[
            _item("t1", ItemType.top, 4),
            _item("b1", ItemType.bottom, 5),
            _item("b2", ItemType.bottom, 5),
            _item("b3", ItemType.bottom, 6),
            _item("s1", ItemType.shoes, 3),
        ],
        forced_item_id="t1",
        occasion="weekend brunch",
        weather="mild",
        session_id="user-e2e",
        wardrobe_version=3,
        n_surfaced=3,
    )


def _e2e_envelope() -> str:
    # 4 valid distinct outfits (accepted → scored; only n_surfaced=3 surface, so one is
    # scored-but-unshown) + 1 rejected (ghost id) + 1 rescue-dropped (no styleMove): a snapshot
    # exercising every funnel disposition.
    return json.dumps(
        {
            "outfits": [
                _outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]),
                _outfit([("t1", Role.base_top), ("b2", Role.base_bottom)], ["t1"]),
                _outfit([("t1", Role.base_top), ("b3", Role.base_bottom), ("s1", Role.shoes)], ["s1"]),
                _outfit([("t1", Role.base_top), ("b2", Role.base_bottom), ("s1", Role.shoes)], ["s1"]),
                _outfit([("t1", Role.base_top), ("b3", Role.base_bottom)], ["t1"], style_move=False),
                _outfit([("t1", Role.base_top), ("ghost", Role.base_bottom)], ["t1"]),
            ]
        }
    )


def _build_e2e_wire() -> dict:
    """Deterministically build the camelCase GenerationSnapshot wire doc (the Python half)."""
    request = _e2e_request()
    trace = rescue_with_trace(request, StubGenerator(_e2e_envelope()))
    # This fixture is the current Python→TS/Mongo contract artifact, not historical H40
    # evidence; use the M5 generator provenance shape that the live writer must persist.
    payload = build_snapshot_payload(
        trace, request, candidate_cache_key="ck-e2e",
        request_id="e1111111-1111-4111-8111-111111111111",
        generator_provider="openai", generator_model="gpt-5.4-mini", generator_temperature=0.5,
        generator_max_completion_tokens=2200,
    )
    return snapshot_serde.to_wire(dataclasses.asdict(payload))


# --- the seam composes -------------------------------------------------------


def test_wire_doc_is_a_complete_python_authored_snapshot():
    wire = _build_e2e_wire()
    # identity / provenance (the required-non-null block) + the funnel arrays + diagnostics.
    for key in (
        "sessionId", "candidateCacheKey", "generationIndex", "intent", "occasion", "weather",
        "wardrobeVersion", "fittedCoreVersion", "generator", "rankerConfigVersion", "scorer",
        "itemSnapshots", "generationAttempts", "candidates", "diagnostics",
        "shownCandidateIds", "shownFullSignatures",
    ):
        assert key in wire, f"missing {key}"
    assert {
        "provider",
        "model",
        "temperature",
        "promptVersion",
        "promptCacheRetention",
        "timeoutSeconds",
        "maxRetries",
    } <= set(wire["generator"])
    assert {"kind", "available"} <= set(wire["scorer"])
    # the engineVisible partition key crossed as clothingType (serde rename).
    assert wire["itemSnapshots"][0]["engineVisible"]["clothingType"] in {"top", "bottom", "shoes"}


def test_funnel_dispositions_all_present_in_the_wire_doc():
    wire = _build_e2e_wire()
    cands = wire["candidates"]
    assert any(c["rejectionCodes"] for c in cands), "a validation-rejected candidate"
    assert any(c.get("dropStage") == "rescue" for c in cands), "a rescue-dropped candidate"
    assert sum(1 for c in cands if c["shown"]) == 3, "the surfaced set"
    assert any(c.get("scoreTrace") and not c["shown"] for c in cands), "a scored-but-unshown candidate"
    # every non-accepted candidate kept content (the §8.2-F invariant survived serialization).
    for c in cands:
        if not c["accepted"]:
            assert c.get("rawEmitted") is not None or (c.get("items") and c.get("slotMap"))


def test_outfit_interaction_binding_round_trips_to_the_snapshot():
    wire = _build_e2e_wire()
    snapshot_id = "65a1f000000000000000abcd"  # a TS-preallocated ObjectId-string (opaque to Python)

    # The server re-reads the candidate from the snapshot (never the client echo) and server-sets
    # the binding keys — exactly the M5 contract, modelled here without a live route.
    shown_id = wire["shownCandidateIds"][0]
    candidate = next(c for c in wire["candidates"] if c["candidateId"] == shown_id)
    binding = {
        "snapshotId": snapshot_id,
        "candidateId": shown_id,
        "baseKey": candidate["baseKey"],
        "fullSignature": candidate["fullSignature"],
    }

    # membership: the bound candidateId was actually shown.
    assert binding["candidateId"] in wire["shownCandidateIds"]
    # round-trip: the binding's keys equal the candidate's keys in the immutable snapshot.
    rereadable = next(c for c in wire["candidates"] if c["candidateId"] == binding["candidateId"])
    assert binding["baseKey"] == rereadable["baseKey"]
    assert binding["fullSignature"] == rereadable["fullSignature"]
    assert binding["fullSignature"] in wire["shownFullSignatures"]


# --- cross-language drift guard ----------------------------------------------


def test_committed_fixture_matches_a_fresh_build():
    # The TS side validates the COMMITTED fixture against the real C5 schema; this guards that the
    # fixture stays byte-identical to a fresh Python build, so the two halves never silently drift.
    assert FIXTURE.exists(), f"missing {FIXTURE} — regenerate it (see the module docstring)"
    committed = json.loads(FIXTURE.read_text())
    assert committed == _build_e2e_wire(), "fixture is stale — regenerate m4b_e2e_snapshot.json"
