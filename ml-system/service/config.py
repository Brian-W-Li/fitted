"""Service-owned config + the §A/G7 boundary constants (m5-cutover.md §A/§A.6, C3).

One home for every service-side constant (mirrored Next-side at C5). Two classes of value:

  - **Generator config is service-owned** (§A): the service generates with THESE values and
    authors the payload's ``generator`` provenance from them; the wire ``generator`` object is
    a cross-checked *expectation*, exact-match-validated and never obeyed (a mismatch is
    ``contract_invalid``, never clamped — clamping IS client control).
  - **Input clamps run before generation** (G7): concrete numbers, boundary-tested
    (exactly-at-limit passes, limit+1 rejects). Relying on Mongoose failures after the GPT
    call is spend leakage; text fields are REJECTED when over-length, never truncated (a
    truncated occasion would be a corrupt Lens).

Values are defaults, tuned at C3/C5; the load-bearing part is that they are concrete and
tested at the boundary, not adjectives.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Mapping, Optional

from fitted_core.generation import (
    PROMPT_CACHE_RETENTION_IN_MEMORY,
    RESPONSE_FORMAT_JSON_OBJECT,
    RESPONSE_FORMAT_JSON_SCHEMA_STRICT,
)

# Re-export (single home: fitted_core/snapshot.py) so the cross-runtime clamp mirror can pin the
# TS model's hand copy (GenerationSnapshot.ts maxlength) to the live Python value via contract.py.
from fitted_core.snapshot import ENGINE_FAILURE_MESSAGE_MAX_CHARS as ENGINE_FAILURE_MESSAGE_MAX_CHARS

# Re-export (single home: fitted_core/models.py) — the wire boundary's warmth accept-predicate
# and the cross-runtime clamp mirror both read these, pinning the TS copies (lib/warmth.ts).
from fitted_core.models import WARMTH_MAX as WARMTH_MAX, WARMTH_MIN as WARMTH_MIN

# --- Generator config (§A.6 / D6 — service-owned, never wire-controlled) ---------------
GENERATOR_PROVIDER = "openai"
GENERATOR_MODEL_ALLOWLIST = frozenset({"gpt-5.4-mini"})
GENERATOR_MODEL = "gpt-5.4-mini"
GENERATOR_TEMPERATURE = 0.5
GENERATOR_API_SURFACE = "chat_completions"
GENERATOR_RESPONSE_FORMAT = RESPONSE_FORMAT_JSON_SCHEMA_STRICT
GENERATOR_REASONING_EFFORT = "none"  # gpt-5.4-mini's accepted lowest (§A.6 point 2)
GENERATOR_STORE_MODE = "none"  # G14 — distillation/evals storage disabled; Mongo is the corpus
GENERATOR_PROMPT_CACHE_RETENTION = PROMPT_CACHE_RETENTION_IN_MEMORY
OPENAI_TIMEOUT_SECONDS = 30.0
OPENAI_MAX_RETRIES = 0

GENERATOR_API_SURFACES = frozenset({"chat_completions"})
GENERATOR_RESPONSE_FORMATS = frozenset({RESPONSE_FORMAT_JSON_SCHEMA_STRICT, RESPONSE_FORMAT_JSON_OBJECT})
GENERATOR_REASONING_EFFORTS = frozenset({"none"})
GENERATOR_STORE_MODES = frozenset({"none"})
# M5's privacy posture is explicit in-memory prompt caching only. Extended 24h cache
# retention would be a future, versioned corpus/provenance decision, not a deploy-time
# config option.
GENERATOR_PROMPT_CACHE_RETENTIONS = frozenset({PROMPT_CACHE_RETENTION_IN_MEMORY})

# Ask-sized output cap (§A.6 point 3 — NEVER a flat 900 against a 40-outfit ask): sized to
# hold the DAILY_MAX_CANDIDATES=12 ask at ~130–170 output tokens/outfit + headroom.
# VALIDATED at the DAILY capped worst case (TOKCAP-1 discharge, 2026-07-20, live Fly service):
# a 16-item closet forced the full daily candidateRequested=12 ask under this exact 2200 cap and
# the model returned 12/12 outfits, finish_reason "stop", one attempt, clean strict-JSON
# parse (the sibling root render: 11/12, also "stop") — snapshot-verified via the
# diagnostics/generator fields before erasure. Re-check driver: fitted/scripts/
# track2-gauntlet.mjs persona `tokcap-full-ask` — re-run it after any prompt/schema change
# that lengthens per-outfit output. SCOPE: this discharged the DAILY worst case only. The
# RESCUE ask is NOT bounded by the daily-12 cap — `_rescue_candidate_requested` clamps to
# [MIN_RESCUE_CANDIDATES=6, MAX_CANDIDATES=40], so a high-yield rescue can out-ask 12 and
# risk truncation at 2200; that half of the pre-C5 empirical gate (m5-cutover.md) was never
# re-run live and is a graded residual (TOKCAP-2, runbook §8). It degrades gracefully — a
# truncated rescue is a parse-fail → one repair → "couldn't find enough" fallback, never a
# 500 or a corpus lie. Env-overridable so a tune needs no deploy — but only up
# to the hard ceiling below: a fat-fingered Fly secret must not silently remove the
# per-request spend envelope while /readyz stays green.
DEFAULT_MAX_COMPLETION_TOKENS = 2200
# Hard upper bound on the env override — well above any sane ask (even the engine-wide
# MAX_CANDIDATES=40 at ~170 tok/outfit ≈ 6,800 + headroom), far below "effectively uncapped".
MAX_COMPLETION_TOKENS_CEILING = 10_000
# Readiness floor — the other half of the bounds pair: a tiny-but-positive cap (1, 100)
# would keep /readyz green while every real render truncates to a degenerate row
# (ready-but-unusable). 2200 is the TOKCAP-1-validated value (holds the full 12-outfit DAILY
# worst case — see DEFAULT above; the rescue worst case is un-revalidated, TOKCAP-2); lower it
# only with measured evidence a smaller cap holds the worst-case daily ask.
# Invariant: FLOOR <= DEFAULT <= CEILING (tested).
MIN_COMPLETION_TOKENS_FLOOR = 2200

# --- §A/G7 input clamps (pre-spend; each gets an at-limit + limit+1 boundary test) ------
MAX_OCCASION_CHARS = 200
MAX_WEATHER_RAW_CHARS = 120
MAX_LOCATION_CHARS = 120
MAX_WARDROBE_ITEMS = 2000  # bounds the REQUEST; the engine still per-type-caps to 135
MAX_REQUEST_BODY_BYTES = 1_048_576  # 1 MiB, enforced at the ASGI layer
MAX_CONTROL_IDS = 50  # each of controls.lockedItemIds / dislikedItemIds
MAX_PER_ITEM_FEEDBACK = 20  # C6 feedback route (homed here, mirrored Next-side)
FEEDBACK_REASON_RAW_TEXT_MAX_CHARS = 500  # C6 (already §I)
MAX_JSON_NESTING_DEPTH = 512  # hostile-but-parseable depth → contract_invalid pre-walk

# Service-side additions in the same G7 spirit — every body-controlled string that reaches
# the GPT prompt (item names/tags/attrs ride _serialize_pool_item verbatim) or a key/seed
# is length-clamped pre-spend; the 1 MiB body cap alone would admit a prompt-inflating item.
MAX_SESSION_ID_CHARS = 128
MAX_ID_CHARS = 64  # wardrobe/forced/lock ids + requestId (§C.4 pins ≤ 64)
MAX_ITEM_NAME_CHARS = 200
MAX_ITEM_TAG_CHARS = 60
MAX_ITEM_TAGS = 25  # per tag field (styleTags / colorTags / occasionTags)
MAX_ITEM_ATTR_CHARS = 60  # material / formality
MAX_IMAGE_URL_CHARS = 2048  # never reaches the prompt (H33) but is stored engineVisible
# Upper bound for non-negative integer wire fields (generationIndex/wardrobeVersion/
# interactionCountAtRequest). A 400-digit JSON int is otherwise accepted and framed into the seed;
# int32-max is far above any real value and stays within JS Number.MAX_SAFE_INTEGER.
MAX_WIRE_INT = 2_147_483_647

# --- Rate ceiling (§A) — per-instance token bucket; the fly.toml single-machine pin makes
# it the global bound; the monthly OpenAI project cap is the hard backstop regardless.
RATE_LIMIT_BURST = 5
RATE_LIMIT_REFILL_PER_SECOND = 0.2  # 12 renders/minute sustained

# --- Closed request vocabularies (§A / §D) ---------------------------------------------
SUPPORTED_INTENTS = frozenset({"daily", "rescue_item"})  # the implemented M5 set
WEATHER_BUCKETS = frozenset({"hot", "mild", "cold", "indoor", "outdoor"})

# --- Env schema (G9 readyz asserts these; values NEVER logged or returned) -------------
ENV_OPENAI_API_KEY = "OPENAI_API_KEY"
ENV_SERVICE_KEY_CURRENT = "SERVICE_KEY_CURRENT"
ENV_SERVICE_KEY_NEXT = "SERVICE_KEY_NEXT"  # optional — the §A two-key rotation slot
ENV_MAX_COMPLETION_TOKENS = "M5_MAX_COMPLETION_TOKENS"  # optional int override


@dataclass(frozen=True)
class ServiceConfig:
    """The resolved runtime config — secrets + the service-owned generator params."""

    openai_api_key: str
    service_key_current: str
    service_key_next: Optional[str]
    max_completion_tokens: int


def validate_static_config() -> Optional[str]:
    """Validate code-owned generator constants that env parsing cannot protect.

    `/readyz` is the runtime gate for the full §A.6 surface. A bad constant here is a deploy
    misconfiguration, not a caller contract error; fail the service closed before render.
    """
    if GENERATOR_MODEL not in GENERATOR_MODEL_ALLOWLIST:
        return "generator model is not in its allowlist"
    if GENERATOR_API_SURFACE not in GENERATOR_API_SURFACES:
        return "GENERATOR_API_SURFACE is not sanctioned"
    if GENERATOR_RESPONSE_FORMAT not in GENERATOR_RESPONSE_FORMATS:
        return "GENERATOR_RESPONSE_FORMAT is not sanctioned"
    if GENERATOR_REASONING_EFFORT not in GENERATOR_REASONING_EFFORTS:
        return "GENERATOR_REASONING_EFFORT is not sanctioned"
    if GENERATOR_STORE_MODE not in GENERATOR_STORE_MODES:
        return "GENERATOR_STORE_MODE is not sanctioned"
    if GENERATOR_PROMPT_CACHE_RETENTION not in GENERATOR_PROMPT_CACHE_RETENTIONS:
        return "GENERATOR_PROMPT_CACHE_RETENTION is not sanctioned"
    if (
        isinstance(OPENAI_TIMEOUT_SECONDS, bool)
        or not isinstance(OPENAI_TIMEOUT_SECONDS, (int, float))
        or not math.isfinite(float(OPENAI_TIMEOUT_SECONDS))
        or float(OPENAI_TIMEOUT_SECONDS) <= 0
    ):
        return "OPENAI_TIMEOUT_SECONDS must be a finite positive number"
    if (
        isinstance(OPENAI_MAX_RETRIES, bool)
        or not isinstance(OPENAI_MAX_RETRIES, int)
        or OPENAI_MAX_RETRIES < 0
    ):
        return "OPENAI_MAX_RETRIES must be a non-negative int"
    if not (
        MIN_COMPLETION_TOKENS_FLOOR
        <= DEFAULT_MAX_COMPLETION_TOKENS
        <= MAX_COMPLETION_TOKENS_CEILING
    ):
        return "completion-token default is outside the readiness band"
    return None


def load_service_config(env: Mapping[str, str]) -> tuple[Optional[ServiceConfig], Optional[str]]:
    """Resolve + validate config from ``env`` → ``(config, None)`` or ``(None, reason)``.

    The ``reason`` names the failed check WITHOUT any secret value (G9: the readyz body
    carries presence booleans and check names only).
    """
    openai_api_key = env.get(ENV_OPENAI_API_KEY, "")
    if not openai_api_key.strip():
        return None, f"{ENV_OPENAI_API_KEY} missing"
    service_key_current = env.get(ENV_SERVICE_KEY_CURRENT, "")
    if not service_key_current.strip():
        return None, f"{ENV_SERVICE_KEY_CURRENT} missing"
    service_key_next: Optional[str] = None
    if ENV_SERVICE_KEY_NEXT in env:
        service_key_next = env[ENV_SERVICE_KEY_NEXT]
        if not service_key_next.strip():
            return None, f"{ENV_SERVICE_KEY_NEXT} set but blank"
    raw_cap = env.get(ENV_MAX_COMPLETION_TOKENS)
    if raw_cap is None:
        max_completion_tokens = DEFAULT_MAX_COMPLETION_TOKENS
    else:
        try:
            max_completion_tokens = int(raw_cap)
        except ValueError:
            return None, f"{ENV_MAX_COMPLETION_TOKENS} is not an int"
        if max_completion_tokens <= 0:
            return None, f"{ENV_MAX_COMPLETION_TOKENS} must be a positive int"
        if max_completion_tokens < MIN_COMPLETION_TOKENS_FLOOR:
            return None, (
                f"{ENV_MAX_COMPLETION_TOKENS} is below the readiness floor "
                f"{MIN_COMPLETION_TOKENS_FLOOR} — every render would truncate"
            )
        if max_completion_tokens > MAX_COMPLETION_TOKENS_CEILING:
            return None, (
                f"{ENV_MAX_COMPLETION_TOKENS} exceeds the hard ceiling "
                f"{MAX_COMPLETION_TOKENS_CEILING}"
            )
    static_reason = validate_static_config()
    if static_reason is not None:
        return None, static_reason
    return (
        ServiceConfig(
            openai_api_key=openai_api_key,
            service_key_current=service_key_current,
            service_key_next=service_key_next,
            max_completion_tokens=max_completion_tokens,
        ),
        None,
    )


def load_from_process_env() -> tuple[Optional[ServiceConfig], Optional[str]]:
    return load_service_config(os.environ)
