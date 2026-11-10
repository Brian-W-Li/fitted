import { createHash } from "crypto";
import { Types, type ClientSession } from "mongoose";
import User from "@/models/User";
import { ownerWriteFence, OwnerWriteUnavailable } from "@/lib/ownerWriteFence";
import { emptyStyleMemory, type StyleContextSelection, type StyleMemoryData, type StyleMemoryResult } from "./contract";
import { parseStyleMemoryCommand, styleId, StyleMemoryError } from "./validation";
import { applyStyleCommand, publicStyleMemory, STYLE_MEMORY_MAX_BYTES, STYLE_MEMORY_NORMAL_RECEIPTS, STYLE_MEMORY_RECEIPTS } from "./state";
import { resolveOwnedStyleContext } from "./context";
import { cleanupStyleMemoryErasure } from "./erase";
export { cleanupStyleMemoryErasure } from "./erase";
export { contextIsVisible } from "./context";
export interface StyleMemoryOwner { data: StyleMemoryData; revision: number }
export async function readStyleMemoryOwner(ownerId: string | Types.ObjectId, session?: ClientSession): Promise<StyleMemoryOwner> {
  const row = await User.collection.findOne({ _id: new Types.ObjectId(styleId(String(ownerId))), erasureStarted: { $ne: true } }, { session, projection: { styleMemory: 1, styleMemoryRevision: 1 } });
  if (!row) throw new StyleMemoryError(410, "account_unavailable", "This account no longer accepts styling changes.");
  return { data: structuredClone((row.styleMemory as StyleMemoryData | undefined) ?? emptyStyleMemory()), revision: row.styleMemoryRevision ?? 0 };
}
export async function resolveStyleContext(ownerId: string | Types.ObjectId, selection: StyleContextSelection,
  options: { session?: ClientSession; allowArchived?: boolean; allowHistoricalVersions?: boolean } = {}) {
  const { data, revision } = await readStyleMemoryOwner(ownerId, options.session);
  return resolveOwnedStyleContext(data, revision, selection, options);
}
interface Options { now?: () => Date; beforeWrite?: () => Promise<void>; afterWrite?: () => Promise<void>; beforeCleanup?: () => Promise<void> }
/** Bounded embedded state: one owner transaction orders CAS, durable retries and erasure. */
export class StyleMemoryStore {
  constructor(private readonly options: Options = {}) {}
  async list(ownerId: string) { const { data, revision } = await readStyleMemoryOwner(ownerId); return publicStyleMemory(data, revision); }
  async mutate(ownerId: string, raw: unknown): Promise<StyleMemoryResult> {
    const command = parseStyleMemoryCommand(raw), user = new Types.ObjectId(styleId(ownerId));
    const digest = createHash("sha256").update(JSON.stringify(command)).digest("hex");
    const timestamp = (this.options.now?.() ?? new Date()).toISOString();
    await this.options.beforeWrite?.();
    let acknowledgement = 0;
    try {
      await ownerWriteFence(User, user, async session => {
        const { data, revision } = await readStyleMemoryOwner(user, session);
        const previous = data.operations.find(row => row.id === command.operationId);
        if (previous) {
          if (previous.digest !== digest) throw new StyleMemoryError(409, "operation_conflict", "This operation ID already belongs to a different change.");
          acknowledgement = previous.revision; return;
        }
        if (revision !== command.expectedRevision) throw new StyleMemoryError(409, "revision_conflict", "Your saved styling state changed. Refresh before editing it.");
        const erasing = command.kind === "erase_board" || command.kind === "erase_routine";
        if (data.operations.length >= (erasing ? STYLE_MEMORY_RECEIPTS : STYLE_MEMORY_NORMAL_RECEIPTS)) throw new StyleMemoryError(429, "operation_limit", "Styling change storage is full. Existing directions and situations can still be erased.");
        acknowledgement = revision + 1;
        applyStyleCommand(data, command, acknowledgement, timestamp);
        data.operations.push({ id: command.operationId, digest, revision: acknowledgement });
        if (Buffer.byteLength(JSON.stringify(data), "utf8") > STYLE_MEMORY_MAX_BYTES) throw new StyleMemoryError(429, "storage_limit", "Saved styling storage is full. Erase an unwanted direction or situation first.");
        await User.collection.updateOne({ _id: user, erasureStarted: { $ne: true } }, { $set: { styleMemory: data, styleMemoryRevision: acknowledgement } }, { session });
      });
    } catch (error) {
      if (error instanceof OwnerWriteUnavailable) throw new StyleMemoryError(410, "account_unavailable", "This account no longer accepts styling changes.");
      throw error;
    }
    await this.options.afterWrite?.();
    if (command.kind === "erase_board" || command.kind === "erase_routine") { await this.options.beforeCleanup?.(); await cleanupStyleMemoryErasure(user); }
    return { state: await this.list(ownerId), operation: { id: command.operationId, revision: acknowledgement } };
  }
}
