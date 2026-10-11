import { spawn } from "node:child_process";
import path from "node:path";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import User from "@/models/User";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import { admitFirebaseIdentity, verifyIdentityToken } from "@/lib/identityAdmission";

jest.mock("@/lib/db", () => ({ initDatabase: jest.fn(), deleteUserWithData: jest.fn(async (id: string) => {
  const model = jest.requireActual("@/models/User").default;
  return (await model.deleteOne({ _id: id })).deletedCount > 0;
}) }));
jest.mock("@/lib/firebaseAdmin", () => ({ adminAuth: { verifyIdToken: jest.fn(), deleteUser: jest.fn() } }));
// Real Mongo owns uniqueness, transaction retries, commit faults, and deletion. Only
// Firebase and scheduling are controlled, explicitly using production token semantics.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let harness: MongoHarness;
let alive: boolean;
const identity = { uid: "old-uid", email: "same@example.test" };
const gate = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };
const admin = () => jest.requireMock("@/lib/firebaseAdmin").adminAuth;
const req = (token = "old-token"): Any => ({ headers: { get: (name: string) => name === "authorization" ? `Bearer ${token}` : null }, json: async () => ({}) });
const sync = async () => (await import("@/app/api/auth/sync/route")).POST(req());
const admit = (verify = async () => identity, limits?: { transactionMs?: number; firebaseMs?: number }) => admitFirebaseIdentity(User, "old-token", identity, verify, limits);
beforeAll(async () => {
  harness = await startMemoryMongo([User, GenerationSnapshot], { replicaSet: true, testCommands: true });
}, 120_000);
afterAll(async () => { await harness.stop(); });
beforeEach(() => {
  alive = true;
  jest.requireMock("@/lib/db").initDatabase.mockResolvedValue({ User, GenerationSnapshot });
  admin().verifyIdToken.mockImplementation(async (_token: string, checkRevoked: boolean) => {
    // A production signature-only check accepts the old token after Firebase deletion.
    if (checkRevoked && !alive) throw { code: "auth/user-not-found" };
    return identity;
  });
  admin().deleteUser.mockImplementation(async () => { alive = false; });
});
afterEach(async () => {
  await User.db.db!.admin().command({ configureFailPoint: "failCommand", mode: "off" });
  jest.restoreAllMocks(); jest.clearAllMocks(); await harness.clear();
});

it("reproduces the delayed create schedule and rejects the erased identity after reservation", async () => {
  const reached = gate(), resume = gate();
  const create = User.create.bind(User);
  const pause = jest.spyOn(User, "create").mockImplementationOnce((async (...args: Any[]) => {
    reached.release(); await resume.promise; return create(...args as [Any, Any]);
  }) as Any);
  const old = sync();
  try {
    await reached.promise;
    const winner = await sync(); expect(winner.status).toBe(200);
    const deleted = await (await import("@/app/api/account/route")).DELETE(req());
    expect(deleted.status).toBe(200); expect(alive).toBe(false);
    resume.release(); expect((await old).status).toBe(401);
    expect(await User.countDocuments({ authId: identity.uid })).toBe(0);
    expect(await User.countDocuments({ email: identity.email })).toBe(0);
  } finally { resume.release(); pause.mockRestore(); }
});

it("holds the unique reservation through a paused fresh verdict; concurrent sync cannot admit another owner", async () => {
  const verified = gate(), resume = gate();
  let fresh = 0;
  admin().verifyIdToken.mockImplementation(async (_token: string, revoked: boolean) => {
    if (revoked && ++fresh === 1) { verified.release(); await resume.promise; }
    return identity;
  });
  const first = sync();
  try {
    await verified.promise;
    expect(await User.countDocuments({ authId: identity.uid })).toBe(0); // uncommitted
    let secondDone = false;
    const second = sync().then(result => { secondDone = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 100)); expect(secondDone).toBe(false);
    resume.release();
    const [a, b] = await Promise.all([first, second]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await a.json()).userId).toBe((await b.json()).userId);
    expect(fresh).toBe(1); // losing reservation never asks for a premature verdict
    expect(await User.countDocuments({ authId: identity.uid })).toBe(1);
  } finally { resume.release(); }
});

it("aborts a real duplicate transaction before refinding a pending owner", async () => {
  const winner = await User.create({ authProvider: "firebase", authId: identity.uid, email: identity.email, erasureStarted: true });
  const session = await User.db.startSession();
  const abort = jest.spyOn(session, "abortTransaction");
  jest.spyOn(User.db, "startSession").mockResolvedValueOnce(session);
  const verify = jest.fn(async () => identity);
  const find = User.findOne.bind(User);
  const refind = jest.spyOn(User, "findOne").mockImplementation(((...args: Any[]) => {
    expect(abort).toHaveBeenCalled(); expect(session.inTransaction()).toBe(false);
    return find(...args as [Any]);
  }) as Any);
  try {
    await expect(admit(verify)).rejects.toMatchObject({ status: 409, code: "account_deletion_pending" });
    expect(verify).not.toHaveBeenCalled();
    expect(String((await User.findById(winner._id))._id)).toBe(String(winner._id));
  } finally { refind.mockRestore(); }
});

it("never adopts the owner of an unrelated email collision", async () => {
  await User.create({ authProvider: "firebase", authId: "different-uid", email: identity.email });
  await expect(admit()).rejects.toMatchObject({ status: 503 });
  expect(await User.countDocuments({ authId: identity.uid })).toBe(0);
});

it("repeats the fresh verdict on a real transient transaction callback retry", async () => {
  await User.db.db!.admin().command({ configureFailPoint: "failCommand", mode: { times: 1 }, data: {
    failCommands: ["commitTransaction"], errorCode: 251, errorLabels: ["TransientTransactionError"],
  } });
  const verify = jest.fn(async () => identity);
  await admit(verify);
  expect(verify).toHaveBeenCalledTimes(2);
  expect(await User.countDocuments({ authId: identity.uid })).toBe(1);
});

it("a retried callback cannot reuse a live verdict after Firebase starts rejecting the identity", async () => {
  await User.db.db!.admin().command({ configureFailPoint: "failCommand", mode: { times: 1 }, data: {
    failCommands: ["commitTransaction"], errorCode: 251, errorLabels: ["TransientTransactionError"],
  } });
  const verify = jest.fn().mockResolvedValueOnce(identity).mockRejectedValueOnce({ code: "auth/user-not-found" });
  await expect(admit(verify)).rejects.toMatchObject({ status: 401 });
  expect(verify).toHaveBeenCalledTimes(2);
  expect(await User.countDocuments({ authId: identity.uid })).toBe(0);
});

it("retries a real uncertain commit response without repeating the verdict or creating a second owner", async () => {
  await User.db.db!.admin().command({ configureFailPoint: "failCommand", mode: { times: 1 }, data: {
    failCommands: ["commitTransaction"], writeConcernError: { code: 64, errmsg: "uncertain commit" },
  } });
  const session = await User.db.startSession();
  const commit = jest.spyOn(session, "commitTransaction");
  jest.spyOn(User.db, "startSession").mockResolvedValueOnce(session);
  const verify = jest.fn(async () => identity);
  await admit(verify);
  expect(commit.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(verify).toHaveBeenCalledTimes(1);
  expect(await User.countDocuments({ authId: identity.uid })).toBe(1);
});

it("a lost committed response remains one safe owner and retry resolves it, then erasure removes it", async () => {
  const session = await User.db.startSession();
  const transaction = session.withTransaction.bind(session);
  session.withTransaction = (async (...args: Any[]) => { await transaction(...args as [Any, Any]); throw new Error("lost committed response"); }) as Any;
  jest.spyOn(User.db, "startSession").mockResolvedValueOnce(session);
  await expect(admit()).rejects.toMatchObject({ status: 503 });
  expect(await User.countDocuments({ authId: identity.uid })).toBe(1);
  expect((await sync()).status).toBe(200);
  expect((await (await import("@/app/api/account/route")).DELETE(req())).status).toBe(200);
  expect((await sync()).status).toBe(401);
  expect(await User.countDocuments({ authId: identity.uid })).toBe(0);
});

it("fresh-check timeout aborts before return, and a late Firebase reply cannot insert or commit", async () => {
  let respond!: (value: typeof identity) => void;
  const verdict = new Promise<typeof identity>(resolve => { respond = resolve; });
  await expect(admit(async () => verdict, { firebaseMs: 40, transactionMs: 200 })).rejects.toMatchObject({ status: 503 });
  expect(await User.countDocuments({ authId: identity.uid })).toBe(0);
  respond(identity); await new Promise(resolve => setTimeout(resolve, 80));
  expect(await User.countDocuments({ authId: identity.uid })).toBe(0);
});

it("overall callback deadline expires safely even with a larger Firebase allowance", async () => {
  await expect(admit(async () => new Promise(() => {}), { firebaseMs: 500, transactionMs: 40 })).rejects.toMatchObject({ status: 503 });
  expect(await User.countDocuments({ authId: identity.uid })).toBe(0);
});

it.each(["auth/user-not-found", "auth/id-token-revoked", "auth/user-disabled", "auth/id-token-expired", "auth/invalid-id-token"])("fresh Firebase credential rejection %s aborts admission with 401", async code => {
  await expect(admit(async () => { throw { code }; })).rejects.toMatchObject({ status: 401 });
  expect(await User.countDocuments({ authId: identity.uid })).toBe(0);
});
it.each(["auth/internal-error", "auth/invalid-credential", "app/network-error"])("fresh Firebase service fault %s is retryable 503", async code => {
  await expect(admit(async () => { throw { code }; })).rejects.toMatchObject({ status: 503 });
  expect(await User.countDocuments({ authId: identity.uid })).toBe(0);
});
it.each(["uid", "email"] as const)("a fresh verdict with a changed %s cannot mint a different identity", async field => {
  await expect(admit(async () => ({ ...identity, [field]: "other" }))).rejects.toMatchObject({ status: 401 });
  expect(await User.countDocuments({})).toBe(0);
});

it("initial verification has the same truthful service classification and finite timeout", async () => {
  await expect(verifyIdentityToken(async () => { throw { code: "auth/internal-error" }; }, "token", false, 20)).rejects.toMatchObject({ status: 503 });
  await expect(verifyIdentityToken(async () => { throw { code: "auth/id-token-expired" }; }, "token", false, 20)).rejects.toMatchObject({ status: 401 });
  await expect(verifyIdentityToken(async () => new Promise(() => {}), "token", false, 20)).rejects.toMatchObject({ status: 503 });
  expect(await User.countDocuments({})).toBe(0);
});

it("permits deliberate re-signup with a new UID and the released email after erasure", async () => {
  expect((await sync()).status).toBe(200);
  expect((await (await import("@/app/api/account/route")).DELETE(req())).status).toBe(200);
  const newIdentity = { uid: "new-uid", email: identity.email };
  admin().verifyIdToken.mockResolvedValue(newIdentity);
  const responses = await Promise.all([sync(), sync()]);
  expect(responses.map(r => r.status)).toEqual([200, 200]);
  expect((await responses[0].json()).userId).toBe((await responses[1].json()).userId);
  expect(await User.countDocuments({ authId: "old-uid" })).toBe(0);
  expect(await User.countDocuments({ authId: "new-uid" })).toBe(1);
});

it("erasure still covers an admitted identity after the production admission worker dies", async () => {
  const script = `
    const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
    const resolve = Module._resolveFilename;
    Module._resolveFilename = function(id, ...args) { return resolve.call(this, id.startsWith("@/") ? path.join(process.cwd(), id.slice(2)) : id, ...args); };
    require.extensions[".ts"] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, file);
    require("./lib/db.ts").initDatabase().then(({ User }) => require("./lib/identityAdmission.ts").admitFirebaseIdentity(User, "token", { uid: "old-uid", email: "same@example.test" }, async () => ({ uid: "old-uid", email: "same@example.test" }))).then(() => { process.stdout.write("committed"); setInterval(() => {}, 1000); }).catch(error => { console.error(error); process.exit(1); });
  `;
  const child = spawn(process.execPath, ["-e", script], { cwd: path.resolve(__dirname, ".."), env: { ...process.env, MONGODB_URI: harness.server.getUri() } });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`worker timed out: ${stderr}`)), 20_000);
      child.stdout.on("data", chunk => { if (String(chunk).includes("committed")) { clearTimeout(timeout); resolve(); } });
      child.once("exit", code => { clearTimeout(timeout); reject(new Error(`worker exited ${code}: ${stderr}`)); });
    });
    child.kill("SIGKILL"); await new Promise(resolve => child.once("exit", resolve));
    expect(await User.countDocuments({ authId: identity.uid })).toBe(1);
    expect((await (await import("@/app/api/account/route")).DELETE(req())).status).toBe(200);
    expect((await sync()).status).toBe(401);
    expect(await User.countDocuments({ authId: identity.uid })).toBe(0);
  } finally { child.kill("SIGKILL"); }
}, 30_000);
