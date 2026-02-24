/** CV metadata JSON from vision pipeline: color (hex), category top/bottom, type, pattern, style. */
export interface CVMetadata {
  color_primary: { value: string; confidence: number };
  category: { value: "top" | "bottom"; confidence: number };
  type: { value: string; confidence: number };
  pattern: { value: string; confidence: number };
  style: { value: string; confidence: number };
}

/** Map CV hex color to palette name for embedding/harmony (no CV → unchanged behavior). */
function hexToColorName(hex: string): string {
  const h = hex.replace(/^#/, "").trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(h)) return hex;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0, hue = 0;
  if (max !== min) {
    s = l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
    if (max === r) hue = ((g - b) / (max - min)) % 6;
    else if (max === g) hue = (b - r) / (max - min) + 2;
    else hue = (r - g) / (max - min) + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  if (s < 0.15 || l > 0.92) return "white";
  if (l < 0.15) return "black";
  if (s < 0.2) return l < 0.35 ? "charcoal" : l < 0.6 ? "gray" : "light gray";
  const hueMap: [number, number, string][] = [
    [0, 30, "red"], [30, 60, "orange"], [60, 90, "yellow"], [90, 170, "green"],
    [170, 260, "blue"], [260, 320, "purple"], [320, 360, "pink"],
  ];
  for (const [lo, hi, name] of hueMap) {
    if (hue >= lo && hue < hi) return name;
  }
  return "gray";
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

/** Optional: inject ONNX (or other) model for pair compatibility. Input: 160-dim pair features → score 0–1. */
export type PairScorer = {
  predictBatch(features: number[][]): Promise<number[]>;
};

interface UserFeedback {
  itemIds: string[];
  action: "accepted" | "rejected";
}

class VectorMath {
  static dot(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * (b[i] || 0), 0);
  }

  static add(a: number[], b: number[]): number[] {
    return a.map((val, i) => val + (b[i] || 0));
  }

  static subtract(a: number[], b: number[]): number[] {
    return a.map((val, i) => val - (b[i] || 0));
  }

  static scale(a: number[], scalar: number): number[] {
    return a.map(val => val * scalar);
  }

  static magnitude(a: number[]): number {
    return Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  }

  static normalize(a: number[]): number[] {
    const mag = this.magnitude(a);
    return mag > 0 ? a.map(val => val / mag) : a;
  }

  static cosineSimilarity(a: number[], b: number[]): number {
    const dot = this.dot(a, b);
    const magA = this.magnitude(a);
    const magB = this.magnitude(b);
    return magA > 0 && magB > 0 ? dot / (magA * magB) : 0;
  }

  static sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
  }

  static relu(x: number): number {
    return Math.max(0, x);
  }

  static softmax(arr: number[]): number[] {
    const max = Math.max(...arr);
    const exps = arr.map(x => Math.exp(x - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / sum);
  }
}

class ColorHarmonyAnalyzer {
  private colorHSL: Map<string, [number, number, number]> = new Map([
    ["black", [0, 0, 10]], ["white", [0, 0, 100]], ["gray", [0, 0, 50]], ["grey", [0, 0, 50]],
    ["red", [0, 100, 50]], ["blue", [240, 100, 50]], ["navy", [240, 100, 25]],
    ["green", [120, 100, 35]], ["yellow", [60, 100, 50]], ["orange", [30, 100, 50]],
    ["purple", [280, 100, 40]], ["pink", [350, 80, 75]], ["brown", [30, 60, 30]],
    ["beige", [40, 30, 85]], ["khaki", [45, 35, 65]], ["tan", [35, 45, 60]],
    ["cream", [50, 50, 95]], ["maroon", [0, 70, 30]], ["olive", [60, 60, 35]],
    ["teal", [180, 100, 35]], ["coral", [15, 90, 65]], ["burgundy", [345, 80, 30]],
    ["charcoal", [0, 0, 25]], ["ivory", [50, 50, 95]], ["lavender", [270, 50, 80]],
    ["light gray", [0, 0, 70]], ["dark gray", [0, 0, 30]], ["light blue", [200, 70, 75]],
  ]);

  private getHSL(color: string): [number, number, number] {
    const normalized = color.toLowerCase().trim();
    if (this.colorHSL.has(normalized)) return this.colorHSL.get(normalized)!;
    for (const [name, hsl] of this.colorHSL.entries()) {
      if (normalized.includes(name) || name.includes(normalized)) return hsl;
    }
    return [0, 0, 50];
  }

  private fashionNeutrals = new Set([
    "black", "white", "gray", "grey", "navy", "charcoal", "cream", "ivory",
    "beige", "khaki", "tan", "brown", "light gray", "dark gray",
  ]);

  private isNeutral(color: string): boolean {
    const normalized = color.toLowerCase().trim();
    if (this.fashionNeutrals.has(normalized)) return true;
    const [, saturation, lightness] = this.getHSL(color);
    return saturation < 20 || lightness > 85 || lightness < 15;
  }

  scoreColorHarmony(colors1: string[], colors2: string[]): number {
    if (!colors1.length || !colors2.length) return 0.7;
    
    let totalScore = 0;
    let comparisons = 0;
    
    for (const c1 of colors1) {
      for (const c2 of colors2) {
        const neutral1 = this.isNeutral(c1);
        const neutral2 = this.isNeutral(c2);
        
        if (neutral1 && neutral2) {
          totalScore += 0.92;
        } else if (neutral1 || neutral2) {
          totalScore += 0.95;
        } else {
          const [h1, s1] = this.getHSL(c1);
          const [h2, s2] = this.getHSL(c2);
          const hueDiff = Math.abs(h1 - h2);
          const normalizedDiff = Math.min(hueDiff, 360 - hueDiff);
          const avgSat = (s1 + s2) / 2;
          const satPenalty = avgSat > 60 ? 0.92 : 1.0;

          if (normalizedDiff < 15) totalScore += 0.88 * satPenalty;
          else if (normalizedDiff < 30) totalScore += 0.82 * satPenalty;
          else if (normalizedDiff >= 150) totalScore += 0.78 * satPenalty;
          else if (normalizedDiff >= 60 && normalizedDiff < 90) totalScore += 0.6 * satPenalty;
          else if (normalizedDiff >= 90 && normalizedDiff < 150) totalScore += 0.55 * satPenalty;
          else totalScore += 0.35 * satPenalty;
        }
        comparisons++;
      }
    }
    
    return comparisons > 0 ? totalScore / comparisons : 0.7;
  }

  getColorReason(colors1: string[], colors2: string[]): string | null {
    if (!colors1.length || !colors2.length) return null;
    
    const c1 = colors1[0];
    const c2 = colors2[0];
    const neutral1 = this.isNeutral(c1);
    const neutral2 = this.isNeutral(c2);
    
    if (neutral1 && neutral2) return "Classic neutral pairing";
    if (neutral1 || neutral2) return "Neutral pairs with any color";
    
    const [h1] = this.getHSL(c1);
    const [h2] = this.getHSL(c2);
    const hueDiff = Math.abs(h1 - h2);
    const normalizedDiff = Math.min(hueDiff, 360 - hueDiff);
    
    if (normalizedDiff < 30) return "Monochromatic color scheme";
    if (normalizedDiff >= 150 && normalizedDiff <= 210) return "Complementary colors";
    if (normalizedDiff >= 90 && normalizedDiff <= 150) return "Triadic color harmony";
    return null;
  }
}

class EmbeddingLayer {
  private colorEmbeddings: Map<string, number[]> = new Map();
  private styleEmbeddings: Map<string, number[]> = new Map();
  private occasionEmbeddings: Map<string, number[]> = new Map();
  private seasonEmbeddings: Map<string, number[]> = new Map();
  private categoryEmbeddings: Map<string, number[]> = new Map();
  
  private embeddingDim = 16;

  constructor() {
    this.initializeEmbeddings();
  }

  private initializeEmbeddings(): void {
    const colors = ["black", "white", "gray", "grey", "red", "blue", "navy", "green", 
      "yellow", "orange", "purple", "pink", "brown", "beige", "khaki", "tan", "cream",
      "maroon", "olive", "teal", "coral", "burgundy", "charcoal", "ivory", "lavender"];
    
    const styles = ["casual", "formal", "business", "athletic", "streetwear", "bohemian",
      "preppy", "minimalist", "vintage", "smart casual", "business casual"];
    
    const occasions = ["everyday", "work", "formal", "casual", "athletic", "streetwear",
      "business", "wedding", "interview", "weekend", "vacation", "party"];
    
    const seasons = ["spring", "summer", "fall", "winter", "all"];
    
    const categories = ["t-shirt", "shirt", "polo", "hoodie", "sweater", "jacket", "blazer",
      "jeans", "pants", "shorts", "skirt", "chinos", "sweatpants", "dress"];

    colors.forEach(c => this.colorEmbeddings.set(c, this.generateEmbedding(c, "color")));
    styles.forEach(s => this.styleEmbeddings.set(s, this.generateEmbedding(s, "style")));
    occasions.forEach(o => this.occasionEmbeddings.set(o, this.generateEmbedding(o, "occasion")));
    seasons.forEach(s => this.seasonEmbeddings.set(s, this.generateEmbedding(s, "season")));
    categories.forEach(c => this.categoryEmbeddings.set(c, this.generateEmbedding(c, "category")));
  }

  private generateEmbedding(value: string, type: string): number[] {
    const seed = this.hashString(value + type);
    const embedding: number[] = [];
    for (let i = 0; i < this.embeddingDim; i++) {
      embedding.push((this.seededRandom(seed + i) - 0.5) * 2);
    }
    return VectorMath.normalize(embedding);
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private seededRandom(seed: number): number {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  private getEmbedding(value: string, embeddings: Map<string, number[]>): number[] {
    const normalized = value.toLowerCase().trim();
    if (embeddings.has(normalized)) {
      return embeddings.get(normalized)!;
    }
    for (const [key, emb] of embeddings.entries()) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return emb;
      }
    }
    return new Array(this.embeddingDim).fill(0);
  }

  /** 80-dim per item. Uses fused fields (colors, formality, category) which may come from CV when present; no CV = unchanged. */
  getItemEmbedding(item: WardrobeItemML): number[] {
    const colorEmbs = (item.colors || []).map(c => this.getEmbedding(c, this.colorEmbeddings));
    const avgColorEmb = this.averageEmbeddings(colorEmbs);
    const styleEmb = this.getEmbedding(item.formality || "casual", this.styleEmbeddings);
    const occasionEmbs = (item.occasions || []).map(o => this.getEmbedding(o, this.occasionEmbeddings));
    const avgOccasionEmb = this.averageEmbeddings(occasionEmbs);
    const seasonEmbs = (item.seasons || []).map(s => this.getEmbedding(s, this.seasonEmbeddings));
    const avgSeasonEmb = this.averageEmbeddings(seasonEmbs);
    const categoryEmb = this.getEmbedding(item.category || "", this.categoryEmbeddings);
    return [...avgColorEmb, ...styleEmb, ...avgOccasionEmb, ...avgSeasonEmb, ...categoryEmb];
  }

  private averageEmbeddings(embeddings: number[][]): number[] {
    if (embeddings.length === 0) return new Array(this.embeddingDim).fill(0);
    const sum = embeddings.reduce((acc, emb) => VectorMath.add(acc, emb), 
      new Array(this.embeddingDim).fill(0));
    return VectorMath.scale(sum, 1 / embeddings.length);
  }

  getDimension(): number {
    return this.embeddingDim * 5;
  }
}

class NeuralNetwork {
  private weights1: number[][];
  private bias1: number[];
  private weights2: number[][];
  private bias2: number[];
  private weights3: number[];
  private bias3: number;
  
  private inputDim: number;
  private hiddenDim1 = 32;
  private hiddenDim2 = 16;
  private learningRate = 0.01;

  constructor(inputDim: number) {
    this.inputDim = inputDim;
    this.weights1 = this.initWeights(inputDim, this.hiddenDim1);
    this.bias1 = new Array(this.hiddenDim1).fill(0);
    this.weights2 = this.initWeights(this.hiddenDim1, this.hiddenDim2);
    this.bias2 = new Array(this.hiddenDim2).fill(0);
    this.weights3 = this.initWeights1D(this.hiddenDim2);
    this.bias3 = 0;
  }

  private initWeights(rows: number, cols: number): number[][] {
    const scale = Math.sqrt(2 / rows);
    return Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => (Math.random() - 0.5) * 2 * scale)
    );
  }

  private initWeights1D(size: number): number[] {
    const scale = Math.sqrt(2 / size);
    return Array.from({ length: size }, () => (Math.random() - 0.5) * 2 * scale);
  }

  forward(input: number[]): { output: number; hidden1: number[]; hidden2: number[]; activated1: number[]; activated2: number[] } {
    const hidden1 = new Array(this.hiddenDim1).fill(0);
    for (let j = 0; j < this.hiddenDim1; j++) {
      for (let i = 0; i < this.inputDim; i++) {
        hidden1[j] += input[i] * this.weights1[i][j];
      }
      hidden1[j] += this.bias1[j];
    }
    const activated1 = hidden1.map(x => VectorMath.relu(x));

    const hidden2 = new Array(this.hiddenDim2).fill(0);
    for (let j = 0; j < this.hiddenDim2; j++) {
      for (let i = 0; i < this.hiddenDim1; i++) {
        hidden2[j] += activated1[i] * this.weights2[i][j];
      }
      hidden2[j] += this.bias2[j];
    }
    const activated2 = hidden2.map(x => VectorMath.relu(x));

    let output = this.bias3;
    for (let i = 0; i < this.hiddenDim2; i++) {
      output += activated2[i] * this.weights3[i];
    }
    output = VectorMath.sigmoid(output);

    return { output, hidden1, hidden2, activated1, activated2 };
  }

  train(input: number[], target: number): number {
    const { output, activated1, activated2 } = this.forward(input);
    const error = output - target;
    const loss = 0.5 * error * error;

    const dOutput = error * output * (1 - output);

    const dHidden2 = new Array(this.hiddenDim2).fill(0);
    for (let i = 0; i < this.hiddenDim2; i++) {
      dHidden2[i] = dOutput * this.weights3[i] * (activated2[i] > 0 ? 1 : 0);
      this.weights3[i] -= this.learningRate * dOutput * activated2[i];
    }
    this.bias3 -= this.learningRate * dOutput;

    const dHidden1 = new Array(this.hiddenDim1).fill(0);
    for (let i = 0; i < this.hiddenDim1; i++) {
      for (let j = 0; j < this.hiddenDim2; j++) {
        dHidden1[i] += dHidden2[j] * this.weights2[i][j];
        this.weights2[i][j] -= this.learningRate * dHidden2[j] * activated1[i];
      }
      dHidden1[i] *= activated1[i] > 0 ? 1 : 0;
    }
    for (let j = 0; j < this.hiddenDim2; j++) {
      this.bias2[j] -= this.learningRate * dHidden2[j];
    }

    for (let i = 0; i < this.inputDim; i++) {
      for (let j = 0; j < this.hiddenDim1; j++) {
        this.weights1[i][j] -= this.learningRate * dHidden1[j] * input[i];
      }
    }
    for (let j = 0; j < this.hiddenDim1; j++) {
      this.bias1[j] -= this.learningRate * dHidden1[j];
    }

    return loss;
  }

  predict(input: number[]): number {
    return this.forward(input).output;
  }

  getWeights(): { w1: number[][]; b1: number[]; w2: number[][]; b2: number[]; w3: number[]; b3: number } {
    return {
      w1: this.weights1,
      b1: this.bias1,
      w2: this.weights2,
      b2: this.bias2,
      w3: this.weights3,
      b3: this.bias3
    };
  }

  loadWeights(weights: { w1: number[][]; b1: number[]; w2: number[][]; b2: number[]; w3: number[]; b3: number }): void {
    this.weights1 = weights.w1;
    this.bias1 = weights.b1;
    this.weights2 = weights.w2;
    this.bias2 = weights.b2;
    this.weights3 = weights.w3;
    this.bias3 = weights.b3;
  }
}

class MatrixFactorization {
  private userFactors = new Map<string, number[]>();
  private itemFactors = new Map<string, number[]>();
  private latentDim = 8;
  private learningRate = 0.01;
  private regularization = 0.01;

  private getOrCreateFactor(id: string, factors: Map<string, number[]>): number[] {
    if (!factors.has(id)) {
      factors.set(id, Array.from({ length: this.latentDim }, () => (Math.random() - 0.5) * 0.1));
    }
    return factors.get(id)!;
  }

  predict(userId: string, itemId: string): number {
    const userFactor = this.getOrCreateFactor(userId, this.userFactors);
    const itemFactor = this.getOrCreateFactor(itemId, this.itemFactors);
    return VectorMath.sigmoid(VectorMath.dot(userFactor, itemFactor));
  }

  train(userId: string, itemId: string, rating: number): void {
    const userFactor = this.getOrCreateFactor(userId, this.userFactors);
    const itemFactor = this.getOrCreateFactor(itemId, this.itemFactors);
    
    const prediction = VectorMath.dot(userFactor, itemFactor);
    const error = rating - VectorMath.sigmoid(prediction);
    const sigmoidGrad = VectorMath.sigmoid(prediction) * (1 - VectorMath.sigmoid(prediction));

    for (let k = 0; k < this.latentDim; k++) {
      const userGrad = -error * sigmoidGrad * itemFactor[k] + this.regularization * userFactor[k];
      const itemGrad = -error * sigmoidGrad * userFactor[k] + this.regularization * itemFactor[k];
      userFactor[k] -= this.learningRate * userGrad;
      itemFactor[k] -= this.learningRate * itemGrad;
    }
  }

  trainPair(userId: string, topId: string, bottomId: string, rating: number): void {
    this.train(userId, topId, rating);
    this.train(userId, bottomId, rating);
    const pairId = [topId, bottomId].sort().join("|");
    this.train(userId, pairId, rating);
  }

  getPairScore(userId: string, topId: string, bottomId: string): number {
    const topScore = this.predict(userId, topId);
    const bottomScore = this.predict(userId, bottomId);
    const pairId = [topId, bottomId].sort().join("|");
    const pairScore = this.predict(userId, pairId);
    return (topScore + bottomScore + pairScore * 2) / 4;
  }
}

class ContextMatcher {
  private occasionAliases: Record<string, string[]> = {
    athletic: ["athletic", "workout", "gym", "sports", "exercise"],
    formal: ["formal", "business", "work", "office", "professional", "black tie", "gala", "date night", "date", "romantic", "semi-formal", "interview", "wedding"],
    casual: ["casual", "everyday", "relaxed"],
    streetwear: ["streetwear", "street", "going out", "party", "nightlife", "clubbing", "urban", "hype"],
  };

  private categoryFormality: [string, number][] = [
    ["tank top", 1], ["sports bra", 1], ["sweatpant", 1], ["sweat pant", 1],
    ["jogger", 1], ["legging", 1], ["athletic short", 1], ["running short", 1],
    ["dress shirt", 4], ["button-down", 4], ["button down", 4],
    ["dress pants", 4], ["dress pant", 4],
    ["tank", 1], ["compression", 1],
    ["t-shirt", 2], ["tee", 2], ["hoodie", 2], ["sweatshirt", 2],
    ["jeans", 2], ["jean", 2], ["shorts", 2], ["denim", 2],
    ["polo", 3], ["sweater", 3], ["cardigan", 3], ["pullover", 3],
    ["chino", 3], ["khaki", 3], ["jacket", 3], ["blouse", 3],
    ["slacks", 4], ["trouser", 4],
    ["blazer", 5], ["suit", 5], ["tuxedo", 5],
  ];

  private formalityLevels: Record<string, number> = {
    "very casual": 1, "casual": 2, "relaxed": 2, "smart casual": 3,
    "business casual": 3, "business": 4, "formal": 5, "semi-formal": 4,
  };

  private occasionFormalityRange: Record<string, [number, number]> = {
    athletic: [1, 2],
    casual: [1, 3],
    streetwear: [1, 4],
    formal: [3, 5],
  };

  private getItemFormalityLevel(item: WardrobeItemML): number {
    const text = `${(item.category || "").toLowerCase()} ${(item.name || "").toLowerCase()}`;
    for (const [keyword, level] of this.categoryFormality) {
      if (text.includes(keyword)) return level;
    }
    const f = (item.formality || "").toLowerCase();
    return this.formalityLevels[f] || 2;
  }

  matchOccasion(item: WardrobeItemML, targetOccasion: string): number {
    const targetNorm = targetOccasion.toLowerCase();
    const itemOccasions = (item.occasions || []).map(o => o.toLowerCase());
    const aliases = this.occasionAliases[targetNorm] || [targetNorm];

    const hasExplicitTag = itemOccasions.some(occ =>
      aliases.some(alias => occ === alias)
    );

    const itemFormality = this.getItemFormalityLevel(item);
    const [minF, maxF] = this.occasionFormalityRange[targetNorm] || [1, 5];

    let formalityFit: number;
    if (itemFormality >= minF && itemFormality <= maxF) {
      formalityFit = 1.0;
    } else {
      const distance = itemFormality < minF ? minF - itemFormality : itemFormality - maxF;
      formalityFit = distance === 1 ? 0.3 : 0;
    }

    if (hasExplicitTag && formalityFit >= 1.0) return 1.0;
    if (hasExplicitTag) return 0.4;
    if (formalityFit >= 1.0) return 0.8;
    if (formalityFit > 0) return 0.15;
    return 0;
  }

  matchSeason(item: WardrobeItemML): number {
    const seasons = item.seasons || [];
    if (seasons.length === 0) return 0.8;

    const month = new Date().getMonth();
    const currentSeason = month >= 2 && month <= 4 ? "spring" :
                         month >= 5 && month <= 7 ? "summer" :
                         month >= 8 && month <= 10 ? "fall" : "winter";

    const normalizedSeasons = seasons.map(s => s.toLowerCase());
    if (normalizedSeasons.some(s => s === "all" || s === "all seasons" || s === currentSeason)) {
      return 1.0;
    }

    const opposites: Record<string, string> = {
      spring: "fall", summer: "winter", fall: "spring", winter: "summer",
    };
    const opposite = opposites[currentSeason];
    if (opposite && normalizedSeasons.length <= 2 && normalizedSeasons.every(s => s === opposite)) {
      return 0.2;
    }

    if (seasons.length >= 3) return 0.85;
    return 0.6;
  }

  getItemFormality(item: WardrobeItemML): number {
    return this.getItemFormalityLevel(item);
  }

  getFormalityRange(occasion: string): [number, number] {
    return this.occasionFormalityRange[occasion.toLowerCase()] || [1, 5];
  }
}

class CategoryTaxonomy {
  private upperKeywords = new Set([
    "shirt", "t-shirt", "tee", "top", "blouse", "sweater", "hoodie", "jacket",
    "coat", "cardigan", "vest", "tank", "polo", "henley", "pullover", "sweatshirt",
    "blazer", "tunic", "crop", "camisole", "bodysuit", "turtleneck", "flannel"
  ]);
  
  private lowerKeywords = new Set([
    "jean", "jeans", "pant", "pants", "short", "shorts", "skirt", "trouser",
    "trousers", "chino", "chinos", "sweatpant", "sweatpants", "legging", "leggings",
    "jogger", "joggers", "cargo", "khaki", "khakis", "denim", "slacks"
  ]);

  classify(item: WardrobeItemML): "top" | "bottom" {
    const category = (item.category || "").toLowerCase();
    const name = (item.name || "").toLowerCase();
    const text = `${category} ${name}`;

    for (const keyword of this.lowerKeywords) {
      if (text.includes(keyword)) return "bottom";
    }
    for (const keyword of this.upperKeywords) {
      if (text.includes(keyword)) return "top";
    }

    if (item.clothingType) return item.clothingType;
    if (item.cvMetadata?.category?.value) return item.cvMetadata.category.value;
    return "top";
  }
}

const PAIR_FEATURE_DIM = 160;

/** Flow: CV JSON → fused item (toMLItem) → 80-dim → 160-dim pair → scoring.
 *  Rules (occasion 40% + color 30%) dominate. ONNX (synthetic data) is only a gentle
 *  reranker (~5 pt adjustment) on already-good candidates; disable or replace once a
 *  model trained on real user data is available. */
export class OutfitRecommendationEngine {
  private items: WardrobeItemML[];
  private embeddingLayer: EmbeddingLayer;
  private neuralNetwork: NeuralNetwork;
  private matrixFactorization: MatrixFactorization;
  private contextMatcher: ContextMatcher;
  private categoryTaxonomy: CategoryTaxonomy;
  private colorAnalyzer: ColorHarmonyAnalyzer;
  private userId = "default_user";
  private itemEmbeddings = new Map<string, number[]>();
  private pairScorer: PairScorer | null = null;

  constructor(
    items: WardrobeItemML[],
    feedbackHistory: UserFeedback[] = [],
    pairScorer?: PairScorer | null
  ) {
    this.items = items;
    this.embeddingLayer = new EmbeddingLayer();
    this.neuralNetwork = new NeuralNetwork(this.embeddingLayer.getDimension() * 2);
    this.matrixFactorization = new MatrixFactorization();
    this.contextMatcher = new ContextMatcher();
    this.categoryTaxonomy = new CategoryTaxonomy();
    this.colorAnalyzer = new ColorHarmonyAnalyzer();
    this.pairScorer = pairScorer ?? null;

    this.precomputeEmbeddings();
    this.trainFromFeedback(feedbackHistory);
  }

  private precomputeEmbeddings(): void {
    for (const item of this.items) {
      const embedding = this.embeddingLayer.getItemEmbedding(item);
      this.itemEmbeddings.set(item.id, embedding);
    }
  }

  private trainFromFeedback(feedbackHistory: UserFeedback[]): void {
    for (const feedback of feedbackHistory) {
      if (feedback.itemIds.length >= 2) {
        const [topId, bottomId] = feedback.itemIds;
        const target = feedback.action === "accepted" ? 1 : 0;
        
        const topEmb = this.itemEmbeddings.get(topId);
        const bottomEmb = this.itemEmbeddings.get(bottomId);
        
        if (topEmb && bottomEmb) {
          const pairInput = [...topEmb, ...bottomEmb];
          for (let i = 0; i < 3; i++) {
            this.neuralNetwork.train(pairInput, target);
          }
        }
        
        this.matrixFactorization.trainPair(this.userId, topId, bottomId, target);
      }
    }
  }

  /** Weights: occasion 40% + color 30% + in-memory NN 10% + collaborative 15% + season 5%.
   *  ONNX (trained on synthetic data) is NOT used here; it is applied as a gentle reranker after scoring. */
  private scoreOutfit(top: WardrobeItemML, bottom: WardrobeItemML, occasion: string): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    const topOccasionScore = this.contextMatcher.matchOccasion(top, occasion);
    const bottomOccasionScore = this.contextMatcher.matchOccasion(bottom, occasion);
    if (topOccasionScore === 0 || bottomOccasionScore === 0) {
      return { score: 0, reasons: ["Items not suitable for this occasion"] };
    }
    const occasionScore = (topOccasionScore + bottomOccasionScore) / 2;
    const colorScore = this.colorAnalyzer.scoreColorHarmony(top.colors || [], bottom.colors || []);
    const colorReason = this.colorAnalyzer.getColorReason(top.colors || [], bottom.colors || []);
    if (colorReason) reasons.push(colorReason);
    const topEmb = this.itemEmbeddings.get(top.id) || this.embeddingLayer.getItemEmbedding(top);
    const bottomEmb = this.itemEmbeddings.get(bottom.id) || this.embeddingLayer.getItemEmbedding(bottom);
    const neuralScore = this.neuralNetwork.predict([...topEmb, ...bottomEmb]);
    const collabScore = this.matrixFactorization.getPairScore(this.userId, top.id, bottom.id);
    const seasonScore = (this.contextMatcher.matchSeason(top) + this.contextMatcher.matchSeason(bottom)) / 2;
    const finalScore = (
      occasionScore * 40 +
      colorScore * 30 +
      neuralScore * 10 +
      collabScore * 15 +
      seasonScore * 5
    );
    if (neuralScore > 0.7) reasons.push("AI predicts high compatibility");
    if (collabScore > 0.6) reasons.push("Based on your preferences");
    if (occasionScore > 0.8) reasons.push(`Perfect for ${occasion}`);
    if (seasonScore > 0.8) reasons.push("Great for current season");

    return { score: Math.min(100, Math.max(0, finalScore)), reasons };
  }

  async recommend(
    options: { occasion?: string; maxResults?: number; minScore?: number } = {}
  ): Promise<OutfitRecommendation[]> {
    const { occasion = "casual", maxResults = 5, minScore = 35 } = options;

    const allTops = this.items.filter((item) => this.categoryTaxonomy.classify(item) === "top");
    const allBottoms = this.items.filter((item) => this.categoryTaxonomy.classify(item) === "bottom");

    if (allTops.length === 0 || allBottoms.length === 0) {
      return [];
    }

    // --- Hard pre-filters: reject items clearly wrong for the occasion or season ---
    const [minF, maxF] = this.contextMatcher.getFormalityRange(occasion);
    const currentSeason = this.getCurrentSeason();
    const tops = allTops.filter(t => this.passesHardFilters(t, minF, maxF, currentSeason));
    const bottoms = allBottoms.filter(b => this.passesHardFilters(b, minF, maxF, currentSeason));

    if (tops.length === 0 || bottoms.length === 0) {
      return [];
    }

    // --- Score all pairs using rules + in-memory NN (no ONNX in this stage) ---
    const candidates: OutfitRecommendation[] = [];

    for (const top of tops) {
      for (const bottom of bottoms) {
        if (this.isDuplicateType(top, bottom)) continue;
        const { score, reasons } = this.scoreOutfit(top, bottom, occasion);
        if (score >= minScore) {
          candidates.push({ top, bottom, score: Math.round(score), reasons });
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    // --- Optional ONNX reranker on the top candidates ---
    // NOTE: outfit_model.onnx was trained on synthetic data and is intentionally
    // used only as a gentle reranker (~5 pt max adjustment) until a model trained
    // on real user data is available. It cannot push a bad outfit to the top.
    const RERANKER_POOL_SIZE = 30;
    const ONNX_RERANK_WEIGHT = 5;
    const rerankerPool = candidates.slice(0, RERANKER_POOL_SIZE);

    if (this.pairScorer && rerankerPool.length > 0) {
      const features: number[][] = [];
      for (const c of rerankerPool) {
        const tEmb = this.itemEmbeddings.get(c.top.id) ?? this.embeddingLayer.getItemEmbedding(c.top);
        const bEmb = this.itemEmbeddings.get(c.bottom.id) ?? this.embeddingLayer.getItemEmbedding(c.bottom);
        const pair = [...tEmb, ...bEmb];
        features.push(pair.length === PAIR_FEATURE_DIM ? pair : new Array(PAIR_FEATURE_DIM).fill(0));
      }
      try {
        const onnxScores = await this.pairScorer.predictBatch(features);
        for (let i = 0; i < rerankerPool.length; i++) {
          rerankerPool[i].score = Math.min(100, Math.max(0,
            Math.round(rerankerPool[i].score + (onnxScores[i] - 0.5) * ONNX_RERANK_WEIGHT)
          ));
        }
        rerankerPool.sort((a, b) => b.score - a.score);
      } catch {
        // ONNX failed; keep rule-based scores unchanged
      }
    }

    // --- Diversity: limit how often the same item appears ---
    const finalPool = (this.pairScorer && rerankerPool.length > 0) ? rerankerPool : candidates;
    const results: OutfitRecommendation[] = [];
    const topUsageCount = new Map<string, number>();
    const bottomUsageCount = new Map<string, number>();
    const maxItemUsage = Math.max(2, Math.ceil(maxResults / 3));

    for (const candidate of finalPool) {
      if (results.length >= maxResults) break;

      const topCount = topUsageCount.get(candidate.top.id) || 0;
      const bottomCount = bottomUsageCount.get(candidate.bottom.id) || 0;

      if (topCount < maxItemUsage && bottomCount < maxItemUsage) {
        results.push(candidate);
        topUsageCount.set(candidate.top.id, topCount + 1);
        bottomUsageCount.set(candidate.bottom.id, bottomCount + 1);
      }
    }

    return results;
  }

  private getCurrentSeason(): string {
    const month = new Date().getMonth();
    if (month >= 2 && month <= 4) return "spring";
    if (month >= 5 && month <= 7) return "summer";
    if (month >= 8 && month <= 10) return "fall";
    return "winter";
  }

  /** Hard filter: reject items whose formality is ≥2 levels outside the occasion range,
   *  or items exclusively tagged for the opposite season. */
  private passesHardFilters(
    item: WardrobeItemML, minF: number, maxF: number, currentSeason: string
  ): boolean {
    const formality = this.contextMatcher.getItemFormality(item);
    if (formality < minF - 1 || formality > maxF + 1) return false;

    const seasons = (item.seasons || []).map(s => s.toLowerCase());
    if (seasons.length > 0 && !seasons.some(s => s === "all" || s === "all seasons")) {
      const opposites: Record<string, string> = {
        spring: "fall", summer: "winter", fall: "spring", winter: "summer",
      };
      const opposite = opposites[currentSeason];
      if (opposite && seasons.length <= 2 && seasons.every(s => s === opposite)) return false;
    }
    return true;
  }

  /** Sanity filter: prevent pairing two items of the same core clothing type. */
  private isDuplicateType(top: WardrobeItemML, bottom: WardrobeItemML): boolean {
    const topText = `${top.category || ""} ${top.name || ""}`.toLowerCase();
    const bottomText = `${bottom.category || ""} ${bottom.name || ""}`.toLowerCase();
    const dupeKeywords = ["hoodie", "sweatpant", "jogger", "legging", "tank", "blazer"];
    return dupeKeywords.some(kw => topText.includes(kw) && bottomText.includes(kw));
  }

  addFeedback(topId: string, bottomId: string, liked: boolean): void {
    const target = liked ? 1 : 0;
    
    const topEmb = this.itemEmbeddings.get(topId);
    const bottomEmb = this.itemEmbeddings.get(bottomId);
    
    if (topEmb && bottomEmb) {
      const pairInput = [...topEmb, ...bottomEmb];
      for (let i = 0; i < 5; i++) {
        this.neuralNetwork.train(pairInput, target);
      }
    }
    
    this.matrixFactorization.trainPair(this.userId, topId, bottomId, target);
  }
}

/** Fuse CV metadata into item fields when present: CV color → colors[0], category → clothingType, style → formality, type → category. No CV = same as today. */
export function toMLItem(dbItem: {
  _id: unknown;
  name: string;
  clothingType?: "top" | "bottom";
  category?: string;
  colors?: string[];
  formality?: string;
  seasons?: string[];
  occasions?: string[];
  metadata?: Map<string, unknown> | Record<string, unknown>;
}): WardrobeItemML {
  const raw = dbItem.metadata;
  const cvMetadata = (raw && typeof (raw as Map<string, unknown>).get === "function"
    ? (raw as Map<string, unknown>).get("cv")
    : (raw as Record<string, unknown>)?.["cv"]) as CVMetadata | undefined;
  const colors =
    dbItem.colors?.length
      ? dbItem.colors
      : cvMetadata?.color_primary?.value
        ? [hexToColorName(cvMetadata.color_primary.value)]
        : undefined;
  const clothingType = dbItem.clothingType ?? cvMetadata?.category?.value;
  const formality = dbItem.formality ?? cvMetadata?.style?.value;
  const category = dbItem.category ?? cvMetadata?.type?.value;
  return {
    id: String(dbItem._id),
    name: dbItem.name,
    clothingType,
    category,
    colors,
    formality,
    seasons: dbItem.seasons,
    occasions: dbItem.occasions,
    cvMetadata,
  };
}
