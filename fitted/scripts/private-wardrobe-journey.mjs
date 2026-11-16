import { runPrivateWardrobeContinuation } from "./private-wardrobe-continuation.mjs";
/** Opt-in faithful wardrobe correction stage. Writes only through the actual local UI. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ObjectId } from "mongodb";
import { writePrivateReplayReport } from "./private-replay-input.mjs";
import { stableJson } from "./private-feedback-contract.mjs";
import { verifyCapturedRender, verifyIntactAttempts } from "./private-feedback-verification.mjs";
import { wardrobeExpectation, verifyStoredWardrobe, verifyFaithfulCapture, verifyOriginalPhoto, verifyWardrobeAck } from "./private-wardrobe-verification.mjs";

export async function runPrivateWardrobeJourney({ db, page, owner, origin, loaded, run, report, first, paceRender, annotate, privateWardrobeFull = false }) {
  const user = new ObjectId(owner.userId), frozenInput = stableJson(loaded.input);
  const readWardrobe = () => db.collection("wardrobeitems").find({ user }).sort({ _id: 1 }).toArray();
  const initial = await readWardrobe(), snapshots = [first.row];
  const context = first.row.styleContext, available = new Set(loaded.input.wardrobe.filter(item => item.isAvailable).map(item => item.id));
  const supply = new Map();
  for (const draft of loaded.input.drafts) {
    const ids = draft.outfit.items.map(item => item.itemId);
    if (ids.every(id => available.has(id))) supply.set([...ids].sort().join("|"), ids);
  }
  const targetId = first.result.shown.flatMap(shown => first.row.candidates.find(row => row.candidateId === shown.candidateId)?.items ?? [])
    .find(item => item.role === "base_top" && loaded.input.wardrobe.find(row => row.id === item.itemId)?.fit === null &&
      [...supply.values()].filter(ids => ids.includes(item.itemId)).length >= 2 && [...supply.values()].filter(ids => !ids.includes(item.itemId)).length >= 3)?.itemId;
  const phase = report.wardrobe = { version: "private-wardrobe-journey.v1", status: "running", complete: false, stage: "facts-and-availability",
    operatorProvenance: "Hypothetical operator Fit correction and availability checks, not owner fit/preferences or real wear", maximumRenderRequests: 3,
    renderRequests: 0, steps: [], renders: [], targetId: targetId ?? null };
  report.status = "checking-private-wardrobe";
  report.pending = ["facts/availability stage", "request controls and plan/wear navigation", "Home/390px outside this walkthrough"];
  const persist = async () => { assert.equal(stableJson(loaded.input), frozenInput, "original fixture stays immutable"); await writePrivateReplayReport(run, report); };
  if (!targetId) { phase.status = "incomplete-supply"; await persist(); return report; }
  const target = loaded.input.wardrobe.find(item => item.id === targetId);
  const rawTarget = initial.find(item => String(item._id) === targetId);
  assert.equal(await db.collection("outfitinteractions").countDocuments({ user }), 0);
  const audit = async () => (await readFile(run.auditPath, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const firstAudit = await audit(); verifyIntactAttempts(first.row, firstAudit, loaded); let auditOffset = firstAudit.length;
  const requestIds = new Set([first.request.requestId]);
  async function preserved() {
    for (const snapshot of snapshots) assert.deepEqual(await db.collection("generationsnapshots").findOne({ _id: snapshot._id, user }), snapshot, "each earlier generation remains byte-stable");
    assert.equal(await db.collection("outfitinteractions").countDocuments({ user }), 0, "wardrobe commands never invent taste labels");
    for (const garment of loaded.input.wardrobe) {
      const original = initial.find(item => String(item._id) === garment.id), image = await db.collection("wardrobeimages").findOne({ _id: new ObjectId(original.imagePath.slice(6)), user });
      assert.ok(image); verifyOriginalPhoto(image, garment, original.imagePath, owner.userId);
    }
  }
  const targetPhoto = `/api/images/${rawTarget.imagePath.slice(6)}`;
  const card = () => page.locator("div.relative.overflow-hidden.rounded-xl")
    .filter({ has: page.getByRole("button", { name: /^Mark (?:un)?available$/ }) })
    .filter({ has: page.locator(`img[src="${targetPhoto}"]`) });
  async function openGarment() {
    await page.goto(`${origin}/wardrobe?itemId=${targetId}`);
    await page.getByRole("region", { name: "Current garment", exact: true }).getByRole("heading", { name: target.name, exact: true }).waitFor();
  }
  async function editFit(value, semanticFit) {
    await openGarment();
    await page.getByRole("region", { name: "Current garment", exact: true }).getByRole("button", { name: "Edit this garment", exact: true }).click();
    await page.getByText("More details (optional)", { exact: true }).click();
    await page.getByLabel("Fit", { exact: true }).selectOption(value);
    const [response] = await Promise.all([page.waitForResponse(r => r.url().endsWith(`/api/wardrobe/${targetId}`) && r.request().method() === "PATCH"), page.getByRole("button", { name: "Save item", exact: true }).click()]);
    assert.equal(response.status(), 200); assert.deepEqual(response.request().postDataJSON(), { fit: value });
    const receipt = await response.json(); verifyWardrobeAck(rawTarget, receipt.item, { fit: value, isAvailable: true });
    await page.getByRole("button", { name: "Save item", exact: true }).waitFor({ state: "detached" });
    const current = await readWardrobe(); verifyStoredWardrobe(initial, current, targetId, { fit: value, isAvailable: true });
    phase.steps.push({ kind: value ? "operator-fit-correction" : "clear-fit-undo", request: { fit: value }, semanticFit, acknowledged: true });
    await preserved(); await persist();
  }
  async function availability(value) {
    await openGarment();
    // The availability action is on the same exact card; its image identifies it even
    // while its rescue link is absent after exclusion from recommendations.
    const ownedCard = card();
    assert.equal(await ownedCard.count(), 1);
    const [response] = await Promise.all([page.waitForResponse(r => r.url().endsWith(`/api/wardrobe/${targetId}`) && r.request().method() === "PATCH"), ownedCard.getByRole("button", { name: value ? "Mark available" : "Mark unavailable", exact: true }).click()]);
    assert.equal(response.status(), 200); assert.deepEqual(response.request().postDataJSON(), { isAvailable: value });
    verifyWardrobeAck(rawTarget, (await response.json()).item, { fit: "", isAvailable: value });
    await ownedCard.getByRole("button", { name: value ? "Mark unavailable" : "Mark available", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("region", { name: "Current garment", exact: true }).getByRole("heading", { name: target.name, exact: true }).waitFor();
    verifyStoredWardrobe(initial, await readWardrobe(), targetId, { fit: "", isAvailable: value });
    phase.steps.push({ kind: value ? "restore-availability" : "mark-unavailable", request: { isAvailable: value }, acknowledged: true });
    await preserved(); await persist();
  }
  async function verifyVisible(row, result) {
    await page.waitForFunction(id => [...document.querySelectorAll("a")].some(link => link.getAttribute("href")?.includes(`snapshotId=${id}`)), String(row._id));
    const cards = page.locator(".p-5.border.rounded-xl").filter({ has: page.getByRole("button", { name: "Regenerate", exact: true }) });
    assert.equal(await cards.count(), result.shown.length);
    for (let i = 0; i < result.shown.length; i++) {
      const visible = await cards.nth(i).locator(".grid > div").evaluateAll(pieces => pieces.map(piece => ({
        name: piece.querySelector("p.font-medium")?.textContent?.trim(),
        photo: piece.querySelector("img")?.getAttribute("src"), alt: piece.querySelector("img")?.getAttribute("alt"),
      })).sort((a,b) => a.photo.localeCompare(b.photo)));
      const expected = result.shown[i].displayItems.map(item => ({ name: item.name.trim(), photo: item.imageUrl, alt: item.name })).sort((a,b) => a.photo.localeCompare(b.photo));
      assert.deepEqual(visible, expected, "each visible name is paired with its exact owned response photo");
    }
    await cards.locator("img").evaluateAll(images => images.forEach(image => { image.loading = "eager"; }));
    const count = result.shown.reduce((sum, outfit) => sum + outfit.displayItems.length, 0);
    await page.waitForFunction(count => { const images = [...document.querySelectorAll(".p-5.border.rounded-xl img")]; return images.length === count && images.every(image => image.complete && image.naturalWidth > 0); }, count);
  }
  async function render(kind, semanticFit, isAvailable, rescue) {
    assert.ok(phase.renderRequests < 3, "stage-one render limit is fixed at three");
    if (rescue) { await card().getByRole("link", { name: "Build an outfit around this", exact: true }).click(); }
    else await page.getByRole("link", { name: "Home", exact: true }).click();
    const expected = wardrobeExpectation(loaded.input, targetId, { fit: semanticFit, isAvailable });
    await page.locator("textarea").fill(first.request.occasion);
    await page.getByRole("combobox", { name: "Temperature", exact: true }).selectOption("mild");
    const button = page.getByRole("button", { name: "Get Recommendations", exact: true }); await button.waitFor();
    await paceRender(); phase.renderRequests++;
    const [response] = await Promise.all([page.waitForResponse(r => r.url().endsWith("/api/recommend") && r.request().method() === "POST"), button.click()]);
    const result = await response.json(), request = response.request().postDataJSON(); assert.equal(response.status(), 200);
    assert.equal(request.forcedItemId ?? null, rescue ? targetId : null); assert.ok(!request.parentSnapshotId);
    assert.ok(!requestIds.has(request.requestId)); requestIds.add(request.requestId);
    const row = await db.collection("generationsnapshots").findOne({ user, requestId: request.requestId });
    assert.ok(row); const events = await audit();
    const attemptEvents = events.slice(auditOffset);
    verifyCapturedRender({ row, result, request, loaded: { ...loaded, input: expected }, context, events: attemptEvents, ownerId: owner.userId }); auditOffset = events.length;
    verifyFaithfulCapture(row, result, expected, await readWardrobe(), { forcedItemId: rescue ? targetId : null, poolDigests: attemptEvents.map(event => event.poolSha256) });
    if (rescue) assert.ok(result.shown.every(outfit => outfit.displayItems.some(item => item.itemId === targetId)));
    if (!isAvailable) assert.ok(result.shown.every(outfit => outfit.displayItems.every(item => item.itemId !== targetId)));
    await verifyVisible(row, result);
    snapshots.push(row); await preserved();
    const filename = `wardrobe-${phase.renderRequests}-${kind}.png`; await annotate(); await page.screenshot({ path: path.join(run.runDirectory, filename), fullPage: true }); report.screenshots.push(filename);
    phase.renders.push({ kind, requestId: request.requestId, snapshotId: String(row._id), shownGarmentIds: result.shown.map(outfit => outfit.displayItems.map(item => item.itemId)), authoredExpectation: { fit: semanticFit, isAvailable }, screenshot: filename });
    await persist(); return { row, request, result };
  }
  verifyFaithfulCapture(first.row, first.result, loaded.input, initial, { poolDigests: firstAudit.map(event => event.poolSha256) });
  await verifyVisible(first.row, first.result);
  await preserved(); await persist();
  await editFit("Relaxed", "Relaxed"); await render("corrected-fit-rescue", "Relaxed", true, true);
  await editFit("", null); await availability(false); await render("unavailable-daily", null, false, false);
  await availability(true); const last = await render("restored-rescue", null, true, true);
  phase.complete = true; phase.status = "facts-and-availability-passed"; report.status = "private-wardrobe-stage-one-passed";
  phase.limits = ["Operator hypothetical cut correction, not owner truth", "Raw Fit cleared to empty; engine unknown restored to null", "Controls and plan/wear navigation remain the next stage", "Home unchanged"];
  report.sourceSelections = await audit();
  report.pending = ["request controls and plan/wear navigation", "Home/390px outside this walkthrough"];
  await persist();
  if (privateWardrobeFull) return runPrivateWardrobeContinuation({ db, page, owner, origin, loaded, run, report, first, last, targetId, paceRender, annotate, verifyVisible, preserved, readWardrobe });
  return report;
}
