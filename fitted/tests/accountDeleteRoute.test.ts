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
import { spawn } from "node:child_process";
import path from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
  adminAuth: { verifyIdToken: jest.fn(), verifySessionCookie: jest.fn(), deleteUser: jest.fn() },
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
  else adminAuth.verifyIdToken.mockResolvedValue({ uid, email: "a@example.com" });
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
  await User.collection.updateOne({ _id: user._id }, { $set: { outfitPlans: [{ planId: crypto.randomUUID(), lifecycle: "active", revision: 1,
    snapshotId: String(snapshot._id), candidateId: "synthetic-plan", plannedFor: "2099-10-11", timezone: "UTC" }], planningVersion: 1 } });
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
    expect((await User.collection.findOne({ _id: new Types.ObjectId(b.userId) }))!.outfitPlans).toHaveLength(1);
    expect(await WardrobeItem.countDocuments({ user: b.userId })).toBe(1);
    expect(await WardrobeImage.countDocuments({ user: b.userId })).toBe(1);
    expect(await OutfitInteraction.countDocuments({ user: b.userId })).toBe(1);
    const snapB = (await GenerationSnapshot.findById(b.snapshotId).lean()) as Any;
    expect(snapB).not.toBeNull();
    expect(snapB.redacted).toBe(false);
  });

  it("sweeps a known writer landing during Firebase cleanup before final owner removal", async () => {
    const a = await seedUser("uid-a", "a@example.com");
    mockedAdminAuth().deleteUser.mockImplementationOnce(async () => {
      await makeSnapshot(a.userId, "known-in-flight-write");
    });
    expect((await DELETE(makeRequest())).status).toBe(200);
    expect(await GenerationSnapshot.countDocuments({ user: a.userId })).toBe(0);
  });

  it("retains a blocked owner and reports pending erasure when Firebase cleanup fails, then retries", async () => {
    const a = await seedUser("uid-a", "a@example.com");
    mockedAdminAuth().deleteUser.mockRejectedValue(new Error("firebase down"));
    const response = await DELETE(makeRequest());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, dataDeleted: false, authDeleted: false, deletionPending: true, error: "auth_deletion_failed" });
    expect((await User.findById(a.userId).lean<Any>()).erasureStarted).toBe(true);
    expect(await WardrobeImage.countDocuments({ user: a.userId })).toBe(0);
    const { verifyFirebaseUser } = await import("@/lib/apiAuth");
    expect(await verifyFirebaseUser(makeRequest())).toMatchObject({ status: 409 });
    const { POST } = await import("@/app/api/auth/sync/route");
    expect((await POST({ ...makeRequest(), json: async () => ({}) })).status).toBe(409);
    expect(await User.countDocuments({ authId: "uid-a" })).toBe(1);
    mockedAdminAuth().deleteUser.mockResolvedValue(undefined);
    expect((await DELETE(makeRequest())).status).toBe(200);
    expect(await User.findById(a.userId)).toBeNull();
  });

  it("keeps failed data cleanup blocked and retryable without touching Firebase", async () => {
    const a = await seedUser("uid-a", "a@example.com");
    const fail = jest.spyOn(User.db.collection("wardrobeimages"), "deleteMany").mockRejectedValueOnce(new Error("sweep unavailable") as never);
    try {
      expect((await DELETE(makeRequest())).status).toBe(500);
      expect((await User.findById(a.userId).lean<Any>()).erasureStarted).toBe(true);
      expect((await GenerationSnapshot.findById(a.snapshotId).lean<Any>()).redacted).toBe(true);
      expect(mockedAdminAuth().deleteUser).not.toHaveBeenCalled();
      expect((await DELETE(makeRequest())).status).toBe(200);
      expect(await User.findById(a.userId)).toBeNull();
    } finally { fail.mockRestore(); }
  });

  it("recovers with the server-only continuation after Firebase succeeds, final Mongo removal fails and the client credential expires", async () => {
    const a = await seedUser("uid-a", "a@example.com");
    const { deleteUserWithData } = jest.requireMock("@/lib/db") as { deleteUserWithData: jest.Mock };
    deleteUserWithData.mockImplementationOnce(async () => false);
    expect((await DELETE(makeRequest())).status).toBe(500);
    expect(mockedAdminAuth().deleteUser).toHaveBeenCalled();
    expect((await User.findById(a.userId).lean<Any>()).erasureStarted).toBe(true);
    setToken(null);
    expect((await DELETE(makeRequest())).status).toBe(401);
    // The same helper invoked by the guarded operator CLI needs no expired client token.
    const { resumeUserErasure } = await import("@/lib/resumeUserErasure");
    const models = await jest.requireMock("@/lib/db").initDatabase();
    mockedAdminAuth().deleteUser.mockRejectedValue({ code: "auth/user-not-found" });
    const outcome = await resumeUserErasure(models, a.userId, uid => mockedAdminAuth().deleteUser(uid), () => deleteUserWithData(a.userId));
    expect(outcome).toEqual({ status: 200, body: { ok: true } });
    expect(await User.findById(a.userId)).toBeNull();
  });

  it("confirms completion for both synchronized DELETE requests when the second final delete finds no owner", async () => {
    const a = await seedUser("uid-a", "a@example.com");
    const b = await seedUser("uid-b", "b@example.com");
    const { deleteUserWithData } = jest.requireMock("@/lib/db") as { deleteUserWithData: jest.Mock };
    const originalFinish = deleteUserWithData.getMockImplementation()!;
    let arrive = 0;
    let releaseAuth!: () => void;
    const authGate = new Promise<void>(resolve => { releaseAuth = resolve; });
    mockedAdminAuth().deleteUser.mockImplementation(async () => {
      // Both actual continuations have loaded and acknowledged a pending owner.
      if (++arrive === 2) releaseAuth();
      await authGate;
    });
    let finishCalls = 0;
    let releaseSecondFinish!: () => void;
    const firstFinished = new Promise<void>(resolve => { releaseSecondFinish = resolve; });
    deleteUserWithData.mockImplementation(async (userId: string) => {
      const first = ++finishCalls === 1;
      if (!first) await firstFinished;
      try { return await originalFinish(userId); }
      finally { if (first) releaseSecondFinish(); }
    });
    try {
      const responses = await Promise.all([DELETE(makeRequest()), DELETE(makeRequest())]);
      expect(await Promise.all(responses.map(async response => ({ status: response.status, body: await response.json() }))))
        .toEqual([{ status: 200, body: { ok: true } }, { status: 200, body: { ok: true } }]);
      expect(finishCalls).toBe(2);
      expect(await User.findById(a.userId)).toBeNull();
      for (const Model of [WardrobeItem, WardrobeImage, OutfitInteraction, GenerationSnapshot]) {
        expect(await Model.countDocuments({ user: a.userId })).toBe(0);
        expect(await Model.countDocuments({ user: b.userId })).toBe(1);
      }
      expect(await User.findById(b.userId)).not.toBeNull();
      expect(mockedAdminAuth().deleteUser).toHaveBeenCalledTimes(2);
      expect(mockedAdminAuth().deleteUser).toHaveBeenNthCalledWith(1, "uid-a");
      expect(mockedAdminAuth().deleteUser).toHaveBeenNthCalledWith(2, "uid-a");
    } finally {
      deleteUserWithData.mockImplementation(originalFinish);
      mockedAdminAuth().deleteUser.mockResolvedValue(undefined);
    }
  });

  it("finishes its own cleanup if another continuation removes the observed pending owner before re-acknowledgment", async () => {
    const a = await seedUser("uid-a", "a@example.com");
    await User.updateOne({ _id: a.userId }, { $set: { erasureStarted: true } });
    const { resumeUserErasure } = await import("@/lib/resumeUserErasure");
    const { deleteUserWithData } = jest.requireMock("@/lib/db") as { deleteUserWithData: jest.Mock };
    const models = await jest.requireMock("@/lib/db").initDatabase();
    const resume = () => resumeUserErasure(models, a.userId, uid => mockedAdminAuth().deleteUser(uid), () => deleteUserWithData(a.userId));
    const realUpdate = User.updateOne.bind(User);
    const barrier = jest.spyOn(User, "updateOne").mockImplementationOnce(() => (async () => {
      // The first continuation has already read erasureStarted:true. Let the
      // second run its real cascades, Firebase boundary and final owner deletion.
      expect(await resume()).toEqual({ status: 200, body: { ok: true } });
      expect(await User.findById(a.userId)).toBeNull();
      return realUpdate({ _id: a.userId }, { $set: { erasureStarted: true } }, { writeConcern: { w: "majority" } });
    })() as never);
    const sweep = jest.spyOn(User.db.collection("wardrobeimages"), "deleteMany");
    try {
      expect(await resume()).toEqual({ status: 200, body: { ok: true } });
      // Absence is not used as a shortcut around this continuation's own cleanup.
      expect(mockedAdminAuth().deleteUser).toHaveBeenCalledTimes(2);
      expect(sweep).toHaveBeenCalledTimes(3); // two continuations plus the first owner's final hook
      expect(await WardrobeImage.countDocuments({ user: a.userId })).toBe(0);
    } finally { barrier.mockRestore(); sweep.mockRestore(); }
  });

  it("fails closed if a zero re-acknowledgment match is followed by an unexpectedly retained owner", async () => {
    const a = await seedUser("uid-a", "a@example.com");
    await User.updateOne({ _id: a.userId }, { $set: { erasureStarted: true } });
    const { resumeUserErasure } = await import("@/lib/resumeUserErasure");
    const models = await jest.requireMock("@/lib/db").initDatabase();
    const finish = jest.fn();
    const barrier = jest.spyOn(User, "updateOne").mockImplementationOnce(() => (async () => {
      // This state cannot occur through sanctioned monotonic erasure doors. A
      // negative barrier acknowledgment must not authorize an active retained row.
      await User.collection.updateOne({ _id: new Types.ObjectId(a.userId) }, { $set: { erasureStarted: false } });
      return { matchedCount: 0 };
    })() as never);
    try {
      expect(await resumeUserErasure(models, a.userId, uid => mockedAdminAuth().deleteUser(uid), finish))
        .toEqual({ status: 500, body: { ok: false, deletionPending: true, error: "Failed to finish account deletion" } });
      expect(await WardrobeImage.countDocuments({ user: a.userId })).toBe(1);
      expect(mockedAdminAuth().deleteUser).not.toHaveBeenCalled();
      expect(finish).not.toHaveBeenCalled();
    } finally { barrier.mockRestore(); }
  });

  it.each(["final delete acknowledgment", "completion read"])("does not claim completion after an uncertain %s", async failure => {
    const a = await seedUser("uid-a", "a@example.com");
    const { deleteUserWithData } = jest.requireMock("@/lib/db") as { deleteUserWithData: jest.Mock };
    const originalFinish = deleteUserWithData.getMockImplementation()!;
    const find = jest.spyOn(User, "findById");
    deleteUserWithData.mockImplementationOnce(async (userId: string) => {
      await originalFinish(userId); // The durable delete really lands; its receipt is uncertain.
      if (failure === "final delete acknowledgment") throw new Error("delete response lost");
      find.mockImplementationOnce(() => { throw new Error("completion read unavailable"); });
      return false;
    });
    try {
      const response = await DELETE(makeRequest());
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to delete account", deletionPending: true });
      expect(await User.findById(a.userId)).toBeNull();
      expect(await WardrobeImage.countDocuments({ user: a.userId })).toBe(0);
      expect(mockedAdminAuth().deleteUser).toHaveBeenCalledWith("uid-a");
    } finally { find.mockRestore(); deleteUserWithData.mockImplementation(originalFinish); }
  });

  it("does not treat an initially absent owner as completed erasure", async () => {
    const { resumeUserErasure } = await import("@/lib/resumeUserErasure");
    const models = await jest.requireMock("@/lib/db").initDatabase();
    const finish = jest.fn();
    expect(await resumeUserErasure(models, oid(), uid => mockedAdminAuth().deleteUser(uid), finish))
      .toEqual({ status: 404, body: { ok: false, error: "User not found" } });
    expect(mockedAdminAuth().deleteUser).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });

  it("the operator CLI refuses an active owner before Firebase initialization or deletion", async () => {
    const a = await seedUser("uid-a", "a@example.com");
    const child = spawn(process.execPath, ["scripts/resume-account-erasure.cjs", a.userId, "--resume-pending"], {
      cwd: path.resolve(__dirname, ".."), env: { ...process.env, MONGODB_URI: harness.server.getUri() },
    });
    let stderr = "", stdout = "";
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    const status = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`CLI timed out; stdout=${stdout}; stderr=${stderr}`)); }, 20_000);
      child.once("exit", code => { clearTimeout(timeout); resolve(code); });
    });
    expect(status).toBe(1);
    expect(stderr).toMatch(/Refusing recovery/);
    expect(await User.findById(a.userId)).not.toBeNull();
    expect(await WardrobeImage.countDocuments({ user: a.userId })).toBe(1);
  }, 30_000);

  it("the actual guarded operator CLI finishes a flagged owner without a client credential", async () => {
    const a = await seedUser("uid-a", "a@example.com");
    await User.updateOne({ _id: a.userId }, { $set: { erasureStarted: true } });
    const fixture = mkdtempSync(path.join(tmpdir(), "fitted-r18-cli-"));
    const preload = path.join(fixture, "firebase-boundary.cjs");
    // Only Firebase's external delete boundary is substituted. The CLI, production
    // continuation, models, majority sweeps and owner middleware execute unchanged.
    writeFileSync(preload, `const Module = require("node:module"); const load = Module._load;
      Module._load = function(id, ...args) {
        if (id.endsWith("/lib/firebaseAdmin.ts")) return { adminAuth: { deleteUser: async () => { throw { code: "auth/user-not-found" }; } } };
        return load.call(this, id, ...args);
      };`);
    const child = spawn(process.execPath, ["--require", preload, "scripts/resume-account-erasure.cjs", a.userId, "--resume-pending"], {
      cwd: path.resolve(__dirname, ".."), env: { ...process.env, MONGODB_URI: harness.server.getUri() },
    });
    let stderr = "", stdout = "";
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    try {
      const status = await new Promise<number | null>((resolve, reject) => {
        const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`CLI timed out; stdout=${stdout}; stderr=${stderr}`)); }, 20_000);
        child.once("exit", code => { clearTimeout(timeout); resolve(code); });
      });
      expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
      expect(JSON.parse(stdout)).toEqual({ ok: true });
      expect(await User.findById(a.userId)).toBeNull();
      expect(await WardrobeImage.countDocuments({ user: a.userId })).toBe(0);
    } finally { child.kill("SIGKILL"); rmSync(fixture, { recursive: true, force: true }); }
  }, 30_000);

  it("does not claim pending deletion when the initial barrier fails before acknowledgment", async () => {
    const a = await seedUser("uid-a", "a@example.com");
    const barrier = jest.spyOn(User, "updateOne").mockRejectedValueOnce(new Error("barrier unavailable") as never);
    try {
      const response = await DELETE(makeRequest());
      expect(response.status).toBe(500);
      expect((await response.json()).deletionPending).toBeUndefined();
      expect((await User.findById(a.userId).lean<Any>()).erasureStarted).toBe(false);
      expect(await WardrobeImage.countDocuments({ user: a.userId })).toBe(1);
      expect(mockedAdminAuth().deleteUser).not.toHaveBeenCalled();
    } finally { barrier.mockRestore(); }
  });

  it("the server-only continuation refuses an active account without data or Firebase changes", async () => {
    const a = await seedUser("uid-a", "a@example.com");
    const { resumeUserErasure } = await import("@/lib/resumeUserErasure");
    const models = await jest.requireMock("@/lib/db").initDatabase();
    const finish = jest.fn();
    expect((await resumeUserErasure(models, a.userId, uid => mockedAdminAuth().deleteUser(uid), finish)).status).toBe(409);
    expect(await WardrobeImage.countDocuments({ user: a.userId })).toBe(1);
    expect(mockedAdminAuth().deleteUser).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });

  it("sync's concurrent-create loser rejects a flagged owner when it refinds the winner", async () => {
    const a = await seedUser("uid-a", "a@example.com");
    await User.updateOne({ _id: a.userId }, { $set: { erasureStarted: true } });
    const find = jest.spyOn(User, "findOne").mockResolvedValueOnce(null as never);
    const create = jest.spyOn(User, "create").mockRejectedValueOnce({ code: 11000 } as never);
    try {
      const { POST } = await import("@/app/api/auth/sync/route");
      const response = await POST({ ...makeRequest(), json: async () => ({}) });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "Account deletion is in progress", code: "account_deletion_pending" });
    } finally { find.mockRestore(); create.mockRestore(); }
  });

  it("session image authentication rejects the flagged owner", async () => {
    const a = await seedUser("uid-a", "a@example.com");
    await User.updateOne({ _id: a.userId }, { $set: { erasureStarted: true } });
    jest.requireMock("@/lib/firebaseAdmin").adminAuth.verifySessionCookie.mockResolvedValue({ uid: "uid-a" });
    const { verifySessionCookieUser } = await import("@/lib/session");
    expect(await verifySessionCookieUser({ cookies: { get: () => ({ value: "cookie" }) } } as Any)).toMatchObject({ status: 409 });
  });
});
