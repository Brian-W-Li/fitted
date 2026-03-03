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

function isOuterLayer(category: string, name: string): boolean {
  const combined = `${category} ${name}`.toLowerCase();
  return OUTER_LAYER_KEYWORDS.some((keyword) => combined.includes(keyword));
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
  colors?: string[];
  formality?: string;
  imagePath?: string;
  isAvailable?: boolean;
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
    const { topId, bottomId, topName, bottomName, topColors, bottomColors, eventContext } = body;

    if (!topId || !bottomId) {
      return NextResponse.json(
        { error: "topId and bottomId are required" },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key is required for recommendations." },
        { status: 503 }
      );
    }

    const { WardrobeItem } = await initDatabase();

    const docs = (await WardrobeItem.find({ user: userId })
      .lean()
      .exec()) as unknown as WardrobeItemLean[];

    const items = docs.filter((d) => d.isAvailable ?? true);

    const outerLayers = items.filter((item) => isOuterLayer(item.category, item.name));

    if (outerLayers.length === 0) {
      return NextResponse.json({
        outerLayers: [],
        message: "No outer layers found in your wardrobe."
      });
    }

    const outerLayersForPrompt = outerLayers.map((item) => ({
      id: item._id.toString(),
      name: item.name,
      colors: item.colors || [],
      formality: item.formality || "casual",
    }));

    const numToRecommend = Math.min(5, outerLayers.length);

    const prompt = `You are a fashion stylist. The user has selected a base outfit:

BASE OUTFIT:
- Top: "${topName || 'Unknown'}" (colors: ${(topColors || []).join(', ') || 'unknown'})
- Bottom: "${bottomName || 'Unknown'}" (colors: ${(bottomColors || []).join(', ') || 'unknown'})

AVAILABLE OUTER LAYERS (${outerLayers.length}):
${JSON.stringify(outerLayersForPrompt)}

Event: "${eventContext || 'general outing'}"

Pick the top ${numToRecommend} outer layers that would complement this outfit, ranked best to worst.

Consider:
- Color coordination with the base outfit (neutrals match everything, avoid clashing)
- Appropriateness for the occasion/context
- Formality match (casual top+bottom → casual jacket)
- Weather context if mentioned

JSON only:
{"outerLayers":[{"id":"item_id","reason":"brief explanation"}]}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      response_format: { type: "json_object" },
    });

    const responseText = completion.choices[0]?.message?.content || "{}";

    let parsed: { outerLayers?: { id: string; reason: string }[] };
    try {
      parsed = JSON.parse(responseText);
    } catch {
      parsed = { outerLayers: [] };
    }

    const outerMap = new Map(outerLayers.map((item) => [item._id.toString(), item]));

    const recommendations = (parsed.outerLayers || [])
      .map((rec) => {
        const item = outerMap.get(rec.id);
        if (!item) return null;
        return {
          id: item._id.toString(),
          name: item.name,
          category: item.category,
          colors: item.colors ?? [],
          imagePath: item.imagePath,
          reason: rec.reason || "",
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    return NextResponse.json({
      outerLayers: recommendations,
    });
  } catch (error) {
    console.error("Error getting outer layer recommendations:", error);
    const message = error instanceof Error ? error.message : "Failed to get outer layer recommendations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
