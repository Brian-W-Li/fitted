/**
 * /api/cv/infer — BEHAVIORAL over real in-memory Mongo (post-m5-reset §4.6 / Track-1). The prior
 * version mocked `@/lib/apiAuth` whole, so the DB-backed auth boundary (token → real User lookup →
 * userId) was never exercised. This version runs the REAL `verifyFirebaseUser` over a REAL mongod:
 * only the two genuinely-external seams are mocked — the Firebase token verify and the outbound CV
 * `fetch`. So the §I gate (authenticate before forwarding untrusted bytes; a token with no matching
 * user is rejected) is proven, not stubbed away.
 */
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import User from "@/models/User";
import { __resetRateLimit } from "@/lib/rateLimit";

jest.mock("@/lib/db", () => ({ initDatabase: jest.fn() }));
jest.mock("@/lib/firebaseAdmin", () => ({ adminAuth: { verifyIdToken: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let harness: MongoHarness;

function mockDb() {
  const { initDatabase } = jest.requireMock("@/lib/db") as { initDatabase: jest.Mock };
  initDatabase.mockResolvedValue({ User });
}
function setToken(uid: string | null) {
  const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
    adminAuth: { verifyIdToken: jest.Mock };
  };
  if (uid == null) adminAuth.verifyIdToken.mockRejectedValue(new Error("bad token"));
  else adminAuth.verifyIdToken.mockResolvedValue({ uid });
}

function makeFile({ name = "test.png", type = "image/png", sizeBytes = 8 } = {}) {
  return new File([new Uint8Array(sizeBytes).fill(1)], name, { type });
}
function makeRequest(file: File, { auth = true }: { auth?: boolean } = {}): Any {
  const fd = new FormData();
  fd.append("file", file);
  const headers = new Headers({ "content-type": "multipart/form-data; boundary=----jest" });
  if (auth) headers.set("authorization", "Bearer fake-token");
  return {
    method: "POST",
    nextUrl: new URL("http://localhost/api/cv/infer"),
    headers,
    formData: async () => fd,
  };
}

const originalFetch = globalThis.fetch;
const originalConsoleInfo = console.info;
let consoleErrorSpy: jest.SpyInstance;

beforeAll(async () => {
  harness = await startMemoryMongo([User]);
  process.env.CV_SERVICE_URL = "http://cv.example"; // captured at the route's first import
}, 120_000);
afterAll(async () => {
  await harness.stop();
  delete process.env.CV_SERVICE_URL;
});
beforeEach(async () => {
  mockDb();
  setToken("firebase-uid");
  __resetRateLimit();
  globalThis.fetch = jest.fn();
  console.info = jest.fn();
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  // The authenticated user the real verifyFirebaseUser will resolve the token to.
  await User.create({ authProvider: "firebase", authId: "firebase-uid", email: "u@x.com" });
});
afterEach(async () => {
  globalThis.fetch = originalFetch;
  console.info = originalConsoleInfo;
  consoleErrorSpy.mockRestore();
  await harness.clear();
  jest.clearAllMocks();
});

async function post(req: Any) {
  const { POST } = await import("@/app/api/cv/infer/route");
  return POST(req);
}

describe("/api/cv/infer route (behavioral auth, real Mongo)", () => {
  it("forwards successful CV JSON for an authenticated user", async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ category: { value: "top" }, type: { value: "t-shirt" }, colors: [{ value: "#111111" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await post(makeRequest(makeFile()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.category?.value).toBe("top");
    expect(body.type?.value).toBe("t-shirt");
    expect(body.colors?.[0]?.value).toBe("#111111");
  });

  it("returns structured error JSON when upstream returns 503", async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Service down" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await post(makeRequest(makeFile()));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("CV_SERVICE_ERROR");
    expect(body.message).toMatch(/continue/i);
  });

  it("returns structured bad-response error when upstream response is not JSON", async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(
      new Response("not-json", { status: 200, headers: { "content-type": "text/plain" } }),
    );

    const res = await post(makeRequest(makeFile()));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("CV_SERVICE_BAD_RESPONSE");
  });

  it("returns structured timeout error when fetch aborts (AbortError)", async () => {
    const abortErr = new Error("aborted");
    (abortErr as Any).name = "AbortError";
    (globalThis.fetch as jest.Mock).mockRejectedValueOnce(abortErr);

    const res = await post(makeRequest(makeFile()));
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("CV_SERVICE_TIMEOUT");
  });

  it("§I gate: an unauthenticated request → 401, never forwarded (no upstream call)", async () => {
    const res = await post(makeRequest(makeFile(), { auth: false }));
    expect(res.status).toBe(401);
    expect((await res.json()).ok).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("§I gate: a valid token with no matching user → 404 (real user lookup), no upstream call", async () => {
    setToken("ghost-uid"); // verifies, but no User row exists for this uid
    const res = await post(makeRequest(makeFile()));
    expect(res.status).toBe(404);
    expect((await res.json()).ok).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("§I gate: oversize image → 413, no upstream call", async () => {
    const huge = makeFile({ sizeBytes: 11 * 1024 * 1024 }); // > 10 MiB cap
    const res = await post(makeRequest(huge));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("IMAGE_TOO_LARGE");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
