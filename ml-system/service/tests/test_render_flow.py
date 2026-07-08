"""POST /render flow tests (C3 acceptance): happy daily/rescue, the §A shown-identity zip,
the §D degenerate arms (both recording loci), §A.6 refusal/truncation routing, and the
§G.1 echo-through + §A.6 generator-provenance read-backs — all on a fake ``Generator``."""


from fitted_core.generation import FinishStatus
from fitted_core.models import Role
from fitted_core.reducers import AffinitySignalScorer
from fitted_core.seed import candidate_cache_key
from service.tests.helpers import (
    AUTH,
    ENV,
    daily_envelope,
    envelope,
    http,
    make_app,
    outfit,
    render_body,
    rescue_body,
    wire_item,
)


class FinishStatusGenerator:
    """A stub exposing per-call finish statuses the way ``OpenAIGenerator`` does."""

    def __init__(self, response: str, status: FinishStatus) -> None:
        self._response = response
        self._status = status
        self.call_count = 0
        self.last_finish_status = None

    def generate(self, prompt) -> str:
        self.call_count += 1
        self.last_finish_status = self._status
        return self._response


class RaisingGenerator:
    def __init__(self) -> None:
        self.call_count = 0

    def generate(self, prompt) -> str:
        self.call_count += 1
        raise RuntimeError("boom")


def _render(json_body, *, responses=None, generator=None, env=None):
    app, stub = make_app(
        responses if responses is not None else daily_envelope(),
        generator=generator,
        env=env,
    )
    status, body = http(app, "POST", "/render", headers=AUTH, json_body=json_body)
    return status, body, stub


# --- happy paths -----------------------------------------------------------------------


def test_daily_render_returns_a_valid_payload_and_bound_shown_set():
    status, body, stub = _render(render_body())
    assert status == 200
    assert set(body) == {"payload", "shown", "flags", "degenerate"}
    assert body["degenerate"] is False
    payload = body["payload"]
    # §A shown-identity pin: shown[].candidateId equals payload.shownCandidateIds in order.
    assert [entry["candidateId"] for entry in body["shown"]] == payload["shownCandidateIds"]
    assert len(body["shown"]) == payload["nSurfaced"] == 3
    shown_ids = {c["candidateId"] for c in payload["candidates"]}
    for entry in body["shown"]:
        assert entry["candidateId"] in shown_ids
        wire_outfit = entry["outfit"]
        assert {"items", "templateType", "optionPath", "risk", "styleMove", "score",
                "scoreBreakdown", "baseKey", "fullSignature", "compatibility",
                "visibility"} == set(wire_outfit)
        assert all(set(i) == {"itemId", "role"} for i in wire_outfit["items"])
    # flags carry the RenderResult state (spreadCollapsed legitimately varies with how the
    # three similar outfits bucket — assert it mirrors the payload, not a fixed value).
    assert body["flags"]["notEnoughItems"] is False
    assert body["flags"]["insufficientAfterGeneration"] is False
    assert body["flags"]["reasonHint"] is None
    assert body["flags"]["spreadCollapsed"] == payload["spreadCollapsed"]
    assert stub.call_count == 1


def test_rescue_render_forces_the_item_through_every_shown_outfit():
    rescue_envelope = envelope(
        outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]),
        outfit([("t1", Role.base_top), ("b2", Role.base_bottom)], ["t1"]),
        outfit([("t1", Role.base_top), ("b1", Role.base_bottom), ("s1", Role.shoes)], ["s1"]),
    )
    status, body, _ = _render(rescue_body(), responses=rescue_envelope)
    assert status == 200
    assert body["payload"]["intent"] == "rescue_item"
    assert body["payload"]["forcedItemId"] == "t1"
    assert body["shown"]
    for entry in body["shown"]:
        assert any(i["itemId"] == "t1" for i in entry["outfit"]["items"])


def test_shown_zip_binds_by_full_signature_when_ranking_reorders_generation_order():
    # C3 acceptance fixture: the top-shown variant is NOT the first-generated candidate —
    # outfit 0 is a low-compatibility clash (non-neutral warm+cool, max formality spread),
    # outfits 1–2 are cohesive neutrals, and select_spread re-sorts compatibility-led at
    # cold start. A naive index-zip of shown[] against payload.candidates[] would mis-bind;
    # the full_signature zip must still bind each candidateId correctly.
    wardrobe = [
        wire_item("tl", "top", colorTags=["red"], styleTags=["bold"], formality="black tie"),
        wire_item("t1", "top"),
        wire_item("bl", "bottom", colorTags=["green"], formality="loungewear"),
        wire_item("b1", "bottom"),
    ]
    reordering_envelope = envelope(
        outfit([("tl", Role.base_top), ("bl", Role.base_bottom)], ["tl"]),  # c0 — the clash
        outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]),  # c1 — cohesive
        outfit([("tl", Role.base_top), ("b1", Role.base_bottom)], ["tl"]),  # c2 — mixed
    )
    status, body, _ = _render(render_body(wardrobe=wardrobe), responses=reordering_envelope)
    assert status == 200
    payload = body["payload"]
    shown = body["shown"]
    assert len(shown) == 3
    # Fixture validity guard: ranking actually reordered — first-shown ≠ first-generated.
    assert shown[0]["candidateId"] != "c0", "fixture failed to reorder; strengthen the clash"
    # The zip is correct: each shown outfit's fullSignature matches ITS bound candidate...
    by_id = {c["candidateId"]: c for c in payload["candidates"]}
    for entry in shown:
        assert entry["outfit"]["fullSignature"] == by_id[entry["candidateId"]]["fullSignature"]
    # ...while an index-zip against candidates[] (funnel order) would mis-bind.
    assert shown[0]["outfit"]["fullSignature"] != payload["candidates"][0]["fullSignature"]
    assert [e["candidateId"] for e in shown] == payload["shownCandidateIds"]


def test_daily_not_enough_items_is_a_valid_empty_render_with_zero_spend():
    status, body, stub = _render(render_body(wardrobe=[wire_item("t1", "top")]))
    assert status == 200
    assert stub.call_count == 0  # pre-GPT short-circuit — no generator call (§B)
    assert body["degenerate"] is False  # a VALID empty render, not an engine failure
    assert body["shown"] == []
    assert body["flags"]["notEnoughItems"] is True
    assert body["flags"]["reasonHint"]
    payload = body["payload"]
    assert payload["generationAttempts"] == []
    assert payload["nSurfaced"] == 0
    assert payload["itemSnapshots"], "the engine-visible pool must still be captured"
    assert payload["diagnostics"]["engineFailure"] is None


# --- §D degenerate arms ---------------------------------------------------------------


def test_parse_fail_after_repair_is_a_degenerate_payload_with_attempts():
    status, body, stub = _render(render_body(), responses=["{ bad", "{ still bad"])
    assert status == 200  # never the contract_invalid envelope — the request was valid
    assert body["degenerate"] is True
    assert body["shown"] == []
    attempts = body["payload"]["generationAttempts"]
    assert len(attempts) == 2 and attempts[1]["isRepair"] is True
    assert not attempts[1]["payloadParsed"]
    # Recording-locus split: money spent WITH attempts → no engineFailure record.
    assert body["payload"]["diagnostics"]["engineFailure"] is None
    assert stub.call_count == 2


def test_model_refusal_routes_to_the_degenerate_corpus_with_finish_status():
    generator = FinishStatusGenerator("", FinishStatus("stop", "I can't help with that."))
    status, body, _ = _render(render_body(), generator=generator)
    assert status == 200
    assert body["degenerate"] is True
    payload = body["payload"]
    attempts = payload["generationAttempts"]
    assert attempts and attempts[-1]["finishStatus"] == {
        "finishReason": "stop",
        "refusal": "I can't help with that.",
    }
    assert payload["generator"]["finishStatus"] == {"finishReason": "stop", "refused": True}


def test_cap_truncated_response_routes_to_the_degenerate_corpus():
    generator = FinishStatusGenerator('{"outfits": [', FinishStatus("length", None))
    status, body, _ = _render(render_body(), generator=generator)
    assert status == 200
    assert body["degenerate"] is True
    assert body["payload"]["generator"]["finishStatus"] == {
        "finishReason": "length",
        "refused": False,
    }


def test_clean_run_leaves_generator_finish_status_unset():
    generator = FinishStatusGenerator(daily_envelope(), FinishStatus("stop", None))
    status, body, _ = _render(render_body(), generator=generator)
    assert status == 200 and body["degenerate"] is False
    assert "finishStatus" not in body["payload"]["generator"]
    assert body["payload"]["generationAttempts"][0]["finishStatus"] == {
        "finishReason": "stop",
        "refusal": None,
    }


def test_pre_generation_internal_failure_yields_engine_failure_with_empty_attempts(monkeypatch):
    import fitted_core.rescue as rescue_module

    def explode(*args, **kwargs):
        raise RuntimeError("sampler blew up")

    monkeypatch.setattr(rescue_module, "build_candidate_pool", explode)
    status, body, stub = _render(render_body())
    assert status == 200  # never a 500 that drops the failure corpus
    assert body["degenerate"] is True
    assert stub.call_count == 0
    payload = body["payload"]
    assert payload["generationAttempts"] == []  # never fabricate an attempt
    failure = payload["diagnostics"]["engineFailure"]
    assert failure["stage"] == "pre_generation"
    assert failure["code"] == "internal_exception"
    assert "Traceback" not in failure["message"] and "boom" not in failure["message"]
    # The §G.1 identity set rides the degenerate write (the §C.4 index needs requestId).
    assert payload["requestId"] == render_body()["requestId"]
    assert payload["sessionId"] == "user-service"
    assert payload["candidateCacheKey"]
    assert payload["generator"]["maxCompletionTokens"] == 2200


def test_mid_generation_exception_is_recorded_without_a_fabricated_attempt():
    generator = RaisingGenerator()
    status, body, _ = _render(render_body(), generator=generator)
    assert status == 200
    assert generator.call_count == 1
    payload = body["payload"]
    assert payload["generationAttempts"] == []  # the known §D micro-gap: raw text is lost...
    failure = payload["diagnostics"]["engineFailure"]  # ...but the failure IS recorded
    assert failure["stage"] == "unknown"
    assert failure["code"] == "internal_exception"


# --- provenance + echo-through (§A.6 / §G.1) --------------------------------------------


def test_payload_generator_block_is_authored_from_service_config_not_the_wire():
    env = {**ENV, "M5_MAX_COMPLETION_TOKENS": "3000"}
    body_json = render_body(generator={"maxCompletionTokens": 3000})
    status, body, _ = _render(body_json, env=env)
    assert status == 200
    generator = body["payload"]["generator"]
    assert generator["provider"] == "openai"
    assert generator["model"] == "gpt-5.4-mini"
    assert generator["temperature"] == 0.5
    assert generator["maxCompletionTokens"] == 3000
    assert generator["apiSurface"] == "chat_completions"
    assert generator["responseFormat"] == "json_schema_strict"
    assert generator["reasoningEffort"] == "none"
    assert generator["storeMode"] == "none"
    assert generator["promptVersion"]
    # And the exact-match half: a wire expectation that trails the config is rejected.
    status, response, stub = _render(render_body(), env=env)  # wire still says 2200
    assert status == 400 and response["error"]["code"] == "contract_invalid"
    assert stub.call_count == 0


def test_payload_carries_the_echo_through_lens_fields():
    status, body, _ = _render(render_body())
    payload = body["payload"]
    assert payload["requestId"] == "41111111-1111-4111-8111-111111111111"
    assert payload["parentSnapshotId"] is None
    assert payload["weatherRaw"] == "72F sunny"
    assert payload["location"] == "Santa Barbara, CA"
    assert payload["constraints"] == {}
    assert payload["seedDate"] == "2026-07-07"


def test_candidate_cache_key_is_the_c1_lens_chain_key():
    status, body, _ = _render(render_body())
    expected = candidate_cache_key(
        session_id="user-service",
        wardrobe_version=3,
        occasion="weekend brunch",
        weather="mild",
        intent="daily",
        forced_item_id=None,
        seed_date="2026-07-07",
    )
    assert body["payload"]["candidateCacheKey"] == expected


def test_behavioral_rows_reach_the_reducers_and_the_sampler_scorer(monkeypatch):
    import service.app as app_module

    captured = {}
    real = app_module.render_with_trace

    def spy(request, generator, *, signal_scorer=None, behavioral_signals=None):
        captured["scorer"] = signal_scorer
        captured["signals"] = behavioral_signals
        return real(
            request, generator,
            signal_scorer=signal_scorer, behavioral_signals=behavioral_signals,
        )

    monkeypatch.setattr(app_module, "render_with_trace", spy)
    interaction_rows = [
        {
            "snapshotId": "65a1f0000000000000000009",
            "candidateId": "c1",
            "action": "accepted",
            "items": ["t1", "b1"],
            "fullSignature": "t1:b1|outer=|shoes=",
            "createdAt": "2026-07-01T00:00:00Z",
        }
    ]
    snapshot_rows = [
        {
            "_id": "65a1f0000000000000000008",
            "nSurfaced": 1,
            "shownFullSignatures": ["t2:b2|outer=|shoes="],
            "createdAt": "2026-07-02T00:00:00Z",
        }
    ]
    status, _, _ = _render(
        render_body(
            behavioralRows={
                "interactionRows": interaction_rows,
                "recentSnapshots": snapshot_rows,
            }
        )
    )
    assert status == 200
    signals = captured["signals"]
    assert signals.item_affinity == {"t1": 1, "b1": 1}
    assert signals.liked_full_signatures == frozenset({"t1:b1|outer=|shoes="})
    assert signals.shown_full_signatures == ("t2:b2|outer=|shoes=",)
    scorer = captured["scorer"]
    assert isinstance(scorer, AffinitySignalScorer) and scorer.is_available()


def test_empty_valid_set_is_degenerate():
    # Parsed fine but every candidate rejected (ghost ids) → §D "empty valid set".
    ghost_envelope = envelope(
        outfit([("ghost1", Role.base_top), ("ghost2", Role.base_bottom)], ["ghost1"]),
    )
    status, body, _ = _render(render_body(), responses=ghost_envelope)
    assert status == 200
    assert body["degenerate"] is True
    assert body["shown"] == []
    assert body["flags"]["insufficientAfterGeneration"] is True


def test_mid_generation_exception_records_the_true_generator_call_count():
    # The spend COUNT is knowable even when the in-flight attempt's raw text is lost —
    # a paid-but-crashed render must never claim generator_calls: 0 (§D micro-gap edge).
    generator = RaisingGenerator()
    status, body, _ = _render(render_body(), generator=generator)
    assert status == 200
    parse = body["payload"]["diagnostics"]["parse"]
    assert parse["generatorCalls"] == 1
    assert parse["repairUsed"] is False
    assert parse["parseSuccess"] is False


def test_no_image_wardrobe_items_render_fine():
    # Integration fact, not a hypothetical: the deployed WardrobeItem model does NOT require
    # an image (imageUrl/imagePath both optional, WardrobeItem.ts), and spec §15.2 pins the
    # adapter mapping as imageUrl → else imagePath → else "". A blank imageUrl is therefore a
    # legitimate closet state and must never be rejected pre-generation — the engine doesn't
    # prompt on it (H33) and stores it verbatim in the engineVisible snapshot.
    wardrobe = [
        wire_item("t1", "top", imageUrl=""),
        wire_item("t2", "top"),
        wire_item("b1", "bottom", imageUrl=""),
        wire_item("b2", "bottom"),
        wire_item("s1", "shoes"),
    ]
    status, body, _ = _render(render_body(wardrobe=wardrobe))
    assert status == 200
    assert body["degenerate"] is False
    assert body["shown"]
    snapshots = {s["itemId"]: s for s in body["payload"]["itemSnapshots"]}
    assert snapshots["t1"]["engineVisible"]["imageUrl"] == ""
    assert snapshots["t2"]["engineVisible"]["imageUrl"] == "https://img/t2.png"


def test_tagless_wardrobe_items_render_fine():
    # The deployed columns default to [] (colors/occasions) and styleTags has no column until
    # the W-track — §15.2 emits []; empty tag arrays are a legitimate adapter output.
    wardrobe = [
        wire_item("t1", "top", colorTags=[], occasionTags=[], styleTags=[]),
        wire_item("b1", "bottom", colorTags=[], occasionTags=[], styleTags=[]),
    ]
    status, body, _ = _render(
        render_body(
            wardrobe=wardrobe,
            # the stub envelope must only reference pool items:
        ),
        responses=envelope(
            outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]),
        ),
    )
    assert status == 200
    assert body["degenerate"] is False
    assert body["shown"]


# --- §D assembly-failure arm (post-review-2: "constructable at EVERY internal failure
# point" — fault-injection over EACH post-render stage, not just the named ones) ---------


def _assert_assembly_degenerate(body, *, expect_attempts: int):
    assert body["degenerate"] is True
    assert body["shown"] == []
    payload = body["payload"]
    failure = payload["diagnostics"]["engineFailure"]
    assert failure["stage"] == "assemble"
    assert failure["code"] == "internal_exception"
    attempts = payload["generationAttempts"]
    assert len(attempts) == expect_attempts
    parse = payload["diagnostics"]["parse"]
    assert parse["generatorCalls"] == 1  # the spend count survives (never a false zero)
    assert parse["parseSuccess"] is True  # honest: the parse SUCCEEDED; assembly failed
    # The §G.1 identity set still rides the failure row (the §C.4 index needs requestId).
    assert payload["requestId"] == render_body()["requestId"]


def test_build_snapshot_payload_failure_degrades_with_salvaged_attempts(monkeypatch):
    import service.app as app_module

    def explode(*args, **kwargs):
        raise RuntimeError("payload builder blew up")

    monkeypatch.setattr(app_module, "build_snapshot_payload", explode)
    status, body, stub = _render(render_body())
    assert status == 200  # a 500 here would drop the paid row the failure corpus exists for
    _assert_assembly_degenerate(body, expect_attempts=1)
    assert body["payload"]["generationAttempts"][0]["rawText"]  # the raw negative corpus
    assert stub.call_count == 1


def test_shown_zip_failure_degrades_too(monkeypatch):
    import service.app as app_module

    def explode(*args, **kwargs):
        raise RuntimeError("zip blew up")

    monkeypatch.setattr(app_module, "_shown_entries", explode)
    status, body, _ = _render(render_body())
    assert status == 200
    _assert_assembly_degenerate(body, expect_attempts=1)


def test_variant_serializer_failure_degrades_too(monkeypatch):
    import service.app as app_module

    def explode(*args, **kwargs):
        raise RuntimeError("variant serializer blew up")

    monkeypatch.setattr(app_module, "variant_to_wire", explode)
    status, body, _ = _render(render_body())
    assert status == 200
    _assert_assembly_degenerate(body, expect_attempts=1)


def test_wire_serialization_failure_of_the_full_payload_degrades_too(monkeypatch):
    # to_wire is shared by the happy path AND the fallback — inject a failure only for the
    # full payload (non-empty candidates); the degenerate payload must still serialize.
    import service.app as app_module

    real = app_module.to_wire

    def selective(payload):
        if payload.get("candidates"):
            raise ValueError("full payload refused to serialize")
        return real(payload)

    monkeypatch.setattr(app_module, "to_wire", selective)
    status, body, _ = _render(render_body())
    assert status == 200
    _assert_assembly_degenerate(body, expect_attempts=1)


def test_attempt_salvage_failure_still_ships_the_failure_record(monkeypatch):
    # If mapping the attempts is ITSELF what crashed (here: _build_attempts raises, which
    # breaks build_snapshot_payload AND the salvage), the degenerate row still ships —
    # empty attempts, failure recorded, spend count honest.
    import fitted_core.snapshot as snapshot_module

    def explode(*args, **kwargs):
        raise RuntimeError("attempt mapper blew up")

    monkeypatch.setattr(snapshot_module, "_build_attempts", explode)
    status, body, _ = _render(render_body())
    assert status == 200
    assert body["degenerate"] is True
    payload = body["payload"]
    assert payload["generationAttempts"] == []  # salvage failed — never fabricate
    assert payload["diagnostics"]["engineFailure"]["stage"] == "assemble"
    assert payload["diagnostics"]["parse"]["generatorCalls"] == 1
