/**
 * DELETE /api/wardrobe/[id] — the per-item delete's image cascade, BEHAVIORAL over real in-memory
 * Mongo. §D2 (Track2 stable-audit / Fable#2): deleting an item must NOT hard-delete its photo when a
 * GenerationSnapshot still references it — that would silently void the image side of an already-
 * labeled outfit for the M6 image-embedding re-measure (append-only, irreversible). An UNreferenced
 * image is still deleted (no orphan bytes). Account deletion still purges everything (erasure).
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
function setToken(uid: string) {
  const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
    adminAuth: { verifyIdToken: jest.Mock };
  };
  adminAuth.verifyIdToken.mockResolvedValue({ uid });
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
  jest.clearAllMocks();
});

function makeRequest(): Any {
  return { headers: { get: (h: string) => (h.toLowerCase() === "authorization" ? "Bearer t" : null) } };
}
async function DELETE(itemId: string) {
  const route = await import("@/app/api/wardrobe/[id]/route");
  return route.DELETE(makeRequest(), { params: Promise.resolve({ id: itemId }) });
}

async function seedUser(uid: string) {
  const user = await User.create({ authProvider: "firebase", authId: uid, email: `${uid}@x.com` });
  return user._id.toString();
}
/** An item + its image; returns both ids. The item's imagePath points at the image (mongo:<id>). */
async function seedItemWithImage(userId: string) {
  const img = await WardrobeImage.create({
    user: userId, wardrobeItem: new Types.ObjectId(),
    base64: Buffer.from("PNG").toString("base64"), contentType: "image/png", sizeBytes: 3,
  });
  const item = await WardrobeItem.create({
    user: userId, name: "Item", category: "top", clothingType: "top", warmth: 2,
    imagePath: `mongo:${img._id.toString()}`,
  });
  return { itemId: item._id.toString(), imageId: img._id.toString() };
}
async function referenceImageInSnapshot(userId: string, imageId: string) {
  await GenerationSnapshot.collection.insertOne({
    user: new Types.ObjectId(userId),
    itemSnapshots: [{ evidence: { image: { imageRef: `mongo:${imageId}` } } }],
  });
}

describe("DELETE /api/wardrobe/[id] — image cascade honors snapshot references (§D2)", () => {
  it("deletes the linked image when NO snapshot references it", async () => {
    const userId = await seedUser("firebase-uid");
    const { itemId, imageId } = await seedItemWithImage(userId);

    const res = await DELETE(itemId);
    expect(res.status).toBe(200);
    expect(await WardrobeItem.countDocuments({ _id: new Types.ObjectId(itemId) })).toBe(0);
    expect(await WardrobeImage.countDocuments({ _id: new Types.ObjectId(imageId) })).toBe(0); // orphan removed
  });

  it("KEEPS the linked image when a snapshot references it (corpus provenance preserved)", async () => {
    const userId = await seedUser("firebase-uid");
    const { itemId, imageId } = await seedItemWithImage(userId);
    await referenceImageInSnapshot(userId, imageId);

    const res = await DELETE(itemId);
    expect(res.status).toBe(200);
    expect(await WardrobeItem.countDocuments({ _id: new Types.ObjectId(itemId) })).toBe(0); // item still gone
    expect(await WardrobeImage.countDocuments({ _id: new Types.ObjectId(imageId) })).toBe(1); // image SURVIVES
  });

  it("does not keep an image referenced only by ANOTHER user's snapshot", async () => {
    const userId = await seedUser("firebase-uid");
    const { itemId, imageId } = await seedItemWithImage(userId);
    // A different user's snapshot referencing the same imageId string must not protect this image.
    await referenceImageInSnapshot(new Types.ObjectId().toString(), imageId);

    const res = await DELETE(itemId);
    expect(res.status).toBe(200);
    expect(await WardrobeImage.countDocuments({ _id: new Types.ObjectId(imageId) })).toBe(0); // deleted
  });

  it("404s a malformed (non-ObjectId) item id instead of a Mongoose CastError 500", async () => {
    await seedUser("firebase-uid");
    const res = await DELETE("not-an-object-id");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Item not found");
  });
});
