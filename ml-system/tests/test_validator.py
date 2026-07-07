"""M2 validator contract tests (v2 §12/§13).

Checkpoints C1–C6 (Stages A–H in the M2 plan §10): the strict parser, the
result/issue model, root-envelope validation, the per-candidate schema +
forbidden-field pass (candidate/item shape, items/itemId/role, the §12 forbidden
fields), SlotMap normalization, slot-level structural validity, sampled-pool
membership, BaseKey/FullSignature computation and exact-FullSignature dedup (C4 — the
first checkpoint that emits accepted ``ValidatedCandidate``s), StyleMove boundary
validation (C5, flow step 5.8, warning-only), and — at C6 — the ``candidate_requested``
upper bound (type/value validation + the aggregate ``extraCandidatesIgnored`` warning).

Assert on ``IssueCode`` (and ``candidate_index`` where useful), **never** on
``Issue.detail`` prose (M2 plan §4/§10) — the detail text is a debug aid that may
change freely; the codes are the stable contract.
"""

import pytest

from fitted_core.models import IssueCode, ItemType, StyleMove, Template, WardrobeItem
from fitted_core.validator import (
    MAX_JSON_NESTING_DEPTH,
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


# --- pathological nesting: RecursionError is content, not a crash (B1, pre-flight) ---

def test_parse_deeply_nested_json_returns_invalid_json():
    # A hostile/degenerate generator can emit thousands of nesting levels; whether json.loads
    # raises RecursionError or the engine depth guard catches it, this must land on invalidJson.
    deep = '{"a":' * 2000 + "1" + "}" * 2000
    result = parse_gpt_json(deep)
    assert result.payload is None
    assert result.issue.code is IssueCode.invalid_json


def test_parse_json_depth_guard_boundary():
    accepted = '{"a":' * MAX_JSON_NESTING_DEPTH + "1" + "}" * MAX_JSON_NESTING_DEPTH
    rejected = '{"a":' * (MAX_JSON_NESTING_DEPTH + 1) + "1" + "}" * (MAX_JSON_NESTING_DEPTH + 1)

    assert parse_gpt_json(accepted).issue is None
    result = parse_gpt_json(rejected)
    assert result.payload is None
    assert result.issue.code is IssueCode.invalid_json


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


def test_style_move_is_allowed_key_not_a_candidate_field_reject():
    # styleMove is an allowed candidate key, so even a malformed one never triggers a
    # candidate REJECTION (unknownCandidateField / forbiddenGptField). Its contents are
    # boundary-validated at C5 as a WARNING only — never a candidate-field rejection.
    candidate = {
        "items": [
            {"itemId": "t1", "role": "base_top"},
            {"itemId": "b1", "role": "base_bottom"},
        ],
        "styleMove": {"bogus": 1, "moveType": ""},  # malformed → warning, not reject
    }
    result = validate_gpt_payload({"outfits": [candidate]}, POOL)
    assert IssueCode.unknown_candidate_field not in _codes(result.rejections)
    assert IssueCode.forbidden_gpt_field not in _codes(result.rejections)
    assert result.rejections == []
    assert len(result.candidates) == 1
    assert _codes(result.warnings) == [IssueCode.invalid_style_move_shape]


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
    """Validate one candidate against a full-type pool (C3–C5 structural/pool/key/
    StyleMove tests — the pool spans all five types so valid candidates clear membership)."""
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


# --- structurally valid + in-pool → no rejection/warning, and (from C4) accepted as
#     a single keyed ValidatedCandidate ---

@pytest.mark.parametrize("items", [
    [{"itemId": "d1", "role": "one_piece"}],
    [{"itemId": "d1", "role": "one_piece"}, {"itemId": "o1", "role": "outer_layer"}],
    [{"itemId": "d1", "role": "one_piece"}, {"itemId": "s1", "role": "shoes"}],
    [{"itemId": "t1", "role": "base_top"}, {"itemId": "b1", "role": "base_bottom"}],
    [{"itemId": "t1", "role": "base_top"}, {"itemId": "b1", "role": "base_bottom"},
     {"itemId": "o1", "role": "outer_layer"}, {"itemId": "s1", "role": "shoes"}],
])
def test_structurally_valid_in_pool_is_accepted(items):
    result = _validate_pooled({"items": items})
    assert result.rejections == []
    assert result.warnings == []
    # C4: a valid + in-pool candidate is now keyed and accepted (one ValidatedCandidate).
    assert len(result.candidates) == 1
    assert result.candidates[0].source_index == 0


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
    # still processed (isolation) and accepted at its original index (from C4).
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
    # From C4 the good candidate at index 1 is accepted, keeping its original index.
    assert [c.source_index for c in result.candidates] == [1]


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
    # From C4 the good candidate at index 0 is accepted (the bad one doesn't shift it).
    assert [c.source_index for c in result.candidates] == [0]


# ============================ keys + FullSignature dedup (C4) ============================
# Stage E (M2 plan §10): the first checkpoint that emits accepted ValidatedCandidates.
# base_key + full_signature are computed here, so these assert on accepted-candidate
# fields and on exact-FullSignature dedup. Key formats cross-check v2 §7.


def test_accepted_one_piece_candidate():
    # one_piece base_key is the dress id; full_signature appends none/none for the empty
    # optional slots (§7). style_move is None — StyleMove validation is C5, not C4.
    result = _validate_pooled({"items": [{"itemId": "d1", "role": "one_piece"}]})
    assert result.rejections == []
    assert result.warnings == []
    assert len(result.candidates) == 1
    c = result.candidates[0]
    assert c.source_index == 0
    assert c.template is Template.one_piece
    assert c.base_key == "d1"
    assert c.full_signature == "d1|outer=none|shoes=none"
    assert c.slot_map.dress == "d1"
    assert c.style_move is None


def test_accepted_two_piece_candidate_fields():
    # two_piece base_key is "{top}:{bottom}" (§7); slots carried through on the candidate.
    result = _validate_pooled({"items": [
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "b1", "role": "base_bottom"},
    ]})
    assert len(result.candidates) == 1
    c = result.candidates[0]
    assert c.template is Template.two_piece
    assert c.base_key == "t1:b1"
    assert c.full_signature == "t1:b1|outer=none|shoes=none"
    assert c.slot_map.top == "t1"
    assert c.slot_map.bottom == "b1"
    assert c.style_move is None


def test_accepted_optional_outer_candidate():
    # An optional outer shows up in the FullSignature (not the BaseKey) — same base.
    result = _validate_pooled({"items": [
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "b1", "role": "base_bottom"},
        {"itemId": "o1", "role": "outer_layer"},
    ]})
    assert len(result.candidates) == 1
    c = result.candidates[0]
    assert c.base_key == "t1:b1"
    assert c.full_signature == "t1:b1|outer=o1|shoes=none"


def test_accepted_optional_shoes_candidate():
    # An optional shoes shows up in the FullSignature shoes field (one-piece base).
    result = _validate_pooled({"items": [
        {"itemId": "d1", "role": "one_piece"},
        {"itemId": "s1", "role": "shoes"},
    ]})
    assert len(result.candidates) == 1
    c = result.candidates[0]
    assert c.base_key == "d1"
    assert c.full_signature == "d1|outer=none|shoes=s1"


def test_accepted_ordering_after_rejections():
    # reject, accept, reject, accept — survivors stay in input order carrying their
    # original source_index; rejections in encounter order.
    incomplete = {"items": [{"itemId": "t1", "role": "base_top"}]}            # 0 reject
    good_a = {"items": [                                                      # 1 accept
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "b1", "role": "base_bottom"},
    ]}
    out_of_pool = {"items": [                                                 # 2 reject
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "ghost", "role": "base_bottom"},
    ]}
    good_b = {"items": [{"itemId": "d1", "role": "one_piece"}]}               # 3 accept
    result = validate_gpt_payload(
        {"outfits": [incomplete, good_a, out_of_pool, good_b]}, POOL_C3
    )
    assert [c.source_index for c in result.candidates] == [1, 3]
    assert _codes(result.rejections) == [
        IssueCode.incomplete_two_piece,
        IssueCode.item_outside_sampled_pool,
    ]


def test_rejected_candidate_emits_no_accepted_candidate():
    # A structural reject yields zero accepted candidates (no half-accept).
    result = _validate_pooled({"items": [{"itemId": "t1", "role": "base_top"}]})
    assert _codes(result.rejections) == [IssueCode.incomplete_two_piece]
    assert result.candidates == []


def test_exact_full_signature_duplicate_rejects_later():
    # Two identical outfits → first accepted, later identical dropped as
    # duplicateFullSignature (first-occurrence-wins, Decision D9).
    candidate = {"items": [
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "b1", "role": "base_bottom"},
    ]}
    result = validate_gpt_payload({"outfits": [candidate, dict(candidate)]}, POOL_C3)
    assert len(result.candidates) == 1
    assert result.candidates[0].source_index == 0
    assert _codes(result.rejections) == [IssueCode.duplicate_full_signature]
    assert result.rejections[0].candidate_index == 1


def test_same_base_key_different_full_signature_both_survive():
    # Same base pairing, different outer → different FullSignature → BOTH survive. Never
    # dedup on BaseKey (§7 invariant, Decision D9).
    bare = {"items": [
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "b1", "role": "base_bottom"},
    ]}
    with_outer = {"items": [
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "b1", "role": "base_bottom"},
        {"itemId": "o1", "role": "outer_layer"},
    ]}
    result = validate_gpt_payload({"outfits": [bare, with_outer]}, POOL_C3)
    assert len(result.candidates) == 2
    assert result.candidates[0].base_key == result.candidates[1].base_key == "t1:b1"
    assert result.candidates[0].full_signature != result.candidates[1].full_signature
    assert result.rejections == []


@pytest.mark.parametrize("bad_id", ["none", "a:b", "a|b", "a=b"])
def test_key_precondition_failed_wraps_key_value_error(bad_id):
    # An itemId tripping the R10 key guard (reserved char / "none" sentinel) is in pool
    # and structurally valid, so it reaches key computation → keyPreconditionFailed, not
    # an escaping ValueError.
    pool = [
        WardrobeItem(bad_id, "Weird", ItemType.top, warmth=4, image_url="n.jpg"),
        WardrobeItem("b1", "Jeans", ItemType.bottom, warmth=5, image_url="b1.jpg"),
    ]
    result = validate_gpt_payload({"outfits": [{"items": [
        {"itemId": bad_id, "role": "base_top"},
        {"itemId": "b1", "role": "base_bottom"},
    ]}]}, pool)
    assert _codes(result.rejections) == [IssueCode.key_precondition_failed]
    assert result.rejections[0].candidate_index == 0
    assert result.candidates == []


def test_key_failure_does_not_stop_later_candidates():
    # A key-precondition failure at index 0 must not prevent index 1 from being accepted.
    pool = [
        WardrobeItem("none", "Weird", ItemType.top, warmth=4, image_url="n.jpg"),
        WardrobeItem("t1", "Tee", ItemType.top, warmth=4, image_url="t1.jpg"),
        WardrobeItem("b1", "Jeans", ItemType.bottom, warmth=5, image_url="b1.jpg"),
    ]
    bad = {"items": [
        {"itemId": "none", "role": "base_top"},
        {"itemId": "b1", "role": "base_bottom"},
    ]}
    good = {"items": [
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "b1", "role": "base_bottom"},
    ]}
    result = validate_gpt_payload({"outfits": [bad, good]}, pool)
    assert _codes(result.rejections) == [IssueCode.key_precondition_failed]
    assert [c.source_index for c in result.candidates] == [1]


def test_structural_or_pool_reject_precedes_key_computation():
    # An itemId that would trip the R10 key guard but is ALSO out of pool reports the
    # pool reject — 5.5 (membership) runs before 5.6 (keys). Mutation guard: keys must
    # not be computed before structural/pool validation.
    pool = [WardrobeItem("b1", "Jeans", ItemType.bottom, warmth=5, image_url="b1.jpg")]
    result = validate_gpt_payload({"outfits": [{"items": [
        {"itemId": "a:b", "role": "base_top"},   # reserved char AND not in pool
        {"itemId": "b1", "role": "base_bottom"},
    ]}]}, pool)
    assert _codes(result.rejections) == [IssueCode.item_outside_sampled_pool]
    assert IssueCode.key_precondition_failed not in _codes(result.rejections)


def test_malformed_style_move_warns_candidate_still_accepted():
    # A valid candidate with a malformed styleMove is accepted with style_move=None and a
    # single invalid_style_move_shape WARNING (never a rejection) — H23/§13: the outfit's
    # structural validity is independent of its styling prose.
    candidate = {
        "items": [
            {"itemId": "t1", "role": "base_top"},
            {"itemId": "b1", "role": "base_bottom"},
        ],
        "styleMove": {"bogus": 1, "moveType": ""},  # malformed
    }
    result = _validate_pooled(candidate)
    assert len(result.candidates) == 1
    assert result.candidates[0].style_move is None
    assert result.rejections == []
    assert _codes(result.warnings) == [IssueCode.invalid_style_move_shape]


@pytest.mark.parametrize("bad_id", ["none", "o:x"])
def test_key_precondition_failed_from_optional_outer(bad_id):
    # A reserved-char / sentinel id in an OPTIONAL outer slot still trips the R10 guard —
    # full_signature guards outer/shoes too, not just the base — so it surfaces as
    # keyPreconditionFailed. The bad id is in pool, so 5.5 passes and 5.6 fires.
    pool = [
        WardrobeItem("t1", "Tee", ItemType.top, warmth=4, image_url="t1.jpg"),
        WardrobeItem("b1", "Jeans", ItemType.bottom, warmth=5, image_url="b1.jpg"),
        WardrobeItem(bad_id, "Coat", ItemType.outer_layer, warmth=8, image_url="o.jpg"),
    ]
    result = validate_gpt_payload({"outfits": [{"items": [
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "b1", "role": "base_bottom"},
        {"itemId": bad_id, "role": "outer_layer"},
    ]}]}, pool)
    assert _codes(result.rejections) == [IssueCode.key_precondition_failed]
    assert result.rejections[0].candidate_index == 0
    assert result.candidates == []


@pytest.mark.parametrize("bad_id", ["none", "s|x"])
def test_key_precondition_failed_from_optional_shoes(bad_id):
    # Same as the outer case but for an OPTIONAL shoes slot (one-piece base) — the R10
    # guard covers every participating itemId, including shoes.
    pool = [
        WardrobeItem("d1", "Dress", ItemType.dress, warmth=3, image_url="d1.jpg"),
        WardrobeItem(bad_id, "Boots", ItemType.shoes, warmth=2, image_url="s.jpg"),
    ]
    result = validate_gpt_payload({"outfits": [{"items": [
        {"itemId": "d1", "role": "one_piece"},
        {"itemId": bad_id, "role": "shoes"},
    ]}]}, pool)
    assert _codes(result.rejections) == [IssueCode.key_precondition_failed]
    assert result.rejections[0].candidate_index == 0
    assert result.candidates == []


def test_dedup_is_signature_based_not_array_order():
    # Same outfit with items listed in a different array order → same normalized SlotMap
    # → same FullSignature → the second is a duplicate. Proves dedup keys on the SlotMap
    # signature, not the raw items-array order.
    a = {"items": [
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "b1", "role": "base_bottom"},
        {"itemId": "o1", "role": "outer_layer"},
    ]}
    b = {"items": [
        {"itemId": "o1", "role": "outer_layer"},
        {"itemId": "b1", "role": "base_bottom"},
        {"itemId": "t1", "role": "base_top"},
    ]}
    result = validate_gpt_payload({"outfits": [a, b]}, POOL_C3)
    assert len(result.candidates) == 1
    assert result.candidates[0].source_index == 0
    assert _codes(result.rejections) == [IssueCode.duplicate_full_signature]
    assert result.rejections[0].candidate_index == 1


def test_one_piece_same_base_key_different_optionals_all_survive():
    # One-piece mirror of the two-piece same-BaseKey case: the same dress (BaseKey "d1")
    # with no optional, a different outer, and a different shoes → three distinct
    # FullSignatures → ALL survive. Never dedup on BaseKey (§7, Decision D9).
    bare = {"items": [{"itemId": "d1", "role": "one_piece"}]}
    with_outer = {"items": [
        {"itemId": "d1", "role": "one_piece"},
        {"itemId": "o1", "role": "outer_layer"},
    ]}
    with_shoes = {"items": [
        {"itemId": "d1", "role": "one_piece"},
        {"itemId": "s1", "role": "shoes"},
    ]}
    result = validate_gpt_payload({"outfits": [bare, with_outer, with_shoes]}, POOL_C3)
    assert len(result.candidates) == 3
    assert {c.base_key for c in result.candidates} == {"d1"}
    assert len({c.full_signature for c in result.candidates}) == 3
    assert result.rejections == []


# ============================ StyleMove validation (C5) ============================
# Stage F (M2 plan §10): styleMove is validated (flow 5.8) ONLY for accepted candidates,
# warning-only — an invalid/missing styleMove never rejects the candidate (D5, H23, §13).
# A base two-piece (t1+b1, both in POOL_C3) carries most cases.

_BASE_ITEMS = [
    {"itemId": "t1", "role": "base_top"},
    {"itemId": "b1", "role": "base_bottom"},
]
_VALID_STYLE_MOVE = {
    "moveType": "swap",
    "changedItemIds": ["t1"],
    "oneSentence": "Wear the tee untucked.",
}


def _with_style_move(style_move, items=None):
    """A schema-valid two-piece candidate carrying the given styleMove value."""
    return {"items": list(items or _BASE_ITEMS), "styleMove": style_move}


# --- missing styleMove → valid, no warning, style_move=None (D5) ---

def test_missing_style_move_accepted_no_warning():
    result = _validate_pooled({"items": list(_BASE_ITEMS)})
    assert len(result.candidates) == 1
    assert result.candidates[0].style_move is None
    assert result.warnings == []
    assert result.rejections == []


# --- valid styleMove → attached ---

def test_valid_style_move_attached():
    result = _validate_pooled(_with_style_move(dict(_VALID_STYLE_MOVE)))
    assert result.warnings == []
    assert result.rejections == []
    assert len(result.candidates) == 1
    sm = result.candidates[0].style_move
    assert isinstance(sm, StyleMove)
    assert sm.move_type == "swap"
    assert sm.changed_item_ids == ["t1"]
    assert sm.one_sentence == "Wear the tee untucked."


def test_valid_style_move_can_reference_optional_outer_or_shoes():
    # H23 subset target is ALL filled slots, incl. optionals — a styleMove may reference
    # the outer/shoes it added. Two-piece + outer o1 + shoes s1, changedItemIds covers both.
    items = [
        {"itemId": "t1", "role": "base_top"},
        {"itemId": "b1", "role": "base_bottom"},
        {"itemId": "o1", "role": "outer_layer"},
        {"itemId": "s1", "role": "shoes"},
    ]
    sm = {"moveType": "layer", "changedItemIds": ["o1", "s1"], "oneSentence": "Add the coat and boots."}
    result = _validate_pooled(_with_style_move(sm, items))
    assert result.warnings == []
    assert len(result.candidates) == 1
    assert result.candidates[0].style_move.changed_item_ids == ["o1", "s1"]


# --- present-but-invalid shape → invalid_style_move_shape (warning), candidate stands ---

@pytest.mark.parametrize("bad", [None, "x", 5, 1.0, True, [], ["x"]])
def test_non_object_style_move_warns(bad):
    # null/non-object styleMove is present-but-invalid → invalid_style_move_shape warning.
    result = _validate_pooled(_with_style_move(bad))
    assert _codes(result.warnings) == [IssueCode.invalid_style_move_shape]
    assert len(result.candidates) == 1
    assert result.candidates[0].style_move is None
    assert result.rejections == []


def test_unknown_field_inside_style_move_warns_not_rejects():
    sm = {**_VALID_STYLE_MOVE, "bogus": 1}
    result = _validate_pooled(_with_style_move(sm))
    assert _codes(result.warnings) == [IssueCode.invalid_style_move_shape]
    assert IssueCode.unknown_candidate_field not in _codes(result.rejections)
    assert len(result.candidates) == 1


@pytest.mark.parametrize("forbidden", ["score", "optionPath", "risk", "imageUrl"])
def test_forbidden_field_inside_style_move_warns_not_rejects(forbidden):
    # A §12-forbidden name INSIDE styleMove is a shape warning, NOT a forbiddenGptField
    # reject (M2 plan §4: forbidden/unknown inside styleMove → invalid_style_move_shape).
    sm = {**_VALID_STYLE_MOVE, forbidden: 1}
    result = _validate_pooled(_with_style_move(sm))
    assert _codes(result.warnings) == [IssueCode.invalid_style_move_shape]
    assert IssueCode.forbidden_gpt_field not in _codes(result.rejections)
    assert len(result.candidates) == 1


@pytest.mark.parametrize("field", ["moveType", "oneSentence"])
def test_empty_string_field_warns(field):
    sm = {**_VALID_STYLE_MOVE, field: ""}
    result = _validate_pooled(_with_style_move(sm))
    assert _codes(result.warnings) == [IssueCode.invalid_style_move_shape]
    assert len(result.candidates) == 1


@pytest.mark.parametrize("field", ["moveType", "oneSentence"])
@pytest.mark.parametrize("blank", ["   ", "\t", "\n  \n"])
def test_whitespace_only_style_move_field_warns(field, blank):
    # Whitespace-only text is as unusable as empty — it would render a blank styling
    # explanation on the card (B2, pre-flight 2026-07-06).
    sm = {**_VALID_STYLE_MOVE, field: blank}
    result = _validate_pooled(_with_style_move(sm))
    assert _codes(result.warnings) == [IssueCode.invalid_style_move_shape]
    assert len(result.candidates) == 1


@pytest.mark.parametrize("field", ["moveType", "changedItemIds", "oneSentence"])
def test_missing_required_field_warns(field):
    sm = {k: v for k, v in _VALID_STYLE_MOVE.items() if k != field}
    result = _validate_pooled(_with_style_move(sm))
    assert _codes(result.warnings) == [IssueCode.invalid_style_move_shape]
    assert len(result.candidates) == 1


@pytest.mark.parametrize("bad", [5, 1.0, True, [], {}, None])
@pytest.mark.parametrize("field", ["moveType", "oneSentence"])
def test_non_string_field_warns(field, bad):
    sm = {**_VALID_STYLE_MOVE, field: bad}
    result = _validate_pooled(_with_style_move(sm))
    assert _codes(result.warnings) == [IssueCode.invalid_style_move_shape]
    assert len(result.candidates) == 1


@pytest.mark.parametrize("changed", ["x", 5, True, {}, None, [], [5], [""], ["t1", 5], ["t1", ""]])
def test_bad_changed_item_ids_warns_shape(changed):
    # changedItemIds must be a non-empty array of non-empty strings: non-array, empty,
    # non-string entry, or empty-string entry → invalid_style_move_shape (shape, not subset).
    sm = {**_VALID_STYLE_MOVE, "changedItemIds": changed}
    result = _validate_pooled(_with_style_move(sm))
    assert _codes(result.warnings) == [IssueCode.invalid_style_move_shape]
    assert len(result.candidates) == 1


# --- H23 subset + duplicate (warnings) ---

def test_changed_item_ids_outside_outfit_warns():
    # Well-shaped changedItemIds but references an id not in the outfit → H23 subset fail.
    sm = {**_VALID_STYLE_MOVE, "changedItemIds": ["b1", "ghost"]}
    result = _validate_pooled(_with_style_move(sm))
    assert _codes(result.warnings) == [IssueCode.style_move_item_outside_outfit]
    assert len(result.candidates) == 1
    assert result.candidates[0].style_move is None


def test_duplicate_changed_item_ids_warns():
    # All ids in outfit but changedItemIds has a duplicate → duplicate_style_move_changed_ids.
    sm = {**_VALID_STYLE_MOVE, "changedItemIds": ["t1", "t1"]}
    result = _validate_pooled(_with_style_move(sm))
    assert _codes(result.warnings) == [IssueCode.duplicate_style_move_changed_ids]
    assert len(result.candidates) == 1
    assert result.candidates[0].style_move is None


# --- first-failing-check-wins order: shape → subset → duplicate (plan §7) ---

def test_style_move_first_failure_wins_shape_before_subset():
    # Malformed shape (empty moveType) AND an out-of-outfit changedItemId → shape wins.
    sm = {"moveType": "", "changedItemIds": ["ghost"], "oneSentence": "x"}
    result = _validate_pooled(_with_style_move(sm))
    assert _codes(result.warnings) == [IssueCode.invalid_style_move_shape]


def test_style_move_first_failure_wins_subset_before_duplicate():
    # Out-of-outfit AND duplicate ("ghost" twice) → subset/outside-outfit wins.
    sm = {**_VALID_STYLE_MOVE, "changedItemIds": ["ghost", "ghost"]}
    result = _validate_pooled(_with_style_move(sm))
    assert _codes(result.warnings) == [IssueCode.style_move_item_outside_outfit]


# --- invalid styleMove never rejects / never stops later candidates; index correctness ---

def test_invalid_style_move_does_not_reject_candidate():
    sm = {"moveType": "", "changedItemIds": [], "oneSentence": ""}  # multiply malformed
    result = _validate_pooled(_with_style_move(sm))
    assert result.rejections == []
    assert len(result.candidates) == 1
    assert result.candidates[0].style_move is None


def test_invalid_style_move_does_not_stop_later_candidates():
    bad = _with_style_move({"moveType": ""})                          # index 0, warns
    good = {"items": [{"itemId": "d1", "role": "one_piece"}]}         # index 1, accepted
    result = validate_gpt_payload({"outfits": [bad, good]}, POOL_C3)
    assert [c.source_index for c in result.candidates] == [0, 1]
    assert _codes(result.warnings) == [IssueCode.invalid_style_move_shape]
    assert result.warnings[0].candidate_index == 0
    assert result.rejections == []


def test_style_move_warning_index_is_source_index():
    # A clean candidate at 0, then a candidate with a bad styleMove at 1 → the warning
    # carries the original source index (1), not an encounter counter.
    clean = {"items": [{"itemId": "d1", "role": "one_piece"}]}
    bad = _with_style_move({"moveType": ""})
    result = validate_gpt_payload({"outfits": [clean, bad]}, POOL_C3)
    assert _codes(result.warnings) == [IssueCode.invalid_style_move_shape]
    assert result.warnings[0].candidate_index == 1


# --- dedup runs before styleMove (§9) ---

def test_duplicate_full_signature_rejected_before_style_move_inspection():
    # §9: dedup (5.7) runs before styleMove (5.8). Duplicate A (invalid styleMove) precedes
    # duplicate B (valid styleMove): A is KEPT (its styleMove dropped with ONE warning), B
    # is rejected as duplicateFullSignature and is NEVER styleMove-inspected (no 2nd warning).
    a = {"items": list(_BASE_ITEMS), "styleMove": {"moveType": ""}}          # invalid styleMove
    b = {"items": list(_BASE_ITEMS), "styleMove": dict(_VALID_STYLE_MOVE)}   # valid styleMove
    result = validate_gpt_payload({"outfits": [a, b]}, POOL_C3)
    assert [c.source_index for c in result.candidates] == [0]
    assert result.candidates[0].style_move is None  # A kept, its styleMove dropped
    assert _codes(result.rejections) == [IssueCode.duplicate_full_signature]
    assert result.rejections[0].candidate_index == 1
    # exactly one styleMove warning (A's); B was never inspected
    assert _codes(result.warnings) == [IssueCode.invalid_style_move_shape]
    assert result.warnings[0].candidate_index == 0


def test_dedup_before_style_move_second_duplicate_invalid_style_move_not_warned():
    # Symmetric to the test above: A (first) has a VALID styleMove and is accepted; B
    # (duplicate) has an INVALID styleMove but is rejected by dedup (5.7) before styleMove
    # (5.8), so B is never inspected → NO styleMove warning is emitted at all.
    a = {"items": list(_BASE_ITEMS), "styleMove": dict(_VALID_STYLE_MOVE)}  # valid → attached
    b = {"items": list(_BASE_ITEMS), "styleMove": {"moveType": ""}}         # invalid, but dup
    result = validate_gpt_payload({"outfits": [a, b]}, POOL_C3)
    assert [c.source_index for c in result.candidates] == [0]
    assert isinstance(result.candidates[0].style_move, StyleMove)  # A's valid move attached
    assert _codes(result.rejections) == [IssueCode.duplicate_full_signature]
    assert result.rejections[0].candidate_index == 1
    assert result.warnings == []  # B never styleMove-inspected


# --- styleMove (5.8) is reached ONLY for accepted candidates: a candidate rejected at any
#     earlier stage carries an invalid styleMove that is never inspected (no warning) ---

def test_style_move_not_inspected_when_candidate_schema_rejected():
    # Missing items → invalidItems (schema 5.1) rejects before acceptance; the malformed
    # styleMove (would warn if inspected) is never reached.
    candidate = {"styleMove": {"moveType": ""}}  # no items
    result = _validate_pooled(candidate)
    assert _codes(result.rejections) == [IssueCode.invalid_items]
    assert result.warnings == []
    assert result.candidates == []


def test_style_move_not_inspected_when_structural_rejected():
    # incompleteTwoPiece (top only, 5.4) rejects before acceptance → no styleMove warning.
    candidate = {
        "items": [{"itemId": "t1", "role": "base_top"}],
        "styleMove": {"moveType": ""},  # would warn if inspected
    }
    result = _validate_pooled(candidate)
    assert _codes(result.rejections) == [IssueCode.incomplete_two_piece]
    assert result.warnings == []
    assert result.candidates == []


def test_style_move_not_inspected_when_pool_rejected():
    # A structurally valid two-piece whose bottom is out of pool → itemOutsideSampledPool
    # (5.5) rejects before acceptance → no styleMove warning. Single-item pool isolates it.
    pool = [WardrobeItem("t1", "Tee", ItemType.top, warmth=4, image_url="t1.jpg")]
    candidate = {
        "items": [
            {"itemId": "t1", "role": "base_top"},
            {"itemId": "b1", "role": "base_bottom"},  # not in pool
        ],
        "styleMove": {"moveType": ""},
    }
    result = validate_gpt_payload({"outfits": [candidate]}, pool)
    assert _codes(result.rejections) == [IssueCode.item_outside_sampled_pool]
    assert result.warnings == []
    assert result.candidates == []


def test_style_move_not_inspected_when_key_precondition_failed():
    # A reserved-sentinel base id trips the R10 key guard → keyPreconditionFailed (5.6)
    # rejects before acceptance (5.6 < 5.8) → no styleMove warning. The bad id is in pool
    # so 5.5 passes and 5.6 fires.
    pool = [
        WardrobeItem("none", "Weird", ItemType.top, warmth=4, image_url="n.jpg"),
        WardrobeItem("b1", "Jeans", ItemType.bottom, warmth=5, image_url="b1.jpg"),
    ]
    candidate = {
        "items": [
            {"itemId": "none", "role": "base_top"},
            {"itemId": "b1", "role": "base_bottom"},
        ],
        "styleMove": {"moveType": ""},
    }
    result = validate_gpt_payload({"outfits": [candidate]}, pool)
    assert _codes(result.rejections) == [IssueCode.key_precondition_failed]
    assert result.warnings == []
    assert result.candidates == []


@pytest.mark.parametrize("future_field", ["matchedTraits", "missingTraits"])
def test_future_traits_field_inside_style_move_warns_not_rejects(future_field):
    # matchedTraits/missingTraits are [NEXT] (§6.5) and candidate-level forbidden, but
    # INSIDE styleMove they are a shape warning, never a candidate forbidden/unknown reject.
    sm = {**_VALID_STYLE_MOVE, future_field: ["x"]}
    result = _validate_pooled(_with_style_move(sm))
    assert _codes(result.warnings) == [IssueCode.invalid_style_move_shape]
    assert IssueCode.forbidden_gpt_field not in _codes(result.rejections)
    assert IssueCode.unknown_candidate_field not in _codes(result.rejections)
    assert len(result.candidates) == 1


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


# ============================ candidate_requested bounds (C6) ============================
# Stage G (M2 plan §10): candidate_requested is finally consumed as an upper bound, plus the
# Stage-H mutants unique to this dimension (treating the bound as exact; ignored extras
# leaking into accepted candidates / dedup / StyleMove). Decision D6 (raise on caller misuse)
# and the §12 "upper-bound hint" contract. None = unbounded (explicit test mode); a
# production caller passes the real SamplerResult.candidate_requested.

# Two distinct valid candidates (different FullSignatures → both survive when unbounded).
_CR_ONE_PIECE = {"items": [{"itemId": "d1", "role": "one_piece"}]}
_CR_TWO_PIECE = {"items": [
    {"itemId": "t1", "role": "base_top"},
    {"itemId": "b1", "role": "base_bottom"},
]}


# --- value/type validation (D6): caller misuse raises, never becomes an Issue ---

def test_candidate_requested_none_validates_all():
    result = validate_gpt_payload(
        {"outfits": [_CR_ONE_PIECE, _CR_TWO_PIECE]}, POOL_C3, candidate_requested=None
    )
    assert len(result.candidates) == 2
    assert IssueCode.extra_candidates_ignored not in _codes(result.warnings)


def test_candidate_requested_omitted_is_unbounded():
    # Omitting the arg (signature default None) behaves exactly like an explicit None.
    result = validate_gpt_payload({"outfits": [_CR_ONE_PIECE, _CR_TWO_PIECE]}, POOL_C3)
    assert len(result.candidates) == 2
    assert result.warnings == []


def test_candidate_requested_zero_raises_value_error():
    # 0 is wrong VALUE — the normal flow short-circuits to notEnoughItems before GPT, so a
    # 0 request here is caller misuse (Decision D6).
    with pytest.raises(ValueError):
        validate_gpt_payload({"outfits": []}, POOL_C3, candidate_requested=0)


@pytest.mark.parametrize("bound", [-1, -40])
def test_candidate_requested_negative_raises_value_error(bound):
    with pytest.raises(ValueError):
        validate_gpt_payload({"outfits": []}, POOL_C3, candidate_requested=bound)


@pytest.mark.parametrize("bound", [True, False])
def test_candidate_requested_bool_raises_type_error(bound):
    # bool is an int subclass; it must be rejected as a TYPE error, never silently read as
    # 1/0 (mutant: an int-first guard would let True through as bound=1).
    with pytest.raises(TypeError):
        validate_gpt_payload({"outfits": []}, POOL_C3, candidate_requested=bound)


@pytest.mark.parametrize("bound", [1.0, 1.5, "1", [1], {1}, {"n": 1}])
def test_candidate_requested_non_int_raises_type_error(bound):
    with pytest.raises(TypeError):
        validate_gpt_payload({"outfits": []}, POOL_C3, candidate_requested=bound)


# --- count behavior: fewer / exact / more than the bound ---

def test_candidate_requested_fewer_than_bound_no_warning():
    # Returning fewer candidates than requested is valid (§12) — not an error, no warning.
    result = validate_gpt_payload({"outfits": [_CR_ONE_PIECE]}, POOL_C3, candidate_requested=5)
    assert len(result.candidates) == 1
    assert result.warnings == []
    assert result.rejections == []


def test_candidate_requested_exact_count_no_warning():
    result = validate_gpt_payload(
        {"outfits": [_CR_ONE_PIECE, _CR_TWO_PIECE]}, POOL_C3, candidate_requested=2
    )
    assert len(result.candidates) == 2
    assert result.warnings == []
    assert result.rejections == []


def test_candidate_requested_more_than_bound_ignores_extras():
    # Two valid candidates, bound 1 → only the first is validated/accepted; one aggregate
    # extraCandidatesIgnored warning carrying candidate_index=None.
    result = validate_gpt_payload(
        {"outfits": [_CR_ONE_PIECE, _CR_TWO_PIECE]}, POOL_C3, candidate_requested=1
    )
    assert [c.source_index for c in result.candidates] == [0]
    assert _codes(result.warnings) == [IssueCode.extra_candidates_ignored]
    assert result.warnings[0].candidate_index is None
    assert result.rejections == []


def test_extra_candidates_ignored_fires_even_when_in_bound_rejected():
    # The warning trigger is raw len(outfits) > bound, independent of acceptance: a rejected
    # first candidate still warns about the ignored extra.
    incomplete = {"items": [{"itemId": "t1", "role": "base_top"}]}  # incompleteTwoPiece
    result = validate_gpt_payload(
        {"outfits": [incomplete, _CR_ONE_PIECE]}, POOL_C3, candidate_requested=1
    )
    assert result.candidates == []
    assert _codes(result.rejections) == [IssueCode.incomplete_two_piece]
    assert _codes(result.warnings) == [IssueCode.extra_candidates_ignored]


# --- ignored extras are sliced BEFORE validation: they cannot leak into accepted
#     candidates, rejections, dedup state, or StyleMove warnings (Stage-H mutants) ---

def test_extra_candidates_ignored_does_not_affect_dedup():
    # bound 1, then an exact duplicate of the accepted candidate. The duplicate is sliced
    # off, so it never reaches dedup → NO duplicateFullSignature (mutant: validate-all-then-
    # cap would emit one).
    result = validate_gpt_payload(
        {"outfits": [_CR_TWO_PIECE, dict(_CR_TWO_PIECE)]}, POOL_C3, candidate_requested=1
    )
    assert len(result.candidates) == 1
    assert IssueCode.duplicate_full_signature not in _codes(result.rejections)
    assert _codes(result.warnings) == [IssueCode.extra_candidates_ignored]


def test_extra_candidates_ignored_does_not_produce_candidate_issues():
    # The extra is arbitrarily malformed (non-list items + a forbidden field). Sliced off,
    # it produces NO schema/structural/forbidden rejection (mutant would reject it).
    malformed_extra = {"items": "not-a-list", "score": 5}
    result = validate_gpt_payload(
        {"outfits": [_CR_ONE_PIECE, malformed_extra]}, POOL_C3, candidate_requested=1
    )
    assert len(result.candidates) == 1
    assert result.rejections == []
    assert _codes(result.warnings) == [IssueCode.extra_candidates_ignored]


def test_extra_candidates_ignored_does_not_affect_style_move_warnings():
    # The accepted candidate has no styleMove; the ignored extra carries a malformed one.
    # Only extraCandidatesIgnored is emitted — the extra's styleMove is never inspected.
    extra_bad_sm = {"items": list(_BASE_ITEMS), "styleMove": {"moveType": ""}}
    result = validate_gpt_payload(
        {"outfits": [_CR_ONE_PIECE, extra_bad_sm]}, POOL_C3, candidate_requested=1
    )
    assert len(result.candidates) == 1
    assert result.candidates[0].style_move is None
    assert _codes(result.warnings) == [IssueCode.extra_candidates_ignored]


def test_extra_candidates_ignored_source_index_unaffected():
    # bound 2 over three valid candidates → the first two accepted keep indices 0 and 1
    # (a prefix slice preserves original source indexes).
    third = {"items": [
        {"itemId": "t2", "role": "base_top"},
        {"itemId": "b1", "role": "base_bottom"},
    ]}
    result = validate_gpt_payload(
        {"outfits": [_CR_ONE_PIECE, _CR_TWO_PIECE, third]}, POOL_C3, candidate_requested=2
    )
    assert [c.source_index for c in result.candidates] == [0, 1]
    assert _codes(result.warnings) == [IssueCode.extra_candidates_ignored]


def test_extra_candidates_ignored_precedes_per_candidate_warnings():
    # The aggregate warning is recorded at the bound step (4), before the per-candidate loop
    # (5). An accepted in-bound candidate carrying a bad styleMove emits its warning AFTER
    # the aggregate one → encounter order [extraCandidatesIgnored, invalidStyleMoveShape].
    good_bad_sm = {"items": list(_BASE_ITEMS), "styleMove": {"moveType": ""}}
    result = validate_gpt_payload(
        {"outfits": [good_bad_sm, _CR_ONE_PIECE]}, POOL_C3, candidate_requested=1
    )
    assert len(result.candidates) == 1
    assert _codes(result.warnings) == [
        IssueCode.extra_candidates_ignored,
        IssueCode.invalid_style_move_shape,
    ]
    assert result.warnings[0].candidate_index is None
    assert result.warnings[1].candidate_index == 0


# --- precedence: candidate_requested resolution (step 1) precedes pool index (2) and root
#     envelope (3); the bound step (4) never runs on a malformed root ---

def test_candidate_requested_resolved_before_pool_index():
    # An invalid bound (bool → TypeError) and a duplicate-id pool (→ ValueError) both fail.
    # Step 1 < step 2, so the TypeError wins — candidate_requested is resolved first.
    dup_pool = [
        WardrobeItem("t1", "Tee", ItemType.top, warmth=4, image_url="t1.jpg"),
        WardrobeItem("t1", "TeeDup", ItemType.top, warmth=4, image_url="t1b.jpg"),
    ]
    with pytest.raises(TypeError):
        validate_gpt_payload({"outfits": []}, dup_pool, candidate_requested=True)


def test_candidate_requested_invalid_raises_before_root_validation():
    # An invalid bound (0 → ValueError) on a malformed root raises rather than returning a
    # malformedRoot rejection — step 1 precedes step 3.
    with pytest.raises(ValueError):
        validate_gpt_payload("not-an-object", POOL_C3, candidate_requested=0)


def test_extra_candidates_ignored_not_emitted_on_malformed_root():
    # A malformed root short-circuits at step 3 (return) before the bound step 4 → only
    # malformedRoot, no extraCandidatesIgnored, even though surplus candidates were supplied.
    payload = {"outfits": [_CR_ONE_PIECE, _CR_TWO_PIECE], "extra": 1}
    result = validate_gpt_payload(payload, POOL_C3, candidate_requested=1)
    assert _codes(result.rejections) == [IssueCode.malformed_root]
    assert result.warnings == []
    assert result.candidates == []
