/**
 * POST /api/wardrobe — M4 ingestion, BEHAVIORAL over real in-memory Mongo (post-m5-reset §4.6 /
 * Track-1). The prior version mocked `WardrobeItem.create` and asserted the *argument* it was called
 * with — a shape check that says nothing about what actually persists. This version drives the REAL
 * route over a REAL mongod: the item is written through the live Mongoose schema (clothingType enum,
 * warmth min/max, strict:true) and READ BACK, so a schema-rejection or strict-strip on the derived
 * clothingType/warmth reddens here instead of hiding behind a green mock.
 *
 * Regression it reddens on: revert the §10.3 classifier to the legacy top/bottom funnel, or drop the
 * warmth derivation, and the read-back assertion fails (the mock-era test could not see either a
 * strict-strip or a schema reject on the *stored* row).
 *
 * The two non-DB seams are mocked (Mongo connect + Firebase token verify); models/documents are REAL.
 */
import type { NextRequest } from "next/server";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import User from "@/models/User";
import WardrobeItem from "@/models/WardrobeItem";
import { CLOTHING_TYPES } from "@/lib/clothingType";

jest.mock("@/lib/db", () => ({ initDatabase: jest.fn() }));
jest.mock("@/lib/firebaseAdmin", () => ({ adminAuth: { verifyIdToken: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let harness: MongoHarness;
let userId: string;

function mockDb() {
  const { initDatabase } = jest.requireMock("@/lib/db") as { initDatabase: jest.Mock };
  initDatabase.mockResolvedValue({ User, WardrobeItem });
}
function setToken(uid: string) {
  const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
    adminAuth: { verifyIdToken: jest.Mock };
  };
  adminAuth.verifyIdToken.mockResolvedValue({ uid });
}

beforeAll(async () => {
  harness = await startMemoryMongo([User, WardrobeItem]);
}, 120_000); // first run may download the mongod binary
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

async function post(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/wardrobe/route");
  return POST(makeRequest(body));
}

/** The single persisted item for the user — the write→read-back proof (a real Mongoose lean doc). */
async function readBack() {
  return WardrobeItem.findOne({ user: userId }).lean<Any>();
}
async function count() {
  return WardrobeItem.countDocuments({ user: userId });
}

describe("POST /api/wardrobe — M4 ingestion (behavioral, real Mongo)", () => {
  it("persists a dress without coercing it to top/bottom, plus a valid warmth", async () => {
    const res = await post({ name: "Floral midi dress", category: "one piece", clothingType: "dress" });
    expect(res.status).toBe(201);

    const doc = await readBack();
    expect(doc.clothingType).toBe("dress");
    expect(CLOTHING_TYPES).toContain(doc.clothingType);
    // The live schema enforces warmth 0..10; the route derives an integer in-band.
    expect(Number.isInteger(doc.warmth)).toBe(true);
    expect(doc.warmth).toBeGreaterThanOrEqual(0);
    expect(doc.warmth).toBeLessThanOrEqual(10);
  });

  it("preserves outer_layer and derives a warm value for a wool coat", async () => {
    const res = await post({
      name: "Wool overcoat",
      category: "outer",
      clothingType: "outer_layer",
      seasons: ["winter"],
    });
    expect(res.status).toBe(201);

    const doc = await readBack();
    expect(doc.clothingType).toBe("outer_layer");
    expect(doc.warmth).toBeGreaterThanOrEqual(6); // cold band
  });

  it("classifies clothingType from category/name when the form omits it", async () => {
    // Today's upload form does not send a clothingType.
    const res = await post({ name: "Strappy sandals", category: "footwear" });
    expect(res.status).toBe(201);
    expect((await readBack()).clothingType).toBe("shoes");
  });

  it("classifies a dress from a one-piece category when clothingType is omitted", async () => {
    const res = await post({ name: "Summer maxi", category: "one piece" });
    expect(res.status).toBe(201);
    expect((await readBack()).clothingType).toBe("dress");
  });

  it("lets a VALID form-supplied clothingType win over derivation", async () => {
    // Derivation from category "footwear" would say "shoes"; the explicit valid "top" must win.
    const res = await post({ name: "My favorite top", category: "footwear", clothingType: "top" });
    expect(res.status).toBe(201);
    expect((await readBack()).clothingType).toBe("top");
  });

  it("honors a valid supplied warmth, else derives it", async () => {
    const res = await post({ name: "Cotton tee", category: "top", warmth: 9 });
    expect(res.status).toBe(201);
    expect((await readBack()).warmth).toBe(9); // supplied wins

    // Out-of-range → derive (and the derived value must persist through the 0..10 schema bound).
    await WardrobeItem.deleteMany({ user: userId });
    const res2 = await post({ name: "Cotton tee", category: "top", warmth: 99 });
    expect(res2.status).toBe(201);
    const w = (await readBack()).warmth;
    expect(w).toBeGreaterThanOrEqual(0);
    expect(w).toBeLessThanOrEqual(10);
    expect(w).not.toBe(99);
  });

  it("falls back to classification when an invalid clothingType is supplied", async () => {
    // "hat" is not a valid 5-value type → derive from category, never persist garbage (the schema
    // enum would reject "hat" at .create(), so a read-back of "shoes" proves the fallback ran).
    const res = await post({ name: "Chelsea boots", category: "footwear", clothingType: "hat" });
    expect(res.status).toBe(201);
    expect((await readBack()).clothingType).toBe("shoes");
  });

  it("returns the derived warmth in the response body equal to the persisted value (no refetch)", async () => {
    const res = await post({
      name: "Wool overcoat",
      category: "outer",
      clothingType: "outer_layer",
      seasons: ["winter"],
    });
    expect(res.status).toBe(201);

    const stored = (await readBack()).warmth;
    const body = await res.json();
    // The response must surface the SAME warmth that persisted (§6.1/§15.1 authoritative warmth).
    expect(typeof body.item.warmth).toBe("number");
    expect(body.item.warmth).toBe(stored);
  });

  it("still 400s when name/category are missing (nothing persisted)", async () => {
    const res = await post({ clothingType: "top" });
    expect(res.status).toBe(400);
    expect(await count()).toBe(0);
  });

  it("rejects whitespace-only required strings before create (nothing persisted)", async () => {
    const res = await post({ name: "   ", category: "top" });
    expect(res.status).toBe(400);
    expect(await count()).toBe(0);
  });

  it("rejects scalar array fields instead of silently coercing them (nothing persisted)", async () => {
    const res = await post({ name: "Cotton tee", category: "top", seasons: "winter" });
    expect(res.status).toBe(400);
    expect(await count()).toBe(0);
  });

  it("rejects string booleans instead of coercing \"false\" to true (nothing persisted)", async () => {
    const res = await post({ name: "Cotton tee", category: "top", isAvailable: "false" });
    expect(res.status).toBe(400);
    expect(await count()).toBe(0);
  });

  it("persists an explicit false availability flag", async () => {
    const res = await post({ name: "Cotton tee", category: "top", isAvailable: false });
    expect(res.status).toBe(201);
    expect((await readBack()).isAvailable).toBe(false);
  });
});

describe("POST /api/wardrobe — storage bounds (§I, Track 2 Lane B)", () => {
  it("rejects an over-cap name (201 chars) — nothing persisted", async () => {
    const res = await post({ name: "x".repeat(201), category: "top" });
    expect(res.status).toBe(400);
    expect(await count()).toBe(0);
  });

  it("rejects an over-cap notes field (2001 chars) — nothing persisted", async () => {
    const res = await post({ name: "Tee", category: "top", notes: "n".repeat(2001) });
    expect(res.status).toBe(400);
    expect(await count()).toBe(0);
  });

  it("rejects a lone-surrogate name (ill-formed UTF-16 must never reach storage)", async () => {
    // "\ud83d" alone is half an astral pair — stored, it would 400 every future render
    // service-side (`_require_utf8`) until the item is edited.
    const res = await post({ name: "bad \ud83d shirt", category: "top" });
    expect(res.status).toBe(400);
    expect(await count()).toBe(0);
  });

  it("rejects an over-cap colors array (26 entries) and an over-long entry", async () => {
    const many = await post({ name: "Tee", category: "top", colors: Array(26).fill("blue") });
    expect(many.status).toBe(400);
    const long = await post({ name: "Tee", category: "top", colors: ["c".repeat(61)] });
    expect(long.status).toBe(400);
    expect(await count()).toBe(0);
  });

  it("rejects a create once the per-user item ceiling is reached — existing items untouched", async () => {
    const { MAX_ITEMS_PER_USER } = await import("@/app/api/wardrobe/route");
    await WardrobeItem.insertMany(
      Array.from({ length: MAX_ITEMS_PER_USER }, (_, i) => ({
        user: userId,
        name: `Item ${i}`,
        category: "top",
        clothingType: "top",
        warmth: 5,
      })),
    );
    const res = await post({ name: "One too many", category: "top" });
    expect(res.status).toBe(400);
    expect(await count()).toBe(MAX_ITEMS_PER_USER);
  });
});
