"""Independent C3 breaker checks, synthetic fixture and fake model only."""

import json

import pytest

import embed_bundle as subject
from gate import GateRefusal
from test_embed_bundle import BLUE_ID, RED_ID, fake, source  # noqa: F401


def test_bound_clearance_cannot_embed_mutated_parsed_sample(source, fake):
    source[0].rows[0]["label"] = "rejected"
    with pytest.raises(GateRefusal, match="changed"):
        subject.embed_bundle(*source)
    assert not fake[1]


def test_bound_clearance_cannot_embed_changed_disk_manifest(source, fake):
    path = source[0].root / "manifest.json"
    path.write_bytes(path.read_bytes() + b" ")
    with pytest.raises(GateRefusal, match="changed"):
        subject.embed_bundle(*source)
    assert not fake[1]


def test_inventory_rejects_image_ref_filename_disagreement(source):
    source[0].clusters[0].items[0]["imageFile"] = f"images/{BLUE_ID}.png"
    with pytest.raises(subject.EmbeddingError, match="image ID"):
        subject._inventory(source[0])


def test_inventory_rejects_symlink_image_escape(source, tmp_path):
    image = source[0].root / "images" / f"{RED_ID}.jpg"
    outside = tmp_path / f"{RED_ID}.jpg"
    outside.write_bytes(image.read_bytes())
    image.unlink()
    image.symlink_to(outside)
    with pytest.raises(Exception, match="escapes"):
        subject._inventory(source[0])


def test_inventory_preserves_rephotographed_garment_bindings(source):
    # This inventory is intentionally unscored: the secondary separately rejects
    # ambiguous garment identity; primary occurrences retain exact image IDs.
    original = source[0].clusters[0].items[0]
    source[0].rows.append({"items": [{**original, "imageRef": f"mongo:{BLUE_ID}",
                                    "imageFile": f"images/{BLUE_ID}.png"}]})
    _, bindings = subject._inventory(source[0])
    assert bindings[original["itemId"]] == [RED_ID, BLUE_ID]


@pytest.mark.parametrize("field,value", [
    ("image_ids", [BLUE_ID, RED_ID]), ("revision_sha", "wrong"),
    ("preprocess_hash", "wrong"), ("dtype", "float64"),
])
def test_cache_manifest_identity_drift_cannot_reuse_matrix(source, fake, field, value):
    subject.embed_bundle(*source)
    path = source[0].root / "bundle.embedding_manifest.json"
    manifest = json.loads(path.read_text())
    manifest[field] = value
    path.write_text(json.dumps(manifest))
    with pytest.raises(subject.EmbeddingError, match="drift"):
        subject.embed_bundle(*source)


def test_interrupted_cache_write_is_never_reused(source, fake):
    subject.embed_bundle(*source)
    (source[0].root / "bundle.embedding_manifest.json").unlink()
    with pytest.raises(subject.EmbeddingError, match="incomplete"):
        subject.embed_bundle(*source)


def test_model_failure_cannot_publish_partial_cache(source, fake, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("synthetic model failure")
    monkeypatch.setattr(subject, "embed_images", broken)
    with pytest.raises(RuntimeError, match="synthetic model failure"):
        subject.embed_bundle(*source)
    assert not (source[0].root / "bundle.embeddings.npy").exists()
    assert not (source[0].root / "bundle.embedding_manifest.json").exists()
