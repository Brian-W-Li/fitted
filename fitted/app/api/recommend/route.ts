import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";
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

async function getLLMRecommendations(
  userId: string,
  eventDescription: string,
  maxOutfits: number = 5
): Promise<{
  outfits: Array<{
    items: Array<{ id: string; name: string; category: string; colors: string[]; imagePath?: string }>;
    reason: string;
    score: number;
  }>;
  message?: string;
}> {
  const { WardrobeItem } = await initDatabase();

  type WardrobeItemLean = {
    _id: { toString(): string };
    name: string;
    category: string;
    subCategory?: string;
    layerRole?: string;
    colors?: string[];
    pattern?: string;
    seasons?: string[];
    occasions?: string[];
    notes?: string;
    isAvailable?: boolean;
    imagePath?: string;
  };

  const docs = (await WardrobeItem.find({ user: userId })
    .lean()
    .exec()) as unknown as WardrobeItemLean[];

  // Only consider available items
  const items = docs.filter((d) => d.isAvailable ?? true);

  if (items.length < 2) {
    return {
      outfits: [],
      message: "You need at least 2 items in your wardrobe to get outfit recommendations.",
    };
  }

  // Build compact wardrobe description for the model
  const wardrobe = items.map((item) => ({
    id: item._id.toString(),
    name: item.name,
    category: item.category,
    subCategory: item.subCategory ?? "",
    layerRole: item.layerRole ?? "",
    colors: item.colors ?? [],
    pattern: item.pattern ?? "",
    seasons: item.seasons ?? [],
    occasions: item.occasions ?? [],
    notes: item.notes ?? "",
  }));

  const systemPrompt = `
You are an expert fashion stylist.
You will receive:
- A free-text description of an event or context.
- A wardrobe: structured JSON describing the user's clothes.

Your job is to pick outfits using ONLY items from the wardrobe.
Each outfit should be realistic and appropriate for the event, colors should harmonize, and layering should make sense.
Return calibrated confidence scores (0-100) for how good each outfit is for this specific event.
If there are not enough suitable items to produce the requested number of outfits, set "notEnoughItems" to true and explain why in "message".
`.trim();

  const userPrompt = `
EVENT_DESCRIPTION:
"""${eventDescription.trim()}"""

WARDROBE_ITEMS (JSON array):
${JSON.stringify(wardrobe, null, 2)}

Instructions:
- Use only IDs from WARDROBE_ITEMS.
- You may propose:
  - One-piece outfits (e.g. a dress alone) when appropriate.
  - Two-piece outfits (top + bottom).
  - Layered outfits (base + mid + outer) when layerRole and weather/context suggest it.
- Aim to propose up to ${maxOutfits} outfits.
- For each outfit, include:
  - itemIds: array of item IDs (strings).
  - confidence: number between 0 and 100 (integer).
  - reason: short explanation (1-2 sentences).
- If there are not enough suitable items to produce at least 1 good outfit, set:
  - "notEnoughItems": true
  - "message": a short human-friendly explanation (e.g. "You only have bottoms and no tops").

Respond ONLY with valid JSON in this schema:
{
  "outfits": [
    {
      "itemIds": ["..."],
      "confidence": 0,
      "reason": "..."
    }
  ],
  "notEnoughItems": false,
  "message": ""
}
`.trim();

  if (!process.env.OPENAI_API_KEY) {
    return {
      outfits: [],
      message: "OpenAI API key is not configured on the server.",
    };
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.6,
    response_format: { type: "json_object" },
  } as any);

  const content = completion.choices[0]?.message?.content || "{}";

  type RawResponse = {
    outfits?: { itemIds: string[]; confidence: number; reason: string }[];
    notEnoughItems?: boolean;
    message?: string;
  };

  let parsed: RawResponse;
  try {
    parsed = JSON.parse(content) as RawResponse;
  } catch {
    parsed = { outfits: [], notEnoughItems: true, message: "AI response was not valid JSON." };
  }

  const rawOutfits = parsed.outfits ?? [];

  if (parsed.notEnoughItems && (!rawOutfits.length || rawOutfits.every(o => (o.itemIds ?? []).length === 0))) {
    return {
      outfits: [],
      message: parsed.message || "You don't have enough suitable items in your wardrobe for this event.",
    };
  }

  // Map itemIds back to full item objects
  const itemMap = new Map(items.map((item) => [item._id.toString(), item]));

  const mapped = rawOutfits
    .map((outfit) => {
      const usedItems = (outfit.itemIds || [])
        .map((id) => {
          const item = itemMap.get(id);
          if (!item) return null;
          return {
            id: item._id.toString(),
            name: item.name,
            category: item.category,
            colors: item.colors ?? [],
            imagePath: item.imagePath,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null);

      if (!usedItems.length) return null;

      const score = Number.isFinite(outfit.confidence)
        ? Math.max(0, Math.min(100, Math.round(outfit.confidence)))
        : 0;

      return {
        items: usedItems,
        reason: outfit.reason || "",
        score,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  // Sort by confidence descending and cap to maxOutfits
  mapped.sort((a, b) => (b.score || 0) - (a.score || 0));
  const topK = mapped.slice(0, maxOutfits);

  if (!topK.length) {
    return {
      outfits: [],
      message: parsed.message || "The AI could not form any valid outfits from your wardrobe for this event.",
    };
  }

  return {
    outfits: topK,
    message: parsed.message,
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
    const { eventDescription, maxOutfits } = body as {
      eventDescription?: string;
      maxOutfits?: number;
    };

    if (!eventDescription || !eventDescription.trim()) {
      return NextResponse.json(
        { error: "Event description is required." },
        { status: 400 }
      );
    }

    const result = await getLLMRecommendations(
      userId,
      eventDescription,
      typeof maxOutfits === "number" && maxOutfits > 0 ? maxOutfits : 5
    );

    return NextResponse.json({
      ...result,
    });
  } catch (error) {
    console.error("Error generating recommendations:", error);
    const message =
      error instanceof Error ? error.message : "Failed to generate recommendations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
