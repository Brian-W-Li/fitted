"""C1 tests — the GPT seam (spearhead.md §C C1 gate).

Gate: the stub returns canned JSON; ``fitted_core`` imports with ``openai`` absent (the
import is lazy/local to ``OpenAIGenerator.generate``); the ``Generator`` protocol is
satisfied by both implementations. No live OpenAI calls (spearhead.md §A/§I).
"""

import dataclasses

import pytest

from fitted_core.generation import GenerationPrompt, Generator, OpenAIGenerator
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
    assert isinstance(OpenAIGenerator(model="gpt-4o", temperature=0.5), Generator)


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
    g = OpenAIGenerator(model="gpt-4o", temperature=0.8, max_tokens=512)
    assert isinstance(g, OpenAIGenerator)
