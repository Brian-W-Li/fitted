/**
 * M4 (C1) — wipe the legacy collections for the data-model migration.
 *
 * The deployed Vercel app runs the TEAM repo, not this fork, so there are no real
 * users to protect on this fork's own DB. M4 drops the legacy collections clean
 * rather than running a backfill (docs/plans/m4-data-model-migration.md §14, decision #5).
 *
 * Wipes: wardrobeitems, outfitinteractions, preferencesummaries.
 *
 * Run:  npx tsx scripts/wipe-db.ts --yes-wipe
 *
 * SAFETY (triple-gate — the reused CS148 .env.local may point MONGODB_URI at the
 * SHARED team Atlas cluster; a careless run there nukes the team's data):
 *   (a) the --yes-wipe flag is required;
 *   (b) the URI must match a localhost / fitted-dev allowlist, OR FITTED_ALLOW_WIPE=1 must be set;
 *   (c) the target host + db + per-collection counts are printed and the DB name must be typed back.
 *
 * Idempotent: deleteMany({}) on an already-empty/absent collection is a no-op.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import readline from "readline";
import mongoose from "mongoose";
import { parseMongoUri, isWipeAllowed } from "@/lib/wipeGuard";

const WIPE_COLLECTIONS = ["wardrobeitems", "outfitinteractions", "preferencesummaries"];

// --- Load .env.local (same pattern as scripts/test-db.ts) ---
function loadEnvLocal() {
  const envPath = resolve(__dirname, "../.env.local");
  try {
    const envFile = readFileSync(envPath, "utf8");
    for (const line of envFile.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    console.warn("⚠️  Could not load .env.local; relying on existing env vars.");
  }
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (a) => { rl.close(); res(a); }));
}

async function main() {
  loadEnvLocal();

  // Gate (a): explicit flag.
  if (!process.argv.includes("--yes-wipe")) {
    console.error("Refusing to wipe: pass --yes-wipe to confirm intent.");
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("Missing MONGODB_URI (set it in .env.local or the environment).");
    process.exit(1);
  }

  const { host } = parseMongoUri(uri);

  // Gate (b): host allowlist (label boundary, or FITTED_ALLOW_WIPE=1). See lib/wipeGuard —
  // the db name is intentionally NOT consulted, so a `fitted-dev`-named db on the shared
  // team Atlas host cannot authorize a wipe.
  if (!isWipeAllowed(host)) {
    console.error(
      `Refusing to wipe: MONGODB_URI host "${host}" is not on the localhost/fitted-dev allowlist.\n` +
        `If this really is a throwaway dev DB, re-run with FITTED_ALLOW_WIPE=1.`,
    );
    process.exit(1);
  }

  console.log("🔌 Connecting to MongoDB...");
  await mongoose.connect(uri, { maxPoolSize: 5 });
  const db = mongoose.connection.db;
  if (!db) {
    console.error("No database handle after connect — aborting.");
    process.exit(1);
  }
  // Confirm against the ACTUALLY-connected db, not the URI-parsed path: a URI with no
  // path connects to Mongo's default db, so the parsed name could differ from reality.
  const connectedDbName = db.databaseName;

  console.log(`\n🎯 Target host : ${host}`);
  console.log(`🎯 Target db   : ${connectedDbName}`);
  console.log("📊 Collections to wipe (current doc counts):");
  for (const name of WIPE_COLLECTIONS) {
    const count = await db.collection(name).countDocuments();
    console.log(`     ${name.padEnd(20)} ${count}`);
  }

  // Gate (c): type the (real, connected) DB name back.
  const answer = await ask(`\nType the db name "${connectedDbName}" to confirm the wipe: `);
  if (answer.trim() !== connectedDbName) {
    console.error("Confirmation did not match — aborting, nothing wiped.");
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log("\n🗑️  Wiping...");
  for (const name of WIPE_COLLECTIONS) {
    const { deletedCount } = await db.collection(name).deleteMany({});
    console.log(`     ${name.padEnd(20)} cleared (${deletedCount} removed)`);
  }

  await mongoose.disconnect();
  console.log("\n✅ Wipe complete.");
  process.exit(0);
}

main().catch(async (err) => {
  console.error("❌ Wipe failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
