"""M2 GPT-response validator — parse + strict root envelope (v2 §12/§13).

The first strict LLM-output boundary (pipeline Steps 2→3, §9): turn a raw GPT
response string into structurally-valid, deduplicated, keyed candidate outfits plus
a structured issue log. Two public entry points (M2 plan Decision D1/D2):

- ``parse_gpt_json(raw)`` — strict JSON parse only. Pure; no network, no repair.
- ``validate_gpt_payload(payload, sampled_pool, candidate_requested=None)`` —
  validate an already-parsed payload against the §12 schema.

**Checkpoint scope (C1).** This file currently implements the result model, the
strict parser, and **root-envelope validation only**. Candidate/item schema,
SlotMap normalization, sampled-pool membership, key/dedup, and StyleMove validation
land at C2–C5 (M2 plan §11). The ``sampled_pool`` and ``candidate_requested``
parameters are part of the pinned public signature (D1) but are not yet consumed —
a malformed root short-circuits before any nested work, and a valid root yields zero
candidates until C2 wires per-candidate validation.

Error-model convention (package ``__init__.py``): expected, data-driven failures go
to the issue channel (``Issue`` / ``ParseResult`` / ``ValidationResult``);
caller-contract violations raise. So a non-``str`` ``raw`` raises ``TypeError``
(caller misuse), while malformed JSON *content* returns ``invalidJson`` (data).

Sources: docs/Fitted_Spec_v2.md §7/§8/§9/§12/§13, docs/plans/m2-validator.md.
"""

import json
from dataclasses import dataclass
from enum import Enum
from typing import Optional, Sequence

from fitted_core.models import (
    IssueCode,
    SlotMap,
    StyleMove,
    Template,
    WardrobeItem,
)


# ============================ result / issue model ============================


class Severity(Enum):
    """Whether an issue drops its locus (rejection) or only annotates it (warning)."""

    rejection = "rejection"
    warning = "warning"


@dataclass(frozen=True)
class Issue:
    """One structured validation finding.

    ``candidate_index`` is the position in the original ``outfits`` array, or
    ``None`` for root/aggregate issues. ``detail`` is a human debug aid only —
    **never asserted in tests** (M2 plan §4/§10); downstream code branches on
    ``code``, which is the stable contract.
    """

    code: IssueCode
    candidate_index: Optional[int]
    detail: Optional[str] = None


@dataclass(frozen=True)
class ValidatedCandidate:
    """One structurally-valid, keyed outfit that survived validation.

    ``source_index`` is its position in the original ``outfits`` array (survivors
    stay in input order). ``style_move`` is present iff a valid StyleMove was
    supplied; otherwise ``None`` (M2 plan Decision D5). Populated starting at C2/C3;
    C1 never emits one.
    """

    source_index: int
    slot_map: SlotMap
    template: Template
    base_key: str
    full_signature: str
    style_move: Optional[StyleMove]


@dataclass(frozen=True)
class ParseResult:
    """Result of ``parse_gpt_json``: ``payload`` set on success, else ``issue`` set."""

    payload: Optional[object]
    issue: Optional[Issue]


@dataclass(frozen=True)
class ValidationResult:
    """Result of ``validate_gpt_payload`` — accepted candidates plus the issue log.

    ``candidates`` are in accepted input order; ``rejections`` and ``warnings`` are
    in encounter order (M2 plan §7 *Result ordering*).
    """

    candidates: list[ValidatedCandidate]
    rejections: list[Issue]
    warnings: list[Issue]


# Severity is a function of the code (single source of truth — M2 plan §4): the
# issue log's rejections/warnings membership follows this table exactly, so it is
# never stored on an Issue (no drift between a stored severity and which list an
# issue lands in). Mirrors the §4 issue-code table verbatim.
_SEVERITY: dict[IssueCode, Severity] = {
    # root / envelope
    IssueCode.invalid_json: Severity.rejection,
    IssueCode.malformed_root: Severity.rejection,
    IssueCode.invalid_outfits: Severity.rejection,
    # candidate / item schema
    IssueCode.invalid_candidate_shape: Severity.rejection,
    IssueCode.unknown_candidate_field: Severity.rejection,
    IssueCode.forbidden_gpt_field: Severity.rejection,
    IssueCode.invalid_items: Severity.rejection,
    IssueCode.invalid_item_shape: Severity.rejection,
    IssueCode.unknown_item_field: Severity.rejection,
    IssueCode.invalid_item_id: Severity.rejection,
    IssueCode.invalid_role: Severity.rejection,
    # SlotMap normalization / structural
    IssueCode.unknown_role: Severity.rejection,
    IssueCode.duplicate_role_slot: Severity.rejection,
    IssueCode.mixed_template: Severity.rejection,
    IssueCode.empty_base: Severity.rejection,
    IssueCode.incomplete_two_piece: Severity.rejection,
    IssueCode.duplicate_item_id: Severity.rejection,
    # pool membership / keys / dedup
    IssueCode.item_outside_sampled_pool: Severity.rejection,
    IssueCode.duplicate_full_signature: Severity.rejection,
    IssueCode.key_precondition_failed: Severity.rejection,
    # StyleMove + aggregate (warnings)
    IssueCode.invalid_style_move_shape: Severity.warning,
    IssueCode.style_move_item_outside_outfit: Severity.warning,
    IssueCode.duplicate_style_move_changed_ids: Severity.warning,
    IssueCode.extra_candidates_ignored: Severity.warning,
}

# Drift guard: every IssueCode must classify, or severity routing silently misfiles
# a new code. Cheap import-time assertion keeps the table complete as codes are added.
assert set(_SEVERITY) == set(IssueCode), (
    "every IssueCode needs a Severity in _SEVERITY: missing "
    f"{set(IssueCode) - set(_SEVERITY)}"
)


def severity_of(code: IssueCode) -> Severity:
    """The severity of an issue code (M2 plan §4 — one source of truth)."""
    return _SEVERITY[code]


def _record(issue: Issue, rejections: list[Issue], warnings: list[Issue]) -> None:
    """Route ``issue`` into rejections/warnings by its code's severity.

    Membership follows ``_SEVERITY`` exactly (M2 plan §4) — the one place an issue is
    filed, so the two lists can never disagree with the severity table.
    """
    if severity_of(issue.code) is Severity.warning:
        warnings.append(issue)
    else:
        rejections.append(issue)


# ============================ strict JSON parsing ============================


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict:
    """``object_pairs_hook`` that rejects duplicate object member names.

    Runs for every JSON object at every depth, so it catches nested duplicates too
    (M2 plan Decision D2b / §12). ``json.loads`` defaults to last-wins, which could
    silently hide a forbidden or malformed member before schema validation sees it.
    Raising ``ValueError`` routes to ``invalidJson`` in ``parse_gpt_json``.
    """
    seen: set[str] = set()
    for key, _ in pairs:
        if key in seen:
            raise ValueError(f"duplicate object member name {key!r} is not strictly valid JSON")
        seen.add(key)
    return dict(pairs)


def _reject_non_finite(token: str) -> object:
    """``parse_constant`` hook rejecting ``NaN`` / ``Infinity`` / ``-Infinity``.

    These tokens are not strictly valid JSON (§12); ``json.loads`` accepts them by
    default. Raising routes to ``invalidJson``.
    """
    raise ValueError(f"non-finite JSON constant {token!r} is not strictly valid JSON")


def parse_gpt_json(raw: str) -> ParseResult:
    """Strict JSON parse of a raw GPT response string (M2 plan Decision D2/D2b).

    Returns ``ParseResult(payload, issue=None)`` on success. Malformed *content* —
    bad syntax, duplicate object member names at any depth, or ``NaN``/``Infinity``/
    ``-Infinity`` tokens — returns ``ParseResult(payload=None, issue=invalidJson)``;
    this never raises on bad data. A non-``str`` ``raw`` is caller misuse and raises
    ``TypeError`` (package error-model convention). Does **not** validate the §12
    envelope — that is ``validate_gpt_payload``'s job (Decision D2, two functions).
    """
    if not isinstance(raw, str):
        raise TypeError(f"parse_gpt_json expects a str, got {type(raw).__name__}")
    try:
        # json.JSONDecodeError is a ValueError subclass; our two hooks also raise
        # ValueError, so a single except covers every malformed-content failure.
        payload = json.loads(
            raw,
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_non_finite,
        )
    except ValueError as exc:
        return ParseResult(payload=None, issue=Issue(IssueCode.invalid_json, None, str(exc)))
    return ParseResult(payload=payload, issue=None)


# ============================ payload validation ============================


def _validate_root(payload: object) -> Optional[Issue]:
    """Strict root-envelope check: the root must be exactly ``{"outfits": [...]}``.

    Returns the matching root rejection on failure, or ``None`` when the envelope is
    well-formed. Precedence note: the strict exact-key check runs *first* — any key
    other than ``outfits`` is ``malformedRoot``, even when ``outfits`` is itself
    absent (the envelope is exactly ``{"outfits": [...]}``, so an unexpected key is
    the governing violation). A *missing* ``outfits`` with no other keys is
    ``invalidOutfits``.
    """
    if not isinstance(payload, dict):
        return Issue(IssueCode.malformed_root, None, "root payload is not a JSON object")
    extra = sorted(set(payload.keys()) - {"outfits"})
    if extra:
        return Issue(IssueCode.malformed_root, None, f"root has unexpected key(s): {extra}")
    if "outfits" not in payload:
        return Issue(IssueCode.invalid_outfits, None, "root is missing the required 'outfits' key")
    if not isinstance(payload["outfits"], list):
        return Issue(IssueCode.invalid_outfits, None, "'outfits' is present but is not a list")
    return None


def validate_gpt_payload(
    payload: object,
    sampled_pool: Sequence[WardrobeItem],
    candidate_requested: Optional[int] = None,
) -> ValidationResult:
    """Validate an already-parsed GPT payload against the §12 schema (M2 plan §7).

    **C1 scope:** strict root-envelope validation only. A malformed root returns
    zero candidates and a single root-level rejection, and never inspects nested
    candidates (§13). A well-formed envelope (including an empty ``{"outfits": []}``)
    returns zero candidates with no rejection — per-candidate validation
    (schema/SlotMap/pool/keys/dedup/StyleMove) lands at C2–C5.

    ``sampled_pool`` and ``candidate_requested`` are part of the pinned signature
    (Decision D1) but are not consumed yet: pool indexing/membership is C3, and the
    ``candidate_requested`` bound semantics (Decision D6) are C6.
    """
    candidates: list[ValidatedCandidate] = []
    rejections: list[Issue] = []
    warnings: list[Issue] = []

    # Step 3 — strict root envelope. On failure: record and return immediately,
    # zero candidates, no nested inspection (§13).
    root_issue = _validate_root(payload)
    if root_issue is not None:
        _record(root_issue, rejections, warnings)
        return ValidationResult(candidates=candidates, rejections=rejections, warnings=warnings)

    # Well-formed envelope. C1 stops here (no per-candidate validation yet); an empty
    # or non-empty outfits list both yield zero candidates for now.
    return ValidationResult(candidates=candidates, rejections=rejections, warnings=warnings)
