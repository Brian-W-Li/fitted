/**
 * M5 request adapter (C5 seam #3) — the cross-runtime acceptance gate + the trust-boundary
 * rejection behavior.
 *
 * The gate (m5-cutover.md §A "C5 acceptance gate"): the Next adapter's emitted keys MUST equal the
 * single source of truth `ml-system/service/contract_fields.json` `wireBoundaries`. This is what
 * the M5 build lacked — the field-drift class (`sessionId` absent from the wire) that hid in a
 * green suite now reddens it. The check catches BOTH a missing required field AND a stray key, so
 * either runtime drifting away from the shared contract file fails the suite.
 */
import fs from "fs";
import path from "path";
import {
  buildLens,
  buildRenderBody,
  projectWardrobe,
  RequestContractError,
  GENERATOR_EXPECTATION,
  MAX_IMAGE_URL_CHARS,
  type WardrobeItemSource,
} from "@/lib/mlRequestAdapter";

const CONTRACT = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../ml-system/service/contract_fields.json"), "utf8"),
) as {
  wireBoundaries: Record<string, { required: string[]; optional: string[] }>;
};

/** Every required key present; no key outside required ∪ optional (the drift guard, both directions). */
function assertBoundary(emitted: object, boundaryName: string) {
  const boundary = CONTRACT.wireBoundaries[boundaryName];
  if (!boundary) throw new Error(`no wireBoundary named ${boundaryName}`);
  const emittedKeys = Object.keys(emitted).sort();
  const allowed = new Set([...boundary.required, ...boundary.optional]);
  for (const req of boundary.required) {
    expect(emittedKeys).toContain(req);
  }
  for (const key of emittedKeys) {
    expect(allowed.has(key)).toBe(true);
  }
}

const oid = (hex: string) => ({ toString: () => hex });

const sampleItem: WardrobeItemSource = {
  _id: oid("6a4eb442443135439ac080d2"),
  name: "Oxford shirt",
  clothingType: "top",
  warmth: 4,
  colors: ["white"],
  occasions: ["work"],
  imageUrl: "https://img/x.jpg",
};

/** Project a single item and return its wire projection (undefined if it was dropped). */
const projectOne = (item: WardrobeItemSource) => projectWardrobe([item]).wire[0];

const dailyLens = () =>
  buildLens(
    {
      occasion: "coffee with a friend",
      weather: "mild",
      weatherRaw: "62F, partly cloudy",
      location: "Santa Barbara",
      seedDate: "2026-07-08",
    },
    "daily",
  );

const fullBody = () =>
  buildRenderBody({
    snapshotId: "6a4eb442443135439ac080d3",
    requestId: "0192f1a0-1c1a-7c3e-9b2a-1a2b3c4d5e6f",
    sessionId: "user-1",
    intent: "daily",
    generationIndex: 0,
    parentSnapshotId: null,
    controls: { lockedItemIds: [], dislikedItemIds: [] },
    lens: dailyLens(),
    wardrobe: projectWardrobe([sampleItem]).wire,
    wardrobeVersion: 0,
    interactionCountAtRequest: 0,
    behavioralRows: { recentSnapshots: [], interactionRows: [] },
  });

// ---------------------------------------------------------------------------
describe("cross-runtime acceptance gate — emitted keys == contract_fields.json wireBoundaries", () => {
  it("the top-level request body matches the `request` boundary", () => {
    assertBoundary(fullBody(), "request");
  });

  it("the lens object matches the `lens` boundary", () => {
    assertBoundary(fullBody().lens, "lens");
  });

  it("each wardrobe item matches the `wardrobeItem` boundary", () => {
    assertBoundary(fullBody().wardrobe[0], "wardrobeItem");
  });

  it("the generator expectation matches the `generator` boundary", () => {
    assertBoundary(fullBody().generator, "generator");
  });

  it("the controls object matches the `controls` boundary", () => {
    assertBoundary(fullBody().controls, "controls");
  });

  it("the behavioralRows object matches the `behavioralRows` boundary", () => {
    assertBoundary(fullBody().behavioralRows, "behavioralRows");
  });

  it("the generator expectation values mirror the service config (§A.6)", () => {
    // A value drift here → a pre-spend contract_invalid on every render (§A exact-match).
    expect(GENERATOR_EXPECTATION.model).toBe("gpt-5.4-mini");
    expect(GENERATOR_EXPECTATION.temperature).toBe(0.5);
    expect(GENERATOR_EXPECTATION.apiSurface).toBe("chat_completions");
    expect(GENERATOR_EXPECTATION.responseFormat).toBe("json_schema_strict");
    expect(GENERATOR_EXPECTATION.reasoningEffort).toBe("none");
    expect(GENERATOR_EXPECTATION.storeMode).toBe("none");
    expect(GENERATOR_EXPECTATION.promptCacheRetention).toBe("in_memory");
    expect(GENERATOR_EXPECTATION.timeoutSeconds).toBe(30);
    expect(GENERATOR_EXPECTATION.maxRetries).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("Lens adapter (§F) — trust-boundary rejections through the one error channel", () => {
  const base = { occasion: "brunch", weather: "mild", seedDate: "2026-07-08" };

  it("rejects a whitespace-only occasion (never trim-and-proceed)", () => {
    expect(() => buildLens({ ...base, occasion: "   " }, "daily")).toThrow(RequestContractError);
  });

  it("rejects an over-length occasion at the boundary (limit+1)", () => {
    expect(() => buildLens({ ...base, occasion: "x".repeat(201) }, "daily")).toThrow(RequestContractError);
    expect(buildLens({ ...base, occasion: "x".repeat(200) }, "daily").occasion.length).toBe(200);
  });

  it("rejects an un-bucketed weather value", () => {
    expect(() => buildLens({ ...base, weather: "62F" }, "daily")).toThrow(RequestContractError);
  });

  it("rejects a missing/malformed seedDate", () => {
    expect(() => buildLens({ ...base, seedDate: "" }, "daily")).toThrow(RequestContractError);
    expect(() => buildLens({ ...base, seedDate: "07/08/2026" }, "daily")).toThrow(RequestContractError);
  });

  it("rejects a non-empty constraints map (H36 deferred at M5)", () => {
    expect(() => buildLens({ ...base, constraints: { season: "summer" } }, "daily")).toThrow(
      RequestContractError,
    );
  });

  it("requires forcedItemId iff intent=rescue_item, and forbids it on daily", () => {
    expect(() => buildLens({ ...base }, "rescue_item")).toThrow(RequestContractError);
    expect(() => buildLens({ ...base, forcedItemId: "x" }, "daily")).toThrow(RequestContractError);
    expect(buildLens({ ...base, forcedItemId: "item-1" }, "rescue_item").forcedItemId).toBe("item-1");
  });
});

// ---------------------------------------------------------------------------
describe("item map (§15.2) + control caps", () => {
  it("maps deployed columns to the wire projection (renames + W-track placeholders)", () => {
    expect(projectOne(sampleItem)).toEqual({
      id: "6a4eb442443135439ac080d2",
      name: "Oxford shirt",
      clothingType: "top",
      warmth: 4,
      colorTags: ["white"],
      occasionTags: ["work"],
      styleTags: [],
      material: null,
      formality: null,
      imageUrl: "https://img/x.jpg",
    });
  });

  it("resolves imagePath (mongo:<id>) when imageUrl is absent (§15.2 fallback, the common deployed case)", () => {
    expect(
      projectOne({ ...sampleItem, imageUrl: undefined, imagePath: "mongo:6a4eb442443135439ac080d9" }).imageUrl,
    ).toBe("/api/images/6a4eb442443135439ac080d9");
    // imageUrl wins when present.
    expect(projectOne({ ...sampleItem, imagePath: "mongo:x" }).imageUrl).toBe("https://img/x.jpg");
    // neither → "" (a no-image item is legitimate; the service accepts a blank imageUrl).
    expect(projectOne({ ...sampleItem, imageUrl: undefined, imagePath: undefined }).imageUrl).toBe("");
  });

  it('drops an over-cap imageUrl to "" so one bad-URL item cannot make the closet unrenderable', () => {
    // The service rejects an over-MAX_IMAGE_URL_CHARS imageUrl for the WHOLE render (⚠ mirror obligation).
    expect(projectOne({ ...sampleItem, imageUrl: "u".repeat(MAX_IMAGE_URL_CHARS + 1) }).imageUrl).toBe("");
    // exactly-at-cap passes through unchanged (pins the boundary is `>`, not `>=`)
    const atCap = "h".repeat(MAX_IMAGE_URL_CHARS);
    expect(projectOne({ ...sampleItem, imageUrl: atCap }).imageUrl).toBe(atCap);
  });

  it("sanitizes tags so one bad tag never makes a closet unrenderable (⚠ mirror obligation)", () => {
    // The service _string_list rejects a blank/whitespace or over-60-char tag for the WHOLE render.
    const wire = projectOne({
      ...sampleItem,
      colors: ["  navy  ", "", "   ", "x".repeat(61), "red"], // trim; drop blanks + over-long
      occasions: Array.from({ length: 30 }, (_, i) => `occ${i}`), // cap to 25
    });
    expect(wire.colorTags).toEqual(["navy", "red"]);
    expect(wire.occasionTags).toHaveLength(25);
  });

  it("treats a non-string imagePath as no-image instead of throwing TypeError", () => {
    expect(
      projectOne({ ...sampleItem, imageUrl: undefined, imagePath: { bad: true } as unknown as string }).imageUrl,
    ).toBe("");
  });

  it("caps an over-long item name rather than rejecting the render", () => {
    expect(projectOne({ ...sampleItem, name: "n".repeat(250) }).name).toHaveLength(200);
  });

  // --- A-cluster: per-item resilience. A malformed row is DROPPED (with a reason), not fatal, so
  // one corrupt garment never costs the user their whole closet. Coercion is prohibited (it would
  // fabricate signal the immutable M6 corpus trains on) — sanitize removes noise, never invents it.
  it("drops a row whose data is unusable, keeping the good items (never sinks the closet)", () => {
    const good2 = { ...sampleItem, _id: oid("6a4eb442443135439ac080e0"), name: "Chinos", clothingType: "bottom" };
    const { wire, dropped } = projectWardrobe([
      sampleItem, // good
      { ...sampleItem, _id: oid("6a4eb442443135439ac080e1"), warmth: 11 }, // out-of-range warmth
      { ...sampleItem, _id: oid("6a4eb442443135439ac080e2"), warmth: NaN }, // non-finite warmth
      { ...sampleItem, _id: oid("6a4eb442443135439ac080e3"), clothingType: "trousers" }, // not in 5-set
      { ...sampleItem, _id: oid("6a4eb442443135439ac080e4"), name: 123 as unknown as string }, // non-string name
      { ...sampleItem, _id: oid("6a4eb442443135439ac080e5"), colors: "navy" as unknown as string[] }, // scalar container
      { ...sampleItem, _id: oid("6a4eb442443135439ac080e6"), warmth: 5.5 }, // fractional — service wants an int
      good2, // good
    ]);
    // The two good items survive; the six bad rows are dropped, not thrown.
    expect(wire.map((w) => w.id)).toEqual(["6a4eb442443135439ac080d2", "6a4eb442443135439ac080e0"]);
    expect(dropped.map((d) => d.id).sort()).toEqual([
      "6a4eb442443135439ac080e1",
      "6a4eb442443135439ac080e2",
      "6a4eb442443135439ac080e3",
      "6a4eb442443135439ac080e4",
      "6a4eb442443135439ac080e5",
      "6a4eb442443135439ac080e6",
    ]);
    // Each drop carries a legible, field-specific reason (the observability the degrade rests on).
    const reasonById = new Map(dropped.map((d) => [d.id, d.reason]));
    expect(reasonById.get("6a4eb442443135439ac080e1")).toMatch(/warmth/);
    expect(reasonById.get("6a4eb442443135439ac080e3")).toMatch(/clothingType/);
    expect(reasonById.get("6a4eb442443135439ac080e4")).toMatch(/name/);
    expect(reasonById.get("6a4eb442443135439ac080e5")).toMatch(/colors/);
  });

  it("accepts every value of the 5-value clothingType ontology, drops anything else", () => {
    for (const ct of ["top", "bottom", "dress", "outer_layer", "shoes"]) {
      expect(projectOne({ ...sampleItem, clothingType: ct })?.clothingType).toBe(ct);
    }
    // Legacy 4-value category labels + undefined are NOT wire clothingTypes → dropped.
    for (const bad of ["one piece", "footwear", "", undefined as unknown as string]) {
      expect(projectWardrobe([{ ...sampleItem, clothingType: bad }]).wire).toHaveLength(0);
    }
  });

  it("throws (ENVELOPE fault) only for a wardrobe over the request cap — not per-item", () => {
    const many = Array.from({ length: 2001 }, (_, i) => ({ ...sampleItem, _id: oid(`id-${i}`) }));
    expect(() => projectWardrobe(many)).toThrow(RequestContractError);
  });

  it("rejects a control id array over the cap or with a blank id", () => {
    const parts = { ...fullBody() };
    expect(() =>
      buildRenderBody({ ...parts, controls: { lockedItemIds: Array(51).fill("x"), dislikedItemIds: [] } }),
    ).toThrow(RequestContractError);
    expect(() =>
      buildRenderBody({ ...parts, controls: { lockedItemIds: [" "], dislikedItemIds: [] } }),
    ).toThrow(RequestContractError);
  });
});
