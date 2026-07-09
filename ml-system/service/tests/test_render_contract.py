"""§A auth + G7 bounds + §D corpus-purity contract tests for POST /render (C3).

Every rejection here must be pre-spend: the assertion `stub.call_count == 0` IS the
no-spend guarantee (a fake Generator standing where OpenAI would be)."""

import json
from pathlib import Path

import pytest

from service import config as cfg
from service import contract
from service.tests.helpers import (
    AUTH,
    ENV,
    daily_envelope,
    http,
    make_app,
    regen_body,
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


# --- malformed field TYPES must be 400 contract_invalid, never a 500 crash ----------
# Regression for the type-confusion class: `value in <frozenset>` raises TypeError on an
# unhashable list/dict, and `float(value)` raises OverflowError on a 400-digit int — both would
# escape the ContractInvalid parse contract as a 500 (mislabelling a caller bug as infra).


def _huge_int() -> int:
    return 10**400  # arbitrary-precision int; overflows float(), far over MAX_WIRE_INT


@pytest.mark.parametrize(
    "make_body",
    [
        lambda: render_body(intent=[]),
        lambda: render_body(intent={}),
        lambda: render_body(lens={"weather": []}),
        lambda: render_body(generator={"model": []}),
        lambda: render_body(generator={"temperature": _huge_int()}),
        lambda: render_body(generator={"timeoutSeconds": _huge_int()}),
        # parent set → passes the lineage check, so it reaches the generationIndex max guard
        lambda: render_body(generationIndex=_huge_int(), parentSnapshotId="65a1f0000000000000000002"),
        lambda: render_body(wardrobeVersion=_huge_int()),
        lambda: render_body(interactionCountAtRequest=_huge_int()),
        lambda: render_body(wardrobe=[{**wire_item("t1", "top"), "clothingType": []}]),
    ],
)
def test_malformed_field_type_is_400_contract_invalid_not_500(make_body):
    app, stub = make_app(daily_envelope())
    status, response = http(app, "POST", "/render", headers=AUTH, json_body=make_body())
    assert status == 400, response
    assert response["error"]["code"] == "contract_invalid", response
    assert stub.call_count == 0  # pre-spend


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


@pytest.mark.parametrize("constant", ["NaN", "Infinity", "-Infinity"])
def test_non_finite_json_tokens_are_contract_invalid_pre_spend(constant):
    # Python's json.loads accepts these by default. The service boundary must not:
    # they are not valid JSON and a body carrying one used to render/spend when the
    # token was hidden in arbitrary behavioralRows.
    raw = json.dumps(render_body()).replace(
        '"interactionRows": []',
        f'"interactionRows": [{{"createdAt": {constant}}}]',
    )
    app, stub = make_app(daily_envelope())
    status, body = http(app, "POST", "/render", headers=AUTH, body=raw.encode())
    assert status == 400 and body["error"]["code"] == "contract_invalid"
    assert stub.call_count == 0


def test_duplicate_json_keys_are_contract_invalid_pre_spend():
    # json.loads is last-wins on duplicate object keys. A duplicated generator key could
    # mask a bad first value and reach the model; reject before validation/spend.
    raw = json.dumps(render_body()).replace(
        '"generator": {',
        '"generator": {"provider":"azure","model":"gpt-4o","temperature":0.7,'
        '"maxCompletionTokens":900}, "generator": {',
        1,
    )
    app, stub = make_app(daily_envelope())
    status, body = http(app, "POST", "/render", headers=AUTH, body=raw.encode())
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


def test_controls_over_bound_and_bad_element_rejected():
    # limit+1 trips the MAX_CONTROL_IDS bound; a non-string element trips _string_list — both
    # pre-spend contract_invalid. (C4 activates regen controls; the C3 "not active" posture is gone.)
    over = [f"i{n}" for n in range(cfg.MAX_CONTROL_IDS + 1)]
    status, response = _reject({"controls": {"lockedItemIds": over, "dislikedItemIds": []}})
    assert f"exceeds {cfg.MAX_CONTROL_IDS}" in response["error"]["message"]
    _reject({"controls": {"lockedItemIds": [], "dislikedItemIds": [123]}})  # non-string id
    _reject({"controls": {"lockedItemIds": ["  "], "dislikedItemIds": []}})  # blank id
    # F3: exactly-at-limit must PASS the bound (pins `>`, not `>=`) — it then falls through to
    # the membership check, so the reject is "not in the wardrobe", never "exceeds N entries".
    at_limit = [f"i{n}" for n in range(cfg.MAX_CONTROL_IDS)]
    _, at_limit_resp = _reject(
        body=regen_body(controls={"lockedItemIds": [], "dislikedItemIds": at_limit})
    )
    assert "exceeds" not in at_limit_resp["error"]["message"]
    assert "not in the wardrobe" in at_limit_resp["error"]["message"]


# NOTE: controls are regenerate-lineage only (§C.3 root-controls invariant) — these preflight
# checks fire only on a CHILD render, so each drives a child-shaped body (regen_body). The root
# rejection of non-empty controls is covered separately below.


def test_controls_preflight_locked_not_in_wardrobe_rejected():
    # §C.3 check 2 — a locked id that is not a live wardrobe item is a caller bug, pre-spend.
    status, response = _reject(
        body=regen_body(controls={"lockedItemIds": ["ghost-id"], "dislikedItemIds": []})
    )
    assert "not in the wardrobe" in response["error"]["message"]


def test_controls_preflight_disliked_not_in_wardrobe_rejected():
    # F6 corpus truth: a stale dislike cannot be persisted as if it shaped the render.
    status, response = _reject(
        body=regen_body(controls={"lockedItemIds": [], "dislikedItemIds": ["ghost-id"]})
    )
    assert "not in the wardrobe" in response["error"]["message"]


def test_controls_preflight_locked_intersect_disliked_rejected():
    # §C.3 check 1 — a contradictory locked ∩ disliked request never empty-succeeds (pre-spend).
    status, response = _reject(
        body=regen_body(controls={"lockedItemIds": ["t1"], "dislikedItemIds": ["t1"]})
    )
    assert "both locked and disliked" in response["error"]["message"]


def test_rescue_forced_item_disliked_rejected_pre_spend():
    # The forced item is an implicit lock; disliking it would contextual-drop every candidate →
    # empty after a wasted spend. Rejected pre-spend like the explicit locked ∩ disliked check.
    # Controls ride a child render (§C.3), so this is a rescue re-roll.
    body = regen_body(
        intent="rescue_item",
        lens={"forcedItemId": "t1"},
        controls={"lockedItemIds": [], "dislikedItemIds": ["t1"]},
    )
    app, stub = make_app(daily_envelope())
    status, response = http(app, "POST", "/render", headers=AUTH, json_body=body)
    assert response["error"]["code"] == "contract_invalid"
    assert "cannot also be disliked" in response["error"]["message"]
    assert stub.call_count == 0


@pytest.mark.parametrize(
    ("wardrobe", "locked_ids", "message"),
    [
        (None, ["t1", "t2"], "more than one lock occupies the top slot"),
        (
            [wire_item("t1", "top"), wire_item("b1", "bottom"),
             wire_item("s1", "shoes"), wire_item("s2", "shoes")],
            ["s1", "s2"],
            "more than one lock occupies the shoes slot",
        ),
        (
            [wire_item("d1", "dress"), wire_item("t1", "top"), wire_item("b1", "bottom")],
            ["d1", "t1"],
            "locked dress cannot coexist with a locked top or bottom",
        ),
        (
            [wire_item("d1", "dress"), wire_item("t1", "top"), wire_item("b1", "bottom")],
            ["d1", "b1"],
            "locked dress cannot coexist with a locked top or bottom",
        ),
    ],
)
def test_controls_preflight_structurally_infeasible_lock_set_rejected(
    wardrobe, locked_ids, message
):
    # §C.3 check 3 — locks that cannot co-occupy a valid slot map are rejected pre-spend,
    # never converted into a GPT call whose post-validate lock drop kills every candidate.
    # Controls ride a child render (§C.3), so this drives a child-shaped body.
    overrides = {"controls": {"lockedItemIds": locked_ids, "dislikedItemIds": []}}
    if wardrobe is not None:
        overrides["wardrobe"] = wardrobe
    status, response = _reject(body=regen_body(**overrides))
    assert message in response["error"]["message"]


# NOTE: a well-formed control set the *actual wardrobe can't complete* (a locked top with no bottom;
# dislikes that remove every base) is NOT contract_invalid — it is a **closet-dependent** empty state
# the engine short-circuits to a valid `notEnoughItems` render pre-GPT (§C.3 request-decidability,
# Fable 2026-07-07). Those cases are covered as valid-empty flow tests in test_render_flow.py; only the
# closet-INDEPENDENT contradictions (co-occupancy, locked∩disliked, forced∈disliked, stale ids) 400 here.


@pytest.mark.parametrize(
    "controls",
    [
        {"lockedItemIds": ["t1"], "dislikedItemIds": []},
        {"lockedItemIds": [], "dislikedItemIds": ["t1"]},
        {"lockedItemIds": ["t1"], "dislikedItemIds": ["t2"]},
    ],
)
def test_root_render_with_non_empty_controls_rejected_pre_spend(controls):
    # §C.3 root-controls invariant: controls are regenerate-LINEAGE only. A root render
    # (generationIndex=0 + null parent — the render_body default) carrying non-empty locked/
    # disliked controls is a caller bug, rejected pre-spend BEFORE any wardrobe preflight or
    # generator call. Defense-in-depth: C5 only ever derives controls onto a child re-roll.
    status, response = _reject({"controls": controls})
    assert "root render" in response["error"]["message"]


def test_root_render_with_empty_controls_is_accepted():
    # The invariant is scoped to NON-empty controls: an explicit empty-controls root render is
    # the normal first/daily shape (§C.3 "{lockedItemIds:[], dislikedItemIds:[]}", never absent).
    app, _ = make_app(daily_envelope())
    status, body = http(
        app, "POST", "/render", headers=AUTH,
        json_body=render_body(controls={"lockedItemIds": [], "dislikedItemIds": []}),
    )
    assert status == 200
    assert body["payload"]["controls"] == {"lockedItemIds": [], "dislikedItemIds": []}


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


def test_seed_date_is_required_not_nullable():
    _reject({"lens": {"seedDate": None}})
    body = render_body()
    body["lens"].pop("seedDate")
    _reject(body=body)


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
    # F3: exactly-at-limit must PASS — pins the `>` (not `>=`) so a bound off-by-one regression trips.
    at_limit_tags = render_body()
    at_limit_tags["wardrobe"][0] = wire_item("t1", "top", colorTags=["c"] * cfg.MAX_ITEM_TAGS)
    status, _ = http(app, "POST", "/render", headers=AUTH, json_body=at_limit_tags)
    assert status == 200


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


def test_generator_expectation_exact_matches_the_full_api_surface():
    # The §A.6/§G static API surface is part of the wire expectation — a wire value ≠ the
    # service's configured value is caught PRE-SPEND (stub.call_count==0), never after a paid
    # call authored a provenance row that lies about what produced it.
    _reject({"generator": {"apiSurface": "responses"}})  # ≠ chat_completions
    _reject({"generator": {"responseFormat": "json_object"}})  # ≠ json_schema_strict
    _reject({"generator": {"reasoningEffort": "minimal"}})  # ≠ none
    _reject({"generator": {"storeMode": "distillation"}})  # ≠ none
    _reject({"generator": {"promptCacheRetention": "24h"}})  # ≠ in_memory
    _reject({"generator": {"timeoutSeconds": 60.0}})  # ≠ 30.0
    _reject({"generator": {"maxRetries": 2}})  # ≠ 0
    _reject({"generator": {"timeoutSeconds": True}})  # bool is never a valid number
    _reject({"generator": {"maxRetries": True}})  # bool is never a valid int
    for field in (
        "apiSurface", "responseFormat", "reasoningEffort", "storeMode",
        "promptCacheRetention", "timeoutSeconds", "maxRetries",
    ):
        body = render_body()
        del body["generator"][field]
        _reject(body=body)  # every surface field is required, not optional


@pytest.mark.parametrize(
    ("attr", "drifted"),
    [
        # Only fields with ≥2 sanctioned values (or a numeric band) can drift while config stays
        # VALID — the dangerous "green /readyz + silent spend" case. Single-valued fields
        # (reasoningEffort/promptCacheRetention) can't reach here: any drift makes config invalid,
        # so /readyz fails closed (test_readyz_503_on_unsanctioned_generator_surface); their wire
        # expectation is still validated pre-spend by the full-surface wire-mismatch test above.
        ("GENERATOR_RESPONSE_FORMAT", "json_object"),
        ("OPENAI_TIMEOUT_SECONDS", 60.0),
        ("OPENAI_MAX_RETRIES", 2),
    ],
)
def test_service_config_drift_is_caught_pre_spend_while_readyz_stays_green(monkeypatch, attr, drifted):
    # The bug this closes: the wire expectation once validated only 4 fields, so a service whose
    # API-surface config had drifted from Next's expectation stayed /readyz-green, still SPENT, and
    # then authored a provenance row asserting the drifted surface. Now the wire↔config mismatch
    # rejects before the generator is built. Here the wire body carries the ORIGINAL expectation
    # (render_body's defaults) while the service's config has drifted to another VALID value —
    # exactly the repro — so /readyz stays green yet /render must reject with no spend.
    monkeypatch.setattr(cfg, attr, drifted)
    app, stub = make_app(daily_envelope())
    ready_status, ready_body = http(app, "GET", "/readyz")
    assert ready_status == 200 and ready_body["ready"] is True  # config is still valid — green
    status, body = http(app, "POST", "/render", headers=AUTH, json_body=render_body())
    assert status == 400 and body["error"]["code"] == "contract_invalid"
    assert stub.call_count == 0  # rejected before any paid generator call — the load-bearing half


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


# --- wire-contract conformance (the single-source-of-truth drift guard) ----------------
# These tests exist to kill the M5 "green suite over a drifted contract" disease: a field
# renamed/dropped at one layer while the others (and the tests) stayed green. They pin the
# field sets in service.contract as THE contract — the parser references them, the canonical
# render_body() fixture is pinned equal to them, and each required field is proven enforced.


def test_contract_json_mirror_matches_the_module():
    """contract_fields.json is the language-neutral mirror C5's TS adapter/projection tests load. It
    is generated FROM service.contract; if they diverge, the TS side targets a stale contract. Covers
    BOTH the wire boundaries (presence) AND the reducer row reads (the itemIds/items projection grain)."""
    mirror = json.loads((Path(contract.__file__).parent / "contract_fields.json").read_text())
    expected = {
        "wireBoundaries": {
            name: {"required": sorted(req), "optional": sorted(opt)}
            for name, (req, opt) in contract.BOUNDARIES.items()
        },
        "reducerRowReads": {
            name: sorted(fields) for name, fields in contract.REDUCER_ROW_READS.items()
        },
        "engineFailureVocab": {
            name: sorted(fields) for name, fields in contract.ENGINE_FAILURE_VOCAB.items()
        },
    }
    assert mirror == expected, (
        "contract_fields.json drifted from service.contract — regenerate it (json.dump of "
        "BOUNDARIES + REDUCER_ROW_READS) so the cross-runtime mirror stays truthful"
    )


def test_canonical_render_body_fixture_matches_the_contract():
    """The shared render_body() fixture — used by nearly every service test — must carry EXACTLY
    the contract's fields at every boundary. This is the guard that would have caught C-B1
    (sessionId dropped from the wire) and A1 (a field the fixture carries that the contract does
    not, or vice-versa): a drift here reddens the whole suite instead of hiding in green."""
    body = render_body()
    checks = {
        "request": set(body),
        "controls": set(body["controls"]),
        "lens": set(body["lens"]),
        "wardrobeItem": set(body["wardrobe"][0]),
        "behavioralRows": set(body["behavioralRows"]),
        "generator": set(body["generator"]),
    }
    for name, keys in checks.items():
        required, optional = contract.BOUNDARIES[name]
        # The base fixture populates every optional field, so keys == required ∪ optional exactly.
        assert keys == required | optional, (
            f"{name}: fixture carries {sorted(keys)} but the contract is "
            f"{sorted(required | optional)}"
        )
        # And required must be a real subset of what the fixture provides (no phantom requirement).
        assert required <= keys


def _drop_nested(body: dict, boundary: str, field: str) -> dict:
    """Return a copy of ``body`` with ``field`` removed from ``boundary``'s object."""
    if boundary == "request":
        body.pop(field)
    elif boundary == "wardrobeItem":
        body["wardrobe"][0].pop(field)
    else:
        body[boundary].pop(field)
    return body


# behavioralRows has no required fields; every other boundary's required set is enforced.
_REQUIRED_DROP_CASES = [
    (boundary, field)
    for boundary in ("request", "controls", "lens", "wardrobeItem", "generator")
    for field in sorted(contract.BOUNDARIES[boundary][0])
]


@pytest.mark.parametrize("boundary,field", _REQUIRED_DROP_CASES)
def test_every_required_field_is_enforced_pre_spend(boundary, field):
    """For EVERY required field at EVERY boundary: dropping it from an otherwise-valid request is
    contract_invalid before any generator spend. Proves the contract set isn't just declared but
    actually enforced — a field silently downgraded to optional (or never checked) fails here."""
    _reject(body=_drop_nested(render_body(), boundary, field))


def test_unknown_top_level_field_is_rejected_pre_spend():
    """The contract is closed: an unlisted wire field is a caller/adapter bug, not ignored."""
    _reject({"unexpectedField": "x"})


# --- reducer row-read contract (the itemIds/items drift grain) -------------------------
# The wire parser treats behavioralRows rows as opaque dicts, so the drift the wire tests can't
# catch is the row grain: the C5 Mongo projection emitting a name the reducer doesn't read. These
# tests pin service.contract.REDUCER_ROW_READS as the names the reducer actually consumes — a read
# renamed off a contract name (items→itemIds) empties the signal it feeds and reddens the suite.


def test_declared_row_reads_drive_live_signals():
    """Every signal a bound feedback / snapshot row can produce is driven by a field NAME in
    REDUCER_ROW_READS. Fixtures use only contract-declared names (asserted ⊆), so a reducer read
    *renamed away* from its declared name yields an empty signal here.

    HONEST SCOPE (do not overstate): this catches a RENAME of a declared read, not a NEW undeclared
    read — adding `row.get("moodTag")` to the reducer without declaring it stays green here, because
    the fixture can't know to send `moodTag`. This is a *localizer* (which declared field drove which
    signal), NOT the cure for row-grain drift. The real guard is the C5 behavioral round-trip: feed a
    real Mongo projection through the service and assert the observable personalization behavior — a
    projection/reducer name mismatch then produces the wrong OUTPUT regardless of which side drifted.
    See docs/plans/post-m5-reset.md (test pyramid)."""
    from fitted_core.reducers import reduce_interaction_rows, reduce_snapshot_rows

    accepted = {
        "snapshotId": "s1", "candidateId": "c1", "action": "accepted",
        "fullSignature": "sig-1", "createdAt": "2026-07-07T00:00:00Z", "items": ["it1", "it2"],
    }
    rejected = {
        "snapshotId": "s2", "candidateId": "c2", "action": "rejected", "baseKey": "bk-1",
        "createdAt": "2026-07-06T00:00:00Z",
        "perItemFeedback": [{"itemId": "it3", "disliked": True}],
    }
    snapshot_row = {"nSurfaced": 3, "shownFullSignatures": ["shown-1"]}

    # The fixtures may not use any name outside the declared contract (keeps them honest to it).
    assert set(accepted) <= contract.INTERACTION_ROW_READS
    assert set(rejected) <= contract.INTERACTION_ROW_READS
    assert set(rejected["perItemFeedback"][0]) <= contract.PER_ITEM_FEEDBACK_READS
    assert set(snapshot_row) <= contract.SNAPSHOT_ROW_READS

    signals = reduce_interaction_rows([accepted, rejected])
    shown = reduce_snapshot_rows([snapshot_row])

    # Each declared read drives a live signal; a renamed read empties its target.
    assert signals.item_affinity == {"it1": 1, "it2": 1}          # items + action + snapshot/candidate
    assert signals.liked_full_signatures == frozenset({"sig-1"})  # fullSignature
    assert signals.recent_disliked_base_keys == ("bk-1",)         # baseKey + action
    assert signals.recent_disliked_item_ids == ("it3",)           # perItemFeedback → itemId/disliked
    assert shown == ("shown-1",)                                   # nSurfaced gate + shownFullSignatures
