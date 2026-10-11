"""Hermetic C3 image-leg tests: synthetic bundles and a fake backbone only."""

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

import embed_bundle as subject
from bundle import derive_certificate, load_bundle
from gate import check_look_trigger


FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
RED_ID = "000000000000000000000001"
BLUE_ID = "000000000000000000000002"


@pytest.fixture
def source(tmp_path):
    from PIL import Image

    root = tmp_path / "bundle"
    (root / "images").mkdir(parents=True)
    (root / "images" / f"{RED_ID}.jpg").write_bytes((FIXTURES / "orientation_6.jpg").read_bytes())
    Image.new("RGB", (16, 32), "blue").save(root / "images" / f"{BLUE_ID}.png")
    rows = []
    # Thirteen unique signatures per friend and arm: 26/arm, cap exactly .5.
    for friend in ("synthetic-a", "synthetic-b"):
        for arm in ("accepted", "rejected"):
            for n in range(13):
                rows.append({
                    "user": friend, "label": arm, "snapshotId": f"{friend}-{arm}-{n:02}",
                    "candidateId": "candidate", "items": [
                        {"itemId": f"{friend}-{arm}-{n}-top", "clothingType": "top",
                         "imageStatus": "resolved", "imageRef": f"mongo:{RED_ID}",
                         "imageFile": f"images/{RED_ID}.jpg"},
                        {"itemId": f"{friend}-{arm}-{n}-bottom", "clothingType": "bottom",
                         "imageStatus": "resolved", "imageRef": f"/api/images/{BLUE_ID}",
                         "imageFile": f"images/{BLUE_ID}.png"},
                    ],
                })
    certificate, _ = derive_certificate(rows, set())
    manifest = {"bundleVersion": "track2-export.v1", "yield": certificate,
                "exclusions": {"operatorAuthIds": ["synthetic-operator"]}}
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (root / "training_examples.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    bundle = load_bundle(root)
    clearance = check_look_trigger(bundle, look=1, as_of="2026-09-26", looks_dir=tmp_path / "looks")
    return bundle, clearance


@pytest.fixture
def fake(monkeypatch):
    frozen = json.loads(subject.FROZEN_MANIFEST.read_text())
    loaded = SimpleNamespace(
        backbone=SimpleNamespace(key=frozen["backbone_key"], open_clip_id=frozen["open_clip_id"],
                                 pretrained=frozen["pretrained"]),
        revision_sha=frozen["revision_sha"], preprocess_hash=frozen["preprocess_hash"], device="cpu",
    )
    observed = []

    def embed(backbone, images, batch_size):
        observed.extend(image.copy() for image in images)
        matrix = np.zeros((len(images), frozen["embedding_dim"]), dtype=np.float32)
        matrix[:, 0] = 1.0
        return matrix

    monkeypatch.setattr(subject, "load_backbone", lambda *args, **kwargs: loaded)
    monkeypatch.setattr(subject, "embed_images", embed)
    yield loaded, observed
    for image in observed:
        image.close()


def test_exif_fixture_is_reproducible_and_transposed_before_embedding(source, fake):
    from PIL import Image

    spec = importlib.util.spec_from_file_location("regen_orientation", FIXTURES / "regen_orientation.py")
    generator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(generator)
    assert generator.orientation_bytes() == (FIXTURES / "orientation_6.jpg").read_bytes()
    with Image.open(FIXTURES / "orientation_6.jpg") as stored:
        assert stored.size == (32, 16)
        assert stored.getexif()[274] == 6
    cache = subject.embed_bundle(*source)
    corrected = fake[1][0]
    assert corrected.size == (16, 32)
    assert corrected.mode == "RGB"
    assert corrected.getexif().get(274) is None
    assert corrected.getpixel((8, 4))[0] > 200  # red moves to top
    assert corrected.getpixel((8, 28))[2] > 200  # blue moves to bottom
    assert cache.ids == [RED_ID, BLUE_ID]
    assert cache.matrix.shape == (2, 768)
    assert not cache.matrix.flags.writeable


def test_manifest_hashes_and_cache_reuse_reverify_input_bytes(source, fake, monkeypatch):
    bundle, _ = source
    cache = subject.embed_bundle(*source)
    manifest = cache.manifest
    assert manifest["image_ids"] == [RED_ID, BLUE_ID]
    assert manifest["image_hashes"][RED_ID] == hashlib.sha256(
        (bundle.root / "images" / f"{RED_ID}.jpg").read_bytes()).hexdigest()
    assert manifest["manifest_sha256"] == hashlib.sha256((bundle.root / "manifest.json").read_bytes()).hexdigest()
    assert manifest["embeddings_content_sha256"] == hashlib.sha256(cache.matrix.tobytes()).hexdigest()
    assert manifest["item_image_bindings"]["synthetic-a-accepted-0-top"] == [RED_ID]
    monkeypatch.setattr(subject, "load_backbone", lambda *a, **k: pytest.fail("cache hit loaded weights"))
    np.testing.assert_array_equal(subject.embed_bundle(*source).matrix, cache.matrix)
    image = bundle.root / "images" / f"{RED_ID}.jpg"
    image.write_bytes(image.read_bytes() + b"changed bytes")
    with pytest.raises(subject.EmbeddingError, match="image_hashes drift"):
        subject.embed_bundle(*source)


@pytest.mark.parametrize("field", ["revision_sha", "preprocess_hash"])
def test_loaded_backbone_drift_aborts_without_cache(source, fake, field):
    setattr(fake[0], field, "drift")
    with pytest.raises(subject.EmbeddingError, match=field):
        subject.embed_bundle(*source)
    assert not fake[1]
    assert not list(source[0].root.glob("*.embedding*"))


@pytest.mark.parametrize("field,value", [("revision_sha", "wrong"), ("preprocess_hash", "wrong"),
                                        ("embedding_dim", 769), ("normalization", "none")])
def test_changed_frozen_manifest_aborts(source, fake, monkeypatch, tmp_path, field, value):
    manifest = json.loads(subject.FROZEN_MANIFEST.read_text())
    manifest[field] = value
    path = tmp_path / "fake_frozen_manifest.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr(subject, "FROZEN_MANIFEST", path)
    with pytest.raises(subject.EmbeddingError):
        subject.embed_bundle(*source)
    assert not list(source[0].root.glob("*.embedding*"))


@pytest.mark.parametrize("shape,dtype,value", [((2, 767), "float32", 1), ((1, 768), "float32", 1),
                                              ((2, 768), "float64", 1), ((2, 768), "float32", 0),
                                              ((2, 768), "float32", float("nan"))])
def test_invalid_embedding_matrix_aborts_without_cache(source, fake, monkeypatch, shape, dtype, value):
    matrix = np.zeros(shape, dtype=dtype)
    matrix[:, 0] = value
    monkeypatch.setattr(subject, "embed_images", lambda *a, **k: matrix)
    with pytest.raises(subject.EmbeddingError):
        subject.embed_bundle(*source)
    assert not list(source[0].root.glob("*.embedding*"))


@pytest.mark.parametrize("failure", ["missing", "undecodable"])
def test_last_bad_image_aborts_before_any_model_or_cache_work(source, fake, monkeypatch, failure):
    last = source[0].root / "images" / f"{BLUE_ID}.png"
    if failure == "missing":
        last.unlink()
    else:
        last.write_bytes(b"not an image")
    monkeypatch.setattr(subject, "load_backbone", lambda *a, **k: pytest.fail("model ran before all images decoded"))
    with pytest.raises(subject.EmbeddingError, match="missing or undecodable"):
        subject.embed_bundle(*source)
    assert not fake[1]
    assert not list(source[0].root.glob("*.embedding*"))


def test_clearance_required_before_any_image_access(source, monkeypatch):
    monkeypatch.setattr(subject, "_inventory", lambda *a: pytest.fail("image inventory ran"))
    with pytest.raises(subject.EmbeddingError, match="clearance"):
        subject.embed_bundle(source[0], None)
    with pytest.raises(subject.EmbeddingError, match="clearance"):
        subject.embed_bundle(copy.copy(source[0]), source[1])


def test_cache_matrix_tampering_is_refused(source, fake):
    subject.embed_bundle(*source)
    path = source[0].root / "bundle.embeddings.npy"
    matrix = np.load(path)
    matrix[:, 0] = -1
    np.save(path, matrix)
    with pytest.raises(subject.EmbeddingError, match="content hash"):
        subject.embed_bundle(*source)


def test_cache_still_requires_all_images_to_decode(source, fake):
    subject.embed_bundle(*source)
    (source[0].root / "images" / f"{BLUE_ID}.png").write_bytes(b"broken")
    with pytest.raises(subject.EmbeddingError, match="undecodable"):
        subject.embed_bundle(*source)


@pytest.mark.parametrize("ref", [None, "", "mongo:", "../escape", "/api/images/not-an-id"])
def test_invalid_image_ref_is_refused(ref):
    with pytest.raises(subject.EmbeddingError, match="imageRef"):
        subject.image_id({"itemId": "synthetic", "imageRef": ref})


@pytest.mark.parametrize("ref", [RED_ID, f"mongo:{RED_ID}", f"/api/images/{RED_ID}?v=1"])
def test_export_image_ref_forms(ref):
    assert subject.image_id({"imageRef": ref}) == RED_ID
