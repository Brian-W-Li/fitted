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
function setupMocks(existing: Record<string, unknown> = { name: "Cotton Tee", category: "top" }) {
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

  // The warmth re-derivation path reads the existing row (merge baseline) via
  // findOne(...).select(...).lean().exec().
  const findOne = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) }),
    }),
  });

  initDatabase.mockResolvedValue({
    User: {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: { toString: () => "user-id" } }),
      }),
    },
    WardrobeItem: { findOneAndUpdate, findOne },
    WardrobeImage: { deleteOne: jest.fn() },
  });

  return { findOneAndUpdate, findOne };
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

  // §23-H47: warmth is stored, never read-time-derived — so an edit must not leave it stale.
  it("re-derives warmth from the merged item when a warmth-driving field (name) changes", async () => {
    // existing is a light tee (would derive hot ~2); rename to a wool sweater → cold center 8.
    const { findOneAndUpdate } = setupMocks({ name: "Cotton Tee", category: "top" });

    const { PATCH } = await import("@/app/api/wardrobe/[id]/route");
    const res = await PATCH(makeRequest({ name: "Wool Sweater" }), params("item-1"));
    expect(res.status).toBe(200);
    expect(findOneAndUpdate.mock.calls[0][1].$set.warmth).toBe(8);
    expect((await res.json()).item.warmth).toBe(8);
  });

  it("honors a valid explicit warmth (the correction path) over re-derivation", async () => {
    const { findOneAndUpdate, findOne } = setupMocks({ name: "Cotton Tee", category: "top" });

    const { PATCH } = await import("@/app/api/wardrobe/[id]/route");
    // Even though the name changes to a warm garment, an explicit warmth=3 must win.
    await PATCH(makeRequest({ name: "Wool Sweater", warmth: 3 }), params("item-1"));
    expect(findOneAndUpdate.mock.calls[0][1].$set.warmth).toBe(3);
    expect(findOne).not.toHaveBeenCalled(); // explicit value short-circuits the merge read
  });

  it("rejects an out-of-range explicit warmth by falling back to re-derivation", async () => {
    const { findOneAndUpdate } = setupMocks({ name: "Cotton Tee", category: "top" });

    const { PATCH } = await import("@/app/api/wardrobe/[id]/route");
    await PATCH(makeRequest({ name: "Wool Sweater", warmth: 99 }), params("item-1"));
    // 99 is invalid → ignored → re-derived from the new name (cold 8), never persisted as 99.
    expect(findOneAndUpdate.mock.calls[0][1].$set.warmth).toBe(8);
  });

  it("does not re-derive (or read) warmth when no warmth-driving field changes", async () => {
    const { findOneAndUpdate, findOne } = setupMocks();

    const { PATCH } = await import("@/app/api/wardrobe/[id]/route");
    await PATCH(makeRequest({ isAvailable: false }), params("item-1"));
    expect("warmth" in findOneAndUpdate.mock.calls[0][1].$set).toBe(false);
    expect(findOne).not.toHaveBeenCalled();
  });
});
