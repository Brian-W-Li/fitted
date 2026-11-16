/** Four-render operator-only continuation: controls, intent, simulated wear and correction.
 * Every mutation uses the mounted UI; Mongo is assertion-only. No owner judgments are authored.
 * ACK boundaries: modal reconciled; plan status/date reconciled; wear receipt + fresh correction
 * control enabled. A correction's undo is a new revision, never deletion of prior evidence. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ObjectId } from "mongodb";
import { stableJson } from "./private-feedback-contract.mjs";
import { verifyCapturedRender } from "./private-feedback-verification.mjs";
import { verifyFaithfulCapture } from "./private-wardrobe-verification.mjs";
import { writePrivateReplayReport } from "./private-replay-input.mjs";

const idsOf = outfit => outfit.items.map(item => String(item.itemId)).sort();
const sameIds = (left, right) => stableJson([...left].sort()) === stableJson([...right].sort());
const sourceUrl = (origin, row, candidate) => `${origin}/memory/proposal?snapshotId=${row._id}&candidateId=${encodeURIComponent(candidate.candidateId)}`;
class SupplyUnavailable extends Error {}

export async function runPrivateWardrobeContinuation({ db, page, owner, origin, loaded, run, report, first, last, targetId, paceRender, annotate, verifyVisible, preserved, readWardrobe }) {
  const user = new ObjectId(owner.userId), baselineWardrobe = await readWardrobe(), frozenInput = stableJson(loaded.input), context = structuredClone(first.row.styleContext);
  const phase = report.continuation = { version: "private-wardrobe-continuation.v1", complete: false, status: "running", maximumRenderRequests: 4,
    renderRequests: 0, renders: [], steps: [], operatorProvenance: "Simulated operator plan/wear records, unknown outcomes; not owner history, preferences or satisfaction",
    limits: ["One owned shoe is present in every preserved draft: sticky Keep is proved by controls and membership, not a shoe-drop counterfactual", "Home UX remains outside this walkthrough"] };
  const owned = new Map(loaded.input.wardrobe.filter(item => item.isAvailable).map(item => [item.id, item]));
  const bank = [...new Map(loaded.input.drafts.filter(draft => draft.outfit.items.every(item => owned.has(item.itemId))).map(draft => [idsOf(draft.outfit).join("|"), draft.outfit])).values()];
  const initialSnapshotCount = await db.collection("generationsnapshots").countDocuments({ user });
  const retained = [], requests = new Set([first.request.requestId, last.request.requestId]);
  const audit = async () => (await readFile(run.auditPath, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  let offset = (await audit()).length, invalidated = null, frozenPlans = null;
  const persist = async () => { assert.equal(stableJson(loaded.input), frozenInput); report.sourceSelections = await audit(); await writePrivateReplayReport(run, report); };
  const incomplete = async reason => { phase.status = "incomplete-supply"; phase.reason = reason; report.status = "private-wardrobe-continuation-incomplete"; await persist(); return report; };
  async function unchanged() {
    if (frozenPlans) assert.deepEqual((await db.collection("users").findOne({ _id: user }, { projection: { outfitPlans: 1 } })).outfitPlans, frozenPlans, "wear and corrections preserve the complete plan ledger");
    await preserved(); assert.equal(await db.collection("generationsnapshots").countDocuments({ user }), initialSnapshotCount + retained.length, "each new snapshot belongs to a recorded UI render"); assert.deepEqual(await readWardrobe(), baselineWardrobe, "continuation never changes wardrobe facts or availability");
    assert.equal(await db.collection("outfitinteractions").countDocuments({ user }), 0, "no feedback is authored");
    for (const row of retained) {
      const actual = await db.collection("generationsnapshots").findOne({ _id: row._id, user });
      if (invalidated && String(row._id) === String(invalidated)) {
        assert.equal(actual.redacted, true); assert.equal(actual.redactionReason, "experience_changed"); assert.ok(actual.redactedAt instanceof Date);
        const a = { ...actual }, b = { ...row };
        for (const key of ["redacted", "redactedAt", "redactionReason"]) { delete a[key]; delete b[key]; }
        assert.deepEqual(a, b, "only report-derived invalidation metadata changes");
      } else assert.deepEqual(actual, row, "earlier generated evidence stays byte-stable");
    }
  }
  const dashboardCards = () => page.locator(".p-5.border.rounded-xl").filter({ has: page.getByRole("button", { name: "Regenerate", exact: true }) });
  async function dashboardCard(render, candidate) {
    const card = dashboardCards().filter({ has: page.locator(`a[href*="snapshotId=${render.row._id}"][href*="candidateId=${candidate.candidateId}"]`) });
    assert.equal(await card.count(), 1); return card;
  }
  const modal = () => page.getByRole("heading", { name: "Regenerate", exact: true }).locator("../..");
  const pieceRow = (scope, itemId) => scope.locator("div.p-3.rounded-lg.border.flex").filter({ has: page.locator(`img[src="/api/images/${baselineWardrobe.find(item => String(item._id) === itemId).imagePath.slice(6)}"]`) });
  async function enabled(control) { await control.waitFor(); await page.waitForFunction(element => !element.disabled, await control.elementHandle()); }
  async function inlineVisible(render) {
    const region = page.getByRole("region", { name: "New outfit proposals", exact: true });
    const cards = region.getByRole("article"); await region.waitFor(); assert.equal(await cards.count(), render.result.shown.length);
    for (const outfit of render.result.shown) {
      const card = cards.filter({ has: page.locator(`a[href*="snapshotId=${render.row._id}"][href*="candidateId=${outfit.candidateId}"]`) }); assert.equal(await card.count(), 1);
      const pairs = await card.locator("ul > li").evaluateAll(rows => rows.map(row => ({ name: row.querySelector("span")?.textContent?.trim(), photo: row.querySelector("img")?.getAttribute("src"), alt: row.querySelector("img")?.getAttribute("alt") })).sort((a,b) => a.photo.localeCompare(b.photo)));
      assert.deepEqual(pairs, outfit.displayItems.map(item => ({ name: item.name.trim(), photo: item.imageUrl, alt: item.name })).sort((a,b) => a.photo.localeCompare(b.photo)));
    }
    await cards.locator("img").evaluateAll(images => images.forEach(image => { image.loading = "eager"; }));
    const count = render.result.shown.reduce((sum, outfit) => sum + outfit.displayItems.length, 0); assert.ok(count > 0);
    await page.waitForFunction(({ count, snapshotId }) => { const region = document.querySelector('[aria-label="New outfit proposals"]'); const images = [...(region?.querySelectorAll("article img") ?? [])]; return region?.querySelector(`a[href*="snapshotId=${snapshotId}"]`) && images.length === count && images.every(image => image.complete && image.naturalWidth > 0); }, { count, snapshotId: String(render.row._id) });
  }
  async function render(kind, submit, expectedContext = context, inline = false) {
    assert.ok(phase.renderRequests < 4, "four explicit render requests only"); await paceRender(); phase.renderRequests++;
    const [response] = await Promise.all([page.waitForResponse(r => r.url().endsWith("/api/recommend") && r.request().method() === "POST"), submit()]);
    const result = await response.json(), request = response.request().postDataJSON(); assert.equal(response.status(), 200);
    if (Array.isArray(result.shown) && result.shown.length === 0) throw new SupplyUnavailable(`No complete shown composition for ${kind} within the unchanged replay cap`);
    assert.ok(result.bindable && result.shown?.length, "preserved supply must yield a complete normal render"); assert.ok(!requests.has(request.requestId)); requests.add(request.requestId);
    const row = await db.collection("generationsnapshots").findOne({ user, requestId: request.requestId }); assert.ok(row);
    const events = (await audit()).slice(offset); offset += events.length;
    verifyCapturedRender({ row, result, request, loaded, context: expectedContext, events, ownerId: owner.userId });
    verifyFaithfulCapture(row, result, loaded.input, await readWardrobe(), { forcedItemId: row.forcedItemId ?? null, poolDigests: events.map(event => event.poolSha256) });
    const value = { row, result, request };
    if (inline) await inlineVisible(value); else { await verifyVisible(row, result); await page.getByRole("heading", { name: "Regenerate", exact: true }).waitFor({ state: "detached" }); }
    retained.push(row); await unchanged();
    const filename = `wardrobe-continuation-${phase.renderRequests}-${kind}.png`; await annotate(); await page.screenshot({ path: path.join(run.runDirectory, filename), fullPage: true }); report.screenshots.push(filename);
    phase.renders.push({ kind, requestId: request.requestId, snapshotId: String(row._id), shownCandidateIds: row.shownCandidateIds, shownGarmentIds: result.shown.map(outfit => outfit.displayItems.map(item => item.itemId)), screenshot: filename });
    await persist(); return value;
  }
  async function postClick(pathname, method, click) {
    const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === pathname && r.request().method() === method), click()]);
    const receipt = await response.json(); assert.equal(response.status(), 200); return { receipt, command: response.request().postDataJSON() };
  }
  try {
  await unchanged();
  const source = last.result.shown.map(shown => last.row.candidates.find(candidate => candidate.candidateId === shown.candidateId)).find(candidate => {
    const bottom = candidate.items.find(item => item.role === "base_bottom"), shoe = candidate.items.find(item => item.role === "shoes");
    return bottom && shoe && shoe.itemId !== targetId && bank.some(outfit => outfit.items.some(item => item.itemId === targetId) && outfit.items.some(item => item.itemId === shoe.itemId) && outfit.items.every(item => item.itemId !== bottom.itemId));
  });
  if (!source) return incomplete("No actually shown rescue supports nonforced shoe Keep plus a replaceable bottom");
  const shoeId = source.items.find(item => item.role === "shoes").itemId, avoidId = source.items.find(item => item.role === "base_bottom").itemId;
  phase.supply = { sourceCandidateId: source.candidateId, explicitKeepItemId: shoeId, avoidItemId: avoidId, forcedTopId: targetId };
  await (await dashboardCard(last, source)).getByRole("button", { name: "Regenerate", exact: true }).click();
  for (const id of [shoeId, avoidId]) { const item = source.items.find(item => item.itemId === id), shown = last.result.shown.find(candidate => candidate.candidateId === source.candidateId).displayItems.find(item => item.itemId === id); const row = pieceRow(modal(), id); assert.equal(await row.count(), 1); assert.equal(await row.locator("img").getAttribute("src"), shown.imageUrl); assert.ok(item); }
  await pieceRow(modal(), shoeId).getByRole("button", { name: "Keep", exact: true }).click();
  await pieceRow(modal(), avoidId).getByRole("button", { name: "Avoid", exact: true }).click();
  await enabled(modal().getByRole("button", { name: "Regenerate", exact: true }));
  const kept = await render("keep-shoe-avoid-bottom", () => modal().getByRole("button", { name: "Regenerate", exact: true }).click());
  assert.equal(kept.request.parentSnapshotId, String(last.row._id)); assert.deepEqual(kept.request.controls, { lockedItemIds: [shoeId], dislikedItemIds: [avoidId] });
  assert.equal(String(kept.row.parentSnapshotId), String(last.row._id)); assert.equal(kept.row.generationIndex, last.row.generationIndex + 1); assert.equal(kept.row.forcedItemId, targetId);
  assert.deepEqual(kept.row.controls.lockedItemIds, [shoeId]); assert.deepEqual(kept.row.controls.dislikedItemIds, [avoidId]);
  assert.ok(kept.result.shown.every(outfit => outfit.displayItems.some(item => item.itemId === shoeId) && outfit.displayItems.every(item => item.itemId !== avoidId)));
  const keptCandidate = kept.row.candidates.find(candidate => candidate.candidateId === kept.result.shown[0].candidateId);
  await (await dashboardCard(kept, keptCandidate)).getByRole("button", { name: "Regenerate", exact: true }).click();
  await pieceRow(modal(), shoeId).getByRole("button", { name: "Keeping", exact: true }).waitFor(); assert.equal(await modal().getByRole("button", { name: "Avoiding", exact: true }).count(), 0);
  await enabled(modal().getByRole("button", { name: "Regenerate", exact: true }));
  const sticky = await render("sticky-shoe-avoid-reset", () => modal().getByRole("button", { name: "Regenerate", exact: true }).click());
  assert.equal(sticky.request.parentSnapshotId, String(kept.row._id)); assert.deepEqual(sticky.request.controls, { lockedItemIds: [shoeId], dislikedItemIds: [] });
  assert.equal(String(sticky.row.parentSnapshotId), String(kept.row._id)); assert.equal(sticky.row.generationIndex, kept.row.generationIndex + 1); assert.equal(sticky.row.forcedItemId, targetId);
  assert.deepEqual(sticky.row.controls.lockedItemIds, [shoeId]); assert.deepEqual(sticky.row.controls.dislikedItemIds, []);
  assert.ok(sticky.row.itemSnapshots.some(item => String(item.itemId) === avoidId), "previous Avoid is eligible again, without requiring it to surface");
  assert.ok(sticky.result.shown.every(outfit => outfit.displayItems.some(item => item.itemId === shoeId)));
  const exploreSource = sticky.row.candidates.find(candidate => candidate.candidateId === sticky.result.shown[0].candidateId);
  if (!bank.some(outfit => outfit.items.some(item => item.itemId === targetId) && !sameIds(idsOf(outfit), idsOf(exploreSource)))) return incomplete("No preserved alternate exact composition for Explore");
  const stickyUrl = sourceUrl(origin, sticky.row, exploreSource); await page.goto(stickyUrl); await page.getByRole("heading", { name: "Saved proposal", exact: true }).waitFor();
  await page.getByRole("button", { name: "Make another outfit", exact: true }).click();
  await page.getByLabel("Keep this piece", { exact: true }).selectOption(targetId);
  const exploreToggle = page.getByLabel("Explore the saved situation", { exact: true }); await exploreToggle.click(); assert.equal(await exploreToggle.isChecked(), true);
  assert.equal(await page.getByLabel("Saved situation", { exact: true }).inputValue(), sticky.row.occasion); assert.equal(await page.getByLabel("Saved situation", { exact: true }).isDisabled(), true);
  await enabled(page.getByRole("button", { name: "Find another combination", exact: true }));
  const explored = await render("explore-saved-proposal", () => page.getByRole("button", { name: "Find another combination", exact: true }).click(), context, true);
  assert.equal(explored.request.parentSnapshotId, String(sticky.row._id)); assert.deepEqual(explored.request.variation, { mode: "explore", sourceCandidateId: exploreSource.candidateId, anchorItemId: targetId, occasion: sticky.row.occasion });
  assert.equal(String(explored.row.parentSnapshotId), String(sticky.row._id)); assert.equal(explored.row.generationIndex, sticky.row.generationIndex + 1);
  assert.deepEqual(explored.row.controls.lockedItemIds, []); assert.deepEqual(explored.row.controls.dislikedItemIds, []);
  assert.equal(explored.row.variationSourceCandidateId, exploreSource.candidateId); assert.deepEqual(explored.row.controls.excludedOutfitItemIds, idsOf(exploreSource));
  assert.equal(explored.row.occasion, sticky.row.occasion); assert.equal(explored.row.weather, sticky.row.weather); assert.equal(explored.row.weatherRaw, sticky.row.weatherRaw);
  assert.ok(explored.result.shown.every(outfit => outfit.displayItems.some(item => item.itemId === targetId) && !sameIds(outfit.displayItems.map(item => item.itemId), idsOf(exploreSource))));
  const proposal = explored.row.candidates.find(candidate => candidate.candidateId === explored.result.shown[0].candidateId), bottomA = proposal.items.find(item => item.role === "base_bottom").itemId;
  const bottomB = [...owned.values()].find(item => item.clothingType === "bottom" && item.id !== bottomA && bank.some(outfit => outfit.items.some(member => member.itemId === item.id)));
  if (!bottomB) return incomplete("No distinct owned bottom with preserved bank supply for simulated actual wear");
  const proposalUrl = sourceUrl(origin, explored.row, proposal); await page.goto(proposalUrl); await page.getByRole("heading", { name: "Saved proposal", exact: true }).waitFor();
  const planRows = async () => (await db.collection("users").findOne({ _id: user }, { projection: { outfitPlans: 1 } })).outfitPlans ?? [];
  const experienceCount = await db.collection("outfitexperiences").countDocuments({ user }); assert.equal(experienceCount, 0);
  const dates = ["2099-10-11", "2099-10-12", "2099-10-13"];
  async function plan(day) {
    await page.getByRole("button", { name: "Plan this outfit", exact: true }).click(); await page.getByLabel("Plan for", { exact: true }).fill(day);
    const ack = await postClick("/api/plans", "POST", () => page.getByRole("button", { name: "Save plan", exact: true }).click());
    assert.equal(ack.command.snapshotId, String(explored.row._id)); assert.equal(ack.command.candidateId, proposal.candidateId); assert.equal(ack.command.plannedFor, day);
    assert.equal(ack.receipt.planId, ack.command.planId); assert.equal(ack.receipt.plannedFor, day);
    const savedStatus = page.getByRole("status").filter({ hasText: `Planned for ${day}. This is intent, not a wear report.` });
    await savedStatus.waitFor(); await savedStatus.getByRole("link", { name: "View planned outfits", exact: true }).click();
    await page.getByRole("heading", { name: `Planned for ${day}`, exact: true }).waitFor();
    const stored = (await planRows()).find(row => row.planId === ack.command.planId); assert.ok(stored); assert.equal(String(stored.snapshotId), String(explored.row._id)); assert.equal(stored.candidateId, proposal.candidateId);
    phase.steps.push({ kind: "plan-create", command: ack.command, receipt: ack.receipt }); await persist();
    await unchanged(); assert.equal(await db.collection("outfitexperiences").countDocuments({ user }), experienceCount); return ack;
  }
  const planned = await plan(dates[0]);
  const planCard = () => page.getByRole("article").filter({ has: page.locator(`a[href*="snapshotId=${explored.row._id}"][href*="candidateId=${proposal.candidateId}"]`) });
  assert.equal(await planCard().count(), 1); await planCard().getByLabel("Change planned day", { exact: true }).fill(dates[1]);
  const rescheduled = await postClick(`/api/plans/${planned.command.planId}`, "PATCH", () => planCard().getByRole("button", { name: "Save new date", exact: true }).click());
  assert.equal(rescheduled.command.expectedRevision, planned.receipt.revision); assert.equal(rescheduled.command.plannedFor, dates[1]);
  assert.equal(rescheduled.receipt.revision, planned.receipt.revision + 1); assert.equal(rescheduled.receipt.plannedFor, dates[1]);
  const moved = (await planRows()).find(row => row.planId === planned.command.planId); assert.equal(moved.plannedFor, dates[1]); assert.equal(moved.revision, rescheduled.receipt.revision);
  phase.steps.push({ kind: "plan-reschedule", command: rescheduled.command, receipt: rescheduled.receipt }); await persist();
  await page.getByRole("heading", { name: `Planned for ${dates[1]}`, exact: true }).waitFor(); await enabled(planCard().getByRole("button", { name: "Remove plan", exact: true }));
  const removed = await postClick(`/api/plans/${planned.command.planId}`, "DELETE", () => planCard().getByRole("button", { name: "Remove plan", exact: true }).click());
  assert.deepEqual(removed.receipt, { removed: true }); phase.steps.push({ kind: "plan-remove", planId: planned.command.planId, receipt: removed.receipt });
  await page.getByText("No planned outfits yet.", { exact: false }).waitFor(); assert.equal((await planRows()).find(row => row.planId === planned.command.planId).lifecycle, "removed");
  await page.goto(proposalUrl); const replanned = await plan(dates[2]); assert.notEqual(replanned.command.planId, planned.command.planId);
  frozenPlans = await planRows();
  phase.steps.push({ kind: "plan-reschedule-remove-replan", firstPlanId: planned.command.planId, secondPlanId: replanned.command.planId, days: dates, acknowledged: true });
  await planCard().getByRole("link", { name: "Open proposal / report actual wear", exact: true }).click();
  await page.getByRole("button", { name: "Report what I wore", exact: true }).click();
  await page.getByRole("radio", { name: "I changed some pieces", exact: true }).click();
  const oldBottomControl = page.getByRole("checkbox", { name: owned.get(bottomA).name, exact: true }); if (await oldBottomControl.isChecked()) await oldBottomControl.click();
  await page.getByLabel("Add a piece from your closet", { exact: true }).selectOption(bottomB.id);
  const actualIds = proposal.items.map(item => item.itemId).filter(id => id !== bottomA).concat(bottomB.id).sort();
  const situations = ["Operator simulation: wardrobe walkthrough", "Operator simulation: corrected wardrobe walkthrough"];
  const wornOn = "2026-11-01", wornTimezone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  await page.getByLabel("Date worn", { exact: true }).fill(wornOn);
  await page.getByLabel("Actual situation", { exact: true }).fill(situations[0]); await page.getByLabel("How did it go?", { exact: true }).selectOption("unknown");
  const createWear = await postClick("/api/experiences", "POST", () => page.getByRole("button", { name: "Save wear report", exact: true }).click());
  assert.equal(createWear.command.snapshotId, String(explored.row._id)); assert.equal(createWear.command.candidateId, proposal.candidateId); assert.equal(createWear.command.compositionStatus, "changed"); assert.deepEqual([...createWear.command.memberItemIds].sort(), actualIds); assert.equal(createWear.command.outcome, "unknown"); assert.equal(createWear.command.context.text, situations[0]); assert.notEqual(createWear.command.occurredOn, dates[2]);
  assert.equal(createWear.command.occurredOn, wornOn); assert.equal(createWear.command.timezone, wornTimezone);
  const experienceId = createWear.command.experienceId;
  phase.steps.push({ kind: "simulated-wear-create", command: createWear.command, receipt: createWear.receipt });
  await page.getByText("Wear report saved. Find or correct it in Wear memory.", { exact: true }).waitFor();
  const readWear = () => db.collection("outfitexperiences").findOne({ user, experienceId });
  const originalWear = await readWear(); assert.equal(originalWear.currentRevision, 1); assert.equal(createWear.receipt.acknowledgedRevision, 1); assert.deepEqual(originalWear.memberItemIds.map(String).sort(), actualIds);
  assert.equal(String(originalWear.snapshotId), String(explored.row._id)); assert.equal(originalWear.candidateId, proposal.candidateId);
  assert.equal(originalWear.revisions[0].state.occurredOn, wornOn); assert.equal(originalWear.revisions[0].state.timezone, wornTimezone);
  assert.equal(originalWear.revisions[0].state.learningDisposition, "do_not_learn");
  function verifyReportedPhotos(record) {
    const members = record.revisions.at(-1).state.memberItems; assert.equal(members.length, actualIds.length);
    for (const item of members) {
      const original = baselineWardrobe.find(row => String(row._id) === item.itemId);
      assert.equal(item.name, owned.get(item.itemId).name); assert.equal(item.photo.imageRef, original.imagePath);
      assert.equal(item.photo.origin, item.itemId === bottomB.id ? "wardrobe" : "suggestion");
    }
  }
  verifyReportedPhotos(originalWear); await persist();
  async function memory(situation) {
    await page.goto(`${origin}/memory?itemId=${targetId}`); await page.getByRole("heading", { name: "Reported wears", exact: true }).waitFor();
    const card = page.getByRole("article").filter({ has: page.getByText(`Actual situation: ${situation} · Outcome: Unknown`, { exact: false }) });
    await card.waitFor(); assert.equal(await card.count(), 1); await enabled(card.getByRole("button", { name: "Correct wear report", exact: true }));
    const list = card.locator(":scope > ul").first();
    const pairs = await list.locator(":scope > li").evaluateAll(items => items.map(item => ({ name: item.querySelector("button")?.textContent?.trim(), photo: item.querySelector("img")?.getAttribute("src"), alt: item.querySelector("img")?.getAttribute("alt") })).sort((a,b) => a.photo.localeCompare(b.photo)));
    assert.deepEqual(pairs, actualIds.map(id => ({ name: owned.get(id).name, photo: `/api/images/${baselineWardrobe.find(row => String(row._id) === id).imagePath.slice(6)}`, alt: owned.get(id).name })).sort((a,b) => a.photo.localeCompare(b.photo)));
    await page.waitForFunction(element => { const images = [...element.querySelectorAll("img")]; return images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0); }, await list.elementHandle()); return card;
  }
  async function correct(situation, previous, nextSituation) {
    const previousRecord = await readWear(); assert.equal(previousRecord.currentRevision, previous);
    const card = await memory(situation); await card.getByRole("button", { name: "Correct wear report", exact: true }).click(); await card.getByLabel("Actual situation", { exact: true }).fill(nextSituation);
    const ack = await postClick(`/api/experiences/${experienceId}`, "PATCH", () => card.getByRole("button", { name: "Save correction", exact: true }).click());
    assert.equal(ack.command.expectedPreviousRevision, previous); assert.equal(ack.command.outcome, "unknown"); assert.equal(ack.command.context.text, nextSituation); assert.deepEqual([...ack.command.memberItemIds].sort(), actualIds); assert.equal(ack.receipt.acknowledgedRevision, previous + 1);
    await page.getByText("Wear report saved.", { exact: true }).waitFor(); const next = await memory(nextSituation), record = await readWear();
    assert.equal(record.currentRevision, previous + 1); assert.deepEqual(record.revisions.slice(0, previous), previousRecord.revisions);
    const priorState = { ...previousRecord.revisions.at(-1).state }, nextState = { ...record.revisions.at(-1).state };
    delete priorState.context; delete nextState.context;
    assert.deepEqual(nextState, priorState, "situation correction preserves date, timezone, learning disposition and all other reported state");
    assert.deepEqual(record.memberItemIds.map(String).sort(), actualIds); assert.equal(record.revisions.at(-1).state.context.rawOccasion, nextSituation); assert.equal(record.revisions.at(-1).state.outcome, "unknown"); verifyReportedPhotos(record);
    phase.steps.push({ kind: previous === 1 ? "simulated-situation-correction" : "simulated-situation-undo", command: ack.command, receipt: ack.receipt }); await persist(); return { card: next, record, ack };
  }
  const corrected = await correct(situations[0], 1, situations[1]);
  await corrected.card.getByRole("button", { name: "Make another outfit", exact: true }).click();
  await corrected.card.getByLabel("Keep this piece", { exact: true }).selectOption(bottomB.id); await corrected.card.getByLabel("New situation", { exact: true }).fill("Operator simulation: separate adaptation");
  await enabled(corrected.card.getByRole("button", { name: "Find an outfit", exact: true }));
  const adaptationContext = { ...structuredClone(context), routineId: null, routineVersion: null, routineLabel: null, learningEnabled: false, weather: "mild" };
  const adapted = await render("actual-added-bottom-adaptation", () => corrected.card.getByRole("button", { name: "Find an outfit", exact: true }).click(), adaptationContext, true);
  assert.equal(adapted.row.weatherSource, "default"); assert.equal(adapted.row.weatherRaw, null);
  assert.deepEqual(adapted.request.actualVariation, { experienceId, expectedRevision: 2, anchorItemId: bottomB.id, occasion: "Operator simulation: separate adaptation" });
  assert.equal(String(adapted.row.parentSnapshotId), String(explored.row._id)); assert.equal(adapted.row.generationIndex, explored.row.generationIndex + 1);
  assert.equal(adapted.row.variationSourceExperienceId, experienceId); assert.equal(adapted.row.variationSourceRevision, 2); assert.ok(adapted.result.shown.every(outfit => outfit.displayItems.some(item => item.itemId === bottomB.id)));
  assert.deepEqual(await readWear(), corrected.record, "adaptation never changes the report");
  // Undo only the operator situation: immutable earlier revisions remain and revision two's
  // derivative becomes unreadable. Do not create a fifth render to manufacture recovery.
  const beforeUndo = await readWear(); invalidated = adapted.row._id;
  const undone = await correct(situations[1], 2, situations[0]); assert.deepEqual(undone.record.revisions.slice(0, 2), beforeUndo.revisions);
  assert.deepEqual(undone.record.revisions.at(-1).state, originalWear.revisions[0].state, "situation undo restores the entire original reported state");
  await unchanged();
  const invalidUrl = sourceUrl(origin, adapted.row, adapted.row.candidates.find(candidate => candidate.candidateId === adapted.result.shown[0].candidateId));
  let finalCheckTimer;
  try {
    await Promise.race([(async () => {
      const [unavailable] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/api/experiences/suggestion" && new URL(r.url()).searchParams.get("snapshotId") === String(adapted.row._id)), page.goto(invalidUrl)]);
      // The app intentionally rejects 404 before reading a body. Response.json() has
      // no Playwright action timeout and hung on that rejected fetch in a real run.
      assert.equal(unavailable.status(), 404);
      await page.getByRole("alert").filter({ hasText: "This saved proposal is no longer available." }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Report what I wore", exact: true }).count(), 0);
    })(), new Promise((_, reject) => { finalCheckTimer = setTimeout(() => reject(new Error("Final invalidated-proposal browser check timed out")), 30_000); })]);
  } finally { clearTimeout(finalCheckTimer); }
  phase.steps.push({ kind: "simulated-changed-wear-correct-adapt-undo", experienceId, sourceSnapshotId: String(explored.row._id), addedBottomId: bottomB.id, actualMemberIds: actualIds, revisions: [1,2,3], invalidatedSnapshotId: String(adapted.row._id), outcome: "unknown", acknowledged: true });
  assert.equal(phase.renderRequests, 4); await unchanged(); phase.complete = true; phase.status = "controls-and-simulated-wear-passed"; report.status = "private-wardrobe-full-passed";
  report.pending = ["Home/390px outside this walkthrough"]; await persist(); return report;
  } catch (error) { if (error instanceof SupplyUnavailable) return incomplete(error.message); throw error; }
}
