"""M2 validator contract tests (v2 §12/§13).

Checkpoints C1–C3 (Stages A–D in the M2 plan §10): the strict parser, the
result/issue model, root-envelope validation, the per-candidate schema +
forbidden-field pass (candidate/item shape, items/itemId/role, the §12 forbidden
fields), and — at C3 — SlotMap normalization, slot-level structural validity, and
sampled-pool membership (structural/pool **rejections** only; C3 emits no accepted
candidates — keys/dedup land at C4). StyleMove tests land at C5.

Assert on ``IssueCode`` (and ``candidate_index`` where useful), **never** on
``Issue.detail`` prose (M2 plan §4/§10) — the detail text is a debug aid that may
change freely; the codes are the stable contract.
"""

import pytest

from fitted_core.models import IssueCode, ItemType, WardrobeItem
from fitted_core.validator import (
    Issue,
    ParseResult,
    Severity,
    ValidationResult,
    parse_gpt_json,
    severity_of,
    validate_gpt_payload,
)


def _codes(issues):
    return [issue.code for issue in issues]


# C1/C2 do not consume sampled_pool; pass an empty pool for the reject-path tests
# (they fail before the pool is ever consulted, from C3 on).
EMPTY_POOL: list = []

# A small sampled pool covering the ids used by structurally-valid "good" candidates,
# so those candidates keep surviving once C3 adds sampled-pool membership — the
# happy-path no-rejection assertions then stay durable into C3/C4. C1/C2 ignore it.
POOL = [
    WardrobeItem("t1", "Tee", ItemType.top, warmth=4, image_url="t1.jpg"),
    WardrobeItem("b1", "Jeans", ItemType.bottom, warmth=5, image_url="b1.jpg"),
]


def _validate_one(candidate):
    """Validate a single candidate inside a well-formed root envelope."""
    return validate_gpt_payload({"outfits": [candidate]}, EMPTY_POOL)


# The §12 forbidden-field enumeration (docs/Fitted_Spec_v2.md §12 / M2 plan §4),
# pinned here so the candidate/item forbidden-field tests are exhaustive and any
# drift from the validator's frozenset is caught (test_forbidden_field_set_matches_spec).
FORBIDDEN_FIELDS = [
    "score", "rank", "optionPath", "risk",
    "anchor", "bridge", "experiment",
    "edge", "compatibility", "behavioralStrength",
    "freshness", "exposure", "cooldown", "fallback",
    "imageUrl", "warmth",
    "matchedTraits", "missingTraits", "diagnosticReason",
]


# ============================ parse_gpt_json (strict parse) ============================

# --- caller-contract: a non-str raw is misuse → TypeError (not invalidJson) ---

@pytest.mark.parametrize("bad_raw", [None, 123, 1.5, True, b'{"outfits": []}', ["x"], {"a": 1}])
def test_parse_non_str_raises_type_error(bad_raw):
    with pytest.raises(TypeError):
        parse_gpt_json(bad_raw)


# --- success: valid JSON parses, issue is None, payload is the parsed value ---

def test_parse_valid_json():
    result = parse_gpt_json('{"outfits": []}')
    assert isinstance(result, ParseResult)
    assert result.issue is None
    assert result.payload == {"outfits": []}


def test_parse_valid_nested_json():
    result = parse_gpt_json('{"outfits": [{"items": [{"itemId": "t1", "role": "base_top"}]}]}')
    assert result.issue is None
    assert result.payload == {"outfits": [{"items": [{"itemId": "t1", "role": "base_top"}]}]}


# --- malformed string content → invalidJson (data failure, never raises) ---

@pytest.mark.parametrize("bad", ['{bad', '', '{"outfits": }', "{'outfits': []}", '{"a": 1,}'])
def test_parse_malformed_string_returns_invalid_json(bad):
    result = parse_gpt_json(bad)
    assert result.payload is None
    assert result.issue is not None
    assert result.issue.code is IssueCode.invalid_json
    assert result.issue.candidate_index is None


# --- strict parse: NaN / Infinity / -Infinity tokens are not strictly valid JSON ---

@pytest.mark.parametrize("raw", [
    "NaN", "Infinity", "-Infinity",
    '{"x": NaN}', '{"x": Infinity}', '{"x": -Infinity}',
    '{"outfits": [NaN]}',
])
def test_parse_rejects_non_finite_constants(raw):
    result = parse_gpt_json(raw)
    assert result.payload is None
    assert result.issue.code is IssueCode.invalid_json


# --- strict parse: duplicate object member names at any depth → invalidJson ---

def test_parse_rejects_duplicate_keys_top_level():
    result = parse_gpt_json('{"a": 1, "a": 2}')
    assert result.payload is None
    assert result.issue.code is IssueCode.invalid_json


def test_parse_rejects_duplicate_keys_nested():
    # A duplicate buried inside a nested object must still be caught — last-wins
    # could otherwise hide a forbidden/malformed member before schema validation.
    result = parse_gpt_json('{"outfits": [{"items": [], "items": [{"itemId": "x"}]}]}')
    assert result.payload is None
    assert result.issue.code is IssueCode.invalid_json


def test_parse_distinct_keys_ok():
    # Sanity: distinct keys (including a repeated key in *different* objects) parse.
    result = parse_gpt_json('{"outfits": [{"a": 1}, {"a": 2}]}')
    assert result.issue is None
    assert result.payload == {"outfits": [{"a": 1}, {"a": 2}]}


# ============================ root-envelope validation ============================


# --- non-object root → malformedRoot ---

@pytest.mark.parametrize("payload", [[], "outfits", 5, 1.0, True, None])
def test_non_object_root_rejected(payload):
    result = validate_gpt_payload(payload, EMPTY_POOL)
    assert result.candidates == []
    assert _codes(result.rejections) == [IssueCode.malformed_root]
    assert result.rejections[0].candidate_index is None
    assert result.warnings == []


# --- missing outfits → invalidOutfits ---

def test_missing_outfits_rejected():
    result = validate_gpt_payload({}, EMPTY_POOL)
    assert result.candidates == []
    assert _codes(result.rejections) == [IssueCode.invalid_outfits]


def test_extra_key_precedence_over_missing_outfits():
    # Deliberate precedence (validator._validate_root): the root envelope is exactly
    # {"outfits": [...]}, so an unexpected key is malformedRoot even when 'outfits' is
    # itself absent — exact-key strictness wins over the missing-field diagnostic.
    result = validate_gpt_payload({"unexpected": 1}, EMPTY_POOL)
    assert _codes(result.rejections) == [IssueCode.malformed_root]


# --- outfits present but not a list → invalidOutfits ---

@pytest.mark.parametrize("outfits", ["x", 5, {}, None, True])
def test_outfits_not_list_rejected(outfits):
    result = validate_gpt_payload({"outfits": outfits}, EMPTY_POOL)
    assert result.candidates == []
    assert _codes(result.rejections) == [IssueCode.invalid_outfits]


# --- extra root key alongside outfits → malformedRoot (strict envelope) ---

def test_extra_root_key_rejected():
    result = validate_gpt_payload({"outfits": [], "extra": 1}, EMPTY_POOL)
    assert result.candidates == []
    assert _codes(result.rejections) == [IssueCode.malformed_root]


# --- malformed root returns zero candidates and never inspects nested candidates ---

def test_malformed_root_does_not_inspect_nested_candidates():
    # The root has an extra key AND a nested candidate that *would* be rejected if
    # inspected (non-list items + a forbidden 'score' field). The short-circuit must
    # yield exactly one root rejection and zero candidate-level issues — this holds
    # as nested validation lands in later checkpoints.
    payload = {
        "outfits": [{"items": "not-a-list", "score": 5}],
        "extra": 1,
    }
    result = validate_gpt_payload(payload, EMPTY_POOL)
    assert result.candidates == []
    assert _codes(result.rejections) == [IssueCode.malformed_root]
    assert result.warnings == []


# --- valid empty outfits: zero candidates, no rejection, no warning ---

def test_valid_empty_outfits():
    result = validate_gpt_payload({"outfits": []}, EMPTY_POOL)
    assert isinstance(result, ValidationResult)
    assert result.candidates == []
    assert result.rejections == []
    assert result.warnings == []


# ============================ candidate / item schema (C2) ============================

# --- a candidate must be a JSON object ---

@pytest.mark.parametrize("bad", ["x", 5, 1.0, True, [], None])
def test_non_object_candidate_rejected(bad):
    result = _validate_one(bad)
    assert _codes(result.rejections) == [IssueCode.invalid_candidate_shape]
    assert result.rejections[0].candidate_index == 0
    assert result.candidates == []


# --- items required: missing or non-list → invalidItems ---

def test_candidate_missing_items_rejected():
    # An object lacking 'items' (even with an allowed 'styleMove') → invalidItems.
    assert _codes(_validate_one({}).rejections) == [IssueCode.invalid_items]
    assert _codes(_validate_one({"styleMove": {}}).rejections) == [IssueCode.invalid_items]


@pytest.mark.parametrize("items", ["x", 5, True, {}, None])
def test_candidate_items_non_list_rejected(items):
    assert _codes(_validate_one({"items": items}).rejections) == [IssueCode.invalid_items]


def test_empty_items_is_not_invalid_items():
    # items: [] is schema-valid here; the empty-base reject is the SlotMap layer's at
    # C3 (N3). Pin the durable claim: C2 must NOT classify it as invalidItems.
    result = _validate_one({"items": []})
    assert IssueCode.invalid_items not in _codes(result.rejections)


# --- candidate extra / forbidden fields reject the candidate ---

def test_candidate_unknown_field_rejected():
    candidate = {"items": [{"itemId": "t1", "role": "base_top"}], "bogus": 1}
    result = _validate_one(candidate)
    assert _codes(result.rejections) == [IssueCode.unknown_candidate_field]
    assert result.rejections[0].candidate_index == 0


@pytest.mark.parametrize("field", FORBIDDEN_FIELDS)
def test_candidate_forbidden_field_rejected(field):
    candidate = {"items": [{"itemId": "t1", "role": "base_top"}], field: "x"}
    result = _validate_one(candidate)
    assert _codes(result.rejections) == [IssueCode.forbidden_gpt_field]
    assert result.rejections[0].candidate_index == 0


def test_forbidden_takes_precedence_over_unknown_candidate_field():
    # Both an unknown and a forbidden key present → the sharper forbidden code wins.
    candidate = {"items": [{"itemId": "t1", "role": "base_top"}], "bogus": 1, "score": 5}
    assert _codes(_validate_one(candidate).rejections) == [IssueCode.forbidden_gpt_field]


# --- item schema: each item is an object with exactly itemId + role ---

@pytest.mark.parametrize("bad", ["x", 5, 1.0, True, [], None])
def test_non_object_item_rejected(bad):
    result = _validate_one({"items": [bad]})
    assert _codes(result.rejections) == [IssueCode.invalid_item_shape]
    assert result.rejections[0].candidate_index == 0


def test_item_missing_item_id_rejected():
    result = _validate_one({"items": [{"role": "base_top"}]})
    assert _codes(result.rejections) == [IssueCode.invalid_item_id]


@pytest.mark.parametrize("item_id", ["", 5, 1.0, True, [], {}, None])
def test_item_id_non_string_or_empty_rejected(item_id):
    item = {"itemId": item_id, "role": "base_top"}
    assert _codes(_validate_one({"items": [item]}).rejections) == [IssueCode.invalid_item_id]


def test_item_missing_role_rejected():
    result = _validate_one({"items": [{"itemId": "t1"}]})
    assert _codes(result.rejections) == [IssueCode.invalid_role]


@pytest.mark.parametrize("role", [5, 1.0, True, [], {}, None])
def test_role_non_string_rejected(role):
    item = {"itemId": "t1", "role": role}
    assert _codes(_validate_one({"items": [item]}).rejections) == [IssueCode.invalid_role]


def test_item_unknown_field_rejected():
    item = {"itemId": "t1", "role": "base_top", "bogus": 1}
    assert _codes(_validate_one({"items": [item]}).rejections) == [IssueCode.unknown_item_field]


@pytest.mark.parametrize("field", FORBIDDEN_FIELDS)
def test_item_forbidden_field_rejected(field):
    item = {"itemId": "t1", "role": "base_top", field: "x"}
    result = _validate_one({"items": [item]})
    assert _codes(result.rejections) == [IssueCode.forbidden_gpt_field]
    assert result.rejections[0].candidate_index == 0


def test_forbidden_takes_precedence_over_unknown_item_field():
    # Both an unknown and a forbidden key on an *item* → the sharper forbidden code wins.
    item = {"itemId": "t1", "role": "base_top", "bogus": 1, "score": 5}
    assert _codes(_validate_one({"items": [item]}).rejections) == [IssueCode.forbidden_gpt_field]


def test_forbidden_field_set_matches_spec():
    # Drift guard (white-box): the validator's forbidden frozenset must equal the §12
    # enumeration pinned in this test, in both directions.
    from fitted_core.validator import _FORBIDDEN_GPT_FIELDS

    assert _FORBIDDEN_GPT_FIELDS == set(FORBIDDEN_FIELDS)


# --- C2/C3 boundary: a string role *value* is not membership-checked here ---

def test_c2_does_not_validate_role_value():
    # A well-formed but non-existent role string is schema-valid in C2; the value check
    # is the normalizer's at C3 (Decision D4), where "banana" may become unknownRole.
    # Durable claim: C2 must not flag a *string* role with the schema-level invalidRole
    # code (don't assert no rejection at all — C3 will add unknownRole here).
    result = _validate_one({"items": [{"itemId": "t1", "role": "banana"}]})
    assert IssueCode.invalid_role not in _codes(result.rejections)


# --- candidate-by-candidate isolation: a bad candidate never stops later ones ---

def test_bad_candidate_does_not_stop_later_candidates():
    # `good` is a complete, in-pool two-piece, so it stays non-rejected through C3/C4;
    # `bad` is missing items. Isolation: only the bad candidate is rejected, at its own
    # index, and the good candidate is processed independently. Uses POOL so the
    # good candidate survives C3 sampled-pool membership.
    good = {"items": [
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "b1", "role": "base_bottom"},
    ]}
    bad = {}  # missing items → invalidItems
    result = validate_gpt_payload({"outfits": [bad, good]}, POOL)
    assert _codes(result.rejections) == [IssueCode.invalid_items]
    assert result.rejections[0].candidate_index == 0
    # good first, bad second → candidate_index follows position, not encounter count
    result2 = validate_gpt_payload({"outfits": [good, bad]}, POOL)
    assert _codes(result2.rejections) == [IssueCode.invalid_items]
    assert result2.rejections[0].candidate_index == 1


def test_schema_valid_candidate_emits_no_rejection():
    # A fully valid two-piece whose ids are in the sampled pool: no rejection and no
    # warning. Uses POOL (not EMPTY_POOL) so the claim is durable into C3 (membership
    # passes) and C4 (where it first becomes an accepted candidate).
    candidate = {"items": [
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "b1", "role": "base_bottom"},
    ]}
    result = validate_gpt_payload({"outfits": [candidate]}, POOL)
    assert result.rejections == []
    assert result.warnings == []


def test_style_move_is_allowed_key_but_not_inspected_in_c2():
    # C2/C5 boundary: styleMove is an allowed candidate key, so it never triggers
    # unknownCandidateField (durable). Its *contents* are boundary-validated only at C5,
    # so a deliberately malformed styleMove produces no styleMove issue in C2. (C5 will
    # update this to warn; StyleMove validation is NOT implemented yet.)
    candidate = {
        "items": [
            {"itemId": "t1", "role": "base_top"},
            {"itemId": "b1", "role": "base_bottom"},
        ],
        "styleMove": {"bogus": 1, "moveType": ""},  # malformed; C5 would warn
    }
    result = validate_gpt_payload({"outfits": [candidate]}, POOL)
    assert IssueCode.unknown_candidate_field not in _codes(result.rejections)
    style_codes = {
        IssueCode.invalid_style_move_shape,
        IssueCode.style_move_item_outside_outfit,
        IssueCode.duplicate_style_move_changed_ids,
    }
    assert not (style_codes & set(_codes(result.rejections)))
    assert not (style_codes & set(_codes(result.warnings)))


# ============================ SlotMap + sampled-pool (C3) ============================

# A pool spanning all five types so structurally-valid candidates (one/two-piece,
# ±outer ±shoes) clear sampled-pool membership. Distinct from the module-level POOL.
POOL_C3 = [
    WardrobeItem("t1", "Tee", ItemType.top, warmth=4, image_url="t1.jpg"),
    WardrobeItem("t2", "Shirt", ItemType.top, warmth=4, image_url="t2.jpg"),
    WardrobeItem("b1", "Jeans", ItemType.bottom, warmth=5, image_url="b1.jpg"),
    WardrobeItem("d1", "Dress", ItemType.dress, warmth=3, image_url="d1.jpg"),
    WardrobeItem("o1", "Coat", ItemType.outer_layer, warmth=8, image_url="o1.jpg"),
    WardrobeItem("s1", "Boots", ItemType.shoes, warmth=2, image_url="s1.jpg"),
]


def _validate_pooled(candidate, pool=POOL_C3):
    """Validate one candidate against a full-type pool (C3 structural/pool tests)."""
    return validate_gpt_payload({"outfits": [candidate]}, pool)


# --- 5.3 normalizer-owned rejects (Decision D7: slotmap.py emits the IssueCode) ---

def test_unknown_role_rejected():
    # A well-formed but non-existent role string is schema-valid in C2; the normalizer
    # rejects the value at C3 (Decision D4/D7) as unknownRole.
    result = _validate_pooled({"items": [{"itemId": "t1", "role": "banana"}]})
    assert _codes(result.rejections) == [IssueCode.unknown_role]
    assert result.rejections[0].candidate_index == 0
    assert result.candidates == []


def test_duplicate_role_slot_rejected():
    # Two items claim the same role slot — last-write-wins would silently drop one, so
    # the normalizer rejects pre-collapse (mutation guard: NOT a silent overwrite).
    result = _validate_pooled({"items": [
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "t2", "role": "base_top"},
    ]})
    assert _codes(result.rejections) == [IssueCode.duplicate_role_slot]
    assert result.candidates == []


# --- 5.4 is_valid_slotmap-owned slot-level structural rejects ---

def test_mixed_template_rejected():
    result = _validate_pooled({"items": [
        {"itemId": "d1", "role": "one_piece"},
        {"itemId": "t1", "role": "base_top"},
    ]})
    assert _codes(result.rejections) == [IssueCode.mixed_template]
    assert result.candidates == []


def test_empty_items_rejected_as_empty_base():
    # items: [] is schema-valid (C2), normalizes to an empty SlotMap, and is rejected
    # as emptyBase by is_valid_slotmap (N3 owner) — NOT invalidItems (mutation guard).
    result = _validate_pooled({"items": []})
    assert _codes(result.rejections) == [IssueCode.empty_base]
    assert IssueCode.invalid_items not in _codes(result.rejections)
    assert result.candidates == []


def test_optionals_only_rejected_as_empty_base():
    # Outer + shoes with no base role → emptyBase.
    result = _validate_pooled({"items": [
        {"itemId": "o1", "role": "outer_layer"},
        {"itemId": "s1", "role": "shoes"},
    ]})
    assert _codes(result.rejections) == [IssueCode.empty_base]
    assert result.candidates == []


def test_incomplete_two_piece_rejected():
    result = _validate_pooled({"items": [{"itemId": "t1", "role": "base_top"}]})
    assert _codes(result.rejections) == [IssueCode.incomplete_two_piece]
    assert result.candidates == []


def test_duplicate_item_id_rejected():
    # Same itemId in two different role slots (top == bottom). is_valid_slotmap owns
    # this at 5.4, before pool membership at 5.5 — the id IS in pool, isolating dupId.
    result = _validate_pooled({"items": [
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "t1", "role": "base_bottom"},
    ]})
    assert _codes(result.rejections) == [IssueCode.duplicate_item_id]
    assert result.candidates == []


# --- pass-through: structurally valid + in-pool → no rejection/warning, and (the
#     C3/C4 boundary) NO accepted candidate yet — that needs the C4 keys ---

@pytest.mark.parametrize("items", [
    [{"itemId": "d1", "role": "one_piece"}],
    [{"itemId": "d1", "role": "one_piece"}, {"itemId": "o1", "role": "outer_layer"}],
    [{"itemId": "d1", "role": "one_piece"}, {"itemId": "s1", "role": "shoes"}],
    [{"itemId": "t1", "role": "base_top"}, {"itemId": "b1", "role": "base_bottom"}],
    [{"itemId": "t1", "role": "base_top"}, {"itemId": "b1", "role": "base_bottom"},
     {"itemId": "o1", "role": "outer_layer"}, {"itemId": "s1", "role": "shoes"}],
])
def test_structurally_valid_in_pool_passes_through(items):
    result = _validate_pooled({"items": items})
    assert result.rejections == []
    assert result.warnings == []
    # C3/C4 boundary mutation guard: a valid + in-pool candidate is NOT accepted yet.
    assert result.candidates == []


# --- 5.5 sampled-pool membership (M2 Step-3 owned) ---

def test_item_outside_pool_rejected():
    # Structurally valid two-piece, but b1 is absent from this single-item pool.
    pool = [WardrobeItem("t1", "Tee", ItemType.top, warmth=4, image_url="t1.jpg")]
    result = validate_gpt_payload({"outfits": [{"items": [
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "b1", "role": "base_bottom"},
    ]}]}, pool)
    assert _codes(result.rejections) == [IssueCode.item_outside_sampled_pool]
    assert result.rejections[0].candidate_index == 0
    assert result.candidates == []


def test_membership_uses_pool_not_wider_wardrobe():
    # An id that could be valid "somewhere" but is not in the sampled pool is still
    # rejected — C3 validates against the bounded pool only (mutation guard).
    pool = [
        WardrobeItem("t1", "Tee", ItemType.top, warmth=4, image_url="t1.jpg"),
        WardrobeItem("b1", "Jeans", ItemType.bottom, warmth=5, image_url="b1.jpg"),
    ]
    result = validate_gpt_payload({"outfits": [{"items": [
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "b_other", "role": "base_bottom"},
    ]}]}, pool)
    assert _codes(result.rejections) == [IssueCode.item_outside_sampled_pool]


def test_structural_reject_precedes_pool_reject():
    # An out-of-pool id on a structurally INVALID candidate reports the structural code,
    # not pool — 5.4 runs before 5.5 (mutation guard: don't check pool before structure).
    result = validate_gpt_payload({"outfits": [{"items": [
        {"itemId": "ghost", "role": "base_top"},  # not in pool AND incomplete two-piece
    ]}]}, POOL_C3)
    assert _codes(result.rejections) == [IssueCode.incomplete_two_piece]


def test_duplicate_pool_ids_raise():
    # Duplicate ids in sampled_pool are caller-contract misuse → ValueError (R12).
    dup_pool = [
        WardrobeItem("t1", "Tee", ItemType.top, warmth=4, image_url="t1.jpg"),
        WardrobeItem("t1", "TeeDup", ItemType.top, warmth=4, image_url="t1b.jpg"),
    ]
    with pytest.raises(ValueError):
        validate_gpt_payload({"outfits": []}, dup_pool)


def test_duplicate_pool_ids_raise_before_root_validation():
    # The pool index is built before the root envelope (flow step 2 < step 3), so a
    # caller-contract dup-id pool raises even for a payload that would itself reject.
    dup_pool = [
        WardrobeItem("t1", "Tee", ItemType.top, warmth=4, image_url="t1.jpg"),
        WardrobeItem("t1", "TeeDup", ItemType.top, warmth=4, image_url="t1b.jpg"),
    ]
    with pytest.raises(ValueError):
        validate_gpt_payload("not-an-object", dup_pool)


# --- 5.5 membership covers OPTIONAL slots too, not just the base ---

def test_optional_outer_outside_pool_rejected():
    # Base in pool, optional outer NOT in pool → itemOutsideSampledPool. Pins that
    # membership walks every filled slot, not only the base role.
    pool = [
        WardrobeItem("t1", "Tee", ItemType.top, warmth=4, image_url="t1.jpg"),
        WardrobeItem("b1", "Jeans", ItemType.bottom, warmth=5, image_url="b1.jpg"),
    ]
    result = validate_gpt_payload({"outfits": [{"items": [
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "b1", "role": "base_bottom"},
        {"itemId": "o_ghost", "role": "outer_layer"},
    ]}]}, pool)
    assert _codes(result.rejections) == [IssueCode.item_outside_sampled_pool]
    assert result.rejections[0].candidate_index == 0
    assert result.candidates == []


def test_optional_shoes_outside_pool_rejected():
    # Base in pool, optional shoes NOT in pool → itemOutsideSampledPool (one-piece).
    pool = [WardrobeItem("d1", "Dress", ItemType.dress, warmth=3, image_url="d1.jpg")]
    result = validate_gpt_payload({"outfits": [{"items": [
        {"itemId": "d1", "role": "one_piece"},
        {"itemId": "s_ghost", "role": "shoes"},
    ]}]}, pool)
    assert _codes(result.rejections) == [IssueCode.item_outside_sampled_pool]
    assert result.rejections[0].candidate_index == 0
    assert result.candidates == []


# --- duplicate itemId across a one-piece base + an optional slot (5.4, hardening) ---

@pytest.mark.parametrize("optional_role", ["outer_layer", "shoes"])
def test_one_piece_duplicate_item_id_with_optional_rejected(optional_role):
    # A dress id reused in an optional slot collapses to a SlotMap with the same id in
    # two slots → duplicateItemId (is_valid_slotmap, 5.4). d1 is in pool, so the dup-id
    # reject (not pool membership) is the governing failure.
    result = _validate_pooled({"items": [
        {"itemId": "d1", "role": "one_piece"},
        {"itemId": "d1", "role": optional_role},
    ]})
    assert _codes(result.rejections) == [IssueCode.duplicate_item_id]
    assert result.candidates == []


# --- candidate-by-candidate isolation for C3 structural/pool failures ---

def test_c3_failures_isolated_indexes_follow_position():
    # A structural reject, a valid+in-pool candidate, and a pool reject, in that order.
    # Each bad candidate is rejected at its ORIGINAL index, the good one between them is
    # still processed (isolation), and candidates stays empty (C3 emits none).
    incomplete = {"items": [{"itemId": "t1", "role": "base_top"}]}           # index 0
    good = {"items": [                                                       # index 1
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "b1", "role": "base_bottom"},
    ]}
    out_of_pool = {"items": [                                                # index 2
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "ghost", "role": "base_bottom"},
    ]}
    result = validate_gpt_payload({"outfits": [incomplete, good, out_of_pool]}, POOL_C3)
    assert _codes(result.rejections) == [
        IssueCode.incomplete_two_piece,
        IssueCode.item_outside_sampled_pool,
    ]
    assert [r.candidate_index for r in result.rejections] == [0, 2]
    assert result.candidates == []


def test_c3_failure_does_not_stop_later_candidate_reversed_order():
    # Reversed: a good candidate first (index 0) then a structurally bad one (index 1).
    # The index follows position, not encounter count — the good one doesn't shift it.
    good = {"items": [
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "b1", "role": "base_bottom"},
    ]}
    bad = {"items": [{"itemId": "t1", "role": "base_top"}]}  # incomplete two-piece
    result = validate_gpt_payload({"outfits": [good, bad]}, POOL_C3)
    assert _codes(result.rejections) == [IssueCode.incomplete_two_piece]
    assert result.rejections[0].candidate_index == 1
    assert result.candidates == []


# ============================ result-model / severity contract ============================

def test_severity_table_complete_and_classified():
    # Every code classifies; the four warning codes are warnings, the rest rejections.
    warning_codes = {
        IssueCode.invalid_style_move_shape,
        IssueCode.style_move_item_outside_outfit,
        IssueCode.duplicate_style_move_changed_ids,
        IssueCode.extra_candidates_ignored,
    }
    for code in IssueCode:
        expected = Severity.warning if code in warning_codes else Severity.rejection
        assert severity_of(code) is expected


def test_issue_is_frozen():
    issue = Issue(IssueCode.malformed_root, None)
    with pytest.raises(Exception):
        issue.code = IssueCode.invalid_json  # type: ignore[misc]
