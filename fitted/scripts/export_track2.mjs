/**
 * export_track2 — READ-ONLY M6 training-corpus export CLI. Takes a Mongo URI in, emits a versioned
 * JSONL bundle + an images dir out, joining the four owned collections into a training shape.
 *
 *   node scripts/export_track2.mjs --uri "<mongo uri>" [--authId <firebase-uid>] [--out <dir>]
 *     [--operatorAuthId <brian-firebase-uid>]
 *   # or rely on MONGODB_URI_ATLAS from .env.local:
 *   node scripts/export_track2.mjs --out ./track2-export --operatorAuthId <brian-firebase-uid>
 *
 * `--operatorAuthId` is the prereg §5 author exclusion: Brian-as-friend-#0's closet is reported
 * separately and never enters the headline certificate pool (the Look-1 trigger). `track2test_*`
 * synthetic accounts are always excluded regardless. Pass it on every real M6 export; the runbook
 * §8 export command carries it. The bundle FILES still contain every user's rows — only the
 * decidability certificate (`manifest.yield`) is exclusion-filtered.
 *
 * Why this exists: if friends deliver data and it can't leave Atlas in a training shape, Track 2
 * succeeds operationally and fails terminally. This is the missing bridge (verified absent before
 * 2026-07-18) between "friends used the app" and "M6 has something to train on".
 *
 * This file is the thin CLI shell: arg-parsing, the Mongo connection, and the direct-invocation
 * guard. The pure export logic — and the seams that make it correct (immutable engineVisible training
 * truth, redacted exclusion for the erasure promise, §H61 latest-state collapse, image resolution) —
 * lives in `exportTrack2Core.cjs`, which `tests/exportTrack2.test.ts` exercises directly. The core is
 * re-exported here so existing ESM importers (e.g. track2-export-roundtrip.mjs) keep working.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import mongoose from "mongoose";
import { exportTrack2, BUNDLE_VERSION } from "./exportTrack2Core.cjs";

export { exportTrack2, BUNDLE_VERSION };

function loadEnvLocal() {
  try {
    for (const line of readFileSync(resolve("./.env.local"), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i > -1 && !process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch {
    /* ignore */
  }
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  loadEnvLocal();
  const uri = arg("uri", process.env.MONGODB_URI_ATLAS || process.env.MONGODB_URI);
  const outDir = resolve(arg("out", "./track2-export"));
  const authId = arg("authId", null);
  const operatorAuthId = arg("operatorAuthId", process.env.TRACK2_OPERATOR_AUTH_ID || null);
  if (!uri) throw new Error("no Mongo URI (pass --uri or set MONGODB_URI_ATLAS)");

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  // Echo the resolved host so a dev-DB bundle is never mistaken for the live corpus at a Look trigger.
  const host = (() => {
    try {
      return new URL(uri.replace(/^mongodb\+srv:/, "https:").replace(/^mongodb:/, "http:")).host;
    } catch {
      return "unparseable-uri";
    }
  })();
  console.log(`Connected → ${host}${authId ? ` (authId filter ${authId})` : ""}`);
  if (!operatorAuthId) {
    console.warn(
      "⚠  no --operatorAuthId (and no TRACK2_OPERATOR_AUTH_ID) — the certificate will NOT exclude the " +
        "operator's own closet (prereg §5). Pass it for a real M6 decidability read.",
    );
  }
  let userFilter = null;
  if (authId) {
    const u = await db.collection("users").findOne({ authProvider: "firebase", authId });
    if (!u) {
      console.log(`No user for authId ${authId} — exporting nothing (matches erasure promise for a deleted user).`);
    }
    userFilter = u ? u._id : new mongoose.Types.ObjectId(); // a non-matching id → empty export
  }
  const manifest = await exportTrack2({ db, outDir, userFilter, operatorAuthId });
  console.log(`Exported → ${outDir}`);
  console.log(JSON.stringify(manifest.counts, null, 2));
  await mongoose.disconnect();
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith("export_track2.mjs")) {
  main().catch(async (err) => {
    console.error("❌", err);
    try {
      await mongoose.disconnect();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
}
