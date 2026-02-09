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

  private isNeutral(color: string): boolean {
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
          totalScore += 0.85;
        } else if (neutral1 || neutral2) {
          totalScore += 0.9;
        } else {
          const [h1] = this.getHSL(c1);
          const [h2] = this.getHSL(c2);
          const hueDiff = Math.abs(h1 - h2);
          const normalizedDiff = Math.min(hueDiff, 360 - hueDiff);
          
          if (normalizedDiff < 30) totalScore += 0.85;
          else if (normalizedDiff >= 150 && normalizedDiff <= 210) totalScore += 0.9;
          else if (normalizedDiff >= 90 && normalizedDiff <= 150) totalScore += 0.75;
          else if (normalizedDiff >= 60 && normalizedDiff <= 90) totalScore += 0.8;
          else totalScore += 0.5;
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
    
    const occasions = ["everyday", "work", "formal", "casual", "athletic", "going out",
      "date night", "wedding", "interview", "weekend", "vacation", "party"];
    
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
  private occasionWhitelist: Record<string, string[]> = {
    athletic: ["tank", "athletic", "sports", "workout", "gym", "running", "jogger", "sweatpant", "legging", "shorts", "t-shirt", "tee", "hoodie"],
    formal: ["blazer", "dress shirt", "dress pants", "slacks", "suit", "formal", "button"],
    business: ["blazer", "dress shirt", "polo", "chino", "slacks", "dress pants", "button", "formal"],
    casual: ["t-shirt", "tee", "jeans", "shorts", "hoodie", "sweater", "polo", "chino", "khaki"],
    "going out": ["dress", "blazer", "button", "jeans", "chino", "blouse", "nice"],
  };

  private occasionBlacklist: Record<string, string[]> = {
    athletic: ["dress pants", "slacks", "blazer", "polo", "chino", "jeans", "formal", "button", "dress shirt", "khaki"],
    formal: ["shorts", "hoodie", "sweatpants", "joggers", "tank", "athletic", "t-shirt", "tee", "jeans"],
    business: ["shorts", "hoodie", "sweatpants", "joggers", "tank", "athletic", "ripped"],
    casual: ["blazer", "suit", "formal"],
    "going out": ["sweatpants", "joggers", "athletic", "gym", "workout"],
  };

  private strictOccasions = new Set(["athletic", "formal"]);

  matchOccasion(item: WardrobeItemML, targetOccasion: string): number {
    const itemOccasions = item.occasions || [];
    const itemCategory = item.category?.toLowerCase() || "";
    const itemName = item.name?.toLowerCase() || "";
    const itemFormality = item.formality?.toLowerCase() || "";
    const combined = `${itemCategory} ${itemName} ${itemFormality}`;
    const targetNorm = targetOccasion.toLowerCase();

    const blacklist = this.occasionBlacklist[targetNorm] || [];
    for (const blocked of blacklist) {
      if (combined.includes(blocked)) return 0;
    }

    for (const occ of itemOccasions) {
      if (occ.toLowerCase() === targetNorm || occ.toLowerCase().includes(targetNorm)) {
        return 1.0;
      }
    }

    const whitelist = this.occasionWhitelist[targetNorm] || [];
    let whitelistMatch = false;
    for (const allowed of whitelist) {
      if (combined.includes(allowed)) {
        whitelistMatch = true;
        break;
      }
    }

    if (this.strictOccasions.has(targetNorm)) {
      return whitelistMatch ? 0.8 : 0;
    }

    if (whitelistMatch) return 0.8;

    return 0.3;
  }

  matchSeason(item: WardrobeItemML): number {
    const seasons = item.seasons || [];
    if (seasons.length === 0) return 0.8;
    
    const month = new Date().getMonth();
    const currentSeason = month >= 2 && month <= 4 ? "Spring" :
                         month >= 5 && month <= 7 ? "Summer" :
                         month >= 8 && month <= 10 ? "Fall" : "Winter";
    
    for (const season of seasons) {
      const s = season.toLowerCase();
      if (s === "all" || s === "all seasons" || s === currentSeason.toLowerCase()) {
        return 1.0;
      }
    }
    
    if (seasons.length >= 3) return 0.85;
    return 0.7;
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
    if (item.clothingType) return item.clothingType;
    if (item.cvMetadata?.category?.value) return item.cvMetadata.category.value;
    
    const category = (item.category || "").toLowerCase();
    for (const keyword of this.upperKeywords) {
      if (category.includes(keyword)) return "top";
    }
    for (const keyword of this.lowerKeywords) {
      if (category.includes(keyword)) return "bottom";
    }
    return "top";
  }
}

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

  constructor(items: WardrobeItemML[], feedbackHistory: UserFeedback[] = []) {
    this.items = items;
    this.embeddingLayer = new EmbeddingLayer();
    this.neuralNetwork = new NeuralNetwork(this.embeddingLayer.getDimension() * 2);
    this.matrixFactorization = new MatrixFactorization();
    this.contextMatcher = new ContextMatcher();
    this.categoryTaxonomy = new CategoryTaxonomy();
    this.colorAnalyzer = new ColorHarmonyAnalyzer();
    
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
    
    const pairInput = [...topEmb, ...bottomEmb];
    const neuralScore = this.neuralNetwork.predict(pairInput);
    
    const collabScore = this.matrixFactorization.getPairScore(this.userId, top.id, bottom.id);
    
    const seasonScore = (this.contextMatcher.matchSeason(top) + this.contextMatcher.matchSeason(bottom)) / 2;
    
    const finalScore = (
      occasionScore * 35 +
      colorScore * 25 +
      neuralScore * 15 +
      collabScore * 15 +
      seasonScore * 10
    );
    
    if (neuralScore > 0.7) reasons.push("AI predicts high compatibility");
    if (collabScore > 0.6) reasons.push("Based on your preferences");
    if (occasionScore > 0.8) reasons.push(`Perfect for ${occasion}`);
    if (seasonScore > 0.8) reasons.push("Great for current season");
    
    return { score: Math.min(100, Math.max(0, finalScore)), reasons };
  }

  recommend(options: { occasion?: string; maxResults?: number; minScore?: number } = {}): OutfitRecommendation[] {
    const { occasion = "casual", maxResults = 5, minScore = 35 } = options;
    
    const tops = this.items.filter(item => this.categoryTaxonomy.classify(item) === "top");
    const bottoms = this.items.filter(item => this.categoryTaxonomy.classify(item) === "bottom");
    
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
    const topUsageCount = new Map<string, number>();
    const bottomUsageCount = new Map<string, number>();
    const maxItemUsage = Math.max(2, Math.ceil(maxResults / 3));
    
    for (const candidate of candidates) {
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
