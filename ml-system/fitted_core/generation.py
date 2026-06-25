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
from typing import Optional, Protocol, Sequence, Union, runtime_checkable


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

    ``model``/``temperature`` are provisional believability levers tuned in the C6 eval
    (spearhead.md §E A/B sweep); a higher temperature widens the "range of vibes" the
    prompt asks for. ``response_format=json_object`` matches the §12 strict-JSON contract.
    """

    def __init__(
        self,
        *,
        model: str = "gpt-4o",
        temperature: float = 0.8,
        api_key: Optional[str] = None,
        max_tokens: Optional[int] = None,
    ) -> None:
        self._model = model
        self._temperature = temperature
        self._api_key = api_key
        self._max_tokens = max_tokens
        # C6-eval telemetry only (observational): the token usage of the most recent call,
        # or None before any call / when the API omits it. Product code (`rescue()`) never
        # reads this; the eval harness's RecordingGenerator does, to report tokens/$ (§E).
        self.last_usage: Optional[dict] = None

    def generate(self, prompt: GenerationPrompt) -> str:
        # Lazy/local import (spearhead.md §B): fitted_core + the stub suite import with
        # `openai` absent; only a real generation call needs the dependency + a key.
        from openai import OpenAI

        client = OpenAI(api_key=self._api_key) if self._api_key else OpenAI()
        kwargs: dict[str, object] = {
            "model": self._model,
            "temperature": self._temperature,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": prompt.system},
                {"role": "user", "content": prompt.user},
            ],
        }
        if self._max_tokens is not None:
            kwargs["max_tokens"] = self._max_tokens
        response = client.chat.completions.create(**kwargs)
        # Capture usage for the C6 cost report (observational; does not alter the return).
        usage = getattr(response, "usage", None)
        self.last_usage = (
            {
                "prompt_tokens": usage.prompt_tokens,
                "completion_tokens": usage.completion_tokens,
                "total_tokens": usage.total_tokens,
            }
            if usage is not None
            else None
        )
        return response.choices[0].message.content or ""


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
