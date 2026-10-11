import { spawn } from "node:child_process";
import path from "node:path";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import User from "@/models/User";
import WardrobeImage from "@/models/WardrobeImage";
import WardrobeItem from "@/models/WardrobeItem";
import { uploadWardrobeImage } from "@/lib/imageStorage";
import { beginUserErasure } from "@/lib/userErasure";

jest.mock("@/lib/db", () => ({ initDatabase: jest.fn() }));
// These spies control scheduling/transport only. Owner writes, transactions, images, and
// erasure execute against real Mongo. A standalone rejection is covered separately.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let harness: MongoHarness;
let owner: string;
let item: string;
const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const input = () => ({ userId: owner, wardrobeItemId: item, bytes, contentType: "image/png", attachmentLease: "crash-pin" });
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
};
beforeAll(async () => {
  harness = await startMemoryMongo([User, WardrobeItem, WardrobeImage], { replicaSet: true, testCommands: true });
}, 120_000);
afterAll(async () => { await harness.stop(); });
beforeEach(async () => {
  jest.requireMock("@/lib/db").initDatabase.mockResolvedValue({ User, WardrobeImage, WardrobeItem });
  const user = await User.create({ authId: "owner", email: "owner@example.test" });
  owner = String(user._id);
  item = String((await WardrobeItem.create({ user: owner, name: "Tee", category: "top", clothingType: "top", warmth: 2 }))._id);
});
afterEach(async () => { jest.restoreAllMocks(); await harness.clear(); });

it("rejects a delayed admission after the erasure barrier and sweep, without bytes or cleanup", async () => {
  const reached = gate(), resume = gate();
  const update = User.updateOne.bind(User);
  const spy = jest.spyOn(User, "updateOne").mockImplementation(((filter: Any, change: Any, options: Any) => {
    if (!change.$inc?.imageWriteVersion) return update(filter, change, options);
    return (async () => { reached.release(); await resume.promise; return update(filter, change, options); })();
  }) as Any);
  const uploading = uploadWardrobeImage(input());
  const result = uploading.then(() => "uploaded", error => String(error));
  try {
    await reached.promise;
    expect((await User.deleteOne({ _id: owner })).deletedCount).toBe(1);
    resume.release();
    expect(await result).toMatch(/no longer accepts/);
    expect(await WardrobeImage.countDocuments({ user: owner })).toBe(0);
  } finally { resume.release(); spy.mockRestore(); }
});

it("waits for a transaction admitted before the barrier, then sweeps committed bytes", async () => {
  const inserted = gate(), resume = gate();
  const create = WardrobeImage.create.bind(WardrobeImage);
  const spy = jest.spyOn(WardrobeImage, "create").mockImplementation((async (...args: Any[]) => {
    const docs = await create(...args as [Any, Any]);
    inserted.release(); await resume.promise;
    return docs;
  }) as Any);
  const uploading = uploadWardrobeImage(input());
  try {
    await inserted.promise;
    // The transaction owns a conflicting write on User. No barrier may complete first.
    let deletionDone = false;
    const deleting = User.deleteOne({ _id: owner }).then(result => { deletionDone = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(deletionDone).toBe(false);
    expect((await User.findById(owner).lean<Any>()).erasureStarted).toBe(false);
    resume.release(); await uploading; await deleting;
    expect(await WardrobeImage.countDocuments({ user: owner })).toBe(0);
  } finally { resume.release(); spy.mockRestore(); }
});

it("sweeps a real committed transaction after its completion acknowledgment is lost", async () => {
  const start = User.db.startSession.bind(User.db);
  jest.spyOn(User.db, "startSession").mockImplementation((async () => {
    const session = await start();
    const transaction = session.withTransaction.bind(session);
    session.withTransaction = (async (...args: Any[]) => {
      await transaction(...args as [Any, Any]);
      throw new Error("lost commit acknowledgment");
    }) as Any;
    return session;
  }) as Any);
  await expect(uploadWardrobeImage(input())).rejects.toThrow("lost commit acknowledgment");
  expect(await WardrobeImage.countDocuments({ user: owner })).toBe(1);
  // No image route/finally reconciliation ran. Only the durable erasure path is needed.
  await User.deleteOne({ _id: owner });
  expect(await WardrobeImage.countDocuments({ user: owner })).toBe(0);
});

it("retries a real server-injected uncertain commit acknowledgment and stores one image", async () => {
  const admin = User.db.db!.admin();
  await admin.command({
    configureFailPoint: "failCommand", mode: { times: 1 },
    data: { failCommands: ["commitTransaction"], writeConcernError: { code: 64, errmsg: "uncertain commit acknowledgment" } },
  });
  const session = await User.db.startSession();
  const commit = jest.spyOn(session, "commitTransaction");
  jest.spyOn(User.db, "startSession").mockResolvedValueOnce(session);
  try {
    await uploadWardrobeImage(input());
    expect(commit.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(await WardrobeImage.countDocuments({ user: owner })).toBe(1);
    expect((await User.findById(owner).select("+imageWriteVersion")).imageWriteVersion).toBe(1);
    await User.deleteOne({ _id: owner });
    expect(await WardrobeImage.countDocuments({ user: owner })).toBe(0);
  } finally { await admin.command({ configureFailPoint: "failCommand", mode: "off" }); }
});

it("leaves a durable barrier on cascade failure and permits a safe retry", async () => {
  await uploadWardrobeImage(input());
  const images = User.db.collection("wardrobeimages");
  jest.spyOn(images, "deleteMany").mockRejectedValueOnce(new Error("sweep unavailable") as never);
  await expect(User.deleteOne({ _id: owner })).rejects.toThrow("sweep unavailable");
  expect((await User.findById(owner).lean<Any>()).erasureStarted).toBe(true);
  await expect(uploadWardrobeImage(input())).rejects.toThrow("no longer accepts");
  expect((await User.deleteOne({ _id: owner })).deletedCount).toBe(1);
  expect(await WardrobeImage.countDocuments({ user: owner })).toBe(0);
});

it("halts before every cascade arm when the majority barrier acknowledgment fails", async () => {
  await uploadWardrobeImage(input());
  jest.spyOn(User, "updateOne").mockRejectedValueOnce(new Error("unknown barrier acknowledgment") as never);
  await expect(User.deleteOne({ _id: owner })).rejects.toThrow("unknown barrier acknowledgment");
  expect(await WardrobeImage.countDocuments({ user: owner })).toBe(1);
  expect(await WardrobeItem.countDocuments({ user: owner })).toBe(1);
});

it.each(["deleteOne", "findOneAndDelete"] as const)("%s binds an authId filter to the fenced owner and leaves another owner intact", async operation => {
  await uploadWardrobeImage(input());
  const other = await User.create({ authId: "other", email: "other@example.test" });
  if (operation === "deleteOne") await User.deleteOne({ authId: "owner" });
  else await User.findOneAndDelete({ authId: "owner" });
  expect(await WardrobeImage.countDocuments({ user: owner })).toBe(0);
  expect(await User.findById(owner)).toBeNull();
  expect(await User.findById(other._id)).not.toBeNull();
});

it("preserves a mutable direct-delete predicate as a fail-closed pending owner", async () => {
  await uploadWardrobeImage(input());
  expect((await User.deleteOne({ _id: owner, erasureStarted: false })).deletedCount).toBe(0);
  expect((await User.findById(owner).lean<Any>()).erasureStarted).toBe(true);
  expect(await WardrobeImage.countDocuments({ user: owner })).toBe(0);
  await expect(uploadWardrobeImage(input())).rejects.toThrow("no longer accepts");
  expect((await User.deleteOne({ _id: owner })).deletedCount).toBe(1);
});

it.each(["sort", "collation", "hint"])("rejects unsupported %s query selection before erasure", async option => {
  await uploadWardrobeImage(input());
  await expect(User.findOneAndDelete({ authId: "owner" }).setOptions({ [option]: {} })).rejects.toThrow("Unsupported account erasure query options");
  expect((await User.findById(owner).lean<Any>()).erasureStarted).toBe(false);
  expect(await WardrobeImage.countDocuments({ user: owner })).toBe(1);
});

it("rejects caller-transaction deletion instead of allowing a rollback of its barrier", async () => {
  const session = await User.db.startSession();
  try {
    await expect(session.withTransaction(() => User.deleteOne({ _id: owner }).session(session))).rejects.toThrow("cannot run inside a transaction");
    expect(await User.findById(owner)).not.toBeNull();
  } finally { await session.endSession(); }
});

it("erases a production-helper upload after its worker process dies before attachment cleanup", async () => {
  // Load the production TypeScript helper in an independent process, not a facsimile writer.
  const script = `
    const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
    const resolve = Module._resolveFilename;
    Module._resolveFilename = function(id, ...args) { return resolve.call(this, id.startsWith("@/") ? path.join(process.cwd(), id.slice(2)) : id, ...args); };
    require.extensions[".ts"] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, file);
    require("./lib/imageStorage.ts").uploadWardrobeImage({ userId: process.env.TEST_OWNER, wardrobeItemId: process.env.TEST_ITEM, bytes: Buffer.from("89504e470d0a1a0a", "hex"), contentType: "image/png", attachmentLease: "dead-worker" }).then(() => { process.stdout.write("committed"); setInterval(() => {}, 1000); }).catch(error => { console.error(error); process.exit(1); });
  `;
  const child = spawn(process.execPath, ["-e", script], { cwd: path.resolve(__dirname, ".."), env: { ...process.env, MONGODB_URI: harness.server.getUri(), TEST_OWNER: owner, TEST_ITEM: item } });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`worker timed out: ${stderr}`)), 20_000);
      child.stdout.on("data", chunk => { if (String(chunk).includes("committed")) { clearTimeout(timeout); resolve(); } });
      child.once("exit", code => { clearTimeout(timeout); reject(new Error(`worker exited ${code}: ${stderr}`)); });
    });
    expect(await WardrobeImage.countDocuments({ user: owner, attachmentLease: "dead-worker" })).toBe(1);
    child.kill("SIGKILL");
    await new Promise(resolve => child.once("exit", resolve));
    await User.deleteOne({ _id: owner });
    expect(await WardrobeImage.countDocuments({ user: owner })).toBe(0);
  } finally { child.kill("SIGKILL"); }
}, 30_000);

it("repeated barrier writes keep admission denied", async () => {
  expect(await beginUserErasure(User, owner)).toBe(true);
  expect(await beginUserErasure(User, owner)).toBe(true);
  await expect(uploadWardrobeImage(input())).rejects.toThrow("no longer accepts");
  expect(await WardrobeImage.countDocuments({ user: owner })).toBe(0);
});
