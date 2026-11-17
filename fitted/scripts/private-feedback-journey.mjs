/** Opt-in bounded private operator collection. This is test tooling, never owner preference evidence. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ObjectId } from "mongodb";
import { writePrivateReplayReport } from "./private-replay-input.mjs";
import { TARGET_FEEDBACK, MAX_RENDER_REQUESTS, OPERATOR_LABELS, collectionState, reserveRender,
  displayedUnrated, acknowledgeOperatorReaction, chooseSupplyAnchor, compositionKey } from "./private-feedback-contract.mjs";
import { runPrivateFeedbackLifecycle } from "./private-feedback-lifecycle.mjs";
import { verifyCapturedRender, collectedObservation, verifyProbeEvidence } from "./private-feedback-verification.mjs";
import { openTimeAndWeather } from "./home-browser-controls.mjs";

const cardsOn = page => page.locator(".p-5.border.rounded-xl").filter({ has: page.getByRole("button", { name: "Regenerate", exact: true }) });
export async function runPrivateFeedbackJourney({ db, page, owner, origin, loaded, run, paceRender, report, first, annotate, privateLifecycle = false }) {
  const user = new ObjectId(owner.userId), state = collectionState(), renders = [], observations = [], sources = new Map();
  const context = first.row.styleContext;
  let auditOffset = 0, lifecycleRenderRequests = 0;
  report.checkpoint = "ordinary-operator-feedback";
  report.status = "collecting-operator-test-feedback";
  report.collection = { labelProvenance: "Fixed predeclared alternating operator test labels; not the owner's preferences", labels: OPERATOR_LABELS,
    target: TARGET_FEEDBACK, maximumRenderRequests: MAX_RENDER_REQUESTS, renders, observations, complete: false };
  const audit = async () => (await readFile(run.auditPath, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  async function inspect(render, kind, expectedContext = context) {
    const events = await audit();
    verifyCapturedRender({ ...render, loaded, context: expectedContext, ownerId: owner.userId, events: events.slice(auditOffset) });
    auditOffset = events.length;
    assert.ok(!sources.has(String(render.row._id)), "each visible generation has a fresh snapshot");
    sources.set(String(render.row._id), render.row);
    renders.push({ kind, requestId: render.request.requestId, snapshotId: String(render.row._id), shownCandidateIds: render.row.shownCandidateIds,
      shownGarmentIds: render.result.shown.map(outfit => outfit.displayItems.map(item => item.itemId)), preference: render.row.preference });
    await page.waitForFunction(snapshotId => Array.from(document.querySelectorAll("a")).some(link => link.getAttribute("href")?.includes(`snapshotId=${snapshotId}`)), String(render.row._id));
    const cards = cardsOn(page); assert.equal(await cards.count(), render.result.shown.length);
    for (let index = 0; index < render.result.shown.length; index++) {
      const outfit = render.result.shown[index], card = cards.nth(index);
      assert.deepEqual((await card.locator(".grid p.font-medium").allTextContents()).map(name => name.trim()).sort(), outfit.displayItems.map(item => item.name).sort());
      assert.deepEqual(await card.locator("img").evaluateAll(images => images.map(image => image.getAttribute("src")).sort()), outfit.displayItems.map(item => item.imageUrl).sort(), "actual photos identify the displayed response members");
    }
    const memberCount = render.result.shown.reduce((count, outfit) => count + outfit.displayItems.length, 0);
    await cards.locator("img").evaluateAll(images => images.forEach(image => { image.loading = "eager"; }));
    await page.waitForFunction(expected => {
      const images = Array.from(document.querySelectorAll(".p-5.border.rounded-xl img"));
      return images.length === expected && images.every(image => image.complete && image.naturalWidth > 0);
    }, memberCount);
    assert.equal(await cards.locator("img").count(), memberCount);
    await writePrivateReplayReport(run, report);
    return render;
  }
  async function collect(render) {
    let added = 0;
    for (const selected of displayedUnrated(render.result.shown, state.seen)) {
      if (state.feedback.length === TARGET_FEEDBACK) break;
      const action = OPERATOR_LABELS[state.feedback.length], card = cardsOn(page).nth(selected.index);
      const [response] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/interactions") && response.request().method() === "POST"),
        card.getByRole("button", { name: action === "accepted" ? "Like" : "Dislike", exact: true }).click(),
      ]);
      const receipt = await response.json(); assert.equal(response.status(), 200, "ordinary operator reaction must acknowledge successfully");
      const command = response.request().postDataJSON();
      assert.deepEqual(command, { snapshotId: selected.outfit.snapshotId, candidateId: selected.outfit.candidateId, action }, "ordinary UI sends only the actual shown binding and authored vote");
      assert.equal(receipt.interaction?.action, action);
      const vote = await db.collection("outfitinteractions").findOne({ _id: new ObjectId(receipt.interaction.id), user });
      assert.ok(vote && vote.candidateId === selected.outfit.candidateId && String(vote.snapshotId) === selected.outfit.snapshotId);
      const observation = collectedObservation(vote, render.row, action);
      assert.equal(compositionKey(observation.items.map(item => item.id)), selected.key);
      // Chips are optimistic. This exact-card control appears only after React consumes reactionId.
      await card.getByRole("button", { name: "Something’s off", exact: true }).waitFor();
      acknowledgeOperatorReaction(state, { action, reactionId: String(vote._id), compositionKey: selected.key, itemIds: observation.items.map(item => item.id),
        snapshotId: observation.snapshotId, candidateId: observation.candidateId });
      observations.push(observation); added++;
      report.operatorFeedback = state.feedback;
      await writePrivateReplayReport(run, report);
    }
    return added;
  }
  async function generate(kind, anchor, expectedContext = context, lifecycle = false) {
    if (!lifecycle) reserveRender(state, kind);
    else {
      assert.ok(lifecycleRenderRequests < 5, "lifecycle phase permits at most five explicit probes");
      lifecycleRenderRequests++;
    }
    if (anchor) {
      await page.goto(`${origin}/wardrobe`);
      await page.locator(`a[href^="/dashboard?rescue=${anchor.item.id}&"]`).click();
      await page.getByText("Building an outfit around", { exact: false }).waitFor();
      state.usedAnchors.add(anchor.item.id);
    } else {
      const clear = page.getByRole("button", { name: "Clear", exact: true });
      if (await clear.count()) await clear.click();
    }
    await page.locator("textarea").fill(first.request.occasion);
    await openTimeAndWeather(page);
    await page.getByRole("combobox", { name: "Temperature", exact: true }).selectOption("mild");
    await paceRender();
    const [response] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/recommend") && response.request().method() === "POST"),
      page.getByRole("button", { name: "Get Recommendations", exact: true }).click(),
    ]);
    const result = await response.json(), request = response.request().postDataJSON();
    assert.equal(response.status(), 200, "bounded local collection request must succeed");
    const row = await db.collection("generationsnapshots").findOne({ user, requestId: request.requestId });
    assert.ok(row && result.bindable && result.shown?.length, "collection request must have a complete ordinary shown snapshot");
    const render = await inspect({ row, result, request }, kind, expectedContext);
    if (anchor) {
      assert.ok(result.shown.every(outfit => outfit.displayItems.some(item => item.itemId === anchor.item.id)), "real rescue control retains its supply-only anchor");
      renders.at(-1).supplyAnchor = { itemId: anchor.item.id, remainingDistinctSupply: anchor.remainingDistinctSupply, selection: "unseen label-independent preserved supply" };
    }
    return render;
  }
  try {
    assert.equal(await db.collection("outfitinteractions").countDocuments({ user }), 0, "collection starts with no seeded votes or amendments");
    assert.equal(await db.collection("generationsnapshots").countDocuments({ user }), 1, "only the recorded first normal render exists initially");
    await inspect(first, "first-ordinary");
    await collect(first);
    while (state.feedback.length < TARGET_FEEDBACK && state.renderRequests < MAX_RENDER_REQUESTS - 1) {
      const anchor = state.ordinaryRequests >= 2 ? chooseSupplyAnchor(loaded.input.drafts, loaded.input.wardrobe, state.seen, state.usedAnchors) : null;
      if (state.ordinaryRequests >= 2 && !anchor) break;
      const render = await generate(anchor ? "rescue" : "ordinary", anchor);
      await collect(render);
    }
    const probe = await generate("probe"); // Separate visible request; never a hidden retry to force activation.
    const ledger = await db.collection("outfitinteractions").find({ user }).toArray();
    assert.equal(ledger.length, state.feedback.length, "exactly the acknowledged ordinary reactions exist; no amendments or seeded history");
    assert.deepEqual(ledger.map(vote => String(vote._id)).sort(), state.feedback.map(record => record.reactionId).sort());
    const authoredActions = new Map(state.feedback.map(record => [record.reactionId, record.action]));
    const retained = ledger.map(vote => collectedObservation(vote, sources.get(String(vote.snapshotId)), authoredActions.get(String(vote._id))));
    const expected = verifyProbeEvidence(probe.row, retained);
    assert.equal(await db.collection("generationsnapshots").countDocuments({ user }), renders.length, "every owned snapshot originated in a recorded recommend response");
    assert.equal(renders.length, state.renderRequests); assert.ok(state.renderRequests <= MAX_RENDER_REQUESTS);
    report.sourceSelections = await audit();
    report.collection = { ...report.collection, renders: [...renders], renderRequests: state.renderRequests, distinctAcknowledgedCompositions: state.seen.size,
      complete: state.feedback.length === TARGET_FEEDBACK, expectedEvidence: expected, probe: renders.at(-1), activationRequired: false };
    if (report.collection.complete) {
      assert.deepEqual([expected.support, expected.likes, expected.dislikes], [6, 3, 3]);
      report.status = "ordinary-feedback-collection-passed";
      report.pending = report.pending.filter(step => step !== "six distinct operator-authored reactions");
    } else {
      report.status = "incomplete-ordinary-feedback-collection";
      report.collection.incompleteReason = "bounded requests or eligible preserved supply did not expose six distinct two-piece compositions";
    }
    await annotate();
    await page.screenshot({ path: path.join(run.runDirectory, "03-ordinary-feedback-probe.png"), fullPage: true });
    report.screenshots.push("03-ordinary-feedback-probe.png");
    if (privateLifecycle && report.collection.complete) {
      await runPrivateFeedbackLifecycle({ db, page, owner, origin, loaded, run, report, context, observations: retained, annotate,
        generate: (kind, expectedContext) => generate(kind, null, expectedContext, true) });
      assert.equal(await db.collection("generationsnapshots").countDocuments({ user }), renders.length, "all lifecycle snapshots also originate in recorded recommend responses");
      assert.equal(lifecycleRenderRequests, 5, "complete lifecycle has exactly five probes");
      report.totalRenderRequests = renders.length;
      report.sourceSelections = await audit();
    }
    report.completedAt = new Date().toISOString();
    await writePrivateReplayReport(run, report);
    return report;
  } catch (error) {
    report.status = "ordinary-feedback-check-failed"; report.collection.failure = String(error.message);
    report.collection.renderRequests = state.renderRequests;
    await writePrivateReplayReport(run, report);
    throw error;
  }
}
