/**
 * Track 2 erasure gate — prove the deletion promise against the LIVE Atlas, observed not asserted.
 * For a given test persona: read row counts across ALL owned collections BEFORE, call the real
 * DELETE /api/account, then re-read AFTER and confirm every count is zero. This is the
 * throwaway-account erasure check the runbook §8 owed.
 *
 *   TRACK2_LIVE_OK=1 node scripts/track2-erasure-check.mjs <persona-slug>
 *
 * Reads Atlas via MONGODB_URI_ATLAS from .env.local (read-only counts; the delete goes through the
 * app route, exactly as a friend's browser would).
 */
import { createRequire } from "module";
import { mintIdToken, api, testIdentity, requireLiveOk, adminAuth } from "./track2-live.mjs";

const require = createRequire(import.meta.url);
const mongoose = require("mongoose");

const COLLECTIONS = ["users", "wardrobeitems", "wardrobeimages", "generationsnapshots", "outfitinteractions"];

async function countsFor(db, userId) {
  const out = {};
  for (const c of COLLECTIONS) {
    const filter = c === "users" ? { _id: userId } : { user: userId };
    out[c] = await db.collection(c).countDocuments(filter);
  }
  return out;
}

async function main() {
  requireLiveOk();
  const slug = process.argv[2];
  if (!slug) {
    console.error("usage: node scripts/track2-erasure-check.mjs <persona-slug>");
    process.exit(1);
  }
  const { uid, email } = testIdentity(slug.replace(/-/g, ""));
  const atlasUri = process.env.MONGODB_URI_ATLAS;
  if (!atlasUri) throw new Error("MONGODB_URI_ATLAS missing from .env.local");

  await mongoose.connect(atlasUri);
  const db = mongoose.connection.db;
  const userDoc = await db.collection("users").findOne({ authProvider: "firebase", authId: uid });
  if (!userDoc) {
    console.log(`No live user for ${uid} — nothing to erase (already clean or never seeded).`);
    await mongoose.disconnect();
    process.exit(0);
  }
  const userId = userDoc._id;
  console.log(`Persona ${slug} → user ${userId}`);

  const before = await countsFor(db, userId);
  console.log("\nBEFORE delete:");
  for (const c of COLLECTIONS) console.log(`  ${c.padEnd(20)} ${before[c]}`);
  const totalBefore = Object.values(before).reduce((a, b) => a + b, 0);

  console.log("\nCalling DELETE /api/account (through the app, as the friend would) …");
  const token = await mintIdToken(uid, email);
  const del = await api("DELETE", "/api/account", { token });
  console.log(`  → ${del.status} ${JSON.stringify(del.body)}`);

  // brief settle for the phase-3 sweep
  const after = await countsFor(db, userId);
  console.log("\nAFTER delete:");
  let allZero = true;
  for (const c of COLLECTIONS) {
    console.log(`  ${c.padEnd(20)} ${after[c]}`);
    if (after[c] !== 0) allZero = false;
  }

  // Firebase auth binding should be gone too (the route calls adminAuth.deleteUser).
  let authGone = false;
  try {
    await adminAuth().getUser(uid);
  } catch {
    authGone = true;
  }

  console.log("\n─────────────────────────────────────");
  console.log(`Rows before: ${totalBefore}  |  rows after: ${Object.values(after).reduce((a, b) => a + b, 0)}`);
  console.log(`All owned collections zero after delete: ${allZero ? "✅ YES" : "❌ NO"}`);
  console.log(`Firebase auth binding erased: ${authGone ? "✅ YES" : "❌ NO (residual auth user)"}`);
  console.log(
    allZero && authGone
      ? "\n✅ ERASURE GATE PASSED — the deletion promise holds, observed live."
      : "\n❌ ERASURE GATE FAILED — investigate residual rows.",
  );

  await mongoose.disconnect();
  process.exit(allZero && authGone ? 0 : 1);
}

main().catch(async (err) => {
  console.error("❌", err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
