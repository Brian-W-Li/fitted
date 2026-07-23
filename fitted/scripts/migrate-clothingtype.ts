/**
 * clothingType slot-correctness migration (C4 — docs/plans/clothingtype-slot-correctness.md §4/§6).
 *
 * The render path reads the STORED `clothingType` verbatim (lib/mlRequestAdapter.ts — it validates,
 * never re-derives), so the C1 classifier fix corrects FUTURE ingestion only. This script is the
 * conversion lever for already-stored rows: it re-derives every wardrobe item through the REAL
 * post-C1 `deriveClothingType` (imported from @/lib/clothingType — never a re-implemented cascade;
 * the mirror-drift ban) and PATCHes the rows whose stored value disagrees.
 *
 * Run (from fitted/):
 *   npx tsx scripts/migrate-clothingtype.ts            # DRY-RUN (default): per-row diff, no writes
 *   npx tsx scripts/migrate-clothingtype.ts --apply    # write the flagged rows ($set clothingType only)
 * A bare run targets whatever MONGODB_URI resolves to (often localhost dev) — for the LIVE Atlas
 * corpus use the runbook §8 recipe, which prefixes MONGODB_URI with the .env.local Atlas value
 * (an env var always beats .env.local here). ALWAYS read the printed host/db before --apply.
 *
 * Safety posture (this touches the LIVE friend corpus):
 *   - dry-run is the default; --apply is the only write gate;
 *   - the connected host + db + row counts are printed before anything else;
 *   - --apply first writes a timestamped JSON backup of every row it is about to change
 *     (id, user, name, stored value) so the change is mechanically reversible — the backup is
 *     gitignored (live friend data; delete it once the run is verified);
 *   - writes `$set: { clothingType }` and nothing else — though Mongoose timestamps still bump
 *     `updatedAt`, so a migrated row surfaces at the top of the friend's wardrobe list (honest
 *     visibility of the correction, noted so nobody chases it as a bug).
 *
 * Ordering trap (plan §6): run this AFTER the C1 web redeploy — on the old deployed classifier a
 * friend's next modal edit would re-derive the row right back (the PATCH route re-derives whenever
 * a taxonomy field is present without an explicit clothingType).
 *
 * ⚠ Forward-compat trap-guard (spec §18/H52): stored≠derived is only interpretable as "stale
 * derivation" while EVERY stored value is machine-derived — true today. The moment the W-track
 * override lands a user-set clothingType (`clothingTypeSource: "user"`), a user correction IS a
 * stored≠derived row, and a re-run of this tool with --apply would revert human corrections to the
 * machine guess. That unit must teach this tool to skip `clothingTypeSource: "user"` rows in the
 * SAME commit, or retire it.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import mongoose from "mongoose";
import { deriveClothingType } from "@/lib/clothingType";
import WardrobeItem from "@/models/WardrobeItem";

// --- Load .env.local (same pattern as scripts/wipe-db.ts / test-db.ts) ---
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

export interface RowDiff {
  id: string;
  user: string;
  name: string;
  category: string;
  subCategory: string;
  layerRole: string;
  stored: string;
  derived: string;
}

export interface WardrobeRowLean {
  _id: { toString(): string };
  user?: { toString(): string } | null;
  name?: string;
  category?: string;
  subCategory?: string;
  layerRole?: string;
  clothingType?: string;
}

/** Pure diff: every row whose stored clothingType disagrees with the REAL post-C1 classifier.
 *  Exported so the behavioral test (tests/migrateClothingType.test.ts) exercises this exact unit. */
export function collectDiffs(rows: WardrobeRowLean[]): RowDiff[] {
  const diffs: RowDiff[] = [];
  for (const r of rows) {
    const derived = deriveClothingType({
      category: r.category,
      subCategory: r.subCategory,
      name: r.name,
      layerRole: r.layerRole,
    });
    const stored = r.clothingType ?? "(unset)";
    if (stored !== derived) {
      diffs.push({
        id: r._id.toString(),
        user: r.user?.toString() ?? "(none)",
        name: r.name ?? "(unnamed)",
        category: r.category ?? "",
        subCategory: r.subCategory ?? "",
        layerRole: r.layerRole ?? "",
        stored,
        derived,
      });
    }
  }
  return diffs;
}

/** Guarded targeted write for one diffed row: `$set clothingType` ONLY, and only if the row still
 *  holds the value the scan diffed against (a friend editing mid-migration must not be clobbered).
 *  Returns true when the row was updated, false when the guard skipped it. */
export async function applyDiff(model: typeof WardrobeItem, d: RowDiff): Promise<boolean> {
  // `{clothingType: null}` matches BOTH a missing field and an explicit null — `$exists:false`
  // would re-flag an explicit-null row forever ("skipped" on every run).
  const filter: Record<string, unknown> =
    d.stored === "(unset)"
      ? { _id: d.id, clothingType: null }
      : { _id: d.id, clothingType: d.stored };
  const res = await model.updateOne(
    filter,
    { $set: { clothingType: d.derived } },
    { runValidators: true },
  );
  return res.modifiedCount === 1;
}

async function main() {
  loadEnvLocal();
  const apply = process.argv.includes("--apply");

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("Missing MONGODB_URI (set it in .env.local or the environment).");
    process.exit(1);
  }

  console.log("🔌 Connecting to MongoDB...");
  await mongoose.connect(uri, { maxPoolSize: 5 });
  const db = mongoose.connection.db;
  if (!db) {
    console.error("No database handle after connect — aborting.");
    process.exit(1);
  }
  // Report the ACTUALLY-connected host/db (wipe-db pattern): the target guard is seeing where
  // you are pointed before any write is possible.
  const host = mongoose.connection.host;
  console.log(`\n🎯 Connected host : ${host}`);
  console.log(`🎯 Connected db   : ${db.databaseName}`);
  console.log(`🎯 Mode           : ${apply ? "APPLY (will write flagged rows)" : "DRY-RUN (no writes)"}`);

  const rows = await WardrobeItem.find({})
    .select("user name category subCategory layerRole clothingType")
    .lean<
      Array<{
        _id: mongoose.Types.ObjectId;
        user: mongoose.Types.ObjectId;
        name?: string;
        category?: string;
        subCategory?: string;
        layerRole?: string;
        clothingType?: string;
      }>
    >()
    .exec();
  console.log(`\n📦 wardrobeitems scanned: ${rows.length}`);

  const diffs = collectDiffs(rows);

  if (diffs.length === 0) {
    console.log("✅ No rows disagree with the post-C1 classifier — nothing to migrate.");
    await mongoose.disconnect();
    return;
  }

  console.log(`\n🔍 Rows where stored ≠ re-derived (${diffs.length}):`);
  for (const d of diffs) {
    console.log(
      `   ${d.id}  user=${d.user}\n` +
        `      "${d.name}"  (category="${d.category}" subCategory="${d.subCategory}" layerRole="${d.layerRole}")\n` +
        `      stored=${d.stored}  →  derived=${d.derived}`,
    );
  }

  if (!apply) {
    console.log(
      `\nDRY-RUN complete — no writes. Re-run with --apply to PATCH these ${diffs.length} row(s) ` +
        "($set clothingType only).",
    );
    await mongoose.disconnect();
    return;
  }

  // --apply: backup first (mechanical reversibility for live friend data), then targeted writes.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = resolve(__dirname, `migrate-clothingtype.backup.${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(diffs, null, 2));
  console.log(`\n💾 Backup of pre-migration values written: ${backupPath}`);

  let updated = 0;
  for (const d of diffs) {
    if (await applyDiff(WardrobeItem, d)) {
      updated += 1;
      console.log(`   ✏️  ${d.id}  ${d.stored} → ${d.derived}  ("${d.name}")`);
    } else {
      console.log(`   ⚠️  ${d.id}  skipped (row changed since the scan — re-run to re-diff)`);
    }
  }
  console.log(`\n✅ Migration complete: ${updated}/${diffs.length} row(s) updated.`);
  await mongoose.disconnect();
}

// Run only as a direct CLI (`npx tsx scripts/migrate-clothingtype.ts`) — the jest behavioral test
// imports collectDiffs/applyDiff from this module and must not trigger a live connection.
const isDirectRun = typeof process.argv[1] === "string" && /migrate-clothingtype/.test(process.argv[1]);
if (isDirectRun) {
  main().catch(async (err) => {
    console.error("💥 Migration failed:", err);
    try {
      await mongoose.disconnect();
    } catch {
      /* already down */
    }
    process.exit(1);
  });
}
