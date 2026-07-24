/**
 * The recommend route's PRODUCTION auth arm (`verifyUserProd`, lib/mlRecommend.ts §prodDeps) had
 * ZERO coverage — every mlRecommend test injects a fake `verifyUser`, and recommendationStability
 * mocks `prodDeps` wholesale, so the real header-parse → token-verify → Mongo-user lookup was never
 * exercised. This closes that gap BEHAVIORALLY: the real `User` model over an in-memory mongod, with
 * only the two unavoidable non-DB seams mocked (Mongo *connect* `@/lib/db`, token *verify*
 * `@/lib/firebaseAdmin`) — the same idiom as retainedRouteAuth.test.ts.
 *
 * `verifyUserProd` is module-local (not exported); we reach it through its public binding
 * `prodDeps().verifyUser` (per the audit prompt — avoids adding a test-only export). `prodDeps()`
 * has no side effects: it builds a deps object whose model getters are lazy, so constructing it and
 * calling `.verifyUser` only touches `adminAuth` + `initDatabase`.
 */
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import User from "@/models/User";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

jest.mock("@/lib/firebaseAdmin", () => ({ adminAuth: { verifyIdToken: jest.fn() } }));
jest.mock("@/lib/db", () => ({ initDatabase: jest.fn() }));

let harness: MongoHarness;

function mockDb() {
  const { initDatabase } = jest.requireMock("@/lib/db") as { initDatabase: jest.Mock };
  initDatabase.mockResolvedValue({ User }); // real model, real (in-memory) connection
}
function setToken(uid: string | null) {
  const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
    adminAuth: { verifyIdToken: jest.Mock };
  };
  if (uid == null) adminAuth.verifyIdToken.mockRejectedValue(new Error("bad token"));
  else adminAuth.verifyIdToken.mockResolvedValue({ uid });
}

// Minimal NextRequest stand-in: verifyUserProd only reads request.headers.get("authorization").
function req(authHeader: string | null): Any {
  return { headers: { get: (h: string) => (h.toLowerCase() === "authorization" ? authHeader : null) } };
}
async function verifyUser(request: Any) {
  const { prodDeps } = await import("@/lib/mlRecommend");
  return prodDeps().verifyUser(request);
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
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  consoleErrorSpy.mockRestore();
  await harness.clear();
  jest.clearAllMocks();
});

describe("verifyUserProd — recommend route production auth arm", () => {
  it("401s a missing Authorization header (never verifies a token)", async () => {
    const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
      adminAuth: { verifyIdToken: jest.Mock };
    };
    const res = await verifyUser(req(null));
    expect(res).toEqual({ error: "Missing or invalid Authorization header", status: 401 });
    expect(adminAuth.verifyIdToken).not.toHaveBeenCalled(); // no token → no verify attempt
  });

  it("401s a non-Bearer scheme (Basic ...) as an invalid header", async () => {
    const res = await verifyUser(req("Basic dXNlcjpwYXNz"));
    expect(res).toEqual({ error: "Missing or invalid Authorization header", status: 401 });
  });

  it("401s when token verification throws (invalid/expired token)", async () => {
    setToken(null); // verifyIdToken rejects
    const res = await verifyUser(req("Bearer bad-token"));
    expect(res).toEqual({ error: "Invalid or expired token", status: 401 });
  });

  it("404s a valid token with no matching Mongo user — distinguishable from the 401s", async () => {
    setToken("ghost-uid"); // token verifies, but no User row for it
    const res = (await verifyUser(req("Bearer good-token"))) as Any;
    expect(res.status).toBe(404);
    expect(res.error).toBe("User not found");
    // The 404 must be distinct from the auth-failure 401s (a real user with a bad token vs a good
    // token for a non-existent user are different conditions the caller maps to different responses).
    expect(res.status).not.toBe(401);
  });

  it("resolves the Mongo _id (not the Firebase uid) for a valid token + existing user", async () => {
    const user = await User.create({ authProvider: "firebase", authId: "real-uid", email: "r@x.com" });
    setToken("real-uid");
    const res = (await verifyUser(req("Bearer good-token"))) as Any;
    expect(res).toEqual({ userId: user._id.toString() });
    expect(res.userId).not.toBe("real-uid"); // the Mongo _id, never the Firebase uid
  });
});
