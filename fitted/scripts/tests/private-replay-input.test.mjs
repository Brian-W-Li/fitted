import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, chmod, rm, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadPrivateReplayInput, materializePrivateWardrobe } from "../private-replay-input.mjs";
const sha = value => createHash("sha256").update(value).digest("hex");
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "private-replay-contract-")); t.after(() => rm(root, { recursive: true, force: true }));
  const photoRoot = path.join(root, "photos"); await mkdir(photoRoot, { mode: 0o700 });
  const pixels = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQeUAAAAASUVORK5CYII=", "base64");
  await writeFile(path.join(photoRoot, "pixel.png"), pixels, { mode: 0o600 });
  const ids = ["610000000000000000000001", "610000000000000000000002"];
  const input = { version: "private-wardrobe-replay.v1", provenance: { kind: "synthetic-contract-test", capturedAt: "2026-11-09T00:00:00Z", subsetCount: 2, currentClosetParity: false, labelsImported: false, operatorFeedbackOnly: true, caveats: ["Synthetic fixture, no human evidence"], sourceDigests: { returns: "a".repeat(64) } }, photoRoot,
    wardrobe: ids.map((id, index) => ({ id, name: `Synthetic ${index}`, clothingType: index ? "bottom" : "top", subCategory: index ? "pants" : "shirt", colors: ["white", "blue"], pattern: null, fit: null, layerRole: null, warmth: 5, isAvailable: true, photoPath: "pixel.png", photoSha256: sha(pixels), photoMime: "image/png" })),
    drafts: [{ sourceId: "source-a", sourceDigest: "a".repeat(64), jobId: "synthetic-job", attemptIndex: 0, outfitIndex: 0, outfit: { items: [{ itemId: ids[0], role: "base_top" }, { itemId: ids[1], role: "base_bottom" }], styleMove: { moveType: "color", changedItemIds: [ids[0]], oneSentence: "Intact synthetic prose." } } }], factualCorrections: [{ correction_id: "synthetic-color", owner_id: "synthetic-owner", garment_id: ids[0], field: "primary_color", value: "red", source: "synthetic contract", source_ref: "synthetic-original" }] };
  const filename = path.join(root, "fixture.json"); const save = async () => { await writeFile(filename, JSON.stringify(input), { mode: 0o600 }); };
  await save(); return { root, photoRoot, filename, input, save, pixels };
}
test("validates private captured photos and preserves full colors/unknowns without applying derived correction metadata", async t => {
  const f = await fixture(t), loaded = await loadPrivateReplayInput(f.filename);
  assert.deepEqual(loaded.input.wardrobe[0].colors, ["white", "blue"]); assert.equal(loaded.input.wardrobe[0].fit, null);
  assert.equal(loaded.photos.size, 2); assert.equal(loaded.inputDigest, sha(await (await import("node:fs/promises")).readFile(f.filename)));
});
test("rejects photo hash tampering and MIME disagreement", async t => {
  const f = await fixture(t); f.input.wardrobe[0].photoSha256 = "0".repeat(64); await f.save();
  await assert.rejects(loadPrivateReplayInput(f.filename), /checksum mismatch/);
  f.input.wardrobe[0].photoSha256 = sha(f.pixels); f.input.wardrobe[0].photoMime = "image/jpeg"; await f.save();
  await assert.rejects(loadPrivateReplayInput(f.filename), /MIME disagrees/);
});
test("rejects symlink photo escape and active-checkout input", async t => {
  const f = await fixture(t); const outside = path.join(f.root, "outside.png"); await writeFile(outside, f.pixels);
  await symlink(outside, path.join(f.photoRoot, "escape.png")); f.input.wardrobe[0].photoPath = "escape.png"; await f.save();
  await assert.rejects(loadPrivateReplayInput(f.filename), /escapes/);
  await assert.rejects(loadPrivateReplayInput(f.filename, { checkoutRoots: [f.root] }), /outside active/);
});
test("rejects label imports, unapproved input fields and permissive input permissions", async t => {
  const f = await fixture(t); f.input.provenance.labelsImported = true; await f.save();
  await assert.rejects(loadPrivateReplayInput(f.filename), /label import/);
  f.input.provenance.labelsImported = false; f.input.choices = []; await f.save();
  await assert.rejects(loadPrivateReplayInput(f.filename), /unsupported or missing/);
  delete f.input.choices; await f.save(); await chmod(f.filename, 0o644);
  await assert.rejects(loadPrivateReplayInput(f.filename), /deny group\/world/);
});
test("rejects unknown member identities and mismatched source hashes", async t => {
  const f = await fixture(t); f.input.drafts[0].outfit.items[0].itemId = "610000000000000000000099"; await f.save();
  await assert.rejects(loadPrivateReplayInput(f.filename), /member missing/);
  f.input.drafts[0].outfit.items[0].itemId = f.input.wardrobe[0].id; f.input.drafts[0].sourceDigest = "b".repeat(64); await f.save();
  await assert.rejects(loadPrivateReplayInput(f.filename), /source digest/);
});
test("materialization binds images and facts to the fresh owner and never converts derived primary color into full colors", async t => {
  const f = await fixture(t), loaded = await loadPrivateReplayInput(f.filename), inserted = {};
  const db = { collection: name => ({ countDocuments: async () => 0, insertOne: async row => { (inserted[name] ??= []).push(row); } }) };
  const owner = "620000000000000000000001"; await materializePrivateWardrobe(db, owner, loaded);
  assert.equal(inserted.wardrobeitems.length, 2);
  for (let index = 0; index < 2; index++) {
    assert.equal(String(inserted.wardrobeitems[index].user), owner); assert.equal(String(inserted.wardrobeimages[index].user), owner);
    assert.equal(String(inserted.wardrobeimages[index].wardrobeItem), f.input.wardrobe[index].id);
    assert.deepEqual(inserted.wardrobeitems[index].colors, ["white", "blue"]); assert.equal(inserted.wardrobeitems[index].fit, null);
  }
});


test("rejects nested preference payloads and extra fields disguised as factual corrections", async t => {
  const f = await fixture(t), original = structuredClone(f.input.factualCorrections[0]);
  for (const changed of [{ value: { labels: [1] } }, { choices: [] }, { session: {} }, { features: [1] }, { source_ref: { label: "preference" } }, { field: "taste" }, { garment_id: "610000000000000000000099" }]) {
    f.input.factualCorrections = [{ ...original, ...changed }]; await f.save();
    await assert.rejects(loadPrivateReplayInput(f.filename), /correction/);
  }
  f.input.factualCorrections = [{ ...original, previous_value: "blue" }]; await f.save();
  assert.equal((await loadPrivateReplayInput(f.filename)).input.factualCorrections[0].previous_value, "blue");
});
test("honors an additional explicit forbidden export root for inputs and photos", async t => {
  const f = await fixture(t), runningRoot = path.join(f.root, "running-code"); await mkdir(runningRoot);
  await assert.rejects(loadPrivateReplayInput(f.filename, { checkoutRoots: [runningRoot, f.root] }), /outside active/);
  await assert.rejects(loadPrivateReplayInput(f.filename, { checkoutRoots: [runningRoot, f.photoRoot] }), /photo root must be outside/);
});


test("CLI rejects forbidden-root flags outside explicit private mode before service startup", () => {
  const harness = fileURLToPath(new URL("../baseline-browser.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [harness, "--private-forbid-root=/synthetic-export"], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /private forbidden roots require explicit private replay mode/);
  assert.doesNotMatch(result.stdout, /Building isolated|Launching isolated/);
});
