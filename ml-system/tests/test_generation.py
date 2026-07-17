"""C1 tests — the GPT seam (spearhead.md §C C1 gate).

Gate: the stub returns canned JSON; ``fitted_core`` imports with ``openai`` absent (the
import is lazy/local to ``OpenAIGenerator.generate``); the ``Generator`` protocol is
satisfied by both implementations. No live OpenAI calls (spearhead.md §A/§I).
"""

import dataclasses
import sys
import types

import pytest

from fitted_core.generation import (
    DEFAULT_OPENAI_MAX_RETRIES,
    DEFAULT_OPENAI_TIMEOUT_SECONDS,
    OUTFITS_ENVELOPE_SCHEMA,
    PROMPT_CACHE_RETENTION_IN_MEMORY,
    RESPONSE_FORMAT_JSON_OBJECT,
    RESPONSE_FORMAT_JSON_SCHEMA_STRICT,
    FinishStatus,
    GenerationPrompt,
    Generator,
    OpenAIGenerator,
)
from fitted_core.models import Role
from tests.helpers import StubGenerator


def _prompt() -> GenerationPrompt:
    return GenerationPrompt(system="s", user="u", candidate_requested=6)


# --- StubGenerator (the hermetic test double) ---


def test_stub_returns_canned_json_every_call():
    canned = '{"outfits": []}'
    stub = StubGenerator(canned)
    assert stub.generate(_prompt()) == canned
    assert stub.generate(_prompt()) == canned  # pure: same output every call
    assert stub.call_count == 2


def test_stub_sequence_is_stateful_invalid_then_valid():
    # The §G-step-7 repair path's canned invalid-then-valid pair: call-count stateful by
    # design (spearhead.md §J), used only in its own repair test (C4), never determinism.
    invalid, valid = "not json", '{"outfits": []}'
    stub = StubGenerator([invalid, valid])
    assert stub.generate(_prompt()) == invalid
    assert stub.generate(_prompt()) == valid
    assert stub.generate(_prompt()) == valid  # repeats the last once exhausted
    assert stub.call_count == 3


def test_stub_rejects_empty_sequence():
    with pytest.raises(ValueError):
        StubGenerator([])


# --- Generator protocol ---


def test_stub_and_openai_satisfy_generator_protocol():
    assert isinstance(StubGenerator("{}"), Generator)
    assert isinstance(OpenAIGenerator(model="gpt-5.4-mini", temperature=0.5), Generator)


# --- GenerationPrompt contract ---


def test_generation_prompt_is_frozen_and_carries_fields():
    p = GenerationPrompt(system="sys", user="usr", candidate_requested=12)
    assert (p.system, p.user, p.candidate_requested) == ("sys", "usr", 12)
    with pytest.raises(dataclasses.FrozenInstanceError):
        p.system = "mutated"  # type: ignore[misc]


# --- Lazy-dependency contract (the hermetic-import guarantee) ---


def test_openai_import_is_lazy_no_module_level_binding():
    # fitted_core must import with `openai` absent: the dependency is imported *locally*
    # inside generate(), so generation.py has no module-level `openai` symbol. This is
    # environment-independent (holds whether or not openai happens to be installed).
    import fitted_core.generation as gen

    assert not hasattr(gen, "openai")


def test_constructing_openai_generator_does_not_require_openai():
    # Construction touches no IO and no dependency — only a real generate() call does.
    g = OpenAIGenerator(model="gpt-5.4-mini", temperature=0.5, max_completion_tokens=512)
    assert isinstance(g, OpenAIGenerator)


def _install_fake_openai(
    monkeypatch,
    captured: dict,
    *,
    content: object = '{"outfits":[]}',
    finish_reason: object = "stop",
    refusal: object = None,
):
    """A hermetic fake `openai` module recording the create() kwargs (no network, ever)."""

    class _Completions:
        def create(self, **kwargs):
            captured.update(kwargs)
            message = types.SimpleNamespace(content=content, refusal=refusal)
            choice = types.SimpleNamespace(message=message, finish_reason=finish_reason)
            usage = types.SimpleNamespace(prompt_tokens=1, completion_tokens=2, total_tokens=3)
            return types.SimpleNamespace(choices=[choice], usage=usage)

    class _Chat:
        completions = _Completions()

    class _OpenAI:
        def __init__(self, **kwargs):
            captured["client_kwargs"] = dict(kwargs)
            captured["api_key"] = kwargs.get("api_key")
            self.chat = _Chat()

    monkeypatch.setitem(sys.modules, "openai", types.SimpleNamespace(OpenAI=_OpenAI))


def test_openai_generator_sends_m5_defaults_and_max_completion_tokens(monkeypatch):
    captured: dict = {}
    _install_fake_openai(monkeypatch, captured)

    generator = OpenAIGenerator(api_key="k", max_completion_tokens=512)
    assert generator.generate(_prompt()) == '{"outfits":[]}'

    assert captured["api_key"] == "k"
    assert captured["client_kwargs"]["timeout"] == DEFAULT_OPENAI_TIMEOUT_SECONDS
    assert captured["client_kwargs"]["max_retries"] == DEFAULT_OPENAI_MAX_RETRIES
    assert captured["model"] == "gpt-5.4-mini"
    assert captured["temperature"] == 0.5
    assert captured["max_completion_tokens"] == 512
    assert "max_tokens" not in captured
    # The prompt halves land as the two-message system/user array — a swapped role or a
    # dropped system message is a silent prompt corruption no other assertion would catch.
    assert captured["messages"] == [
        {"role": "system", "content": "s"},
        {"role": "user", "content": "u"},
    ]
    assert generator.last_usage == {
        "prompt_tokens": 1,
        "completion_tokens": 2,
        "total_tokens": 3,
    }


# --- §A.6 generator API contract (m5-cutover.md §A.6 / D6) ---


def test_openai_generator_sends_a6_surface_reasoning_store_cache_and_strict_schema(monkeypatch):
    # The §A.6 mandatory surface: explicit lowest reasoning_effort ("none" — verified
    # accepted on gpt-5.4-mini by the H26 judge), store:false (no distillation/evals
    # storage), explicit prompt_cache_retention (the separate prompt-cache policy), and
    # strict json_schema Structured Outputs as the default response format.
    captured: dict = {}
    _install_fake_openai(monkeypatch, captured)

    generator = OpenAIGenerator(api_key="k")
    generator.generate(_prompt())

    assert captured["reasoning_effort"] == "none"
    assert captured["store"] is False
    assert captured["prompt_cache_retention"] == PROMPT_CACHE_RETENTION_IN_MEMORY
    assert captured["response_format"] == {
        "type": "json_schema",
        "json_schema": {
            "name": "outfit_envelope",
            "strict": True,
            "schema": OUTFITS_ENVELOPE_SCHEMA,
        },
    }


def test_openai_generator_json_object_fallback_mode(monkeypatch):
    # The sanctioned §A.6 fallback when strict mode is not wanted: bare json_object +
    # the §13 validator. Selected by config, never silently.
    captured: dict = {}
    _install_fake_openai(monkeypatch, captured)

    generator = OpenAIGenerator(api_key="k", response_format=RESPONSE_FORMAT_JSON_OBJECT)
    generator.generate(_prompt())

    assert captured["response_format"] == {"type": "json_object"}


def test_openai_generator_rejects_unknown_response_format():
    with pytest.raises(ValueError, match="response_format"):
        OpenAIGenerator(response_format="yaml")


def test_openai_generator_none_reasoning_effort_param_can_be_omitted(monkeypatch):
    # reasoning_effort=None omits the param entirely — the escape hatch for non-reasoning
    # models (e.g. a gpt-4o eval rerun rejects the param). The M5 default always sends it.
    captured: dict = {}
    _install_fake_openai(monkeypatch, captured)

    generator = OpenAIGenerator(api_key="k", reasoning_effort=None)
    generator.generate(_prompt())

    assert "reasoning_effort" not in captured


def test_openai_generator_none_prompt_cache_retention_param_can_be_omitted(monkeypatch):
    # Historical/model-specific reruns can omit the prompt-cache param explicitly; M5 default
    # sends it so provider-side cache retention never depends on org policy defaults.
    captured: dict = {}
    _install_fake_openai(monkeypatch, captured)

    generator = OpenAIGenerator(api_key="k", prompt_cache_retention=None)
    generator.generate(_prompt())

    assert "prompt_cache_retention" not in captured


def test_openai_generator_rejects_unknown_prompt_cache_retention():
    with pytest.raises(ValueError, match="prompt_cache_retention"):
        OpenAIGenerator(prompt_cache_retention="forever")


def test_openai_generator_can_omit_timeout_and_retry_overrides(monkeypatch):
    # The M5 service default is bounded, but historical/manual runs may opt back into SDK
    # defaults explicitly. The service config never does this.
    captured: dict = {}
    _install_fake_openai(monkeypatch, captured)

    generator = OpenAIGenerator(api_key="k", timeout_seconds=None, max_retries=None)
    generator.generate(_prompt())

    assert "timeout" not in captured["client_kwargs"]
    assert "max_retries" not in captured["client_kwargs"]


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"timeout_seconds": 0}, "timeout_seconds"),
        ({"timeout_seconds": float("nan")}, "timeout_seconds"),
        ({"timeout_seconds": float("inf")}, "timeout_seconds"),
        ({"timeout_seconds": True}, "timeout_seconds"),
        ({"max_retries": -1}, "max_retries"),
        ({"max_retries": 0.5}, "max_retries"),
    ],
)
def test_openai_generator_rejects_bad_timeout_retry_options(kwargs, message):
    with pytest.raises(ValueError, match=message):
        OpenAIGenerator(**kwargs)


def test_openai_generator_surfaces_finish_status_on_success(monkeypatch):
    captured: dict = {}
    _install_fake_openai(monkeypatch, captured, finish_reason="stop", refusal=None)

    generator = OpenAIGenerator(api_key="k")
    assert generator.last_finish_status is None  # no call yet
    generator.generate(_prompt())

    assert generator.last_finish_status == FinishStatus(finish_reason="stop", refusal=None)


def test_openai_generator_surfaces_refusal_instead_of_discarding_it(monkeypatch):
    # A refusal leaves message.content None: generate() returns "" (parse-fails downstream)
    # but the refusal text is surfaced — the §A.6 point-5 trigger the C3 service routes to
    # the §D degenerate corpus. Discarding it (the pre-hardening behavior) is the mutant.
    captured: dict = {}
    _install_fake_openai(
        monkeypatch, captured, content=None, finish_reason="stop", refusal="cannot comply"
    )

    generator = OpenAIGenerator(api_key="k")
    assert generator.generate(_prompt()) == ""
    assert generator.last_finish_status == FinishStatus(
        finish_reason="stop", refusal="cannot comply"
    )


def test_openai_generator_surfaces_cap_truncation_finish_reason(monkeypatch):
    # finish_reason=="length" is the cap-truncation marker (§A.6 point 5): the partial text
    # still returns (the repair path may run), but the status must be visible to the service.
    captured: dict = {}
    _install_fake_openai(
        monkeypatch, captured, content='{"outfits":[{"items"', finish_reason="length"
    )

    generator = OpenAIGenerator(api_key="k")
    assert generator.generate(_prompt()) == '{"outfits":[{"items"'
    assert generator.last_finish_status == FinishStatus(finish_reason="length", refusal=None)


def test_openai_generator_handles_empty_choices_without_crashing(monkeypatch):
    # Defensive path: an empty choices array (malformed/degenerate API response) must return
    # "" with an all-None FinishStatus — never an IndexError mid-render.
    captured: dict = {}

    class _Completions:
        def create(self, **kwargs):
            return types.SimpleNamespace(choices=[], usage=None)

    class _Chat:
        completions = _Completions()

    class _OpenAI:
        def __init__(self, **kwargs):
            self.chat = _Chat()

    monkeypatch.setitem(sys.modules, "openai", types.SimpleNamespace(OpenAI=_OpenAI))

    generator = OpenAIGenerator(api_key="k")
    assert generator.generate(_prompt()) == ""
    assert generator.last_finish_status == FinishStatus(finish_reason=None, refusal=None)
    assert generator.last_usage is None


def test_openai_generator_usage_telemetry_is_not_on_the_generation_critical_path(monkeypatch):
    # Usage is C6/eval telemetry only. If the SDK/API omits or renames a usage member,
    # a successful paid response must still return content and finish status instead of
    # raising after spend and forcing C3 into the lossy mid-generation failure arm.
    class _Completions:
        def create(self, **kwargs):
            message = types.SimpleNamespace(content='{"outfits":[]}', refusal=None)
            choice = types.SimpleNamespace(message=message, finish_reason="stop")
            usage = types.SimpleNamespace(prompt_tokens=1)  # partial telemetry
            return types.SimpleNamespace(choices=[choice], usage=usage)

    class _Chat:
        completions = _Completions()

    class _OpenAI:
        def __init__(self, **kwargs):
            self.chat = _Chat()

    monkeypatch.setitem(sys.modules, "openai", types.SimpleNamespace(OpenAI=_OpenAI))

    generator = OpenAIGenerator(api_key="k")
    assert generator.generate(_prompt()) == '{"outfits":[]}'
    assert generator.last_finish_status == FinishStatus(finish_reason="stop", refusal=None)
    assert generator.last_usage is None


def test_openai_generator_clears_stale_status_when_sdk_call_raises(monkeypatch):
    # A reused generator must never expose the *previous* call's finish/usage after a failed
    # call: C3 reads `last_finish_status` per attempt for §D degenerate-corpus routing, so a
    # transient SDK exception after an earlier "stop" would otherwise be misclassified with
    # stale provenance. generate() clears both fields before the SDK call can raise.
    calls = {"n": 0}

    class _Completions:
        def create(self, **kwargs):
            calls["n"] += 1
            if calls["n"] > 1:
                raise RuntimeError("transient SDK failure")
            message = types.SimpleNamespace(content='{"outfits":[]}', refusal=None)
            choice = types.SimpleNamespace(message=message, finish_reason="stop")
            usage = types.SimpleNamespace(prompt_tokens=1, completion_tokens=2, total_tokens=3)
            return types.SimpleNamespace(choices=[choice], usage=usage)

    class _Chat:
        completions = _Completions()

    class _OpenAI:
        def __init__(self, **kwargs):
            self.chat = _Chat()

    monkeypatch.setitem(sys.modules, "openai", types.SimpleNamespace(OpenAI=_OpenAI))

    generator = OpenAIGenerator(api_key="k")
    assert generator.generate(_prompt()) == '{"outfits":[]}'
    assert generator.last_finish_status == FinishStatus(finish_reason="stop", refusal=None)
    assert generator.last_usage is not None

    with pytest.raises(RuntimeError, match="transient SDK failure"):
        generator.generate(_prompt())
    assert generator.last_finish_status is None  # cleared, not the stale "stop"
    assert generator.last_usage is None


def _assert_strict_subschema(node: object):
    """Every object node must close additionalProperties and require ALL its keys —
    the OpenAI strict-mode subset; a violation 400s at the API, so guard it here."""
    if isinstance(node, dict):
        if node.get("type") == "object":
            assert node.get("additionalProperties") is False
            assert sorted(node.get("required", [])) == sorted(node.get("properties", {}))
        for value in node.values():
            _assert_strict_subschema(value)


def test_outfits_envelope_schema_is_strict_mode_compliant_and_role_enum_matches():
    _assert_strict_subschema(OUTFITS_ENVELOPE_SCHEMA)
    role_enum = OUTFITS_ENVELOPE_SCHEMA["properties"]["outfits"]["items"]["properties"][
        "items"
    ]["items"]["properties"]["role"]["enum"]
    assert role_enum == [role.value for role in Role]  # derived, never re-typed
    assert RESPONSE_FORMAT_JSON_SCHEMA_STRICT != RESPONSE_FORMAT_JSON_OBJECT
