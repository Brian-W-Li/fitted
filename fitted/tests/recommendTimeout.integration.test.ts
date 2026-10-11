/** Ordinary client deadline through the real HTTP boundary and recommendation orchestrator.
 * Synthetic Mongo only; no Firebase/provider/service credentials and no timeout override.
 * This proves honest degradation and no snapshot, not cancellation of a provider's paid work.
 */
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Types } from "mongoose";
import { type NextRequest } from "next/server";
import User from "@/models/User";
import WardrobeItem from "@/models/WardrobeItem";
import WardrobeImage from "@/models/WardrobeImage";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import OutfitInteraction from "@/models/OutfitInteraction";
import { mlRecommend, type MlRecommendDeps } from "@/lib/mlRecommend";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";

jest.mock("@/lib/firebaseAdmin", () => ({ adminAuth: { verifyIdToken: jest.fn() } }));
let harness: MongoHarness;
let server: Server;
let serviceUrl: string;
let received = false;
let closed = false;
beforeAll(async () => {
  harness = await startMemoryMongo([User, WardrobeItem, WardrobeImage, GenerationSnapshot, OutfitInteraction], { replicaSet: true });
  server = createServer((req, res) => {
    received = req.method === "POST" && req.url === "/render";
    req.resume();
    // A hung service deliberately never returns a render, including any bound IDs.
    res.once("close", () => { closed = true; });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  serviceUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await harness.stop();
});

it("ordinary default abort produces an honest non-bindable response and persists no shown proposal", async () => {
  let client!: typeof import("@/lib/mlServiceClient");
  const previous = process.env.ML_SERVICE_TIMEOUT_MS;
  delete process.env.ML_SERVICE_TIMEOUT_MS;
  try { jest.isolateModules(() => { client = jest.requireActual("@/lib/mlServiceClient"); }); }
  finally {
    if (previous === undefined) delete process.env.ML_SERVICE_TIMEOUT_MS;
    else process.env.ML_SERVICE_TIMEOUT_MS = previous;
  }
  expect(client.SERVICE_TIMEOUT_MS).toBe(45_000);
  const owner = await User.create({ authId: randomUUID(), email: `${randomUUID()}@example.test` });
  await WardrobeItem.create([
    { user: owner._id, name: "Synthetic tee", category: "top", clothingType: "top", warmth: 4 },
    { user: owner._id, name: "Synthetic trousers", category: "bottom", clothingType: "bottom", warmth: 4 },
  ]);
  const deps: MlRecommendDeps = {
    verifyUser: async () => ({ userId: String(owner._id) }),
    models: { User, WardrobeItem, WardrobeImage, GenerationSnapshot, OutfitInteraction },
    callService: body => client.callRenderService(body, { serviceUrl, serviceKey: "synthetic-timeout-key" }),
    today: () => "2026-10-11", newId: () => String(new Types.ObjectId()),
    resolveWeather: async () => ({ weather: "mild", weatherRaw: null, weatherSource: "default" }),
  };
  const request = { json: async () => ({ requestId: randomUUID(), occasion: "class" }) } as NextRequest;
  const started = Date.now();
  const response = await mlRecommend(request, deps);
  const elapsed = Date.now() - started;
  expect(received).toBe(true);
  expect(elapsed).toBeGreaterThanOrEqual(client.SERVICE_TIMEOUT_MS - 500);
  expect(elapsed).toBeLessThan(60_000);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ shown: [], bindable: false,
    flags: { reasonHint: "service_unavailable", notEnoughItems: false } });
  expect(await GenerationSnapshot.countDocuments({ user: owner._id })).toBe(0);
  expect(await WardrobeItem.countDocuments({ user: owner._id })).toBe(2);
  // Give the peer's close event one event-loop turn before examining transport cleanup.
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(closed).toBe(true);
}, 70_000);
