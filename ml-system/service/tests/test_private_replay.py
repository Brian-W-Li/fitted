"""Synthetic contract evidence only; no private paths or participant inputs."""
import hashlib
import json

import pytest
from fitted_core.generation import GenerationPrompt
from service.private_replay import PrivateReplayGenerator, private_replay_from_environment


def prepared(tmp_path):
    ids = [f"61000000000000000000000{n}" for n in range(1, 5)]
    def draft(source, members, sentence):
        return {"sourceId": source, "sourceDigest": "a"*64, "jobId": "synthetic", "attemptIndex": 0, "outfitIndex": len(source),
                "outfit": {"items": [{"itemId": members[0], "role": "base_top"}, {"itemId": members[1], "role": "base_bottom"}],
                           "styleMove": {"moveType": "color", "changedItemIds": [members[0]], "oneSentence": sentence}}}
    data = {"version": "private-wardrobe-replay.v1", "provenance": {"kind": "synthetic-contract", "capturedAt": "2026-11-09T00:00:00Z", "subsetCount": 4,
            "currentClosetParity": False, "labelsImported": False, "operatorFeedbackOnly": True, "caveats": [], "sourceDigests": {"returns": "a"*64}},
            "photoRoot": str(tmp_path), "wardrobe": [{"id": ident, "name": "Synthetic garment", "clothingType": "top" if n%2 == 0 else "bottom", "subCategory": None, "colors": ["blue"], "pattern": None, "fit": None, "layerRole": None, "warmth": 5, "isAvailable": True, "photoPath": "synthetic.png", "photoSha256": "b"*64, "photoMime": "image/png"} for n, ident in enumerate(ids)], "factualCorrections": [],
            "drafts": [draft("first", ids[:2], "Original synthetic prose."), draft("duplicate", ids[:2], "Never replace the first composition."), draft("other", ids[2:], "Other intact synthetic prose.")]}
    filename = tmp_path/"fixture.json"; filename.write_text(json.dumps(data)); filename.chmod(0o600)
    audit_dir = tmp_path/"audit"; audit_dir.mkdir(mode=0o700)
    checksum = hashlib.sha256(filename.read_bytes()).hexdigest()
    return ids, data, filename, audit_dir/"selection.jsonl", checksum


def prompt(ids, cap=12):
    return GenerationPrompt("synthetic", "Build believable outfits for this occasion and weather from this wardrobe:\n" + json.dumps([{"id": ident} for ident in ids]) + "\n\nReturn up to 12 outfits.", cap)


def test_first_composition_then_cap_preserves_original_prose_and_source_audit(tmp_path):
    ids, data, filename, audit, checksum = prepared(tmp_path)
    generator = PrivateReplayGenerator(str(filename), str(audit), checksum)
    result = json.loads(generator.generate(prompt(ids, 2)))
    assert result["outfits"] == [data["drafts"][0]["outfit"], data["drafts"][2]["outfit"]]
    event = json.loads(audit.read_text())
    assert [row["sourceId"] for row in event["selected"]] == ["first", "other"]
    assert event["eligibleDistinctCount"] == 2 and event["requestedCap"] == 2
    assert audit.stat().st_mode & 0o077 == 0
    assert json.loads(generator.generate(prompt(ids, 1)))["outfits"] == [data["drafts"][0]["outfit"]]


def test_unavailable_members_are_filtered_and_empty_never_falls_back(tmp_path):
    ids, data, filename, audit, checksum = prepared(tmp_path)
    generator = PrivateReplayGenerator(str(filename), str(audit), checksum)
    assert json.loads(generator.generate(prompt(ids[2:])))["outfits"] == [data["drafts"][2]["outfit"]]
    assert json.loads(generator.generate(prompt(ids[:1])))["outfits"] == []
    with pytest.raises(ValueError, match="uncaptured"):
        generator.generate(prompt(["f"*24]))


def test_missing_changed_or_ambiguous_mode_fails_closed(tmp_path):
    _, _, filename, audit, checksum = prepared(tmp_path)
    assert private_replay_from_environment({}) is None
    with pytest.raises(ValueError, match="complete and exclusive"):
        private_replay_from_environment({"FITTED_PRIVATE_REPLAY_INPUT": str(filename)})
    with pytest.raises(ValueError, match="complete and exclusive"):
        private_replay_from_environment({"FITTED_PRIVATE_REPLAY_INPUT": str(filename), "FITTED_PRIVATE_REPLAY_AUDIT": str(audit), "FITTED_PRIVATE_REPLAY_SHA256": checksum, "FITTED_BASELINE_ITEM_IDS": "synthetic"})
    with pytest.raises(ValueError, match="checksum mismatch"):
        PrivateReplayGenerator(str(filename), str(audit), "0"*64)
    filename.chmod(0o644)
    with pytest.raises(ValueError, match="permissions"):
        PrivateReplayGenerator(str(filename), str(audit), checksum)


def test_label_import_is_rejected_before_generation(tmp_path):
    _, data, filename, audit, _ = prepared(tmp_path)
    data["provenance"]["labelsImported"] = True; filename.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="feedback boundary"):
        PrivateReplayGenerator(str(filename), str(audit), hashlib.sha256(filename.read_bytes()).hexdigest())


@pytest.mark.parametrize("change", [
    {"value": {"labels": [1]}}, {"choices": []}, {"session": {}}, {"features": [1]},
    {"source_ref": {"preference": "hidden"}}, {"field": "taste"}, {"garment_id": "f"*24},
])
def test_factual_corrections_reject_nested_labels_unknown_fields_and_targets(tmp_path, change):
    ids, data, filename, audit, _ = prepared(tmp_path)
    data["factualCorrections"] = [{"correction_id": "synthetic-correction", "owner_id": "synthetic-owner", "garment_id": ids[0],
                                  "field": "name", "value": "Synthetic corrected name", "source": "synthetic test", "source_ref": "synthetic-original", **change}]
    filename.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="factual correction"):
        PrivateReplayGenerator(str(filename), str(audit), hashlib.sha256(filename.read_bytes()).hexdigest())


def test_original_flat_corrections_are_metadata_only(tmp_path):
    ids, data, filename, audit, _ = prepared(tmp_path)
    data["factualCorrections"] = [{"correction_id": "synthetic-correction", "owner_id": "synthetic-owner", "garment_id": ids[0],
                                  "field": "primary_color", "value": "red", "previous_value": "blue", "source": "synthetic test", "source_ref": "synthetic-original"}]
    filename.write_text(json.dumps(data))
    generator = PrivateReplayGenerator(str(filename), str(audit), hashlib.sha256(filename.read_bytes()).hexdigest())
    assert json.loads(generator.generate(prompt(ids)))["outfits"] == [data["drafts"][0]["outfit"], data["drafts"][2]["outfit"]]
