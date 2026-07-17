/**
 * DELETE /api/account — the account-deletion promise, BEHAVIORAL over real in-memory Mongo.
 *
 * The friend-facing contract (m5-c8-half2-runbook §8 / §23-H43 Track 2 policy — "delete me"
 * means delete): deleting an account hard-deletes the user's wardrobe items, interactions,
 * images, AND GenerationSnapshots (the cascade's native-driver erasure door through the
 * snapshot delete guard; the route redacts first as a two-phase fail-safe), removes the
 * Firebase Auth binding, and touches NOTHING owned by other users.
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

describe("DELETE /api/account — cascade erasure + auth removal", () => {
  it("401s without a bearer token; 404s for a token with no user row", async () => {
    const resNoAuth = await DELETE(makeRequest(null));
    expect(resNoAuth.status).toBe(401);

    setToken("uid-with-no-row");
    const resNoRow = await DELETE(makeRequest());
    expect(resNoRow.status).toBe(404);
  });

  it("erases ONLY the caller's user+wardrobe+images+interactions+snapshots, and removes the Firebase user", async () => {
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

    // …including their snapshots: erased, not just redacted — the friend-facing "delete me"
    // promise (§23-H43 Track 2 policy). The cascade's native-driver arm is the ONE sanctioned
    // door through the snapshot delete guard.
    expect(await GenerationSnapshot.findById(a.snapshotId)).toBeNull();
    expect(await GenerationSnapshot.countDocuments({ user: a.userId })).toBe(0);

    // The Firebase Auth binding was removed for A's uid.
    expect(mockedAdminAuth().deleteUser).toHaveBeenCalledTimes(1);
    expect(mockedAdminAuth().deleteUser).toHaveBeenCalledWith("uid-a");

    // B is fully intact — user, rows, and an UNredacted, UNerased snapshot.
    expect(await User.findById(b.userId)).not.toBeNull();
    expect(await WardrobeItem.countDocuments({ user: b.userId })).toBe(1);
    expect(await WardrobeImage.countDocuments({ user: b.userId })).toBe(1);
    expect(await OutfitInteraction.countDocuments({ user: b.userId })).toBe(1);
    const snapB = (await GenerationSnapshot.findById(b.snapshotId).lean()) as Any;
    expect(snapB).not.toBeNull();
    expect(snapB.redacted).toBe(false);
  });

  it("phase-3 sweep erases a snapshot that landed AFTER the cascade's pre-hook sweep (the third race interleaving)", async () => {
    // The User cascade is a PRE-hook: an in-flight render can persist a row after the cascade's
    // generationsnapshots deleteMany but before (or around) the user row's death — the writer's
    // own User.exists check may still see the user alive. The route's phase-3 post-deletion
    // cascade re-run is what erases that row; simulate the interleaving by injecting a late
    // snapshot write inside deleteUserWithData, after the real cascade has already swept.
    const a = await seedUser("uid-a", "a@example.com");
    setToken("uid-a");
    const { deleteUserWithData } = jest.requireMock("@/lib/db") as { deleteUserWithData: jest.Mock };
    deleteUserWithData.mockImplementationOnce(async (userId: unknown) => {
      const UserModel = jest.requireActual("@/models/User").default;
      const result = await UserModel.deleteOne({ _id: userId }); // real cascade sweep runs here
      await makeSnapshot(String(userId), "late-in-flight-write"); // the racing row lands after it
      return result.deletedCount > 0;
    });

    const res = await DELETE(makeRequest());
    expect(res.status).toBe(200);
    expect(await GenerationSnapshot.countDocuments({ user: a.userId })).toBe(0); // swept by phase 3
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
