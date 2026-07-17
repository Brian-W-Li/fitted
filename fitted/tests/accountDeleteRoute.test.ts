/**
 * DELETE /api/account — the account-deletion promise, BEHAVIORAL over real in-memory Mongo.
 *
 * The friend-facing contract (m5-c8-half2-runbook §8 / §23-H43): deleting an account hard-deletes
 * the user's wardrobe items, interactions, and images (the User cascade hook), REDACTS their
 * GenerationSnapshots (the H43 seam — the only post-insert-mutable fields, immutability-guard
 * enforced), removes the Firebase Auth binding, and touches NOTHING owned by other users.
 *
 * Non-DB seams mocked (Mongo connect + Firebase admin); models/documents/hooks/guards are REAL —
 * the cascade hook and the snapshot immutability guard both execute against a real mongod.
 */
import { Types } from "mongoose";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import User from "@/models/User";
import WardrobeItem from "@/models/WardrobeItem";
import WardrobeImage from "@/models/WardrobeImage";
import OutfitInteraction from "@/models/OutfitInteraction";
import GenerationSnapshot from "@/models/GenerationSnapshot";

jest.mock("@/lib/db", () => ({
  initDatabase: jest.fn(),
  // Delegates to the REAL harness-connected User model so the registered cascade hook + the
  // ObjectId cast (the units that matter) run for real. HONEST LIMIT: the real 3-line
  // `deleteUserWithData` wrapper itself is NOT executed here (its `initDatabase()` needs a real
  // env) — this mock replicates its `User.deleteOne` body, so a change to the wrapper must keep
  // that call shape or this suite goes stale.
  deleteUserWithData: jest.fn(async (userId: unknown) => {
    const UserModel = jest.requireActual("@/models/User").default;
    const result = await UserModel.deleteOne({ _id: userId });
    return result.deletedCount > 0;
  }),
}));
jest.mock("@/lib/firebaseAdmin", () => ({
  adminAuth: { verifyIdToken: jest.fn(), deleteUser: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let harness: MongoHarness;
const oid = () => new Types.ObjectId().toString();

function mockDb() {
  const { initDatabase } = jest.requireMock("@/lib/db") as { initDatabase: jest.Mock };
  initDatabase.mockResolvedValue({
    User,
    WardrobeItem,
    WardrobeImage,
    OutfitInteraction,
    GenerationSnapshot,
  });
}
function setToken(uid: string | null) {
  const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
    adminAuth: { verifyIdToken: jest.Mock; deleteUser: jest.Mock };
  };
  if (uid == null) adminAuth.verifyIdToken.mockRejectedValue(new Error("bad token"));
  else adminAuth.verifyIdToken.mockResolvedValue({ uid });
  adminAuth.deleteUser.mockResolvedValue(undefined);
}
function mockedAdminAuth() {
  return (jest.requireMock("@/lib/firebaseAdmin") as { adminAuth: { deleteUser: jest.Mock } })
    .adminAuth;
}

let consoleErrorSpy: jest.SpyInstance;
beforeAll(async () => {
  harness = await startMemoryMongo([
    User,
    WardrobeItem,
    WardrobeImage,
    OutfitInteraction,
    GenerationSnapshot,
  ]);
}, 120_000);
afterAll(async () => {
  await harness.stop();
});
beforeEach(() => {
  mockDb();
  setToken("uid-a");
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  consoleErrorSpy.mockRestore();
  await harness.clear();
  jest.clearAllMocks();
});

function makeRequest(authHeader: string | null = "Bearer fake-token"): Any {
  return {
    headers: { get: (h: string) => (h.toLowerCase() === "authorization" ? authHeader : null) },
  };
}
async function DELETE(req: Any) {
  return (await import("@/app/api/account/route")).DELETE(req);
}

/** A schema-valid snapshot owned by `userId` (adapted from interactionsBinding.test.ts). */
async function makeSnapshot(userId: string, occasion: string) {
  const topId = oid();
  return GenerationSnapshot.create({
    user: userId,
    sessionId: userId,
    candidateCacheKey: "ck",
    generationIndex: 0,
    requestId: crypto.randomUUID(),
    intent: "daily",
    occasion,
    weather: "mild",
    wardrobeVersion: 0,
    interactionCountAtRequest: 0,
    fittedCoreVersion: "0.4.0",
    generator: {
      provider: "openai",
      model: "gpt-5.4-mini",
      temperature: 0.5,
      promptVersion: "m5-c1.v1",
      maxCompletionTokens: 2200,
      apiSurface: "chat_completions",
      responseFormat: "json_schema_strict",
      reasoningEffort: "none",
      storeMode: "none",
      promptCacheRetention: "in_memory",
      timeoutSeconds: 30,
      maxRetries: 0,
    },
    rankerConfigVersion: "rk",
    scorer: { kind: "cold_start", available: false },
    itemSnapshots: [
      {
        itemId: topId,
        engineVisible: {
          name: "White Tee",
          clothingType: "top",
          warmth: 5,
          colorTags: ["white"],
          occasionTags: ["casual"],
          imageUrl: "",
        },
      },
    ],
    generationAttempts: [],
    candidates: [],
    shownCandidateIds: [],
    shownFullSignatures: [],
    nSurfaced: 0,
    spreadCollapsed: false,
  });
}

async function seedUser(authId: string, email: string) {
  const user = await User.create({ authProvider: "firebase", authId, email });
  const userId = user._id.toString();
  const item = await WardrobeItem.create({
    user: userId,
    name: "Tee",
    clothingType: "top",
    warmth: 5,
    category: "tops",
  });
  await WardrobeImage.create({
    user: userId,
    wardrobeItem: item._id,
    base64: "aGk=",
    contentType: "image/jpeg",
    sizeBytes: 2,
  });
  await OutfitInteraction.create({
    user: userId,
    items: [item._id],
    action: "accepted",
  });
  const snapshot = await makeSnapshot(userId, `occasion-${authId}`);
  return { userId, itemId: item._id.toString(), snapshotId: snapshot._id.toString() };
}

describe("DELETE /api/account — cascade + redaction + auth removal", () => {
  it("401s without a bearer token; 404s for a token with no user row", async () => {
    const resNoAuth = await DELETE(makeRequest(null));
    expect(resNoAuth.status).toBe(401);

    setToken("uid-with-no-row");
    const resNoRow = await DELETE(makeRequest());
    expect(resNoRow.status).toBe(404);
  });

  it("deletes ONLY the caller's user+wardrobe+images+interactions, REDACTS their snapshots, and removes the Firebase user", async () => {
    const a = await seedUser("uid-a", "a@example.com");
    const b = await seedUser("uid-b", "b@example.com");

    setToken("uid-a");
    const res = await DELETE(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // A's owned rows are gone (the real cascade hook ran)…
    expect(await User.findById(a.userId)).toBeNull();
    expect(await WardrobeItem.countDocuments({ user: a.userId })).toBe(0);
    expect(await WardrobeImage.countDocuments({ user: a.userId })).toBe(0);
    expect(await OutfitInteraction.countDocuments({ user: a.userId })).toBe(0);

    // …their snapshot SURVIVES, redacted (H43), with its training truth untouched.
    const snapA = (await GenerationSnapshot.findById(a.snapshotId).lean()) as Any;
    expect(snapA).not.toBeNull();
    expect(snapA.redacted).toBe(true);
    expect(snapA.redactionReason).toBe("account_deleted");
    expect(snapA.redactedAt).toBeInstanceOf(Date);
    expect(snapA.occasion).toBe("occasion-uid-a"); // non-redaction fields unchanged

    // The Firebase Auth binding was removed for A's uid.
    expect(mockedAdminAuth().deleteUser).toHaveBeenCalledTimes(1);
    expect(mockedAdminAuth().deleteUser).toHaveBeenCalledWith("uid-a");

    // B is fully intact — user, rows, and an UNredacted snapshot.
    expect(await User.findById(b.userId)).not.toBeNull();
    expect(await WardrobeItem.countDocuments({ user: b.userId })).toBe(1);
    expect(await WardrobeImage.countDocuments({ user: b.userId })).toBe(1);
    expect(await OutfitInteraction.countDocuments({ user: b.userId })).toBe(1);
    const snapB = (await GenerationSnapshot.findById(b.snapshotId).lean()) as Any;
    expect(snapB.redacted).toBe(false);
  });

  it("still reports success when the Firebase-side deletion fails (Mongo data already removed)", async () => {
    const a = await seedUser("uid-a", "a@example.com");
    setToken("uid-a");
    mockedAdminAuth().deleteUser.mockRejectedValue(new Error("firebase down"));

    const res = await DELETE(makeRequest());
    expect(res.status).toBe(200);
    expect(await User.findById(a.userId)).toBeNull(); // the data deletion still happened
  });
});
