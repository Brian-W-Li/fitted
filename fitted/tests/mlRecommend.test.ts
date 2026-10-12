import { LAYER_CHOICE_NOTES } from "@/lib/weatherContext";
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
import WardrobeImage from "@/models/WardrobeImage";
import OutfitInteraction from "@/models/OutfitInteraction";
import User from "@/models/User";
import OutfitExperience, { experienceCollection } from "@/models/OutfitExperience";
import { ExperienceStore } from "@/lib/outfitExperience/store";
import { getSuggestion, getExperience, recallExperiences, recentSuggestions } from "@/lib/outfitExperience/read";

// Mocks used ONLY by the composed erasure-race case (the real DELETE /api/account route runs in
// this suite): every mlRecommend test injects deps, so these never affect the render paths.
jest.mock("@/lib/db", () => ({
  initDatabase: jest.fn(),
  // Delegates to the REAL harness-connected User model so the registered cascade hook + ObjectId
  // cast run for real (same honest-limit note as accountDeleteRoute.test.ts: the 3-line
  // `deleteUserWithData` wrapper body is replicated, not executed).
  deleteUserWithData: jest.fn(async (uid: unknown) => {
    const UserModel = jest.requireActual("@/models/User").default;
    const result = await UserModel.deleteOne({ _id: uid });
    return result.deletedCount > 0;
  }),
}));
jest.mock("@/lib/firebaseAdmin", () => ({
  adminAuth: { verifyIdToken: jest.fn(), deleteUser: jest.fn() },
}));
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
  // 120s, matching the other 16 real-Mongo suites: booting a mongod exceeds jest's 5s DEFAULT
  // hook timeout under parallel load, and when it does this hook throws, `harness` stays
  // undefined, and EVERY test in the file fails on `harness.clear()` — an intermittent red that
  // reads as flake and trains people to re-run instead of investigate.
  harness = await startMemoryMongo([GenerationSnapshot, WardrobeItem, WardrobeImage, OutfitInteraction, User, OutfitExperience], { replicaSet: true });
}, 120_000);
afterAll(async () => {
  await harness.stop();
});
afterEach(async () => {
  await harness.clear();
});

beforeEach(async () => {
  // A REAL user row — the 11.5 erasure-race check re-reads it after every snapshot write.
  const user = await User.create({ authProvider: "firebase", authId: "uid-test", email: "t@example.com" });
  userId = user._id.toString();
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
  respectControls?: boolean;
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
        name: body.wardrobe.find(item => item.id === id)?.name ?? "Unknown item",
        clothingType: id === itemIds.top ? "top" : "bottom",
        warmth: 5,
        styleTags: [],
        colorTags: ["black"],
        occasionTags: ["casual"],
        material: null,
        formality: null,
        imageUrl: body.wardrobe.find(item => item.id === id)?.imageUrl ?? "",
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
      ...(body.lens.weatherSignals ? { weatherSignals: body.lens.weatherSignals } : {}),
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
    if (opts.respectControls) {
      const blocked = new Set(body.controls.dislikedItemIds);
      const shownCandidates = candidates.filter(c => c.items.some((item: Any) => item.itemId === body.lens.forcedItemId) &&
        c.items.every((item: Any) => !blocked.has(item.itemId)) &&
        (!body.controls.excludedOutfitItemIds || c.items.length !== body.controls.excludedOutfitItemIds.length ||
          c.items.some((item: Any) => !body.controls.excludedOutfitItemIds!.includes(item.itemId))));
      candidates.forEach(c => {
        c.shown = shownCandidates.includes(c);
        if (!c.shown) { c.stageReached = "ranked"; delete c.shownPosition; }
        else c.shownPosition = shownCandidates.indexOf(c);
      });
      payload.shownCandidateIds = shownCandidates.map(c => c.candidateId);
      payload.shownFullSignatures = shownCandidates.map(c => c.fullSignature);
      payload.nSurfaced = shownCandidates.length;
    }
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
    models: { GenerationSnapshot, WardrobeItem, WardrobeImage, OutfitInteraction, User },
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

  it("D1 slot census counts the PROJECTED wardrobe — a dropped malformed row is never counted", async () => {
    // A corrupt "bottom" the projection drops: were the census taken from raw wardrobeDocs it
    // would read 3 bottoms — a count the engine can't see, misdiagnosing the empty state.
    await insertMalformed({ warmth: 11, clothingType: "bottom", name: "Ghost skirt" });
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), makeDeps());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Any;
    expect(body.flags.slotCensus).toEqual({ top: 1, bottom: 2, dress: 0, outer_layer: 0, shoes: 1 });
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

describe("R2 shown-outfit variation", () => {
  async function classSource(occasion = "Class", weatherRaw: string | null = null) {
    const first = await mlRecommend(req({ requestId: uuid(), occasion, forcedItemId: itemIds.top }), makeDeps({ resolveWeather: async () => ({ weather: "mild", weatherRaw }) }));
    const source = (await GenerationSnapshot.findOne({ user: userId }).lean()) as Any;
    return { first, sourceId: source._id.toString() };
  }
  const variation = (sourceCandidateId: string, anchorItemId: string, leaveOutItemId: string, occasion = "Dinner") =>
    ({ sourceCandidateId, anchorItemId, leaveOutItemId, occasion });

  it("adapts without rejecting a source piece and distinguishes an added exclusion on retry", async () => {
    const { sourceId } = await classSource();
    const requestId = uuid();
    const body = { requestId, parentSnapshotId: sourceId,
      variation: { sourceCandidateId: "c0", anchorItemId: itemIds.top, occasion: "Relaxed dinner" } };
    const service = jest.fn(fakeService({ respectControls: true }));
    const deps = makeDeps({ callService: service });
    const first = await mlRecommend(req(body), deps);
    expect(first.status).toBe(200);
    const result = await first.json();
    expect(result.shown).toHaveLength(2); // Original combination remains eligible.
    expect(service.mock.calls[0][0].controls.dislikedItemIds).toEqual([]);
    expect(service.mock.calls[0][0].lens).toMatchObject({ forcedItemId: itemIds.top, occasion: "Relaxed dinner", constraints: {} });
    const child = (await GenerationSnapshot.findOne({ user: userId, requestId }).lean()) as Any;
    expect(child.variationSourceCandidateId).toBe("c0");
    expect((await (await mlRecommend(req(body), deps)).json()).shown[0].snapshotId).toBe(result.shown[0].snapshotId);
    expect(service).toHaveBeenCalledTimes(1);
    expect((await mlRecommend(req({ ...body, variation: { ...body.variation, leaveOutItemId: itemIds.b1 } }), deps)).status).toBe(409);
    for (const leaveOutItemId of [null, "", "bad"]) {
      expect((await mlRecommend(req({ ...body, requestId: uuid(), variation: { ...body.variation, leaveOutItemId } }), deps)).status).toBe(400);
    }
    expect(service).toHaveBeenCalledTimes(1);
    expect(await OutfitExperience.countDocuments({ user: userId })).toBe(0);
    expect(await OutfitInteraction.countDocuments({ user: userId })).toBe(0);
  });

  it("still rejects non-source anchors and shown output missing the anchor without an exclusion", async () => {
    const { sourceId } = await classSource();
    const body = { requestId: uuid(), parentSnapshotId: sourceId,
      variation: { sourceCandidateId: "c0", anchorItemId: itemIds.b2, occasion: "Dinner" } };
    const service = jest.fn(fakeService());
    expect((await mlRecommend(req(body), makeDeps({ callService: service }))).status).toBe(404);
    expect(service).not.toHaveBeenCalled();
    const result = await (await mlRecommend(req({ ...body, variation: { ...body.variation, anchorItemId: itemIds.b1 } }),
      makeDeps({ callService: service }))).json();
    expect(result.shown).toEqual([]);
    expect(result.flags.reasonHint).toBe("contract_invalid");
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(1);
  });

  it("explores an authoritative saved situation with different membership and replay identity", async () => {
    const { sourceId } = await classSource(" Class ", "Light rain, 16°C");
    const body = { requestId: uuid(), parentSnapshotId: sourceId,
      variation: { mode: "explore", sourceCandidateId: "c0", anchorItemId: itemIds.top, occasion: " Class " } };
    const service = jest.fn(fakeService({ respectControls: true }));
    const weather = jest.fn(async () => { throw new Error("exploration must use saved weather"); });
    const deps = makeDeps({ callService: service, resolveWeather: weather });
    const result = await (await mlRecommend(req(body), deps)).json();
    expect(result.shown.map((c: Any) => c.candidateId)).toEqual(["c1"]);
    const child = (await GenerationSnapshot.findOne({ user: userId, requestId: body.requestId }).lean()) as Any;
    expect(child.controls.excludedOutfitItemIds).toEqual([itemIds.top, itemIds.b1].sort());
    expect(child.occasion).toBe(" Class ");
    expect(child.variationSourceCandidateId).toBe("c0");
    expect(child.candidates.find((c: Any) => c.candidateId === "c0").shown).toBe(false);
    expect((await (await mlRecommend(req(body), deps)).json()).shown[0].snapshotId).toBe(result.shown[0].snapshotId);
    expect(service).toHaveBeenCalledTimes(1);
    expect(weather).not.toHaveBeenCalled();
    expect(service.mock.calls[0][0].lens.weatherRaw).toBe("Light rain, 16°C");
    const adaptationService = jest.fn(fakeService({ respectControls: true }));
    const adaptation = await mlRecommend(req({ ...body, requestId: uuid(), variation: { sourceCandidateId: "c0", anchorItemId: itemIds.top, occasion: "Dinner" } }),
      makeDeps({ callService: adaptationService, resolveWeather: async () => ({ weather: "cold", weatherRaw: "Clear, 8°C" }) }));
    expect(adaptation.status).toBe(200);
    expect(adaptationService.mock.calls[0][0].lens.weatherRaw).toBe("Clear, 8°C");
    expect((await mlRecommend(req({ ...body, variation: { ...body.variation, occasion: "Dinner" } }), deps)).status).toBe(400);
    const adapt = { sourceCandidateId: "c0", anchorItemId: itemIds.top, occasion: " Class " };
    expect((await mlRecommend(req({ ...body, variation: { ...adapt, occasion: "Dinner" } }), makeDeps())).status).toBe(409);
    expect((await mlRecommend(req({ requestId: uuid(), parentSnapshotId: String(child._id) }), deps)).status).toBe(400);
    expect((await mlRecommend(req({ ...body, controls: { excludedOutfitItemIds: [itemIds.top] } }), deps)).status).toBe(400);
    const malicious = await (await mlRecommend(req({ ...body, requestId: uuid() }), makeDeps())).json();
    expect(malicious.shown).toEqual([]); // An echoing but non-enforcing service is rejected.
    expect(malicious.flags.reasonHint).toBe("contract_invalid");
    expect(await OutfitInteraction.countDocuments({ user: userId })).toBe(0);
    expect(await OutfitExperience.countDocuments({ user: userId })).toBe(0);
  });

  it("allows adapting a shown source to its original occasion after a report-context correction", async () => {
    const { sourceId } = await classSource();
    const response = await mlRecommend(req({ requestId: uuid(), parentSnapshotId: sourceId,
      variation: { sourceCandidateId: "c0", anchorItemId: itemIds.top, occasion: "Class" } }),
      makeDeps({ callService: fakeService({ respectControls: true }) }));
    expect(response.status).toBe(200);
    expect((await response.json()).shown).toHaveLength(2);
  });

  it("builds a new-occasion proposal bound to one owned shown candidate and excludes the selected old piece", async () => {
    const { sourceId } = await classSource();
    const requestId = uuid();
    const body = { requestId, parentSnapshotId: sourceId, variation: variation("c0", itemIds.top, itemIds.b1) };
    const deps = makeDeps({ callService: fakeService({ respectControls: true, overridePayload: p => { p.candidateCacheKey = "b".repeat(64); } }) });
    const first = await mlRecommend(req(body), deps);
    expect(first.status).toBe(200);
    const result = await first.json();
    expect(result.flags.reasonHint).toBeNull();
    expect(result.shown.map((candidate: Any) => candidate.candidateId)).toEqual(["c1"]);
    expect(result.shown[0].displayItems.map((item: Any) => item.itemId)).toEqual([itemIds.top, itemIds.b2]);
    const child = (await GenerationSnapshot.findOne({ user: userId, requestId }).lean()) as Any;
    expect(child.occasion).toBe("Dinner");
    expect(child.intent).toBe("rescue_item");
    expect(child.forcedItemId).toBe(itemIds.top);
    expect(child.parentSnapshotId.toString()).toBe(sourceId);
    expect(child.variationSourceCandidateId).toBe("c0");
    expect(child.controls.dislikedItemIds).toEqual([itemIds.b1]);
    expect(child.candidateCacheKey).toBe("b".repeat(64));
    const replay = await mlRecommend(req(body), deps);
    expect(replay.status).toBe(200);
    expect((await replay.json()).shown[0].snapshotId).toBe(result.shown[0].snapshotId);
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(2);
    expect(await OutfitExperience.countDocuments({ user: userId })).toBe(0);
    expect(await OutfitInteraction.countDocuments({ user: userId })).toBe(0);
    const grandchild = await mlRecommend(req({ requestId: uuid(), parentSnapshotId: String(child._id),
      variation: variation("c1", itemIds.top, itemIds.b2, "Office lunch") }),
      makeDeps({ callService: fakeService({ respectControls: true }) }));
    expect(grandchild.status).toBe(200);
    expect((await grandchild.json()).shown[0].displayItems.map((item: Any) => item.itemId)).toEqual([itemIds.top, itemIds.b1]);
  });

  it("rejects unshown, foreign, contradictory and unavailable source controls before the service", async () => {
    const { sourceId } = await classSource();
    const original = await GenerationSnapshot.collection.findOne({ _id: new mongoose.Types.ObjectId(sourceId) });
    const foreignId = new mongoose.Types.ObjectId();
    await GenerationSnapshot.collection.insertOne({ ...original!, _id: foreignId, user: new mongoose.Types.ObjectId() });
    let called = false;
    const deps = makeDeps({ callService: async body => { called = true; return fakeService()(body); } });
    const invalid = [
      { parentSnapshotId: String(foreignId), variation: variation("c0", itemIds.top, itemIds.b1) },
      { parentSnapshotId: new mongoose.Types.ObjectId().toString(), variation: variation("c0", itemIds.top, itemIds.b1) },
      { parentSnapshotId: sourceId, variation: variation("never-shown", itemIds.top, itemIds.b1) },
      { parentSnapshotId: sourceId, variation: variation("c0", itemIds.top, itemIds.top) },
      { parentSnapshotId: sourceId, variation: variation("c0", itemIds.top, itemIds.b2) },
    ];
    for (const candidate of invalid) {
      const response = await mlRecommend(req({ requestId: uuid(), ...candidate }), deps);
      expect([400, 404]).toContain(response.status);
    }
    await WardrobeItem.updateOne({ _id: itemIds.b1 }, { $set: { isAvailable: false } });
    const unavailable = await mlRecommend(req({ requestId: uuid(), parentSnapshotId: sourceId,
      variation: variation("c0", itemIds.top, itemIds.b1) }), deps);
    expect(unavailable.status).toBe(400);
    expect((await unavailable.json()).error.code).toBe("control_item_unavailable");
    expect(called).toBe(false);
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(1);
  });

  it("rejects a service result that includes the explicitly avoided item instead of writing a false guarantee", async () => {
    const { sourceId } = await classSource();
    const response = await mlRecommend(req({ requestId: uuid(), parentSnapshotId: sourceId,
      variation: variation("c0", itemIds.top, itemIds.b1) }), makeDeps());
    expect((await response.json()).flags.reasonHint).toBe("contract_invalid");
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(1);
  });

  it("does not persist a proposal if its shown source is redacted while the service runs", async () => {
    const { sourceId } = await classSource();
    const deps = makeDeps({ callService: async body => {
      await GenerationSnapshot.updateOne({ _id: sourceId }, { $set: { redacted: true, redactedAt: new Date(), redactionReason: "test" } });
      return fakeService({ respectControls: true })(body);
    } });
    const response = await mlRecommend(req({ requestId: uuid(), parentSnapshotId: sourceId,
      variation: variation("c0", itemIds.top, itemIds.b1) }), deps);
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("variation_source_unavailable");
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(1);
  });
});

describe("R4 actual-outfit variation", () => {
  const store = new ExperienceStore({ now: () => new Date("2026-07-08T12:00:00Z") });
  async function reportedChange() {
    await mlRecommend(req({ requestId: uuid(), occasion: "Class", forcedItemId: itemIds.top }), makeDeps());
    const source = (await GenerationSnapshot.findOne({ user: userId }).lean()) as Any;
    const experienceId = uuid();
    await store.create(userId, { experienceId, operationId: uuid(), snapshotId: source._id.toString(), candidateId: "c0",
      occurredOn: "2026-07-07", timezone: "UTC", context: { kind: "user", text: "Class" }, outcome: "unknown",
      compositionStatus: "changed", memberItemIds: [itemIds.top, itemIds.b2] });
    return { experienceId, sourceId: source._id.toString() };
  }
  const actualVariation = (experienceId: string, anchorItemId: string, leaveOutItemId: string, expectedRevision = 1) =>
    ({ experienceId, expectedRevision, anchorItemId, leaveOutItemId, occasion: "Dinner" });

  it("adapts actual members without exclusion and rejects a stale revision before replay", async () => {
    const { experienceId } = await reportedChange();
    const body = { requestId: uuid(), actualVariation: { experienceId, expectedRevision: 1, anchorItemId: itemIds.top, occasion: "Dinner" } };
    const service = jest.fn(fakeService({ respectControls: true }));
    const deps = makeDeps({ callService: service });
    const first = await mlRecommend(req(body), deps);
    expect(first.status).toBe(200);
    expect((await first.json()).shown).toHaveLength(2);
    const child = (await GenerationSnapshot.findOne({ user: userId, requestId: body.requestId }).lean()) as Any;
    expect(child).toMatchObject({ variationSourceExperienceId: experienceId, variationSourceRevision: 1,
      forcedItemId: itemIds.top, controls: { dislikedItemIds: [] } });
    expect((await mlRecommend(req(body), deps)).status).toBe(200);
    await experienceCollection().updateOne({ user: new mongoose.Types.ObjectId(userId), experienceId }, { $set: { currentRevision: 2 } });
    expect((await mlRecommend(req(body), deps)).status).toBe(409);
    expect(service).toHaveBeenCalledTimes(1);
  });

  it("derives controls from the reported actual members, preserves the report, and safely replays", async () => {
    const { experienceId, sourceId } = await reportedChange();
    const requestId = uuid();
    const body = { requestId, actualVariation: actualVariation(experienceId, itemIds.top, itemIds.b2) };
    const deps = makeDeps({ callService: fakeService({ respectControls: true, overridePayload: p => { p.candidateCacheKey = "b".repeat(64); } }) });
    const response = await mlRecommend(req(body), deps);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.shown.map((candidate: Any) => candidate.displayItems.map((item: Any) => item.itemId))).toEqual([[itemIds.top, itemIds.b1]]);
    const child = (await GenerationSnapshot.findOne({ user: userId, requestId }).lean()) as Any;
    expect(child).toMatchObject({ variationSourceExperienceId: experienceId, variationSourceRevision: 1,
      forcedItemId: itemIds.top, controls: { dislikedItemIds: [itemIds.b2] }, occasion: "Dinner" });
    expect(child.parentSnapshotId.toString()).toBe(sourceId);
    expect((await experienceCollection().findOne({ user: new mongoose.Types.ObjectId(userId), experienceId }))!.memberItemIds!.map(String))
      .toEqual([itemIds.top, itemIds.b2]);
    const reroll = await mlRecommend(req({ requestId: uuid(), parentSnapshotId: String(child._id), controls: {} }), deps);
    expect(reroll.status).toBe(400);
    expect((await reroll.json()).error.code).toBe("variation_invalid");
    const shownAttempt = await mlRecommend(req({ requestId: uuid(), parentSnapshotId: String(child._id),
      variation: { sourceCandidateId: "c0", anchorItemId: itemIds.top, leaveOutItemId: itemIds.b1, occasion: "Office" } }),
      makeDeps({ callService: async () => { throw new Error("must not render report-bound shown variation"); } }));
    expect(shownAttempt.status).toBe(400);
    expect((await shownAttempt.json()).error.code).toBe("variation_invalid");
    const replay = await mlRecommend(req(body), deps);
    expect(replay.status).toBe(200);
    expect((await replay.json()).shown[0].snapshotId).toBe(result.shown[0].snapshotId);
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(2);
  });

  it("rejects forged source membership, stale revisions, foreign reports, and unavailable actual controls before render", async () => {
    const { experienceId } = await reportedChange();
    const render = jest.fn(fakeService({ respectControls: true }));
    const deps = makeDeps({ callService: render });
    const forged = await mlRecommend(req({ requestId: uuid(), actualVariation: actualVariation(experienceId, itemIds.top, itemIds.b1) }), deps);
    expect(forged.status).toBe(404);
    expect((await forged.json()).error.code).toBe("experience_source_unavailable");
    const stale = await mlRecommend(req({ requestId: uuid(), actualVariation: actualVariation(experienceId, itemIds.top, itemIds.b2, 2) }), deps);
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("experience_revision_conflict");
    const other = await User.create({ authProvider: "firebase", authId: uuid(), email: `${uuid()}@example.test` });
    const foreign = await mlRecommend(req({ requestId: uuid(), actualVariation: actualVariation(experienceId, itemIds.top, itemIds.b2) }),
      makeDeps({ verifyUser: async () => ({ userId: String(other._id) }), callService: render }));
    expect(foreign.status).toBe(404);
    await WardrobeItem.updateOne({ _id: itemIds.b2 }, { $set: { isAvailable: false } });
    const unavailable = await mlRecommend(req({ requestId: uuid(), actualVariation: actualVariation(experienceId, itemIds.top, itemIds.b2) }), deps);
    expect(unavailable.status).toBe(400);
    expect((await unavailable.json()).error.code).toBe("control_item_unavailable");
    expect(render).not.toHaveBeenCalled();
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(1);
  });

  it("uses changed-wear facts after shown-source redaction but rejects an in-flight correction", async () => {
    const { experienceId, sourceId } = await reportedChange();
    await GenerationSnapshot.collection.updateOne({ _id: new mongoose.Types.ObjectId(sourceId) },
      { $set: { redacted: true, redactedAt: new Date(), redactionReason: "test" } });
    const good = await mlRecommend(req({ requestId: uuid(), actualVariation: actualVariation(experienceId, itemIds.top, itemIds.b2) }),
      makeDeps({ callService: fakeService({ respectControls: true, overridePayload: p => { p.candidateCacheKey = "b".repeat(64); } }) }));
    expect(good.status).toBe(200);
    const raced = await mlRecommend(req({ requestId: uuid(), actualVariation: actualVariation(experienceId, itemIds.top, itemIds.b2) }),
      makeDeps({ callService: async body => {
        await store.revise(userId, experienceId, { operationId: uuid(), expectedPreviousRevision: 1,
          occurredOn: "2026-07-07", timezone: "UTC", context: { kind: "user", text: "Class" }, outcome: "worked",
          compositionStatus: "changed", memberItemIds: [itemIds.top, itemIds.b2] });
        return fakeService({ respectControls: true, overridePayload: p => { p.candidateCacheKey = "b".repeat(64); } })(body);
      } }));
    expect(raced.status).toBe(409);
    expect((await raced.json()).error.code).toBe("experience_revision_conflict");
    expect(await GenerationSnapshot.countDocuments({ user: userId, variationSourceExperienceId: experienceId, redacted: { $ne: true } })).toBe(0);
  });

  it.each(["revise", "erase"] as const)("rejects retries and parent reuse after interrupted %s, before service spend", async mutation => {
    const { experienceId } = await reportedChange();
    const requestId = uuid();
    const body = { requestId, actualVariation: actualVariation(experienceId, itemIds.top, itemIds.b2) };
    const deps = makeDeps({ callService: fakeService({ respectControls: true,
      overridePayload: p => { p.candidateCacheKey = "b".repeat(64); } }) });
    expect((await mlRecommend(req(body), deps)).status).toBe(200);
    const child = (await GenerationSnapshot.findOne({ user: userId, requestId }).lean()) as Any;
    const interrupted = new ExperienceStore({ now: () => new Date("2026-07-08T12:00:00Z"),
      afterNativeWrite: async operation => { if (operation === mutation) throw new Error("interrupted"); } });
    await expect(mutation === "erase" ? interrupted.erase(userId, experienceId) : interrupted.revise(userId, experienceId,
      { operationId: uuid(), expectedPreviousRevision: 1, occurredOn: "2026-07-07", timezone: "UTC",
        context: { kind: "user", text: "Class" }, outcome: "worked", compositionStatus: "changed",
        memberItemIds: [itemIds.top, itemIds.b2] })).rejects.toThrow("interrupted");
    expect(((await GenerationSnapshot.findOne({ _id: child._id }).lean()) as Any).redacted).not.toBe(true);
    const service = jest.fn(async () => { throw new Error("must not spend"); });
    const guarded = makeDeps({ callService: service });
    expect([404, 409]).toContain((await mlRecommend(req(body), guarded)).status);
    expect((await mlRecommend(req({ requestId: uuid(), parentSnapshotId: String(child._id), controls: {} }), guarded)).status).toBe(404);
    // Even a corrupted binding reused under an ordinary request cannot bypass early replay.
    await GenerationSnapshot.collection.updateOne({ _id: child._id }, { $set: { requestId: "11111111-1111-4111-8111-111111111111" } });
    expect((await mlRecommend(req({ requestId: "11111111-1111-4111-8111-111111111111", occasion: "Class" }), guarded)).status).toBe(404);
    expect(service).not.toHaveBeenCalled();
  });

  it("does not redact a current-revision proposal when an older correction acknowledgement is retried", async () => {
    const { experienceId } = await reportedChange();
    const edit = { operationId: uuid(), expectedPreviousRevision: 1,
      occurredOn: "2026-07-07", timezone: "UTC", context: { kind: "user", text: "Class" }, outcome: "worked",
      compositionStatus: "changed", memberItemIds: [itemIds.top, itemIds.b2] };
    await store.revise(userId, experienceId, edit);
    const requestId = uuid();
    const body = { requestId, actualVariation: actualVariation(experienceId, itemIds.top, itemIds.b2, 2) };
    const response = await mlRecommend(req(body), makeDeps({ callService: fakeService({ respectControls: true,
      overridePayload: p => { p.candidateCacheKey = "b".repeat(64); } }) }));
    expect(response.status).toBe(200);
    await store.revise(userId, experienceId, edit);
    expect(await GenerationSnapshot.countDocuments({ user: userId, requestId, redacted: { $ne: true } })).toBe(1);
  });

  it("does not replay a redacted proposal back into the browser", async () => {
    const { experienceId } = await reportedChange();
    const requestId = uuid();
    const body = { requestId, actualVariation: actualVariation(experienceId, itemIds.top, itemIds.b2) };
    const deps = makeDeps({ callService: fakeService({ respectControls: true,
      overridePayload: p => { p.candidateCacheKey = "b".repeat(64); } }) });
    expect((await mlRecommend(req(body), deps)).status).toBe(200);
    await GenerationSnapshot.collection.updateOne({ user: new mongoose.Types.ObjectId(userId), requestId },
      { $set: { redacted: true, redactedAt: new Date(), redactionReason: "test" } });
    const replay = await mlRecommend(req(body), deps);
    expect(replay.status).toBe(404);
    expect((await replay.json()).error.code).toBe("proposal_unavailable");
  });

  it("redacts a saved derivative when its wear report is erased", async () => {
    const { experienceId } = await reportedChange();
    const requestId = uuid();
    await mlRecommend(req({ requestId, actualVariation: actualVariation(experienceId, itemIds.top, itemIds.b2) }),
      makeDeps({ callService: fakeService({ respectControls: true, overridePayload: p => { p.candidateCacheKey = "b".repeat(64); } }) }));
    await store.erase(userId, experienceId);
    expect(await GenerationSnapshot.countDocuments({ user: userId, requestId, redacted: true })).toBe(1);
    const derivativeId = String(((await GenerationSnapshot.findOne({ user: userId, requestId }).lean()) as Any)._id);
    expect((await recentSuggestions(userId, itemIds.top)).suggestions.some(s => s.snapshotId === derivativeId)).toBe(false);
    const reroll = await mlRecommend(req({ requestId: uuid(), parentSnapshotId: derivativeId, controls: {} }), makeDeps());
    expect(reroll.status).toBe(404);
    expect((await reroll.json()).error.code).toBe("parent_not_found");
    expect(Object.keys((await experienceCollection().findOne({ user: new mongoose.Types.ObjectId(userId), experienceId }))!).sort())
      .toEqual(["_id", "experienceId", "lifecycle", "user"]);
    const retry = await mlRecommend(req({ requestId, actualVariation: actualVariation(experienceId, itemIds.top, itemIds.b2) }), makeDeps());
    expect(retry.status).toBe(404);
    expect((await retry.json()).error.code).toBe("experience_unavailable");
  });

  it.each(["correction", "retraction", "erasure"] as const)(
    "keeps a later confirmed wear recallable after %s redacts its proposal source", async action => {
      const { experienceId } = await reportedChange();
      const requestId = uuid();
      const proposal = await mlRecommend(req({ requestId, actualVariation: actualVariation(experienceId, itemIds.top, itemIds.b2) }),
        makeDeps({ callService: fakeService({ respectControls: true, overridePayload: p => { p.candidateCacheKey = "b".repeat(64); } }) }));
      expect(proposal.status).toBe(200);
      const shown = (await proposal.json()).shown[0];
      const laterId = uuid();
      await store.create(userId, { experienceId: laterId, operationId: uuid(), snapshotId: shown.snapshotId,
        candidateId: shown.candidateId, occurredOn: "2026-07-08", timezone: "UTC", context: { kind: "user", text: "Dinner" },
        outcome: "worked", compositionStatus: "as_shown" });
      if (action === "correction") await store.revise(userId, experienceId, { operationId: uuid(), expectedPreviousRevision: 1,
        occurredOn: "2026-07-07", timezone: "UTC", context: { kind: "user", text: "Class" }, outcome: "worked",
        compositionStatus: "changed", memberItemIds: [itemIds.top, itemIds.b2] });
      else if (action === "retraction") await store.retract(userId, experienceId, { operationId: uuid(), expectedPreviousRevision: 1 });
      else await store.erase(userId, experienceId);
      expect(await GenerationSnapshot.countDocuments({ user: userId, requestId, redacted: true })).toBe(1);
      const later = await getExperience(userId, laterId);
      expect(later).toMatchObject({ sourceAvailable: false, source: null,
        items: [{ itemId: itemIds.top, name: "White Tee" }, { itemId: itemIds.b1, name: "Blue Jeans" }],
        state: { occurredOn: "2026-07-08", context: { rawOccasion: "Dinner", source: "user", confirmed: true }, outcome: "worked" } });
      const recalled = await recallExperiences(userId, { itemId: itemIds.b1, context: "Dinner" });
      expect(recalled.experiences.map(row => row.experienceId)).toEqual([laterId]);
      expect((await recallExperiences(userId, { itemId: itemIds.b2, context: "Dinner" })).experiences).toEqual([]);
      expect((await recentSuggestions(userId, itemIds.top)).suggestions.some(s => s.snapshotId === shown.snapshotId)).toBe(false);
    });

  it("prevents an in-flight erase from writing a proposal and account deletion removes saved derivatives", async () => {
    const { experienceId } = await reportedChange();
    const erased = await mlRecommend(req({ requestId: uuid(), actualVariation: actualVariation(experienceId, itemIds.top, itemIds.b2) }),
      makeDeps({ callService: async body => {
        await store.erase(userId, experienceId);
        return fakeService({ respectControls: true, overridePayload: p => { p.candidateCacheKey = "b".repeat(64); } })(body);
      } }));
    expect(erased.status).toBe(409);
    expect(await GenerationSnapshot.countDocuments({ user: userId, variationSourceExperienceId: experienceId })).toBe(0);

    const another = await reportedChange();
    await mlRecommend(req({ requestId: uuid(), actualVariation: actualVariation(another.experienceId, itemIds.top, itemIds.b2) }),
      makeDeps({ callService: fakeService({ respectControls: true, overridePayload: p => { p.candidateCacheKey = "b".repeat(64); } }) }));
    expect(await GenerationSnapshot.countDocuments({ user: userId, variationSourceExperienceId: another.experienceId })).toBe(1);
    await User.deleteOne({ _id: userId });
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(0);
    expect(await experienceCollection().countDocuments({ user: new mongoose.Types.ObjectId(userId) })).toBe(0);
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
    // The LIVE render additionally carries the D1 slot census; the §C.4 replay reconstructs
    // flags from the stored doc — whose itemSnapshots is the SCOPED pool, no honest census
    // source — so it omits it (plan §4-D). Everything else round-trips identical.
    const { slotCensus: liveCensus, ...liveRest } = firstBody.flags;
    expect(liveCensus).toEqual({ top: 1, bottom: 2, dress: 0, outer_layer: 0, shoes: 1 });
    expect(secondBody.flags).toEqual(liveRest);
    expect(secondBody.flags).toEqual({
      notEnoughItems: false,
      insufficientAfterGeneration: true,
      spreadCollapsed: true,
      reasonHint: "try regenerating",
    });
  });

  it("a live render's flags carry the full 5-slot census (zeros included) of the closet", async () => {
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), makeDeps());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Any;
    // The fixture closet is 1 top / 2 bottoms / 1 shoes — dress + outer_layer report as explicit
    // zeros (the zeros ARE the census's point: "0 bottoms" is what the empty-state copy diagnoses).
    expect(body.flags.slotCensus).toEqual({ top: 1, bottom: 2, dress: 0, outer_layer: 0, shoes: 1 });
  });

  it("a re-roll carrying controls OMITS the census — a controls-caused empty must not be misdiagnosed", async () => {
    // The engine's "your locks and dislikes rule out every outfit" state rides notEnoughItems; a
    // census's fix-a-mislabel/add-a-piece remedy would be a false diagnosis there. Census defends
    // FIRST-render walls, which never carry controls (controls are re-roll-only — root_controls).
    const parent = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), makeDeps());
    const parentId = ((await parent.json()) as Any).shown[0].snapshotId;
    const res = await mlRecommend(
      req({
        requestId: uuid(),
        parentSnapshotId: parentId,
        controls: { lockedItemIds: [itemIds.top], dislikedItemIds: [] },
      }),
      makeDeps(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Any;
    expect(body.flags.slotCensus).toBeUndefined();
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

  it("concurrent duplicate requestId with DIFFERENT identity → one 200 winner + one 409, no wrong-render token", async () => {
    // The POST-write G5 arm (step 11's deduped-but-identity-mismatch 409): both calls pass the
    // step-5 early read-check before either write commits, so the loser discovers the conflict
    // only on its E11000 re-read. If this guard regressed, the loser would silently receive the
    // WINNER's outfits for a DIFFERENT occasion plus a binding token to the wrong render —
    // mislabeling the training corpus. (The sequential different-identity case above 409s at the
    // early check and never reaches this arm.)
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

    const [a, b] = await Promise.all([
      mlRecommend(req({ requestId: rid, occasion: "brunch" }), deps),
      mlRecommend(req({ requestId: rid, occasion: "a wedding" }), deps),
    ]);
    expect(arrivals).toBe(2); // both passed the early read-check → the post-write arm decided
    expect([a.status, b.status].sort()).toEqual([200, 409]); // write winner is nondeterministic

    const loser = a.status === 409 ? a : b;
    const winner = a.status === 409 ? b : a;
    const loserBody = (await loser.json()) as Any;
    expect(loserBody.error.code).toBe("request_id_conflict");
    expect(loserBody.shown).toBeUndefined(); // no outfits, no binding token for the loser
    expect(JSON.stringify(loserBody)).not.toContain("snapshotId");

    const winnerBody = (await winner.json()) as Any;
    expect(await GenerationSnapshot.countDocuments({ user: userId, requestId: rid })).toBe(1);
    const row = (await GenerationSnapshot.findOne({ user: userId, requestId: rid }).lean()) as Any;
    expect(winnerBody.shown[0].snapshotId).toBe(row._id.toString());
    // The stored render IS the winner's request, not a blend: its occasion matches the 200 arm.
    expect(row.occasion).toBe(a.status === 200 ? "brunch" : "a wedding");
  });
});

describe("degrade + reject arms (no write, snapshotId discarded)", () => {
  it("account deleted mid-render (erasure race, §23-H43) → no surviving snapshot, non-bindable degraded", async () => {
    // The account-deletion cascade runs while the render is in flight (after auth, before the
    // write): simulate by deleting the user inside the service call. The REAL cascade hook fires
    // (wardrobe/interactions/snapshots erased); the 11.5 post-persist check must then self-erase
    // the just-written row and refuse to hand back a binding token.
    const deps = makeDeps({
      callService: async (b: RenderBody) => {
        await User.deleteOne({ _id: userId });
        return fakeService()(b);
      },
    });
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), deps);
    const { status, body } = await json(res);
    expect(status).toBe(200);
    expect(body.bindable).toBe(false);
    expect(body.shown).toEqual([]);
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(0); // delete means delete
  });

  it("COMPOSED erasure race: the REAL DELETE /api/account completes while a render is parked in-flight → zero rows everywhere, non-bindable render", async () => {
    // The H43 guard pair has two halves — the writer-side post-persist User.exists self-erase
    // (step 11.5) and the route's phase-3 post-deletion sweep — and until now each was tested
    // against a hand-rolled stand-in of the other. This composes both REAL units on one schedule:
    // the render authenticates and parks inside callService; the full real route (phase-1
    // redaction → cascade → phase-3 sweep → Firebase delete) runs to completion; the render then
    // resumes, writes its snapshot for the now-dead user, and must self-erase + refuse a token.
    // HONEST LIMIT: the OTHER window — the write landing between the cascade's snapshot sweep and
    // the user row's death — has no injection seam between callService and the step-11 write, so
    // it cannot be composed with a real render; accountDeleteRoute.test.ts's hand-injected
    // phase-3 test remains that window's guard.
    const erasedPhoto = await WardrobeImage.create({
      user: userId, wardrobeItem: itemIds.top, base64: "aGk=", contentType: "image/jpeg",
      sizeBytes: 2, snapshotRetained: true, generationLeases: ["crash-leftover"],
    });
    await WardrobeItem.updateOne({ _id: itemIds.top }, { $set: { imagePath: `mongo:${erasedPhoto._id}` } });
    const { initDatabase } = jest.requireMock("@/lib/db") as { initDatabase: jest.Mock };
    initDatabase.mockResolvedValue({ User, WardrobeItem, WardrobeImage, OutfitInteraction, GenerationSnapshot });
    const { adminAuth } = jest.requireMock("@/lib/firebaseAdmin") as {
      adminAuth: { verifyIdToken: jest.Mock; deleteUser: jest.Mock };
    };
    adminAuth.verifyIdToken.mockResolvedValue({ uid: "uid-test" }); // the beforeEach user's authId
    adminAuth.deleteUser.mockResolvedValue(undefined);

    let parked!: () => void;
    const renderParked = new Promise<void>((r) => { parked = r; });
    let release!: () => void;
    const releaseGate = new Promise<void>((r) => { release = r; });
    const deps = makeDeps({
      callService: async (b) => {
        parked();
        await releaseGate;
        return fakeService()(b);
      },
    });

    const renderPromise = mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), deps);
    await renderParked; // the render is authed + in-flight, pre-write

    const { DELETE } = await import("@/app/api/account/route");
    const delRes = await DELETE({
      headers: { get: (h: string) => (h.toLowerCase() === "authorization" ? "Bearer fake" : null) },
    } as Any);
    expect(delRes.status).toBe(200);
    expect(adminAuth.deleteUser).toHaveBeenCalledWith("uid-test");

    release();
    const { status, body } = await json(await renderPromise);
    expect(status).toBe(200);
    expect(body.bindable).toBe(false); // no binding token for an erased account
    expect(body.shown).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("snapshotId");

    // Erasure holds across EVERY cascade collection — the composed promise, not one half of it.
    expect(await User.findById(userId)).toBeNull();
    expect(await WardrobeItem.countDocuments({ user: userId })).toBe(0);
    expect(await WardrobeImage.countDocuments({ user: userId })).toBe(0);
    expect(await OutfitInteraction.countDocuments({ user: userId })).toBe(0);
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(0);
  });

  it("per-user render ceiling tripped → 200 rate_limited degraded, no service call, no snapshot", async () => {
    // allowRender is the per-user bound over the service's GLOBAL bucket; a denied render must
    // degrade (the dashboard keeps current outfits + shows try-again copy), never 5xx or spend.
    // It sits AFTER the §C.4 replay check, so a denied FRESH render reaches here but never spends.
    let serviceCalled = false;
    const deps = makeDeps({
      allowRender: () => false,
      callService: async (body) => {
        serviceCalled = true;
        return fakeService()(body);
      },
    });
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), deps);
    const { status, body } = await json(res);
    expect(status).toBe(200);
    expect(body.bindable).toBe(false);
    expect(body.shown).toEqual([]);
    expect(body.flags.reasonHint).toBe("rate_limited");
    expect(serviceCalled).toBe(false); // denied BEFORE the service call — no spend
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(0);
  });

  it("a rate-limited RETRY of an already-persisted requestId still replays the winner (replay beats limiter)", async () => {
    // The F10 resume re-sends the same requestId after a dropped response; the replay is one
    // Mongo read and zero spend, so the per-user ceiling must not forfeit an already-paid render.
    const requestId = uuid();
    const first = await mlRecommend(req({ requestId, occasion: "brunch" }), makeDeps());
    expect((await json(first)).body.bindable).toBe(true);

    const retry = await mlRecommend(
      req({ requestId, occasion: "brunch" }),
      makeDeps({ allowRender: () => false }),
    );
    const { status, body } = await json(retry);
    expect(status).toBe(200);
    expect(body.bindable).toBe(true); // the replayed winner, NOT a rate_limited degrade
    expect(body.shown.length).toBeGreaterThan(0);
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(1); // no second write
  });

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

  it.each(["mid", "base"])("two top pins require explicit mid eligibility (%s)", async (layerRole) => {
    const knit = await WardrobeItem.create({ user: userId, name: "Sweater", clothingType: "top", warmth: 5,
      category: "top", layerRole, isAvailable: true });
    const first = await mlRecommend(req({ requestId: uuid(), occasion: "brunch" }), makeDeps());
    await first.json();
    const parentId = ((await GenerationSnapshot.findOne({ user: userId }).lean()) as Any)._id.toString();
    let called = false;
    const deps = makeDeps({ callService: async (b) => { called = true; return fakeService()(b); } });
    const response = await mlRecommend(req({ requestId: uuid(), parentSnapshotId: parentId,
      controls: { lockedItemIds: [itemIds.top, String(knit._id)], dislikedItemIds: [] } }), deps);
    if (layerRole === "mid") {
      expect(called).toBe(true);
      expect((await response.json()).error?.code).not.toBe("controls_structurally_infeasible");
    } else {
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("controls_structurally_infeasible");
      expect(called).toBe(false);
    }
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


describe("captured weather context replay", () => {
  it("replays automatic same-bucket weather refreshes using the original saved summary", async () => {
    const requestId = uuid(); let raw = "Light rain, 16°C"; let calls = 0;
    const deps = makeDeps({ resolveWeather: async () => ({ weather: "mild", weatherRaw: raw }),
      callService: async body => { calls++; return fakeService()(body); } });
    await mlRecommend(req({ requestId, occasion: "brunch" }), deps);
    raw = "Clear, 18°C";
    const result = await mlRecommend(req({ requestId, occasion: "brunch" }), deps);
    expect(result.status).toBe(200); expect(calls).toBe(1);
    expect((await GenerationSnapshot.findOne({ user: userId, requestId }).lean() as Any).weatherRaw).toBe("Light rain, 16°C");
  });
  it("conflicts on changed explicitly frozen raw context and replays equal context", async () => {
    const requestId = uuid();
    const deps = makeDeps({ resolveWeather: async input => ({ weather: "mild", weatherRaw: typeof input.weatherRaw === "string" ? input.weatherRaw : null }) });
    const command = { requestId, occasion: "brunch", weather: "mild", weatherRaw: "Light rain" };
    expect((await mlRecommend(req(command), deps)).status).toBe(200);
    expect((await mlRecommend(req(command), deps)).status).toBe(200);
    expect((await mlRecommend(req({ ...command, weatherRaw: "Clear" }), deps)).status).toBe(409);
    expect((await mlRecommend(req({ ...command, weatherRaw: {} }), deps)).status).toBe(400);
    const blank = { ...command, requestId: uuid(), weatherRaw: null };
    expect((await mlRecommend(req(blank), deps)).status).toBe(200);
    expect((await mlRecommend(req({ ...blank, weatherRaw: "" }), deps)).status).toBe(200);
    expect((await mlRecommend(req({ ...blank, weatherRaw: "Rain" }), deps)).status).toBe(409);
  });
  it.each([false, true])("checks captured weather after concurrent writes (explicit=%s)", async explicit => {
    const requestId = uuid(); let arrivals = 0; let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const deps = makeDeps({ resolveWeather: async input => ({ weather: "mild", weatherRaw: String(input.weatherRaw) }),
      callService: async body => { if (++arrivals === 2) release(); await barrier; return fakeService()(body); } });
    const command = { requestId, occasion: "brunch", ...(explicit ? { weather: "mild" } : {}) };
    const responses = await Promise.all([mlRecommend(req({ ...command, weatherRaw: "Rain" }), deps), mlRecommend(req({ ...command, weatherRaw: "Clear" }), deps)]);
    expect(responses.map(response => response.status).sort()).toEqual(explicit ? [200, 409] : [200, 200]);
    expect(await GenerationSnapshot.countDocuments({ user: userId, requestId })).toBe(1);
    if (!explicit) {
      const bodies = await Promise.all(responses.map(response => response.json()));
      expect(bodies[0].shown[0].snapshotId).toBe(bodies[1].shown[0].snapshotId);
    }
  });
});


describe("R14 atomic photo retention across generation", () => {
  async function photo(itemId = itemIds.top, owner = userId) {
    const image = await WardrobeImage.create({ user: owner, wardrobeItem: itemId,
      base64: "exact-old-pixels", contentType: "image/png", sizeBytes: 16 });
    await WardrobeItem.updateOne({ _id: itemId }, { $set: { imagePath: `mongo:${image._id}` } });
    return image;
  }
  function authedRoutes() {
    jest.requireMock("@/lib/db").initDatabase.mockResolvedValue({
      User, WardrobeItem, WardrobeImage, OutfitInteraction, GenerationSnapshot,
    });
    jest.requireMock("@/lib/firebaseAdmin").adminAuth.verifyIdToken.mockResolvedValue({ uid: "uid-test" });
    return { headers: { get: (h: string) => h === "authorization" ? "Bearer fake" : null } } as Any;
  }
  function parkedRender(over: Partial<MlRecommendDeps> = {}, requestId = uuid()) {
    let parked!: () => void;
    const ready = new Promise<void>(resolve => { parked = resolve; });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const run = mlRecommend(req({ requestId, occasion: "class" }), makeDeps({ ...over,
      callService: async body => { parked(); await gate; return (over.callService ?? fakeService())(body); },
    }));
    return { ready, release, run };
  }
  async function destructive(action: string) {
    const request = authedRoutes();
    if (action === "replace") {
      const form = new FormData();
      form.append("file", new File([new Uint8Array([0x89,0x50,0x4e,0x47,13,10,26,10])], "new.png", { type: "image/png" }));
      request.formData = async () => form;
      const { POST } = await import("@/app/api/wardrobe/[id]/image/route");
      return POST(request, { params: Promise.resolve({ id: itemIds.top }) });
    }
    if (action === "delete") {
      const { DELETE } = await import("@/app/api/wardrobe/[id]/route");
      return DELETE(request, { params: Promise.resolve({ id: itemIds.top }) });
    }
    const { DELETE } = await import("@/app/api/wardrobe/clear/route");
    return DELETE(request);
  }
  it.each(["replace", "delete", "clear"])("retains exact captured bytes through %s during paused render", async action => {
    const old = await photo();
    const render = parkedRender();
    await render.ready;
    expect((await WardrobeImage.findById(old._id).lean<Any>()).generationLeases).toHaveLength(1);
    expect((await destructive(action)).status).toBe(200);
    expect((await WardrobeImage.findById(old._id).lean<Any>()).base64).toBe("exact-old-pixels");
    render.release();
    expect((await json(await render.run)).body.bindable).toBe(true);
    const stored = await GenerationSnapshot.findOne({ user: userId }).lean<Any>();
    expect(stored.itemSnapshots.find((item: Any) => item.itemId === itemIds.top).evidence.image.imageRef).toBe(`mongo:${old._id}`);
    expect(stored.itemSnapshots.find((item: Any) => item.itemId === itemIds.top).engineVisible.imageUrl).toBe(`/api/images/${old._id}`);
    const retained = await WardrobeImage.findById(old._id).lean<Any>();
    expect(retained).toMatchObject({ base64: "exact-old-pixels", snapshotRetained: true, generationLeases: [] });
  });
  it.each(["replace", "delete", "clear"])("reclaims superseded bytes after service failure and %s", async action => {
    const old = await photo();
    const render = parkedRender({ callService: fakeService({ fail: { ok: false, reasonHint: "service_unavailable" } }) });
    await render.ready;
    expect((await destructive(action)).status).toBe(200);
    render.release();
    expect((await json(await render.run)).body.bindable).toBe(false);
    expect(await WardrobeImage.findById(old._id)).toBeNull();
  });
  it("omits evidence and engine URL if photo deletion wins before atomic acquisition", async () => {
    const old = await photo();
    // Capture the old wardrobe, then delete the item+photo at the acquisition boundary.
    const update = WardrobeImage.updateOne.bind(WardrobeImage);
    const pin = jest.spyOn(WardrobeImage, "updateOne").mockImplementationOnce(((...args: Any[]) => ({ exec: async () => {
      expect((await destructive("delete")).status).toBe(200);
      return update(...args as [Any, Any]).exec();
    } })) as Any);
    try {
      expect((await json(await mlRecommend(req({ requestId: uuid(), occasion: "class" }), makeDeps()))).body.bindable).toBe(true);
    } finally { pin.mockRestore(); }
    expect(await WardrobeImage.findById(old._id)).toBeNull();
    const item = (await GenerationSnapshot.findOne({ user: userId }).lean<Any>()).itemSnapshots.find((i: Any) => i.itemId === itemIds.top);
    expect(item.evidence.image).toBeUndefined();
    expect(item.engineVisible.imageUrl).toBe("");
  });
  it("does not retain a foreign owner's exact image reference", async () => {
    const other = await User.create({ authProvider: "firebase", authId: "foreign", email: "foreign@example.com" });
    const old = await photo(itemIds.top, other._id.toString());
    await mlRecommend(req({ requestId: uuid(), occasion: "class" }), makeDeps());
    const item = (await GenerationSnapshot.findOne({ user: userId }).lean<Any>()).itemSnapshots.find((i: Any) => i.itemId === itemIds.top);
    expect(item.evidence.image).toBeUndefined();
    expect(item.engineVisible.imageUrl).toBe("");
    expect((await WardrobeImage.findById(old._id).lean<Any>())).toMatchObject({ snapshotRetained: false, generationLeases: [] });
  });
  it("one failed invocation cannot release another invocation's pin", async () => {
    const old = await photo();
    const failing = parkedRender({ callService: fakeService({ fail: { ok: false, reasonHint: "service_unavailable" } }) });
    const successful = parkedRender();
    await Promise.all([failing.ready, successful.ready]);
    expect((await WardrobeImage.findById(old._id).lean<Any>()).generationLeases).toHaveLength(2);
    expect((await destructive("delete")).status).toBe(200);
    failing.release(); await failing.run;
    expect((await WardrobeImage.findById(old._id).lean<Any>()).generationLeases).toHaveLength(1);
    successful.release(); await successful.run;
    expect((await WardrobeImage.findById(old._id).lean<Any>())).toMatchObject({ snapshotRetained: true, generationLeases: [] });
  });
  it("ambiguous write failure conservatively keeps pins without a visible snapshot", async () => {
    const old = await photo();
    const create = jest.spyOn(GenerationSnapshot, "create").mockRejectedValueOnce(new Error("transport timed out before server result") as never);
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await json(await mlRecommend(req({ requestId: uuid(), occasion: "class" }), makeDeps()))).body.bindable).toBe(false);
      expect((await WardrobeImage.findById(old._id).lean<Any>()).generationLeases).toHaveLength(1);
      expect((await destructive("delete")).status).toBe(200);
      expect(await WardrobeImage.findById(old._id)).not.toBeNull();
      expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(0);
    } finally { create.mockRestore(); log.mockRestore(); }
  });
  it("promotes actual refs when transaction committed but its acknowledgement failed", async () => {
    const old = await photo();
    const session = await User.db.startSession();
    const transaction = session.withTransaction.bind(session);
    session.withTransaction = (async (...args: Any[]) => {
      await transaction(...args as [Any, Any]); throw new Error("lost acknowledgement");
    }) as Any;
    const startSession = jest.spyOn(User.db, "startSession").mockResolvedValueOnce(session);
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      await mlRecommend(req({ requestId: uuid(), occasion: "class" }), makeDeps());
      expect((await WardrobeImage.findById(old._id).lean<Any>())).toMatchObject({ snapshotRetained: true, generationLeases: [] });
    } finally { startSession.mockRestore(); log.mockRestore(); }
  });
  it("successful commit with failed transfer leaves the durable lease for exact pixels", async () => {
    const old = await photo();
    const realUpdate = WardrobeImage.updateOne.bind(WardrobeImage);
    const update = jest.spyOn(WardrobeImage, "updateOne").mockImplementation(((filter: Any, operation: Any) => {
      if (operation.$pull) return { exec: async () => { throw new Error("database unavailable during transfer"); } };
      return realUpdate(filter, operation);
    }) as Any);
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await json(await mlRecommend(req({ requestId: uuid(), occasion: "class" }), makeDeps()))).body.bindable).toBe(true);
      expect((await WardrobeImage.findById(old._id).lean<Any>()).generationLeases).toHaveLength(1);
      expect((await destructive("delete")).status).toBe(200);
      expect(await WardrobeImage.findById(old._id)).not.toBeNull();
    } finally { update.mockRestore(); log.mockRestore(); }
  });
  it("idempotent loser releases only its unused replacement photo", async () => {
    const old = await photo();
    const requestId = uuid();
    const winner = parkedRender({}, requestId);
    await winner.ready;
    expect((await destructive("replace")).status).toBe(200);
    const current = (await WardrobeItem.findById(itemIds.top).lean<Any>()).imagePath;
    const loser = parkedRender({}, requestId);
    await loser.ready;
    winner.release(); const winningBody = (await json(await winner.run)).body;
    expect((await destructive("delete")).status).toBe(200);
    loser.release(); const losingBody = (await json(await loser.run)).body;
    expect(losingBody.shown[0].snapshotId).toBe(winningBody.shown[0].snapshotId);
    expect(await GenerationSnapshot.countDocuments({ user: userId, requestId })).toBe(1);
    expect(await WardrobeImage.findById(current.slice(6))).toBeNull();
    expect((await WardrobeImage.findById(old._id).lean<Any>())).toMatchObject({ snapshotRetained: true, generationLeases: [] });
  });
  it("an unused leased pool image is reclaimed after successful snapshot persistence", async () => {
    const unused = await photo(itemIds.shoes);
    const render = parkedRender(); await render.ready;
    const { DELETE } = await import("@/app/api/wardrobe/[id]/route");
    expect((await DELETE(authedRoutes(), { params: Promise.resolve({ id: itemIds.shoes }) })).status).toBe(200);
    render.release(); expect((await json(await render.run)).body.bindable).toBe(true);
    expect(await WardrobeImage.findById(unused._id)).toBeNull();
  });
  it("a URL-only current garment keeps its bytes after a failed render", async () => {
    const image = await photo();
    await WardrobeItem.updateOne({ _id: itemIds.top }, {
      $unset: { imagePath: "" }, $set: { imageUrl: `/api/images/${image._id}` },
    });
    await mlRecommend(req({ requestId: uuid(), occasion: "class" }), makeDeps({
      callService: fakeService({ fail: { ok: false, reasonHint: "service_unavailable" } }),
    }));
    expect((await WardrobeImage.findById(image._id).lean<Any>())).toMatchObject({ generationLeases: [], snapshotRetained: false });
  });
  it("URL-only exact owned photo captures canonical evidence and survives clear during render", async () => {
    const image = await photo();
    await WardrobeItem.updateOne({ _id: itemIds.top }, {
      $unset: { imagePath: "" }, $set: { imageUrl: `/api/images/${image._id}` },
    });
    const render = parkedRender(); await render.ready;
    expect((await destructive("clear")).status).toBe(200);
    render.release(); expect((await json(await render.run)).body.bindable).toBe(true);
    const item = (await GenerationSnapshot.findOne({ user: userId }).lean<Any>()).itemSnapshots.find((i: Any) => i.itemId === itemIds.top);
    expect(item.evidence.image.imageRef).toBe(`mongo:${image._id}`);
    expect(item.engineVisible.imageUrl).toBe(`/api/images/${image._id}`);
    expect((await WardrobeImage.findById(image._id).lean<Any>())).toMatchObject({ snapshotRetained: true, generationLeases: [] });
  });
  it("historic engine URL-only snapshot protects exact bytes without modern flags", async () => {
    const image = await photo();
    await GenerationSnapshot.collection.insertOne({ user: new mongoose.Types.ObjectId(userId),
      itemSnapshots: [{ engineVisible: { imageUrl: `/api/images/${image._id}` } }],
    });
    expect((await destructive("clear")).status).toBe(200);
    expect(await WardrobeImage.findById(image._id)).not.toBeNull();
  });
  it("malformed local URLs are omitted while external photo URLs remain ordinary evidence", async () => {
    await WardrobeItem.updateOne({ _id: itemIds.top }, { $set: { imageUrl: "/api/images/not-an-id", imagePath: "mongo:bad" } });
    await WardrobeItem.updateOne({ _id: itemIds.b1 }, { $set: { imageUrl: "https://example.com/photo.png" } });
    await mlRecommend(req({ requestId: uuid(), occasion: "class" }), makeDeps());
    const snapshot = await GenerationSnapshot.findOne({ user: userId }).lean<Any>();
    const top = snapshot.itemSnapshots.find((i: Any) => i.itemId === itemIds.top);
    expect(top.evidence.image).toBeUndefined(); expect(top.engineVisible.imageUrl).toBe("");
    expect(snapshot.itemSnapshots.find((i: Any) => i.itemId === itemIds.b1).engineVisible.imageUrl).toBe("https://example.com/photo.png");
  });

});


describe("R15 durable manual weather", () => {
  const manual = () => ({ requestId: uuid(), occasion: "Class tomorrow", weatherSource: "manual",
    weather: "cold", weatherRaw: " Rain and wind, 8°C " });

  it.each([false, true])("captures manual root conditions/source in real Mongo and the prompt (rescue=%s)", async rescue => {
    const automatic = jest.fn(async (): Promise<WeatherResolution> => ({ weather: "hot", weatherRaw: "Clear", weatherSource: "current" }));
    const service = jest.fn(fakeService());
    const command = { ...manual(), ...(rescue ? { forcedItemId: itemIds.top } : {}), lat: 40, lon: -74 };
    const deps = makeDeps({ resolveWeather: automatic, callService: service });
    const response = await mlRecommend(req(command), deps);
    expect(response.status).toBe(200);
    expect((await response.json()).weatherSource).toBe("manual");
    const row = await GenerationSnapshot.findOne({ user: userId, requestId: command.requestId }).lean() as Any;
    expect(row.weatherSource).toBe("manual"); expect(row.weather).toBe("cold");
    expect(row.weatherRaw).toBe(command.weatherRaw);
    expect(service.mock.calls[0][0].lens.weatherRaw).toBe(command.weatherRaw);
    expect(automatic).not.toHaveBeenCalled();
    expect((await mlRecommend(req(command), deps)).status).toBe(200);
    expect((await mlRecommend(req({ ...command, weatherRaw: "Snow, 8°C" }), deps)).status).toBe(409);
    expect(service).toHaveBeenCalledTimes(1);
    expect(await OutfitInteraction.countDocuments({ user: userId })).toBe(0);
    expect(await OutfitExperience.countDocuments({ user: userId })).toBe(0);
  });

  it("requires manual source identity both when replacing automatic and when dropping manual", async () => {
    const deps = makeDeps({ resolveWeather: async () => ({ weather: "cold", weatherRaw: "Rain", weatherSource: "forecast" }) });
    const command = { ...manual(), weatherRaw: "Rain" };
    expect((await mlRecommend(req(command), deps)).status).toBe(200);
    const { weatherSource: _source, ...automatic } = command;
    void _source;
    expect((await mlRecommend(req(automatic), deps)).status).toBe(409);
    const automaticFirst = { ...automatic, requestId: uuid() };
    expect((await mlRecommend(req(automaticFirst), deps)).status).toBe(200);
    expect((await mlRecommend(req({ ...automaticFirst, weatherSource: "manual" }), deps)).status).toBe(409);
  });

  it("preserves manual source on re-roll/explore and conservatively projects legacy missing provenance", async () => {
    const command = { ...manual(), forcedItemId: itemIds.top };
    const deps = makeDeps({ callService: fakeService({ respectControls: true }) });
    const source = await (await mlRecommend(req(command), deps)).json();
    const parentSnapshotId = source.shown[0].snapshotId;
    const reroll = { requestId: uuid(), parentSnapshotId };
    const child = await (await mlRecommend(req(reroll), deps)).json();
    expect(child.weatherSource).toBe("manual");
    const explore = { requestId: uuid(), parentSnapshotId, variation: { mode: "explore", sourceCandidateId: "c0",
      anchorItemId: itemIds.top, occasion: command.occasion } };
    const explored = await (await mlRecommend(req(explore), deps)).json();
    expect(explored.weatherSource).toBe("manual");
    const rows = await GenerationSnapshot.find({ user: userId }).lean() as Any[];
    expect(rows).toHaveLength(3);
    expect(rows.every(row => row.weatherSource === "manual" && row.weatherRaw === command.weatherRaw)).toBe(true);
    // Native insertion represents a historical row; do not mutate the immutable current snapshot.
    const historical = { ...rows.find(row => String(row._id) === parentSnapshotId), _id: new mongoose.Types.ObjectId(), requestId: uuid() };
    delete historical.weatherSource;
    await GenerationSnapshot.collection.insertOne(historical);
    const legacy = await (await mlRecommend(req({ requestId: uuid(), parentSnapshotId: String(historical._id) }), deps)).json();
    expect(legacy.weatherSource).toBe("unknown");
  });

  it.each([
    { weather: "rainy" }, { weather: undefined }, { weatherRaw: 5 }, { weatherRaw: "x".repeat(121) },
    { weatherRaw: "Rain\nwind" }, { weatherRaw: "\ud800" }, { weatherSource: "forecast" },
  ])("rejects malformed input without service spend or writes %j", async patch => {
    const service = jest.fn(fakeService());
    const response = await mlRecommend(req({ ...manual(), ...patch }), makeDeps({ callService: service }));
    expect(response.status).toBe(400); expect(service).not.toHaveBeenCalled();
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(0);
  });

  it("rejects the manual control on child requests and binds absent manual details as null", async () => {
    const command = { ...manual(), weatherRaw: null };
    const deps = makeDeps();
    const source = await (await mlRecommend(req(command), deps)).json();
    expect((await mlRecommend(req({ requestId: uuid(), parentSnapshotId: source.shown[0].snapshotId,
      weatherSource: "manual", weather: "cold" }), deps)).status).toBe(400);
    expect((await mlRecommend(req({ ...command, weatherRaw: "" }), deps)).status).toBe(200);
    expect((await mlRecommend(req({ ...command, weatherRaw: "rain" }), deps)).status).toBe(409);
  });

  it.each(["raw", "source"])("checks manual %s identity after a real concurrent duplicate-key write", async changed => {
    let arrivals = 0; let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const deps = makeDeps({ resolveWeather: async () => ({ weather: "cold", weatherRaw: " Rain and wind, 8°C ", weatherSource: "forecast" }),
      callService: async body => { if (++arrivals === 2) release(); await barrier; return fakeService()(body); } });
    const first = manual();
    const second = { ...first, ...(changed === "raw" ? { weatherRaw: "snow" } : { weatherSource: undefined }) };
    const results = await Promise.all([mlRecommend(req(first), deps), mlRecommend(req(second), deps)]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect(await GenerationSnapshot.countDocuments({ user: userId, requestId: first.requestId })).toBe(1);
  });

  it("keeps automatic cross-bucket retry conflicts while same-bucket summaries replay", async () => {
    let weather: "mild" | "cold" = "mild";
    const deps = makeDeps({ resolveWeather: async () => ({ weather, weatherRaw: "Forecast", weatherSource: "forecast" }) });
    const command = { requestId: uuid(), occasion: "Class" };
    expect((await mlRecommend(req(command), deps)).status).toBe(200);
    weather = "cold";
    expect((await mlRecommend(req(command), deps)).status).toBe(409);
  });
});


describe("R16 durable positive weather signals", () => {
  const command = () => ({ requestId: uuid(), occasion: "Class", weatherSource: "manual", weather: "mild",
    weatherRaw: "Expected wet and windy", weatherSignals: { rain: true, wind: true } });
  it("persists server-captured signals with exact manual replay/conflicts, saved return and source inheritance", async () => {
    const service = jest.fn(fakeService({ respectControls: true }));
    const deps = makeDeps({ callService: service });
    const root = { ...command(), forcedItemId: itemIds.top };
    const response = await (await mlRecommend(req(root), deps)).json();
    expect(response.weatherSignals).toEqual(root.weatherSignals);
    const snapshotId = response.shown[0].snapshotId;
    expect((await GenerationSnapshot.findById(snapshotId).lean<Any>()).weatherSignals).toEqual(root.weatherSignals);
    expect(service.mock.calls[0][0].lens.weatherSignals).toEqual(root.weatherSignals);
    expect(await getSuggestion(userId, snapshotId, "c0")).toMatchObject({ weatherSignals: root.weatherSignals });
    expect((await mlRecommend(req(root), deps)).status).toBe(200);
    expect((await mlRecommend(req({ ...root, weatherSignals: { rain: true, wind: false } }), deps)).status).toBe(409);
    expect((await mlRecommend(req({ ...root, weatherSignals: undefined }), deps)).status).toBe(409);
    const reroll = await (await mlRecommend(req({ requestId: uuid(), parentSnapshotId: snapshotId }), deps)).json();
    const explored = await (await mlRecommend(req({ requestId: uuid(), parentSnapshotId: snapshotId,
      variation: { mode: "explore", sourceCandidateId: "c0", anchorItemId: itemIds.top, occasion: root.occasion } }), deps)).json();
    expect(reroll.weatherSignals).toEqual(root.weatherSignals); expect(explored.weatherSignals).toEqual(root.weatherSignals);
    expect(service.mock.calls.every(([body]) => JSON.stringify(body.lens.weatherSignals) === JSON.stringify(root.weatherSignals))).toBe(true);
    expect(await OutfitInteraction.countDocuments()).toBe(0); expect(await OutfitExperience.countDocuments()).toBe(0);
    const other = await User.create({ authProvider: "firebase", authId: "other-r16", email: "other@example.com" });
    await expect(getSuggestion(String(other._id), snapshotId, "c0")).rejects.toMatchObject({ status: 404 });
    expect((await mlRecommend(req({ requestId: uuid(), parentSnapshotId: snapshotId }), makeDeps({ verifyUser: async () => ({ userId: String(other._id) }) }))).status).toBe(404);
  });
  it("does not infer signals from arbitrary manual text or legacy saved context", async () => {
    const service = jest.fn(fakeService()); const deps = makeDeps({ callService: service });
    const root = { ...command(), weatherSignals: undefined, weatherRaw: "Rain and windy" };
    const result = await (await mlRecommend(req(root), deps)).json();
    expect(result).not.toHaveProperty("weatherSignals");
    const child = await (await mlRecommend(req({ requestId: uuid(), parentSnapshotId: result.shown[0].snapshotId }), deps)).json();
    expect(child).not.toHaveProperty("weatherSignals");
    expect(service.mock.calls.every(([body]) => body.lens.weatherSignals === undefined)).toBe(true);
  });
  it("same-bucket automatic retries replay the first captured signals without new service spend", async () => {
    let weatherSignals = { rain: true, wind: false };
    const service = jest.fn(fakeService());
    const deps = makeDeps({ callService: service, resolveWeather: async () => ({ weather: "mild", weatherRaw: "Forecast", weatherSource: "forecast", weatherSignals }) });
    const root = { requestId: uuid(), occasion: "Class" };
    const first = await (await mlRecommend(req(root), deps)).json();
    weatherSignals = { rain: false, wind: true };
    const retry = await (await mlRecommend(req(root), deps)).json();
    expect(retry.shown).toEqual(first.shown); expect(retry.weatherSignals).toEqual({ rain: true, wind: false }); expect(service).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, { rain: true }, { rain: 1, wind: false }, { rain: true, wind: false, extra: true }, []])("rejects malformed signals %j before spend", async weatherSignals => {
    const service = jest.fn(fakeService());
    expect((await mlRecommend(req({ ...command(), weatherSignals }), makeDeps({ callService: service }))).status).toBe(400);
    expect(service).not.toHaveBeenCalled(); expect(await GenerationSnapshot.countDocuments()).toBe(0);
  });
  it("checks changed signal identity after concurrent duplicate-key reconciliation", async () => {
    let arrivals = 0; let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
    const deps = makeDeps({ callService: async body => { if (++arrivals === 2) release(); await barrier; return fakeService()(body); } });
    const first = command();
    const results = await Promise.all([mlRecommend(req(first), deps), mlRecommend(req({ ...first, weatherSignals: { rain: false, wind: true } }), deps)]);
    expect(results.map(result => result.status).sort()).toEqual([200,409]);
    expect(await GenerationSnapshot.countDocuments({ requestId: first.requestId })).toBe(1);
  });
});


describe("R16 layer-choice response integrity", () => {
  const command = () => ({ requestId: uuid(), occasion: "Class", weatherSource: "manual", weather: "mild", weatherSignals: { rain: true, wind: false } });
  it("accepts a service null signal echo for legacy unknown context without inventing captured signals", async () => {
    const deps = makeDeps({ callService: fakeService({ overridePayload: payload => { payload.weatherSignals = null; } }) });
    const response = await (await mlRecommend(req({ requestId: uuid(), occasion: "Class" }), deps)).json();
    expect(response.bindable).toBe(true); expect(response).not.toHaveProperty("weatherSignals");
    expect((await GenerationSnapshot.findById(response.shown[0].snapshotId).lean<Any>()).weatherSignals).toBeUndefined();
  });
  it("captures the honest no-layer gap in strict Mongo, replay and saved return", async () => {
    const layerChoice = { status: "gap", note: LAYER_CHOICE_NOTES.gap };
    const deps = makeDeps({ callService: fakeService({ overridePayload: payload => { payload.layerChoice = layerChoice; } }) });
    const root = command(); const response = await (await mlRecommend(req(root), deps)).json();
    expect(response.layerChoice).toEqual(layerChoice);
    const id = response.shown[0].snapshotId;
    expect((await GenerationSnapshot.findById(id).lean<Any>()).layerChoice).toEqual(layerChoice);
    expect((await (await mlRecommend(req(root), deps)).json()).layerChoice).toEqual(layerChoice);
    expect((await getSuggestion(userId, id, "c0")).layerChoice).toEqual(layerChoice);
  });
  it.each([
    { status: "off", note: null }, { status: "offered", note: LAYER_CHOICE_NOTES.offered },
    { status: "gap", note: "This jacket is waterproof." }, { status: "gap", note: null },
  ])("rejects contradictory or untrusted choice %j without persistence", async layerChoice => {
    const deps = makeDeps({ callService: fakeService({ overridePayload: payload => { payload.layerChoice = layerChoice; } }) });
    const result = await (await mlRecommend(req(command()), deps)).json();
    expect(result.bindable).toBe(false); expect(result.flags.reasonHint).toBe("contract_invalid");
    expect(await GenerationSnapshot.countDocuments()).toBe(0);
  });
  it.each([undefined, null, { rain: false, wind: false }, { rain: 1, wind: true }])("rejects missing or altered service signal echo %j", async weatherSignals => {
    const deps = makeDeps({ callService: fakeService({ overridePayload: payload => { payload.weatherSignals = weatherSignals; } }) });
    const result = await (await mlRecommend(req(command()), deps)).json();
    expect(result.bindable).toBe(false); expect(await GenerationSnapshot.countDocuments()).toBe(0);
  });
});
