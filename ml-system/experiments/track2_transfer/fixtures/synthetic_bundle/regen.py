#!/usr/bin/env python3
"""Regenerate the deterministic synthetic Track-2 bundle rows and test images.

The fixture contains no real-user material.  Its committed JSONL exercises the
same 26/26 eligibility trigger in Python and JavaScript; generated image bytes
are ignored and exist only for embedding rehearsals.
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
GENERATED = ROOT / "generated" / "images"
USERS = ("friend_alpha", "friend_beta")
ARMS = ("accepted", "rejected")


def _item(user_idx: int, arm_idx: int, row_idx: int, slot: int) -> dict:
    item_id = f"u{user_idx}-a{arm_idx}-r{row_idx:02d}-i{slot}"
    image_id = f"{user_idx + 1:02x}{arm_idx + 1:02x}{row_idx + 1:04x}{slot + 1:02x}".ljust(24, "0")
    clothing_type = "top" if slot == 0 else "bottom"
    return {
        "itemId": item_id,
        "role": "base_top" if slot == 0 else "base_bottom",
        "name": f"Synthetic {clothing_type} {item_id}",
        "clothingType": clothing_type,
        "colorTags": ["synthetic"],
        "imageRef": f"mongo:{image_id}",
        "imageFile": f"images/{image_id}.png",
        "imageStatus": "resolved",
    }


def rows() -> list[dict]:
    out: list[dict] = []
    for user_idx, user in enumerate(USERS):
        for arm_idx, arm in enumerate(ARMS):
            for row_idx in range(13):
                out.append({
                    "snapshotId": f"s-{user_idx}-{arm_idx}-{row_idx:02d}",
                    "candidateId": "c0",
                    "user": user,
                    "occasion": "synthetic",
                    "intent": "rehearsal",
                    "seedDate": "2026-01-01",
                    "generationIndex": 0,
                    "generator": {"provider": "fixture"},
                    "template": "two_piece",
                    "styleMove": None,
                    "items": [_item(user_idx, arm_idx, row_idx, 0), _item(user_idx, arm_idx, row_idx, 1)],
                    "label": arm,
                    "feedbackReason": None,
                    "labeledAt": "2026-01-01T00:00:00.000Z",
                })
    # A fabricated operator account proves that exclusions flow through both runtimes.
    for arm_idx, arm in enumerate(ARMS):
        out.append({
            "snapshotId": f"s-operator-{arm_idx}", "candidateId": "c0", "user": "operator_fixture",
            "occasion": "synthetic", "intent": "rehearsal", "seedDate": "2026-01-01",
            "generationIndex": 0, "generator": {"provider": "fixture"}, "template": "two_piece",
            "styleMove": None,
            "items": [_item(8, arm_idx, 0, 0), _item(8, arm_idx, 0, 1)],
            "label": arm, "feedbackReason": None, "labeledAt": "2026-01-01T00:00:00.000Z",
        })
    return out


def main() -> None:
    fixture_rows = rows()
    encoded = "".join(json.dumps(row, separators=(",", ":"), sort_keys=True) + "\n" for row in fixture_rows)
    (ROOT / "training_examples.jsonl").write_text(encoded, encoding="utf-8")
    (ROOT / "generated").mkdir(parents=True, exist_ok=True)
    (ROOT / "generated" / "training_examples.jsonl").write_text(encoded, encoding="utf-8")
    GENERATED.mkdir(parents=True, exist_ok=True)
    for row_no, row in enumerate(fixture_rows):
        for slot, item in enumerate(row["items"]):
            target = GENERATED.parent / item["imageFile"]
            target.parent.mkdir(parents=True, exist_ok=True)
            color = ((row_no * 37 + slot * 83) % 256, (row_no * 71 + 40) % 256, (slot * 101 + 80) % 256)
            Image.new("RGB", (32, 24), color).save(target, format="PNG")
    print(f"wrote {len(fixture_rows)} rows and synthetic images under {ROOT}")


if __name__ == "__main__":
    main()
