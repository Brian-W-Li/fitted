import {
  OutfitRecommendationEngine,
  type WardrobeItemML,
  type PairScorer,
} from "@/lib/recommendationEngine";

const PAIR_FEATURE_DIM = 160;

describe("Recommendation flow integration (engine + PairScorer)", () => {
  const tops: WardrobeItemML[] = [
    {
      id: "t1",
      name: "White Tee",
      clothingType: "top",
      category: "t-shirt",
      colors: ["white"],
      formality: "casual",
      occasions: ["Casual"],
      seasons: ["All"],
    },
    {
      id: "t2",
      name: "Gray Hoodie",
      clothingType: "top",
      category: "hoodie",
      colors: ["gray"],
      formality: "casual",
      occasions: ["Casual", "Athletic"],
      seasons: ["All"],
    },
  ];

  const bottoms: WardrobeItemML[] = [
    {
      id: "b1",
      name: "Blue Jeans",
      clothingType: "bottom",
      category: "jeans",
      colors: ["blue"],
      formality: "casual",
      occasions: ["Casual"],
      seasons: ["All"],
    },
    {
      id: "b2",
      name: "Black Shorts",
      clothingType: "bottom",
      category: "shorts",
      colors: ["black"],
      formality: "casual",
      occasions: ["Casual", "Athletic"],
      seasons: ["Summer"],
    },
  ];

  const items = [...tops, ...bottoms];

  it("uses PairScorer batch scores in recommendations", async () => {
    let callCount = 0;
    const mockScorer: PairScorer = {
      async predictBatch(features: number[][]) {
        callCount++;
        expect(features.length).toBe(4);
        expect(features.every((row) => row.length === PAIR_FEATURE_DIM)).toBe(
          true
        );
        return features.map(() => 0.9);
      },
    };

    const engine = new OutfitRecommendationEngine(items, [], mockScorer);
    const results = await engine.recommend({
      occasion: "casual",
      maxResults: 5,
      minScore: 0,
    });

    expect(callCount).toBe(1);
    expect(results.length).toBeGreaterThanOrEqual(1);
    results.forEach((rec) => {
      expect(rec.top).toBeDefined();
      expect(rec.bottom).toBeDefined();
      expect(rec.score).toBeGreaterThanOrEqual(0);
      expect(rec.reasons).toBeDefined();
      expect(Array.isArray(rec.reasons)).toBe(true);
    });
  });

  it("runs without PairScorer (rule-based + neural fallback)", async () => {
    const engine = new OutfitRecommendationEngine(items, [], null);
    const results = await engine.recommend({
      occasion: "casual",
      maxResults: 5,
      minScore: 0,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]).toHaveProperty("top");
    expect(results[0]).toHaveProperty("bottom");
    expect(results[0]).toHaveProperty("score");
    expect(results[0]).toHaveProperty("reasons");
  });
});
