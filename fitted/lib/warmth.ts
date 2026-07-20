/**
 * The wardrobe-item warmth band (§6.1/§15.2): an INTEGER 0 (coolest) .. 10 (warmest).
 *
 * Single TS home for the bound — the Mongoose schema (models/WardrobeItem.ts), the render
 * adapter's drop-predicate (lib/mlRequestAdapter.ts), the snapshot validator
 * (lib/mlSnapshotValidation.ts), and the ingestion routes all import from here. The Python
 * side (fitted_core/models.py WARMTH_MIN/WARMTH_MAX) is pinned equal via
 * contract_fields.json crossRuntime.clamps + crossRuntimeContract.test.ts — the adapter's
 * drop-predicate must equal the service's accept-predicate exactly, or one out-of-band row
 * sinks the whole closet service-side.
 *
 * Pure module (no mongoose) — safe to import from client components via the adapter.
 */
export const WARMTH_MIN = 0;
export const WARMTH_MAX = 10;
