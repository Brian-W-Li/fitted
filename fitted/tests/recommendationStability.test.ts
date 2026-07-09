/**
 * POST /api/recommend — C8 flag routing + §A degraded contract.
 *
 * Post-C8 the legacy recommender is deleted; the route is a thin dispatcher:
 *   - USE_ML_SHORTLISTER === "true"  → delegates to the M5 vertical (mlRecommend + prodDeps).
 *   - otherwise (off/unset)          → the §A degraded empty browser state: 200, empty candidates,
 *     no {snapshotId,candidateId} binding token, no snapshot — never legacy, never a 5xx/503.
 *
 * The full flag-ON behavior is covered by mlRecommend.test.ts (real Mongo + fake service). Here we
 * assert the dispatcher picks the right arm and that flag-OFF is the honest degraded state (the
 * rollback story) — no OPENAI_API_KEY, no auth, no DB required.
 */
import { NextRequest } from "next/server";

function makeRequest(body: Record<string, unknown> = {}) {
  return {
    headers: { get: () => null },
    json: async () => body,
  } as unknown as NextRequest;
}

describe("POST /api/recommend — flag OFF → §A degraded empty state (legacy retired)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.USE_ML_SHORTLISTER;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("flag unset → 200 degraded empty state, unbindable, no snapshot/binding token", async () => {
    const { POST } = await import("@/app/api/recommend/route");
    const res = await POST(makeRequest({ occasion: "casual hangout" }));

    expect(res.status).toBe(200); // NOT 503/500 — the degraded state is a valid-shape 200
    const body = await res.json();
    expect(body.shown).toEqual([]);
    expect(body.displayItems).toEqual([]);
    expect(body.bindable).toBe(false);
    expect(body.flags.reasonHint).toBe("service_unavailable");
    // No feedback-binding token is emitted for an unbindable render.
    expect(body).not.toHaveProperty("snapshotId");
    expect(body.shown).not.toContainEqual(expect.objectContaining({ candidateId: expect.anything() }));
  });

  it("flag literally 'false' → same degraded state (only 'true' enables the vertical)", async () => {
    process.env.USE_ML_SHORTLISTER = "false";
    const { POST } = await import("@/app/api/recommend/route");
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bindable).toBe(false);
    expect(body.shown).toEqual([]);
  });

  it("returns the degraded state without auth or a body (no 401/500)", async () => {
    const { POST } = await import("@/app/api/recommend/route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect((await res.json()).bindable).toBe(false);
  });
});

describe("POST /api/recommend — flag ON delegates to the M5 vertical", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.dontMock("@/lib/mlRecommend");
    jest.resetModules();
  });

  it("USE_ML_SHORTLISTER=true calls mlRecommend(request, prodDeps()) — not the degraded arm", async () => {
    jest.resetModules();
    process.env = { ...originalEnv, USE_ML_SHORTLISTER: "true" };

    const sentinel = { delegated: true };
    const mlRecommend = jest.fn().mockResolvedValue(sentinel);
    const prodDeps = jest.fn().mockReturnValue({ marker: "prod-deps" });
    const renderDegraded = jest.fn();
    jest.doMock("@/lib/mlRecommend", () => ({ mlRecommend, prodDeps, renderDegraded }));

    const { POST } = await import("@/app/api/recommend/route");
    const req = makeRequest({ occasion: "x" });
    const res = await POST(req);

    expect(mlRecommend).toHaveBeenCalledTimes(1);
    expect(mlRecommend).toHaveBeenCalledWith(req, { marker: "prod-deps" });
    expect(renderDegraded).not.toHaveBeenCalled();
    expect(res).toBe(sentinel);
  });
});

export {}; // module scope (tsc --noEmit: no cross-file top-level name collisions)
