/**
 * ML-based Outfit Recommendation Engine
 * Hybrid recommendation system combining content-based filtering,
 * collaborative filtering, and color theory analysis.
 */

export interface CVMetadata {
  color_primary: { value: string; confidence: number };
  category: { value: "top" | "bottom"; confidence: number };
  type: { value: string; confidence: number };
  pattern: { value: string; confidence: number };
  style: { value: string; confidence: number };
}

export interface WardrobeItemML {
  id: string;
  name: string;
  clothingType?: "top" | "bottom";
  category?: string;
  colors?: string[];
  formality?: string;
  seasons?: string[];
  occasions?: string[];
  cvMetadata?: CVMetadata;
}

export interface OutfitRecommendation {
  top: WardrobeItemML;
  bottom: WardrobeItemML;
  score: number;
  reasons: string[];
}

interface UserFeedback {
  itemIds: string[];
  action: "accepted" | "rejected";
}

class CategoryTaxonomy {
  private upperCategories = new Set<string>();
  private lowerCategories = new Set<string>();
  private categoryCache = new Map<string, "top" | "bottom">();
  
  private readonly upperEmbeddings = [
    "shirt", "t-shirt", "tee", "top", "blouse", "sweater", "hoodie", "jacket",
    "coat", "cardigan", "vest", "tank", "polo", "henley", "pullover", "sweatshirt",
    "blazer", "tunic", "crop", "camisole", "bodysuit", "turtleneck", "flannel"
  ];
  
  private readonly lowerEmbeddings = [
    "jean", "jeans", "pant", "pants", "short", "shorts", "skirt", "trouser",
    "trousers", "chino", "chinos", "sweatpant", "sweatpants", "legging", "leggings",
    "jogger", "joggers", "cargo", "khaki", "khakis", "denim", "slacks"
  ];

  constructor() {
    this.upperEmbeddings.forEach(c => this.upperCategories.add(c.toLowerCase()));
    this.lowerEmbeddings.forEach(c => this.lowerCategories.add(c.toLowerCase()));
  }

  classify(category: string): "top" | "bottom" {
    if (!category) return "top";
    const normalized = category.toLowerCase().trim();
    
    if (this.categoryCache.has(normalized)) {
      return this.categoryCache.get(normalized)!;
    }
    
    if (this.upperCategories.has(normalized)) {
      this.categoryCache.set(normalized, "top");
      return "top";
    }
    if (this.lowerCategories.has(normalized)) {
      this.categoryCache.set(normalized, "bottom");
      return "bottom";
    }
    
    for (const upper of this.upperEmbeddings) {
      if (normalized.includes(upper)) {
        this.categoryCache.set(normalized, "top");
        return "top";
      }
    }
    for (const lower of this.lowerEmbeddings) {
      if (normalized.includes(lower)) {
        this.categoryCache.set(normalized, "bottom");
        return "bottom";
      }
    }
    
    this.categoryCache.set(normalized, "top");
    return "top";
  }
}

class ColorAnalyzer {
  private colorNameMap: Map<string, [number, number, number]> = new Map([
    ["black", [0, 0, 10]], ["white", [0, 0, 100]], ["gray", [0, 0, 50]], ["grey", [0, 0, 50]],
    ["red", [0, 100, 50]], ["blue", [240, 100, 50]], ["navy", [240, 100, 25]],
    ["green", [120, 100, 35]], ["yellow", [60, 100, 50]], ["orange", [30, 100, 50]],
    ["purple", [280, 100, 40]], ["pink", [350, 80, 75]], ["brown", [30, 60, 30]],
    ["beige", [40, 30, 85]], ["khaki", [45, 35, 65]], ["tan", [35, 45, 60]],
    ["cream", [50, 50, 95]], ["maroon", [0, 70, 30]], ["olive", [60, 60, 35]],
    ["teal", [180, 100, 35]], ["coral", [15, 90, 65]], ["burgundy", [345, 80, 30]],
    ["charcoal", [0, 0, 25]], ["ivory", [50, 50, 95]], ["lavender", [270, 50, 80]],
  ]);

  toHSL(color: string): [number, number, number] {
    const normalized = color.toLowerCase().trim();
    if (this.colorNameMap.has(normalized)) {
      return this.colorNameMap.get(normalized)!;
    }
    for (const [name, hsl] of this.colorNameMap.entries()) {
      if (normalized.includes(name) || name.includes(normalized)) {
        return hsl;
      }
    }
    return [0, 0, 50];
  }

  isNeutral(color: string): boolean {
    const [, saturation, lightness] = this.toHSL(color);
    return saturation < 15 || lightness > 90 || lightness < 15;
  }

  colorHarmonyScore(colors1: string[], colors2: string[]): number {
    if (!colors1.length || !colors2.length) return 70;
    
    let totalScore = 0;
    let comparisons = 0;
    
    for (const c1 of colors1) {
      for (const c2 of colors2) {
        if (this.isNeutral(c1) || this.isNeutral(c2)) {
          totalScore += 90;
        } else {
          const [h1] = this.toHSL(c1);
          const [h2] = this.toHSL(c2);
          const hueDiff = Math.abs(h1 - h2);
          const normalizedDiff = Math.min(hueDiff, 360 - hueDiff);
          
          if (normalizedDiff < 30) totalScore += 85;
          else if (normalizedDiff >= 150 && normalizedDiff <= 210) totalScore += 80;
          else if (normalizedDiff >= 60 && normalizedDiff <= 120) totalScore += 75;
          else totalScore += 60;
        }
        comparisons++;
      }
    }
    
    return comparisons > 0 ? totalScore / comparisons : 70;
  }
}

class ContextMatcher {
  private formalityMap: Record<string, string[]> = {
    casual: ["Casual", "Everyday", "Smart Casual"],
    business: ["Business Casual", "Smart Casual"],
    formal: ["Formal"],
    athletic: ["Athletic", "Workout", "Sporty"],
    "going out": ["Going Out", "Evening", "Party"],
  };

  private occasionBlacklist: Record<string, string[]> = {
    formal: ["shorts", "hoodie", "sweatpants", "joggers", "tank", "athletic"],
    business: ["shorts", "hoodie", "sweatpants", "joggers", "tank", "athletic"],
  };

  matchOccasion(item: WardrobeItemML, targetOccasion: string): number {
    const itemOccasions = item.occasions || [];
    const itemFormality = item.formality?.toLowerCase() || "";
    const itemCategory = item.category?.toLowerCase() || "";
    
    const blacklist = this.occasionBlacklist[targetOccasion.toLowerCase()] || [];
    for (const blocked of blacklist) {
      if (itemCategory.includes(blocked)) return 0;
    }
    
    const targetNorm = targetOccasion.toLowerCase();
    for (const occ of itemOccasions) {
      if (occ.toLowerCase() === targetNorm || occ.toLowerCase().includes(targetNorm)) {
        return 1.0;
      }
    }
    
    const formalityMatches = this.formalityMap[targetNorm] || [];
    for (const formality of formalityMatches) {
      if (itemFormality === formality.toLowerCase()) return 0.8;
      for (const occ of itemOccasions) {
        if (occ.toLowerCase() === formality.toLowerCase()) return 0.8;
      }
    }
    
    return 0.4;
  }

  matchSeason(item: WardrobeItemML): number {
    const seasons = item.seasons || [];
    if (seasons.length === 0) return 0.7;
    
    const month = new Date().getMonth();
    const currentSeason = month >= 2 && month <= 4 ? "Spring" :
                         month >= 5 && month <= 7 ? "Summer" :
                         month >= 8 && month <= 10 ? "Fall" : "Winter";
    
    for (const season of seasons) {
      if (season.toLowerCase() === currentSeason.toLowerCase()) return 1.0;
    }
    return 0.5;
  }
}

class CollaborativeFilter {
  private pairBoosts = new Map<string, number>();
  private itemBoosts = new Map<string, number>();

  constructor(feedbackHistory: UserFeedback[]) {
    for (const feedback of feedbackHistory) {
      const ids = feedback.itemIds.sort();
      const pairKey = ids.join("|");
      const boost = feedback.action === "accepted" ? 5 : -5;
      
      this.pairBoosts.set(pairKey, (this.pairBoosts.get(pairKey) || 0) + boost);
      
      for (const id of ids) {
        this.itemBoosts.set(id, (this.itemBoosts.get(id) || 0) + boost * 0.5);
      }
    }
  }

  getBoost(topId: string, bottomId: string): number {
    const pairKey = [topId, bottomId].sort().join("|");
    const pairBoost = this.pairBoosts.get(pairKey) || 0;
    const topBoost = this.itemBoosts.get(topId) || 0;
    const bottomBoost = this.itemBoosts.get(bottomId) || 0;
    return pairBoost + (topBoost + bottomBoost) * 0.3;
  }
}

class FeatureExtractor {
  private taxonomy = new CategoryTaxonomy();

  getCategory(item: WardrobeItemML): "top" | "bottom" {
    if (item.clothingType) return item.clothingType;
    if (item.cvMetadata?.category?.value) return item.cvMetadata.category.value;
    return this.taxonomy.classify(item.category || "");
  }
}

export class OutfitRecommendationEngine {
  private items: WardrobeItemML[];
  private colorAnalyzer = new ColorAnalyzer();
  private contextMatcher = new ContextMatcher();
  private collaborativeFilter: CollaborativeFilter;
  private featureExtractor = new FeatureExtractor();

  constructor(items: WardrobeItemML[], feedbackHistory: UserFeedback[] = []) {
    this.items = items;
    this.collaborativeFilter = new CollaborativeFilter(feedbackHistory);
  }

  private scoreOutfit(top: WardrobeItemML, bottom: WardrobeItemML, occasion: string): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    
    const topOccasionScore = this.contextMatcher.matchOccasion(top, occasion);
    const bottomOccasionScore = this.contextMatcher.matchOccasion(bottom, occasion);
    if (topOccasionScore === 0 || bottomOccasionScore === 0) {
      return { score: 0, reasons: ["Items not suitable for this occasion"] };
    }
    const occasionScore = (topOccasionScore + bottomOccasionScore) / 2;
    
    const colorScore = this.colorAnalyzer.colorHarmonyScore(top.colors || [], bottom.colors || []) / 100;
    if (colorScore > 0.8) reasons.push("Colors complement beautifully");
    else if (colorScore > 0.7) reasons.push("Colors work well together");
    
    const seasonScore = (this.contextMatcher.matchSeason(top) + this.contextMatcher.matchSeason(bottom)) / 2;
    if (seasonScore > 0.8) reasons.push("Great for current season");
    
    const collabBoost = this.collaborativeFilter.getBoost(top.id, bottom.id);
    if (collabBoost > 0) reasons.push("Based on your preferences");
    
    const weightedScore = (
      occasionScore * 30 +
      colorScore * 25 +
      25 +
      seasonScore * 10 +
      10
    ) + collabBoost;
    
    if (occasionScore > 0.8) reasons.push(`Perfect for ${occasion}`);
    
    return { score: Math.min(100, Math.max(0, weightedScore)), reasons };
  }

  recommend(options: { occasion?: string; maxResults?: number; minScore?: number } = {}): OutfitRecommendation[] {
    const { occasion = "casual", maxResults = 5, minScore = 40 } = options;
    
    const tops = this.items.filter(item => this.featureExtractor.getCategory(item) === "top");
    const bottoms = this.items.filter(item => this.featureExtractor.getCategory(item) === "bottom");
    
    if (tops.length === 0 || bottoms.length === 0) {
      return [];
    }
    
    const candidates: OutfitRecommendation[] = [];
    
    for (const top of tops) {
      for (const bottom of bottoms) {
        const { score, reasons } = this.scoreOutfit(top, bottom, occasion);
        if (score >= minScore) {
          candidates.push({ top, bottom, score: Math.round(score), reasons });
        }
      }
    }
    
    candidates.sort((a, b) => b.score - a.score);
    
    const results: OutfitRecommendation[] = [];
    const usedTops = new Set<string>();
    const usedBottoms = new Set<string>();
    
    for (const candidate of candidates) {
      if (results.length >= maxResults) break;
      
      const topUsed = usedTops.has(candidate.top.id);
      const bottomUsed = usedBottoms.has(candidate.bottom.id);
      
      if (!topUsed || !bottomUsed) {
        results.push(candidate);
        usedTops.add(candidate.top.id);
        usedBottoms.add(candidate.bottom.id);
      }
    }
    
    return results;
  }
}

export function toMLItem(dbItem: {
  _id: unknown;
  name: string;
  clothingType?: "top" | "bottom";
  category?: string;
  colors?: string[];
  formality?: string;
  seasons?: string[];
  occasions?: string[];
  metadata?: Map<string, unknown>;
}): WardrobeItemML {
  const cvMetadata = dbItem.metadata?.get?.("cv") as CVMetadata | undefined;
  return {
    id: String(dbItem._id),
    name: dbItem.name,
    clothingType: dbItem.clothingType,
    category: dbItem.category,
    colors: dbItem.colors,
    formality: dbItem.formality,
    seasons: dbItem.seasons,
    occasions: dbItem.occasions,
    cvMetadata,
  };
}
