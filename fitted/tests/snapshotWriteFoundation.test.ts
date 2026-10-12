import mongoose, { Types } from "mongoose";
import { randomUUID } from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "@/models/User";
import WardrobeItem from "@/models/WardrobeItem";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import { requireSnapshotWriteIndex, writeSnapshotWithIdempotency } from "@/lib/mlSnapshotWrite";
import { ownerWriteFence } from "@/lib/ownerWriteFence";
let server: MongoMemoryServer;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri(), { autoIndex: false });
  await Promise.all([User.init(), WardrobeItem.init(), GenerationSnapshot.init()]);
  await GenerationSnapshot.createCollection();
}, 120_000);
afterAll(async () => { await mongoose.disconnect(); await server.stop(); });
beforeEach(async () => { await GenerationSnapshot.collection.dropIndexes(); });
afterEach(async () => { jest.restoreAllMocks(); await User.collection.deleteMany({}); await WardrobeItem.collection.deleteMany({}); await GenerationSnapshot.collection.deleteMany({}); });
const correct = () => GenerationSnapshot.collection.createIndex({ user: 1, requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: "string" } } });
it.each(["missing", "nonunique", "wrong-partial", "nonpartial", "sparse", "collation", "reversed"])("snapshot writer rejects %s production uniqueness without implicit repair", async variant => {
  if (variant === "nonunique") await GenerationSnapshot.collection.createIndex({ user: 1, requestId: 1 }, { partialFilterExpression: { requestId: { $type: "string" } } });
  if (variant === "wrong-partial") await GenerationSnapshot.collection.createIndex({ user: 1, requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $exists: true } } });
  if (variant === "nonpartial") await GenerationSnapshot.collection.createIndex({ user: 1, requestId: 1 }, { unique: true });
  if (variant === "sparse") await GenerationSnapshot.collection.createIndex({ user: 1, requestId: 1 }, { unique: true, sparse: true });
  if (variant === "collation") await GenerationSnapshot.collection.createIndex({ user: 1, requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: "string" } }, collation: { locale: "en", strength: 2 } });
  if (variant === "reversed") await GenerationSnapshot.collection.createIndex({ requestId: 1, user: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: "string" } } });
  const definitions = await GenerationSnapshot.collection.indexes();
  const owner = await User.create({ authId: randomUUID(), email: `${randomUUID()}@example.test` });
  const requestId = randomUUID();
  const repair = jest.spyOn(GenerationSnapshot, "createIndexes");
  await expect(writeSnapshotWithIdempotency(GenerationSnapshot, { user: owner._id, requestId }, owner._id, requestId, User)).rejects.toThrow("uniqueness is not ready");
  expect(repair).not.toHaveBeenCalled(); expect(await GenerationSnapshot.collection.indexes()).toEqual(definitions);
  expect(await GenerationSnapshot.countDocuments({})).toBe(0);
  expect((await User.findById(owner._id).select("+imageWriteVersion")).imageWriteVersion).toBeUndefined();
});
it("readiness is not cached across a deployed index drop", async () => {
  await correct(); await expect(requireSnapshotWriteIndex(GenerationSnapshot)).resolves.toBeUndefined();
  await GenerationSnapshot.collection.dropIndex("user_1_requestId_1");
  await expect(requireSnapshotWriteIndex(GenerationSnapshot)).rejects.toThrow("uniqueness is not ready");
});
it.each(["different-owner", "missing-owner", "malformed-owner", "different-request", "missing-request"])("snapshot helper rejects %s before index or transaction work", async variant => {
  const owner = new Types.ObjectId(), requestId = randomUUID();
  const payload: Record<string, unknown> = { user: owner, requestId };
  if (variant === "different-owner") payload.user = new Types.ObjectId();
  if (variant === "missing-owner") delete payload.user;
  if (variant === "malformed-owner") payload.user = "not-an-id";
  if (variant === "different-request") payload.requestId = randomUUID();
  if (variant === "missing-request") delete payload.requestId;
  const indexes = jest.spyOn(GenerationSnapshot.collection, "listIndexes");
  const session = jest.spyOn(User.db, "startSession");
  await expect(writeSnapshotWithIdempotency(GenerationSnapshot, payload, owner, requestId, User)).rejects.toThrow("do not match write identity");
  expect(indexes).not.toHaveBeenCalled(); expect(session).not.toHaveBeenCalled();
});
it("standalone owner fencing rejects before the row callback with no fallback", async () => {
  const owner = await User.create({ authId: randomUUID(), email: `${randomUUID()}@example.test` });
  const write = jest.fn(session => WardrobeItem.create([{ user: owner._id, name: "unsafe", category: "top", clothingType: "top", warmth: 2 }], { session }));
  await expect(ownerWriteFence(User, owner._id, write)).rejects.toThrow(/Transaction numbers/);
  expect(write).not.toHaveBeenCalled(); expect(await WardrobeItem.countDocuments({})).toBe(0);
});
