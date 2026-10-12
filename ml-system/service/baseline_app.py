"""Local whole-app baseline fixture. Never import this module in deployment.

The production ASGI factory, validators, reducers and response adapter stay in use. Only
the paid generator is injected, with a deterministic envelope over synthetic item IDs.
"""

import os

from fitted_core.models import Role
from service.app import create_app
from service.tests.helpers import envelope, outfit
from tests.helpers import StubGenerator


def _fixture():
    ids = os.environ["FITTED_BASELINE_ITEM_IDS"].split(",")
    if len(ids) not in (5, 6) or any(len(item_id) != 24 for item_id in ids):
        raise RuntimeError("five or six synthetic Mongo item IDs required")
    top, bottom_a, bottom_b, shoes, outer = ids[:5]
    drafts = [
        outfit([(top, Role.base_top), (bottom_a, Role.base_bottom)], [top]),
        outfit([(top, Role.base_top), (bottom_b, Role.base_bottom)], [top]),
        outfit([(top, Role.base_top), (bottom_a, Role.base_bottom), (shoes, Role.shoes)], [shoes]),
        outfit([(top, Role.base_top), (bottom_b, Role.base_bottom), (outer, Role.outer_layer)], [outer]),
    ]
    if len(ids) == 6:
        mid = ids[5]
        drafts.extend([
            outfit([(top, Role.base_top), (bottom_a, Role.base_bottom), (mid, Role.mid_layer), (shoes, Role.shoes)], [mid]),
            outfit([(top, Role.base_top), (bottom_b, Role.base_bottom), (mid, Role.mid_layer), (outer, Role.outer_layer), (shoes, Role.shoes)], [mid]),
        ])
    return envelope(*drafts)


app = create_app(
    {
        "OPENAI_API_KEY": "sk-baseline-no-network",
        "SERVICE_KEY_CURRENT": "local-baseline-key",
    },
    generator_factory=lambda _: StubGenerator(_fixture()),
)
