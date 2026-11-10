/**
 * M5 feedback boundary — BEHAVIORAL test (C6, §I). Drives the real `postInteraction`/`getInteractions`
 * core over a REAL in-memory Mongo (write → read back) with an injected verified user. Replaces the
 * retired `interactionPersistence.test.ts` (which mock-tested the dead itemIds contract). This is the
 * behavior-first cure: a forged-echo POST is written and READ BACK to prove the persisted row carries
 * the SERVER-DERIVED binding, not the client echo — the exact class a mock test cannot catch.
 *
 * Matrix = the m5-cutover.md §I acceptance list (G8/G10 gates, ownership, append-only, GET scoping,
 * feedbackReason) + the "no PATCH/DELETE handler" append-only invariant.
 */
import { Types } from "mongoose";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import OutfitInteraction from "@/models/OutfitInteraction";
import User, { cascadeDeleteUserData } from "@/models/User";
import {
  postInteraction,
  getInteractions,
  deleteInteraction,
  __resetInteractionRateLimit,
  type InteractionDeps,
} from "@/lib/interactions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let harness: MongoHarness;

beforeAll(async () => {
  harness = await startMemoryMongo([GenerationSnapshot, OutfitInteraction], { replicaSet: true });
}, 120_000);
afterAll(async () => {
  await harness.stop();
});
afterEach(async () => {
  await harness.clear();
  __resetInteractionRateLimit(); // the module-level bucket must not bleed across cases
});

const oid = () => new Types.ObjectId().toHexString();

// A request stub — the injected verifyUser ignores it, so only body/url matter.
function postReq(body: Record<string, unknown>): Any {
  // Reason-rich primary votes are explicit; untyped reason posts are legacy enrichment.
  const command = body;
  return { headers: { get: () => "Bearer x" }, json: async () => command };
}
function getReq(url = "http://localhost/api/interactions"): Any {
  return { headers: { get: () => "Bearer x" }, url };
}
function delReq(snapshotId: string, candidateId: string): Any {
  const qs = `snapshotId=${encodeURIComponent(snapshotId)}&candidateId=${encodeURIComponent(candidateId)}`;
  return { headers: { get: () => "Bearer x" }, url: `http://localhost/api/interactions?${qs}` };
}

function deps(userId: string): InteractionDeps {
  return {
    verifyUser: async () => ({ userId }),
    models: { OutfitInteraction, GenerationSnapshot, User },
  };
}

import { makeSnapshot } from "./helpers/interactionFixture";

import { randomUUID } from "crypto";
import { gate, rendezvous } from "./helpers/experienceFixture";
import { beginUserErasure } from "@/lib/userErasure";
import { buildBehavioralRows } from "@/lib/mlBehavioralRows";
async function rejected() {
  const owner = oid(); const binding = await makeSnapshot(owner);
  const response = await postInteraction(postReq({ ...binding, action: "rejected" }), deps(owner));
  expect(response.status).toBe(200);
  const receipt = await response.json();
  const command = { kind: "reason_amendment", reactionId: receipt.interaction.id, operationId: randomUUID(), feedbackReason: { codes: ["not_me"] } };
  return { owner, ...binding, command };
}
async function history(owner: string) { return (await (await getInteractions(getReq(), deps(owner))).json()).interactions; }
async function rows(owner: string) { return OutfitInteraction.find({ user: owner }).lean(); }

it("retries a committed amendment with a lost acknowledgment without adding votes or rows", async () => {
  const f = await rejected(); let lose = true;
  const delayed = { ...deps(f.owner), afterNativeWrite: async () => { if (lose) { lose = false; throw new Error("lost acknowledgment"); } } };
  expect((await postInteraction(postReq(f.command), delayed)).status).toBe(500);
  expect(await rows(f.owner)).toHaveLength(2);
  const retry = await postInteraction(postReq(f.command), deps(f.owner)); expect(retry.status).toBe(200);
  expect((await retry.json()).amendment.reactionId).toBe(f.command.reactionId);
  expect(await rows(f.owner)).toHaveLength(2);
  expect((await history(f.owner))[0]).toMatchObject({ id: f.command.reactionId, action: "rejected" });
  expect((await postInteraction(postReq({ ...f.command, feedbackReason: { codes: ["wrong_context"] } }), deps(f.owner))).status).toBe(409);
  expect(await rows(f.owner)).toHaveLength(2);
});
it("removal wins a delayed amendment and a retry never recreates the removed reaction", async () => {
  const f = await rejected(); const pause = gate();
  const saving = postInteraction(postReq(f.command), { ...deps(f.owner), beforeWrite: async () => pause.block() });
  try {
    await pause.entered;
    expect((await deleteInteraction(delReq(f.snapshotId, f.candidateId), deps(f.owner))).status).toBe(200);
  } finally { pause.release(); }
  expect((await saving).status).toBe(404);
  expect((await postInteraction(postReq(f.command), deps(f.owner))).status).toBe(404);
  expect(await rows(f.owner)).toHaveLength(0);
});
it("an admitted amendment is included in a subsequently committed removal", async () => {
  const f = await rejected(); const pause = gate();
  const removing = deleteInteraction(delReq(f.snapshotId, f.candidateId), { ...deps(f.owner), beforeWrite: async () => pause.block() });
  try {
    await pause.entered;
    expect((await postInteraction(postReq(f.command), deps(f.owner))).status).toBe(200);
    expect(await rows(f.owner)).toHaveLength(2);
  } finally { pause.release(); }
  expect((await removing).status).toBe(200);
  expect(await rows(f.owner)).toHaveLength(0);
});
it("a correction wins against delayed reasons without changing its vote identity", async () => {
  const f = await rejected(); const pause = gate();
  const saving = postInteraction(postReq(f.command), { ...deps(f.owner), beforeWrite: async () => pause.block() });
  let receipt;
  try {
    await pause.entered;
    const flipped = await postInteraction(postReq({ snapshotId: f.snapshotId, candidateId: f.candidateId, action: "accepted" }), deps(f.owner));
    expect(flipped.status).toBe(200); receipt = await flipped.json();
  } finally { pause.release(); }
  expect((await saving).status).toBe(409);
  expect((await history(f.owner))[0]).toMatchObject({ id: receipt.interaction.id, action: "accepted" });
  expect(await rows(f.owner)).toHaveLength(2);
});
it("removed and freshly re-reacted feedback cannot be mistaken for the old amendment target", async () => {
  const f = await rejected(); const pause = gate();
  const saving = postInteraction(postReq(f.command), { ...deps(f.owner), beforeWrite: async () => pause.block() });
  let fresh;
  try {
    await pause.entered; await deleteInteraction(delReq(f.snapshotId, f.candidateId), deps(f.owner));
    fresh = await (await postInteraction(postReq({ snapshotId: f.snapshotId, candidateId: f.candidateId, action: "rejected" }), deps(f.owner))).json();
  } finally { pause.release(); }
  expect((await saving).status).toBe(409);
  expect(await rows(f.owner)).toHaveLength(1);
  expect((await postInteraction(postReq(f.command), deps(f.owner))).status).toBe(404);
  expect((await postInteraction(postReq({ ...f.command, reactionId: fresh.interaction.id, operationId: randomUUID() }), deps(f.owner))).status).toBe(200);
});
it("concurrent identical retries admit exactly one amendment", async () => {
  const f = await rejected(); const meet = rendezvous(2);
  const parked = { ...deps(f.owner), beforeWrite: async () => meet() };
  const responses = await Promise.all([postInteraction(postReq(f.command), parked), postInteraction(postReq(f.command), parked)]);
  expect(responses.map(response => response.status)).toEqual([200, 200]);
  expect(await rows(f.owner)).toHaveLength(2);
  const receipts = await Promise.all(responses.map(response => response.json()));
  expect(receipts[0].amendment.id).toBe(receipts[1].amendment.id);
});
it("concurrent conflicting retries cannot replace the first operation payload", async () => {
  const f = await rejected(); const meet = rendezvous(2); const parked = { ...deps(f.owner), beforeWrite: async () => meet() };
  const responses = await Promise.all([postInteraction(postReq(f.command), parked),
    postInteraction(postReq({ ...f.command, feedbackReason: { codes: ["wrong_context"] } }), parked)]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  expect(await rows(f.owner)).toHaveLength(2);
});
it("full reason replacement can clear per-item and structured reasons while preserving vote time", async () => {
  const f = await rejected(); const before = (await rows(f.owner))[0];
  expect((await postInteraction(postReq({ ...f.command, perItemFeedback: [{ itemId: f.topId, disliked: true }] }), deps(f.owner))).status).toBe(200);
  expect((await buildBehavioralRows(f.owner, { OutfitInteraction, GenerationSnapshot })).interactionRows[0].perItemFeedback).toHaveLength(1);
  expect((await postInteraction(postReq({ kind: "reason_amendment", reactionId: f.command.reactionId, operationId: randomUUID() }), deps(f.owner))).status).toBe(200);
  const effective = (await buildBehavioralRows(f.owner, { OutfitInteraction, GenerationSnapshot })).interactionRows;
  expect(effective).toHaveLength(1); expect(effective[0].perItemFeedback).toEqual([]);
  expect(effective[0].createdAt).toBe(before.createdAt!.toISOString());
});
it("lost removal acknowledgment can retry without restoring either votes or amendment content", async () => {
  const f = await rejected(); await postInteraction(postReq(f.command), deps(f.owner));
  const lost = await deleteInteraction(delReq(f.snapshotId, f.candidateId), { ...deps(f.owner), afterNativeWrite: async () => { throw new Error("lost removal acknowledgment"); } });
  expect(lost.status).toBe(500); expect(await rows(f.owner)).toHaveLength(0);
  expect((await deleteInteraction(delReq(f.snapshotId, f.candidateId), deps(f.owner))).status).toBe(404);
  expect((await postInteraction(postReq(f.command), deps(f.owner))).status).toBe(404);
});
it("owner erasure blocks delayed amendments and other owners cannot attach reasons", async () => {
  const f = await rejected(); const other = await rejected();
  expect((await postInteraction(postReq(f.command), deps(other.owner))).status).toBe(404);
  expect((await postInteraction(postReq({ ...f.command, perItemFeedback: [{ itemId: other.topId, disliked: true }] }), deps(f.owner))).status).toBe(400);
  expect((await postInteraction(postReq(f.command), deps(f.owner))).status).toBe(200);
  expect(await rows(f.owner)).toHaveLength(2); // Existing amendment content must be erased too.
  const pause = gate(); const saving = postInteraction(postReq({ ...f.command, operationId: randomUUID() }), { ...deps(f.owner), beforeWrite: async () => pause.block() });
  try { await pause.entered; await beginUserErasure(User, f.owner); await cascadeDeleteUserData(User.db, f.owner); }
  finally { pause.release(); }
  expect((await saving).status).toBe(401); expect(await rows(f.owner)).toHaveLength(0);
  expect(await rows(other.owner)).toHaveLength(1);
});
it("legacy untyped enrichment fails closed while existing reason-rich votes remain unchanged", async () => {
  const f = await rejected();
  const legacy = { snapshotId: f.snapshotId, candidateId: f.candidateId, action: "rejected", feedbackReason: { codes: ["not_me"] } };
  const old = await postInteraction(postReq(legacy), deps(f.owner)); expect(old.status).toBe(409);
  expect((await old.json()).code).toBe("reason_amendment_required");
  const explicit = await postInteraction(postReq({ ...legacy, kind: "reaction" }), deps(f.owner)); expect(explicit.status).toBe(200);
  expect(await rows(f.owner)).toHaveLength(2);
});
it("concurrent reactions cannot exceed the shared ledger budget assumed by bounded reason reads", async () => {
  const f = await rejected(); const original = (await rows(f.owner))[0];
  await OutfitInteraction.collection.insertMany(Array.from({ length: 1998 }, () => ({ ...original, _id: new Types.ObjectId() })));
  const meet = rendezvous(2); const parked = { ...deps(f.owner), beforeWrite: async () => meet() };
  const command = { snapshotId: f.snapshotId, candidateId: f.candidateId, action: "accepted" };
  const results = await Promise.all([postInteraction(postReq(command), parked), postInteraction(postReq(command), parked)]);
  expect(results.map(response => response.status).sort()).toEqual([200, 400]);
  expect(await OutfitInteraction.countDocuments({ user: f.owner })).toBe(2000);
});


it("persists an item-fit reservation on an accepted outfit without changing its vote or affinity", async () => {
  const owner = oid(); const binding = await makeSnapshot(owner, { occasion: "class" });
  const vote = await (await postInteraction(postReq({ ...binding, action: "accepted" }), deps(owner))).json();
  const before = await buildBehavioralRows(owner, { OutfitInteraction, GenerationSnapshot });
  const feedbackReason = { scope: "item", concern: "fit", itemId: binding.topId, rawText: "This shirt is too big for me" };
  const command = { kind: "reason_amendment", reactionId: vote.interaction.id, operationId: randomUUID(), feedbackReason };
  expect((await postInteraction(postReq(command), deps(owner))).status).toBe(200);
  const saved = (await rows(owner)).find((row: Any) => row.eventKind === "reason_amendment") as Any;
  expect(saved.feedbackReason).toMatchObject({ ...feedbackReason, itemId: new Types.ObjectId(binding.topId), source: "user" });
  expect(saved).not.toHaveProperty("action"); expect(saved.perItemFeedback).toBeUndefined();
  expect(await buildBehavioralRows(owner, { OutfitInteraction, GenerationSnapshot })).toEqual(before);
  expect((await history(owner))[0]).toMatchObject({ id: vote.interaction.id, action: "accepted", feedbackReason });
  expect((await postInteraction(postReq({ ...command, operationId: randomUUID(), feedbackReason: undefined, perItemFeedback: [] }), deps(owner))).status).toBe(200);
  expect((await history(owner))[0]).not.toHaveProperty("feedbackReason");
  expect(await buildBehavioralRows(owner, { OutfitInteraction, GenerationSnapshot })).toEqual(before);
});

it("request-scoped formality remains bound to the saved occasion and survives reload without becoming an item dislike", async () => {
  const f = await rejected();
  const feedbackReason = { scope: "request", concern: "formality", rawText: "Too formal for this class" };
  expect((await postInteraction(postReq({ ...f.command, feedbackReason }), deps(f.owner))).status).toBe(200);
  expect((await history(f.owner))[0]).toMatchObject({ occasion: "brunch", feedbackReason });
  const effective = await buildBehavioralRows(f.owner, { OutfitInteraction, GenerationSnapshot });
  expect(effective.interactionRows).toHaveLength(1);
  expect(effective.interactionRows[0].perItemFeedback).toEqual([]);
  expect((await rows(f.owner)).find((row: Any) => row.eventKind === "reason_amendment")).toMatchObject({ context: { occasion: "brunch" } });
});

it.each([
  { scope: "global", concern: "style" },
  { scope: "request", concern: "fit" },
  { scope: "outfit", concern: "fit" },
  { scope: "item", concern: "fit" },
  { scope: "request", concern: "personality" },
  { concern: "fit" },
])("rejects unsupported or ambiguous scope without storing a row: %j", async feedbackReason => {
  const f = await rejected();
  expect((await postInteraction(postReq({ ...f.command, feedbackReason }), deps(f.owner))).status).toBe(400);
  expect(await rows(f.owner)).toHaveLength(1);
});

it("item reasons cannot name another owned outfit's item or a foreign owner's item", async () => {
  const f = await rejected(); const otherOwned = await makeSnapshot(oid()); const foreign = await rejected();
  const template = await GenerationSnapshot.findById(otherOwned.snapshotId).lean();
  await GenerationSnapshot.create({ ...template, _id: new Types.ObjectId(), user: f.owner, requestId: randomUUID() });
  for (const itemId of [otherOwned.topId, foreign.topId]) {
    expect((await postInteraction(postReq({ ...f.command, feedbackReason: { scope: "item", concern: "fit", itemId } }), deps(f.owner))).status).toBe(400);
  }
  expect(await rows(f.owner)).toHaveLength(1);
});

it("scoped declaration on a primary reaction is snapshot-validated and never sets a global scope", async () => {
  const owner = oid(); const binding = await makeSnapshot(owner);
  const feedbackReason = { scope: "outfit", concern: "style", rawText: "These pieces do not work together" };
  const response = await postInteraction(postReq({ kind: "reaction", ...binding, action: "rejected", feedbackReason, scopeTarget: "global" }), deps(owner));
  expect(response.status).toBe(200);
  const [saved] = await rows(owner);
  expect(saved.feedbackReason).toMatchObject(feedbackReason); expect(saved.scopeTarget).toBeUndefined();
  expect((await history(owner))[0].feedbackReason).toEqual(feedbackReason);
});

it("a flipped or removed accepted reaction does not transfer its scoped reservation to the new vote", async () => {
  const owner = oid(); const binding = await makeSnapshot(owner);
  const receipt = await (await postInteraction(postReq({ ...binding, action: "accepted" }), deps(owner))).json();
  const command = { kind: "reason_amendment", reactionId: receipt.interaction.id, operationId: randomUUID(), feedbackReason: { scope: "request", concern: "formality" } };
  expect((await postInteraction(postReq(command), deps(owner))).status).toBe(200);
  expect((await postInteraction(postReq({ ...binding, action: "rejected" }), deps(owner))).status).toBe(200);
  expect((await history(owner))[0]).not.toHaveProperty("feedbackReason");
  expect((await postInteraction(postReq({ ...command, operationId: randomUUID() }), deps(owner))).status).toBe(409);
  await deleteInteraction(delReq(binding.snapshotId, binding.candidateId), deps(owner));
  expect(await rows(owner)).toHaveLength(0);
});

it("accepted reasons reject legacy item-dislike amendments and scoped content cannot be read by another owner", async () => {
  const owner = oid(); const binding = await makeSnapshot(owner);
  const receipt = await (await postInteraction(postReq({ ...binding, action: "accepted" }), deps(owner))).json();
  const command = { kind: "reason_amendment", reactionId: receipt.interaction.id, operationId: randomUUID() };
  expect((await postInteraction(postReq({ ...command, feedbackReason: { codes: ["not_me"] } }), deps(owner))).status).toBe(400);
  expect((await postInteraction(postReq({ ...command, feedbackReason: { scope: "item", concern: "fit", itemId: binding.topId }, perItemFeedback: [{ itemId: binding.topId, disliked: true }] }), deps(owner))).status).toBe(400);
  expect((await postInteraction(postReq({ ...command, feedbackReason: { scope: "request", concern: "other", rawText: "Private note" } }), deps(owner))).status).toBe(200);
  const other = await rejected();
  expect((await history(other.owner)).every((card: Any) => card.feedbackReason?.rawText !== "Private note")).toBe(true);
  await GenerationSnapshot.updateOne({ _id: binding.snapshotId }, { $set: { redacted: true } });
  expect((await history(owner))[0]).not.toHaveProperty("feedbackReason");
});
