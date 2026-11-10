import { Types } from "mongoose";
import User from "@/models/User";
import GenerationSnapshot from "@/models/GenerationSnapshot";
const oid = () => new Types.ObjectId().toHexString();

// The post-persist erasure-race check requires a live User row (§23-H43) — seed one per test user.
export async function seedUser(userId: string) {
  await User.findOneAndUpdate(
    { _id: userId },
    { $setOnInsert: { authProvider: "firebase", authId: `auth-${userId}`, email: `${userId}@t.example` } },
    { upsert: true },
  ).exec();
}

// Build a valid snapshot owned by `userId` with one shown two-piece candidate.
export async function makeSnapshot(
  userId: string,
  opts: { candidateId?: string; itemIds?: [string, string]; shown?: boolean; occasion?: string } = {},
) {
  await seedUser(userId);
  const candidateId = opts.candidateId ?? "c0";
  const [topId, bottomId] = opts.itemIds ?? [oid(), oid()];
  const shown = opts.shown ?? true;
  const candidate = {
    candidateId,
    sourceAttemptId: "a0",
    sourceIndex: 0,
    stageReached: shown ? "shown" : "ranked",
    accepted: true,
    shown,
    shownPosition: shown ? 0 : undefined,
    rejectionCodes: [],
    warningCodes: [],
    items: [
      { itemId: topId, role: "base_top" },
      { itemId: bottomId, role: "base_bottom" },
    ],
    slotMap: { top: topId, bottom: bottomId },
    template: "two_piece",
    baseKey: `top:${topId}|bottom:${bottomId}`,
    fullSignature: `top:${topId}|bottom:${bottomId}|outer=none|shoes=none`,
    optionPath: "reliable",
    risk: "safe",
    styleMove: { moveType: "anchor", changedItemIds: [topId], oneSentence: "Anchor the look." },
  };
  const snap = await GenerationSnapshot.create({
    user: userId,
    sessionId: userId,
    candidateCacheKey: "ck",
    generationIndex: 0,
    requestId: "0192f1a0-1c1a-4c3e-9b2a-1a2b3c4d5e6f",
    intent: "daily",
    occasion: opts.occasion ?? "brunch",
    weather: "mild",
    wardrobeVersion: 0,
    interactionCountAtRequest: 0,
    fittedCoreVersion: "0.4.0",
    generator: {
      provider: "openai",
      model: "gpt-5.4-mini",
      temperature: 0.5,
      promptVersion: "m5-c1.v1",
      maxCompletionTokens: 2200,
      apiSurface: "chat_completions",
      responseFormat: "json_schema_strict",
      reasoningEffort: "none",
      storeMode: "none",
      promptCacheRetention: "in_memory",
      timeoutSeconds: 30,
      maxRetries: 0,
    },
    rankerConfigVersion: "rk",
    scorer: { kind: "cold_start", available: false },
    itemSnapshots: [
      { itemId: topId, engineVisible: { name: "White Tee", clothingType: "top", warmth: 5, colorTags: ["white"], occasionTags: ["casual"], imageUrl: "mongo:img1" } },
      { itemId: bottomId, engineVisible: { name: "Blue Jeans", clothingType: "bottom", warmth: 5, colorTags: ["blue"], occasionTags: ["casual"], imageUrl: "mongo:img2" } },
    ],
    generationAttempts: [],
    candidates: [candidate],
    shownCandidateIds: shown ? [candidateId] : [],
    shownFullSignatures: shown ? [candidate.fullSignature] : [],
    nSurfaced: shown ? 1 : 0,
    spreadCollapsed: false,
  });
  return { snapshotId: snap._id.toString(), candidateId, topId, bottomId };
}
