import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import User from "@/models/User";
import OutfitExperience from "@/models/OutfitExperience";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import OutfitInteraction from "@/models/OutfitInteraction";
import WardrobeItem from "@/models/WardrobeItem";
import WardrobeImage from "@/models/WardrobeImage";
import { ExperienceStore } from "@/lib/outfitExperience/store";
import { beginUserErasure } from "@/lib/userErasure";
import { resumeUserErasure } from "@/lib/resumeUserErasure";
import { gate } from "./helpers/experienceFixture";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let server: MongoMemoryReplSet;
const models = { User, OutfitExperience, GenerationSnapshot, OutfitInteraction, WardrobeItem, WardrobeImage };
beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" }, instanceOpts: [{ args: ["--setParameter", "enableTestCommands=1"] }] });
  await mongoose.connect(server.getUri(), { retryWrites: true });
  await Promise.all(Object.values(models).map(model => model.init()));
}, 120_000);
afterAll(async () => { await mongoose.disconnect(); await server.stop(); });
afterEach(() => { jest.restoreAllMocks(); });
it("a genuinely delayed marker command cannot recreate a row after complete erasure", async () => {
  const owner = await User.create({ authId: randomUUID(), email: `${randomUUID()}@example.test` });
  const retry = gate(), id = randomUUID();
  const admin = User.db.db!.admin(), update = User.updateOne.bind(User);
  let admissions = 0, rowStartedAt = 0;
  const observedErrors: string[] = [];
  // Arm the actual row command AFTER the real owner write, not an update-name guess.
  // Pause the retry before it can reacquire that owner, allowing erasure to complete.
  jest.spyOn(User, "updateOne").mockImplementation((async (...args: Any[]) => {
    const admission = Boolean(args[1].$inc?.imageWriteVersion);
    const attempt = admission ? ++admissions : 0;
    if (attempt === 2) await retry.block();
    const result = await update(...args as [Any, Any, Any]);
    if (attempt === 1) await admin.command({ configureFailPoint: "failCommand", mode: { times: 1 }, data: { failCommands: ["update"], blockConnection: true, blockTimeMS: 1000 } });
    return result;
  }) as Any);
  const native = Object.getPrototypeOf(User.db.db!.collection("outfitexperiences"));
  const replace = native.replaceOne;
  jest.spyOn(native, "replaceOne").mockImplementation((async function(this: Any, ...args: Any[]) {
    // Driver CSOT deliberately suppresses connection socketTimeoutMS during transactions.
    // Inject the 80ms timeout only on this row operation to reproduce a lost transport.
    if (this.collectionName === "outfitexperiences") {
      rowStartedAt = performance.now();
      args[2] = { ...args[2], socketTimeoutMS: 80 };
    }
    try { return await replace.apply(this, args); }
    catch (error) { if (this.collectionName === "outfitexperiences") observedErrors.push((error as Error).name); throw error; }
  }) as Any);
  const pending = new ExperienceStore().erase(String(owner._id), id).then(() => undefined, error => error);
  try {
    await retry.entered;
    expect(observedErrors).toContain("MongoNetworkTimeoutError");
    expect(await OutfitExperience.countDocuments({ user: owner._id })).toBe(0);
    await beginUserErasure(User, owner._id);
    const outcome = await resumeUserErasure(models, String(owner._id), async () => {}, async () => (await User.deleteOne({ _id: owner._id })).deletedCount > 0);
    expect(outcome).toEqual({ status: 200, body: { ok: true } });
    // Prove the adverse order actually occurred, rather than merely sleeping later.
    expect(performance.now() - rowStartedAt).toBeLessThan(1000);
    retry.release(); expect(await pending).toMatchObject({ code: "account_unavailable" });
    // The original server command resumes after the caller's timeout, abort, successful
    // cascade, and all request cleanup. Its session is aborted, so it cannot recreate data.
    await new Promise(resolve => setTimeout(resolve, 1400));
    expect(await User.findById(owner._id)).toBeNull();
    expect(await OutfitExperience.countDocuments({ user: owner._id })).toBe(0);
  } finally { retry.release(); await admin.command({ configureFailPoint: "failCommand", mode: "off" }); }
}, 15_000);
