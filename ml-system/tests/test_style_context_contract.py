"""Shared literal cases prove web/service captured-context acceptance agrees."""
import json
from pathlib import Path

import pytest

from fitted_core.style_context import normalize_style_context

CASES = json.loads((Path(__file__).resolve().parents[2] /
    "fitted/tests/fixtures/styleContextValidation.json").read_text())


@pytest.mark.parametrize("case", CASES["cases"], ids=lambda case: case["name"])
def test_captured_context_contract(case):
    value = {**CASES["base"], **case["patch"]}
    for key in case.get("remove", []):
        value.pop(key)
    if case["valid"]:
        assert normalize_style_context(value) == value
    else:
        with pytest.raises(ValueError):
            normalize_style_context(value)
