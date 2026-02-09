import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";
import { OutfitRecommendationEngine, toMLItem, type WardrobeItemML } from "@/lib/recommendationEngine";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

async function getMLRecommendations(
  userId: string,
  occasion: string
): Promise<{ outfits: Array<{ items: Array<{ id: string; name: string; category: string; colors: string[] }>; reason: string; score: number }> }> {
  const { WardrobeItem, OutfitInteraction } = await initDatabase();

  type WardrobeDoc = {
    _id: unknown;
    name: string;
    clothingType?: "top" | "bottom";
    category?: string;
    colors?: string[];
    formality?: string;
    seasons?: string[];
    occasions?: string[];
    metadata?: Map<string, unknown>;
  };
  const items = await WardrobeItem.find({ user: userId }).lean().exec() as unknown as WardrobeDoc[];

  if (items.length < 2) {
    throw new Error("Add at least 2 items to your wardrobe to get recommendations");
  }


  type InteractionDoc = {
    items: unknown[];
    action: string;
  };
  const feedbackDocs = await OutfitInteraction.find({
    user: userId,
    action: { $in: ["accepted", "rejected"] },
  }).lean().exec() as unknown as InteractionDoc[];

  const feedbackHistory = feedbackDocs.map((doc) => ({
    itemIds: doc.items.map((id: unknown) => String(id)),
    action: doc.action as "accepted" | "rejected",
  }));

  // Convert to ML format
  const mlItems: WardrobeItemML[] = items.map((item) => toMLItem(item));

  // Create engine and get recommendations
  const engine = new OutfitRecommendationEngine(mlItems, feedbackHistory);
  const recommendations = engine.recommend({
    occasion,
    maxResults: 5,
    minScore: 40,
  });

  // Format response
  return {
    outfits: recommendations.map(rec => ({
      items: [
        {
          id: rec.top.id,
          name: rec.top.name,
          category: rec.top.category || "top",
          colors: rec.top.colors || [],
        },
        {
          id: rec.bottom.id,
          name: rec.bottom.name,
          category: rec.bottom.category || "bottom",
          colors: rec.bottom.colors || [],
        },
      ],
      reason: rec.reasons.join(". "),
      score: rec.score,
    })),
  };
}

// OpenAI-based recommendation (optional - requires API key)
async function getAIRecommendations(
  userId: string,
  occasion: string
): Promise<{ outfits: Array<{ items: Array<{ id: string; name: string; category: string; colors: string[] }>; reason: string }> }> {
  const { WardrobeItem } = await initDatabase();

  type WardrobeItemLean = {
    _id: { toString(): string };
    name: string;
    category: string;
    colors?: string[];
    formality?: string;
    occasions?: string[];
  };

  const items = (await WardrobeItem.find({ user: userId }).lean().exec()) as unknown as WardrobeItemLean[];

  if (items.length < 2) {
    throw new Error("Add at least 2 items to your wardrobe to get recommendations");
  }

  const wardrobeDescription = items.map((item) => ({
    id: item._id.toString(),
    name: item.name,
    category: item.category,
    colors: item.colors || [],
    formality: item.formality || "casual",
    occasions: item.occasions || [],
  }));

  const prompt = `You are a fashion stylist. Given this wardrobe, suggest 3 outfit combinations for a ${occasion} occasion.

WARDROBE:
${JSON.stringify(wardrobeDescription, null, 2)}

Rules:
- Each outfit must have exactly 2 items: one upper wear (t-shirt, shirt, sweater, jacket, hoodie, top, blouse) and one lower wear (jeans, pants, shorts, skirt, trousers)
- Colors should complement each other (neutrals go with everything, avoid clashing colors)
- Match the formality to the occasion
- Only use items from the wardrobe provided

Respond ONLY with valid JSON in this exact format:
{
  "outfits": [
    {
      "items": ["item_id_1", "item_id_2"],
      "reason": "Brief explanation why these items work together"
    }
  ]
}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
  });

  const responseText = completion.choices[0]?.message?.content || "{}";

  let recommendations;
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    recommendations = jsonMatch ? JSON.parse(jsonMatch[0]) : { outfits: [] };
  } catch {
    recommendations = { outfits: [] };
  }

  const itemMap = new Map(items.map((item) => [item._id.toString(), item]));

  return {
    outfits: recommendations.outfits.map((outfit: { items: string[]; reason: string }) => ({
      items: outfit.items
        .map((id: string) => {
          const item = itemMap.get(id);
          if (!item) return null;
          return {
            id: item._id.toString(),
            name: item.name,
            category: item.category,
            colors: item.colors ?? [],
          };
        })
        .filter(Boolean),
      reason: outfit.reason,
    })),
  };
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
    const { occasion = "casual", useAI = false } = body;

    let result;

    if (useAI && process.env.OPENAI_API_KEY) {
      // Use OpenAI for recommendations
      result = await getAIRecommendations(userId, occasion);
    } else {
      // Use ML engine (default - no API cost)
      result = await getMLRecommendations(userId, occasion);
    }

    return NextResponse.json({
      occasion,
      method: useAI ? "ai" : "ml",
      ...result,
    });
  } catch (error) {
    console.error("Error generating recommendations:", error);
    const message = error instanceof Error ? error.message : "Failed to generate recommendations";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
