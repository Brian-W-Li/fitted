import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";
import { runPersonalizationSummarize } from "@/lib/runPersonalizationSummary";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ============================================================================
// TYPES
// ============================================================================

type TemperatureHint = "hot" | "mild" | "cold" | "indoor" | "outdoor";
type ChangeTarget = "outer" | "top" | "bottom" | "footwear" | "any";

interface EnvironmentContext {
  temperatureHint: TemperatureHint;
  weatherSummary?: string;
}

interface WardrobeItemLean {
  _id: { toString(): string };
  name: string;
  category: string;
  subCategory?: string;
  layerRole?: "base" | "mid" | "outer";
  colors?: string[];
  pattern?: string;
  seasons?: string[];
  occasions?: string[];
  notes?: string;
  isAvailable?: boolean;
  imagePath?: string;
}

interface ShortlistedItem {
  id: string;
  name: string;
  category: string;
  subCategory?: string;
  layerRole?: string;
  colors: string[];
  pattern?: string;
  seasons: string[];
  occasions: string[];
  notes?: string;
}

interface OutfitResult {
  itemIds: string[];
  confidence: number;
  reason: string;
  mode?: "safe" | "exploratory";
}

// ============================================================================
// AUTH HELPER
// ============================================================================

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

// ============================================================================
// SHORTLISTING LOGIC (reused from main route)
// ============================================================================

function extractOccasionBuckets(eventDescription: string): string[] {
  const text = eventDescription.toLowerCase();
  const buckets: string[] = [];
  
  if (["work", "office", "meeting", "business", "professional"].some(w => text.includes(w))) {
    buckets.push("work");
  }
  if (["formal", "wedding", "gala", "black tie", "elegant"].some(w => text.includes(w))) {
    buckets.push("formal");
  }
  if (["casual", "relaxed", "chill", "hangout", "friends"].some(w => text.includes(w))) {
    buckets.push("casual");
  }
  if (["date", "romantic", "dinner"].some(w => text.includes(w))) {
    buckets.push("date");
  }
  if (["sport", "athletic", "gym", "workout", "active"].some(w => text.includes(w))) {
    buckets.push("athletic");
  }
  if (["outdoor", "hiking", "picnic", "beach", "park"].some(w => text.includes(w))) {
    buckets.push("outdoor");
  }
  
  return buckets.length > 0 ? buckets : ["everyday"];
}

function detectTemperatureHint(eventDescription: string): TemperatureHint {
  const text = eventDescription.toLowerCase();
  // Use word-boundary matching to prevent substring collisions (e.g. "hot" inside
  // "hotel"/"photo", "warm" inside "swarm", "park" inside "spark", etc.).
  // Single words use word-boundary regex to avoid substring collisions (e.g. "hot"
  // matching inside "hotel"). Multi-word phrases (e.g. "air condition") use plain
  // includes — they are long enough that false positives are practically impossible,
  // and they may appear inflected ("air conditioned") which breaks \b at the end.
  const hasWord = (w: string) =>
    w.includes(" ") ? text.includes(w) : new RegExp(`\\b${w}\\b`).test(text);

  if (["cold", "winter", "freezing", "chilly", "snow", "frigid"].some(hasWord)) {
    return "cold";
  }
  if (["hot", "summer", "warm", "humid", "heat", "scorching"].some(hasWord)) {
    return "hot";
  }
  // Check outdoor before indoor — "ac" was removed because it matches substrings
  // like "beach" (be-AC-h), causing false indoor classifications.
  if (["outdoor", "outside", "beach", "park", "picnic", "hiking", "hike", "camping", "barbecue", "bbq", "garden", "trail"].some(hasWord)) {
    return "outdoor";
  }
  if (["indoor", "inside", "air condition", "office"].some(hasWord)) {
    return "indoor";
  }
  if (["spring", "fall", "autumn", "mild", "cool", "moderate"].some(hasWord)) {
    return "mild";
  }

  return "mild";
}

function calculateOccasionScore(itemOccasions: string[], eventBuckets: string[]): number {
  if (!itemOccasions || itemOccasions.length === 0) return 0.5;
  
  const itemOccLower = itemOccasions.map(o => o.toLowerCase());
  const matches = eventBuckets.filter(b => itemOccLower.some(o => o.includes(b) || b.includes(o)));
  
  return matches.length > 0 ? 1.0 : 0.3;
}

function calculateTemperatureScore(item: WardrobeItemLean, tempHint: TemperatureHint): number {
  const seasons = (item.seasons || []).map(s => s.toLowerCase());
  const name = item.name.toLowerCase();
  const layerRole = item.layerRole?.toLowerCase();
  
  if (seasons.length === 0 || seasons.includes("all")) return 1.0;
  
  switch (tempHint) {
    case "cold":
      if (seasons.some(s => ["winter", "fall", "autumn"].includes(s))) return 1.0;
      if (seasons.every(s => s === "summer")) return 0.4;
      return 0.7;
    case "hot":
      if (seasons.some(s => ["summer", "spring"].includes(s))) return 1.0;
      if (layerRole === "outer" && ["parka", "puffer", "wool", "heavy", "winter coat"].some(w => name.includes(w))) {
        return 0.2;
      }
      if (seasons.every(s => s === "winter")) return 0.5;
      return 0.8;
    case "outdoor":
    default:
      return 1.0;
  }
}

function shortlistForLLM(
  wardrobe: WardrobeItemLean[],
  eventDescription: string,
  env: EnvironmentContext,
  dislikedItemIds: string[],
  maxItems: number = 80
): ShortlistedItem[] {
  const eventBuckets = extractOccasionBuckets(eventDescription);
  const dislikedSet = new Set(dislikedItemIds);
  
  // Filter only by hard requirements
  const available = wardrobe.filter(item => {
    if (item.isAvailable === false) return false;
    if (dislikedSet.has(item._id.toString())) return false;
    return true;
  });
  
  // Score items by multiple factors
  const scored = available.map(item => {
    const occasionScore = calculateOccasionScore(item.occasions || [], eventBuckets);
    const temperatureScore = calculateTemperatureScore(item, env.temperatureHint);
    const combinedScore = (occasionScore * 0.6) + (temperatureScore * 0.4);
    return { item, score: combinedScore };
  });
  
  if (scored.length <= maxItems) {
    return scored
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => toShortlistedItem(item));
  }
  
  const byCategory: Record<string, typeof scored> = {
    top: [],
    bottom: [],
    "one piece": [],
    footwear: [],
    outer: []
  };
  
  for (const s of scored) {
    const cat = s.item.category.toLowerCase();
    const layerRole = s.item.layerRole?.toLowerCase();
    const name = s.item.name.toLowerCase();
    
    if (layerRole === "outer" || ["jacket", "coat", "blazer", "cardigan", "hoodie", "parka", "puffer"].some(w => name.includes(w))) {
      byCategory.outer.push(s);
    } else if (cat === "bottom" || cat === "bottoms" || ["pants", "jeans", "shorts", "skirt", "trousers"].some(w => cat.includes(w))) {
      byCategory.bottom.push(s);
    } else if (cat === "one piece" || ["dress", "jumpsuit", "romper"].some(w => cat.includes(w) || name.includes(w))) {
      byCategory["one piece"].push(s);
    } else if (cat === "footwear" || ["shoes", "sneakers", "boots", "sandals", "loafers"].some(w => cat.includes(w) || name.includes(w))) {
      byCategory.footwear.push(s);
    } else {
      byCategory.top.push(s);
    }
  }
  
  const result: ShortlistedItem[] = [];
  const quotas: Record<string, number> = {
    top: 25,
    bottom: 20,
    outer: 15,
    "one piece": 10,
    footwear: 10
  };
  
  for (const [cat, items] of Object.entries(byCategory)) {
    const quota = quotas[cat] || 10;
    const sorted = items.sort((a, b) => b.score - a.score);
    const sampled = sorted.slice(0, quota);
    result.push(...sampled.map(s => toShortlistedItem(s.item)));
  }
  
  return result.slice(0, maxItems);
}

function toShortlistedItem(item: WardrobeItemLean): ShortlistedItem {
  return {
    id: item._id.toString(),
    name: item.name,
    category: item.category,
    subCategory: item.subCategory,
    layerRole: item.layerRole,
    colors: item.colors || [],
    pattern: item.pattern,
    seasons: item.seasons || [],
    occasions: item.occasions || [],
    notes: item.notes
  };
}

// ============================================================================
// PREFERENCE SUMMARY HELPER (lazy refresh)
// ============================================================================

const SUMMARY_STALE_THRESHOLD = 5;

async function getOrRefreshPreferenceSummary(userId: string): Promise<string | null> {
  try {
    const { PreferenceSummary, OutfitInteraction } = await initDatabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = (await PreferenceSummary.findOne({ user: userId }).lean().exec()) as any;
    const existingText: string | null = existing?.text || null;
    const lastUpdatedAt: Date | null = existing?.updatedAt || null;

    const sinceQuery: Record<string, unknown> = {
      user: userId,
      action: { $in: ["accepted", "rejected"] },
      inferredWhy: { $exists: true, $ne: "" },
    };
    if (lastUpdatedAt) {
      sinceQuery.createdAt = { $gt: lastUpdatedAt };
    }
    const newCount = await OutfitInteraction.countDocuments(sinceQuery).exec();

    const isStale = !existingText || newCount >= SUMMARY_STALE_THRESHOLD;

    console.info(JSON.stringify({
      event: "summarize_refresh_decision",
      userId,
      hasSummary: !!existingText,
      newInteractionsSinceUpdate: newCount,
      threshold: SUMMARY_STALE_THRESHOLD,
      willRefresh: isStale,
    }));

    if (!isStale) {
      return existingText;
    }

    const result = await runPersonalizationSummarize(userId);
    if (result.success && result.summaryText) {
      return result.summaryText;
    }

    console.info(JSON.stringify({
      event: "summarize_refresh_fallback",
      userId,
      reason: result.message,
    }));
    return existingText;
  } catch (err) {
    console.error(JSON.stringify({ event: "summarize_refresh_error", userId, message: (err as Error)?.message }));
    return null;
  }
}

// ============================================================================
// MAIN ENDPOINT
// ============================================================================

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
    const {
      eventDescription,
      temperatureHint: providedTempHint,
      weatherSummary,
      lockedItemIds = [],
      dislikedItemIds = [],
      changeTarget = "any" as ChangeTarget,
      feedbackNotes,
      maxOutfits = 5
    } = body;

    if (!eventDescription) {
      return NextResponse.json(
        { error: "eventDescription is required" },
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

    // Fetch wardrobe
    const docs = (await WardrobeItem.find({ user: userId })
      .lean()
      .exec()) as unknown as WardrobeItemLean[];

    if (docs.length === 0) {
      return NextResponse.json({
        outfits: [],
        notEnoughItems: true,
        message: "Your wardrobe is empty. Add some items first."
      });
    }

    // Determine environment context
    const temperatureHint: TemperatureHint = providedTempHint || detectTemperatureHint(eventDescription);
    const env: EnvironmentContext = { temperatureHint, weatherSummary };

    // Shortlist items, excluding items the user explicitly disliked for this outfit.
    // dislikedItemIds contains only the per-item selections from the current outfit's
    // feedback modal — contextual to this regenerate call, not a global blacklist.
    const shortlisted = shortlistForLLM(docs, eventDescription, env, dislikedItemIds);

    // Get locked items info
    const lockedItems = shortlisted.filter(item => lockedItemIds.includes(item.id));
    const lockedItemsJson = lockedItems.length > 0 ? JSON.stringify(lockedItems, null, 2) : null;

    if (shortlisted.length < 2) {
      return NextResponse.json({
        outfits: [],
        notEnoughItems: true,
        message: "Not enough available items to create outfits."
      });
    }

    // Get preference summary (lazy refresh if stale)
    const preferenceSummary = await getOrRefreshPreferenceSummary(userId);

    // Build the prompt
    const systemMessage = `You are an expert fashion stylist creating outfit recommendations from a user's wardrobe.

CRITICAL RULES:
- You MUST use only item IDs from the provided WARDROBE_ITEMS.
- NEVER use two tops (category "top") in the same outfit - only ONE top allowed.
- NEVER use two bottoms (category "bottom") in the same outfit - only ONE bottom allowed.
- One-piece items (dresses/jumpsuits) should NOT be combined with separate tops or bottoms.
- Every outfit MUST include exactly ONE footwear item (shoes, sneakers, boots, sandals, etc.) when footwear is available in WARDROBE_ITEMS.

VALID OUTFIT STRUCTURES (strictly follow these):

For one-piece outfits (dress, jumpsuit) — always add footwear when available:
1. One-piece + footwear
2. One-piece + mid layer + footwear (e.g., dress + cardigan + shoes)
3. One-piece + outer layer + footwear (e.g., dress + jacket + shoes)
4. One-piece + mid layer + outer layer + footwear

For top+bottom outfits (MUST have base layer top) — always add footwear when available:
1. Base top + bottom + footwear - the basic outfit
2. Base top + mid layer + bottom + footwear - adding a sweater/cardigan
3. Base top + outer layer + bottom + footwear - adding a jacket/coat
4. Base top + mid layer + outer layer + bottom + footwear - full layering

IMPORTANT: For top+bottom outfits, you MUST include a base layer top (t-shirt, shirt, blouse).
Mid layers (sweaters, cardigans) and outer layers (jackets, coats) are ADDITIONS, not replacements.
One-pieces can have layers added on top but NOT combined with separate tops or bottoms.

LAYERING GUIDANCE:
- "hot" temperature: Prefer single layers (one-piece or base+bottom). No heavy outers.
- "cold" temperature: Add outer layer (jackets, coats) on top of base. Mid layers optional.
- "mild"/"indoor": Flexible - light outer optional based on style.
- Outer layers have layerRole: "outer" - these go ON TOP of base tops, not replacing them.

COLOR & STYLE:
- Ensure colors complement each other (neutrals work with everything).
- Match formality to the occasion.
- Max 1 bold pattern per outfit.`;

    let userMessage = "";

    // Add preference summary if available
    if (preferenceSummary) {
      userMessage += `USER_PREFERENCES:\n${preferenceSummary}\n\n`;
      userMessage += `When regenerating outfits, interpret USER_PREFERENCES as follows:
- Prefer outfits that respect these preferences, but you may still include some exploratory elements as long as they address the user's feedback.\n\n`;
    }

    userMessage += `EVENT_DESCRIPTION: "${eventDescription}"

ENVIRONMENT:
- TEMPERATURE_HINT: "${temperatureHint}"${weatherSummary ? `\n- WEATHER_SUMMARY: "${weatherSummary}"` : ""}

`;

    const changeTargetLabel =
      changeTarget === "any"
        ? "the non-locked items"
        : changeTarget === "outer"
          ? "the outer layer items"
          : `the ${changeTarget} items`;

    // Change target hint should apply even when nothing is locked.
    userMessage += `CHANGE_TARGET: "${changeTarget}"
- Primarily change ${changeTargetLabel}.

`;

    // Locked items are conditional.
    if (lockedItemsJson) {
      userMessage += `LOCKED_ITEMS (MUST be included in every outfit):
${lockedItemsJson}

- You MUST include ALL locked items in every suggested outfit.

`;
    }

    // Add feedback context if provided
    if (feedbackNotes) {
      userMessage += `USER_FEEDBACK (why previous outfits were disliked):
${feedbackNotes}

Consider this feedback when creating new suggestions.

`;
    }

    userMessage += `WARDROBE_ITEMS:
${JSON.stringify(shortlisted, null, 2)}

TASK:
Create ${maxOutfits} NEW outfit recommendations different from what the user disliked. For each outfit:
1. Think about what formality and style the event requires.
2. Consider the temperature - does it need layering?
3. Select items that work together (colors, style, occasion).
4. Include exactly one footwear item (shoes, sneakers, boots, sandals, etc.) when available in WARDROBE_ITEMS.
5. ${lockedItemsJson ? "Ensure all locked items are included." : ""}
6. Provide a confidence score (0-100) and brief reason.

RESPONSE FORMAT (JSON only):
{
  "outfits": [
    {
      "itemIds": ["id1", "id2"],
      "confidence": 85,
      "reason": "Brief explanation of why this works",
      "mode": "safe" or "exploratory"
    }
  ],
  "notEnoughItems": false,
  "message": ""
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage }
      ],
      temperature: 0.6, // Slightly higher for more variety in regeneration
      response_format: { type: "json_object" },
    });

    const responseText = completion.choices[0]?.message?.content || "{}";

    let parsed: { outfits?: OutfitResult[]; notEnoughItems?: boolean; message?: string };
    try {
      parsed = JSON.parse(responseText);
    } catch {
      parsed = { outfits: [] };
    }

    // Validate and enrich outfit data
    const itemMap = new Map(shortlisted.map(item => [item.id, item]));
    const lockedSet = new Set(lockedItemIds);
    
    // Smart categorization helper
    function inferItemType(item: ShortlistedItem): "base_top" | "mid_layer" | "outer_layer" | "bottom" | "one_piece" | "footwear" | "unknown" {
      const cat = item.category.toLowerCase();
      const layerRole = item.layerRole?.toLowerCase();
      const name = item.name.toLowerCase();
      const subCat = item.subCategory?.toLowerCase() || "";
      
      if (cat === "one piece" || ["dress", "jumpsuit", "romper"].some(w => cat.includes(w) || name.includes(w) || subCat.includes(w))) {
        return "one_piece";
      }
      if (cat === "bottom" || cat === "bottoms" || ["pants", "jeans", "shorts", "skirt", "trousers", "chinos", "leggings"].some(w => cat.includes(w) || name.includes(w) || subCat.includes(w))) {
        return "bottom";
      }
      if (cat === "footwear" || ["shoes", "sneakers", "boots", "sandals", "loafers", "heels", "flats"].some(w => cat.includes(w) || name.includes(w) || subCat.includes(w))) {
        return "footwear";
      }
      if (layerRole === "outer" || ["jacket", "coat", "blazer", "parka", "puffer", "windbreaker", "trench", "overcoat"].some(w => name.includes(w) || subCat.includes(w))) {
        return "outer_layer";
      }
      if (layerRole === "mid" || ["cardigan", "sweater", "hoodie", "fleece", "vest"].some(w => name.includes(w) || subCat.includes(w))) {
        return "mid_layer";
      }
      if (cat === "top" || cat === "tops" || ["shirt", "tee", "t-shirt", "blouse", "polo", "tank", "henley", "button-down", "oxford"].some(w => name.includes(w) || subCat.includes(w))) {
        return "base_top";
      }
      return "unknown";
    }

    const hasFootwearInWardrobe = shortlisted.some(s => inferItemType(s) === "footwear");
    const footwearIds = shortlisted.filter(s => inferItemType(s) === "footwear").map(s => s.id);

    // Post-process: if LLM omitted footwear, inject it so outfits pass validation.
    if (hasFootwearInWardrobe && footwearIds.length > 0 && parsed.outfits?.length) {
      const defaultFootwearId = footwearIds[0];
      for (const outfit of parsed.outfits) {
        if (!outfit.itemIds || !Array.isArray(outfit.itemIds)) continue;
        outfit.itemIds = outfit.itemIds.map(id => String(id).trim()).filter(Boolean);
        const items = outfit.itemIds.map(id => itemMap.get(id)).filter((i): i is ShortlistedItem => Boolean(i));
        const hasFootwearByType = items.some(item => inferItemType(item) === "footwear");
        if (!hasFootwearByType) {
          outfit.itemIds = [...outfit.itemIds, defaultFootwearId];
        }
      }
    }

    // Validate outfit structure
    function isValidOutfitStructure(itemIds: string[]): boolean {
      const items = itemIds.map(id => itemMap.get(id)).filter(Boolean);
      if (items.length === 0) return false;
      
      let baseTops = 0, midLayers = 0, outerLayers = 0, bottoms = 0, onePieces = 0, footwear = 0, unknown = 0;
      
      for (const item of items) {
        if (!item) continue;
        const itemType = inferItemType(item);
        switch (itemType) {
          case "base_top": baseTops++; break;
          case "mid_layer": midLayers++; break;
          case "outer_layer": outerLayers++; break;
          case "bottom": bottoms++; break;
          case "one_piece": onePieces++; break;
          case "footwear": footwear++; break;
          default: unknown++; break;
        }
      }
      
      // Hard invalid: more than one bottom
      if (bottoms > 1) return false;
      
      // Hard invalid: more than one base top
      if (baseTops > 1) return false;
      
      // Hard invalid: more than one one-piece
      if (onePieces > 1) return false;
      
      // Hard invalid: one-piece with separate base top or bottom (layers are OK)
      if (onePieces > 0 && (baseTops > 0 || bottoms > 0)) return false;

      if (footwear > 1) return false;
      if (hasFootwearInWardrobe && footwear !== 1) return false;
      
      // Limit layers to reasonable amounts
      if (midLayers > 2) return false;  // max 2 mid layers
      if (outerLayers > 1) return false; // max 1 outer layer
      
      // Valid structure: one-piece outfit (with optional mid/outer layers)
      // e.g., dress alone, dress + cardigan, dress + jacket, dress + cardigan + jacket
      if (onePieces === 1) return true;
      
      // For non-one-piece outfits: MUST have exactly 1 base top and 1 bottom
      if (baseTops !== 1 || bottoms !== 1) return false;
      
      // Valid layering combinations (all require base top + bottom):
      // 1. Base only: base + bottom
      // 2. Base + mid: base + mid + bottom
      // 3. Base + outer: base + outer + bottom
      // 4. Base + mid + outer: base + mid + outer + bottom
      
      return true;
    }
    
    const validOutfits = (parsed.outfits || [])
      .filter(outfit => {
        // Ensure all item IDs exist
        if (!outfit.itemIds.every(id => itemMap.has(id))) return false;
        // Ensure all locked items are included
        if (lockedItemIds.length > 0) {
          const outfitIdSet = new Set(outfit.itemIds);
          if (!lockedItemIds.every((id: string) => outfitIdSet.has(id))) return false;
        }
        // Ensure valid outfit structure
        return isValidOutfitStructure(outfit.itemIds);
      })
      .map(outfit => ({
        ...outfit,
        items: outfit.itemIds.map(id => {
          const item = itemMap.get(id)!;
          const fullItem = docs.find(d => d._id.toString() === id);
          return {
            id: item.id,
            name: item.name,
            category: item.category,
            subCategory: item.subCategory,
            layerRole: item.layerRole,
            colors: item.colors,
            imagePath: fullItem?.imagePath,
            isLocked: lockedSet.has(id)
          };
        })
      }));

    return NextResponse.json({
      outfits: validOutfits,
      notEnoughItems: parsed.notEnoughItems || false,
      message: parsed.message || "",
      environment: env,
      lockedItemIds
    });
  } catch (error) {
    console.error("Error regenerating recommendations:", error);
    const message = error instanceof Error ? error.message : "Failed to regenerate recommendations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
