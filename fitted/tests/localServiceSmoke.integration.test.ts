/**
 * LOCAL cross-runtime integration smoke (M5 C8 half-2) — NOT part of `npm test` / CI.
 *
 * Drives the REAL `mlRecommend` orchestrator over a REAL in-memory Mongo with the REAL HTTP client
 * (`callRenderService`) pointed at a LOCALLY-RUNNING render service + a real `gpt-5.4-mini` render.
 * Proves the whole cutover wire end-to-end across BOTH runtimes with the real model — the one seam
 * the hermetic suite stubs: Next adapter → HTTP → python service → §G payload validation + §A/G4
 * cross-checks → snapshot write → §6.5 feedback bind. Zero production data (ephemeral Mongo, no
 * Firebase, no Atlas).
 *
 * Run (with the local service up on the given URL + key):
 *   ML_SMOKE_URL=http://127.0.0.1:8099 ML_SMOKE_KEY=... npx jest localServiceSmoke --runInBand
 * Skips entirely unless ML_SMOKE_URL + ML_SMOKE_KEY are set — so `npm test` / CI never run it.
 */
import mongoose from "mongoose";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import WardrobeItem from "@/models/WardrobeItem";
import OutfitInteraction from "@/models/OutfitInteraction";
import User from "@/models/User";
import { mlRecommend, resolveWeatherProd, type MlRecommendDeps } from "@/lib/mlRecommend";
import { callRenderService } from "@/lib/mlServiceClient";
import { postInteraction, type InteractionDeps } from "@/lib/interactions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const SMOKE_URL = process.env.ML_SMOKE_URL;
const SMOKE_KEY = process.env.ML_SMOKE_KEY;
const gate = SMOKE_URL && SMOKE_KEY ? describe : describe.skip;

let harness: MongoHarness;
let userId: string;
let ids: { top: string; b1: string; b2: string; shoes: string; outer: string };

gate("LOCAL service smoke — real Next core ↔ real service ↔ real gpt-5.4-mini", () => {
  beforeAll(async () => {
    harness = await startMemoryMongo([GenerationSnapshot, WardrobeItem, OutfitInteraction, User]);
  });
  afterAll(async () => {
    await harness.stop();
  });
  beforeEach(async () => {
    await harness.clear();
    // A REAL user row — the 11.5 erasure-race check re-reads it after every snapshot write.
    const user = await User.create({ authProvider: "firebase", authId: "uid-smoke", email: "s@example.com" });
    userId = user._id.toString();
    const mk = async (name: string, clothingType: string, category: string) => {
      const doc = await WardrobeItem.create({
        user: userId, name, clothingType, warmth: 5, category,
        colors: ["navy"], occasions: ["casual"], isAvailable: true,
      });
      return doc._id.toString();
    };
    ids = {
      top: await mk("Oxford shirt", "top", "top"),
      b1: await mk("Chinos", "bottom", "bottom"),
      b2: await mk("Charcoal trousers", "bottom", "bottom"),
      shoes: await mk("Derby shoes", "shoes", "footwear"),
      outer: await mk("Grey blazer", "outer_layer", "outer"),
    };
  });

  function deps(): MlRecommendDeps {
    return {
      verifyUser: async () => ({ userId }),
      models: { GenerationSnapshot, WardrobeItem, OutfitInteraction, User },
      callService: (body) =>
        callRenderService(body, { serviceUrl: SMOKE_URL, serviceKey: SMOKE_KEY, timeoutMs: 60_000 }),
      today: () => "2026-07-08",
      newId: () => new mongoose.Types.ObjectId().toString(),
      resolveWeather: resolveWeatherProd,
    };
  }

  function req(body: Record<string, unknown>): NextRequest {
    return { json: async () => body, headers: { get: () => null } } as unknown as NextRequest;
  }

  function interactionDeps(): InteractionDeps {
    return {
      verifyUser: async () => ({ userId }) as Any,
      models: { OutfitInteraction, GenerationSnapshot },
    };
  }

  it("daily render → real service → a valid snapshot + a bindable §6.5 response", async () => {
    const res = await mlRecommend(req({ requestId: randomUUID(), occasion: "office day, business casual" }), deps());
    const body = (await res.json()) as Any;
    // eslint-disable-next-line no-console
    console.log("[smoke] daily status", res.status, "bindable", body.bindable, "nShown", body.shown?.length, "flags", body.flags);
    expect(res.status).toBe(200);
    expect(body.bindable).toBe(true);
    expect(body.shown.length).toBeGreaterThanOrEqual(1);
    expect(body.shown[0]).toHaveProperty("snapshotId");
    expect(body.shown[0]).toHaveProperty("candidateId");
    expect(body.shown[0].displayItems[0]).toHaveProperty("clothingType"); // hydrated from itemSnapshots

    const rows = await GenerationSnapshot.find({ user: userId }).lean();
    expect(rows).toHaveLength(1);
    const row = rows[0] as Any;
    expect(row.intent).toBe("daily");
    expect(row.candidates.length).toBeGreaterThanOrEqual(1);
    expect(row.generator.model).toBe("gpt-5.4-mini"); // a REAL render authored by the service
    // no corpus internals leak to the browser (G15)
    expect(JSON.stringify(body)).not.toContain("candidateCacheKey");

    // §6.5 feedback binds to what was shown
    const { snapshotId, candidateId } = body.shown[0];
    const fb = await postInteraction(
      req({ snapshotId, candidateId, action: "accepted" }) as Any,
      interactionDeps(),
    );
    expect(fb.status).toBe(200);
    const interactions = await OutfitInteraction.find({ user: userId }).lean();
    expect(interactions).toHaveLength(1);
    expect((interactions[0] as Any).snapshotId.toString()).toBe(snapshotId);
    expect((interactions[0] as Any).candidateId).toBe(candidateId);
  }, 90_000);

  it("rescue render (forcedItemId) → the forced item is in the surfaced outfit(s)", async () => {
    const res = await mlRecommend(
      req({ requestId: randomUUID(), occasion: "weekend casual", forcedItemId: ids.top }),
      deps(),
    );
    const body = (await res.json()) as Any;
    // eslint-disable-next-line no-console
    console.log("[smoke] rescue status", res.status, "bindable", body.bindable, "nShown", body.shown?.length);
    expect(res.status).toBe(200);
    if (body.bindable) {
      for (const outfit of body.shown) {
        const itemIds = outfit.displayItems.map((d: Any) => d.itemId ?? d.id);
        expect(itemIds).toContain(ids.top);
      }
      const row = (await GenerationSnapshot.findOne({ user: userId }).lean()) as Any;
      expect(row.intent).toBe("rescue_item");
      expect(row.forcedItemId).toBe(ids.top);
    }
  }, 90_000);
});
