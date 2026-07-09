// §I CV gate: the route now authenticates via verifyFirebaseUser. Mock it so the forwarding tests
// run as an authenticated user; a dedicated test exercises the unauthenticated arm.
jest.mock("@/lib/apiAuth", () => ({ verifyFirebaseUser: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function makeFile({
  name = "test.png",
  type = "image/png",
  sizeBytes = 8,
}: {
  name?: string;
  type?: string;
  sizeBytes?: number;
}) {
  const bytes = new Uint8Array(sizeBytes).fill(1);
  return new File([bytes], name, { type });
}

async function makeRequestWithFile(file: File) {
  const fd = new FormData();
  fd.append("file", file);

  return {
    method: "POST",
    nextUrl: new URL("http://localhost/api/cv/infer"),
    headers: new Headers({ "content-type": "multipart/form-data; boundary=----jest" }),
    formData: async () => fd,
  };
}

describe("/api/cv/infer route", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;
  const originalConsoleInfo = console.info;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, CV_SERVICE_URL: "http://cv.example" };
    globalThis.fetch = jest.fn();
    console.info = jest.fn();
    const { verifyFirebaseUser } = jest.requireMock("@/lib/apiAuth") as { verifyFirebaseUser: jest.Mock };
    verifyFirebaseUser.mockResolvedValue({ userId: "user-1" });
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    console.info = originalConsoleInfo;
  });

  it("returns ok:true and forwards successful CV JSON", async () => {
    const { POST } = await import("@/app/api/cv/infer/route");
    const file = makeFile({});

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          category: { value: "top" },
          type: { value: "t-shirt" },
          colors: [{ value: "#111111" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const req = (await makeRequestWithFile(file)) as Any;
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.category?.value).toBe("top");
    expect(body.type?.value).toBe("t-shirt");
    expect(body.colors?.[0]?.value).toBe("#111111");
  });

  it("returns structured error JSON when upstream returns 503", async () => {
    const { POST } = await import("@/app/api/cv/infer/route");
    const file = makeFile({});

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Service down" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      })
    );

    const req = (await makeRequestWithFile(file)) as Any;
    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("CV_SERVICE_ERROR");
    expect(typeof body.message).toBe("string");
    expect(body.message).toMatch(/continue/i);
  });

  it("returns structured bad-response error when upstream response is not JSON", async () => {
    const { POST } = await import("@/app/api/cv/infer/route");
    const file = makeFile({});

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(
      new Response("not-json", { status: 200, headers: { "content-type": "text/plain" } })
    );

    const req = (await makeRequestWithFile(file)) as Any;
    const res = await POST(req);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("CV_SERVICE_BAD_RESPONSE");
    expect(typeof body.message).toBe("string");
  });

  it("returns structured timeout error when fetch aborts (AbortError)", async () => {
    const { POST } = await import("@/app/api/cv/infer/route");
    const file = makeFile({});

    const abortErr = new Error("aborted");
    (abortErr as Any).name = "AbortError";
    (globalThis.fetch as jest.Mock).mockRejectedValueOnce(abortErr);

    const req = (await makeRequestWithFile(file)) as Any;
    const res = await POST(req);
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("CV_SERVICE_TIMEOUT");
    expect(typeof body.message).toBe("string");
  });

  it("§I gate: unauthenticated request → 401, no upstream call", async () => {
    const { verifyFirebaseUser } = jest.requireMock("@/lib/apiAuth") as { verifyFirebaseUser: jest.Mock };
    verifyFirebaseUser.mockResolvedValueOnce({ error: "Missing or invalid Authorization header", status: 401 });
    const { POST } = await import("@/app/api/cv/infer/route");

    const req = (await makeRequestWithFile(makeFile({}))) as Any;
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled(); // never forwarded to the CV service
  });

  it("§I gate: oversize image → 413, no upstream call", async () => {
    const { POST } = await import("@/app/api/cv/infer/route");
    const huge = makeFile({ sizeBytes: 11 * 1024 * 1024 }); // > 10 MiB cap

    const req = (await makeRequestWithFile(huge)) as Any;
    const res = await POST(req);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("IMAGE_TOO_LARGE");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
