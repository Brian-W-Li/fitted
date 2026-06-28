"""C4 — version-constant provenance + the snapshot_serde wire layer (plan §14 C4).

Two concerns:
  - the (``__version__``, ``PROMPT_VERSION``, ``RANKER_CONFIG_VERSION``) provenance triple
    is present, well-formed, and the auto-digest is stable yet sensitive to a constant move;
  - ``to_wire`` / ``from_wire`` round-trip the engineVisible projection (incl. the
    non-mechanical ``type`` → ``clothingType`` rename) and reject non-finite floats /
    non-string ids at the boundary.
"""

import json

import pytest

import fitted_core
from fitted_core import config
from fitted_core import snapshot_serde as serde


# --- provenance triple -------------------------------------------------------


def test_version_is_nonempty_semverish():
    v = fitted_core.__version__
    assert isinstance(v, str) and v
    parts = v.split(".")
    assert len(parts) == 3 and all(p.isdigit() for p in parts), v


def test_prompt_version_present_and_nonempty():
    assert isinstance(fitted_core.PROMPT_VERSION, str) and fitted_core.PROMPT_VERSION
    # re-exported from the package root AND single-homed in config
    assert fitted_core.PROMPT_VERSION == config.PROMPT_VERSION


def test_ranker_config_version_is_stable_sha256_hex():
    v = fitted_core.RANKER_CONFIG_VERSION
    assert isinstance(v, str) and len(v) == 64
    int(v, 16)  # valid hex
    # deterministic: recomputing over the unchanged constants yields the same digest
    assert config._compute_ranker_config_version() == v


def test_ranker_config_version_changes_when_a_scalar_constant_moves(monkeypatch):
    before = config._compute_ranker_config_version()
    monkeypatch.setattr(config, "COMBO_BOOST", config.COMBO_BOOST + 1.0)
    assert config._compute_ranker_config_version() != before


def test_ranker_config_version_changes_when_a_taxonomy_moves(monkeypatch):
    # a frozenset member change must move the digest too (the rescue taxonomies are
    # behavioral tuning, not just the ranker scalars)
    before = config._compute_ranker_config_version()
    monkeypatch.setattr(config, "NEUTRAL_COLORS", config.NEUTRAL_COLORS | {"chartreuse"})
    assert config._compute_ranker_config_version() != before


def test_prompt_version_is_excluded_from_the_ranker_digest(monkeypatch):
    # PROMPT_VERSION is its own provenance axis — moving it must NOT perturb the ranker hash
    before = config._compute_ranker_config_version()
    monkeypatch.setattr(config, "PROMPT_VERSION", config.PROMPT_VERSION + "-x")
    assert config._compute_ranker_config_version() == before


# --- engineVisible round-trip ------------------------------------------------


def _sample_payload() -> dict:
    """A representative snapshot-shaped payload: nested engineVisible + ids + finite floats
    + the data-valued Map fields (constraints / samplerPerType / histogram) and a verbatim
    Mixed blob (rawEmitted). Float values are exactly representable so round-trips are
    byte-equal; the underscored data keys (outer_layer / max_items) exercise key-preservation."""
    return {
        "candidate_cache_key": "ck-1",
        "generation_index": 0,
        "constraints": {"max_items": 4, "no_repeat_base": True},  # data-keyed Map (§8.3)
        "item_snapshots": [
            {
                "item_id": "abc123",
                "engine_visible": {
                    "name": "Navy Tee",
                    "type": "top",
                    "warmth": 4,
                    "style_tags": ["casual"],
                    "color_tags": ["navy"],
                    "occasion_tags": ["daily"],
                    "material": None,
                    "formality": None,
                    "image_url": "https://example/y.png",
                },
            }
        ],
        "candidates": [
            {
                "candidate_id": "c0",
                "source_attempt_id": "a0",
                "accepted": True,
                "raw_emitted": {"type": "outfit", "item_ids": ["abc123"]},  # verbatim blob
                "score_trace": {"compatibility": 0.5, "ranker_score": 1.25},
            }
        ],
        "diagnostics": {
            # keyed by ItemType (incl. the underscored outer_layer) — keys are DATA, not fields
            "sampler_per_type": {"top": {"eligible": 3}, "outer_layer": {"eligible": 1}},
            "rejection_histogram": {"invalidJson": 2},
        },
    }


def test_engine_visible_partition_key_and_tag_renames():
    wire = serde.to_wire(_sample_payload())
    ev = wire["itemSnapshots"][0]["engineVisible"]
    assert ev["clothingType"] == "top"  # the non-mechanical type → clothingType rename
    assert "type" not in ev
    assert ev["styleTags"] == ["casual"]
    assert ev["colorTags"] == ["navy"]
    assert ev["occasionTags"] == ["daily"]
    assert ev["imageUrl"] == "https://example/y.png"
    assert ev["material"] is None and ev["formality"] is None


def test_outer_keys_use_mechanical_snake_to_camel():
    wire = serde.to_wire(_sample_payload())
    assert "candidateCacheKey" in wire
    assert "itemSnapshots" in wire
    assert wire["candidates"][0]["sourceAttemptId"] == "a0"
    assert wire["candidates"][0]["scoreTrace"]["rankerScore"] == 1.25


def test_round_trip_byte_equal_through_json():
    payload = _sample_payload()
    wire = serde.to_wire(payload)
    restored = serde.from_wire(json.loads(json.dumps(wire)))
    assert restored == payload


def test_non_round_trippable_structural_key_raises_on_to_wire():
    # The latent corruption the guard closes: a structural field whose segment starts with a
    # non-letter (digit-after-underscore / trailing / double underscore) loses its boundary
    # under the mechanical snake->camel and would silently mangle stored training truth. It
    # must fail loud at author time, not round-trip-corrupt.
    # (note: "score_v2" is *fine* — "v2" starts with a letter, so the boundary survives; only a
    # segment that starts with a non-letter breaks.)
    for bad_key in ("gpt_4o_score", "trailing_", "double__under"):
        with pytest.raises(ValueError, match="round-trip-safe"):
            serde.to_wire({bad_key: 1.0})


def test_non_round_trippable_key_is_fine_inside_an_opaque_blob():
    # Inside a Mixed/data-Map blob, keys are preserved verbatim (never converted), so a digit
    # key is legal there — only mechanically-converted *structural* names are constrained.
    wire = serde.to_wire({"raw_emitted": {"gpt_4o": "ok", "score_v2": 1}})
    assert wire["rawEmitted"] == {"gpt_4o": "ok", "score_v2": 1}


def test_from_wire_rejects_non_round_trippable_wire_key():
    # A genuine camel wire key round-trips (gpt4oScore -> gpt4o_score -> gpt4oScore); the guard
    # fires on a malformed wire key that smuggles an underscore (e.g. TS sent snake by mistake).
    serde.from_wire({"gpt4oScore": 1.0})  # well-formed: must NOT raise
    with pytest.raises(ValueError, match="round-trip-safe"):
        serde.from_wire({"score_v2": 1.0})


def test_data_map_keys_preserved_verbatim_on_the_wire():
    # The regression this guards: a blanket snake->camel would mangle the ItemType key
    # "outer_layer" -> "outerLayer", silently diverging the wire from the ItemType member
    # value and corrupting M6 training truth. Data-Map keys must survive byte-for-byte.
    wire = serde.to_wire(_sample_payload())
    sampler = wire["diagnostics"]["samplerPerType"]  # field name IS re-cased ...
    assert set(sampler.keys()) == {"top", "outer_layer"}  # ... but its data keys are NOT
    assert sampler["outer_layer"]["eligible"] == 1
    assert "outerLayer" not in sampler
    # constraints + histogram keys (underscored / IssueCode-valued) likewise preserved
    assert set(wire["constraints"].keys()) == {"max_items", "no_repeat_base"}
    assert wire["diagnostics"]["rejectionHistogram"]["invalidJson"] == 2


def test_raw_blob_is_verbatim_and_type_is_not_renamed_outside_engine_visible():
    wire = serde.to_wire(_sample_payload())
    raw = wire["candidates"][0]["rawEmitted"]  # field re-cased; its contents are a blob
    assert raw["type"] == "outfit"  # NOT clothingType — type renames only inside engineVisible
    assert raw["item_ids"] == ["abc123"]  # not "itemIds"


def test_type_rename_is_scoped_to_engine_visible():
    # inside engine_visible: type -> clothingType
    assert serde.to_wire({"engine_visible": {"type": "x"}}) == {"engineVisible": {"clothingType": "x"}}
    # a bare type key in any other structural object is left mechanical (unchanged)
    assert serde.to_wire({"foo": {"type": "x"}}) == {"foo": {"type": "x"}}


def test_bool_is_not_mangled_into_int():
    # bool is an int subclass — it must round-trip as bool, not be caught by a numeric branch
    wire = serde.to_wire(_sample_payload())
    assert wire["candidates"][0]["accepted"] is True


# --- boundary rejections -----------------------------------------------------


def test_nan_raises():
    payload = _sample_payload()
    payload["candidates"][0]["score_trace"]["compatibility"] = float("nan")
    with pytest.raises(ValueError):
        serde.to_wire(payload)


def test_infinity_raises():
    payload = _sample_payload()
    payload["candidates"][0]["score_trace"]["ranker_score"] = float("inf")
    with pytest.raises(ValueError):
        serde.to_wire(payload)


def test_non_string_item_id_raises():
    payload = _sample_payload()
    payload["item_snapshots"][0]["item_id"] = 12345
    with pytest.raises(ValueError):
        serde.to_wire(payload)


def test_objectid_like_candidate_id_raises():
    class FakeObjectId:
        def __str__(self) -> str:  # looks string-ish but isn't a str
            return "deadbeefdeadbeefdeadbeef"

    payload = _sample_payload()
    payload["candidates"][0]["candidate_id"] = FakeObjectId()
    with pytest.raises((ValueError, TypeError)):
        serde.to_wire(payload)


def test_unserializable_leaf_raises():
    payload = _sample_payload()
    payload["candidates"][0]["score_trace"]["compatibility"] = {1, 2, 3}  # a set isn't wire-able
    with pytest.raises(TypeError):
        serde.to_wire(payload)


def test_from_wire_rejects_objectid_id_too():
    # the guard fires in the camel→snake direction as well (key_context is the wire key)
    class FakeObjectId:
        pass

    wire = {"itemId": FakeObjectId()}
    with pytest.raises((ValueError, TypeError)):
        serde.from_wire(wire)


# --- id-sequence + scalar-id guards (plural/container id fields, not just the scalar itemId) ----


def test_numeric_entry_in_shown_candidate_ids_raises():
    payload = _sample_payload()
    payload["shown_candidate_ids"] = ["c0", 123]
    with pytest.raises(ValueError):
        serde.to_wire(payload)


def test_scalar_shown_candidate_ids_raises():
    payload = _sample_payload()
    payload["shown_candidate_ids"] = "c0"
    with pytest.raises(ValueError, match="list/tuple"):
        serde.to_wire(payload)


@pytest.mark.parametrize(
    "key",
    [
        "item_snapshots",
        "generation_attempts",
        "candidates",
        "shown_candidate_ids",
        "shown_full_signatures",
    ],
)
def test_required_snapshot_arrays_reject_none_on_to_wire(key):
    payload = _sample_payload()
    payload[key] = None
    with pytest.raises(ValueError, match="required array"):
        serde.to_wire(payload)


@pytest.mark.parametrize(
    "wire_key",
    ["itemSnapshots", "generationAttempts", "candidates", "shownCandidateIds", "shownFullSignatures"],
)
def test_required_snapshot_arrays_reject_none_from_wire(wire_key):
    with pytest.raises(ValueError, match="required array"):
        serde.from_wire({wire_key: None})


@pytest.mark.parametrize("key", ["item_snapshots", "generation_attempts", "candidates"])
def test_required_snapshot_arrays_reject_scalar_containers(key):
    payload = _sample_payload()
    payload[key] = "not-an-array"
    with pytest.raises(ValueError, match="required array"):
        serde.to_wire(payload)


def test_optional_base_outfit_item_ids_may_be_none():
    assert serde.to_wire({"base_outfit_item_ids": None}) == {"baseOutfitItemIds": None}
    assert serde.from_wire({"baseOutfitItemIds": None}) == {"base_outfit_item_ids": None}


def test_nested_shown_candidate_ids_raises():
    payload = _sample_payload()
    payload["shown_candidate_ids"] = ["c0", ["c1"]]
    with pytest.raises(ValueError, match="opaque strings"):
        serde.to_wire(payload)


def test_none_entry_in_shown_candidate_ids_raises():
    payload = _sample_payload()
    payload["shown_candidate_ids"] = ["c0", None]
    with pytest.raises(ValueError, match="opaque strings"):
        serde.to_wire(payload)


def test_numeric_entry_in_shown_full_signatures_raises():
    payload = _sample_payload()
    payload["shown_full_signatures"] = [456]
    with pytest.raises(ValueError):
        serde.to_wire(payload)


def test_numeric_changed_item_id_in_style_move_raises():
    payload = _sample_payload()
    payload["candidates"][0]["style_move"] = {
        "move_type": "swap",
        "changed_item_ids": ["abc123", 789],  # a non-string id inside the sequence
        "one_sentence": "x",
    }
    with pytest.raises(ValueError):
        serde.to_wire(payload)


def test_none_changed_item_ids_in_style_move_raises_when_present():
    payload = _sample_payload()
    payload["candidates"][0]["style_move"] = {
        "move_type": "swap",
        "changed_item_ids": None,
        "one_sentence": "x",
    }
    with pytest.raises(ValueError, match="required array"):
        serde.to_wire(payload)


def test_non_string_scalar_forced_item_id_raises():
    payload = _sample_payload()
    payload["forced_item_id"] = 999
    with pytest.raises(ValueError):
        serde.to_wire(payload)


def test_string_id_sequences_round_trip_cleanly():
    payload = _sample_payload()
    payload["shown_candidate_ids"] = ["c0", "c1"]
    payload["shown_full_signatures"] = ["t1:b1|outer=none|shoes=none"]
    payload["forced_item_id"] = "t1"
    wire = serde.to_wire(payload)
    assert wire["shownCandidateIds"] == ["c0", "c1"]
    assert wire["forcedItemId"] == "t1"
    assert serde.from_wire(wire)["shown_candidate_ids"] == ["c0", "c1"]


def test_from_wire_rejects_numeric_shown_candidate_id():
    # the id-sequence guard fires in the camel→snake direction too (key_context is the wire key)
    with pytest.raises(ValueError):
        serde.from_wire({"shownCandidateIds": ["c0", 123]})


def test_from_wire_rejects_scalar_shown_candidate_ids():
    # the field itself must be an array; a bare string is valid only as an element.
    with pytest.raises(ValueError, match="list/tuple"):
        serde.from_wire({"shownCandidateIds": "c0"})
