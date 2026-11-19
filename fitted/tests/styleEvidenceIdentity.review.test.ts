/** Persisted corrections/removals and single-axis scope isolation, without a mocked reducer. */
import { randomUUID } from "crypto";
import { Types } from "mongoose";
import type { NextRequest } from "next/server";
import User from "@/models/User";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import OutfitInteraction from "@/models/OutfitInteraction";
import { __resetInteractionRateLimit, deleteInteraction, postInteraction } from "@/lib/interactions";
import { buildStylePreferenceEvidence } from "@/lib/stylePreferenceEvidence";
import { StyleMemoryStore } from "@/lib/styleMemory/store";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import { deps, namedOwner, oid, react, request, styledSnapshot } from "./helpers/styleLearningFixture";

let harness: MongoHarness;
beforeAll(async () => { harness = await startMemoryMongo([User, GenerationSnapshot, OutfitInteraction], { replicaSet: true }); }, 120_000);
afterEach(async () => { await harness.clear(); __resetInteractionRateLimit(); });
afterAll(async () => { await harness.stop(); });
const at = async (id: string, createdAt: string) => OutfitInteraction.collection.updateOne(
  { _id: new Types.ObjectId(id) }, { $set: { createdAt: new Date(createdAt) } });
const revision = async (owner: string) => (await User.collection.findOne({ _id: new Types.ObjectId(owner) }))?.styleMemoryRevision;

it("correcting, clearing and explicitly including an older vote never makes it a newer composition vote", async () => {
  const f = await namedOwner(), first = await styledSnapshot(f.owner, f.context);
  const older = await react(f.owner, first);
  await at(older, "2026-01-01T00:00:00Z");
  const repeated = await styledSnapshot(f.owner, f.context, [first.topId, first.bottomId]);
  const newer = await react(f.owner, repeated, "rejected");
  await at(newer, "2026-01-02T00:00:00Z");
  const before = await buildStylePreferenceEvidence(f.owner, f.selection, "mild");
  expect(before.preferenceRows).toHaveLength(1);
  expect(before.preferenceRows[0]).toMatchObject({ id: newer, snapshotId: repeated.snapshotId,
    action: "rejected", createdAt: "2026-01-02T00:00:00.000Z" });

  const concern = { kind: "reason_amendment", reactionId: older, operationId: randomUUID(),
    feedbackReason: { scope: "item", concern: "fit", itemId: first.topId } };
  expect((await postInteraction(request(concern), deps(f.owner))).status).toBe(200);
  expect((await postInteraction(request({ kind: "reason_amendment", reactionId: older, operationId: randomUUID() }), deps(f.owner))).status).toBe(200);
  const inclusion = { kind: "learning_disposition", reactionId: older, operationId: randomUUID(),
    expectedDispositionRevision: 2, learningDisposition: "normal" };
  expect((await postInteraction(request(inclusion), deps(f.owner))).status).toBe(200);
  const after = await buildStylePreferenceEvidence(f.owner, f.selection, "mild");
  expect(after.preferenceRows).toEqual(before.preferenceRows);
  expect(after.interactionCountAtRequest).toBe(2);
  expect(after.behavioralRows.interactionRows).toHaveLength(2);
  const stored = await OutfitInteraction.collection.findOne({ _id: new Types.ObjectId(older) });
  expect(stored?.createdAt).toEqual(new Date("2026-01-01T00:00:00Z"));
  expect(stored?.action).toBe("accepted");
  const acknowledgedRevision = after.memoryRevision;
  expect((await postInteraction(request(inclusion), deps(f.owner))).status).toBe(200);
  expect((await buildStylePreferenceEvidence(f.owner, f.selection, "mild")).memoryRevision).toBe(acknowledgedRevision);
});

it("removing a flipped binding erases every vote and amendment, and a new vote starts a fresh evidence identity", async () => {
  const f = await namedOwner(), source = await styledSnapshot(f.owner, f.context);
  const original = await react(f.owner, source);
  expect((await postInteraction(request({ kind: "reason_amendment", reactionId: original, operationId: randomUUID(),
    feedbackReason: { scope: "item", concern: "fit", itemId: source.topId } }), deps(f.owner))).status).toBe(200);
  const flipped = await react(f.owner, source, "rejected");
  const before = await buildStylePreferenceEvidence(f.owner, f.selection, "mild");
  expect(before.preferenceRows.map(row => [row.id, row.action])).toEqual([[flipped, "rejected"]]);
  const removal = { url: `http://localhost/api/interactions?snapshotId=${source.snapshotId}&candidateId=${source.candidateId}` } as NextRequest;
  const priorRevision = await revision(f.owner);
  expect((await deleteInteraction(removal, deps(f.owner))).status).toBe(200);
  const removed = await buildStylePreferenceEvidence(f.owner, f.selection, "mild");
  expect(removed.memoryRevision).toBe(priorRevision + 1);
  expect(removed.preferenceRows).toEqual([]);
  expect(removed.behavioralRows.interactionRows).toEqual([]);
  expect(removed.interactionCountAtRequest).toBe(0);
  expect(removed.behavioralRows.recentSnapshots).toHaveLength(1); // Exposure survives retracted feedback.
  expect(await OutfitInteraction.countDocuments({ user: f.owner })).toBe(0);
  expect((await deleteInteraction(removal, deps(f.owner))).status).toBe(404);
  expect(await revision(f.owner)).toBe(removed.memoryRevision);

  const fresh = await react(f.owner, source);
  expect([original, flipped]).not.toContain(fresh);
  const after = await buildStylePreferenceEvidence(f.owner, f.selection, "mild");
  expect(after.preferenceRows.map(row => [row.id, row.action, row.learningDisposition])).toEqual([[fresh, "accepted", "normal"]]);
  expect(after.interactionCountAtRequest).toBe(1);
  expect((await postInteraction(request({ kind: "learning_disposition", reactionId: original, operationId: randomUUID(),
    expectedDispositionRevision: 1, learningDisposition: "exception" }), deps(f.owner))).status).toBe(404);
  expect((await buildStylePreferenceEvidence(f.owner, f.selection, "mild")).preferenceRows).toEqual(after.preferenceRows);
});

it.each(["profile version", "situation identity", "situation version", "weather"] as const)(
  "a newer identical composition in another %s cannot suppress matching evidence or leak affinity", async axis => {
    const f = await namedOwner(), source = await styledSnapshot(f.owner, f.context);
    const matching = await react(f.owner, source);
    await at(matching, "2026-01-01T00:00:00Z");
    const store = new StyleMemoryStore();
    const other = { ...f.context };
    if (axis === "profile version") {
      await store.mutate(f.owner, { kind: "edit_board", boardId: f.context.boardId, operationId: randomUUID(), expectedRevision: 1,
        rawSource: "tailored", compiled: { ...f.context.compiled, aestheticKeywords: ["tailored"] } });
      other.profileVersion = 2;
      other.compiled = { ...f.context.compiled, aestheticKeywords: ["tailored"] };
    } else if (axis === "situation version") {
      await store.mutate(f.owner, { kind: "edit_routine", routineId: f.context.routineId!, operationId: randomUUID(), expectedRevision: 1, label: "Gym" });
      other.routineVersion = 2; other.routineLabel = "Gym";
    } else if (axis === "situation identity") {
      other.routineId = oid(); other.routineLabel = "Dinner";
      await store.mutate(f.owner, { kind: "create_routine", id: other.routineId, label: "Dinner", operationId: randomUUID(), expectedRevision: 1 });
    } else other.weather = "hot";
    if (axis !== "weather") {
      await store.mutate(f.owner, { kind: "set_learning", boardId: other.boardId, profileVersion: other.profileVersion,
        routineId: other.routineId!, routineVersion: other.routineVersion!, enabled: true,
        operationId: randomUUID(), expectedRevision: 2 });
      other.memoryRevision = 3;
    }
    const repeated = await styledSnapshot(f.owner, other, [source.topId, source.bottomId]);
    const nonmatching = await react(f.owner, repeated, "rejected");
    await at(nonmatching, "2026-01-02T00:00:00Z");
    const result = await buildStylePreferenceEvidence(f.owner, f.selection, "mild", { allowHistoricalVersions: true });
    expect(result.preferenceRows.map(row => [row.id, row.action])).toEqual([[matching, "accepted"]]);
    expect(result.interactionCountAtRequest).toBe(1);
    expect(result.behavioralRows.interactionRows.map(row => row.snapshotId)).toEqual([source.snapshotId]);
    expect(result.behavioralRows.recentSnapshots).toHaveLength(2);
    expect(await OutfitInteraction.countDocuments({ user: f.owner })).toBe(2);
  });
