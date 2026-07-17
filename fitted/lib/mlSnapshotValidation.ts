/**
 * M5 central payload validation helper (C5, seam #5b) — the anti-corpus-lie boundary run BEFORE
 * every `.create()`. The Mongoose schema accepts documents a serde payload never produces but a
 * TS/service bug could (e.g. `scoreTrace.compatibility` has no [0,1] validator, shown arrays have
 * no cross-validator). This helper rejects those loudly (`contract_invalid`, no write) so a row
 * that lies about what produced it never persists.
 *
 * Scope of THIS helper = payload-integrity invariants that are self-contained in the payload:
 *   - finite numbers; compatibility/visibility ∈ [0,1]
 *   - candidateId uniqueness; itemSnapshots[].itemId uniqueness
 *   - exact shown-set equality (shownCandidateIds/shownFullSignatures == candidates with shown,
 *     contiguous shownPosition 0..n-1, nSurfaced == length)
 *   - every candidate content id (items[].itemId + slotMap values, shown OR unshown) resolves to
 *     an itemSnapshots row
 *   - scoreTrace coverage + algebra (G12): a candidate WITH a scoreBreakdown carries a complete,
 *     [0,1]-bounded, exact-sum trace; a breakdown-less drop needs none
 *   - styleMove/template semantics (G11): changedItemIds ⊆ the candidate's items, templateType
 *     matches the slotMap-derived template
 *   - engineFailure sanitize (G13): closed stage/code sets; a bounded, stack-trace/secret-free
 *     message; a 24-hex detail.itemId
 *
 * Deferred to the route (seam #6, they need inputs beyond the payload or belong to the writer):
 *   - the §G.1 G4 authorship cross-check (payload vs the normalized request)
 *   - the §A shown[].outfit-body cross-check (needs the wire `shown[]`, handled route-side)
 *   - RAW-FIELD caps (§G "raw-field caps"): the M5 WRITER truncates each raw field to its
 *     RAW_*_CAP_BYTES + records bytes/hash/truncation-flag (GenerationSnapshot.ts:23-26), so the
 *     bytes/hash/flag do not exist to validate until the writer has run. Conscious owner
 *     assignment: seam #6 truncates-then-validates the raw-field consistency (declared *Bytes ==
 *     actual, *Truncated flag consistent with the cap). It is NOT silently dropped — it moves to
 *     where the values are produced.
 *
 * Reference: docs/plans/m5-cutover.md §G validation helper + §G.1; ranker.py term set + sum invariant.
 */
import {
  ENGINE_FAILURE_STAGES,
  ENGINE_FAILURE_CODES,
  ENGINE_FAILURE_MESSAGE_MAX_CHARS,
} from "@/models/GenerationSnapshot";
import { OBJECT_ID_RE } from "@/lib/formats";

/** The one error channel for a payload that would persist a corrupt/lying corpus row. */
export class PayloadContractError extends Error {
  readonly code = "contract_invalid";
  constructor(message: string) {
    super(message);
    this.name = "PayloadContractError";
  }
}

const SUM_EPSILON = 1e-6;
const SCORE_TERMS = ["base", "combo", "item", "dislike", "overuse", "repetition", "cooldown"] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function fail(msg: string): never {
  throw new PayloadContractError(msg);
}
function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function inUnit(v: unknown): boolean {
  return isFiniteNum(v) && v >= 0 && v <= 1;
}

/** The slot→value pairs of a candidate's slotMap (skips absent slots). */
function slotValues(slotMap: Any): string[] {
  if (!slotMap || typeof slotMap !== "object") return [];
  return (["dress", "top", "bottom", "outer", "shoes"] as const)
    .map((s) => slotMap[s])
    .filter((v): v is string => typeof v === "string" && v.length > 0);
}

// role → slotMap slot (mirrors snapshot._SLOT_ROLE inverse). Used to reconstruct the slotMap
// implied by items[] and cross-check it against the declared slotMap (G — items↔slotMap consistency).
const ROLE_TO_SLOT: Record<string, string> = {
  base_top: "top",
  base_bottom: "bottom",
  one_piece: "dress",
  outer_layer: "outer",
  shoes: "shoes",
};

function validateItemsSlotMapConsistency(cand: Any, id: string): void {
  const items: Any[] = Array.isArray(cand.items) ? cand.items : [];
  if (items.length === 0) return; // a pre-validation drop (c5-style) carries neither
  const declared = cand.slotMap ?? {};
  // Reconstruct {slot: itemId} from items[]+roles; it must equal the declared filled-slot map.
  const expected: Record<string, string> = {};
  for (const it of items) {
    const slot = ROLE_TO_SLOT[it.role];
    if (!slot) fail(`candidate ${id}: item ${it.itemId} has unmapped role ${it.role}`);
    if (expected[slot] !== undefined) fail(`candidate ${id}: two items share role→slot ${slot}`);
    expected[slot] = it.itemId;
  }
  const declaredFilled = slotValues(cand.slotMap).length;
  if (declaredFilled !== Object.keys(expected).length) {
    fail(`candidate ${id}: items[] fills ${Object.keys(expected).length} slots but slotMap fills ${declaredFilled}`);
  }
  for (const [slot, itemId] of Object.entries(expected)) {
    if (declared[slot] !== itemId) {
      fail(`candidate ${id}: items[] puts ${itemId} in ${slot} but slotMap says ${declared[slot]}`);
    }
  }
}

function validateContentPreservation(cand: Any, id: string): void {
  if (cand.accepted === true) return;
  const items: Any[] = Array.isArray(cand.items) ? cand.items : [];
  const hasItemsAndSlotMap = items.length > 0 && slotValues(cand.slotMap).length > 0;
  const hasRawEmitted = cand.rawEmitted != null;
  if (!hasItemsAndSlotMap && !hasRawEmitted) {
    fail(`candidate ${id}: generated non-accepted candidate lacks items+slotMap or rawEmitted`);
  }
}

function validateScoreTrace(cand: Any, id: string): void {
  const trace = cand.scoreTrace;
  if (!trace) return;
  // Even a trace WITHOUT a breakdown must not carry a garbage compat/vis (the schema has no [0,1]
  // validator — the reason this helper exists). Not serde-producible, but a TS/service bug could.
  if (trace.compatibility != null && !inUnit(trace.compatibility)) fail(`candidate ${id}: compatibility out of [0,1]`);
  if (trace.visibility != null && !inUnit(trace.visibility)) fail(`candidate ${id}: visibility out of [0,1]`);
  // Same finite guard for the two other bare-`Number` trace fields, on EVERY path (not just the
  // with-breakdown branch below): `rankerScore` and `signalScore` (the reserved M6-scorer output
  // slot) have no schema validator, so an unguarded ±Infinity would persist. compat/vis are
  // already guarded breakdown-less above; these two were the asymmetry.
  if (trace.rankerScore != null && !isFiniteNum(trace.rankerScore)) fail(`candidate ${id}: rankerScore non-finite`);
  if (trace.signalScore != null && !isFiniteNum(trace.signalScore)) fail(`candidate ${id}: signalScore non-finite`);
  // Coverage key (G12): a candidate carries a scoreBreakdown IFF it was scored. A Step-4
  // hard-dropped candidate legitimately has none — do NOT require one.
  if (!trace.scoreBreakdown) return;
  const bd = trace.scoreBreakdown;
  for (const term of SCORE_TERMS) {
    if (!isFiniteNum(bd[term])) fail(`candidate ${id}: scoreBreakdown.${term} is missing/non-finite`);
  }
  if (!inUnit(trace.compatibility)) fail(`candidate ${id}: compatibility out of [0,1]`);
  if (!inUnit(trace.visibility)) fail(`candidate ${id}: visibility out of [0,1]`);
  if (!isFiniteNum(trace.rankerScore)) fail(`candidate ${id}: rankerScore non-finite`);
  const sum = SCORE_TERMS.reduce((acc, t) => acc + (bd[t] as number), 0);
  if (Math.abs(sum - (trace.rankerScore as number)) > SUM_EPSILON) {
    fail(`candidate ${id}: rankerScore ${trace.rankerScore} != term sum ${sum} (N4 invariant)`);
  }
}

function validateStyleMove(cand: Any, id: string, itemIds: Set<string>): void {
  const sm = cand.styleMove;
  if (!sm) return;
  if (typeof sm.moveType !== "string" || !sm.moveType.trim()) fail(`candidate ${id}: styleMove.moveType blank`);
  if (typeof sm.oneSentence !== "string" || !sm.oneSentence.trim()) {
    fail(`candidate ${id}: styleMove.oneSentence blank`);
  }
  const changed = sm.changedItemIds;
  if (!Array.isArray(changed) || changed.length === 0) fail(`candidate ${id}: styleMove.changedItemIds empty`);
  if (new Set(changed).size !== changed.length) fail(`candidate ${id}: styleMove.changedItemIds not unique`);
  for (const cid of changed) {
    // H23 invariant re-asserted: changed ids ⊆ the candidate's own items.
    if (!itemIds.has(cid)) fail(`candidate ${id}: styleMove references non-candidate item ${cid}`);
  }
}

function validateTemplate(cand: Any, id: string): void {
  // G11: templateType matches the template derived from slotMap (one_piece iff a dress slot is set;
  // two_piece iff top+bottom set). `template` on the wire is the candidate's declared template.
  const sm = cand.slotMap ?? {};
  const hasDress = typeof sm.dress === "string" && sm.dress.length > 0;
  const hasTopBottom =
    typeof sm.top === "string" && sm.top.length > 0 && typeof sm.bottom === "string" && sm.bottom.length > 0;
  const declared = cand.template;
  if (declared === undefined) return; // a drop with no assembled template
  if (hasDress && declared !== "one_piece") fail(`candidate ${id}: dress slot but template=${declared}`);
  if (!hasDress && hasTopBottom && declared !== "two_piece") {
    fail(`candidate ${id}: top+bottom slots but template=${declared}`);
  }
}

function validateEngineFailure(ef: Any): void {
  if (!ef) return;
  if (!ENGINE_FAILURE_STAGES.has(ef.stage)) fail(`engineFailure.stage ${ef.stage} out of set`);
  if (!ENGINE_FAILURE_CODES.has(ef.code)) fail(`engineFailure.code ${ef.code} out of set`);
  const msg = ef.message;
  if (typeof msg === "string") {
    if (msg.length > ENGINE_FAILURE_MESSAGE_MAX_CHARS) fail("engineFailure.message over the cap");
    if (msg.includes("Traceback") || msg.includes('  File "')) fail("engineFailure.message contains a stack trace");
    if (/sk-[A-Za-z0-9]/.test(msg)) fail("engineFailure.message contains a key-shaped substring");
    // A base64/hex run LONGER than a 24-hex ObjectId reads as a possible secret. The bound is >24
    // (i.e. 25+) precisely so a legitimate 24-hex id is never flagged; structured ids live in
    // `detail`, never interpolated into the message, so a 24-hex here would be anomalous anyway.
    if (/[A-Za-z0-9+/]{25,}/.test(msg)) fail("engineFailure.message contains a key-shaped run");
  }
  if (ef.detail && ef.detail.itemId !== undefined && !OBJECT_ID_RE.test(String(ef.detail.itemId))) {
    fail("engineFailure.detail.itemId is not a 24-hex ObjectId");
  }
}

/**
 * Validate the service payload before persistence. Throws PayloadContractError on the first
 * violation (the route maps it to the §A `contract_invalid` degraded state — no write).
 */
export function validateSnapshotPayload(payload: unknown): void {
  if (!payload || typeof payload !== "object") fail("payload is not an object");
  const p = payload as Any;

  const candidates: Any[] = Array.isArray(p.candidates) ? p.candidates : fail("candidates is not an array");
  const itemSnapshots: Any[] = Array.isArray(p.itemSnapshots)
    ? p.itemSnapshots
    : fail("itemSnapshots is not an array");

  // itemSnapshots[].itemId uniqueness + the coverage set.
  const knownItemIds = new Set<string>();
  for (const snap of itemSnapshots) {
    const iid = snap.itemId;
    if (typeof iid !== "string" || !iid) fail("itemSnapshots row missing itemId");
    if (knownItemIds.has(iid)) fail(`duplicate itemSnapshots itemId ${iid}`);
    knownItemIds.add(iid);
    // engineVisible.warmth is the one numeric ML feature the ranker conditions on, stored as a
    // bare Mongoose `Number` (no min/max/finite validator) — so Mongoose stores ±Infinity
    // silently (it rejects only NaN). This helper is the sole guard: a non-finite / out-of-range
    // warmth would persist into the immutable corpus M6 trains on. Range mirrors the ingestion
    // derivation + the adapter bound (0..10).
    const warmth = snap.engineVisible?.warmth;
    if (warmth != null && (!isFiniteNum(warmth) || warmth < 0 || warmth > 10)) {
      fail(`itemSnapshots ${iid}: engineVisible.warmth ${warmth} is non-finite or outside [0,10]`);
    }
  }

  // Per-candidate: id uniqueness, content-id coverage, scoreTrace, styleMove, template.
  const seenCandidateIds = new Set<string>();
  const shownFromCandidates: Array<{ position: number; candidateId: string; fullSignature: string }> = [];
  for (const cand of candidates) {
    const id = cand.candidateId;
    if (typeof id !== "string" || !id) fail("candidate missing candidateId");
    if (seenCandidateIds.has(id)) fail(`duplicate candidateId ${id}`);
    seenCandidateIds.add(id);

    // Every content id (items[].itemId AND slotMap values), shown or unshown, resolves to a snapshot.
    const items: Any[] = Array.isArray(cand.items) ? cand.items : [];
    const itemIdSet = new Set<string>();
    for (const it of items) {
      if (typeof it.itemId !== "string" || !it.itemId) fail(`candidate ${id}: item missing itemId`);
      itemIdSet.add(it.itemId);
      if (!knownItemIds.has(it.itemId)) fail(`candidate ${id}: item ${it.itemId} absent from itemSnapshots`);
    }
    for (const sv of slotValues(cand.slotMap)) {
      if (!knownItemIds.has(sv)) fail(`candidate ${id}: slotMap item ${sv} absent from itemSnapshots`);
    }

    validateContentPreservation(cand, id);
    validateItemsSlotMapConsistency(cand, id);
    validateScoreTrace(cand, id);
    validateStyleMove(cand, id, itemIdSet);
    validateTemplate(cand, id);

    if (cand.shown === true) {
      if (!isFiniteNum(cand.shownPosition)) fail(`shown candidate ${id} missing shownPosition`);
      if (typeof cand.fullSignature !== "string") fail(`shown candidate ${id} missing fullSignature`);
      shownFromCandidates.push({
        position: cand.shownPosition,
        candidateId: id,
        fullSignature: cand.fullSignature,
      });
    }
  }

  // Exact shown-set equality: shownCandidateIds/shownFullSignatures must equal the shown candidates
  // sorted by contiguous shownPosition 0..n-1, and nSurfaced == that length (NOT a subset).
  shownFromCandidates.sort((a, b) => a.position - b.position);
  shownFromCandidates.forEach((s, i) => {
    if (s.position !== i) fail(`shownPosition not contiguous 0..n-1 (got ${s.position} at index ${i})`);
  });
  const expectedIds = shownFromCandidates.map((s) => s.candidateId);
  const expectedSigs = shownFromCandidates.map((s) => s.fullSignature);
  const declaredIds: unknown = p.shownCandidateIds;
  const declaredSigs: unknown = p.shownFullSignatures;
  if (!Array.isArray(declaredIds) || !arraysEqual(declaredIds, expectedIds)) {
    fail("shownCandidateIds != the shown candidates in shownPosition order");
  }
  if (!Array.isArray(declaredSigs) || !arraysEqual(declaredSigs, expectedSigs)) {
    fail("shownFullSignatures != the shown candidates in shownPosition order");
  }
  if (p.nSurfaced !== expectedIds.length) {
    fail(`nSurfaced ${p.nSurfaced} != shown count ${expectedIds.length}`);
  }

  validateEngineFailure(p.diagnostics?.engineFailure);
}

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
