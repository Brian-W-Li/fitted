/** Authored synthetic contracts only: no private records, services, browser or provider calls. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { privateFeedbackFlag, verifyIntactAttempts, verifyCapturedRender, collectedObservation, verifyProbeEvidence } from "../private-feedback-verification.mjs";
import { sha256, stableJson, expectedCollectedEvidence } from "../private-feedback-contract.mjs";
const id = number => number.toString(16).padStart(24, "0");
function fixture() {
  const context = { boardId: id(10), profileId: id(11), profileVersion: 1, routineId: id(12), routineVersion: 1,
    boardLabel: "Authored direction", routineLabel: "Authored situation", learningEnabled: true, weather: "mild", memoryRevision: 0,
    compiled: { aestheticKeywords: ["synthetic"], palette: [], patterns: [], fits: [] } };
  const wardrobe = [1, 2].map((number, index) => ({ id: id(number), isAvailable: true, subCategory: index ? "jeans" : "t_shirt", colors: index ? ["navy", "white"] : ["blue"], pattern: null, fit: null }));
  const outfit = { items: [{ itemId: id(1), role: "base_top" }, { itemId: id(2), role: "base_bottom" }], styleMove: { moveType: "color", changedItemIds: [id(1)], oneSentence: "Intact authored original." } };
  const draft = { sourceId: "authored-source", sourceDigest: "a".repeat(64), jobId: "authored-job", attemptIndex: 2, outfitIndex: 3, outfit };
  const loaded = { inputDigest: "b".repeat(64), input: { wardrobe, drafts: [draft] } };
  const event = { kind: "preserved-draft-replay", inputSha256: loaded.inputDigest, selected: [{ sourceId: draft.sourceId, sourceDigest: draft.sourceDigest,
    jobId: draft.jobId, attemptIndex: draft.attemptIndex, outfitIndex: draft.outfitIndex, outfitSha256: sha256(stableJson(outfit)) }] };
  const row = { _id: id(20), user: id(21), schemaVersion: 2, nSurfaced: 1, requestId: "authored-request", styleContext: structuredClone(context),
    generationAttempts: [{ rawText: JSON.stringify({ outfits: [outfit] }) }], shownCandidateIds: ["candidate-a"], shownFullSignatures: ["authored-full"],
    candidates: [{ candidateId: "candidate-a", template: "two_piece", items: outfit.items, scoreTrace: { scoreBreakdown: { preference: 0 } } }],
    itemSnapshots: wardrobe.map(item => ({ itemId: item.id, engineVisible: { subtype: item.subCategory, colorTags: [...item.colors], pattern: null, fit: null } })),
    preference: { status: "abstained", shownFullSignatures: ["authored-full"], baselineShownFullSignatures: ["authored-full"] } };
  const result = { bindable: true, styleContext: structuredClone(context), shown: [{ candidateId: "candidate-a", snapshotId: row._id,
    displayItems: wardrobe.map(item => ({ itemId: item.id, imageUrl: `/api/images/${item.id}` })) }] };
  const vote = { _id: id(30), user: row.user, snapshotId: row._id, candidateId: "candidate-a", action: "accepted", items: wardrobe.map(item => item.id),
    createdAt: new Date("2026-11-15T12:00:00Z"), styleContext: structuredClone(context), learningDisposition: "normal", dispositionRevision: 0 };
  return { loaded, row, result, request: { requestId: row.requestId }, context, events: [event], ownerId: row.user, vote };
}
test("explicit private feedback is opt-in, unique and exclusive; default replay remains first-request only", () => {
  assert.equal(privateFeedbackFlag([]), false);
  assert.equal(privateFeedbackFlag(["--private-replay=/synthetic/input.json"]), false);
  assert.equal(privateFeedbackFlag(["--private-replay=/synthetic/input.json", "--private-feedback"]), true);
  for (const args of [["--private-feedback"], ["--private-feedback", "--private-replay=relative.json"], ["--private-feedback", "--private-replay=/x", "--private-feedback"],
    ["--private-feedback", "--private-replay=/x", "--style-only"], ["--private-feedback", "--private-replay=/x", "--feedback-only"]]) assert.throws(() => privateFeedbackFlag(args));
});
test("CLI rejects invalid feedback flags before dependency checks, temporary workspace or service startup", () => {
  const harness = fileURLToPath(new URL("../baseline-browser.mjs", import.meta.url));
  for (const args of [["--private-feedback"], ["--private-feedback", "--private-replay=relative.json"], ["--private-feedback", "--private-replay=/synthetic/input", "--style-only"]]) {
    const result = spawnSync(process.execPath, [harness, ...args], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 1); assert.match(result.stderr, /private feedback/);
    assert.doesNotMatch(result.stdout, /Building isolated|Launching isolated/);
    assert.doesNotMatch(result.stderr, /dependencies differ|ENOENT/);
  }
});
test("all raw attempts need exact original objects and individual pinned source audits", () => {
  const f = fixture(); f.row.generationAttempts.push(structuredClone(f.row.generationAttempts[0])); f.events.push(structuredClone(f.events[0]));
  verifyIntactAttempts(f.row, f.events, f.loaded);
  assert.throws(() => verifyIntactAttempts(f.row, f.events.slice(0, 1), f.loaded), /each captured generation attempt/);
  f.row.generationAttempts[0].rawText = JSON.stringify({ outfits: [{ ...f.loaded.input.drafts[0].outfit, styleMove: { ...f.loaded.input.drafts[0].outfit.styleMove, oneSentence: "Changed prose" } }] });
  assert.throws(() => verifyIntactAttempts(f.row, f.events, f.loaded), /intact original/);
  const wrongCoordinate = fixture(); wrongCoordinate.events[0].selected[0].attemptIndex++;
  assert.throws(() => verifyIntactAttempts(wrongCoordinate.row, wrongCoordinate.events, wrongCoordinate.loaded), /coordinates/);
  const wrongHash = fixture(); wrongHash.events[0].selected[0].outfitSha256 = "c".repeat(64);
  assert.throws(() => verifyIntactAttempts(wrongHash.row, wrongHash.events, wrongHash.loaded), /hashes/);
});
test("normal snapshots preserve full colors, explicit unknown fit, shown membership and captured context", () => {
  verifyCapturedRender(fixture());
  for (const mutate of [f => { f.row.styleContext.profileVersion = 2; }, f => { f.row.styleContext.compiled.aestheticKeywords.push("fabricated trait"); },
    f => { f.row.nSurfaced = 2; }, f => { f.row.schemaVersion = 1; }, f => { f.row.itemSnapshots[1].engineVisible.colorTags.pop(); },
    f => { f.row.itemSnapshots[0].engineVisible.fit = "regular"; }, f => { f.row.itemSnapshots[0].engineVisible.subtype = "polo"; },
    f => { f.result.shown[0].displayItems.pop(); }, f => { f.result.shown[0].displayItems[0].imageUrl = null; },
    f => { f.context = { ...f.context, routineVersion: 2 }; }]) {
    const f = fixture(); mutate(f); assert.throws(() => verifyCapturedRender(f));
  }
  const revised = fixture(); revised.row.styleContext = { ...revised.context, memoryRevision: 6 }; verifyCapturedRender(revised);
});
test("declared unknown pattern/fit tokens become null without inventing known facts", () => {
  const f = fixture(); f.loaded.input.wardrobe[0].pattern = "unknown"; f.loaded.input.wardrobe[0].fit = " N/A ";
  verifyCapturedRender(f);
  f.row.itemSnapshots[0].engineVisible.fit = "regular";
  assert.throws(() => verifyCapturedRender(f), /unknown fit stays null/);
  for (const token of ["0", "UNKNOWN", "unspecified", "not specified", "none", "n/a", "not applicable"]) {
    const next = fixture(); next.loaded.input.wardrobe[0].pattern = token; next.loaded.input.wardrobe[0].fit = token;
    verifyCapturedRender(next);
  }
  const known = fixture(); known.loaded.input.wardrobe[0].pattern = " solid "; known.loaded.input.wardrobe[0].fit = " Relaxed ";
  known.row.itemSnapshots[0].engineVisible.pattern = "solid"; known.row.itemSnapshots[0].engineVisible.fit = "Relaxed";
  verifyCapturedRender(known);
  known.row.itemSnapshots[0].engineVisible.fit = "relaxed";
  assert.throws(() => verifyCapturedRender(known), /unknown fit stays null/);
});
test("ordinary evidence is source-bound, complete and normal, excluding amendments and composition mismatches", () => {
  const f = fixture(), observation = collectedObservation(f.vote, f.row, "accepted");
  assert.deepEqual(observation.items[1].colors, ["navy", "white"]); assert.equal(observation.items[1].fit, null);
  for (const mutate of [vote => { vote.user = id(91); }, vote => { vote.items.pop(); }, vote => { vote.learningDisposition = "exception"; }, vote => { vote.dispositionRevision = 1; },
    vote => { vote.eventKind = "reason_amendment"; }, vote => { vote.feedbackReason = { rawText: "Not a plain label" }; }, vote => { vote.snapshotId = id(90); }]) {
    const next = fixture(); mutate(next.vote); assert.throws(() => collectedObservation(next.vote, next.row, "accepted"));
  }
});
test("stored votes match each exact authored action even when swapped signs preserve aggregate balance", () => {
  const first = fixture(), second = fixture(); second.vote._id = id(31); second.vote.action = "rejected";
  assert.equal([first.vote, second.vote].filter(vote => vote.action === "accepted").length, 1);
  collectedObservation(first.vote, first.row, "accepted"); collectedObservation(second.vote, second.row, "rejected");
  assert.throws(() => collectedObservation(first.vote, first.row), /explicit predeclared operator action/);
  first.vote.action = "rejected"; second.vote.action = "accepted";
  assert.equal([first.vote, second.vote].filter(vote => vote.action === "accepted").length, 1, "balanced signs alone cannot prove per-reaction correctness");
  assert.throws(() => collectedObservation(first.vote, first.row, "accepted"), /stored reaction action/);
  assert.throws(() => collectedObservation(second.vote, second.row, "rejected"), /stored reaction action/);
});
test("probe verifies independent counts/digest/cutoff and honest current baseline without requiring activation", () => {
  const f = fixture(), observation = collectedObservation(f.vote, f.row, "accepted");
  const expected = expectedCollectedEvidence([observation], "app-traits.v1", "c".repeat(64));
  Object.assign(f.row.preference, expected, { featureVersion: "app-traits.v1", schemaDigest: "c".repeat(64) });
  assert.deepEqual(verifyProbeEvidence(f.row, [observation]), expected);
  const unscored = structuredClone(f.row); unscored.candidates.push({ scoreTrace: null });
  assert.deepEqual(verifyProbeEvidence(unscored, [observation]), expected, "rejected unscored candidates cannot have a preference term");
  const tampered = structuredClone(f.row); tampered.preference.evidenceDigest = "d".repeat(64);
  assert.throws(() => verifyProbeEvidence(tampered, [observation]), /evidenceDigest/);
  const nonzero = structuredClone(f.row); nonzero.candidates[0].scoreTrace.scoreBreakdown.preference = 0.1;
  assert.throws(() => verifyProbeEvidence(nonzero, [observation]), /zero preference/);
  const different = structuredClone(f.row); different.preference.baselineShownFullSignatures = ["old-not-current-baseline"];
  assert.throws(() => verifyProbeEvidence(different, [observation]), /current same-pool baseline/);
});
