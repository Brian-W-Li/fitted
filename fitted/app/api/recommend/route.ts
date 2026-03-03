import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const OUTER_LAYER_KEYWORDS = [
  "jacket", "coat", "blazer", "cardigan", "parka", "windbreaker",
  "hoodie", "fleece", "vest", "bomber", "denim jacket", "leather jacket",
  "trench", "overcoat", "puffer", "raincoat", "peacoat"
];

const FORMAL_KEYWORDS = ["dress", "formal", "business", "suit", "blazer", "slacks"];
const CASUAL_KEYWORDS = ["jeans", "t-shirt", "tee", "hoodie", "sneaker", "casual", "jogger", "sweatpants"];
const COLD_WEATHER_EXCLUDE = ["shorts", "tank", "sleeveless"];
const HOT_WEATHER_EXCLUDE = ["sweater", "wool", "fleece", "thermal"];

function detectEventContext(eventText: string): { formality: "casual" | "formal" | "neutral"; weather: "cold" | "hot" | "neutral" } {
  const text = eventText.toLowerCase();
  
  let formality: "casual" | "formal" | "neutral" = "neutral";
  if (["casual", "brunch", "hangout", "friends", "chill", "relaxed", "beach", "picnic"].some(w => text.includes(w))) {
    formality = "casual";
  } else if (["formal", "business", "interview", "wedding", "gala", "meeting", "office", "professional"].some(w => text.includes(w))) {
    formality = "formal";
  }
  
  let weather: "cold" | "hot" | "neutral" = "neutral";
  if (["cold", "winter", "freezing", "chilly", "snow", "windy", "rainy"].some(w => text.includes(w))) {
    weather = "cold";
  } else if (["hot", "summer", "warm", "sunny", "beach", "heat"].some(w => text.includes(w))) {
    weather = "hot";
  }
  
  return { formality, weather };
}

function shouldIncludeItem(item: { name: string; subCategory?: string }, formality: string, weather: string): boolean {
  const combined = `${item.name} ${item.subCategory || ""}`.toLowerCase();
  
  // Filter based on formality
  if (formality === "casual") {
    // For casual events, exclude formal items
    if (FORMAL_KEYWORDS.some(k => combined.includes(k))) return false;
  } else if (formality === "formal") {
    // For formal events, exclude casual items
    if (CASUAL_KEYWORDS.some(k => combined.includes(k) && !combined.includes("dress"))) return false;
  }
  
  // Filter based on weather
  if (weather === "cold") {
    if (COLD_WEATHER_EXCLUDE.some(k => combined.includes(k))) return false;
  } else if (weather === "hot") {
    if (HOT_WEATHER_EXCLUDE.some(k => combined.includes(k))) return false;
  }
  
  return true;
}

function classifyClothingType(category: string, name: string, subCategory?: string): "top" | "bottom" | "outer_layer" | "unknown" {
  const cat = category.toLowerCase();
  const combined = `${category} ${subCategory || ""} ${name}`.toLowerCase();
  
  // Check for outer layers first (these are often categorized as "top" but should be separated)
  for (const keyword of OUTER_LAYER_KEYWORDS) {
    if (combined.includes(keyword)) return "outer_layer";
  }
  
  // Use the category field directly
  if (cat === "bottom") return "bottom";
  if (cat === "top") return "top";
  
  return "unknown";
}

function sampleItems<T>(items: T[], maxCount: number): T[] {
  if (items.length <= maxCount) return items;
  const shuffled = [...items].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, maxCount);
}

async function getUserIdFromRequest(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { error: "Missing or invalid Authorization header", status: 401 };
  }

  const idToken = authHeader.slice("Bearer ".length).trim();
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    const firebaseUid = decoded.uid;

    const { User } = await initDatabase();
    const user = await User.findOne({
      authProvider: "firebase",
      authId: firebaseUid,
    }).exec();

    if (!user) {
      return { error: "User not found", status: 404 };
    }

    return { userId: user._id.toString() };
  } catch (error) {
    console.error("Error verifying Firebase token:", error);
    return { error: "Invalid or expired token", status: 401 };
  }
}

type WardrobeItemLean = {
  _id: { toString(): string };
  name: string;
  category: string;
  subCategory?: string;
  colors?: string[];
  seasons?: string[];
  notes?: string;
  imagePath?: string;
  isAvailable?: boolean;
};

type OutfitItem = {
  id: string;
  name: string;
  category: string;
  colors: string[];
  imagePath?: string;
};

export async function POST(request: NextRequest) {
  try {
    const userResult = await getUserIdFromRequest(request);
    if ("error" in userResult) {
      return NextResponse.json(
        { error: userResult.error },
        { status: userResult.status }
      );
    }

    const { userId } = userResult;
    const body = await request.json();
    const { eventContext } = body;

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key is required for recommendations." },
        { status: 503 }
      );
    }

    const { WardrobeItem, OutfitInteraction } = await initDatabase();

    const docs = (await WardrobeItem.find({ user: userId })
      .lean()
      .exec()) as unknown as WardrobeItemLean[];

    const items = docs.filter((d) => d.isAvailable ?? true);

    const tops: WardrobeItemLean[] = [];
    const bottoms: WardrobeItemLean[] = [];
    const outerLayers: WardrobeItemLean[] = [];

    for (const item of items) {
      const type = classifyClothingType(item.category, item.name, item.subCategory);
      if (type === "top") tops.push(item);
      else if (type === "bottom") bottoms.push(item);
      else if (type === "outer_layer") outerLayers.push(item);
    }

    if (tops.length === 0) {
      return NextResponse.json({
        outfits: [],
        hasOuterLayers: outerLayers.length > 0,
        message: "No tops found in your wardrobe. Add some shirts, sweaters, or t-shirts."
      });
    }
    if (bottoms.length === 0) {
      return NextResponse.json({
        outfits: [],
        hasOuterLayers: outerLayers.length > 0,
        message: "No bottoms found in your wardrobe. Add some pants, jeans, or shorts."
      });
    }

    // Pre-filter items based on event context
    const { formality, weather } = detectEventContext(eventContext || "");
    
    const filteredTops = tops.filter(item => shouldIncludeItem(item, formality, weather));
    const filteredBottoms = bottoms.filter(item => shouldIncludeItem(item, formality, weather));
    
    // Fall back to all items if filtering removes everything
    const topsToUse = filteredTops.length > 0 ? filteredTops : tops;
    const bottomsToUse = filteredBottoms.length > 0 ? filteredBottoms : bottoms;

    const sampledTops = sampleItems(topsToUse, 15);
    const sampledBottoms = sampleItems(bottomsToUse, 15);

    type InteractionDoc = {
      items: Array<{ _id: { toString(): string }; name: string; category: string }>;
      action: string;
      context?: { occasion?: string };
    };

    const interactions = (await OutfitInteraction.find({
      user: userId,
      action: { $in: ["accepted", "rejected"] },
    })
      .populate({ path: "items", select: "name category" })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean()
      .exec()) as unknown as InteractionDoc[];

    const likedOutfits = interactions
      .filter((i) => i.action === "accepted" && i.items?.length >= 2)
      .map((i) => {
        const top = i.items.find((item) => classifyClothingType(item.category, item.name) === "top");
        const bottom = i.items.find((item) => classifyClothingType(item.category, item.name) === "bottom");
        return top && bottom ? `"${top.name}" + "${bottom.name}"` : null;
      })
      .filter(Boolean)
      .slice(0, 5);

    const dislikedOutfits = interactions
      .filter((i) => i.action === "rejected" && i.items?.length >= 2)
      .map((i) => {
        const top = i.items.find((item) => classifyClothingType(item.category, item.name) === "top");
        const bottom = i.items.find((item) => classifyClothingType(item.category, item.name) === "bottom");
        return top && bottom ? `"${top.name}" + "${bottom.name}"` : null;
      })
      .filter(Boolean)
      .slice(0, 5);

    let feedbackSection = "";
    if (likedOutfits.length > 0) {
      feedbackSection += `\nLiked outfits (suggest similar): ${likedOutfits.join(", ")}`;
    }
    if (dislikedOutfits.length > 0) {
      feedbackSection += `\nDisliked outfits (avoid similar): ${dislikedOutfits.join(", ")}`;
    }

    const topsForPrompt = sampledTops.map((item) => {
      const data: Record<string, unknown> = {
        id: item._id.toString(),
        name: item.name,
        type: item.subCategory || item.category,
      };
      if (item.colors?.length) data.colors = item.colors;
      if (item.seasons?.length) data.seasons = item.seasons;
      if (item.notes) data.notes = item.notes;
      return data;
    });

    const bottomsForPrompt = sampledBottoms.map((item) => {
      const data: Record<string, unknown> = {
        id: item._id.toString(),
        name: item.name,
        type: item.subCategory || item.category,
      };
      if (item.colors?.length) data.colors = item.colors;
      if (item.seasons?.length) data.seasons = item.seasons;
      if (item.notes) data.notes = item.notes;
      return data;
    });

    const maxPossibleOutfits = sampledTops.length * sampledBottoms.length;
    const numOutfits = Math.min(5, maxPossibleOutfits);

    // System message for role definition
    const systemMessage = `You are an expert fashion stylist. Your job is to create perfect outfit combinations that match the user's event, considering formality, weather, and color coordination. Think step-by-step before making recommendations.`;

    // Few-shot examples
    const fewShotExamples = `
EXAMPLE 1:
Event: "casual brunch with friends"
Available: T-shirt (casual), Dress Shirt (formal), Jeans (casual), Dress Pants (formal)
Thinking: Brunch with friends = casual. I should pick casual items. T-shirt + Jeans both casual, good match.
Result: T-shirt + Jeans ✓ (both casual, perfect for brunch)
NOT: Dress Shirt + Dress Pants ✗ (too formal)

EXAMPLE 2:
Event: "job interview"
Available: Polo Shirt, Dress Shirt, Jeans, Dress Pants
Thinking: Interview = formal/professional. Need polished look. Dress Shirt + Dress Pants is appropriate.
Result: Dress Shirt + Dress Pants ✓ (professional, appropriate formality)
NOT: Polo + Jeans ✗ (too casual for interview)

EXAMPLE 3:
Event: "cold winter day, casual"
Available: T-shirt, Sweater, Shorts, Jeans
Thinking: Cold + casual. Need warm items. Sweater is warm, Jeans provide coverage. No shorts in cold.
Result: Sweater + Jeans ✓ (warm and casual)
NOT: T-shirt + Shorts ✗ (too cold)
`;

    const prompt = `Event: "${eventContext}"

TOPS: ${JSON.stringify(topsForPrompt)}
BOTTOMS: ${JSON.stringify(bottomsForPrompt)}${feedbackSection}

Think step-by-step:
1. What formality does "${eventContext}" require? (casual/formal/smart casual)
2. Any weather considerations mentioned?
3. Which items match this formality and weather?
4. What color combinations work well?${feedbackSection ? '\n5. How can I incorporate liked styles and avoid disliked ones?' : ''}

Pick ${numOutfits} outfit${numOutfits === 1 ? '' : 's'}. For each, briefly explain your reasoning.

Return JSON: {"outfits":[{"topId":"id","bottomId":"id","reason":"[formality match] + [why colors work]"}]}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: fewShotExamples + "\nNOW YOUR TURN:\n" + prompt }
      ],
      temperature: 0.5,
      response_format: { type: "json_object" },
    });

    const responseText = completion.choices[0]?.message?.content || "{}";

    let parsed: { outfits?: { topId: string; bottomId: string; reason: string }[] };
    try {
      parsed = JSON.parse(responseText);
    } catch {
      parsed = { outfits: [] };
    }

    const topMap = new Map(sampledTops.map((item) => [item._id.toString(), item]));
    const bottomMap = new Map(sampledBottoms.map((item) => [item._id.toString(), item]));

    const seenCombos = new Set<string>();
    const outfits: Array<{ top: OutfitItem; bottom: OutfitItem; reason: string }> = [];

    for (const outfit of parsed.outfits || []) {
      const top = topMap.get(outfit.topId);
      const bottom = bottomMap.get(outfit.bottomId);
      
      if (!top || !bottom) continue;
      
      const comboKey = `${outfit.topId}:${outfit.bottomId}`;
      if (seenCombos.has(comboKey)) continue;
      seenCombos.add(comboKey);

      outfits.push({
        top: {
          id: top._id.toString(),
          name: top.name,
          category: top.category,
          colors: top.colors ?? [],
          imagePath: top.imagePath,
        },
        bottom: {
          id: bottom._id.toString(),
          name: bottom.name,
          category: bottom.category,
          colors: bottom.colors ?? [],
          imagePath: bottom.imagePath,
        },
        reason: outfit.reason || "",
      });
    }

    return NextResponse.json({
      outfits,
      hasOuterLayers: outerLayers.length > 0,
    });
  } catch (error) {
    console.error("Error generating recommendations:", error);
    const message = error instanceof Error ? error.message : "Failed to generate recommendations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
