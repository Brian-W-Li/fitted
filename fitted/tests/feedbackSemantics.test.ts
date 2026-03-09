/**
 * Tests for feedback semantics — specifically the contextual disliked-item
 * exclusion logic that lives inside shortlistForLLM (regenerate route).
 *
 * Because shortlistForLLM is an internal function in the route file (not
 * exported), these tests reproduce the critical filtering predicate inline.
 * If the predicate logic in the route changes, update these tests to match.
 *
 * The core contract being tested:
 *   - Items in dislikedItemIds are hard-excluded from the candidate pool.
 *   - Items NOT in dislikedItemIds are kept regardless of other attributes.
 *   - An empty dislikedItemIds excludes nothing.
 */

// ---------------------------------------------------------------------------
// Inline reproduction of the disliked-item filter predicate (from regenerate)
// ---------------------------------------------------------------------------

interface MinimalItem {
  id: string;
  isAvailable?: boolean;
}

function applyDislikedFilter(
  items: MinimalItem[],
  dislikedItemIds: string[]
): MinimalItem[] {
  const dislikedSet = new Set(dislikedItemIds);
  return items.filter((item) => {
    if (item.isAvailable === false) return false;
    if (dislikedSet.has(item.id)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------

describe("Disliked-item filter (regenerate shortlist predicate)", () => {
  const items: MinimalItem[] = [
    { id: "a" },
    { id: "b" },
    { id: "c" },
    { id: "d", isAvailable: false },
  ];

  it("excludes nothing when dislikedItemIds is empty", () => {
    const result = applyDislikedFilter(items, []);
    const ids = result.map((i) => i.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).toContain("c");
    // d excluded because isAvailable: false (unrelated to dislike filter)
    expect(ids).not.toContain("d");
  });

  it("hard-excludes a single disliked item ID", () => {
    const result = applyDislikedFilter(items, ["b"]);
    const ids = result.map((i) => i.id);
    expect(ids).not.toContain("b");
    expect(ids).toContain("a");
    expect(ids).toContain("c");
  });

  it("hard-excludes multiple disliked item IDs", () => {
    const result = applyDislikedFilter(items, ["a", "c"]);
    const ids = result.map((i) => i.id);
    expect(ids).not.toContain("a");
    expect(ids).not.toContain("c");
    expect(ids).toContain("b");
  });

  it("excludes all items if every available item is disliked", () => {
    const result = applyDislikedFilter(items, ["a", "b", "c"]);
    // d is already unavailable; a,b,c are disliked → empty result
    expect(result).toHaveLength(0);
  });

  it("ignores disliked IDs that do not match any item (no crash, no phantom exclusion)", () => {
    const result = applyDislikedFilter(items, ["z", "nonexistent"]);
    const ids = result.map((i) => i.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).toContain("c");
  });

  it("disliked filter is exact-match only — similar IDs are not excluded", () => {
    const result = applyDislikedFilter(items, ["ab"]);
    const ids = result.map((i) => i.id);
    // "ab" is not the same as "a" or "b"
    expect(ids).toContain("a");
    expect(ids).toContain("b");
  });

  it("isAvailable:false items are excluded regardless of disliked list", () => {
    // item d has isAvailable:false — it should never appear even if not disliked
    const result = applyDislikedFilter(items, []);
    expect(result.find((i) => i.id === "d")).toBeUndefined();
  });

  it("disliked exclusion and availability exclusion are independent (item in both lists)", () => {
    // If an unavailable item is also in the disliked list — still excluded, no error
    const result = applyDislikedFilter(items, ["d"]);
    expect(result.find((i) => i.id === "d")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Contextual scoping invariants
// These verify the semantic contract: disliked IDs come only from
// the current outfit's per-item feedback and must not cross outfits.
// ---------------------------------------------------------------------------

describe("Per-outfit disliked items scoping", () => {
  /**
   * Simulates the outfitDislikedItems state from dashboard/page.tsx.
   * Maps outfit index → disliked item IDs for that outfit.
   */
  type OutfitDislikedItems = Record<number, string[]>;

  function getDislikedForOutfit(
    state: OutfitDislikedItems,
    outfitIndex: number
  ): string[] {
    return state[outfitIndex] ?? [];
  }

  function addDislikedForOutfit(
    state: OutfitDislikedItems,
    outfitIndex: number,
    itemIds: string[]
  ): OutfitDislikedItems {
    return { ...state, [outfitIndex]: itemIds };
  }

  it("starts with empty state — no outfit has any disliked items", () => {
    const state: OutfitDislikedItems = {};
    expect(getDislikedForOutfit(state, 0)).toEqual([]);
    expect(getDislikedForOutfit(state, 1)).toEqual([]);
  });

  it("storing disliked items for outfit 0 does not affect outfit 1", () => {
    let state: OutfitDislikedItems = {};
    state = addDislikedForOutfit(state, 0, ["item-x", "item-y"]);

    expect(getDislikedForOutfit(state, 0)).toEqual(["item-x", "item-y"]);
    expect(getDislikedForOutfit(state, 1)).toEqual([]); // isolation
  });

  it("storing disliked items for outfit 1 does not affect outfit 0", () => {
    let state: OutfitDislikedItems = {};
    state = addDislikedForOutfit(state, 0, ["item-a"]);
    state = addDislikedForOutfit(state, 1, ["item-b"]);

    expect(getDislikedForOutfit(state, 0)).toEqual(["item-a"]);
    expect(getDislikedForOutfit(state, 1)).toEqual(["item-b"]);
  });

  it("clearing state (new recommendations) resets all outfit-level disliked items", () => {
    let state: OutfitDislikedItems = {};
    state = addDislikedForOutfit(state, 0, ["item-a"]);
    state = addDislikedForOutfit(state, 2, ["item-b", "item-c"]);

    // Simulate setOutfitDislikedItems({}) on new recommendations
    state = {};

    expect(getDislikedForOutfit(state, 0)).toEqual([]);
    expect(getDislikedForOutfit(state, 2)).toEqual([]);
  });

  it("regenerate for outfit N only sees outfit N's disliked items", () => {
    let state: OutfitDislikedItems = {};
    state = addDislikedForOutfit(state, 0, ["shirt-1"]);
    state = addDislikedForOutfit(state, 1, ["jeans-2"]);
    state = addDislikedForOutfit(state, 2, ["shoe-3", "shoe-4"]);

    // Regenerating outfit 1 — should only see jeans-2
    const dislikedForRegen = getDislikedForOutfit(state, 1);
    expect(dislikedForRegen).toEqual(["jeans-2"]);
    expect(dislikedForRegen).not.toContain("shirt-1");
    expect(dislikedForRegen).not.toContain("shoe-3");
  });

  it("outfit with no disliked items returns empty array (not undefined)", () => {
    const state: OutfitDislikedItems = {};
    const result = getDislikedForOutfit(state, 99);
    expect(result).toEqual([]);
    expect(Array.isArray(result)).toBe(true);
  });
});
