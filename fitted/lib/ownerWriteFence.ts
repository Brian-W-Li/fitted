import type { ClientSession } from "mongoose";

export const OWNER_WRITE_TIMEOUT_MS = 20_000;
export class OwnerWriteUnavailable extends Error {
  constructor() { super("Account no longer accepts writes"); }
}
export class StyleMemoryRevisionChanged extends Error {
  constructor() { super("Style memory changed while preparing these outfits"); }
}
export interface OwnerWriteModel {
  db: { startSession(): Promise<ClientSession> };
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options: { session: ClientSession }): PromiseLike<{ matchedCount: number }>;
}

/** Same-owner conflict with the durable erasure barrier. Only retryable database work
 * belongs in write; prepare stable payloads first and keep external effects outside.
 * The explicit session must also reach the row operation. No ordinary-write fallback.
 */
export async function ownerWriteFence<T>(
  User: OwnerWriteModel, user: unknown, write: (session: ClientSession) => Promise<T>,
  expectedStyleMemoryRevision?: number,
): Promise<T> {
  const session = await User.db.startSession();
  try {
    return await session.withTransaction(async () => {
      const owner = await User.updateOne(
        { _id: user, erasureStarted: { $ne: true },
          ...(expectedStyleMemoryRevision === undefined ? {} : expectedStyleMemoryRevision === 0
            ? { $or: [{ styleMemoryRevision: 0 }, { styleMemoryRevision: { $exists: false } }] }
            : { styleMemoryRevision: expectedStyleMemoryRevision }) },
        { $inc: { imageWriteVersion: 1 } }, { session },
      );
      if (!owner.matchedCount) {
        if (expectedStyleMemoryRevision !== undefined) throw new StyleMemoryRevisionChanged();
        throw new OwnerWriteUnavailable();
      }
      return await write(session);
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, timeoutMS: OWNER_WRITE_TIMEOUT_MS });
  } finally { await session.endSession(); }
}
