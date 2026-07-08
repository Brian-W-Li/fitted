"""§A auth + G7 bounds + §D corpus-purity contract tests for POST /render (C3).

Every rejection here must be pre-spend: the assertion `stub.call_count == 0` IS the
no-spend guarantee (a fake Generator standing where OpenAI would be)."""

import json

import pytest

from service import config as cfg
from service.tests.helpers import (
    AUTH,
    ENV,
    daily_envelope,
    http,
    make_app,
    render_body,
    rescue_body,
    wire_item,
)


def _reject(body_overrides=None, *, body=None, expect_code="contract_invalid"):
    """POST a (mutated) render body; assert the envelope + that no generation was spent."""
    app, stub = make_app(daily_envelope())
    payload = body if body is not None else render_body(**(body_overrides or {}))
    status, response = http(app, "POST", "/render", headers=AUTH, json_body=payload)
    assert response["error"]["code"] == expect_code, response
    assert stub.call_count == 0  # pre-spend rejection — the load-bearing half
    return status, response


# --- auth (§A) ----------------------------------------------------------------------


def test_missing_service_key_is_401_before_the_body_is_read():
    app, stub = make_app(daily_envelope())

    async def receive_must_not_be_called():
        raise AssertionError("the body must never be read before auth passes")

    status, body = http(app, "POST", "/render", receive=receive_must_not_be_called)
    assert status == 401
    assert body["error"]["code"] == "auth"
    assert stub.call_count == 0


def test_wrong_service_key_is_401_and_next_key_is_accepted():
    app, _ = make_app(daily_envelope())
    status, body = http(
        app, "POST", "/render", headers={"X-Fitted-Service-Key": "wrong"},
        json_body=render_body(),
    )
    assert status == 401 and body["error"]["code"] == "auth"
    # The §A rotation slot: SERVICE_KEY_NEXT authenticates too.
    app, _ = make_app(daily_envelope())
    status, _ = http(
        app, "POST", "/render",
        headers={"X-Fitted-Service-Key": ENV["SERVICE_KEY_NEXT"]},
        json_body=render_body(),
    )
    assert status == 200


# --- malformed body / depth (G7) ------------------------------------------------------


def test_malformed_json_body_is_contract_invalid():
    app, stub = make_app(daily_envelope())
    status, body = http(app, "POST", "/render", headers=AUTH, body=b"{ not json")
    assert status == 400 and body["error"]["code"] == "contract_invalid"
    assert stub.call_count == 0


def test_non_object_json_body_is_contract_invalid():
    _reject(body=["not", "an", "object"])


def test_too_deep_json_is_contract_invalid_before_any_walk():
    # The deep value hides inside an interaction row — the one place a C3 body carries
    # arbitrary JSON — so the ONLY thing that can reject it is the depth guard, and the
    # message pins that (a mutant that drops the guard renders successfully instead).
    depth = cfg.MAX_JSON_NESTING_DEPTH + 1
    raw = json.dumps(render_body()).replace(
        '"interactionRows": []',
        '"interactionRows": [{"deep": %s}]' % ("[" * depth + "]" * depth),
    )
    app, stub = make_app(daily_envelope())
    status, response = http(app, "POST", "/render", headers=AUTH, body=raw.encode())
    assert status == 400 and response["error"]["code"] == "contract_invalid"
    assert "nesting depth" in response["error"]["message"]
    assert stub.call_count == 0


# --- body-size cap at the ASGI layer (G7) ---------------------------------------------


def test_body_exactly_at_the_byte_cap_passes_and_cap_plus_one_rejects():
    app, _ = make_app(daily_envelope())
    raw = json.dumps(render_body()).encode("utf-8")
    at_limit = raw + b" " * (cfg.MAX_REQUEST_BODY_BYTES - len(raw))
    assert len(at_limit) == cfg.MAX_REQUEST_BODY_BYTES
    status, _ = http(app, "POST", "/render", headers=AUTH, body=at_limit)
    assert status == 200
    app, stub = make_app(daily_envelope())
    status, body = http(app, "POST", "/render", headers=AUTH, body=at_limit + b" ")
    assert status == 400 and body["error"]["code"] == "contract_invalid"
    assert stub.call_count == 0


def test_body_cap_applies_across_chunked_reads():
    app, stub = make_app(daily_envelope())
    chunk = b" " * (cfg.MAX_REQUEST_BODY_BYTES // 2 + 1)
    status, body = http(app, "POST", "/render", headers=AUTH, chunks=[chunk, chunk])
    assert status == 400 and body["error"]["code"] == "contract_invalid"
    assert stub.call_count == 0


# --- G7 text/array clamps: exactly-at-limit passes, limit+1 rejects -------------------


def test_occasion_boundary():
    app, _ = make_app(daily_envelope())
    status, _ = http(
        app, "POST", "/render", headers=AUTH,
        json_body=render_body(lens={"occasion": "x" * cfg.MAX_OCCASION_CHARS}),
    )
    assert status == 200
    _reject({"lens": {"occasion": "x" * (cfg.MAX_OCCASION_CHARS + 1)}})


def test_weather_raw_and_location_boundaries():
    app, _ = make_app(daily_envelope())
    status, _ = http(
        app, "POST", "/render", headers=AUTH,
        json_body=render_body(
            lens={
                "weatherRaw": "w" * cfg.MAX_WEATHER_RAW_CHARS,
                "location": "l" * cfg.MAX_LOCATION_CHARS,
            }
        ),
    )
    assert status == 200
    _reject({"lens": {"weatherRaw": "w" * (cfg.MAX_WEATHER_RAW_CHARS + 1)}})
    _reject({"lens": {"location": "l" * (cfg.MAX_LOCATION_CHARS + 1)}})


def test_wardrobe_boundary():
    wardrobe = render_body()["wardrobe"]
    filler = [
        wire_item(f"x{i}", "shoes") for i in range(cfg.MAX_WARDROBE_ITEMS - len(wardrobe))
    ]
    app, _ = make_app(daily_envelope())
    status, _ = http(
        app, "POST", "/render", headers=AUTH,
        json_body=render_body(wardrobe=wardrobe + filler),
    )
    assert status == 200
    _reject({"wardrobe": wardrobe + filler + [wire_item("overflow", "shoes")]})


def test_controls_arrays_reject_over_bound_and_c3_rejects_non_empty():
    # limit+1 trips the MAX_CONTROL_IDS bound; at/under the bound trips the C3 posture
    # (regen controls inactive until C4) — both contract_invalid, distinguishable messages.
    over = [f"i{n}" for n in range(cfg.MAX_CONTROL_IDS + 1)]
    status, response = _reject({"controls": {"lockedItemIds": over, "dislikedItemIds": []}})
    assert f"exceeds {cfg.MAX_CONTROL_IDS}" in response["error"]["message"]
    status, response = _reject(
        {"controls": {"lockedItemIds": ["one-id"], "dislikedItemIds": []}}
    )
    assert "not active until C4" in response["error"]["message"]
    _reject({"controls": {"lockedItemIds": [], "dislikedItemIds": [123]}})  # non-string id


# --- Lens validation (§A/§F/§D) --------------------------------------------------------


@pytest.mark.parametrize("occasion", ["", "   "])
def test_blank_occasion_is_rejected_never_trimmed(occasion):
    # Whitespace-only PASSES Mongoose `required` — the service must reject it explicitly,
    # never trim-and-proceed (a blank-occasion snapshot is an unexplainable Lens row).
    _reject({"lens": {"occasion": occasion}})


def test_invalid_weather_bucket_is_rejected_not_bucketed():
    _reject({"lens": {"weather": "72F sunny"}})
    _reject({"lens": {"weather": "sunny"}})


def test_non_empty_constraints_rejected():
    _reject({"lens": {"constraints": {"palette": "warm"}}})


def test_malformed_seed_date_rejected():
    _reject({"lens": {"seedDate": "2026-7-7"}})
    _reject({"lens": {"seedDate": "tomorrow"}})


def test_unsupported_intent_rejected():
    _reject({"intent": "outfit_upgrade"})
    _reject({"intent": "translate"})


def test_forced_item_iff_rescue():
    _reject({"lens": {"forcedItemId": "t1"}})  # daily with a forced item
    _reject(body=rescue_body(lens={"forcedItemId": None}))  # rescue without one


def test_rescue_forced_item_absent_from_wardrobe_is_pre_spend_contract_invalid():
    _reject(body=rescue_body(lens={"forcedItemId": "ghost"}))


# --- identity fields (§C.4 / §C.1) -----------------------------------------------------


def test_request_id_shapes():
    app, _ = make_app(daily_envelope())
    status, _ = http(
        app, "POST", "/render", headers=AUTH,
        json_body=render_body(requestId="01ARZ3NDEKTSV4RRFFQ69G5FAV"),  # ULID
    )
    assert status == 200
    for bad in ["", "not-a-uuid", "41111111-1111-1111-8111-111111111111", "x" * 65]:
        _reject({"requestId": bad})


def test_snapshot_and_parent_ids_must_be_object_id_hex():
    _reject({"snapshotId": "not-hex"})
    _reject({"generationIndex": 1, "parentSnapshotId": "short"})


def test_lineage_consistency_and_reroll_shape():
    # Root render: index 0 + null parent (the helper default) — inconsistent pairs reject.
    _reject({"generationIndex": 1})  # index 1 with a null parent
    _reject({"parentSnapshotId": "65a1f0000000000000000002"})  # parent with index 0
    # The re-roll shape renders and echoes lineage into the payload (§G.1).
    app, _ = make_app(daily_envelope())
    status, body = http(
        app, "POST", "/render", headers=AUTH,
        json_body=render_body(
            generationIndex=1, parentSnapshotId="65a1f0000000000000000002"
        ),
    )
    assert status == 200
    assert body["payload"]["generationIndex"] == 1
    assert body["payload"]["parentSnapshotId"] == "65a1f0000000000000000002"


# --- wardrobe items (§15.2 projection at the trust boundary) ---------------------------


def test_duplicate_wardrobe_ids_are_contract_invalid_with_no_payload():
    status, response = _reject(
        {"wardrobe": render_body()["wardrobe"] + [wire_item("t1", "top")]}
    )
    assert "payload" not in response  # §D: caller bug → envelope only, never a snapshot


def test_malformed_wardrobe_items_rejected():
    _reject({"wardrobe": [wire_item("t1", "jacket")]})  # unknown clothingType
    _reject({"wardrobe": [wire_item("t1", "top", warmth=11)]})
    _reject({"wardrobe": [wire_item("t1", "top", warmth=True)]})  # bool smuggled as int
    _reject({"wardrobe": [wire_item("t1", "top", styleTags="solid")]})  # non-array tags
    _reject({"wardrobe": [wire_item("t1", "top", extra="?")]})  # unknown field
    _reject({"wardrobe": [wire_item("", "top")]})  # blank id
    _reject({"wardrobe": [{"id": "t1"}]})  # missing required fields


def test_item_text_clamps_guard_the_prompt():
    # Prompt-reaching item text is length-clamped pre-spend (G7 spirit — the 1 MiB body cap
    # alone would admit a prompt-inflating name).
    app, _ = make_app(daily_envelope())
    long_name = wire_item("t1", "top", name="n" * cfg.MAX_ITEM_NAME_CHARS)
    body = render_body()
    body["wardrobe"][0] = long_name
    status, _ = http(app, "POST", "/render", headers=AUTH, json_body=body)
    assert status == 200
    body["wardrobe"][0] = wire_item("t1", "top", name="n" * (cfg.MAX_ITEM_NAME_CHARS + 1))
    _reject({"wardrobe": body["wardrobe"]})
    too_many_tags = wire_item("t1", "top", colorTags=["c"] * (cfg.MAX_ITEM_TAGS + 1))
    _reject({"wardrobe": [too_many_tags]})


# --- numeric fields + behavioral rows (§H bounds) --------------------------------------


def test_numeric_field_guards():
    _reject({"wardrobeVersion": -1})
    _reject({"wardrobeVersion": True})
    _reject({"interactionCountAtRequest": -2})
    _reject({"generationIndex": "0"})


def test_behavioral_rows_bounds_and_shapes():
    from fitted_core.reducers import INTERACTION_ROWS_SCAN_LIMIT, REPETITION_WINDOW_SNAPSHOTS

    app, _ = make_app(daily_envelope())
    at_limit = {
        "recentSnapshots": [{} for _ in range(REPETITION_WINDOW_SNAPSHOTS)],
        "interactionRows": [{} for _ in range(INTERACTION_ROWS_SCAN_LIMIT)],
    }
    status, _ = http(
        app, "POST", "/render", headers=AUTH, json_body=render_body(behavioralRows=at_limit)
    )
    assert status == 200
    _reject({"behavioralRows": {"interactionRows": [{} for _ in range(INTERACTION_ROWS_SCAN_LIMIT + 1)]}})
    _reject({"behavioralRows": {"recentSnapshots": [{} for _ in range(REPETITION_WINDOW_SNAPSHOTS + 1)]}})
    _reject({"behavioralRows": {"interactionRows": ["not-an-object"]}})
    _reject({"behavioralRows": {"unknownKey": []}})


# --- generator exact-match (§A — never clamped, never obeyed) --------------------------


def test_generator_expectation_exact_match():
    _reject({"generator": {"model": "gpt-4o"}})  # disallowed model
    _reject({"generator": {"temperature": 0.7}})  # ≠ configured value (never clamped)
    _reject({"generator": {"maxCompletionTokens": 900}})  # ≠ configured cap
    _reject({"generator": {"provider": "azure"}})
    _reject({"generator": {"temperature": True}})
    body = render_body()
    del body["generator"]["temperature"]
    _reject(body=body)  # missing key
    body = render_body()
    body["generator"]["extra"] = 1
    _reject(body=body)  # unknown key


def test_unknown_top_level_key_rejected():
    body = render_body()
    body["surprise"] = 1
    _reject(body=body)


def test_added_clamp_constants_have_boundaries_too():
    # The C3 service-side clamp additions (G7 spirit) get the same at-limit/limit+1 pair.
    app, _ = make_app(daily_envelope())
    ok = render_body(
        sessionId="s" * cfg.MAX_SESSION_ID_CHARS,
        wardrobe=[
            wire_item(
                "i" * cfg.MAX_ID_CHARS, "top",
                colorTags=["c" * cfg.MAX_ITEM_TAG_CHARS],
                material="m" * cfg.MAX_ITEM_ATTR_CHARS,
                formality="casual",
                imageUrl="https://" + "u" * (cfg.MAX_IMAGE_URL_CHARS - 8),
            ),
            wire_item("b1", "bottom"),
        ],
    )
    status, _ = http(app, "POST", "/render", headers=AUTH, json_body=ok)
    assert status == 200
    _reject({"sessionId": "s" * (cfg.MAX_SESSION_ID_CHARS + 1)})
    _reject({"wardrobe": [wire_item("i" * (cfg.MAX_ID_CHARS + 1), "top")]})
    _reject({"wardrobe": [wire_item("t1", "top", colorTags=["c" * (cfg.MAX_ITEM_TAG_CHARS + 1)])]})
    _reject({"wardrobe": [wire_item("t1", "top", material="m" * (cfg.MAX_ITEM_ATTR_CHARS + 1))]})
    _reject({"wardrobe": [wire_item("t1", "top", imageUrl="u" * (cfg.MAX_IMAGE_URL_CHARS + 1))]})
    _reject({"lens": {"forcedItemId": "f" * (cfg.MAX_ID_CHARS + 1)}})


@pytest.mark.parametrize("bad_id", ["none", "t:1", "t|1", "t=1"])
def test_key_invalid_wardrobe_item_ids_reject_pre_spend(bad_id):
    # v2 §7/R10 says participating item ids cannot corrupt BaseKey/FullSignature. Real
    # ObjectId-hex ids never hit this, but a service-boundary bug must die before GPT, not
    # spend and later record `keyPreconditionFailed` against the model output.
    _reject({"wardrobe": [wire_item(bad_id, "top"), wire_item("b1", "bottom")]})


def test_json_depth_exactly_at_the_limit_passes():
    # The at-limit half of the depth boundary: a row nesting to EXACTLY the cap renders.
    # Body depth so far: body(1) → behavioralRows(2) → interactionRows(3) → row(4) → value…
    headroom = cfg.MAX_JSON_NESTING_DEPTH - 4
    raw = json.dumps(render_body()).replace(
        '"interactionRows": []',
        '"interactionRows": [{"deep": %s}]' % ("[" * headroom + "]" * headroom),
    )
    app, _ = make_app(daily_envelope())
    status, _ = http(app, "POST", "/render", headers=AUTH, body=raw.encode())
    assert status == 200


def test_non_calendar_seed_date_rejected():
    _reject({"lens": {"seedDate": "2026-13-99"}})
