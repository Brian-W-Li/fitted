/**
 * LIVE-CORPUS read-back verifier (Track 2 / Lane G) — NOT part of `npm test` / CI.
 *
 * Certifies the M6 training corpus as it accumulates: connects READ-ONLY to a real database
 * (the Track 2 Atlas, or any Mongo holding `fitted` collections) and drives the repo's REAL
 * validation units over every persisted GenerationSnapshot + OutfitInteraction — the same
 * invariants the write path enforces, re-proven against what Mongo actually stored, plus the
 * cross-row invariants no single write can see (lineage chains, requestId uniqueness,
 * candidateCacheKey truthfulness, feedback join-back).
 *
 * Run (read-only; safe against the live friend corpus):
 *   CORPUS_READBACK_URI="$(grep '^MONGODB_URI_ATLAS=' .env.local | cut -d= -f2-)" \
 *     npx jest corpusReadback --runInBand
 * Skips entirely unless CORPUS_READBACK_URI is set — so `npm test` / CI never touch a real DB.
 */
import mongoose from "mongoose";
// The read-back truth check that a stored candidateCacheKey really is the sha256 of the row's
// OWN Lens-chain fields. Shared with the CI known-answer pin (crossRuntimeContract.test.ts), so
// the recompute can't drift from seed.py while this gated verifier sits idle.
import { recomputeCandidateCacheKey } from "./helpers/candidateCacheKey";
import { validateSnapshotPayload } from "@/lib/mlSnapshotValidation";
import { projectInteractionRow } from "@/lib/mlBehavioralRows";
import { isValidRequestId, OBJECT_ID_RE, SEED_DATE_RE } from "@/lib/formats";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const URI = process.env.CORPUS_READBACK_URI;
const gate = URI ? describe : describe.skip;

const GENERATOR_REQUIRED_KEYS = [
  "provider",
  "model",
  "temperature",
  "promptVersion",
  "maxCompletionTokens",
  "apiSurface",
  "responseFormat",
  "reasoningEffort",
  "storeMode",
  "promptCacheRetention",
  "timeoutSeconds",
  "maxRetries",
] as const;

let conn: mongoose.Connection;
let snapshots: Any[];
let interactions: Any[];
let userIds: Set<string>;

/** Collect violations with row context so one failing expect names every bad row at once. */
function violationsToString(v: string[]): string {
  return v.length === 0 ? "" : `\n${v.join("\n")}`;
}

gate("live corpus read-back — GenerationSnapshot + OutfitInteraction integrity", () => {
  beforeAll(async () => {
    conn = await mongoose.createConnection(URI as string).asPromise();
    const db = conn.db!;
    snapshots = await db.collection("generationsnapshots").find({}).sort({ createdAt: 1 }).toArray();
    interactions = await db.collection("outfitinteractions").find({}).sort({ createdAt: 1 }).toArray();
    const users = await db.collection("users").find({}, { projection: { _id: 1 } }).toArray();
    userIds = new Set(users.map((u: Any) => String(u._id)));
    console.log(`[corpus] ${snapshots.length} snapshots, ${interactions.length} interactions`);
  }, 30_000);

  afterAll(async () => {
    await conn.close();
  });

  it("every snapshot passes the real payload validator (funnel/shown/scoreTrace invariants)", () => {
    const violations: string[] = [];
    for (const s of snapshots) {
      try {
        validateSnapshotPayload(s);
      } catch (err) {
        violations.push(`${s._id}: ${(err as Error).message}`);
      }
    }
    expect(violationsToString(violations)).toBe("");
  });

  it("every snapshot carries complete identity + provenance (§15.1 required groups)", () => {
    const violations: string[] = [];
    for (const s of snapshots) {
      const id = String(s._id);
      if (s.schemaVersion !== 1) violations.push(`${id}: schemaVersion ${s.schemaVersion}`);
      if (!s.user) violations.push(`${id}: missing user`);
      if (s.sessionId !== String(s.user)) violations.push(`${id}: sessionId != user`);
      if (typeof s.requestId !== "string" || s.requestId.length > 64 || !isValidRequestId(s.requestId)) {
        violations.push(`${id}: bad requestId ${JSON.stringify(s.requestId)}`);
      }
      if (typeof s.candidateCacheKey !== "string" || !/^[0-9a-f]{64}$/.test(s.candidateCacheKey)) {
        violations.push(`${id}: bad candidateCacheKey`);
      } else if (recomputeCandidateCacheKey(s) !== s.candidateCacheKey) {
        violations.push(`${id}: candidateCacheKey does not hash from the row's own Lens fields`);
      }
      if (typeof s.seedDate !== "string" || !SEED_DATE_RE.test(s.seedDate)) {
        violations.push(`${id}: bad seedDate ${JSON.stringify(s.seedDate)}`);
      }
      if (!s.controls || !Array.isArray(s.controls.lockedItemIds) || !Array.isArray(s.controls.dislikedItemIds)) {
        violations.push(`${id}: controls absent/malformed (must be explicit, even when empty)`);
      }
      if (!s.fittedCoreVersion) violations.push(`${id}: missing fittedCoreVersion`);
      if (!s.rankerConfigVersion) violations.push(`${id}: missing rankerConfigVersion`);
      const g = s.generator ?? {};
      for (const key of GENERATOR_REQUIRED_KEYS) {
        if (g[key] == null) violations.push(`${id}: generator.${key} missing/null`);
      }
      const scorer = s.scorer ?? {};
      if (scorer.kind !== "cold_start" && scorer.kind !== "trained") {
        violations.push(`${id}: scorer.kind ${JSON.stringify(scorer.kind)}`);
      }
      if (typeof scorer.available !== "boolean") violations.push(`${id}: scorer.available not boolean`);
      if (typeof s.interactionCountAtRequest !== "number") {
        violations.push(`${id}: interactionCountAtRequest missing`);
      }
      // itemSnapshots: opaque 24-hex ids + finite in-range warmth (the one numeric ML feature).
      for (const it of s.itemSnapshots ?? []) {
        if (typeof it.itemId !== "string" || !OBJECT_ID_RE.test(it.itemId)) {
          violations.push(`${id}: itemSnapshots itemId ${JSON.stringify(it.itemId)} not 24-hex`);
        }
        if (!it.engineVisible) violations.push(`${id}: itemSnapshots ${it.itemId} missing engineVisible`);
      }
      if (typeof s.redacted !== "boolean") violations.push(`${id}: redacted not boolean`);
      if (s.redacted === true && !s.redactedAt) violations.push(`${id}: redacted without redactedAt`);
      if (!s.createdAt) violations.push(`${id}: missing createdAt (M6 batch read keys on it)`);
    }
    expect(violationsToString(violations)).toBe("");
  });

  it("lineage reconstructs: every re-roll points at a real same-user parent and stays in its Lens chain", () => {
    const byId = new Map<string, Any>(snapshots.map((s) => [String(s._id), s]));
    const violations: string[] = [];
    for (const s of snapshots) {
      const id = String(s._id);
      if (s.parentSnapshotId == null) {
        if (s.generationIndex !== 0) violations.push(`${id}: root with generationIndex ${s.generationIndex}`);
        continue;
      }
      const parent = byId.get(String(s.parentSnapshotId));
      if (!parent) {
        violations.push(`${id}: parentSnapshotId ${s.parentSnapshotId} not in corpus (orphaned re-roll)`);
        continue;
      }
      if (String(parent.user) !== String(s.user)) violations.push(`${id}: parent belongs to another user`);
      if (s.generationIndex !== (parent.generationIndex ?? 0) + 1) {
        violations.push(`${id}: generationIndex ${s.generationIndex} != parent+1 (${parent.generationIndex})`);
      }
      if (s.candidateCacheKey !== parent.candidateCacheKey) {
        violations.push(`${id}: re-roll candidateCacheKey differs from parent (Lens-chain broken)`);
      }
      for (const field of ["intent", "occasion", "weather", "seedDate"] as const) {
        if (s[field] !== parent[field]) violations.push(`${id}: re-roll ${field} differs from parent`);
      }
    }
    expect(violationsToString(violations)).toBe("");
  });

  it("requestId is unique per user (the idempotency index holds on the real data)", () => {
    const seen = new Map<string, string>();
    const violations: string[] = [];
    for (const s of snapshots) {
      const key = `${s.user}:${s.requestId}`;
      const prior = seen.get(key);
      if (prior) violations.push(`${s._id}: duplicate {user, requestId} with ${prior}`);
      seen.set(key, String(s._id));
    }
    expect(violationsToString(violations)).toBe("");
  });

  it("every bound interaction joins back to the exact shown candidate it reacted to", () => {
    const byId = new Map<string, Any>(snapshots.map((s) => [String(s._id), s]));
    const violations: string[] = [];
    for (const row of interactions) {
      const id = String(row._id);
      const bindings = [row.snapshotId, row.candidateId, row.baseKey, row.fullSignature];
      const present = bindings.filter((v) => v !== undefined && v !== null && v !== "").length;
      if (present === 0) {
        // On the fresh Track 2 corpus every live write binds all four fields (postInteraction),
        // so a fully-unbound row is an anomaly: schema-legal, but silent signal loss for M6.
        violations.push(`${id}: fully-unbound interaction row — no M5 write path produces this`);
        continue;
      }
      if (present !== 4) {
        violations.push(`${id}: partial binding (${present}/4 fields) — poisons the reducers`);
        continue;
      }
      const snapshot = byId.get(String(row.snapshotId));
      if (!snapshot) {
        violations.push(`${id}: snapshotId ${row.snapshotId} not in corpus (dangling feedback)`);
        continue;
      }
      if (String(snapshot.user) !== String(row.user)) violations.push(`${id}: cross-user binding`);
      const shownIds: string[] = snapshot.shownCandidateIds ?? [];
      if (!shownIds.includes(row.candidateId)) {
        violations.push(`${id}: candidateId ${row.candidateId} not in the snapshot's shown set`);
      }
      const candidate = (snapshot.candidates ?? []).find((c: Any) => c.candidateId === row.candidateId);
      if (!candidate) {
        violations.push(`${id}: candidateId ${row.candidateId} not found in snapshot.candidates`);
        continue;
      }
      if (row.baseKey !== candidate.baseKey) violations.push(`${id}: baseKey != candidate's`);
      if (row.fullSignature !== candidate.fullSignature) violations.push(`${id}: fullSignature != candidate's`);
      const rowItems = (row.items ?? []).map((v: Any) => String(v));
      const candidateItems = (candidate.items ?? []).map((it: Any) => String(it.itemId));
      if (JSON.stringify(rowItems) !== JSON.stringify(candidateItems)) {
        violations.push(`${id}: items [${rowItems}] != candidate items [${candidateItems}]`);
      }
      const candidateSet = new Set(candidateItems);
      for (const f of row.perItemFeedback ?? []) {
        if (!candidateSet.has(String(f.itemId))) {
          violations.push(`${id}: perItemFeedback.itemId ${f.itemId} outside the bound outfit`);
        }
      }
      // The reducer consumes this row through the REAL projection — it must emit the full grain.
      const wire = projectInteractionRow(row);
      if (!wire.snapshotId || !wire.candidateId || !wire.baseKey || !wire.fullSignature) {
        violations.push(`${id}: projectInteractionRow drops part of the binding grain`);
      }
      if (wire.items.some((v) => !OBJECT_ID_RE.test(v))) {
        violations.push(`${id}: projected items are not 24-hex strings`);
      }
    }
    expect(violationsToString(violations)).toBe("");
  });

  it("no orphaned rows: every snapshot/interaction belongs to a still-existing user (erasure completeness, §23-H43)", () => {
    const violations: string[] = [];
    for (const s of snapshots) {
      if (!userIds.has(String(s.user))) {
        violations.push(`snapshot ${s._id}: user ${s.user} no longer exists — account-deletion erasure missed it`);
      }
      // The phase-1-fail-safe leftover state: rows redacted for account deletion whose user
      // SURVIVES means the deletion cascade died midway (route docblock) — the erasure the
      // friend asked for never finished. Finish it manually (the {user, redacted} index).
      if (s.redactionReason === "account_deleted" && userIds.has(String(s.user))) {
        violations.push(
          `snapshot ${s._id}: redacted for account_deleted but user ${s.user} still exists — the deletion cascade died midway; finish the erasure`,
        );
      }
    }
    for (const row of interactions) {
      if (!userIds.has(String(row.user))) {
        violations.push(`interaction ${row._id}: user ${row.user} no longer exists`);
      }
    }
    expect(violationsToString(violations)).toBe("");
  });

  it("degenerate / empty rows are honest: a paid-but-empty render explains itself", () => {
    const violations: string[] = [];
    for (const s of snapshots) {
      const id = String(s._id);
      const attempts: Any[] = s.generationAttempts ?? [];
      if (s.nSurfaced !== 0) continue;
      if (attempts.length === 0) {
        // A no-attempt empty render is valid only as an explicit engine outcome: a pre-generation
        // §D failure record, or a not-enough-items graceful degradation.
        const explained = s.diagnostics?.engineFailure != null || s.diagnostics?.notEnoughItems === true;
        if (!explained) violations.push(`${id}: empty no-attempt render with no recorded cause`);
        continue;
      }
      // Money was spent and nothing surfaced (§D) — the row must carry a readable cause.
      const d = s.diagnostics ?? {};
      const abnormalAttempt = attempts.some(
        (a) =>
          a.payloadParsed === false ||
          a.parseIssue != null ||
          a.rootRejectionCode != null ||
          (a.finishStatus && a.finishStatus.finishReason !== "stop"),
      );
      const explained =
        d.engineFailure != null ||
        abnormalAttempt ||
        Object.keys(d.rejectionHistogram ?? {}).length > 0 ||
        d.rescue?.insufficientAfterGeneration === true ||
        s.generator?.finishStatus != null;
      if (!explained) violations.push(`${id}: degenerate render (attempts>0, nSurfaced=0) with no recorded cause`);
    }
    expect(violationsToString(violations)).toBe("");
  });
});
