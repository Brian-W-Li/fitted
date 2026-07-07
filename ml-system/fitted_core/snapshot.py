"""GenerationSnapshotPayload + the snapshot builder (M4b C6).

The Python producer half of the §15.1 GenerationSnapshot contract: a frozen dataclass mirror
of the snapshot's Python-authored fields (§8.2-A/B/C/E/F/G + each item's ``engineVisible``
projection) plus ``build_snapshot_payload``, which folds a ``RenderTrace`` (the Option-B funnel
capture) into one immutable payload. The TS side adds ``evidence`` and persists the merged doc;
the C4 ``snapshot_serde`` carries this payload across the wire (snake→camel, ``type``→
``clothingType``, finite floats, opaque-string ids).

Three C6 obligations live here:
  - **candidateId** — Python-issued, deterministic, unique within the snapshot, over the FULL
    funnel (rejected + scored-but-unshown + non-selected-variant all get one). Keyed by the GPT
    outfit's ``source_index`` so it is a pure function of the funnel order (permutation-stable).
  - **content-preservation (§8.2-F)** — enforced in ``CandidatePayload.__post_init__``: a
    non-accepted candidate must carry ``(items+slot_map)`` or ``raw_emitted``; a bare
    ``{candidate_id, rejection_codes}`` raises (it would lose the negative training signal).
  - **diagnostics** — populated explicitly from the ``SamplerResult`` / ``RankerResult`` /
    rescue flags + the rejection/warning histograms (the only §15.1 group with no other writer).
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Optional

from fitted_core import PROMPT_VERSION, RANKER_CONFIG_VERSION, __version__
from fitted_core.generation import RESPONSE_FORMAT_JSON_SCHEMA_STRICT
from fitted_core.models import Role, SlotMap, WardrobeItem
from fitted_core.rescue import RenderRequest, RenderTrace

# ---------------------------------------------------------------------------
# Payload dataclasses (snake_case; the C4 serde maps to camelCase wire fields).
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ScoreTracePayload:
    """Per-candidate continuous scores (§8.2-G / §15.1) — the M6 seam. All optional until scored."""

    compatibility: Optional[float] = None
    visibility: Optional[float] = None
    ranker_score: Optional[float] = None
    score_breakdown: Optional[dict] = None  # base/combo/item/dislike/overuse/repetition/cooldown
    signal_score: Optional[float] = None  # reserved — the trained M6 scorer


@dataclass(frozen=True)
class CandidatePayload:
    """One candidate over the generated→validated→ranked→shown funnel (§8.2-F).

    Content-preservation invariant (§8.2-F) enforced in ``__post_init__``: a non-accepted
    candidate MUST carry ``(items+slot_map)`` or ``raw_emitted``.
    """

    candidate_id: str
    source_attempt_id: str
    source_index: int
    stage_reached: str  # generated | validated | ranked | shown
    accepted: bool
    shown: bool
    shown_position: Optional[int] = None
    drop_stage: Optional[str] = None
    drop_reason: Optional[str] = None
    rejection_codes: tuple[str, ...] = ()
    warning_codes: tuple[str, ...] = ()
    items: tuple[dict, ...] = ()
    slot_map: Optional[dict] = None
    template: Optional[str] = None
    base_key: Optional[str] = None
    full_signature: Optional[str] = None
    option_path: Optional[str] = None
    risk: Optional[str] = None
    style_move: Optional[dict] = None
    raw_emitted: object = None
    score_trace: Optional[ScoreTracePayload] = None

    def __post_init__(self) -> None:
        if not self.accepted:
            has_content = self.raw_emitted is not None or (self.items and self.slot_map)
            if not has_content:
                raise ValueError(
                    f"candidate {self.candidate_id!r} (generated, non-accepted) must carry "
                    f"(items+slot_map) or raw_emitted — the content-preservation invariant (§8.2-F)"
                )


@dataclass(frozen=True)
class GenerationAttemptPayload:
    """A root/attempt-level generate→parse event (§8.2-E) — kept out of the candidate array.

    ``root_rejection_code``/``aggregate_warning_codes`` capture the root-envelope reject + the
    aggregate (``candidate_index=None``) warnings — e.g. ``extraCandidatesIgnored`` — that belong
    to the whole attempt, never to a fake candidate (§8.2-E). Set on the producing attempt only.
    """

    attempt_id: str
    attempt_index: int
    is_repair: bool
    payload_parsed: bool
    parse_issue: Optional[str] = None
    root_rejection_code: Optional[str] = None
    aggregate_warning_codes: tuple[str, ...] = ()
    candidate_count_emitted: int = 0
    raw_text: Optional[str] = None  # the snapshot writer applies the byte cap + hash + flag
    # §A.6 point 4 (C3 routing half): the attempt's finish/refusal metadata as a plain wire
    # dict {finish_reason, refusal} — a refused/cap-truncated attempt is money spent, so it is
    # recorded here, never a silent empty. None for generators that don't expose it (stubs).
    finish_status: Optional[dict] = None


@dataclass(frozen=True)
class DiagnosticsPayload:
    """Request-level diagnostics (§8.2-G). ``sampler_per_type``/histograms are DATA-keyed maps
    (the C4 serde preserves their keys verbatim); ``parse`` nests to match the C5 sub-schema."""

    sampler_per_type: dict
    candidate_requested: Optional[int]
    prompt_item_count: Optional[int]
    not_enough_items: bool
    scorer_available: bool
    rejection_histogram: dict
    warning_histogram: dict
    parse: dict  # {parse_success, repair_used, generator_calls} → wire diagnostics.parse.{...}
    ranker: dict
    rescue: dict
    # §D recording-locus split (C3): a failure WITHOUT a generation attempt (pre-GPT raise,
    # caught internal exception) is recorded here — the §G item-4 shape authored by
    # ``EngineFailure.to_payload_dict()`` — never as a fabricated attempt. None on healthy
    # renders and on failures that DO have attempts (those live in generation_attempts[]).
    engine_failure: Optional[dict] = None


@dataclass(frozen=True)
class ItemSnapshotPayload:
    """The Python half of an itemSnapshot — the ``engine_visible`` projection only (§8.4).

    ``evidence`` is the TS side's responsibility; Python sends exactly what the engine saw.
    """

    item_id: str
    engine_visible: dict


@dataclass(frozen=True)
class GenerationSnapshotPayload:
    """The Python-authored half of one GenerationSnapshot (§8.2-A/B/C/E/F/G + itemSnapshots)."""

    # A — identity
    session_id: str
    candidate_cache_key: str
    generation_index: int
    # A' — §G.1 echo-through of the validated wire request (C3): the payload stays the single
    # validated artifact. request_id is the §C.4 idempotency token (a client-minted plain
    # string, never an ObjectId); parent_snapshot_id is the lineage pointer (None on roots).
    request_id: str
    parent_snapshot_id: Optional[str]
    # B — request context (the Lens)
    intent: str
    occasion: str
    weather: str
    weather_raw: Optional[str]
    location: Optional[str]
    forced_item_id: Optional[str]
    wardrobe_version: int
    seed_date: Optional[str]
    # M5 invariant: always {} — non-empty constraints are rejected pre-generation, never
    # stored as inert provenance (m5-cutover.md §A/§G.1).
    constraints: dict
    # C — provenance / versions (required non-null on every live write)
    fitted_core_version: str
    generator: dict  # provider / model / temperature / prompt_version
    ranker_config_version: str
    scorer: dict  # kind / model_id / available
    # D — item feature snapshots (engineVisible)
    item_snapshots: tuple[ItemSnapshotPayload, ...]
    # E / F — candidate funnel
    generation_attempts: tuple[GenerationAttemptPayload, ...]
    candidates: tuple[CandidatePayload, ...]
    # G — diagnostics
    diagnostics: DiagnosticsPayload
    # H — shown history
    shown_candidate_ids: tuple[str, ...]
    shown_full_signatures: tuple[str, ...]
    n_surfaced: int
    spread_collapsed: bool


# ---------------------------------------------------------------------------
# §D engine-failure record (C3) — the diagnostics.engineFailure shape (§G item 4).
# ---------------------------------------------------------------------------

# Closed vocabularies (m5-cutover.md §G item 4). The TS helper re-enforces them; append-only.
ENGINE_FAILURE_STAGES = frozenset(
    {"sample", "generate", "parse", "validate", "rank", "assemble", "pre_generation", "unknown"}
)
ENGINE_FAILURE_CODES = frozenset(
    {
        "parse_fail",
        "empty_valid_set",
        "refusal",
        "truncated",
        "internal_exception",
        "sampler_error",
        "ranker_error",
        "unknown",
    }
)
ENGINE_FAILURE_MESSAGE_MAX_CHARS = 300  # §G/G13 — the TS helper rejects longer

# G13 trap-guard: `message` comes from THIS fixed catalogue, keyed by code — never
# ``str(exception)``, never raw model text, never an interpolated runtime value (a hex/secret
# filter must never have to reason about a legitimate 24-hex ObjectId; structured detail lives
# in ``detail{item_id, count}`` instead). Every string here is bounded well under the cap.
_ENGINE_FAILURE_MESSAGES: dict[str, str] = {
    "parse_fail": "GPT output failed JSON repair",
    "empty_valid_set": "no generated candidate survived validation",
    "refusal": "the model refused the generation request",
    "truncated": "the model response was truncated by the completion-token cap",
    "internal_exception": "an internal engine error interrupted the render",
    "sampler_error": "the sampler failed on a valid request",
    "ranker_error": "the ranker failed on a valid request",
    "unknown": "an unknown engine failure interrupted the render",
}


@dataclass(frozen=True)
class EngineFailure:
    """An internal engine failure on a VALID request (§D) — the no-attempt recording locus.

    Reserved for failures the degenerate corpus must record without a generation attempt
    (a pre-GPT raise, a caught internal exception). Never constructed for input-validation
    failures — those are caller bugs → the ``contract_invalid`` envelope, no payload (§D
    corpus-purity boundary).
    """

    stage: str
    code: str
    detail: Optional[dict] = None  # structured values only: {"item_id": str, "count": int}

    def __post_init__(self) -> None:
        if self.stage not in ENGINE_FAILURE_STAGES:
            raise ValueError(f"engine-failure stage {self.stage!r} is outside the closed set")
        if self.code not in ENGINE_FAILURE_CODES:
            raise ValueError(f"engine-failure code {self.code!r} is outside the closed set")
        if self.detail is not None:
            unknown = set(self.detail) - {"item_id", "count"}
            if unknown:
                raise ValueError(
                    f"engine-failure detail keys {sorted(unknown)} are outside the closed "
                    "set {'item_id', 'count'} — runtime values never ride `message`"
                )

    def to_payload_dict(self) -> dict:
        """The §G item-4 wire shape (snake_case; serde camelCases the field names)."""
        message = _ENGINE_FAILURE_MESSAGES[self.code]
        out: dict = {
            "stage": self.stage,
            "code": self.code,
            "message": message,
            "message_truncated": False,  # catalogue strings are bounded by construction
        }
        if self.detail is not None:
            out["detail"] = dict(self.detail)
        return out


# ---------------------------------------------------------------------------
# Projection helpers.
# ---------------------------------------------------------------------------

_SLOT_ROLE = {
    "dress": Role.one_piece,
    "top": Role.base_top,
    "bottom": Role.base_bottom,
    "outer": Role.outer_layer,
    "shoes": Role.shoes,
}


def _engine_visible(item: WardrobeItem) -> dict:
    """The exact ``fitted_core.WardrobeItem`` projection the engine conditioned on (§8.2-D).

    snake_case; the C4 serde renames ``type``→``clothingType`` (+ the tags) on the wire. The
    ``type`` value is the ``ItemType`` member's string (member names = wire values, §15.2).
    """
    return {
        "name": item.name,
        "type": item.type.value,
        "warmth": item.warmth,
        "style_tags": list(item.style_tags),
        "color_tags": list(item.color_tags),
        "occasion_tags": list(item.occasion_tags),
        "material": item.material,
        "formality": item.formality,
        "image_url": item.image_url,
    }


def _slot_items(slot_map: SlotMap) -> tuple[dict, ...]:
    """Role-tagged ``{item_id, role}`` entries for every filled slot (§8.3 candidate.items)."""
    return tuple(
        {"item_id": getattr(slot_map, slot), "role": role.value}
        for slot, role in _SLOT_ROLE.items()
        if getattr(slot_map, slot) is not None
    )


def _slot_dict(slot_map: SlotMap) -> dict:
    """The filled-slot map (§8.3 candidate.slotMap)."""
    return {
        slot: getattr(slot_map, slot)
        for slot in ("dress", "top", "bottom", "outer", "shoes")
        if getattr(slot_map, slot) is not None
    }


def _breakdown_dict(breakdown) -> dict:
    return {
        "base": breakdown.base,
        "combo": breakdown.combo,
        "item": breakdown.item,
        "dislike": breakdown.dislike,
        "overuse": breakdown.overuse,
        "repetition": breakdown.repetition,
        "cooldown": breakdown.cooldown,
    }


def _style_move_dict(style_move) -> Optional[dict]:
    if style_move is None:
        return None
    return {
        "move_type": style_move.move_type,
        "changed_item_ids": list(style_move.changed_item_ids),
        "one_sentence": style_move.one_sentence,
    }


# Mutable per-source-index accumulator while joining the funnel; frozen into CandidatePayload last.
@dataclass
class _CandidateAcc:
    source_index: int
    stage_reached: str = "generated"
    accepted: bool = False
    shown: bool = False
    shown_position: Optional[int] = None
    drop_stage: Optional[str] = None
    drop_reason: Optional[str] = None
    rejection_codes: list = field(default_factory=list)
    warning_codes: list = field(default_factory=list)
    items: tuple = ()
    slot_map: Optional[dict] = None
    template: Optional[str] = None
    base_key: Optional[str] = None
    full_signature: Optional[str] = None
    option_path: Optional[str] = None
    risk: Optional[str] = None
    style_move: Optional[dict] = None
    raw_emitted: object = None
    compatibility: Optional[float] = None
    visibility: Optional[float] = None
    ranker_score: Optional[float] = None
    score_breakdown: Optional[dict] = None


def _build_candidates(trace: RenderTrace, source_attempt_id: str) -> tuple[CandidatePayload, ...]:
    """Join every funnel stage by ``source_index`` into one candidate per GPT outfit (§8.2-F).

    candidateId = ``c{source_index}`` — a pure function of the funnel order, so it is deterministic
    and permutation-stable, and unique within the snapshot.
    """
    acc: dict[int, _CandidateAcc] = {}

    def get(idx: int) -> _CandidateAcc:
        if idx not in acc:
            acc[idx] = _CandidateAcc(source_index=idx)
        return acc[idx]

    # 1 — seed every generated candidate from the parsed outfits (raw_emitted = content).
    for idx, outfit in enumerate(trace.parsed_outfits):
        get(idx).raw_emitted = outfit

    # 2 — validation rejections/warnings (candidate-level only; root issues → generation_attempts).
    if trace.validation is not None:
        for issue in trace.validation.rejections:
            if issue.candidate_index is not None:
                get(issue.candidate_index).rejection_codes.append(issue.code.value)
        for issue in trace.validation.warnings:
            if issue.candidate_index is not None:
                get(issue.candidate_index).warning_codes.append(issue.code.value)
        # 3 — accepted validated candidates (content + keys).
        for vc in trace.validation.candidates:
            c = get(vc.source_index)
            c.accepted = True
            c.stage_reached = "validated"
            c.items = _slot_items(vc.slot_map)
            c.slot_map = _slot_dict(vc.slot_map)
            c.template = vc.template.value
            c.base_key = vc.base_key
            c.full_signature = vc.full_signature

    # 4 — render/rescue-specific drops (forced-item / StyleMove).
    for drop in trace.rescue_drops:
        c = get(drop.candidate.source_index)
        c.drop_stage = drop.drop_stage
        c.drop_reason = drop.drop_reason

    # 5 — ranker funnel.
    if trace.rank_audit is not None:
        for fc in trace.rank_audit.filtered:
            c = get(fc.candidate.source_index)
            c.stage_reached = "ranked"
            c.drop_stage = "ranker"
            c.drop_reason = fc.drop_reason
        for ro in trace.rank_audit.scored:
            c = get(ro.source_index)
            c.stage_reached = "ranked"
            c.ranker_score = ro.score
            c.score_breakdown = _breakdown_dict(ro.breakdown)
            c.base_key = ro.base_key
            c.full_signature = ro.full_signature
            c.items = _slot_items(ro.slot_map)
            c.slot_map = _slot_dict(ro.slot_map)
            c.style_move = _style_move_dict(ro.style_move)

    # 6 — response funnel: attach the cold-start scores + path/risk by full_signature, then mark shown.
    full_sig_to_index = {}
    if trace.rank_audit is not None:
        full_sig_to_index = {ro.full_signature: ro.source_index for ro in trace.rank_audit.scored}
    if trace.build_trace is not None:
        for variant in trace.build_trace.all_variants:
            idx = full_sig_to_index.get(variant.full_signature)
            if idx is None:
                continue
            c = get(idx)
            c.compatibility = variant.compatibility
            c.visibility = variant.visibility
            c.option_path = variant.option_path.value
            c.risk = variant.risk.value
        for position, variant in enumerate(trace.build_trace.selected):
            idx = full_sig_to_index.get(variant.full_signature)
            if idx is None:
                continue
            c = get(idx)
            c.shown = True
            c.stage_reached = "shown"
            c.shown_position = position

    candidates: list[CandidatePayload] = []
    for idx in sorted(acc):
        c = acc[idx]
        score_trace = None
        if any(v is not None for v in (c.compatibility, c.visibility, c.ranker_score, c.score_breakdown)):
            score_trace = ScoreTracePayload(
                compatibility=c.compatibility,
                visibility=c.visibility,
                ranker_score=c.ranker_score,
                score_breakdown=c.score_breakdown,
            )
        candidates.append(
            CandidatePayload(
                candidate_id=f"c{idx}",
                source_attempt_id=source_attempt_id,
                source_index=idx,
                stage_reached=c.stage_reached,
                accepted=c.accepted,
                shown=c.shown,
                shown_position=c.shown_position,
                drop_stage=c.drop_stage,
                drop_reason=c.drop_reason,
                rejection_codes=tuple(c.rejection_codes),
                warning_codes=tuple(c.warning_codes),
                items=c.items,
                slot_map=c.slot_map,
                template=c.template,
                base_key=c.base_key,
                full_signature=c.full_signature,
                option_path=c.option_path,
                risk=c.risk,
                style_move=c.style_move,
                raw_emitted=c.raw_emitted,
                score_trace=score_trace,
            )
        )
    return tuple(candidates)


def _build_attempts(trace: RenderTrace) -> tuple[GenerationAttemptPayload, ...]:
    """Map each captured generate→parse attempt to a GenerationAttemptPayload (§8.2-E).

    The producing (last) attempt carries ``candidate_count_emitted`` = the parsed-outfit count,
    plus the root-envelope reject + the aggregate (``candidate_index=None``) warnings that belong
    to the whole attempt, never to a candidate.
    """
    last_index = len(trace.attempts) - 1
    root_rejection_code: Optional[str] = None
    aggregate_warning_codes: tuple[str, ...] = ()
    if trace.validation is not None:
        root_rejections = [i.code.value for i in trace.validation.rejections if i.candidate_index is None]
        root_rejection_code = root_rejections[0] if root_rejections else None
        aggregate_warning_codes = tuple(
            i.code.value for i in trace.validation.warnings if i.candidate_index is None
        )

    out: list[GenerationAttemptPayload] = []
    for index, attempt in enumerate(trace.attempts):
        is_last = index == last_index
        out.append(
            GenerationAttemptPayload(
                attempt_id=f"a{index}",
                attempt_index=index,
                is_repair=attempt.is_repair,
                payload_parsed=attempt.payload_parsed,
                parse_issue=attempt.parse_issue.value if attempt.parse_issue is not None else None,
                root_rejection_code=root_rejection_code if is_last else None,
                aggregate_warning_codes=aggregate_warning_codes if is_last else (),
                candidate_count_emitted=len(trace.parsed_outfits) if is_last else 0,
                raw_text=attempt.raw_text,
                finish_status=_finish_status_dict(attempt.finish_status),
            )
        )
    return tuple(out)


def _finish_status_dict(finish_status) -> Optional[dict]:
    """A ``FinishStatus`` → the plain wire dict, or None for generators that don't expose it."""
    if finish_status is None:
        return None
    return {"finish_reason": finish_status.finish_reason, "refusal": finish_status.refusal}


def abnormal_finish_status(trace: RenderTrace) -> Optional[dict]:
    """The producing attempt's finish status IFF it marks a refusal/truncation (§A.6 point 4).

    The §G ``generator.finishStatus`` provenance is optional — a clean run leaves it unset —
    so this returns the last attempt's status only when it is abnormal: a non-null refusal, or
    a ``finish_reason`` outside ``{None, "stop"}`` (``"length"`` = cap-truncated; anything else
    non-stop, e.g. ``content_filter``, is equally a paid-but-no-JSON §D trigger). The C3
    service records it in the payload's generator block and routes the run to the degenerate
    corpus, never a silent empty and never ``contract_invalid``.
    """
    if not trace.attempts:
        return None
    status = trace.attempts[-1].finish_status
    if status is None:
        return None
    refused = status.refusal is not None
    truncated = status.finish_reason not in (None, "stop")
    if not (refused or truncated):
        return None
    return {"finish_reason": status.finish_reason, "refused": refused}


def _sampler_per_type_diag(sampler) -> dict:
    """Project each ``TypeSampleResult`` to JSON/wire-safe scalars (§8.2-G).

    ``vars(r)`` would embed the raw ``list[WardrobeItem]`` (duplicating itemSnapshots, and not the
    engineVisible projection) and a bare ``SelectionKind`` enum — neither crosses the C4 serde. Keep
    only the diagnostic scalars + an item count; ``.value`` the enum.
    """
    if sampler is None:
        return {}
    return {
        item_type.value: {
            "selection_kind": result.selection_kind.value,
            "reason": result.reason,
            "random_count": result.random_count,
            "signal_count": result.signal_count,
            "item_count": len(result.items),
        }
        for item_type, result in sampler.per_type.items()
    }


def _build_diagnostics(trace: RenderTrace) -> DiagnosticsPayload:
    rejection_histogram: dict = {}
    warning_histogram: dict = {}
    if trace.validation is not None:
        rejection_histogram = dict(Counter(i.code.value for i in trace.validation.rejections))
        warning_histogram = dict(Counter(i.code.value for i in trace.validation.warnings))

    sampler = trace.sampler_result
    ranker: dict = {}
    if trace.rank_audit is not None:
        rr = trace.rank_audit.result
        ranker = {
            "fallback_stage": rr.fallback_stage.value if rr.fallback_stage is not None else None,
            "insufficient_wardrobe": rr.insufficient_wardrobe,
            "relaxed_cooldown_count": rr.relaxed_cooldown_count,
            "locked_survivor_count": rr.locked_survivor_count,
            "insufficient_locked_candidates": rr.insufficient_locked_candidates,
        }

    result = trace.result
    rescue = {
        "not_enough_items": result.not_enough_items,
        "insufficient_after_generation": result.insufficient_after_generation,
        "spread_collapsed": result.spread_collapsed,
    }

    return DiagnosticsPayload(
        sampler_per_type=_sampler_per_type_diag(sampler),
        candidate_requested=trace.candidate_requested,  # the rescue's actual GPT ask
        prompt_item_count=len(trace.prompt_pool),  # the scoped pool = what itemSnapshots captures
        not_enough_items=result.not_enough_items,
        scorer_available=sampler.scorer_available if sampler else False,
        rejection_histogram=rejection_histogram,
        warning_histogram=warning_histogram,
        parse={
            "parse_success": bool(trace.attempts) and trace.attempts[-1].payload_parsed,
            "repair_used": any(a.is_repair for a in trace.attempts),
            "generator_calls": len(trace.attempts),
        },
        ranker=ranker,
        rescue=rescue,
    )


def build_snapshot_payload(
    trace: RenderTrace,
    request: RenderRequest,
    *,
    candidate_cache_key: str,
    request_id: str,
    generator_provider: str,
    generator_model: str,
    generator_temperature: float,
    generator_max_completion_tokens: int,
    generator_api_surface: str = "chat_completions",
    generator_response_format: str = RESPONSE_FORMAT_JSON_SCHEMA_STRICT,
    generator_reasoning_effort: str = "none",
    generator_store_mode: str = "none",
    generator_finish_status: Optional[dict] = None,
    parent_snapshot_id: Optional[str] = None,
    weather_raw: Optional[str] = None,
    location: Optional[str] = None,
    constraints: Optional[dict] = None,
    fitted_core_version: str = __version__,
    prompt_version: str = PROMPT_VERSION,
    ranker_config_version: str = RANKER_CONFIG_VERSION,
) -> GenerationSnapshotPayload:
    """Fold a ``RenderTrace`` into the immutable Python snapshot payload (§8.4 producer half).

    Issues the deterministic per-candidate ``candidate_id`` over the full funnel, preserves every
    candidate's content (§8.2-F), and populates diagnostics from the sampler/ranker/rescue results.
    The version/provenance constants default to C4's module constants; the generator config +
    cache key + the §G.1 echo-through identity (``request_id``/``parent_snapshot_id``/
    ``weather_raw``/``location``/``constraints``) are supplied by the caller — the C3 service,
    which knows them (never the wire ``generator`` expectation, §A). ``request_id`` is required:
    a write without it escapes the §C.4 partial unique index and duplicates on retry.

    §A.6/§G generator provenance: the ``generator`` block records the full API surface the run
    used — ``max_completion_tokens`` (the cap changes truncation/parse-fail/candidate
    distributions, so M6 stratifies by it), ``api_surface``/``response_format``/
    ``reasoning_effort``/``store_mode``, and the run's abnormal ``finish_status`` (a clean run
    leaves it unset — pass :func:`abnormal_finish_status`).
    """
    candidates = _build_candidates(trace, source_attempt_id=f"a{max(len(trace.attempts) - 1, 0)}")
    item_snapshots = tuple(
        ItemSnapshotPayload(item_id=item.id, engine_visible=_engine_visible(item))
        for item in trace.prompt_pool
    )
    shown = [c for c in candidates if c.shown]
    shown.sort(key=lambda c: (c.shown_position if c.shown_position is not None else 0))
    shown_full_signatures = tuple(c.full_signature for c in shown if c.full_signature is not None)

    return GenerationSnapshotPayload(
        session_id=request.session_id,
        candidate_cache_key=candidate_cache_key,
        generation_index=request.generation_index,
        request_id=request_id,
        parent_snapshot_id=parent_snapshot_id,
        intent=request.intent,
        occasion=request.occasion,
        weather=request.weather,
        weather_raw=weather_raw,
        location=location,
        forced_item_id=request.forced_item_id,
        wardrobe_version=request.wardrobe_version,
        seed_date=request.date,
        constraints=dict(constraints) if constraints else {},
        fitted_core_version=fitted_core_version,
        generator=_generator_block(
            provider=generator_provider,
            model=generator_model,
            temperature=generator_temperature,
            prompt_version=prompt_version,
            max_completion_tokens=generator_max_completion_tokens,
            api_surface=generator_api_surface,
            response_format=generator_response_format,
            reasoning_effort=generator_reasoning_effort,
            store_mode=generator_store_mode,
            finish_status=generator_finish_status,
        ),
        ranker_config_version=ranker_config_version,
        # M6: a trained scorer flips kind/model_id/available here (cold-start until then)
        scorer={"kind": "cold_start", "model_id": None, "available": False},
        item_snapshots=item_snapshots,
        generation_attempts=_build_attempts(trace),
        candidates=candidates,
        diagnostics=_build_diagnostics(trace),
        shown_candidate_ids=tuple(c.candidate_id for c in shown),
        shown_full_signatures=shown_full_signatures,
        n_surfaced=len(shown),
        spread_collapsed=trace.result.spread_collapsed,
    )


def _generator_block(
    *,
    provider: str,
    model: str,
    temperature: float,
    prompt_version: str,
    max_completion_tokens: int,
    api_surface: str,
    response_format: str,
    reasoning_effort: str,
    store_mode: str,
    finish_status: Optional[dict],
) -> dict:
    """The §A.6/§G generator provenance block — authored from the service's OWN config.

    ``finish_status`` is included only when set (a clean run leaves it unset, §G item 6).
    """
    block: dict = {
        "provider": provider,
        "model": model,
        "temperature": temperature,
        "prompt_version": prompt_version,
        "max_completion_tokens": max_completion_tokens,
        "api_surface": api_surface,
        "response_format": response_format,
        "reasoning_effort": reasoning_effort,
        "store_mode": store_mode,
    }
    if finish_status is not None:
        block["finish_status"] = dict(finish_status)
    return block


def build_degenerate_payload(
    request: RenderRequest,
    failure: EngineFailure,
    *,
    candidate_cache_key: str,
    request_id: str,
    generator_provider: str,
    generator_model: str,
    generator_temperature: float,
    generator_max_completion_tokens: int,
    generator_api_surface: str = "chat_completions",
    generator_response_format: str = RESPONSE_FORMAT_JSON_SCHEMA_STRICT,
    generator_reasoning_effort: str = "none",
    generator_store_mode: str = "none",
    parent_snapshot_id: Optional[str] = None,
    weather_raw: Optional[str] = None,
    location: Optional[str] = None,
    constraints: Optional[dict] = None,
    generator_calls: int = 0,
    fitted_core_version: str = __version__,
    prompt_version: str = PROMPT_VERSION,
    ranker_config_version: str = RANKER_CONFIG_VERSION,
) -> GenerationSnapshotPayload:
    """A schema-valid degenerate payload for a failure with NO ``RenderTrace`` (§D, C3).

    ``generator_calls`` is the number of paid ``generate()`` calls the caller observed before
    the failure (the C3 service counts them) — the trace's raw attempt text is lost on a
    mid-trace exception (the known §D micro-gap), but the spend COUNT is knowable and must
    not be recorded as an affirmatively-false zero.

    ``build_snapshot_payload`` requires a trace, which a pre-trace exception doesn't have —
    but every provenance-required field is derivable from the request + module constants +
    the service's own generator config, so the failure corpus §15.1 wants is always
    constructable (*trap-guard:* never reason "generation didn't run ⇒ provenance unknown ⇒
    no snapshot"). Attempts are **empty** (§8.2-E: never fabricate an attempt) and the
    failure is recorded in ``diagnostics.engine_failure``. Carries the full §G.1
    identity/echo-through set — in particular ``request_id``: a degenerate write without it
    escapes the §C.4 partial unique index and duplicates on retry.

    Reserved for **internal engine failures on a valid request** — an input-validation
    failure is a caller bug → the ``contract_invalid`` envelope, no payload (§D).
    """
    diagnostics = DiagnosticsPayload(
        sampler_per_type={},
        candidate_requested=None,
        prompt_item_count=None,
        not_enough_items=False,
        scorer_available=False,
        rejection_histogram={},
        warning_histogram={},
        parse={
            "parse_success": False,
            "repair_used": generator_calls >= 2,  # the 2nd call is the one §12 repair retry
            "generator_calls": generator_calls,
        },
        ranker={},
        rescue={
            "not_enough_items": False,
            "insufficient_after_generation": False,
            "spread_collapsed": False,
        },
        engine_failure=failure.to_payload_dict(),
    )
    return GenerationSnapshotPayload(
        session_id=request.session_id,
        candidate_cache_key=candidate_cache_key,
        generation_index=request.generation_index,
        request_id=request_id,
        parent_snapshot_id=parent_snapshot_id,
        intent=request.intent,
        occasion=request.occasion,
        weather=request.weather,
        weather_raw=weather_raw,
        location=location,
        forced_item_id=request.forced_item_id,
        wardrobe_version=request.wardrobe_version,
        seed_date=request.date,
        constraints=dict(constraints) if constraints else {},
        fitted_core_version=fitted_core_version,
        generator=_generator_block(
            provider=generator_provider,
            model=generator_model,
            temperature=generator_temperature,
            prompt_version=prompt_version,
            max_completion_tokens=generator_max_completion_tokens,
            api_surface=generator_api_surface,
            response_format=generator_response_format,
            reasoning_effort=generator_reasoning_effort,
            store_mode=generator_store_mode,
            finish_status=None,  # no attempt ran — there is no finish status to record
        ),
        ranker_config_version=ranker_config_version,
        scorer={"kind": "cold_start", "model_id": None, "available": False},
        item_snapshots=(),
        generation_attempts=(),
        candidates=(),
        diagnostics=diagnostics,
        shown_candidate_ids=(),
        shown_full_signatures=(),
        n_surfaced=0,
        spread_collapsed=False,
    )
