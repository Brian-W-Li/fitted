/**
 * export_track2 ROUND-TRIP proof — the acceptance test for the M6 export. Seeds a throwaway user with
 * PHOTOS, renders, likes a shown candidate, then DELETES one wardrobe item that appears in a shown
 * outfit (the D2/REPLACE-1 seam: the item is gone but its snapshot-referenced photo is KEPT), runs the
 * export scoped to that user, reloads the bundle, and reconstructs ONE complete training example —
 * asserting: (a) the deleted item still resolves from itemSnapshots, (b) its image file resolved on
 * disk (D2 join survives item delete), (c) the §H61 latest-state label is present. Then erases.
 *
 *   TRACK2_LIVE_OK=1 node scripts/track2-export-roundtrip.mjs
 */
import { mkdirSync, readFileSync, existsSync, statSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";
import { createRequire } from "module";
import { mintIdToken, api, uploadImage, requireLiveOk, adminAuth } from "./track2-live.mjs";
import { exportTrack2 } from "./export_track2.mjs";

const require = createRequire(import.meta.url);
const mongoose = require("mongoose");
const sharp = require("sharp");

const UID = "track2test_export";
const EMAIL = "track2test_export@example.invalid";
const OUT = resolve("./track2-export-roundtrip");

async function swatch(hex) {
  return sharp({ create: { width: 200, height: 200, channels: 3, background: hex } }).jpeg().toBuffer();
}
function readJsonl(path) {
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
function assert(cond, msg) {
  if (!cond) throw new Error("ROUND-TRIP ASSERT FAILED: " + msg);
  console.log("  ✓ " + msg);
}

async function main() {
  requireLiveOk();
  console.log("Seeding throwaway user with photos …");
  const token = await mintIdToken(UID, EMAIL);
  await api("POST", "/api/auth/sync", { token, body: { displayName: "export roundtrip" } });
  const SEED = [
    { name: "White Cotton Tee", category: "top", hex: "#f5f5f5" },
    { name: "Gray Sweatshirt", category: "top", hex: "#888888" },
    { name: "Blue Jeans", category: "bottom", hex: "#3b6fb5" },
    { name: "Black Chinos", category: "bottom", hex: "#111111" },
    { name: "White Sneakers", category: "footwear", hex: "#eeeeee" },
    { name: "Denim Jacket", category: "top", hex: "#4a6fa5", layerRole: "outer" },
  ];
  const items = [];
  for (const s of SEED) {
    const r = await api("POST", "/api/wardrobe", { token, body: { name: s.name, category: s.category, colors: [s.name.split(" ")[0].toLowerCase()], occasions: ["casual"], ...(s.layerRole ? { layerRole: s.layerRole } : {}) } });
    const id = r.body.item.id;
    await uploadImage(id, await swatch(s.hex), `${id}.jpg`, "image/jpeg", token);
    items.push({ id, name: s.name });
  }
  console.log(`  seeded ${items.length} items with photos`);

  console.log("Rendering + liking a shown candidate …");
  const rec = await api("POST", "/api/recommend", { token, body: { requestId: randomUUID(), occasion: "casual weekend" } });
  const shown = rec.body.shown;
  assert(shown.length > 0, `render returned ${shown.length} shown candidates`);
  // pick a shown candidate that contains a specific item we will delete
  const target = shown.find((c) => c.displayItems.length >= 2) ?? shown[0];
  const like = await api("POST", "/api/interactions", { token, body: { snapshotId: target.snapshotId, candidateId: target.candidateId, action: "accepted" } });
  assert(like.status === 200, `liked candidate (interaction ${like.status})`);
  const deletedItem = target.displayItems[0];
  console.log(`  will delete "${deletedItem.name}" (${deletedItem.itemId}) which is in the liked outfit`);

  console.log("Deleting that item (D2 seam: photo is snapshot-referenced → kept) …");
  const del = await api("DELETE", `/api/wardrobe/${deletedItem.itemId}`, { token });
  assert(del.status === 200, `item delete returned ${del.status}`);

  console.log("Running export scoped to the test user …");
  const atlasUri = process.env.MONGODB_URI_ATLAS;
  await mongoose.connect(atlasUri);
  const db = mongoose.connection.db;
  const u = await db.collection("users").findOne({ authProvider: "firebase", authId: UID });
  mkdirSync(OUT, { recursive: true });
  const manifest = await exportTrack2({ db, outDir: OUT, userFilter: u._id });
  console.log("  export counts:", JSON.stringify(manifest.counts));

  console.log("Reconstructing ONE training example from the reloaded bundle …");
  const examples = readJsonl(resolve(OUT, "training_examples.jsonl"));
  assert(examples.length > 0, `training_examples.jsonl has ${examples.length} rows`);
  const ex = examples.find((e) => e.candidateId === target.candidateId);
  assert(!!ex, "found the liked candidate's training example in the export");
  assert(ex.label === "accepted", `the label is the §H61 latest-state (accepted), got ${ex.label}`);
  const delInExample = ex.items.find((i) => i.itemId === deletedItem.itemId);
  assert(!!delInExample, "the DELETED item still resolves from itemSnapshots (immutable training truth)");
  assert(delInExample.name === deletedItem.name, `deleted item retains its feature-copy name (${delInExample.name})`);
  assert(delInExample.imageStatus === "resolved" && !!delInExample.imageFile, "the DELETED item's photo RESOLVED (D2 keep-referenced-image join survives)");
  const imgPath = resolve(OUT, delInExample.imageFile);
  assert(existsSync(imgPath) && statSync(imgPath).size > 0, `the image blob is a real non-empty file on disk (${delInExample.imageFile})`);
  // every shown item image resolved
  const unresolved = ex.items.filter((i) => i.imageStatus !== "resolved");
  assert(unresolved.length === 0, `all ${ex.items.length} items in the example have resolved images`);

  console.log("\n✅ EXPORT ROUND-TRIP PASSED — a complete training example (outfit + latest-state label + resolvable images, incl. a deleted item's kept photo) reconstructs from the bundle.");

  console.log("\nErasing the test user + verifying the export now sees nothing …");
  const derase = await api("DELETE", "/api/account", { token });
  console.log(`  DELETE /api/account → ${derase.status}`);
  const u2 = await db.collection("users").findOne({ authProvider: "firebase", authId: UID });
  assert(!u2, "user row gone after account delete");
  const postManifest = await exportTrack2({ db, outDir: resolve("./track2-export-postdelete"), userFilter: (await db.collection("users").findOne({ authProvider: "firebase", authId: UID }))?._id ?? new mongoose.Types.ObjectId() });
  assert(postManifest.counts.snapshots === 0 && postManifest.counts.trainingExamples === 0, "export sees ZERO for a deleted user (matches the erasure promise)");
  try { await adminAuth().deleteUser(UID); } catch { /* gone */ }

  await mongoose.disconnect();
  console.log("\n✅ ALL ROUND-TRIP ASSERTIONS PASSED.");
  process.exit(0);
}

main().catch(async (err) => {
  console.error("❌", err.message || err);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  // best-effort cleanup on failure
  try {
    const token = await mintIdToken(UID, EMAIL);
    await api("DELETE", "/api/account", { token });
    await adminAuth().deleteUser(UID);
    console.error("  (cleaned up test user after failure)");
  } catch { /* ignore */ }
  process.exit(1);
});
