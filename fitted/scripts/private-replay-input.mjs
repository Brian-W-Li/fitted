/** Explicit local-only private input. Never imports answers, accounts, models or inferred facts. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath, stat, mkdtemp, chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import { ObjectId } from "mongodb";

const HEX = /^[a-f0-9]{24}$/;
const SHA = /^[a-f0-9]{64}$/;
const TYPES = ["top", "bottom", "dress", "outer_layer", "shoes"];
const ROLES = ["base_top", "base_bottom", "mid_layer", "one_piece", "outer_layer", "shoes"];
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
const object = value => !!value && typeof value === "object" && !Array.isArray(value);
function keys(value, allowed, label) { assert.ok(object(value), `${label}: expected an object`); assert.ok(Object.keys(value).every(key => allowed.includes(key)) && allowed.every(key => Object.hasOwn(value, key)), `${label}: unsupported or missing fields`); }
function text(value, max, label, blank = false) { assert.ok(typeof value === "string" && value.length <= max && value.isWellFormed() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) && (blank || value.trim()), `${label}: invalid text`); }
function terms(value, label) { assert.ok(Array.isArray(value) && value.length <= 25, `${label}: invalid list`); value.forEach(item => text(item, 60, label)); }
function mime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}
export async function loadPrivateReplayInput(filename, { checkoutRoots = [] } = {}) {
  assert.ok(typeof filename === "string" && path.isAbsolute(filename), "private replay requires an explicit absolute input path");
  assert.ok(checkoutRoots.every(root => typeof root === "string" && path.isAbsolute(root)), "forbidden checkout roots must be absolute");
  const inputPath = await realpath(filename), roots = await Promise.all(checkoutRoots.map(root => realpath(root)));
  assert.ok((await Promise.all(roots.map(root => stat(root)))).every(info => info.isDirectory()), "forbidden checkout roots must be directories");
  assert.ok(!roots.some(root => inside(root, inputPath)), "private input must be outside active/public checkouts");
  const info = await stat(inputPath);
  assert.ok(info.isFile() && info.size > 0 && info.size <= 16 * 1024 * 1024, "private replay input size is invalid");
  assert.equal(info.mode & 0o077, 0, "private input must deny group/world permissions");
  const bytes = await readFile(inputPath), input = JSON.parse(bytes.toString("utf8"));
  keys(input, ["version", "provenance", "photoRoot", "wardrobe", "drafts", "factualCorrections"], "private replay");
  assert.equal(input.version, "private-wardrobe-replay.v1", "unsupported private replay schema");
  keys(input.provenance, ["kind", "capturedAt", "subsetCount", "currentClosetParity", "labelsImported", "operatorFeedbackOnly", "caveats", "sourceDigests"], "provenance");
  text(input.provenance.kind, 128, "provenance kind"); assert.ok(Number.isFinite(Date.parse(input.provenance.capturedAt)), "capture time required");
  assert.equal(input.provenance.currentClosetParity, false, "replay must not claim whole/current closet parity");
  assert.equal(input.provenance.labelsImported, false, "preference-label import is forbidden");
  assert.equal(input.provenance.operatorFeedbackOnly, true, "replay feedback must be explicitly operator authored");
  assert.ok(Array.isArray(input.provenance.caveats) && input.provenance.caveats.length <= 32, "bounded caveats required");
  input.provenance.caveats.forEach(value => text(value, 2000, "caveat"));
  assert.ok(object(input.provenance.sourceDigests) && Object.keys(input.provenance.sourceDigests).length > 0 && Object.keys(input.provenance.sourceDigests).length <= 32 && Object.values(input.provenance.sourceDigests).every(value => SHA.test(value)), "source artifact digests required");
  assert.ok(typeof input.photoRoot === "string" && path.isAbsolute(input.photoRoot), "absolute photo root required");
  const photoRoot = await realpath(input.photoRoot);
  assert.ok((await stat(photoRoot)).isDirectory() && !roots.some(root => inside(root, photoRoot)), "photo root must be outside active/public checkouts");
  assert.ok(Array.isArray(input.wardrobe) && input.wardrobe.length >= 2 && input.wardrobe.length <= 2000 && input.provenance.subsetCount === input.wardrobe.length, "captured subset count mismatch");
  const ids = new Set(), photos = new Map(); let photoBytes = 0;
  for (const garment of input.wardrobe) {
    keys(garment, ["id", "name", "clothingType", "subCategory", "colors", "pattern", "fit", "layerRole", "warmth", "isAvailable", "photoPath", "photoSha256", "photoMime"], "captured garment");
    assert.ok(HEX.test(garment.id) && !ids.has(garment.id), "unique canonical garment IDs required"); ids.add(garment.id);
    text(garment.name, 200, "captured garment name"); assert.ok(TYPES.includes(garment.clothingType), "declared garment type required");
    if (garment.subCategory !== null) text(garment.subCategory, 60, "captured subtype");
    terms(garment.colors, "captured full color set");
    for (const field of ["pattern", "fit"]) if (garment[field] !== null) text(garment[field], 60, `captured ${field}`);
    assert.ok([null, "base", "mid", "outer"].includes(garment.layerRole), "unknown or explicit layer role required");
    assert.ok(Number.isInteger(garment.warmth) && garment.warmth >= 0 && garment.warmth <= 10 && typeof garment.isAvailable === "boolean", "captured warmth/availability required");
    text(garment.photoPath, 4096, "photo path"); assert.ok(SHA.test(garment.photoSha256), "photo digest required");
    const target = await realpath(path.resolve(photoRoot, garment.photoPath));
    assert.ok(inside(photoRoot, target) && !roots.some(root => inside(root, target)), "photo escapes the explicit root");
    const photoInfo = await stat(target); assert.ok(photoInfo.isFile() && photoInfo.size > 0 && photoInfo.size <= 8 * 1024 * 1024, "invalid photo size");
    const pixels = await readFile(target); photoBytes += pixels.length; assert.ok(photoBytes <= 256 * 1024 * 1024, "photo memory bound exceeded");
    assert.equal(digest(pixels), garment.photoSha256, "photo checksum mismatch"); assert.equal(mime(pixels), garment.photoMime, "photo MIME disagrees with bytes");
    photos.set(garment.id, pixels);
  }
  assert.ok(Array.isArray(input.drafts) && input.drafts.length > 0 && input.drafts.length <= 2000, "bounded original draft bank required");
  const sourceIds = new Set();
  for (const draft of input.drafts) {
    keys(draft, ["sourceId", "sourceDigest", "jobId", "attemptIndex", "outfitIndex", "outfit"], "preserved draft");
    text(draft.sourceId, 200, "draft source ID"); assert.ok(!sourceIds.has(draft.sourceId), "duplicate draft source ID"); sourceIds.add(draft.sourceId);
    text(draft.jobId, 200, "draft job ID"); assert.ok(SHA.test(draft.sourceDigest) && Object.values(input.provenance.sourceDigests).includes(draft.sourceDigest), "draft source digest required");
    assert.ok(!input.provenance.sourceDigests.returns || draft.sourceDigest === input.provenance.sourceDigests.returns, "draft must reference preserved returns artifact");
    assert.ok([draft.attemptIndex, draft.outfitIndex].every(value => Number.isSafeInteger(value) && value >= 0), "draft source indices required");
    keys(draft.outfit, ["items", "styleMove"], "preserved outfit");
    assert.ok(Array.isArray(draft.outfit.items) && draft.outfit.items.length >= 1 && draft.outfit.items.length <= 5, "invalid preserved membership");
    const members = new Set();
    for (const item of draft.outfit.items) { keys(item, ["itemId", "role"], "preserved member"); assert.ok(ids.has(item.itemId) && !members.has(item.itemId) && ROLES.includes(item.role), "preserved member missing or duplicated"); members.add(item.itemId); }
    keys(draft.outfit.styleMove, ["moveType", "changedItemIds", "oneSentence"], "preserved StyleMove");
    text(draft.outfit.styleMove.moveType, 80, "preserved move type"); text(draft.outfit.styleMove.oneSentence, 4000, "preserved prose");
    assert.ok(Array.isArray(draft.outfit.styleMove.changedItemIds) && draft.outfit.styleMove.changedItemIds.length > 0 && draft.outfit.styleMove.changedItemIds.every(id => members.has(id)), "preserved move must name original members");
  }
  assert.ok(Array.isArray(input.factualCorrections) && input.factualCorrections.length <= 100 && Buffer.byteLength(JSON.stringify(input.factualCorrections)) <= 64 * 1024, "bounded factual correction metadata required");
  const correctionIds = new Set();
  for (const correction of input.factualCorrections) {
    assert.ok(object(correction), "factual correction must be a flat record");
    keys(correction, ["correction_id", "owner_id", "garment_id", "field", "value", "source", "source_ref", ...(Object.hasOwn(correction, "previous_value") ? ["previous_value"] : [])], "factual correction");
    for (const [field, max] of [["correction_id", 128], ["owner_id", 128], ["source", 500], ["source_ref", 2000]]) text(correction[field], max, `factual correction ${field}`);
    assert.ok(!correctionIds.has(correction.correction_id), "duplicate factual correction ID"); correctionIds.add(correction.correction_id);
    assert.ok(ids.has(correction.garment_id), "factual correction must name a captured garment");
    assert.ok(["name", "primary_color"].includes(correction.field), "unsupported factual correction field");
    text(correction.value, correction.field === "name" ? 200 : 60, "factual correction value");
    if (Object.hasOwn(correction, "previous_value")) text(correction.previous_value, 200, "factual correction previous value");
  }
  return { input, inputPath, inputDigest: digest(bytes), photos };
}
export async function createPrivateReplayRun(loaded) {
  const runDirectory = await mkdtemp(path.join(path.dirname(loaded.inputPath), "walkthrough-run-"));
  await chmod(runDirectory, 0o700);
  return { runDirectory, auditPath: path.join(runDirectory, "source-selections.jsonl"), reportPath: path.join(runDirectory, "report.json") };
}
export async function writePrivateReplayReport(run, report) {
  await writeFile(run.reportPath, JSON.stringify(report, null, 2), { mode: 0o600 }); await chmod(run.reportPath, 0o600);
}
export async function materializePrivateWardrobe(db, ownerId, loaded) {
  const user = new ObjectId(ownerId);
  assert.equal(await db.collection("wardrobeitems").countDocuments({ user }), 0, "private replay requires an isolated empty local owner");
  for (const garment of loaded.input.wardrobe) {
    const imageId = new ObjectId(), wardrobeItem = new ObjectId(garment.id), pixels = loaded.photos.get(garment.id);
    await db.collection("wardrobeimages").insertOne({ _id: imageId, user, wardrobeItem, base64: pixels.toString("base64"), contentType: garment.photoMime, sizeBytes: pixels.length, createdAt: new Date(), updatedAt: new Date() });
    await db.collection("wardrobeitems").insertOne({ _id: wardrobeItem, user, name: garment.name, clothingType: garment.clothingType,
      category: garment.clothingType === "shoes" ? "footwear" : garment.clothingType === "outer_layer" ? "outer" : garment.clothingType,
      subCategory: garment.subCategory, colors: garment.colors, pattern: garment.pattern, fit: garment.fit, layerRole: garment.layerRole,
      warmth: garment.warmth, isAvailable: garment.isAvailable, imagePath: `mongo:${imageId}`, createdAt: new Date(), updatedAt: new Date() });
  }
}
