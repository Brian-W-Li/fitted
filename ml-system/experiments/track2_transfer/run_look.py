#!/usr/bin/env python3
"""Gated, once-only Track-2 Look executor.

Fresh execution order is deliberately fixed:
gate -> catalog preflight -> decode/embed every friend image -> secondary
input preflight -> primary scoring -> secondary scoring -> atomic records.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import platform
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable

import numpy as np

import h26_bridge as h26
from bundle import Bundle, BundleError, file_sha256, load_bundle
from constants import BOOTSTRAP_B, PRIMARY_CI_LEVEL, SECONDARY_CI_LEVEL, SEED
from embed_bundle import embed_bundle
from gate import (
    GateRefusal,
    check_look_trigger,
    require_clearance,
    verify_record_clearance,
)
from scoring import score_bundle
from transfer_read import prepare_transfer, transfer_read

ROOT = Path(__file__).resolve().parent
LOOKS = ROOT / "looks"
REHEARSAL_OUT = ROOT / "rehearsal_out"
SYNTHETIC_BUNDLE = ROOT / "fixtures" / "synthetic_bundle" / "generated"
LOCAL_PHOTO_ROOT = h26.H26_ROOT / "closet"
PIPELINE_FILES = (
    "constants.py", "bundle.py", "gate.py", "embed_bundle.py", "scoring.py",
    "transfer_read.py", "h26_bridge.py", "run_look.py",
)


class LookExecutionError(RuntimeError):
    pass


def _strict_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        value = json.load(f, parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
    if not isinstance(value, dict):
        raise LookExecutionError(f"{path} must contain a JSON object")
    return value


def _git_head() -> str | None:
    try:
        return subprocess.check_output(
            ["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def _pipeline_hashes() -> dict[str, str]:
    return {name: file_sha256(ROOT / name) for name in PIPELINE_FILES}


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n"
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(encoded, encoding="utf-8")
    os.replace(temporary, path)


def catalog_preflight() -> tuple[Any, dict[str, Any], dict[str, Any]]:
    """Bind the sealed head/cache to the emitted H26 catalog point.

    This runs before any friend image is opened.  It returns the already-loaded
    head so the friend scoring stage cannot silently load a different blob.
    """
    h26.set_determinism(SEED)
    head, selection = h26.load_sealed_pairwise_head(str(h26.H26_ROOT))
    corpus = h26.load_headline_corpus(verbose=False)
    cache = h26.load_cache(h26.HEADLINE)
    edge = h26.head_edge_scorer(head, cache, corpus.item_index)
    pos, neg = h26.catalog_pair_scores(corpus, edge, seed=SEED)
    point = float(h26.auc_pos_neg(pos, neg))
    emitted = _strict_json(h26.H26_ROOT / "metrics.json")["AUC_catalog_pair"]["point"]
    delta = abs(point - float(emitted))
    if delta > 1e-6:
        raise LookExecutionError(
            f"catalog reproduction drift {point!r} vs {emitted!r} (delta {delta:.3g})"
        )
    report = {
        "point": point,
        "emitted_point": float(emitted),
        "absolute_delta": delta,
        "status": "bit-bound" if point == float(emitted) else "within-1e-6 environment caveat",
        "n_positive": int(len(pos)),
        "n_negative": int(len(neg)),
    }
    return head, selection, report


def analysis_sample(bundle: Bundle, *, look: int, as_of: str) -> dict[str, Any]:
    return {
        "schema": "track2-analysis-sample.v1",
        "look": look,
        "as_of": as_of,
        "bundle_hashes": dict(bundle.content_hashes),
        "snapshot_ids": sorted({str(row["snapshotId"]) for row in bundle.rows}),
        "scoreable_clusters": [
            {
                "user": cluster.user,
                "arm": cluster.arm,
                "signature": cluster.signature,
                "snapshot_id": cluster.snapshot_id,
                "candidate_id": cluster.candidate_id,
            }
            for cluster in bundle.clusters
        ],
        "certificate": bundle.certificate,
    }


def analysis_sample_path(output: Path, look: int) -> Path:
    """Return the once-only pre-score sample ledger for a look.

    The frozen preregistration names ``analysis_sample.json`` as Look 1's
    trigger artifact, so that path must remain byte-stable after Look 1.  Look
    2 needs the same interruption-safe freeze without colliding with Look 1's
    committed sample; its additive operational ledger therefore lives beside
    the look record as ``look2_analysis_sample.json``.  This changes no sample,
    gate, metric, or decision rule.
    """
    if look not in (1, 2):
        raise LookExecutionError("analysis sample path requires look 1 or 2")
    return output / ("analysis_sample.json" if look == 1 else "look2_analysis_sample.json")


def rehearse_local_photos(
    *,
    as_of: str,
    source_dir: Path = LOCAL_PHOTO_ROOT,
    template_root: Path = SYNTHETIC_BUNDLE,
    output_dir: Path | None = None,
    embed_fn: Callable = embed_bundle,
) -> dict[str, Any]:
    """Exercise the production image leg on local, gitignored real photos.

    The labels remain the synthetic rehearsal labels and are never scored here.
    A private ignored bundle reuses each source photo across fixture garments, so
    all real bytes pass the same path, decode, EXIF and backbone checks without
    copying or committing those bytes.
    """
    photos = sorted(
        path for path in source_dir.iterdir()
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
    ) if source_dir.is_dir() else []
    if not photos:
        print(f"REHEARSAL NOTE: local-photo leg skipped; no images under {source_dir}", file=sys.stderr)
        return {"status": "skipped", "reason": "local H26 closet absent or empty"}

    target = output_dir or (REHEARSAL_OUT / "local_photo_bundle")
    images_dir = target / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    template = load_bundle(template_root)
    specs = []
    for index, source in enumerate(photos, 1):
        iid = f"{index:024x}"
        suffix = source.suffix.lower()
        destination = images_dir / f"{iid}{suffix}"
        if destination.exists() and file_sha256(destination) != file_sha256(source):
            destination.unlink()
        if not destination.exists():
            try:
                os.link(source, destination)
            except OSError:
                destination.write_bytes(source.read_bytes())
        specs.append((iid, destination.relative_to(target).as_posix(), source))

    rows = copy.deepcopy(template.rows)
    slot = 0
    for row in rows:
        for item in row.get("items", []):
            iid, relative, _ = specs[slot % len(specs)]
            item["imageRef"] = f"mongo:{iid}"
            item["imageFile"] = relative
            item["imageStatus"] = "resolved"
            slot += 1
    encoded = "".join(json.dumps(row, separators=(",", ":"), sort_keys=True) + "\n" for row in rows)
    (target / "training_examples.jsonl").write_text(encoded, encoding="utf-8")
    manifest = copy.deepcopy(template.manifest)
    manifest["imageManifest"] = {
        iid: {"status": "resolved", "file": relative, "contentType": "image/jpeg"}
        for iid, relative, _ in specs
    }
    counts = manifest.setdefault("counts", {})
    counts["imagesReferenced"] = len(specs)
    counts["imagesResolved"] = len(specs)
    counts["imagesUnresolved"] = 0
    _atomic_json(target / "manifest.json", manifest)

    bundle = load_bundle(target)
    clearance = check_look_trigger(
        bundle, look=1, as_of=as_of, looks_dir=target / "ledger"
    )
    embeddings = embed_fn(bundle, clearance, out_dir=target)
    return {
        "status": "passed",
        "source_photos": len(photos),
        "embedded_unique_images": len(embeddings.ids),
        "embedding_content_sha256": embeddings.manifest["embeddings_content_sha256"],
        "private_output": str(target),
    }


def execute_stages(
    clearance,
    *,
    cache_dir: Path,
    catalog_fn: Callable = catalog_preflight,
    embed_fn: Callable = embed_bundle,
    prepare_fn: Callable = prepare_transfer,
    score_fn: Callable = score_bundle,
    transfer_fn: Callable = transfer_read,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Execute the frozen stage order; dependency injection exists only for tests."""
    bundle = require_clearance(clearance)
    head, selection, catalog = catalog_fn()
    embeddings = embed_fn(bundle, clearance, out_dir=cache_dir)
    # Resolve every secondary input ambiguity before the first label score.
    prepared = prepare_fn(clearance)
    primary = score_fn(clearance, embeddings, head)
    secondary = transfer_fn(clearance, embeddings, head)
    if len(prepared) != len(secondary["per_friend"]) + len(secondary["excluded"]):
        raise LookExecutionError("secondary preparation/scoring friend count drift")
    provenance = {
        "checkpoint_sha256": selection["checkpoint_sha256"],
        "backbone_key": embeddings.manifest["backbone_key"],
        "open_clip_id": embeddings.manifest["open_clip_id"],
        "pretrained": embeddings.manifest["pretrained"],
        "backbone_revision_sha": embeddings.manifest["revision_sha"],
        "preprocess_hash": embeddings.manifest["preprocess_hash"],
        "embedding_manifest_sha256": file_sha256(cache_dir / "bundle.embedding_manifest.json"),
        "embedding_content_sha256": embeddings.manifest["embeddings_content_sha256"],
        "image_hashes": embeddings.manifest["image_hashes"],
        "image_files": embeddings.manifest["image_files"],
        "item_image_bindings": embeddings.manifest["item_image_bindings"],
        "seed": SEED,
        "bootstrap_b": BOOTSTRAP_B,
        "primary_ci_level": PRIMARY_CI_LEVEL,
        "secondary_ci_level": SECONDARY_CI_LEVEL,
        "python": platform.python_version(),
        "numpy": np.__version__,
        "torch": __import__("torch").__version__,
        "torch_num_threads": int(__import__("torch").get_num_threads()),
        "pipeline_hashes": _pipeline_hashes(),
        "catalog_crosscheck": catalog,
    }
    return {**primary, "secondary": secondary}, provenance


def build_record(
    bundle: Bundle,
    clearance,
    results: dict[str, Any],
    provenance: dict[str, Any],
    *,
    rehearsal: bool,
    decommissioned: str | None,
    implementation_commit: str | None,
) -> dict[str, Any]:
    return {
        "schema": "track2-look-record.v1",
        "look": clearance.look,
        "as_of": clearance.as_of,
        "rehearsal": rehearsal,
        "allow_no_operator": clearance.allow_no_operator,
        "decommissioned": decommissioned,
        "bundle_hashes": dict(bundle.content_hashes),
        "snapshot_ids": sorted({str(row["snapshotId"]) for row in bundle.rows}),
        "certificate": bundle.certificate,
        "export_counts": bundle.manifest.get("counts", {}),
        "exclusion_trust_boundary": {
            "source": "manifest.yield.excluded.users",
            "users": bundle.manifest.get("yield", {}).get("excluded", {}).get("users", {}),
            "identity_is_manifest_trusted": True,
        },
        "primary": results["primary"],
        "cosine_reference": results["cosine"],
        "operator_excluded": results["excluded"],
        "secondary": results["secondary"],
        "cluster_scores": results["cluster_scores"],
        "provenance": {**provenance, "implementation_commit": implementation_commit},
        "disclosures": {
            "cohort_conditional": True,
            "primary_proxy": "human accept/reject is taste + compatibility",
            "range_restricted": "stylist outputs are already compatibility-filtered",
            "implementation_timing": "executor implemented after Look-1 eligibility, from the committed pre-result design; no friend compatibility score was inspected before the fresh run",
            "secondary_never_gates": True,
        },
    }


def _records_equal(actual: dict[str, Any], expected: dict[str, Any]) -> None:
    if actual != expected:
        a = hashlib.sha256(json.dumps(actual, sort_keys=True).encode()).hexdigest()
        e = hashlib.sha256(json.dumps(expected, sort_keys=True).encode()).hexdigest()
        raise LookExecutionError(f"verification mismatch: reproduced {a}, recorded {e}")


def run(args: argparse.Namespace) -> dict[str, Any]:
    rehearsal = bool(args.rehearsal)
    bundle_path = Path(args.bundle).resolve() if args.bundle else SYNTHETIC_BUNDLE
    output = REHEARSAL_OUT if rehearsal else LOOKS
    if not rehearsal and output.resolve() == REHEARSAL_OUT.resolve():
        raise LookExecutionError("real looks may not write inside rehearsal_out")
    bundle = load_bundle(bundle_path)
    record_path = output / f"look{args.look}_record.json"
    sample_path = analysis_sample_path(output, args.look)

    if args.verify:
        existing = _strict_json(record_path)
        clearance = verify_record_clearance(
            bundle, look=args.look, as_of=args.as_of, looks_dir=output,
            expected_record=existing,
        )
        implementation_commit = existing.get("provenance", {}).get("implementation_commit")
        decommissioned = existing.get("decommissioned")
    else:
        clearance = check_look_trigger(
            bundle, look=args.look, as_of=args.as_of, looks_dir=output,
            allow_no_operator=args.allow_no_operator,
            decommissioned=args.decommissioned,
        )
        decommissioned = args.decommissioned
        implementation_commit = _git_head()
        sample = analysis_sample(bundle, look=args.look, as_of=args.as_of)
        if sample_path.exists():
            if _strict_json(sample_path) != sample:
                raise GateRefusal(f"{sample_path} exists for a different sample")
            # Same frozen sample after a pre-record interruption: deterministic resume,
            # not a new optional look.
        else:
            _atomic_json(sample_path, sample)

    results, provenance = execute_stages(clearance, cache_dir=bundle.root)
    record = build_record(
        bundle, clearance, results, provenance, rehearsal=rehearsal,
        decommissioned=decommissioned,
        implementation_commit=implementation_commit,
    )
    if rehearsal:
        record["rehearsal_real_photo_leg"] = rehearse_local_photos(as_of=args.as_of)
    if args.verify:
        _records_equal(record, existing)
    else:
        _atomic_json(record_path, record)
    return record


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--bundle", help="Track-2 export directory; omitted only for --rehearsal")
    p.add_argument("--as-of", required=False, help="analysis date YYYY-MM-DD")
    p.add_argument("--look", type=int, choices=(1, 2), default=1)
    p.add_argument("--verify", action="store_true")
    p.add_argument("--rehearsal", action="store_true")
    p.add_argument("--allow-no-operator", action="store_true")
    p.add_argument("--decommissioned")
    return p


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if args.rehearsal and args.bundle:
        raise SystemExit("--rehearsal uses the synthetic generated bundle; do not pass --bundle")
    if not args.rehearsal and not args.bundle:
        raise SystemExit("a real look requires --bundle")
    if not args.as_of:
        raise SystemExit("--as-of YYYY-MM-DD is required")
    try:
        record = run(args)
    except (BundleError, GateRefusal, LookExecutionError, ValueError, OSError) as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    primary = record["primary"]
    print(json.dumps({
        "look": record["look"], "rehearsal": record["rehearsal"],
        "verdict": primary["verdict"], "auc": primary["point"],
        "ci": [primary["low"], primary["high"]],
        "record": str((REHEARSAL_OUT if record["rehearsal"] else LOOKS) / f"look{record['look']}_record.json"),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
