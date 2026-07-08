/**
 * M5 snapshot write path + §G schema completion (C5 seam #5a) — BEHAVIORAL, real Mongo.
 *
 *   - requestId required + UUIDv4/ULID validated on a real insert
 *   - the delete guard (§G item 3 / H54) rejects ALL FOUR delete paths on a persisted doc
 *   - parentSnapshotId round-trips
 *   - the partial unique index {user, requestId} enforces one-per-render; a duplicate insert
 *     throws E11000 and writeSnapshotWithIdempotency re-reads + replays the WINNER (§C.4)
 *
 * These need the index built (harness Model.init) + a real insert — validateSync could not prove
 * uniqueness or the delete-hook wiring.
 */
import { Types } from "mongoose";
import GenerationSnapshot, { type GenerationSnapshotDocument } from "@/models/GenerationSnapshot";
import {
  writeSnapshotWithIdempotency,
  isDuplicateKeyError,
  type SnapshotWriteModel,
} from "@/lib/mlSnapshotWrite";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";

let harness: MongoHarness;
beforeAll(async () => {
  harness = await startMemoryMongo([GenerationSnapshot]);
}, 120_000);
afterAll(async () => await harness.stop());
afterEach(async () => await harness.clear());

const oid = () => new Types.ObjectId();
const UUID = "0192f1a0-1c1a-4c3e-9b2a-1a2b3c4d5e6f"; // v4
const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const validDoc = (over: Record<string, unknown> = {}) => ({
  _id: oid(),
  user: oid(),
  sessionId: "u",
  candidateCacheKey: "ck",
  generationIndex: 0,
  requestId: UUID,
  intent: "daily",
  occasion: "casual",
  weather: "mild",
  wardrobeVersion: 0,
  interactionCountAtRequest: 0,
  fittedCoreVersion: "0.4.0",
  generator: {
    provider: "openai", model: "gpt-5.4-mini", temperature: 0.5, promptVersion: "m5-c1.v1",
    maxCompletionTokens: 2200, apiSurface: "chat_completions", responseFormat: "json_schema_strict",
    reasoningEffort: "none", storeMode: "none", promptCacheRetention: "in_memory", timeoutSeconds: 30, maxRetries: 0,
  },
  rankerConfigVersion: "deadbeef",
  scorer: { kind: "cold_start", available: true },
  itemSnapshots: [], generationAttempts: [], candidates: [],
  shownCandidateIds: [], shownFullSignatures: [], nSurfaced: 0, spreadCollapsed: false,
  ...over,
});

// ---------------------------------------------------------------------------
describe("requestId — required + validated on a real write", () => {
  it("rejects a write with no requestId", async () => {
    const doc = validDoc();
    delete (doc as Record<string, unknown>).requestId;
    await expect(GenerationSnapshot.create(doc)).rejects.toThrow();
  });

  it("rejects a malformed requestId (not UUIDv4/ULID)", async () => {
    await expect(GenerationSnapshot.create(validDoc({ requestId: "not-a-token" }))).rejects.toThrow();
    await expect(GenerationSnapshot.create(validDoc({ requestId: "" }))).rejects.toThrow();
  });

  it("accepts a UUIDv4 and a ULID, read back verbatim", async () => {
    const a = await GenerationSnapshot.create(validDoc({ requestId: UUID }));
    const b = await GenerationSnapshot.create(validDoc({ requestId: ULID }));
    expect((await GenerationSnapshot.findById(a._id).lean<GenerationSnapshotDocument>())!.requestId).toBe(UUID);
    expect((await GenerationSnapshot.findById(b._id).lean<GenerationSnapshotDocument>())!.requestId).toBe(ULID);
  });
});

// ---------------------------------------------------------------------------
describe("parentSnapshotId — lineage pointer round-trips", () => {
  it("stores + reads back a parent ObjectId (null on a root render)", async () => {
    const parent = await GenerationSnapshot.create(validDoc());
    const child = await GenerationSnapshot.create(
      validDoc({ requestId: "0192f1a0-1c1a-4c3e-9b2a-000000000002", generationIndex: 1, parentSnapshotId: parent._id }),
    );
    const readBack = await GenerationSnapshot.findById(child._id).lean<GenerationSnapshotDocument>();
    expect(readBack!.parentSnapshotId?.toString()).toBe(parent._id.toString());
    expect((await GenerationSnapshot.findById(parent._id).lean<GenerationSnapshotDocument>())!.parentSnapshotId ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("delete guard (§G item 3 / H54) — all four delete paths reject", () => {
  it("Model.deleteOne / deleteMany / findOneAndDelete / doc.deleteOne all throw on a persisted row", async () => {
    const doc = await GenerationSnapshot.create(validDoc());
    await expect(GenerationSnapshot.deleteOne({ _id: doc._id })).rejects.toThrow(/immutable/i);
    await expect(GenerationSnapshot.deleteMany({ _id: doc._id })).rejects.toThrow(/immutable/i);
    await expect(GenerationSnapshot.findOneAndDelete({ _id: doc._id })).rejects.toThrow(/immutable/i);
    await expect(GenerationSnapshot.findByIdAndDelete(doc._id)).rejects.toThrow(/immutable/i);
    await expect(doc.deleteOne()).rejects.toThrow(/immutable/i);
    // the row is still there — nothing was deleted
    expect(await GenerationSnapshot.findById(doc._id).lean<GenerationSnapshotDocument>()).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("idempotency — partial unique index + E11000 winner re-read (§C.4)", () => {
  const model = GenerationSnapshot as unknown as SnapshotWriteModel;

  it("a duplicate {user, requestId} insert throws E11000", async () => {
    const user = oid();
    const rid = UUID;
    await GenerationSnapshot.create(validDoc({ user, requestId: rid }));
    let caught: unknown;
    try {
      await GenerationSnapshot.create(validDoc({ user, requestId: rid })); // same {user,requestId}, new _id
    } catch (err) {
      caught = err;
    }
    expect(isDuplicateKeyError(caught)).toBe(true);
  });

  it("different requestIds for the same user both persist (a legit repeat render)", async () => {
    const user = oid();
    await GenerationSnapshot.create(validDoc({ user, requestId: UUID }));
    await GenerationSnapshot.create(validDoc({ user, requestId: ULID }));
    expect(await GenerationSnapshot.countDocuments({ user })).toBe(2);
  });

  it("the same requestId for DIFFERENT users both persist (index is user-scoped)", async () => {
    await GenerationSnapshot.create(validDoc({ user: oid(), requestId: UUID }));
    await GenerationSnapshot.create(validDoc({ user: oid(), requestId: UUID }));
    expect(await GenerationSnapshot.countDocuments({ requestId: UUID })).toBe(2);
  });

  it("writeSnapshotWithIdempotency: first wins (deduped:false), second replays the winner (deduped:true)", async () => {
    const user = oid();
    const rid = UUID;
    const winnerDoc = validDoc({ _id: oid(), user, requestId: rid, occasion: "the-winner" });
    const first = await writeSnapshotWithIdempotency<{ _id: Types.ObjectId; occasion: string }>(
      model, winnerDoc, user, rid,
    );
    expect(first.deduped).toBe(false);

    const loserDoc = validDoc({ _id: oid(), user, requestId: rid, occasion: "the-loser" });
    const second = await writeSnapshotWithIdempotency<{ _id: Types.ObjectId; occasion: string }>(
      model, loserDoc, user, rid,
    );
    expect(second.deduped).toBe(true);
    // the replayed snapshot is the WINNER, not the loser's would-be row
    expect(second.snapshot._id.toString()).toBe(first.snapshot._id.toString());
    expect(second.snapshot.occasion).toBe("the-winner");
    // exactly one corpus row exists
    expect(await GenerationSnapshot.countDocuments({ user, requestId: rid })).toBe(1);
  });
});
