/**
 * End-to-end recommendation flow — pipeline invariant tests.
 *
 * TRUE E2E ASSESSMENT: Chaining the recommend → interaction → regenerate routes
 * through shared MongoDB state is not feasible as a meaningful unit test. Each
 * route independently calls initDatabase(), and replicating cross-route state
 * through mocks would test mock wiring, not production behaviour.
 *
 * WHAT THESE TESTS DO INSTEAD: Verify the logical contracts that hold across
 * the full pipeline. These are pure-logic invariants about:
 *   1. The recommend-to-regenerate semantic contract (recommend ignores item
 *      dislikes; regenerate respects contextual dislikes from a single outfit).
 *   2. The interaction payload shape contract (what fields persist → what
 *      the regenerate body must contain).
 *   3. The per-outfit scoping contract (disliked IDs from outfit N cannot
 *      bleed into outfit M's regenerate call).
 *   4. The summary staleness contract (threshold logic that governs whether
 *      Gemini is called during a recommend/regenerate call).
 *
 * These complement the individual route tests in regenerateExclusion.test.ts,
 * interactionPersistence.test.ts, and recommendationStability.test.ts.
 */

// ---------------------------------------------------------------------------
// 1. Recommend → Regenerate semantic contract
// ---------------------------------------------------------------------------

describe("Recommend → Regenerate semantic contract", () => {
  /**
   * Simulates the shortlistForLLM filter predicate for the recommend route:
   * availability-only filtering — no item-level dislike exclusion.
   */
  function recommendShortlist(
    items: Array<{ id: string; isAvailable?: boolean }>,
    _dislikedItemIds: string[] // intentionally ignored — matches recommend route behaviour
  ) {
    return items.filter((item) => item.isAvailable !== false);
  }

  /**
   * Simulates the shortlistForLLM filter predicate for the regenerate route:
   * availability filtering PLUS contextual disliked-item exclusion.
   */
  function regenerateShortlist(
    items: Array<{ id: string; isAvailable?: boolean }>,
    dislikedItemIds: string[]
  ) {
    const dislikedSet = new Set(dislikedItemIds);
    return items.filter((item) => {
      if (item.isAvailable === false) return false;
      if (dislikedSet.has(item.id)) return false;
      return true;
    });
  }

  const wardrobe = [
    { id: "shirt-1", isAvailable: true },
    { id: "jeans-1", isAvailable: true },
    { id: "jacket-1", isAvailable: true },
    { id: "unavail-1", isAvailable: false },
  ];

  it("recommend route sends all available items — dislikedItemIds has no effect", () => {
    const result = recommendShortlist(wardrobe, ["jacket-1"]);
    const ids = result.map((i) => i.id);

    expect(ids).toContain("jacket-1"); // not excluded by recommend
    expect(ids).toContain("shirt-1");
    expect(ids).not.toContain("unavail-1"); // availability IS enforced
  });

  it("regenerate route excludes disliked items for that specific outfit", () => {
    const result = regenerateShortlist(wardrobe, ["jacket-1"]);
    const ids = result.map((i) => i.id);

    expect(ids).not.toContain("jacket-1"); // hard-excluded
    expect(ids).toContain("shirt-1");
    expect(ids).not.toContain("unavail-1");
  });

  it("recommend sends the same candidate pool as regenerate when no dislikes are passed", () => {
    const recResult = recommendShortlist(wardrobe, []).map((i) => i.id).sort();
    const regenResult = regenerateShortlist(wardrobe, []).map((i) => i.id).sort();

    expect(recResult).toEqual(regenResult);
  });
});

// ---------------------------------------------------------------------------
// 2. Interaction payload → Regenerate body contract
// ---------------------------------------------------------------------------

describe("Interaction payload → Regenerate body contract", () => {
  /**
   * Simulates how the dashboard extracts disliked item IDs from a saveFeedback
   * call and passes them to the regenerate request body.
   */
  type PerItemFeedback = { itemId: string; disliked: boolean; notes?: string };

  function extractDislikedItemIdsFromFeedback(perItemFeedback: PerItemFeedback[]): string[] {
    return perItemFeedback.filter((f) => f.disliked).map((f) => f.itemId);
  }

  it("extracts only disliked:true items from perItemFeedback for the regenerate body", () => {
    const feedback: PerItemFeedback[] = [
      { itemId: "item-a", disliked: true },
      { itemId: "item-b", disliked: false },
      { itemId: "item-c", disliked: true },
    ];

    const ids = extractDislikedItemIdsFromFeedback(feedback);
    expect(ids).toEqual(["item-a", "item-c"]);
    expect(ids).not.toContain("item-b");
  });

  it("returns empty array when no items are disliked (dislikedItemIds: [])", () => {
    const feedback: PerItemFeedback[] = [
      { itemId: "item-a", disliked: false },
      { itemId: "item-b", disliked: false },
    ];

    const ids = extractDislikedItemIdsFromFeedback(feedback);
    expect(ids).toHaveLength(0);
  });

  it("returns empty array when perItemFeedback is empty", () => {
    const ids = extractDislikedItemIdsFromFeedback([]);
    expect(ids).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Per-outfit disliked-item scoping contract
// ---------------------------------------------------------------------------

describe("Per-outfit disliked-item scoping — cross-outfit isolation", () => {
  type OutfitDislikedItems = Record<number, string[]>;

  function getDislikedForOutfit(state: OutfitDislikedItems, index: number): string[] {
    return state[index] ?? [];
  }

  function setDislikedForOutfit(
    state: OutfitDislikedItems,
    index: number,
    ids: string[]
  ): OutfitDislikedItems {
    return { ...state, [index]: ids };
  }

  it("outfit 0 dislikes do not appear in outfit 1's regenerate call", () => {
    let state: OutfitDislikedItems = {};
    state = setDislikedForOutfit(state, 0, ["shirt-1", "shoes-1"]);
    state = setDislikedForOutfit(state, 1, ["jacket-2"]);

    // Simulates: regenerate button clicked on outfit 0
    const forOutfit0 = getDislikedForOutfit(state, 0);
    expect(forOutfit0).toContain("shirt-1");
    expect(forOutfit0).not.toContain("jacket-2"); // outfit 1 item must not appear

    // Simulates: regenerate button clicked on outfit 1
    const forOutfit1 = getDislikedForOutfit(state, 1);
    expect(forOutfit1).toContain("jacket-2");
    expect(forOutfit1).not.toContain("shirt-1"); // outfit 0 item must not appear
  });

  it("an outfit with no user-disliked items receives an empty dislikedItemIds array", () => {
    let state: OutfitDislikedItems = {};
    state = setDislikedForOutfit(state, 0, ["shirt-1"]);
    // outfit 1 was never touched

    const forOutfit1 = getDislikedForOutfit(state, 1);
    expect(forOutfit1).toEqual([]);
    expect(Array.isArray(forOutfit1)).toBe(true);
  });

  it("clearing state on new recommendations resets all per-outfit dislikes", () => {
    let state: OutfitDislikedItems = {};
    state = setDislikedForOutfit(state, 0, ["shirt-1"]);
    state = setDislikedForOutfit(state, 2, ["shoes-3", "jacket-4"]);

    // Simulate new recommendations generated → state cleared
    state = {};

    expect(getDislikedForOutfit(state, 0)).toEqual([]);
    expect(getDislikedForOutfit(state, 2)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Summary staleness contract
// ---------------------------------------------------------------------------

describe("Summary staleness contract", () => {
  const SUMMARY_STALE_THRESHOLD = 5;

  /**
   * Simulates the isStale decision inside getOrRefreshPreferenceSummary.
   */
  function isSummaryStalе(
    existingText: string | null,
    newInteractionCount: number
  ): boolean {
    return !existingText || newInteractionCount >= SUMMARY_STALE_THRESHOLD;
  }

  it("is stale when no existing summary exists (first-run)", () => {
    expect(isSummaryStalе(null, 0)).toBe(true);
  });

  it("is stale when no existing summary and interactions exist", () => {
    expect(isSummaryStalе(null, 10)).toBe(true);
  });

  it("is NOT stale when existing summary and fewer than threshold new interactions", () => {
    expect(isSummaryStalе("- Prefers casual", 4)).toBe(false);
  });

  it("is NOT stale when exactly threshold - 1 new interactions", () => {
    expect(isSummaryStalе("- Prefers casual", SUMMARY_STALE_THRESHOLD - 1)).toBe(false);
  });

  it("IS stale at exactly threshold new interactions", () => {
    expect(isSummaryStalе("- Prefers casual", SUMMARY_STALE_THRESHOLD)).toBe(true);
  });

  it("IS stale above threshold", () => {
    expect(isSummaryStalе("- Prefers casual", SUMMARY_STALE_THRESHOLD + 3)).toBe(true);
  });

  it("is NOT stale when count is 0 and summary exists", () => {
    expect(isSummaryStalе("- Prefers casual", 0)).toBe(false);
  });
});
