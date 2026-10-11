import { randomUUID } from "crypto";
import { Types } from "mongoose";
import OutfitExperience, { experienceCollection } from "@/models/OutfitExperience";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import User from "@/models/User";
import { ExperienceStore } from "@/lib/outfitExperience/store";
import { MAX_EXPERIENCE_REVISIONS } from "@/lib/outfitExperience/contract";
import { getExperience, recallExperiences } from "@/lib/outfitExperience/read";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import { experienceFixture, gate, rendezvous } from "./helpers/experienceFixture";

let harness: MongoHarness | undefined;
const now = () => new Date("2026-10-10T12:00:00Z");
beforeAll(async () => { harness = await startMemoryMongo([OutfitExperience, User], { replicaSet: true }); }, 120_000);
afterEach(async () => { await harness?.clear(); });
afterAll(async () => { await harness?.stop(); });

it("builds the unique owner/experience index and one row under concurrent identical creates", async () => {
  const f = await experienceFixture();
  const barrier = rendezvous(2);
  const store = new ExperienceStore({ now, beforeWrite: barrier });
  const results = await Promise.all([store.create(f.owner, f.input), store.create(f.owner, f.input)]);
  expect(results[0]).toEqual(results[1]);
  expect(await experienceCollection().countDocuments()).toBe(1);
  expect((await experienceCollection().indexes()).some(i => i.unique && i.key.user === 1 && i.key.experienceId === 1)).toBe(true);
  const row = await experienceCollection().findOne({ experienceId: f.input.experienceId });
  expect(row!.memberItemIds!.map(String)).toContain(f.itemId);
  expect(row!.revisions![0].state.learningDisposition).toBe("do_not_learn");
});

it("rejects cross-owner, unshown and forged membership writes", async () => {
  const f = await experienceFixture(); const other = await experienceFixture();
  const store = new ExperienceStore({ now });
  await expect(store.create(other.owner, f.input)).rejects.toMatchObject({ code: "source_unavailable" });
  await expect(store.create(f.owner, { ...f.input, candidateId: "not-shown" })).rejects.toMatchObject({ code: "source_unavailable" });
  await expect(store.create(f.owner, { ...f.input, memberItemIds: [other.itemId] })).rejects.toThrow("Shown composition is derived from the source");
  await expect(store.create(f.owner, { ...f.input, compositionStatus: "changed" })).rejects.toThrow("Choose 1–5 actual pieces");
  expect(await experienceCollection().countDocuments()).toBe(0);
});

it("uses shown source context only when explicitly confirmed and suppresses it after redaction", async () => {
  const f = await experienceFixture();
  const store = new ExperienceStore({ now, beforeWrite: async () => {
    await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId }, { $set: { redacted: true } });
  } });
  await store.create(f.owner, { ...f.input, context: { kind: "suggestion", confirmed: false } });
  const view = await getExperience(f.owner, f.input.experienceId);
  expect(view).toMatchObject({ sourceAvailable: false, source: null,
    items: [{ name: "Green shirt" }, { name: "Unknown item" }],
    state: { context: { rawOccasion: "", exactScopeKey: null } } });
  expect(JSON.stringify(view)).not.toContain("Class");
});

it("allows just one competing revision and acknowledges older retries without reverting current state", async () => {
  const f = await experienceFixture(); const store = new ExperienceStore({ now });
  await store.create(f.owner, f.input);
  const edits = ["Dinner", "Work"].map(text => ({ ...f.state, context: { kind: "user", text }, operationId: randomUUID(), expectedPreviousRevision: 1 }));
  const racing = new ExperienceStore({ now, beforeWrite: rendezvous(2) });
  const results = await Promise.allSettled(edits.map(edit => racing.revise(f.owner, f.input.experienceId, edit)));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
  const winner = edits[results.findIndex(r => r.status === "fulfilled")];
  await store.revise(f.owner, f.input.experienceId, { ...f.state, operationId: randomUUID(), expectedPreviousRevision: 2, outcome: "worked" });
  expect(await store.revise(f.owner, f.input.experienceId, winner)).toMatchObject({ acknowledgedRevision: 2, currentRevision: 3 });
  await expect(store.revise(f.owner, f.input.experienceId, { ...winner, outcome: "worked" })).rejects.toMatchObject({ code: "operation_conflict" });
  expect(await getExperience(f.owner, f.input.experienceId)).toMatchObject({ state: { outcome: "worked" } });
  expect(await store.create(f.owner, f.input)).toMatchObject({ acknowledgedRevision: 1, currentRevision: 3 });
});

it("conflicts on a different initial payload or operation under an existing experience ID", async () => {
  const f = await experienceFixture(); const store = new ExperienceStore({ now });
  await store.create(f.owner, f.input);
  await expect(store.create(f.owner, { ...f.input, outcome: "worked" })).rejects.toMatchObject({ code: "operation_conflict" });
  await expect(store.create(f.owner, { ...f.input, operationId: randomUUID() })).rejects.toMatchObject({ code: "experience_exists" });
});

it("can retract at capacity, reconcile a full-history retry and erase after retraction", async () => {
  const f = await experienceFixture(); const store = new ExperienceStore({ now });
  await store.create(f.owner, f.input);
  let last;
  for (let i = 1; i < MAX_EXPERIENCE_REVISIONS; i++) {
    last = { ...f.state, expectedPreviousRevision: i, operationId: randomUUID() };
    await store.revise(f.owner, f.input.experienceId, last);
  }
  expect(await store.revise(f.owner, f.input.experienceId, last)).toMatchObject({ currentRevision: MAX_EXPERIENCE_REVISIONS });
  await expect(store.revise(f.owner, f.input.experienceId, { ...f.state, expectedPreviousRevision: MAX_EXPERIENCE_REVISIONS, operationId: randomUUID() })).rejects.toMatchObject({ code: "revision_capacity" });
  await store.retract(f.owner, f.input.experienceId, { expectedPreviousRevision: MAX_EXPERIENCE_REVISIONS, operationId: randomUUID() });
  expect((await recallExperiences(f.owner)).experiences).toEqual([]);
  expect((await recallExperiences(f.owner, { lifecycle: "retracted" })).experiences).toHaveLength(1);
  expect(await getExperience(f.owner, f.input.experienceId)).toMatchObject({ lifecycle: "retracted" });
  await store.erase(f.owner, f.input.experienceId);
  const erased = await experienceCollection().findOne({ experienceId: f.input.experienceId });
  expect(Object.keys(erased!).sort()).toEqual(["_id", "experienceId", "lifecycle", "user"]);
  await expect(store.create(f.owner, f.input)).rejects.toMatchObject({ code: "experience_erased" });
});

it.each(["before", "after"])("erasure wins %s the initial write", async timing => {
  const f = await experienceFixture(); const g = gate();
  const delayed = new ExperienceStore({ now, [timing === "before" ? "beforeWrite" : "afterWrite"]: g.block });
  const pending = delayed.create(f.owner, f.input);
  await g.entered;
  await new ExperienceStore({ now }).erase(f.owner, f.input.experienceId);
  g.release();
  await expect(pending).rejects.toMatchObject({ code: "experience_erased" });
  expect(Object.keys((await experienceCollection().findOne({ experienceId: f.input.experienceId }))!).sort()).toEqual(["_id", "experienceId", "lifecycle", "user"]);
});

it("erasure wins an already validated edit", async () => {
  const f = await experienceFixture(); const store = new ExperienceStore({ now });
  await store.create(f.owner, f.input);
  const g = gate(); const delayed = new ExperienceStore({ now, beforeWrite: g.block });
  const pending = delayed.revise(f.owner, f.input.experienceId, { ...f.state, expectedPreviousRevision: 1, operationId: randomUUID() });
  await g.entered; await store.erase(f.owner, f.input.experienceId); g.release();
  await expect(pending).rejects.toMatchObject({ code: "experience_erased" });
  expect(await getExperience(f.owner, f.input.experienceId)).toEqual({ experienceId: f.input.experienceId, lifecycle: "erased" });
});

it.each(["create", "revise", "erase"] as const)("account deletion closes an in-flight %s including marker creation", async mutation => {
  const f = await experienceFixture(); const store = new ExperienceStore({ now });
  if (mutation === "revise") await store.create(f.owner, f.input);
  const g = gate(); const delayed = new ExperienceStore({ now, beforeWrite: g.block });
  const pending = mutation === "create" ? delayed.create(f.owner, f.input) : mutation === "erase"
    ? delayed.erase(f.owner, f.input.experienceId)
    : delayed.revise(f.owner, f.input.experienceId, { ...f.state, expectedPreviousRevision: 1, operationId: randomUUID() });
  await g.entered; await User.deleteOne({ _id: f.owner }); g.release();
  await expect(pending).rejects.toMatchObject({ code: "account_unavailable" });
  expect(await experienceCollection().countDocuments({ user: new Types.ObjectId(f.owner) })).toBe(0);
});

it("account cascade removes active records and erased markers only for its owner", async () => {
  const f = await experienceFixture(); const other = await experienceFixture(); const store = new ExperienceStore({ now });
  await store.create(f.owner, f.input); await store.erase(f.owner, randomUUID());
  await store.create(other.owner, other.input);
  await User.deleteOne({ _id: f.owner });
  expect(await experienceCollection().countDocuments()).toBe(1);
  expect(await getExperience(other.owner, other.input.experienceId)).toMatchObject({ lifecycle: "active" });
});

it("bounds absent-ID markers but still erases existing content", async () => {
  const f = await experienceFixture(); const store = new ExperienceStore({ now });
  await store.create(f.owner, f.input);
  // Request-scoped store construction must not reset the worker's courtesy limiter.
  for (let i = 0; i < 20; i++) await new ExperienceStore({ now }).erase(f.owner, randomUUID());
  await expect(new ExperienceStore({ now }).erase(f.owner.toUpperCase(), randomUUID())).rejects.toMatchObject({ code: "marker_rate_limit" });
  await store.erase(f.owner, f.input.experienceId);
  await store.erase(f.owner, f.input.experienceId);
});

it("durably admits distinct IDs up to the account ceiling and reuses a reservation on retry", async () => {
  const f = await experienceFixture(); const store = new ExperienceStore({ now });
  await User.collection.updateOne({ _id: new Types.ObjectId(f.owner) }, { $set: { experienceAdmissions: Array.from({ length: 999 }, () => randomUUID()) } });
  await store.create(f.owner, f.input);
  expect(await store.create(f.owner, f.input)).toMatchObject({ acknowledgedRevision: 1 });
  await expect(store.create(f.owner, { ...f.input, experienceId: randomUUID(), operationId: randomUUID() })).rejects.toMatchObject({ code: "storage_limit" });
  await store.revise(f.owner, f.input.experienceId, { ...f.state, operationId: randomUUID(), expectedPreviousRevision: 1 });
  await store.erase(f.owner, f.input.experienceId);
  expect((await User.collection.findOne({ _id: new Types.ObjectId(f.owner) }))?.experienceAdmissions).toHaveLength(1000);
});

it.each(["create", "revise", "erase"] as const)("cleans account data after ambiguous committed %s", async mutation => {
  const f = await experienceFixture(); const store = new ExperienceStore({ now });
  if (mutation !== "create") await store.create(f.owner, f.input);
  const ambiguous = new Error("ack lost after commit");
  const delayed = new ExperienceStore({ now, afterNativeWrite: async () => {
    await User.deleteOne({ _id: f.owner });
    throw ambiguous;
  } });
  const request = mutation === "create" ? delayed.create(f.owner, f.input) : mutation === "revise"
    ? delayed.revise(f.owner, f.input.experienceId, { ...f.state, operationId: randomUUID(), expectedPreviousRevision: 1 })
    : delayed.erase(f.owner, f.input.experienceId);
  await expect(request).rejects.toBe(ambiguous);
  expect(await experienceCollection().countDocuments({ user: new Types.ObjectId(f.owner) })).toBe(0);
});
