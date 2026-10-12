"""Certificate parity and dedup checks using exclusively synthetic examples."""

import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bundle import BundleError, derive_certificate, load_bundle


def test_synthetic_fixture_rows_regenerate_byte_identically():
    """The committed cross-runtime rows are the generator's exact deterministic bytes."""
    import importlib.util

    fixture = Path(__file__).resolve().parents[1] / "fixtures" / "synthetic_bundle"
    spec = importlib.util.spec_from_file_location("track2_fixture_regen", fixture / "regen.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    encoded = "".join(
        json.dumps(row, separators=(",", ":"), sort_keys=True) + "\n"
        for row in module.rows()
    )
    assert encoded.encode() == (fixture / "training_examples.jsonl").read_bytes()

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "synthetic_bundle"


def test_shared_js_fixture_certificate_agrees():
    bundle = load_bundle(FIXTURE)
    assert bundle.certificate["scoreableClusters"] == bundle.manifest["yield"]["scoreableClusters"]
    assert bundle.certificate["perUser"] == bundle.manifest["yield"]["perUser"]


def example(snapshot="z", label="accepted", user="friend"):
    return {"user": user, "snapshotId": snapshot, "candidateId": "candidate", "label": label,
            "items": [{"itemId": "top", "clothingType": "top", "imageStatus": "resolved"},
                      {"itemId": "bottom", "clothingType": "bottom", "imageStatus": "resolved"}]}


def test_dedup_keeps_both_arms_and_lexicographic_representative():
    rows = [example(), example("a"), example("r", "rejected")]
    rows[1]["items"][0]["clothingType"] = "dress"
    certificate, clusters = derive_certificate(rows, set())
    assert certificate["scoreableClusters"] == {"acceptedScoreable": 1, "rejectedScoreable": 1,
                                                  "transferAcceptedScoreable": 0}
    assert clusters[0].snapshot_id == "a"
    assert clusters[0].items[0]["clothingType"] == "dress"


def test_primary_eligibility_does_not_require_transfer_negative():
    certificate, _ = derive_certificate([example()], set())
    assert certificate["scoreableClusters"]["acceptedScoreable"] == 1
    assert certificate["scoreableClusters"]["transferAcceptedScoreable"] == 0


def test_unresolved_and_excluded_rows_do_not_count_in_primary():
    unresolved = example("unresolved")
    unresolved["items"][0]["imageStatus"] = "missing"
    certificate, clusters = derive_certificate([unresolved, example("operator", user="operator")], {"operator"})
    assert certificate["scoreableClusters"]["acceptedScoreable"] == 0
    assert len(clusters) == 1  # retained only for the separate operator report


def test_transfer_depth_uses_all_rendered_items_but_dedups_ids():
    other = example("other", None)
    other["items"][0]["itemId"] = "second-top"
    other["items"][0]["imageStatus"] = "missing"
    certificate, _ = derive_certificate([example(), other], set())
    assert certificate["scoreableClusters"]["transferAcceptedScoreable"] == 1
    other["items"][0]["itemId"] = "top"
    assert derive_certificate([example(), other], set())[0]["scoreableClusters"]["transferAcceptedScoreable"] == 0


def test_duplicate_latest_state_identity_is_invalid():
    with pytest.raises(BundleError, match="latest-state"):
        derive_certificate([example(), example(label="rejected")], set())


@pytest.mark.parametrize("clothing_type", [None, "hat"])
def test_invalid_scoreable_clothing_type_aborts(clothing_type):
    row = example()
    row["items"][0]["clothingType"] = clothing_type
    with pytest.raises(BundleError, match="clothingType"):
        derive_certificate([row], set())


def test_strict_json_and_image_path_containment(tmp_path):
    bundle = load_bundle(FIXTURE)
    with pytest.raises(BundleError, match="escapes"):
        bundle.image_path({"imageFile": "../outside.png"})
    manifest = copy.deepcopy(bundle.manifest)
    manifest["yield"]["concentration"]["acceptedMaxShare"] = float("nan")
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    (tmp_path / "training_examples.jsonl").write_text("")
    with pytest.raises(BundleError, match="non-finite"):
        load_bundle(tmp_path)
