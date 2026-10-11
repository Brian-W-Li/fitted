import { randomUUID } from "crypto";
import { Types } from "mongoose";
import User from "@/models/User";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import WardrobeItem from "@/models/WardrobeItem";

export async function experienceFixture() {
  const user = await User.create({ authProvider: "firebase", authId: randomUUID(), email: `${randomUUID()}@example.test` });
  const owner = String(user._id);
  const item = await WardrobeItem.create({ user: user._id, name: "Green shirt", clothingType: "top", category: "top", warmth: 5, colors: ["green"], occasions: ["casual"] });
  const secondItem = new Types.ObjectId();
  // Source-query fixtures intentionally use the native collection: generation/schema conformance
  // is covered by its own suite. These tests exercise binding, revision storage and read visibility.
  const snapshotId = new Types.ObjectId();
  await GenerationSnapshot.collection.insertOne({
    _id: snapshotId, user: user._id, occasion: "Class", redacted: false,
    shownCandidateIds: ["c0", "c1"],
    candidates: [
      { candidateId: "c0", items: [{ itemId: String(item._id) }, { itemId: String(secondItem) }] },
      { candidateId: "c1", items: [{ itemId: String(item._id) }] },
      { candidateId: "not-shown", items: [{ itemId: String(item._id) }] },
    ],
    itemSnapshots: [{ itemId: String(item._id), engineVisible: { name: "Green shirt", clothingType: "top", imageUrl: "mongo:synthetic" } }],
  });
  const state = { occurredOn: "2026-10-09", timezone: "America/Los_Angeles", context: { kind: "user", text: "Class" }, outcome: "unknown", compositionStatus: "as_shown" };
  return { owner, itemId: String(item._id), snapshotId, state,
    input: { ...state, experienceId: randomUUID(), operationId: randomUUID(), snapshotId: String(snapshotId), candidateId: "c0" } };
}

export function gate() {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  return { entered, release, block: async () => { enter(); await released; } };
}
export function rendezvous(count: number) {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  return async () => { if (--count === 0) release(); await ready; };
}
