/**
 * export_track2 core — behavioral test over a REAL in-memory mongod (mongoHarness), not a mock db.
 *
 * `scripts/export_track2.mjs` is the M6 training-corpus bridge and jest never collects `scripts/`,
 * so its correctness rode entirely on a live-credential manual round-trip (`track2-export-roundtrip.mjs`).
 * This pins the four load-bearing seams offline, no live creds:
 *   1. REDACTED exclusion — the erasure promise: a deleted friend's rows must never reach the corpus.
 *      A silent regression here is an erasure-promise violation, so it is the headline case.
 *   2. §H61 latest-state collapse per {snapshotId, candidateId} (last event wins; _id tie-break).
 *   3. Image resolution (`/api/images/<id>` + `mongo:<id>` → wardrobeimages.base64; missing → unresolved).
 *   4. Training truth = itemSnapshots[].engineVisible (immutable copy) — survives item deletion.
 * Plus userFilter scoping (the erasure/per-user export path).
 *
 * exportTrack2 takes an injectable `db`, so we pass `mongoose.connection.db` from the harness and
 * insert raw docs directly into the four collections the exporter reads.
 */
import mongoose from "mongoose";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve, join } from "path";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
// The export logic is a CommonJS core so this suite can require the real unit directly (one mongoose
// instance, no ESM transform). export_track2.mjs is the thin CLI wrapper over it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { exportTrack2 } = require("../scripts/exportTrack2Core.cjs") as typeof import("../scripts/exportTrack2Core.cjs");

let harness: MongoHarness;
let db: NonNullable<typeof mongoose.connection.db>;
let outDir: string;

const oid = () => new mongoose.Types.ObjectId();
const readJsonl = (dir: string, file: string): Record<string, unknown>[] => {
  const p = resolve(dir, file);
  if (!existsSync(p)) return [];
  const text = readFileSync(p, "utf8").trim();
  return text ? text.split("\n").map((l) => JSON.parse(l)) : [];
};

/** A minimal but complete non-redacted snapshot with one shown candidate over two items. */
function makeSnapshot(user: mongoose.Types.ObjectId, imageId1: string, imageId2: string) {
  return {
    _id: oid(),
    user,
    occasion: "casual",
    intent: "daily",
    seedDate: "2026-07-18",
    generationIndex: 0,
    generator: { model: "gpt-5.4-mini" },
    itemSnapshots: [
      { itemId: "item1", engineVisible: { name: "Blue Tee", clothingType: "top", colorTags: ["blue"], imageUrl: `/api/images/${imageId1}` } },
      { itemId: "item2", engineVisible: { name: "Jeans", clothingType: "bottom", colorTags: ["indigo"], imageUrl: `mongo:${imageId2}` } },
    ],
    candidates: [{ candidateId: "cand1", template: "casual", items: [{ itemId: "item1", role: "top" }, { itemId: "item2", role: "bottom" }] }],
    shownCandidateIds: ["cand1"],
  };
}

beforeAll(async () => {
  // No Mongoose models needed — the exporter reads raw collections; boot bare mongod.
  harness = await startMemoryMongo([]);
  db = mongoose.connection.db!;
});
afterAll(async () => {
  await harness.stop();
});
beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), "track2-export-"));
});
afterEach(async () => {
  // We insert into raw driver collections (no Mongoose models registered), which harness.clear()
  // — it iterates mongoose.connection.collections — cannot see. Clear them at the driver level.
  await Promise.all(
    ["generationsnapshots", "wardrobeitems", "outfitinteractions", "wardrobeimages"].map((c) => db.collection(c).deleteMany({})),
  );
  rmSync(outDir, { recursive: true, force: true });
});

describe("exportTrack2 — redacted exclusion (erasure promise)", () => {
  it("omits a redacted snapshot from every emitted artifact", async () => {
    const user = oid();
    const kept = makeSnapshot(user, oid().toString(), oid().toString());
    const redacted = { ...makeSnapshot(user, oid().toString(), oid().toString()), _id: oid(), redacted: true };
    await db.collection("generationsnapshots").insertMany([kept, redacted]);

    const manifest = await exportTrack2({ db, outDir, userFilter: null });

    // Only the non-redacted snapshot survives — in the count, the file, and the training rows.
    expect(manifest.counts.snapshots).toBe(1);
    expect(manifest.schemaNotes.redactedExcluded).toBe(true);
    const snapIds = readJsonl(outDir, "snapshots.jsonl").map((s) => String(s._id));
    expect(snapIds).toEqual([String(kept._id)]);
    expect(snapIds).not.toContain(String(redacted._id));
    const trainIds = readJsonl(outDir, "training_examples.jsonl").map((t) => t.snapshotId);
    expect(trainIds).not.toContain(String(redacted._id));
    expect(trainIds).toContain(String(kept._id));
  });
});

describe("exportTrack2 — §H61 latest-state collapse", () => {
  it("collapses repeated feedback to the last event and labels the training row with it", async () => {
    const user = oid();
    const snap = makeSnapshot(user, oid().toString(), oid().toString());
    await db.collection("generationsnapshots").insertOne(snap);
    const sid = snap._id;
    // rejected(t1) → rejected(t2) → accepted(t3): last event wins. Endpoints DIFFER on purpose, so a
    // keep-first / dropped-time-comparison regression would yield "rejected" and fail the assertion.
    await db.collection("outfitinteractions").insertMany([
      { _id: oid(), snapshotId: sid, candidateId: "cand1", action: "rejected", createdAt: new Date("2026-07-18T10:00:00Z") },
      { _id: oid(), snapshotId: sid, candidateId: "cand1", action: "rejected", createdAt: new Date("2026-07-18T10:01:00Z") },
      { _id: oid(), snapshotId: sid, candidateId: "cand1", action: "accepted", createdAt: new Date("2026-07-18T10:02:00Z") },
    ]);

    const manifest = await exportTrack2({ db, outDir, userFilter: null });

    expect(manifest.counts.interactionsRaw).toBe(3);
    expect(manifest.counts.interactionsLatest).toBe(1);
    const latest = readJsonl(outDir, "interactions_latest.jsonl");
    expect(latest).toHaveLength(1);
    expect(latest[0].action).toBe("accepted");
    const train = readJsonl(outDir, "training_examples.jsonl");
    expect(train).toHaveLength(1);
    expect(train[0].label).toBe("accepted");
  });

  it("breaks a createdAt tie by higher _id", async () => {
    const user = oid();
    const snap = makeSnapshot(user, oid().toString(), oid().toString());
    await db.collection("generationsnapshots").insertOne(snap);
    const sameTime = new Date("2026-07-18T10:00:00Z");
    // lo < hi as 24-hex strings. Insert lo (rejected) FIRST so natural iteration sees it first: now
    // "first-seen" (rejected) and "higher _id" (accepted) DISAGREE, so dropping the `_id` tie-break
    // clause flips the winner to rejected and fails the assertion.
    const lo = new mongoose.Types.ObjectId("000000000000000000000001");
    const hi = new mongoose.Types.ObjectId("ffffffffffffffffffffffff");
    await db.collection("outfitinteractions").insertMany([
      { _id: lo, snapshotId: snap._id, candidateId: "cand1", action: "rejected", createdAt: sameTime },
      { _id: hi, snapshotId: snap._id, candidateId: "cand1", action: "accepted", createdAt: sameTime },
    ]);

    await exportTrack2({ db, outDir, userFilter: null });
    const latest = readJsonl(outDir, "interactions_latest.jsonl");
    expect(latest).toHaveLength(1);
    expect(latest[0].action).toBe("accepted"); // higher _id wins the tie
  });
});

describe("exportTrack2 — image resolution", () => {
  it("resolves a referenced image, records a missing one as unresolved, writes the blob", async () => {
    const user = oid();
    const imageId1 = oid().toString(); // resolvable
    const imageId2 = oid().toString(); // referenced but absent
    const snap = makeSnapshot(user, imageId1, imageId2);
    await db.collection("generationsnapshots").insertOne(snap);
    const bytes = Buffer.from("fake-png-bytes");
    await db.collection("wardrobeimages").insertOne({
      _id: new mongoose.Types.ObjectId(imageId1),
      base64: bytes.toString("base64"),
      contentType: "image/png",
      sizeBytes: bytes.length,
    });

    const manifest = await exportTrack2({ db, outDir, userFilter: null });

    expect(manifest.counts.imagesReferenced).toBe(2);
    expect(manifest.counts.imagesResolved).toBe(1);
    expect(manifest.counts.imagesUnresolved).toBe(1);
    expect(manifest.imageManifest[imageId1].status).toBe("resolved");
    expect(manifest.imageManifest[imageId2].status).toBe("unresolved");
    // The resolved blob is written and byte-faithful.
    const file = manifest.imageManifest[imageId1].file;
    expect(file).toBeDefined();
    const written = readFileSync(resolve(outDir, file!));
    expect(written.equals(bytes)).toBe(true);
    // The training row reflects per-item resolution status.
    const train = readJsonl(outDir, "training_examples.jsonl");
    const items = train[0].items as Array<{ itemId: string; imageStatus: string }>;
    expect(items.find((i) => i.itemId === "item1")?.imageStatus).toBe("resolved");
    expect(items.find((i) => i.itemId === "item2")?.imageStatus).toBe("unresolved");
  });
});

describe("exportTrack2 — training truth is the immutable engineVisible copy", () => {
  it("emits item features from itemSnapshots even when the live WardrobeItem is gone", async () => {
    const user = oid();
    const snap = makeSnapshot(user, oid().toString(), oid().toString());
    await db.collection("generationsnapshots").insertOne(snap);
    // Deliberately insert NO wardrobeitems — the item was deleted after render.

    await exportTrack2({ db, outDir, userFilter: null });

    const train = readJsonl(outDir, "training_examples.jsonl");
    const items = train[0].items as Array<{ itemId: string; name: string; clothingType: string }>;
    expect(items.find((i) => i.itemId === "item1")?.name).toBe("Blue Tee");
    expect(items.find((i) => i.itemId === "item1")?.clothingType).toBe("top");
    expect(items.find((i) => i.itemId === "item2")?.name).toBe("Jeans");
  });
});

describe("exportTrack2 — userFilter scoping", () => {
  it("exports only the filtered user's rows", async () => {
    const userA = oid();
    const userB = oid();
    const snapA = makeSnapshot(userA, oid().toString(), oid().toString());
    const snapB = makeSnapshot(userB, oid().toString(), oid().toString());
    await db.collection("generationsnapshots").insertMany([snapA, snapB]);
    // Give userB a wardrobe item + an interaction too — the scoping must hold across ALL row
    // collections, not just snapshots (a leak of another user's rows would violate per-user export).
    await db.collection("wardrobeitems").insertMany([
      { _id: oid(), user: userA, name: "A shirt" },
      { _id: oid(), user: userB, name: "B shirt" },
    ]);
    await db.collection("outfitinteractions").insertMany([
      { _id: oid(), user: userA, snapshotId: snapA._id, candidateId: "cand1", action: "accepted", createdAt: new Date("2026-07-18T10:00:00Z") },
      { _id: oid(), user: userB, snapshotId: snapB._id, candidateId: "cand1", action: "accepted", createdAt: new Date("2026-07-18T10:00:00Z") },
    ]);

    const manifest = await exportTrack2({ db, outDir, userFilter: userA });

    expect(manifest.counts.snapshots).toBe(1);
    expect(manifest.counts.wardrobeItems).toBe(1);
    expect(manifest.counts.interactionsRaw).toBe(1);
    expect(String(manifest.userFilter)).toBe(String(userA));
    const snapIds = readJsonl(outDir, "snapshots.jsonl").map((s) => String(s._id));
    expect(snapIds).toEqual([String(snapA._id)]);
    // userB's rows are absent from every scoped collection.
    expect(readJsonl(outDir, "wardrobe.jsonl").map((w) => String(w.user))).toEqual([String(userA)]);
    expect(readJsonl(outDir, "interactions_raw.jsonl").map((i) => String(i.user))).toEqual([String(userA)]);
  });
});
