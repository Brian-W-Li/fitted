import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { Types } from "mongoose";
import User from "@/models/User";
import WardrobeItem from "@/models/WardrobeItem";
import WardrobeImage from "@/models/WardrobeImage";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import OutfitInteraction from "@/models/OutfitInteraction";
import OutfitExperience from "@/models/OutfitExperience";
import { ownerWriteFence } from "@/lib/ownerWriteFence";
import { writeSnapshotWithIdempotency } from "@/lib/mlSnapshotWrite";
import { ExperienceStore } from "@/lib/outfitExperience/store";
import { postInteraction, __resetInteractionRateLimit } from "@/lib/interactions";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import { experienceFixture, gate } from "./helpers/experienceFixture";
jest.mock("@/lib/db", () => ({ initDatabase: jest.fn() }));
jest.mock("@/lib/firebaseAdmin", () => ({ adminAuth: { verifyIdToken: jest.fn() } }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let harness: MongoHarness;
const models = { User, WardrobeItem, WardrobeImage, GenerationSnapshot, OutfitInteraction, OutfitExperience };
beforeAll(async () => { harness = await startMemoryMongo(Object.values(models), { replicaSet: true, testCommands: true, transactionLifetimeSeconds: 2 }); }, 120_000);
afterAll(async () => { await harness.stop(); });
beforeEach(() => { jest.requireMock("@/lib/db").initDatabase.mockResolvedValue(models); });
afterEach(async () => { jest.restoreAllMocks(); __resetInteractionRateLimit(); await User.db.db!.admin().command({ configureFailPoint: "failCommand", mode: "off" }); await harness.clear(); });
const snapshotDoc = (owner: string) => ({
  _id: new Types.ObjectId(), user: owner, sessionId: owner, candidateCacheKey: "ck", generationIndex: 0,
  requestId: randomUUID(), intent: "daily", occasion: "class", weather: "mild", wardrobeVersion: 0,
  interactionCountAtRequest: 0, fittedCoreVersion: "0.4.0",
  generator: { provider: "openai", model: "gpt-5.4-mini", temperature: 0.5, promptVersion: "m5-c1.v1", maxCompletionTokens: 2200, apiSurface: "chat_completions", responseFormat: "json_schema_strict", reasoningEffort: "none", storeMode: "none", promptCacheRetention: "in_memory", timeoutSeconds: 30, maxRetries: 0 },
  rankerConfigVersion: "rk", scorer: { kind: "cold_start", available: false }, itemSnapshots: [], generationAttempts: [], candidates: [], shownCandidateIds: [], shownFullSignatures: [], nSurfaced: 0, spreadCollapsed: false,
});
const doors = ["garment", "snapshot", "reaction", "wear", "marker"] as const;
async function prepare(door: typeof doors[number]): Promise<{ owner: string; collection: string; method: "insertOne" | "replaceOne"; run: () => Promise<unknown> }> {
  const f = await experienceFixture();
  const request: Any = { headers: { get: () => "Bearer token" }, json: async () => ({ name: "Fenced tee", category: "top" }) };
  jest.requireMock("@/lib/firebaseAdmin").adminAuth.verifyIdToken.mockResolvedValue({ uid: (await User.findById(f.owner)).authId });
  if (door === "garment") return { owner: f.owner, collection: "wardrobeitems", method: "insertOne", run: async () => (await (await import("@/app/api/wardrobe/route")).POST(request)).status };
  if (door === "snapshot") {
    const doc = snapshotDoc(f.owner);
    return { owner: f.owner, collection: "generationsnapshots", method: "insertOne", run: () => writeSnapshotWithIdempotency(GenerationSnapshot, doc, f.owner, doc.requestId, User) };
  }
  if (door === "reaction") {
    await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId }, { $set: { "candidates.0.baseKey": "base", "candidates.0.fullSignature": "full" } });
    request.json = async () => ({ snapshotId: String(f.snapshotId), candidateId: "c0", action: "accepted" });
    return { owner: f.owner, collection: "outfitinteractions", method: "insertOne", run: async () => (await postInteraction(request, { verifyUser: async () => ({ userId: f.owner }), models })).status };
  }
  const store = new ExperienceStore({ now: () => new Date("2026-10-10T12:00:00Z") });
  return { owner: f.owner, collection: "outfitexperiences", method: door === "wear" ? "insertOne" : "replaceOne", run: () => door === "wear" ? store.create(f.owner, f.input) : store.erase(f.owner, f.input.experienceId) };
}
it.each(doors)("%s rejects deletion-first at the actual owner admission", async door => {
  const seam = await prepare(door);
  const update = User.updateOne.bind(User);
  let deleted = false;
  jest.spyOn(User, "updateOne").mockImplementation((async (...args: Any[]) => {
    if (!deleted && args[1].$inc?.imageWriteVersion) { deleted = true; await User.deleteOne({ _id: seam.owner }); }
    return update(...args as [Any, Any, Any]);
  }) as Any);
  const result = await Promise.resolve().then(seam.run).catch(error => error);
  expect(deleted).toBe(true);
  if (door === "garment" || door === "reaction") expect(result).toBe(401);
  else expect(result).toBeInstanceOf(Error);
  expect(await User.findById(seam.owner)).toBeNull();
  expect(await User.db.collection(seam.collection).countDocuments({ user: new Types.ObjectId(seam.owner) })).toBe(0);
});
it.each(doors)("%s rolls back its REAL row operation when forced to abort afterwards", async door => {
  const seam = await prepare(door);
  const collection = User.db.db!.collection(seam.collection);
  const before = await collection.countDocuments({ user: new Types.ObjectId(seam.owner) });
  const prototype = Object.getPrototypeOf(collection);
  const native = prototype[seam.method];
  let executed = false;
  jest.spyOn(prototype, seam.method as "insertOne").mockImplementation((async function(this: Any, ...args: Any[]) {
    const result = await native.apply(this, args);
    if (this.collectionName === seam.collection) { executed = true; throw new Error("forced abort after actual row"); }
    return result;
  }) as Any);
  const result = await Promise.resolve().then(seam.run).catch(error => error);
  expect(executed).toBe(true);
  if (door === "garment" || door === "reaction") expect(result).toBe(500);
  else expect(result).toBeInstanceOf(Error);
  expect(await collection.countDocuments({ user: new Types.ObjectId(seam.owner) })).toBe(before);
  expect((await User.findById(seam.owner).select("+imageWriteVersion")).imageWriteVersion).toBeUndefined();
  if (door === "wear" || door === "marker") expect((await User.findById(seam.owner).select("+experienceAdmissions")).experienceAdmissions).toHaveLength(1);
});
it("erase retries a real duplicate collision only after abort in a fresh fenced session", async () => {
  const f = await experienceFixture();
  const store = new ExperienceStore({ now: () => new Date("2026-10-10T12:00:00Z") });
  await store.create(f.owner, f.input);
  const original = await OutfitExperience.collection.findOne({ experienceId: f.input.experienceId });
  const version = (await User.findById(f.owner).select("+imageWriteVersion")).imageWriteVersion;
  const prototype = Object.getPrototypeOf(User.db.db!.collection("outfitexperiences"));
  const replace = prototype.replaceOne;
  let injected = false;
  const duplicateId = new Types.ObjectId();
  // Trigger a genuine Mongo E11000 in the first row-write slot. This models the
  // duplicate branch without pretending its now-serialized create race is common.
  jest.spyOn(prototype, "replaceOne").mockImplementation((async function(this: Any, ...args: Any[]) {
    if (!injected && this.collectionName === "outfitexperiences") {
      injected = true;
      await this.insertOne({ ...original, _id: duplicateId }, { session: args[2].session });
    }
    return replace.apply(this, args);
  }) as Any);
  const sessions: Any[] = [];
  const start = User.db.startSession.bind(User.db);
  jest.spyOn(User.db, "startSession").mockImplementation((async () => { const session = await start(); sessions.push(session); return session; }) as Any);
  await store.erase(f.owner, f.input.experienceId);
  expect(injected).toBe(true); expect(sessions).toHaveLength(2);
  expect(sessions[0]).not.toBe(sessions[1]);
  expect(sessions.every(session => !session.inTransaction())).toBe(true);
  const marker = await OutfitExperience.collection.findOne({ experienceId: f.input.experienceId });
  expect(marker!.lifecycle).toBe("erased"); expect(String(marker!._id)).toBe(String(original!._id));
  expect(Object.keys(marker!).sort()).toEqual(["_id", "experienceId", "lifecycle", "user"]);
  expect((await User.findById(f.owner).select("+imageWriteVersion")).imageWriteVersion).toBe(version + 1);
});

it("a held owner transaction commits before deletion can establish its barrier, then the cascade sweeps it", async () => {
  const f = await experienceFixture(), parked = gate();
  const payload = { _id: new Types.ObjectId(), user: new Types.ObjectId(f.owner), name: "held", category: "top", clothingType: "top", warmth: 2 };
  const writing = ownerWriteFence(User, f.owner, async session => { await WardrobeItem.collection.insertOne(payload, { session }); await parked.block(); });
  await parked.entered;
  let completed = false;
  const deleting = User.deleteOne({ _id: f.owner }).then(result => { completed = true; return result; });
  try {
    await new Promise(resolve => setTimeout(resolve, 100)); expect(completed).toBe(false);
    expect((await User.findById(f.owner)).erasureStarted).toBe(false);
    parked.release(); await writing; await deleting;
    expect(await WardrobeItem.countDocuments({ user: f.owner })).toBe(0);
  } finally { parked.release(); }
});
it("a transient callback retry preserves payload identity/timestamps and only commits one row", async () => {
  const f = await experienceFixture();
  const timestamp = new Date();
  const payload = { _id: new Types.ObjectId(), user: f.owner, name: "retry", category: "top", clothingType: "top", warmth: 2, createdAt: timestamp, updatedAt: timestamp };
  await User.db.db!.admin().command({ configureFailPoint: "failCommand", mode: { times: 1 }, data: { failCommands: ["commitTransaction"], errorCode: 251, errorLabels: ["TransientTransactionError"] } });
  let callbacks = 0;
  await ownerWriteFence(User, f.owner, async session => { callbacks++; return WardrobeItem.create([payload], { session, timestamps: false }); });
  expect(callbacks).toBe(2);
  expect(await WardrobeItem.countDocuments({ _id: payload._id })).toBe(1);
  expect((await WardrobeItem.findById(payload._id)).createdAt).toEqual(timestamp);
  expect((await User.findById(f.owner).select("+imageWriteVersion")).imageWriteVersion).toBe(1);
});
it("uncertain commit retries only commit and creates one row", async () => {
  const f = await experienceFixture();
  const payload = { _id: new Types.ObjectId(), user: new Types.ObjectId(f.owner), name: "uncertain", category: "top", clothingType: "top", warmth: 2 };
  await User.db.db!.admin().command({ configureFailPoint: "failCommand", mode: { times: 1 }, data: { failCommands: ["commitTransaction"], writeConcernError: { code: 64, errmsg: "uncertain result" } } });
  const session = await User.db.startSession();
  const commit = jest.spyOn(session, "commitTransaction"); jest.spyOn(User.db, "startSession").mockResolvedValueOnce(session);
  let callbacks = 0;
  await ownerWriteFence(User, f.owner, async session => { callbacks++; return WardrobeItem.collection.insertOne(payload, { session }); });
  expect(callbacks).toBe(1); expect(commit.mock.calls.length).toBeGreaterThanOrEqual(2);
  await User.deleteOne({ _id: f.owner }); expect(await WardrobeItem.countDocuments({ user: f.owner })).toBe(0);
});
it("a committed response loss is safely swept without caller cleanup", async () => {
  const f = await experienceFixture();
  const session = await User.db.startSession(), transaction = session.withTransaction.bind(session);
  session.withTransaction = (async (...args: Any[]) => { await transaction(...args as [Any, Any]); throw new Error("lost result"); }) as Any;
  jest.spyOn(User.db, "startSession").mockResolvedValueOnce(session);
  await expect(ownerWriteFence(User, f.owner, session => WardrobeItem.create([{ user: f.owner, name: "lost", category: "top", clothingType: "top", warmth: 2 }], { session }))).rejects.toThrow("lost result");
  await User.deleteOne({ _id: f.owner }); expect(await WardrobeItem.countDocuments({ user: f.owner })).toBe(0);
});
it("worker loss after real fenced insertion leaves data covered by erasure", async () => {
  const f = await experienceFixture();
  const script = `const fs=require("node:fs"),path=require("node:path"),Module=require("node:module"),ts=require("typescript"); const resolve=Module._resolveFilename; Module._resolveFilename=function(id,...args){return resolve.call(this,id.startsWith("@/")?path.join(process.cwd(),id.slice(2)):id,...args)}; require.extensions[".ts"]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file); require("./lib/db.ts").initDatabase().then(({User,WardrobeItem})=>require("./lib/ownerWriteFence.ts").ownerWriteFence(User,process.env.TEST_OWNER,session=>WardrobeItem.create([{user:process.env.TEST_OWNER,name:"worker",category:"top",clothingType:"top",warmth:2}],{session}))).then(()=>{process.stdout.write("committed");setInterval(()=>{},1000)}).catch(error=>{console.error(error);process.exit(1)});`;
  const child=spawn(process.execPath,["-e",script],{cwd:path.resolve(__dirname,".."),env:{...process.env,MONGODB_URI:harness.server.getUri(),TEST_OWNER:f.owner}});
  let stderr=""; child.stderr.on("data",chunk=>{stderr+=String(chunk)});
  try {
    await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error(stderr||"worker timed out")),20_000); child.stdout.on("data",chunk=>{if(String(chunk).includes("committed")){clearTimeout(timeout);resolve()}}); child.once("exit",code=>{clearTimeout(timeout);reject(new Error(`worker exited ${code}: ${stderr}`))})});
    child.kill("SIGKILL"); await new Promise(resolve=>child.once("exit",resolve));
    await User.deleteOne({_id:f.owner}); expect(await WardrobeItem.countDocuments({user:f.owner})).toBe(0);
  } finally {child.kill("SIGKILL")}
},30_000);

it("worker loss before commit releases only through server abort/expiry, after which erasure leaves no rows", async () => {
  const f = await experienceFixture();
  const script = `const fs=require("node:fs"),path=require("node:path"),Module=require("node:module"),ts=require("typescript"); const resolve=Module._resolveFilename; Module._resolveFilename=function(id,...args){return resolve.call(this,id.startsWith("@/")?path.join(process.cwd(),id.slice(2)):id,...args)}; require.extensions[".ts"]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file); require("./lib/db.ts").initDatabase().then(({User,WardrobeItem})=>require("./lib/ownerWriteFence.ts").ownerWriteFence(User,process.env.TEST_OWNER,async session=>{await WardrobeItem.create([{user:process.env.TEST_OWNER,name:"uncommitted-worker",category:"top",clothingType:"top",warmth:2}],{session});process.stdout.write("uncommitted");await new Promise(()=>{})})).catch(error=>{console.error(error);process.exit(1)});`;
  const child=spawn(process.execPath,["-e",script],{cwd:path.resolve(__dirname,".."),env:{...process.env,MONGODB_URI:harness.server.getUri(),TEST_OWNER:f.owner}});
  let stderr=""; child.stderr.on("data",chunk=>{stderr+=String(chunk)});
  try {
    await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error(stderr||"worker timed out")),20_000); child.stdout.on("data",chunk=>{if(String(chunk).includes("uncommitted")){clearTimeout(timeout);resolve()}}); child.once("exit",code=>{clearTimeout(timeout);reject(new Error(`worker exited ${code}: ${stderr}`))})});
    expect(await WardrobeItem.countDocuments({user:f.owner,name:"uncommitted-worker"})).toBe(0);
    child.kill("SIGKILL"); await new Promise(resolve=>child.once("exit",resolve));
    // Test-only replica startup uses a 2s server transaction lifetime. Production may
    // block or require deletion retry until its server releases the killed worker's lock.
    expect((await User.deleteOne({_id:f.owner})).deletedCount).toBe(1);
    expect(await WardrobeItem.countDocuments({user:f.owner})).toBe(0);
    expect(await User.findById(f.owner)).toBeNull();
  } finally {child.kill("SIGKILL")}
},30_000);
