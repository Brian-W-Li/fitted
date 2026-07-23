/**
 * PATCH /api/wardrobe/[id] — the edit half of the ingestion contract, BEHAVIORAL over real in-memory
 * Mongo (post-m5-reset §4.6 / Track-1). The prior version mocked `findOneAndUpdate` and asserted the
 * `$set` it was handed — it never proved the edit actually SURVIVED a write→read, nor that the
 * owner-scope filter really excludes another user's row (the mock returned a doc regardless of the
 * filter). This version seeds a REAL item, drives the REAL route, and READS THE ROW BACK.
 *
 * §14.2 C2 trap-guard it reddens on: editing an item's clothingType must NOT silently revert it (the
 * legacy `=== "bottom" ? "bottom" : "top"` funnel). A regression to that funnel now fails the read-back.
 * §23-H47: warmth is stored, never read-time-derived — an edit must not leave it stale.
 *
 * Non-DB seams mocked (Mongo connect + Firebase token verify); models/documents are REAL.
 */
import type { NextRequest } from "next/server";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import User from "@/models/User";
import WardrobeItem from "@/models/WardrobeItem";
import { deriveWarmth } from "@/lib/deriveWarmth";

jest.mock("@/lib/db", () => ({ initDatabase: jest.fn() }));
jest.mock("@/lib/firebaseAdmin", () => ({ adminAuth: { verifyIdToken: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let harness: MongoHarness;
let userId: string;

function mockDb() {
  const { initDatabase } = jest.requireMock("@/lib/db") as { initDatabase: jest.Mock };
  initDatabase.mockResolvedValue({ User, WardrobeItem, WardrobeImage: { deleteOne: jest.fn() } });
}
function setToken(uid: string) {
  const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
    adminAuth: { verifyIdToken: jest.Mock };
  };
  adminAuth.verifyIdToken.mockResolvedValue({ uid });
}

beforeAll(async () => {
  harness = await startMemoryMongo([User, WardrobeItem]);
}, 120_000);
afterAll(async () => {
  await harness.stop();
});
afterEach(async () => {
  await harness.clear();
  jest.clearAllMocks();
});
beforeEach(async () => {
  mockDb();
  setToken("firebase-uid");
  const user = await User.create({ authProvider: "firebase", authId: "firebase-uid", email: "u@x.com" });
  userId = user._id.toString();
});

function makeRequest(body: Record<string, unknown>): NextRequest {
  return {
    headers: { get: (h: string) => (h === "authorization" ? "Bearer fake-token" : null) },
    json: async () => body,
  } as unknown as NextRequest;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function patch(id: string, body: Record<string, unknown>) {
  const { PATCH } = await import("@/app/api/wardrobe/[id]/route");
  return PATCH(makeRequest(body), params(id));
}

/** Seed a real item owned by `owner` (default: the authenticated user); returns its string _id. */
async function seedItem(fields: Record<string, unknown> = {}, owner = userId) {
  const doc = await WardrobeItem.create({
    user: owner,
    name: "Cotton Tee",
    category: "top",
    clothingType: "top",
    warmth: 2, // a light tee — differs from any wool re-derivation, so a stale value is detectable
    ...fields,
  });
  return doc._id.toString();
}
async function readItem(id: string) {
  return WardrobeItem.findById(id).lean<Any>();
}

describe("PATCH /api/wardrobe/[id] — M4 ingestion edit round-trip (behavioral, real Mongo)", () => {
  it.each(["dress", "outer_layer", "shoes"] as const)(
    "persists an explicit clothingType=%s without coercing it back to top/bottom",
    async (type) => {
      const id = await seedItem();
      const res = await patch(id, { clothingType: type });
      expect(res.status).toBe(200);

      // The stored row carries the un-coerced 5-value type, and the response echoes it.
      expect((await readItem(id)).clothingType).toBe(type);
      expect((await res.json()).item.clothingType).toBe(type);
    },
  );

  it("IGNORES an invalid clothingType on edit — the stored value survives (never coerced to top)", async () => {
    const id = await seedItem({ clothingType: "dress" });
    const res = await patch(id, { clothingType: "hat" });
    expect(res.status).toBe(200);
    // The old normalizeClothingType coerce silently stored "top" here — the legacy coerce-to-top
    // funnel resurfacing on the edit path. Garbage is now dropped, so the row keeps its value.
    expect((await readItem(id)).clothingType).toBe("dress");
  });

  it("an invalid clothingType alongside a taxonomy change falls back to re-derivation (POST parity)", async () => {
    const id = await seedItem({ clothingType: "top" });
    // POST semantics: "falls back to classification when an invalid clothingType is supplied".
    // Pre-fix, the coerced "top" string SUPPRESSED this re-derive branch — the identical body
    // stored different types on POST vs PATCH.
    const res = await patch(id, { clothingType: "sneaker", category: "footwear" });
    expect(res.status).toBe(200);
    expect((await readItem(id)).clothingType).toBe("shoes");
  });

  it("scopes the update to the owning user — a cross-user edit 404s and does not mutate the row", async () => {
    const otherUser = await User.create({ authProvider: "firebase", authId: "other", email: "o@x.com" });
    const id = await seedItem({ name: "Victim" }, otherUser._id.toString());

    // Authenticated as firebase-uid, edit an item owned by `other`.
    const res = await patch(id, { name: "Renamed by attacker" });
    expect(res.status).toBe(404);
    expect((await readItem(id)).name).toBe("Victim"); // untouched
  });

  it("does not touch clothingType when the edit body omits it", async () => {
    const id = await seedItem({ clothingType: "dress" });
    const res = await patch(id, { name: "Just a rename" });
    expect(res.status).toBe(200);
    expect((await readItem(id)).clothingType).toBe("dress"); // preserved
  });

  // §10.3 slot-staleness: clothingType decides the outfit SLOT, so a corrected taxonomy dropdown
  // (category/subCategory/layerRole) must re-derive it — the friend who dropdown-slipped Type=Jeans
  // on a tee, then corrected it, must not have the tee offered in the pants slot forever.
  it("re-derives clothingType when a taxonomy field changes and the body omits clothingType", async () => {
    // Seeded as a mis-stored bottom (the dropdown slip); the correction changes subCategory only.
    const id = await seedItem({ clothingType: "bottom", subCategory: "jeans" });
    const res = await patch(id, { subCategory: "t-shirt" });
    expect(res.status).toBe(200);
    expect((await readItem(id)).clothingType).toBe("top"); // re-derived from category=top + t-shirt
  });

  it("re-derive still respects an explicit clothingType in the same body (the correction path wins)", async () => {
    const id = await seedItem({ clothingType: "top" });
    const res = await patch(id, { subCategory: "jeans", clothingType: "dress" });
    expect(res.status).toBe(200);
    // The explicit value persists; the taxonomy-driven re-derivation must not overwrite it.
    expect((await readItem(id)).clothingType).toBe("dress");
  });

  // §23-H47: warmth is stored, never read-time-derived — so an edit must re-derive, not leave it stale.
  it("re-derives warmth from the merged item when a warmth-driving field (name) changes", async () => {
    const id = await seedItem(); // seeded warmth 2
    const res = await patch(id, { name: "Wool Sweater" });
    expect(res.status).toBe(200);

    const expected = deriveWarmth({ name: "Wool Sweater", category: "top" });
    const stored = (await readItem(id)).warmth;
    expect(stored).toBe(expected);
    expect(stored).not.toBe(2); // proves the re-derivation persisted, not the stale seed
    expect((await res.json()).item.warmth).toBe(expected);
  });

  it("honors a valid explicit warmth (the correction path) over re-derivation", async () => {
    const id = await seedItem();
    // Even though the name changes to a warm garment, an explicit warmth=3 must win.
    const res = await patch(id, { name: "Wool Sweater", warmth: 3 });
    expect(res.status).toBe(200);
    expect((await readItem(id)).warmth).toBe(3);
  });

  it("rejects an out-of-range explicit warmth by falling back to re-derivation", async () => {
    const id = await seedItem();
    const res = await patch(id, { name: "Wool Sweater", warmth: 99 });
    expect(res.status).toBe(200);
    // 99 is invalid → ignored → re-derived from the new name, never persisted as 99.
    const stored = (await readItem(id)).warmth;
    expect(stored).toBe(deriveWarmth({ name: "Wool Sweater", category: "top" }));
    expect(stored).not.toBe(99);
  });

  it("does not re-derive warmth when no warmth-driving field changes", async () => {
    const id = await seedItem(); // warmth 2
    const res = await patch(id, { isAvailable: false });
    expect(res.status).toBe(200);
    expect((await readItem(id)).warmth).toBe(2); // unchanged
  });

  it("rejects string booleans instead of coercing them on edit (row unchanged)", async () => {
    const id = await seedItem({ isAvailable: true });
    const res = await patch(id, { isAvailable: "false" });
    expect(res.status).toBe(400);
    expect((await readItem(id)).isAvailable).toBe(true);
  });

  it("rejects scalar array fields instead of clearing them on edit (row unchanged)", async () => {
    const id = await seedItem({ colors: ["#222222"] });
    const res = await patch(id, { colors: "#111111" });
    expect(res.status).toBe(400);
    expect((await readItem(id)).colors).toEqual(["#222222"]);
  });

  it("rejects whitespace-only required strings on edit (row unchanged)", async () => {
    const id = await seedItem({ name: "Keep me" });
    const res = await patch(id, { name: "   " });
    expect(res.status).toBe(400);
    expect((await readItem(id)).name).toBe("Keep me");
  });

  it('an explicit "" clears a stored optional field (the edit modal\'s clear semantics)', async () => {
    // The modal sends "" (not undefined) to clear pattern/layerRole — the round-trip proof that
    // "" survives validation, lands in $set, and reads back cleared.
    const id = await seedItem({ pattern: "striped" });
    const res = await patch(id, { pattern: "" });
    expect(res.status).toBe(200);
    expect((await readItem(id)).pattern ?? "").toBe("");
  });

  it("rejects an over-cap string on edit (row unchanged — storage bounds hold on PATCH too)", async () => {
    const id = await seedItem({ name: "Keep me" });
    const res = await patch(id, { name: "x".repeat(201) });
    expect(res.status).toBe(400);
    expect((await readItem(id)).name).toBe("Keep me");
  });
});
