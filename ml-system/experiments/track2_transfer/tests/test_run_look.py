"""Synthetic-only tests of the C6 stage order and record contract."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bundle import load_bundle
from gate import check_look_trigger
import run_look


FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "synthetic_bundle"


def clearance(tmp_path):
    bundle = load_bundle(FIXTURE)
    return check_look_trigger(
        bundle, look=1, as_of="2026-09-26", looks_dir=tmp_path / "looks"
    )


def test_stage_order_embeds_and_prepares_before_first_score(tmp_path):
    permit = clearance(tmp_path)
    calls = []

    def catalog():
        calls.append("catalog")
        return object(), {"checkpoint_sha256": "sealed"}, {"status": "bit-bound"}

    def embed(bundle, gate, *, out_dir):
        calls.append("embed")
        manifest = {
            "revision_sha": "revision", "preprocess_hash": "preprocess",
            "embeddings_content_sha256": "matrix-hash",
            "backbone_key": "fashion", "open_clip_id": "model",
            "pretrained": "weights", "image_hashes": {"image": "hash"},
            "image_files": {"image": "images/image.png"},
            "item_image_bindings": {"item": ["image"]},
        }
        (out_dir / "bundle.embedding_manifest.json").write_text(json.dumps(manifest))
        return SimpleNamespace(manifest=manifest)

    def prepare(gate):
        calls.append("prepare")
        return [object(), object(), object()]

    def score(gate, embeddings, head):
        calls.append("score")
        return {
            "primary": {"point": 0.6, "low": 0.51, "high": 0.7, "verdict": "ESTABLISHED"},
            "cosine": {}, "excluded": {}, "cluster_scores": {},
        }

    def transfer(gate, embeddings, head):
        calls.append("transfer")
        return {"per_friend": {"friend_alpha": {}, "friend_beta": {}}, "excluded": {"operator_fixture": {}}}

    _, provenance = run_look.execute_stages(
        permit, cache_dir=tmp_path, catalog_fn=catalog, embed_fn=embed,
        prepare_fn=prepare, score_fn=score, transfer_fn=transfer,
    )
    assert calls == ["catalog", "embed", "prepare", "score", "transfer"]
    assert provenance["checkpoint_sha256"] == "sealed"
    assert provenance["image_hashes"] == {"image": "hash"}


def test_prepare_failure_prevents_every_score(tmp_path):
    permit = clearance(tmp_path)
    calls = []

    def catalog():
        calls.append("catalog")
        return object(), {"checkpoint_sha256": "sealed"}, {}

    def embed(bundle, gate, *, out_dir):
        calls.append("embed")
        return object()

    def prepare(gate):
        calls.append("prepare")
        raise ValueError("ambiguous binding")

    def forbidden(*args, **kwargs):
        calls.append("SCORED")
        raise AssertionError("score stage was reached")

    try:
        run_look.execute_stages(
            permit, cache_dir=tmp_path, catalog_fn=catalog, embed_fn=embed,
            prepare_fn=prepare, score_fn=forbidden, transfer_fn=forbidden,
        )
    except ValueError as exc:
        assert "ambiguous" in str(exc)
    else:
        raise AssertionError("prepare failure was swallowed")
    assert calls == ["catalog", "embed", "prepare"]


def test_analysis_sample_and_record_are_strict_json(tmp_path):
    permit = clearance(tmp_path)
    sample = run_look.analysis_sample(permit.bundle, look=1, as_of="2026-09-26")
    assert sample["bundle_hashes"] == permit.bundle.content_hashes
    assert sample["snapshot_ids"] == sorted(sample["snapshot_ids"])
    assert len(sample["scoreable_clusters"]) == 54
    record = run_look.build_record(
        permit.bundle, permit,
        {"primary": {"verdict": "ESTABLISHED"}, "cosine": {}, "excluded": {},
         "secondary": {}, "cluster_scores": {}},
        {"pipeline_hashes": {}}, rehearsal=True, decommissioned=None,
        implementation_commit="abc",
    )
    encoded = json.dumps(record, allow_nan=False)
    assert '"rehearsal": true' in encoded
    assert record["export_counts"]["labelsWithoutTrainingExample"] == 0
    assert record["exclusion_trust_boundary"]["users"]["operator_fixture"]["reason"] == "operator"
    target = tmp_path / "record.json"
    run_look._atomic_json(target, record)
    assert json.loads(target.read_text()) == record
    assert not list(tmp_path.glob(".*.tmp"))


def test_look_two_sample_ledger_cannot_collide_with_frozen_look_one(tmp_path):
    look1 = run_look.analysis_sample_path(tmp_path, 1)
    look2 = run_look.analysis_sample_path(tmp_path, 2)
    assert look1 == tmp_path / "analysis_sample.json"
    assert look2 == tmp_path / "look2_analysis_sample.json"
    assert look1 != look2
    with pytest.raises(run_look.LookExecutionError, match="look 1 or 2"):
        run_look.analysis_sample_path(tmp_path, 3)


def test_cli_requires_real_bundle_and_explicit_date():
    with pytest.raises(SystemExit, match="real look requires"):
        run_look.main(["--as-of", "2026-09-26"])


def test_local_photo_rehearsal_uses_gate_and_private_bundle(tmp_path):
    from PIL import Image

    source = tmp_path / "closet"
    source.mkdir()
    Image.new("RGB", (8, 8), "red").save(source / "a.jpg")
    Image.new("RGB", (8, 8), "blue").save(source / "b.png")
    observed = {}

    def fake_embed(bundle, permit, *, out_dir):
        from gate import require_clearance

        assert require_clearance(permit) is bundle
        observed["bundle"] = bundle
        observed["out_dir"] = out_dir
        manifest = {"embeddings_content_sha256": "real-photo-hash"}
        return SimpleNamespace(ids=["a", "b"], manifest=manifest)

    output = tmp_path / "private"
    report = run_look.rehearse_local_photos(
        as_of="2026-09-26", source_dir=source, template_root=FIXTURE,
        output_dir=output, embed_fn=fake_embed,
    )
    assert report == {
        "status": "passed", "source_photos": 2, "embedded_unique_images": 2,
        "embedding_content_sha256": "real-photo-hash", "private_output": str(output),
    }
    assert observed["out_dir"] == output
    assert len(list((output / "images").iterdir())) == 2
    assert observed["bundle"].certificate["scoreableClusters"] == {
        "acceptedScoreable": 26, "rejectedScoreable": 26,
        "transferAcceptedScoreable": 26,
    }


def test_local_photo_rehearsal_skips_loudly_when_absent(tmp_path, capsys):
    report = run_look.rehearse_local_photos(
        as_of="2026-09-26", source_dir=tmp_path / "missing",
        template_root=FIXTURE, output_dir=tmp_path / "private",
    )
    assert report["status"] == "skipped"
    assert "skipped" in capsys.readouterr().err
