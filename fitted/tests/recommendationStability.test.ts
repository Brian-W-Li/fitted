/**
 * Tests for POST /api/recommend — recommendation stability contract.
 *
 * The normal recommend route must NOT filter wardrobe items based on any
 * prior dislikes (item-level or otherwise). All available items must be
 * forwarded to OpenAI regardless of past feedback.
 *
 * Mocks: openai, @/lib/db, @/lib/firebaseAdmin, @/lib/runPersonalizationSummary,
 *        @/lib/weather
 */

jest.mock("openai", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("@/lib/db", () => ({ initDatabase: jest.fn() }));
jest.mock("@/lib/firebaseAdmin", () => ({
  adminAuth: { verifyIdToken: jest.fn() },
}));
jest.mock("@/lib/runPersonalizationSummary", () => ({
  runPersonalizationSummarize: jest.fn(),
}));
jest.mock("@/lib/weather", () => ({
  getWeatherContext: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(
  id: string,
  name: string,
  category: string,
  extra: Record<string, unknown> = {}
) {
  return {
    _id: { toString: () => id },
    name,
    category,
    isAvailable: true,
    colors: ["black"],
    seasons: [],
    occasions: [],
    ...extra,
  };
}

function makeRequest(body: Record<string, unknown>) {
  return {
    headers: {
      get: (h: string) => (h === "authorization" ? "Bearer fake-token" : null),
    },
    json: async () => body,
  };
}

/** Parse item IDs from the WARDROBE_ITEMS section of the OpenAI user message. */
function extractWardrobeItemIds(content: string): string[] {
  const marker = "WARDROBE_ITEMS:\n";
  const start = content.indexOf(marker);
  if (start === -1) return [];
  const jsonStr = content.slice(start + marker.length);
  try {
    const items = JSON.parse(jsonStr.split("\nTASK:")[0].trim()) as Array<{ id: string }>;
    return items.map((i) => i.id);
  } catch {
    return [];
  }
}

const WARDROBE = [
  makeItem("shirt-1", "White Shirt", "top"),
  makeItem("jeans-1", "Blue Jeans", "bottom"),
  makeItem("jacket-1", "Black Jacket", "outer", { layerRole: "outer" }),
  makeItem("shoes-1", "White Sneakers", "footwear"),
];

const OPENAI_EMPTY_RESPONSE = {
  choices: [
    {
      message: {
        content: JSON.stringify({ outfits: [], notEnoughItems: false, message: "" }),
      },
    },
  ],
};

function setupMocks(
  mockCreate: jest.Mock,
  wardrobeItems: ReturnType<typeof makeItem>[] = WARDROBE
) {
  const MockOpenAI = jest.requireMock("openai").default as jest.Mock;
  MockOpenAI.mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));

  const { initDatabase } = jest.requireMock("@/lib/db") as { initDatabase: jest.Mock };
  const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
    adminAuth: { verifyIdToken: jest.Mock };
  };
  const { runPersonalizationSummarize } = jest.requireMock(
    "@/lib/runPersonalizationSummary"
  ) as { runPersonalizationSummarize: jest.Mock };
  const { getWeatherContext } = jest.requireMock("@/lib/weather") as {
    getWeatherContext: jest.Mock;
  };

  adminAuth.verifyIdToken.mockResolvedValue({ uid: "firebase-uid" });
  runPersonalizationSummarize.mockResolvedValue({ success: false, message: "not enough data" });
  getWeatherContext.mockResolvedValue(null);

  initDatabase.mockResolvedValue({
    User: {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: { toString: () => "user-id" } }),
      }),
    },
    WardrobeItem: {
      find: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(wardrobeItems),
        }),
      }),
    },
    PreferenceSummary: {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      }),
    },
    OutfitInteraction: {
      countDocuments: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      }),
    },
  });
}

// ---------------------------------------------------------------------------

describe("POST /api/recommend — stability: item-level dislikes do not filter the shortlist", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv, OPENAI_API_KEY: "test-key" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("sends all available wardrobe items to OpenAI (baseline)", async () => {
    const mockCreate = jest.fn().mockResolvedValue(OPENAI_EMPTY_RESPONSE);
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/recommend/route");
    const req = makeRequest({ eventDescription: "casual hangout with friends" });

    await POST(req as any);

    const content: string = mockCreate.mock.calls[0][0].messages[1].content;
    const ids = extractWardrobeItemIds(content);

    expect(ids).toContain("shirt-1");
    expect(ids).toContain("jeans-1");
    expect(ids).toContain("jacket-1");
    expect(ids).toContain("shoes-1");
  });

  it("does NOT accept a dislikedItemIds body field — all items remain in prompt", async () => {
    // The recommend route's shortlistForLLM does not take dislikedItemIds.
    // Even if the client sends the field, it must be silently ignored.
    const mockCreate = jest.fn().mockResolvedValue(OPENAI_EMPTY_RESPONSE);
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/recommend/route");
    const req = makeRequest({
      eventDescription: "casual hangout",
      dislikedItemIds: ["jacket-1", "shoes-1"], // not a valid field for this route
    });

    await POST(req as any);

    const content: string = mockCreate.mock.calls[0][0].messages[1].content;
    const ids = extractWardrobeItemIds(content);

    // Both "disliked" items must still appear — recommend route ignores this field
    expect(ids).toContain("jacket-1");
    expect(ids).toContain("shoes-1");
  });

  it("only excludes items with isAvailable: false, never by item ID alone", async () => {
    const wardrobeWithUnavailable = [
      ...WARDROBE,
      makeItem("unavail-shirt", "Unavailable Shirt", "top", { isAvailable: false }),
    ];
    const mockCreate = jest.fn().mockResolvedValue(OPENAI_EMPTY_RESPONSE);
    setupMocks(mockCreate, wardrobeWithUnavailable);

    const { POST } = await import("@/app/api/recommend/route");
    const req = makeRequest({ eventDescription: "casual hangout" });

    await POST(req as any);

    const content: string = mockCreate.mock.calls[0][0].messages[1].content;
    const ids = extractWardrobeItemIds(content);

    // All available items present
    expect(ids).toContain("shirt-1");
    expect(ids).toContain("jeans-1");
    // Unavailable item absent — availability is the ONLY hard filter
    expect(ids).not.toContain("unavail-shirt");
  });

  it("returns 200 with standard response shape", async () => {
    const mockCreate = jest.fn().mockResolvedValue(OPENAI_EMPTY_RESPONSE);
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/recommend/route");
    const req = makeRequest({ eventDescription: "casual hangout" });

    const res = await POST(req as any);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("outfits");
    expect(Array.isArray(body.outfits)).toBe(true);
  });

  it("returns 400 when eventDescription is missing", async () => {
    const mockCreate = jest.fn();
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/recommend/route");
    const req = makeRequest({}); // no eventDescription

    const res = await POST(req as any);
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 503 when OPENAI_API_KEY is not set", async () => {
    delete process.env.OPENAI_API_KEY;

    const mockCreate = jest.fn();
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/recommend/route");
    const req = makeRequest({ eventDescription: "casual hangout" });

    const res = await POST(req as any);
    expect(res.status).toBe(503);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("includes preference summary in prompt when one exists", async () => {
    const summaryText = "- Prefers casual smart outfits\n- Avoids formal wear";
    const mockCreate = jest.fn().mockResolvedValue(OPENAI_EMPTY_RESPONSE);
    setupMocks(mockCreate);

    // Override the PreferenceSummary mock to return an existing summary
    const { initDatabase } = jest.requireMock("@/lib/db") as { initDatabase: jest.Mock };
    const existingResolvedValue = await (initDatabase as jest.Mock).mock.results[0]?.value;
    // Re-setup with a summary present
    const MockOpenAI = jest.requireMock("openai").default as jest.Mock;
    MockOpenAI.mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }));
    const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
      adminAuth: { verifyIdToken: jest.Mock };
    };
    adminAuth.verifyIdToken.mockResolvedValue({ uid: "firebase-uid" });

    initDatabase.mockResolvedValue({
      User: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ _id: { toString: () => "user-id" } }),
        }),
      },
      WardrobeItem: {
        find: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(WARDROBE) }),
        }),
      },
      PreferenceSummary: {
        findOne: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ text: summaryText, updatedAt: new Date() }),
          }),
        }),
      },
      OutfitInteraction: {
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(2), // below stale threshold (5)
        }),
      },
    });

    const { POST } = await import("@/app/api/recommend/route");
    const req = makeRequest({ eventDescription: "casual hangout" });

    await POST(req as any);

    const userContent: string = mockCreate.mock.calls[0][0].messages[1].content;
    expect(userContent).toContain("USER_PREFERENCES");
    expect(userContent).toContain(summaryText);
  });
});
