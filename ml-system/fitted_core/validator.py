"""M2 GPT-response validator — parse + strict root envelope (v2 §12/§13).

The first strict LLM-output boundary (pipeline Steps 2→3, §9): turn a raw GPT
response string into structurally-valid, deduplicated, keyed candidate outfits plus
a structured issue log. Two public entry points (M2 plan Decision D1/D2):

- ``parse_gpt_json(raw)`` — strict JSON parse only. Pure; no network, no repair.
- ``validate_gpt_payload(payload, sampled_pool, candidate_requested=None)`` —
  validate an already-parsed payload against the §12 schema.

**Milestone scope (M2 complete, C1–C6).** This file implements the result model, the
strict parser, root-envelope validation, the per-candidate **schema + forbidden-field**
pass (each candidate is an object with required ``items`` + optional ``styleMove``; each
item an object with exactly non-empty ``itemId`` + string ``role``), **SlotMap
normalization, slot-level structural validity, and sampled-pool membership** (flow steps
5.3–5.5 + the up-front pool-index build), **BaseKey/FullSignature computation and
exact-FullSignature dedup** (flow steps 5.6–5.7), **StyleMove boundary validation** (flow
step 5.8, warning-only, M2 plan §7), and the **``candidate_requested`` upper bound** (flow
steps 1 + 4: caller-contract type/value validation, then slicing surplus candidates with
one aggregate ``extraCandidatesIgnored`` warning). A candidate that passes 5.3–5.7 is keyed
and appended to ``candidates`` (in input order; dedup keeps the first occurrence); its
optional ``styleMove`` is then validated (5.8) and attached when valid, else dropped via a
warning while the candidate still stands (D5, H23).

Error-model convention (package ``__init__.py``): expected, data-driven failures go
to the issue channel (``Issue`` / ``ParseResult`` / ``ValidationResult``);
caller-contract violations raise. So a non-``str`` ``raw`` raises ``TypeError``
(caller misuse), while malformed JSON *content* returns ``invalidJson`` (data).

Sources: docs/Fitted_Spec_v2.md §7/§8/§9/§12/§13, docs/plans/m2-validator.md.
"""

import json
from dataclasses import dataclass
from enum import Enum
from typing import Optional, Sequence, Union

from fitted_core.keys import base_key, full_signature
from fitted_core.models import (
    IssueCode,
    SlotMap,
    StyleMove,
    Template,
    WardrobeItem,
)
from fitted_core.slotmap import is_valid_slotmap, normalize_to_slotmap, template_of


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
    supplied; otherwise ``None`` (M2 plan Decision D5 — a present-but-invalid styleMove
    is dropped via a warning and leaves this ``None``). Emitted from **C4** on, the
    checkpoint that computes the required ``base_key`` + ``full_signature``.
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
_ALLOWED_STYLE_MOVE_FIELDS = frozenset({"moveType", "changedItemIds", "oneSentence"})
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
    accepted as an allowed key only; its contents are boundary-validated separately at
    flow step 5.8 (``_validate_style_move``), after the candidate is accepted.
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


@dataclass(frozen=True)
class _Structure:
    """A schema-valid, structurally-valid, in-pool candidate's normalized SlotMap.

    Private carry between ``_validate_structure`` (5.3–5.5) and key computation (5.6):
    holding the normalized SlotMap means the caller does not re-normalize to build the
    accepted ``ValidatedCandidate``. Never public (M2 plan Decision D1).
    """

    slot_map: SlotMap


def _validate_structure(
    candidate: dict, index: int, pool_ids: set[str]
) -> Union[Issue, _Structure]:
    """SlotMap + structural + pool validation of a schema-valid candidate (5.3–5.5).

    Runs only after ``_validate_candidate`` confirmed the candidate is an object whose
    ``items`` is a list of well-formed ``{itemId, role}`` objects. Returns the first
    failing check as an ``Issue`` (first-failing-check-wins, M2 plan §7), or a
    ``_Structure`` carrying the normalized SlotMap when the candidate is structurally
    valid and fully in-pool. It never accepts the candidate itself — the caller computes
    keys (5.6) from that SlotMap and builds the ``ValidatedCandidate`` (C4).

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
    return _Structure(slot_map=slot_map)


def _compute_keys(slot_map: SlotMap, index: int) -> Union[tuple[str, str], Issue]:
    """Compute ``(base_key, full_signature)`` for a validated SlotMap (flow 5.6).

    Returns the key pair, or wraps the R10 key-precondition ``ValueError`` (a reserved
    char / the ``"none"`` sentinel in a participating itemId — see keys.py) as a
    candidate-level ``keyPreconditionFailed`` ``Issue`` so it never escapes (Decision
    D9). The base is already structurally valid and in-pool by the time this runs, so
    only the reserved-char/sentinel guard can fire here, not the invalid-base guard.
    """
    try:
        bk = base_key(slot_map)
        fs = full_signature(slot_map)
    except ValueError as exc:
        return Issue(IssueCode.key_precondition_failed, index, str(exc))
    return bk, fs


def _validate_style_move(
    candidate: dict, slot_map: SlotMap, index: int
) -> tuple[Optional[StyleMove], Optional[Issue]]:
    """Validate an accepted candidate's optional ``styleMove`` (flow 5.8, §12/H23).

    Warning-only, and runs **only** for candidates that already survived schema,
    structure, pool, keys, and dedup (§9). Returns ``(StyleMove, None)`` when valid,
    ``(None, None)`` when the key is absent (D5 — the common, correct case), or
    ``(None, Issue)`` (a warning) when the key is present but invalid. A present-but-
    invalid styleMove is dropped via the warning and never rejects the candidate
    (D5, H23, §13) — the outfit's structural validity is independent of its prose.

    First-failing-check-wins in the §7 order — shape → H23 subset → duplicate ids:
    - **shape** (``invalidStyleMoveShape``): non-object (incl. ``null``); not exactly the
      three §12 fields (a forbidden/unknown key here is a *warning*, never a candidate
      reject — M2 plan §4); ``moveType``/``oneSentence`` non-string or empty;
      ``changedItemIds`` non-array/empty/with a non-string or empty-string entry.
    - **subset** (``styleMoveItemOutsideOutfit``): ``changedItemIds`` ⊄ the outfit's
      filled slot ids (H23 — every slot, incl. optional outer/shoes).
    - **duplicate** (``duplicateStyleMoveChangedIds``): ``changedItemIds`` has duplicates.
    """
    if "styleMove" not in candidate:
        return None, None  # absent → valid, no warning (D5)
    raw = candidate["styleMove"]

    # Shape — a present styleMove must be an object with exactly the three §12 fields
    # (this single check covers null/non-object, missing required fields, and any
    # unknown/forbidden extra key — all are warnings here, never candidate rejects).
    if not isinstance(raw, dict) or set(raw) != _ALLOWED_STYLE_MOVE_FIELDS:
        return None, Issue(
            IssueCode.invalid_style_move_shape, index,
            "styleMove must be an object with exactly {moveType, changedItemIds, oneSentence}",
        )
    move_type = raw["moveType"]
    one_sentence = raw["oneSentence"]
    changed = raw["changedItemIds"]
    # bool is an int, not a str — isinstance(True, str) is False, so bools fall through
    # to the shape warning (mirrors the itemId/role bool-rejection precedents).
    if not isinstance(move_type, str) or move_type == "":
        return None, Issue(IssueCode.invalid_style_move_shape, index, "moveType must be a non-empty string")
    if not isinstance(one_sentence, str) or one_sentence == "":
        return None, Issue(IssueCode.invalid_style_move_shape, index, "oneSentence must be a non-empty string")
    if not isinstance(changed, list) or len(changed) == 0:
        return None, Issue(IssueCode.invalid_style_move_shape, index, "changedItemIds must be a non-empty array")
    for cid in changed:
        if not isinstance(cid, str) or cid == "":
            return None, Issue(
                IssueCode.invalid_style_move_shape, index, "changedItemIds entries must be non-empty strings"
            )

    # H23 subset — every changed id must be one of the outfit's filled slot ids.
    outfit_ids = {
        v for v in (slot_map.dress, slot_map.top, slot_map.bottom, slot_map.outer, slot_map.shoes)
        if v is not None
    }
    outside = sorted(set(changed) - outfit_ids)
    if outside:
        return None, Issue(
            IssueCode.style_move_item_outside_outfit, index, f"changedItemIds outside outfit: {outside}"
        )

    # Duplicate changed ids (all in-outfit by here).
    if len(changed) != len(set(changed)):
        return None, Issue(
            IssueCode.duplicate_style_move_changed_ids, index, "changedItemIds contains duplicates"
        )

    return StyleMove(move_type=move_type, changed_item_ids=list(changed), one_sentence=one_sentence), None


def _resolve_candidate_requested(candidate_requested: Optional[int]) -> Optional[int]:
    """Resolve the ``candidate_requested`` upper bound (flow step 1, M2 plan §6/D6).

    Returns ``None`` (unbounded — validate every candidate) or a positive ``int`` upper
    bound. Caller-contract misuse raises and never becomes an ``Issue`` (package
    error-model convention): wrong *type* → ``TypeError`` (a ``bool`` — an ``int``
    subclass, so checked first — or any non-``int``); wrong *value* → ``ValueError``
    (``0`` or negative; the normal flow short-circuits to ``notEnoughItems`` before GPT,
    so a ``0`` request here is misuse). Resolved before the pool index is built
    (step 1 < step 2), so an invalid bound surfaces even for a payload or pool that would
    itself fail.
    """
    if candidate_requested is None:
        return None
    # bool is an int subclass — isinstance(True, int) is True — so reject it explicitly
    # before the int check (mirrors the package's warmth=True / bool-rejection precedents).
    if isinstance(candidate_requested, bool):
        raise TypeError("candidate_requested must be an int or None, got bool")
    if not isinstance(candidate_requested, int):
        raise TypeError(
            f"candidate_requested must be an int or None, got {type(candidate_requested).__name__}"
        )
    if candidate_requested <= 0:
        raise ValueError(f"candidate_requested must be positive, got {candidate_requested}")
    return candidate_requested


def validate_gpt_payload(
    payload: object,
    sampled_pool: Sequence[WardrobeItem],
    candidate_requested: Optional[int] = None,
) -> ValidationResult:
    """Validate an already-parsed GPT payload against the §12 schema (M2 plan §7).

    **Full M2 flow (steps 1–5.8).** First resolve ``candidate_requested`` (step 1,
    Decision D6): ``None`` is unbounded (validate all); a positive ``int`` is an upper
    bound; ``0``/negative raise ``ValueError`` and ``bool``/non-``int`` raise ``TypeError``
    (caller-contract misuse — raised before the pool index is built). Then build the pool
    index (step 2) and apply the strict root envelope (step 3) — a malformed root returns
    zero candidates and a single root rejection, never inspecting nested candidates (§13).
    When a bound is set and more candidates are supplied than the bound, the surplus is
    sliced off (step 4) *before* any per-candidate work and one aggregate
    ``extraCandidatesIgnored`` warning (``candidate_index=None``) is recorded; ignored
    extras never affect accepted candidates, rejections, warnings, keys, or dedup (§12).
    Each surviving candidate is then validated in order through schema (5.1–5.2),
    structure/pool (5.3–5.5), keys (5.6), and dedup (5.7); a bad candidate yields one
    rejection (first failing check wins, with its ``candidate_index``) and never stops later
    candidates. A candidate that passes 5.3–5.7 is keyed and appended to ``candidates`` (in
    input order; dedup keeps the first occurrence of a FullSignature); its optional
    ``styleMove`` is then validated (5.8, warning-only) and attached when valid, else dropped
    via a warning with the candidate still accepted (``style_move=None``).
    """
    candidates: list[ValidatedCandidate] = []
    rejections: list[Issue] = []
    warnings: list[Issue] = []

    # Step 1 — resolve the candidate_requested upper bound. Caller-contract misuse raises
    # (TypeError/ValueError) before the pool index is built, so an invalid bound surfaces
    # even for a payload or pool that would itself fail (M2 plan §6/§7).
    bound = _resolve_candidate_requested(candidate_requested)

    # Step 2 — build the pool id index up front. A duplicate id is caller-contract
    # misuse and raises (R12), even when the payload would itself be rejected.
    pool_ids = _build_pool_index(sampled_pool)

    # Step 3 — strict root envelope. On failure: record and return immediately,
    # zero candidates, no nested inspection (§13).
    root_issue = _validate_root(payload)
    if root_issue is not None:
        _record(root_issue, rejections, warnings)
        return ValidationResult(candidates=candidates, rejections=rejections, warnings=warnings)

    # Step 4 — apply the upper bound. When more candidates are supplied than the bound,
    # slice the surplus off *before* any per-candidate work and record one aggregate
    # extraCandidatesIgnored warning (candidate_index=None). A prefix slice keeps every
    # survivor's original source index, and the ignored extras are never schema/structure/
    # pool/key/dedup/StyleMove inspected — so they cannot affect accepted candidates,
    # their issues, or dedup state (§12). None bound → no slice, no warning (unbounded).
    outfits = payload["outfits"]
    if bound is not None and len(outfits) > bound:
        _record(
            Issue(
                IssueCode.extra_candidates_ignored,
                None,
                f"received {len(outfits)} candidates, bound is {bound}; ignored {len(outfits) - bound}",
            ),
            rejections,
            warnings,
        )
        outfits = outfits[:bound]

    # Per-candidate validation (§7 step 5), candidate-by-candidate (§13): a bad
    # candidate never stops later ones. Each candidate runs schema (5.1–5.2),
    # structure/pool (5.3–5.5), keys (5.6), dedup (5.7), then — for survivors only —
    # StyleMove (5.8), first-failing-check-wins. StyleMove is warning-only and never
    # un-accepts a candidate.
    seen_signatures: set[str] = set()
    for index, candidate in enumerate(outfits):
        candidate_issue = _validate_candidate(candidate, index)
        if candidate_issue is not None:
            _record(candidate_issue, rejections, warnings)
            continue
        # 5.3–5.5 structure + pool; on success carries the normalized SlotMap forward.
        structure = _validate_structure(candidate, index, pool_ids)
        if isinstance(structure, Issue):
            _record(structure, rejections, warnings)
            continue
        # 5.6 keys — wrap the R10 ValueError as keyPreconditionFailed (never escapes).
        key_result = _compute_keys(structure.slot_map, index)
        if isinstance(key_result, Issue):
            _record(key_result, rejections, warnings)
            continue
        base, full_sig = key_result
        # 5.7 exact-FullSignature dedup — first occurrence wins (Decision D9); a later
        # identical signature is dropped, while same BaseKey + different signature both
        # survive (it never deduplicates on BaseKey).
        if full_sig in seen_signatures:
            _record(Issue(IssueCode.duplicate_full_signature, index, full_sig), rejections, warnings)
            continue
        seen_signatures.add(full_sig)
        # 5.8 StyleMove (warning-only) — inspected only for accepted candidates, i.e.
        # after dedup (§9): a duplicate-rejected candidate is never styleMove-inspected.
        # A present-but-invalid styleMove warns and is dropped; the candidate still stands.
        style_move, style_issue = _validate_style_move(candidate, structure.slot_map, index)
        if style_issue is not None:
            _record(style_issue, rejections, warnings)
        candidates.append(ValidatedCandidate(
            source_index=index,
            slot_map=structure.slot_map,
            template=template_of(structure.slot_map),
            base_key=base,
            full_signature=full_sig,
            style_move=style_move,
        ))

    return ValidationResult(candidates=candidates, rejections=rejections, warnings=warnings)
