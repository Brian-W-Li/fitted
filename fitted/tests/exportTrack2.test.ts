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
const { exportTrack2, buildCertificate, CERTIFICATE } = require("../scripts/exportTrack2Core.cjs") as typeof import("../scripts/exportTrack2Core.cjs");

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

describe("buildCertificate — scoreable-cluster certificate (the prereg decidability gate)", () => {
  // A training-example row in the shape exportTrack2 emits. Images default resolved.
  type Item = { itemId: string; clothingType?: string | null; imageStatus?: string };
  const te = (user: string, label: "accepted" | "rejected" | null, items: Item[]) => ({
    user, label, items: items.map((i) => ({ imageStatus: "resolved", ...i })),
  });
  const pair = (a: string, b: string): Item[] => [
    { itemId: a, clothingType: "top" }, { itemId: b, clothingType: "bottom" },
  ];

  it("excludes singletons and unresolved-image outfits from the scoreable count", async () => {
    const rows = [
      te("u", "accepted", pair("t1", "b1")), // scoreable
      te("u", "accepted", [{ itemId: "solo", clothingType: "top" }]), // 1 item → not pairwise-sized
      te("u", "accepted", [{ itemId: "t2", clothingType: "top" }, { itemId: "b2", clothingType: "bottom", imageStatus: "unresolved" }]), // image gap
    ];
    const cert = buildCertificate(rows);
    expect(cert.scoreableClusters.acceptedScoreable).toBe(1);
  });

  it("dedups re-rolled identical item sets within an arm (lineage inflation guard)", async () => {
    const rows = [
      te("u", "accepted", pair("t1", "b1")),
      te("u", "accepted", pair("b1", "t1")), // same set, different order → one signature
      te("u", "accepted", pair("t1", "b1")), // exact re-roll → still one
    ];
    expect(buildCertificate(rows).scoreableClusters.acceptedScoreable).toBe(1);
  });

  it("counts transfer-scoreable only when a same-category negative exists; primary is NOT so filtered", async () => {
    // Depth-1 world: each clothingType appears once → no corrupted negative constructible.
    const depth1 = [te("u", "accepted", [{ itemId: "t1", clothingType: "top" }, { itemId: "b1", clothingType: "bottom" }])];
    const c1 = buildCertificate(depth1);
    expect(c1.scoreableClusters.acceptedScoreable).toBe(1); // primary does NOT require a negative
    expect(c1.scoreableClusters.transferAcceptedScoreable).toBe(0); // transfer does

    // Add a 2nd top + 2nd bottom → top/bottom now depth 2 → the outfit gains a negative.
    const depth2 = [...depth1, te("u", "accepted", pair("t2", "b2"))];
    const c2 = buildCertificate(depth2);
    expect(c2.scoreableClusters.transferAcceptedScoreable).toBe(2);
  });

  it("verdict is UNDERPOWERED below 25/arm and DECIDABLE at ≥25 both arms with the concentration cap met", async () => {
    const rows = [];
    // Two friends, 13 distinct accepted + 13 distinct rejected each = 26/arm, max share 0.5 (== cap → OK).
    for (const u of ["a", "b"]) {
      for (let i = 0; i < 13; i++) rows.push(te(u, "accepted", pair(`${u}-ta-${i}`, `${u}-ba-${i}`)));
      for (let i = 0; i < 13; i++) rows.push(te(u, "rejected", pair(`${u}-tr-${i}`, `${u}-br-${i}`)));
    }
    const cert = buildCertificate(rows);
    expect(cert.scoreableClusters.acceptedScoreable).toBe(26);
    expect(cert.scoreableClusters.rejectedScoreable).toBe(26);
    expect(cert.concentration.capOk).toBe(true);
    expect(cert.primaryRead.verdict).toBe("DECIDABLE");

    // One fewer accepted arm → drops below 25 → UNDERPOWERED.
    const thin = buildCertificate(rows.filter((_r, idx) => idx > 1)); // remove 2 accepted rows
    expect(thin.scoreableClusters.acceptedScoreable).toBeLessThan(CERTIFICATE.primaryDecisionMinPerArm);
    expect(thin.primaryRead.verdict).toBe("UNDERPOWERED (keep collecting)");
  });

  it("a single-friend cohort fails the concentration cap even with counts ≥25/arm", async () => {
    const rows = [];
    for (let i = 0; i < 26; i++) rows.push(te("solo", "accepted", pair(`ta-${i}`, `ba-${i}`)));
    for (let i = 0; i < 26; i++) rows.push(te("solo", "rejected", pair(`tr-${i}`, `br-${i}`)));
    const cert = buildCertificate(rows);
    expect(cert.scoreableClusters.acceptedScoreable).toBe(26);
    expect(cert.concentration.acceptedMaxShare).toBe(1); // one friend is the whole arm
    expect(cert.concentration.capOk).toBe(false);
    expect(cert.primaryRead.verdict).toBe("UNDERPOWERED (keep collecting)");
  });

  it("CERTIFICATE floors byte-equal the frozen preregistration.json (cross-runtime pin)", async () => {
    // The prereg (ml-system/experiments/track2_transfer/preregistration.json) is the frozen home;
    // this JS CERTIFICATE is the live consumer. They MUST agree — a silent floor drift here would
    // change the decidability gate without touching the freeze. (pytest test_preregistration.py pins
    // the same equality from the Python side.)
    const prereg = JSON.parse(
      readFileSync(resolve(__dirname, "../../ml-system/experiments/track2_transfer/preregistration.json"), "utf8"),
    );
    const ec = prereg.export_certificate as Record<string, number>;
    for (const k of Object.keys(CERTIFICATE) as (keyof typeof CERTIFICATE)[]) {
      expect(CERTIFICATE[k]).toBe(ec[k]);
    }
  });

  it("transfer read state ladders <12 report-only → 12–24 suggestive → ≥25 decidable", async () => {
    const mk = (n: number) => {
      const rows = [];
      for (let i = 0; i < n; i++) rows.push(te("u", "accepted", pair(`t${i}`, `b${i}`))); // all depth≥2 once n≥2
      return buildCertificate(rows).transferRead.state;
    };
    expect(mk(8)).toMatch(/REPORT-ONLY/);
    expect(mk(20)).toMatch(/SUGGESTIVE/);
    expect(mk(30)).toMatch(/DECIDABLE/);
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
