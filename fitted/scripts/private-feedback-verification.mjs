/** Local replay assertions only; no generated candidates or personal labels are created here. */
import assert from "node:assert/strict";
import path from "node:path";
import { stableJson, sha256, compositionKey, expectedCollectedEvidence, expectedLifecycleEvidence } from "./private-feedback-contract.mjs";

export function privateFeedbackFlag(args) {
  const flags = args.filter(arg => arg === "--private-feedback");
  assert.ok(flags.length <= 1, "choose private feedback mode only once");
  if (!flags.length) return false;
  const inputs = args.filter(arg => arg.startsWith("--private-replay="));
  assert.ok(inputs.length === 1 && path.isAbsolute(inputs[0].slice("--private-replay=".length)), "private feedback requires one explicit absolute private replay input");
  assert.ok(!args.includes("--feedback-only") && !args.includes("--style-only"), "private feedback cannot mix focused journeys");
  return true;
}
export function capturedPartition(context) {
  return Object.fromEntries(Object.entries(context).filter(([key]) => key !== "memoryRevision"));
}
export function verifyIntactAttempts(row, events, loaded) {
  assert.ok(row.generationAttempts?.length > 0 && events.length === row.generationAttempts.length, "each captured generation attempt needs its own source audit");
  const originals = new Map(loaded.input.drafts.map(draft => [draft.sourceId, draft]));
  const bank = new Set(loaded.input.drafts.map(draft => stableJson(draft.outfit)));
  row.generationAttempts.forEach((attempt, index) => {
    const event = events[index];
    assert.equal(event.inputSha256, loaded.inputDigest, "audit pins the validated private input");
    assert.equal(event.kind, "preserved-draft-replay");
    const selected = event.selected.map(source => {
      const original = originals.get(source.sourceId);
      assert.ok(original, "audit source belongs to the preserved input");
      for (const key of ["sourceDigest", "jobId", "attemptIndex", "outfitIndex"]) assert.equal(source[key], original[key], "audit preserves original coordinates/digest");
      assert.equal(source.outfitSha256, sha256(stableJson(original.outfit)), "audit hashes the intact original object");
      return original.outfit;
    });
    const raw = JSON.parse(attempt.rawText).outfits;
    assert.ok(Array.isArray(raw) && raw.every(outfit => bank.has(stableJson(outfit))), "every raw attempt outfit remains an intact original, including prose");
    assert.deepEqual(raw, selected, "each attempt matches its exact pinned source selection");
  });
}
// Independent expected contract: declared unknown sentinels are absence, never
// inferred facts. Known pattern/fit values retain their exact trimmed spelling.
const UNKNOWN_DETAILS = new Set(["0", "unknown", "unspecified", "not specified", "none", "n/a", "not applicable"]);
const expectedDetail = value => value == null || UNKNOWN_DETAILS.has(value.trim().toLowerCase()) ? null : value.trim();
export function verifyCapturedRender({ row, result, request, loaded, context, events, ownerId }) {
  assert.equal(row.schemaVersion, 2); assert.equal(String(row.user), ownerId);
  assert.ok(!row.redacted && result.bindable && result.shown?.length > 0, "complete normal bound snapshot required");
  assert.equal(row.requestId, request.requestId);
  assert.equal(row.nSurfaced, result.shown.length, "captured surfaced count matches the actual shown response");
  assert.deepEqual(capturedPartition(row.styleContext), capturedPartition(context), "direction/versions/meaning/weather/opt-in stay fixed");
  assert.deepEqual(capturedPartition(result.styleContext), capturedPartition(context));
  assert.equal(row.styleContext.learningEnabled, true); assert.equal(row.styleContext.weather, "mild");
  assert.deepEqual(row.shownCandidateIds, result.shown.map(outfit => outfit.candidateId));
  assert.deepEqual(row.preference.shownFullSignatures, row.shownFullSignatures);
  verifyIntactAttempts(row, events, loaded);
  const wardrobe = new Map(loaded.input.wardrobe.map(item => [item.id, item]));
  const facts = new Map(row.itemSnapshots.map(item => [String(item.itemId), item.engineVisible]));
  for (const candidate of row.candidates) {
    for (const member of candidate.items) {
      const garment = wardrobe.get(String(member.itemId)), fact = facts.get(String(member.itemId));
      assert.ok(garment?.isAvailable && fact, "every candidate member has captured available facts");
      assert.equal(fact.subtype ?? null, garment.subCategory?.trim() ?? null, "declared subtype remains captured");
      assert.deepEqual(fact.colorTags, garment.colors.map(color => color.trim()), "the full declared color set stays intact");
      assert.equal(fact.pattern, expectedDetail(garment.pattern)); assert.equal(fact.fit, expectedDetail(garment.fit), "unknown fit stays null");
    }
  }
  for (const shown of result.shown) {
    assert.equal(shown.snapshotId, String(row._id));
    const candidate = row.candidates.find(candidate => candidate.candidateId === shown.candidateId);
    assert.ok(candidate && row.shownCandidateIds.includes(candidate.candidateId));
    assert.equal(compositionKey(shown.displayItems), compositionKey(candidate.items));
    assert.ok(shown.displayItems.every(item => typeof item.imageUrl === "string" && item.imageUrl.startsWith("/api/images/")), "every shown member retains its owner-bound image");
  }
}
export function collectedObservation(vote, row, expectedAction) {
  assert.ok(["accepted", "rejected"].includes(expectedAction), "an explicit predeclared operator action is required");
  assert.equal(vote.action, expectedAction, "stored reaction action matches this exact authored operator action");
  assert.equal(String(vote.user), String(row.user), "ordinary evidence must belong to the snapshot owner");
  assert.equal(String(vote.snapshotId), String(row._id));
  assert.ok(row.shownCandidateIds.includes(vote.candidateId), "ordinary vote binds an actually shown candidate");
  assert.equal(vote.learningDisposition, "normal"); assert.equal(vote.dispositionRevision, 0);
  assert.ok(vote.eventKind == null || vote.eventKind === "reaction");
  assert.ok(vote.feedbackReason == null && (!vote.perItemFeedback || vote.perItemFeedback.length === 0), "no reason/disposition amendments belong in this slice");
  assert.deepEqual(capturedPartition(vote.styleContext), capturedPartition(row.styleContext));
  const candidate = row.candidates.find(candidate => candidate.candidateId === vote.candidateId);
  const facts = new Map(row.itemSnapshots.map(item => [String(item.itemId), item.engineVisible]));
  const roles = { base_top: "top", base_bottom: "bottom", mid_layer: "mid", outer_layer: "outer", shoes: "shoes" };
  assert.equal(candidate.template, "two_piece");
  assert.equal(compositionKey(vote.items.map(String)), compositionKey(candidate.items), "stored ordinary reaction retains the complete shown composition");
  const context = row.styleContext;
  return { id: String(vote._id), snapshotId: String(row._id), candidateId: vote.candidateId, createdAt: new Date(vote.createdAt).toISOString(), action: vote.action,
    context: { ownerId: String(row.user), profileId: context.profileId, profileVersion: context.profileVersion, routineId: context.routineId, routineVersion: context.routineVersion, weather: context.weather },
    learningEnabled: true, learningDisposition: "normal", visible: true,
    items: candidate.items.map(item => {
      const fact = facts.get(String(item.itemId)); assert.ok(fact && roles[item.role]);
      return { id: String(item.itemId), role: roles[item.role], subtype: fact.subtype ?? null, colors: fact.colorTags, pattern: fact.pattern ?? null, fit: fact.fit ?? null };
    }) };
}
export function verifyProbeEvidence(row, observations) {
  assert.match(row.preference.featureVersion, /^app-traits\.v1$/);
  const expected = expectedCollectedEvidence(observations, row.preference.featureVersion, row.preference.schemaDigest);
  return verifyExpectedProbe(row, expected);
}
function verifyExpectedProbe(row, expected) {
  for (const key of ["support", "likes", "dislikes", "evidenceDigest", "evidenceCutoff"]) assert.equal(row.preference[key], expected[key], `probe ${key} matches independently reconstructed ordinary evidence`);
  if (row.preference.status === "abstained") {
    assert.ok(row.candidates.every(candidate => (candidate.scoreTrace?.scoreBreakdown?.preference ?? 0) === 0), "honest abstention has zero preference terms everywhere");
    assert.deepEqual(row.shownFullSignatures, row.preference.baselineShownFullSignatures, "abstention serves the complete current same-pool baseline");
  } else assert.equal(row.preference.status, "fitted_experimental");
  return expected;
}

export function verifyLifecycleProbe(row, observations, dispositions = new Map()) {
  assert.equal(row.preference.featureVersion, "app-traits.v1");
  const context = { ownerId: String(row.user), profileId: row.styleContext.profileId, profileVersion: row.styleContext.profileVersion,
    routineId: row.styleContext.routineId, routineVersion: row.styleContext.routineVersion, weather: row.styleContext.weather };
  const expected = expectedLifecycleEvidence(observations, context, dispositions, row.preference.featureVersion, row.preference.schemaDigest);
  return verifyExpectedProbe(row, expected);
}
export function privateLifecycleFlag(args) {
  const flags = args.filter(arg => arg === "--private-lifecycle");
  assert.ok(flags.length <= 1, "choose private lifecycle mode only once");
  if (!flags.length) return false;
  assert.ok(privateFeedbackFlag(args), "private lifecycle requires ordinary private feedback collection");
  return true;
}

export function verifyIsolatedTasteSignals(row) {
  assert.equal(row.interactionCountAtRequest, 0, "new profile cannot borrow ordinary feedback counts");
  const signals = row.diagnostics?.ranker;
  assert.ok(signals && typeof signals.reducerConfigVersion === "string" && signals.reducerConfigVersion.length > 0,
    "isolated request captures its actual reducer diagnostics");
  // Mongoose's default minimize removes empty Mixed objects when saving the
  // snapshot. An absent affinity map here represents the serialized empty map;
  // nonempty and null maps must still fail. The reducer marker/arrays are required.
  assert.deepEqual(signals.itemAffinity === undefined ? {} : signals.itemAffinity, {}, "new profile cannot borrow item affinity");
  for (const key of ["likedFullSignatures", "recentDislikedBaseKeys", "recentDislikedItemIds", "contextualDislikedItemIds"])
    assert.deepEqual(signals[key], [], `new profile cannot borrow ${key}`);
}

export function privateExclusionsFlag(args) {
  const flags = args.filter(arg => arg === "--private-exclusions");
  assert.ok(flags.length <= 1, "choose private exclusions mode only once");
  if (!flags.length) return false;
  const inputs = args.filter(arg => arg.startsWith("--private-replay="));
  assert.ok(inputs.length === 1 && path.isAbsolute(inputs[0].slice("--private-replay=".length)), "private exclusions requires one explicit absolute private replay input");
  assert.ok(!["--private-feedback", "--private-lifecycle", "--feedback-only", "--style-only"].some(flag => args.includes(flag)), "private exclusions is a separate focused journey");
  return true;
}
