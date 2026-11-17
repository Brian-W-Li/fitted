/** Explicit local-only acceptance: original photos/drafts, visible controls, no authored votes. */
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { ObjectId } from "mongodb";
import { stableJson, sha256 } from "./private-feedback-contract.mjs";
import { verifyCapturedRender, verifyIntactAttempts, capturedPartition } from "./private-feedback-verification.mjs";
import { writePrivateReplayReport } from "./private-replay-input.mjs";
import { openStyleDirection, openTimeAndWeather } from "./home-browser-controls.mjs";

const sorted = values => [...values].sort();
const membership = values => sorted(values).join("|");
const localImage = ref => ref?.startsWith("mongo:") ? `/api/images/${ref.slice(6)}` : ref;
const emptyInput = () => ({ itemIds: [], outfitItemIds: [] });
const renderedCards = page => page.locator(".p-5.border.rounded-xl").filter({ has: page.getByRole("button", { name: "Regenerate", exact: true }) });

export async function runPrivateExclusionsJourney({ db, page, owner, origin, loaded, run, report, first, paceRender, annotate }) {
  assert.equal(new URL(page.url()).origin, origin, "the visible controls belong to the isolated app under test");
  const user = new ObjectId(owner.userId), context = first.row.styleContext;
  assert.equal(String(first.row.user), owner.userId);
  assert.ok(context?.boardId && context.routineId && context.learningEnabled && context.weather === "mild");
  const original = first.result.shown.map(shown => ({ shown, candidate: first.row.candidates.find(candidate => candidate.candidateId === shown.candidateId) }))
    .find(pair => pair.candidate?.template === "two_piece" && pair.candidate.items.some(item => item.role === "base_top"));
  assert.ok(original, "the existing first normal render must contain a real top-and-bottom option");
  const topId = String(original.candidate.items.find(item => item.role === "base_top").itemId);
  const combo = sorted(original.candidate.items.map(item => String(item.itemId)));
  assert.ok(combo.length >= 1 && combo.length <= 5 && new Set(combo).size === combo.length);
  assert.equal(membership(combo), membership(original.shown.displayItems.map(item => item.itemId)));
  const captured = new Map(loaded.input.wardrobe.map(item => [item.id, item]));
  assert.ok(captured.get(topId)?.isAvailable && captured.get(topId)?.clothingType === "top");
  assert.ok(combo.every(id => captured.get(id)?.isAvailable));
  const itemInput = { itemIds: [topId], outfitItemIds: [] }, comboInput = { itemIds: [], outfitItemIds: [combo] };
  const baseline = await db.collection("generationsnapshots").findOne({ user, _id: first.row._id });
  assert.ok(baseline && baseline.requestId === first.request.requestId);
  assert.equal(await db.collection("generationsnapshots").countDocuments({ user }), 1, "only the first actual request exists before this phase");
  assert.equal(await db.collection("outfitinteractions").countDocuments({ user }), 0, "exclusions acceptance imports no reactions");
  const wardrobe = await db.collection("wardrobeitems").find({ user }, { projection: { _id: 1, name: 1, imagePath: 1, imageUrl: 1, isAvailable: 1 } }).sort({ _id: 1 }).toArray();
  assert.deepEqual(wardrobe.map(item => String(item._id)).sort(), loaded.input.wardrobe.map(item => item.id).sort());
  const pieces = new Map(wardrobe.map(item => [String(item._id), item]));
  const phase = report.exclusions = { version: "private-exclusions-journey.v1", status: "running", complete: false,
    maximumRenderRequests: 5, renderRequests: 0, labelProvenance: "Explicit operator test instructions; no owner taste or fit claims",
    scope: { boardId: context.boardId, profileId: context.profileId, profileVersion: context.profileVersion,
      routineId: context.routineId, routineVersion: context.routineVersion },
    original: { snapshotId: String(first.row._id), candidateId: original.candidate.candidateId, topId, combo }, steps: [], renders: [], screenshots: [] };
  report.status = "checking-private-exclusions";
  const persist = () => writePrivateReplayReport(run, report);
  const readAudit = async () => (await readFile(run.auditPath, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const initialAudit = await readAudit();
  verifyIntactAttempts(first.row, initialAudit, loaded);
  let auditOffset = initialAudit.length;
  const requestIds = new Set([first.request.requestId]), snapshotIds = new Set([String(first.row._id)]);
  const panel = page.getByRole("region", { name: "Saved style direction", exact: true });
  await openStyleDirection(page);
  const controls = panel.locator("details").filter({ has: page.locator("summary").filter({ hasText: "Leave pieces or an exact outfit out" }) });
  const saveButton = () => controls.getByRole("button", { name: "Save exclusion for this direction and situation", exact: true });
  async function enabled(locator) {
    await locator.waitFor();
    const deadline = Date.now() + 30_000;
    while (!await locator.isEnabled()) {
      assert.ok(Date.now() < deadline, "the visible control must consume its acknowledgement before the next action");
      await page.waitForTimeout(25);
    }
  }
  async function readState() {
    const row = await db.collection("users").findOne({ _id: user, erasureStarted: { $ne: true } }, { projection: { styleMemory: 1, styleMemoryRevision: 1 } });
    assert.ok(row && Number.isSafeInteger(row.styleMemoryRevision));
    const memory = row.styleMemory, board = memory?.boards.find(board => board.id === context.boardId && board.profileId === context.profileId);
    assert.ok(board?.status === "active" && board.versions.some(version => version.version === context.profileVersion));
    assert.equal(memory.selectedBoardId, context.boardId); assert.equal(memory.selectedRoutineId, context.routineId);
    const routine = memory.routines.find(routine => routine.id === context.routineId);
    assert.ok(routine?.status === "active" && routine.versions.some(version => version.version === context.routineVersion));
    const set = board.exclusionSets?.find(set => set.profileVersion === context.profileVersion && set.routineId === context.routineId && set.routineVersion === context.routineVersion) ?? null;
    return { memory, board, set, revision: row.styleMemoryRevision };
  }
  function expectedEntries(set, requestId, once) {
    const entries = (set?.entries ?? []).map(entry => ({ ...entry, itemIds: sorted(entry.itemIds), scope: "saved" }));
    for (const itemId of once.itemIds) entries.push({ id: sha256(stableJson(["request", requestId, "item", [itemId]])).slice(0, 24), revision: 1, scope: "request", kind: "item", itemIds: [itemId] });
    return entries.sort((a, b) => a.id.localeCompare(b.id));
  }
  function verifyPolicy(render, set, once) {
    const { row, request, result } = render;
    const ref = set ? { id: set.id, revision: set.revision } : null;
    assert.deepEqual(request.exclusionRef ?? null, ref, "the UI dispatches its acknowledged saved-set reference");
    assert.deepEqual(request.requestExclusions ?? emptyInput(), once, "only the explicitly submitted next-request draft belongs to this command");
    const entries = expectedEntries(set, request.requestId, once);
    const body = { version: "explicit-exclusions.v1", requestId: request.requestId, savedRef: ref, entries };
    assert.deepEqual(row.explicitExclusions, { ...body, digest: sha256(stableJson(body)) }, "snapshot freezes exact known rule identities, membership, revisions and digest");
    assert.deepEqual(result.explicitExclusions, row.explicitExclusions, "browser result echoes the exact admitted policy");
  }
  async function save(action, input, label) {
    const before = await readState();
    const [response] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/style-memory") && response.request().method() === "POST"), action(),
    ]);
    const receipt = await response.json(), command = response.request().postDataJSON();
    assert.equal(response.status(), 200, "visible exclusion replacement must acknowledge");
    assert.match(command.operationId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    assert.deepEqual(command, { kind: "set_exclusions", operationId: command.operationId, expectedRevision: before.revision,
      boardId: context.boardId, profileVersion: context.profileVersion, routineId: context.routineId, routineVersion: context.routineVersion,
      expectedSetRevision: before.set?.revision ?? 0, ...input });
    assert.equal(receipt.operation.id, command.operationId); assert.equal(receipt.operation.revision, before.revision + 1);
    assert.equal(receipt.state.revision, before.revision + 1);
    await enabled(panel.getByRole("button", { name: "New direction", exact: true }));
    const after = await readState();
    assert.equal(after.revision, before.revision + 1);
    assert.ok(after.set && after.set.revision === after.revision);
    assert.deepEqual(after.memory.routines, before.memory.routines);
    const beforeMeaning = { ...before.board }, afterMeaning = { ...after.board };
    delete beforeMeaning.exclusionSets; delete afterMeaning.exclusionSets;
    assert.deepEqual(afterMeaning, beforeMeaning, "an instruction cannot edit profile meaning or learning opt-in");
    const scope = [context.boardId, context.profileId, context.profileVersion, context.routineId, context.routineVersion];
    assert.equal(after.set.id, sha256(JSON.stringify(scope)).slice(0, 24), "the saved set identity belongs to this exact owned semantic scope");
    for (const entry of after.set.entries) {
      assert.equal(entry.id, sha256(JSON.stringify([scope, entry.kind, sorted(entry.itemIds)])).slice(0, 24));
      assert.equal(entry.revision, after.revision, "new and restored entries use their actual owner acknowledgement revision");
    }
    const expected = [...input.itemIds.map(itemId => ({ kind: "item", itemIds: [itemId] })), ...input.outfitItemIds.map(itemIds => ({ kind: "combination", itemIds: sorted(itemIds) }))];
    assert.deepEqual(after.set.entries.map(entry => ({ kind: entry.kind, itemIds: sorted(entry.itemIds) })).sort((a, b) => stableJson(a).localeCompare(stableJson(b))),
      expected.sort((a, b) => stableJson(a).localeCompare(stableJson(b))), "saved membership matches the visible operator action");
    assert.deepEqual(receipt.state.boards.find(board => board.id === context.boardId).exclusionSets, after.board.exclusionSets);
    if (after.set.entries.length) {
      const list = controls.getByRole("list", { name: "Saved exclusions", exact: true });
      await list.waitFor(); assert.equal(await list.locator("li").count(), after.set.entries.length);
    } else await controls.getByRole("list", { name: "Saved exclusions", exact: true }).waitFor({ state: "detached" });
    phase.steps.push({ kind: label, command, receipt: { operation: receipt.operation }, savedSet: after.set }); await persist();
    return after.set;
  }
  async function choose(kind, ids, scope) {
    await controls.getByRole("combobox", { name: "Exclusion scope", exact: true }).selectOption(scope);
    await controls.getByRole("combobox", { name: "Exclusion type", exact: true }).selectOption(kind);
    for (const input of await controls.locator('fieldset input[type="checkbox"]').all()) if (await input.isChecked()) await input.uncheck();
    for (const id of ids) {
      const piece = pieces.get(id), image = localImage(piece?.imageUrl || piece?.imagePath);
      assert.ok(piece?.isAvailable !== false && typeof image === "string" && image.startsWith("/api/images/"));
      const label = controls.locator("fieldset label").filter({ has: page.locator(`img[src="${image}"]`) });
      assert.equal(await label.count(), 1, "an owned materialized photo uniquely identifies the chosen piece");
      assert.equal((await label.innerText()).trim(), piece.name.trim());
      await label.locator("img").evaluate(image => image.decode());
      await label.getByRole(kind === "item" ? "radio" : "checkbox").check();
    }
  }
  async function removeSaved(label) {
    const list = controls.getByRole("list", { name: "Saved exclusions", exact: true });
    assert.equal(await list.locator("li").count(), 1);
    return save(() => list.getByRole("button", { name: /^Remove / }).click(), emptyInput(), label);
  }
  async function generate(kind, once = emptyInput(), forbiddenItem = null, forbiddenCombo = null) {
    assert.ok(phase.renderRequests < 5, "explicit exclusions acceptance permits only five new visible requests");
    const before = await readState();
    await page.locator("textarea").fill(first.request.occasion);
    await openTimeAndWeather(page);
    await page.getByRole("combobox", { name: "Temperature", exact: true }).selectOption("mild");
    await paceRender();
    await enabled(page.getByRole("button", { name: "Get Recommendations", exact: true }));
    phase.renderRequests++;
    const [response] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/recommend") && response.request().method() === "POST"),
      page.getByRole("button", { name: "Get Recommendations", exact: true }).click(),
    ]);
    const result = await response.json(), request = response.request().postDataJSON();
    assert.equal(response.status(), 200, "explicit exclusions run through the normal local recommendation route");
    assert.ok(!request.parentSnapshotId && !request.forcedItemId, "each acceptance probe is an explicit fresh root");
    assert.equal(request.occasion, first.request.occasion); assert.equal(request.weather, "mild");
    assert.ok(!requestIds.has(request.requestId), "a new instruction probe cannot masquerade as a completed retry"); requestIds.add(request.requestId);
    const row = await db.collection("generationsnapshots").findOne({ user, requestId: request.requestId });
    assert.ok(row && !snapshotIds.has(String(row._id))); snapshotIds.add(String(row._id));
    const audit = await readAudit();
    verifyCapturedRender({ row, request, result, loaded, context, ownerId: owner.userId, events: audit.slice(auditOffset) }); auditOffset = audit.length;
    assert.deepEqual(capturedPartition(row.styleContext), capturedPartition(context));
    assert.equal(row.styleContext.memoryRevision, before.revision);
    assert.equal((await readState()).revision, before.revision, "generation never edits the saved exclusion set");
    verifyPolicy({ row, request, result }, before.set, once);
    for (const outfit of result.shown) {
      const ids = outfit.displayItems.map(item => item.itemId);
      if (forbiddenItem) assert.ok(!ids.includes(forbiddenItem), "the explicit piece is absent from every displayed outfit");
      if (forbiddenCombo) assert.notEqual(membership(ids), membership(forbiddenCombo), "the exact complete outfit is absent; shared pieces are allowed");
    }
    await page.waitForFunction(snapshotId => [...document.querySelectorAll("a")].some(link => link.getAttribute("href")?.includes(`snapshotId=${snapshotId}`)), String(row._id));
    const cards = renderedCards(page); assert.equal(await cards.count(), result.shown.length);
    for (let index = 0; index < result.shown.length; index++) {
      const outfit = result.shown[index], card = cards.nth(index);
      assert.deepEqual(sorted((await card.locator(".grid p.font-medium").allTextContents()).map(name => name.trim())), sorted(outfit.displayItems.map(item => item.name)));
      assert.deepEqual(await card.locator("img").evaluateAll(images => images.map(image => image.getAttribute("src")).sort()), sorted(outfit.displayItems.map(item => item.imageUrl)));
    }
    const count = result.shown.reduce((n, outfit) => n + outfit.displayItems.length, 0);
    await cards.locator("img").evaluateAll(images => images.forEach(image => { image.loading = "eager"; }));
    await page.waitForFunction(expected => {
      const images = [...document.querySelectorAll(".p-5.border.rounded-xl img")];
      return images.length === expected && images.every(image => image.complete && image.naturalWidth > 0);
    }, count);
    await enabled(panel.getByRole("button", { name: "New direction", exact: true }));
    assert.equal(await db.collection("outfitinteractions").countDocuments({ user }), 0);
    phase.renders.push({ kind, requestId: request.requestId, snapshotId: String(row._id), explicitExclusions: row.explicitExclusions,
      shownCandidateIds: row.shownCandidateIds, shownGarmentIds: result.shown.map(outfit => outfit.displayItems.map(item => item.itemId)) });
    await persist(); return { row, request, result };
  }
  async function screenshot(filename) {
    await annotate(); await page.screenshot({ path: path.join(run.runDirectory, filename), fullPage: true });
    phase.screenshots.push(filename); report.screenshots.push(filename);
  }
  try {
    await persist();
    assert.equal((await readState()).set, null, "a fresh isolated direction has no pre-seeded exclusion set");
    await panel.getByText("Leave pieces or an exact outfit out", { exact: true }).click();
    await controls.locator("fieldset label").first().waitFor();
    await choose("item", [topId], "saved");
    const itemSet = await save(() => saveButton().click(), itemInput, "save-piece");
    const itemRender = await generate("saved-piece", emptyInput(), topId);
    assert.equal(itemRender.row.explicitExclusions.entries.length, 1);
    assert.equal(itemRender.row.explicitExclusions.entries[0].kind, "item");
    await screenshot("06-saved-piece-exclusion.png");

    await removeSaved("remove-piece");
    await choose("combination", combo, "saved");
    const comboSet = await save(() => saveButton().click(), comboInput, "save-exact-combination");
    assert.equal(comboSet.id, itemSet.id);
    const comboRender = await generate("saved-exact-combination", emptyInput(), null, combo);
    assert.ok(comboRender.result.shown.some(outfit => outfit.displayItems.some(item => combo.includes(item.itemId))), "an original member still appears, proving the combo did not ban all its pieces");
    await removeSaved("remove-exact-combination");
    await enabled(controls.getByRole("button", { name: "Undo last removal", exact: true }));
    const restoredSet = await save(() => controls.getByRole("button", { name: "Undo last removal", exact: true }).click(), comboInput, "undo-exact-combination");
    assert.equal(restoredSet.id, comboSet.id); assert.equal(restoredSet.entries[0].id, comboSet.entries[0].id);
    assert.ok(restoredSet.entries[0].revision > comboSet.entries[0].revision, "undo restores the semantic rule with a newer acknowledged revision");
    await generate("undone-exact-combination", emptyInput(), null, combo);
    await screenshot("07-restored-combination-exclusion.png");

    const cleared = await removeSaved("clear-saved-exclusions");
    assert.equal(cleared.entries.length, 0);
    const beforeOnce = await readState();
    await choose("item", [topId], "request");
    await controls.getByRole("button", { name: "Leave out on next request", exact: true }).click();
    const onceList = controls.getByRole("list", { name: "Next-request exclusions", exact: true });
    await onceList.waitFor(); assert.equal(await onceList.locator("li").count(), 1);
    assert.equal((await readState()).revision, beforeOnce.revision, "a next-request draft is not a saved rule write");
    const once = await generate("next-request-piece", itemInput, topId);
    assert.equal(once.row.explicitExclusions.entries.filter(entry => entry.scope === "request").length, 1);
    await controls.getByRole("list", { name: "Next-request exclusions", exact: true }).waitFor({ state: "detached" });
    const following = await generate("following-request-no-carryover");
    assert.equal(following.row.explicitExclusions.entries.length, 0, "the next explicit root inherits no consumed one-request or cleared saved ban");
    assert.equal(following.request.requestExclusions, undefined);
    await screenshot("08-one-request-exclusion-consumed.png");
    assert.equal(phase.renderRequests, 5);
    assert.equal(await db.collection("generationsnapshots").countDocuments({ user }), 6);
    assert.deepEqual(await db.collection("generationsnapshots").findOne({ user, _id: first.row._id }), baseline, "instruction changes preserve the original shown snapshot");
    assert.deepEqual(await db.collection("wardrobeitems").find({ user }, { projection: { _id: 1, name: 1, imagePath: 1, imageUrl: 1, isAvailable: 1 } }).sort({ _id: 1 }).toArray(), wardrobe);
    assert.equal(await db.collection("outfitinteractions").countDocuments({ user }), 0);
    report.sourceSelections = await readAudit();
    phase.status = "passed"; phase.complete = true; phase.completedAt = new Date().toISOString();
    report.status = "private-exclusions-passed"; report.completedAt = phase.completedAt;
    report.pending = report.pending.filter(step => step !== "saved and one-request exclusions");
    await persist(); return report;
  } catch (error) {
    phase.status = "failed"; phase.failure = String(error.message); await persist(); throw error;
  }
}
