/** Pending runtime collector policy only. All facts and labels below are authored synthetic tests. */
import test from "node:test";
import assert from "node:assert/strict";
import { compositionKey, displayedUnrated, collectionState, reserveRender, acknowledgeOperatorReaction,
  chooseSupplyAnchor, expectedCollectedEvidence, OPERATOR_LABELS, MAX_RENDER_REQUESTS } from "../private-feedback-contract.mjs";
const id = number => number.toString(16).padStart(24, "0");
const pair = number => [id(1000 + number * 2), id(1001 + number * 2)];
const record = (number, action = OPERATOR_LABELS[number]) => ({ action, reactionId: id(100 + number), itemIds: pair(number), compositionKey: compositionKey(pair(number)) });
const shown = (members, extra = {}) => ({ templateType: "two_piece", displayItems: members.map(itemId => ({ itemId })), ...extra });

test("deduplicates actual garment sets across ordering/snapshots and skips unsupported shown templates", () => {
  assert.equal(compositionKey(pair(0)), compositionKey([...pair(0)].reverse()));
  const candidates = [shown(pair(0)), shown([...pair(0)].reverse(), { snapshotId: id(900) }), shown(pair(1)), { templateType: "one_piece", displayItems: [{ itemId: id(999) }] }];
  assert.deepEqual(displayedUnrated(candidates, new Set()).map(row => row.index), [0, 2]);
  assert.deepEqual(displayedUnrated(candidates, new Set([compositionKey(pair(0))])).map(row => row.index), [2]);
  assert.throws(() => compositionKey([pair(0)[0], pair(0)[0]]), /unique canonical/);
});
test("acknowledges only six distinct receipts in the fixed alternating operator sequence", () => {
  const state = collectionState();
  assert.deepEqual(OPERATOR_LABELS, ["accepted", "rejected", "accepted", "rejected", "accepted", "rejected"]);
  assert.equal(Object.isFrozen(OPERATOR_LABELS), true);
  assert.throws(() => acknowledgeOperatorReaction(state, record(0, "rejected")), /predeclared alternating/);
  assert.equal(state.feedback.length, 0);
  acknowledgeOperatorReaction(state, record(0));
  assert.throws(() => acknowledgeOperatorReaction(state, { ...record(1), itemIds: pair(0), compositionKey: compositionKey(pair(0)) }), /repeated composition/);
  assert.equal(state.feedback.length, 1);
  // Six is the review contract, independent of the implementation's target constant.
  for (let number = 1; number < 6; number++) acknowledgeOperatorReaction(state, record(number));
  assert.equal(state.feedback.length, 6);
  assert.throws(() => acknowledgeOperatorReaction(state, record(6)), /bounded at six/, "an out-of-sequence seventh record must not become an undefined label");
  assert.equal(state.feedback.filter(row => row.action === "accepted").length, 3);
  assert.equal(state.feedback.filter(row => row.action === "rejected").length, 3);
  assert.throws(() => acknowledgeOperatorReaction(state, record(6, "accepted")), /bounded at six/);
});
test("reserves the final probe inside the six-render total and forbids later collection", () => {
  const state = collectionState(); assert.equal(state.renderRequests, 1, "the first checkpoint already consumed one render");
  for (let number = 0; number < 4; number++) reserveRender(state, number === 2 ? "rescue" : "ordinary");
  assert.equal(state.renderRequests, MAX_RENDER_REQUESTS - 1);
  assert.throws(() => reserveRender(state, "ordinary"), /preserves one final probe/);
  assert.equal(state.renderRequests, 5, "a rejected reservation consumes no render");
  reserveRender(state, "probe"); assert.equal(state.renderRequests, MAX_RENDER_REQUESTS);
  assert.throws(() => reserveRender(state, "probe"), /no render may follow/);
  assert.throws(() => reserveRender(state, "rescue"), /no render may follow/);
  const incomplete = collectionState(); reserveRender(incomplete, "probe");
  assert.equal(incomplete.feedback.length, 0, "probing incomplete collection must never fabricate labels");
});
test("mixed preserved banks skip valid one-piece outfits before composition checks and choose anchors from unique unseen supply", () => {
  const top = id(1), firstBottom = id(2), secondBottom = id(3), dress = id(4);
  const wardrobe = [{ id: dress, clothingType: "dress", isAvailable: true }, { id: top, clothingType: "top", isAvailable: true },
    { id: firstBottom, clothingType: "bottom", isAvailable: true }, { id: secondBottom, clothingType: "bottom", isAvailable: true }];
  const outfit = members => ({ outfit: { items: members } });
  const first = outfit([{ itemId: top, role: "base_top" }, { itemId: firstBottom, role: "base_bottom" }]);
  const drafts = [outfit([{ itemId: dress, role: "one_piece" }]), first,
    outfit([...first.outfit.items].reverse()), outfit([{ itemId: top, role: "base_top" }, { itemId: secondBottom, role: "base_bottom" }])];
  assert.deepEqual(chooseSupplyAnchor(drafts, wardrobe, new Set()), { item: wardrobe[1], remainingDistinctSupply: 2 });
  const seen = new Set([compositionKey([top, firstBottom])]);
  assert.deepEqual(chooseSupplyAnchor(drafts, wardrobe, seen, new Set([top])), { item: wardrobe[3], remainingDistinctSupply: 1 });
  assert.equal(chooseSupplyAnchor(drafts, wardrobe.map(row => ({ ...row, isAvailable: false })), new Set()), null);
  assert.equal(chooseSupplyAnchor(drafts.slice(0, 1), wardrobe, new Set()), null, "one-piece supply is not two-piece learning support");
});
function observations() {
  return Array.from({ length: 6 }, (_, number) => ({ id: id(100 + number), snapshotId: id(200 + number), candidateId: `candidate-${number}`,
    createdAt: "2026-11-09T12:00:00.000Z", action: OPERATOR_LABELS[number],
    context: { ownerId: "f".repeat(24), profileId: "e".repeat(24), profileVersion: 1, routineId: "d".repeat(24), routineVersion: 1, weather: "mild" },
    learningEnabled: true, learningDisposition: "normal", visible: true,
    items: [{ id: pair(number)[0], role: "top", subtype: "shirt", colors: ["blå"], pattern: null, fit: null },
      { id: pair(number)[1], role: "bottom", subtype: "pants", colors: ["white", "blue"], pattern: null, fit: null }] }));
}
test("matches a Python canonical evidence digest including Unicode, unknowns and same-time ID ordering", () => {
  const expected = expectedCollectedEvidence(observations().reverse(), "app-traits.v1", "a".repeat(64));
  assert.deepEqual(expected, { support: 6, likes: 3, dislikes: 3,
    evidenceDigest: "8890233a55ea480ba51b98188abadd295f9375aafd927bd871812d28b0586a02", evidenceCutoff: "2026-11-09T12:00:00.000Z" });
  assert.equal(expectedCollectedEvidence(observations(), "app-traits.v1", "a".repeat(64)).evidenceDigest, expected.evidenceDigest);
});
test("does not count exceptions or duplicate compositions as resolved normal evidence", () => {
  const rows = observations(); rows[0].learningDisposition = "exception";
  assert.throws(() => expectedCollectedEvidence(rows, "app-traits.v1", "a".repeat(64)), /normal operator observations/);
  const duplicate = observations(); duplicate[1].items = structuredClone(duplicate[0].items);
  assert.throws(() => expectedCollectedEvidence(duplicate, "app-traits.v1", "a".repeat(64)), /compositions must be distinct/);
});
