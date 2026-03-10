/**
 * Tests for the display-only wardrobe filter, search, and sort pipeline.
 *
 * Pipeline: type filter → name search → sort → render
 *
 * None of this touches backend state or recommendation APIs.
 * The `items` array in the component is never mutated — all operations
 * produce a new derived `display` array used only for rendering.
 *
 * Type mapping (matches page.tsx):
 *   "all"       → all items
 *   "top"       → category === "top"
 *   "bottom"    → category === "bottom"
 *   "one piece" → category === "one piece"
 *
 * Timestamps (top-level, forwarded from MongoDB via GET /api/wardrobe):
 *   createdAt  — ISO string, used for Newest / Oldest sort
 *   updatedAt  — ISO string (present but not used for sorting)
 */

type WardrobeItem = {
  id: string;
  name: string;
  category: string;
  colors: string[];
  fit: string;
  size: string;
  seasons: string[];
  occasions: string[];
  createdAt?: string;
  updatedAt?: string;
};

type FilterValue = "all" | "top" | "bottom" | "one piece";
type SortOrder = "newest" | "oldest" | "name";

/** Mirrors the full pipeline in wardrobe/page.tsx exactly. */
function applyPipeline(
  items: WardrobeItem[],
  filter: FilterValue,
  searchQuery: string,
  sortOrder: SortOrder,
): WardrobeItem[] {
  let display =
    filter === "all" ? items : items.filter((it) => it.category === filter);

  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    display = display.filter((it) => it.name.toLowerCase().includes(q));
  }

  display = [...display].sort((a, b) => {
    if (sortOrder === "name") return a.name.localeCompare(b.name);
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return sortOrder === "newest" ? tb - ta : ta - tb;
  });

  return display;
}

const base = { colors: ["#000"], fit: "Regular", size: "M", seasons: [], occasions: [] };

const ITEMS: WardrobeItem[] = [
  { id: "1", name: "White Tee",      category: "top",       ...base, createdAt: "2024-01-01T00:00:00Z" },
  { id: "2", name: "Blue Shirt",     category: "top",       ...base, createdAt: "2024-03-01T00:00:00Z" },
  { id: "3", name: "Black Jeans",    category: "bottom",    ...base, createdAt: "2024-02-01T00:00:00Z" },
  { id: "4", name: "Chinos",         category: "bottom",    ...base, createdAt: "2024-04-01T00:00:00Z" },
  { id: "5", name: "Summer Dress",   category: "one piece", ...base, createdAt: "2024-05-01T00:00:00Z" },
  { id: "6", name: "Jumpsuit",       category: "one piece", ...base, createdAt: "2023-12-01T00:00:00Z" },
  { id: "7", name: "White Sneakers", category: "footwear",  ...base, createdAt: "2024-06-01T00:00:00Z" },
];

// ─── Type filter ──────────────────────────────────────────────────────────────

describe("type filter", () => {
  it("All returns every item", () => {
    expect(applyPipeline(ITEMS, "all", "", "newest")).toHaveLength(7);
  });

  it("Tops returns only category=top", () => {
    const r = applyPipeline(ITEMS, "top", "", "newest");
    expect(r).toHaveLength(2);
    expect(r.every((i) => i.category === "top")).toBe(true);
  });

  it("Bottoms returns only category=bottom", () => {
    const r = applyPipeline(ITEMS, "bottom", "", "newest");
    expect(r).toHaveLength(2);
    expect(r.every((i) => i.category === "bottom")).toBe(true);
  });

  it("One-piece returns only category=one piece", () => {
    const r = applyPipeline(ITEMS, "one piece", "", "newest");
    expect(r).toHaveLength(2);
    expect(r.every((i) => i.category === "one piece")).toBe(true);
  });

  it("footwear visible under All but has no dedicated filter bucket", () => {
    const all = applyPipeline(ITEMS, "all", "", "newest");
    expect(all.some((i) => i.category === "footwear")).toBe(true);
  });
});

// ─── Name search ─────────────────────────────────────────────────────────────

describe("name search", () => {
  it("matches substring case-insensitively", () => {
    const r = applyPipeline(ITEMS, "all", "white", "newest");
    expect(r.map((i) => i.id)).toEqual(expect.arrayContaining(["1", "7"]));
    expect(r).toHaveLength(2);
  });

  it("empty query returns all items (after type filter)", () => {
    expect(applyPipeline(ITEMS, "all", "", "newest")).toHaveLength(7);
    expect(applyPipeline(ITEMS, "all", "   ", "newest")).toHaveLength(7);
  });

  it("no match returns empty array", () => {
    expect(applyPipeline(ITEMS, "all", "xyzzy", "newest")).toHaveLength(0);
  });

  it("combines with type filter — search within Tops only", () => {
    const r = applyPipeline(ITEMS, "top", "shirt", "newest");
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("2");
  });

  it("search does not bleed across type buckets", () => {
    const r = applyPipeline(ITEMS, "top", "jeans", "newest");
    expect(r).toHaveLength(0);
  });
});

// ─── Sort ─────────────────────────────────────────────────────────────────────

describe("sort", () => {
  it("newest sorts by createdAt descending", () => {
    const r = applyPipeline(ITEMS, "all", "", "newest");
    const dates = r.map((i) => new Date(i.createdAt!).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
    }
  });

  it("oldest sorts by createdAt ascending", () => {
    const r = applyPipeline(ITEMS, "all", "", "oldest");
    const dates = r.map((i) => new Date(i.createdAt!).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeLessThanOrEqual(dates[i]);
    }
  });

  it("name sorts alphabetically A–Z", () => {
    const r = applyPipeline(ITEMS, "all", "", "name");
    const names = r.map((i) => i.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("sort is applied after filter and search", () => {
    // Tops: White Tee (Jan) and Blue Shirt (Mar); newest first → Blue Shirt, White Tee
    const r = applyPipeline(ITEMS, "top", "", "newest");
    expect(r[0].id).toBe("2"); // Blue Shirt (Mar)
    expect(r[1].id).toBe("1"); // White Tee (Jan)
  });

  it("oldest: Jumpsuit (Dec 2023) should be first, White Sneakers (Jun 2024) last", () => {
    const r = applyPipeline(ITEMS, "all", "", "oldest");
    expect(r[0].id).toBe("6");  // Jumpsuit — Dec 2023
    expect(r[r.length - 1].id).toBe("7"); // White Sneakers — Jun 2024
  });

  it("items without createdAt sort to the end for newest", () => {
    const withMissing: WardrobeItem[] = [
      { id: "a", name: "A", category: "top", ...base, createdAt: "2024-01-01T00:00:00Z" },
      { id: "b", name: "B", category: "top", ...base }, // no createdAt
    ];
    const r = applyPipeline(withMissing, "all", "", "newest");
    expect(r[0].id).toBe("a");
    expect(r[1].id).toBe("b");
  });
});

// ─── Combined pipeline ────────────────────────────────────────────────────────

describe("full pipeline", () => {
  it("type=top + search=white + sort=name returns White Tee only", () => {
    const r = applyPipeline(ITEMS, "top", "white", "name");
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("White Tee");
  });

  it("empty wardrobe returns empty for any combination", () => {
    expect(applyPipeline([], "all", "", "newest")).toHaveLength(0);
    expect(applyPipeline([], "top", "shirt", "name")).toHaveLength(0);
  });

  it("does not mutate the source items array", () => {
    const original = ITEMS.map((i) => i.id);
    applyPipeline(ITEMS, "top", "white", "oldest");
    expect(ITEMS.map((i) => i.id)).toEqual(original);
  });
});
