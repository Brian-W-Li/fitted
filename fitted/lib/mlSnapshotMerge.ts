/**
 * M5 route-owned merge + cross-check helpers (C5, seam #6) — the pure pieces the recommend route
 * assembles AROUND the service payload. `mlSnapshotValidation.ts` owns the payload-self-contained
 * invariants; THIS module owns everything that needs the request, the writer's raw-field caps, or
 * the browser projection — the checks that helper's docstring deliberately deferred route-side.
 *
 *   - normalizeControls        Next mirror of the service §C.3 F6 normalization (dedup/sort/reject)
 *   - makeRenderIdentity / identityMatches   the §C.4/G5 render-identity set (EXCLUDES seedDate)
 *   - crossCheckAuthorship     §G.1 G4 — payload's request-derived + server-owned fields == the
 *                              normalized request Next built (a service that mangles them fails loud)
 *   - crossCheckShownIdentity  §A — the wire shown[].candidateId sequence == payload.shownCandidateIds
 *   - crossCheckShownBody      §A display-source pin — each wire shown[].outfit body == the bound
 *                              candidate field-for-field (swapped-body mutant rejected)
 *   - capRawField              §G raw-field cap: byte-cap + sha256 hash + truncation flag (the WRITER
 *                              owns this, per mlSnapshotValidation.ts's deferral + GenerationSnapshot.ts)
 *   - buildEvidence            the TS-merge per-item evidence{} (storage-only deployed fields)
 *   - projectBrowserResponse   the §A/G15 browser allowlist (displayItems from itemSnapshots; card
 *                              body from candidates[candidateId], never shown[].outfit; reusable for
 *                              the §C.4 dedup replay from a stored doc)
 *
 * Reference: docs/plans/m5-cutover.md §A/§C/§G/§G.1; docs/sessions/2026-07-08-m5-c5-seam6-route.md.
 */
import { createHash } from "crypto";
import { RequestContractError, MAX_CONTROL_IDS, type GENERATOR_EXPECTATION } from "@/lib/mlRequestAdapter";
import { PayloadContractError } from "@/lib/mlSnapshotValidation";
import {
  RAW_TEXT_CAP_BYTES,
  RAW_EMITTED_CAP_BYTES,
  RAW_ATTRIBUTES_CAP_BYTES,
} from "@/models/GenerationSnapshot";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const CACHE_KEY_RE = /^[0-9a-f]{64}$/;

/** Normalize an optional string/ObjectId field to a canonical comparable: null iff absent/blank. */
function s(v: unknown): string | null {
  if (v == null) return null;
  const str = typeof v === "string" ? v : (v as { toString(): string }).toString();
  return str === "" ? null : str;
}

// ---------------------------------------------------------------------------
// Controls normalization — the Next mirror of the service's §C.3 F6 (reject blank/non-string ids,
// dedup, stable sort). Next re-derives this to CROSS-CHECK the payload's controls (G4), so a
// compromised service cannot persist a controls set that differs from what shaped generation.
// ⚠ Cross-runtime obligation: this must byte-match the service's normalization. Lock/dislike ids
// are 24-hex ObjectIds, for which JS UTF-16 and Python codepoint sort agree; a cross-runtime golden
// pin is a named post-M5 residual (docs/plans/post-m5-reset.md).
// ---------------------------------------------------------------------------
function normalizeIdList(ids: unknown, field: string): string[] {
  if (ids == null) return [];
  if (!Array.isArray(ids)) throw new RequestContractError(`controls.${field} is not an array`);
  if (ids.length > MAX_CONTROL_IDS) {
    throw new RequestContractError(`controls.${field} exceeds ${MAX_CONTROL_IDS} ids`);
  }
  const out = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string") throw new RequestContractError(`controls.${field} contains a non-string id`);
    const trimmed = id.trim();
    if (!trimmed) throw new RequestContractError(`controls.${field} contains a blank id`);
    out.add(trimmed);
  }
  return [...out].sort();
}

export interface NormalizedControls {
  lockedItemIds: string[];
  dislikedItemIds: string[];
}

export function normalizeControls(controls: unknown): NormalizedControls {
  const c = (controls ?? {}) as Any;
  return {
    lockedItemIds: normalizeIdList(c.lockedItemIds, "lockedItemIds"),
    dislikedItemIds: normalizeIdList(c.dislikedItemIds, "dislikedItemIds"),
  };
}

// ---------------------------------------------------------------------------
// §C.4/G5 render identity — the client-controlled + deterministic request-shaping set. seedDate is
// DELIBERATELY EXCLUDED (it is server-clock-derived and rolls over at 00:00 UTC on a legit retry).
// Weather STAYS in the set — it is resolved ONCE per Generate action and frozen (the F10 envelope),
// never re-fetched on a retry, so it is deterministic (§F/§C.4 reconciliation).
// ---------------------------------------------------------------------------
export interface RenderIdentity {
  user: string;
  intent: string;
  occasion: string;
  weather: string;
  weatherRaw: string | null;
  location: string | null;
  forcedItemId: string | null;
  wardrobeVersion: number;
  generationIndex: number;
  parentSnapshotId: string | null;
  lockedItemIds: string[];
  dislikedItemIds: string[];
}

/** Build the comparable identity from raw fields (used for BOTH the incoming request and a stored
 *  winner doc — one normalizer, so the two are compared on equal footing). `constraints` is not a
 *  field here: it is always `{}` at M5, so it can never distinguish two renders. */
export function makeRenderIdentity(f: {
  user: unknown;
  intent: unknown;
  occasion: unknown;
  weather: unknown;
  weatherRaw?: unknown;
  location?: unknown;
  forcedItemId?: unknown;
  wardrobeVersion: unknown;
  generationIndex: unknown;
  parentSnapshotId?: unknown;
  controls?: unknown;
}): RenderIdentity {
  const controls = normalizeControls(f.controls);
  return {
    user: s(f.user) ?? "",
    intent: String(f.intent ?? ""),
    occasion: String(f.occasion ?? ""),
    weather: String(f.weather ?? ""),
    weatherRaw: s(f.weatherRaw),
    location: s(f.location),
    forcedItemId: s(f.forcedItemId),
    wardrobeVersion: Number(f.wardrobeVersion ?? 0),
    generationIndex: Number(f.generationIndex ?? 0),
    parentSnapshotId: s(f.parentSnapshotId),
    lockedItemIds: controls.lockedItemIds,
    dislikedItemIds: controls.dislikedItemIds,
  };
}

function arraysEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function identityMatches(a: RenderIdentity, b: RenderIdentity): boolean {
  return (
    a.user === b.user &&
    a.intent === b.intent &&
    a.occasion === b.occasion &&
    a.weather === b.weather &&
    a.weatherRaw === b.weatherRaw &&
    a.location === b.location &&
    a.forcedItemId === b.forcedItemId &&
    a.wardrobeVersion === b.wardrobeVersion &&
    a.generationIndex === b.generationIndex &&
    a.parentSnapshotId === b.parentSnapshotId &&
    arraysEqual(a.lockedItemIds, b.lockedItemIds) &&
    arraysEqual(a.dislikedItemIds, b.dislikedItemIds)
  );
}

// ---------------------------------------------------------------------------
// §G.1 G4 authorship cross-check — the payload is authored by the SERVICE, but Next is the authority
// for the request identity + service config, so re-assert EVERY request-derived / server-owned field
// against the SAME normalized request Next built. A service bug / compromised service that mangles
// any of these fails LOUD (contract_invalid, no write), never persists a corpus row that lies.
// ---------------------------------------------------------------------------
export interface AuthorshipExpectation {
  sessionId: string;
  intent: string;
  occasion: string;
  weather: string;
  weatherRaw: string | null;
  location: string | null;
  forcedItemId: string | null;
  seedDate: string;
  wardrobeVersion: number;
  requestId: string;
  parentSnapshotId: string | null;
  generationIndex: number;
  controls: NormalizedControls;
  generator: typeof GENERATOR_EXPECTATION;
  /** On a re-roll only: the parent row's candidateCacheKey (siblings share the Lens-chain key). */
  parentCandidateCacheKey?: string | null;
}

function eq(actual: unknown, expected: unknown, label: string): void {
  const a = actual == null ? null : actual;
  const e = expected == null ? null : expected;
  if (a !== e) fail4(`authorship: ${label} mismatch (payload ${JSON.stringify(a)} != request ${JSON.stringify(e)})`);
}
function fail4(msg: string): never {
  throw new PayloadContractError(msg);
}

export function crossCheckAuthorship(payload: unknown, expected: AuthorshipExpectation): void {
  const p = (payload ?? {}) as Any;
  eq(s(p.sessionId), expected.sessionId, "sessionId");
  eq(p.intent, expected.intent, "intent");
  eq(p.occasion, expected.occasion, "occasion");
  eq(p.weather, expected.weather, "weather");
  eq(s(p.weatherRaw), expected.weatherRaw, "weatherRaw");
  eq(s(p.location), expected.location, "location");
  eq(s(p.forcedItemId), expected.forcedItemId, "forcedItemId");
  eq(p.seedDate, expected.seedDate, "seedDate");
  eq(p.wardrobeVersion, expected.wardrobeVersion, "wardrobeVersion");
  eq(p.requestId, expected.requestId, "requestId");
  eq(s(p.parentSnapshotId), expected.parentSnapshotId, "parentSnapshotId");
  eq(p.generationIndex, expected.generationIndex, "generationIndex");

  // constraints must be exactly {} at M5.
  const constraints = p.constraints ?? {};
  if (typeof constraints !== "object" || Array.isArray(constraints) || Object.keys(constraints).length > 0) {
    fail4("authorship: constraints must be {} at M5");
  }

  // controls == the normalizedControls Next used to shape generation (order-normalized both sides).
  const pc = normalizeControls(p.controls);
  if (!arraysEqual(pc.lockedItemIds, expected.controls.lockedItemIds)) {
    fail4("authorship: controls.lockedItemIds != the normalized request controls");
  }
  if (!arraysEqual(pc.dislikedItemIds, expected.controls.dislikedItemIds)) {
    fail4("authorship: controls.dislikedItemIds != the normalized request controls");
  }

  // generator{} — the persisted provenance must equal Next's known service expectation field-for-field
  // (§A validates the WIRE expectation pre-spend; this validates the PERSISTED block).
  const g = (p.generator ?? {}) as Any;
  const e = expected.generator;
  for (const key of [
    "provider",
    "model",
    "temperature",
    "maxCompletionTokens",
    "apiSurface",
    "responseFormat",
    "reasoningEffort",
    "storeMode",
    "promptCacheRetention",
    "timeoutSeconds",
    "maxRetries",
  ] as const) {
    eq(g[key], (e as Any)[key], `generator.${key}`);
  }

  // candidateCacheKey — a Python seed.py sha256; cannot be recomputed in TS, so validate
  // structurally (64-hex) AND, on a re-roll, assert it equals the parent's (the Lens-chain invariant).
  const cck = p.candidateCacheKey;
  if (typeof cck !== "string" || !CACHE_KEY_RE.test(cck)) {
    fail4("authorship: candidateCacheKey is not 64-char lowercase hex");
  }
  if (expected.parentCandidateCacheKey != null && cck !== expected.parentCandidateCacheKey) {
    fail4("authorship: re-roll candidateCacheKey != parent's (Lens-chain invariant broken)");
  }
}

// ---------------------------------------------------------------------------
// §A shown-identity + display-source cross-checks (the feedback-binding token integrity).
// ---------------------------------------------------------------------------

export interface WireShownEntry {
  candidateId: string;
  outfit?: Any;
}

/** The wire shown[].candidateId sequence must equal payload.shownCandidateIds (order + length) and
 *  the count must equal nSurfaced. Never zip by array index across the wire (§A). */
export function crossCheckShownIdentity(payload: unknown, wireShown: WireShownEntry[]): void {
  const p = (payload ?? {}) as Any;
  const declared: unknown = p.shownCandidateIds;
  if (!Array.isArray(declared)) fail4("shownCandidateIds is not an array");
  const wireIds = wireShown.map((e) => e.candidateId);
  if (!arraysEqual(wireIds, declared as unknown[])) {
    fail4("shown[].candidateId sequence != payload.shownCandidateIds");
  }
  if (p.nSurfaced !== wireIds.length) {
    fail4(`nSurfaced ${p.nSurfaced} != shown[] length ${wireIds.length}`);
  }
}

/** §A display-source pin: a wire shown[].outfit, if carried, is untrusted — its body must equal the
 *  bound payload.candidates[candidateId] field-for-field. A swapped-body mutant (matching
 *  fullSignature, differing styleMove/risk) is rejected. The card is displayed from the CANDIDATE. */
export function crossCheckShownBody(payload: unknown, wireShown: WireShownEntry[]): void {
  const p = (payload ?? {}) as Any;
  const byId = new Map<string, Any>((p.candidates ?? []).map((c: Any) => [c.candidateId, c]));
  for (const entry of wireShown) {
    if (entry.outfit == null) continue; // outfit is optional on the wire; nothing to cross-check
    const cand = byId.get(entry.candidateId);
    if (!cand) fail4(`shown[].outfit references unknown candidate ${entry.candidateId}`);
    const o = entry.outfit as Any;
    // scalar body fields (the wire uses templateType; the candidate stores template)
    eqBody(o.templateType, cand.template, entry.candidateId, "templateType");
    eqBody(o.optionPath, cand.optionPath, entry.candidateId, "optionPath");
    eqBody(o.risk, cand.risk, entry.candidateId, "risk");
    eqBody(o.fullSignature, cand.fullSignature, entry.candidateId, "fullSignature");
    eqBody(o.baseKey, cand.baseKey, entry.candidateId, "baseKey");
    // items + roles (order-sensitive — the candidate's funnel order is canonical)
    const oItems = (o.items ?? []) as Any[];
    const cItems = (cand.items ?? []) as Any[];
    if (oItems.length !== cItems.length) fail4(`shown[].outfit ${entry.candidateId}: items length differs`);
    oItems.forEach((it: Any, i: number) => {
      if (it.itemId !== cItems[i].itemId || it.role !== cItems[i].role) {
        fail4(`shown[].outfit ${entry.candidateId}: item ${i} differs from the bound candidate`);
      }
    });
    // styleMove field-for-field
    const os = o.styleMove ?? {};
    const cs = cand.styleMove ?? {};
    eqBody(os.moveType, cs.moveType, entry.candidateId, "styleMove.moveType");
    eqBody(os.oneSentence, cs.oneSentence, entry.candidateId, "styleMove.oneSentence");
    if (!arraysEqual(os.changedItemIds ?? [], cs.changedItemIds ?? [])) {
      fail4(`shown[].outfit ${entry.candidateId}: styleMove.changedItemIds differs`);
    }
  }
}
function eqBody(a: unknown, b: unknown, id: string, label: string): void {
  if (a !== b) fail4(`shown[].outfit ${id}: ${label} differs from the bound candidate`);
}

// ---------------------------------------------------------------------------
// §G raw-field caps — the WRITER truncates each raw field to its byte cap + records the ORIGINAL
// byte length + a sha256 hash + a truncation flag (so the bounded snapshot stays under Mongo's 16 MB
// BSON ceiling and no image/blob bytes are stored). Python sends raw_text/raw_emitted VERBATIM
// (snapshot.py:114 "the snapshot writer applies the byte cap + hash + flag"), so Next owns this.
// ---------------------------------------------------------------------------
export interface CappedRawField {
  value: unknown; // the original when under cap; a byte-truncated string when over
  hash: string | null; // sha256 hex of the ORIGINAL serialized bytes; null iff the field was absent
  bytes: number; // ORIGINAL byte length
  truncated: boolean;
}

export function capRawField(value: unknown, capBytes: number): CappedRawField {
  if (value == null) return { value, hash: null, bytes: 0, truncated: false };
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const buf = Buffer.from(serialized, "utf8");
  const bytes = buf.length;
  const hash = createHash("sha256").update(buf).digest("hex");
  if (bytes <= capBytes) return { value, hash, bytes, truncated: false };
  // Truncate at the byte cap. A trailing partial codepoint decodes to U+FFFD — acceptable: the
  // truncated value is a bounded preview, and the hash is over the ORIGINAL bytes.
  const truncated = buf.subarray(0, capBytes).toString("utf8");
  return { value: truncated, hash, bytes, truncated: true };
}

// ---------------------------------------------------------------------------
// TS-merge per-item evidence{} — storage-only deployed fields the engine never saw (the C+D
// provenance split, §15.1). engineVisible is Python-authored; evidence is Next's to add.
// ---------------------------------------------------------------------------
export interface EvidenceSourceItem {
  category?: string;
  subCategory?: string;
  pattern?: string;
  seasons?: string[];
  isAvailable?: boolean;
  isFavorite?: boolean;
  lastWornAt?: Date | string;
  brand?: string;
  fit?: string;
  size?: string;
  layerRole?: string;
  tags?: string[];
  imagePath?: string;
  metadata?: Map<string, unknown> | Record<string, unknown>;
}

function mapToPlain(m: unknown): Record<string, unknown> | undefined {
  if (m == null) return undefined;
  if (m instanceof Map) {
    if (m.size === 0) return undefined;
    return Object.fromEntries(m.entries());
  }
  if (typeof m === "object" && Object.keys(m as object).length > 0) return m as Record<string, unknown>;
  return undefined;
}

export function buildEvidence(item: EvidenceSourceItem | undefined): Record<string, unknown> {
  if (!item) return {};
  const evidence: Record<string, unknown> = {
    category: item.category,
    subCategory: item.subCategory,
    pattern: item.pattern,
    seasons: item.seasons ?? [],
    isAvailable: item.isAvailable,
    isFavorite: item.isFavorite,
    lastWornAt: item.lastWornAt,
    brand: item.brand,
    fit: item.fit,
    size: item.size,
    layerRole: item.layerRole,
    tags: item.tags ?? [],
  };
  // Image ref/version/hash ONLY — never the image blob (H29(c)). The deployed reference is
  // `mongo:<imageId>`; store it as the ref (no version/hash at M5 — the W-track wires those).
  if (item.imagePath) evidence.image = { imageRef: item.imagePath };
  // Raw declared attributes (deployed metadata Map) — bounded by the raw-field cap.
  const raw = mapToPlain(item.metadata);
  if (raw !== undefined) {
    const capped = capRawField(raw, RAW_ATTRIBUTES_CAP_BYTES);
    evidence.rawAttributes = capped.value;
    evidence.rawAttributesHash = capped.hash;
    evidence.rawAttributesBytes = capped.bytes;
    evidence.rawAttributesTruncated = capped.truncated;
  }
  return evidence;
}

// ---------------------------------------------------------------------------
// The §D degenerate flag (mirror of app.py:869) — money spent, nothing surfaced.
// ---------------------------------------------------------------------------
export function isDegeneratePayload(payload: Any): boolean {
  const attempts = Array.isArray(payload.generationAttempts) ? payload.generationAttempts : [];
  return attempts.length > 0 && payload.nSurfaced === 0;
}

// ---------------------------------------------------------------------------
// §A/G15 browser allowlist — the browser gets a PROJECTED UI object, never the corpus payload. Card
// body from candidates[candidateId] (never shown[].outfit); item display fields joined from
// itemSnapshots[] (no post-Python DB refetch, H10). Reusable for the §C.4 dedup replay from a stored
// doc: pass the doc; the live path additionally passes the wire `flags` (reasonHint is NOT persisted).
// ---------------------------------------------------------------------------
export interface BrowserFlags {
  notEnoughItems: boolean;
  insufficientAfterGeneration: boolean;
  spreadCollapsed: boolean;
  reasonHint: string | null;
}

export interface BrowserShownEntry {
  snapshotId: string;
  candidateId: string;
  displayItems: Array<{ itemId: string; role?: string; name?: string; clothingType?: string; colorTags?: string[]; imageUrl?: string }>;
  styleMove: Any;
  optionPath?: string;
  risk?: string;
  templateType?: string;
}

export interface BrowserResponse {
  shown: BrowserShownEntry[];
  flags: BrowserFlags;
  bindable: boolean;
  generationIndex?: number;
  parentSnapshotId?: string | null;
}

/** Reconstruct the client-facing flags from a stored doc for the replay path (reasonHint is not
 *  persisted, so it is null on replay — the winner's shown set is the authoritative idempotent
 *  result; the prose hint is a first-response-only nicety). */
function flagsFromDoc(doc: Any): BrowserFlags {
  return {
    notEnoughItems: Boolean(doc.diagnostics?.notEnoughItems),
    insufficientAfterGeneration: false,
    spreadCollapsed: Boolean(doc.spreadCollapsed),
    reasonHint: null,
  };
}

export function projectBrowserResponse(
  doc: Any,
  snapshotId: string,
  wireFlags?: BrowserFlags,
): BrowserResponse {
  const candidatesById = new Map<string, Any>((doc.candidates ?? []).map((c: Any) => [c.candidateId, c]));
  const engineVisibleById = new Map<string, Any>(
    (doc.itemSnapshots ?? []).map((it: Any) => [it.itemId, it.engineVisible ?? {}]),
  );
  const shownIds: string[] = Array.isArray(doc.shownCandidateIds) ? doc.shownCandidateIds : [];

  const shown: BrowserShownEntry[] = shownIds.map((cid) => {
    const cand = candidatesById.get(cid) ?? {};
    const items: Any[] = Array.isArray(cand.items) ? cand.items : [];
    return {
      snapshotId,
      candidateId: cid,
      displayItems: items.map((it: Any) => {
        const ev = engineVisibleById.get(it.itemId) ?? {};
        return {
          itemId: it.itemId,
          role: it.role,
          name: ev.name,
          clothingType: ev.clothingType,
          colorTags: ev.colorTags,
          imageUrl: ev.imageUrl,
        };
      }),
      styleMove: cand.styleMove,
      optionPath: cand.optionPath,
      risk: cand.risk,
      templateType: cand.template,
    };
  });

  const response: BrowserResponse = {
    shown,
    flags: wireFlags ?? flagsFromDoc(doc),
    bindable: (doc.nSurfaced ?? 0) > 0,
  };
  // A re-roll adds lineage for the client's display (§A).
  if ((doc.generationIndex ?? 0) > 0) {
    response.generationIndex = doc.generationIndex;
    response.parentSnapshotId = s(doc.parentSnapshotId);
  }
  return response;
}

// ---------------------------------------------------------------------------
// Merge — build the persistable document from the validated payload + the exactly-four TS-added
// fields (§G.1), stripping any schema-reserved key a compromised service might have injected via the
// spread (redacted/schemaVersion/timestamps — else a row could be born redacted or backdated).
// ---------------------------------------------------------------------------

// Reserved schema paths the SERVICE must never author — they are Mongoose-known, so a naive
// {...payload} spread would honor them on .create() (strict mode only strips UNKNOWN keys).
const RESERVED_PAYLOAD_KEYS = new Set([
  "_id",
  "id",
  "user",
  "schemaVersion",
  "redacted",
  "redactedAt",
  "redactionReason",
  "createdAt",
  "updatedAt",
  "interactionCountAtRequest",
]);

export interface MergeInputs {
  payload: Any;
  snapshotId: unknown; // the pre-allocated ObjectId
  user: unknown; // the verified user ObjectId
  interactionCountAtRequest: number;
  /** Full deployed WardrobeItem docs keyed by string id — the evidence{} source. */
  wardrobeById: Map<string, EvidenceSourceItem>;
}

/**
 * Merge the validated payload into the persistable doc. Applies the raw-field caps
 * (generationAttempts[].rawText, candidates[].rawEmitted) + builds per-item evidence, and asserts
 * every itemSnapshots[].itemId came from the request wardrobe (a service-invented id fails loud).
 */
export function buildSnapshotDoc(inputs: MergeInputs): Record<string, unknown> {
  const { payload, snapshotId, user, interactionCountAtRequest, wardrobeById } = inputs;

  const doc: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!RESERVED_PAYLOAD_KEYS.has(k)) doc[k] = v;
  }
  doc._id = snapshotId;
  doc.user = user;
  doc.interactionCountAtRequest = interactionCountAtRequest;

  // Raw-field caps on the attempt text.
  doc.generationAttempts = (payload.generationAttempts ?? []).map((a: Any) => {
    const capped = capRawField(a.rawText, RAW_TEXT_CAP_BYTES);
    return {
      ...a,
      rawText: capped.value,
      rawTextHash: capped.hash ?? undefined,
      rawTextBytes: capped.bytes,
      rawTextTruncated: capped.truncated,
    };
  });

  // Raw-field caps on each candidate's emitted outfit JSON.
  doc.candidates = (payload.candidates ?? []).map((c: Any) => {
    const capped = capRawField(c.rawEmitted, RAW_EMITTED_CAP_BYTES);
    return {
      ...c,
      rawEmitted: capped.value,
      rawEmittedHash: capped.hash ?? undefined,
      rawEmittedBytes: capped.bytes,
      rawEmittedTruncated: capped.truncated,
    };
  });

  // itemSnapshots: add per-item evidence{} from the deployed wardrobe. Every itemId MUST have come
  // from the request wardrobe (else a service-invented id would silently get evidence:undefined).
  doc.itemSnapshots = (payload.itemSnapshots ?? []).map((it: Any) => {
    const source = wardrobeById.get(it.itemId);
    if (!source) fail4(`itemSnapshots itemId ${it.itemId} is not in the request wardrobe`);
    return { ...it, evidence: buildEvidence(source) };
  });

  return doc;
}
