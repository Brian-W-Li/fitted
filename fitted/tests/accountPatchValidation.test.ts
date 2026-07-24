/**
 * PATCH /api/account — the VALIDATION half, BEHAVIORAL over real in-memory Mongo. The §I identity
 * half is covered by retainedRouteAuth.test.ts (token-derived identity, PATCH happy path); the
 * field-validation half (age/gender/rating/feedback/photo parsing, the 400 branches, the
 * clear-vs-invalid distinction, and the early-return "no partial write" guarantee) had ZERO
 * coverage. Every accepted/rejected value is asserted on BOTH the response AND the persisted row
 * (write→read-back, the repo's behavioral idiom).
 *
 * Non-DB seams mocked (Mongo connect + Firebase token verify); the real User model + its metadata
 * Map persist to a real mongod.
 */
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import User from "@/models/User";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

jest.mock("@/lib/firebaseAdmin", () => ({ adminAuth: { verifyIdToken: jest.fn() } }));
jest.mock("@/lib/db", () => ({ initDatabase: jest.fn() }));

const UID = "patch-uid";
let harness: MongoHarness;

function mockDb() {
  const { initDatabase } = jest.requireMock("@/lib/db") as { initDatabase: jest.Mock };
  initDatabase.mockResolvedValue({ User });
}
function setToken(uid: string) {
  const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
    adminAuth: { verifyIdToken: jest.Mock };
  };
  adminAuth.verifyIdToken.mockResolvedValue({ uid });
}
function req(body: Record<string, unknown>): Any {
  return {
    headers: { get: (h: string) => (h.toLowerCase() === "authorization" ? "Bearer t" : null) },
    json: async () => body,
    url: "http://localhost/api/account",
  };
}
async function PATCH(body: Record<string, unknown>) {
  return (await import("@/app/api/account/route")).PATCH(req(body));
}
// metadata comes back as a Map (document) or plain object (.lean()) — read either.
function meta(row: Any, key: string): unknown {
  const m = row?.metadata;
  if (m == null) return undefined;
  if (typeof m.get === "function") return m.get(key);
  return m[key];
}
async function seedUser(overrides: Record<string, unknown> = {}) {
  const user = await User.create({
    authProvider: "firebase",
    authId: UID,
    email: "patch@x.com",
    metadata: new Map(Object.entries(overrides)),
  });
  return user._id.toString();
}
async function reload(id: string) {
  return (await User.findById(id).lean()) as Any;
}

let consoleErrorSpy: jest.SpyInstance;
beforeAll(async () => {
  harness = await startMemoryMongo([User]);
}, 120_000);
afterAll(async () => {
  await harness.stop();
});
beforeEach(() => {
  mockDb();
  setToken(UID);
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  consoleErrorSpy.mockRestore();
  await harness.clear();
  jest.clearAllMocks();
});

describe("PATCH /api/account — age validation", () => {
  it("400s a non-numeric age WITHOUT partially writing any other field", async () => {
    const id = await seedUser({ age: 25 });
    // A valid gender rides along in the same request — the age 400 must fire BEFORE any save,
    // proving the route never partially persists (the 400 sits above initDatabase/save).
    const res = await PATCH({ age: "abc", gender: "male" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid age value");
    const row = await reload(id);
    expect(meta(row, "age")).toBe(25); // pre-existing value untouched
    expect(meta(row, "gender")).toBeUndefined(); // the valid sibling was NOT written
  });

  it('age:"" CLEARS the key (distinct from invalid → 400)', async () => {
    const id = await seedUser({ age: 42 });
    const res = await PATCH({ age: "" });
    expect(res.status).toBe(200);
    expect((await res.json()).user.age).toBeNull();
    expect(meta(await reload(id), "age")).toBeUndefined(); // key deleted, not set to ""
  });

  it("accepts the age boundaries 0 and 130, rejects -1 and 131", async () => {
    const id = await seedUser();
    for (const age of [0, 130]) {
      const res = await PATCH({ age });
      expect(res.status).toBe(200);
      expect((await res.json()).user.age).toBe(age);
      expect(meta(await reload(id), "age")).toBe(age);
    }
    for (const age of [-1, 131]) {
      const res = await PATCH({ age });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Invalid age value");
    }
  });

  it("floors a fractional age", async () => {
    const id = await seedUser();
    const res = await PATCH({ age: 30.7 });
    expect(res.status).toBe(200);
    expect((await res.json()).user.age).toBe(30);
    expect(meta(await reload(id), "age")).toBe(30);
  });
});

describe("PATCH /api/account — gender validation", () => {
  it("400s a gender outside the allowlist", async () => {
    const id = await seedUser({ gender: "female" });
    const res = await PATCH({ gender: "martian" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid gender value");
    expect(meta(await reload(id), "gender")).toBe("female"); // unchanged
  });

  it("accepts an allowlisted gender and clears on empty string", async () => {
    const id = await seedUser();
    expect((await (await PATCH({ gender: "nonbinary" })).json()).user.gender).toBe("nonbinary");
    expect(meta(await reload(id), "gender")).toBe("nonbinary");
    const cleared = await PATCH({ gender: "" });
    expect((await cleared.json()).user.gender).toBeNull();
    expect(meta(await reload(id), "gender")).toBeUndefined();
  });
});

describe("PATCH /api/account — rating validation", () => {
  it("accepts 10, rounds a fractional value, rejects 11", async () => {
    const id = await seedUser();
    expect((await (await PATCH({ appRatingScore10: 10 })).json()).user.appRatingScore10).toBe(10);
    expect(meta(await reload(id), "appRatingScore10")).toBe(10);
    // Math.round(10.4) === 10 → stored 10 (rounding accept path).
    expect((await (await PATCH({ appRatingScore10: 10.4 })).json()).user.appRatingScore10).toBe(10);
    const res = await PATCH({ appRatingScore10: 11 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid rating value");
  });

  it("400s a non-numeric rating", async () => {
    await seedUser();
    const res = await PATCH({ appRatingScore10: "great" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid rating value");
  });
});

describe("PATCH /api/account — feedback comment validation", () => {
  it("400s a non-string comment", async () => {
    await seedUser();
    const res = await PATCH({ appFeedbackComment: 5 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid feedback comment value");
  });

  it("stores a 2001-char comment sliced to 2000", async () => {
    const id = await seedUser();
    const res = await PATCH({ appFeedbackComment: "x".repeat(2001) });
    expect(res.status).toBe(200);
    expect((meta(await reload(id), "appFeedbackComment") as string).length).toBe(2000);
  });
});

describe("PATCH /api/account — photo validation", () => {
  const PREFIX = "data:image/png;base64,";
  const MAX = 3_000_000;

  it("400s a non-string photo", async () => {
    await seedUser();
    const res = await PATCH({ photoDataUrl: 123 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid photo format");
  });

  it("400s non-image schemes (javascript:, data:text/html)", async () => {
    await seedUser();
    for (const bad of ["javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4="]) {
      const res = await PATCH({ photoDataUrl: bad });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Only PNG, JPG, JPEG, or WEBP images are allowed");
    }
  });

  it("accepts a regex-valid data URL of exactly 3,000,000 chars, rejects 3,000,001 as too large", async () => {
    const id = await seedUser();
    const atMax = PREFIX + "A".repeat(MAX - PREFIX.length); // length === 3_000_000, regex-valid
    expect(atMax.length).toBe(MAX);
    const ok = await PATCH({ photoDataUrl: atMax });
    expect(ok.status).toBe(200);
    expect((await ok.json()).user.hasCustomPhoto).toBe(true);
    expect(meta(await reload(id), "customPhotoURL")).toBe(atMax);

    const overMax = PREFIX + "A".repeat(MAX + 1 - PREFIX.length); // length === 3_000_001
    expect(overMax.length).toBe(MAX + 1);
    const tooBig = await PATCH({ photoDataUrl: overMax });
    expect(tooBig.status).toBe(400);
    expect((await tooBig.json()).error).toBe("Photo is too large"); // size gate fires before regex
  });

  it("clears customPhotoURL on empty string", async () => {
    const id = await seedUser({ customPhotoURL: PREFIX + "AAAA" });
    const res = await PATCH({ photoDataUrl: "" });
    expect(res.status).toBe(200);
    expect((await res.json()).user.hasCustomPhoto).toBe(false);
    expect(meta(await reload(id), "customPhotoURL")).toBeUndefined();
  });
});
