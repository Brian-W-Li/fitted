/**
 * M5 recommend orchestrator — BEHAVIORAL test (C5, seam #6). The behavior-first cure: drive the
 * real `mlRecommend` core over a REAL in-memory Mongo (write → read back) with a fake in-process
 * render service that ECHOES the request identity into a valid payload (exactly as the real service
 * authors it). Asserts orchestration behavior across the real DB boundary — never a shape pin.
 *
 * The client's real HTTP/timeout path is covered separately (mlServiceClient.test.ts); here the
 * service boundary is stubbed so the route's own logic (lineage, idempotency, cross-checks, merge,
 * write, G15 projection) is exercised against a real DB. Matrix = the m5-cutover.md C5 acceptance
 * list + the Fable Q2 absence list.
 */
import mongoose from "mongoose";
import http from "http";
import { randomUUID } from "crypto";
import type { AddressInfo } from "net";
import { NextRequest } from "next/server";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import WardrobeItem from "@/models/WardrobeItem";
import OutfitInteraction from "@/models/OutfitInteraction";
import { mlRecommend, resolveWeatherProd, type MlRecommendDeps, type WeatherResolution } from "@/lib/mlRecommend";
import { GENERATOR_EXPECTATION } from "@/lib/mlRequestAdapter";
import type { RenderBody } from "@/lib/mlRequestAdapter";
import { callRenderService, type RenderServiceResult } from "@/lib/mlServiceClient";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let harness: MongoHarness;
let userId: string;
let itemIds: { top: string; b1: string; b2: string; shoes: string };

beforeAll(async () => {
  harness = await startMemoryMongo([GenerationSnapshot, WardrobeItem, OutfitInteraction]);
});
afterAll(async () => {
  await harness.stop();
});
afterEach(async () => {
  await harness.clear();
});

beforeEach(async () => {
  userId = new mongoose.Types.ObjectId().toString();
  const mk = async (name: string, clothingType: string, category: string) => {
    const doc = await WardrobeItem.create({
      user: userId,
      name,
      clothingType,
      warmth: 5,
      category,
      colors: ["black"],
      occasions: ["casual"],
      isAvailable: true,
    });
    return doc._id.toString();
  };
  itemIds = {
    top: await mk("White Tee", "top", "top"),
    b1: await mk("Blue Jeans", "bottom", "bottom"),
    b2: await mk("Black Chinos", "bottom", "bottom"),
    shoes: await mk("Sneakers", "shoes", "footwear"),
  };
});

// ---------------------------------------------------------------------------
// Fake render service — echoes the request identity into a valid payload + a two-candidate funnel
// over the request wardrobe (so validation, authorship, coverage, and evidence-merge all pass).
// ---------------------------------------------------------------------------
const CACHE_KEY = "a".repeat(64);

function candidate(id: string, topId: string, bottomId: string, pos: number, sig: string): Any {
  return {
    candidateId: id,
    sourceAttemptId: "a0",
    sourceIndex: pos,
    stageReached: "shown",
    accepted: true,
    shown: true,
    shownPosition: pos,
    rejectionCodes: [],
    warningCodes: [],
    items: [
      { itemId: topId, role: "base_top" },
      { itemId: bottomId, role: "base_bottom" },
    ],
    slotMap: { top: topId, bottom: bottomId },
    template: "two_piece",
    baseKey: sig,
    fullSignature: sig,
    optionPath: "reliable",
    risk: "safe",
    styleMove: { moveType: "anchor", changedItemIds: [topId], oneSentence: "Anchor the look." },
    rawEmitted: { itemIds: [topId, bottomId] },
  };
}

function variantWire(c: Any): Any {
  return {
    items: c.items,
    templateType: c.template,
    optionPath: c.optionPath,
    risk: c.risk,
    baseKey: c.baseKey,
    fullSignature: c.fullSignature,
    styleMove: c.styleMove,
  };
}

interface FakeOptions {
  overridePayload?: (p: Any) => void; // mutate the echoed payload (to inject an authorship mismatch)
  fail?: RenderServiceResult; // return a degraded result instead
  degenerate?: boolean; // set the wire `degenerate` flag (a paid-but-nothing-surfaced §D render)
}

function fakeService(opts: FakeOptions = {}) {
  return async (body: RenderBody): Promise<RenderServiceResult> => {
    if (opts.fail) return opts.fail;
    const c0 = candidate("c0", itemIds.top, itemIds.b1, 0, "sig-0");
    const c1 = candidate("c1", itemIds.top, itemIds.b2, 1, "sig-1");
    const candidates = [c0, c1];
    const itemSnapshots = [itemIds.top, itemIds.b1, itemIds.b2].map((id) => ({
      itemId: id,
      engineVisible: {
        name: "x",
        clothingType: id === itemIds.top ? "top" : "bottom",
        warmth: 5,
        styleTags: [],
        colorTags: ["black"],
        occasionTags: ["casual"],
        material: null,
        formality: null,
        imageUrl: "",
      },
    }));
    const payload: Any = {
      // echo-through identity (what the real service authors from the request)
      sessionId: body.sessionId,
      requestId: body.requestId,
      parentSnapshotId: body.parentSnapshotId,
      intent: body.intent,
      occasion: body.lens.occasion,
      weather: body.lens.weather,
      weatherRaw: body.lens.weatherRaw,
      location: body.lens.location,
      forcedItemId: body.lens.forcedItemId,
      seedDate: body.lens.seedDate,
      constraints: {},
      wardrobeVersion: body.wardrobeVersion,
      generationIndex: body.generationIndex,
      controls: body.controls,
      candidateCacheKey: CACHE_KEY,
      // provenance (service config == the Next expectation + promptVersion)
      fittedCoreVersion: "m5.test",
      generator: { ...GENERATOR_EXPECTATION, promptVersion: "m5-c1.v1" },
      rankerConfigVersion: "rk.test",
      scorer: { kind: "cold_start", available: false },
      // funnel
      itemSnapshots,
      generationAttempts: [
        { attemptId: "a0", attemptIndex: 0, isRepair: false, payloadParsed: true, candidateCountEmitted: 2, rawText: "raw gpt text" },
      ],
      candidates,
      diagnostics: {
        samplerPerType: {},
        candidateRequested: 2,
        promptItemCount: body.wardrobe.length,
        notEnoughItems: false,
        scorerAvailable: false,
        rejectionHistogram: {},
        warningHistogram: {},
        parse: { parseSuccess: true, repairUsed: false, generatorCalls: 1 },
        ranker: {},
        rescue: {
          notEnoughItems: false,
          insufficientAfterGeneration: false,
          spreadCollapsed: false,
          reasonHint: null,
        },
      },
      shownCandidateIds: ["c0", "c1"],
      shownFullSignatures: ["sig-0", "sig-1"],
      nSurfaced: 2,
      spreadCollapsed: false,
    };
    opts.overridePayload?.(payload);
    const rescueFlags = payload.diagnostics?.rescue ?? {};
    const shown = payload.shownCandidateIds.map((cid: string) => ({
      candidateId: cid,
      outfit: variantWire(candidates.find((c) => c.candidateId === cid)),
    }));
    // JSON round-trip the whole wire response (as the real HTTP boundary does): isolates object
    // references (so a tampered shown[].outfit truly diverges from its candidate) and proves no
    // unstringifiable value hides in the canned payload.
    const response = JSON.parse(
      JSON.stringify({
        payload,
        shown,
        flags: {
          notEnoughItems: Boolean(rescueFlags.notEnoughItems ?? payload.diagnostics?.notEnoughItems),
          insufficientAfterGeneration: Boolean(rescueFlags.insufficientAfterGeneration),
          spreadCollapsed: Boolean(rescueFlags.spreadCollapsed ?? payload.spreadCollapsed),
          reasonHint: typeof rescueFlags.reasonHint === "string" ? rescueFlags.reasonHint : null,
        },
        degenerate: opts.degenerate ?? false,
      }),
    );
    return { ok: true, response };
  };
}

// ---------------------------------------------------------------------------
// Deps + request builders.
// ---------------------------------------------------------------------------
function makeDeps(over: Partial<MlRecommendDeps> = {}): MlRecommendDeps {
  return {
    verifyUser: async () => ({ userId }),
    models: { GenerationSnapshot, WardrobeItem, OutfitInteraction },
    callService: fakeService(),
    today: () => "2026-07-08",
    newId: () => new mongoose.Types.ObjectId().toString(),
    resolveWeather: async (): Promise<WeatherResolution> => ({ weather: "mild", weatherRaw: null }),
    ...over,
  };
}

function req(body: Record<string, unknown>): NextRequest {
  return { json: async () => body, headers: { get: () => null } } as unknown as NextRequest;
}
function uuid() {
  return randomUUID(); // a real UUIDv4 — unique per call (matches the route's REQUEST_ID_RE)
}

async function json(res: Awaited<ReturnType<typeof mlRecommend>>) {
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// Cases.
// ---------------------------------------------------------------------------
describe("daily + rescue first render", () => {
  it("daily render writes a valid snapshot and returns a G15 browser response with {snapshotId,candidateId}", async () => {
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "weekend brunch" }), makeDeps());
    const { status, body } = await json(res);
    expect(status).toBe(200);
    expect(body.bindable).toBe(true);
    expect(body.shown).toHaveLength(2);
    expect(body.shown[0]).toHaveProperty("snapshotId");
    expect(body.shown[0]).toHaveProperty("candidateId", "c0");
    expect(body.shown[0].displayItems[0]).toHaveProperty("clothingType"); // hydrated from itemSnapshots

    // read the snapshot BACK — the anti-drift cure
    const rows = await GenerationSnapshot.find({ user: userId }).lean();
    expect(rows).toHaveLength(1);
    const row = rows[0] as Any;
    expect(row.intent).toBe("daily");
    expect(row.controls).toEqual({ lockedItemIds: [], dislikedItemIds: [] }); // empty on a root render
    expect(row.interactionCountAtRequest).toBe(0);
    expect(row._id.toString()).toBe(body.shown[0].snapshotId);
    // TS-merge: per-item evidence added; raw-field caps recorded
    expect(row.itemSnapshots[0].evidence).toBeDefined();
    expect(row.generationAttempts[0].rawTextBytes).toBe("raw gpt text".length);
    expect(row.generationAttempts[0].rawTextTruncated).toBe(false);
  });

  it("rescue render (forcedItemId present) persists intent=rescue_item + forcedItemId", async () => {
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "class", forcedItemId: itemIds.top }), makeDeps());
    expect(res.status).toBe(200);
    const row = (await GenerationSnapshot.findOne({ user: userId }).lean()) as Any;
    expect(row.intent).toBe("rescue_item");
    expect(row.forcedItemId).toBe(itemIds.top);
  });

  it("daily render excludes wardrobe items marked unavailable from the service body", async () => {
    await WardrobeItem.findByIdAndUpdate(itemIds.shoes, { isAvailable: false });
    let seenWardrobeIds: string[] = [];
    const deps = makeDeps({
      callService: async (b) => {
        seenWardrobeIds = b.wardrobe.map((item) => item.id);
        return fakeService()(b);
      },
    });
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "weekend brunch" }), deps);
    expect(res.status).toBe(200);
    expect(seenWardrobeIds).not.toContain(itemIds.shoes);
  });

  it("route composes with the real HTTP service client and still writes the snapshot", async () => {
    let seenKey: string | undefined;
    let seenUrl: string | undefined;
    const server = http.createServer((incoming, outgoing) => {
      seenKey = incoming.headers["x-fitted-service-key"] as string | undefined;
      seenUrl = incoming.url;
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      incoming.on("end", () => {
        void (async () => {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as RenderBody;
          const result = await fakeService()(body);
          outgoing.writeHead(200, { "Content-Type": "application/json" });
          outgoing.end(JSON.stringify(result.ok ? result.response : { error: { code: result.reasonHint } }));
        })();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const deps = makeDeps({
        callService: (body) =>
          callRenderService(body, {
            serviceUrl: `http://127.0.0.1:${port}`,
            serviceKey: "route-client-test-key",
            timeoutMs: 2_000,
          }),
      });
      const res = await mlRecommend(req({ requestId: uuid(), occasion: "weekend brunch" }), deps);
      const { status, body } = await json(res);
      expect(status).toBe(200);
      expect(body.bindable).toBe(true);
      expect(seenUrl).toBe("/render");
      expect(seenKey).toBe("route-client-test-key");
      expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("browser response leaks NONE of the corpus internals (G15 negative allowlist)", async () => {
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), makeDeps());
    const { body } = await json(res);
    const tree = JSON.stringify(body);
    for (const banned of [
      "\"payload\"", "\"candidates\"", "rawEmitted", "generationAttempts",
      "diagnostics", "engineFailure", "\"generator\"", "candidateCacheKey", "itemSnapshots",
    ]) {
      expect(tree).not.toContain(banned);
    }
  });
});

describe("A-cluster — per-item wardrobe resilience (a malformed row never sinks the closet)", () => {
  // Raw-insert bypasses Mongoose validation to simulate a messy DB row (CV-derived / legacy /
  // hand-edited) — the data the resilience promise is actually about. clothingType stays valid so
  // the row survives the structural-lock preflight and is isolated to the per-item drop path.
  async function insertMalformed(over: Record<string, unknown>): Promise<string> {
    const res = await WardrobeItem.collection.insertOne({
      user: new mongoose.Types.ObjectId(userId),
      name: "Mystery item",
      clothingType: "top",
      warmth: 5,
      category: "top",
      colors: ["black"],
      occasions: ["casual"],
      isAvailable: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    });
    return res.insertedId.toString();
  }

  it("drops a malformed row and still renders from the good items (service sees only the good wire)", async () => {
    await insertMalformed({ warmth: 11 }); // out-of-range warmth → unusable, but not fatal
    let wireIds: string[] = [];
    const deps = makeDeps({
      callService: async (b: RenderBody) => {
        wireIds = b.wardrobe.map((w) => w.id);
        return fakeService()(b);
      },
    });
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), deps);
    expect(res.status).toBe(200);
    // The four good items reach the wire; the malformed row is excluded (never fatal).
    expect([...wireIds].sort()).toEqual([itemIds.b1, itemIds.b2, itemIds.shoes, itemIds.top].sort());
    // A snapshot still persists — the render succeeded DESPITE the bad row.
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(1);
  });

  it("escalates to 422 forced_item_unusable when the rescue anchor itself is malformed (no spend, no write)", async () => {
    const badId = await insertMalformed({ warmth: 11 });
    let called = false;
    const deps = makeDeps({ callService: async (b: RenderBody) => { called = true; return fakeService()(b); } });
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "class", forcedItemId: badId }), deps);
    const { status, body } = await json(res);
    expect(status).toBe(422);
    expect(body.error.code).toBe("forced_item_unusable");
    expect(called).toBe(false); // the user pointed at an unusable item — reject before any LLM spend
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(0);
  });

  it("escalates to 422 control_item_unusable when a locked item is malformed (re-roll; no spend, no write)", async () => {
    const badId = await insertMalformed({ warmth: 11 });
    const first = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), makeDeps());
    expect(first.status).toBe(200); // the root render drops the bad row harmlessly
    const parent = (await GenerationSnapshot.findOne({ user: userId }).lean()) as Any;
    let called = false;
    const deps = makeDeps({ callService: async (b: RenderBody) => { called = true; return fakeService()(b); } });
    const res = await mlRecommend(
      req({ requestId: uuid(), parentSnapshotId: parent._id.toString(), controls: { lockedItemIds: [badId], dislikedItemIds: [] } }),
      deps,
    );
    const { status, body } = await json(res);
    expect(status).toBe(422);
    expect(body.error.code).toBe("control_item_unusable");
    expect(called).toBe(false);
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(1); // only the parent
  });

  it("escalates a malformed DISLIKED item too (the service rejects an unknown control id, so silent-drop isn't free)", async () => {
    const badId = await insertMalformed({ warmth: 11 });
    await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), makeDeps());
    const parent = (await GenerationSnapshot.findOne({ user: userId }).lean()) as Any;
    const res = await mlRecommend(
      req({ requestId: uuid(), parentSnapshotId: parent._id.toString(), controls: { lockedItemIds: [], dislikedItemIds: [badId] } }),
      makeDeps(),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("control_item_unusable");
  });
});

describe("§C.1 lineage (re-roll)", () => {
  async function firstRender(occasion = "brunch", forcedItemId?: string) {
    const res = await mlRecommend(req({ requestId: uuid(), occasion, forcedItemId }), makeDeps());
    const row = (await GenerationSnapshot.findOne({ user: userId }).lean()) as Any;
    return { res, parentId: row._id.toString(), parent: row };
  }

  it("a re-roll writes a lineaged child with the parent's Lens + generationIndex=parent+1", async () => {
    const { parentId, parent } = await firstRender("weekend brunch");
    const res = await mlRecommend(
      req({ requestId: uuid(), parentSnapshotId: parentId, controls: { lockedItemIds: [itemIds.top], dislikedItemIds: [] } }),
      makeDeps(),
    );
    expect(res.status).toBe(200);
    const child = (await GenerationSnapshot.findOne({ user: userId, generationIndex: 1 }).lean()) as Any;
    expect(child.parentSnapshotId.toString()).toBe(parentId);
    expect(child.occasion).toBe(parent.occasion); // Lens derived from the parent, not the client
    expect(child.weather).toBe(parent.weather);
    expect(child.controls.lockedItemIds).toEqual([itemIds.top]);
    const { body } = await json(res);
    expect(body.generationIndex).toBe(1); // re-roll surfaces lineage to the client
    expect(body.parentSnapshotId).toBe(parentId);
  });

  it("a client-supplied generationIndex on a re-roll is ignored (child index = parent+1)", async () => {
    const { parentId } = await firstRender();
    await mlRecommend(req({ requestId: uuid(), parentSnapshotId: parentId, generationIndex: 99, controls: {} }), makeDeps());
    const child = (await GenerationSnapshot.findOne({ user: userId, parentSnapshotId: parentId }).lean()) as Any;
    expect(child.generationIndex).toBe(1);
  });

  it("a rescue re-roll keeps intent=rescue_item + the parent's forcedItemId (intent from parent, not body)", async () => {
    const { parentId } = await firstRender("class", itemIds.top);
    const res = await mlRecommend(req({ requestId: uuid(), parentSnapshotId: parentId, controls: {} }), makeDeps());
    expect(res.status).toBe(200);
    const child = (await GenerationSnapshot.findOne({ user: userId, generationIndex: 1 }).lean()) as Any;
    expect(child.intent).toBe("rescue_item");
    expect(child.forcedItemId).toBe(itemIds.top);
  });

  it("an uppercase-hex parentSnapshotId is canonicalized so an identical retry replays the winner (not 409)", async () => {
    const { parentId } = await firstRender();
    const rid = uuid();
    const upperParent = parentId.toUpperCase(); // a valid ObjectId, non-canonical case
    const first = await mlRecommend(req({ requestId: rid, parentSnapshotId: upperParent, controls: {} }), makeDeps());
    expect(first.status).toBe(200);
    // Same requestId + same (uppercase) parent = the same render identity → must replay, not conflict.
    const second = await mlRecommend(req({ requestId: rid, parentSnapshotId: upperParent, controls: {} }), makeDeps());
    expect(second.status).toBe(200);
    expect(await GenerationSnapshot.countDocuments({ user: userId, generationIndex: 1 })).toBe(1);
  });

  it("a forged / cross-user parentSnapshotId → 404, no service call, no write", async () => {
    const foreign = new mongoose.Types.ObjectId().toString();
    let called = false;
    const deps = makeDeps({ callService: async (b) => { called = true; return fakeService()(b); } });
    const res = await mlRecommend(req({ requestId: uuid(), parentSnapshotId: foreign, controls: {} }), deps);
    expect(res.status).toBe(404);
    expect(called).toBe(false);
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(0);
  });
});

describe("§C.4 idempotency + G5", () => {
  it("a duplicate requestId with the SAME identity writes one snapshot and replays the winner", async () => {
    const rid = uuid();
    const first = await mlRecommend(req({ requestId: rid, occasion: "brunch" }), makeDeps());
    const firstBody = (await first.json()) as Any;
    const second = await mlRecommend(req({ requestId: rid, occasion: "brunch" }), makeDeps());
    const secondBody = (await second.json()) as Any;
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(1);
    expect(secondBody.shown[0].snapshotId).toBe(firstBody.shown[0].snapshotId); // same winner replayed
  });

  it("a duplicate requestId replays the stored winner with the original browser flags", async () => {
    const rid = uuid();
    const deps = makeDeps({
      callService: fakeService({
        overridePayload: (p) => {
          p.spreadCollapsed = true;
          p.diagnostics.rescue.insufficientAfterGeneration = true;
          p.diagnostics.rescue.spreadCollapsed = true;
          p.diagnostics.rescue.reasonHint = "try regenerating";
        },
      }),
    });
    const first = await mlRecommend(req({ requestId: rid, occasion: "brunch" }), deps);
    const firstBody = (await first.json()) as Any;
    const second = await mlRecommend(req({ requestId: rid, occasion: "brunch" }), deps);
    const secondBody = (await second.json()) as Any;

    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(1);
    expect(secondBody.shown[0].snapshotId).toBe(firstBody.shown[0].snapshotId);
    expect(secondBody.flags).toEqual(firstBody.flags);
    expect(secondBody.flags).toEqual({
      notEnoughItems: false,
      insufficientAfterGeneration: true,
      spreadCollapsed: true,
      reasonHint: "try regenerating",
    });
  });

  it("requestId casing is canonicalized before lookup/write", async () => {
    const rid = uuid();
    const first = await mlRecommend(req({ requestId: rid.toUpperCase(), occasion: "brunch" }), makeDeps());
    const firstBody = (await first.json()) as Any;
    const second = await mlRecommend(req({ requestId: rid.toLowerCase(), occasion: "brunch" }), makeDeps());
    const secondBody = (await second.json()) as Any;
    const row = (await GenerationSnapshot.findOne({ user: userId }).lean()) as Any;

    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(1);
    expect(row.requestId).toBe(rid.toLowerCase());
    expect(secondBody.shown[0].snapshotId).toBe(firstBody.shown[0].snapshotId);
  });

  it("a retry across UTC midnight still replays the winner (seedDate is not G5 identity)", async () => {
    const rid = uuid();
    let day = "2026-07-08";
    let serviceCalls = 0;
    const deps = makeDeps({
      today: () => day,
      callService: async (b) => {
        serviceCalls += 1;
        return fakeService()(b);
      },
    });
    const first = await mlRecommend(req({ requestId: rid, occasion: "brunch" }), deps);
    const firstBody = (await first.json()) as Any;
    day = "2026-07-09";
    const second = await mlRecommend(req({ requestId: rid, occasion: "brunch" }), deps);
    const secondBody = (await second.json()) as Any;

    expect(serviceCalls).toBe(1);
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(1);
    expect(secondBody.shown[0].snapshotId).toBe(firstBody.shown[0].snapshotId);
  });

  it("a duplicate requestId with a CHANGED identity → 409 request_id_conflict, no second write", async () => {
    const rid = uuid();
    await mlRecommend(req({ requestId: rid, occasion: "brunch" }), makeDeps());
    const res = await mlRecommend(req({ requestId: rid, occasion: "a wedding" }), makeDeps());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("request_id_conflict");
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(1);
  });

  it("concurrent duplicate requestId calls still store one snapshot and both replay the same winner", async () => {
    const rid = uuid();
    let arrivals = 0;
    let release!: () => void;
    const bothArrived = new Promise<void>((resolve) => { release = resolve; });
    const deps = makeDeps({
      callService: async (b) => {
        arrivals += 1;
        if (arrivals === 2) release();
        await bothArrived;
        return fakeService()(b);
      },
    });

    const [first, second] = await Promise.all([
      mlRecommend(req({ requestId: rid, occasion: "brunch" }), deps),
      mlRecommend(req({ requestId: rid, occasion: "brunch" }), deps),
    ]);
    const firstBody = (await first.json()) as Any;
    const secondBody = (await second.json()) as Any;

    expect(arrivals).toBe(2); // both passed the early read-check before either write committed
    expect(await GenerationSnapshot.countDocuments({ user: userId, requestId: rid })).toBe(1);
    expect(new Set([firstBody.shown[0].snapshotId, secondBody.shown[0].snapshotId]).size).toBe(1);
  });
});

describe("degrade + reject arms (no write, snapshotId discarded)", () => {
  it("a service failure → 200 degraded empty state, no snapshot", async () => {
    const deps = makeDeps({ callService: fakeService({ fail: { ok: false, reasonHint: "service_unavailable" } }) });
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), deps);
    const { status, body } = await json(res);
    expect(status).toBe(200);
    expect(body.bindable).toBe(false);
    expect(body.shown).toEqual([]);
    expect(body.flags.reasonHint).toBe("service_unavailable");
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(0);
  });

  it("an authorship mismatch (service mangles sessionId) → contract_invalid degraded, no write", async () => {
    const deps = makeDeps({
      callService: fakeService({ overridePayload: (p) => { p.sessionId = "not-the-user"; } }),
    });
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), deps);
    const { status, body } = await json(res);
    expect(status).toBe(200);
    expect(body.flags.reasonHint).toBe("contract_invalid");
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(0);
  });

  it.each([
    ["intent", (p: Any) => { p.intent = "rescue_item"; }],
    ["weatherRaw", (p: Any) => { p.weatherRaw = "service invented weather"; }],
    ["generationIndex", (p: Any) => { p.generationIndex = 99; }],
    ["controls", (p: Any) => { p.controls = { lockedItemIds: [itemIds.top], dislikedItemIds: [] }; }],
    ["generator", (p: Any) => { p.generator.maxCompletionTokens = 9999; }],
  ])("a payload authorship mismatch on %s → contract_invalid degraded, no write", async (_field, mutate) => {
    const deps = makeDeps({ callService: fakeService({ overridePayload: mutate }) });
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), deps);
    const { status, body } = await json(res);
    expect(status).toBe(200);
    expect(body.flags.reasonHint).toBe("contract_invalid");
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(0);
  });

  it("a re-roll whose payload changes the parent candidateCacheKey → contract_invalid, no child write", async () => {
    const first = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), makeDeps());
    await first.json();
    const parent = (await GenerationSnapshot.findOne({ user: userId }).lean()) as Any;
    const deps = makeDeps({
      callService: fakeService({ overridePayload: (p) => { p.candidateCacheKey = "b".repeat(64); } }),
    });
    const res = await mlRecommend(req({ requestId: uuid(), parentSnapshotId: parent._id.toString(), controls: {} }), deps);
    const { status, body } = await json(res);
    expect(status).toBe(200);
    expect(body.flags.reasonHint).toBe("contract_invalid");
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(1); // parent only
  });

  it("a swapped-body shown[].outfit (matching signature, different styleMove) → contract_invalid, no write", async () => {
    const deps = makeDeps({
      // mutate the WIRE outfit body after the payload is built — done via override on candidates is
      // hard, so mutate through a custom service:
      callService: async (b) => {
        const base = await fakeService()(b);
        if (base.ok) {
          (base.response.shown[0].outfit as Any).styleMove.oneSentence = "TAMPERED";
        }
        return base;
      },
    });
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), deps);
    expect((await res.json()).flags.reasonHint).toBe("contract_invalid");
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(0);
  });

  it("a malformed requestId → 400, no service call", async () => {
    let called = false;
    const deps = makeDeps({ callService: async (b) => { called = true; return fakeService()(b); } });
    const res = await mlRecommend(req({ requestId: "not-a-uuid", occasion: "brunch" }), deps);
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });

  it("non-empty controls on a ROOT render → 400 root_controls, no write", async () => {
    const res = await mlRecommend(
      req({ requestId: uuid(), occasion: "brunch", controls: { lockedItemIds: [itemIds.top], dislikedItemIds: [] } }),
      makeDeps(),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("root_controls");
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(0);
  });

  it("non-empty constraints at M5 → contract_invalid degraded, no service call, no write", async () => {
    let called = false;
    const deps = makeDeps({ callService: async (b) => { called = true; return fakeService()(b); } });
    const res = await mlRecommend(
      req({ requestId: uuid(), occasion: "brunch", constraints: { dressCode: "formal" } }),
      deps,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).flags.reasonHint).toBe("contract_invalid");
    expect(called).toBe(false);
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(0);
  });

  it("an invalid client-carried weather bucket → contract_invalid degraded, no service call, no write", async () => {
    let called = false;
    const deps = makeDeps({
      resolveWeather: resolveWeatherProd,
      callService: async (b) => { called = true; return fakeService()(b); },
    });
    const res = await mlRecommend(
      req({ requestId: uuid(), occasion: "brunch", weather: "72F sunny", weatherRaw: "72F sunny" }),
      deps,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).flags.reasonHint).toBe("contract_invalid");
    expect(called).toBe(false);
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(0);
  });

  it("malformed root controls with unknown fields → contract_invalid degraded, no service call, no write", async () => {
    let called = false;
    const deps = makeDeps({ callService: async (b) => { called = true; return fakeService()(b); } });
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "brunch", controls: { unknown: ["x"] } }), deps);
    expect(res.status).toBe(200);
    expect((await res.json()).flags.reasonHint).toBe("contract_invalid");
    expect(called).toBe(false);
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(0);
  });

  it("a rescue whose forced item is not in the wardrobe → 409 forced_item_unavailable, no service call", async () => {
    const gone = new mongoose.Types.ObjectId().toString();
    let called = false;
    const deps = makeDeps({ callService: async (b) => { called = true; return fakeService()(b); } });
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "class", forcedItemId: gone }), deps);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("forced_item_unavailable");
    expect(called).toBe(false);
  });

  it("a rescue whose forced item is marked unavailable → 409 forced_item_unavailable, no service call", async () => {
    await WardrobeItem.findByIdAndUpdate(itemIds.top, { isAvailable: false });
    let called = false;
    const deps = makeDeps({ callService: async (b) => { called = true; return fakeService()(b); } });
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "class", forcedItemId: itemIds.top }), deps);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("forced_item_unavailable");
    expect(called).toBe(false);
  });

  it("locked ∩ disliked ≠ ∅ on a re-roll → 400 controls_contradictory", async () => {
    const first = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), makeDeps());
    await first.json();
    const parentId = ((await GenerationSnapshot.findOne({ user: userId }).lean()) as Any)._id.toString();
    const res = await mlRecommend(
      req({ requestId: uuid(), parentSnapshotId: parentId, controls: { lockedItemIds: [itemIds.top], dislikedItemIds: [itemIds.top] } }),
      makeDeps(),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("controls_contradictory");
  });

  it("a re-roll control id outside the available wardrobe → 400 control_item_unavailable", async () => {
    const first = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), makeDeps());
    await first.json();
    const parentId = ((await GenerationSnapshot.findOne({ user: userId }).lean()) as Any)._id.toString();
    const gone = new mongoose.Types.ObjectId().toString();
    let called = false;
    const deps = makeDeps({ callService: async (b) => { called = true; return fakeService()(b); } });
    const res = await mlRecommend(
      req({ requestId: uuid(), parentSnapshotId: parentId, controls: { lockedItemIds: [gone], dislikedItemIds: [] } }),
      deps,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("control_item_unavailable");
    expect(called).toBe(false);
  });

  it("a structurally impossible lock set → 400 controls_structurally_infeasible, no service call", async () => {
    const secondShoe = await WardrobeItem.create({
      user: userId,
      name: "Loafers",
      clothingType: "shoes",
      warmth: 5,
      category: "footwear",
      colors: ["black"],
      isAvailable: true,
    });
    const first = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), makeDeps());
    await first.json();
    const parentId = ((await GenerationSnapshot.findOne({ user: userId }).lean()) as Any)._id.toString();
    let called = false;
    const deps = makeDeps({ callService: async (b) => { called = true; return fakeService()(b); } });
    const res = await mlRecommend(
      req({
        requestId: uuid(),
        parentSnapshotId: parentId,
        controls: { lockedItemIds: [itemIds.shoes, secondShoe._id.toString()], dislikedItemIds: [] },
      }),
      deps,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("controls_structurally_infeasible");
    expect(called).toBe(false);
  });
});

describe("edge quantifier paths (review absence-shaped gaps)", () => {
  it("a blank optional Lens field (location='') still renders — no false authorship degrade", async () => {
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "brunch", location: "" }), makeDeps());
    expect(res.status).toBe(200);
    expect((await res.json()).bindable).toBe(true);
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(1);
  });

  it("malformed controls (non-array) → contract_invalid degraded (not a 500), no write", async () => {
    const first = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), makeDeps());
    await first.json();
    const parentId = ((await GenerationSnapshot.findOne({ user: userId }).lean()) as Any)._id.toString();
    const res = await mlRecommend(
      req({ requestId: uuid(), parentSnapshotId: parentId, controls: { lockedItemIds: "not-an-array" } }),
      makeDeps(),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).flags.reasonHint).toBe("contract_invalid");
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(1); // only the parent
  });

  it("a healthy nSurfaced=0 render (understocked closet) STILL writes a snapshot, bindable=false", async () => {
    const deps = makeDeps({
      callService: fakeService({
        overridePayload: (p) => {
          p.candidates = [];
          p.itemSnapshots = [];
          p.generationAttempts = [];
          p.shownCandidateIds = [];
          p.shownFullSignatures = [];
          p.nSurfaced = 0;
        },
      }),
    });
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), deps);
    const { status, body } = await json(res);
    expect(status).toBe(200);
    expect(body.bindable).toBe(false);
    expect(body.shown).toEqual([]);
    const row = (await GenerationSnapshot.findOne({ user: userId }).lean()) as Any;
    expect(row).not.toBeNull();
    expect(row.nSurfaced).toBe(0);
  });

  it("a degenerate payload (attempts present, nSurfaced=0) STILL writes a snapshot", async () => {
    const deps = makeDeps({
      callService: fakeService({
        overridePayload: (p) => {
          p.candidates = [];
          p.itemSnapshots = [];
          p.shownCandidateIds = [];
          p.shownFullSignatures = [];
          p.nSurfaced = 0; // generationAttempts stays non-empty → degenerate (money spent, nothing surfaced)
        },
      }),
    });
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), deps);
    expect(res.status).toBe(200);
    const row = (await GenerationSnapshot.findOne({ user: userId }).lean()) as Any;
    expect(row).not.toBeNull();
    expect(row.nSurfaced).toBe(0);
    expect(row.generationAttempts.length).toBeGreaterThan(0);
  });

  it("a degenerate:true + diagnostics.engineFailure render persists an engineFailure snapshot row", async () => {
    // Item (d): distinct from the healthy nSurfaced=0 tests above — a §D engine failure (parse repair
    // gave up) must round-trip its failure corpus through the orchestrator's validate→merge→write,
    // never be strict-stripped, and never leak to the browser.
    const failItemId = new mongoose.Types.ObjectId().toHexString();
    const deps = makeDeps({
      callService: fakeService({
        degenerate: true,
        overridePayload: (p) => {
          p.candidates = [];
          p.itemSnapshots = [];
          p.generationAttempts = []; // build_degenerate_payload emits EMPTY attempts + engineFailure
          p.shownCandidateIds = [];
          p.shownFullSignatures = [];
          p.nSurfaced = 0;
          p.diagnostics.engineFailure = {
            stage: "parse",
            code: "parse_fail",
            message: "GPT output failed JSON repair",
            messageTruncated: false,
            detail: { itemId: failItemId, count: 3 },
          };
        },
      }),
    });
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), deps);
    const { status, body } = await json(res);
    expect(status).toBe(200);
    expect(body.bindable).toBe(false);
    expect(body.shown).toEqual([]);

    // The failure corpus survives the orchestrator write and reads back non-null.
    const row = (await GenerationSnapshot.findOne({ user: userId }).lean()) as Any;
    expect(row).not.toBeNull();
    expect(row.nSurfaced).toBe(0);
    expect(row.diagnostics?.engineFailure).toBeTruthy();
    expect(row.diagnostics.engineFailure.stage).toBe("parse");
    expect(row.diagnostics.engineFailure.code).toBe("parse_fail");
    expect(row.diagnostics.engineFailure.detail.itemId).toBe(failItemId);

    // ...but the browser response leaks NONE of it (G15 negative allowlist).
    expect(JSON.stringify(body)).not.toContain("engineFailure");
  });
});
