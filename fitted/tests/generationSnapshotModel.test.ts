/**
 * M4b C5 — GenerationSnapshot model: validation, immutability, indexes, BSON-size guard.
 *
 * In-memory only (no DB), matching the repo's model-test style:
 *   - validateSync() exercises required / enum path validators.
 *   - the immutability guard is tested two ways: the exported pure predicates directly,
 *     AND the actual registered pre-hooks fired through Mongoose's Kareem hook runner.
 *   - schema.indexes() asserts the §8.8 index plan is declared.
 *   - BSON.calculateObjectSize proves a worst-case doc (caps applied) stays under 16 MB.
 *
 * Reference: docs/plans/m4-data-model-migration.md §8.3/§8.8 + §14 (C5); spec §15.1.
 */
import mongoose, { Types } from "mongoose";
import GenerationSnapshot, {
  nonRedactionUpdatePaths,
  nonRedactionModifiedPaths,
  immutableUpdateGuard,
  immutableSaveGuard,
  immutableReplaceGuard,
  GENERATION_SNAPSHOT_MUTABLE_FIELDS,
  RAW_TEXT_CAP_BYTES,
  RAW_EMITTED_CAP_BYTES,
  RAW_ATTRIBUTES_CAP_BYTES,
} from "@/models/GenerationSnapshot";

// Measure with mongoose's own BSON so its Types.ObjectId matches the serializer's version.
const calculateObjectSize = mongoose.mongo.BSON.calculateObjectSize;

const oid = () => new Types.ObjectId();

const validBase = () => ({
  user: oid(),
  sessionId: "user-1",
  candidateCacheKey: "ck-1",
  generationIndex: 0,
  intent: "daily",
  occasion: "casual",
  weather: "mild",
  wardrobeVersion: 0,
  interactionCountAtRequest: 0,
  fittedCoreVersion: "0.4.0",
  generator: { provider: "openai", model: "gpt", temperature: 0.7, promptVersion: "spearhead-d.v1" },
  rankerConfigVersion: "deadbeef",
  scorer: { kind: "cold_start", available: true },
  itemSnapshots: [],
  generationAttempts: [],
  candidates: [],
});

// ---------------------------------------------------------------------------
describe("GenerationSnapshot — validation", () => {
  it("a minimal snapshot with empty funnel arrays validates", () => {
    const err = new GenerationSnapshot(validBase()).validateSync();
    expect(err).toBeUndefined();
  });

  it.each([
    "user",
    "sessionId",
    "candidateCacheKey",
    "generationIndex",
    "intent",
    "occasion",
    "weather",
    "wardrobeVersion",
    "interactionCountAtRequest",
    "fittedCoreVersion",
    "rankerConfigVersion",
  ])("requires %s", (path) => {
    const doc = validBase() as Record<string, unknown>;
    delete doc[path];
    const err = new GenerationSnapshot(doc).validateSync();
    expect(err?.errors[path]).toBeDefined();
  });

  it.each(["provider", "model", "temperature", "promptVersion"])(
    "requires generator.%s (full generator is non-null provenance, §15.1/§8.2-C)",
    (sub) => {
      const generator: Record<string, unknown> = {
        provider: "openai",
        model: "gpt",
        temperature: 0.7,
        promptVersion: "spearhead-d.v1",
      };
      delete generator[sub];
      const err = new GenerationSnapshot({ ...validBase(), generator }).validateSync();
      expect(err?.errors[`generator.${sub}`]).toBeDefined();
    },
  );

  it("requires the scorer provenance block (kind + available; §15.1 non-null provenance)", () => {
    const noScorer = validBase() as Record<string, unknown>;
    delete noScorer.scorer;
    expect(new GenerationSnapshot(noScorer).validateSync()?.errors.scorer).toBeDefined();

    const partial = new GenerationSnapshot({ ...validBase(), scorer: { kind: "cold_start" } }).validateSync();
    expect(partial?.errors["scorer.available"]).toBeDefined();

    const badKind = new GenerationSnapshot({
      ...validBase(),
      scorer: { kind: "magic", available: true },
    }).validateSync();
    expect(badKind?.errors["scorer.kind"]).toBeDefined();
  });

  it.each([
    ["intent", "bogus"],
    ["weather", "freezing"],
  ])("rejects an out-of-enum %s", (path, bad) => {
    const err = new GenerationSnapshot({ ...validBase(), [path]: bad }).validateSync();
    expect(err?.errors[path]).toBeDefined();
  });

  it.each(["rescue_item", "outfit_upgrade", "daily", "translate"])("accepts intent=%s", (intent) => {
    const err = new GenerationSnapshot({ ...validBase(), intent }).validateSync();
    expect(err?.errors.intent).toBeUndefined();
  });

  it.each(["hot", "mild", "cold", "indoor", "outdoor"])("accepts weather=%s", (weather) => {
    const err = new GenerationSnapshot({ ...validBase(), weather }).validateSync();
    expect(err?.errors.weather).toBeUndefined();
  });

  it("defaults schemaVersion to 1 and redacted to false", () => {
    const doc = new GenerationSnapshot(validBase());
    expect(doc.schemaVersion).toBe(1);
    expect(doc.redacted).toBe(false);
  });

  it("defaults itemSnapshot.cvModelVersion to null (the W-track provenance seam)", () => {
    const doc = new GenerationSnapshot({
      ...validBase(),
      itemSnapshots: [{ itemId: "i1", engineVisible: { name: "Tee", clothingType: "top", warmth: 4 } }],
    });
    expect(doc.itemSnapshots[0].cvModelVersion).toBeNull();
  });

  it("requires engineVisible.warmth on every itemSnapshot", () => {
    const err = new GenerationSnapshot({
      ...validBase(),
      itemSnapshots: [{ itemId: "i1", engineVisible: { name: "Tee", clothingType: "top" } }],
    }).validateSync();
    expect(err?.errors["itemSnapshots.0.engineVisible.warmth"]).toBeDefined();
  });

  it.each(["generated", "validated", "ranked", "shown"])("accepts candidate stageReached=%s", (stage) => {
    const err = new GenerationSnapshot({
      ...validBase(),
      candidates: [{ candidateId: "c0", sourceAttemptId: "a0", stageReached: stage, accepted: false }],
    }).validateSync();
    expect(err?.errors["candidates.0.stageReached"]).toBeUndefined();
  });

  it("rejects an out-of-enum candidate stageReached / risk / optionPath", () => {
    const err = new GenerationSnapshot({
      ...validBase(),
      candidates: [
        {
          candidateId: "c0",
          sourceAttemptId: "a0",
          stageReached: "teleported",
          accepted: false,
          risk: "extreme",
          optionPath: "wormhole",
        },
      ],
    }).validateSync();
    expect(err?.errors["candidates.0.stageReached"]).toBeDefined();
    expect(err?.errors["candidates.0.risk"]).toBeDefined();
    expect(err?.errors["candidates.0.optionPath"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
describe("GenerationSnapshot — immutability predicates", () => {
  it("the mutable-field whitelist is exactly the three redaction fields", () => {
    expect([...GENERATION_SNAPSHOT_MUTABLE_FIELDS].sort()).toEqual([
      "redacted",
      "redactedAt",
      "redactionReason",
    ]);
  });

  it("flags a non-redaction $set", () => {
    expect(nonRedactionUpdatePaths({ $set: { occasion: "x" } })).toEqual(["occasion"]);
  });

  it("allows a redaction-only update ($set of the three fields)", () => {
    expect(
      nonRedactionUpdatePaths({ $set: { redacted: true, redactedAt: new Date(), redactionReason: "gdpr" } }),
    ).toEqual([]);
  });

  it("allows a bare (non-operator) redaction field assignment", () => {
    expect(nonRedactionUpdatePaths({ redacted: true })).toEqual([]);
  });

  it("flags a mixed update that also touches a non-redaction field", () => {
    expect(nonRedactionUpdatePaths({ $set: { redacted: true }, $unset: { occasion: 1 } })).toEqual([
      "occasion",
    ]);
  });

  it("flags a nested non-redaction path by its top-level segment", () => {
    expect(nonRedactionUpdatePaths({ $set: { "lens.boardId": oid() } })).toEqual(["lens.boardId"]);
  });

  it("flags a $rename by its DESTINATION (source-keyed operator bypass)", () => {
    // $rename:{redacted:"occasion"} has a whitelisted SOURCE key but writes to occasion.
    expect(nonRedactionUpdatePaths({ $rename: { redacted: "occasion" } })).toEqual(["occasion"]);
    // a rename between two redaction fields touches only whitelisted paths → allowed.
    expect(nonRedactionUpdatePaths({ $rename: { redactedAt: "redactionReason" } })).toEqual([]);
  });

  it("exempts the framework-managed timestamp paths injected by { timestamps: true }", () => {
    // This is the exact shape Mongoose's timestamp pre-hook produces for a redaction update.
    expect(
      nonRedactionUpdatePaths({
        $set: { redacted: true, redactedAt: new Date(), redactionReason: "gdpr", updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      }),
    ).toEqual([]);
    expect(nonRedactionModifiedPaths(["redacted", "redactedAt", "updatedAt"])).toEqual([]);
  });

  it("rejects an aggregation-pipeline update wholesale", () => {
    expect(nonRedactionUpdatePaths([{ $set: { occasion: "x" } }])).toEqual(["<aggregation-pipeline>"]);
  });

  it("treats no/empty update as allowed", () => {
    expect(nonRedactionUpdatePaths(undefined)).toEqual([]);
    expect(nonRedactionUpdatePaths({})).toEqual([]);
  });

  it("nonRedactionModifiedPaths filters the whitelist", () => {
    expect(nonRedactionModifiedPaths(["redacted", "redactedAt", "redactionReason"])).toEqual([]);
    expect(nonRedactionModifiedPaths(["occasion", "redacted"])).toEqual(["occasion"]);
  });
});

// ---------------------------------------------------------------------------
describe("GenerationSnapshot — immutability guard fires on the registered hooks", () => {
  // Invoke the EXACT functions registered as pre-hooks, with a faked query/doc context —
  // proves wiring + behavior without a live DB (execPre would also run Mongoose internals).
  const runUpdateGuard = (update: unknown) =>
    new Promise<void>((resolve, reject) => {
      immutableUpdateGuard.call({ getUpdate: () => update }, (err) => (err ? reject(err) : resolve()));
    });

  const runSaveGuard = (ctx: { isNew: boolean; modifiedPaths: () => string[] }) =>
    new Promise<void>((resolve, reject) => {
      immutableSaveGuard.call(ctx, (err) => (err ? reject(err) : resolve()));
    });

  const runReplaceGuard = () =>
    new Promise<void>((resolve, reject) => {
      immutableReplaceGuard((err) => (err ? reject(err) : resolve()));
    });

  it("the EXACT guard fn is wired to every mutating query op + save (not just a timestamps hook)", () => {
    // {timestamps:true} also registers a pre-hook on each of these ops, so a bare length>0 check
    // would stay green even if the guard registration (the .pre(...) calls) were deleted — masking
    // a silent de-wiring of a one-way-door guard. Assert the specific guard FUNCTION is present.
    const pres = (
      GenerationSnapshot.schema as unknown as { s: { hooks: { _pres: Map<string, { fn: unknown }[]> } } }
    ).s.hooks._pres;
    const wiring: [string, unknown][] = [
      ["updateOne", immutableUpdateGuard],
      ["updateMany", immutableUpdateGuard],
      ["findOneAndUpdate", immutableUpdateGuard],
      ["replaceOne", immutableReplaceGuard],
      ["findOneAndReplace", immutableReplaceGuard],
      ["save", immutableSaveGuard],
    ];
    for (const [op, guard] of wiring) {
      expect((pres.get(op) || []).some((h) => h.fn === guard)).toBe(true);
    }
  });

  it("the update guard rejects a non-redaction mutation", async () => {
    await expect(runUpdateGuard({ $set: { occasion: "leaked" } })).rejects.toThrow(/immutable/i);
  });

  it("a redaction-only update is accepted (incl. the injected updatedAt/createdAt)", async () => {
    await expect(
      runUpdateGuard({
        $set: { redacted: true, redactedAt: new Date(), redactionReason: "gdpr", updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      }),
    ).resolves.toBeUndefined();
  });

  it("a $rename that writes to a non-redaction field is rejected", async () => {
    await expect(runUpdateGuard({ $rename: { redacted: "occasion" } })).rejects.toThrow(/immutable/i);
  });

  it("a whole-doc replace is rejected unconditionally — even a redaction-only body", async () => {
    // Replace deletes every absent field, so even {redacted:true} would wipe the record.
    await expect(runReplaceGuard()).rejects.toThrow(/replace is never permitted/i);
  });

  it("save: the initial insert (isNew) is allowed", async () => {
    await expect(runSaveGuard({ isNew: true, modifiedPaths: () => ["occasion"] })).resolves.toBeUndefined();
  });

  it("save: re-saving a modified non-redaction field is rejected", async () => {
    await expect(runSaveGuard({ isNew: false, modifiedPaths: () => ["occasion"] })).rejects.toThrow(
      /immutable/i,
    );
  });

  it("save: re-saving only redaction fields is allowed", async () => {
    await expect(
      runSaveGuard({ isNew: false, modifiedPaths: () => ["redacted", "redactedAt"] }),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("GenerationSnapshot — index plan (§8.8)", () => {
  const indexes = () => GenerationSnapshot.schema.indexes();
  const find = (pred: (keys: Record<string, number>) => boolean) =>
    indexes().find(([keys]) => pred(keys as Record<string, number>));

  it("declares the user+createdAt+_id window index (H19 tie-break + feedback-binding prefix)", () => {
    expect(find((k) => k.user === 1 && k.createdAt === -1 && k._id === -1)).toBeDefined();
  });

  it("declares the re-roll grouping index as NON-unique", () => {
    const idx = find((k) => k.user === 1 && k.candidateCacheKey === 1 && k.generationIndex === 1);
    expect(idx).toBeDefined();
    expect(idx?.[1]?.unique).toBeFalsy();
  });

  it("declares the multikey shownFullSignatures index", () => {
    expect(find((k) => k.user === 1 && k.shownFullSignatures === 1 && k.createdAt === -1)).toBeDefined();
  });

  it("declares the M6 training-batch and redaction-sweep indexes", () => {
    expect(find((k) => k.redacted === 1 && k.createdAt === 1)).toBeDefined();
    expect(find((k) => k.user === 1 && k.redacted === 1)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
describe("GenerationSnapshot — BSON size guard (OQ1)", () => {
  it("a worst-case doc with all raw fields at cap stays under 16 MB", () => {
    const big = (bytes: number) => "x".repeat(bytes);

    const worstCase = {
      ...validBase(),
      user: oid(),
      // 135 items (MAX_PROMPT_ITEMS) — base fields + a capped raw-attributes blob each.
      itemSnapshots: Array.from({ length: 135 }, (_, i) => ({
        itemId: `item-${i}`,
        engineVisible: {
          name: `Item number ${i} with a reasonably long descriptive name`,
          clothingType: "top",
          warmth: 5,
          styleTags: ["casual", "solid", "everyday"],
          colorTags: ["navy", "blue"],
          occasionTags: ["daily", "work"],
          material: "cotton",
          formality: "casual",
          imageUrl: "https://example.com/images/some/path/item.png",
        },
        evidence: {
          category: "top",
          subCategory: "tee",
          pattern: "solid",
          seasons: ["spring", "summer"],
          isAvailable: true,
          isFavorite: false,
          brand: "BrandName",
          tags: ["t1", "t2"],
          image: { imageRef: "ref-xyz", imageVersion: 1, hash: "abcdef0123456789" },
          rawAttributes: { raw: big(RAW_ATTRIBUTES_CAP_BYTES) },
          rawAttributesBytes: RAW_ATTRIBUTES_CAP_BYTES,
          rawAttributesHash: "hash",
          rawAttributesTruncated: true,
        },
        cvModelVersion: null,
      })),
      // 40 candidates (MAX_CANDIDATES) — content + a capped raw-emitted blob + full score trace.
      candidates: Array.from({ length: 40 }, (_, i) => ({
        candidateId: `cand-${i}`,
        sourceAttemptId: "attempt-0",
        sourceIndex: i,
        stageReached: "ranked",
        accepted: false,
        shown: false,
        items: [
          { itemId: "item-1", role: "base_top" },
          { itemId: "item-2", role: "base_bottom" },
        ],
        slotMap: { top: "item-1", bottom: "item-2" },
        template: "two_piece",
        baseKey: "item-1:item-2",
        fullSignature: "item-1:item-2|outer=none|shoes=none",
        optionPath: "reliable",
        risk: "safe",
        rejectionCodes: ["duplicateFullSignature"],
        rawEmitted: { raw: big(RAW_EMITTED_CAP_BYTES) },
        rawEmittedBytes: RAW_EMITTED_CAP_BYTES,
        rawEmittedHash: "hash",
        scoreTrace: {
          compatibility: 0.5,
          visibility: 0.5,
          rankerScore: 1.25,
          scoreBreakdown: { base: 1, combo: 0, item: 0, dislike: 0, overuse: 0, repetition: 0, cooldown: 0 },
        },
      })),
      // a few generation attempts each carrying a capped full-response raw text.
      generationAttempts: Array.from({ length: 4 }, (_, i) => ({
        attemptId: `attempt-${i}`,
        attemptIndex: i,
        isRepair: i > 0,
        payloadParsed: true,
        candidateCountEmitted: 40,
        rawText: big(RAW_TEXT_CAP_BYTES),
        rawTextBytes: RAW_TEXT_CAP_BYTES,
        rawTextHash: "hash",
        rawTextTruncated: true,
      })),
      shownCandidateIds: Array.from({ length: 10 }, (_, i) => `cand-${i}`),
      shownFullSignatures: Array.from({ length: 10 }, (_, i) => `sig-${i}`),
      nSurfaced: 10,
      spreadCollapsed: false,
    };

    const size = calculateObjectSize(worstCase);
    expect(size).toBeLessThan(16 * 1024 * 1024);
  });
});
