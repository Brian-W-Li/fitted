"""Pytest bootstrap for the H26 spike.

Puts the spike package dir on sys.path so its tests import the spike modules
(`import data_loader`, `import metrics`, ...) without an installed package. The spike is a
flat script directory, not a `fitted_core`-style importable package, so there is no
`__init__.py` to import through. See docs/plans/h26-compatibility-spike-v2.md §15.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
