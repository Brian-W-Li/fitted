import { Types, type ClientSession } from "mongoose";
import { ownerWriteFence, type OwnerWriteModel } from "@/lib/ownerWriteFence";
/**
 * M5 snapshot write path (C5, seam #5) — the blocking, on-the-critical-path GenerationSnapshot
 * write with §C.4 idempotency.
 *
 * The write is awaited before the browser response (§A): a duplicate `requestId` must return the
 * WINNER's shown set, and a failed/rejected write must degrade rather than hand back a binding
 * token for a row that never persisted. On the partial unique index `{user, requestId}` a
 * duplicate insert throws `E11000`; the route re-reads the winner by `{user, requestId}` and
 * replays its shown set — one corpus row per render, idempotent response.
 *
 * Writes go through `.create()` only — NEVER `bulkWrite`, which bypasses the immutability + delete
 * middleware (GenerationSnapshot.ts). The doc carries a pre-allocated `_id` (= the snapshotId Next
 * minted and returned to the client as the feedback-binding token) so the row's identity is fixed
 * before the write.
 *
 * Reference: docs/plans/m5-cutover.md §A write posture + §C.4 idempotency.
 */

/** Mongo duplicate-key error code — the partial unique index firing on a repeat {user, requestId}. */
export function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === 11000
  );
}

/** A structural slice of the GenerationSnapshot model this path needs (so tests + the route can
 *  pass the real model without a hard import cycle). */
export interface SnapshotWriteModel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create(docs: Record<string, unknown>[], options: { session: ClientSession; timestamps: false }): Promise<any[]>;
  collection: { listIndexes(options: { maxTimeMS: number }): { toArray(): Promise<SnapshotIndex[]> } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findOne(filter: Record<string, unknown>): { lean(): Promise<any> };
}

interface SnapshotIndex {
  key: Record<string, unknown>; unique?: boolean; sparse?: boolean;
  partialFilterExpression?: { requestId?: { $type?: unknown } };
  collation?: { locale?: string };
}
export async function requireSnapshotWriteIndex(model: SnapshotWriteModel): Promise<void> {
  const indexes = await model.collection.listIndexes({ maxTimeMS: 5_000 }).toArray();
  if (!indexes.some(index => index.unique === true && !index.sparse &&
    (!index.collation || index.collation.locale === "simple") &&
    Object.keys(index.key).join(",") === "user,requestId" && index.key.user === 1 && index.key.requestId === 1 &&
    JSON.stringify(index.partialFilterExpression) === JSON.stringify({ requestId: { $type: "string" } }))) {
    throw new Error("Snapshot write uniqueness is not ready");
  }
}

export interface WriteSnapshotResult<T> {
  /** The persisted snapshot — the freshly-created row, or (on a duplicate) the re-read winner. */
  snapshot: T;
  /** true iff this request lost the idempotency race and we replayed the existing winner. */
  deduped: boolean;
}

/**
 * Create the snapshot, resolving a duplicate-`requestId` race to the winner (§C.4).
 *
 * `doc` must already be the fully-merged document (service payload + the TS merge fields: `_id`,
 * `user`, `interactionCountAtRequest`, per-item evidence). `user` + `requestId` are passed
 * explicitly for the winner re-read key — they must equal `doc.user` / `doc.requestId`.
 */
export async function writeSnapshotWithIdempotency<T>(
  model: SnapshotWriteModel,
  doc: Record<string, unknown>,
  user: unknown,
  requestId: string,
  User: OwnerWriteModel,
): Promise<WriteSnapshotResult<T>> {
  const owner = String(user).toLowerCase();
  const payloadOwner = String(doc.user).toLowerCase();
  if (!/^[a-f0-9]{24}$/.test(owner) || !/^[a-f0-9]{24}$/.test(payloadOwner) ||
      typeof requestId !== "string" || !requestId || typeof doc.requestId !== "string" ||
      payloadOwner !== owner || doc.requestId !== requestId) {
    throw new Error("Snapshot owner/requestId do not match write identity");
  }
  await requireSnapshotWriteIndex(model);
  const timestamp = new Date();
  const payload = { ...doc, _id: doc._id ?? new Types.ObjectId(), createdAt: doc.createdAt ?? timestamp, updatedAt: doc.updatedAt ?? timestamp };
  try {
    const [snapshot] = await ownerWriteFence(User, user, session => model.create([payload], { session, timestamps: false }));
    return { snapshot: snapshot as T, deduped: false };
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    // The failed transaction has completed abort before this lookup. The winner persisted under this {user, requestId}. Re-read + replay.
    const winner = (await model.findOne({ user, requestId }).lean()) as T | null;
    if (!winner) {
      // The unique index fired but no winner is readable — a real anomaly, not a normal retry.
      throw err;
    }
    return { snapshot: winner, deduped: true };
  }
}
