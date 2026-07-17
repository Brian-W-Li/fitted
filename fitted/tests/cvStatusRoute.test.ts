/**
 * GET /api/cv/status — the CV-service health probe the client uses to decide whether to offer the
 * "Analyze photo" flow (post-m5-reset §4.6 / Track-1; untested before this). Behaviors pinned: no
 * configured URL → a fast {available:false, reason:"not_configured"} with no network call; a reachable
 * service (200, or 405/422 = up-but-no-HEAD) → available:true; an error status → available:false; a
 * network failure → {available:false, reason:"unreachable"}.
 *
 * CV_SERVICE_URL is captured at module load, so each env branch imports the route fresh (resetModules).
 * The outbound fetch is mocked (the CV service is external).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const originalFetch = globalThis.fetch;
const originalUrl = process.env.CV_SERVICE_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.CV_SERVICE_URL;
  else process.env.CV_SERVICE_URL = originalUrl;
});

/** Import the route with CV_SERVICE_URL set (or unset) for THIS test, capturing the env at load. */
async function loadRoute(url: string | undefined) {
  jest.resetModules();
  if (url === undefined) delete process.env.CV_SERVICE_URL;
  else process.env.CV_SERVICE_URL = url;
  return (await import("@/app/api/cv/status/route")).GET;
}

describe("GET /api/cv/status", () => {
  it("reports not_configured without any network call when CV_SERVICE_URL is unset", async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as Any;
    const GET = await loadRoute(undefined);

    const res = await GET();
    expect(await res.json()).toEqual({ available: false, reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("HEADs <url>/infer and reports available on a 200", async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as Any;
    const GET = await loadRoute("http://cv.example/");

    const res = await GET();
    expect(await res.json()).toEqual({ available: true });
    // Trailing slash trimmed; probes the /infer endpoint with a cheap HEAD.
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("http://cv.example/infer");
    expect(init.method).toBe("HEAD");
  });

  it.each([405, 422])("treats %s (up, but HEAD unsupported) as available", async (status) => {
    globalThis.fetch = jest.fn().mockResolvedValue(new Response(null, { status })) as Any;
    const GET = await loadRoute("http://cv.example");
    expect(await (await GET()).json()).toEqual({ available: true });
  });

  it("reports unavailable on a 500 error status", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(new Response(null, { status: 500 })) as Any;
    const GET = await loadRoute("http://cv.example");
    expect(await (await GET()).json()).toEqual({ available: false });
  });

  it("reports unreachable when the probe fails (network error / timeout abort)", async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED")) as Any;
    const GET = await loadRoute("http://cv.example");
    expect(await (await GET()).json()).toEqual({ available: false, reason: "unreachable" });
  });
});
