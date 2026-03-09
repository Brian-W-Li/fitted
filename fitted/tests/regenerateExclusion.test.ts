/**
 * Tests for POST /api/recommend/regenerate — specifically the disliked-item exclusion
 * contract: items listed in dislikedItemIds must be absent from the WARDROBE_ITEMS JSON
 * that is sent to OpenAI, and items not listed must be present.
 *
 * Mocks: openai, @/lib/db, @/lib/firebaseAdmin, @/lib/runPersonalizationSummary
 *
 * Pattern: jest.resetModules() + dynamic import per test so that the module-scope
 * `const openai = new OpenAI(...)` in the route picks up the current mock impl.
 */

jest.mock("openai", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("@/lib/db", () => ({ initDatabase: jest.fn() }));
jest.mock("@/lib/firebaseAdmin", () => ({
  adminAuth: { verifyIdToken: jest.fn() },
}));
jest.mock("@/lib/runPersonalizationSummary", () => ({
  runPersonalizationSummarize: jest.fn(),
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

/** Extract the WARDROBE_ITEMS JSON array from the OpenAI user-message content string. */
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

// A minimal wardrobe: shirt (top) + jeans (bottom) + jacket (outer) + shoes (footwear)
const WARDROBE = [
  makeItem("shirt-1", "White Shirt", "top"),
  makeItem("jeans-1", "Blue Jeans", "bottom"),
  makeItem("jacket-1", "Black Jacket", "outer", { layerRole: "outer" }),
  makeItem("shoes-1", "White Sneakers", "footwear"),
  makeItem("shirt-2", "Grey Polo", "top"),
];

function makeDbMock(
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

  adminAuth.verifyIdToken.mockResolvedValue({ uid: "firebase-uid" });
  runPersonalizationSummarize.mockResolvedValue({ success: false, message: "not enough data" });

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

const OPENAI_EMPTY_RESPONSE = {
  choices: [
    {
      message: {
        content: JSON.stringify({ outfits: [], notEnoughItems: false, message: "" }),
      },
    },
  ],
};

// ---------------------------------------------------------------------------

describe("POST /api/recommend/regenerate — disliked-item exclusion", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv, OPENAI_API_KEY: "test-key" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("includes all available items when dislikedItemIds is empty", async () => {
    const mockCreate = jest.fn().mockResolvedValue(OPENAI_EMPTY_RESPONSE);
    makeDbMock(mockCreate);

    const { POST } = await import("@/app/api/recommend/regenerate/route");
    const req = makeRequest({
      eventDescription: "casual hangout with friends",
      dislikedItemIds: [],
    });

    await POST(req as any);

    const content: string = mockCreate.mock.calls[0][0].messages[1].content;
    const ids = extractWardrobeItemIds(content);

    expect(ids).toContain("shirt-1");
    expect(ids).toContain("jeans-1");
    expect(ids).toContain("jacket-1");
    expect(ids).toContain("shoes-1");
    expect(ids).toContain("shirt-2");
  });

  it("excludes a single disliked item from WARDROBE_ITEMS", async () => {
    const mockCreate = jest.fn().mockResolvedValue(OPENAI_EMPTY_RESPONSE);
    makeDbMock(mockCreate);

    const { POST } = await import("@/app/api/recommend/regenerate/route");
    const req = makeRequest({
      eventDescription: "casual hangout with friends",
      dislikedItemIds: ["jacket-1"],
    });

    await POST(req as any);

    const content: string = mockCreate.mock.calls[0][0].messages[1].content;
    const ids = extractWardrobeItemIds(content);

    expect(ids).not.toContain("jacket-1"); // hard-excluded
    expect(ids).toContain("shirt-1");
    expect(ids).toContain("jeans-1");
    expect(ids).toContain("shoes-1");
  });

  it("excludes multiple disliked items while keeping non-disliked items", async () => {
    const mockCreate = jest.fn().mockResolvedValue(OPENAI_EMPTY_RESPONSE);
    makeDbMock(mockCreate);

    const { POST } = await import("@/app/api/recommend/regenerate/route");
    const req = makeRequest({
      eventDescription: "casual hangout with friends",
      dislikedItemIds: ["shirt-1", "shoes-1"],
    });

    await POST(req as any);

    const content: string = mockCreate.mock.calls[0][0].messages[1].content;
    const ids = extractWardrobeItemIds(content);

    expect(ids).not.toContain("shirt-1");
    expect(ids).not.toContain("shoes-1");
    expect(ids).toContain("jeans-1");
    expect(ids).toContain("jacket-1");
    expect(ids).toContain("shirt-2");
  });

  it("is exact-match: disliking 'shirt' does not exclude 'shirt-1' or 'shirt-2'", async () => {
    const mockCreate = jest.fn().mockResolvedValue(OPENAI_EMPTY_RESPONSE);
    makeDbMock(mockCreate);

    const { POST } = await import("@/app/api/recommend/regenerate/route");
    const req = makeRequest({
      eventDescription: "casual hangout",
      dislikedItemIds: ["shirt"], // not a real ID in our wardrobe
    });

    await POST(req as any);

    const content: string = mockCreate.mock.calls[0][0].messages[1].content;
    const ids = extractWardrobeItemIds(content);

    // partial IDs must not be excluded
    expect(ids).toContain("shirt-1");
    expect(ids).toContain("shirt-2");
  });

  it("ignores nonexistent disliked IDs — no crash, all real items remain", async () => {
    const mockCreate = jest.fn().mockResolvedValue(OPENAI_EMPTY_RESPONSE);
    makeDbMock(mockCreate);

    const { POST } = await import("@/app/api/recommend/regenerate/route");
    const req = makeRequest({
      eventDescription: "casual hangout",
      dislikedItemIds: ["ghost-id-1", "ghost-id-2"],
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);

    const content: string = mockCreate.mock.calls[0][0].messages[1].content;
    const ids = extractWardrobeItemIds(content);

    expect(ids).toContain("shirt-1");
    expect(ids).toContain("jeans-1");
  });

  it("already-unavailable items are excluded regardless of dislikedItemIds", async () => {
    const wardrobeWithUnavailable = [
      ...WARDROBE,
      makeItem("unavail-1", "Unavailable Coat", "outer", { isAvailable: false }),
    ];
    const mockCreate = jest.fn().mockResolvedValue(OPENAI_EMPTY_RESPONSE);
    makeDbMock(mockCreate, wardrobeWithUnavailable);

    const { POST } = await import("@/app/api/recommend/regenerate/route");
    const req = makeRequest({
      eventDescription: "casual hangout",
      dislikedItemIds: [], // not disliked, but isAvailable: false
    });

    await POST(req as any);

    const content: string = mockCreate.mock.calls[0][0].messages[1].content;
    const ids = extractWardrobeItemIds(content);

    expect(ids).not.toContain("unavail-1");
  });
});
