"""Hermetic guards for the C2 one-way-door FREEZE artifacts (no dataset, no torch).

The frozen JSONs (`preregistration.json`, `fitb_manifest.json`,
`embedding_manifest_fashionsiglip.json`, `metrics.schema.json`, `selection.schema.json`,
`closet_manifest.schema.json`) and `type_map.json` are
pre-registration commitments `evaluate.py` parses at C3-C6. Build-doc §1 makes the machine-readable
mirror "enforceable, not honor-system" and `preregistration.md` states the .md and .json "must
agree". These tests pin that in plain CI, before any model number: the JSONs parse; the frozen seed
+ gate thresholds + head params + embedding fields agree across every artifact; `type_map.json`'s
enum / overrides / C2-resolved rows are exactly the frozen set; and the .md human authority carries
the same load-bearing literals. A drift fails HERE, not silently at C3. The data_loader tests only
ever use fixture seeds, so this is the only guard on the committed seed 20260629.
Reference: docs/plans/h26-compatibility-spike-v2.md §1/§12/§15.
"""

import hashlib
import os
import re

import pytest

import data_loader as dl

H26 = os.path.dirname(os.path.dirname(__file__))  # the spike root (tests/ -> ..)
SEED = 20260629


def _load(name: str):
    return dl.load_json_strict(os.path.join(H26, name))


def _read(name: str) -> str:
    with open(os.path.join(H26, name), encoding="utf-8") as f:
        return f.read()


def _sha256(name: str) -> str:
    with open(os.path.join(H26, name), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


# --------------------------------------------------------------------------- #
# The freeze JSONs parse
# --------------------------------------------------------------------------- #
def test_freeze_jsons_parse():
    for name in (
        "preregistration.json", "fitb_manifest.json",
        "embedding_manifest_fashionsiglip.json", "metrics.schema.json",
        "selection.schema.json", "closet_manifest.schema.json",
        "judge_addendum.schema.json",
    ):
        assert isinstance(_load(name), dict), name


def test_freeze_json_loader_is_strict(tmp_path):
    dup = tmp_path / "dup.json"
    dup.write_text('{"a": 1, "a": 2}', encoding="utf-8")
    with pytest.raises(ValueError, match="duplicate JSON key"):
        dl.load_json_strict(str(dup))

    nan = tmp_path / "nan.json"
    nan.write_text('{"a": NaN}', encoding="utf-8")
    with pytest.raises(ValueError, match="non-finite JSON constant"):
        dl.load_json_strict(str(nan))


# --------------------------------------------------------------------------- #
# The frozen seed agrees across every artifact (a drift silently runs the wrong negative draw)
# --------------------------------------------------------------------------- #
def test_frozen_seed_agrees_everywhere():
    p = _load("preregistration.json")
    assert p["headline_cell"]["seed"] == SEED
    assert p["analyst_pins"]["optimizer"]["seed"] == SEED
    assert p["analyst_pins"]["seed"]["headline"] == SEED
    assert p["analyst_pins"]["seed"]["robustness_footnote"][0] == SEED
    assert _load("fitb_manifest.json")["seed"] == SEED
    assert str(SEED) in _read("preregistration.md")  # the human authority carries the same literal


# --------------------------------------------------------------------------- #
# Gate thresholds: the .json mirror == the build-doc-frozen values, and the .md echoes them
# --------------------------------------------------------------------------- #
def test_gate_thresholds_frozen():
    p = _load("preregistration.json")
    g = p["gates"]
    assert g["A"]["threshold"] == 0.0
    assert g["B"]["delta"] == 0.05 and g["B"]["delta_fitb_points"] == 5
    floors = {c["metric"]: c["floor"] for c in g["D"]["conjuncts"]}
    assert floors["outfit_auc"] == 0.81 and floors["fitb_trained_full"] == 0.50
    rt = p["reported_transfer"]
    assert rt["gated"] is False
    assert rt["drop"]["healthy_if_leq"] == 0.12 and rt["closet_floor"]["healthy_if_geq"] == 0.70
    assert p["analyst_pins"]["popularity_confound_response"]["blind_margin_auc"] == 0.55
    md = _read("preregistration.md")
    for literal in ("0.81", "0.50", "0.55", "0.12", "0.70", "δ = 0.05"):
        assert literal in md, f"preregistration.md missing the frozen literal {literal!r}"


# --------------------------------------------------------------------------- #
# Head + capacity-match params: the frozen one-way-door arithmetic (.json == recomputed == .md)
# --------------------------------------------------------------------------- #
def test_head_param_counts_frozen():
    pins = _load("preregistration.json")["analyst_pins"]
    pw = pins["edge_head"]["param_count"]
    il = pins["item_level_ablation_head"]["param_count"]
    # recompute from the pinned shapes: 3104->256->1 + 15x32 type-pair table; 768->1024->1
    assert pw == 15 * 32 + (3104 * 256 + 256) + (256 * 1 + 1) == 795617
    assert il == (768 * 1024 + 1024) + (1024 * 1 + 1) == 788481
    assert abs(il - pw) / pw <= pins["item_level_ablation_head"]["capacity_match_tolerance"] == 0.05
    assert pins["edge_head"]["hidden_width"] == 256
    assert pins["item_level_ablation_head"]["hidden_width"] == 1024
    md = _read("preregistration.md")
    assert "795,617" in md and "788,481" in md  # the human authority carries the same counts


# --------------------------------------------------------------------------- #
# The seam-falsification metric is PINNED (AM-1/FC-1: no post-hoc forking on which metric)
# --------------------------------------------------------------------------- #
def test_seam_metric_is_pinned_to_pair_level_auc():
    pins = _load("preregistration.json")["analyst_pins"]
    il = pins["item_level_ablation_head"]
    assert "AUC_catalog_pair - AUC_pair_item_level" in il["seam_metric"]
    assert "AUC_catalog_pair - AUC_pair_item_level" in il["seam_claim_rule"]
    fw = pins["family_wise_correction"]
    assert any("AUC_catalog_pair - AUC_pair_item_level" in r for r in fw["seam_claim_requires"])
    # the schema carries the matching item-level pair-AUC field the diff needs
    props = _load("metrics.schema.json")["properties"]
    assert "AUC_pair_item_level" in props and "seam_diff_pairwise_minus_item_level" in props


# --------------------------------------------------------------------------- #
# Embedding fields agree between the prereg and the embedding manifest; cache staged to C3
# --------------------------------------------------------------------------- #
def test_embedding_freeze_agrees():
    p = _load("preregistration.json")["embedding"]
    m = _load("embedding_manifest_fashionsiglip.json")
    assert p["revision_sha"] == m["revision_sha"] == "c56244cc94f92419e8369fa71efdaf403b124ce8"
    assert p["embedding_dim"] == m["embedding_dim"] == 768
    assert p["preprocess_sha256"] == m["preprocess_hash"]
    assert p["normalization"] == m["normalization"] == "l2"
    assert m["dtype"] == "float32"
    # Cache-content fields stage to C3/B2 (the one-time FashionSigLIP embedding pass). Accept BOTH the
    # pre-B2 state (all null — a fresh checkout with the cache deferred) AND the post-B2 state (all
    # populated + well-formed — after build_cache_and_select ran and the manifest is committed). A PARTIAL
    # population is a corrupt/interrupted cache build and fails loud. (The config fields above stay frozen
    # either way — that is the load-bearing C2 freeze this test guards.)
    import re as _re

    staged = m["_freeze"]["c3_staged_cache_fields"]
    populated = [f for f in staged if m[f] is not None]
    if populated:
        assert set(populated) == set(staged), (
            f"partial embedding-cache population — {sorted(set(staged) - set(populated))} still null "
            f"(a corrupt/interrupted C3 build; re-run build_cache_and_select)"
        )
        assert isinstance(m["n_items"], int) and m["n_items"] > 0
        for f in ("ids_list_sha256", "image_hashes_sha256", "embeddings_content_sha256"):
            assert _re.fullmatch(r"[0-9a-f]{64}", m[f]), f"{f} is not a sha256 ({m[f]!r})"
    # device is RECORDED, not VERIFIED (a faster mps/cuda pass is allowed, §5)
    assert "device" not in m["_freeze"]["c2_verified_config_fields"]
    assert "device" in m["_freeze"]["c2_recorded_fields"]


# --------------------------------------------------------------------------- #
# type_map.json freeze: enum + overrides + C2-resolved rows (hermetic — loader ignores data_root)
# --------------------------------------------------------------------------- #
def test_type_map_enum_overrides_and_resolved_rows():
    doc = _load("type_map.json")
    assert doc["_enum"] == [*dl.FIVE_TYPES, dl.EXCLUDED]
    assert doc["_version"] == "h26-c2-frozen"
    cats = dl.load_type_map()  # the loader path — no dataset needed (reads the committed file)
    assert all(r["type"] in (*dl.FIVE_TYPES, dl.EXCLUDED) for r in cats.values())
    # the production-match overrides, pinned exactly (a new/changed override fails until re-verified)
    overrides = {cid: r["type"] for cid, r in cats.items() if "override_reason" in r}
    assert overrides == {"18": "top", "256": "outer_layer", "289": "outer_layer"}
    # the three C2-resolved formerly-ambiguous rows (prereg §E)
    for cid, t in {"30": "dress", "281": "dress", "1607": "outer_layer", "4457": "outer_layer"}.items():
        assert cats[cid]["type"] == t, f"C2-resolved row {cid} must be {t!r}"


# --------------------------------------------------------------------------- #
# fitb_manifest allocation + metrics.schema required set
# --------------------------------------------------------------------------- #
def test_fitb_allocation_and_schema_required():
    manifest = _load("fitb_manifest.json")
    assert manifest["constructor_source_sha256"] == _sha256("data_loader.py")
    assert manifest["type_map_sha256"] == _sha256("type_map.json")
    a = manifest["allocation"]
    assert a["gate_D"]["name"] == "fitb_trained_full"
    assert a["gate_B"]["cap"] == 500 and a["gate_B"]["pilot_prefix"] == 100
    required = set(_load("metrics.schema.json")["required"])
    assert required == {
        "_meta",
        "AUC_catalog_pair", "AUC_zero_shot_cosine", "gate_A_diff",
        "fitb_trained_gateB", "fitb_judge_gateB",
        "gate_B_diff_inconsistent_miss", "gate_B_diff_inconsistent_half",
        "outfit_auc", "fitb_trained_full",
    }


def test_judge_addendum_schema_is_the_c4_freeze_pin():
    # preregistration.json names judge_addendum_schema "pinned_at_C4"; this is that pin. It must enforce
    # the load-bearing freeze invariants (§1/§8): frozen=true (so a scaffold is refused), temperature 0,
    # the calibration set's actual-human + judge-only-use + disjoint-from-both-gated-sets contract, and
    # image_only as a required arm (the gate-B comparator).
    s = _load("judge_addendum.schema.json")
    props = s["properties"]
    assert props["frozen"]["const"] is True
    assert props["temperature"]["const"] == 0
    assert "image_only" in props["arms"]["contains"]["const"]
    cal = props["calibration_set"]["properties"]
    assert cal["label_kind"]["const"] == "actual_human_forced_choice"
    assert cal["single_annotator"]["const"] is False          # amended 2026-07-01: a diverse PANEL, not one owner
    assert cal["n_annotators"]["minimum"] == 3
    assert "inter_annotator_agreement" in cal                 # the panel's human-agreement ceiling (§F)
    assert cal["size"]["minimum"] == 50
    assert set(cal["disjoint_from"]["items"]["enum"]) == {"gate_B_set", "gate_D_full_fitb"}
    assert "frozen" in s["required"] and "prompt_sha256" in s["required"] and "calibration_set" in s["required"]
    # the prereg mirror records that this schema is the C4 pin (un-edited frozen artifact)
    assert _load("preregistration.json")["unlock_validation"]["judge_addendum_schema"] == "pinned_at_C4"


def test_committed_judge_addendum_is_still_a_scaffold():
    # The committed judge_addendum.md MUST stay a scaffold (frozen:false) until the RUN-phase pilot
    # freezes it — so the repo can never accidentally ship a "frozen" addendum with placeholder hashes
    # (the freeze is a deliberate, blind, post-pilot act — §1). evaluate.extract_envelope reads the
    # first ```json block; the unlock refuses it precisely because frozen is false.
    import re as _re

    md = _read("judge_addendum.md")
    block = _re.search(r"```json\s*\n(.*?)\n```", md, _re.DOTALL)
    assert block is not None, "judge_addendum.md must carry a machine-readable ```json envelope block"
    import json as _json

    env = _json.loads(block.group(1))
    assert env["frozen"] is False, "the committed addendum must be an UNFROZEN scaffold until the C4 pilot"


def test_scaffold_freezes_to_a_schema_valid_envelope():
    # The scaffold must be freezable by filling ONLY the per-run fields the RUN recipe lists — that yields
    # a schema-valid frozen envelope. This pins scaffold<->schema<->recipe consistency: if a FIXED field
    # (drop_policy/payload_logging_policy/calibration_set.source) is left as a FILL placeholder, or
    # the recipe's fill-list drifts, freezing per the recipe would silently fail gate-b's schema gate.
    # (A real regression this guards — the recipe once told the operator to "leave the *_policy" fields
    # while they were still FILL placeholders that the schema rejects.)
    import json as _json

    import jsonschema

    env = _json.loads(re.search(r"```json\s*\n(.*?)\n```", _read("judge_addendum.md"), re.DOTALL).group(1))
    validator = jsonschema.Draft202012Validator(_load("judge_addendum.schema.json"))
    assert not validator.is_valid(env), "the committed addendum must be an unfrozen scaffold (schema-refused)"
    # Fill ONLY the genuinely per-run fields (the recipe's fill-list) — nothing else.
    env["frozen"] = True
    env["model_snapshot"] = "gpt-5.4-mini-2026-03-17"
    env["k_samples"], env["max_tokens"], env["retry_budget"] = 3, 16, 2
    env["prompt_sha256"] = "a" * 64
    env["calibration_set"]["manifest_sha256"] = "b" * 64
    env["calibration_set"]["size"] = 60                        # per-run: the surviving consensus count
    env["calibration_set"]["n_annotators"] = 3                 # per-run: the panel size (>=3)
    env["calibration_set"]["inter_annotator_agreement"] = 0.9
    env["above_chance_pilot"] = {"image_only_fitb_point": 0.55, "image_only_fitb_ci_low": 0.31, "above_chance": True}
    env["commit_hash"] = "c" * 40
    leftover = ["/".join(map(str, e.absolute_path)) for e in validator.iter_errors(env)]
    assert not leftover, f"per-run-only freeze still fails the schema at {leftover} — a FIXED field is still a placeholder"


def test_unlock_and_selection_schema_are_frozen():
    p = _load("preregistration.json")
    assert p["unlock_validation"]["closet_manifest_schema"] == "closet_manifest.schema.json"
    assert p["unlock_validation"]["record_hashes_in_metrics_json"] is True
    assert p["selection_schema"] == "selection.schema.json"

    metrics_schema = _load("metrics.schema.json")
    meta = metrics_schema["properties"]["_meta"]
    assert set(meta["required"]) == {
        "stage", "seed", "split_loader", "git_commit", "unlock_files", "selection",
    }
    unlock = meta["properties"]["unlock_files"]
    assert set(unlock["required"]) == {
        "preregistration.md",
        "preregistration.json",
        "judge_addendum.md",
        "closet_manifest.json",
    }
    unlock_file = metrics_schema["$defs"]["unlock_file"]
    assert set(unlock_file["required"]) == {"path", "git_blob_sha", "sha256", "validated"}
    assert unlock_file["properties"]["validated"]["const"] is True
    selection_meta = meta["properties"]["selection"]
    assert selection_meta["properties"]["path"]["const"] == "selection.json"
    assert selection_meta["properties"]["schema"]["const"] == "selection.schema.json"
    assert set(selection_meta["required"]) == {
        "path",
        "schema",
        "git_blob_sha",
        "sha256",
        "validated",
        "checkpoint_id",
        "checkpoint_sha256",
    }
    assert len(metrics_schema["allOf"]) == 2

    closet_schema = _load("closet_manifest.schema.json")
    assert "label_audit" in closet_schema["required"]
    assert closet_schema["properties"]["items"]["minItems"] == 1
    assert closet_schema["properties"]["outfits"]["minItems"] == 1
    item_schema = closet_schema["properties"]["items"]["items"]
    assert item_schema["properties"]["polyvore_category_id"]["anyOf"][0]["pattern"] == "^[0-9]{1,4}$"
    assert item_schema["allOf"][0]["then"]["required"] == ["coarsening_note"]

    selection_schema = _load("selection.schema.json")
    assert selection_schema["properties"]["training_config"]["additionalProperties"] is False
    assert set(selection_schema["properties"]["manifest_hashes"]["required"]) == {
        "preregistration_json_sha256",
        "fitb_manifest_sha256",
        "embedding_manifest_sha256",
        "type_map_sha256",
    }
    sealed = selection_schema["$defs"]["sealedString"]["not"]["anyOf"]
    assert any("[Aa][Uu][Cc]" in rule["pattern"] and "[Ll][Oo][Ss][Ss]" in rule["pattern"] for rule in sealed)
    assert any("[0-9]+\\.[0-9]+" == rule["pattern"] for rule in sealed)
    leak = "epoch7_valid_auc_0.91_loss_0.12"
    assert any(re.search(rule["pattern"], leak) for rule in sealed)
    forbidden = next(iter(selection_schema["patternProperties"]))
    assert "[Aa][Uu][Cc]" in forbidden and "[Ll][Oo][Ss][Ss]" in forbidden
