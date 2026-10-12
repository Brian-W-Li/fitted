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
import GenerationSnapshot from "@/models/GenerationSnapshot";
import { MAX_WARDROBE_IMAGE_BYTES } from "@/lib/imageStorage";
import { UPLOAD_RATE_MAX, MAX_WARDROBE_IMAGE_REQUEST_BYTES, CREATE_RATE_MAX } from "@/lib/wardrobeLimits";
import { Types } from "mongoose";

jest.mock("@/lib/db", () => ({
  initDatabase: jest.fn(),
  // Same narrow facade as accountDeleteRoute: real User deletion hooks/native erasure,
  // while the env-bound connect wrapper is replaced with its existing call shape.
  deleteUserWithData: jest.fn(async (user: unknown) => {
    const model = jest.requireActual("@/models/User").default;
    return (await model.deleteOne({ _id: user })).deletedCount > 0;
  }),
}));
jest.mock("@/lib/firebaseAdmin", () => ({ adminAuth: { verifyIdToken: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let harness: MongoHarness;
let userId: string;

function mockDb() {
  const { initDatabase } = jest.requireMock("@/lib/db") as { initDatabase: jest.Mock };
  // The real route AND the real uploadWardrobeImage both call initDatabase() — same real models.
  initDatabase.mockResolvedValue({ User, WardrobeItem, WardrobeImage, GenerationSnapshot });
}
function setToken(uid: string) {
  const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
    adminAuth: { verifyIdToken: jest.Mock };
  };
  adminAuth.verifyIdToken.mockResolvedValue({ uid });
}

beforeAll(async () => {
  harness = await startMemoryMongo([User, WardrobeItem, WardrobeImage, GenerationSnapshot], { replicaSet: true });
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

// Real PNG magic bytes — the storage layer now sniffs the actual format (the declared
// contentType is client-supplied and can lie), so fixtures must be sniffable.
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function makeFile(sizeBytes = 8, type = "image/png") {
  const bytes = new Uint8Array(Math.max(sizeBytes, PNG_MAGIC.length)).fill(1);
  bytes.set(PNG_MAGIC, 0);
  return new File([bytes], "test.png", { type });
}
/** Bytes that are NOT any allowed image format (e.g. a renamed HEIC) with a lying contentType. */
function makeFakeImageFile(type = "image/jpeg") {
  return new File([new Uint8Array(64).fill(1)], "renamed.jpg", { type });
}
function makeRequest({ file = makeFile(), contentLength, view, imageRef }: { file?: File; contentLength?: string; view?: string; imageRef?: string } = {}): Any {
  const fd = new FormData();
  fd.append("file", file);
  if (view) fd.append("view", view);
  if (imageRef) fd.append("imageRef", imageRef);
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

  it("erasure race (§23-H43): account gone at the post-upload guard → the new image self-erases, 401", async () => {
    const id = await seedItem();
    // The account-delete cascade can land between auth and the post-upload User.exists guard. The
    // uploaded image row (REAL photo bytes) must not survive "delete me" — the guard sweeps it + 401s.
    const spy = jest.spyOn(User, "exists").mockResolvedValueOnce(null as never);
    const res = await post(id, makeRequest({ file: makeFile(8) }));
    expect(res.status).toBe(401);
    expect(await WardrobeImage.countDocuments({ user: userId })).toBe(0);
    expect(await WardrobeItem.countDocuments({ user: userId })).toBe(0);
    spy.mockRestore();
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

  it("KEEPS the old image on replace when a GenerationSnapshot references it (§D2 / REPLACE-1)", async () => {
    const id = await seedItem();
    const first = await (await post(id, makeRequest({ file: makeFile(8) }))).json();
    const oldImageId = first.imagePath.slice("mongo:".length);
    // A snapshot references the old image — replacing the photo must NOT strip the pixels an
    // already-labeled outfit was built from (M6 image-embedding provenance).
    await GenerationSnapshot.collection.insertOne({
      user: new Types.ObjectId(userId),
      itemSnapshots: [{ evidence: { image: { imageRef: first.imagePath } } }],
    });

    const second = await (await post(id, makeRequest({ file: makeFile(16) }))).json();
    const newImageId = second.imagePath.slice("mongo:".length);

    expect(newImageId).not.toBe(oldImageId);
    expect(await WardrobeImage.findById(oldImageId).lean<Any>()).not.toBeNull(); // old KEPT (referenced)
    expect(await WardrobeImage.findById(newImageId).lean<Any>()).not.toBeNull(); // new present
    expect((await WardrobeItem.findById(id).lean<Any>()).imagePath).toBe(second.imagePath); // item repointed
  });

  it("a store REJECTED by the sniff leaves the old photo AND its pointer intact (store→repoint→delete)", async () => {
    // The ORDER is the guarantee, and nothing pinned it before: the route used to delete the old
    // image BEFORE calling uploadWardrobeImage. That call throws on a REACHABLE input — a HEIC
    // renamed .jpg reports type image/jpeg, passes the client allowlist, survives the client
    // downscale (which can't decode it, so it forwards the ORIGINAL bytes) and then fails the
    // server's magic-byte sniff. The friend's existing photo was destroyed and imagePath left
    // dangling at a deleted row. It routes real traffic: the DEFECTS-H77(a) notice makes "retry the
    // photo from Edit" the ADVERTISED remedy for a failed upload. Reverting to delete-then-store
    // reddens this (verified by mutation); the two 413 siblings below cover the other throw arms.
    const id = await seedItem();
    const first = await (await post(id, makeRequest({ file: makeFile(8) }))).json();
    const oldImageId = first.imagePath.slice("mongo:".length);

    const res = await post(id, makeRequest({ file: makeFakeImageFile("image/jpeg") }));
    expect(res.status).toBe(415);
    expect(await WardrobeImage.findById(oldImageId).lean<Any>()).not.toBeNull(); // old photo survived
    expect((await WardrobeItem.findById(id).lean<Any>()).imagePath).toBe(first.imagePath); // not dangling
    expect(await WardrobeImage.countDocuments({ user: userId })).toBe(1); // and no orphan row
  });

  it("a store rejected by the 5MB storage cap also leaves the old photo intact", async () => {
    // Same ordering guarantee via the other reachable throw inside uploadWardrobeImage. The
    // existing oversized-upload test covers an item with NO prior photo, so it cannot see a
    // destroy-the-old-one regression.
    const id = await seedItem();
    const first = await (await post(id, makeRequest({ file: makeFile(8) }))).json();
    const oldImageId = first.imagePath.slice("mongo:".length);

    // >5MB with no Content-Length header → the pre-check is skipped and the REAL storage cap throws.
    const res = await post(id, makeRequest({ file: makeFile(MAX_WARDROBE_IMAGE_BYTES + 1) }));
    expect(res.status).toBe(413);
    expect(await WardrobeImage.findById(oldImageId).lean<Any>()).not.toBeNull();
    expect((await WardrobeItem.findById(id).lean<Any>()).imagePath).toBe(first.imagePath);
    expect(await WardrobeImage.countDocuments({ user: userId })).toBe(1);
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

  it("415s bytes that aren't a real JPEG/PNG/WEBP even when the declared contentType lies — nothing stored", async () => {
    // The renamed-HEIC hole: a .heic renamed .jpg carries browser type image/jpeg, fails the
    // client decode, and the downscale fallback uploads the ORIGINAL bytes. Trusting the declared
    // type stored a permanently broken tile with no error anywhere — the sniff is the hard bound.
    const id = await seedItem();
    const res = await post(id, makeRequest({ file: makeFakeImageFile("image/jpeg") }));
    expect(res.status).toBe(415);
    expect((await res.json()).error).toContain("JPEG");
    expect(await WardrobeImage.countDocuments({})).toBe(0);
    expect((await WardrobeItem.findById(id).lean<Any>()).imagePath).toBeUndefined();
  });

  it("stores the SNIFFED contentType, not the declared one, when they disagree", async () => {
    const id = await seedItem();
    const res = await post(id, makeRequest({ file: makeFile(64, "image/jpeg") })); // PNG bytes, jpeg label
    expect(res.status).toBe(200);
    const { imagePath } = await res.json();
    const img = await WardrobeImage.findById(imagePath.slice("mongo:".length)).lean<Any>();
    expect(img.contentType).toBe("image/png"); // server-derived truth
  });

  it("a corrupt client-PATCHed imagePath ('mongo:garbage') does not brick the upload — replace succeeds and heals the pointer", async () => {
    const id = await seedItem({ imagePath: "mongo:garbage" });
    const res = await post(id, makeRequest({ file: makeFile(8) }));
    expect(res.status).toBe(200);
    const { imagePath } = await res.json();
    expect(imagePath).toMatch(/^mongo:[a-f0-9]{24}$/);
    expect((await WardrobeItem.findById(id).lean<Any>()).imagePath).toBe(imagePath); // healed
  });

  it("413s when the per-user byte budget is exhausted (the hard storage bound, §I) — nothing written", async () => {
    // The budget's failure mode is SILENT non-enforcement (a wrong $match cast or a sizeBytes
    // rename makes the aggregate sum 0 and the guard never trips) — this pins it. Seed stored
    // bytes just under the cap on ANOTHER item so the new upload pushes over.
    const { MAX_USER_IMAGE_BYTES } = await import("@/lib/wardrobeLimits");
    const otherItem = await seedItem();
    await WardrobeImage.create({
      user: userId,
      wardrobeItem: otherItem,
      base64: "aGk=",
      contentType: "image/jpeg",
      sizeBytes: MAX_USER_IMAGE_BYTES - 4,
    });
    const id = await seedItem();
    const res = await post(id, makeRequest({ file: makeFile(8) }));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toContain("storage limit");
    expect((await WardrobeItem.findById(id).lean<Any>()).imagePath).toBeUndefined();
    expect(await WardrobeImage.countDocuments({ wardrobeItem: id })).toBe(0);
  });

  it("replacement requires headroom rather than crediting a photo a concurrent writer may pin", async () => {
    // The old row could be pinned between budget admission and deletion. Require enough
    // room for both photos; a rejected replacement must preserve the original bytes/pointer.
    const { MAX_USER_IMAGE_BYTES } = await import("@/lib/wardrobeLimits");
    const id = await seedItem();
    const first = await WardrobeImage.create({
      user: userId,
      wardrobeItem: id,
      base64: "aGk=",
      contentType: "image/jpeg",
      sizeBytes: MAX_USER_IMAGE_BYTES - 4,
    });
    await WardrobeItem.updateOne({ _id: id }, { $set: { imagePath: `mongo:${first._id}` } });
    const res = await post(id, makeRequest({ file: makeFile(8) }));
    expect(res.status).toBe(413);
    expect(await WardrobeImage.findById(first._id)).not.toBeNull();
    expect((await WardrobeItem.findById(id).lean<Any>()).imagePath).toBe(`mongo:${first._id}`);
  });

  it("a replace REJECTED by the budget keeps the old image intact (no dangling imagePath)", async () => {
    // The user is at the cap from OTHER items; replacing this item's small image with a larger
    // file must 413 WITHOUT deleting the old photo — delete-then-reject would destroy data and
    // leave imagePath pointing at nothing.
    const { MAX_USER_IMAGE_BYTES } = await import("@/lib/wardrobeLimits");
    const otherItem = await seedItem();
    await WardrobeImage.create({
      user: userId,
      wardrobeItem: otherItem,
      base64: "aGk=",
      contentType: "image/jpeg",
      sizeBytes: MAX_USER_IMAGE_BYTES - 4,
    });
    const id = await seedItem();
    const old = await WardrobeImage.create({
      user: userId,
      wardrobeItem: id,
      base64: "aGk=",
      contentType: "image/jpeg",
      sizeBytes: 2,
    });
    await WardrobeItem.updateOne({ _id: id }, { $set: { imagePath: `mongo:${old._id}` } });
    const res = await post(id, makeRequest({ file: makeFile(64) }));
    expect(res.status).toBe(413);
    expect(await WardrobeImage.findById(old._id)).not.toBeNull(); // the old photo survived
    expect((await WardrobeItem.findById(id).lean<Any>()).imagePath).toBe(`mongo:${old._id}`);
  });

  it("does NOT count another user's stored bytes against the budget", async () => {
    // The $match user-scope is the load-bearing line — an unscoped aggregate would let one heavy
    // user brick everyone's uploads (and the reverse cast bug would enforce nothing, caught above).
    const { MAX_USER_IMAGE_BYTES } = await import("@/lib/wardrobeLimits");
    const other = await User.create({ authProvider: "firebase", authId: "uid-other", email: "o@x.com" });
    const otherItem = await seedItem({}, other._id.toString());
    await WardrobeImage.create({
      user: other._id,
      wardrobeItem: otherItem,
      base64: "aGk=",
      contentType: "image/jpeg",
      sizeBytes: MAX_USER_IMAGE_BYTES - 4,
    });
    const id = await seedItem();
    const res = await post(id, makeRequest({ file: makeFile(8) }));
    expect(res.status).toBe(200);
  });

  it("429s once the per-user upload pacing window is exhausted — nothing written on the denied call", async () => {
    const id = await seedItem();
    let last: Any = null;
    // Read the real ceiling rather than re-copying the number: the first call past it must be denied.
    for (let i = 0; i < UPLOAD_RATE_MAX + 1; i++) {
      last = await post(id, makeRequest({ file: makeFile(8) }));
    }
    expect(last.status).toBe(429);
    // Replace-style uploads leave exactly one stored image; the denied call added none.
    expect(await WardrobeImage.countDocuments({ user: userId })).toBe(1);
  });

  // DEFECTS-H77 / fix #3. Every photographed add is one create + one upload, so an upload ceiling BELOW
  // the create ceiling 429s the photo of an item the create route just admitted — silent photo loss
  // on the batch-add a friend does when onboarding a closet, and (before the H77(a) fix) with no
  // visible warning at all. Asserted rather than commented, because a lone comment is exactly what
  // let the two numbers drift apart in the first place.
  it("the upload pacing ceiling is never stricter than the item-create ceiling", () => {
    expect(UPLOAD_RATE_MAX).toBeGreaterThanOrEqual(CREATE_RATE_MAX);
  });

  // Both size gates below were pinned REJECT-ONLY. The largest accepted fixture anywhere in this file
  // was 64 bytes, so `MAX_WARDROBE_IMAGE_BYTES` could drop 5MB → 64 and every test stayed green while
  // EVERY real upload 413'd — silently routing every friend photo into the "saved, but its photo
  // didn't upload" path (DEFECTS-H77(a)) and zeroing the M6 image side. Accept sides, from real bytes:
  it("ACCEPTS a 1MB image — the cap must admit an ordinary post-downscale phone photo", async () => {
    const id = await seedItem();
    const res = await post(id, makeRequest({ file: makeFile(1024 * 1024) }));
    expect(res.status).toBe(200);
    const { imagePath } = await res.json();
    const img = await WardrobeImage.findById(imagePath.slice("mongo:".length)).lean<Any>();
    expect(img.sizeBytes).toBe(1024 * 1024);
  });

  it("the storage cap stays under the BSON document limit after base64 inflation", () => {
    // The stated reason for the value: bytes are stored base64 (×4/3) inside one Mongo document, so
    // the cap must leave room under the hard 16MB BSON ceiling. Stating the DERIVATION rather than
    // restating 5MB keeps this from being a mirror, and it brackets the constant from above.
    expect(MAX_WARDROBE_IMAGE_BYTES * (4 / 3)).toBeLessThan(16 * 1024 * 1024);
  });

  it("ACCEPTS a request whose Content-Length is under the limit (the pre-check's accept side)", async () => {
    // Every other test omits the header entirely, so the pre-check was only ever exercised in its
    // rejecting direction: `> MAX_WARDROBE_IMAGE_REQUEST_BYTES` could become `> 0` (or slip a units
    // factor) and the suite would stay green while every real browser upload 413'd before
    // `formData()` was even read — `fetch` with a FormData body ALWAYS sets Content-Length.
    const id = await seedItem();
    const req = makeRequest({ file: makeFile(8), contentLength: String(1024) });
    const res = await post(id, req);
    expect(res.status).toBe(200);
    expect(req.formData).toHaveBeenCalledTimes(1);
  });

  it("ACCEPTS a Content-Length inside the multipart-overhead allowance (a real request, not a constant compare)", async () => {
    // Pins MAX_MULTIPART_OVERHEAD_BYTES from below by actually SENDING a Content-Length in the
    // interval (image cap, image cap + overhead] — the band no other test in this file touches. A
    // constant comparison here was named for this guarantee but issued no request, so shrinking the
    // allowance to 0 left the suite green while a max-size image plus its multipart envelope 413'd on
    // framing bytes alone. Latent today only because the client caps below this; that changes the
    // moment a non-modal caller appears.
    const id = await seedItem();
    const req = makeRequest({
      file: makeFile(8),
      contentLength: String(MAX_WARDROBE_IMAGE_BYTES + 1024),
    });
    const res = await post(id, req);
    expect(res.status).toBe(200);
    expect(req.formData).toHaveBeenCalledTimes(1);
    // And the band is genuinely a band: the constant must leave room above the image cap.
    expect(MAX_WARDROBE_IMAGE_REQUEST_BYTES).toBeGreaterThan(MAX_WARDROBE_IMAGE_BYTES);
  });
});

export {};


it("replaces a legacy null image pointer without leaving an unlinked new photo", async () => {
  const id = await seedItem({ imagePath: null });
  const response = await post(id, makeRequest({ file: makeFile(8) }));
  expect(response.status).toBe(200);
  const { imagePath } = await response.json();
  expect((await WardrobeItem.findById(id).lean<Any>()).imagePath).toBe(imagePath);
  expect(await WardrobeImage.countDocuments({ wardrobeItem: id })).toBe(1);
});

it("a simultaneous item deletion after upload storage reclaims the new unlinked bytes", async () => {
  const id = await seedItem();
  const update = WardrobeItem.collection.updateOne.bind(WardrobeItem.collection);
  const race = jest.spyOn(WardrobeItem.collection, "updateOne").mockImplementationOnce((async (...args: Any[]) => {
    await WardrobeItem.deleteOne({ _id: id });
    return update(...args as [Any, Any]);
  }) as Any);
  try {
    expect((await post(id, makeRequest())).status).toBe(409);
    expect(await WardrobeImage.countDocuments({ wardrobeItem: id })).toBe(0);
  } finally { race.mockRestore(); }
});


it("heals an exact raw malformed pointer without schema-casting its compare-and-swap", async () => {
  const id = await seedItem();
  await WardrobeItem.collection.updateOne({ _id: new Types.ObjectId(id) }, { $set: { imagePath: 7 } });
  const response = await post(id, makeRequest());
  expect(response.status).toBe(200);
  const { imagePath } = await response.json();
  expect((await WardrobeItem.findById(id).lean<Any>()).imagePath).toBe(imagePath);
  expect(await WardrobeImage.countDocuments({ wardrobeItem: id })).toBe(1);
});

it("simultaneous photo replacements leave the winner linked and reclaim the losing upload", async () => {
  const id = await seedItem();
  let ready!: () => void;
  const parked = new Promise<void>(resolve => { ready = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const update = WardrobeItem.collection.updateOne.bind(WardrobeItem.collection);
  const race = jest.spyOn(WardrobeItem.collection, "updateOne").mockImplementationOnce((async (...args: Any[]) => {
    ready(); await gate; return update(...args as [Any, Any]);
  }) as Any);
  try {
    const losing = post(id, makeRequest()); await parked;
    const winning = await post(id, makeRequest()); expect(winning.status).toBe(200);
    const { imagePath } = await winning.json();
    release(); expect((await losing).status).toBe(409);
    expect((await WardrobeItem.findById(id).lean<Any>()).imagePath).toBe(imagePath);
    expect(await WardrobeImage.countDocuments({ wardrobeItem: id })).toBe(1);
  } finally { release(); race.mockRestore(); }
});

it("CAS loser whose account disappeared returns auth failure and leaves no bytes", async () => {
  const id = await seedItem();
  const update = WardrobeItem.collection.updateOne.bind(WardrobeItem.collection);
  const race = jest.spyOn(WardrobeItem.collection, "updateOne").mockImplementationOnce((async (...args: Any[]) => {
    await User.deleteOne({ _id: userId });
    return update(...args as [Any, Any]);
  }) as Any);
  try {
    expect((await post(id, makeRequest())).status).toBe(401);
    expect(await WardrobeImage.countDocuments({ user: userId })).toBe(0);
    expect(await WardrobeItem.countDocuments({ user: userId })).toBe(0);
  } finally { race.mockRestore(); }
});

async function removePhoto(id: string, view: string, imageRef: string) {
  const { DELETE } = await import("@/app/api/wardrobe/[id]/image/route");
  return DELETE({ ...makeRequest(), json: async () => ({ view, imageRef }) }, params(id));
}
async function itemDelete(id: string) {
  const { DELETE } = await import("@/app/api/wardrobe/[id]/route");
  return DELETE(makeRequest(), params(id));
}
async function clearWardrobe() {
  const { DELETE } = await import("@/app/api/wardrobe/clear/route");
  return DELETE(makeRequest());
}
async function append(id: string) {
  return post(id, makeRequest({ view: "supplemental" }));
}
function pauseNextCAS() {
  let ready!: () => void;
  const parked = new Promise<void>(resolve => { ready = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const update = WardrobeItem.collection.updateOne.bind(WardrobeItem.collection);
  const spy = jest.spyOn(WardrobeItem.collection, "updateOne").mockImplementationOnce((async (...args: Any[]) => {
    ready(); await gate; return update(...args as [Any, Any]);
  }) as Any);
  return { parked, release, spy };
}

it("stores at most two additional views and replaces/removes exact refs without changing primary or the other view", async () => {
  const id = await seedItem();
  const first = await (await post(id, makeRequest())).json();
  const one = await (await append(id)).json();
  const two = await (await append(id)).json();
  expect(two.imagePath).toBe(first.imagePath);
  expect(two.supplementalImages).toHaveLength(2);
  const denied = await append(id);
  expect(denied.status).toBe(409);
  expect((await denied.json()).attachments).toEqual({ imagePath: two.imagePath, supplementalImages: two.supplementalImages });
  expect(await WardrobeImage.countDocuments({ wardrobeItem: id })).toBe(3);
  const old = one.supplementalImages[0];
  const replaced = await (await post(id, makeRequest({ view: "supplemental", imageRef: old }))).json();
  expect(replaced.imagePath).toBe(first.imagePath);
  expect(replaced.supplementalImages[1]).toBe(two.supplementalImages[1]);
  expect(replaced.supplementalImages[0]).not.toBe(old);
  expect(await WardrobeImage.findById(old.slice(6))).toBeNull();
  const removed = await (await removePhoto(id, "supplemental", replaced.supplementalImages[0])).json();
  expect(removed).toMatchObject({ imagePath: first.imagePath, supplementalImages: [two.supplementalImages[1]] });
  expect(await WardrobeImage.countDocuments({ wardrobeItem: id })).toBe(2);
  expect((await removePhoto(id, "supplemental", old)).status).toBe(409);
});

it("retains an immutable historical primary when removing it, while current supplemental views remain current only", async () => {
  const id = await seedItem();
  const first = await (await post(id, makeRequest())).json();
  const current = await (await append(id)).json();
  await GenerationSnapshot.collection.insertOne({ user: new Types.ObjectId(userId),
    itemSnapshots: [{ evidence: { image: { imageRef: first.imagePath } } }],
  });
  const removed = await removePhoto(id, "primary", first.imagePath);
  expect(removed.status).toBe(200);
  expect(await removed.json()).toEqual({ ok: true, supplementalImages: current.supplementalImages });
  expect(await WardrobeImage.findById(first.imagePath.slice(6))).not.toBeNull();
  expect((await WardrobeItem.findById(id).lean<Any>()).imagePath).toBeUndefined();
  await itemDelete(id);
  expect(await WardrobeImage.countDocuments({ user: userId })).toBe(1);
});

it("supplemental failure preserves all current refs and their bytes; explicit retry writes only the failed view", async () => {
  const id = await seedItem();
  await post(id, makeRequest());
  const saved = await (await append(id)).json();
  expect((await post(id, makeRequest({ view: "supplemental", imageRef: saved.supplementalImages[0], file: makeFakeImageFile() }))).status).toBe(415);
  expect((await WardrobeItem.findById(id).lean<Any>())).toMatchObject({ imagePath: saved.imagePath, supplementalImages: saved.supplementalImages });
  expect(await WardrobeImage.countDocuments({ wardrobeItem: id })).toBe(2);
  expect((await append(id)).status).toBe(200);
  expect(await WardrobeImage.countDocuments({ wardrobeItem: id })).toBe(3);
});

it("does not allow nonowners to append, replace, or remove views or attach another item's ref", async () => {
  const other = await User.create({ authProvider: "firebase", authId: "other", email: "other@x.com" });
  const id = await seedItem({}, other._id.toString());
  const borrowed = `mongo:${new Types.ObjectId()}`;
  expect((await append(id)).status).toBe(404);
  expect((await post(id, makeRequest({ view: "supplemental", imageRef: borrowed }))).status).toBe(404);
  expect((await removePhoto(id, "supplemental", borrowed)).status).toBe(404);
  const mine = await seedItem();
  expect((await post(mine, makeRequest({ view: "supplemental", imageRef: borrowed }))).status).toBe(409);
  expect(await WardrobeImage.countDocuments()).toBe(0);
});

it("complete-set CAS serializes concurrent appends at the cap and reclaims the losing fresh bytes", async () => {
  const id = await seedItem();
  const one = await (await append(id)).json();
  const race = pauseNextCAS();
  try {
    const loser = append(id); await race.parked;
    const winner = await append(id); expect(winner.status).toBe(200);
    const winning = await winner.json();
    race.release(); expect((await loser).status).toBe(409);
    expect((await WardrobeItem.findById(id).lean<Any>()).supplementalImages).toEqual(winning.supplementalImages);
    expect(winning.supplementalImages).toContain(one.supplementalImages[0]);
    expect(await WardrobeImage.countDocuments({ wardrobeItem: id })).toBe(2);
  } finally { race.release(); race.spy.mockRestore(); }
});

it("a concurrent primary edit cannot overwrite a supplemental append", async () => {
  const id = await seedItem();
  const original = await (await post(id, makeRequest())).json();
  const race = pauseNextCAS();
  try {
    const loser = post(id, makeRequest()); await race.parked;
    const winner = await (await append(id)).json();
    race.release(); expect((await loser).status).toBe(409);
    expect((await WardrobeItem.findById(id).lean<Any>())).toMatchObject({ imagePath: original.imagePath, supplementalImages: winner.supplementalImages });
    expect(await WardrobeImage.countDocuments({ wardrobeItem: id })).toBe(2);
  } finally { race.release(); race.spy.mockRestore(); }
});

it("a replacement racing removal loses its CAS and preserves the remaining views", async () => {
  const id = await seedItem();
  const one = await (await append(id)).json();
  const two = await (await append(id)).json();
  const race = pauseNextCAS();
  try {
    const loser = post(id, makeRequest({ view: "supplemental", imageRef: one.supplementalImages[0] })); await race.parked;
    expect((await removePhoto(id, "supplemental", one.supplementalImages[0])).status).toBe(200);
    race.release(); expect((await loser).status).toBe(409);
    expect((await WardrobeItem.findById(id).lean<Any>()).supplementalImages).toEqual([two.supplementalImages[1]]);
    expect(await WardrobeImage.countDocuments({ wardrobeItem: id })).toBe(1);
  } finally { race.release(); race.spy.mockRestore(); }
});

it.each(["delete", "clear"])("in-flight supplemental append versus %s reclaims the upload and all current views", async operation => {
  const id = await seedItem();
  await post(id, makeRequest()); await append(id);
  const race = pauseNextCAS();
  try {
    const upload = append(id); await race.parked;
    expect((await (operation === "delete" ? itemDelete(id) : clearWardrobe())).status).toBe(200);
    race.release(); expect((await upload).status).toBe(409);
    expect(await WardrobeImage.countDocuments({ user: userId })).toBe(0);
    expect(await WardrobeItem.countDocuments({ user: userId })).toBe(0);
  } finally { race.release(); race.spy.mockRestore(); }
});

it("clear preserves a newly created garment's leased in-flight upload through link and cleanup", async () => {
  await seedItem();
  const distinct = WardrobeImage.distinct.bind(WardrobeImage);
  let ready!: () => void;
  const parked = new Promise<void>(resolve => { ready = resolve; });
  let releaseSweep!: () => void;
  const gate = new Promise<void>(resolve => { releaseSweep = resolve; });
  const sweep = jest.spyOn(WardrobeImage, "distinct").mockImplementationOnce(((...args: Any[]) => ({
    exec: async () => { ready(); await gate; return distinct(...args as [Any, Any]).exec(); },
  })) as Any);
  let race: ReturnType<typeof pauseNextCAS> | undefined;
  try {
    const clearing = clearWardrobe(); await parked;
    const id = await seedItem(); race = pauseNextCAS();
    const uploading = append(id); await race.parked;
    releaseSweep(); expect((await clearing).status).toBe(200);
    expect(await WardrobeImage.countDocuments({ wardrobeItem: id })).toBe(1);
    race.release(); expect((await uploading).status).toBe(200);
    const item = await WardrobeItem.findById(id).lean<Any>();
    expect(item.supplementalImages).toHaveLength(1);
    expect(await WardrobeImage.findById(item.supplementalImages[0].slice(6))).not.toBeNull();
  } finally { releaseSweep(); race?.release(); race?.spy.mockRestore(); sweep.mockRestore(); }
});

it("an erased account's stored upload self-erases even when CAS throws after erasure's final sweep", async () => {
  const id = await seedItem();
  const update = jest.spyOn(WardrobeItem.collection, "updateOne").mockImplementationOnce((async () => {
    await User.deleteOne({ _id: userId });
    const { cascadeDeleteUserData } = await import("@/models/User");
    await cascadeDeleteUserData(User.db, userId);
    // Reproduce already-authed insertion after final sweep then failure.
    await WardrobeImage.collection.insertOne({ _id: new Types.ObjectId(), user: new Types.ObjectId(userId), wardrobeItem: new Types.ObjectId(id), base64: "late-bytes", contentType: "image/png", sizeBytes: 8 });
    throw new Error("lost update acknowledgment");
  }) as Any);
  try {
    expect((await append(id)).status).toBe(401);
    expect(await WardrobeImage.countDocuments({ user: userId })).toBe(0);
    expect(await WardrobeItem.countDocuments({ user: userId })).toBe(0);
  } finally { update.mockRestore(); }
});

it("ambiguous late-committing attachment CAS keeps a durable lease rather than deleting the soon-linked bytes", async () => {
  const id = await seedItem();
  const update = WardrobeItem.collection.updateOne.bind(WardrobeItem.collection);
  let lateCommit!: () => Promise<unknown>;
  const uncertain = jest.spyOn(WardrobeItem.collection, "updateOne").mockImplementationOnce((async (...args: Any[]) => {
    lateCommit = () => update(...args as [Any, Any]);
    throw new Error("lost update acknowledgment");
  }) as Any);
  try {
    expect((await append(id)).status).toBe(500);
    const bytes = await WardrobeImage.findOne({ wardrobeItem: id }).lean<Any>();
    expect(bytes.attachmentLease).toEqual(expect.any(String));
    await lateCommit();
    expect((await WardrobeItem.findById(id).lean<Any>()).supplementalImages).toEqual([`mongo:${bytes._id}`]);
    expect(await WardrobeImage.findById(bytes._id)).not.toBeNull();
  } finally { uncertain.mockRestore(); }
});

it("server-authored supplemental refs cannot be injected via item POST/PATCH and are absent from generation projections", async () => {
  const injected = [`mongo:${new Types.ObjectId()}`];
  const route = await import("@/app/api/wardrobe/route");
  const create = await route.POST({ ...makeRequest(), json: async () => ({ name: "Manual", category: "top", supplementalImages: injected }) });
  expect(create.status).toBe(201);
  const { item } = await create.json();
  expect(item.supplementalImages).toEqual([]);
  const edit = await import("@/app/api/wardrobe/[id]/route");
  const patched = await edit.PATCH({ ...makeRequest(), json: async () => ({ supplementalImages: injected }) }, params(item.id));
  expect(patched.status).toBe(200);
  expect((await patched.json()).item.supplementalImages).toEqual([]);
  const primary = await (await post(item.id, makeRequest())).json();
  await append(item.id);
  const raw = await WardrobeItem.findById(item.id).lean<Any>();
  const { projectWardrobe } = await import("@/lib/mlRequestAdapter");
  const { buildEvidence } = await import("@/lib/mlSnapshotMerge");
  const wire = projectWardrobe([raw]).wire;
  expect(wire[0].imageUrl).toBe(`/api/images/${primary.imagePath.slice(6)}`);
  expect(JSON.stringify(wire)).not.toContain(raw.supplementalImages[0]);
  expect(buildEvidence(raw).image).toEqual({ imageRef: primary.imagePath });
  expect(JSON.stringify(buildEvidence(raw))).not.toContain(raw.supplementalImages[0]);
  const get = await route.GET(makeRequest());
  expect((await get.json()).items[0].supplementalImages).toEqual(raw.supplementalImages);
});

it("primary replacement clears a legacy external alias so UI and engine both use the fresh primary", async () => {
  const id = await seedItem({ imageUrl: "https://example.test/legacy.jpg" });
  const response = await post(id, makeRequest());
  expect(response.status).toBe(200);
  const { imagePath } = await response.json();
  const raw = await WardrobeItem.findById(id).lean<Any>();
  expect(raw.imageUrl).toBeUndefined();
  const { projectWardrobe } = await import("@/lib/mlRequestAdapter");
  expect(projectWardrobe([raw]).wire[0].imageUrl).toBe(`/api/images/${imagePath.slice(6)}`);
});

it("stale primary removal cannot erase a newer primary", async () => {
  const id = await seedItem();
  const old = await (await post(id, makeRequest())).json();
  const current = await (await post(id, makeRequest())).json();
  const stale = await removePhoto(id, "primary", old.imagePath);
  expect(stale.status).toBe(409);
  expect((await stale.json()).attachments.imagePath).toBe(current.imagePath);
  expect((await WardrobeItem.findById(id).lean<Any>()).imagePath).toBe(current.imagePath);
  expect(await WardrobeImage.findById(current.imagePath.slice(6))).not.toBeNull();
});

it("supplemental replacement shares the byte limits and rejects oversized bytes without losing any saved view", async () => {
  const id = await seedItem();
  const current = await (await append(id)).json();
  const response = await post(id, makeRequest({ view: "supplemental", imageRef: current.supplementalImages[0], file: makeFile(MAX_WARDROBE_IMAGE_BYTES + 1) }));
  expect(response.status).toBe(413);
  expect((await WardrobeItem.findById(id).lean<Any>()).supplementalImages).toEqual(current.supplementalImages);
  expect(await WardrobeImage.countDocuments({ wardrobeItem: id })).toBe(1);
});

it("clear reclaims current extras and preserves historic primary; account erasure then purges all retained and leased bytes", async () => {
  const id = await seedItem();
  const primary = await (await post(id, makeRequest())).json();
  await append(id); await append(id);
  await GenerationSnapshot.collection.insertOne({ user: new Types.ObjectId(userId), itemSnapshots: [{ evidence: { image: { imageRef: primary.imagePath } } }] });
  expect((await clearWardrobe()).status).toBe(200);
  expect(await WardrobeImage.countDocuments({ user: userId })).toBe(1);
  expect(await WardrobeImage.findById(primary.imagePath.slice(6))).not.toBeNull();
  await WardrobeImage.create({ user: userId, wardrobeItem: new Types.ObjectId(), base64: "pending", contentType: "image/png", sizeBytes: 8, attachmentLease: "unknown-outcome" });
  const admin = jest.requireMock("@/lib/firebaseAdmin").adminAuth;
  admin.deleteUser = jest.fn().mockResolvedValue(undefined);
  const { DELETE } = await import("@/app/api/account/route");
  expect((await DELETE(makeRequest())).status).toBe(200);
  expect(await WardrobeImage.countDocuments({ user: userId })).toBe(0);
  expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(0);
  expect(await User.findById(userId)).toBeNull();
});

it("clear does not delete settled bytes of a garment created and linked after its item-deletion phase", async () => {
  await seedItem();
  const distinct = WardrobeImage.distinct.bind(WardrobeImage);
  let ready!: () => void;
  const parked = new Promise<void>(resolve => { ready = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const sweep = jest.spyOn(WardrobeImage, "distinct").mockImplementationOnce(((...args: Any[]) => ({
    exec: async () => { ready(); await gate; return distinct(...args as [Any, Any]).exec(); },
  })) as Any);
  try {
    const clearing = clearWardrobe(); await parked;
    const id = await seedItem();
    const saved = await (await append(id)).json();
    release(); expect((await clearing).status).toBe(200);
    expect(await WardrobeItem.findById(id)).not.toBeNull();
    expect(await WardrobeImage.findById(saved.supplementalImages[0].slice(6))).not.toBeNull();
  } finally { release(); sweep.mockRestore(); }
});

it("removes the displayed primary from a legacy dual-alias row and reclaims both local aliases", async () => {
  const id = await seedItem();
  const primary = await (await post(id, makeRequest())).json();
  const fallback = await WardrobeImage.create({ user: userId, wardrobeItem: id, base64: "legacy", contentType: "image/png", sizeBytes: 6 });
  await WardrobeItem.updateOne({ _id: id }, { $set: { imageUrl: `/api/images/${fallback._id}` } });
  const removed = await removePhoto(id, "primary", `/api/images/${fallback._id}`);
  expect(removed.status).toBe(200);
  expect(await removed.json()).toEqual({ ok: true, supplementalImages: [] });
  expect(await WardrobeImage.findById(primary.imagePath.slice(6))).toBeNull();
  expect(await WardrobeImage.findById(fallback._id)).toBeNull();
});
