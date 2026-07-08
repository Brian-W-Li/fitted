"""The general GPT seam (v2 §9 Step 2 / §12; spearhead.md §B, C1).

The single place an outfit-generation backend is abstracted. ``Generator`` mirrors
``sampler.SignalScorer``'s seam style: a tiny ``Protocol`` the pipeline depends on, so
the rescue/daily/upgrade/translate flows inject a backend rather than hard-wiring one.

Two implementations matter:
  - ``OpenAIGenerator`` — the **only** module that touches ``openai`` / does network IO.
    The import is **lazy/local** to ``generate`` so ``fitted_core`` imports cleanly with
    the dependency absent (spearhead.md §B/§J): the pytest suite never installs ``openai``.
  - ``StubGenerator`` — a canned-JSON test double, homed in ``tests/helpers.py`` (NOT here),
    so runtime code never imports from ``tests/`` (spearhead.md §B). A CLI ``--dry-run``
    fixture generator lands separately at C6.

A ``Generator`` returns **raw response text** (a JSON string). It does no parsing,
validation, or repair — those are the validator's (§13) and ``rescue()``'s job. The one
§12 JSON-repair retry is owned by ``rescue()`` (a blind re-generation), never here
(spearhead.md §B/§G step 7).

Sources: docs/Fitted_Spec_v2.md §9/§12, docs/plans/spearhead.md §B/§D/§G.
"""

from dataclasses import dataclass
from typing import Any, Optional, Protocol, Sequence, Union, runtime_checkable

from fitted_core.models import Role


@dataclass(frozen=True)
class GenerationPrompt:
    """What a ``Generator`` is handed — pure and serializable (spearhead.md §B).

    ``system``/``user`` are the two prompt halves (§D builds them at C3). ``candidate_requested``
    is the §12 **upper-bound hint** the rescue layer recomputed from the scoped pool; it is
    carried through here so the orchestrator can pass the *same* bound to
    ``validate_gpt_payload`` after generation (asking GPT for more than it can build is
    harmless — extras are sliced with a warning).
    """

    system: str
    user: str
    candidate_requested: int


# --- §A.6 generator API contract (m5-cutover.md §A.6, D6) -----------------------------

# The §12 output envelope as a strict Structured-Outputs JSON Schema: every object closes
# additionalProperties and requires all keys (the strict-mode subset), and `role` is pinned
# to the closed Role enum (derived, never re-typed — drift-proof against models.py). Strict
# mode guarantees SCHEMA adherence (no omitted key, no hallucinated enum, no extra field),
# not semantic validity — the §13 validator stays the strict boundary (itemId existence,
# template legality, changedItemIds ⊆ outfit items are all validator checks).
# `candidate_requested` ("Return up to N outfits") deliberately stays prose, NOT a maxItems
# bound: N varies per request, and a per-request schema would defeat OpenAI's compiled-schema
# caching; the validator slices extras with a warning either way.
OUTFITS_ENVELOPE_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "outfits": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "itemId": {"type": "string"},
                                "role": {
                                    "type": "string",
                                    "enum": [role.value for role in Role],
                                },
                            },
                            "required": ["itemId", "role"],
                            "additionalProperties": False,
                        },
                    },
                    "styleMove": {
                        "type": "object",
                        "properties": {
                            "moveType": {"type": "string"},
                            "changedItemIds": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                            "oneSentence": {"type": "string"},
                        },
                        "required": ["moveType", "changedItemIds", "oneSentence"],
                        "additionalProperties": False,
                    },
                },
                "required": ["items", "styleMove"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["outfits"],
    "additionalProperties": False,
}

# The two sanctioned structured-output modes (§A.6 point 1). Strict json_schema is the M5
# default; json_object is the registered fallback (weaker: syntactic JSON only). The chosen
# mode is provenance (`generator.responseFormat`) — the C3 service records it per write.
RESPONSE_FORMAT_JSON_SCHEMA_STRICT = "json_schema_strict"
RESPONSE_FORMAT_JSON_OBJECT = "json_object"
_RESPONSE_FORMATS = frozenset(
    {RESPONSE_FORMAT_JSON_SCHEMA_STRICT, RESPONSE_FORMAT_JSON_OBJECT}
)


@dataclass(frozen=True)
class FinishStatus:
    """One call's finish/refusal metadata — never discarded (m5-cutover.md §A.6 point 4).

    ``finish_reason`` is Chat Completions' ``choices[0].finish_reason`` (``"length"`` marks a
    cap-truncated run); ``refusal`` is the non-null ``message.refusal`` text on a model
    refusal. Either condition on a *valid* request is an engine failure routed to the §D
    degenerate corpus by the C3 service — a paid-but-no-JSON outcome must be visible, never a
    silent empty. Carried per attempt on ``GenerationAttemptTrace.finish_status`` and into the
    snapshot ``generator`` provenance block (C3).
    """

    finish_reason: Optional[str]
    refusal: Optional[str]


@runtime_checkable
class Generator(Protocol):
    """The replaceable generation seam (mirrors ``sampler.SignalScorer``).

    ``generate`` returns the backend's **raw** response text (expected to be the strict
    §12 JSON envelope, but unparsed/unvalidated here — the validator is the strict
    boundary). Implementations must be side-effect-free beyond the generation call itself.
    """

    def generate(self, prompt: GenerationPrompt) -> str: ...


class OpenAIGenerator:
    """Real OpenAI-backed ``Generator`` — the lone IO/dependency boundary (spearhead.md §B).

    ``import openai`` is **deliberately lazy/local** to ``generate`` so importing
    ``fitted_core`` (and running the hermetic pytest suite) never requires the package.
    A missing dependency / missing key surfaces only here, on a real call — the CLI path
    (C6), never the core or the stub suite (spearhead.md §H last row).

    ``model``/``temperature`` are the M5 cutover defaults for bounded outfit composition.
    The full API surface is pinned by m5-cutover.md §A.6 (Chat Completions):

    - **Structured output** defaults to strict ``json_schema`` over ``OUTFITS_ENVELOPE_SCHEMA``
      (schema adherence, not just syntactic JSON); ``json_object`` is the sanctioned fallback.
      The §13 validator stays the strict boundary either way.
    - **``reasoning_effort``** is sent explicitly — default ``"none"``, gpt-5.4-mini's accepted
      lowest (verified on real calls by the H26 judge, 2026-07-01): bounded composition gains
      nothing from deep reasoning, and an unset/high effort risks reasoning tokens eating the
      output cap. Pass ``None`` to omit the param entirely (non-reasoning models, e.g. a
      gpt-4o eval rerun, reject it).
    - The output cap is sent as **``max_completion_tokens``, never ``max_tokens``** (GPT-5.x
      hard-400s on the legacy name).
    - **``store: False``** always (§A.6/G14 — no OpenAI-side retention; Mongo is the sole
      corpus).
    - The run's **finish/refusal status is surfaced** on ``last_finish_status`` (a
      ``FinishStatus``), never discarded: refusal and cap-truncation are §D degenerate-corpus
      triggers the C3 service must see.
    """

    def __init__(
        self,
        *,
        model: str = "gpt-5.4-mini",
        temperature: float = 0.5,
        api_key: Optional[str] = None,
        max_completion_tokens: Optional[int] = None,
        reasoning_effort: Optional[str] = "none",
        response_format: str = RESPONSE_FORMAT_JSON_SCHEMA_STRICT,
    ) -> None:
        if response_format not in _RESPONSE_FORMATS:
            raise ValueError(
                f"response_format must be one of {sorted(_RESPONSE_FORMATS)}, "
                f"got {response_format!r}"
            )
        self._model = model
        self._temperature = temperature
        self._api_key = api_key
        self._max_completion_tokens = max_completion_tokens
        self._reasoning_effort = reasoning_effort
        self._response_format = response_format
        # C6-eval telemetry only (observational): the token usage of the most recent call,
        # or None before any call / when the API omits it. Product code (`rescue()`) never
        # reads this; the eval harness's RecordingGenerator does, to report tokens/$ (§E).
        self.last_usage: Optional[dict] = None
        # §A.6 point 4: the most recent call's finish/refusal metadata, or None before any
        # call. The traced orchestrator (`_generate_and_parse_with_trace`) reads this after
        # each generate() so every GenerationAttemptTrace carries its finish status.
        self.last_finish_status: Optional[FinishStatus] = None

    def _response_format_param(self) -> dict[str, object]:
        if self._response_format == RESPONSE_FORMAT_JSON_OBJECT:
            return {"type": "json_object"}
        return {
            "type": "json_schema",
            "json_schema": {
                "name": "outfit_envelope",
                "strict": True,
                "schema": OUTFITS_ENVELOPE_SCHEMA,
            },
        }

    @staticmethod
    def _usage_dict(usage: Any) -> Optional[dict]:
        """Best-effort usage telemetry; never let reporting fields break generation."""
        if usage is None:
            return None
        values = {
            key: usage.get(key) if isinstance(usage, dict) else getattr(usage, key, None)
            for key in ("prompt_tokens", "completion_tokens", "total_tokens")
        }
        if any(value is None for value in values.values()):
            return None
        return values

    def generate(self, prompt: GenerationPrompt) -> str:
        # Cleared before anything can raise: on a reused generator, an SDK/import error
        # must never leave the *previous* call's usage/finish status observable — C3 reads
        # `last_finish_status` per attempt for §D degenerate-corpus routing, so a stale
        # value would misclassify the failed attempt with the prior call's provenance.
        self.last_usage = None
        self.last_finish_status = None
        # Lazy/local import (spearhead.md §B): fitted_core + the stub suite import with
        # `openai` absent; only a real generation call needs the dependency + a key.
        from openai import OpenAI

        client = OpenAI(api_key=self._api_key) if self._api_key else OpenAI()
        kwargs: dict[str, object] = {
            "model": self._model,
            "temperature": self._temperature,
            "response_format": self._response_format_param(),
            "store": False,
            "messages": [
                {"role": "system", "content": prompt.system},
                {"role": "user", "content": prompt.user},
            ],
        }
        if self._reasoning_effort is not None:
            kwargs["reasoning_effort"] = self._reasoning_effort
        if self._max_completion_tokens is not None:
            kwargs["max_completion_tokens"] = self._max_completion_tokens
        response = client.chat.completions.create(**kwargs)
        # Capture usage for the C6 cost report (observational; does not alter the return).
        self.last_usage = self._usage_dict(getattr(response, "usage", None))
        # §A.6 point 4: surface finish/refusal instead of discarding it. A refusal leaves
        # content None → "" is returned (parse-fails downstream), but the status is what
        # lets the C3 service route the run to the §D degenerate corpus with provenance.
        choices = getattr(response, "choices", None) or []
        choice = choices[0] if choices else None
        message = getattr(choice, "message", None)
        self.last_finish_status = FinishStatus(
            finish_reason=getattr(choice, "finish_reason", None),
            refusal=getattr(message, "refusal", None),
        )
        return getattr(message, "content", None) or ""


class ReplayGenerator:
    """A non-test fixture ``Generator`` that replays canned raw responses (spearhead.md §B).

    The §B "small non-test fixture generator in cli.py or generation.py": runtime code (the
    CLI ``--dry-run`` path and the C6 eval harness's stage re-derivation) needs a canned
    ``Generator`` without importing the test-only ``StubGenerator``. It returns each response
    in order and **repeats the last once exhausted** — so the ``rescue()`` repair retry (a
    second ``generate`` call) replays the second canned response, exactly like the recorded
    output it stands in for.

    A single ``str`` is treated as a one-element sequence (returned on every call). Unlike the
    test ``StubGenerator`` it records no prompts — it is a plain fixture, not an assertion
    surface. ``call_count`` is exposed only so the harness can tell whether a repair fired.
    """

    def __init__(self, responses: Union[str, Sequence[str]]) -> None:
        items = [responses] if isinstance(responses, str) else list(responses)
        if not items:
            raise ValueError("ReplayGenerator needs at least one response")
        self._responses = items
        self.call_count = 0

    def generate(self, prompt: GenerationPrompt) -> str:
        idx = min(self.call_count, len(self._responses) - 1)
        self.call_count += 1
        return self._responses[idx]
