/**
 * DEFECTS-H88 — a database failure must never be reported as an expired login.
 *
 * Pre-fix, all three auth helpers wrapped `initDatabase()` inside the SAME try as token/cookie
 * verification and mapped every throw to 401 ("Invalid or expired token" / "... session"). Any
 * Mongo fault — H87's bricked instance, an M0 connection-cap rejection, a slow cold connect —
 * therefore presented as an auth failure: the friend re-signs-in successfully at Firebase and
 * still fails, in a loop, because the real fault was the database and nothing could say so.
 *
 * The contract pinned here: 401 is reserved for genuine credential rejection; a DB fault past
 * verification is a retryable 503 whose message names the real problem. Mocked seams are the two
 * non-DB boundaries (`@/lib/firebaseAdmin`) and the connect itself (`@/lib/db`) — the failure
 * under test IS the connect/query throwing, so no mongod is needed.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/firebaseAdmin", () => ({
  adminAuth: { verifyIdToken: jest.fn(), verifySessionCookie: jest.fn() },
}));
jest.mock("@/lib/db", () => ({ initDatabase: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const mocks = () => ({
  adminAuth: (jest.requireMock("@/lib/firebaseAdmin") as Any).adminAuth,
  initDatabase: (jest.requireMock("@/lib/db") as Any).initDatabase as jest.Mock,
});

function bearerReq(): NextRequest {
  return { headers: { get: (h: string) => (h.toLowerCase() === "authorization" ? "Bearer t" : null) } } as Any;
}
function cookieReq(): NextRequest {
  return { cookies: { get: (n: string) => (n === "__session" ? { value: "cookie" } : undefined) } } as Any;
}

let consoleErrorSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => consoleErrorSpy.mockRestore());

describe("verifyFirebaseUser (lib/apiAuth) — DB faults are 503, never 401", () => {
  it("a verified token + a failing connect → 503 naming the closet, NOT an expired-token 401", async () => {
    const { adminAuth, initDatabase } = mocks();
    adminAuth.verifyIdToken.mockResolvedValue({ uid: "u1" });
    initDatabase.mockRejectedValue(new Error("Atlas M0 connection cap"));
    const { verifyFirebaseUser } = await import("@/lib/apiAuth");
    const res = (await verifyFirebaseUser(bearerReq())) as Any;
    expect(res.status).toBe(503);
    expect(res.error).toMatch(/trouble reaching your closet/i);
    expect(res.error).not.toMatch(/token/i); // the message must not blame the credential
  });

  it("a verified token + a failing user QUERY (post-connect) → the same 503 class", async () => {
    const { adminAuth, initDatabase } = mocks();
    adminAuth.verifyIdToken.mockResolvedValue({ uid: "u1" });
    initDatabase.mockResolvedValue({
      User: { findOne: () => ({ exec: () => Promise.reject(new Error("topology closed")) }) },
    });
    const { verifyFirebaseUser } = await import("@/lib/apiAuth");
    const res = (await verifyFirebaseUser(bearerReq())) as Any;
    expect(res.status).toBe(503);
  });

  it("a genuinely rejected token is STILL 401 (the split must not widen)", async () => {
    const { adminAuth, initDatabase } = mocks();
    adminAuth.verifyIdToken.mockRejectedValue(new Error("expired"));
    const { verifyFirebaseUser } = await import("@/lib/apiAuth");
    const res = (await verifyFirebaseUser(bearerReq())) as Any;
    expect(res).toEqual({ error: "Invalid or expired token", status: 401 });
    expect(initDatabase).not.toHaveBeenCalled(); // token rejected → the DB is never consulted
  });
});

describe("verifySessionCookieUser (lib/session) — same split for the image-route cookie", () => {
  it("a verified cookie + a failing connect → 503, NOT an expired-session 401", async () => {
    const { adminAuth, initDatabase } = mocks();
    adminAuth.verifySessionCookie.mockResolvedValue({ uid: "u1" });
    initDatabase.mockRejectedValue(new Error("SRV blip"));
    const { verifySessionCookieUser } = await import("@/lib/session");
    const res = (await verifySessionCookieUser(cookieReq())) as Any;
    expect(res.status).toBe(503);
    expect(res.error).not.toMatch(/session/i);
  });

  it("a genuinely rejected cookie is STILL 401", async () => {
    const { adminAuth } = mocks();
    adminAuth.verifySessionCookie.mockRejectedValue(new Error("bad cookie"));
    const { verifySessionCookieUser } = await import("@/lib/session");
    const res = (await verifySessionCookieUser(cookieReq())) as Any;
    expect(res).toEqual({ error: "Invalid or expired session", status: 401 });
  });
});

describe("verifyUserProd (lib/mlRecommend prodDeps) — the recommend path gets the same split", () => {
  it("a verified token + a failing connect → 503 through prodDeps().verifyUser", async () => {
    const { adminAuth, initDatabase } = mocks();
    adminAuth.verifyIdToken.mockResolvedValue({ uid: "u1" });
    initDatabase.mockRejectedValue(new Error("Atlas down"));
    const { prodDeps } = await import("@/lib/mlRecommend");
    const res = (await prodDeps().verifyUser(bearerReq())) as Any;
    expect(res.status).toBe(503);
    expect(res.error).toMatch(/trouble reaching your closet/i);
  });
});
