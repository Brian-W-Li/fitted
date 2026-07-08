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
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import WardrobeItem from "@/models/WardrobeItem";
import OutfitInteraction from "@/models/OutfitInteraction";
import { mlRecommend, type MlRecommendDeps, type WeatherResolution } from "@/lib/mlRecommend";
import { GENERATOR_EXPECTATION } from "@/lib/mlRequestAdapter";
import type { RenderBody } from "@/lib/mlRequestAdapter";
import type { RenderServiceResult } from "@/lib/mlServiceClient";

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
      diagnostics: { notEnoughItems: false },
      shownCandidateIds: ["c0", "c1"],
      shownFullSignatures: ["sig-0", "sig-1"],
      nSurfaced: 2,
      spreadCollapsed: false,
    };
    opts.overridePayload?.(payload);
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
        flags: { notEnoughItems: false, insufficientAfterGeneration: false, spreadCollapsed: false, reasonHint: null },
        degenerate: false,
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

  it("a duplicate requestId with a CHANGED identity → 409 request_id_conflict, no second write", async () => {
    const rid = uuid();
    await mlRecommend(req({ requestId: rid, occasion: "brunch" }), makeDeps());
    const res = await mlRecommend(req({ requestId: rid, occasion: "a wedding" }), makeDeps());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("request_id_conflict");
    expect(await GenerationSnapshot.countDocuments({ user: userId })).toBe(1);
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

  it("a rescue whose forced item is not in the wardrobe → 409 forced_item_unavailable, no service call", async () => {
    const gone = new mongoose.Types.ObjectId().toString();
    let called = false;
    const deps = makeDeps({ callService: async (b) => { called = true; return fakeService()(b); } });
    const res = await mlRecommend(req({ requestId: uuid(), occasion: "class", forcedItemId: gone }), deps);
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
});
