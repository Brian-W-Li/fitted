"""Step-3 tooling: assemble a schema-valid `closet_manifest.json` from your photos + plain labels (§10/§14).

You provide ~15-25 real worn outfits: photos under `closet/` (gitignored) + a simple `closet_input.json`
listing each outfit's garments with a 5-value `clothing_type`, a `fine_label_human` (plain English), and
a `photo` filename. This module maps each garment to the **Polyvore fine `category_id`** the catalog
negatives key on (taxonomy-match — the transfer drop is only like-for-like if both sides draw
same-fine-category negatives from the same tree, §10), computes tamper-evident photo `sha256`s, fills
the consent + label-audit blocks, and validates against `closet_manifest.schema.json` + the C4
referential checks before writing. `suggest_categories` helps pick the right `category_id`.

    .venv/bin/python -c "import assemble_closet as a; a.suggest('shoes', 'boot')"   # find category_ids
    # fill closet_input.json (copy closet_input.template.json), photos under closet/
    .venv/bin/python assemble_closet.py                                            # -> closet_manifest.json

Photos never leave your machine (gitignored); only the manifest commits. Reference:
docs/plans/h26-compatibility-spike-v2.md §10 / §14; the template closet_manifest.template.json.
"""

from __future__ import annotations

import hashlib
import json
import os
import re

from data_loader import load_json_strict

ROOT_DIR = os.path.dirname(__file__)
CLOSET_DIR = os.path.join(ROOT_DIR, "closet")            # gitignored photos
INPUT_PATH = os.path.join(ROOT_DIR, "closet_input.json")
OUT_PATH = os.path.join(ROOT_DIR, "closet_manifest.json")
REFERENCE = os.path.join(ROOT_DIR, "closet_category_reference.json")
FIVE_TYPES = ("top", "bottom", "dress", "outer_layer", "shoes")


def suggest(clothing_type: str, query: str = "", *, reference: str = REFERENCE) -> list[tuple[str, list[str]]]:
    """List `(category_id, fine_names)` in `closet_category_reference.json` matching a 5-type + optional
    substring — so you pick the fine category whose negatives match the catalog's (taxonomy-match, §10)."""
    ref = load_json_strict(reference)["categories"]
    hits = [
        (cid, row.get("fines", []))
        for cid, row in ref.items()
        if row.get("type") == clothing_type and (not query or any(query.lower() in f.lower() for f in row.get("fines", [])))
    ]
    for cid, fines in hits:
        print(f"  category_id {cid}: {', '.join(fines)}")
    return hits


def _photo_sha256(closet_dir: str, filename: str) -> str:
    with open(os.path.join(closet_dir, filename), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def assemble_closet(
    closet_input: dict, *, closet_dir: str = CLOSET_DIR, reference: str = REFERENCE,
) -> dict:
    """Build the `closet_manifest.json` dict from the simple `closet_input` (pure but for reading photo
    bytes to hash). Validates each garment's `clothing_type` + `category_id`, maps outfit membership,
    and carries consent + label-audit. Raises on an unknown type, a category_id absent from the
    reference, or a missing photo — fail loud before writing an invalid manifest."""
    ref_ids = set(load_json_strict(reference)["categories"])
    items: list[dict] = []
    outfits: list[dict] = []
    seen: set[str] = set()
    for o in closet_input["outfits"]:
        item_ids: list[str] = []
        for g in o["items"]:
            iid = g["item_id"]
            item_ids.append(iid)
            if iid in seen:
                continue                                # a garment worn in >1 outfit -> declare once
            seen.add(iid)
            ctype = g["clothing_type"]
            if ctype not in FIVE_TYPES:
                raise ValueError(f"item {iid!r} has invalid clothing_type {ctype!r}")
            cid = g.get("polyvore_category_id")
            if cid is not None and cid not in ref_ids:
                raise ValueError(f"item {iid!r} category_id {cid!r} absent from the reference (use suggest())")
            note = g.get("coarsening_note")
            if cid is None and not note:
                raise ValueError(f"item {iid!r} has no category_id — set a coarsening_note (§10)")
            items.append({
                "item_id": iid,
                "clothing_type": ctype,
                "polyvore_category_id": cid,
                "fine_label_human": g["fine_label_human"],
                "photo_path": f"closet/{g['photo']}",
                "photo_sha256": _photo_sha256(closet_dir, g["photo"]),
                "coarsening_note": note,
            })
        outfits.append({"set_id": o["set_id"], "item_ids": item_ids})

    consent = closet_input.get("consent", {})
    # The §10 single-annotator label audit is an integrity guard (a mislabel drives an invalid
    # same-category negative on the load-bearing transfer measurement), so DON'T silently default it to a
    # passing audit when omitted — that would let the committed manifest assert an audit that never
    # happened. Require an explicit block with real values; fail loud otherwise (same fail-loud posture as
    # every other invalid input above). The schema still enforces second_pass_completed:true + the ranges.
    audit = closet_input.get("label_audit")
    required_audit = {"second_pass_completed", "items_rechecked", "agreement_rate"}
    if not isinstance(audit, dict) or not required_audit <= set(audit):
        raise ValueError(
            "closet_input needs an explicit label_audit block with second_pass_completed + items_rechecked "
            "+ agreement_rate (assemble_closet will not default to a passing audit — §10 label-audit integrity)"
        )
    owner_id = consent.get("owner_id", closet_input.get("owner_id", ""))
    # §14 PII guard: owner_id is committed VERBATIM into the public closet_manifest.json, so refuse a
    # value that carries a real identity — whitespace (a name) or an email-like token. Use an opaque
    # token (owner_a / owner_01). Empty is left to the schema; this catches the identity-leak shapes.
    if re.search(r"\s", owner_id) or re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", owner_id):
        raise ValueError(
            f"owner_id {owner_id!r} looks like a real identity (whitespace or email) — use an opaque "
            f"token like 'owner_a'/'owner_01', never a name/email (§14 closet PII guard)"
        )
    return {
        "_schema_version": 1,
        "_consent": {
            "owner_id": owner_id,
            "third_party_api_processing": consent.get("third_party_api_processing", False),
            "providers_photos_may_reach": consent.get("providers_photos_may_reach", []),
        },
        "_taxonomy": {
            "fine_category_key": "polyvore_category_id",
            "reference": "closet_category_reference.json",
            "coarsening_policy": "null category_id -> coarsening_note; those edges reported separately (§10)",
        },
        "label_audit": {
            "second_pass_completed": audit["second_pass_completed"],
            "items_rechecked": audit["items_rechecked"],
            "agreement_rate": audit["agreement_rate"],
        },
        "items": items,
        "outfits": outfits,
    }


def validate(manifest: dict, *, root_dir: str = ROOT_DIR) -> None:
    """Schema-validate + run the C4 referential checks (the same `evaluate.py` runs at unlock), so a bad
    manifest fails here rather than at emission time."""
    import jsonschema

    from evaluate import closet_referential_checks

    schema = json.load(open(os.path.join(root_dir, "closet_manifest.schema.json"), encoding="utf-8"))
    jsonschema.Draft202012Validator(schema).validate(manifest)
    closet_referential_checks(manifest, load_json_strict(os.path.join(root_dir, "closet_category_reference.json")))


def main() -> None:
    closet_input = load_json_strict(INPUT_PATH)
    manifest = assemble_closet(closet_input)
    validate(manifest)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    print(f"[closet] wrote {OUT_PATH}: {len(manifest['items'])} items / {len(manifest['outfits'])} outfits (schema + referential valid)")
    print("[closet] photos stay under closet/ (gitignored); commit only closet_manifest.json.")


if __name__ == "__main__":
    main()
