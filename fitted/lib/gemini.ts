import { GoogleGenerativeAI } from "@google/generative-ai";

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenerativeAI(apiKey);
}

export type OutfitItemForInference = {
  name?: string;
  category?: string;
  subCategory?: string;
  colors?: string[];
  layerRole?: string;
  pattern?: string;
};

/**
 * Infer "what went right or wrong" for a single like/dislike event.
 * Returns 1-2 sentences. Used to populate OutfitInteraction.inferredWhy.
 */
export async function inferWhyForInteraction(params: {
  action: "accepted" | "rejected";
  occasion: string;
  items: OutfitItemForInference[];
  dislikedItemNames?: string[];
}): Promise<string | null> {
  const gen = getClient();
  if (!gen) return null;

  const { action, occasion, items, dislikedItemNames } = params;
  const itemSummary = items
    .map((i) => `${i.name || "Item"} (${i.category}${i.subCategory ? ` / ${i.subCategory}` : ""}${i.colors?.length ? `, colors: ${i.colors.join(", ")}` : ""}${i.layerRole ? `, ${i.layerRole}` : ""})`)
    .join("; ");
  const dislikedNote =
    action === "rejected" && dislikedItemNames?.length
      ? ` The user specifically marked these pieces as disliked: ${dislikedItemNames.join(", ")}.`
      : "";

  const prompt = `The user ${action === "accepted" ? "liked" : "disliked"} this outfit.
Occasion: ${occasion}
Outfit pieces: ${itemSummary}
${dislikedNote}

In 1-2 short sentences, what went ${action === "accepted" ? "right" : "wrong"} with this outfit? Be specific (e.g. color, layering, formality, fit, combination). If they only disliked certain pieces, focus on why those pieces or their combination with the rest might not work. Reply with only the 1-2 sentences, no prefix.`;

  const modelId = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  try {
    const model = gen.getGenerativeModel({ model: modelId });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return text?.trim()?.slice(0, 500) || null;
  } catch (e) {
    console.error("Gemini inferWhy error:", e);
    return null;
  }
}

/**
 * Generate personalization summary from a list of interactions that have inferredWhy.
 * Uses current summary as prior so one-off events don't override established patterns.
 */
export async function generatePersonalizationSummary(params: {
  events: { action: "accepted" | "rejected"; occasion?: string; inferredWhy: string }[];
  currentSummary: string | null;
}): Promise<string | null> {
  const gen = getClient();
  if (!gen) return null;

  const { events, currentSummary } = params;
  const list = events
    .map(
      (e, i) =>
        `${i + 1}. ${e.action.toUpperCase()} (occasion: ${e.occasion || "—"})\n   Why: ${e.inferredWhy}`
    )
    .join("\n\n");

  const prompt = `You are updating a user's style profile for an outfit recommendation app.

Current style profile (may be empty):
${currentSummary || "(none yet)"}

Recent feedback events, each with an inferred reason (what went right or wrong):
${list}

Produce an updated style profile in 3-5 bullet points. Rules:
- Reflect patterns that appear in multiple events.
- A single opposite event (e.g. one like after many dislikes on similar looks) must NOT flip the profile; at most add a nuance like "sometimes open to X in the right context" or leave that part unchanged.
- Keep the profile stable; only change when there is clear, repeated evidence.
- Write in second person or as a style profile (e.g. "Prefers...", "Tends to avoid...").
- Output only the bullet list, each line starting with "- ".`;

  const modelId = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  try {
    const model = gen.getGenerativeModel({ model: modelId });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return text?.trim()?.slice(0, 2000) || null;
  } catch (e) {
    console.error("Gemini generatePersonalizationSummary error:", e);
    return null;
  }
}
