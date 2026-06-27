/**
 * M4 C2 — the edit (PATCH) half of the ingestion contract.
 *
 * §14.2 C2 trap-guard: editing an item's clothingType must NOT silently revert it —
 * the 5-value enum has to survive an edit round-trip, not get coerced back to
 * top/bottom (the legacy `=== "bottom" ? "bottom" : "top"` funnel). A regression to
 * that funnel would otherwise pass the rest of the suite green.
 *
 * Mocks: @/lib/db, @/lib/firebaseAdmin (real lib/clothingType runs).
 */
jest.mock("@/lib/db", () => ({ initDatabase: jest.fn() }));
jest.mock("@/lib/firebaseAdmin", () => ({
  adminAuth: { verifyIdToken: jest.fn() },
}));

import type { NextRequest } from "next/server";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return {
    headers: {
      get: (h: string) => (h === "authorization" ? "Bearer fake-token" : null),
    },
    json: async () => body,
  } as unknown as NextRequest;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Capture the $set passed to findOneAndUpdate and echo it back as the updated doc. */
function setupMocks() {
  const { initDatabase } = jest.requireMock("@/lib/db") as { initDatabase: jest.Mock };
  const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
    adminAuth: { verifyIdToken: jest.Mock };
  };
  adminAuth.verifyIdToken.mockResolvedValue({ uid: "firebase-uid" });

  const findOneAndUpdate = jest.fn().mockImplementation(
    (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => ({
      exec: async () => ({
        _id: { toString: () => (filter._id as string) ?? "item-id" },
        category: "top",
        ...update.$set,
      }),
    }),
  );

  initDatabase.mockResolvedValue({
    User: {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: { toString: () => "user-id" } }),
      }),
    },
    WardrobeItem: { findOneAndUpdate },
    WardrobeImage: { deleteOne: jest.fn() },
  });

  return { findOneAndUpdate };
}

describe("PATCH /api/wardrobe/[id] — M4 ingestion (edit round-trip)", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it.each(["dress", "outer_layer", "shoes"] as const)(
    "persists an explicit clothingType=%s without coercing it back to top/bottom",
    async (type) => {
      const { findOneAndUpdate } = setupMocks();

      const { PATCH } = await import("@/app/api/wardrobe/[id]/route");
      const res = await PATCH(makeRequest({ clothingType: type }), params("item-1"));
      expect(res.status).toBe(200);

      // The $set carries the un-coerced 5-value type, and the response echoes it.
      expect(findOneAndUpdate.mock.calls[0][1].$set.clothingType).toBe(type);
      const body = await res.json();
      expect(body.item.clothingType).toBe(type);
    },
  );

  it("normalizes an invalid clothingType on edit to top (never persists garbage)", async () => {
    const { findOneAndUpdate } = setupMocks();

    const { PATCH } = await import("@/app/api/wardrobe/[id]/route");
    const res = await PATCH(makeRequest({ clothingType: "hat" }), params("item-1"));
    expect(res.status).toBe(200);
    expect(findOneAndUpdate.mock.calls[0][1].$set.clothingType).toBe("top");
  });

  it("scopes the update to the owning user (no cross-user edit)", async () => {
    const { findOneAndUpdate } = setupMocks();

    const { PATCH } = await import("@/app/api/wardrobe/[id]/route");
    await PATCH(makeRequest({ name: "Renamed" }), params("item-42"));
    expect(findOneAndUpdate.mock.calls[0][0]).toEqual({ _id: "item-42", user: "user-id" });
  });

  it("does not touch clothingType when the edit body omits it", async () => {
    const { findOneAndUpdate } = setupMocks();

    const { PATCH } = await import("@/app/api/wardrobe/[id]/route");
    await PATCH(makeRequest({ name: "Just a rename" }), params("item-1"));
    expect("clothingType" in findOneAndUpdate.mock.calls[0][1].$set).toBe(false);
  });
});
