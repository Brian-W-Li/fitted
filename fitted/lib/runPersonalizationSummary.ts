import { initDatabase } from "@/lib/db";
import { generatePersonalizationSummary, isValidPreferenceSummary } from "@/lib/gemini";

/**
 * Run personalization summarization for a user: load interactions with inferredWhy,
 * call Gemini, and upsert PreferenceSummary. Used by POST /api/preferences/summarize
 * and by POST /api/interactions when auto-summarize conditions are met.
 */
export async function runPersonalizationSummarize(userId: string): Promise<{
  success: boolean;
  summaryText?: string;
  message?: string;
  feedbackCount?: number;
  updatedAt?: Date;
}> {
  if (!process.env.GEMINI_API_KEY) {
    return { success: false, message: "GEMINI_API_KEY is required." };
  }

  const { OutfitInteraction, PreferenceSummary } = await initDatabase();

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const interactions = await OutfitInteraction.find({
    user: userId,
    action: { $in: ["accepted", "rejected"] },
    createdAt: { $gte: ninetyDaysAgo },
    inferredWhy: { $exists: true, $ne: "" },
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean()
    .exec();

  if (interactions.length < 3) {
    return {
      success: false,
      message: "Not enough feedback with inferred reasons. Need at least 3 interactions.",
      feedbackCount: interactions.length,
    };
  }

  const events = interactions.map((doc: Record<string, unknown>) => ({
    action: (doc.action === "accepted" ? "accepted" : "rejected") as "accepted" | "rejected",
    occasion: (doc.context as { occasion?: string })?.occasion,
    inferredWhy: (doc.inferredWhy as string) || "",
  }));

  const currentSummaryDoc = await PreferenceSummary.findOne({ user: userId }).lean().exec();
  const currentSummary = currentSummaryDoc
    ? (currentSummaryDoc as { text?: string }).text ?? null
    : null;

  console.info(JSON.stringify({
    event: "summarize_start",
    userId,
    eventCount: events.length,
    hasPriorSummary: !!currentSummary,
  }));

  const summaryText = await generatePersonalizationSummary({
    events,
    currentSummary,
  });

  if (!summaryText) {
    console.info(JSON.stringify({ event: "summarize_failed", userId, reason: "gemini_returned_null" }));
    return { success: false, message: "Failed to generate preference summary." };
  }

  // Validate the output before storing — reject apologies, empty text, or non-bullet prose.
  // If invalid, keep the existing valid summary rather than overwriting it with garbage.
  if (!isValidPreferenceSummary(summaryText)) {
    console.info(JSON.stringify({ event: "summarize_rejected", userId, reason: "invalid_output", preview: summaryText.slice(0, 100) }));
    return {
      success: false,
      message: "Generated summary did not pass validation. Keeping existing summary.",
      summaryText: currentSummary ?? undefined,
    };
  }

  const updated = await PreferenceSummary.findOneAndUpdate(
    { user: userId },
    {
      text: summaryText,
      feedbackCount: interactions.length,
      lastFeedbackAt: (interactions[0] as { createdAt?: Date })?.createdAt,
    },
    { upsert: true, new: true }
  );

  console.info(JSON.stringify({ event: "summarize_success", userId, feedbackCount: interactions.length }));

  return {
    success: true,
    summaryText,
    feedbackCount: interactions.length,
    updatedAt: (updated as { updatedAt?: Date })?.updatedAt,
  };
}
