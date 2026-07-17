"""The M5 ``POST /render`` wire contract, as data — the SINGLE source of truth for field sets.

Every request boundary's required/optional key set lives here as a named frozenset, imported by
BOTH the parser (:mod:`service.app`) and the conformance test
(``service/tests/test_render_contract.py``). Nothing else may re-declare a wire field set: the
parser references these constants, the test enumerates them, and the canonical ``render_body()``
fixture is pinned equal to them.

Why this module exists — the disease it cures. The M5 build repeatedly shipped a *green* suite over
a *drifted* contract: a reducer read ``itemIds`` while the schema emitted ``items`` (the affinity
seam silently never opened); ``sessionId`` was absent from the entire wire while three downstream
layers required it. Both slipped because the field names lived as inline literals scattered across
``_require_keys(required={...})`` calls / reducer ``row.get(...)`` reads and prose in the plan — no
single test enumerated the contract, so nothing failed when a layer drifted. Hoisting the names here
+ the conformance tests makes the contract executable.

Two contract kinds live here, and they are NOT the same guarantee:

* **Wire boundaries** (``BOUNDARIES``) — the exact required/optional *presence* set the ``/render``
  parser (``service/app.py``) enforces per request object. Enforced end-to-end in Python: add/rename/
  drop a wire field without updating this module and ``test_render_contract.py`` reddens (the
  ``sessionId`` class).
* **Reducer row reads** (``REDUCER_ROW_READS``) — the field *names* :mod:`fitted_core.reducers`
  depends on inside each ``behavioralRows`` row (which the wire parser treats as opaque dicts). These
  are a *consumption* contract, not a per-row presence rule (a row may lawfully omit an optional
  field), and their cross-runtime enforcement is the C5 jest test: the Next Mongo **projection** must
  emit exactly these names (the ``itemIds``/``items`` class lives HERE, at the row grain — a Python
  test alone cannot see the TS projection, so the mirror below is the shared target).

Cross-runtime (C5): the Next adapter + its jest parity test target these same sets.
``contract_fields.json`` is the language-neutral mirror (pinned equal to this module by
``test_render_contract.py``); the TS side loads that file so a drift on either runtime trips a test.
See ``docs/plans/m5-cutover.md`` §"Wire contract".
"""

from __future__ import annotations

from fitted_core.models import ItemType, Role, Template
from fitted_core.response import OptionPath, Risk
from fitted_core.snapshot import CANDIDATE_STAGES, ENGINE_FAILURE_CODES, ENGINE_FAILURE_STAGES
from service import config as cfg

# --- POST /render top-level body (§A) -------------------------------------------------
RENDER_BODY_REQUIRED = frozenset({
    "snapshotId",
    "requestId",
    "sessionId",
    "intent",
    "generationIndex",
    "parentSnapshotId",
    "controls",
    "lens",
    "wardrobe",
    "wardrobeVersion",
    "interactionCountAtRequest",
    "behavioralRows",
    "generator",
})
RENDER_BODY_OPTIONAL: frozenset[str] = frozenset()

# --- controls (§C.3) — regenerate-lineage only; present-but-empty on a root render ----
CONTROLS_REQUIRED = frozenset({"lockedItemIds", "dislikedItemIds"})
CONTROLS_OPTIONAL: frozenset[str] = frozenset()

# --- lens (§F) — the normalized request context --------------------------------------
LENS_REQUIRED = frozenset({"occasion", "weather", "constraints", "seedDate"})
LENS_OPTIONAL = frozenset({"weatherRaw", "location", "forcedItemId"})

# --- wardrobe[i] (§A) — one wire wardrobe item ----------------------------------------
WARDROBE_ITEM_REQUIRED = frozenset({
    "id",
    "name",
    "clothingType",
    "warmth",
    "styleTags",
    "colorTags",
    "occasionTags",
    "imageUrl",
})
WARDROBE_ITEM_OPTIONAL = frozenset({"material", "formality"})

# --- behavioralRows (§H) — bounded Mongo projections; both arrays optional ------------
BEHAVIORAL_ROWS_REQUIRED: frozenset[str] = frozenset()
BEHAVIORAL_ROWS_OPTIONAL = frozenset({"recentSnapshots", "interactionRows"})

# --- generator (§G) — the wire expectation exact-matched against service config --------
GENERATOR_REQUIRED = frozenset({
    "provider",
    "model",
    "temperature",
    "maxCompletionTokens",
    "apiSurface",
    "responseFormat",
    "reasoningEffort",
    "storeMode",
    "promptCacheRetention",
    "timeoutSeconds",
    "maxRetries",
})
GENERATOR_OPTIONAL: frozenset[str] = frozenset()


# The full boundary map — {boundary name: (required, optional)}. The conformance test and the
# JSON mirror both iterate this, so a new boundary is covered the moment it is added here.
BOUNDARIES: dict[str, tuple[frozenset[str], frozenset[str]]] = {
    "request": (RENDER_BODY_REQUIRED, RENDER_BODY_OPTIONAL),
    "controls": (CONTROLS_REQUIRED, CONTROLS_OPTIONAL),
    "lens": (LENS_REQUIRED, LENS_OPTIONAL),
    "wardrobeItem": (WARDROBE_ITEM_REQUIRED, WARDROBE_ITEM_OPTIONAL),
    "behavioralRows": (BEHAVIORAL_ROWS_REQUIRED, BEHAVIORAL_ROWS_OPTIONAL),
    "generator": (GENERATOR_REQUIRED, GENERATOR_OPTIONAL),
}


# --- Reducer row reads (§H) — the field NAMES fitted_core.reducers depends on inside each ----------
# behavioralRows row. The wire parser treats rows as opaque; the drift these guard is the C5 Mongo
# projection emitting a name the reducer does not read (e.g. `itemIds` vs `items` → the affinity seam
# silently never opens). NOT a per-row presence rule — the C5 projection MUST include these names, but
# an individual row may omit an optional one (e.g. a non-rejected row carries no `perItemFeedback`).
# Keep in lockstep with fitted_core/reducers.py; the C5 jest projection-parity test loads these.
INTERACTION_ROW_READS = frozenset({
    "snapshotId",       # binding presence (_is_bound_feedback) + affinity dedup key
    "candidateId",      # binding presence + affinity dedup key
    "action",           # COUNTED_ACTIONS / REJECTED_ACTION routing
    "fullSignature",    # counted → liked_full_signatures
    "createdAt",        # counted-event dedup within window
    "items",            # counted → item_affinity  (THE itemIds/items drift point)
    "baseKey",          # rejected → recent_disliked_base_keys (cooldown)
    "perItemFeedback",  # rejected → per-item dislikes
})
PER_ITEM_FEEDBACK_READS = frozenset({
    "disliked",         # gate: only disliked entries count
    "itemId",           # → recent_disliked_item_ids
})
SNAPSHOT_ROW_READS = frozenset({
    "nSurfaced",           # >0 gate on a repetition-window row
    "shownFullSignatures", # → the H19 shown_full_signatures window
})

# {read-group name: fields}. Included in the JSON mirror under "reducerRowReads" so the C5 jest
# projection test asserts the Mongo projection emits exactly these names.
REDUCER_ROW_READS: dict[str, frozenset[str]] = {
    "interactionRow": INTERACTION_ROW_READS,
    "perItemFeedback": PER_ITEM_FEEDBACK_READS,
    "snapshotRow": SNAPSHOT_ROW_READS,
}

# --- Engine-failure vocabulary (§G item 4) — a THIRD cross-runtime mirror kind ---------------------
# The diagnostics.engineFailure closed sets the TS schema enum + validation helper re-enforce.
# Sourced from fitted_core.snapshot (the Python authority) so a stage/code added there flows into the
# JSON mirror; the C5 TS round-trip test loads the mirror and asserts GenerationSnapshot.ts's literal
# equals it. That closes the drift loop: a Python-side stage/code NOT mirrored to TS reddens a test,
# instead of the TS write boundary silently rejecting the §D failure row (the D-1 data-loss class).
ENGINE_FAILURE_VOCAB: dict[str, frozenset[str]] = {
    "stages": ENGINE_FAILURE_STAGES,
    "codes": ENGINE_FAILURE_CODES,
}

# --- Cross-runtime mirror (§4.1 C1/C2/C4) — clamps / enums / id-formats hand-copied Next-side --------
# A fourth mirror kind: values/behaviors the Next app re-declares (adapter clamps, enum value-sets,
# id/format regexes). Clamps + enums are DERIVED from the live config/ontology here (never a second
# literal that could drift); the TS side asserts equality against the JSON mirror, and a Python-side
# change flows into the JSON automatically. The format entries are behavioral accept/reject vectors,
# not pattern strings — the two runtimes' regexes differ syntactically (`/i` vs explicit `A-F`) but
# must agree on behavior, so each runtime asserts its regex matches the vectors (test_render_contract
# `test_cross_runtime_*`; the TS crossRuntimeContract.test.ts).

# Clamps the Next adapter/feedback route re-declares — value derived from config so it cannot drift.
CROSS_RUNTIME_CLAMPS: dict[str, int] = {
    "MAX_OCCASION_CHARS": cfg.MAX_OCCASION_CHARS,
    "MAX_WEATHER_RAW_CHARS": cfg.MAX_WEATHER_RAW_CHARS,
    "MAX_LOCATION_CHARS": cfg.MAX_LOCATION_CHARS,
    "MAX_WARDROBE_ITEMS": cfg.MAX_WARDROBE_ITEMS,
    "MAX_CONTROL_IDS": cfg.MAX_CONTROL_IDS,
    "MAX_ITEM_NAME_CHARS": cfg.MAX_ITEM_NAME_CHARS,
    "MAX_ITEM_TAG_CHARS": cfg.MAX_ITEM_TAG_CHARS,
    "MAX_ITEM_TAGS": cfg.MAX_ITEM_TAGS,
    "MAX_IMAGE_URL_CHARS": cfg.MAX_IMAGE_URL_CHARS,
    "MAX_PER_ITEM_FEEDBACK": cfg.MAX_PER_ITEM_FEEDBACK,
    "FEEDBACK_REASON_RAW_TEXT_MAX_CHARS": cfg.FEEDBACK_REASON_RAW_TEXT_MAX_CHARS,
}

# Clamps the SERVICE alone enforces — intentionally NOT mirrored Next-side (documented so the
# boundary reads as deliberate, not an omission). A name here must exist in config.
# NOTE: MAX_ID_CHARS (the ≤64 id cap) is deliberately absent — it IS re-declared Next-side (a bare
# literal `64` in mlRecommend + the GenerationSnapshot validator), so it is not "service-only"; it is
# left unpinned because the ULID(26)/UUIDv4(36)/ObjectId(24) regexes bound id length far tighter, so
# the 64 cap is defensive-redundant and a drift in it cannot change accept behavior.
CROSS_RUNTIME_SERVICE_ONLY_CLAMPS: tuple[str, ...] = (
    "MAX_SESSION_ID_CHARS",
    "MAX_ITEM_ATTR_CHARS",
    "MAX_WIRE_INT",
    "MAX_JSON_NESTING_DEPTH",
    "MAX_REQUEST_BODY_BYTES",
    "RATE_LIMIT_BURST",
    "RATE_LIMIT_REFILL_PER_SECOND",
    "DEFAULT_MAX_COMPLETION_TOKENS",
    "MAX_COMPLETION_TOKENS_CEILING",
    "MIN_COMPLETION_TOKENS_FLOOR",
)

# Enum value-sets both runtimes gate on — derived from the live config/ontology.
CROSS_RUNTIME_ENUMS: dict[str, list[str]] = {
    "weather": sorted(cfg.WEATHER_BUCKETS),
    "intent": sorted(cfg.SUPPORTED_INTENTS),
    "clothingType": sorted(t.value for t in ItemType),
}

# Candidate/role vocab that ONLY the GenerationSnapshot Mongoose schema re-declares — no adapter/config
# const mirrors these (unlike the CROSS_RUNTIME_ENUMS above, which the Next request path also gates on).
# Derived from the fitted_core ontology so a member added to Role/Template/OptionPath/Risk/CANDIDATE_STAGES
# flows into the JSON mirror; the TS side pins the schema's literal enum arrays to this set. A drift
# would write-reject a valid service candidate (post-m5-reset §4.6 "role/candidate enums unpinned").
CROSS_RUNTIME_SCHEMA_ENUMS: dict[str, list[str]] = {
    "stageReached": sorted(CANDIDATE_STAGES),
    "role": sorted(r.value for r in Role),
    "template": sorted(t.value for t in Template),
    "optionPath": sorted(p.value for p in OptionPath),
    "risk": sorted(r.value for r in Risk),
}

# Behavioral accept/reject vectors for the id/format regexes (see the note above).
CROSS_RUNTIME_FORMATS: dict[str, object] = {
    "_comment": (
        "Behavioral vectors, not pattern strings — the two runtimes' regexes differ syntactically "
        "but MUST agree on accept/reject. Each runtime asserts its regex accepts every `valid` and "
        "rejects every `invalid`."
    ),
    "objectId": {
        "valid": ["6a4eb442443135439ac080d2", "AABBCCDDEEFF001122334455"],
        "invalid": [
            "",
            "6a4eb442443135439ac080d",
            "6a4eb442443135439ac080d2a",
            "6a4eb442443135439ac080dg",
            " 6a4eb442443135439ac080d2",
            # trailing newline — the one input class where Python `$` and JS `$` differ; both must
            # reject it (Python via re.fullmatch, JS via end-of-string `$`).
            "6a4eb442443135439ac080d2\n",
        ],
    },
    "seedDate": {
        "valid": ["2026-07-16", "0000-00-00"],
        "invalid": ["", "2026-7-16", "07/16/2026", "2026-07-16 ", "2026-07-16T00:00:00Z", "2026-07-16\n"],
    },
    "requestId": {
        "_comment": (
            "UUIDv4 (case-insensitive hex) OR an UPPERCASE Crockford-base32 ULID. A LOWERCASE ULID is "
            "invalid on both sides — the drift this pins (a TS route regex once accepted it while "
            "Python/Mongoose rejected it)."
        ),
        "valid": ["0192f1a0-1c1a-4c3e-9b2a-1a2b3c4d5e6f", "01ARZ3NDEKTSV4RRFFQ69G5FAV"],
        "invalid": [
            "",
            "0192f1a0-1c1a-7c3e-9b2a-1a2b3c4d5e6f",
            "01arz3ndektsv4rrffq69g5fav",
            "0192f1a0-1c1a-4c3e-cb2a-1a2b3c4d5e6f",
            "01ARZ3NDEKTSV4RRFFQ69G5FA",
            "01ARZ3NDEKTSV4RRFFQ69G5FAV\n",
        ],
    },
}


def cross_runtime_mirror() -> dict:
    """The `crossRuntime` block of the JSON mirror — clamps/enums derived from config, formats literal."""
    return {
        "_comment": (
            "Values/behaviors hand-mirrored across the Next app (TS/Mongoose) and this service "
            "(Python). This file is the single source; a TS test and a Python test each assert their "
            "runtime matches these, so a one-sided edit reddens a suite instead of drifting silently "
            "(post-m5-reset §4.1 C1/C2/C4)."
        ),
        "clamps": dict(CROSS_RUNTIME_CLAMPS),
        "serviceOnlyClamps": {
            "_comment": (
                "Constants enforced ONLY by the service (ml-system/service/config.py) and "
                "intentionally NOT mirrored Next-side — the service is the sole enforcer, so there is "
                "no second copy to drift. Listed so the boundary reads as deliberate, not an omission."
            ),
            "names": list(CROSS_RUNTIME_SERVICE_ONLY_CLAMPS),
        },
        "enums": {name: list(values) for name, values in CROSS_RUNTIME_ENUMS.items()},
        "schemaEnums": {name: list(values) for name, values in CROSS_RUNTIME_SCHEMA_ENUMS.items()},
        "formats": CROSS_RUNTIME_FORMATS,
    }
