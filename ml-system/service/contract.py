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

from fitted_core.snapshot import ENGINE_FAILURE_CODES, ENGINE_FAILURE_STAGES

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
