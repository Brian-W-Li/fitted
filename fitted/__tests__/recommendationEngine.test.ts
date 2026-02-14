/**
 * Unit tests for the ML recommendation engine (Lab06).
 * Covers OutfitRecommendationEngine, toMLItem, and recommendation behavior.
 */

import {
  OutfitRecommendationEngine,
  toMLItem,
  type WardrobeItemML,
  type OutfitRecommendation,
} from "@/lib/recommendationEngine";

describe("toMLItem", () => {
  it("converts a db-like item to WardrobeItemML with id string", () => {
    const dbItem = {
      _id: "507f1f77bcf86cd799439011",
      name: "Blue T-Shirt",
      category: "t-shirt",
      colors: ["blue"],
      formality: "casual",
      seasons: ["Summer"],
      occasions: ["Casual"],
    };
    const ml = toMLItem(dbItem);
    expect(ml.id).toBe("507f1f77bcf86cd799439011");
    expect(ml.name).toBe("Blue T-Shirt");
    expect(ml.category).toBe("t-shirt");
    expect(ml.colors).toEqual(["blue"]);
    expect(ml.formality).toBe("casual");
    expect(ml.seasons).toEqual(["Summer"]);
    expect(ml.occasions).toEqual(["Casual"]);
  });

  it("handles missing optional fields", () => {
    const dbItem = {
      _id: "abc123",
      name: "Shirt",
      category: "shirt",
    };
    const ml = toMLItem(dbItem);
    expect(ml.id).toBe("abc123");
    expect(ml.name).toBe("Shirt");
    expect(ml.category).toBe("shirt");
    expect(ml.colors).toBeUndefined();
  });
});

describe("OutfitRecommendationEngine", () => {
  const sampleTop: WardrobeItemML = {
    id: "1",
    name: "White T-Shirt",
    clothingType: "top",
    category: "t-shirt",
    colors: ["white"],
    formality: "casual",
    occasions: ["Casual", "Athletic"],
    seasons: ["All"],
  };

  const sampleBottom: WardrobeItemML = {
    id: "2",
    name: "Blue Jeans",
    clothingType: "bottom",
    category: "jeans",
    colors: ["blue"],
    formality: "casual",
    occasions: ["Casual", "Going Out"],
    seasons: ["All"],
  };

  it("returns empty array when no tops", async () => {
    const engine = new OutfitRecommendationEngine([sampleBottom]);
    const results = await engine.recommend({ occasion: "casual", maxResults: 5 });
    expect(results).toEqual([]);
  });

  it("returns empty array when no bottoms", async () => {
    const engine = new OutfitRecommendationEngine([sampleTop]);
    const results = await engine.recommend({ occasion: "casual", maxResults: 5 });
    expect(results).toEqual([]);
  });

  it("returns at least one recommendation for one top and one bottom", async () => {
    const engine = new OutfitRecommendationEngine([sampleTop, sampleBottom]);
    const results = await engine.recommend({
      occasion: "casual",
      maxResults: 5,
      minScore: 0,
    });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const rec = results[0];
    expect(rec).toHaveProperty("top");
    expect(rec).toHaveProperty("bottom");
    expect(rec).toHaveProperty("score");
    expect(rec).toHaveProperty("reasons");
    expect(rec.top.id).toBe(sampleTop.id);
    expect(rec.bottom.id).toBe(sampleBottom.id);
    expect(typeof rec.score).toBe("number");
    expect(rec.score).toBeGreaterThanOrEqual(0);
    expect(rec.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(rec.reasons)).toBe(true);
  });

  it("respects maxResults", async () => {
    const tops: WardrobeItemML[] = [
      { ...sampleTop, id: "t1" },
      { ...sampleTop, id: "t2", name: "Gray Hoodie", category: "hoodie" },
    ];
    const bottoms: WardrobeItemML[] = [
      { ...sampleBottom, id: "b1" },
      { ...sampleBottom, id: "b2", name: "Khaki Shorts", category: "shorts" },
    ];
    const engine = new OutfitRecommendationEngine([...tops, ...bottoms]);
    const results = await engine.recommend({
      occasion: "casual",
      maxResults: 2,
      minScore: 0,
    });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("uses clothingType when present for classification", async () => {
    const topOnly = { ...sampleTop, category: "mystery" };
    const bottomOnly = { ...sampleBottom, category: "mystery" };
    const engine = new OutfitRecommendationEngine([topOnly, bottomOnly]);
    const results = await engine.recommend({
      occasion: "casual",
      maxResults: 5,
      minScore: 0,
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].top.clothingType).toBe("top");
    expect(results[0].bottom.clothingType).toBe("bottom");
  });

  it("accepts feedback without throwing", () => {
    const engine = new OutfitRecommendationEngine([sampleTop, sampleBottom]);
    expect(() => {
      engine.addFeedback("1", "2", true);
      engine.addFeedback("1", "2", false);
    }).not.toThrow();
  });
});
