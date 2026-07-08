/**
 * M5 render-service client (C5 seam #3) — a REAL network round-trip, not a mock.
 *
 * A localhost http server stands in for the Fly.io service; `callRenderService` fetches it over
 * the loopback interface for real, so the test exercises the actual fetch + AbortSignal.timeout +
 * response-parsing path. This is the "real service call" boundary the behavior-first mandate asks
 * for: every §D degrade trigger (unreachable/timeout/5xx/auth/rate-limit/contract_invalid) is
 * driven end-to-end, not asserted against a stubbed return value.
 */
import http from "http";
import type { AddressInfo } from "net";
import {
  callRenderService,
  buildDegradedResponse,
  type RenderServiceResult,
} from "@/lib/mlServiceClient";
import type { RenderBody } from "@/lib/mlRequestAdapter";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let currentHandler: Handler;
let server: http.Server;
let baseUrl: string;
const KEY = "test-secret-key";

beforeAll(async () => {
  server = http.createServer((req, res) => currentHandler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const body = {} as RenderBody; // the client only JSON.stringifies it — content is irrelevant here
const call = (timeoutMs = 5_000): Promise<RenderServiceResult> =>
  callRenderService(body, { serviceUrl: baseUrl, serviceKey: KEY, timeoutMs });

function respondJson(res: http.ServerResponse, status: number, obj: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
describe("callRenderService — success path", () => {
  it("returns ok + the parsed response on a 200, and sends the shared-secret header", async () => {
    let seenKey: string | undefined;
    currentHandler = (req, res) => {
      seenKey = req.headers["x-fitted-service-key"] as string;
      respondJson(res, 200, {
        payload: { candidateCacheKey: "ck" },
        shown: [{ candidateId: "c0" }],
        flags: { notEnoughItems: false, insufficientAfterGeneration: false, spreadCollapsed: false, reasonHint: null },
        degenerate: false,
      });
    };
    const result = await call();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.shown[0].candidateId).toBe("c0");
      expect(result.response.degenerate).toBe(false);
    }
    expect(seenKey).toBe(KEY); // the auth header actually crossed the wire
  });

  it("treats a degenerate 2xx as a success to persist (not a degrade)", async () => {
    currentHandler = (_req, res) =>
      respondJson(res, 200, {
        payload: { candidateCacheKey: "ck" },
        shown: [],
        flags: { notEnoughItems: false, insufficientAfterGeneration: true, spreadCollapsed: false, reasonHint: "try regenerating" },
        degenerate: true,
      });
    const result = await call();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.response.degenerate).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("callRenderService — degrade triggers (§D H12)", () => {
  it("times out via its own AbortSignal → service_unavailable (a slow service never blocks)", async () => {
    currentHandler = (_req, res) => {
      // Hold the response well past the client timeout; never respond in time.
      setTimeout(() => respondJson(res, 200, { payload: {}, shown: [], flags: {}, degenerate: false }), 1_000).unref();
    };
    const result = await call(100); // 100ms client timeout vs 1s server delay
    expect(result).toEqual({ ok: false, reasonHint: "service_unavailable" });
  });

  it("maps a 5xx → service_unavailable", async () => {
    currentHandler = (_req, res) => respondJson(res, 503, { error: { code: "internal", message: "boom" } });
    expect(await call()).toEqual({ ok: false, reasonHint: "service_unavailable" });
  });

  it("maps a 401 → auth_failed", async () => {
    currentHandler = (_req, res) => respondJson(res, 401, { error: { code: "auth", message: "bad key" } });
    expect(await call()).toEqual({ ok: false, reasonHint: "auth_failed" });
  });

  it("maps a 429 → rate_limited", async () => {
    currentHandler = (_req, res) => respondJson(res, 429, { error: { code: "rate_limit", message: "slow down" } });
    expect(await call()).toEqual({ ok: false, reasonHint: "rate_limited" });
  });

  it("maps a contract_invalid envelope → contract_invalid", async () => {
    currentHandler = (_req, res) => respondJson(res, 422, { error: { code: "contract_invalid", message: "bad lens" } });
    expect(await call()).toEqual({ ok: false, reasonHint: "contract_invalid" });
  });

  it("maps a 2xx with unparseable body → service_unavailable", async () => {
    currentHandler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("not json{");
    };
    expect(await call()).toEqual({ ok: false, reasonHint: "service_unavailable" });
  });

  it("an unreachable service (connection refused) → service_unavailable", async () => {
    // Port 1 is not listening; fetch rejects with a connection error the client catches.
    const result = await callRenderService(body, {
      serviceUrl: "http://127.0.0.1:1",
      serviceKey: KEY,
      timeoutMs: 2_000,
    });
    expect(result).toEqual({ ok: false, reasonHint: "service_unavailable" });
  });
});

// ---------------------------------------------------------------------------
describe("buildDegradedResponse — the §A browser empty state", () => {
  it("is an empty, non-bindable state carrying only the reason code", () => {
    expect(buildDegradedResponse("service_unavailable")).toEqual({
      shown: [],
      displayItems: [],
      bindable: false,
      flags: { notEnoughItems: false, insufficientAfterGeneration: false, spreadCollapsed: false, reasonHint: "service_unavailable" },
    });
  });
});
