/**
 * Tests for runPersonalizationSummarize — the lazy preference-summary refresh utility.
 *
 * Mocks:
 *   @/lib/db     — MongoDB models (OutfitInteraction, PreferenceSummary)
 *   @/lib/gemini — Gemini API (generatePersonalizationSummary, isValidPreferenceSummary)
 *
 * No jest.resetModules() needed — this is a pure library function, not a route module.
 * Static imports work fine since the mock factories are applied once for the whole file.
 */

jest.mock("@/lib/db", () => ({ initDatabase: jest.fn() }));
jest.mock("@/lib/gemini", () => ({
  generatePersonalizationSummary: jest.fn(),
  isValidPreferenceSummary: jest.fn(),
}));

import { runPersonalizationSummarize } from "@/lib/runPersonalizationSummary";
import { initDatabase } from "@/lib/db";
import { generatePersonalizationSummary, isValidPreferenceSummary } from "@/lib/gemini";

const mockInitDatabase = initDatabase as jest.MockedFunction<typeof initDatabase>;
const mockGenerate = generatePersonalizationSummary as jest.MockedFunction<
  typeof generatePersonalizationSummary
>;
const mockIsValid = isValidPreferenceSummary as jest.MockedFunction<
  typeof isValidPreferenceSummary
>;

// ---------------------------------------------------------------------------
// Mongoose mock helpers
// ---------------------------------------------------------------------------

/** Builds a mock for Model.find({}).sort().limit().lean().exec() */
function makeChainedFind(result: unknown[]) {
  const exec = jest.fn().mockResolvedValue(result);
  const lean = jest.fn().mockReturnValue({ exec });
  const limit = jest.fn().mockReturnValue({ lean, exec });
  const sort = jest.fn().mockReturnValue({ lean, limit, exec });
  return jest.fn().mockReturnValue({ sort, limit, lean, exec });
}

/** Builds a mock for Model.findOne({}).lean().exec() */
function makeFindOne(result: unknown) {
  const exec = jest.fn().mockResolvedValue(result);
  const lean = jest.fn().mockReturnValue({ exec });
  return jest.fn().mockReturnValue({ lean, exec });
}

/** Builds a database mock with configurable interactions and summary */
function makeDb(
  interactions: unknown[],
  existingSummary: unknown,
  findOneAndUpdateResult: unknown = { updatedAt: new Date() }
) {
  return {
    OutfitInteraction: { find: makeChainedFind(interactions) },
    PreferenceSummary: {
      findOne: makeFindOne(existingSummary),
      findOneAndUpdate: jest.fn().mockResolvedValue(findOneAndUpdateResult),
    },
  };
}

const VALID_SUMMARY =
  "- Prefers casual smart outfits\n- Avoids heavy winter coats\n- Likes neutral colors";

// ---------------------------------------------------------------------------

describe("runPersonalizationSummarize — Gemini call gating", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, GEMINI_API_KEY: "test-key" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ---- GEMINI_API_KEY gate ----

  it("fails immediately without calling DB or Gemini when GEMINI_API_KEY is unset", async () => {
    delete process.env.GEMINI_API_KEY;

    const result = await runPersonalizationSummarize("user-1");

    expect(result.success).toBe(false);
    expect(mockInitDatabase).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  // ---- Minimum-interactions threshold (< 3 → no Gemini call) ----

  it("does NOT call Gemini when there are 0 interactions", async () => {
    mockInitDatabase.mockResolvedValue(makeDb([], null) as any);

    const result = await runPersonalizationSummarize("user-1");

    expect(result.success).toBe(false);
    expect(result.feedbackCount).toBe(0);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("does NOT call Gemini when there are exactly 2 interactions (just below threshold)", async () => {
    const interactions = [
      { action: "accepted", inferredWhy: "Liked the casual vibe", context: {} },
      { action: "rejected", inferredWhy: "Too formal", context: {} },
    ];
    mockInitDatabase.mockResolvedValue(makeDb(interactions, null) as any);

    const result = await runPersonalizationSummarize("user-1");

    expect(result.success).toBe(false);
    expect(result.feedbackCount).toBe(2);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  // ---- Threshold boundary (exactly 3 → Gemini IS called) ----

  it("calls Gemini exactly once when exactly 3 interactions exist (threshold boundary)", async () => {
    const interactions = [
      { action: "accepted", inferredWhy: "Liked casual vibe", context: { occasion: "casual" } },
      { action: "rejected", inferredWhy: "Too formal", context: { occasion: "formal" } },
      { action: "accepted", inferredWhy: "Colors worked well", context: { occasion: "casual" } },
    ];
    mockInitDatabase.mockResolvedValue(makeDb(interactions, null) as any);
    mockGenerate.mockResolvedValue(VALID_SUMMARY);
    mockIsValid.mockReturnValue(true);

    const result = await runPersonalizationSummarize("user-1");

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.feedbackCount).toBe(3);
  });

  it("calls Gemini when more than 3 interactions exist", async () => {
    const interactions = Array.from({ length: 10 }, (_, i) => ({
      action: i % 2 === 0 ? "accepted" : "rejected",
      inferredWhy: `Reason ${i}`,
      context: { occasion: "casual" },
    }));
    mockInitDatabase.mockResolvedValue(makeDb(interactions, { text: "Old summary" }) as any);
    mockGenerate.mockResolvedValue(VALID_SUMMARY);
    mockIsValid.mockReturnValue(true);

    const result = await runPersonalizationSummarize("user-1");

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(result.feedbackCount).toBe(10);
  });

  // ---- currentSummary forwarding ----

  it("passes null as currentSummary to Gemini when no existing summary exists", async () => {
    const interactions = Array.from({ length: 5 }, (_, i) => ({
      action: "accepted",
      inferredWhy: `Reason ${i}`,
      context: {},
    }));
    mockInitDatabase.mockResolvedValue(makeDb(interactions, null) as any);
    mockGenerate.mockResolvedValue(VALID_SUMMARY);
    mockIsValid.mockReturnValue(true);

    await runPersonalizationSummarize("user-1");

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ currentSummary: null })
    );
  });

  it("passes existing text as currentSummary to Gemini for incremental refinement", async () => {
    const existing = "- Existing: likes casual looks\n- Avoids formal";
    const interactions = Array.from({ length: 5 }, (_, i) => ({
      action: "accepted",
      inferredWhy: `Reason ${i}`,
      context: {},
    }));
    mockInitDatabase.mockResolvedValue(makeDb(interactions, { text: existing }) as any);
    mockGenerate.mockResolvedValue(VALID_SUMMARY);
    mockIsValid.mockReturnValue(true);

    await runPersonalizationSummarize("user-1");

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ currentSummary: existing })
    );
  });

  // ---- Gemini output validation ----

  it("does NOT store summary and returns failure when Gemini returns null", async () => {
    const interactions = Array.from({ length: 5 }, (_, i) => ({
      action: "accepted",
      inferredWhy: `Reason ${i}`,
      context: {},
    }));
    const db = makeDb(interactions, null);
    const mockFindOneAndUpdate = (db.PreferenceSummary as any).findOneAndUpdate;
    mockInitDatabase.mockResolvedValue(db as any);
    mockGenerate.mockResolvedValue(null);

    const result = await runPersonalizationSummarize("user-1");

    expect(result.success).toBe(false);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("does NOT store summary when output fails isValidPreferenceSummary, falls back to existing", async () => {
    const existingText = "- Existing valid preference summary\n- Prefers casual looks";
    const interactions = Array.from({ length: 5 }, (_, i) => ({
      action: "accepted",
      inferredWhy: `Reason ${i}`,
      context: {},
    }));
    const db = makeDb(interactions, { text: existingText });
    const mockFindOneAndUpdate = (db.PreferenceSummary as any).findOneAndUpdate;
    mockInitDatabase.mockResolvedValue(db as any);
    mockGenerate.mockResolvedValue("I'm sorry, I cannot generate a profile.");
    mockIsValid.mockReturnValue(false);

    const result = await runPersonalizationSummarize("user-1");

    expect(result.success).toBe(false);
    expect(result.summaryText).toBe(existingText); // falls back to existing, does not return garbage
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  // ---- Successful upsert path ----

  it("upserts summary via findOneAndUpdate with correct shape when valid", async () => {
    const interactions = Array.from({ length: 3 }, (_, i) => ({
      action: "accepted",
      inferredWhy: `Reason ${i}`,
      createdAt: new Date("2024-01-0" + (i + 1)),
      context: {},
    }));
    const db = makeDb(interactions, null);
    const mockFindOneAndUpdate = (db.PreferenceSummary as any).findOneAndUpdate as jest.Mock;
    mockInitDatabase.mockResolvedValue(db as any);
    mockGenerate.mockResolvedValue(VALID_SUMMARY);
    mockIsValid.mockReturnValue(true);

    const result = await runPersonalizationSummarize("user-1");

    expect(result.success).toBe(true);
    expect(result.summaryText).toBe(VALID_SUMMARY);
    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { user: "user-1" },
      expect.objectContaining({ text: VALID_SUMMARY, feedbackCount: 3 }),
      { upsert: true, new: true }
    );
  });

  it("returns the new summaryText and feedbackCount on success", async () => {
    const interactions = Array.from({ length: 7 }, (_, i) => ({
      action: "accepted",
      inferredWhy: `Reason ${i}`,
      context: {},
    }));
    mockInitDatabase.mockResolvedValue(makeDb(interactions, null) as any);
    mockGenerate.mockResolvedValue(VALID_SUMMARY);
    mockIsValid.mockReturnValue(true);

    const result = await runPersonalizationSummarize("user-1");

    expect(result.success).toBe(true);
    expect(result.summaryText).toBe(VALID_SUMMARY);
    expect(result.feedbackCount).toBe(7);
  });
});
