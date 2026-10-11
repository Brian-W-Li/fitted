import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import OutfitExperience, { experienceCollection } from "@/models/OutfitExperience";
import { ExperienceStore } from "@/lib/outfitExperience/store";
import { experienceFixture } from "./helpers/experienceFixture";

let server: MongoMemoryReplSet | undefined;
beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(server.getUri(), { autoIndex: false });
  await OutfitExperience.init();
}, 120_000);
afterAll(async () => { await mongoose.disconnect(); await server?.stop(); });

it("fails closed then retries explicit index creation with production autoIndex disabled", async () => {
  // Unlike the normal fixture harness, this database has no automatic unique index.
  expect((await experienceCollection().indexes()).some(i => i.unique)).toBe(false);
  const f = await experienceFixture();
  const store = new ExperienceStore({ now: () => new Date("2026-10-10T12:00:00Z") });
  const build = jest.spyOn(OutfitExperience, "createIndexes").mockRejectedValueOnce(new Error("index build unavailable"));
  try {
    await expect(store.create(f.owner, f.input)).rejects.toThrow("index build unavailable");
    expect(await experienceCollection().countDocuments()).toBe(0);
    const results = await Promise.all([store.create(f.owner, f.input), store.create(f.owner, f.input)]);
    expect(results.map(r => r.currentRevision)).toEqual([1, 1]);
    expect(build).toHaveBeenCalledTimes(2); // Failed build + one shared successful retry.
    const unique = (await experienceCollection().indexes()).find(i => i.unique);
    expect(unique?.key).toEqual({ user: 1, experienceId: 1 });
    expect(await experienceCollection().countDocuments()).toBe(1);
  } finally { build.mockRestore(); }
});
