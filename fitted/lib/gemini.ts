import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_TIMEOUT_MS = 15_000;

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenerativeAI(apiKey);
}

/** Race a Gemini promise against a fixed timeout. Rejects with an Error whose name is "GeminiTimeout" on timeout. */
function withGeminiTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      const err = new Error(`Gemini ${label} timed out after ${GEMINI_TIMEOUT_MS / 1000}s`);
      err.name = "GeminiTimeout";
      reject(err);
    }, GEMINI_TIMEOUT_MS);
    promise.then(
      (v) => { clearTimeout(id); resolve(v); },
      (e) => { clearTimeout(id); reject(e); },
    );
  });
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
    console.info(JSON.stringify({ event: "gemini_infer_why_start", action, occasion }));
    const result = await withGeminiTimeout(model.generateContent(prompt), "inferWhy");
    const text = result.response.text();
    const out = text?.trim()?.slice(0, 500) || null;
    console.info(JSON.stringify({ event: "gemini_infer_why_success", chars: out?.length ?? 0 }));
    return out;
  } catch (e) {
    const isTimeout = (e as Error)?.name === "GeminiTimeout";
    console.error(JSON.stringify({ event: "gemini_infer_why_error", isTimeout, message: (e as Error)?.message }));
    return null;
  }
}
