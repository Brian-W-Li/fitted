"""Constants consumed by the Track-2 executor.

The values are mirrored from preregistration.json and pinned at import time.  The
preregistration files remain the authority and are never rewritten here.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PREREG_PATH = ROOT / "preregistration.json"
with PREREG_PATH.open(encoding="utf-8") as _f:
    PREREG = json.load(_f)

PRIMARY_MIN_LOOK1 = 25
PRIMARY_MIN_LOOK2 = 50
CONCENTRATION_CAP = 0.5
TRANSFER_INTERP_MIN = 12
TRANSFER_DECISION_MIN = 25
MIN_CATEGORY_DEPTH = 2
PRIMARY_BOUNDARY = 0.50
PRIMARY_POINT_FLOOR = 0.60
PRIMARY_CI_LEVEL = 0.975
SECONDARY_CI_LEVEL = 0.95
BOOTSTRAP_B = 10_000
SEED = 20260629
HORIZON = "2026-10-31"
FIVE_TYPES = ("top", "bottom", "dress", "outer_layer", "shoes")


def assert_preregistered_constants() -> None:
    cert = PREREG["export_certificate"]
    primary = PREREG["primary_read"]
    secondary = PREREG["secondary_read"]
    statistics = PREREG["statistics"]
    expected = {
        "primaryDecisionMinPerArm": PRIMARY_MIN_LOOK1,
        "transferInterpMin": TRANSFER_INTERP_MIN,
        "transferDecisionMin": TRANSFER_DECISION_MIN,
        "perFriendConcentrationCap": CONCENTRATION_CAP,
        "minCategoryDepthForNegative": MIN_CATEGORY_DEPTH,
    }
    actual = {k: cert[k] for k in expected}
    if actual != expected:
        raise RuntimeError(f"Track-2 constant drift: prereg {actual!r} != executor {expected!r}")
    if primary["boundary"] != PRIMARY_BOUNDARY:
        raise RuntimeError("primary boundary drift")
    if primary["established_requires"]["ci_low_gt"] != PRIMARY_BOUNDARY:
        raise RuntimeError("primary CI boundary drift")
    for look, floor in zip(primary["looks"], (PRIMARY_MIN_LOOK1, PRIMARY_MIN_LOOK2)):
        match = re.search(r"both arms >= (\d+) scoreable clusters", look["trigger"])
        if match is None or int(match.group(1)) != floor:
            raise RuntimeError("primary look floor drift")
    if [look["look"] for look in primary["looks"]] != [1, 2]:
        raise RuntimeError("primary look count drift")
    if primary["established_requires"]["point_estimate_geq"] != PRIMARY_POINT_FLOOR:
        raise RuntimeError("primary point-floor drift")
    if primary["ci_level_per_look"] != PRIMARY_CI_LEVEL:
        raise RuntimeError("primary CI-level drift")
    if secondary["ci_level"] != SECONDARY_CI_LEVEL:
        raise RuntimeError("secondary CI-level drift")
    if statistics["bootstrap"]["b"] != BOOTSTRAP_B:
        raise RuntimeError("bootstrap count drift")
    if statistics["concentration_cap"] != CONCENTRATION_CAP:
        raise RuntimeError("concentration cap drift")
    if primary["horizon"].split()[0] != HORIZON:
        raise RuntimeError("horizon drift")


assert_preregistered_constants()
