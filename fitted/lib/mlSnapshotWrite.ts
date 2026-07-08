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
  create(doc: Record<string, unknown>): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findOne(filter: Record<string, unknown>): { lean(): Promise<any> };
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
): Promise<WriteSnapshotResult<T>> {
  try {
    const snapshot = (await model.create(doc)) as T;
    return { snapshot, deduped: false };
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    // Lost the race: the winner already persisted under this {user, requestId}. Re-read + replay.
    const winner = (await model.findOne({ user, requestId }).lean()) as T | null;
    if (!winner) {
      // The unique index fired but no winner is readable — a real anomaly, not a normal retry.
      throw err;
    }
    return { snapshot: winner, deduped: true };
  }
}
