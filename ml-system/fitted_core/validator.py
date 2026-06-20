"""M2 GPT-response validator — parse + strict root envelope (v2 §12/§13).

The first strict LLM-output boundary (pipeline Steps 2→3, §9): turn a raw GPT
response string into structurally-valid, deduplicated, keyed candidate outfits plus
a structured issue log. Two public entry points (M2 plan Decision D1/D2):

- ``parse_gpt_json(raw)`` — strict JSON parse only. Pure; no network, no repair.
- ``validate_gpt_payload(payload, sampled_pool, candidate_requested=None)`` —
  validate an already-parsed payload against the §12 schema.

**Checkpoint scope (C3).** This file implements the result model, the strict parser,
root-envelope validation, the per-candidate **schema + forbidden-field** pass (each
candidate is an object with required ``items`` + optional ``styleMove``; each item an
object with exactly non-empty ``itemId`` + string ``role``), and — new at C3 —
**SlotMap normalization, slot-level structural validity, and sampled-pool
membership** (flow steps 5.3–5.5 + the up-front pool-index build, M2 plan §7). Key
computation + exact-FullSignature dedup land at C4, StyleMove content validation at
C5, and ``candidate_requested`` bound semantics at C6 (M2 plan §11). A candidate that
passes 5.3–5.5 is structurally valid + in-pool but **does not yet become an accepted
``ValidatedCandidate``** — that needs the keys built at C4 — so ``candidates`` is
still always empty; C3 emits only structural/pool **rejections** (M2 plan C3/C4
boundary). ``candidate_requested`` is part of the pinned signature (D1) but not yet
consumed (C6).

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
from fitted_core.slotmap import is_valid_slotmap, normalize_to_slotmap


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
    supplied; otherwise ``None`` (M2 plan Decision D5). Populated starting at **C4** —
    the first checkpoint that computes the required ``base_key`` + ``full_signature``;
    C1–C3 emit none (C3 does SlotMap/pool rejection only — M2 plan C3/C4 boundary).
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

# Allowed field sets per the §12 schema (M2 plan §4). `_FORBIDDEN_GPT_FIELDS` is the
# single §12 enumeration of fields GPT must never emit — path/risk/score/graph-role
# labels are Python-only (H20). §12 is the home; keep this in sync with
# docs/Fitted_Spec_v2.md §12.
_ALLOWED_ROOT_FIELDS = frozenset({"outfits"})
_ALLOWED_CANDIDATE_FIELDS = frozenset({"items", "styleMove"})
_ALLOWED_ITEM_FIELDS = frozenset({"itemId", "role"})
_FORBIDDEN_GPT_FIELDS = frozenset({
    "score", "rank", "optionPath", "risk",
    "anchor", "bridge", "experiment",
    "edge", "compatibility", "behavioralStrength",
    "freshness", "exposure", "cooldown", "fallback",
    "imageUrl", "warmth",
    "matchedTraits", "missingTraits", "diagnosticReason",
})


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
    extra = sorted(set(payload.keys()) - _ALLOWED_ROOT_FIELDS)
    if extra:
        return Issue(IssueCode.malformed_root, None, f"root has unexpected key(s): {extra}")
    if "outfits" not in payload:
        return Issue(IssueCode.invalid_outfits, None, "root is missing the required 'outfits' key")
    if not isinstance(payload["outfits"], list):
        return Issue(IssueCode.invalid_outfits, None, "'outfits' is present but is not a list")
    return None


def _check_fields(
    obj: dict,
    allowed: frozenset,
    index: int,
    unknown_code: IssueCode,
) -> Optional[Issue]:
    """Reject unexpected keys on a candidate/item object (M2 plan §4).

    A key in the §12 forbidden set yields the sharper ``forbiddenGptField``; any
    other unexpected key yields ``unknown_code`` (candidate- or item-specific).
    Forbidden takes precedence over unknown when both are present.
    """
    extra = set(obj.keys()) - allowed
    forbidden = extra & _FORBIDDEN_GPT_FIELDS
    if forbidden:
        return Issue(IssueCode.forbidden_gpt_field, index, f"forbidden GPT field(s): {sorted(forbidden)}")
    if extra:
        return Issue(unknown_code, index, f"unexpected field(s): {sorted(extra)}")
    return None


def _validate_item(item: object, index: int) -> Optional[Issue]:
    """Item schema (§12, §7 step 5.2): an object with exactly ``itemId`` + ``role``.

    Owns presence/type only: ``itemId`` a non-empty string, ``role`` a string. The
    role *value* check (one of the 5 ``Role`` enums) is the normalizer's at C3 — so a
    well-formed but unknown role string passes here and is rejected as ``unknownRole``
    later (Decision D4: ``invalidRole`` is schema-level, ``unknownRole`` is C3).
    """
    if not isinstance(item, dict):
        return Issue(IssueCode.invalid_item_shape, index, "item entry is not a JSON object")
    field_issue = _check_fields(item, _ALLOWED_ITEM_FIELDS, index, IssueCode.unknown_item_field)
    if field_issue is not None:
        return field_issue
    item_id = item.get("itemId")
    # bool is an int, not a str — isinstance(True, str) is False, so a bool itemId
    # falls into invalidItemId (mirrors the package's bool-rejection precedents).
    if not isinstance(item_id, str) or item_id == "":
        return Issue(IssueCode.invalid_item_id, index, "itemId missing, non-string, or empty")
    if not isinstance(item.get("role"), str):
        return Issue(IssueCode.invalid_role, index, "role missing or non-string")
    return None


def _validate_candidate(candidate: object, index: int) -> Optional[Issue]:
    """Candidate schema (§12, §7 step 5.1): object → fields → ``items`` → each item.

    ``items`` must be a list; an **empty** list passes here and falls through to the
    SlotMap ``emptyBase`` reject at C3 (N3 — never ``invalidItems``). ``styleMove`` is
    accepted as an allowed key only; its contents are boundary-validated at C5.
    Returns the first failing check (one Issue per candidate), or ``None`` when the
    candidate's schema is well-formed.
    """
    if not isinstance(candidate, dict):
        return Issue(IssueCode.invalid_candidate_shape, index, "candidate entry is not a JSON object")
    field_issue = _check_fields(candidate, _ALLOWED_CANDIDATE_FIELDS, index, IssueCode.unknown_candidate_field)
    if field_issue is not None:
        return field_issue
    items = candidate.get("items")
    if not isinstance(items, list):  # missing key → None → not a list → invalidItems
        return Issue(IssueCode.invalid_items, index, "items missing or not a list")
    for item in items:
        item_issue = _validate_item(item, index)
        if item_issue is not None:
            return item_issue
    return None


def _build_pool_index(sampled_pool: Sequence[WardrobeItem]) -> set[str]:
    """Flatten the sampled pool to its set of item ids (flow step 2, M2 plan §8).

    The pool is the bounded set GPT was shown; candidate ids are validated against it
    (never the wider wardrobe). A **duplicate id** is caller-contract misuse →
    ``ValueError`` (mirrors ``sampler._reject_duplicate_ids``): a duplicate collapses
    the membership lookup and breaks key equality (§7/R12). A clean M1 path can never
    produce this, so raising surfaces the upstream bug loudly instead of silently
    mis-validating. Built up front — before the root envelope — so this caller-contract
    violation always raises, even for a payload that would itself be rejected.
    """
    seen: set[str] = set()
    for item in sampled_pool:
        if item.id in seen:
            raise ValueError(
                f"duplicate item id {item.id!r} in sampled_pool (R12): ids must be unique"
            )
        seen.add(item.id)
    return seen


def _validate_structure(candidate: dict, index: int, pool_ids: set[str]) -> Optional[Issue]:
    """SlotMap + structural + pool validation of a schema-valid candidate (5.3–5.5).

    Runs only after ``_validate_candidate`` confirmed the candidate is an object whose
    ``items`` is a list of well-formed ``{itemId, role}`` objects. Returns the first
    failing check as an ``Issue`` (first-failing-check-wins, M2 plan §7), or ``None``
    when the candidate is structurally valid and fully in-pool. Even on ``None`` the
    candidate is **not** accepted here — building a ``ValidatedCandidate`` needs the
    keys computed at C4 (M2 plan C3/C4 boundary), so C3 emits no accepted candidates.

    Structural codes are *owned* by ``slotmap.py`` (Decision D7), which returns the
    ``IssueCode`` directly; this wraps it with the candidate index, never re-classifies
    prose. ``detail`` is ``None`` for those (the code is the contract; the prose is gone
    with D7); only the validator-owned pool reject carries the offending id as detail.
    """
    # 5.3 normalize → SlotMap (owns unknownRole / duplicateRoleSlot, D7).
    slot_map, norm_code = normalize_to_slotmap(candidate["items"])
    if norm_code is not None:
        return Issue(norm_code, index)
    # 5.4 slot-level structural validity (owns mixed/empty/incomplete/dupId, D7).
    valid, struct_code = is_valid_slotmap(slot_map)
    if not valid:
        return Issue(struct_code, index)
    # 5.5 sampled-pool membership — every filled slot id must be in the pool. Runs
    # after structural validity, so a structural reject always precedes a pool reject.
    for item_id in (slot_map.dress, slot_map.top, slot_map.bottom, slot_map.outer, slot_map.shoes):
        if item_id is not None and item_id not in pool_ids:
            return Issue(
                IssueCode.item_outside_sampled_pool, index, f"itemId {item_id!r} not in sampled pool"
            )
    return None


def validate_gpt_payload(
    payload: object,
    sampled_pool: Sequence[WardrobeItem],
    candidate_requested: Optional[int] = None,
) -> ValidationResult:
    """Validate an already-parsed GPT payload against the §12 schema (M2 plan §7).

    **C3 scope:** strict root envelope + per-candidate schema/forbidden-field pass +
    SlotMap normalization + slot-level structural validity + sampled-pool membership
    (flow steps 2–5.5). A malformed root returns zero candidates and a single root
    rejection, and never inspects nested candidates (§13). Otherwise each candidate is
    validated in order through schema (5.1–5.2) then structure/pool (5.3–5.5); a bad
    candidate yields one rejection (first failing check wins, with its
    ``candidate_index``) and never stops later candidates. Key computation + dedup
    (C4), StyleMove validation (C5), and ``candidate_requested`` bound semantics (C6)
    are not done here — so a candidate that passes 5.3–5.5 is structurally valid +
    in-pool but is **not** accepted yet (a ``ValidatedCandidate`` needs the C4 keys),
    and ``candidates`` is still always empty (M2 plan C3/C4 boundary).

    ``candidate_requested`` is part of the pinned signature (Decision D1) but not yet
    consumed — its bound semantics (Decision D6) are C6.
    """
    candidates: list[ValidatedCandidate] = []
    rejections: list[Issue] = []
    warnings: list[Issue] = []

    # Step 2 — build the pool id index up front. A duplicate id is caller-contract
    # misuse and raises (R12), even when the payload would itself be rejected.
    pool_ids = _build_pool_index(sampled_pool)

    # Step 3 — strict root envelope. On failure: record and return immediately,
    # zero candidates, no nested inspection (§13).
    root_issue = _validate_root(payload)
    if root_issue is not None:
        _record(root_issue, rejections, warnings)
        return ValidationResult(candidates=candidates, rejections=rejections, warnings=warnings)

    # Per-candidate validation (§7 step 5), candidate-by-candidate (§13): a bad
    # candidate never stops later ones. C3 runs schema (5.1–5.2) then structure/pool
    # (5.3–5.5), first-failing-check-wins. Keys/dedup/StyleMove (5.6–5.8) — and thus
    # accepting a candidate — land at C4–C5, so a candidate that passes 5.3–5.5 yields
    # neither a rejection nor (yet) an accepted candidate.
    for index, candidate in enumerate(payload["outfits"]):
        candidate_issue = _validate_candidate(candidate, index)
        if candidate_issue is None:
            candidate_issue = _validate_structure(candidate, index, pool_ids)
        if candidate_issue is not None:
            _record(candidate_issue, rejections, warnings)

    return ValidationResult(candidates=candidates, rejections=rejections, warnings=warnings)
