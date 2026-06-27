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
from fitted_core.response import build_variants, build_variants_with_trace
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
        trace, request, candidate_cache_key="ck-c6",
        generator_provider="openai", generator_model="gpt-4o", generator_temperature=0.8,
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


def test_not_enough_items_exit_builds_a_degenerate_payload():
    # A forced item with no possible pairing → pre-GPT not_enough_items; the snapshot is still valid.
    request = RescueRequest(
        wardrobe=[_item("t1", ItemType.top)],  # a top with no bottom → no 2-piece possible
        forced_item_id="t1", occasion="x", weather="mild", session_id="s", wardrobe_version=1,
    )
    payload = _payload(request=request, envelope=_envelope())
    assert payload.diagnostics.not_enough_items is True
    assert payload.candidates == ()
    assert payload.item_snapshots == ()  # no prompt built → no engine-visible items
    assert payload.generation_attempts == ()
