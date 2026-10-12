"""The once-only, pre-score Track-2 Look gate."""

from __future__ import annotations

import hashlib
import json
import subprocess
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path

from bundle import (
    Bundle, BundleError, _assert_certificate_agreement, _load_json,
    derive_certificate, file_sha256, manifest_excluded_users,
)
from constants import CONCENTRATION_CAP, HORIZON, PRIMARY_MIN_LOOK1, PRIMARY_MIN_LOOK2


class GateRefusal(RuntimeError):
    def __init__(self, message: str, *, verdict: str | None = None):
        super().__init__(message)
        self.verdict = verdict
        self.terminal = verdict is not None


_TOKEN = object()


@dataclass(frozen=True, init=False)
class LookClearance:
    bundle: Bundle
    look: int
    as_of: str
    allow_no_operator: bool
    effective_horizon: str
    verification: bool
    _fingerprint: str

    def __init__(self, *, _token=None, **kwargs):
        if _token is not _TOKEN:
            raise GateRefusal("LookClearance is issued only by the gate")
        for key, value in kwargs.items():
            object.__setattr__(self, key, value)
        object.__setattr__(self, "_fingerprint", _bundle_fingerprint(self.bundle))

    @classmethod
    def _issue(cls, token: object, **kwargs):
        if token is not _TOKEN:
            raise GateRefusal("LookClearance is issued only by check_look_trigger")
        return cls(_token=token, **kwargs)


def _bundle_fingerprint(bundle: Bundle) -> str:
    content = {
        "root": str(bundle.root), "manifest": bundle.manifest, "rows": bundle.rows,
        "excluded": sorted(bundle.excluded_users), "certificate": bundle.certificate,
        "clusters": [asdict(c) for c in bundle.clusters],
        "content_hashes": bundle.content_hashes,
    }
    return hashlib.sha256(json.dumps(content, sort_keys=True, allow_nan=False).encode()).hexdigest()


def require_clearance(clearance: LookClearance, bundle: Bundle | None = None) -> Bundle:
    if type(clearance) is not LookClearance or not hasattr(clearance, "_fingerprint"):
        raise GateRefusal("scoring requires a gate-issued LookClearance")
    if bundle is not None and bundle is not clearance.bundle:
        raise GateRefusal("clearance belongs to a different bundle")
    if clearance._fingerprint != _bundle_fingerprint(clearance.bundle):
        raise GateRefusal("bundle changed after Look clearance")
    _check_disk_hashes(clearance.bundle)
    return clearance.bundle


def _check_disk_hashes(bundle: Bundle) -> None:
    try:
        current = {name: file_sha256(bundle.root / name) for name in bundle.content_hashes}
    except OSError as exc:
        raise GateRefusal("bundle file disappeared after loading") from exc
    if current != bundle.content_hashes:
        raise GateRefusal("bundle files changed after loading")


def _recheck_bundle(bundle: Bundle) -> dict:
    _check_disk_hashes(bundle)
    excluded = manifest_excluded_users(bundle.manifest)
    cert, clusters = derive_certificate(bundle.rows, excluded)
    _assert_certificate_agreement(cert, bundle.manifest.get("yield"))
    if excluded != bundle.excluded_users or cert != bundle.certificate or clusters != bundle.clusters:
        raise BundleError("bundle eligibility state changed; reload the export")
    return cert


def _prior_record(ledger: Path) -> dict:
    prior = ledger / "look1_record.json"
    if not prior.is_file():
        raise GateRefusal("Look 2 requires a committed Look-1 record")
    # Bind both existence and bytes to HEAD. A staged, dirty, or untracked record
    # cannot spend the second look's alpha.
    try:
        root = Path(subprocess.check_output(
            ["git", "-C", str(ledger), "rev-parse", "--show-toplevel"], stderr=subprocess.DEVNULL,
            text=True,
        ).strip())
        relative = prior.resolve().relative_to(root.resolve()).as_posix()
        committed = subprocess.check_output(
            ["git", "-C", str(root), "show", f"HEAD:{relative}"], stderr=subprocess.DEVNULL,
        )
        if committed != prior.read_bytes():
            raise GateRefusal("Look-1 record differs from committed HEAD")
        record = _load_json(prior)
    except (OSError, ValueError, subprocess.CalledProcessError, BundleError) as exc:
        raise GateRefusal("Look 2 requires an unchanged committed Look-1 record") from exc
    if not isinstance(record, dict) or record.get("look") != 1 or record.get("rehearsal") is not False:
        raise GateRefusal("Look 2 requires a real, valid Look-1 record")
    primary = record.get("primary")
    verdict = primary.get("verdict") if isinstance(primary, dict) else None
    if verdict == "ESTABLISHED":
        raise GateRefusal("Look 2 is forbidden after an ESTABLISHED Look 1")
    if verdict not in {"NOT-ESTABLISHED", "NOT-ESTABLISHED (keep collecting)",
                       "NOT-ESTABLISHED (proceed to Look 2)",
                       "NOT-ESTABLISHED (underpowered)", "NOT-ESTABLISHED (well-powered null)",
                       "suggestive", "SUGGESTIVE", "SUGGESTIVE (LOFO-sensitive)"}:
        raise GateRefusal("Look 2 requires a valid non-ESTABLISHED Look-1 verdict")
    return record


def check_look_trigger(
    bundle: Bundle,
    *,
    look: int,
    as_of: str,
    looks_dir: str | Path,
    allow_no_operator: bool = False,
    decommissioned: str | None = None,
) -> LookClearance:
    if type(look) is not int or look not in (1, 2):
        raise GateRefusal("look must be 1 or 2")
    try:
        analysis_date = date.fromisoformat(as_of)
        frozen_horizon = date.fromisoformat(HORIZON)
        effective_horizon = min(frozen_horizon, date.fromisoformat(decommissioned)) if decommissioned else frozen_horizon
    except (ValueError, TypeError) as exc:
        raise GateRefusal(f"invalid ISO date: {exc}") from exc
    operator_ids = bundle.manifest.get("exclusions", {}).get("operatorAuthIds") or []
    if not isinstance(operator_ids, list) or any(not isinstance(uid, str) or not uid.strip() for uid in operator_ids):
        raise GateRefusal("operatorAuthIds must be a list of nonempty ids")
    if not operator_ids and not allow_no_operator:
        raise GateRefusal("bundle has no operator exclusion; use --allow-no-operator only if all operator accounts were erased")
    cert = _recheck_bundle(bundle)
    counts = cert["scoreableClusters"]
    floor = PRIMARY_MIN_LOOK1 if look == 1 else PRIMARY_MIN_LOOK2
    cap = cert["concentration"]
    ledger = Path(looks_dir)
    record = ledger / f"look{look}_record.json"
    if record.exists():
        raise GateRefusal(f"{record} already exists; use --verify, never a fresh look")
    if look == 2:
        _prior_record(ledger)
    n = min(counts["acceptedScoreable"], counts["rejectedScoreable"])
    if n < floor:
        terminal_verdict = None
        if analysis_date >= effective_horizon:
            terminal_verdict = "UNDERPOWERED-TERMINAL" if n < PRIMARY_MIN_LOOK1 else "NOT-ESTABLISHED (underpowered)"
        state = terminal_verdict or "UNDERPOWERED — keep collecting"
        raise GateRefusal(f"Look {look} floor {floor}/arm not met ({counts}); {state}", verdict=terminal_verdict)
    if cert["friends"] < 2 or cap["acceptedMaxShare"] > CONCENTRATION_CAP or cap["rejectedMaxShare"] > CONCENTRATION_CAP or not cap["capOk"]:
        raise GateRefusal(f"UNDERPOWERED — concentration cap failed: {cap}")
    return LookClearance._issue(
        _TOKEN, bundle=bundle, look=look, as_of=as_of, allow_no_operator=allow_no_operator,
        effective_horizon=effective_horizon.isoformat(), verification=False,
    )


def verify_record_clearance(
    bundle: Bundle, *, look: int, as_of: str, looks_dir: str | Path,
    expected_record: dict,
) -> LookClearance:
    """Reproduction permission bound to an existing record and the exact sample.

    This is intentionally a distinct entry point, not a skip-ledger flag on the
    fresh-look gate. The caller must compare all reproduced statistics to this
    record and must never overwrite it.
    """
    if type(look) is not int or look not in (1, 2):
        raise GateRefusal("look must be 1 or 2")
    path = Path(looks_dir) / f"look{look}_record.json"
    try:
        record = _load_json(path)
    except (OSError, ValueError, BundleError) as exc:
        raise GateRefusal("verify requires an existing valid look record") from exc
    if not isinstance(record, dict) or record != expected_record:
        raise GateRefusal("verify record changed since it was loaded")
    if record.get("look") != look or record.get("as_of") != as_of:
        raise GateRefusal("verify look/date does not match the record")
    if type(record.get("rehearsal")) is not bool or type(record.get("allow_no_operator")) is not bool:
        raise GateRefusal("verify requires recorded rehearsal and operator-override flags")
    _check_disk_hashes(bundle)
    expected_hashes = bundle.content_hashes or {name: file_sha256(bundle.root / name)
                       for name in ("manifest.json", "training_examples.jsonl")}
    if record.get("bundle_hashes") != expected_hashes:
        raise GateRefusal("verify bundle hashes do not match the recorded sample")
    if record.get("snapshot_ids") != sorted({row["snapshotId"] for row in bundle.rows}):
        raise GateRefusal("verify snapshot IDs do not match the recorded sample")
    cert = _recheck_bundle(bundle)
    operator_ids = bundle.manifest.get("exclusions", {}).get("operatorAuthIds")
    if not isinstance(operator_ids, list) or any(not isinstance(uid, str) or not uid.strip() for uid in operator_ids):
        raise GateRefusal("operatorAuthIds must be a list of nonempty ids")
    if not operator_ids and not record["allow_no_operator"]:
        raise GateRefusal("record does not authorize an empty operator exclusion")
    floor = PRIMARY_MIN_LOOK1 if look == 1 else PRIMARY_MIN_LOOK2
    if min(cert["scoreableClusters"][key] for key in ("acceptedScoreable", "rejectedScoreable")) < floor:
        raise GateRefusal("verify cannot score an under-floor terminal record")
    if cert["friends"] < 2 or not cert["concentration"]["capOk"]:
        raise GateRefusal("verify concentration cap failed")
    if look == 2:
        _prior_record(Path(looks_dir))
    try:
        date.fromisoformat(as_of)
        decommissioned = record.get("decommissioned")
        horizon = min(date.fromisoformat(HORIZON), date.fromisoformat(decommissioned)) if decommissioned else date.fromisoformat(HORIZON)
    except (TypeError, ValueError) as exc:
        raise GateRefusal("invalid recorded analysis date or decommission date") from exc
    return LookClearance._issue(
        _TOKEN, bundle=bundle, look=look, as_of=as_of,
        allow_no_operator=record["allow_no_operator"],
        effective_horizon=horizon.isoformat(), verification=True,
    )
