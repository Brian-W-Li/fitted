/**
 * POST /api/wardrobe/[id]/image — BEHAVIORAL over real in-memory Mongo (post-m5-reset §4.6 / Track-1).
 * The prior version mocked `@/lib/imageStorage` + the whole DB chain and only checked the two 413
 * bounds. This version drives the REAL route with the REAL `uploadWardrobeImage`, so a successful
 * upload actually WRITES a WardrobeImage doc and repoints the item — and the read-back proves it. It
 * also exercises the real ownership scope (a non-owner 404s) and the old-image cleanup on replace.
 *
 * Only the Firebase token verify + the Mongo connect are mocked; models/documents/storage are REAL.
 */
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import User from "@/models/User";
import WardrobeItem from "@/models/WardrobeItem";
import WardrobeImage from "@/models/WardrobeImage";
import { MAX_WARDROBE_IMAGE_BYTES } from "@/lib/imageStorage";

jest.mock("@/lib/db", () => ({ initDatabase: jest.fn() }));
jest.mock("@/lib/firebaseAdmin", () => ({ adminAuth: { verifyIdToken: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let harness: MongoHarness;
let userId: string;

function mockDb() {
  const { initDatabase } = jest.requireMock("@/lib/db") as { initDatabase: jest.Mock };
  // The real route AND the real uploadWardrobeImage both call initDatabase() — same real models.
  initDatabase.mockResolvedValue({ User, WardrobeItem, WardrobeImage });
}
function setToken(uid: string) {
  const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
    adminAuth: { verifyIdToken: jest.Mock };
  };
  adminAuth.verifyIdToken.mockResolvedValue({ uid });
}

beforeAll(async () => {
  harness = await startMemoryMongo([User, WardrobeItem, WardrobeImage]);
}, 120_000);
afterAll(async () => {
  await harness.stop();
});
let consoleErrorSpy: jest.SpyInstance;
beforeEach(async () => {
  mockDb();
  setToken("firebase-uid");
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  const user = await User.create({ authProvider: "firebase", authId: "firebase-uid", email: "u@x.com" });
  userId = user._id.toString();
});
afterEach(async () => {
  consoleErrorSpy.mockRestore();
  await harness.clear();
  jest.clearAllMocks();
});

function makeFile(sizeBytes = 8, type = "image/png") {
  return new File([new Uint8Array(sizeBytes).fill(1)], "test.png", { type });
}
function makeRequest({ file = makeFile(), contentLength }: { file?: File; contentLength?: string } = {}): Any {
  const fd = new FormData();
  fd.append("file", file);
  const formData = jest.fn(async () => fd);
  return {
    headers: {
      get: (h: string) => {
        const header = h.toLowerCase();
        if (header === "authorization") return "Bearer fake-token";
        if (header === "content-length") return contentLength ?? null;
        return null;
      },
    },
    formData,
  };
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function seedItem(fields: Record<string, unknown> = {}, owner = userId) {
  const doc = await WardrobeItem.create({
    user: owner,
    name: "Tee",
    category: "top",
    clothingType: "top",
    warmth: 2,
    ...fields,
  });
  return doc._id.toString();
}
async function post(id: string, req: Any) {
  const { POST } = await import("@/app/api/wardrobe/[id]/image/route");
  return POST(req, params(id));
}

describe("POST /api/wardrobe/[id]/image — behavioral, real Mongo", () => {
  it("persists a WardrobeImage and repoints the item at it on a successful upload", async () => {
    const id = await seedItem();
    const res = await post(id, makeRequest({ file: makeFile(8) }));
    expect(res.status).toBe(200);

    const { imagePath } = await res.json();
    expect(imagePath).toMatch(/^mongo:[a-f0-9]{24}$/);

    // The item now points at the stored image…
    expect((await WardrobeItem.findById(id).lean<Any>()).imagePath).toBe(imagePath);
    // …and the image bytes actually persisted, scoped to the owner + item.
    const imageId = imagePath.slice("mongo:".length);
    const img = await WardrobeImage.findById(imageId).lean<Any>();
    expect(img).not.toBeNull();
    expect(img.user.toString()).toBe(userId);
    expect(img.wardrobeItem.toString()).toBe(id);
    expect(img.contentType).toBe("image/png");
    expect(img.sizeBytes).toBe(8);
  });

  it("deletes the previously-linked WardrobeImage when a new one replaces it", async () => {
    const id = await seedItem();
    // First upload.
    const first = await (await post(id, makeRequest({ file: makeFile(8) }))).json();
    const oldImageId = first.imagePath.slice("mongo:".length);
    expect(await WardrobeImage.findById(oldImageId).lean<Any>()).not.toBeNull();

    // Second upload replaces it.
    const second = await (await post(id, makeRequest({ file: makeFile(16) }))).json();
    const newImageId = second.imagePath.slice("mongo:".length);

    expect(newImageId).not.toBe(oldImageId);
    expect(await WardrobeImage.findById(oldImageId).lean<Any>()).toBeNull(); // old cleaned up
    expect(await WardrobeImage.findById(newImageId).lean<Any>()).not.toBeNull(); // new present
    expect((await WardrobeItem.findById(id).lean<Any>()).imagePath).toBe(second.imagePath);
  });

  it("404s (no image written) when the item is owned by another user", async () => {
    const other = await User.create({ authProvider: "firebase", authId: "other", email: "o@x.com" });
    const id = await seedItem({}, other._id.toString());

    const res = await post(id, makeRequest({ file: makeFile(8) }));
    expect(res.status).toBe(404);
    expect(await WardrobeImage.countDocuments({})).toBe(0); // nothing persisted for the attacker
  });

  it("400s when the form has no file field (nothing written)", async () => {
    const id = await seedItem();
    const req = makeRequest();
    (req.formData as jest.Mock).mockResolvedValue(new FormData()); // empty form
    const res = await post(id, req);
    expect(res.status).toBe(400);
    expect(await WardrobeImage.countDocuments({})).toBe(0);
  });

  it("returns 413 from Content-Length before buffering multipart form data or persisting", async () => {
    const id = await seedItem();
    const req = makeRequest({ contentLength: String(MAX_WARDROBE_IMAGE_BYTES + 64 * 1024 + 1) });
    const res = await post(id, req);

    expect(res.status).toBe(413);
    expect(req.formData).not.toHaveBeenCalled();
    expect(await WardrobeImage.countDocuments({})).toBe(0);
  });

  it("returns 413 when the storage cap catches an oversized image lacking a length header", async () => {
    const id = await seedItem();
    // >5MB, no content-length header → the pre-check is skipped and the REAL storage cap throws.
    const req = makeRequest({ file: makeFile(MAX_WARDROBE_IMAGE_BYTES + 1) });
    const res = await post(id, req);

    expect(res.status).toBe(413);
    expect(req.formData).toHaveBeenCalledTimes(1);
    expect(await WardrobeImage.countDocuments({})).toBe(0);
    // The oversized upload must not have repointed the item.
    expect((await WardrobeItem.findById(id).lean<Any>()).imagePath).toBeUndefined();
  });
});

export {};
