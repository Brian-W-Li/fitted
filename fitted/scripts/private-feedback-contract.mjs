/** Bounded authored collection policy for local replay tests, never a preference model. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
export const TARGET_FEEDBACK = 6;
export const MAX_RENDER_REQUESTS = 6;
export const OPERATOR_LABELS = Object.freeze(["accepted", "rejected", "accepted", "rejected", "accepted", "rejected"]);
const HEX = /^[a-f0-9]{24}$/;
export function compositionKey(items) {
  assert.ok(Array.isArray(items) && items.length >= 2 && items.length <= 5, "complete bounded composition required");
  const ids = items.map(item => typeof item === "string" ? item : item.itemId);
  assert.ok(ids.every(id => typeof id === "string" && HEX.test(id)) && new Set(ids).size === ids.length, "unique canonical composition members required");
  return [...ids].sort().join("|");
}
export function displayedUnrated(shown, seen) {
  const selected = [], pending = new Set(seen);
  shown.forEach((outfit, index) => {
    if (outfit.templateType !== "two_piece") return;
    const key = compositionKey(outfit.displayItems);
    if (!pending.has(key)) { selected.push({ index, key, outfit }); pending.add(key); }
  });
  return selected;
}
export function collectionState() { return { renderRequests: 1, ordinaryRequests: 1, probeReserved: false, feedback: [], seen: new Set(), usedAnchors: new Set() }; }
export function reserveRender(state, kind) {
  assert.ok(["ordinary", "rescue", "probe"].includes(kind) && !state.probeReserved, "no render may follow the final probe");
  const limit = kind === "probe" ? MAX_RENDER_REQUESTS : MAX_RENDER_REQUESTS - 1;
  assert.ok(state.renderRequests < limit, "render budget preserves one final probe and never exceeds six");
  state.renderRequests++;
  if (kind === "ordinary") state.ordinaryRequests++;
  if (kind === "probe") state.probeReserved = true;
}
export function acknowledgeOperatorReaction(state, record) {
  assert.ok(state.feedback.length < TARGET_FEEDBACK, "authored reaction target is bounded at six");
  assert.equal(record.action, OPERATOR_LABELS[state.feedback.length], "operator label must follow the predeclared alternating sequence");
  assert.ok(HEX.test(record.reactionId) && !state.feedback.some(row => row.reactionId === record.reactionId), "unique acknowledged reaction receipt required");
  assert.equal(record.compositionKey, compositionKey(record.itemIds), "reaction must identify its actual complete composition");
  assert.ok(!state.seen.has(record.compositionKey), "a repeated composition cannot increase collection support");
  state.seen.add(record.compositionKey); state.feedback.push(record);
}
/** Supply only; no labels, scores, old answers or preferred-garment identities enter. */
export function chooseSupplyAnchor(drafts, wardrobe, seen, used = new Set()) {
  const available = new Set(wardrobe.filter(item => item.isAvailable).map(item => item.id));
  const compositions = new Map();
  for (const draft of drafts) {
    const roles = draft.outfit.items.map(item => item.role);
    if (roles.filter(role => role === "base_top").length !== 1 || roles.filter(role => role === "base_bottom").length !== 1 || roles.includes("one_piece")) continue;
    const members = draft.outfit.items.map(item => item.itemId);
    const key = compositionKey(members);
    if (members.every(id => available.has(id)) && !seen.has(key) && !compositions.has(key)) compositions.set(key, new Set(members));
  }
  const anchors = wardrobe.filter(item => item.isAvailable && ["top", "bottom"].includes(item.clothingType) && !used.has(item.id));
  let selected = null, count = 0;
  for (const anchor of anchors) {
    const supply = [...compositions.values()].filter(members => members.has(anchor.id)).length;
    if (supply > count) { selected = anchor; count = supply; }
  }
  return selected ? { item: selected, remainingDistinctSupply: count } : null;
}
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
export const stableJson = value => JSON.stringify(ordered(value));
export const sha256 = text => createHash("sha256").update(text).digest("hex");
const pythonJson = value => stableJson(value).replace(/[\u007f-\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
/** This slice has only unique normal votes: no flips, amendments or prior owner history. */
export function expectedCollectedEvidence(observations, featureVersion, schemaDigest) {
  assert.ok(observations.length <= TARGET_FEEDBACK && /^[a-f0-9]{64}$/.test(schemaDigest), "bounded feature-schema evidence required");
  const seen = new Set();
  for (const row of observations) {
    assert.ok(["accepted", "rejected"].includes(row.action) && row.learningEnabled === true && row.learningDisposition === "normal" && row.visible === true, "only acknowledged normal operator observations belong in this slice");
    const key = compositionKey(row.items.map(item => item.id)); assert.ok(!seen.has(key), "resolved compositions must be distinct"); seen.add(key);
  }
  const states = [...observations].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
  const keys = ["id", "snapshotId", "candidateId", "createdAt", "action", "context", "learningEnabled", "learningDisposition", "visible", "items"];
  const provenance = states.map(row => Object.fromEntries(keys.map(key => [key, row[key]])));
  return { support: states.length, likes: states.filter(row => row.action === "accepted").length, dislikes: states.filter(row => row.action === "rejected").length,
    evidenceDigest: sha256(pythonJson([featureVersion, schemaDigest, provenance])), evidenceCutoff: states[0]?.createdAt ?? null };
}
