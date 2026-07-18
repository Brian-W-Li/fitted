/**
 * export_track2 — READ-ONLY M6 training-corpus export. Takes a Mongo URI in, emits a versioned JSONL
 * bundle + an images dir out, joining the four owned collections into a training shape.
 *
 *   node scripts/export_track2.mjs --uri "<mongo uri>" [--authId <firebase-uid>] [--out <dir>]
 *   # or rely on MONGODB_URI_ATLAS from .env.local:
 *   node scripts/export_track2.mjs --out ./track2-export
 *
 * Why this exists: if friends deliver data and it can't leave Atlas in a training shape, Track 2
 * succeeds operationally and fails terminally. This is the missing bridge (verified absent before
 * 2026-07-18) between "friends used the app" and "M6 has something to train on".
 *
 * Design (the seams that make it correct):
 *  - Training truth is the GenerationSnapshot's `itemSnapshots[].engineVisible` — the IMMUTABLE
 *    feature-copy taken at render time — NOT the live (deletable, mutable) WardrobeItem. So the join
 *    survives item deletion + edits. Live WardrobeItems are exported too (closet context), but the
 *    training example never depends on them.
 *  - Images resolve `mongo:<imageId>` → WardrobeImage.base64. The D2/REPLACE-1 fix keeps a
 *    snapshot-referenced WardrobeImage alive even after its WardrobeItem is deleted, so a shown
 *    outfit's photos still resolve. Unreferenced/deleted images are recorded as `unresolved`.
 *  - REDACTED snapshots (the account-deletion phase-1 fail-safe) are EXCLUDED — a deleted friend's
 *    data must not appear in the export, matching the erasure promise. (In the normal path the rows
 *    are hard-deleted and simply absent; the redacted filter catches a mid-cascade fail-safe state.)
 *  - Feedback is collapsed to §H61 latest-state per {snapshotId, candidateId} (dislike→like→dislike
 *    resolves to the last event by {createdAt,_id}); the raw append-only log is exported too.
 *
 * Output bundle (BUNDLE_VERSION):
 *   manifest.json            — version, counts, schema notes, generated-by
 *   snapshots.jsonl          — every non-redacted GenerationSnapshot (full training truth)
 *   wardrobe.jsonl           — live WardrobeItems (closet context; may be fewer than itemSnapshots)
 *   interactions_raw.jsonl   — every OutfitInteraction (append-only provenance)
 *   interactions_latest.jsonl— §H61 latest-state per {snapshotId,candidateId}
 *   training_examples.jsonl  — one row per SHOWN candidate: outfit + item features + image files + label
 *   images/<imageId>.<ext>   — the resolved image blobs
 */
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { readFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const mongoose = require("mongoose");

export const BUNDLE_VERSION = "track2-export.v1";

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

const jsonReplacer = (_k, v) => {
  if (v && typeof v === "object" && v._bsontype === "ObjectId") return v.toString();
  if (v instanceof Date) return v.toISOString();
  return v;
};
function writeJsonl(path, rows) {
  writeFileSync(path, rows.map((r) => JSON.stringify(r, jsonReplacer)).join("\n") + (rows.length ? "\n" : ""));
}

const EXT = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp" };
const OBJ_ID_RE = /^[a-f0-9]{24}$/i;
// engineVisible.imageUrl is the served route form `/api/images/<id>`; the generatorVisible/evidence
// side uses the `mongo:<id>` ref. Accept both (and a bare id) so the join is robust to either home.
function parseImageId(ref) {
  if (typeof ref !== "string" || !ref) return null;
  if (ref.startsWith("mongo:")) return ref.slice("mongo:".length);
  if (ref.startsWith("/api/images/")) return ref.slice("/api/images/".length).split(/[/?#]/)[0];
  if (OBJ_ID_RE.test(ref)) return ref;
  return null;
}

/** Core export. Returns a summary object; writes the bundle to `outDir`. */
export async function exportTrack2({ db, outDir, userFilter }) {
  mkdirSync(resolve(outDir, "images"), { recursive: true });
  const snapMatch = { redacted: { $ne: true }, ...(userFilter ? { user: userFilter } : {}) };
  const rowMatch = userFilter ? { user: userFilter } : {};

  const snapshots = await db.collection("generationsnapshots").find(snapMatch).toArray();
  const wardrobe = await db.collection("wardrobeitems").find(rowMatch).toArray();
  const interactions = await db.collection("outfitinteractions").find(rowMatch).toArray();

  // Resolve every image reference found in snapshot itemSnapshots (engineVisible.imageUrl +
  // generatorVisible/evidence imageRef), dedup by imageId.
  const imageRefs = new Set();
  for (const s of snapshots) {
    for (const it of s.itemSnapshots ?? []) {
      const id = parseImageId(it?.engineVisible?.imageUrl);
      if (id) imageRefs.add(id);
    }
  }
  const imageManifest = {};
  for (const id of imageRefs) {
    let doc = null;
    if (mongoose.isValidObjectId(id)) {
      doc = await db.collection("wardrobeimages").findOne({ _id: new mongoose.Types.ObjectId(id) });
    }
    if (!doc || !doc.base64) {
      imageManifest[id] = { status: "unresolved" };
      continue;
    }
    const ext = EXT[doc.contentType] || "bin";
    const file = `images/${id}.${ext}`;
    writeFileSync(resolve(outDir, file), Buffer.from(doc.base64, "base64"));
    imageManifest[id] = { status: "resolved", file, contentType: doc.contentType, sizeBytes: doc.sizeBytes };
  }

  // §H61 latest-state collapse per {snapshotId, candidateId}.
  const latestByKey = new Map();
  for (const i of interactions) {
    if (!i.snapshotId || !i.candidateId) continue;
    const key = `${i.snapshotId.toString()}::${i.candidateId}`;
    const prev = latestByKey.get(key);
    const newer =
      !prev ||
      new Date(i.createdAt ?? 0).getTime() > new Date(prev.createdAt ?? 0).getTime() ||
      (new Date(i.createdAt ?? 0).getTime() === new Date(prev.createdAt ?? 0).getTime() &&
        i._id.toString() > prev._id.toString());
    if (newer) latestByKey.set(key, i);
  }

  // Training examples: one row per SHOWN candidate, joined to its immutable item features + images.
  const trainingExamples = [];
  for (const s of snapshots) {
    const evById = new Map((s.itemSnapshots ?? []).map((it) => [it.itemId, it.engineVisible ?? {}]));
    const candById = new Map((s.candidates ?? []).map((c) => [c.candidateId, c]));
    for (const cid of s.shownCandidateIds ?? []) {
      const cand = candById.get(cid);
      if (!cand) continue;
      const items = (cand.items ?? []).map((ci) => {
        const ev = evById.get(ci.itemId) ?? {};
        const imgId = parseImageId(ev.imageUrl);
        const img = imgId ? imageManifest[imgId] : null;
        return {
          itemId: ci.itemId,
          role: ci.role,
          name: ev.name ?? null,
          clothingType: ev.clothingType ?? null,
          colorTags: ev.colorTags ?? [],
          imageRef: ev.imageUrl ?? null,
          imageFile: img && img.status === "resolved" ? img.file : null,
          imageStatus: img ? img.status : "none",
        };
      });
      const fb = latestByKey.get(`${s._id.toString()}::${cid}`);
      trainingExamples.push({
        snapshotId: s._id.toString(),
        candidateId: cid,
        user: s.user?.toString(),
        occasion: s.occasion,
        intent: s.intent,
        seedDate: s.seedDate,
        forcedItemId: s.forcedItemId ?? null,
        generationIndex: s.generationIndex ?? 0,
        generator: s.generator ?? null,
        template: cand.template,
        styleMove: cand.styleMove ?? null,
        items,
        label: fb ? fb.action : null, // accepted | rejected | null (shown-but-no-feedback)
        feedbackReason: fb?.feedbackReason ?? null,
        labeledAt: fb?.createdAt ?? null,
      });
    }
  }

  writeJsonl(resolve(outDir, "snapshots.jsonl"), snapshots);
  writeJsonl(resolve(outDir, "wardrobe.jsonl"), wardrobe);
  writeJsonl(resolve(outDir, "interactions_raw.jsonl"), interactions);
  writeJsonl(resolve(outDir, "interactions_latest.jsonl"), [...latestByKey.values()]);
  writeJsonl(resolve(outDir, "training_examples.jsonl"), trainingExamples);

  const resolvedImages = Object.values(imageManifest).filter((m) => m.status === "resolved").length;
  const labeled = trainingExamples.filter((t) => t.label != null).length;

  // Corpus-yield / decidability readout computed FROM THE EXPORT (so "is the data good enough" and
  // "what M6 trains on" are ONE artifact — no drift vs a separate live-DB readout). The M6/H26
  // catalog→closet re-measure is an image-embedding measure over POSITIVELY-labeled outfits, so the
  // headline is image-usable accepted examples; ~30–60 across the cohort is the decidability bar.
  const perUser = {};
  for (const t of trainingExamples) {
    const u = t.user ?? "unknown";
    perUser[u] ??= { accepted: 0, rejected: 0, imageUsableAccepted: 0, clothingTypes: new Set() };
    if (t.label === "accepted") {
      perUser[u].accepted += 1;
      if (t.items.length > 0 && t.items.every((i) => i.imageStatus === "resolved")) perUser[u].imageUsableAccepted += 1;
    } else if (t.label === "rejected") perUser[u].rejected += 1;
    for (const i of t.items) if (i.clothingType) perUser[u].clothingTypes.add(i.clothingType);
  }
  const yieldPerUser = Object.fromEntries(
    Object.entries(perUser).map(([u, v]) => [u, { accepted: v.accepted, rejected: v.rejected, imageUsableAccepted: v.imageUsableAccepted, clothingTypeDepth: v.clothingTypes.size }]),
  );
  const cohortImageUsable = Object.values(perUser).reduce((a, v) => a + v.imageUsableAccepted, 0);
  const yieldReadout = {
    friends: Object.keys(perUser).length,
    cohortImageUsableAcceptedOutfits: cohortImageUsable,
    decidabilityBar: "30–60 usable positively-labeled outfits across the cohort",
    verdict: cohortImageUsable >= 30 ? "DECIDABLE" : "UNDERPOWERED (keep collecting)",
    perUser: yieldPerUser,
  };

  const manifest = {
    bundleVersion: BUNDLE_VERSION,
    userFilter: userFilter ? userFilter.toString() : null,
    counts: {
      snapshots: snapshots.length,
      wardrobeItems: wardrobe.length,
      interactionsRaw: interactions.length,
      interactionsLatest: latestByKey.size,
      trainingExamples: trainingExamples.length,
      trainingExamplesLabeled: labeled,
      imagesReferenced: imageRefs.size,
      imagesResolved: resolvedImages,
      imagesUnresolved: imageRefs.size - resolvedImages,
    },
    schemaNotes: {
      trainingTruth: "itemSnapshots[].engineVisible (immutable render-time copy); NOT live WardrobeItem",
      label: "accepted|rejected|null — §H61 latest-state per {snapshotId,candidateId}",
      redactedExcluded: true,
      imageRefFormat: "mongo:<imageId> or /api/images/<imageId> → wardrobeimages.base64 (D2-retained images survive item delete)",
    },
    yield: yieldReadout,
    imageManifest,
  };
  writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function main() {
  loadEnvLocal();
  const uri = arg("uri", process.env.MONGODB_URI_ATLAS || process.env.MONGODB_URI);
  const outDir = resolve(arg("out", "./track2-export"));
  const authId = arg("authId", null);
  if (!uri) throw new Error("no Mongo URI (pass --uri or set MONGODB_URI_ATLAS)");

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  let userFilter = null;
  if (authId) {
    const u = await db.collection("users").findOne({ authProvider: "firebase", authId });
    if (!u) {
      console.log(`No user for authId ${authId} — exporting nothing (matches erasure promise for a deleted user).`);
    }
    userFilter = u ? u._id : new mongoose.Types.ObjectId(); // a non-matching id → empty export
  }
  const manifest = await exportTrack2({ db, outDir, userFilter });
  console.log(`Exported → ${outDir}`);
  console.log(JSON.stringify(manifest.counts, null, 2));
  await mongoose.disconnect();
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
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
