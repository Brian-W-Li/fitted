/**
 * M4 C2 — the one automated guard on the live data path.
 *
 * Verifies the rebuilt POST /api/wardrobe writes a row with a valid 5-value
 * clothingType + a 0..10 warmth, and no longer coerces dress/outer_layer/shoes
 * down to top/bottom.
 *
 * Mocks: @/lib/db, @/lib/firebaseAdmin (real lib/clothingType + lib/deriveWarmth run).
 */
jest.mock("@/lib/db", () => ({ initDatabase: jest.fn() }));
jest.mock("@/lib/firebaseAdmin", () => ({
  adminAuth: { verifyIdToken: jest.fn() },
}));

import type { NextRequest } from "next/server";
import { CLOTHING_TYPES } from "@/lib/clothingType";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return {
    headers: {
      get: (h: string) => (h === "authorization" ? "Bearer fake-token" : null),
    },
    json: async () => body,
  } as unknown as NextRequest;
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
    WardrobeItem: { create: mockCreate },
  });
}

const okCreate = () =>
  jest.fn().mockImplementation(async (doc: Record<string, unknown>) => ({
    _id: { toString: () => "item-id" },
    ...doc,
  }));

describe("POST /api/wardrobe — M4 ingestion", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("persists a dress without coercing it to top/bottom, plus a valid warmth", async () => {
    const mockCreate = okCreate();
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/wardrobe/route");
    const res = await POST(
      makeRequest({ name: "Floral midi dress", category: "one piece", clothingType: "dress" }),
    );
    expect(res.status).toBe(201);

    const arg = mockCreate.mock.calls[0][0];
    expect(arg.clothingType).toBe("dress");
    expect(CLOTHING_TYPES).toContain(arg.clothingType);
    expect(typeof arg.warmth).toBe("number");
    expect(arg.warmth).toBeGreaterThanOrEqual(0);
    expect(arg.warmth).toBeLessThanOrEqual(10);
  });

  it("preserves outer_layer and derives a warm value for a wool coat", async () => {
    const mockCreate = okCreate();
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/wardrobe/route");
    const res = await POST(
      makeRequest({
        name: "Wool overcoat",
        category: "outer",
        clothingType: "outer_layer",
        seasons: ["winter"],
      }),
    );
    expect(res.status).toBe(201);

    const arg = mockCreate.mock.calls[0][0];
    expect(arg.clothingType).toBe("outer_layer");
    expect(arg.warmth).toBeGreaterThanOrEqual(6); // cold band
  });

  it("classifies clothingType from category/name when the form omits it", async () => {
    const mockCreate = okCreate();
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/wardrobe/route");
    // No clothingType in the body (today's upload form does not send one).
    const res = await POST(
      makeRequest({ name: "Strappy sandals", category: "footwear" }),
    );
    expect(res.status).toBe(201);
    expect(mockCreate.mock.calls[0][0].clothingType).toBe("shoes");
  });

  it("classifies a dress from a one-piece category when clothingType is omitted", async () => {
    const mockCreate = okCreate();
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/wardrobe/route");
    const res = await POST(
      makeRequest({ name: "Summer maxi", category: "one piece" }),
    );
    expect(res.status).toBe(201);
    expect(mockCreate.mock.calls[0][0].clothingType).toBe("dress");
  });

  it("lets a VALID form-supplied clothingType win over derivation", async () => {
    const mockCreate = okCreate();
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/wardrobe/route");
    // Derivation from category "footwear" would say "shoes"; the explicit valid
    // "top" must win. (Non-tautological: derived value != supplied value.)
    const res = await POST(
      makeRequest({ name: "My favorite top", category: "footwear", clothingType: "top" }),
    );
    expect(res.status).toBe(201);
    expect(mockCreate.mock.calls[0][0].clothingType).toBe("top");
  });

  it("honors a valid supplied warmth, else derives it", async () => {
    const mockCreate = okCreate();
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/wardrobe/route");
    const res = await POST(
      makeRequest({ name: "Cotton tee", category: "top", warmth: 9 }),
    );
    expect(res.status).toBe(201);
    expect(mockCreate.mock.calls[0][0].warmth).toBe(9); // supplied wins

    const mockCreate2 = okCreate();
    setupMocks(mockCreate2);
    const { POST: POST2 } = await import("@/app/api/wardrobe/route");
    const res2 = await POST2(
      makeRequest({ name: "Cotton tee", category: "top", warmth: 99 }), // out of range → derive
    );
    expect(res2.status).toBe(201);
    const w = mockCreate2.mock.calls[0][0].warmth;
    expect(w).toBeGreaterThanOrEqual(0);
    expect(w).toBeLessThanOrEqual(10);
    expect(w).not.toBe(99);
  });

  it("falls back to classification when an invalid clothingType is supplied", async () => {
    const mockCreate = okCreate();
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/wardrobe/route");
    // "hat" is not a valid 5-value type → derive from category instead of blind top-default.
    const res = await POST(
      makeRequest({ name: "Chelsea boots", category: "footwear", clothingType: "hat" }),
    );
    expect(res.status).toBe(201);
    expect(mockCreate.mock.calls[0][0].clothingType).toBe("shoes");
  });

  it("returns the derived warmth in the response body (mirrors GET/PATCH, no refetch needed)", async () => {
    const mockCreate = okCreate();
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/wardrobe/route");
    const res = await POST(
      makeRequest({ name: "Wool overcoat", category: "outer", clothingType: "outer_layer", seasons: ["winter"] }),
    );
    expect(res.status).toBe(201);

    const stored = mockCreate.mock.calls[0][0].warmth;
    const body = await res.json();
    // The response must surface the same warmth that was stored — the GET/PATCH responses
    // already do; the POST response previously dropped it (§6.1/§15.1 authoritative warmth).
    expect(typeof body.item.warmth).toBe("number");
    expect(body.item.warmth).toBe(stored);
  });

  it("still 400s when name/category are missing (no create attempted)", async () => {
    const mockCreate = okCreate();
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/wardrobe/route");
    const res = await POST(makeRequest({ clothingType: "top" }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only required strings before create", async () => {
    const mockCreate = okCreate();
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/wardrobe/route");
    const res = await POST(makeRequest({ name: "   ", category: "top" }));

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects scalar array fields instead of silently coercing them to []", async () => {
    const mockCreate = okCreate();
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/wardrobe/route");
    const res = await POST(
      makeRequest({ name: "Cotton tee", category: "top", seasons: "winter" }),
    );

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects string booleans instead of coercing \"false\" to true", async () => {
    const mockCreate = okCreate();
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/wardrobe/route");
    const res = await POST(
      makeRequest({ name: "Cotton tee", category: "top", isAvailable: "false" }),
    );

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("persists an explicit false availability flag", async () => {
    const mockCreate = okCreate();
    setupMocks(mockCreate);

    const { POST } = await import("@/app/api/wardrobe/route");
    const res = await POST(
      makeRequest({ name: "Cotton tee", category: "top", isAvailable: false }),
    );

    expect(res.status).toBe(201);
    expect(mockCreate.mock.calls[0][0].isAvailable).toBe(false);
  });
});
