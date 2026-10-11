/**
 * DELETE /api/wardrobe/clear — the DESTRUCTIVE route path, BEHAVIORAL over real in-memory Mongo
 * (post-m5-reset §4.6 / Track-1). `lib/clearWardrobe` was already unit-tested, but the ROUTE — auth
 * gate + owner resolution + the real cascade delete + the deletedCount response — had no coverage. A
 * destructive endpoint especially must prove it deletes ONLY the caller's rows and leaves other users'
 * wardrobes intact.
 *
 * Non-DB seams mocked (Mongo connect + Firebase token verify); models/documents/deletes are REAL.
 */
import { Types } from "mongoose";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import User from "@/models/User";
import WardrobeItem from "@/models/WardrobeItem";
import WardrobeImage from "@/models/WardrobeImage";
import GenerationSnapshot from "@/models/GenerationSnapshot";

jest.mock("@/lib/db", () => ({ initDatabase: jest.fn() }));
jest.mock("@/lib/firebaseAdmin", () => ({ adminAuth: { verifyIdToken: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let harness: MongoHarness;

function mockDb() {
  const { initDatabase } = jest.requireMock("@/lib/db") as { initDatabase: jest.Mock };
  initDatabase.mockResolvedValue({ User, WardrobeItem, WardrobeImage, GenerationSnapshot });
}
function setToken(uid: string | null) {
  const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
    adminAuth: { verifyIdToken: jest.Mock };
  };
  if (uid == null) adminAuth.verifyIdToken.mockRejectedValue(new Error("bad token"));
  else adminAuth.verifyIdToken.mockResolvedValue({ uid });
}

let consoleErrorSpy: jest.SpyInstance;
beforeAll(async () => {
  harness = await startMemoryMongo([User, WardrobeItem, WardrobeImage, GenerationSnapshot]);
}, 120_000);
afterAll(async () => {
  await harness.stop();
});
beforeEach(() => {
  mockDb();
  setToken("firebase-uid");
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  consoleErrorSpy.mockRestore();
  await harness.clear();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

function makeRequest(authHeader: string | null = "Bearer fake-token"): Any {
  return { headers: { get: (h: string) => (h.toLowerCase() === "authorization" ? authHeader : null) } };
}
async function DELETE(req: Any) {
  return (await import("@/app/api/wardrobe/clear/route")).DELETE(req);
}

async function seedUser(uid: string) {
  const user = await User.create({ authProvider: "firebase", authId: uid, email: `${uid}@x.com` });
  return user._id.toString();
}
async function seedWardrobe(userId: string, n: number) {
  for (let i = 0; i < n; i++) {
    const item = await WardrobeItem.create({
      user: userId,
      name: `Item ${i}`,
      category: "top",
      clothingType: "top",
      warmth: 2,
    });
    await WardrobeImage.create({
      user: userId,
      wardrobeItem: item._id,
      base64: Buffer.from("PNG").toString("base64"),
      contentType: "image/png",
      sizeBytes: 3,
    });
  }
}
// One item + its image, plus a GenerationSnapshot that references the image (the raw imageRef field
// is all §D2 reads — insert directly to skip the snapshot's heavy required-field validation). Returns
// the image _id string so the test can assert it SURVIVES the clear.
async function seedReferencedImage(userId: string): Promise<string> {
  const item = await WardrobeItem.create({
    user: userId, name: "Referenced", category: "top", clothingType: "top", warmth: 2,
  });
  const img = await WardrobeImage.create({
    user: userId, wardrobeItem: item._id,
    base64: Buffer.from("PNG").toString("base64"), contentType: "image/png", sizeBytes: 3,
  });
  const imageId = img._id.toString();
  await GenerationSnapshot.collection.insertOne({
    user: new Types.ObjectId(userId),
    itemSnapshots: [{ evidence: { image: { imageRef: `mongo:${imageId}` } } }],
  });
  return imageId;
}

describe("DELETE /api/wardrobe/clear — behavioral, real Mongo", () => {
  it("hard-deletes the caller's items AND images, returning the item deletedCount", async () => {
    const userId = await seedUser("firebase-uid");
    await seedWardrobe(userId, 3);

    const res = await DELETE(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deletedCount: 3, itemsCleared: true, cleanupComplete: true });

    expect(await WardrobeItem.countDocuments({ user: userId })).toBe(0);
    expect(await WardrobeImage.countDocuments({ user: userId })).toBe(0); // images not orphaned (§23-H14)
  });

  it("KEEPS an image a GenerationSnapshot references, deletes the unreferenced ones (§D2)", async () => {
    const userId = await seedUser("firebase-uid");
    await seedWardrobe(userId, 2); // 2 items + 2 unreferenced images
    const keptImageId = await seedReferencedImage(userId); // +1 item + 1 referenced image

    const res = await DELETE(makeRequest());
    expect(res.status).toBe(200);
    // All 3 items gone; the 2 unreferenced images gone; the 1 snapshot-referenced image SURVIVES so
    // the M6 image-embedding re-measure can still re-fetch that accepted outfit's pixels.
    expect(await WardrobeItem.countDocuments({ user: userId })).toBe(0);
    expect(await WardrobeImage.countDocuments({ user: userId })).toBe(1);
    expect(await WardrobeImage.countDocuments({ _id: new Types.ObjectId(keptImageId) })).toBe(1);
  });

  it("clears ONLY the caller's wardrobe, never another user's rows", async () => {
    const mine = await seedUser("firebase-uid");
    const other = await seedUser("other");
    await seedWardrobe(mine, 2);
    await seedWardrobe(other, 4);

    const res = await DELETE(makeRequest());
    expect((await res.json()).deletedCount).toBe(2);

    expect(await WardrobeItem.countDocuments({ user: mine })).toBe(0);
    expect(await WardrobeItem.countDocuments({ user: other })).toBe(4); // untouched
    expect(await WardrobeImage.countDocuments({ user: other })).toBe(4);
  });

  it("401s a missing Authorization header without deleting anything", async () => {
    const userId = await seedUser("firebase-uid");
    await seedWardrobe(userId, 2);

    const res = await DELETE(makeRequest(null));
    expect(res.status).toBe(401);
    expect(await WardrobeItem.countDocuments({ user: userId })).toBe(2); // nothing cleared
  });

  it("401s an invalid/expired token (not 500) without deleting anything", async () => {
    const userId = await seedUser("firebase-uid");
    await seedWardrobe(userId, 2);

    setToken(null); // verifyIdToken rejects — must be a client 401, never a server 500
    const res = await DELETE(makeRequest());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Invalid or expired token");
    expect(await WardrobeItem.countDocuments({ user: userId })).toBe(2); // nothing cleared
    expect(await WardrobeImage.countDocuments({ user: userId })).toBe(2);
  });

  it("404s a valid token whose user does not exist (no rows to own → nothing deleted)", async () => {
    // A stray item under some other id must survive an unknown caller.
    const strayOwner = new Types.ObjectId().toString();
    await seedWardrobe(strayOwner, 1);

    const res = await DELETE(makeRequest()); // token verifies to "firebase-uid" but no User row exists
    expect(res.status).toBe(404);
    expect(await WardrobeItem.countDocuments({})).toBe(1);
  });

  it("rejects an already-pending owner before any wardrobe delete", async () => {
    const userId = await seedUser("firebase-uid");
    await seedWardrobe(userId, 1);
    await User.updateOne({ _id: userId }, { $set: { erasureStarted: true } });
    const res = await DELETE(makeRequest());
    expect(res.status).toBe(409);
    expect(await WardrobeItem.countDocuments({ user: userId })).toBe(1);
    expect(await WardrobeImage.countDocuments({ user: userId })).toBe(1);
  });

  it("reports deleted garments and unfinished photo cleanup, then retries without garments", async () => {
    const mine = await seedUser("firebase-uid");
    const other = await seedUser("other");
    await seedWardrobe(mine, 2);
    await seedWardrobe(other, 1);
    const fault = jest.spyOn(WardrobeImage, "distinct").mockImplementationOnce((() => ({ exec: async () => { throw new Error("lookup failed"); } })) as Any);
    const failed = await DELETE(makeRequest());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ ok: false, deletedCount: 2, itemsCleared: true, cleanupComplete: false });
    expect(await WardrobeItem.countDocuments({ user: mine })).toBe(0);
    expect(await WardrobeImage.countDocuments({ user: mine })).toBe(2);
    expect(await WardrobeItem.countDocuments({ user: other })).toBe(1);
    fault.mockRestore();
    const retry = await DELETE(makeRequest());
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ deletedCount: 0, cleanupComplete: true });
    expect(await WardrobeImage.countDocuments({ user: mine })).toBe(0);
    expect(await WardrobeImage.countDocuments({ user: other })).toBe(1);
  });

  it("keeps deletion uncertain when Mongo rejects before removing garments", async () => {
    const mine = await seedUser("firebase-uid");
    await seedWardrobe(mine, 2);
    const fault = jest.spyOn(WardrobeItem, "deleteMany").mockImplementationOnce((() => ({ exec: async () => { throw new Error("delete unavailable"); } })) as Any);
    const failed = await DELETE(makeRequest());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ deletedCount: null, itemsCleared: null, cleanupComplete: false });
    expect(await WardrobeItem.countDocuments({ user: mine })).toBe(2);
    expect(await WardrobeImage.countDocuments({ user: mine })).toBe(2);
    fault.mockRestore();
    expect((await DELETE(makeRequest())).status).toBe(200);
    expect(await WardrobeItem.countDocuments({ user: mine })).toBe(0);
    expect(await WardrobeImage.countDocuments({ user: mine })).toBe(0);
  });

  it("rejects an unacknowledged delete result without starting the image sweep", async () => {
    const mine = await seedUser("firebase-uid");
    const other = await seedUser("other");
    await seedWardrobe(mine, 1);
    await seedWardrobe(other, 1);
    const deleteCall = jest.spyOn(WardrobeItem, "deleteMany").mockImplementationOnce((() => ({
      exec: async () => ({ acknowledged: false }),
    })) as Any);
    const sweep = jest.spyOn(WardrobeImage, "distinct");
    const response = await DELETE(makeRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ deletedCount: null, itemsCleared: null, cleanupComplete: false });
    expect(deleteCall).toHaveBeenCalledWith({ user: mine }, { writeConcern: { w: "majority" } });
    expect(sweep).not.toHaveBeenCalled();
    expect(await WardrobeItem.countDocuments({ user: mine })).toBe(1);
    expect(await WardrobeImage.countDocuments({ user: mine })).toBe(1);
    expect(await WardrobeImage.countDocuments({ user: other })).toBe(1);
  });

  it("does not claim completion or sweep photos after a committed delete loses its response", async () => {
    const mine = await seedUser("firebase-uid");
    await seedWardrobe(mine, 2);
    const realDelete = WardrobeItem.deleteMany.bind(WardrobeItem);
    jest.spyOn(WardrobeItem, "deleteMany").mockImplementationOnce(((filter: Any) => ({
      exec: async () => { await realDelete(filter).exec(); throw new Error("delete result lost"); },
    })) as Any);
    const res = await DELETE(makeRequest());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, deletedCount: null, itemsCleared: null, cleanupComplete: false });
    expect(await WardrobeItem.countDocuments({ user: mine })).toBe(0);
    expect(await WardrobeImage.countDocuments({ user: mine })).toBe(2);
    const retry = await DELETE(makeRequest());
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ deletedCount: 0, itemsCleared: true, cleanupComplete: true });
    expect(await WardrobeImage.countDocuments({ user: mine })).toBe(0);
  });

  it("does not use an empty read to promote a failed delete to success", async () => {
    const mine = await seedUser("firebase-uid");
    const count = jest.spyOn(WardrobeItem, "countDocuments");
    jest.spyOn(WardrobeItem, "deleteMany").mockImplementationOnce((() => ({ exec: async () => { throw new Error("delete result unavailable"); } })) as Any);
    const res = await DELETE(makeRequest());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ deletedCount: null, itemsCleared: null, cleanupComplete: false });
    expect(count).not.toHaveBeenCalled();
    expect(await WardrobeItem.find({ user: mine })).toHaveLength(0);
  });

  it("retries a reclamation fault while preserving historic and foreign photos", async () => {
    const mine = await seedUser("firebase-uid");
    const other = await seedUser("other");
    await seedWardrobe(mine, 1);
    const pinned = await seedReferencedImage(mine);
    await seedWardrobe(other, 1);
    const fault = jest.spyOn(WardrobeImage, "deleteOne").mockImplementationOnce((() => ({ exec: async () => { throw new Error("reclamation failed"); } })) as Any);
    const failed = await DELETE(makeRequest());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ deletedCount: 2, itemsCleared: true, cleanupComplete: false });
    expect(await WardrobeItem.countDocuments({ user: mine })).toBe(0);
    expect(await WardrobeImage.countDocuments({ user: mine })).toBe(2);
    fault.mockRestore();
    const retry = await DELETE(makeRequest());
    expect(retry.status).toBe(200);
    expect(await WardrobeImage.countDocuments({ user: mine })).toBe(1);
    expect(await WardrobeImage.countDocuments({ _id: pinned, user: mine })).toBe(1);
    expect(await WardrobeImage.countDocuments({ user: other })).toBe(1);
  });
});
