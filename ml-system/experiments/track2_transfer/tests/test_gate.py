"""Synthetic-only adversarial tests of the alpha fence; never load real exports."""

import copy
import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bundle import Bundle, BundleError, derive_certificate, file_sha256, load_bundle
from gate import GateRefusal, LookClearance, check_look_trigger, require_clearance, verify_record_clearance


def synthetic_bundle(tmp_path, sizes=(9, 8, 8), rejected_sizes=None):
    rows = []
    for arm, arm_sizes in (("accepted", sizes), ("rejected", rejected_sizes or sizes)):
        for friend, count in enumerate(arm_sizes):
            for i in range(count):
                identity = f"{friend}-{arm}-{i}"
                rows.append({
                    "user": f"friend-{friend}", "label": arm,
                    "snapshotId": identity, "candidateId": "candidate",
                    "items": [{"itemId": f"{identity}-{j}", "clothingType": "top",
                               "imageStatus": "resolved", "imageFile": f"images/{identity}-{j}.png"}
                              for j in range(2)],
                })
    cert, clusters = derive_certificate(rows, set())
    manifest = {"bundleVersion": "track2-export.v1",
                "exclusions": {"operatorAuthIds": ["synthetic-operator"]},
                "yield": copy.deepcopy(cert)}
    return Bundle(tmp_path, manifest, rows, set(), cert, clusters)


def run_gate(bundle, tmp_path, **kwargs):
    return check_look_trigger(bundle, look=kwargs.pop("look", 1),
                              as_of=kwargs.pop("as_of", "2026-09-26"),
                              looks_dir=tmp_path / "looks", **kwargs)


def commit_prior(tmp_path, verdict="NOT-ESTABLISHED", **fields):
    ledger = tmp_path / "looks"
    ledger.mkdir(exist_ok=True)
    record = {"look": 1, "rehearsal": False, "primary": {"verdict": verdict}, **fields}
    (ledger / "look1_record.json").write_text(json.dumps(record))
    for args in (["init", "-q"], ["add", "looks/look1_record.json"],
                 ["-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                  "-c", "commit.gpgsign=false", "commit", "-qm", "synthetic prior"]):
        subprocess.run(["git", "-C", str(tmp_path), *args], check=True, capture_output=True)
    return ledger / "look1_record.json"


def test_exact_floor_clears_and_cannot_construct_directly(tmp_path):
    bundle = synthetic_bundle(tmp_path)
    clearance = run_gate(bundle, tmp_path)
    assert require_clearance(clearance) is bundle
    with pytest.raises(GateRefusal):
        LookClearance(bundle=bundle, look=1, as_of="2026-09-26", allow_no_operator=False)
    with pytest.raises(GateRefusal):
        require_clearance(object())


@pytest.mark.parametrize("sizes,rejected", [((8, 8, 8), (9, 8, 8)), ((9, 8, 8), (8, 8, 8))])
def test_floor_minus_one_refuses_each_arm(tmp_path, sizes, rejected):
    with pytest.raises(GateRefusal, match="25/arm"):
        run_gate(synthetic_bundle(tmp_path, sizes, rejected), tmp_path)


@pytest.mark.parametrize("sizes", [(51, 49), (25,)])
def test_concentration_and_single_friend_refuse(tmp_path, sizes):
    with pytest.raises(GateRefusal, match="concentration cap"):
        run_gate(synthetic_bundle(tmp_path, sizes), tmp_path)


def test_empty_operator_override_is_explicit_and_recorded(tmp_path):
    bundle = synthetic_bundle(tmp_path)
    bundle.manifest["exclusions"]["operatorAuthIds"] = []
    with pytest.raises(GateRefusal, match="operator exclusion"):
        run_gate(bundle, tmp_path)
    assert run_gate(bundle, tmp_path, allow_no_operator=True).allow_no_operator is True


@pytest.mark.parametrize("ids", ["fake-id", [""], [7]])
def test_malformed_operator_id_list_refuses(tmp_path, ids):
    bundle = synthetic_bundle(tmp_path)
    bundle.manifest["exclusions"]["operatorAuthIds"] = ids
    with pytest.raises(GateRefusal):
        run_gate(bundle, tmp_path)


def test_gate_rederives_even_if_bundle_loader_agreement_was_bypassed(tmp_path):
    bundle = synthetic_bundle(tmp_path)
    bundle.manifest["yield"]["scoreableClusters"]["acceptedScoreable"] += 1
    with pytest.raises(BundleError, match="disagreement"):
        run_gate(bundle, tmp_path)


def test_offsetting_per_friend_drift_refuses(tmp_path):
    bundle = synthetic_bundle(tmp_path)
    per_user = bundle.manifest["yield"]["perUser"]
    per_user["friend-0"]["primaryAcceptedScoreable"] += 1
    per_user["friend-1"]["primaryAcceptedScoreable"] -= 1
    with pytest.raises(BundleError, match="perUser"):
        run_gate(bundle, tmp_path)


@pytest.mark.parametrize("section,key,value", [
    ("concentration", "acceptedMaxShare", float("nan")),
    ("concentration", "capOk", 1),
    ("concentration", "cap", 1),
    ("scoreableClusters", "acceptedScoreable", 25.0),
])
def test_malformed_certificate_numbers_fail_closed(tmp_path, section, key, value):
    bundle = synthetic_bundle(tmp_path)
    bundle.manifest["yield"][section][key] = value
    with pytest.raises(BundleError):
        run_gate(bundle, tmp_path)


def test_clearance_rejects_post_gate_mutation_and_other_bundle(tmp_path):
    bundle = synthetic_bundle(tmp_path)
    clearance = run_gate(bundle, tmp_path)
    with pytest.raises(GateRefusal, match="different bundle"):
        require_clearance(clearance, copy.deepcopy(bundle))
    bundle.clusters[0].items[0]["clothingType"] = "dress"
    with pytest.raises(GateRefusal, match="changed"):
        require_clearance(clearance)


def test_fresh_look_refuses_existing_record(tmp_path):
    ledger = tmp_path / "looks"
    ledger.mkdir()
    (ledger / "look1_record.json").write_text("{}")
    with pytest.raises(GateRefusal, match="already exists"):
        run_gate(synthetic_bundle(tmp_path), tmp_path)


def test_look_two_requires_committed_non_established_prior(tmp_path):
    bundle = synthetic_bundle(tmp_path, (25, 25))
    with pytest.raises(GateRefusal, match="committed"):
        run_gate(bundle, tmp_path, look=2)
    prior = commit_prior(tmp_path)
    assert run_gate(bundle, tmp_path, look=2).look == 2
    prior.write_text(prior.read_text() + "\n")
    with pytest.raises(GateRefusal, match="differs"):
        run_gate(bundle, tmp_path, look=2)


@pytest.mark.parametrize("verdict,fields", [("ESTABLISHED", {}), (None, {}),
    ("NOT-ESTABLISHED", {"rehearsal": True}), ("arbitrary", {})])
def test_invalid_or_terminal_prior_refuses_look_two(tmp_path, verdict, fields):
    commit_prior(tmp_path, verdict, **fields)
    with pytest.raises(GateRefusal):
        run_gate(synthetic_bundle(tmp_path, (25, 25)), tmp_path, look=2)


def test_look_two_49_refuses_and_50_passes(tmp_path):
    commit_prior(tmp_path)
    with pytest.raises(GateRefusal, match="50/arm"):
        run_gate(synthetic_bundle(tmp_path, (17, 16, 16)), tmp_path, look=2)
    assert run_gate(synthetic_bundle(tmp_path, (25, 25)), tmp_path, look=2).look == 2


@pytest.mark.parametrize("as_of,terminal", [("2026-10-30", False), ("2026-10-31", True), ("2026-11-01", True)])
def test_horizon_exact_date_is_terminal_per_frozen_prereg(tmp_path, as_of, terminal):
    with pytest.raises(GateRefusal) as error:
        run_gate(synthetic_bundle(tmp_path, (8, 8, 8)), tmp_path, as_of=as_of)
    assert error.value.terminal is terminal
    assert error.value.verdict == ("UNDERPOWERED-TERMINAL" if terminal else None)


def test_horizon_post_look_one_uses_underpowered_verdict(tmp_path):
    commit_prior(tmp_path)
    with pytest.raises(GateRefusal) as error:
        run_gate(synthetic_bundle(tmp_path), tmp_path, look=2, as_of="2026-10-31")
    assert error.value.verdict == "NOT-ESTABLISHED (underpowered)"


@pytest.mark.parametrize("decommissioned,as_of", [("2026-09-26", "2026-09-26"), ("2027-01-01", "2026-10-31")])
def test_decommission_can_only_shorten_horizon(tmp_path, decommissioned, as_of):
    with pytest.raises(GateRefusal) as error:
        run_gate(synthetic_bundle(tmp_path, (8, 8, 8)), tmp_path,
                 decommissioned=decommissioned, as_of=as_of)
    assert error.value.terminal


def test_verify_requires_exact_existing_sample_and_cannot_be_fresh_look(tmp_path):
    bundle = synthetic_bundle(tmp_path)
    (tmp_path / "manifest.json").write_text(json.dumps(bundle.manifest))
    (tmp_path / "training_examples.jsonl").write_text("\n".join(json.dumps(r) for r in bundle.rows))
    record = {"look": 1, "as_of": "2026-09-26", "rehearsal": False, "allow_no_operator": False,
              "bundle_hashes": {name: file_sha256(tmp_path / name)
                                for name in ("manifest.json", "training_examples.jsonl")},
              "snapshot_ids": sorted({r["snapshotId"] for r in bundle.rows})}
    ledger = tmp_path / "looks"
    kwargs = dict(look=1, as_of=record["as_of"], looks_dir=ledger, expected_record=record)
    with pytest.raises(GateRefusal, match="existing"):
        verify_record_clearance(bundle, **kwargs)
    ledger.mkdir()
    (ledger / "look1_record.json").write_text(json.dumps(record))
    assert verify_record_clearance(bundle, **kwargs).verification
    with pytest.raises(GateRefusal, match="already exists"):
        run_gate(bundle, tmp_path)
    (tmp_path / "manifest.json").write_text(json.dumps(bundle.manifest) + "\n")
    with pytest.raises(GateRefusal, match="hashes"):
        verify_record_clearance(bundle, **kwargs)


@pytest.mark.parametrize("changed_file", ["manifest.json", "training_examples.jsonl"])
def test_clearance_binds_loaded_disk_bytes(tmp_path, changed_file):
    fixture = Path(__file__).resolve().parents[1] / "fixtures" / "synthetic_bundle"
    for name in ("manifest.json", "training_examples.jsonl"):
        (tmp_path / name).write_bytes((fixture / name).read_bytes())
    bundle = load_bundle(tmp_path)
    clearance = run_gate(bundle, tmp_path)
    target = tmp_path / changed_file
    target.write_bytes(target.read_bytes() + b"\n")
    with pytest.raises(GateRefusal, match="files changed"):
        require_clearance(clearance)
    with pytest.raises(GateRefusal, match="files changed"):
        run_gate(bundle, tmp_path)
