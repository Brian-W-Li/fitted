"""The M5 `/render` service — a minimal ASGI app over ``fitted_core`` (m5-cutover.md §A, C3).

Framework call (§A "FastAPI acceptable"): hand-rolled minimal ASGI, zero HTTP dependencies —
the service is two routes with fully custom validation/envelopes either way, and the hermetic
pytest suite stays dependency-free (the same posture as ``fitted_core``'s lazy ``openai``
import). ``uvicorn`` serves it in the container (service/requirements.txt); tests drive the
ASGI callable directly.

Request lifecycle for ``POST /render`` (each stage ordered before any OpenAI spend):

  1. **auth** — ``X-Fitted-Service-Key`` vs the two rotation keys (§A) → 401 envelope.
  2. **rate ceiling** — per-instance token bucket (§A) → 429 envelope.
  3. **body cap** — ``MAX_REQUEST_BODY_BYTES`` at the ASGI read loop (G7).
  4. **parse + depth cap** — malformed / too-deep JSON is a caller bug → ``contract_invalid``.
  5. **validation** (§A/G7/§D) — clamps, closed vocabularies, UTF-8 well-formedness (an
     unpaired surrogate is a caller bug, never a downstream encode crash), generator
     exact-match, the rescue forced-item pre-spend check, duplicate-id rejection,
     ``RenderRequest`` guards.
     Any failure → ``contract_invalid``, **no payload, no snapshot** (§D corpus purity).
  6. **reducers** — the §H reducers run HERE (they are Python), over the raw
     ``behavioralRows`` Next fetched; their output feeds both sampler + ranker seams. The
     reducers, scorer, and generator construction sit INSIDE the §D degenerate guard: an
     exception in any of them on a valid request is an internal engine failure recorded as
     a no-attempt ``stage="pre_generation"`` degenerate payload, never a bare 500.
  7. **render** — ``render_with_trace`` with the injected ``Generator``. An exception on this
     valid request is an INTERNAL engine failure → the §D degenerate payload
     (``build_degenerate_payload``, empty attempts + ``diagnostics.engineFailure``), never a
     500 that loses the failure corpus. A refusal / cap-truncation / parse-fail-after-repair
     completes the trace normally and lands as a degenerate payload WITH attempts (§A.6).
  8. **payload + shown** — ``build_snapshot_payload`` (generator provenance from the
     service's OWN config, §A) and the §A shown-identity zip by ``full_signature``.

Error envelope (all non-2xx): ``{"error": {"code": "auth|rate_limit|contract_invalid|
internal", "message": …}}``. ``parse_fail`` is deliberately NOT a code — a GPT-side parse
failure is a valid-request engine failure and returns a 2xx degenerate payload (§A).
"""

from __future__ import annotations

import dataclasses
import hmac
import json
import re
import time
from dataclasses import dataclass
from datetime import date
from typing import Any, Callable, Mapping, Optional

from fitted_core.config import DEFAULT_K, N_SURFACED
from fitted_core.generation import Generator, GenerationPrompt, OpenAIGenerator
from fitted_core.models import ItemType, WardrobeItem
from fitted_core.reducers import (
    INTERACTION_ROWS_SCAN_LIMIT,
    REPETITION_WINDOW_SNAPSHOTS,
    AffinitySignalScorer,
    reduce_behavioral_signals,
)
from fitted_core.rescue import RenderRequest, RenderTrace, render_with_trace
from fitted_core.sampler import reject_duplicate_ids
from fitted_core.seed import candidate_cache_key
from fitted_core.snapshot import (
    EngineFailure,
    GenerationSnapshotPayload,
    abnormal_finish_status,
    build_degenerate_payload,
    build_snapshot_payload,
)
from fitted_core.snapshot_serde import to_wire, variant_to_wire
from service import config as cfg
from service import contract
from service.config import ServiceConfig, load_service_config

AUTH_HEADER = "x-fitted-service-key"

# §C.4 accepted requestId shapes (mirrors the §G schema validator): UUIDv4 or ULID, ≤ 64.
_UUID_V4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.IGNORECASE
)
_ULID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")
_OBJECT_ID_RE = re.compile(r"^[0-9a-fA-F]{24}$")
_SEED_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

_ITEM_TYPE_VALUES = frozenset(t.value for t in ItemType)
_KEY_RESERVED_CHARS = (":", "|", "=")
_KEY_NONE_SENTINEL = "none"

# The §D degenerate-arm reasonHint (C4 docket (a), §A): a STABLE MACHINE CODE — never
# str(exception), never an English sentence — matching the degraded browser-response code family
# (service_unavailable/contract_invalid/…). The client maps it to localized copy; healthy-render
# hints (notEnoughItems/insufficientAfterGeneration) stay English prose.
_ENGINE_FAILURE_HINT = "engine_failure"


class ContractInvalid(Exception):
    """A caller bug (§D input-validation boundary) → 400 ``contract_invalid``, no payload."""


# ---------------------------------------------------------------------------
# Envelope + response helpers
# ---------------------------------------------------------------------------


def _envelope(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise ValueError(f"duplicate object member name {key!r} is not valid JSON at the service boundary")
        out[key] = value
    return out


def _reject_non_finite_json_constant(raw: str) -> None:
    raise ValueError(f"{raw} is not valid JSON at the service boundary")


def _flags(
    *,
    not_enough_items: bool = False,
    insufficient_after_generation: bool = False,
    spread_collapsed: bool = False,
    reason_hint: Optional[str] = None,
) -> dict:
    return {
        "notEnoughItems": not_enough_items,
        "insufficientAfterGeneration": insufficient_after_generation,
        "spreadCollapsed": spread_collapsed,
        "reasonHint": reason_hint,
    }


# ---------------------------------------------------------------------------
# Rate ceiling (§A) — in-process token bucket; global ONLY under the fly.toml
# single-machine pin (min_machines_running=1, no autoscale).
# ---------------------------------------------------------------------------


class _TokenBucket:
    def __init__(self, burst: int, refill_per_second: float, clock: Callable[[], float]) -> None:
        self._burst = float(burst)
        self._refill = refill_per_second
        self._clock = clock
        self._tokens = float(burst)
        self._last = clock()

    def try_acquire(self) -> bool:
        now = self._clock()
        self._tokens = min(self._burst, self._tokens + (now - self._last) * self._refill)
        self._last = now
        if self._tokens >= 1.0:
            self._tokens -= 1.0
            return True
        return False


class _CountingGenerator:
    """Wraps the injected ``Generator`` to observe whether spend happened (§D stage split)."""

    def __init__(self, inner: Generator) -> None:
        self._inner = inner
        self.calls = 0

    @property
    def last_finish_status(self):
        return getattr(self._inner, "last_finish_status", None)

    def generate(self, prompt: GenerationPrompt) -> str:
        self.calls += 1
        return self._inner.generate(prompt)


# ---------------------------------------------------------------------------
# Request validation (§A/G7/§D — every check pre-spend)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _ParsedRender:
    render_request: RenderRequest
    snapshot_id: str
    request_id: str
    parent_snapshot_id: Optional[str]
    weather_raw: Optional[str]
    location: Optional[str]
    interaction_rows: list
    snapshot_rows: list


def _require_keys(
    obj: Mapping[str, Any], required: frozenset[str], optional: frozenset[str], where: str
) -> None:
    missing = required - set(obj)
    if missing:
        raise ContractInvalid(f"{where} is missing required field(s): {sorted(missing)}")
    unknown = set(obj) - required - optional
    if unknown:
        raise ContractInvalid(f"{where} has unknown field(s): {sorted(unknown)}")


def _require_utf8(value: str, name: str) -> None:
    """Reject a string that is not UTF-8-encodable (an unpaired surrogate — the only way a Python
    str fails UTF-8). ``json.loads`` accepts the ``"\\ud83d"`` escape, but such text is not valid
    Unicode (I-JSON forbids it) and would raise ``UnicodeEncodeError`` downstream — in
    ``candidate_cache_key`` (outside the §D guard → a bare 500 losing the row) or the OpenAI SDK's
    request encode (a poisoned item name turning every render into a failure row). A caller bug,
    rejected pre-spend. The message never echoes the value (field name only)."""
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        raise ContractInvalid(f"{name} contains an unpaired surrogate (not valid UTF-8 text)") from None


def _string(value: Any, name: str, *, max_chars: int, allow_blank: bool = False) -> str:
    if not isinstance(value, str):
        raise ContractInvalid(f"{name} must be a string")
    if not allow_blank and not value.strip():
        # Whitespace-only PASSES Mongoose `required` — reject explicitly, never trim (§F).
        raise ContractInvalid(f"{name} must be a non-blank string")
    if len(value) > max_chars:
        raise ContractInvalid(f"{name} exceeds {max_chars} characters")
    _require_utf8(value, name)
    return value


def _validate_key_safe_item_id(item_id: str, name: str) -> None:
    """Pre-spend mirror of v2 §7/R10: pool ids must be usable in BaseKey/FullSignature."""
    if item_id == _KEY_NONE_SENTINEL:
        raise ContractInvalid(f"{name} must not equal the reserved sentinel {_KEY_NONE_SENTINEL!r}")
    for ch in _KEY_RESERVED_CHARS:
        if ch in item_id:
            raise ContractInvalid(f"{name} contains reserved key character {ch!r}")


def _optional_string(value: Any, name: str, *, max_chars: int) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ContractInvalid(f"{name} must be a string or null")
    if len(value) > max_chars:
        raise ContractInvalid(f"{name} exceeds {max_chars} characters")
    _require_utf8(value, name)
    return value


def _non_bool_int(value: Any, name: str, *, minimum: int = 0, maximum: Optional[int] = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ContractInvalid(f"{name} must be a non-bool integer")
    if value < minimum:
        raise ContractInvalid(f"{name} must be >= {minimum}")
    if maximum is not None and value > maximum:
        raise ContractInvalid(f"{name} must be <= {maximum}")
    return value


def _exact_number(value: Any, name: str, expected: float) -> None:
    """Exact-equality guard for a numeric wire field vs a configured constant. Rejects non-numbers
    AND arbitrary-precision ints that overflow ``float()`` (e.g. a 400-digit integer) — a raw
    ``float(value)`` there raises OverflowError, which would escape the ``ContractInvalid`` parse
    contract as a 500 instead of a 400. Such a value can never equal the finite configured constant
    anyway, so it is rejected without coercing."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ContractInvalid(f"{name} must exactly equal the service's configured value")
    try:
        equal = float(value) == float(expected)
    except OverflowError:
        equal = False
    if not equal:
        raise ContractInvalid(f"{name} must exactly equal the service's configured value")


def _string_list(value: Any, name: str, *, max_items: int, max_chars: int) -> list[str]:
    if not isinstance(value, list):
        raise ContractInvalid(f"{name} must be an array")
    if len(value) > max_items:
        raise ContractInvalid(f"{name} exceeds {max_items} entries")
    out: list[str] = []
    for element in value:
        if not isinstance(element, str) or not element.strip():
            raise ContractInvalid(f"{name} entries must be non-blank strings")
        if len(element) > max_chars:
            raise ContractInvalid(f"{name} entries exceed {max_chars} characters")
        _require_utf8(element, f"{name} entries")
        out.append(element)
    return out


def _json_depth_guard(value: Any, max_depth: int) -> None:
    """Iterative depth walk — a hostile-but-parseable body must die before any downstream
    recursion (G7 ``MAX_JSON_NESTING_DEPTH``)."""
    stack: list[tuple[Any, int]] = [(value, 1)]
    while stack:
        node, depth = stack.pop()
        if depth > max_depth:
            raise ContractInvalid(f"request JSON exceeds nesting depth {max_depth}")
        if isinstance(node, dict):
            stack.extend((child, depth + 1) for child in node.values())
        elif isinstance(node, list):
            stack.extend((child, depth + 1) for child in node)


def _validate_wardrobe_item(raw: Any, index: int) -> WardrobeItem:
    where = f"wardrobe[{index}]"
    if not isinstance(raw, dict):
        raise ContractInvalid(f"{where} must be an object")
    _require_keys(
        raw,
        required=contract.WARDROBE_ITEM_REQUIRED,
        optional=contract.WARDROBE_ITEM_OPTIONAL,
        where=where,
    )
    item_id = _string(raw["id"], f"{where}.id", max_chars=cfg.MAX_ID_CHARS)
    _validate_key_safe_item_id(item_id, f"{where}.id")
    name = _string(raw["name"], f"{where}.name", max_chars=cfg.MAX_ITEM_NAME_CHARS)
    clothing_type = raw["clothingType"]
    if not isinstance(clothing_type, str) or clothing_type not in _ITEM_TYPE_VALUES:
        raise ContractInvalid(f"{where}.clothingType must be one of {sorted(_ITEM_TYPE_VALUES)}")
    # Accept-predicate = the adapter's drop-predicate exactly (bound single-homed in
    # fitted_core/models.py, cross-runtime-pinned against the TS lib/warmth copy).
    warmth = _non_bool_int(
        raw["warmth"], f"{where}.warmth", minimum=cfg.WARMTH_MIN, maximum=cfg.WARMTH_MAX
    )
    tags = {
        key: _string_list(
            raw[key], f"{where}.{key}", max_items=cfg.MAX_ITEM_TAGS, max_chars=cfg.MAX_ITEM_TAG_CHARS
        )
        for key in ("styleTags", "colorTags", "occasionTags")
    }
    material = _optional_string(raw.get("material"), f"{where}.material", max_chars=cfg.MAX_ITEM_ATTR_CHARS)
    formality = _optional_string(raw.get("formality"), f"{where}.formality", max_chars=cfg.MAX_ITEM_ATTR_CHARS)
    # Blank is a LEGITIMATE value here (spec §15.2: imageUrl → else imagePath → else "" — the
    # deployed model does not require an image), unlike id/name; the engine never prompts on it
    # (H33 strips image_url) and stores it verbatim in the engineVisible snapshot.
    image_url = _string(
        raw["imageUrl"], f"{where}.imageUrl", max_chars=cfg.MAX_IMAGE_URL_CHARS, allow_blank=True
    )
    try:
        return WardrobeItem(
            id=item_id,
            name=name,
            type=ItemType(clothing_type),
            warmth=warmth,
            image_url=image_url,
            style_tags=tags["styleTags"],
            color_tags=tags["colorTags"],
            occasion_tags=tags["occasionTags"],
            material=material,
            formality=formality,
        )
    except (TypeError, ValueError) as exc:  # the dataclass guards are inside the boundary (§D)
        raise ContractInvalid(f"{where} failed engine validation: {exc}") from exc


def _normalize_controls(raw: Any) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """The §C.3 F6 control normalization — ONE normalized set drives generation AND persistence.

    Reject blank/non-string ids (via ``_string_list``), **dedup + order-normalize** (stable sort →
    canonical persisted arrays, never client-order-dependent), and reject the ``locked ∩ disliked``
    contradiction (a caller bug — a contradictory request must never empty-succeed). The
    wardrobe-membership + structural-feasibility checks are wardrobe-dependent and run in
    :func:`_preflight_controls` after the wardrobe is parsed. Returns ``(locked, disliked)`` tuples.
    """
    where = "controls"
    if not isinstance(raw, dict):
        raise ContractInvalid(f"{where} must be an object")
    _require_keys(raw, required=contract.CONTROLS_REQUIRED, optional=contract.CONTROLS_OPTIONAL, where=where)
    normalized: dict[str, tuple[str, ...]] = {}
    for key in ("lockedItemIds", "dislikedItemIds"):
        ids = _string_list(
            raw[key], f"{where}.{key}", max_items=cfg.MAX_CONTROL_IDS, max_chars=cfg.MAX_ID_CHARS
        )
        normalized[key] = tuple(sorted(set(ids)))  # dedup + canonical order (F6)
    locked, disliked = normalized["lockedItemIds"], normalized["dislikedItemIds"]
    overlap = set(locked) & set(disliked)
    if overlap:
        # A contradictory request pre-generation: locked ∩ disliked ≠ ∅ → never empty-success.
        raise ContractInvalid(
            f"{where}: an item cannot be both locked and disliked "
            f"(overlap: {sorted(overlap)})"
        )
    return locked, disliked


def _lock_feasibility_error(pin_types: list[ItemType]) -> Optional[str]:
    """The §C.3 structural-feasibility check over the effective pins' slots (the rescue forced item
    + the R9 locks, deduped by id). Returns a stable reason string, or ``None`` when buildable.

    Two ways a lock set cannot occupy a valid slot map: **>1 lock in one slot** (two tops, two
    shoes — a slot holds one item), or a **locked dress with a locked top/bottom** (one_piece vs
    two_piece — mutually exclusive templates). Optional ``outer``/``shoes`` fit either template, so
    they never conflict beyond the one-per-slot rule.
    """
    seen: set = set()
    for pin_type in pin_types:
        if pin_type in seen:
            return f"locked items conflict: more than one lock occupies the {pin_type.value} slot"
        seen.add(pin_type)
    if ItemType.dress in seen and (ItemType.top in seen or ItemType.bottom in seen):
        return "locked items conflict: a locked dress cannot coexist with a locked top or bottom"
    return None


def _preflight_controls(
    locked: tuple[str, ...],
    disliked: tuple[str, ...],
    wardrobe: list,
    forced_item_id: Optional[str],
    intent: str,
) -> None:
    """The wardrobe-dependent §C.3 preflight (runs after the wardrobe parses, before any spend).

    Rejects ONLY the **request-decidable contradictions** — a control set that can never yield a
    valid outfit *regardless of the closet* — as ``contract_invalid`` (a caller bug the client can and
    must prevent, Fable 2026-07-07):
      - a lock/dislike referencing an id absent from the live wardrobe (a stale control that shaped
        nothing — must not be persisted as if it did);
      - the rescue forced item also disliked (the implicit lock ∩ dislike contradiction);
      - a structurally infeasible lock set (``_lock_feasibility_error``: >1 lock per slot, or a locked
        dress with a locked top/bottom — closet-independent).

    It does **NOT** reject a well-formed control set the *actual wardrobe can't complete* (a locked top
    with no bottom; dislikes that remove every base) — that is **closet-dependent**, decidable only with
    the server wardrobe + the engine's template grammar, so it is a valid EMPTY render, not a caller
    bug. The **engine** short-circuits that case pre-GPT to a valid ``not_enough_items`` result
    (`rescue._controls_leave_no_buildable_outfit`) — no spend, a snapshot row IS written — never a
    ``contract_invalid`` (§C.3; consistent with the no-controls understocked-closet path). See §J for
    the open question of whether the stale-id checks below should soften to a 409 state-conflict
    (deleted-item race) rather than a caller-bug 400.
    """
    by_id = {item.id: item for item in wardrobe}
    for locked_id in locked:
        if locked_id not in by_id:
            raise ContractInvalid(
                f"controls.lockedItemIds contains {locked_id!r}, which is not in the wardrobe"
            )
    for disliked_id in disliked:
        if disliked_id not in by_id:
            raise ContractInvalid(
                f"controls.dislikedItemIds contains {disliked_id!r}, which is not in the wardrobe"
            )
    if intent == "rescue_item" and forced_item_id is not None and forced_item_id in set(disliked):
        raise ContractInvalid(
            "lens.forcedItemId cannot also be disliked — a rescue of a disliked item cannot succeed"
        )
    pin_ids = set(locked)
    if intent == "rescue_item" and forced_item_id is not None:
        pin_ids.add(forced_item_id)  # the forced item is an implicit lock (every outfit includes it)
    pin_types = [by_id[pid].type for pid in sorted(pin_ids) if pid in by_id]
    error = _lock_feasibility_error(pin_types)
    if error is not None:
        raise ContractInvalid(error)


def _validate_generator_expectation(raw: Any, config: ServiceConfig) -> None:
    """§A exact-match: the wire ``generator`` is Next's EXPECTATION, never control. A
    mismatch means Next's expectation and the service's reality drifted — fail loud.

    The expectation covers the **full static API surface** the service authors into the
    §A.6/§G provenance block AND constructs the ``OpenAIGenerator`` from — ``apiSurface`` /
    ``responseFormat`` / ``reasoningEffort`` / ``storeMode`` / ``promptCacheRetention`` /
    ``timeoutSeconds`` / ``maxRetries`` alongside the original four — so any drift between what
    Next expects and what the service is configured to do is caught **pre-spend**, before the
    generator is built, never after a paid call has already been made (a corpus row that lies
    about what produced it). This validates the wire expectation only; it never mutates config."""
    where = "generator"
    if not isinstance(raw, dict):
        raise ContractInvalid(f"{where} must be an object")
    _require_keys(
        raw,
        required=contract.GENERATOR_REQUIRED,
        optional=contract.GENERATOR_OPTIONAL,
        where=where,
    )
    if raw["provider"] != cfg.GENERATOR_PROVIDER:
        raise ContractInvalid(f"{where}.provider must be {cfg.GENERATOR_PROVIDER!r}")
    if (
        not isinstance(raw["model"], str)
        or raw["model"] not in cfg.GENERATOR_MODEL_ALLOWLIST
        or raw["model"] != cfg.GENERATOR_MODEL
    ):
        # isinstance-guard first: `x in <frozenset>` raises TypeError on an unhashable list/dict,
        # which would escape the ContractInvalid parse contract as a 500.
        raise ContractInvalid(f"{where}.model is not the service's configured model")
    _exact_number(raw["temperature"], f"{where}.temperature", cfg.GENERATOR_TEMPERATURE)
    tokens = raw["maxCompletionTokens"]
    if isinstance(tokens, bool) or not isinstance(tokens, int) or tokens != config.max_completion_tokens:
        raise ContractInvalid(
            f"{where}.maxCompletionTokens must exactly equal the service's configured cap"
        )
    # The static API surface — exact-match each field against the service's own configured value
    # (the same constants _default_generator_factory builds the client from and the provenance
    # block records), so an expectation authored against a drifted service is rejected pre-spend.
    for field, expected in (
        ("apiSurface", cfg.GENERATOR_API_SURFACE),
        ("responseFormat", cfg.GENERATOR_RESPONSE_FORMAT),
        ("reasoningEffort", cfg.GENERATOR_REASONING_EFFORT),
        ("storeMode", cfg.GENERATOR_STORE_MODE),
        ("promptCacheRetention", cfg.GENERATOR_PROMPT_CACHE_RETENTION),
    ):
        if raw[field] != expected:
            raise ContractInvalid(
                f"{where}.{field} must exactly equal the service's configured value"
            )
    _exact_number(raw["timeoutSeconds"], f"{where}.timeoutSeconds", cfg.OPENAI_TIMEOUT_SECONDS)
    retries = raw["maxRetries"]
    if isinstance(retries, bool) or not isinstance(retries, int) or retries != cfg.OPENAI_MAX_RETRIES:
        raise ContractInvalid(
            f"{where}.maxRetries must exactly equal the service's configured retry count"
        )


def _validate_behavioral_rows(raw: Any) -> tuple[list, list]:
    where = "behavioralRows"
    if not isinstance(raw, dict):
        raise ContractInvalid(f"{where} must be an object")
    _require_keys(
        raw,
        required=contract.BEHAVIORAL_ROWS_REQUIRED,
        optional=contract.BEHAVIORAL_ROWS_OPTIONAL,
        where=where,
    )
    snapshot_rows = raw.get("recentSnapshots", [])
    interaction_rows = raw.get("interactionRows", [])
    for name, rows, bound in (
        ("recentSnapshots", snapshot_rows, REPETITION_WINDOW_SNAPSHOTS),
        ("interactionRows", interaction_rows, INTERACTION_ROWS_SCAN_LIMIT),
    ):
        if not isinstance(rows, list):
            raise ContractInvalid(f"{where}.{name} must be an array")
        if len(rows) > bound:
            # Next must send BOUNDED projections (§H); an over-bound send is a caller bug
            # the reducers' islice would otherwise mask.
            raise ContractInvalid(f"{where}.{name} exceeds the §H bound of {bound} rows")
        if not all(isinstance(row, dict) for row in rows):
            raise ContractInvalid(f"{where}.{name} entries must be objects")
    return interaction_rows, snapshot_rows


def _parse_render_body(body: dict, config: ServiceConfig) -> _ParsedRender:
    _require_keys(
        body,
        required=contract.RENDER_BODY_REQUIRED,
        optional=contract.RENDER_BODY_OPTIONAL,
        where="request",
    )

    snapshot_id = _string(body["snapshotId"], "snapshotId", max_chars=cfg.MAX_ID_CHARS)
    if not _OBJECT_ID_RE.fullmatch(snapshot_id):
        raise ContractInvalid("snapshotId must be a 24-hex ObjectId string")

    request_id = _string(body["requestId"], "requestId", max_chars=cfg.MAX_ID_CHARS)
    if not (_UUID_V4_RE.fullmatch(request_id) or _ULID_RE.fullmatch(request_id)):
        raise ContractInvalid("requestId must be a UUIDv4 or ULID (§C.4)")

    session_id = _string(body["sessionId"], "sessionId", max_chars=cfg.MAX_SESSION_ID_CHARS)

    intent = body["intent"]
    if not isinstance(intent, str) or intent not in cfg.SUPPORTED_INTENTS:
        raise ContractInvalid(f"intent must be one of {sorted(cfg.SUPPORTED_INTENTS)}")

    generation_index = _non_bool_int(body["generationIndex"], "generationIndex", maximum=cfg.MAX_WIRE_INT)
    parent_snapshot_id = body["parentSnapshotId"]
    if parent_snapshot_id is not None:
        parent_snapshot_id = _string(parent_snapshot_id, "parentSnapshotId", max_chars=cfg.MAX_ID_CHARS)
        if not _OBJECT_ID_RE.fullmatch(parent_snapshot_id):
            raise ContractInvalid("parentSnapshotId must be a 24-hex ObjectId string or null")
    # §C.1 lineage consistency: a root render is exactly index 0 with no parent.
    if (parent_snapshot_id is None) != (generation_index == 0):
        raise ContractInvalid(
            "parentSnapshotId and generationIndex disagree: a root render is index 0 with a "
            "null parent; a re-roll carries both"
        )

    locked_item_ids, disliked_item_ids = _normalize_controls(body["controls"])
    # §C.3 root-controls invariant: controls are regenerate-LINEAGE only. A root render
    # (null parent / index 0) must carry empty controls — non-empty locked/disliked on a
    # parentless render is a caller bug, rejected pre-spend before any preflight or generator
    # call. Defense-in-depth: C5 derives controls server-side from the regenerate UI, only ever
    # on a re-roll (generationIndex > 0 with a parent); the service must never accept a root
    # controlled render even if that derivation drifts. (The lineage check above already
    # guarantees parent-None ⟺ index-0, so this equivalently reads "index 0 → empty controls".)
    if parent_snapshot_id is None and (locked_item_ids or disliked_item_ids):
        raise ContractInvalid(
            "controls must be empty on a root render — locked/disliked controls are carried "
            "only by a re-roll (generationIndex > 0 with a parentSnapshotId)"
        )

    lens = body["lens"]
    if not isinstance(lens, dict):
        raise ContractInvalid("lens must be an object")
    _require_keys(
        lens,
        required=contract.LENS_REQUIRED,
        optional=contract.LENS_OPTIONAL,
        where="lens",
    )
    occasion = _string(lens["occasion"], "lens.occasion", max_chars=cfg.MAX_OCCASION_CHARS)
    weather = lens["weather"]
    if not isinstance(weather, str) or weather not in cfg.WEATHER_BUCKETS:
        raise ContractInvalid(f"lens.weather must be one of {sorted(cfg.WEATHER_BUCKETS)}")
    weather_raw = _optional_string(lens.get("weatherRaw"), "lens.weatherRaw", max_chars=cfg.MAX_WEATHER_RAW_CHARS)
    location = _optional_string(lens.get("location"), "lens.location", max_chars=cfg.MAX_LOCATION_CHARS)
    forced_item_id = lens.get("forcedItemId")
    if forced_item_id is not None:
        forced_item_id = _string(forced_item_id, "lens.forcedItemId", max_chars=cfg.MAX_ID_CHARS)
    if (intent == "rescue_item") != (forced_item_id is not None):
        raise ContractInvalid("lens.forcedItemId is required iff intent is rescue_item")
    seed_date = lens.get("seedDate")
    if not isinstance(seed_date, str) or not _SEED_DATE_RE.fullmatch(seed_date):
        raise ContractInvalid("lens.seedDate must be a required YYYY-MM-DD string (H8, UTC)")
    try:
        date.fromisoformat(seed_date)  # shape-valid but non-calendar (2026-13-99) rejects too
    except ValueError as exc:
        raise ContractInvalid("lens.seedDate is not a real calendar date") from exc
    constraints = lens["constraints"]
    if not isinstance(constraints, dict) or constraints != {}:
        # M5 defers constraints: non-empty maps are rejected, never stored as inert provenance.
        raise ContractInvalid("lens.constraints must be {} at M5")

    raw_wardrobe = body["wardrobe"]
    if not isinstance(raw_wardrobe, list):
        raise ContractInvalid("wardrobe must be an array")
    if len(raw_wardrobe) > cfg.MAX_WARDROBE_ITEMS:
        raise ContractInvalid(f"wardrobe exceeds {cfg.MAX_WARDROBE_ITEMS} items")
    wardrobe = [_validate_wardrobe_item(raw, i) for i, raw in enumerate(raw_wardrobe)]
    try:
        reject_duplicate_ids(wardrobe)  # §D: duplicate logical ids are a caller bug, pre-spend
    except ValueError as exc:
        raise ContractInvalid(str(exc)) from exc
    if forced_item_id is not None and all(item.id != forced_item_id for item in wardrobe):
        # The rescue forced-item pre-spend check (§D input-validation locus; the Next-side
        # 409 forced_item_unavailable state-conflict arm is C5's — here it is a caller bug).
        raise ContractInvalid("lens.forcedItemId is not in the wardrobe")

    # §C.3 wardrobe-dependent lock preflight — every locked id must be a live wardrobe item, the
    # rescue forced item must not be disliked, and the effective pin set (locks + rescue forced
    # item) must be structurally buildable, ALL pre-spend.
    _preflight_controls(locked_item_ids, disliked_item_ids, wardrobe, forced_item_id, intent)

    wardrobe_version = _non_bool_int(body["wardrobeVersion"], "wardrobeVersion", maximum=cfg.MAX_WIRE_INT)
    interaction_count = _non_bool_int(
        body["interactionCountAtRequest"], "interactionCountAtRequest", maximum=cfg.MAX_WIRE_INT
    )
    interaction_rows, snapshot_rows = _validate_behavioral_rows(body["behavioralRows"])
    _validate_generator_expectation(body["generator"], config)

    try:
        render_request = RenderRequest(
            wardrobe=wardrobe,
            forced_item_id=forced_item_id,
            occasion=occasion,
            weather=weather,
            session_id=session_id,
            wardrobe_version=wardrobe_version,
            generation_index=generation_index,
            k=DEFAULT_K,
            n_surfaced=N_SURFACED,
            date=seed_date,
            intent=intent,
            interaction_count=interaction_count,
            locked_item_ids=locked_item_ids,
            disliked_item_ids=disliked_item_ids,
        )
    except (TypeError, ValueError) as exc:
        # RenderRequest guard raises are inside the pre-validation boundary (§D).
        raise ContractInvalid(f"request failed engine validation: {exc}") from exc

    return _ParsedRender(
        render_request=render_request,
        snapshot_id=snapshot_id,
        request_id=request_id,
        parent_snapshot_id=parent_snapshot_id,
        weather_raw=weather_raw,
        location=location,
        interaction_rows=interaction_rows,
        snapshot_rows=snapshot_rows,
    )


# ---------------------------------------------------------------------------
# The service
# ---------------------------------------------------------------------------


def _default_generator_factory(config: ServiceConfig) -> Generator:
    return OpenAIGenerator(
        model=cfg.GENERATOR_MODEL,
        temperature=cfg.GENERATOR_TEMPERATURE,
        api_key=config.openai_api_key,
        max_completion_tokens=config.max_completion_tokens,
        reasoning_effort=cfg.GENERATOR_REASONING_EFFORT,
        response_format=cfg.GENERATOR_RESPONSE_FORMAT,
        prompt_cache_retention=cfg.GENERATOR_PROMPT_CACHE_RETENTION,
        timeout_seconds=cfg.OPENAI_TIMEOUT_SECONDS,
        max_retries=cfg.OPENAI_MAX_RETRIES,
    )


class FittedService:
    """Route handlers, exposed sans-transport so tests can also drive them directly."""

    def __init__(
        self,
        env: Mapping[str, str],
        *,
        generator_factory: Optional[Callable[[ServiceConfig], Generator]] = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._config, self._config_reason = load_service_config(env)
        self._generator_factory = generator_factory or _default_generator_factory
        self._bucket = _TokenBucket(cfg.RATE_LIMIT_BURST, cfg.RATE_LIMIT_REFILL_PER_SECOND, clock)

    # -- readyz (G9 — zero OpenAI spend, no auth key, never a secret value) ---------

    def handle_readyz(self) -> tuple[int, dict]:
        if self._config is None:
            return 503, {"ready": False, "reason": self._config_reason}
        try:
            import fitted_core  # the module graph loads (check 1)
            from fitted_core import PROMPT_VERSION, RANKER_CONFIG_VERSION, __version__
            from fitted_core.config import DAILY_MAX_CANDIDATES
            from fitted_core.reducers import REDUCER_CONFIG_VERSION

            assert fitted_core is not None
            versions = {
                "fittedCoreVersion": __version__,
                "promptVersion": PROMPT_VERSION,
                "rankerConfigVersion": RANKER_CONFIG_VERSION,
                "reducerConfigVersion": REDUCER_CONFIG_VERSION,
            }
            if not all(isinstance(v, str) and v for v in versions.values()):
                return 503, {"ready": False, "reason": "a version constant did not resolve"}
            if not (isinstance(DAILY_MAX_CANDIDATES, int) and DAILY_MAX_CANDIDATES > 0):
                return 503, {"ready": False, "reason": "DAILY_MAX_CANDIDATES did not resolve"}
        except Exception:
            return 503, {"ready": False, "reason": "fitted_core failed to load"}
        if cfg.GENERATOR_MODEL not in cfg.GENERATOR_MODEL_ALLOWLIST:
            return 503, {"ready": False, "reason": "generator model is not in its allowlist"}
        return 200, {"ready": True, "versions": versions}

    # -- render ----------------------------------------------------------------------

    def authorize(self, headers: Mapping[str, str]) -> Optional[tuple[int, dict]]:
        if self._config is None:
            return 500, _envelope("internal", "service is not configured")
        provided = headers.get(AUTH_HEADER)
        if provided is None:
            return 401, _envelope("auth", "missing X-Fitted-Service-Key")
        keys = [self._config.service_key_current]
        if self._config.service_key_next is not None:
            keys.append(self._config.service_key_next)
        for key in keys:
            if hmac.compare_digest(provided.encode("utf-8"), key.encode("utf-8")):
                return None
        return 401, _envelope("auth", "invalid X-Fitted-Service-Key")

    def throttle(self) -> Optional[tuple[int, dict]]:
        if not self._bucket.try_acquire():
            return 429, _envelope("rate_limit", "render rate ceiling exceeded — retry later")
        return None

    def handle_render(self, body: bytes) -> tuple[int, dict]:
        if self._config is None:  # authorize() gates this on the ASGI path; guard direct callers
            return 500, _envelope("internal", "service is not configured")
        if len(body) > cfg.MAX_REQUEST_BODY_BYTES:
            return 400, _envelope(
                "contract_invalid", f"request body exceeds {cfg.MAX_REQUEST_BODY_BYTES} bytes"
            )
        try:
            try:
                parsed_json = json.loads(
                    body,
                    object_pairs_hook=_reject_duplicate_json_keys,
                    parse_constant=_reject_non_finite_json_constant,
                )
            except (ValueError, RecursionError) as exc:
                raise ContractInvalid("request body is not valid JSON") from exc
            _json_depth_guard(parsed_json, cfg.MAX_JSON_NESTING_DEPTH)
            if not isinstance(parsed_json, dict):
                raise ContractInvalid("request body must be a JSON object")
            parsed = _parse_render_body(parsed_json, self._config)
        except ContractInvalid as exc:
            return 400, _envelope("contract_invalid", str(exc))

        request = parsed.render_request

        # cache key + provenance are pure functions of the validated request + the service's
        # own config — they compute FIRST so the §D degenerate arm below always has the full
        # §G.1 identity set (a failure row without request_id/cache_key escapes the §C.4
        # index / loses lineage). Everything after this point that can throw is guarded.
        cache_key = candidate_cache_key(
            session_id=request.session_id,
            wardrobe_version=request.wardrobe_version,
            occasion=request.occasion,
            weather=request.weather,
            intent=request.intent,
            forced_item_id=request.forced_item_id,
            seed_date=request.date,
        )
        provenance = dict(
            candidate_cache_key=cache_key,
            request_id=parsed.request_id,
            parent_snapshot_id=parsed.parent_snapshot_id,
            weather_raw=parsed.weather_raw,
            location=parsed.location,
            constraints={},
            generator_provider=cfg.GENERATOR_PROVIDER,
            generator_model=cfg.GENERATOR_MODEL,
            generator_temperature=cfg.GENERATOR_TEMPERATURE,
            generator_max_completion_tokens=self._config.max_completion_tokens,
            generator_api_surface=cfg.GENERATOR_API_SURFACE,
            generator_response_format=cfg.GENERATOR_RESPONSE_FORMAT,
            generator_reasoning_effort=cfg.GENERATOR_REASONING_EFFORT,
            generator_store_mode=cfg.GENERATOR_STORE_MODE,
            generator_prompt_cache_retention=cfg.GENERATOR_PROMPT_CACHE_RETENTION,
            generator_timeout_seconds=cfg.OPENAI_TIMEOUT_SECONDS,
            generator_max_retries=cfg.OPENAI_MAX_RETRIES,
        )

        generator: Optional[_CountingGenerator] = None
        try:
            # The reducers, scorer, and generator construction are INSIDE the guard (§D
            # "constructable at every internal failure point"): a bug in any of them on a
            # valid request is an internal engine failure the corpus must record, never a
            # bare 500 with no Next-writable row.
            signals = reduce_behavioral_signals(parsed.interaction_rows, parsed.snapshot_rows)
            scorer = AffinitySignalScorer(signals.item_affinity)
            generator = _CountingGenerator(self._generator_factory(self._config))
            trace = render_with_trace(
                request, generator, signal_scorer=scorer, behavioral_signals=signals
            )
        except Exception:
            # An internal engine failure on a VALID request (§D): degrade to a schema-valid
            # payload with EMPTY attempts + diagnostics.engineFailure — never a 500 that
            # drops the failure corpus, never a fabricated attempt. The stage split rides
            # the call counter (a mid-trace generator exception loses the trace's attempt
            # raw text — including a COMPLETED first attempt when the repair call raises —
            # the known §D micro-gap — but is still recorded via engineFailure).
            calls = generator.calls if generator is not None else 0
            failure = EngineFailure(
                stage="pre_generation" if calls == 0 else "unknown",
                code="internal_exception",
            )
            payload = build_degenerate_payload(
                request, failure, generator_calls=calls, **provenance
            )
            return 200, {
                "payload": to_wire(dataclasses.asdict(payload)),
                "shown": [],
                "flags": _flags(reason_hint=_ENGINE_FAILURE_HINT),
                "degenerate": True,
            }

        try:
            payload = build_snapshot_payload(
                trace, request, **provenance,
                generator_finish_status=abnormal_finish_status(trace),
            )
            shown = _shown_entries(payload, trace)
            wire_payload = to_wire(dataclasses.asdict(payload))
        except Exception:
            # §D "constructable at EVERY internal failure point" — a payload/zip/serde bug
            # AFTER generation is still an internal engine failure on a valid request: the
            # money was spent, so a bare 500 here would drop the row the failure corpus
            # exists for. Degrade with stage="assemble", salvaging the trace's real attempts
            # (raw text + finish status) and honest parse/spend diagnostics.
            failure = EngineFailure(stage="assemble", code="internal_exception")
            try:
                degenerate_payload = build_degenerate_payload(
                    request, failure, trace=trace, **provenance
                )
            except Exception:
                # The salvage builder itself died on this trace — fall back to the
                # trace-free record (honest spend count) rather than losing the row.
                degenerate_payload = build_degenerate_payload(
                    request, failure, generator_calls=generator.calls, **provenance
                )
            try:
                wire_payload = to_wire(dataclasses.asdict(degenerate_payload))
            except Exception:
                # A salvaged piece (attempts / itemSnapshots / trace diagnostics) itself
                # refuses to serialize — rebuild the trace-free degenerate payload (honest
                # spend count, no salvage) rather than dying on the salvage (last resort
                # before the ASGI 500).
                stripped = build_degenerate_payload(
                    request, failure, generator_calls=generator.calls, **provenance
                )
                wire_payload = to_wire(dataclasses.asdict(stripped))
            return 200, {
                "payload": wire_payload,
                "shown": [],
                "flags": _flags(reason_hint=_ENGINE_FAILURE_HINT),
                "degenerate": True,
            }
        # Degenerate = money spent with nothing surfaced (§A.6/§D: parse-fail-after-repair,
        # refusal, cap-truncation, empty valid set). A pre-GPT not_enough_items exit has no
        # attempts and is a VALID empty render, not degenerate.
        degenerate = bool(payload.generation_attempts) and payload.n_surfaced == 0
        result = trace.result
        return 200, {
            "payload": wire_payload,
            "shown": shown,
            "flags": _flags(
                not_enough_items=result.not_enough_items,
                insufficient_after_generation=result.insufficient_after_generation,
                spread_collapsed=result.spread_collapsed,
                reason_hint=result.reason_hint,
            ),
            "degenerate": degenerate,
        }


def _shown_entries(payload: GenerationSnapshotPayload, trace: RenderTrace) -> list[dict]:
    """The §A shown-identity zip: bind each surfaced variant to its payload candidate by
    ``full_signature`` (unique per pass — M2 dedup), 1:1 and total; NEVER by array index
    (funnel/source_index order differs from select_spread order whenever ranking reorders).
    """
    by_signature: dict[str, str] = {}
    for candidate in payload.candidates:
        if candidate.full_signature is None:
            continue
        if candidate.full_signature in by_signature:
            raise RuntimeError("duplicate full_signature in payload candidates — zip unsafe")
        by_signature[candidate.full_signature] = candidate.candidate_id
    entries: list[dict] = []
    for variant in trace.result.variants:
        candidate_id = by_signature.get(variant.full_signature)
        if candidate_id is None:
            raise RuntimeError("surfaced variant has no payload candidate — zip not total")
        entries.append({"candidateId": candidate_id, "outfit": variant_to_wire(variant)})
    if [entry["candidateId"] for entry in entries] != list(payload.shown_candidate_ids):
        raise RuntimeError("shown zip does not match payload.shownCandidateIds order")
    return entries


# ---------------------------------------------------------------------------
# Minimal ASGI layer
# ---------------------------------------------------------------------------


async def _read_body_capped(receive) -> Optional[bytes]:
    """Accumulate the request body; ``None`` signals the cap was crossed (stop reading)."""
    chunks: list[bytes] = []
    total = 0
    while True:
        message = await receive()
        if message["type"] != "http.request":  # http.disconnect
            return b"".join(chunks)
        chunk = message.get("body", b"")
        total += len(chunk)
        if total > cfg.MAX_REQUEST_BODY_BYTES:
            return None
        chunks.append(chunk)
        if not message.get("more_body", False):
            return b"".join(chunks)


async def _send_json(send, status: int, body: dict) -> None:
    raw = json.dumps(body).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(raw)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": raw})


def create_app(
    env: Optional[Mapping[str, str]] = None,
    *,
    generator_factory: Optional[Callable[[ServiceConfig], Generator]] = None,
    clock: Callable[[], float] = time.monotonic,
):
    """Build the ASGI app. ``env`` defaults to the process environment; tests inject a fake
    env + a fake ``Generator`` factory + a fake clock (no network, no OpenAI, no sleeps)."""
    import os

    service = FittedService(
        os.environ if env is None else env,
        generator_factory=generator_factory,
        clock=clock,
    )

    async def app(scope, receive, send) -> None:
        if scope["type"] == "lifespan":
            while True:
                message = await receive()
                if message["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                elif message["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"})
                    return
            return
        if scope["type"] != "http":
            raise RuntimeError(f"unsupported ASGI scope type {scope['type']!r}")

        method = scope["method"]
        path = scope["path"]
        try:
            if method == "GET" and path == "/readyz":
                status, body = service.handle_readyz()
            elif method == "POST" and path == "/render":
                headers = {
                    key.decode("latin-1").lower(): value.decode("latin-1")
                    for key, value in scope.get("headers", [])
                }
                # Auth precedes everything — including the body read (auth-before-spend, §A).
                rejected = service.authorize(headers)
                if rejected is None:
                    rejected = service.throttle()
                if rejected is not None:
                    status, body = rejected
                else:
                    raw = await _read_body_capped(receive)
                    if raw is None:
                        status, body = 400, _envelope(
                            "contract_invalid",
                            f"request body exceeds {cfg.MAX_REQUEST_BODY_BYTES} bytes",
                        )
                    else:
                        status, body = service.handle_render(raw)
            else:
                status, body = 404, _envelope("contract_invalid", "unknown route")
        except Exception:
            # The last-resort 500 for an uncaught service crash (§A error envelope).
            status, body = 500, _envelope("internal", "internal service error")
        await _send_json(send, status, body)

    app.service = service  # test seam: reach the handlers without the transport
    return app


app = create_app()
