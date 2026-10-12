import { randomUUID } from "crypto";
import { Types } from "mongoose";
import { NextRequest } from "next/server";
import User from "@/models/User";
import WardrobeItem from "@/models/WardrobeItem";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import OutfitExperience from "@/models/OutfitExperience";
import OutfitInteraction from "@/models/OutfitInteraction";
import { verifyFirebaseUser } from "@/lib/apiAuth";
import { OutfitPlanningStore, MAX_ACTIVE_PLANS, MAX_PLAN_IDENTITIES } from "@/lib/outfitPlanning/store";
import { GET, POST } from "@/app/api/plans/route";
import { PATCH, DELETE } from "@/app/api/plans/[planId]/route";
import { experienceFixture, gate } from "./helpers/experienceFixture";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
jest.mock("@/lib/apiAuth", () => ({ verifyFirebaseUser: jest.fn() }));
let harness: MongoHarness;
const now = () => new Date("2026-10-10T12:00:00Z");
const store = () => new OutfitPlanningStore({ now });
const command = (f: Awaited<ReturnType<typeof experienceFixture>>) => ({ planId: randomUUID(), snapshotId: String(f.snapshotId), candidateId: "c1", plannedFor: "2026-10-11", timezone: "America/Los_Angeles" });
beforeAll(async () => { harness = await startMemoryMongo([User]); }, 120_000);
afterEach(async () => { await harness.clear(); jest.clearAllMocks(); });
afterAll(async () => { await harness.stop(); });

it("plans an unliked exact source without generation, wear or copied evidence and reads current availability", async () => {
  const f = await experienceFixture(); const input = command(f);
  await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId }, { $set: { "candidates.1.styleMove": { oneSentence: "Tuck the shirt." } } });
  expect(await store().create(f.owner, input)).toMatchObject({ planId: input.planId, revision: 1 });
  expect(await store().list(f.owner)).toMatchObject({ plans: [{ plannedFor: input.plannedFor, suggestion: {
    candidateId: "c1", suggestionContext: "Class", styleMove: { oneSentence: "Tuck the shirt." }, items: [{ name: "Green shirt", imageUrl: "mongo:synthetic" }] } }] });
  const owner = await User.collection.findOne({ _id: new Types.ObjectId(f.owner) });
  expect(owner!.outfitPlans[0]).not.toHaveProperty("items");
  expect(owner!.outfitPlans[0]).not.toHaveProperty("imageUrl");
  expect(owner!.outfitPlans[0]).not.toHaveProperty("suggestionContext");
  expect((await User.findById(f.owner).lean())).not.toHaveProperty("outfitPlans");
  expect(await OutfitExperience.countDocuments()).toBe(0); expect(await OutfitInteraction.countDocuments()).toBe(0);
  await WardrobeItem.updateOne({ _id: f.itemId }, { $set: { name: "Renamed shirt", isAvailable: false } });
  expect(await store().list(f.owner)).toMatchObject({ plans: [{ suggestion: { items: [{ name: "Green shirt", availability: "unavailable", changed: true }] } }] });
  await expect(store().create(f.owner, { ...input, planId: randomUUID(), plannedFor: "2026-10-12" })).rejects.toMatchObject({ code: "plan_items_unavailable" });
  await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId }, { $set: { redacted: true } });
  expect(await store().list(f.owner)).toMatchObject({ plans: [{ plannedFor: "2026-10-11", suggestion: null }] });
  await store().remove(f.owner, input.planId);
  expect(await store().list(f.owner)).toEqual({ plans: [] });
  expect((await User.collection.findOne({ _id: new Types.ObjectId(f.owner) }))!.outfitPlans).toEqual([{ planId: input.planId, lifecycle: "removed" }]);
});
it("binds owner and shown membership and rejects missing/unavailable source pieces", async () => {
  const f = await experienceFixture(); const other = await experienceFixture(); const input = command(f);
  await expect(store().create(other.owner, input)).rejects.toMatchObject({ code: "source_unavailable" });
  await expect(store().create(f.owner, { ...input, candidateId: "not-shown" })).rejects.toMatchObject({ code: "source_unavailable" });
  await expect(store().create(f.owner, { ...input, candidateId: "c0" })).rejects.toMatchObject({ code: "plan_items_unavailable" });
  await store().create(f.owner, input);
  expect(await store().list(other.owner)).toEqual({ plans: [] });
  await expect(store().reschedule(other.owner, input.planId, { operationId: randomUUID(), expectedRevision: 1, plannedFor: "2026-10-12", timezone: "UTC" })).rejects.toMatchObject({ code: "plan_unavailable" });
  await store().remove(other.owner, input.planId);
  expect((await store().list(f.owner)).plans).toHaveLength(1);
});
it("validates actual calendar days and named zones, permits future plans and does not infer wear after the day passes", async () => {
  const f = await experienceFixture(); const input = command(f);
  for (const invalid of [{ plannedFor: "2026-02-30" }, { plannedFor: "2026-10-09" }, { timezone: "+04:00" }, { timezone: "Invalid/Zone" }, { itemIds: [f.itemId] }])
    await expect(store().create(f.owner, { ...input, ...invalid })).rejects.toThrow();
  const west = new OutfitPlanningStore({ now: () => new Date("2026-10-11T01:00:00Z") });
  await west.create(f.owner, { ...input, plannedFor: "2026-10-10" }); // Still today in LA.
  expect((await new OutfitPlanningStore({ now: () => new Date("2026-10-15T12:00:00Z") }).list(f.owner)).plans[0].plannedFor).toBe("2026-10-10");
  expect(await OutfitExperience.countDocuments()).toBe(0);
});
it("reuses creation identity after lost acknowledgement/midnight and rejects payload changes and accidental duplicate plans", async () => {
  const f = await experienceFixture(); const input = command(f);
  let lost = true;
  const unreliable = new OutfitPlanningStore({ now, afterWrite: async () => { if (lost) { lost = false; throw new Error("ack lost"); } } });
  await expect(unreliable.create(f.owner, input)).rejects.toThrow("ack lost");
  const later = new OutfitPlanningStore({ now: () => new Date("2026-10-13T12:00:00Z") });
  expect(await later.create(f.owner, input)).toMatchObject({ planId: input.planId, revision: 1 });
  await expect(store().create(f.owner, { ...input, plannedFor: "2026-10-12" })).rejects.toMatchObject({ code: "plan_identity_conflict" });
  await expect(store().create(f.owner, { ...input, planId: randomUUID() })).rejects.toMatchObject({ code: "already_planned" });
  expect((await store().list(f.owner)).plans).toHaveLength(1);
});
it("protects concurrent create capacity and identity with owner CAS, without relying on new production indexes", async () => {
  const f = await experienceFixture(); const input = command(f);
  const same = await Promise.all([store().create(f.owner, input), store().create(f.owner, input)]);
  expect(same[0]).toEqual(same[1]);
  for (let i = 1; i < MAX_ACTIVE_PLANS - 1; i++) await store().create(f.owner, { ...input, planId: randomUUID(), plannedFor: `2026-11-${String(i).padStart(2, "0")}` });
  const results = await Promise.allSettled(["2026-12-01", "2026-12-02"].map(plannedFor => store().create(f.owner, { ...input, planId: randomUUID(), plannedFor })));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect((await store().list(f.owner)).plans).toHaveLength(MAX_ACTIVE_PLANS);
  await store().remove(f.owner, input.planId);
  await store().create(f.owner, { ...input, planId: randomUUID(), plannedFor: "2026-12-03" });
  expect((await store().list(f.owner)).plans).toHaveLength(MAX_ACTIVE_PLANS);
});
it("reschedules with revision checks and replay identity and cannot revive an erased plan", async () => {
  const f = await experienceFixture(); const input = command(f); await store().create(f.owner, input);
  const edit = { operationId: randomUUID(), expectedRevision: 1, plannedFor: "2026-10-12", timezone: "UTC" };
  const results = await Promise.allSettled([store().reschedule(f.owner, input.planId, edit), store().reschedule(f.owner, input.planId, { ...edit, operationId: randomUUID(), plannedFor: "2026-10-13" })]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const current = (await store().list(f.owner)).plans[0]; expect(current.revision).toBe(2);
  const winner = current.plannedFor === edit.plannedFor ? edit : null;
  if (winner) expect(await store().reschedule(f.owner, input.planId, winner)).toMatchObject({ revision: 2 });
  await expect(store().reschedule(f.owner, input.planId, { ...edit, operationId: randomUUID() })).rejects.toMatchObject({ code: "plan_revision_conflict" });
  await store().remove(f.owner, input.planId);
  await expect(store().create(f.owner, input)).rejects.toMatchObject({ code: "plan_removed" });
  await expect(store().reschedule(f.owner, input.planId, edit)).rejects.toMatchObject({ code: "plan_removed" });
});
it("removal wins over a create not yet committed", async () => {
  const f = await experienceFixture(); const input = command(f); const barrier = gate();
  const delayed = new OutfitPlanningStore({ now, beforeWrite: barrier.block });
  const create = delayed.create(f.owner, input); const failed = expect(create).rejects.toMatchObject({ code: "plan_removed" });
  await barrier.entered; await store().remove(f.owner, input.planId); barrier.release(); await failed;
  expect(await store().list(f.owner)).toEqual({ plans: [] });
});
it("account deletion prevents late writes and erases committed intent with the owner", async () => {
  const f = await experienceFixture(); const other = await experienceFixture(); const input = command(f); const barrier = gate();
  await store().create(other.owner, command(other));
  const delayed = new OutfitPlanningStore({ now, beforeWrite: barrier.block });
  const create = delayed.create(f.owner, input); const failed = expect(create).rejects.toMatchObject({ code: "account_unavailable" });
  await barrier.entered; await User.deleteOne({ _id: f.owner }); barrier.release(); await failed;
  expect(await User.collection.findOne({ _id: new Types.ObjectId(f.owner) })).toBeNull();
  expect((await store().list(other.owner)).plans).toHaveLength(1);
  const next = await experienceFixture();
  const deleting = new OutfitPlanningStore({ now, afterWrite: async () => { await User.deleteOne({ _id: next.owner }); } });
  await expect(deleting.create(next.owner, command(next))).rejects.toMatchObject({ code: "account_unavailable" });
  expect(await User.collection.findOne({ _id: new Types.ObjectId(next.owner) })).toBeNull();
});
it("routes enforce authentication, strict bodies, no-store reads and owner-scoped change/removal", async () => {
  const f = await experienceFixture(); const input = { ...command(f), plannedFor: "2099-10-11" };
  const auth = verifyFirebaseUser as jest.Mock; auth.mockResolvedValue({ error: "Missing token", status: 401 });
  expect((await GET(new NextRequest("http://localhost/api/plans"))).status).toBe(401);
  auth.mockResolvedValue({ userId: f.owner });
  const req = (body: unknown, method = "POST") => new NextRequest("http://localhost/api/plans", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  expect((await POST(req({ ...input, user: "other" }))).status).toBe(400);
  expect((await POST(req(input))).status).toBe(200);
  const result = await GET(new NextRequest("http://localhost/api/plans")); expect(result.headers.get("cache-control")).toBe("no-store");
  expect((await result.json()).plans).toHaveLength(1);
  const context = { params: Promise.resolve({ planId: input.planId }) };
  expect((await PATCH(req({ operationId: randomUUID(), expectedRevision: 1, plannedFor: "2099-10-12", timezone: "UTC" }, "PATCH"), context)).status).toBe(200);
  expect((await DELETE(new NextRequest("http://localhost/api/plans", { method: "DELETE" }), context)).status).toBe(200);
  expect((await store().list(f.owner)).plans).toHaveLength(0);
});

it("does not cache outfit content when a source changes during planning admission", async () => {
  const f = await experienceFixture(); const input = command(f); const barrier = gate();
  const delayed = new OutfitPlanningStore({ now, beforeWrite: barrier.block });
  const create = delayed.create(f.owner, input);
  await barrier.entered;
  await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId }, { $set: { redacted: true } });
  barrier.release(); await create;
  expect(await store().list(f.owner)).toMatchObject({ plans: [{ plannedFor: input.plannedFor, suggestion: null }] });
  await store().remove(f.owner, input.planId);
  expect(await store().list(f.owner)).toEqual({ plans: [] });
});
it("reports current garment removal after a date edit raced with closet changes", async () => {
  const f = await experienceFixture(); const input = command(f); await store().create(f.owner, input);
  const barrier = gate(); const delayed = new OutfitPlanningStore({ now, beforeWrite: barrier.block });
  const edit = delayed.reschedule(f.owner, input.planId, { operationId: randomUUID(), expectedRevision: 1, plannedFor: "2026-10-12", timezone: "UTC" });
  await barrier.entered; await WardrobeItem.deleteOne({ _id: f.itemId }); barrier.release(); await edit;
  expect(await store().list(f.owner)).toMatchObject({ plans: [{ plannedFor: "2026-10-12", suggestion: { items: [{ availability: "missing" }] } }] });
  await expect(store().reschedule(f.owner, input.planId, { operationId: randomUUID(), expectedRevision: 2, plannedFor: "2026-10-13", timezone: "UTC" })).rejects.toMatchObject({ code: "plan_items_unavailable" });
});

it("deduplicates simultaneous different requests for the same outfit and day", async () => {
  const f = await experienceFixture(); const input = command(f);
  const results = await Promise.allSettled([store().create(f.owner, input), store().create(f.owner, { ...input, planId: randomUUID() })]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect((await store().list(f.owner)).plans).toHaveLength(1);
});
it("removal wins over a date edit that has not committed", async () => {
  const f = await experienceFixture(); const input = command(f); await store().create(f.owner, input);
  const barrier = gate(); const delayed = new OutfitPlanningStore({ now, beforeWrite: barrier.block });
  const edit = delayed.reschedule(f.owner, input.planId, { operationId: randomUUID(), expectedRevision: 1, plannedFor: "2026-10-12", timezone: "UTC" });
  const failed = expect(edit).rejects.toMatchObject({ code: "plan_removed" });
  await barrier.entered; await store().remove(f.owner, input.planId); barrier.release(); await failed;
  expect(await store().list(f.owner)).toEqual({ plans: [] });
});
it("bounds lifetime retry markers without blocking removal or date corrections to existing plans", async () => {
  const f = await experienceFixture(); const input = command(f); await store().create(f.owner, input);
  const existing = (await User.collection.findOne({ _id: new Types.ObjectId(f.owner) }))!.outfitPlans;
  await User.collection.updateOne({ _id: new Types.ObjectId(f.owner) }, { $set: { outfitPlans: [
    ...existing, ...Array.from({ length: MAX_PLAN_IDENTITIES - 1 }, () => ({ planId: randomUUID(), lifecycle: "removed" })),
  ] } });
  await expect(store().create(f.owner, { ...input, planId: randomUUID(), plannedFor: "2026-10-12" })).rejects.toMatchObject({ code: "planning_storage_limit" });
  await store().reschedule(f.owner, input.planId, { operationId: randomUUID(), expectedRevision: 1, plannedFor: "2026-10-12", timezone: "UTC" });
  await store().remove(f.owner, input.planId);
  expect(await store().list(f.owner)).toEqual({ plans: [] });
});
