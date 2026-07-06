/**
 * Tests for POST /api/interactions — interaction persistence contract.
 *
 * Verifies that OutfitInteraction.create is called with the correct shape
 * for accepted, rejected, and rejected-with-perItemFeedback interactions.
 * The non-blocking Gemini inferWhy IIFE is suppressed by leaving GEMINI_API_KEY unset.
 *
 * Mocks: @/lib/db, @/lib/firebaseAdmin, @/lib/gemini
 */

jest.mock("@/lib/db", () => ({ initDatabase: jest.fn() }));
jest.mock("@/lib/firebaseAdmin", () => ({
  adminAuth: { verifyIdToken: jest.fn() },
}));
jest.mock("@/lib/gemini", () => ({
  inferWhyForInteraction: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: Record<string, unknown>) {
  return {
    headers: {
      get: (h: string) => (h === "authorization" ? "Bearer fake-token" : null),
    },
    json: async () => body,
  };
}

function makeGetRequest(url = "http://localhost/api/interactions") {
  return {
    url,
    headers: {
      get: (h: string) => (h === "authorization" ? "Bearer fake-token" : null),
    },
  };
}

function setupMocks(mockCreate: jest.Mock) {
  const { initDatabase } = jest.requireMock("@/lib/db") as { initDatabase: jest.Mock };
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
    OutfitInteraction: {
      create: mockCreate,
    },
    WardrobeItem: {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    },
  });
}

function setupGetMocks(interactions: Record<string, unknown>[]) {
  const { initDatabase } = jest.requireMock("@/lib/db") as { initDatabase: jest.Mock };
  const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
    adminAuth: { verifyIdToken: jest.Mock };
  };

  adminAuth.verifyIdToken.mockResolvedValue({ uid: "firebase-uid" });

  const find = jest.fn().mockReturnValue({
    populate: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(interactions),
          }),
        }),
      }),
    }),
  });

  initDatabase.mockResolvedValue({
    User: {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: { toString: () => "user-id" } }),
      }),
    },
    OutfitInteraction: { find },
  });

  return { find };
}

// ---------------------------------------------------------------------------

describe("GET /api/interactions — history display", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("skips missing populated items instead of crashing the history response", async () => {
    setupGetMocks([
      {
        _id: { toString: () => "interaction-null-items" },
        items: null,
        action: "accepted",
        context: { occasion: "casual" },
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        _id: { toString: () => "interaction-mixed-items" },
        items: [
          null,
          { name: "Missing id", category: "top" },
          {
            _id: { toString: () => "item-1" },
            name: "Blue tee",
            category: "top",
            colors: ["blue"],
            imagePath: "mongo:image-1",
          },
        ],
        action: "rejected",
        context: {},
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]);

    const { GET } = await import("@/app/api/interactions/route");
    const res = await GET(makeGetRequest() as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.interactions).toHaveLength(2);
    expect(body.interactions[0].items).toEqual([]);
    expect(body.interactions[1].items).toEqual([
      {
        id: "item-1",
        name: "Blue tee",
        category: "top",
        colors: ["blue"],
        imagePath: "mongo:image-1",
      },
    ]);
  });
});

describe("POST /api/interactions — persistence", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    // Leave GEMINI_API_KEY unset so the non-blocking inferWhy IIFE is skipped entirely
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("persists an accepted interaction with correct user, items, and action", async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      _id: { toString: () => "interaction-id" },
      action: "accepted",
    });
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/interactions/route");
    const req = makeRequest({
      itemIds: ["item-a", "item-b"],
      action: "accepted",
      occasion: "casual",
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        user: "user-id",
        items: ["item-a", "item-b"],
        action: "accepted",
      })
    );
  });

  it("persists a rejected interaction with correct action", async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      _id: { toString: () => "interaction-id" },
      action: "rejected",
    });
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/interactions/route");
    const req = makeRequest({
      itemIds: ["item-x"],
      action: "rejected",
      occasion: "formal",
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        user: "user-id",
        action: "rejected",
      })
    );
  });

  it("persists perItemFeedback when provided with a rejected interaction", async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      _id: { toString: () => "interaction-id" },
      action: "rejected",
    });
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/interactions/route");
    const req = makeRequest({
      itemIds: ["item-a", "item-b", "item-c"],
      action: "rejected",
      occasion: "casual",
      perItemFeedback: [
        { itemId: "item-b", disliked: true, notes: "Too bright" },
        { itemId: "item-c", disliked: false },
      ],
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);

    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.perItemFeedback).toBeDefined();
    expect(callArg.perItemFeedback).toHaveLength(2);
    expect(callArg.perItemFeedback[0]).toMatchObject({ itemId: "item-b", disliked: true });
    expect(callArg.perItemFeedback[1]).toMatchObject({ itemId: "item-c", disliked: false });
  });

  it("does NOT include perItemFeedback key when none is provided", async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      _id: { toString: () => "interaction-id" },
      action: "accepted",
    });
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/interactions/route");
    const req = makeRequest({
      itemIds: ["item-a"],
      action: "accepted",
      occasion: "casual",
    });

    await POST(req as any);

    const callArg = mockCreate.mock.calls[0][0];
    // No perItemFeedback key should be spread into the create call
    expect(callArg.perItemFeedback).toBeUndefined();
  });

  it("strips malformed perItemFeedback entries (missing itemId)", async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      _id: { toString: () => "interaction-id" },
      action: "rejected",
    });
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/interactions/route");
    const req = makeRequest({
      itemIds: ["item-a", "item-b"],
      action: "rejected",
      occasion: "casual",
      perItemFeedback: [
        { itemId: "item-a", disliked: true },
        { disliked: true }, // missing itemId — should be filtered out
      ],
    });

    await POST(req as any);

    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.perItemFeedback).toHaveLength(1);
    expect(callArg.perItemFeedback[0].itemId).toBe("item-a");
  });

  it("truncates perItemFeedback notes to 500 characters", async () => {
    const longNote = "x".repeat(600);
    const mockCreate = jest.fn().mockResolvedValue({
      _id: { toString: () => "interaction-id" },
      action: "rejected",
    });
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/interactions/route");
    const req = makeRequest({
      itemIds: ["item-a"],
      action: "rejected",
      occasion: "casual",
      perItemFeedback: [{ itemId: "item-a", disliked: true, notes: longNote }],
    });

    await POST(req as any);

    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.perItemFeedback[0].notes).toHaveLength(500);
  });

  it("returns 400 when itemIds is missing", async () => {
    const mockCreate = jest.fn();
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/interactions/route");
    const req = makeRequest({ action: "accepted" }); // no itemIds

    const res = await POST(req as any);
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when action is an invalid value", async () => {
    const mockCreate = jest.fn();
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/interactions/route");
    const req = makeRequest({ itemIds: ["item-a"], action: "swiped" });

    const res = await POST(req as any);
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns success payload with interaction id and action", async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      _id: { toString: () => "abc-123" },
      action: "accepted",
    });
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/interactions/route");
    const req = makeRequest({
      itemIds: ["item-a"],
      action: "accepted",
      occasion: "casual",
    });

    const res = await POST(req as any);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.interaction.id).toBe("abc-123");
    expect(body.interaction.action).toBe("accepted");
  });
});

export {}; // mark as a module so top-level test helpers are file-scoped (tsc --noEmit: no cross-file name collisions)
