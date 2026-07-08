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

import os
from dataclasses import dataclass
from typing import Mapping, Optional

from fitted_core.generation import RESPONSE_FORMAT_JSON_SCHEMA_STRICT

# --- Generator config (§A.6 / D6 — service-owned, never wire-controlled) ---------------
GENERATOR_PROVIDER = "openai"
GENERATOR_MODEL_ALLOWLIST = frozenset({"gpt-5.4-mini"})
GENERATOR_MODEL = "gpt-5.4-mini"
GENERATOR_TEMPERATURE = 0.5
GENERATOR_API_SURFACE = "chat_completions"
GENERATOR_RESPONSE_FORMAT = RESPONSE_FORMAT_JSON_SCHEMA_STRICT
GENERATOR_REASONING_EFFORT = "none"  # gpt-5.4-mini's accepted lowest (§A.6 point 2)
GENERATOR_STORE_MODE = "none"  # G14 — no OpenAI-side retention; Mongo is the sole corpus

# Ask-sized output cap (§A.6 point 3 — NEVER a flat 900 against a 40-outfit ask): sized to
# hold the DAILY_MAX_CANDIDATES=12 ask at ~130–170 output tokens/outfit + headroom. The
# (cap, ask-ceiling) pair MUST be validated together on real gpt-5.4-mini before C5 (the
# pre-C5 empirical gate) — H40's mechanical read ran uncapped, so its numbers do not extend
# to any cap value. Env-overridable so the gate can raise it without a deploy — but only up
# to the hard ceiling below: a fat-fingered Fly secret must not silently remove the
# per-request spend envelope while /readyz stays green.
DEFAULT_MAX_COMPLETION_TOKENS = 2200
# Hard upper bound on the env override — well above any sane ask (even the engine-wide
# MAX_CANDIDATES=40 at ~170 tok/outfit ≈ 6,800 + headroom), far below "effectively uncapped".
MAX_COMPLETION_TOKENS_CEILING = 10_000
# Readiness floor — the other half of the bounds pair: a tiny-but-positive cap (1, 100)
# would keep /readyz green while every real render truncates to a degenerate row
# (ready-but-unusable). Pinned to the ask-sized default until the pre-C5 empirical gate
# re-tunes both together; the gate may lower it only with measured evidence a smaller cap
# holds the worst-case daily/rescue ask. Invariant: FLOOR <= DEFAULT <= CEILING (tested).
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
