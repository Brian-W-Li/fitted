import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "@/models/User";
import { admitFirebaseIdentity, requireIdentityIndexes } from "@/lib/identityAdmission";

let server: MongoMemoryServer;
const identity = { uid: "new-uid", email: "new@example.test" };
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  // Match production: User.init does not create indexes with autoIndex disabled.
  await mongoose.connect(server.getUri(), { autoIndex: false });
  await User.init();
  await User.createCollection();
}, 120_000);
afterAll(async () => { await mongoose.disconnect(); await server.stop(); });
beforeEach(async () => { await User.collection.dropIndexes(); });
afterEach(async () => { jest.restoreAllMocks(); await User.collection.deleteMany({}); });
const correctIdentity = () => User.collection.createIndex({ authProvider: 1, authId: 1 }, { unique: true });
const correctEmail = () => User.collection.createIndex({ email: 1 }, { unique: true });

it("fails closed with production autoIndex disabled and no required indexes, without implicit index repair", async () => {
  const definitions = await User.collection.indexes();
  expect(definitions.some(index => index.unique)).toBe(false);
  const create = jest.spyOn(User, "createIndexes");
  const verify = jest.fn(async () => identity);
  await expect(admitFirebaseIdentity(User, "token", identity, verify)).rejects.toMatchObject({ status: 503, code: "identity_indexes_unavailable" });
  expect(await User.collection.indexes()).toEqual(definitions);
  expect(create).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
  expect(await User.countDocuments({})).toBe(0);
});

it.each(["missing", "nonunique", "sparse", "partial", "collation", "reversed"])("rejects %s identity uniqueness before reservation and leaves index definitions intact", async variant => {
  await correctEmail();
  if (variant === "nonunique") await User.collection.createIndex({ authProvider: 1, authId: 1 });
  if (variant === "sparse") await User.collection.createIndex({ authProvider: 1, authId: 1 }, { unique: true, sparse: true });
  if (variant === "partial") await User.collection.createIndex({ authProvider: 1, authId: 1 }, { unique: true, partialFilterExpression: { authProvider: "firebase" } });
  if (variant === "collation") await User.collection.createIndex({ authProvider: 1, authId: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
  if (variant === "reversed") await User.collection.createIndex({ authId: 1, authProvider: 1 }, { unique: true });
  const definitions = await User.collection.indexes();
  const verify = jest.fn(async () => identity);
  await expect(admitFirebaseIdentity(User, "token", identity, verify)).rejects.toMatchObject({ status: 503, code: "identity_indexes_unavailable" });
  expect(await User.collection.indexes()).toEqual(definitions);
  expect(verify).not.toHaveBeenCalled(); expect(await User.countDocuments({})).toBe(0);
});

it.each(["missing", "nonunique", "sparse", "partial", "collation"])("rejects %s email uniqueness before any user write", async variant => {
  await correctIdentity();
  if (variant === "nonunique") await User.collection.createIndex({ email: 1 });
  if (variant === "sparse") await User.collection.createIndex({ email: 1 }, { unique: true, sparse: true });
  if (variant === "partial") await User.collection.createIndex({ email: 1 }, { unique: true, partialFilterExpression: { authProvider: "firebase" } });
  if (variant === "collation") await User.collection.createIndex({ email: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
  await expect(admitFirebaseIdentity(User, "token", identity, async () => identity)).rejects.toMatchObject({ status: 503, code: "identity_indexes_unavailable" });
  expect(await User.countDocuments({})).toBe(0);
});

it("reads index readiness again after a previously ready identity index is dropped", async () => {
  await correctIdentity(); await correctEmail();
  await expect(requireIdentityIndexes(User)).resolves.toBeUndefined();
  await User.collection.dropIndex("authProvider_1_authId_1");
  await expect(requireIdentityIndexes(User)).rejects.toMatchObject({ status: 503, code: "identity_indexes_unavailable" });
});

it("rejects unsupported standalone transactions before the fresh verdict and stores no owner", async () => {
  await correctIdentity(); await correctEmail();
  const verify = jest.fn(async () => identity);
  await expect(admitFirebaseIdentity(User, "token", identity, verify)).rejects.toMatchObject({ status: 503, code: "identity_admission_unavailable" });
  expect(verify).not.toHaveBeenCalled(); expect(await User.countDocuments({})).toBe(0);
});
