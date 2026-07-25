/**
 * /api/auth/session — the Firebase session-cookie boundary (post-m5-reset §4.6 / Track-1; ZERO test
 * before this). This route mints the httpOnly `__session` cookie that the images route relies on for
 * `<img>`-compatible ownership auth (§I). It is a trust boundary, so its behavior is pinned: a fresh
 * ID token → an httpOnly, path-scoped cookie carrying the minted value; a missing/invalid token →
 * 401 with NO cookie minted; DELETE → an immediate-expiry clear.
 *
 * The only external seam (Firebase Admin cookie minting) is mocked; the cookie wiring is REAL
 * (a real NextResponse, inspected via res.cookies).
 */
import { SESSION_COOKIE_NAME, SESSION_EXPIRES_IN_MS } from "@/lib/session";

jest.mock("@/lib/firebaseAdmin", () => ({ adminAuth: { createSessionCookie: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function mint() {
  return jest.requireMock("@/lib/firebaseAdmin").adminAuth.createSessionCookie as jest.Mock;
}
function makeRequest(authHeader: string | null): Any {
  return { headers: { get: (h: string) => (h.toLowerCase() === "authorization" ? authHeader : null) } };
}

let consoleErrorSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => consoleErrorSpy.mockRestore());

async function POST(req: Any) {
  return (await import("@/app/api/auth/session/route")).POST(req);
}
async function DELETE() {
  return (await import("@/app/api/auth/session/route")).DELETE();
}

describe("POST /api/auth/session — mint the session cookie", () => {
  it("exchanges a valid ID token for an httpOnly session cookie", async () => {
    mint().mockResolvedValue("SESSION-COOKIE-VALUE");
    const res = await POST(makeRequest("Bearer id-token"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // Minted from the presented token with the shared expiry (no drift between mint + verify).
    expect(mint()).toHaveBeenCalledWith("id-token", { expiresIn: SESSION_EXPIRES_IN_MS });

    const cookie = res.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie?.value).toBe("SESSION-COOKIE-VALUE");
    expect(cookie?.httpOnly).toBe(true); // client JS can never read/forge it
    expect(cookie?.path).toBe("/");
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.maxAge).toBe(SESSION_EXPIRES_IN_MS / 1000);
    // `secure` is asserted separately, under a production NODE_ENV — see the next test. Comparing it
    // to `process.env.NODE_ENV === "production"` HERE would be a tautology (false === false) that a
    // hardcoded `secure: false` sails straight through.
  });

  it("marks the cookie Secure in PRODUCTION (the only credential guarding friend photo bytes)", async () => {
    // This cookie is what `/api/images/<id>` trusts for ownership (lib/session.ts) and it lives 5
    // days, so shipping it without `Secure` puts it on the wire in cleartext on any hostile network.
    // `httpOnly` and `sameSite` were already pinned; this third attribute was not.
    //
    // NODE_ENV must be set BEFORE the import: the route computes the flag once, in a module-level
    // COOKIE_BASE. `resetModules` is safe in this file (no DB/driver singletons to leak).
    const orig = process.env.NODE_ENV;
    try {
      // `process.env` accepts only a configurable+writable+enumerable data descriptor — omitting the last
      // two throws in real Node and, under jest's plain-object `process`, leaves NODE_ENV non-writable.
      Object.defineProperty(process.env, "NODE_ENV", {
        value: "production", configurable: true, writable: true, enumerable: true,
      });
      jest.resetModules();
      mint().mockResolvedValue("SESSION-COOKIE-VALUE");
      const { POST: prodPOST } = await import("@/app/api/auth/session/route");
      const res = await prodPOST(makeRequest("Bearer id-token"));
      expect(res.cookies.get(SESSION_COOKIE_NAME)?.secure).toBe(true);
    } finally {
      Object.defineProperty(process.env, "NODE_ENV", {
        value: orig, configurable: true, writable: true, enumerable: true,
      });
      jest.resetModules();
    }
  });

  it("401s a missing Authorization header without minting a cookie", async () => {
    const res = await POST(makeRequest(null));
    expect(res.status).toBe(401);
    expect(mint()).not.toHaveBeenCalled();
    expect(res.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("401s a non-Bearer Authorization header without minting a cookie", async () => {
    const res = await POST(makeRequest("Basic abc"));
    expect(res.status).toBe(401);
    expect(mint()).not.toHaveBeenCalled();
  });

  it("401s (no cookie) when Firebase rejects the token", async () => {
    mint().mockRejectedValue(new Error("expired"));
    const res = await POST(makeRequest("Bearer stale-token"));
    expect(res.status).toBe(401);
    expect(res.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
  });
});

describe("DELETE /api/auth/session — clear the session cookie", () => {
  it("clears the cookie with an immediate expiry", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const cookie = res.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie?.value).toBe("");
    expect(cookie?.maxAge).toBe(0); // browser drops it at once
  });
});
