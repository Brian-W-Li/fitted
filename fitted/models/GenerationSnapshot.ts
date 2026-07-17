import { Schema, model, models, type InferSchemaType } from "mongoose";
import { isValidRequestId } from "@/lib/formats";
import { CLOTHING_TYPES } from "@/lib/clothingType";

/**
 * GenerationSnapshot — the immutable training-truth record (M4b C5).
 *
 * One snapshot = one rendered response (per `generationIndex`). It captures the resolved
 * Lens inputs, the version/provenance of every component that shaped the render, an
 * immutable feature-copy of every participating wardrobe item (the engineVisible /
 * evidence provenance split), the full candidate funnel (generated → validated → ranked →
 * shown) with continuous scores, and the shown set. Written for EVERY render attempt —
 * including empty-shown / graceful-degradation renders — so the funnel arrays are required
 * but may be empty (absent ≠ empty).
 *
 * Ships DORMANT at M4 (nothing writes it until the M5 cutover). Canonical contract:
 * docs/Fitted_Spec_v2.md §15.1; derivation + Mongoose shape + index plan:
 * docs/plans/m4-data-model-migration.md §8.2/§8.3/§8.8. §15.1 wins on any disagreement.
 *
 * Immutable after insert except the H43 redaction seam (`redacted`/`redactedAt`/
 * `redactionReason`) — enforced by the pre-update/save guard below.
 */

// Raw-payload byte caps (§8.3 — "byte cap + hash + truncation flag on every raw field").
// The M5 writer truncates each raw field to its cap and records the original byte length +
// a hash + a truncation flag, so the bounded snapshot stays well under Mongo's 16 MB BSON
// ceiling (locked by the C5 BSON-size guard test) and NO image/base64/blob bytes are ever
// stored. Shared with the writer + the size test so they can never desync. Tune in M5 if needed.
export const RAW_TEXT_CAP_BYTES = 120_000; // per generation attempt (the full GPT response text)
export const RAW_EMITTED_CAP_BYTES = 8_000; // per candidate (one emitted outfit's raw JSON)
export const RAW_ATTRIBUTES_CAP_BYTES = 8_000; // per item (raw CV / declared attributes)

// §D engine-failure closed vocabularies — the TS mirror of the Python EngineFailure sets
// (ml-system/fitted_core/snapshot.py ENGINE_FAILURE_STAGES/ENGINE_FAILURE_CODES). A rename on
// either side silently empties the degenerate-corpus mapping, so the round-trip test pins the
// mirror. The `enum` arrays below are derived from these Sets — single source per runtime.
export const ENGINE_FAILURE_STAGES = new Set([
  "sample",
  "generate",
  "parse",
  "validate",
  "rank",
  "assemble",
  "pre_generation",
  "unknown",
]);
export const ENGINE_FAILURE_CODES = new Set([
  "parse_fail",
  "empty_valid_set",
  "refusal",
  "truncated",
  "internal_exception",
  "sampler_error",
  "ranker_error",
  "unknown",
]);
// The message is a FIXED-CATALOGUE string keyed by {stage, code} on the Python side, never an
// interpolated runtime value (§G/G13); the TS boundary caps its length. Mirrors
// ENGINE_FAILURE_MESSAGE_MAX_CHARS in snapshot.py.
export const ENGINE_FAILURE_MESSAGE_MAX_CHARS = 300;

// The semantic redaction whitelist — the only DOMAIN fields a post-insert write may touch at
// M4 (the H43 seam). Everything else is immutable training truth. (Framework-managed timestamp
// paths are exempted separately, below; the Privacy milestone extends this with the PII-null
// fields.) Exported so the M5 redaction path + the guard tests agree.
export const GENERATION_SNAPSHOT_MUTABLE_FIELDS = new Set([
  "redacted",
  "redactedAt",
  "redactionReason",
]);

// ---------------------------------------------------------------------------
// Embedded sub-schemas (all `_id:false` — they are value objects, not documents).
// ---------------------------------------------------------------------------

// Group F/G — per-candidate continuous score trace (the M6 seam). Signed scoreBreakdown
// mirrors fitted_core's ScoreBreakdown (S4 sign discipline); all nullable until scored.
const ScoreTraceSchema = new Schema(
  {
    compatibility: { type: Number },
    visibility: { type: Number },
    rankerScore: { type: Number },
    scoreBreakdown: {
      type: new Schema(
        {
          base: { type: Number },
          combo: { type: Number },
          item: { type: Number },
          dislike: { type: Number },
          overuse: { type: Number },
          repetition: { type: Number },
          cooldown: { type: Number },
        },
        { _id: false },
      ),
    },
    signalScore: { type: Number }, // reserved — the trained M6 scorer
  },
  { _id: false },
);

// Group E — root/attempt-level events (invalid JSON, the repair retry, aggregate
// warnings), kept OUT of the candidate array so they are never forced into fake candidates.
const GenerationAttemptSchema = new Schema(
  {
    attemptId: { type: String, required: true },
    attemptIndex: { type: Number, required: true },
    isRepair: { type: Boolean, required: true, default: false },
    parseIssue: { type: String },
    rootRejectionCode: { type: String },
    aggregateWarningCodes: { type: [String], default: [] },
    payloadParsed: { type: Boolean, required: true },
    candidateCountEmitted: { type: Number, default: 0 },
    // Raw generation text — bounded (RAW_TEXT_CAP_BYTES); cap + hash + truncation flag; never a blob.
    rawText: { type: String },
    rawTextHash: { type: String },
    rawTextBytes: { type: Number },
    rawTextTruncated: { type: Boolean },
    // Per-attempt finish status (§A.6 point 6 — snapshot._finish_status_dict → {finishReason,
    // refusal}); null for stubs/replays + clean runs. A declared field, or default strict:true
    // strips the paid-but-degenerate signal the corpus needs (the D-1/D-2 class).
    finishStatus: {
      type: new Schema(
        { finishReason: { type: String }, refusal: { type: String } },
        { _id: false },
      ),
    },
  },
  { _id: false },
);

// Group F — one candidate over the generated → validated → ranked → shown funnel; rejected
// and low-ranked candidates MUST survive (H29(b)), so content is preserved for every one.
const CandidateSnapshotSchema = new Schema(
  {
    candidateId: { type: String, required: true }, // Python-issued, unique within the snapshot
    sourceAttemptId: { type: String, required: true },
    sourceIndex: { type: Number },
    stageReached: {
      type: String,
      enum: ["generated", "validated", "ranked", "shown"],
      required: true,
    },
    accepted: { type: Boolean, required: true },
    shown: { type: Boolean, required: true, default: false },
    shownPosition: { type: Number },
    // dropStage/dropReason are OPEN, append-only code sets (not hard enums) — a future drop
    // reason must not become a write-rejection foreclosure (Fable). Validated against a
    // documented list in app code, never the schema.
    dropStage: { type: String },
    dropReason: { type: String },
    rejectionCodes: { type: [String], default: [] },
    warningCodes: { type: [String], default: [] },
    // Content preservation (§8.2-F, app-validated by the C6 builder): a generated &&
    // !accepted candidate carries (items+slotMap) OR rawEmitted — a bare {candidateId,
    // rejectionCodes} loses the negative training signal. Not schema-enforced here to avoid
    // double-enforcement divergence with the Python builder.
    items: {
      type: [
        new Schema(
          {
            itemId: { type: String, required: true }, // STRING, never a populatable ObjectId ref (H10)
            role: {
              type: String,
              enum: ["base_top", "base_bottom", "one_piece", "outer_layer", "shoes"],
            },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    slotMap: {
      type: new Schema(
        {
          dress: { type: String },
          top: { type: String },
          bottom: { type: String },
          outer: { type: String },
          shoes: { type: String },
        },
        { _id: false },
      ),
    },
    template: { type: String, enum: ["two_piece", "one_piece"] },
    baseKey: { type: String },
    fullSignature: { type: String },
    optionPath: { type: String, enum: ["reliable", "bridge", "stretch"] },
    risk: { type: String, enum: ["safe", "noticeable", "bold"] },
    styleMove: {
      type: new Schema(
        {
          moveType: { type: String },
          changedItemIds: { type: [String], default: [] },
          oneSentence: { type: String },
        },
        { _id: false },
      ),
    },
    // Raw emitted outfit JSON — bounded (RAW_EMITTED_CAP_BYTES); cap + hash + flag; no blobs.
    rawEmitted: { type: Schema.Types.Mixed },
    rawEmittedHash: { type: String },
    rawEmittedBytes: { type: Number },
    rawEmittedTruncated: { type: Boolean },
    scoreTrace: { type: ScoreTraceSchema },
  },
  { _id: false },
);

// Group D — the C+D provenance split. `engineVisible` is the EXACT projection the engine
// conditioned on (the only ranking-visible layer); `evidence` is storage-only deployed
// fields the engine never saw. Moving a field across the boundary requires a schemaVersion bump.
const ItemSnapshotSchema = new Schema(
  {
    itemId: { type: String, required: true }, // STRING, never a populatable ref (H10)
    engineVisible: {
      type: new Schema(
        {
          name: { type: String },
          clothingType: { type: String, enum: [...CLOTHING_TYPES] }, // single-homed in lib/clothingType
          warmth: { type: Number, required: true }, // engine-required; keyword-derived at ingestion
          styleTags: { type: [String], default: [] },
          colorTags: { type: [String], default: [] },
          occasionTags: { type: [String], default: [] },
          material: { type: String }, // empty until the W-track CV (treat empty as unmeasured, not negative)
          formality: { type: String },
          imageUrl: { type: String },
        },
        { _id: false },
      ),
      required: true,
    },
    evidence: {
      type: new Schema(
        {
          category: { type: String },
          subCategory: { type: String },
          pattern: { type: String },
          seasons: { type: [String], default: [] },
          isAvailable: { type: Boolean },
          isFavorite: { type: Boolean },
          lastWornAt: { type: Date },
          brand: { type: String },
          fit: { type: String },
          size: { type: String },
          layerRole: { type: String },
          tags: { type: [String], default: [] },
          // ref/version/hash ONLY — never the image blob (H29(c), guards H14).
          image: {
            type: new Schema(
              {
                imageRef: { type: String },
                imageVersion: { type: Number },
                hash: { type: String },
              },
              { _id: false },
            ),
          },
          // Raw CV/declared attributes — bounded (RAW_ATTRIBUTES_CAP_BYTES); cap + hash + flag; no blobs.
          rawAttributes: { type: Schema.Types.Mixed },
          rawAttributesHash: { type: String },
          rawAttributesBytes: { type: Number },
          rawAttributesTruncated: { type: Boolean },
        },
        { _id: false },
      ),
    },
    generatorVisible: { type: Schema.Types.Mixed }, // reserved — promptVersion-decodable from engineVisible at [NOW]
    // Data-path provenance seam (§15.1): null at M4 (warmth is keyword-derived, not CV-written),
    // wired when the W-track CV becomes the writer of engineVisible features.
    cvModelVersion: { type: String, default: null },
    embeddingRef: { type: String }, // reserved nullable (H25) — shape intentionally NOT locked
    visualFeatureRef: { type: String },
  },
  { _id: false },
);

const LensSchema = new Schema(
  {
    styleProfileId: { type: Schema.Types.ObjectId },
    styleProfileVersion: { type: Number },
    boardId: { type: Schema.Types.ObjectId },
    confidence: { type: Number },
    // The §6.2 embed seam — the compiled profile itself, not a bare ref (a ref re-creates
    // H10 if a board version is later cascaded away). Mixed, null until B-track.
    styleProfileSnapshot: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

// ---------------------------------------------------------------------------
// The root snapshot.
// ---------------------------------------------------------------------------

const GenerationSnapshotSchema = new Schema(
  {
    // --- A: identity ---
    schemaVersion: { type: Number, required: true, default: 1 }, // the additive-evolution lever
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sessionId: { type: String, required: true }, // = user id (R8)
    candidateCacheKey: { type: String, required: true }, // groups re-roll siblings
    generationIndex: { type: Number, required: true },
    // Lineage pointer (§G item 1 / §C.1) — null on root renders; the child of a re-roll points at
    // its parent. String opacity (H10) is enforced serde-side; here it is a real ObjectId ref for
    // the ownership re-read. Serde maps parent_snapshot_id ↔ parentSnapshotId (already in _ID_KEYS).
    parentSnapshotId: { type: Schema.Types.ObjectId, ref: "GenerationSnapshot" },
    // Render idempotency (§G item 2 / §C.4 / H50) — was optional/unvalidated; M5 makes it REQUIRED
    // + validated (UUIDv4 or ULID, ≤64 chars). `required:true` closes the "document written without
    // the field ⇒ invisible to the partial index" hole below the app-level validation (defense in
    // depth). Safe: every M5 write carries it, and the M4a wipe left no legacy rows.
    requestId: {
      type: String,
      required: true,
      validate: {
        // Single-homed in lib/formats (mirrors app.py + the route). The ULID alternative is
        // uppercase-only, so a lowercase-ULID requestId is rejected here too (cross-runtime parity).
        validator: (v: string) => v.length <= 64 && isValidRequestId(v),
        message: "requestId must be a UUIDv4 or ULID",
      },
    },

    // --- B: request context (the Lens) ---
    intent: {
      type: String,
      enum: ["rescue_item", "outfit_upgrade", "daily", "translate"],
      required: true,
    },
    occasion: { type: String, required: true },
    weather: { type: String, enum: ["hot", "mild", "cold", "indoor", "outdoor"], required: true },
    weatherRaw: { type: String },
    location: { type: String },
    constraints: { type: Map, of: Schema.Types.Mixed, default: {} }, // flexible, additive (H36)
    forcedItemId: { type: String },
    baseOutfitItemIds: { type: [String] },
    routineId: { type: Schema.Types.ObjectId },
    lens: { type: LensSchema },
    wardrobeVersion: { type: Number, required: true }, // field only; bump = W-track/H6
    interactionCountAtRequest: { type: Number, required: true },
    seedDate: { type: String },
    // R9 regen controls (m5-cutover.md §G item 5 / §C.3 / §J D-2). The exact inputs that shaped
    // a render (locks scope the pool+prompt; dislikes hard-filter Step-4) MUST be in its row or
    // the corpus can't explain it. Python authors this on EVERY write (snapshot.py, §G.1 F6) —
    // it MUST be a declared field or default strict:true strips it silently. `required:true` +
    // a default so a first/non-regen render stores `{lockedItemIds:[], dislikedItemIds:[]}`,
    // never an absent subdoc: "no controls" must be an explicit corpus statement, since an
    // absent `controls` is indistinguishable from "locks were dropped".
    controls: {
      type: new Schema(
        {
          lockedItemIds: { type: [String], default: [] },
          dislikedItemIds: { type: [String], default: [] },
        },
        { _id: false },
      ),
      required: true,
      default: () => ({ lockedItemIds: [], dislikedItemIds: [] }),
    },

    // --- C: provenance / versions — REQUIRED, non-null on every live write ---
    fittedCoreVersion: { type: String, required: true },
    // Required non-null provenance (spec §15.1 + plan §8.2-C list the FULL generator under the
    // "required, non-null on every live write" group — nullable provenance ⇒ unrecoverable
    // provenance). All four subfields required so M6 can stratify the corpus by generator
    // (different models/temperatures produce different outfit distributions — an off-policy confound).
    generator: {
      type: new Schema(
        {
          provider: { type: String, required: true },
          model: { type: String, required: true },
          temperature: { type: Number, required: true },
          promptVersion: { type: String, required: true },
          // §G item 6 / §A.6 — service-owned config that changes truncation/parse-fail/candidate
          // distributions; M6 must stratify by it. Python authors the whole block from the
          // service config (snapshot.py _generator_block) on EVERY write incl. the §D degenerate
          // path, so these MUST be declared fields or default strict:true strips them silently
          // (the D-1/D-2 class). `finishStatus` is the ONLY optional one (a clean run leaves it
          // unset — snapshot.abnormal_finish_status returns None unless refusal/truncation).
          maxCompletionTokens: { type: Number, required: true }, // cap VALUE (`maxOutputTokens` name if Responses)
          apiSurface: { type: String, enum: ["chat_completions", "responses"], required: true },
          responseFormat: { type: String, enum: ["json_schema_strict", "json_object"], required: true },
          reasoningEffort: { type: String, required: true }, // e.g. "none"/"minimal"
          storeMode: { type: String, enum: ["none"], default: "none", required: true }, // no OpenAI distillation/evals storage
          promptCacheRetention: { type: String, enum: ["in_memory"], required: true }, // M5 rejects extended 24h retention
          timeoutSeconds: { type: Number, required: true }, // OpenAI SDK timeout
          maxRetries: { type: Number, required: true }, // OpenAI SDK retries; 0 for M5 live render
          // Run-level finish status (abnormal_finish_status → {finishReason, refused}); the
          // status/incompleteReason keys carry the Responses-API surface when adopted.
          finishStatus: {
            type: new Schema(
              {
                finishReason: { type: String },
                status: { type: String },
                incompleteReason: { type: String },
                refused: { type: Boolean },
              },
              { _id: false },
            ),
          },
        },
        { _id: false },
      ),
      required: true,
    },
    rankerConfigVersion: { type: String, required: true }, // a hash of the Appendix B constants (C4)
    // Required non-null provenance (spec §15.1 groups scorer with the version block): the M6
    // trainer must know the cold_start-vs-trained regime of every snapshot to stratify the
    // corpus. modelId is optional (null at cold start). Free to tighten now (dormant); a
    // breaking migration once M5 writes begin.
    scorer: {
      type: new Schema(
        {
          kind: { type: String, enum: ["cold_start", "trained"], required: true },
          modelId: { type: String },
          available: { type: Boolean, required: true },
        },
        { _id: false },
      ),
      required: true,
    },

    // --- D: item feature snapshots ---
    // `default: undefined` is load-bearing: Mongoose otherwise materializes omitted arrays as
    // [] before `required` runs, collapsing "writer forgot this field" into "valid empty render".
    itemSnapshots: { type: [ItemSnapshotSchema], required: true, default: undefined }, // required array, may be empty

    // --- E/F: candidate funnel ---
    generationAttempts: { type: [GenerationAttemptSchema], required: true, default: undefined },
    candidates: { type: [CandidateSnapshotSchema], required: true, default: undefined },

    // --- G: request-level diagnostics. samplerPerType/histograms are DATA-keyed Maps
    // (preserved key-for-key by snapshot_serde, C4). ranker/rescue are flexible Mixed —
    // the C6 builder owns the RankerResult/RescueResult → diagnostics mapping. ---
    diagnostics: {
      type: new Schema(
        {
          samplerPerType: { type: Map, of: Schema.Types.Mixed }, // keyed by ItemType (incl. outer_layer)
          candidateRequested: { type: Number },
          promptItemCount: { type: Number },
          notEnoughItems: { type: Boolean },
          scorerAvailable: { type: Boolean },
          ranker: { type: Schema.Types.Mixed },
          rescue: { type: Schema.Types.Mixed },
          parse: {
            type: new Schema(
              {
                parseSuccess: { type: Boolean },
                repairUsed: { type: Boolean },
                generatorCalls: { type: Number },
              },
              { _id: false },
            ),
          },
          rejectionHistogram: { type: Map, of: Number }, // keyed by IssueCode value
          warningHistogram: { type: Map, of: Number },
          // §D engine-failure record (m5-cutover.md §G item 4 / §J D-1). Python emits this on
          // every §D failure/degenerate write (snapshot.py EngineFailure.to_payload_dict). It
          // MUST be a declared field or default strict:true silently strips the entire failure
          // corpus on insert. `stage`/`code` are the closed sets above; `message` is a bounded
          // fixed-catalogue string (G13 — no stack trace / prompt / secret); structured detail
          // lives in `detail{itemId,count}`, never interpolated into `message`.
          engineFailure: {
            type: new Schema(
              {
                stage: { type: String, enum: [...ENGINE_FAILURE_STAGES] },
                code: { type: String, enum: [...ENGINE_FAILURE_CODES] },
                message: { type: String, maxlength: ENGINE_FAILURE_MESSAGE_MAX_CHARS },
                detail: {
                  type: new Schema(
                    { itemId: { type: String }, count: { type: Number } }, // itemId = 24-hex ObjectId (helper-validated)
                    { _id: false },
                  ),
                },
                messageTruncated: { type: Boolean, default: false },
              },
              { _id: false },
            ),
          },
        },
        { _id: false },
      ),
    },

    // --- H: shown history (H19's queryable home) — denormalized so the repetition-window
    // query never unwinds candidates[]. shownBaseKeys intentionally NOT stored (derivable). ---
    shownCandidateIds: { type: [String], required: true, default: undefined },
    shownFullSignatures: { type: [String], required: true, default: undefined },
    nSurfaced: { type: Number, required: true, min: 0 },
    spreadCollapsed: { type: Boolean, required: true },

    // --- K: redaction seam (H43) — the only post-insert-mutable fields. Redaction is the
    // NON-ERASURE removal tool (corpus hygiene / bad batches) and the account route's phase-1
    // fail-safe; account deletion itself ERASES the user's snapshots via the User cascade
    // (Track 2 policy — "delete me" means delete). A [STAGED] PII-null scrub (null occasion/
    // location/weatherRaw/raw text, preserve keys/scores/itemSnapshots) remains reserved for a
    // future consent-based-retention option (spec §15.1 / §23-H43). ---
    redacted: { type: Boolean, default: false },
    redactedAt: { type: Date },
    redactionReason: { type: String },
  },
  { timestamps: true },
);

// ---------------------------------------------------------------------------
// Immutability guard (the one-way door). Post-insert, only the redaction fields may
// change. Enforced on both document (`save`) and query (`updateOne`/`findOneAndUpdate`/…)
// middleware, since either could mutate a stored snapshot.
//
// Coverage note: pre-update query hooks + the document `save` hook are guarded. `bulkWrite`
// does NOT reliably fire per-op middleware in Mongoose, so M5 must never mutate snapshots
// via bulkWrite (the live write path uses `.create()` / pre-allocated `_id` insert).
// ---------------------------------------------------------------------------

// Mongoose's `{ timestamps: true }` registers its builtin pre-hooks DURING `new Schema(...)`
// — i.e. before this guard is registered below — so a redaction write reaches the guard with
// `updatedAt` already injected into `$set` and `createdAt` into `$setOnInsert`. Those paths are
// framework-managed, not training truth, so they are exempt: `createdAt` only ever rides
// `$setOnInsert` (a no-op on an existing doc) and `updatedAt` necessarily bumps on the one
// sanctioned post-insert write. They are NOT in GENERATION_SNAPSHOT_MUTABLE_FIELDS (which is the
// semantic redaction whitelist) — without this exemption the guard would reject its OWN seam.
const TIMESTAMP_MANAGED_FIELDS = new Set(["createdAt", "updatedAt"]);

function isMutationAllowed(path: string): boolean {
  const top = path.split(".")[0];
  return GENERATION_SNAPSHOT_MUTABLE_FIELDS.has(top) || TIMESTAMP_MANAGED_FIELDS.has(top);
}

function immutableError(offending: string[]): Error {
  return new Error(
    "GenerationSnapshot is immutable after insert; only " +
      [...GENERATION_SNAPSHOT_MUTABLE_FIELDS].join(" / ") +
      " may change. Rejected mutation of: " +
      offending.join(", ") +
      ".",
  );
}

/** Non-redaction top-level field paths an update object would mutate (empty ⇒ allowed). */
export function nonRedactionUpdatePaths(update: unknown): string[] {
  if (!update) return [];
  // An aggregation-pipeline update ([{ $set: … }]) cannot be whitelisted field-by-field —
  // reject wholesale (snapshots are never legitimately pipeline-updated).
  if (Array.isArray(update)) return ["<aggregation-pipeline>"];
  const touched: string[] = [];
  for (const [key, val] of Object.entries(update as Record<string, unknown>)) {
    if (key.startsWith("$")) {
      if (val && typeof val === "object") {
        const sub = val as Record<string, unknown>;
        touched.push(...Object.keys(sub));
        // $rename is the lone operator whose payload KEYS are source fields and whose VALUES
        // are the DESTINATION fields it writes to — both sides are mutated, so the destinations
        // must clear the whitelist too (else $rename:{redacted:"occasion"} would slip through).
        if (key === "$rename") {
          touched.push(...Object.values(sub).filter((v): v is string => typeof v === "string"));
        }
      } else {
        touched.push(key); // an operator with a non-object payload — treat as a touch
      }
    } else {
      touched.push(key);
    }
  }
  return touched.filter((path) => !isMutationAllowed(path));
}

/** Non-redaction modified paths for a document re-save (empty ⇒ allowed). */
export function nonRedactionModifiedPaths(modifiedPaths: readonly string[]): string[] {
  return modifiedPaths.filter((path) => !isMutationAllowed(path));
}

// The hooks are named + exported (not inline closures) so the tests can invoke the EXACT
// registered functions directly — proving wiring + behavior without a live DB or Mongoose's
// internal middleware. `this` is typed to the minimal structural slice each needs (a Query /
// Document is assignable to it, so registration type-checks).
export function immutableUpdateGuard(
  this: { getUpdate: () => unknown },
  next: (err?: Error) => void,
): void {
  const offending = nonRedactionUpdatePaths(this.getUpdate());
  if (offending.length > 0) return next(immutableError(offending));
  next();
}

export function immutableSaveGuard(
  this: { isNew: boolean; modifiedPaths: () => string[] },
  next: (err?: Error) => void,
): void {
  if (this.isNew) return next(); // the insert is allowed; only re-saves are constrained
  const offending = nonRedactionModifiedPaths(this.modifiedPaths());
  if (offending.length > 0) return next(immutableError(offending));
  next();
}

// Whole-document replace can NEVER preserve an immutable record — a replacement body that
// happens to contain only redaction fields would still delete every other field (the training
// truth). A field-whitelist is unsound for replace, so reject it unconditionally; the only
// sanctioned post-insert mutation is a redaction-field UPDATE (updateOne / findOneAndUpdate).
export function immutableReplaceGuard(next: (err?: Error) => void): void {
  next(
    new Error(
      "GenerationSnapshot is immutable after insert; whole-document replace is never permitted " +
        "(use a redaction-field update for the only sanctioned mutation).",
    ),
  );
}

GenerationSnapshotSchema.pre(["updateOne", "updateMany", "findOneAndUpdate"], immutableUpdateGuard);
GenerationSnapshotSchema.pre(["replaceOne", "findOneAndReplace"], immutableReplaceGuard);
GenerationSnapshotSchema.pre("save", immutableSaveGuard);

// Delete guard (§G item 3 / H54) — the immutability contract had update/replace/save guards but NO
// delete guard. A GenerationSnapshot is immutable training truth; redaction (redacted:true) is the
// sanctioned removal for corpus hygiene. The ONE sanctioned hard-delete is user-invoked account
// erasure via the User cascade (`User.ts cascadeDeleteUserData` + the mlRecommend post-persist
// orphan check), which runs on the NATIVE driver deliberately below this guard — "delete me"
// means the user's own text (names, occasions, raw generation text) leaves the DB (§23-H43,
// Track 2 policy). Mongoose fires DIFFERENT hooks per delete path: pre('deleteOne') alone
// is QUERY middleware only — Document#deleteOne() needs {document:true}, and findOneAndDelete/
// findByIdAndDelete fire their own 'findOneAndDelete' hook. All three registrations or the guard
// has bypasses (verified against mongoose schema.js pre() jsdoc).
export function immutableDeleteGuard(next: (err?: Error) => void): void {
  next(
    new Error(
      "GenerationSnapshot is immutable training truth; use redaction — the sole sanctioned " +
        "hard-delete is account-deletion erasure via the User cascade (native driver)",
    ),
  );
}
GenerationSnapshotSchema.pre(["deleteOne", "deleteMany", "findOneAndDelete"], immutableDeleteGuard); // query paths
GenerationSnapshotSchema.pre("deleteOne", { document: true, query: false }, immutableDeleteGuard); // doc.deleteOne()

// ---------------------------------------------------------------------------
// Indexes (§8.8) — built automatically on first boot via autoIndex against the empty DB
// (mongodb.ts autoIndex:true + db.ts Model.init()). No migration script.
// ---------------------------------------------------------------------------

// Feedback-binding ownership lookup (prefix {user, createdAt}) + the H19 repetition window:
// the _id:-1 tail makes same-millisecond createdAt ties deterministic (§8.8 / §15.1 reducer).
GenerationSnapshotSchema.index({ user: 1, createdAt: -1, _id: -1 });
// Re-roll sibling grouping — NON-unique (Fable/Codex demotion: real idempotency rides
// requestId once H7 closes; a unique index here would wrongly reject a legit repeat render).
GenerationSnapshotSchema.index({ user: 1, candidateCacheKey: 1, generationIndex: 1 });
// Render idempotency (§G item 2 / §C.4 / H50) — PARTIAL unique on {user, requestId}. $type (not
// $exists) so a null/missing requestId is invisible to the index (no shared retry sentinel); the
// schema `required` + app validation reject blank/malformed before they reach it. First-write-wins
// enforced: a duplicate requestId → E11000, and the route re-reads + replays the winner (§C.4).
GenerationSnapshotSchema.index(
  { user: 1, requestId: 1 },
  { unique: true, partialFilterExpression: { requestId: { $type: "string" } } },
);
// "Has this user been shown this outfit" — multikey over the denormalized shown array.
GenerationSnapshotSchema.index({ user: 1, shownFullSignatures: 1, createdAt: -1 });
// M6 training batch read — scan non-redacted by time.
GenerationSnapshotSchema.index({ redacted: 1, createdAt: 1 });
// The account route's phase-1 redaction fail-safe sweep + manual-sweep lookup (H43).
GenerationSnapshotSchema.index({ user: 1, redacted: 1 });

export type GenerationSnapshotDocument = InferSchemaType<typeof GenerationSnapshotSchema>;

const GenerationSnapshot =
  models.GenerationSnapshot || model("GenerationSnapshot", GenerationSnapshotSchema);
export default GenerationSnapshot;
