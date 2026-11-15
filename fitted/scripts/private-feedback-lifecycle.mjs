/** Private operator-only lifecycle checks. All mutations use the existing visible app controls. */
import assert from "node:assert/strict";
import path from "node:path";
import { ObjectId } from "mongodb";
import { capturedPartition, verifyLifecycleProbe, verifyIsolatedTasteSignals } from "./private-feedback-verification.mjs";
import { compositionKey } from "./private-feedback-contract.mjs";
import { writePrivateReplayReport } from "./private-replay-input.mjs";

export async function runPrivateFeedbackLifecycle({ db, page, owner, origin, loaded, run, report, context, observations, generate, annotate }) {
  assert.equal(observations.length, 6, "lifecycle requires the six completed ordinary original observations");
  assert.ok(observations.every(row => row.learningDisposition === "normal" && row.learningEnabled && row.visible));
  assert.deepEqual(observations.map(row => row.action).sort(), ["accepted", "accepted", "accepted", "rejected", "rejected", "rejected"]);
  assert.equal(new Set(observations.map(row => compositionKey(row.items.map(item => item.id)))).size, 6);
  const user = new ObjectId(owner.userId);
  const target = [...observations].filter(row => row.action === "accepted").sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))[0];
  const reaction = new ObjectId(target.id), itemId = target.items.find(item => item.role === "top")?.id;
  assert.ok(itemId && loaded.input.wardrobe.some(item => item.id === itemId && item.isAvailable));
  const originalVotes = await db.collection("outfitinteractions").find({ user, _id: { $in: observations.map(row => new ObjectId(row.id)) } }).toArray();
  assert.equal(originalVotes.length, 6);
  const originalVote = originalVotes.find(vote => String(vote._id) === target.id);
  const source = await db.collection("generationsnapshots").findOne({ user, _id: new ObjectId(target.snapshotId) });
  assert.ok(originalVote && source?.shownCandidateIds.includes(target.candidateId));
  assert.equal(originalVote.action, "accepted"); assert.equal(originalVote.dispositionRevision, 0);
  assert.deepEqual(capturedPartition(source.styleContext), capturedPartition(context));
  const candidate = source.candidates.find(row => row.candidateId === target.candidateId);
  assert.equal(compositionKey(candidate.items), compositionKey(target.items.map(item => item.id)));
  const facts = new Map(source.itemSnapshots.map(item => [String(item.itemId), item.engineVisible]));
  const expectedNames = candidate.items.map(item => facts.get(String(item.itemId))?.name).sort();
  const imageSrc = value => value?.startsWith("mongo:") ? `/api/images/${value.slice(6)}` : value;
  const expectedImages = candidate.items.map(item => imageSrc(facts.get(String(item.itemId))?.imageUrl)).sort();
  assert.ok(expectedNames.every(name => typeof name === "string" && name.length > 0));
  assert.ok(expectedImages.every(src => typeof src === "string" && src.startsWith("/api/images/")));
  const originalPreference = structuredClone(report.collection.probe.preference);
  const exception = new Map([[target.id, "exception"]]);
  const lifecycle = report.lifecycle = { version: "private-feedback-lifecycle.v1", status: "running", complete: false, maximumRenderRequests: 5,
    renderRequests: 0, labelProvenance: "Operator-authored lifecycle note, never owner preferences", target: { reactionId: target.id,
      snapshotId: target.snapshotId, candidateId: target.candidateId, itemId }, steps: [], screenshots: [] };
  const persist = () => writePrivateReplayReport(run, report);

  async function targetCard() {
    const cards = page.locator(".relative.rounded-2xl").filter({ has: page.getByRole("group", {
      name: `Captured context: ${context.boardLabel} / ${context.routineLabel}`, exact: true }) });
    await cards.first().waitFor(); // Readiness only; action selection below independently matches all members.
    const matches = [];
    for (let index = 0; index < await cards.count(); index++) {
      const names = await cards.nth(index).locator("img").evaluateAll(images => images.map(image => image.getAttribute("alt")).sort());
      const photos = await cards.nth(index).locator("img").evaluateAll(images => images.map(image => image.getAttribute("src")).sort());
      if (JSON.stringify(names) === JSON.stringify(expectedNames) && JSON.stringify(photos) === JSON.stringify(expectedImages)) matches.push(index);
    }
    assert.equal(matches.length, 1, "captured context plus complete image names/membership identify exactly the original reaction card");
    const card = cards.nth(matches[0]);
    await card.locator("img").evaluateAll(images => Promise.all(images.map(image => image.decode())));
    return card;
  }
  async function historyTarget() {
    await page.goto(`${origin}/history`);
    return targetCard(); // History starts on Liked; the original accepted vote stays accepted throughout.
  }
  async function assertStoredState(disposition, dispositionRevision, reasonCount) {
    const after = await db.collection("outfitinteractions").findOne({ user, _id: reaction });
    assert.deepEqual(after, originalVote, "notes/eligibility never rewrite the original ordinary vote or captured facts");
    const retainedVotes = await db.collection("outfitinteractions").find({ user, _id: { $in: originalVotes.map(vote => vote._id) } }).toArray();
    assert.equal(retainedVotes.length, 6);
    for (const vote of originalVotes) assert.deepEqual(retainedVotes.find(row => String(row._id) === String(vote._id)), vote, "all six original ordinary documents remain unchanged");
    const amendments = await db.collection("outfitinteractions").find({ user, reactionId: reaction }).toArray();
    const reasons = amendments.filter(row => row.eventKind === "reason_amendment");
    const dispositions = amendments.filter(row => row.eventKind === "learning_disposition").sort((a, b) => a.dispositionRevision - b.dispositionRevision);
    assert.equal(reasons.length, reasonCount); assert.equal(dispositions.length, dispositionRevision);
    assert.equal(amendments.length, reasonCount + dispositionRevision);
    assert.deepEqual(dispositions.map(row => [row.dispositionRevision, row.learningDisposition]),
      [[1, "exception"], [2, "exception"], [3, "normal"]].slice(0, dispositionRevision));
    assert.equal(dispositions.at(-1).learningDisposition, disposition);
    assert.ok(amendments.every(row => row.action == null && String(row.user) === owner.userId));
    for (const row of amendments) {
      assert.equal(String(row.reactionId), target.id); assert.equal(String(row.snapshotId), target.snapshotId);
      assert.equal(row.candidateId, target.candidateId); assert.equal(row.baseKey, originalVote.baseKey); assert.equal(row.fullSignature, originalVote.fullSignature);
      assert.deepEqual(row.items.map(String), originalVote.items.map(String), "every amendment retains the exact ordered source membership");
    }
    const ledger = await db.collection("outfitinteractions").find({ user }).toArray();
    assert.equal(ledger.length, 6 + amendments.length, "only the six originals and target-bound amendments exist");
    assert.deepEqual(ledger.filter(row => ["accepted", "rejected"].includes(row.action)).map(row => String(row._id)).sort(), observations.map(row => row.id).sort());
    return { reasonIds: reasons.map(row => String(row._id)), dispositionIds: dispositions.map(row => String(row._id)), learningDisposition: disposition, dispositionRevision };
  }
  async function historyMutation(action, expectedKind, expectedDisposition, revision) {
    const beforeRevision = (await db.collection("users").findOne({ _id: user }, { projection: { styleMemoryRevision: 1 } }))?.styleMemoryRevision;
    assert.ok(Number.isSafeInteger(beforeRevision));
    const [response, refreshed] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/interactions") && response.request().method() === "POST"),
      page.waitForResponse(response => response.url().endsWith("/api/interactions") && response.request().method() === "GET"),
      action(),
    ]);
    const receipt = await response.json(); assert.equal(response.status(), 200, "visible History correction must acknowledge");
    const command = response.request().postDataJSON();
    assert.equal(command.kind, expectedKind); assert.equal(command.reactionId, target.id);
    assert.ok(!Object.hasOwn(command, "action") && !Object.hasOwn(command, "snapshotId") && !Object.hasOwn(command, "candidateId"), "amendment is never another vote or a client-supplied outfit binding");
    assert.equal(receipt.success, true); assert.equal(receipt.amendment.reactionId, target.id);
    assert.equal(refreshed.status(), 200);
    const updated = (await refreshed.json()).interactions.find(row => row.id === target.id);
    assert.ok(updated && updated.action === "accepted");
    assert.equal(updated.learningDisposition, expectedDisposition); assert.equal(updated.dispositionRevision, revision);
    // Wait for the fresh History read to be consumed, rather than trusting HTTP 200 or optimistic notes.
    const card = await targetCard();
    const next = card.getByRole("button", { name: expectedDisposition === "normal" ? "Exclude from taste learning" : "Also reflects my taste here", exact: true });
    await next.waitFor();
    const deadline = Date.now() + 30_000;
    while (!await next.isEnabled()) {
      assert.ok(Date.now() < deadline, "the exact corrected History card must finish consuming its receipt and clear busy state");
      await page.waitForTimeout(25);
    }
    const afterRevision = (await db.collection("users").findOne({ _id: user }, { projection: { styleMemoryRevision: 1 } }))?.styleMemoryRevision;
    assert.equal(afterRevision, beforeRevision + 1, "each acknowledged concern/clear/inclusion advances owner memory exactly once");
    return { command, receipt, history: updated, memoryRevision: { before: beforeRevision, after: afterRevision } };
  }
  async function probe(kind, expectedContext, dispositions = new Map()) {
    assert.ok(lifecycle.renderRequests < 5, "lifecycle has no more than five new visible requests");
    await page.goto(`${origin}/dashboard`);
    lifecycle.renderRequests++;
    const render = await generate(kind, expectedContext);
    assert.deepEqual(capturedPartition(render.row.styleContext), capturedPartition(expectedContext));
    const expected = verifyLifecycleProbe(render.row, observations, dispositions);
    const record = { requestId: render.request.requestId, snapshotId: String(render.row._id), preference: render.row.preference, expected,
      shownCandidateIds: render.row.shownCandidateIds, shownGarmentIds: render.result.shown.map(outfit => outfit.displayItems.map(item => item.itemId)) };
    return { render, record };
  }
  function restored(preference) {
    for (const key of ["support", "likes", "dislikes", "evidenceDigest", "evidenceCutoff"]) assert.equal(preference[key], originalPreference[key], `original direction restores ${key}`);
  }
  async function screenshot(filename) {
    await annotate();
    await page.screenshot({ path: path.join(run.runDirectory, filename), fullPage: true });
    lifecycle.screenshots.push(filename); report.screenshots.push(filename);
  }
  async function styleMutation(kind, action) {
    const [response] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/style-memory") && response.request().method() === "POST"), action(),
    ]);
    const body = await response.json(); assert.equal(response.status(), 200);
    assert.equal(response.request().postDataJSON().kind, kind); assert.ok(body.state && body.operation);
    await page.waitForFunction(() => {
      const section = document.querySelector('section[aria-label="Saved style direction"]');
      const ready = section && [...section.querySelectorAll("button")].find(button => button.textContent === "New direction");
      return ready && !ready.disabled;
    });
    return { command: response.request().postDataJSON(), receipt: body };
  }
  try {
    await persist();
    const card = await historyTarget();
    await card.getByRole("button", { name: "Something’s off", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "What felt off?", exact: true });
    await dialog.getByRole("button", { name: "This item", exact: true }).click();
    await dialog.getByRole("combobox", { name: "Which item?", exact: true }).selectOption(itemId);
    await dialog.getByRole("button", { name: "Fit", exact: true }).click();
    const note = "Operator test only: hypothetical fit concern; no owner fit fact.";
    await dialog.getByRole("textbox", { name: "A quick note (optional)", exact: true }).fill(note);
    const concern = await historyMutation(() => dialog.getByRole("button", { name: "Save details", exact: true }).click(), "reason_amendment", "exception", 1);
    assert.deepEqual(concern.command.feedbackReason, { scope: "item", concern: "fit", itemId, rawText: note, codes: [] });
    assert.deepEqual(concern.command.perItemFeedback, []);
    const concernState = await assertStoredState("exception", 1, 1);
    const persistedReason = await db.collection("outfitinteractions").findOne({ user, _id: new ObjectId(concern.receipt.amendment.id), reactionId: reaction, eventKind: "reason_amendment" });
    assert.ok(persistedReason?.feedbackReason?.itemId instanceof ObjectId, "stored item concern retains its typed garment reference");
    assert.deepEqual({ ...persistedReason.feedbackReason, itemId: String(persistedReason.feedbackReason.itemId) },
      { scope: "item", concern: "fit", itemId, rawText: note, codes: [], source: "user" });
    const concernProbe = await probe("lifecycle-concern", context, exception);
    assert.deepEqual([concernProbe.record.preference.support, concernProbe.record.preference.likes, concernProbe.record.preference.dislikes], [5, 2, 3]);
    assert.equal(concernProbe.record.preference.status, "abstained");
    lifecycle.steps.push({ kind: "item-fit-concern", correction: concern, state: concernState, probe: concernProbe.record }); await persist();

    const noted = await historyTarget();
    await noted.getByRole("button", { name: "Edit details", exact: true }).click();
    const cleared = await historyMutation(() => page.getByRole("dialog", { name: "What felt off?", exact: true }).getByRole("button", { name: "Clear details", exact: true }).click(), "reason_amendment", "exception", 2);
    assert.deepEqual(cleared.command.feedbackReason, { codes: [] }); assert.deepEqual(cleared.command.perItemFeedback, []);
    assert.ok(cleared.history.feedbackReason == null && (!cleared.history.perItemFeedback || cleared.history.perItemFeedback.length === 0));
    const clearedState = await assertStoredState("exception", 2, 2);
    await (await targetCard()).getByRole("button", { name: "Something’s off", exact: true }).waitFor();
    const clearProbe = await probe("lifecycle-clear", context, exception);
    assert.deepEqual([clearProbe.record.preference.support, clearProbe.record.preference.likes, clearProbe.record.preference.dislikes], [5, 2, 3]);
    assert.equal(clearProbe.record.preference.status, "abstained");
    for (const key of ["evidenceDigest", "evidenceCutoff"]) assert.equal(clearProbe.record.preference[key], concernProbe.record.preference[key], `clearing does not silently re-enroll evidence or change ${key}`);
    lifecycle.steps.push({ kind: "clear-stays-exceptional", correction: cleared, state: clearedState, probe: clearProbe.record });
    await screenshot("04-cleared-feedback.png"); await persist();

    const exceptional = await historyTarget();
    const included = await historyMutation(() => exceptional.getByRole("button", { name: "Also reflects my taste here", exact: true }).click(), "learning_disposition", "normal", 3);
    assert.equal(included.command.expectedDispositionRevision, 2); assert.equal(included.command.learningDisposition, "normal");
    assert.equal(included.receipt.amendment.dispositionRevision, 3); assert.equal(included.receipt.amendment.learningDisposition, "normal");
    const includedState = await assertStoredState("normal", 3, 2);
    const inclusionProbe = await probe("lifecycle-include", context);
    restored(inclusionProbe.record.preference);
    lifecycle.steps.push({ kind: "explicit-inclusion", correction: included, state: includedState, probe: inclusionProbe.record }); await persist();

    const panel = page.getByRole("region", { name: "Saved style direction", exact: true });
    await panel.getByRole("button", { name: "New direction", exact: true }).click();
    const secondLabel = "Private replay · isolation check";
    await panel.getByLabel("Saved choice name", { exact: true }).fill(secondLabel);
    await panel.getByLabel("Style word or phrase", { exact: true }).fill("operator replay verification");
    await panel.getByRole("button", { name: "Add style phrase", exact: true }).click();
    await panel.getByRole("button", { name: "Review direction", exact: true }).click();
    const created = await styleMutation("create_board", () => panel.getByRole("button", { name: "Save direction", exact: true }).click());
    assert.deepEqual(created.command.compiled, context.compiled, "new direction changes identity, not declared compiled traits");
    const board = created.receipt.state.boards.find(board => board.id === created.command.id);
    assert.ok(board && board.id !== context.boardId && board.profileId !== context.profileId);
    const meaning = board.versions.find(version => version.version === board.currentVersion);
    const selected = await styleMutation("select_context", () => panel.getByRole("combobox", { name: "Style direction", exact: true }).selectOption(board.id));
    assert.equal(selected.receipt.state.selectedBoardId, board.id);
    const situation = await styleMutation("select_context", () => panel.getByRole("combobox", { name: "Saved situation", exact: true }).selectOption(context.routineId));
    const routine = situation.receipt.state.routines.find(routine => routine.id === context.routineId);
    assert.equal(routine.currentVersion, context.routineVersion);
    const optIn = panel.getByRole("checkbox", { name: `Use experimental taste learning for ${board.label} / ${routine.label}`, exact: true });
    assert.equal(await optIn.isChecked(), false, "new direction is not silently opted in");
    const enabled = await styleMutation("set_learning", () => optIn.click());
    await panel.locator('input[type="checkbox"]:checked').waitFor();
    const otherContext = { ...structuredClone(context), boardId: board.id, profileId: board.profileId, profileVersion: board.currentVersion,
      boardLabel: board.label, compiled: meaning.compiled, memoryRevision: enabled.receipt.state.revision };
    const isolated = await probe("lifecycle-isolation", otherContext);
    assert.deepEqual([isolated.record.preference.support, isolated.record.preference.likes, isolated.record.preference.dislikes], [0, 0, 0]);
    assert.equal(isolated.record.preference.status, "abstained");
    verifyIsolatedTasteSignals(isolated.render.row);
    // shownFullSignatures may retain owner-wide exposure; that is not preference transfer.
    lifecycle.steps.push({ kind: "new-direction-isolation", created, enabled, probe: isolated.record }); await persist();

    const returnedBoard = await styleMutation("select_context", () => panel.getByRole("combobox", { name: "Style direction", exact: true }).selectOption(context.boardId));
    assert.equal(returnedBoard.receipt.state.selectedBoardId, context.boardId);
    const returnedRoutine = await styleMutation("select_context", () => panel.getByRole("combobox", { name: "Saved situation", exact: true }).selectOption(context.routineId));
    assert.equal(returnedRoutine.receipt.state.selectedRoutineId, context.routineId);
    const originalOptIn = panel.getByRole("checkbox", { name: `Use experimental taste learning for ${context.boardLabel} / ${context.routineLabel}`, exact: true });
    assert.equal(await originalOptIn.isChecked(), true, "returning to the original context retains its acknowledged opt-in");
    const returned = await probe("lifecycle-return", context);
    restored(returned.record.preference); await assertStoredState("normal", 3, 2);
    lifecycle.steps.push({ kind: "return-original-direction", probe: returned.record });
    assert.equal(lifecycle.renderRequests, 5);
    await screenshot("05-returned-direction.png");
    lifecycle.status = "passed"; lifecycle.complete = true; lifecycle.completedAt = new Date().toISOString();
    report.pending = report.pending.filter(step => !["concern/clear/explicit inclusion", "profile isolation"].includes(step));
    report.status = "ordinary-feedback-lifecycle-passed"; report.completedAt = lifecycle.completedAt;
    await persist();
    return report;
  } catch (error) {
    lifecycle.status = "failed"; lifecycle.failure = String(error.message);
    await persist();
    throw error;
  }
}
