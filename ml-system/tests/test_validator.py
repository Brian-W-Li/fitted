"""M2 validator contract tests (v2 §12/§13).

Checkpoint C1 (Stage A in the M2 plan §10): the strict parser, the result/issue
model, and root-envelope validation. Candidate/item schema, SlotMap, pool, keys,
dedup, and StyleMove tests land at C2–C5.

Assert on ``IssueCode`` (and ``candidate_index`` where useful), **never** on
``Issue.detail`` prose (M2 plan §4/§10) — the detail text is a debug aid that may
change freely; the codes are the stable contract.
"""

import pytest

from fitted_core.models import IssueCode
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

# C1 ignores sampled_pool; pass an empty pool everywhere.
EMPTY_POOL: list = []


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
