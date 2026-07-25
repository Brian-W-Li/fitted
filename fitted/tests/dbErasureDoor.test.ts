/**
 * `lib/db.ts` — the REAL erasure door and the REAL index registration, executed for once.
 *
 * Twelve suites `jest.mock("@/lib/db")`, so until this file existed NOTHING in the repo ever ran
 * `deleteUserWithData` or `initDatabase` — the two functions that actually erase a friend's data and
 * build the idempotency index. `accountDeleteRoute.test.ts` documents that limit in prose and asks a
 * future editor to "keep that call shape"; prose is not a CI artifact (CLAUDE.md: enforce process
 * rules with tests, not discipline). This file connects the REAL `connectMongo` to an in-memory
 * mongod — no `@/lib/db` mock anywhere in it — so both functions run for real.
 *
 * The two regressions it exists to catch:
 *   1. Swapping `User.deleteOne` for any path that does not fire the schema pre-hook
 *      (`User.deleteMany`, `User.collection.deleteOne`, `findByIdAndDelete` with a different op):
 *      "delete me" would delete the user row and leave every wardrobe item, photo, interaction and
 *      snapshot behind, while the whole account-delete suite stayed green.
 *   2. Dropping a `Model.init()` from `initDatabase`'s list: the partial-unique `{user, requestId}`
 *      index (§23-H50) would never be built in production, so every F10 resume writes a SECOND paid
 *      gpt-5.4-mini render and a duplicate corpus row. The other suites cannot see this — the test
 *      harness builds indexes itself, from its own hand-picked model list.
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Types } from "mongoose";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let server: MongoMemoryServer;
let origUri: string | undefined;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  origUri = process.env.MONGODB_URI;
  // The REAL `connectMongo` reads this and does the connecting — deliberately NOT pre-connected by
  // the shared harness, so `initDatabase()` is exercised end to end.
  process.env.MONGODB_URI = server.getUri();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
  if (origUri === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = origUri;
  // `lib/mongodb` memoizes its connection on `globalThis` (to survive Next hot reloads). Clearing it
  // is belt-and-braces WITHIN this file, not cross-file hygiene: jest builds one environment per test
  // FILE (`vm.createContext()`), so `globalThis` here is this file's own sandbox and no other suite
  // can observe it. Verified by probe, not assumed — a first version of this cleanup claimed the
  // opposite ("globalThis is shared by every test file in a worker"), which is false: a marker set on
  // globalThis in one file reads back `undefined` in the next, even under `--runInBand`.
  delete (globalThis as { mongoose?: unknown }).mongoose;
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

describe("lib/db initDatabase — the real connect + index registration", () => {
  it("calls init() on EVERY model it returns — in prod that is the only index builder", async () => {
    // Asserting the CALLS, not the resulting indexes, is deliberate and is the only honest way to
    // pin this: `connectMongo` sets `autoIndex: NODE_ENV !== "production"`, so under jest mongoose
    // auto-builds every index regardless of `.init()`. An index-existence assertion here therefore
    // stays green with the whole init list deleted (verified by mutation) — it measures autoIndex,
    // not this function. In PRODUCTION autoIndex is off and these calls are the sole mechanism, so a
    // dropped `GenerationSnapshot.init()` means the partial-unique {user,requestId} index (§23-H50)
    // never exists live and every F10 resume writes a SECOND paid render + duplicate corpus row.
    // (The index PLAN itself is pinned separately, in generationSnapshotModel.test.ts, and its
    // behavior in mlSnapshotWrite.test.ts.)
    // Deliberately NO `jest.resetModules()` here: re-instantiating the module registry gives
    // `mongoose` a SECOND instance whose connection pool nothing tears down, and jest then never
    // exits (observed — the suite printed its summary and hung until killed).
    const dbMod = await import("@/lib/db");
    const models = await dbMod.initDatabase();
    const spies = Object.entries(models).map(([name, m]) => [
      name,
      jest.spyOn(m as Any, "init"),
    ]) as [string, jest.SpyInstance][];
    try {
      await dbMod.initDatabase();
      for (const [name, spy] of spies) {
        expect([name, spy.mock.calls.length > 0]).toEqual([name, true]);
      }
    } finally {
      for (const [, spy] of spies) spy.mockRestore();
    }
  });

  it("returns all five models the routes destructure", async () => {
    const { initDatabase } = await import("@/lib/db");
    const models = await initDatabase();
    // A missing key here is an immediate `undefined.findOne` 500 on whichever route wanted it.
    expect(Object.keys(models).sort()).toEqual(
      ["GenerationSnapshot", "OutfitInteraction", "User", "WardrobeImage", "WardrobeItem"].sort(),
    );
  });
});

describe("lib/db deleteUserWithData — the single sanctioned erasure door", () => {
  /** One row in every user-owned collection, so a cascade that misses one is visible. */
  async function seedFullUser() {
    const { User, WardrobeItem, OutfitInteraction, WardrobeImage, GenerationSnapshot } =
      await (await import("@/lib/db")).initDatabase();
    const user = await User.create({
      authProvider: "firebase",
      authId: `uid-${new Types.ObjectId().toString()}`,
      email: `${new Types.ObjectId().toString()}@x.com`,
    });
    const userId = user._id.toString();
    const item = await WardrobeItem.create({
      user: userId,
      name: "Tee",
      category: "top",
      clothingType: "top",
      warmth: 2,
    });
    await WardrobeImage.create({
      user: userId,
      wardrobeItem: item._id,
      base64: "aGk=",
      contentType: "image/jpeg",
      sizeBytes: 2,
    });
    // Native inserts for the two schema-guarded collections — this test is about the CASCADE, not
    // about re-proving those schemas' own validation.
    await OutfitInteraction.collection.insertOne({
      user: new Types.ObjectId(userId),
      action: "accepted",
      createdAt: new Date(),
    });
    await GenerationSnapshot.collection.insertOne({
      user: new Types.ObjectId(userId),
      requestId: new Types.ObjectId().toString(),
    });
    return { userId, User, WardrobeItem, OutfitInteraction, WardrobeImage, GenerationSnapshot };
  }

  it("erases the user row AND every owned row in all four collections", async () => {
    const { deleteUserWithData } = await import("@/lib/db");
    const { userId, User, WardrobeItem, OutfitInteraction, WardrobeImage, GenerationSnapshot } =
      await seedFullUser();

    // Pre-condition, so a green result can never mean "there was nothing to delete".
    expect(await WardrobeItem.countDocuments({ user: userId })).toBe(1);
    expect(await WardrobeImage.countDocuments({ user: userId })).toBe(1);
    expect(await OutfitInteraction.countDocuments({ user: userId })).toBe(1);
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(1);

    expect(await deleteUserWithData(userId)).toBe(true);

    expect(await User.countDocuments({ _id: userId })).toBe(0);
    expect(await WardrobeItem.countDocuments({ user: userId })).toBe(0);
    expect(await WardrobeImage.countDocuments({ user: userId })).toBe(0);
    expect(await OutfitInteraction.countDocuments({ user: userId })).toBe(0);
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(0);
  });

  it("leaves another user's rows untouched", async () => {
    const { deleteUserWithData } = await import("@/lib/db");
    const victim = await seedFullUser();
    const bystander = await seedFullUser();

    expect(await deleteUserWithData(victim.userId)).toBe(true);

    expect(await bystander.WardrobeItem.countDocuments({ user: bystander.userId })).toBe(1);
    expect(await bystander.WardrobeImage.countDocuments({ user: bystander.userId })).toBe(1);
    expect(await bystander.OutfitInteraction.countDocuments({ user: bystander.userId })).toBe(1);
    expect(await bystander.GenerationSnapshot.countDocuments({ user: bystander.userId })).toBe(1);
    expect(await bystander.User.countDocuments({ _id: bystander.userId })).toBe(1);
  });

  it("returns false for an id that matches no user (the route's 500 branch)", async () => {
    const { deleteUserWithData } = await import("@/lib/db");
    expect(await deleteUserWithData(new Types.ObjectId().toString())).toBe(false);
  });

  it("accepts a hex-STRING id — the representation every API route passes", async () => {
    // The cascade's own cast choke point (`models/User.ts`) exists because the native-driver
    // deleteMany calls do no Mongoose casting: a hex string would match zero ObjectId-typed `user`
    // fields and the cascade would silently delete nothing. Every route passes a string.
    const { deleteUserWithData } = await import("@/lib/db");
    const { userId, WardrobeItem } = await seedFullUser();
    expect(typeof userId).toBe("string");
    await deleteUserWithData(userId);
    expect(await WardrobeItem.countDocuments({ user: userId })).toBe(0);
  });
});

export {};
