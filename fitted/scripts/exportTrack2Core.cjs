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

// ── Scoreable-cluster certificate (the M6 catalog→closet re-measure decidability gate) ──────────
// These floors MUST byte-equal `ml-system/experiments/track2_transfer/preregistration.json`
// (`export_certificate`), the FROZEN decision rule — pinned equal by
// `experiments/track2_transfer/tests/test_preregistration.py`. The prereg re-derived them from the
// Hanley–McNeil AUC SE: the inherited bare "≥30 image-usable accepted" scalar could not DECIDE
// anything (the 0.70 healthy floor it implied is structurally unpassable — its pass bar sits above
// the catalog AUC ceiling), so the export now certifies SCOREABLE CLUSTERS against the frozen
// two-read floors instead of a raw count. Changing a value here is a prereg change (freeze-before-look).
const CERTIFICATE = {
  primaryDecisionMinPerArm: 25, // primary read decides only with ≥25 scoreable accepted AND ≥25 scoreable rejected (chance-boundary CI_low>0.50 is decidable at AUC≈0.65 → 26/arm; also the ~25-cluster percentile-bootstrap coverage floor)
  transferInterpMin: 12, // ≥12 scoreable accepted source-outfits to attempt the two-boundary transfer read (doubles H26's effective-N=6)
  transferDecisionMin: 25, // a transfer boundary exclusion counts as DECIDED only at ≥25 source-outfits; 12–25 is suggestive/coverage-caveated
  perFriendConcentrationCap: 0.5, // a decided arm may not be >50% one friend (a single-friend "cohort" cannot certify a cohort read)
  minCategoryDepthForNegative: 2, // a transfer-scoreable accepted outfit needs ≥1 clothingType with ≥2 items in that friend's closet, so a same-fine-category corrupted negative exists
};

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

/**
 * Scoreable-cluster certificate: the decision-relevant yield readout the prereg gates on.
 *
 * Eligibility (an outfit is a scoreable CLUSTER, not merely a labeled row):
 *   • pairwise-sized  — ≥2 items (a pairwise/outfit compatibility score needs an edge)
 *   • image-usable    — every item's image resolved (the re-measure is an image-embedding measure)
 *   • labeled         — latest-state action ∈ {accepted, rejected} (§H61)
 *   • primary-scoreable = pairwise-sized ∧ image-usable ∧ labeled
 *   • transfer-scoreable = primary-scoreable ∧ accepted ∧ a same-fine-category corrupted negative
 *     exists in that friend's closet (≥1 clothingType in the outfit with ≥2 items of that type in
 *     the friend's rendered-item set — otherwise H26's negative construction has nothing to swap).
 *
 * Category depth is per FRIEND over that friend's distinct rendered items (engineVisible clothingType,
 * always present), deduped by itemId — the H26 closet probe skipped 25/39 pairs exactly for lack of a
 * same-category negative, so depth is a first-class eligibility gate, not an afterthought.
 */
function buildCertificate(trainingExamples) {
  // Pass 1 — per-user category depth (distinct itemIds per clothingType) over ALL rendered items.
  const depth = {}; // user -> clothingType -> Set(itemId)
  for (const t of trainingExamples) {
    const u = t.user ?? "unknown";
    depth[u] ??= {};
    for (const it of t.items) {
      if (!it.clothingType) continue;
      (depth[u][it.clothingType] ??= new Set()).add(it.itemId);
    }
  }
  const hasSameCatNegative = (u, items) =>
    items.some((it) => it.clothingType && (depth[u]?.[it.clothingType]?.size ?? 0) >= CERTIFICATE.minCategoryDepthForNegative);

  // Pass 2 — classify each labeled outfit against the eligibility gates. Scoreable counts DEDUP by
  // item-set signature within {user, arm} so re-rolled near-identical outfits (correlated children of
  // one parentSnapshotId) don't inflate N — the prereg's frozen lineage-dedup rule. NOTE: the primary
  // arm is NOT filtered by same-category-negative availability (that is a TRANSFER-read eligibility
  // condition only); leaking it into the primary sample would be a post-hoc-lookable exclusion.
  const sig = (items) => items.map((i) => i.itemId).sort().join("|");
  const perUser = {};
  for (const t of trainingExamples) {
    const u = t.user ?? "unknown";
    perUser[u] ??= {
      accepted: 0, rejected: 0, imageUsableAccepted: 0,
      acceptedSig: new Set(), rejectedSig: new Set(), transferSig: new Set(),
      clothingTypes: new Set(),
    };
    const pu = perUser[u];
    for (const i of t.items) if (i.clothingType) pu.clothingTypes.add(i.clothingType);
    const imageUsable = t.items.length > 0 && t.items.every((i) => i.imageStatus === "resolved");
    const primaryScoreable = t.items.length >= 2 && imageUsable;
    if (t.label === "accepted") {
      pu.accepted += 1;
      if (imageUsable) pu.imageUsableAccepted += 1; // legacy continuity readout (onboarding message bar)
      if (primaryScoreable) {
        const s = sig(t.items);
        pu.acceptedSig.add(s);
        if (hasSameCatNegative(u, t.items)) pu.transferSig.add(s);
      }
    } else if (t.label === "rejected") {
      pu.rejected += 1;
      if (primaryScoreable) pu.rejectedSig.add(sig(t.items));
    }
  }

  const perUserOut = Object.fromEntries(
    Object.entries(perUser).map(([u, v]) => [u, {
      accepted: v.accepted, rejected: v.rejected, imageUsableAccepted: v.imageUsableAccepted,
      primaryAcceptedScoreable: v.acceptedSig.size, primaryRejectedScoreable: v.rejectedSig.size,
      transferAcceptedScoreable: v.transferSig.size, clothingTypeDepth: v.clothingTypes.size,
    }]),
  );

  const sum = (f) => Object.values(perUserOut).reduce((a, v) => a + f(v), 0);
  const acceptedScoreable = sum((v) => v.primaryAcceptedScoreable);
  const rejectedScoreable = sum((v) => v.primaryRejectedScoreable);
  const transferScoreable = sum((v) => v.transferAcceptedScoreable);
  const cohortImageUsable = sum((v) => v.imageUsableAccepted);

  // Concentration: the largest single-friend share of the smaller primary arm (a decided cohort read
  // may not rest on one prolific friend). 1.0 for a single-user export → capOk false by construction.
  const maxShare = (total, f) => {
    if (total <= 0) return 0;
    const top = Math.max(0, ...Object.values(perUserOut).map(f));
    return top / total;
  };
  const acceptedMaxShare = maxShare(acceptedScoreable, (v) => v.primaryAcceptedScoreable);
  const rejectedMaxShare = maxShare(rejectedScoreable, (v) => v.primaryRejectedScoreable);
  const concentrationCapOk =
    acceptedMaxShare <= CERTIFICATE.perFriendConcentrationCap && rejectedMaxShare <= CERTIFICATE.perFriendConcentrationCap;

  const primaryDecidable =
    acceptedScoreable >= CERTIFICATE.primaryDecisionMinPerArm &&
    rejectedScoreable >= CERTIFICATE.primaryDecisionMinPerArm &&
    concentrationCapOk;
  const transferState =
    transferScoreable >= CERTIFICATE.transferDecisionMin ? "DECIDABLE (two-boundary)"
      : transferScoreable >= CERTIFICATE.transferInterpMin ? "SUGGESTIVE (coverage-caveated)"
        : "REPORT-ONLY (<12 source-outfits)";

  return {
    friends: Object.keys(perUser).length,
    // Continuity readout (the onboarding message's ≥30 image-usable bar) — kept, but NOT the decision.
    cohortImageUsableAcceptedOutfits: cohortImageUsable,
    // The decision-relevant certificate (the prereg's two reads).
    prereg: "ml-system/experiments/track2_transfer/preregistration.md",
    floors: CERTIFICATE,
    scoreableClusters: { acceptedScoreable, rejectedScoreable, transferAcceptedScoreable: transferScoreable },
    concentration: { acceptedMaxShare, rejectedMaxShare, cap: CERTIFICATE.perFriendConcentrationCap, capOk: concentrationCapOk },
    primaryRead: {
      verdict: primaryDecidable ? "DECIDABLE" : "UNDERPOWERED (keep collecting)",
      boundary: 0.5,
      needPerArm: CERTIFICATE.primaryDecisionMinPerArm,
      note: "accepted-vs-rejected within-user AUC; decides only at ≥25/arm AND concentration cap OK — else keep collecting/recruit",
    },
    transferRead: {
      state: transferState,
      note: "catalog→closet pair-AUC, two-boundary directional {above-chance 0.50 / below-healthy 0.70}; REPORTED, never gates; the 0.70 healthy floor is structurally unpassable and retired as a gate",
    },
    perUser: perUserOut,
  };
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

  // Corpus-yield + SCOREABLE-CLUSTER CERTIFICATE computed FROM THE EXPORT (so "is the data good
  // enough to DECIDE" and "what M6 trains on" are ONE artifact — no drift vs a separate readout).
  // The prereg (`experiments/track2_transfer/preregistration.md`) defines two reads; this block
  // certifies each against its frozen floor (CERTIFICATE, above). An outfit (training example) is
  // NOT scoreable just because it exists — it must clear the eligibility gates the reads require.
  const yieldReadout = buildCertificate(trainingExamples);

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

module.exports = { exportTrack2, BUNDLE_VERSION, CERTIFICATE, buildCertificate, parseImageId, pickLatestPerCandidate };
