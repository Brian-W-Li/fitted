import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const UPPER_KEYWORDS = [
  "shirt", "t-shirt", "tee", "top", "blouse", "sweater", "hoodie",
  "jacket", "blazer", "cardigan", "vest", "tank", "polo", "sweatshirt",
  "coat", "pullover", "henley", "tunic", "crop"
];

const LOWER_KEYWORDS = [
  "jeans", "pants", "shorts", "skirt", "trouser", "chino", "sweatpants",
  "leggings", "joggers", "khaki", "slacks", "cargo", "culottes", "capri"
];

function classifyClothingType(category: string, name: string): "top" | "bottom" | "unknown" {
  const combined = `${category} ${name}`.toLowerCase();
  
  for (const keyword of UPPER_KEYWORDS) {
    if (combined.includes(keyword)) return "top";
  }
  for (const keyword of LOWER_KEYWORDS) {
    if (combined.includes(keyword)) return "bottom";
  }
  return "unknown";
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

async function getRecommendations(
  userId: string,
  occasion: string,
  eventContext?: string
): Promise<{
  outfits: Array<{
    items: Array<{ id: string; name: string; category: string; colors: string[]; imagePath?: string }>;
    reason: string;
  }>;
}> {
  const { WardrobeItem, OutfitInteraction } = await initDatabase();

  type WardrobeItemLean = {
    _id: { toString(): string };
    name: string;
    category: string;
    colors?: string[];
    formality?: string;
    occasions?: string[];
    imagePath?: string;
  };

  const items = (await WardrobeItem.find({ user: userId })
    .lean()
    .exec()) as unknown as WardrobeItemLean[];

  type InteractionDoc = {
    items: Array<{
      _id: { toString(): string };
      name: string;
      category: string;
      colors?: string[];
    }>;
    action: string;
    context?: { occasion?: string };
  };

  const interactions = (await OutfitInteraction.find({
    user: userId,
    action: { $in: ["accepted", "rejected"] },
  })
    .populate({
      path: "items",
      select: "name category colors",
    })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean()
    .exec()) as unknown as InteractionDoc[];

  if (items.length < 2) {
    throw new Error(
      "Add at least 2 items to your wardrobe to get recommendations"
    );
  }

  const tops: typeof items = [];
  const bottoms: typeof items = [];

  for (const item of items) {
    const type = classifyClothingType(item.category, item.name);
    if (type === "top") {
      tops.push(item);
    } else if (type === "bottom") {
      bottoms.push(item);
    }
  }

  if (tops.length === 0) {
    throw new Error("No tops found in your wardrobe. Add some shirts, sweaters, or jackets.");
  }
  if (bottoms.length === 0) {
    throw new Error("No bottoms found in your wardrobe. Add some pants, jeans, or shorts.");
  }


  const likedOutfits = interactions
    .filter((i) => i.action === "accepted" && i.items.length >= 2)
    .map((i) => ({
      top: i.items.find((item) => classifyClothingType(item.category, item.name) === "top"),
      bottom: i.items.find((item) => classifyClothingType(item.category, item.name) === "bottom"),
      occasion: i.context?.occasion || "unknown",
    }))
    .filter((o) => o.top && o.bottom)
    .slice(0, 10);

  const dislikedOutfits = interactions
    .filter((i) => i.action === "rejected" && i.items.length >= 2)
    .map((i) => ({
      top: i.items.find((item) => classifyClothingType(item.category, item.name) === "top"),
      bottom: i.items.find((item) => classifyClothingType(item.category, item.name) === "bottom"),
      occasion: i.context?.occasion || "unknown",
    }))
    .filter((o) => o.top && o.bottom)
    .slice(0, 10);

  let feedbackSection = "";
  
  if (likedOutfits.length > 0 || dislikedOutfits.length > 0) {
    feedbackSection = "\n\nUSER'S PAST FEEDBACK (learn from their preferences):";
    
    if (likedOutfits.length > 0) {
      feedbackSection += "\n\nLIKED OUTFITS (the user enjoyed these combinations - suggest SIMILAR styles):";
      likedOutfits.forEach((outfit, i) => {
        feedbackSection += `\n${i + 1}. "${outfit.top?.name}" + "${outfit.bottom?.name}" (${outfit.occasion})`;
      });
    }
    
    if (dislikedOutfits.length > 0) {
      feedbackSection += "\n\nDISLIKED OUTFITS (the user did NOT like these - AVOID similar combinations):";
      dislikedOutfits.forEach((outfit, i) => {
        feedbackSection += `\n${i + 1}. "${outfit.top?.name}" + "${outfit.bottom?.name}" (${outfit.occasion})`;
      });
    }
  }

  const maxPossibleOutfits = tops.length * bottoms.length;
  const numOutfitsToGenerate = Math.min(5, maxPossibleOutfits);

  const topsForPrompt = tops.map((item) => ({
    id: item._id.toString(),
    name: item.name,
    category: item.category,
    colors: item.colors || [],
    formality: item.formality || "casual",
  }));

  const bottomsForPrompt = bottoms.map((item) => ({
    id: item._id.toString(),
    name: item.name,
    category: item.category,
    colors: item.colors || [],
    formality: item.formality || "casual",
  }));

  const hasFeedback = likedOutfits.length > 0 || dislikedOutfits.length > 0;

  const prompt = `You are a fashion stylist. Pick ${numOutfitsToGenerate} outfit${numOutfitsToGenerate === 1 ? '' : 's'} from this wardrobe.

TOPS: ${JSON.stringify(topsForPrompt)}

BOTTOMS: ${JSON.stringify(bottomsForPrompt)}

Occasion: ${occasion}${eventContext ? `\nContext: "${eventContext}"` : ''}
${feedbackSection}

Requirements:
- Each outfit = 1 top + 1 bottom (use IDs from above)
- No duplicate outfits
- ${eventContext ? 'Context is priority #1 - pick weather-appropriate clothes (jackets for cold, light clothes for hot)' : 'Match the occasion (casual=relaxed, formal=dressy, athletic=sporty, streetwear=trendy)'}
- Match formality levels (casual top + casual bottom, formal top + formal bottom)
- Colors should complement each other${hasFeedback ? '\n- IMPORTANT: Learn from the user\'s liked/disliked outfits above - suggest similar styles to liked, avoid styles like disliked' : ''}
- Order by best match first
- Brief reason for each

JSON only:
{"outfits":[{"topId":"id","bottomId":"id","reason":"why"}]}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
  });

  const responseText = completion.choices[0]?.message?.content || "{}";

  let recommendations: { outfits: { topId: string; bottomId: string; reason: string }[] };
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    recommendations = jsonMatch ? JSON.parse(jsonMatch[0]) : { outfits: [] };
  } catch {
    recommendations = { outfits: [] };
  }

  const topMap = new Map(tops.map((item) => [item._id.toString(), item]));
  const bottomMap = new Map(bottoms.map((item) => [item._id.toString(), item]));

  const seenCombinations = new Set<string>();
  
  const validOutfits = recommendations.outfits
    .map((outfit) => {
      const top = topMap.get(outfit.topId);
      const bottom = bottomMap.get(outfit.bottomId);
      
      if (!top || !bottom) return null;
      
      const comboKey = `${outfit.topId}:${outfit.bottomId}`;
      if (seenCombinations.has(comboKey)) {
        return null;
      }
      seenCombinations.add(comboKey);
      
      return {
        items: [
          {
            id: top._id.toString(),
            name: top.name,
            category: top.category,
            colors: top.colors ?? [],
            imagePath: top.imagePath,
          },
          {
            id: bottom._id.toString(),
            name: bottom.name,
            category: bottom.category,
            colors: bottom.colors ?? [],
            imagePath: bottom.imagePath,
          },
        ],
        reason: outfit.reason,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  return { outfits: validOutfits };
}

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
    const { occasion = "casual", eventContext } = body;

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key is required for recommendations." },
        { status: 503 }
      );
    }

    const result = await getRecommendations(userId, occasion, eventContext);

    return NextResponse.json({
      occasion,
      ...result,
    });
  } catch (error) {
    console.error("Error generating recommendations:", error);
    const message =
      error instanceof Error ? error.message : "Failed to generate recommendations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
