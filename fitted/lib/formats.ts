/**
 * Single home for the cross-runtime identifier/format regexes.
 *
 * These MUST agree byte-for-behavior with `ml-system/service/app.py` (`_OBJECT_ID_RE`,
 * `_SEED_DATE_RE`, `_UUID_V4_RE`, `_ULID_RE`). They were previously hand-copied into four TS files;
 * one copy drifted (a blanket `/i` that also accepted a lowercase ULID the service rejects). Homing
 * them here removes the drift surface, and the shared accept/reject vectors in
 * `contract_fields.json` (`crossRuntime.formats`) pin BOTH runtimes to the same behavior.
 */

/** A Mongo ObjectId hex string (24 hex, either case). */
export const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/** A UTC calendar date `YYYY-MM-DD` (shape only — not a real-date check). */
export const SEED_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A requestId is one of two shapes. The two alternatives are SEPARATE regexes so `/i` (hex is
// case-insensitive) applies to the UUIDv4 only — the ULID alternative is UPPERCASE Crockford
// base32, matching Python's `_ULID_RE` (no IGNORECASE) and the GenerationSnapshot validator.
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True iff `v` is a §C.4 requestId: an uppercase ULID or a UUIDv4. Callers enforce the ≤64 length. */
export function isValidRequestId(v: string): boolean {
  return ULID_RE.test(v) || UUID_V4_RE.test(v);
}
