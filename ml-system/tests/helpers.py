"""Test-only helpers for the Spearhead suite (spearhead.md §B).

``StubGenerator`` is a canned-JSON ``Generator`` double. It lives **here, in tests/**, not
in ``fitted_core`` — so runtime code never imports from ``tests/`` (spearhead.md §B). The
real ``OpenAIGenerator`` is the only generator in the package; the CLI ``--dry-run`` fixture
generator is a separate, non-test artifact added at C6.
"""

from typing import Sequence, Union

from fitted_core.generation import GenerationPrompt


class StubGenerator:
    """A deterministic, hermetic ``Generator`` returning canned JSON (spearhead.md §B/§J).

    Two modes, to serve both the determinism and the repair tests (spearhead.md §J):
      - **fixed** (a single ``str``): returns it on every call — a *pure function of input*,
        so two identical ``rescue(...)`` calls compare equal (the determinism comparison).
      - **sequence** (a ``Sequence[str]``): returns each in order, repeating the last once
        exhausted — **call-count stateful by design** (the canned invalid-then-valid pair for
        the one §12 repair path). Stateful stubs are used in their own repair test, never in
        the determinism comparison.

    ``call_count`` is observable so a test can assert how many times generation was invoked
    (e.g. exactly one repair retry). ``prompts`` records the ``GenerationPrompt`` handed to each
    call in order, so a test can assert the seam is called *with a ``GenerationPrompt``* and that
    the C4 repair retry carries the repair-augmented prompt (its second entry).
    """

    def __init__(self, response: Union[str, Sequence[str]]) -> None:
        if isinstance(response, str):
            self._fixed: Union[str, None] = response
            self._responses: Union[list[str], None] = None
        else:
            responses = list(response)
            if not responses:
                raise ValueError("StubGenerator sequence must be non-empty")
            self._fixed = None
            self._responses = responses
        self.call_count = 0
        self.prompts: list[GenerationPrompt] = []

    def generate(self, prompt: GenerationPrompt) -> str:
        self.call_count += 1
        self.prompts.append(prompt)
        if self._fixed is not None:
            return self._fixed
        assert self._responses is not None  # narrowing for type-checkers
        idx = min(self.call_count - 1, len(self._responses) - 1)
        return self._responses[idx]
