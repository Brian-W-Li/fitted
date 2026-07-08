/**
 * M5 behavioral-rows projection (C5 seam #4) — BEHAVIORAL, across TWO real boundaries.
 *
 *   1. Real Mongo: write OutfitInteraction + GenerationSnapshot rows to an in-memory mongod, run
 *      the bounded fetch + projection, and assert the sort/tie-break, the scan bound, and the
 *      ObjectId→hex / Date→ISO serialization on documents read back from the DB.
 *   2. Real cross-runtime: feed the projected rows to the ACTUAL Python reducers
 *      (ml-system/fitted_core/reducers.py) via a subprocess, and assert the observable
 *      personalization signal (item_affinity / liked_full_signatures / cooldown / dislikes /
 *      repetition window). This reddens on a projection↔reducer field-name mismatch on EITHER
 *      side — the drift class (`items` vs `itemIds`) the M5 build hid in a green unit suite.
 *
 * fitted_core imports are stdlib-only, so the subprocess needs no venv (verified at build time).
 */
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { Types } from "mongoose";
import OutfitInteraction from "@/models/OutfitInteraction";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import { buildBehavioralRows, type BehavioralRowsWire } from "@/lib/mlBehavioralRows";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";

const ML_SYSTEM = path.join(__dirname, "../../ml-system");
const CONTRACT = JSON.parse(
  fs.readFileSync(path.join(ML_SYSTEM, "service/contract_fields.json"), "utf8"),
) as { reducerRowReads: Record<string, string[]> };

let harness: MongoHarness;
beforeAll(async () => {
  harness = await startMemoryMongo([OutfitInteraction, GenerationSnapshot]);
}, 120_000);
afterAll(async () => await harness.stop());
afterEach(async () => await harness.clear());

const oid = () => new Types.ObjectId();
// A fresh valid UUIDv4 per call — snapshots for the same user need distinct requestIds now that
// {user, requestId} is uniquely indexed (§G item 2).
let ridCounter = 0;
const freshRequestId = () => `0192f1a0-1c1a-4c3e-9b2a-${(ridCounter++).toString(16).padStart(12, "0")}`;

/** Drive the projected rows through the real Python reducers and return the reduced signal. */
function reduceViaPython(rows: BehavioralRowsWire) {
  const script = `
import json, sys
from fitted_core.reducers import reduce_behavioral_signals
d = json.load(sys.stdin)
sig = reduce_behavioral_signals(d["interactionRows"], d["recentSnapshots"])
print(json.dumps({
  "item_affinity": dict(sig.item_affinity),
  "liked_full_signatures": sorted(sig.liked_full_signatures),
  "shown_full_signatures": list(sig.shown_full_signatures),
  "recent_disliked_base_keys": list(sig.recent_disliked_base_keys),
  "recent_disliked_item_ids": list(sig.recent_disliked_item_ids),
}))
`;
  const out = execFileSync("python3", ["-c", script], {
    cwd: ML_SYSTEM,
    input: JSON.stringify(rows),
    encoding: "utf8",
  });
  return JSON.parse(out) as {
    item_affinity: Record<string, number>;
    liked_full_signatures: string[];
    shown_full_signatures: string[];
    recent_disliked_base_keys: string[];
    recent_disliked_item_ids: string[];
  };
}

/** A minimal valid GenerationSnapshot with a chosen shown set + createdAt (seam #5 owns the
 *  full validation helper; the schema itself has no shown-set cross-validator). */
function snapshotDoc(user: Types.ObjectId, nSurfaced: number, shownFullSignatures: string[], createdAt: Date) {
  return {
    user,
    sessionId: "u",
    candidateCacheKey: "ck",
    generationIndex: 0,
    requestId: freshRequestId(),
    intent: "daily",
    occasion: "casual",
    weather: "mild",
    wardrobeVersion: 0,
    interactionCountAtRequest: 0,
    fittedCoreVersion: "0.4.0",
    generator: {
      provider: "openai", model: "gpt-5.4-mini", temperature: 0.5, promptVersion: "m5-c1.v1",
      maxCompletionTokens: 2200, apiSurface: "chat_completions", responseFormat: "json_schema_strict",
      reasoningEffort: "none", storeMode: "none", promptCacheRetention: "in_memory", timeoutSeconds: 30, maxRetries: 0,
    },
    rankerConfigVersion: "deadbeef",
    scorer: { kind: "cold_start", available: true },
    itemSnapshots: [], generationAttempts: [], candidates: [],
    shownCandidateIds: shownFullSignatures.map((_, i) => `c${i}`),
    shownFullSignatures,
    nSurfaced,
    spreadCollapsed: false,
    createdAt,
  };
}

// ---------------------------------------------------------------------------
describe("projection emits exactly the reducerRowReads grain (contract_fields.json)", () => {
  it("interactionRow keys == the declared interactionRow reads (the items-vs-itemIds drift guard)", async () => {
    const user = oid();
    await OutfitInteraction.create({
      user,
      items: [oid(), oid()],
      action: "accepted",
      snapshotId: oid(),
      candidateId: "c0",
      baseKey: "top:bottom",
      fullSignature: "top:bottom|shoes=x",
      perItemFeedback: [{ itemId: oid(), disliked: true }],
    });
    const rows = await buildBehavioralRows(user, { OutfitInteraction, GenerationSnapshot });
    const emitted = Object.keys(rows.interactionRows[0]).sort();
    expect(emitted).toEqual([...CONTRACT.reducerRowReads.interactionRow].sort());
    expect(Object.keys(rows.interactionRows[0].perItemFeedback[0]).sort()).toEqual(
      [...CONTRACT.reducerRowReads.perItemFeedback].sort(),
    );
    // snapshotRow grain
    await GenerationSnapshot.create(snapshotDoc(user, 3, ["sig-a"], new Date("2026-07-01T00:00:00Z")));
    const rows2 = await buildBehavioralRows(user, { OutfitInteraction, GenerationSnapshot });
    expect(Object.keys(rows2.recentSnapshots[0]).sort()).toEqual(
      [...CONTRACT.reducerRowReads.snapshotRow].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
describe("real Mongo fetch — sort, tie-break, bound, serialization", () => {
  it("interactions come back most-recent-first with hex ids + ISO dates", async () => {
    const user = oid();
    const snapId = oid();
    const itemA = oid();
    await OutfitInteraction.create({
      user, items: [itemA], action: "accepted", snapshotId: snapId, candidateId: "c1",
      baseKey: "bk", fullSignature: "sig-1", createdAt: new Date("2026-07-01T00:00:00Z"),
    });
    await OutfitInteraction.create({
      user, items: [oid()], action: "rejected", snapshotId: oid(), candidateId: "c2",
      baseKey: "bk2", fullSignature: "sig-2", createdAt: new Date("2026-07-05T00:00:00Z"),
    });
    const rows = await buildBehavioralRows(user, { OutfitInteraction, GenerationSnapshot });
    // most-recent-first
    expect(rows.interactionRows.map((r) => r.fullSignature)).toEqual(["sig-2", "sig-1"]);
    // hex + ISO serialization (not ObjectId/Date objects)
    const accepted = rows.interactionRows[1];
    expect(accepted.snapshotId).toBe(snapId.toHexString());
    expect(accepted.items).toEqual([itemA.toHexString()]);
    expect(accepted.createdAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("recentSnapshots reads only nSurfaced>0", async () => {
    const user = oid();
    await GenerationSnapshot.create(snapshotDoc(user, 0, ["skipme"], new Date("2026-07-02T00:00:00Z")));
    await GenerationSnapshot.create(snapshotDoc(user, 3, ["keep"], new Date("2026-07-03T00:00:00Z")));
    const rows = await buildBehavioralRows(user, { OutfitInteraction, GenerationSnapshot });
    expect(rows.recentSnapshots.map((s) => s.shownFullSignatures)).toEqual([["keep"]]);
  });

  it("is user-scoped — another user's rows never leak in", async () => {
    const me = oid();
    const other = oid();
    await OutfitInteraction.create({
      user: other, items: [oid()], action: "accepted", snapshotId: oid(), candidateId: "c",
      baseKey: "b", fullSignature: "sig-other",
    });
    const rows = await buildBehavioralRows(me, { OutfitInteraction, GenerationSnapshot });
    expect(rows.interactionRows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("cross-runtime — projected rows drive the REAL Python reducers", () => {
  it("an accepted row boosts affinity + likes the signature; a rejected row cools + dislikes", async () => {
    const user = oid();
    const liked1 = oid();
    const liked2 = oid();
    const dislikedItem = oid();
    await OutfitInteraction.create({
      user, items: [liked1, liked2], action: "accepted", snapshotId: oid(), candidateId: "cA",
      baseKey: "bkA", fullSignature: "sig-liked", createdAt: new Date("2026-07-01T00:00:00Z"),
    });
    await OutfitInteraction.create({
      user, items: [oid()], action: "rejected", snapshotId: oid(), candidateId: "cB",
      baseKey: "bkB", fullSignature: "sig-rej",
      perItemFeedback: [{ itemId: dislikedItem, disliked: true }, { itemId: oid(), disliked: false }],
      createdAt: new Date("2026-07-02T00:00:00Z"),
    });
    await GenerationSnapshot.create(snapshotDoc(user, 3, ["shown-sig-1", "shown-sig-2"], new Date("2026-07-02T00:00:00Z")));

    const rows = await buildBehavioralRows(user, { OutfitInteraction, GenerationSnapshot });
    const sig = reduceViaPython(rows);

    // accepted → +1 per item (proves `items` grain crosses correctly), and the signature is liked.
    expect(sig.item_affinity[liked1.toHexString()]).toBe(1);
    expect(sig.item_affinity[liked2.toHexString()]).toBe(1);
    expect(sig.liked_full_signatures).toContain("sig-liked");
    // rejected → baseKey cooled; only the per-item-marked id disliked (not the whole outfit).
    expect(sig.recent_disliked_base_keys).toContain("bkB");
    expect(sig.recent_disliked_item_ids).toEqual([dislikedItem.toHexString()]);
    // repetition window from the shown snapshot.
    expect(sig.shown_full_signatures).toEqual(["shown-sig-1", "shown-sig-2"]);
  });

  it("an unbound (legacy-shaped, no snapshotId) row contributes nothing", async () => {
    const user = oid();
    // No binding fields → all-absent (the pre-validate hook allows all-absent).
    await OutfitInteraction.create({ user, items: [oid()], action: "accepted" });
    const rows = await buildBehavioralRows(user, { OutfitInteraction, GenerationSnapshot });
    const sig = reduceViaPython(rows);
    expect(sig.item_affinity).toEqual({});
    expect(sig.liked_full_signatures).toEqual([]);
  });
});
