"""Local whole-app baseline fixture. Never import this module in deployment.

The production ASGI factory, validators, reducers and response adapter stay in use. Only
the paid generator is injected, with a deterministic envelope over synthetic item IDs.
"""

import os
import json

from fitted_core.models import Role
from service.app import create_app
from service.private_replay import private_replay_from_environment
from service.tests.helpers import envelope, outfit


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


# Exact synthetic IDs shared with scripts/baseline-browser.mjs. They are never real wardrobe data.
STYLE_QUERY_GROUPS = tuple(tuple(f"660000000000000000000{n:03x}" for n in range(start, start+3))
                           for start in (1, 4, 7, 10))


def _prompt_wardrobe_ids(prompt):
    for marker in ("Build believable outfits for this occasion and weather from this wardrobe:\n",
                   "Wardrobe items available for these outfits (attributes are for selection only):\n"):
        if marker in prompt.user:
            value, _ = json.JSONDecoder().raw_decode(prompt.user.split(marker, 1)[1])
            if isinstance(value, list):
                return {row["id"] for row in value if isinstance(row, dict) and isinstance(row.get("id"), str)}
    return set()


class BaselineGenerator:
    """A local-only canned generator; special outputs require actual query IDs in the pool."""
    def generate(self, prompt):
        present = _prompt_wardrobe_ids(prompt)
        query_ids = {ident for group in STYLE_QUERY_GROUPS for ident in group}
        if present & query_ids:
            drafts = []
            for top, bottom, shoes in STYLE_QUERY_GROUPS:
                if {top, bottom, shoes} <= present:
                    draft = outfit([(top, Role.base_top), (bottom, Role.base_bottom), (shoes, Role.shoes)], [top])
                    draft["styleMove"]["oneSentence"] = "Authored synthetic fit contrast; this checks selection mechanics."
                    drafts.append(draft)
            return envelope(*drafts)
        return _fixture()


_private_generator = private_replay_from_environment(os.environ)

app = create_app(
    {
        "OPENAI_API_KEY": "sk-baseline-no-network",
        "SERVICE_KEY_CURRENT": "local-baseline-key",
    },
    generator_factory=lambda _: _private_generator if _private_generator is not None else BaselineGenerator(),
)
