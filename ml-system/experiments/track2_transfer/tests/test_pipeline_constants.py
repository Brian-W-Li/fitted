"""Pins for all consumed frozen numeric choices and the H26 import bridge."""

import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import constants


def test_preregistered_constants():
    constants.assert_preregistered_constants()


@pytest.mark.parametrize("name", ["PRIMARY_MIN_LOOK1", "PRIMARY_MIN_LOOK2", "CONCENTRATION_CAP",
    "TRANSFER_INTERP_MIN", "TRANSFER_DECISION_MIN", "MIN_CATEGORY_DEPTH", "PRIMARY_BOUNDARY",
    "PRIMARY_POINT_FLOOR", "PRIMARY_CI_LEVEL", "SECONDARY_CI_LEVEL", "BOOTSTRAP_B"])
def test_each_numeric_pin_detects_drift(monkeypatch, name):
    monkeypatch.setattr(constants, name, getattr(constants, name) + 1)
    with pytest.raises(RuntimeError):
        constants.assert_preregistered_constants()


def test_horizon_pin_detects_drift(monkeypatch):
    monkeypatch.setattr(constants, "HORIZON", "2027-10-31")
    with pytest.raises(RuntimeError):
        constants.assert_preregistered_constants()


def test_bridge_import_is_lazy_and_inherited_types_agree():
    code = "import sys; import h26_bridge; from h26_bridge import FIVE_TYPES; import constants; assert 'torch' not in sys.modules; assert FIVE_TYPES == constants.FIVE_TYPES"
    subprocess.run([sys.executable, "-c", code], cwd=constants.ROOT, check=True)


def test_seed_is_pinned_to_the_inherited_h26_evaluator():
    from h26_bridge import SEED
    assert constants.SEED == SEED
