"""Live item content for the judge + the calibration viewer — the gated-parquet image source (§8).

`gpt_judge` defines the `ContentProvider` seam (item_id -> `ItemContent`) and the unit suite mocks it;
this is the **live** implementation both the RUN-phase judge and the Step-2 calibration viewer share. It
streams the raw JPEG bytes for a fixed set of `item_id`s out of the gated `mvasil/polyvore-outfits`
parquet (the same source `embed.py` uses, decode=False so the bytes are the raw source bytes) and reads
the item titles/attributes from the local metadata. `get()` returns base64 image bytes + the item's
`url_name` title + a small structured attribute dict, arm-gated by `gpt_judge.build_messages`.

Pure vs I/O: `item_content_from` (bytes + metadata -> `ItemContent`) is pure + hermetically testable;
`ParquetContentProvider` does the parquet/metadata I/O (lazy `datasets` import). Reference:
docs/plans/h26-compatibility-spike-v2.md §8 (judge arms + the production text fields).
"""

from __future__ import annotations

import base64
import os
from collections.abc import Iterable

from data_loader import load_json_strict
from gpt_judge import ItemContent

DEFAULT_DATA_ROOT = os.path.join(os.path.dirname(__file__), "data", "polyvore_outfits")


def item_content_from(item_id: str, image_bytes: bytes | None, meta: dict | None) -> ItemContent:
    """Assemble one `ItemContent` from raw JPEG bytes + the item's metadata row (pure — no I/O). The
    text arm mirrors the production stylist's *available* Polyvore fields (there is no colors/pattern/
    seasons analog in this corpus, unlike `route.ts`; surface what exists: the item's `url_name` text +
    its `semantic_category`, keyed so the prompt is byte-stable). `image_b64` is None when no bytes are
    supplied (a text-only item)."""
    meta = meta or {}
    url_name = (meta.get("url_name") or "").strip()
    title = url_name or (meta.get("title") or "").strip() or None
    attributes = {"category": meta.get("semantic_category", ""), "name": title or ""}
    return ItemContent(
        item_id=item_id,
        image_b64=base64.b64encode(image_bytes).decode("ascii") if image_bytes else None,
        title=title,
        attributes=attributes,
    )


class ParquetContentProvider:
    """The live `ContentProvider`: pre-loads the raw JPEG bytes for `wanted_ids` from the gated disjoint
    parquet + the item metadata, then serves `ItemContent` from memory. Pre-loading (vs per-item
    streaming) keeps the judge run from re-streaming the ~1.5 GB parquet per question; the working set
    (a few thousand items) fits in memory. Fails loud if a wanted id never resolved (the §2 coverage
    guarantee — the judge must not silently skip a question's item)."""

    def __init__(
        self, wanted_ids: Iterable[str], *, data_root: str = DEFAULT_DATA_ROOT,
        splits: tuple[str, ...] = ("train", "valid", "test"),
    ) -> None:
        self.wanted = set(wanted_ids)
        self._meta = self._load_metadata(data_root)
        self._bytes = self._load_bytes(self.wanted, splits)
        missing = [i for i in self.wanted if i not in self._bytes]
        if missing:
            raise RuntimeError(f"{len(missing)} item_ids did not resolve in the parquet (e.g. {missing[:5]})")

    @staticmethod
    def _load_metadata(data_root: str) -> dict:
        return load_json_strict(os.path.join(data_root, "polyvore_item_metadata.json"))

    @staticmethod
    def _load_bytes(wanted: set[str], splits: tuple[str, ...]) -> dict[str, bytes]:
        from datasets import Image as HFImage
        from datasets import load_dataset

        out: dict[str, bytes] = {}
        for split in splits:
            from embed import HF_DATASET, HF_SPLIT_FOR, ID_COLUMNS

            ds = load_dataset(HF_DATASET, "disjoint", split=HF_SPLIT_FOR[split], streaming=True)
            ds = ds.cast_column("image", HFImage(decode=False))
            id_col = None
            for row in ds:
                if id_col is None:
                    id_col = next(c for c in ID_COLUMNS if c in row)
                iid = str(row[id_col])
                if iid in wanted and iid not in out:
                    raw = row["image"]["bytes"]
                    if raw is not None:
                        out[iid] = raw
            if len(out) >= len(wanted):
                break
        return out

    def get(self, item_id: str) -> ItemContent:
        return item_content_from(item_id, self._bytes.get(item_id), self._meta.get(item_id))

    def data_uri(self, item_id: str) -> str:
        """A `data:image/jpeg;base64,…` URI for the calibration viewer's `<img>` tags."""
        b = self._bytes.get(item_id)
        if not b:
            raise KeyError(f"no image bytes for {item_id!r}")
        return f"data:image/jpeg;base64,{base64.b64encode(b).decode('ascii')}"


def title_for(item_id: str, data_root: str = DEFAULT_DATA_ROOT) -> str:
    """The item's short human label (`url_name`) — a caption helper for tooling/logs (never a logic key)."""
    meta = load_json_strict(os.path.join(data_root, "polyvore_item_metadata.json")).get(item_id, {})
    return (meta.get("url_name") or meta.get("title") or item_id).strip()
