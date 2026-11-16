import assert from "node:assert/strict";
import path from "node:path";
import { expectedDetail } from "./private-feedback-verification.mjs";
import { sha256 } from "./private-feedback-contract.mjs";

export function privateWardrobeFlag(args) {
  const selected = args.filter(arg => ["--private-wardrobe", "--private-wardrobe-full"].includes(arg));
  if (!selected.length) return false;
  assert.equal(selected.length, 1, "private wardrobe mode is selected once");
  const inputs = args.filter(arg => arg.startsWith("--private-replay="));
  assert.ok(inputs.length === 1 && path.isAbsolute(inputs[0].slice(17)), "private wardrobe requires one absolute private replay input");
  assert.ok(!["--private-feedback", "--private-lifecycle", "--private-exclusions", "--feedback-only", "--style-only"].some(flag => args.includes(flag)), "private wardrobe is a separate focused journey");
  return true;
}
export function wardrobeExpectation(input, targetId, changes) {
  assert.deepEqual(Object.keys(changes).sort(), ["fit", "isAvailable"], "only declared overlay fields allowed");
  const { fit, isAvailable } = changes;
  assert.ok(input.wardrobe.some(item => item.id === targetId), "known authored target required");
  assert.ok([null, "Relaxed"].includes(fit) && typeof isAvailable === "boolean", "only declared stage changes are allowed");
  const expected = structuredClone(input);
  Object.assign(expected.wardrobe.find(item => item.id === targetId), { fit, isAvailable });
  return expected;
}
const plain = value => JSON.parse(JSON.stringify(value));
export function verifyStoredWardrobe(initial, actual, targetId, { fit, isAvailable }) {
  const before = plain(initial), after = plain(actual);
  assert.ok(before.some(row => row._id === targetId), "known stored target required");
  for (const row of before) if (row._id === targetId) { delete row.updatedAt; row.fit = fit; row.isAvailable = isAvailable; }
  for (const row of after) if (row._id === targetId) delete row.updatedAt;
  assert.deepEqual(after, before, "only the authored target fit/availability and its update timestamp may change");
}
export function verifyFaithfulCapture(row, result, expected, rawWardrobe, { forcedItemId = null, poolDigests } = {}) {
  const available = expected.wardrobe.filter(item => item.isAvailable), raw = new Map(rawWardrobe.map(item => [String(item._id), item]));
  const ids = row.itemSnapshots.map(item => String(item.itemId)), availableIds = new Set(available.map(item => item.id));
  assert.ok(ids.length && new Set(ids).size === ids.length && ids.every(id => availableIds.has(id)), "captured prompt pool contains unique available owned pieces only");
  if (forcedItemId) assert.ok(ids.includes(forcedItemId), "rescue target must be captured");
  if (poolDigests) {
    const digest = sha256(JSON.stringify([...ids].sort()).replaceAll(",", ", "));
    assert.ok(poolDigests.length && poolDigests.every(value => /^[a-f0-9]{64}$/.test(value) && value === digest), "capture matches the independently audited actual prompt pool");
  }
  const facts = new Map(row.itemSnapshots.map(item => [String(item.itemId), item]));
  for (const garment of available.filter(item => facts.has(item.id))) {
    const capture = facts.get(garment.id), stored = raw.get(garment.id), fact = capture.engineVisible;
    assert.ok(stored && /^mongo:[a-f0-9]{24}$/.test(stored.imagePath));
    assert.equal(fact.name, garment.name.trim()); assert.equal(fact.clothingType, garment.clothingType); assert.equal(fact.warmth, garment.warmth);
    assert.deepEqual(fact.colorTags, garment.colors.map(value => value.trim()));
    assert.equal(fact.subtype ?? null, garment.subCategory?.trim() ?? null);
    assert.equal(fact.pattern ?? null, expectedDetail(garment.pattern)); assert.equal(fact.fit ?? null, expectedDetail(garment.fit));
    assert.equal(fact.material ?? null, null); assert.equal(fact.formality ?? null, null);
    assert.equal(fact.layerRole ?? null, garment.layerRole); assert.equal(capture.evidence.fit ?? null, stored.fit ?? null);
    assert.equal(capture.evidence.image.imageRef, stored.imagePath, "capture retains the original exact primary reference");
  }
  for (const outfit of result.shown) for (const member of outfit.displayItems) {
    const stored = raw.get(member.itemId); assert.ok(stored?.isAvailable);
    assert.equal(member.imageUrl, `/api/images/${stored.imagePath.slice(6)}`, "display uses this garment's original materialized photo");
  }
  const allowed = new Set(available.map(item => item.id));
  for (const attempt of row.generationAttempts) for (const outfit of JSON.parse(attempt.rawText).outfits)
    assert.ok(outfit.items.every(item => allowed.has(item.itemId)), "unavailable pieces cannot enter replayed raw attempts");
}
export function verifyOriginalPhoto(image, garment, expectedRef, ownerId) {
  assert.equal(`mongo:${image._id}`, expectedRef); assert.equal(String(image.user), ownerId); assert.equal(String(image.wardrobeItem), garment.id);
  assert.equal(image.contentType, garment.photoMime); assert.equal(sha256(Buffer.from(image.base64, "base64")), garment.photoSha256, "original photo bytes remain intact");
}

export function verifyWardrobeAck(initial, item, changes) {
  const expected = { ...plain(initial), ...changes };
  assert.equal(item.id, expected._id);
  for (const key of ["name", "category", "clothingType", "warmth", "isAvailable", "imagePath", "imageUrl"])
    assert.deepEqual(item[key], expected[key], `acknowledgement preserves ${key}`);
  for (const key of ["subCategory", "pattern", "layerRole", "fit", "size", "notes"])
    assert.equal(item[key], expected[key] ?? "", `acknowledgement projects ${key} without inventing a fact`);
  for (const key of ["colors", "seasons", "occasions", "supplementalImages"])
    assert.deepEqual(item[key], expected[key] ?? [], `acknowledgement preserves the complete ${key}`);
}
