/** First checkpoint only: private captured photos -> actual app request -> intact replay evidence. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ObjectId } from "mongodb";
import { writePrivateReplayReport } from "./private-replay-input.mjs";

export async function annotatePrivateReplay(page, subsetCount) {
  await page.evaluate(count => {
    document.getElementById("private-replay-context")?.remove();
    const note = document.createElement("aside"); note.id = "private-replay-context"; note.setAttribute("role", "note");
    note.textContent = `PRIVATE REPLAY · ${count} captured garments, not current whole-closet parity · preserved candidates · operator feedback only, not the owner's preferences · no new model calls`;
    note.style.cssText = "padding:12px;background:#fff4dc;border:2px solid #845400;color:#392800;font:14px sans-serif;overflow-wrap:anywhere";
    document.body.prepend(note);
  }, subsetCount);
}
export async function runPrivateReplayJourney({ db, page, owner, origin, loaded, run, paceRender }) {
  const report = { version: "private-walkthrough-report.v1", status: "running", checkpoint: "captured-photos-first-request",
    inputSha256: loaded.inputDigest, provenance: loaded.input.provenance, operatorFeedback: [], newProviderCalls: 0,
    annotation: { kind: "harness-only", partOfProductionUI: false, purpose: "Screenshot provenance label inserted by local verification tooling" },
    pending: ["six distinct operator-authored reactions", "concern/clear/explicit inclusion", "profile isolation", "request controls", "factual correction and undo", "availability correction and undo", "plan/wear navigation", "390px walkthrough"] };
  await writePrivateReplayReport(run, report);
  await page.goto(`${origin}/wardrobe`);
  await page.getByRole("button", { name: "Edit", exact: true }).first().waitFor();
  await page.locator("img").evaluateAll(images => images.forEach(image => { image.loading = "eager"; }));
  await page.waitForFunction(expected => { const images = Array.from(document.querySelectorAll("img")); return images.length >= expected && images.every(image => image.complete && image.naturalWidth > 0); }, loaded.input.wardrobe.length);
  await annotatePrivateReplay(page, loaded.input.wardrobe.length);
  await page.screenshot({ path: path.join(run.runDirectory, "01-captured-wardrobe.png"), fullPage: true });
  await page.goto(`${origin}/dashboard`);
  const panel = page.getByRole("region", { name: "Saved style direction", exact: true });
  async function mutate(action) {
    const [response] = await Promise.all([page.waitForResponse(response => response.url().endsWith("/api/style-memory") && response.request().method() === "POST"), action()]);
    const body = await response.json(); assert.equal(response.status(), 200, "local style context must acknowledge the visible action"); return body.state;
  }
  const boardLabel = "Private replay · operator check", routineLabel = "Preserved class-day replay";
  await panel.getByRole("button", { name: "New direction", exact: true }).click();
  await panel.getByLabel("Saved choice name", { exact: true }).fill(boardLabel);
  await panel.getByLabel("Style word or phrase", { exact: true }).fill("operator replay verification");
  await panel.getByRole("button", { name: "Add style phrase", exact: true }).click();
  await panel.getByRole("button", { name: "Review direction", exact: true }).click();
  const boards = await mutate(() => panel.getByRole("button", { name: "Save direction", exact: true }).click());
  const board = boards.boards.find(row => row.label === boardLabel);
  await panel.getByRole("button", { name: "New situation", exact: true }).click();
  await panel.getByLabel("Saved choice name", { exact: true }).fill(routineLabel);
  const routines = await mutate(() => panel.getByRole("button", { name: "Save situation", exact: true }).click());
  const routine = routines.routines.find(row => row.label === routineLabel);
  await mutate(() => panel.getByRole("combobox", { name: "Style direction", exact: true }).selectOption(board.id));
  await mutate(() => panel.getByRole("combobox", { name: "Saved situation", exact: true }).selectOption(routine.id));
  const optIn = panel.getByRole("checkbox", { name: `Use experimental taste learning for ${boardLabel} / ${routineLabel}`, exact: true });
  assert.equal(await optIn.isChecked(), false, "new context starts opted out");
  await mutate(() => optIn.click());
  await page.waitForFunction(() => document.querySelector('section[aria-label="Saved style direction"] input[type="checkbox"]')?.checked === true);
  assert.equal(await optIn.isChecked(), true, "controlled opt-in reflects its acknowledged state");
  await page.locator("textarea").fill("Preserved class-day candidates · operator replay, not fresh styling");
  await page.getByRole("combobox", { name: "Temperature", exact: true }).selectOption("mild");
  await paceRender();
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/recommend") && response.request().method() === "POST"),
    page.getByRole("button", { name: "Get Recommendations", exact: true }).click(),
  ]);
  const result = await response.json(); assert.equal(response.status(), 200, "private request must traverse the local recommendation route");
  assert.ok(result.bindable && result.shown?.length > 0, "preserved bank must supply at least one actual app option");
  const request = response.request().postDataJSON();
  const row = await db.collection("generationsnapshots").findOne({ user: new ObjectId(owner.userId), requestId: request.requestId });
  assert.ok(row?.generationAttempts?.length, "actual production-shaped snapshot must retain replay generation evidence");
  assert.equal(row.styleContext.boardId, board.id); assert.equal(row.styleContext.routineId, routine.id);
  assert.equal(row.preference.support, 0, "no old or operator labels have been imported");
  const audit = (await readFile(run.auditPath, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const originalById = new Map(loaded.input.drafts.map(draft => [draft.sourceId, draft]));
  assert.ok(audit.length > 0 && audit.every(event => event.inputSha256 === loaded.inputDigest), "source selection pins this validated input");
  const selected = audit.at(-1).selected.map(source => {
    const original = originalById.get(source.sourceId);
    assert.ok(original && original.sourceDigest === source.sourceDigest, "every selected draft has the preserved source digest"); return original.outfit;
  });
  assert.deepEqual(JSON.parse(row.generationAttempts.at(-1).rawText).outfits, selected, "replay preserves original item membership, roles and prose intact");
  await page.waitForFunction(snapshotId => Array.from(document.querySelectorAll("a")).some(link => link.getAttribute("href")?.includes(`snapshotId=${snapshotId}`)), result.shown[0].snapshotId);
  const cards = page.locator(".p-5.border.rounded-xl").filter({ has: page.getByRole("button", { name: "Regenerate", exact: true }) });
  assert.equal(await cards.count(), result.shown.length);
  const capturedIds = new Set(loaded.input.wardrobe.filter(garment => garment.isAvailable).map(garment => garment.id));
  for (let index = 0; index < result.shown.length; index++) {
    const outfit = result.shown[index]; assert.ok(outfit.displayItems.every(item => capturedIds.has(item.itemId)), "displayed members remain inside the captured available subset");
    assert.deepEqual((await cards.nth(index).locator(".grid p.font-medium").allTextContents()).map(name => name.trim()).sort(), outfit.displayItems.map(item => item.name).sort(), "visible garment membership matches actual response order");
  }
  const responseMembers = result.shown.flatMap(outfit => outfit.displayItems);
  assert.ok(responseMembers.length > 0 && responseMembers.every(item => typeof item.imageUrl === "string" && item.imageUrl.startsWith("/api/images/")), "every response member has an owner-bound materialized photo reference");
  await cards.locator("img").evaluateAll(images => images.forEach(image => { image.loading = "eager"; }));
  await page.waitForFunction(expected => {
    const images = Array.from(document.querySelectorAll(".p-5.border.rounded-xl img"));
    return images.length === expected && images.every(image => image.complete && image.naturalWidth > 0);
  }, responseMembers.length);
  assert.equal(await cards.locator("img").count(), responseMembers.length, "every displayed member rendered its decoded image");
  await annotatePrivateReplay(page, loaded.input.wardrobe.length);
  await page.screenshot({ path: path.join(run.runDirectory, "02-first-replayed-outfits.png"), fullPage: true });
  Object.assign(report, { status: "first-slice-passed", completedAt: new Date().toISOString(), verifiedPhotoCount: loaded.input.wardrobe.length,
    firstRequest: { requestId: request.requestId, snapshotId: String(row._id), shownCandidateIds: row.shownCandidateIds,
      shownGarmentIds: result.shown.map(outfit => outfit.displayItems.map(item => item.itemId)), preference: row.preference },
    sourceSelections: audit, screenshots: ["01-captured-wardrobe.png", "02-first-replayed-outfits.png"] });
  await writePrivateReplayReport(run, report);
  return report;
}
