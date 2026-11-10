import { randomUUID } from "crypto";
import { Types } from "mongoose";
import type { NextRequest } from "next/server";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import User from "@/models/User";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import OutfitInteraction from "@/models/OutfitInteraction";
import { __resetInteractionRateLimit, deleteInteraction, getInteractions, postInteraction } from "@/lib/interactions";
import { buildBehavioralRows } from "@/lib/mlBehavioralRows";
import { voteEvidenceFilter } from "@/lib/feedbackEvidence.cjs";
import { gate } from "./helpers/experienceFixture";
import { deps, namedOwner, oid, react, request, styledSnapshot } from "./helpers/styleLearningFixture";

let harness: MongoHarness;
beforeAll(async () => { harness = await startMemoryMongo([User, GenerationSnapshot, OutfitInteraction], { replicaSet: true }); }, 120_000);
afterAll(async () => { await harness.stop(); });
afterEach(async () => { await harness.clear(); __resetInteractionRateLimit(); });
const revision = async (owner: string) => (await User.collection.findOne({ _id: new Types.ObjectId(owner) }, { projection: { styleMemoryRevision: 1 } }))?.styleMemoryRevision;
const history = async (owner: string) => (await (await getInteractions({ url: "http://localhost/api/interactions" } as NextRequest, deps(owner))).json()).interactions;
const disposition = (reactionId: string, expectedDispositionRevision: number, learningDisposition = "exception") =>
  ({ kind: "learning_disposition", reactionId, operationId: randomUUID(), expectedDispositionRevision, learningDisposition });

it("records captured opt-in plain votes as normal and never counts eligibility amendments as votes", async () => {
  const f = await namedOwner(), source = await styledSnapshot(f.owner, f.context);
  const reactionId = await react(f.owner, source);
  expect(await revision(f.owner)).toBe(1);
  expect((await history(f.owner))[0]).toMatchObject({ id: reactionId, learningAvailable: true, learningDisposition: "normal", dispositionRevision: 0 });
  const command = disposition(reactionId, 0);
  expect((await postInteraction(request(command), deps(f.owner))).status).toBe(200);
  expect(await OutfitInteraction.countDocuments({ user: f.owner, ...voteEvidenceFilter })).toBe(1);
  expect((await history(f.owner))).toHaveLength(1);
  expect((await history(f.owner))[0]).toMatchObject({ id: reactionId, action: "accepted", learningDisposition: "exception", dispositionRevision: 1 });
  expect(await revision(f.owner)).toBe(2);
  expect((await buildBehavioralRows(f.owner, { OutfitInteraction, GenerationSnapshot })).interactionRows).toHaveLength(1);
});

it("atomically marks a scoped reservation exceptional without changing accepted-item affinity; clear stays exceptional", async () => {
  const f = await namedOwner(), source = await styledSnapshot(f.owner, f.context), reactionId = await react(f.owner, source);
  const before = await buildBehavioralRows(f.owner, { OutfitInteraction, GenerationSnapshot });
  const note = { kind: "reason_amendment", reactionId, operationId: randomUUID(), feedbackReason: { scope: "item", concern: "fit", itemId: source.topId, rawText: "Sleeves bother me" } };
  expect((await postInteraction(request(note), deps(f.owner))).status).toBe(200);
  expect(await OutfitInteraction.countDocuments({ user: f.owner })).toBe(3);
  expect(await revision(f.owner)).toBe(2);
  expect(await buildBehavioralRows(f.owner, { OutfitInteraction, GenerationSnapshot })).toEqual(before);
  expect((await history(f.owner))[0]).toMatchObject({ action: "accepted", learningDisposition: "exception", dispositionRevision: 1 });
  expect((await postInteraction(request(note), deps(f.owner))).status).toBe(200);
  expect(await revision(f.owner)).toBe(2);
  expect(await OutfitInteraction.countDocuments({ user: f.owner })).toBe(3);
  expect((await postInteraction(request({ kind: "reason_amendment", reactionId, operationId: randomUUID() }), deps(f.owner))).status).toBe(200);
  expect((await history(f.owner))[0]).toMatchObject({ learningDisposition: "exception", dispositionRevision: 2 });
  expect((await history(f.owner))[0]).not.toHaveProperty("feedbackReason");
  expect(await revision(f.owner)).toBe(3);
});

it("recovers a lost disposition acknowledgment exactly once and rejects a conflicting or stale operation", async () => {
  const f = await namedOwner(), source = await styledSnapshot(f.owner, f.context), reactionId = await react(f.owner, source);
  const command = disposition(reactionId, 0);
  const quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect((await postInteraction(request(command), { ...deps(f.owner), afterNativeWrite: async () => { throw new Error("lost receipt"); } })).status).toBe(500);
  } finally { quiet.mockRestore(); }
  expect(await revision(f.owner)).toBe(2);
  expect((await postInteraction(request(command), deps(f.owner))).status).toBe(200);
  expect(await revision(f.owner)).toBe(2);
  expect(await OutfitInteraction.countDocuments({ user: f.owner })).toBe(2);
  expect((await postInteraction(request({ ...command, learningDisposition: "normal" }), deps(f.owner))).status).toBe(409);
  expect((await postInteraction(request(disposition(reactionId, 0, "normal")), deps(f.owner))).status).toBe(409);
  expect((await postInteraction(request(disposition(reactionId, 1, "normal")), deps(f.owner))).status).toBe(200);
  expect((await history(f.owner))[0]).toMatchObject({ learningDisposition: "normal", dispositionRevision: 2 });
});

it("a concurrent new concern defeats delayed inclusion, while a flip starts a fresh vote identity", async () => {
  const f = await namedOwner(), source = await styledSnapshot(f.owner, f.context), reactionId = await react(f.owner, source);
  const pause = gate();
  const delayed = postInteraction(request(disposition(reactionId, 0, "normal")), { ...deps(f.owner), beforeWrite: () => pause.block() });
  await pause.entered;
  try { expect((await postInteraction(request({ kind: "reason_amendment", reactionId, operationId: randomUUID(), feedbackReason: { scope: "request", concern: "formality" } }), deps(f.owner))).status).toBe(200); }
  finally { pause.release(); }
  expect((await delayed).status).toBe(409);
  const flippedId = await react(f.owner, source, "rejected");
  expect(flippedId).not.toBe(reactionId);
  expect((await history(f.owner))[0]).toMatchObject({ id: flippedId, action: "rejected", learningDisposition: "normal", dispositionRevision: 0 });
  expect((await postInteraction(request(disposition(reactionId, 1, "normal")), deps(f.owner))).status).toBe(409);
});

it("removal and account fencing defeat delayed learning edits, and foreign owners cannot target another reaction", async () => {
  const f = await namedOwner(), source = await styledSnapshot(f.owner, f.context), reactionId = await react(f.owner, source), command = disposition(reactionId, 0);
  expect((await postInteraction(request(command), deps(oid()))).status).toBe(404);
  const pause = gate(); const delayed = postInteraction(request(command), { ...deps(f.owner), beforeWrite: () => pause.block() });
  await pause.entered;
  try { expect((await deleteInteraction({ url: `http://localhost/api/interactions?snapshotId=${source.snapshotId}&candidateId=${source.candidateId}` } as NextRequest, deps(f.owner))).status).toBe(200); }
  finally { pause.release(); }
  expect((await delayed).status).toBe(404);
  expect(await OutfitInteraction.countDocuments({ user: f.owner })).toBe(0);
  const next = await react(f.owner, source);
  await User.updateOne({ _id: f.owner }, { $set: { erasureStarted: true } });
  expect((await postInteraction(request(disposition(next, 0)), deps(f.owner))).status).toBe(401);
});

it("does not enroll an originally opted-out reaction and reserves room for the complete reason/disposition pair", async () => {
  const f = await namedOwner(), optedOut = await styledSnapshot(f.owner, { ...f.context, learningEnabled: false }), old = await react(f.owner, optedOut);
  expect((await postInteraction(request(disposition(old, 0, "normal")), deps(f.owner))).status).toBe(409);
  const source = await styledSnapshot(f.owner, f.context), current = await react(f.owner, source);
  await OutfitInteraction.collection.insertMany(Array.from({ length: 1997 }, () => ({ user: new Types.ObjectId(f.owner), eventKind: "reason_amendment" })));
  const oldRevision = await revision(f.owner);
  expect((await postInteraction(request({ kind: "reason_amendment", reactionId: current, operationId: randomUUID(), feedbackReason: { scope: "request", concern: "style" } }), deps(f.owner))).status).toBe(400);
  expect(await OutfitInteraction.countDocuments({ user: f.owner })).toBe(1999);
  expect(await revision(f.owner)).toBe(oldRevision);
});
