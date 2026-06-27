# M4 — Data-model migration (planning conductor)

> **COMPLETED 2026-06-27.** The full C1–C8 ladder shipped: M4a (data path, C1–C3) live + M4b (the dormant
> GenerationSnapshot substrate, C4–C8) additive. **§14 was the build authority** — the C1–C8 ladder; where any
> earlier text disagrees, §14 wins. Canonical contracts live in the spec: **§15.1** (snapshot) + **§15.2**
> (adapter) + **§6.1** (clothingType + columns) + **§6.6/§16/Appendix B** (interaction binding + reducer
> constants + scope vocab) + **§18** (W-track split) + **§19** (deletion table) + **§23** (holes). M4b ships
> dormant; M5 owns the live cutover — see the **§14.5 M5-handoff note**. Retired from the default reading list;
> kept as the M4 reference (rationale, trap-guards, query/index notes, the ladder, the handoff).

## 0. One-way door + reversibility posture

M4 catches the persisted Mongo schemas (`fitted/models/*.ts`) up to the v2 contracts `fitted_core` already
assumes (`models.py` `ItemType` already carries all 5 values — most of M4 is "catch the persisted side up").
Spec §6's data-model posture makes most changes **additive/reversible** (rule 1 additive + raw-preserving;
rule 2 inferences are drafts; rule 3 events append-only with lineage) — those need no heavy design.

**M4 has exactly ONE one-way door: the GenerationSnapshot schema + its identity binding (§8).** It survives
not because of existing data (there is none) but because it forecloses what *future* snapshots can capture —
a schema that omits rejected candidates / continuous scores / visual permanently starves every M5+ snapshot
(H29). Everything else (`clothingType`→5, the `wardrobeVersion` field, action-enum +3, H37 scope vocab, the
interaction binding fields, the H19 shown-history home) is additive-reversible. **The `clothingType`
reclassification is NOT a one-way door** — no live data, and rule 1 keeps it re-derivable from raw
`category`/`name`/`subCategory` (`sessionId` stays a derivation = `userId`, not a stored field).

**Writer contract — M4 owns the *contract*; M5 wires the live route.** Storage home = a TS Mongoose model
`GenerationSnapshot.ts` (one Mongo-writing layer; no Mongo creds in Python); authoritative shape = spec
**§15.1**; Python gets a mirroring frozen dataclass in `fitted_core` for producing (M5 write) + reading (M6
train). The writer-contract deliverables M5 executes: (1) required payload shape Python→TS; (2) what TS
persists verbatim; (3) required vs nullable/staged fields; (4) server-generated fields; (5) client-echo
contract; (6) indexes; (7) validation rules; (8) example documents; (9) trainability rules; (10) M5 writer
acceptance criteria. The rejected/low-ranked funnel payload is **server-side Python→TS only, never
client-returned**; OQ1 size is a non-issue (~120 KB worst case, conditioned on the raw-payload caps in §8.3 —
byte cap + hash + truncation flag + no-blob rule).

## 7. Scope + posture

### 7.1 M4 in/out scope (M4a live · M4b dormant)

The **no-live-route / fixtures-only** invariant holds for **M4b (C4–C8) only** — M4a (C1–C3) rebuilds live
ingestion, wipes dev Mongo, and rips the live `/account` + `/dashboard` PreferenceSummary UI (§14).

- **IN (M4 owns):** `clothingType`→5 + the ingestion classifier (§10.3); the `warmth` column; action-enum
  +`planned/packed/corrected`; `baseKey`/`fullSignature` + `{snapshotId,candidateId}` binding **fields** on
  interactions (§9.1); the `wardrobeVersion` **field** (§10.4); affinity **posture** (§7.3); GenerationSnapshot
  **schema + writer contract** (§8/§15.1); the feedback-authenticity **contract** (§9.5 — gate functions
  deferred to M5); H37 scope-vocab **fields** (§11.4); the H19 shown-history **home** = snapshot; the H43
  redaction **seam** + the `wardrobeimages` cascade arm (C7).
- **OUT → M5:** the live snapshot write + route wiring; the `{snapshotId,candidateId}` echo + **actually-shown
  membership** check; request-adapter normalization; two-stage cache; `USE_ML_SHORTLISTER` cutover; the four
  request-time dresses string-match deletions (§19); H7 `generationIndex` / H8 `seedDate`.
- **OUT → other tracks:** the `wardrobeVersion` bump trigger (H6 → **W-track**); the
  `material`/`formality`/`styleTags` columns + their CV + review form (**W-track**, §14 decision #1); the
  StyleProfile compiler (**B-track**); the trained scorer + signed `behavioralStrength` (**M6**); H37
  anomaly-scoping **behavior** (`[STAGED]`).

### 7.3 Affinity = rebuildable projection (OQ2)

`fitted_core` consumes affinity as a **read-only input** (`ranker.py:189-190` `item_affinity` /
`liked_full_signatures`) — the substrate never owns affinity storage, so this can't reopen the closed M0–M3
contract. **Decision: compute-live in the M5 request adapter from append-only `OutfitInteraction` rows; never
an authoritative collection. Do NOT create `fitted/models/ItemAffinity.ts`** (unless a later session overturns
this with measured evidence). **Why (determinism/consistency):** an incrementally-updated affinity collection
is a read-modify-write that can **drift** from the log — and that drift *is* H11 made real; a projection
**cannot drift** (recomputed from the log) and **rebuilds clean after a later redaction** (the H43 cheapening).
**Trap-guard F:** the `baseKey`/`fullSignature` field *values* inherit the §7/H30 append-only key format — M4
stores them, it does not redesign the format.

## 8. GenerationSnapshot schema + writer contract (CLOSED — the one-way door)

Canonical contract = spec **§15.1**; this section holds the design derivation + the Mongoose shape (§8.3) +
the index plan (§8.8) §15.1 points back to. **§15.1 wins on any disagreement — fix on sight.**

**One GenerationSnapshot = one rendered response** (per `generationIndex`) — immutable training truth and the
feedback-binding target; the siblings of a re-roll share a `candidateCacheKey` but each writes its own
write-once doc (appending to a shared mutable doc would break immutability + invite the H11 append race).
**Immutable after insert** except the H43 redaction seam (§8.2-K), which MAY null PII-bearing fields while
preserving keys/scores/`itemSnapshots`. **Authorship (the C+D hybrid, §8.4):** Python issues
keys/scores/dispositions/`candidateId` + each item's `engineVisible` projection; **TS** builds `itemSnapshots`
from the single captured request context (**no post-Python refetch** — a refetch could snapshot a mutated
doc), adds `evidence`, and persists the merged doc verbatim. **Id authorship:** `snapshotId` is
**TS-preallocated** before the browser response (so each shown variant carries `(snapshotId, candidateId)`);
`candidateId` is **Python-issued** over the deterministic funnel order.

### 8.2 Schema field groups (derivation; canonical contract = §15.1)

> Canonical field contract = spec **§15.1**; Mongoose shape = **§8.3**. Below is the design derivation +
> per-group load-bearing rationale, anchors kept for cross-refs. **§15.1 wins on disagreement** — fix on
> sight. camelCase = wire/Mongo (Python mirror snake_case, §8.4; `?` = nullable); owner field is **`user`**,
> not `userId`.

**A — identity:** `_id`(snapshotId, TS-preallocated, §8), `schemaVersion`(=1, the additive-evolution lever),
`user`, `sessionId`(=user id, Finding E), `candidateCacheKey`(groups re-roll siblings), `generationIndex`
(re-roll lever, H7), `requestId?`(**the future render-idempotency key once H7 closes** — the unique-insert
guard rides this, not `generationIndex`, §8.8), `createdAt`.

**B — request context (the Lens, §6.3):** `intent`(enum), `occasion`(verbatim), `weather`(bucket) +
`weatherRaw?`/`location?`, `constraints`(flexible `Map`, additive H36), `forcedItemId?`/`baseOutfitItemIds?`/
`routineId?`, `lens?{styleProfileId?,styleProfileVersion?,boardId?,confidence?,styleProfileSnapshot?}`,
`wardrobeVersion`(**field only**; bump=W-track/H6), `interactionCountAtRequest`(H9), `seedDate?`(H8). **The
`lens.styleProfileSnapshot?` embed seam (§6.2):** a bare `styleProfileId`/`version` ref re-creates the H10
disease if a board-version doc is later cascaded away, so the schema embeds the compiled profile (Mixed, null
until B-track), not just points at it.

**C — version / provenance — REQUIRED, non-null on every live write** (nullable provenance ⇒ unrecoverable
provenance; the backstop for the engine-vs-evidence boundary): `fittedCoreVersion`, `generator{provider,model,
temperature,promptVersion}`, `rankerConfigVersion`(a hash of the Appendix B constants), `scorer{kind:
cold_start|trained, modelId?, available}`. `promptVersion` also decodes the generator-visible subset of
`engineVisible`, so no separate `generatorVisible` store at `[NOW]`. **None of the three version constants
exist in `fitted_core` today** (absent from `__init__.py`/`config.py`) → add before the first live write (S9
ob. 1).

**D — item feature snapshots (`itemSnapshots[]`, the H10/H25 core) — the C+D provenance split (the
one-way-door correction).** A **flat verbatim copy** of the deployed item doc is **REJECTED**: a future M6
trainer can't distinguish "the engine conditioned on this" from "TS kept it for audit," so it would build
features the recommendation never saw (e.g. `pattern`/`seasons`) and do contaminated off-policy correction —
an irreversible corpus foreclosure (flat docs get written all through M5). Fix: **two namespaced buckets**
(the bucket *is* the ranking-visibility marker; no per-field bool). Per `ItemSnapshot`:
- `itemId: string` (**not** a populatable `ObjectId` ref — H10: nothing may re-hydrate a mutated live item).
- **`engineVisible`** — the **exact** `fitted_core.WardrobeItem` projection sent to Python (`name`,
  `clothingType`, `warmth`, `styleTags`/`colorTags`/`occasionTags`, `material`, `formality`, `imageUrl`) —
  the **only** ranking-visible layer, **true by construction** (stored == sent, *modulo* the documented
  snake↔camel rename `style_tags`/`color_tags`/`occasion_tags`, a bijection with no value transform).
- **`evidence`** — storage-only deployed fields the engine **never saw**: `category`, `subCategory`,
  `pattern`, `seasons`, `isAvailable`/`isFavorite`/`lastWornAt` (orphan/H21 signals, not yet engine-scored),
  `brand`, `fit`, `size`, `layerRole`, `tags`, `rawAttributes?`(bounded; no blob, §8.3), and
  `image?{imageRef?,imageVersion?,hash?}` — **refs/hash only, never the blob** (H29(c); guards H14). Image
  hash/version is a **W-track dependency** (`WardrobeImage` has none today).
- `generatorVisible?` — reserved (the `promptVersion`-decodable subset of `engineVisible` at `[NOW]`; H33
  vision generator). `embeddingRef?`/`visualFeatureRef?` — **reserved nullable** (H25; shape **NOT** locked —
  a bare-string lock is itself a foreclosure; deferred to the first writer).

**Trainability rule:** any model of what the recommendation *conditioned on* trains **only** from
`engineVisible` + the per-candidate `scoreTrace`/identity fields; `evidence`/`embeddingRef` are new-capacity
inputs that change the off-policy assumptions. Moving a field `evidence`→`engineVisible` requires a
`schemaVersion` bump.

**E — generation attempts (`generationAttempts[]`):** root/attempt-level events (invalid JSON, malformed
root, the §12 repair retry, aggregate warnings, raw-generation metadata) that **must not be forced into fake
candidates**. Per-attempt fields (`attemptId`/`attemptIndex`/`isRepair`/`parseIssue?`/`rootRejectionCode?`/
`aggregateWarningCodes`/`payloadParsed`/`candidateCountEmitted` + bounded `rawText*`, §8.3) in §8.3;
candidates link back via `sourceAttemptId`.

**F — candidate pool (`candidates[]`, one array over generated→validated→ranked→shown; H29(b) — rejected +
low-ranked must survive).** `candidateId` = **Python-issued, unique within the snapshot**, a deterministic
ordinal over the fully-traced funnel; `dropStage?`/`dropReason?` are **open, append-only code sets** (not
hard enums, so a future reason isn't a write-rejection foreclosure). Per-candidate fields (`stageReached`/
`accepted`/`shown`/`shownPosition?`/`sourceAttemptId`/`sourceIndex?`/rejection+warning codes/content
`items`+`slotMap`+`baseKey?`/`fullSignature?`/`optionPath?`/`risk?`/`styleMove?`/`rawEmitted?`/`scoreTrace?`)
in §8.3.

> **Content-preservation invariant (REQUIRED).** Every **generated, non-accepted** candidate MUST carry
> `{items+slotMap}` (reconstructed by `sourceIndex` from the attempt's parsed `outfits[]`) **or** `rawEmitted`
> — a bare `{candidateId, rejectionCodes}` is **invalid**: it loses the negative training signal, because
> `Issue` carries only `code`/`candidate_index`/`detail`, **never the rejected outfit's content**
> (`validator.py:60`). Snapshot-building must retain the parsed `outfits[]` beside the issues.

**G — scores & diagnostics.** Per-candidate `scoreTrace` is **continuous (never just the 3-way buckets) and
populated for every *scored* candidate, including scored-but-unshown** (H29(a); funnel sites #2/#3, §8.4):
`compatibility?`/`visibility?`([0,1] cold-start, the M6 seam), `rankerScore?`, signed
`scoreBreakdown?{base,combo,item,dislike,overuse,repetition,cooldown}` (N4), `signalScore?`(reserved, M6).
Request-level `diagnostics` carries the per-type `TypeSampleResult` (M6 eligibility, H9), the SamplerResult/
RankerResult/RescueResult/parse flags, and rejection/warning histograms (fields in §8.3).

**H — shown history (H19's queryable home).** Denormalized `shownCandidateIds`/`shownFullSignatures`/
`nSurfaced`/`spreadCollapsed` so the repetition-window query never unwinds `candidates[]`. `shownBaseKeys`
**dropped at S4** (spec §15.1: no `[NOW]` consumer; derivable from `shownCandidateIds` + `candidates[].baseKey`).
The snapshot is the raw source for the ranker's `shown_full_signatures` window (`ranker.py:191`); **S4 owns
the window/cap in the M5 reducer** (§8.8/§9.3).

**I — visual / reference preservation.** Folded into `engineVisible`/`evidence.image` + reserved nullable
`embeddingRef`/`visualFeatureRef` (§8.2-D); refs/hashes only, **never blobs**; the H25 extension seam.

**J — feedback binding support** (contract; **finalized at S4 §9.1**). OutfitInteraction gets four
nullable binding fields (`snapshotId`/`candidateId`/`baseKey`/`fullSignature`, server-re-read,
all-present-or-all-absent); `shownPosition`/`generationIndex` are **derived from the snapshot, not
row-stored**. Client echoes `{snapshotId,candidateId}` **only**; the server re-reads the candidate and
**server-sets** `items[]`/keys, validating optional `perItemFeedback.itemId` ⊆ the candidate's items. Gate
(impl split §9.5): exists ∧ owned ∧ membership (`candidateId ∈ shownCandidateIds`) ∧ items⊆candidate.

**K — redaction seam (H43, D4; behavior `[STAGED]`).** Reserve `redacted`(default false)/`redactedAt?`/
`redactionReason?` (lineage, posture rule 3); M4 does **not** wire the `User` cascade (`User.ts:27` hook covers
only `wardrobeitems`+`outfitinteractions`). A rebuildable-projection affinity (OQ2) rebuilds clean after
redaction (D4/D6). **Recorded privacy-milestone intent:** the snapshot's user-context PII (`occasion`,
`location`, `weatherRaw`, `rawText`/`rawEmitted`) is structurally separable from training signal — redaction
MAY null those while preserving keys/scores/`itemSnapshots`, the designed exit for the
immutable-truth-vs-erasure tension.

### 8.3 Mongoose model proposal (`fitted/models/GenerationSnapshot.ts`)

Concrete enough to implement; exact syntax is M5's. Sub-schemas with `{_id:false}` for embedded docs.

```
ScoreTraceSchema { compatibility?:Number, visibility?:Number, rankerScore?:Number,
  scoreBreakdown?:{base,combo,item,dislike,overuse,repetition,cooldown:Number}, signalScore?:Number }   // _id:false

GenerationAttemptSchema {
  attemptId:String (required), attemptIndex:Number (required), isRepair:Boolean (required, default false),
  parseIssue?:String, rootRejectionCode?:String, aggregateWarningCodes:[String] (default []),
  payloadParsed:Boolean (required), candidateCountEmitted:Number (default 0),
  rawTextHash?:String, rawTextBytes?:Number, rawTextTruncated?:Boolean, rawText?:String  // bounded; no blobs (§8.3)
}   // _id:false

CandidateSnapshotSchema {
  candidateId:String (required), sourceAttemptId:String (required), sourceIndex?:Number,
  stageReached:String enum[generated,validated,ranked,shown] (required),
  accepted:Boolean (required), shown:Boolean (required, default false), shownPosition?:Number,
  dropStage?:String,         // open code set (validate against a documented list, NOT a hard enum)
  dropReason?:String,        // open, append-only code set (Fable: avoid write-rejection foreclosure)
  admittedViaFallbackStage?:String,   // FallbackStage value
  rejectionCodes:[String] (default []), warningCodes:[String] (default []),
  items:[{ itemId:String, role:String enum[Role] }],   // itemId = STRING, not ObjectId ref (H10)
  slotMap:{dress?,top?,bottom?,outer?,shoes?:String}, template?:String enum[two_piece,one_piece],
  baseKey?:String, fullSignature?:String, optionPath?:String enum[reliable,bridge,stretch],
  risk?:String enum[safe,noticeable,bold],
  styleMove?:{moveType:String, changedItemIds:[String], oneSentence:String},
  rawEmitted?:Mixed,         // bounded; no blobs (§8.3)
  scoreTrace?:ScoreTraceSchema
  // INVARIANT (app-validated, §8.2-F): generated && !accepted ⇒ (items+slotMap) || rawEmitted present
}   // _id:false

ItemSnapshotSchema {
  itemId:String (required),
  engineVisible:{ name, clothingType:String enum[5], warmth:Number (required), styleTags:[String], colorTags:[String],  // the exact projection sent to Python,
                  occasionTags:[String], material?, formality?, imageUrl? } (required),                        // modulo snake↔camel (= fitted_core.WardrobeItem view)
  evidence:{ category, subCategory?, pattern?, seasons:[String], isAvailable:Boolean, isFavorite:Boolean,    // storage-only; NOT ranking-visible
             lastWornAt?:Date, brand?, fit?, size?, layerRole?, tags:[String],
             image?:{imageRef?:String, imageVersion?:Number, hash?:String}, rawAttributes?:Mixed },          // bounded; no blobs
  generatorVisible?:Mixed,   // reserved (promptVersion-decodable from engineVisible at [NOW])
  cvModelVersion?:String,    // data-path provenance seam (§15.1 / C5); null at M4, wired at W-track CV
  embeddingRef?:String, visualFeatureRef?:String   // reserved; shape NOT locked now
}   // _id:false

GenerationSnapshotSchema {
  schemaVersion:Number (required, default 1),
  user:ObjectId ref User (required, index), sessionId:String (required),
  candidateCacheKey:String (required), generationIndex:Number (required), requestId?:String,
  intent:String enum[4] (required), occasion:String (required), weather:String enum[5] (required),
  weatherRaw?, location?, constraints:Map<Mixed> (default {}),
  forcedItemId?:String, baseOutfitItemIds?:[String], routineId?:ObjectId,
  lens?:{styleProfileId?:ObjectId, styleProfileVersion?:Number, boardId?:ObjectId, confidence?:Number, styleProfileSnapshot?:Mixed},
  wardrobeVersion:Number (required), interactionCountAtRequest:Number (required), seedDate?:String,
  fittedCoreVersion:String (REQUIRED),                                          // non-null on every live write
  generator:{provider:String (REQUIRED), model:String (REQUIRED), temperature:Number (REQUIRED), promptVersion:String (REQUIRED)} (REQUIRED),  // §8.2-C: the full generator is required non-null provenance
  rankerConfigVersion:String (REQUIRED),
  scorer:{kind:String enum[cold_start,trained] (REQUIRED), modelId?:String, available:Boolean (REQUIRED)} (REQUIRED),  // §15.1 groups scorer in the non-null provenance block; modelId null at cold start
  itemSnapshots:[ItemSnapshotSchema] (required),
  generationAttempts:[GenerationAttemptSchema] (required),                      // root/attempt-level trace
  candidates:[CandidateSnapshotSchema] (required),
  diagnostics:{ samplerPerType:Map, candidateRequested:Number, promptItemCount:Number,
    notEnoughItems:Boolean, scorerAvailable:Boolean, ranker:{...5...}, rescue?:{...5...},
    parse:{parseSuccess,repairUsed:Boolean, generatorCalls:Number}, rejectionHistogram:Map, warningHistogram:Map },
  shownCandidateIds:[String] (default []), shownFullSignatures:[String] (default []),
  nSurfaced:Number, spreadCollapsed:Boolean,                                    // shownBaseKeys NOT stored — derive from shownCandidateIds+candidates[].baseKey (spec §15.1)
  redacted:Boolean (default false), redactedAt?:Date, redactionReason?:String
}  with { timestamps:true }
```

- **Immutability (C5, expanded from the original 3-op sketch):** document write-once + a guard allowing
  mutation **only** of the redaction fields. `updateOne`/`updateMany`/`findOneAndUpdate` run a field-whitelist
  guard; `replaceOne`/`findOneAndReplace` are **rejected unconditionally** (a whole-doc replace can never
  preserve the record, so a field-whitelist is unsound there); `save` re-saves are whitelist-checked (the
  `isNew` insert is allowed). Framework-managed timestamp paths (`createdAt`/`updatedAt`, injected by
  `{timestamps:true}`'s own pre-hooks) are exempt — else the guard would reject its own redaction write.
  (Acceptance tests assert a non-redaction update/replace/`$rename`-bypass is rejected and a redaction update
  with live timestamps is accepted.)
- **Raw-field caps:** `rawText`/`rawEmitted`/`rawAttributes` governed by a byte cap + hash + truncation flag
  + a no-image/base64/blob rule (§8.3) — the 120 KB bound is only defensible with these.
- **Cross-model gaps (routed):** `clothingType` enum → S5 (CLOSED §10); `OutfitInteraction` binding fields →
  S4 (CLOSED §9); `db.ts` `GenerationSnapshot` registration → **done at C5** (registering an unused model is
  inert, but without it the autoIndex + immutability guard never load — §14.2; supersedes the earlier
  "→ M5" note). Indexes: §8.8.

### 8.4 Python payload contract + the three-site funnel obligation

- **Producer:** a frozen `GenerationSnapshotPayload` dataclass (future `fitted_core/snapshot.py`; contracted
  now, built at impl). Fields = §8.2-A/B/C/E/F/G + each item's `engineVisible` (snake_case); `evidence` is
  TS's, not Python's.
- **C+D authorship (§8.2-D):** TS builds `itemSnapshots` from the single captured context **before** the
  Python call (no refetch), sends Python the exact `engineVisible` projection, and stores that same
  projection — "the engine saw it" true by construction. Python owns + returns keys/scores/dispositions/
  `candidateId`, so the §7/H15 no-drift guarantee holds; `fitted_core.WardrobeItem` is confirmed lossy
  (`models.py:106`). The request carries only the projection Python already needs.
- **The full-funnel capture obligation — THREE substrate discard sites, not one.** All three must reach the
  snapshot via an **additive, read-only** trace surface that does **not** reopen the closed
  `rescue()`/`rank()`/`build_variants()` contracts:
  1. **`rescue()`** (`rescue.py:653/656/676`) drops `rejections`/`warnings` + the raw/parsed payload → the
     rejected pool + attempt trace (H29(b)).
  2. **`rank()`** returns top-k only (`ranker.py:834`); the scored-but-unshown `_ScoredCandidate`s + their
     `ScoreBreakdown`s die → the H29(a) selection bias.
  3. **`build_variants()`** returns selected only (`response.py:559`); non-selected variants'
     `compatibility`/`visibility` die.

  **Mechanism — LOCKED: Option B (additive sibling trace APIs), NOT a return-shape change.** The closed
  `rescue()`/`rank()`/`build_variants()`/`validate_gpt_payload()` stay **byte-stable** (their bodies are
  **untouched**, not refactored); new `*_with_trace`/`*_with_audit` siblings return the richer payload (Option A —
  editing a frozen return shape — rejected: it reopens the closed contract). **As implemented at C6**, each
  sibling recovers the discarded signal *additively*: `validate_gpt_payload_with_trace` wraps the original +
  returns the parsed `outfits[]`; `rank_with_audit`/`build_variants_with_trace` **re-run the pure, deterministic
  internals** (seeded by context) to recover the full pre-truncation funnel; `rescue_with_trace` re-orchestrates
  with the siblings — so the closed functions are never edited and re-running yields byte-identical results
  (`rescue_with_trace().result == rescue()`, test-pinned). (This supersedes the earlier "the existing functions
  become *thin projections*" sketch — same Option-B intent, achieved by re-run/wrap rather than by re-pointing the
  originals.) Without all three, every M5 snapshot has continuous scores only for *shown* outfits — a permanently
  selection-biased corpus.
- **Maps from `fitted_core`:** SamplerResult / ValidationResult(+ parsed `outfits[]`) / `keys.py` /
  RankerResult + breakdowns / `response.OutfitVariant` / RescueResult / OpenAIGenerator → the diagnostics/
  funnel/keys/scores/shown/provenance fields (detailed mapping = S9). Also new at impl: the Python-issued
  `candidateId`, the three required version constants (§8.2-C), `interactionCountAtRequest`.
- **Case + id boundary (pinned):** Python snake_case → serializer camelCase, **finite floats only** (no
  `NaN`/`Infinity`), no `undefined`; item/candidate ids cross as **opaque strings** (no `ref`/`populate`,
  H10); `user` stored as `ObjectId`. **Only structural field *names* are re-cased** — the engineVisible
  renames (incl. `type`→`clothingType`) apply **only inside an `engine_visible` object**, and **data-valued
  Map keys** (`constraints`, `samplerPerType`, the rejection/warning histograms — keyed by an `ItemType` like
  `outer_layer`, an `IssueCode` value, or an arbitrary constraint name) plus **verbatim Mixed blobs**
  (`rawEmitted`/`rawAttributes`/`styleProfileSnapshot`/`generatorVisible`) are **preserved key-for-key**.
  Blanket-casing them would diverge the wire from the `ItemType` member value (`outer_layer`→`outerLayer`),
  silently corrupting training truth. Implemented in `fitted_core/snapshot_serde.py` (C4); the opaque-field
  set must grow when C6/M5 adds a new Map/Mixed field.

### 8.8 Index / query plan

| Query pattern | Index | Notes |
|---|---|---|
| Feedback binding / ownership lookup by snapshotId | `_id` (default) + `{user:1, createdAt:-1}` | membership reads one doc by `_id`, asserts `user`, then scans `candidates[]` in that doc |
| **H19** repetition window (last N shown renders for a user) | `{user:1, createdAt:-1, _id:-1}` | total-ordered read (the `_id` tie-break makes same-`createdAt` order deterministic — §9.3); reads `shownFullSignatures` off the recent N **where `nSurfaced>0`** (bounded scan; empties skipped, not counted); `intent` filter optional |
| Re-roll sibling grouping | `{user:1, candidateCacheKey:1, generationIndex:1}` — **NON-unique** | **Demoted from unique (Fable/Codex):** uniqueness-as-idempotency depends on H7 (generationIndex lifecycle, deferred-M5). If `generationIndex` resets per session, a legitimate repeat request with identical inputs + `generationIndex=0` would be **wrongly rejected, losing that render's snapshot + its feedback binding**, OR an idempotent retry would conflate with a genuine later render. Grouping only for M4; **the real idempotency key is `requestId`/renderId, defined when H7 closes (M5)** |
| "Has this user been shown this outfit" / edge queries | multikey `{user:1, shownFullSignatures:1, createdAt:-1}` | content-level "shown recently" lookup off the denormalized array |
| M6 training batch read | `{redacted:1, createdAt:1}` | scan non-redacted by time; training is a batch extract |
| Redaction cascade sweep (future) | `{user:1, redacted:1}` | the H43 `[STAGED]` deletion path |

*Candidate-level `fullSignature` inside `candidates[]` gets a multikey index **only if M6 proves it queries
candidates directly** rather than batch-scanning — deferred, not now (Fable).*

### 8.11 — S9 implementation obligations: superseded by the §14 C1–C8 ladder (the build authority)

The S3 dual review's design changes are folded into §8.2/§8.4/§15.1 (the C+D `engineVisible`/`evidence`
provenance split; the three-site funnel obligation + the Option-B trace siblings; `generationAttempts[]` for
root/attempt events; the content-preservation invariant; required non-null version fields; the **non-unique**
cache-key index, H7-deferred; raw caps + server/client split). **Rejected traps (keep rejected):** a flat
item-copy (provenance foreclosure); a per-field provenance bool; editing the closed return shapes for the
trace (→ Option-B siblings); locking the `embeddingRef` shape now.

---

## 9. Persisted identity & binding (CLOSED)

Additive/reversible **riders** on the §8 one-way door — `baseKey`/`fullSignature` + `{snapshotId,candidateId}`
on interaction rows, the de-orphan binding loop, and the H19 window/cap reducer. Canonical data-shape is
single-homed into the spec (§6.6 fields, §15.1 reducer + shown-history, §16 gate, Appendix B constants); this
is the rationale home. **Governing rule:** denormalize a field onto a row/array only when a `[NOW]` hot path
consumes it **without already holding the source doc** — else keep it single-homed and derive. That stores
`fullSignature`/`baseKey` on the row (the compute-live affinity/cooldown projections read rows at request time)
but **derives** `shownPosition`/`generationIndex` from the snapshot (only exposure-bias/training reads need
them, and those batch reads already load the snapshot).

### 9.1 Additive `OutfitInteraction` binding fields

Additive over the deployed row (`OutfitInteraction.ts`); all nullable — present **iff** snapshot-bound
(`snapshotId` present is the discriminator; pre-M5 legacy rows have none). M4 adds the fields; M5 wires the
live write.

| Field | Type | Source | Why |
|---|---|---|---|
| `snapshotId` | `ObjectId ref GenerationSnapshot` (nullable) | client echo (verified) | the binding target — which exact render (de-orphan) |
| `candidateId` | `String` (nullable) | client echo (verified) | the Python-issued ordinal within that snapshot |
| `baseKey` | `String` (nullable) | **server re-read** from the snapshot candidate | live dislike-cooldown buffer consumer |
| `fullSignature` | `String` (nullable) | **server re-read** | live comboBoost / affinity projection (Finding G) |

- `items[]` (existing): on snapshot-bound feedback the server **sets** it from the re-read candidate, never
  the client echo. Legacy rows keep client-supplied `items` (the §16 vulnerability, gated at M5).
- **NOT added:** `shownPosition`, `generationIndex` — derived from the referenced snapshot (§9), never
  row-stored (only exposure-bias/training reads need them, and those batch reads already load the snapshot).
- **Index (additive, approved):** `{ snapshotId: 1, candidateId: 1 }` for snapshot→feedback joins (M6
  training reads; cheap, additive, reversible). Existing `{user, createdAt}` / `{user, items}` indexes already
  cover the live affinity/cooldown projections.
- **Co-presence invariant (binding atomicity — enforce + test):** the four binding fields are
  **all-present-or-all-absent.** `snapshotId` present ⟺ `candidateId`/`baseKey`/`fullSignature` all present (a
  snapshot-bound row); all four null ⟺ a pre-M5 legacy row. A partial row (e.g. `snapshotId` without
  `candidateId`, or `candidateId` without the server-re-read keys) is **invalid** — it would poison the live
  affinity/cooldown projections that read these fields. Enforced by a Mongoose `pre('validate')` guard + an S9
  test (§14 C1).

### 9.3 H19 shown-history reducer — contract in spec §15.1 (M5 implements)

The deterministic reducer is single-homed in **spec §15.1**: read the user's most-recent
`REPETITION_WINDOW_SNAPSHOTS` (=20) snapshots **with `nSurfaced > 0`** by `{user:1, createdAt:-1, _id:-1}`
(the `_id` tie-break makes same-`createdAt` order deterministic) under a bounded scan cap, walk
`shownFullSignatures` most-recent-first, dedup keeping the first occurrence, truncate to the shipped
`REPETITION_WINDOW_SIZE` (=10), return an **ordered `Sequence[str]`**. Count-based, cross-intent;
empty/failed renders never consume the window. S4 fixed the contract; M5 implements + tunes the numbers.

### 9.5 OQ4 — authenticity gate M4/M5 split

M4 defines the **full contract** (spec §16: exists ∧ owned ∧ membership ∧ items⊆candidate, bound via
`{snapshotId,candidateId}`, server-re-read keys/items) and adds the binding **fields** (§9.1). **The gate
*functions* (existence/ownership/content-key + the live `{snapshotId,candidateId}` echo + the "actually-shown"
membership check) are M5** (§14 C7 — building fixture-only stubs the live route would rewrite is busy-work).
**Trap-guard: the membership ("actually-shown") check is M5, never M4** — M4 has no live route to attack. The
server re-reads keys/items from the immutable snapshot, never the client echo (the security spine, H10).

### 9.7 Trap-guard — reducer output type + signature cap (source-verified)

The reducer output is an **ordered `Sequence[str]`/`tuple`, NOT a frozenset** (`ranker.py:191`/`:247` — it is
a recency-faithful window, deliberately distinct from the frozenset `liked_full_signatures:190`), and the sig
cap **reuses the shipped `REPETITION_WINDOW_SIZE = 10`** (`config.py:64`), **never a new 200 cap** (which would
contradict the shipped ≤10 M3 contract = a code↔spec conflict). Mandated by "don't reopen the closed M3
contract." Only `REPETITION_WINDOW_SNAPSHOTS = 20` is a new constant (Appendix B, M5-tunable).

---

## 10. `clothingType`→5 + the canonical classification rule (CLOSED)

The DB wipe + the W-track data-path pull-forward (CV writes `clothingType` natively at upload) **deletes the
backfill** as a separate workstream; the §10.3 rule survives as the **ingestion classifier** (CV's keyword
fallback) + a fixture-mode test tool. Canonical decision single-homed into spec **§6.1**; this holds the
classification mechanics + trap-guards. The deployed enum extension is exactly
`["top","bottom","dress","outer_layer","shoes"]` (underscore `outer_layer` = `models.py` member-name = wire
value, no translation table).

### 10.2 THE design call — ambiguous-row fallback = **default-to-top** (locked)

When the canonical classifier matches none of the 5 buckets (a genuinely out-of-ontology row — scarf, belt,
empty/garbage `category`), the backfill writes **`clothingType = "top"`**.

**Reasoned from the promise (determinism/consistency) + first principles.** `clothingType` is the sampler's
partition key (the closed M1 sampler partitions the wardrobe into the 5 `ItemType` buckets; the validator's
template rules depend on it). The three candidate fallbacks fail differently:
- **default-to-top (CHOSEN):** every row always carries a valid `ItemType` → zero impact on the closed
  sampler; deployed parity (site #1); deterministic. The guess is **not laundered into apparent truth** — the
  mandated D3 dry-run/report lists every default-branch row, so it is inspectable (posture rule 2: a draft,
  surfaced); raw is preserved → re-run fixes it; durable per-field review is the W-track's existing
  `needs_review` + per-field-confidence seam (§18), not an M4 field. An out-of-ontology item is at worst a
  provisional, reported, reversible "top."
- **null + downstream (rejected):** "honest," but the closed M1 sampler partitions on the 5-value enum with
  **no null member** → forces a closed-contract change or a new adapter path (heavier than S5-LIGHT,
  trap-guard territory), and a null item is **silently dropped from candidacy** (upload it, it never appears)
  — a worse rule-2 violation than a reported guess.
- **new M4 review-flag field (rejected):** durable, but **redundant** — §18 already owns `needs_review` +
  per-field confidence, new ingestion writes `clothingType` natively with confidence, and historical rows are
  re-derivable (raw preserved). The only consumer is W-track → minting it in M4 buys nothing re-derivation
  doesn't.

default-to-top **strictly dominates** null on the promise (always-valid partition, no closed-contract reopen,
no silent drop) and dominates the new-field option on leanness (the report + the W-track seam already deliver
the inspectability/durability).

### 10.3 The canonical backfill classifier (deliverable 2)

One ordered first-match cascade, reconciling both sites; reads the **superset** of signals (`category` +
`name` + `subCategory`, plus `layerRole` for the outer short-circuit). Keyword lists are **seeded from the
union of the two deployed sites**, with one deliberate adjustment — the mid-layer knits (cardigan/hoodie/
fleece/vest) are routed to `top`, **not** `outer_layer`, per the collapse rule below (so `outer_layer` drops
cardigan/hoodie that site #1 had, and `top` gains them) — and are **provisional + S9-tunable over fixtures**:

| Order | Bucket (`ItemType`) | Match (any of) |
|---|---|---|
| 1 | `dress` | `category=="one piece"` · `{dress, jumpsuit, romper}` in cat/name/subCat |
| 2 | `bottom` | `category∈{bottom,bottoms}` · `{pants, sweatpants, joggers, snowpants, jeggings, jeans, shorts, skirt, trousers, chinos, leggings}` |
| 3 | `shoes` | `category=="footwear"` · `{shoes, sneakers, boots, sandals, loafers, heels, flats}` |
| 4 | `outer_layer` | **`layerRole=="outer"`** · `{jacket, coat, raincoat, trenchcoat, blazer, parka, puffer, windbreaker, trench, overcoat}` |
| 5 | `top` | `category∈{top,tops}` · `{shirt, tee, t-shirt, blouse, polo, tank, sweater, henley, button-down, oxford}` + the mid-collapse knits `{cardigan, hoodie, fleece, vest}` |
| 6 | **default → `top`** | none matched → `top`, **listed in the report** (§10.2) |

**The `mid_layer` collapse (the in-ontology decision the divergence forced):** cardigan/hoodie/sweater/fleece/
vest have no v2 type. Rule: **explicit `layerRole=="outer"` wins** (row 4 short-circuits → `outer_layer`);
otherwise the knit collapses to **`top`** (row 5 lists them by name) — a knit worn as the only upper layer is
a valid base top, and `outer_layer` is an *optional* slot, so a misfiled true-outer still yields valid
outfits. This is a deterministic classification rule, not a "fallback."

**Trap-guard — the bare `dress` keyword (row 1) must exclude ADJECTIVAL "dress".** "dress" is both a
one-piece HEAD noun ("wrap dress", "shirt dress") and a common MODIFIER ("dress shoes", "dress shirt",
"dress pants"). A naïve whole-word `dress` match mis-partitions the **"Dress Shoes"** footwear subcategory
(a real upload-form option) as a one-piece. The principle is the **head-noun-last rule of English compounds**:
"dress X" is an X; "X dress" is a dress. The classifier matches `dress`/`dresses` as a one-piece only when it
is **not immediately followed by a garment noun**; a head-noun or standalone "dress" — including a
miscategorized "wrap dress" — still classifies as `dress` (preserving "name beats a coarse category").
`jumpsuit`/`romper`/`sundress`/`gown`/`frock` are never adjectival → matched unconditionally (the closed
compound `sundress` also dodges the `\bdress\b` boundary, like the bottoms rung's `sweatpants`). **Do not
"simplify" this back toward a category-authoritative or cascade-reorder rule** — both regress real one-pieces
("shirt dress"/"sweater dress" → top). The modifier noun set is **derived from the rung keyword arrays**
(`SHOE_KEYWORDS`/`BOTTOM_KEYWORDS`/`OUTER_KEYWORDS`) so it cannot drift out of sync; a drift-guard test
(`deriveWarmth.test.ts`) iterates those arrays asserting `"dress <rung-noun>" ≠ dress`. (`lib/clothingType.ts`
`ADJECTIVAL_DRESS`.)

**Trap-guard — re-derive from raw, never trust the stored `clothingType`.** `WardrobeItem.ts:7` defaults
**every** existing row to `"top"`, so a stored `"top"` is the schema default, not evidence. The classifier
re-derives purely from raw `category`/`name`/`subCategory`/`layerRole`; the only legacy non-default value
possible (`"bottom"`, the sole other enum member) is consistent with re-derivation anyway. This makes the
backfill **idempotent** (pure function of raw → same output on re-run) and **raw-preserving** (never writes
over `category`/`name`/`subCategory`). The dry-run/report/verify mode (D3) emits per-bucket counts + the
default-branch row list so the output is inspectable on fixtures.

**Home: TS** — the classifier writes the `WardrobeItem.clothingType` Mongoose field, so it lives in the Next
backfill (and is the legacy fallback the W-track ingestion reuses); **Python never classifies** — the
substrate consumes the already-typed `type` field. Test home + the no-drift argument: §14 C2.

### 10.4 `wardrobeVersion` field-add

Persisted **field only** — home = `User.wardrobeVersion: int` (default 0, monotonic; canonical in spec §6.3).
**Missing-user coalesce `user.wardrobeVersion ?? 0`** at snapshot-write / adapter read — no backfill pass (the
target is effectively empty). **The bump trigger / activation transition stays W-track/H6 — M4 stores the
field only**, never names the bump. No new review/confidence field (the W-track owns `needs_review` +
per-field confidence, §18); no `ItemAffinity.ts` (§7.3).

---

## 11. Feedback authenticity (trap-guards)

Canonical decisions single-homed into spec §16 (dedup rule + scope vocab) + §6.6 (the additive fields) +
Appendix B (`FEEDBACK_DEDUP_WINDOW`) + §23 (H11/H37). The action-enum extension
(`planned`/`packed`/`corrected`, additive — no existing value renamed/removed) lands at C1; the live route
writes only `accepted`/`rejected` today, M5 wires the new actions. No one-way door — the interaction log stays
append-only, so any dedup rule re-derives by re-projection.

### 11.1 H11 duplicate-feedback dedup — read-time reducer, append-only writes

Canonical rule = spec §16 + Appendix B `FEEDBACK_DEDUP_WINDOW`. Affinity is never stored; the M5 adapter folds
append-only rows into the ranker's three signals (`ranker.py:188`) — `liked_full_signatures` (frozenset,
idempotent), the cooldown buffer (recency, idempotent), and the **counted** `item_affinity` (the one shape
that double-counts). **Decision: dedup the counted `item_affinity` by `{snapshotId, candidateId, action}`
within the window** (set/recency projections need no dedup); same-key rows *outside* the window are genuine
repeat-events and each count. **Trap-guard: a write-path unique index / upsert is REJECTED** — it forecloses
append-only events, repeats the §8.8 unique-index trap, and wrongly rejects a genuine **repeat-wear** (which
shares `{snapshotId,candidateId,action}`), flattening the rotation signal the dive most wants; retry-vs-repeat
is a time/idempotency distinction, not a binding one (`action` keeps `saved`/`worn`/`rated` distinct).
Concurrent writes are a non-problem (two appends; the next projection collapses them — no read-modify-write
counter to race). Reversible; the retry-vs-repeat form (client token vs bounded time window) → M5.

### 11.4 H37 scope vocab — split `scopeTarget` + `learningDisposition`

Two additive **nullable** fields on `OutfitInteraction`; behavior `[STAGED]` (canonical: spec §16/§6.6):
- `scopeTarget` ∈ `outfit | board | routine | global | lens` — *where* feedback attaches (`lens` also carries
  H24's default-lens).
- `learningDisposition` ∈ `normal | exception | do_not_learn` — *how* it is treated (`exception` = the §16
  soft exception for weather-forced/laundry/travel/illness; `do_not_learn` = the early "do not learn from
  this" control).

**Why split (not one merged enum):** disposition is orthogonal to target — a weather-forced dislike is
`scopeTarget=outfit` **and** `learningDisposition=exception`; a merged `{outfit,…,exception}` forces a false
"exception of what?" and would need the disposition axis added later anyway (additive-once, posture rule 1).

---

## 12. Reconcile with reality (CLOSED)

### 12.3 Sequencing + migrate-vs-delete

**No M4↔M5 ordering hazard:** M4b ships dormant; M4a ships the live data-path changes; neither blocks M5,
which deploys the service, flips `USE_ML_SHORTLISTER`, and does the live snapshot write + adapter. The
**deletion license is M5/M6, not M4** — M4 only *registers* what M5/M6 delete: `PreferenceSummary` + the
legacy preference-prose adapter (spec §19) and the four dresses string-match sites (§19). The warmth
keyword-map mechanic relocated from the adapter to **C2 ingestion**; the adapter is a pure passthrough (spec
§15.2).

---

## 13. Consolidation pass — superseded by §14

S10 alignment + S11 design-freeze passed: the M4 design coheres with the M0–M3 substrate, Spearhead, and the
spec — `engineVisible` names match `fitted_core.WardrobeItem`; the compute-live affinity projection + the H19
reducer feed exactly the pre-reduced `RankContext` signals (`ranker.py:188` — never raw `OutfitInteraction`,
already windowed); no closed contract reopened. The **no-live-route invariant applies to M4b only**; the
`> COMPLETED` retirement header lands post-implementation (the plan stays active through the C-ladder build).

---

## 14. Post-design-freeze scope expansion + C1–C8 ladder (2026-06-26)

Pre-implementation audit (multiple rounds of parallel subagents across plan, spec, and codebase) surfaced
gaps the S1–S13 design didn't see. Eight decisions resolved in a first pass; later adversarial rounds caught
a load-bearing false premise (CV does not produce the new fields), doc-consistency drift, and an over-scope
(three unfillable columns + premature cascade/gate work), all resolved in follow-up passes. **The S9
obligation lists (the per-session S9 obligation lists) are superseded by the C1–C8 ladder below** — where any older
session text (any earlier session body or the §16 spec contract) still says "backfill" / "fixtures-only" /
"no live route" / "warmth derived in the adapter" / "**M4 implements the authenticity-gate functions**" /
"M4 persists `material`/`formality`/`styleTags` columns" / "M4 wires snapshot redaction", **§14 wins** (those
are pre-trim; the authenticity-gate functions, the three soft columns, and the redaction-cascade wiring are
all out of M4 — see decisions #1/#6 + C7).

**M4 is split into two sub-milestones (decided 2026-06-26):**
- **M4a — the data path (C1–C3): ships partly live.** Wipe, ingestion rebuild, PreferenceSummary rip.
  These change the running app; verify by re-uploading a wardrobe. This **breaks the old "M4 touches no
  live route" invariant** (§7.1/§12.3/§13) — that invariant now applies **only to M4b**.
- **M4b — the snapshot substrate (C4–C8): ships dormant.** Version constants, the GenerationSnapshot
  model + Python trace layer, cascade + gate. Pure additive; nothing calls it until M5. This is M4 as
  originally scoped.

Land M4a first (stabilize the live changes), then M4b. The ladder already cleaves cleanly — C3 has no
dependency on C1/C2, and C4 is pure Python independent of all TS work.

### 14.1 Resolved decisions (the post-freeze deltas)

| # | Decision | Effect on M4 scope |
|---|---|---|
| 1 | **Persist only the `warmth` column** (`fitted_core` requires it non-null; `models.py:116/132`), keyword-derived at ingestion. **SCOPE-TRIMMED 2026-06-26 (audit round 3):** `material`/`formality`/`styleTags` are **deferred to the W-track** — the engine treats them optional (`models.py:121-122`), today's CV produces none, and nothing reads them before the W-track CV; they ship with that CV + the review form as one unit. The snapshot `engineVisible` contract keeps all three field-slots (adapter emits `null`/`[]`). | C1 adds only the `warmth` column + the `clothingType` widen; C2 drops the soft-field plumbing; §15.2 adapter emits `null`/`[]` for the three deferred fields |
| 2 | **Rip top/bottom-only ingestion now** | Kill `wardrobe/route.ts:149` create-coerce + the edit-coerce at `wardrobe/[id]/route.ts:75-77` (+ `:54`/`:102`) + the `"top" \| "bottom"` typing in `wardrobe/page.tsx:14` + the GET response type at `wardrobe/route.ts:61` (mapped `:87`); widen to the 5-value enum end-to-end |
| 3 | **Rip PreferenceSummary wholesale** | Delete the collection + summarize endpoint + `/account` UI section + `runPersonalizationSummarize` + the calls from `recommend/route.ts` (def `:294`, call `:436`) and `regenerate/route.ts` (def `:283`, call `:411`); plus `db.ts`/`gemini.ts`/dashboard consumers + 5 test files (C3 has the full list) |
| 4 | **Write the C1–Cn ladder before any code** | §14.2 below; supersedes the scattered S9 obligation lists |
| 5 | **Wipe the Mongo collections** (`wardrobeitems` + `outfitinteractions` + `preferencesummaries`) | No backfill classifier needed; §9.1 co-presence guard runs strict from row 0; the §10 standalone backfill harness collapses out (§10 is now the ingestion classification rule, used by CV, not a separate workstream) |
| 6 | **Cascade — trimmed (audit round 3).** `User.ts:33-34` (the two `deleteMany` lines in the `:27` hook) also gains a **hard-delete of `wardrobeimages`** (closes H14's cascade arm). The **GenerationSnapshot redaction-cascade wiring is DEFERRED to the Privacy `[STAGED]` milestone** (transaction-threading a session-less hook for data that doesn't exist on a no-users fork is premature); M4 only **reserves** the redaction schema fields (free in C5). | C7 slims to the `wardrobeimages` arm + the reserved seam; spec §22/§23-H43 reverted to SEAM-RESERVED |
| 7 | **W-track scope.** Only `warmth` + the `clothingType` widen pull into M4 (the engine-required minimum). `material`/`formality`/`styleTags` **columns** + CV fill + review surface stay a coherent W-track unit; async queue / item-state machine also W-track (§18). | C1/C2 add only `warmth` + the enum widen |
| 8 | **Recommend routes — surgical PreferenceSummary excision** | Delete only the `getOrRefreshPreferenceSummary` calls in M4; the full route rewrite stays in M5 behind `USE_ML_SHORTLISTER` |

### 14.2 The C1–C8 implementation ladder

Ordered + dependency-tracked. Each checkpoint = a coherent commit (or short series), acceptance criteria,
and a test plan. **Run C1 → C8 in order**; the dependency notes flag what genuinely blocks vs what could
parallelize. **C1–C3 = M4a (ships partly live); C4–C8 = M4b (dormant substrate).**

> **Index mechanism (applies to C1 + C5).** The codebase already auto-builds indexes: `mongodb.ts` sets
> `autoIndex:true` and `db.ts` calls `Model.init()` per model at connect. So every index declared below
> builds automatically on first boot against the wiped/empty DB — **no migration script.** The only
> obligation is to **register each new/changed model in `db.ts`'s init list** (C5 must add
> `GenerationSnapshot` there, or its indexes + immutability guard never load). (Production note: autoIndex
> should be turned off on the always-on M5 service later — an M5 concern.)

---

### M4a — data path (C1–C3, ships partly live)

#### C1 — DB wipe + schema scaffolding (TS)
**Touches:** `WardrobeItem.ts`, `OutfitInteraction.ts`, `User.ts`. Drop existing collections (a one-shot
script committed to `fitted/scripts/` so it's re-runnable on Brian's local Mongo). Then:
- `WardrobeItem.clothingType` enum → `["top","bottom","dress","outer_layer","shoes"]`; keep `default:"top"`.
- `WardrobeItem` new column: **`warmth:int (required, 0..10)` — the ONLY new data column** (`fitted_core`
  requires it). `material`/`formality`/`styleTags` columns are **deferred to the W-track** (decision #1/#7) —
  do **not** add them here.
- `User.wardrobeVersion:int (default 0, monotonic)`. Missing-user coalesce: `user.wardrobeVersion ?? 0`.
- `OutfitInteraction.action` enum += `planned`/`packed`/`corrected`.
- `OutfitInteraction` binding fields: `snapshotId:ObjectId?`, `candidateId:string?`, `baseKey:string?`,
  `fullSignature:string?` (all nullable; `pre('validate')` co-presence guard — all-present-or-all-absent).
- `OutfitInteraction` scope-vocab fields: `scopeTarget:enum?[outfit/board/routine/global/lens]`,
  `learningDisposition:enum?[normal/exception/do_not_learn]` (both nullable; behavior `[STAGED]`).
- **`OutfitInteraction` binding index** `{ snapshotId:1, candidateId:1 }` (snapshot→feedback
  joins for M6 training reads). Additive; builds via autoIndex. *(This was homeless in the first ladder
  draft — it lives here, not C5, since it's an `OutfitInteraction` index.)*
- **Wipe-script safety gate (mandatory).** The wipe script can destroy real data: the reused CS148
  `.env.local` `MONGODB_URI` may point at the **shared team Atlas cluster** the deployed team app uses.
  Triple-gate: (a) require an explicit `--yes-wipe` flag; (b) refuse unless the connection **HOST** matches a
  localhost/`fitted-dev` allowlist regex **or** `FITTED_ALLOW_WIPE=1` is set; (c) print the target host +
  per-collection doc-counts and require typed confirmation of the DB name.
  - **Trap-guard (host, not db name):** authorize on the **host only** — the db NAME must NOT count, or a
    `fitted-dev`-named database on the shared team Atlas host would self-authorize the very wipe the gate
    exists to refuse. A genuine dev Atlas cluster is allowed via a `fitted-dev`-labelled host or the explicit
    `FITTED_ALLOW_WIPE=1` override. Gate (c) confirms the **actually-connected** `db.databaseName` (not the
    URI-parsed path — a path-less URI connects to Mongo's default db, which would otherwise diverge).

**Acceptance:** jest tests for every new field's validation (enum acceptance/rejection; required-field
rejection; co-presence guard rejects partial rows AND accepts all-absent legacy/empty rows; coalesce
defaults to 0); binding index present. The wipe script is idempotent (running it twice = no error) and
refuses to run against a non-allowlisted URI without the override. Closed M3/Spearhead pytest suites still
green (no fitted_core change).

**Dependencies:** none. Lands first.

---

#### C2 — Ingestion rebuild (data-path; TS)
**Touches:** `app/api/wardrobe/route.ts`, `app/api/wardrobe/[id]/route.ts` (the **edit** path), the upload
form / `app/(app)/wardrobe/page.tsx`, `lib/cvToWardrobeForm.ts`. Goal: create AND edit write a row with the
5-value `clothingType` + a valid `warmth` + the reserved soft fields.

> **CV reality + trimmed scope.** Today's CV (`cv/infer` → HF Space, mapped by `cvToWardrobeForm.ts`)
> returns only `category`/`color`/`pattern` — **not** warmth. C2 **derives `warmth` at ingestion**. The
> `material`/`formality`/`styleTags` columns are **deferred to the W-track** (decision #1) — C2 does not touch
> them; the M5 adapter emits `null`/`[]` for them.

- Delete the top/bottom coerce at `wardrobe/route.ts:149`; accept the full 5-value enum from the request body.
- **Second coerce site (don't miss it):** `wardrobe/[id]/route.ts:75-77` has the identical coerce on item
  **edit**, plus the editable-field list (`:54`) and response default (`:102`). Widen all three, or editing
  an item's type silently reverts it — the 5-value enum must survive an edit round-trip.
- Widen the client type at `wardrobe/page.tsx:14` and the GET response **type at `wardrobe/route.ts:61`**
  (field mapped at `:87`; `:172` is the POST response default — widen it too).
- `warmth`: **keyword-derive at ingestion** from `category`/`subCategory`/`name`. **This is net-new TS
  authorship** — there is no warmth keyword map in the codebase today (the Python `_warmth_band` only *bins*
  an existing 0–10 int; it does not map "parka"→8). Seed the garment→warmth map from the existing
  string-match precedent (`recommend/route.ts:179,237` has the `["parka","puffer","wool",…]` lists) but
  budget it as new work — "airtight" means "always writes a valid 0..10," not "free." Runs whenever CV omits
  warmth (today: always).

**Acceptance:** jest over POST **and** edit fixtures: dress/jumpsuit/romper → `dress`; a knit with
`layerRole=="outer"` → `outer_layer`; out-of-ontology → `top`; warmth always 0..10; an edit to
`clothingType=dress` persists `dress` (not coerced). **A thin jest integration test on the rebuilt POST**
(fixture body → row has a valid 5-value `clothingType` + a 0..10 warmth) — the one automated guard on the
live data path. Manual e2e: Brian re-uploads a test wardrobe and confirms every row has a valid
`clothingType` + warmth.

**Dependencies:** C1 (the `warmth` column + enum widen must exist).

---

#### C3 — PreferenceSummary rip (TS)
**The consumer graph is wider than the first draft listed** (audit-verified). Full touch set:
- **Delete:** `models/PreferenceSummary.ts`, `app/api/preferences/summarize/route.ts`,
  `lib/runPersonalizationSummary.ts`. Drop the `preferencesummaries` collection (C1's wipe does this).
- **`lib/db.ts`** (`:7` import, `:20` `.init()`, `:23` return from `initDatabase()`) — remove the model from
  the registration + return shape; **verify no route destructures `PreferenceSummary` from `initDatabase()`**
  before changing the return.
- **`lib/gemini.ts`** (`:30` `isValidPreferenceSummary`, `:98` `generatePersonalizationSummary`) — the
  helpers `runPersonalizationSummary` depends on; delete them (and any now-dead imports).
- **`app/(app)/account/page.tsx`** — remove the PreferenceSummary UI section + **all three summarize fetches
  (`:93`, `:197`, `:228`)**, not just the `:88` read.
- **`app/(app)/dashboard/page.tsx`** (`:671`, `:681`) — fetches `/api/preferences/summarize`. Since C3
  deletes that endpoint at M4 but §19 keeps `dashboard` until the M5 cutover, **remove the dashboard fetch in
  C3** (it's dead UI deleted at M5 anyway) so it doesn't 404 in the M4→M5 window.
- **`recommend/route.ts`** (`getOrRefreshPreferenceSummary` def `:294`, call site **`:436`**) +
  **`regenerate/route.ts`** (def `:283`, call site **`:411`**) — excise the helper **and its call** (delete
  the def alone and the call dangles → build break). Leave the rest of those routes intact (full rewrite is
  M5). *(Symbol note: the file `lib/runPersonalizationSummary.ts` exports `runPersonalizationSummarize` —
  mind the `-ize`; the recommend routes import that name.)*
- **`CLAUDE.md:73`** — the "Mongo schemas" list names `PreferenceSummary`; drop it (and optionally add
  `GenerationSnapshot`) in this commit, since C3 deletes the model file.
- **5 jest suites** reference it: `summaryRefreshThreshold.test.ts` + `geminiUtils.test.ts` are *entirely*
  about this feature (delete them); `recommendationStability.test.ts`, `regenerateExclusion.test.ts`,
  `endToEndRecommendationFlow.test.ts` mock it (remove the mocks).

**Acceptance:** `grep -rn "PreferenceSummary\|runPersonalizationSummary\|getOrRefreshPreferenceSummary\|
generatePersonalizationSummary" fitted/` returns zero hits in source **and tests**. `/account` + `/dashboard`
still render (minus the summary). Legacy recommend/regenerate still respond 200. **`npm run build` + `npm run
lint` + `npm test` all clean** (the first draft's gate omitted `npm test`, which would have failed on the 5
suites).

**Dependencies:** none file-wise (independent of C1/C2; C1's wipe handles the collection drop).

---

### M4b — snapshot substrate (C4–C8, ships dormant)

> The "M4 touches no live route / ships nothing runnable" invariant (§7.1/§12.3/§13) applies **here** — C4–C8
> are pure additive substrate; nothing calls them until M5.

#### C4 — fitted_core version constants + serializer module
**Touches:** `ml-system/fitted_core/__init__.py`, `ml-system/fitted_core/config.py`, new
`ml-system/fitted_core/snapshot_serde.py`. Goal: the cross-language wire layer the §15.1 contract needs.
- Add `fitted_core.__version__` (e.g. `"0.4.0"`); `promptVersion` constant (tags the §D prompt builder);
  `rankerConfigVersion` = sha256 over the Appendix B constants (computed at module load).
- **Versioning policy (document as a comment in `__init__.py`; this is M6 training-provenance):**
  `__version__` = **semver, hand-bumped** on any behavioral substrate change (sampler/validator/ranker/prompt
  *logic*) — coarse, release-grained. `rankerConfigVersion` = **auto** sha256 over Appendix B, so a
  one-constant tuning change `__version__` would miss is still caught. `promptVersion` = its own string,
  bumped on **any** prompt-text edit (a reword changes generations even with no code change). Failure mode is
  silent (forget to bump → two behaviorally-different corpora share a version → M6 can't separate them), so
  the comment is the guardrail.
- `snapshot_serde.py`: snake↔camel field-name maps for `engineVisible` (`style_tags`↔`styleTags`,
  `color_tags`↔`colorTags`, `occasion_tags`↔`occasionTags`, **plus the partition-key rename
  `type`↔`clothingType`** — a name change a generic snake→camel will NOT produce, value = the `ItemType`
  member's string (member names = wire values, §15.2) — and `image_url`↔`imageUrl`); a `to_wire()` /
  `from_wire()` pair that enforces finite floats only (raises on `NaN`/`Infinity`), opaque-string ids
  (rejects ObjectIds at the Python boundary), no `undefined`.

**Acceptance:** pytest round-trip — a synthetic payload survives `to_wire()`→JSON→`from_wire()` byte-equal
(modulo float canonical form). Rejection tests: a `NaN` raises; a non-string itemId raises. Version-constant
presence test: `fitted_core.__version__` is a non-empty semver-ish string; `rankerConfigVersion` is stable
across runs but changes when an Appendix B constant moves.

**Dependencies:** none (pure Python, independent of TS work).

---

#### C5 — GenerationSnapshot model + immutability + indexes + BSON guard (TS)
**Touches:** new `fitted/models/GenerationSnapshot.ts`, `fitted/lib/db.ts` (model registration). Implement
the §8.3 Mongoose sketch verbatim (with the §15.1 wins on any disagreement):
- Sub-schemas with `_id:false`; field groups A–K per §8.2.
- **`itemSnapshot.cvModelVersion?`** (nullable, default null) — the data-path provenance seam (§15.1),
  forward-looking: once the W-track CV writes `engineVisible` features (warmth/material/formality/styleTags),
  a CV change drifts their meaning. Null at M4 (warmth is keyword-derived, not CV-written; the others aren't
  written yet), wired at the W-track CV. Cheap to reserve now, expensive to retrofit post-corpus.
- `pre(['updateOne','findOneAndUpdate','save'])` guard: rejects any update that touches a non-redaction
  field. Whitelist = `{redacted, redactedAt, redactionReason}` only.
- **Register `GenerationSnapshot` in `db.ts`'s import + `.init()` list** (the §8.3 sketch routed this to M5,
  but registering an unused model is inert — and without it the autoIndex + immutability guard never load, so
  the C5 index-presence test couldn't pass). M4 ships it dormant; M5 wires the live write. *(Supersedes the
  §8.3 "db.ts registration → M5" note.)*
- Apply the §8.8 index plan via autoIndex (see the §14.2 index-mechanism note): `{user, createdAt:-1}`,
  `{user, candidateCacheKey, generationIndex}` (**non-unique**, per the Fable/Codex demotion),
  `{user, shownFullSignatures:1, createdAt:-1}` (multikey), `{redacted, createdAt}`, `{user, redacted}`.
- Raw-payload caps: byte cap + hash + truncation flag on every raw field (`rawText`/`rawEmitted`/
  `rawAttributes`). No image/base64/blob bytes ever stored.
- **BSON-size guard test (jest):** worst-case fixture (135 itemSnapshots × ~500 B + 40 candidates ×
  ~700 B + max-raw payloads at cap) serializes under 16 MB with margin. Locks OQ1.

**Acceptance:** jest schema/validation tests; immutability guard test (a non-redaction update rejected; a
redaction update accepted); index presence test (model registered in `db.ts`, indexes built); BSON-size guard
test passes.

**Dependencies:** C1 (for the cross-model context — the binding fields on `OutfitInteraction` are now
present so the snapshot↔interaction join is well-defined). C4 (for `rankerConfigVersion` which the snapshot
stores).

---

#### C6 — fitted_core snapshot payload + trace wrappers
**Touches:** new `ml-system/fitted_core/snapshot.py`, additions to `rescue.py`/`ranker.py`/`response.py`/
`validator.py`. The §8.4 Option-B mechanism:
- `GenerationSnapshotPayload` frozen dataclass = §8.2-A/B/C/E/F/G + each item's `engineVisible`
  (snake_case). Fields are non-optional where §15.1 says "required, non-null on every live write".
- `rescue_with_trace()`, `rank_with_audit()`, `build_variants_with_trace()`,
  `validate_gpt_payload_with_trace()` siblings. The original closed signatures **must** stay byte-stable
  (the existing M3/Spearhead tests must still pass unchanged).
- Python-issued `candidateId` over the full funnel (deterministic ordinal; unique within snapshot;
  includes rejected, scored-but-unshown, non-selected-variant candidates). Lives in `snapshot.py` so it can
  be called from the trace wrappers consistently.
- The content-preservation invariant (§8.2-F): a generated-non-accepted candidate carries
  `{items, slotMap}` reconstructed from `sourceIndex` or `rawEmitted`.
- **Diagnostics population (explicit deliverable — don't let it ride "field group G").** Map
  `SamplerResult`/`RankerResult`/`RescueResult`/parse flags + the rejection/warning histograms into the
  snapshot `diagnostics{}` (§8.2-G / §8.3). This is the only §15.1 field group with no other build step; name
  it here so it isn't assumed.

**Acceptance:** pytest — every existing M3/Spearhead test passes unchanged (the closed contracts are
byte-stable); new trace-wrapper tests confirm the three discard sites are captured (a fixture with
accepted + rejected + rescue-dropped + ranker-dropped + non-selected-variant + shown proves it);
`candidateId` deterministic across a permuted-input case; content-preservation invariant enforced (a bare
`{candidateId, rejectionCodes}` builder call raises); **`diagnostics{}` populated from the result objects**
(the fixture asserts per-type sampler results + ranker/rescue flags + histograms land). A builder-drift test: `engineVisible` equals the projection the payload builder emitted (in dormant M4b there is no
live "send" — "the projection" = what the builder serialized from the in-memory `WardrobeItem`), and an item
edit/delete after the payload is built does not alter the already-built `itemSnapshot`.

**Dependencies:** C4 (version constants + serializer).

---

#### C7 — `wardrobeimages` cascade (the cheap H14 arm)
**Touches:** `fitted/models/User.ts`. **Trimmed by audit round 3** — only the cheap, no-transaction arm
lands in M4.
- Extend `User.ts` cascade hook (the `deleteMany` lines at `:33-34`, inside the `pre(['deleteOne',
  'findOneAndDelete'])` query hook at `:27`): on user delete, also **hard-delete `wardrobeimages`** rows. Closes
  H14's cascade arm; cheap (one more `deleteMany`, no transaction).
  - **Trap-guard (two invocation paths):** `lib/db.ts:61 deleteUserWithData` calls `User.deleteOne`, so the
    hook fires there too — verify the cascade covers both that path and any direct `User.deleteOne`.
- **DEFERRED (not M4):** the **GenerationSnapshot redaction-cascade wiring** → Privacy `[STAGED]` (the
  `updateMany` that nulls PII + the session/transaction threading; premature with zero users — §23-H43). The
  **authenticity-gate functions** (existence/ownership/content-key) → M5, where the live route makes them
  testable for real (they'd be rewritten the moment the live `{snapshotId,candidateId}` echo + membership
  check land — OQ4). M4 keeps only the §16 *contract* + the reserved redaction schema fields (in C5).

**Acceptance:** jest — a user delete hard-deletes their `wardrobeimages` (via both `User.deleteOne` and
`deleteUserWithData`); existing `wardrobeitems`/`outfitinteractions` cascade unchanged.

**Dependencies:** none hard (C5 only if you want to assert snapshots are *left intact* by the delete — an
optional regression test that the un-wired redaction seam isn't accidentally cascaded).

---

#### C8 — End-to-end fixture verification + M5 handoff doc
**Touches:** new `ml-system/tests/test_m4_e2e_fixture.py` (or wherever the existing pytest suite lives), a
short M5-handoff note at the bottom of this plan.
- **One integration test exercising the seam:** seeded `WardrobeItem` rows (post-C2 shape, with
  keyword-derived warmth) → a Python pipeline run that builds a `GenerationSnapshotPayload` (post-C6) →
  serialized through `snapshot_serde` (post-C4) → a hand-loaded `GenerationSnapshot` doc in jest's test DB →
  an `OutfitInteraction` row carrying the `{snapshotId, candidateId}` binding fields (post-C1) that
  round-trips back to the snapshot's keys. No live route, **no authenticity gate** (that's M5 now — §C7); the
  test proves the *data contract* composes end-to-end (payload → serde → doc → binding), which is what M5
  inherits.
- **M5 handoff note (appended to this plan):** what state M5 inherits (DB has X collections, Y indexes; TS
  exports model Z; fitted_core exports module W); what M5 owns (live route wiring, actually-shown
  membership, `{snapshotId,candidateId}` echo, dedup window tuning, recommend/regenerate rewrite,
  `USE_ML_SHORTLISTER` cutover).

**Acceptance:** the integration test passes. The handoff note is concrete (file paths + symbol names),
not vibes.

**Dependencies:** all prior checkpoints.

---

### 14.3 What collapses out (no longer M4 work)

- **§10 backfill workstream as a separate effort.** The §10.3 classification rule survives as the
  ingestion classifier (C2); the dry-run/report harness becomes a fixture-mode tool only.
- **§15.2 warmth derivation table.** Adapter is pure passthrough post-C2.
- **The "two divergent classifiers" diagnosis** is a trap-guard, not work — don't re-introduce divergent
  string-match sites in any future rewrite.
- **§9.1 "all-four-absent" legacy allowance** — the DB wipe means there are no legacy rows; the
  co-presence guard runs strict from row 0.
- **The four request-time grep sites in recommend/regenerate** — they survive M4 (only PreferenceSummary
  calls are excised), and are deleted at the M5 cutover as part of the wholesale route rewrite (§19).
- **Deferred by audit round 3 (out of M4, not lost):**
  - **`material`/`formality`/`styleTags` columns** → W-track, shipped with their CV + review surface as one
    unit (engine treats them optional; nothing reads them pre-CV; the snapshot contract reserves the slots).
  - **GenerationSnapshot redaction-cascade wiring** → Privacy `[STAGED]` (transaction work for zero users);
    M4 reserves the schema seam only.
  - **Authenticity-gate functions (existence/ownership/content-key)** → M5 (rewritten once the live route
    exists; M4 keeps the §16 contract). C7 shrinks to the `wardrobeimages` arm.

### 14.4 Holes touched / closed

- **H43 (cascade + redaction):** stays **SEAM-RESERVED (M4)** → redaction-wiring + retention
  `DEFERRED-Privacy[STAGED]`. M4 reserves the schema fields + closes H14's `wardrobeimages` arm but does
  **not** wire snapshot redaction (audit round 3: premature with zero users). Spec §23-H43 updated.
- **H14 (cascade arm):** `wardrobeimages` now in cascade (C7); image-replacement delete-before-commit
  ordering bug stays W-track.
- **No new hole.** The deferred columns + the deferred redaction/gate are by-design scope trims (decisions
  #1/#6/#7), each routed to an owning milestone — not gaps.

### 14.5 M5 handoff (M4b complete)

Concrete state M5 inherits and owns, after C1–C8. The full data contract is proven to compose end-to-end by
`ml-system/tests/test_m4_e2e_fixture.py` (Python producer → `snapshot_serde` wire doc → the committed fixture
`ml-system/tests/fixtures/m4b_e2e_snapshot.json` + the binding round-trip) and `fitted/tests/m4bSnapshotContract.test.ts`
(that exact Python wire doc validates against the live C5 model after the M5 merge).

**M5 inherits:**
- **DB:** collections `wardrobeitems` / `outfitinteractions` / `wardrobeimages` / `generationsnapshots`, all
  registered in `lib/db.ts` `initDatabase()` and auto-indexed on first boot (`autoIndex:true`); the dev DB is empty (M4a wipe).
- **TS models:** `models/GenerationSnapshot.ts` — immutable record + §8.8 indexes + the guard exports
  (`nonRedactionUpdatePaths`/`nonRedactionModifiedPaths`/`immutableUpdateGuard`/`immutableSaveGuard`/`immutableReplaceGuard`,
  `GENERATION_SNAPSHOT_MUTABLE_FIELDS`, `RAW_TEXT_CAP_BYTES`/`RAW_EMITTED_CAP_BYTES`/`RAW_ATTRIBUTES_CAP_BYTES`);
  `models/OutfitInteraction.ts` — the `{snapshotId,candidateId,baseKey,fullSignature}` binding fields + the
  `pre('validate')` co-presence guard + the `{snapshotId,candidateId}` join index; `models/User.ts` —
  `cascadeDeleteUserData`.
- **fitted_core:** the provenance constants `__version__`/`PROMPT_VERSION`/`RANKER_CONFIG_VERSION`;
  `snapshot_serde.to_wire`/`from_wire` (the snake↔camel + finite-float + opaque-id wire layer);
  `snapshot.build_snapshot_payload` + `GenerationSnapshotPayload` (the producer half); the Option-B trace siblings
  `rescue_with_trace` / `rank_with_audit` / `build_variants_with_trace` / `validate_gpt_payload_with_trace`.

**M5 owns:**
- The live route rewrite (recommend/regenerate) behind `USE_ML_SHORTLISTER`; the request-adapter normalization (§15.2).
- **The TS merge before insert:** the Python payload authors everything EXCEPT the TS-owned fields. M5 must add
  `user` (ObjectId) + `interactionCountAtRequest` (the Lens field) + `evidence{}` per itemSnapshot + the
  **TS-preallocated `_id`** (= `snapshotId`, allocated *before* the browser response so each shown variant carries
  `(snapshotId, candidateId)`). The C8 jest test asserts that without `user`+`interactionCountAtRequest` the doc is invalid.
- **The live snapshot write** via `.create()` / pre-allocated-`_id` insert — **never `bulkWrite`** (it bypasses the
  immutability middleware) — for every render attempt incl. empty/degraded.
- **The raw-field cap enforcement** at write time (truncate to `RAW_*_CAP_BYTES` + hash + truncation flag; no blobs).
- **The authenticity gate** (§9.5/§16): exists ∧ owned ∧ membership (`candidateId ∈ shownCandidateIds`) ∧
  `perItemFeedback.itemId ⊆` the candidate's items; the live `{snapshotId,candidateId}` echo; the server re-read of
  keys/items from the immutable snapshot (never the client echo).
- **The H19 shown-history reducer** (§9.3/§15.1): read the most-recent `REPETITION_WINDOW_SNAPSHOTS` snapshots with
  `nSurfaced>0` by `{user,createdAt,_id}`, dedup, truncate to `REPETITION_WINDOW_SIZE`; tune the two window constants.
- Turning **autoIndex off** on the always-on M5 service (§14.2 production note).

**Forward-compat notes (not gaps):**
- `diagnostics.samplerPerType` is a serde-**opaque** data-Map: its ItemType keys (incl. `outer_layer`) cross
  verbatim, and so do the value-struct's inner keys (`selection_kind`/`item_count`/…) — they stay **snake_case** on
  the wire. An M6 reader of those value structs must expect snake_case inner keys (the `ranker`/`rescue` diagnostic
  blocks, being non-opaque, are camelCased normally).
- The Privacy `[STAGED]` milestone wires the snapshot redaction cascade + **extends** the guard whitelist to null the
  PII fields (`occasion`/`location`/`weatherRaw`/raw text) while preserving keys/scores/itemSnapshots (§14.4/§23-H43).

