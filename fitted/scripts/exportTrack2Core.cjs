/* eslint-disable @typescript-eslint/no-require-imports -- this is a CommonJS module by design */
/**
 * export_track2 core — the pure, injectable-`db` export logic behind the `export_track2.mjs` CLI.
 *
 * CommonJS on purpose: the jest suite (tests/exportTrack2.test.ts) requires this real unit directly
 * against an in-memory mongod, sharing the one mongoose instance and needing no ESM-transform config.
 * `export_track2.mjs` is the thin CLI wrapper that owns arg-parsing + the Mongo connection and
 * re-exports these. See exportTrack2Core.d.cts for the export-bundle contract.
 */
const { mkdirSync, writeFileSync } = require("fs");
const { resolve } = require("path");
const mongoose = require("mongoose");

const BUNDLE_VERSION = "track2-export.v1";

const jsonReplacer = (_k, v) => {
  if (v && typeof v === "object" && v._bsontype === "ObjectId") return v.toString();
  if (v instanceof Date) return v.toISOString();
  return v;
};
function writeJsonl(path, rows) {
  writeFileSync(path, rows.map((r) => JSON.stringify(r, jsonReplacer)).join("\n") + (rows.length ? "\n" : ""));
}

// §23-H61 per-candidate latest-STATE. Mirror of `fitted/lib/latestFeedbackState.ts` (the History
// curation view) and the Python reducer's first-seen rule — pinned equal by the shared fixture test
// `tests/latestFeedbackState.test.ts` + `test_reducers.py`. Keep the createdAt-then-_id rule identical
// across all three homes (that agreement is what stops the corpus label from disagreeing with what the
// friend saw in History and what the engine acts on).
function isNewerRow(a, b) {
  const at = new Date(a.createdAt ?? 0).getTime();
  const bt = new Date(b.createdAt ?? 0).getTime();
  const an = Number.isNaN(at) ? 0 : at;
  const bn = Number.isNaN(bt) ? 0 : bt;
  if (an !== bn) return an > bn;
  return String(a._id ?? "") > String(b._id ?? "");
}
// Only accepted/rejected win a candidate slot — parity with the reducer + lib/latestFeedbackState.ts
// (a future planned/packed row must not win the collapse here while the reducer skips it).
const PARTICIPATING_ACTIONS = new Set(["accepted", "rejected"]);

/** Collapse interaction rows to the latest row per {snapshotId, candidateId}; returns a Map. */
function pickLatestPerCandidate(rows) {
  const latest = new Map();
  for (const r of rows) {
    if (!r || r.action == null || !PARTICIPATING_ACTIONS.has(r.action)) continue;
    const snap = r.snapshotId == null ? "" : String(r.snapshotId);
    const cand = r.candidateId == null ? "" : String(r.candidateId);
    if (!snap.trim() || !cand.trim()) continue; // .trim() parity with the reducer's _truthy_str
    const key = `${snap}::${cand}`;
    const prev = latest.get(key);
    if (!prev || isNewerRow(r, prev)) latest.set(key, r);
  }
  return latest;
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
async function exportTrack2({ db, outDir, userFilter }) {
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

  // §H61 latest-state collapse per {snapshotId, candidateId} (shared rule — see pickLatestPerCandidate).
  const latestByKey = pickLatestPerCandidate(interactions);

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

module.exports = { exportTrack2, BUNDLE_VERSION, parseImageId, pickLatestPerCandidate };
