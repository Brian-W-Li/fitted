/**
 * M5 §I — images-route ownership, BEHAVIORAL over real in-memory Mongo. `/api/images/<id>` must serve
 * bytes ONLY to the owner, identified by the Firebase session cookie (the `<img>`-compatible auth
 * mechanism). We mock the two non-DB seams — the Mongo connect (`@/lib/db`) and the session-cookie
 * verify (`@/lib/firebaseAdmin`) — but the models/documents are REAL, so ownership is proven, not
 * shape-only.
 */
import { Types } from "mongoose";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import User from "@/models/User";
import WardrobeImage from "@/models/WardrobeImage";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

jest.mock("@/lib/firebaseAdmin", () => ({ adminAuth: { verifySessionCookie: jest.fn() } }));
jest.mock("@/lib/db", () => ({ initDatabase: jest.fn() }));

let harness: MongoHarness;

beforeAll(async () => {
  harness = await startMemoryMongo([User, WardrobeImage]);
  const { initDatabase } = jest.requireMock("@/lib/db") as { initDatabase: jest.Mock };
  initDatabase.mockResolvedValue({ User, WardrobeImage });
}, 120_000);
afterAll(async () => {
  await harness.stop();
});
afterEach(async () => {
  await harness.clear();
  jest.clearAllMocks();
  const { initDatabase } = jest.requireMock("@/lib/db") as { initDatabase: jest.Mock };
  initDatabase.mockResolvedValue({ User, WardrobeImage });
});

/** Set the session-cookie verify result: a uid (authenticated) or null (no/invalid cookie). */
function setCookieUid(uid: string | null, hasCookie = true) {
  const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
    adminAuth: { verifySessionCookie: jest.Mock };
  };
  if (uid == null) adminAuth.verifySessionCookie.mockRejectedValue(new Error("invalid"));
  else adminAuth.verifySessionCookie.mockResolvedValue({ uid });
  // The route reads request.cookies.get(...) — model that below via the request stub.
  return hasCookie;
}

function imgReq(cookieValue: string | null): Any {
  return {
    cookies: { get: (name: string) => (name === "__session" && cookieValue ? { value: cookieValue } : undefined) },
  };
}
const params = (imageId: string) => ({ params: Promise.resolve({ imageId }) });

async function makeImage(authId: string) {
  const user = await User.create({ authProvider: "firebase", authId, email: `${authId}@x.com` });
  const img = await WardrobeImage.create({
    user: user._id,
    wardrobeItem: new Types.ObjectId(),
    base64: Buffer.from("PNGBYTES").toString("base64"),
    contentType: "image/png",
    sizeBytes: 8,
  });
  return { userId: user._id.toString(), authId, imageId: img._id.toString() };
}

describe("GET /api/images/[imageId] — owner-only via session cookie (§I)", () => {
  it("serves the bytes to the owner", async () => {
    const { authId, imageId } = await makeImage("owner");
    setCookieUid(authId);
    const { GET } = await import("@/app/api/images/[imageId]/route");
    const res = await GET(imgReq("cookie"), params(imageId));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("PNGBYTES");
  });

  it("returns 404 (not 200, no bytes) for a NON-owner with a valid cookie — existence not revealed", async () => {
    const { imageId } = await makeImage("owner");
    await User.create({ authProvider: "firebase", authId: "attacker", email: "attacker@x.com" });
    setCookieUid("attacker");
    const { GET } = await import("@/app/api/images/[imageId]/route");
    const res = await GET(imgReq("cookie"), params(imageId));
    expect(res.status).toBe(404);
  });

  it("returns 401 when no session cookie is present", async () => {
    const { imageId } = await makeImage("owner");
    setCookieUid("owner");
    const { GET } = await import("@/app/api/images/[imageId]/route");
    const res = await GET(imgReq(null), params(imageId)); // no cookie on the request
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid/expired session cookie", async () => {
    const { imageId } = await makeImage("owner");
    setCookieUid(null); // verifySessionCookie rejects
    const { GET } = await import("@/app/api/images/[imageId]/route");
    const res = await GET(imgReq("tampered"), params(imageId));
    expect(res.status).toBe(401);
  });

  it("returns a stable 400 for a malformed image id (never a cast-crash 500)", async () => {
    setCookieUid("owner");
    const { GET } = await import("@/app/api/images/[imageId]/route");
    const res = await GET(imgReq("cookie"), params("not-an-objectid"));
    expect(res.status).toBe(400);
  });
});
