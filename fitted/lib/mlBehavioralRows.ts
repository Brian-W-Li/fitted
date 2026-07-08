/**
 * M5 behavioral-rows projection (C5, seam #4) — the Mongo → wire projection the SERVICE reduces.
 *
 * Next fetches the RAW behavioral rows (it holds the DB creds; the service is a pure function) and
 * passes them as `behavioralRows`; the service runs the §H Python reducers over them. This module
 * owns the bounded fetch + the projection to the exact row grain the reducers read.
 *
 * The row grain is the drift site the M5 build missed: the reducers read `items` (not `itemIds`)
 * and `perItemFeedback[].{itemId,disliked}`; a projection that renamed either would silently
 * empty the affinity/dislike signals in a green suite. The names are owned cross-runtime by
 * `ml-system/service/contract.py` `REDUCER_ROW_READS` + its mirror `contract_fields.json`
 * `reducerRowReads`; the C5 tests assert (1) this projection EMITS exactly those names and (2) a
 * real Mongo projection driven through the actual Python reducers produces the expected signal —
 * which reddens on a name mismatch on EITHER side.
 *
 * Serialization pin (§H): the wire is verbatim camelCase JSON — ObjectIds → hex strings, Dates →
 * ISO-8601 strings. Numeric epoch timestamps are NOT emitted (ms-vs-s would silently shift the
 * dedup window).
 *
 * Reference: docs/plans/m5-cutover.md §H + §A; ml-system/fitted_core/reducers.py.
 */

// §H reducer scan bounds — mirror of reducers.INTERACTION_ROWS_SCAN_LIMIT / REPETITION_WINDOW_SNAPSHOTS.
// The reducers re-slice to these anyway; bounding the DB read keeps it O(limit), never a full scan.
export const INTERACTION_ROWS_SCAN_LIMIT = 500;
export const REPETITION_WINDOW_SNAPSHOTS = 50;

// ---------------------------------------------------------------------------
// Wire shapes (camelCase; membership owned by contract_fields.json reducerRowReads).
// ---------------------------------------------------------------------------
export interface PerItemFeedbackWire {
  itemId: string;
  disliked: boolean;
}
export interface InteractionRowWire {
  action: string;
  createdAt: string; // ISO-8601
  snapshotId: string;
  candidateId: string;
  baseKey: string;
  fullSignature: string;
  items: string[]; // hex item ids
  perItemFeedback: PerItemFeedbackWire[];
}
export interface SnapshotRowWire {
  nSurfaced: number;
  shownFullSignatures: string[];
}
export interface BehavioralRowsWire {
  interactionRows: InteractionRowWire[];
  recentSnapshots: SnapshotRowWire[];
}

// ---------------------------------------------------------------------------
// Structural inputs — a lean OutfitInteraction / GenerationSnapshot doc slice. ObjectId is
// anything with toString(); Date is anything with toISOString().
// ---------------------------------------------------------------------------
type Stringable = { toString(): string } | string | null | undefined;
type Datelike = { toISOString(): string } | string | null | undefined;

export interface InteractionLean {
  action?: string | null;
  createdAt?: Datelike;
  snapshotId?: Stringable;
  candidateId?: string | null;
  baseKey?: string | null;
  fullSignature?: string | null;
  items?: Stringable[];
  perItemFeedback?: Array<{ itemId?: Stringable; disliked?: boolean }> | null;
}
export interface SnapshotLean {
  nSurfaced?: number | null;
  shownFullSignatures?: (string | null | undefined)[];
}

// A minimal structural view of the Mongoose models this module queries (so tests can pass the real
// models and the route passes them from initDatabase, without a hard import cycle).
export interface BehavioralQueryModels {
  OutfitInteraction: BoundedQueryable<InteractionLean>;
  GenerationSnapshot: BoundedQueryable<SnapshotLean>;
}
interface BoundedQueryable<T> {
  find(filter: Record<string, unknown>): {
    sort(spec: Record<string, 1 | -1>): {
      limit(n: number): { lean(): Promise<T[]> };
    };
  };
}

// ---------------------------------------------------------------------------
// Serialization helpers.
// ---------------------------------------------------------------------------
function hex(v: Stringable): string {
  return v == null ? "" : typeof v === "string" ? v : v.toString();
}
function iso(v: Datelike): string {
  if (v == null) return "";
  return typeof v === "string" ? v : v.toISOString();
}

// ---------------------------------------------------------------------------
// Projections (pure — the row grain the reducers read).
// ---------------------------------------------------------------------------
export function projectInteractionRow(row: InteractionLean): InteractionRowWire {
  return {
    action: row.action ?? "",
    createdAt: iso(row.createdAt),
    snapshotId: hex(row.snapshotId),
    candidateId: row.candidateId ?? "",
    baseKey: row.baseKey ?? "",
    fullSignature: row.fullSignature ?? "",
    items: (row.items ?? []).map(hex),
    perItemFeedback: (row.perItemFeedback ?? []).map((f) => ({
      itemId: hex(f.itemId),
      disliked: f.disliked === true,
    })),
  };
}

export function projectSnapshotRow(row: SnapshotLean): SnapshotRowWire {
  return {
    nSurfaced: typeof row.nSurfaced === "number" ? row.nSurfaced : 0,
    shownFullSignatures: (row.shownFullSignatures ?? []).filter(
      (s): s is string => typeof s === "string",
    ),
  };
}

// ---------------------------------------------------------------------------
// Bounded fetch + project. Deterministic same-millisecond tie-break by {createdAt:-1, _id:-1}
// (the index exists on both collections). recentSnapshots reads only nSurfaced>0 (H19 window).
// ---------------------------------------------------------------------------
export async function buildBehavioralRows(
  userId: string | { toString(): string },
  models: BehavioralQueryModels,
): Promise<BehavioralRowsWire> {
  const [interactions, snapshots] = await Promise.all([
    models.OutfitInteraction.find({ user: userId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(INTERACTION_ROWS_SCAN_LIMIT)
      .lean(),
    models.GenerationSnapshot.find({ user: userId, nSurfaced: { $gt: 0 } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(REPETITION_WINDOW_SNAPSHOTS)
      .lean(),
  ]);
  return {
    interactionRows: interactions.map(projectInteractionRow),
    recentSnapshots: snapshots.map(projectSnapshotRow),
  };
}
