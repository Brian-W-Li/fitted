"""Pytest bootstrap for the Track-2 transfer re-measure pre-registration.

Puts this flat script dir on sys.path so `tests/` can `import derive_power` without an installed
package (same pattern as the H26 spike's conftest).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
