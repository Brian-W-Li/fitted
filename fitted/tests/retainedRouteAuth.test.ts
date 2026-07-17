/**
 * M5 C7 §I — retained-route auth, BEHAVIORAL over real in-memory Mongo. The identity of the
 * account/auth-sync routes must come ONLY from the verified Firebase token, never a body `firebaseUid`
 * (the §19 gap). We mock the two unavoidable non-DB seams — the Mongo *connect* (`@/lib/db`) and the
 * token *verify* (`@/lib/firebaseAdmin`) — but the models are REAL and write/read a real mongod, so
 * the ownership/isolation assertions are behavioral, not shape-only.
 */
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import User from "@/models/User";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

jest.mock("@/lib/firebaseAdmin", () => ({ adminAuth: { verifyIdToken: jest.fn() } }));
jest.mock("@/lib/db", () => ({ initDatabase: jest.fn() }));

let harness: MongoHarness;

beforeAll(async () => {
  harness = await startMemoryMongo([User]);
  const { initDatabase } = jest.requireMock("@/lib/db") as { initDatabase: jest.Mock };
  // Real model, real (in-memory) connection — only the connect step is mocked away.
  initDatabase.mockResolvedValue({ User });
}, 120_000);
afterAll(async () => {
  await harness.stop();
});
afterEach(async () => {
  await harness.clear();
  jest.clearAllMocks();
  const { initDatabase } = jest.requireMock("@/lib/db") as { initDatabase: jest.Mock };
  initDatabase.mockResolvedValue({ User });
});

function setToken(uid: string | null, email?: string) {
  const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as { adminAuth: { verifyIdToken: jest.Mock } };
  if (uid == null) adminAuth.verifyIdToken.mockRejectedValue(new Error("bad token"));
  else adminAuth.verifyIdToken.mockResolvedValue({ uid, ...(email ? { email } : {}) });
}

function req(body: Record<string, unknown>, withToken = true): Any {
  return {
    headers: { get: (h: string) => (h === "authorization" && withToken ? "Bearer t" : null) },
    json: async () => body,
    url: "http://localhost/api/account",
  };
}

describe("account route — identity from the token, never the body (§I)", () => {
  it("returns the TOKEN user's account, ignoring a body firebaseUid pointing at another user", async () => {
    const a = await User.create({ authProvider: "firebase", authId: "uidA", email: "a@x.com" });
    await User.create({ authProvider: "firebase", authId: "uidB", email: "b@x.com" });

    setToken("uidA");
    const { POST } = await import("@/app/api/account/route");
    // Attacker points the body at user B, but the verified token is A → must get A.
    const res = await POST(req({ firebaseUid: "uidB" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as Any;
    expect(data.user.id).toBe(a._id.toString());
    expect(data.user.email).toBe("a@x.com");
  });

  it("rejects an unauthenticated request (no token) with 401", async () => {
    await User.create({ authProvider: "firebase", authId: "uidA", email: "a@x.com" });
    const { POST } = await import("@/app/api/account/route");
    const res = await POST(req({ firebaseUid: "uidA" }, /* withToken */ false));
    expect(res.status).toBe(401);
  });

  it("rejects an invalid token with 401", async () => {
    await User.create({ authProvider: "firebase", authId: "uidA", email: "a@x.com" });
    setToken(null);
    const { POST } = await import("@/app/api/account/route");
    const res = await POST(req({ firebaseUid: "uidA" }));
    expect(res.status).toBe(401);
  });

  it("PATCH persists only to the token user's row (body firebaseUid ignored)", async () => {
    const a = await User.create({ authProvider: "firebase", authId: "uidA", email: "a@x.com" });
    const b = await User.create({ authProvider: "firebase", authId: "uidB", email: "b@x.com" });
    setToken("uidA");
    const { PATCH } = await import("@/app/api/account/route");
    const res = await PATCH(req({ firebaseUid: "uidB", age: 30 }));
    expect(res.status).toBe(200);

    const aAfter = (await User.findById(a._id).lean()) as Any;
    const bAfter = (await User.findById(b._id).lean()) as Any;
    expect(aAfter.metadata?.get?.("age") ?? aAfter.metadata?.age).toBe(30); // A got the write
    // B untouched.
    expect(bAfter.metadata?.get?.("age") ?? bAfter.metadata?.age).toBeUndefined();
  });
});

describe("auth/sync route — token-derived identity + email (§I)", () => {
  it("creates the user under the TOKEN uid/email, never a body uid", async () => {
    setToken("uidNew", "new@x.com");
    const { POST } = await import("@/app/api/auth/sync/route");
    const res = await POST(req({ firebaseUid: "spoofed", email: "spoof@evil.com" }));
    expect(res.status).toBe(200);

    const created = (await User.findOne({ authId: "uidNew" }).lean()) as Any;
    expect(created).toBeTruthy();
    expect(created.email).toBe("new@x.com"); // token email, not the body's
    expect(await User.findOne({ authId: "spoofed" }).lean()).toBeNull();
  });

  it("rejects an unauthenticated sync with 401", async () => {
    const { POST } = await import("@/app/api/auth/sync/route");
    const res = await POST(req({ firebaseUid: "x", email: "x@x.com" }, false));
    expect(res.status).toBe(401);
    expect(await User.countDocuments({})).toBe(0);
  });

  it("token WITHOUT email + spoofed body email → 400, no row (no body-email squatting)", async () => {
    setToken("uidNoEmail"); // token carries no email
    const { POST } = await import("@/app/api/auth/sync/route");
    const res = await POST(req({ email: "victim@x.com" })); // attacker-chosen body email
    expect(res.status).toBe(400);
    // The unique-email squat must not happen: no row created with the body email.
    expect(await User.countDocuments({})).toBe(0);
    expect(await User.findOne({ email: "victim@x.com" }).lean()).toBeNull();
  });

  it("is idempotent — a second sync returns the same user, no duplicate", async () => {
    setToken("uidNew", "new@x.com");
    const { POST } = await import("@/app/api/auth/sync/route");
    const first = (await (await POST(req({ email: "new@x.com" }))).json()) as Any;
    const second = (await (await POST(req({ email: "new@x.com" }))).json()) as Any;
    expect(first.userId).toBe(second.userId);
    expect(await User.countDocuments({ authId: "uidNew" })).toBe(1);
  });

  it("a revoked-but-cryptographically-valid token cannot mint a row (checkRevoked on the create path)", async () => {
    // The deleted-account ghost: after DELETE /api/account the old ID token stays signature-valid
    // for up to ~1h, but deletion revokes it — only the second verifyIdToken(idToken, true) call
    // catches that. A minted ghost row would permanently squat the email's unique index.
    const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
      adminAuth: { verifyIdToken: jest.Mock };
    };
    adminAuth.verifyIdToken.mockImplementation(async (_token: string, checkRevoked?: boolean) => {
      if (checkRevoked) throw new Error("token revoked"); // Firebase's checkRevoked rejection
      return { uid: "uidGhost", email: "ghost@x.com" };
    });
    const { POST } = await import("@/app/api/auth/sync/route");
    const res = await POST(req({}));
    expect(res.status).toBe(401);
    expect(await User.countDocuments({})).toBe(0); // no ghost row, email not squatted
  });

  it("the warm path (existing row) does NOT pay the checkRevoked round-trip", async () => {
    await User.create({ authProvider: "firebase", authId: "uidWarm", email: "warm@x.com" });
    const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
      adminAuth: { verifyIdToken: jest.Mock };
    };
    adminAuth.verifyIdToken.mockImplementation(async (_token: string, checkRevoked?: boolean) => {
      if (checkRevoked) throw new Error("must not be called on the warm path");
      return { uid: "uidWarm", email: "warm@x.com" };
    });
    const { POST } = await import("@/app/api/auth/sync/route");
    const res = await POST(req({}));
    expect(res.status).toBe(200); // create-path-only cost, as documented in the route
  });

  it("the concurrent first-sign-in race loser re-finds the winner's row (E11000 on {authProvider,authId})", async () => {
    // First sign-in fires sync twice concurrently; simulate the loser by inserting the winner's
    // row in the window between the findOne miss and the create — the checkRevoked round-trip
    // sits exactly there, so its mock is the injection point.
    const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
      adminAuth: { verifyIdToken: jest.Mock };
    };
    let winnerId = "";
    adminAuth.verifyIdToken.mockImplementation(async (_token: string, checkRevoked?: boolean) => {
      if (checkRevoked) {
        const winner = await User.create({
          authProvider: "firebase",
          authId: "uidRace",
          email: "race@x.com",
        });
        winnerId = winner._id.toString();
      }
      return { uid: "uidRace", email: "race@x.com" };
    });
    const { POST } = await import("@/app/api/auth/sync/route");
    const res = await POST(req({}));
    expect(res.status).toBe(200); // no "Failed to sync user" flash on a healthy sign-in
    expect(((await res.json()) as Any).userId).toBe(winnerId); // the winner's row, not a dup
    expect(await User.countDocuments({ authId: "uidRace" })).toBe(1);
  });

  it("an E11000 on the unique EMAIL index (another account squatting the address) still rethrows → 500, no row", async () => {
    await User.create({ authProvider: "firebase", authId: "uidOther", email: "taken@x.com" });
    setToken("uidNewcomer", "taken@x.com"); // new uid, already-taken email
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/api/auth/sync/route");
    const res = await POST(req({}));
    expect(res.status).toBe(500); // the §19 squat rejection survives the E11000 re-find catch
    expect(await User.countDocuments({ authId: "uidNewcomer" })).toBe(0);
    spy.mockRestore();
  });
});
