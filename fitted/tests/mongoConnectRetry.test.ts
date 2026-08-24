/**
 * DEFECTS-H87 — a rejected Mongo connect must not be cached for the life of the instance.
 *
 * `lib/mongodb.ts` memoizes `mongoose.connect(...)` on `globalThis` (correct for hot reloads /
 * serverless warm instances). Pre-fix it also memoized a REJECTED promise: after one transient
 * Atlas/SRV failure, every later `connectMongo()` on that warm instance re-awaited the same
 * rejection and threw instantly — no retry, even after Atlas recovered — until Vercel recycled
 * the instance. Since `connectMongo` sits under both auth helpers, that one blip took down the
 * whole app for whoever routed there.
 *
 * `mongoose.connect` is mocked (no real connection is ever made), so the assertions are purely
 * about the caching contract. The tests in this file share the module-level cache on purpose and
 * are ORDER-DEPENDENT within the file: test 1 leaves a healthy cached connection that test 2
 * then asserts is reused. Deliberately no `jest.resetModules()` — it would mint a second mongoose
 * instance (see dbErasureDoor.test.ts for the observed hang).
 */
import mongoose from "mongoose";

let connectSpy: jest.SpyInstance;
let origUri: string | undefined;

beforeAll(() => {
  origUri = process.env.MONGODB_URI;
  process.env.MONGODB_URI = "mongodb://localhost:0/never-actually-dialed";
  delete (globalThis as { mongoose?: unknown }).mongoose; // fresh cache for this file's module load
  // Base implementation rejects so an unexpected extra connect can never fall through to the
  // spy's ORIGINAL implementation and really dial the bogus URI (which would hang the suite).
  connectSpy = jest
    .spyOn(mongoose, "connect")
    .mockImplementation(() => Promise.reject(new Error("unexpected extra connect")));
});

afterAll(() => {
  connectSpy.mockRestore();
  if (origUri === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = origUri;
  delete (globalThis as { mongoose?: unknown }).mongoose;
});

describe("connectMongo — a failed connect is retried, a successful one is cached", () => {
  it("clears the cached promise on rejection so the NEXT call reconnects and succeeds", async () => {
    connectSpy
      .mockRejectedValueOnce(new Error("SRV blip")) // the transient Atlas failure
      .mockResolvedValueOnce(mongoose as never); // Atlas healthy again

    const { connectMongo } = await import("@/lib/mongodb");

    // First request during the blip: fails, as it must.
    await expect(connectMongo()).rejects.toThrow("SRV blip");
    // Second request after recovery: pre-fix this re-awaited the SAME rejected promise and threw
    // "SRV blip" again without ever redialing — the bricked-instance defect.
    await expect(connectMongo()).resolves.toBe(mongoose);
    expect(connectSpy).toHaveBeenCalledTimes(2);
  });

  it("still memoizes a SUCCESSFUL connection — later calls never redial", async () => {
    const { connectMongo } = await import("@/lib/mongodb");
    connectSpy.mockClear();
    await expect(connectMongo()).resolves.toBe(mongoose);
    expect(connectSpy).not.toHaveBeenCalled(); // served from cache, no third connect
  });
});
