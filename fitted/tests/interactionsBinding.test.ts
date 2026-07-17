/**
 * M5 feedback boundary — BEHAVIORAL test (C6, §I). Drives the real `postInteraction`/`getInteractions`
 * core over a REAL in-memory Mongo (write → read back) with an injected verified user. Replaces the
 * retired `interactionPersistence.test.ts` (which mock-tested the dead itemIds contract). This is the
 * behavior-first cure: a forged-echo POST is written and READ BACK to prove the persisted row carries
 * the SERVER-DERIVED binding, not the client echo — the exact class a mock test cannot catch.
 *
 * Matrix = the m5-cutover.md §I acceptance list (G8/G10 gates, ownership, append-only, GET scoping,
 * feedbackReason) + the "no PATCH/DELETE handler" append-only invariant.
 */
import { Types } from "mongoose";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import OutfitInteraction from "@/models/OutfitInteraction";
import {
  postInteraction,
  getInteractions,
  __resetInteractionRateLimit,
  INTERACTION_RATE_LIMIT_CAPACITY,
  type InteractionDeps,
} from "@/lib/interactions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let harness: MongoHarness;

beforeAll(async () => {
  harness = await startMemoryMongo([GenerationSnapshot, OutfitInteraction]);
}, 120_000);
afterAll(async () => {
  await harness.stop();
});
afterEach(async () => {
  await harness.clear();
  __resetInteractionRateLimit(); // the module-level bucket must not bleed across cases
});

const oid = () => new Types.ObjectId().toHexString();

// A request stub — the injected verifyUser ignores it, so only body/url matter.
function postReq(body: Record<string, unknown>): Any {
  return { headers: { get: () => "Bearer x" }, json: async () => body };
}
function getReq(url = "http://localhost/api/interactions"): Any {
  return { headers: { get: () => "Bearer x" }, url };
}

function deps(userId: string): InteractionDeps {
  return {
    verifyUser: async () => ({ userId }),
    models: { OutfitInteraction, GenerationSnapshot },
  };
}

// Build a valid snapshot owned by `userId` with one shown two-piece candidate.
async function makeSnapshot(
  userId: string,
  opts: { candidateId?: string; itemIds?: [string, string]; shown?: boolean; occasion?: string } = {},
) {
  const candidateId = opts.candidateId ?? "c0";
  const [topId, bottomId] = opts.itemIds ?? [oid(), oid()];
  const shown = opts.shown ?? true;
  const candidate = {
    candidateId,
    sourceAttemptId: "a0",
    sourceIndex: 0,
    stageReached: shown ? "shown" : "ranked",
    accepted: true,
    shown,
    shownPosition: shown ? 0 : undefined,
    rejectionCodes: [],
    warningCodes: [],
    items: [
      { itemId: topId, role: "base_top" },
      { itemId: bottomId, role: "base_bottom" },
    ],
    slotMap: { top: topId, bottom: bottomId },
    template: "two_piece",
    baseKey: `top:${topId}|bottom:${bottomId}`,
    fullSignature: `top:${topId}|bottom:${bottomId}`,
    optionPath: "reliable",
    risk: "safe",
    styleMove: { moveType: "anchor", changedItemIds: [topId], oneSentence: "Anchor the look." },
  };
  const snap = await GenerationSnapshot.create({
    user: userId,
    sessionId: userId,
    candidateCacheKey: "ck",
    generationIndex: 0,
    requestId: "0192f1a0-1c1a-4c3e-9b2a-1a2b3c4d5e6f",
    intent: "daily",
    occasion: opts.occasion ?? "brunch",
    weather: "mild",
    wardrobeVersion: 0,
    interactionCountAtRequest: 0,
    fittedCoreVersion: "0.4.0",
    generator: {
      provider: "openai",
      model: "gpt-5.4-mini",
      temperature: 0.5,
      promptVersion: "m5-c1.v1",
      maxCompletionTokens: 2200,
      apiSurface: "chat_completions",
      responseFormat: "json_schema_strict",
      reasoningEffort: "none",
      storeMode: "none",
      promptCacheRetention: "in_memory",
      timeoutSeconds: 30,
      maxRetries: 0,
    },
    rankerConfigVersion: "rk",
    scorer: { kind: "cold_start", available: false },
    itemSnapshots: [
      { itemId: topId, engineVisible: { name: "White Tee", clothingType: "top", warmth: 5, colorTags: ["white"], occasionTags: ["casual"], imageUrl: "mongo:img1" } },
      { itemId: bottomId, engineVisible: { name: "Blue Jeans", clothingType: "bottom", warmth: 5, colorTags: ["blue"], occasionTags: ["casual"], imageUrl: "mongo:img2" } },
    ],
    generationAttempts: [],
    candidates: [candidate],
    shownCandidateIds: shown ? [candidateId] : [],
    shownFullSignatures: shown ? [candidate.fullSignature] : [],
    nSurfaced: shown ? 1 : 0,
    spreadCollapsed: false,
  });
  return { snapshotId: snap._id.toString(), candidateId, topId, bottomId };
}

describe("POST /api/interactions — bind + append (§I)", () => {
  it("accepted: derives items/baseKey/fullSignature/occasion from the snapshot, appends one row", async () => {
    const userId = oid();
    const { snapshotId, candidateId, topId, bottomId } = await makeSnapshot(userId);

    const res = await postInteraction(postReq({ snapshotId, candidateId, action: "accepted" }), deps(userId));
    expect(res.status).toBe(200);

    const rows = await OutfitInteraction.find({ user: userId }).lean();
    expect(rows).toHaveLength(1);
    const row = rows[0] as Any;
    expect(row.action).toBe("accepted");
    expect(row.snapshotId.toString()).toBe(snapshotId);
    expect(row.candidateId).toBe(candidateId);
    expect(row.baseKey).toBe(`top:${topId}|bottom:${bottomId}`);
    expect(row.fullSignature).toBe(`top:${topId}|bottom:${bottomId}`);
    expect(row.items.map((i: Any) => i.toString()).sort()).toEqual([topId, bottomId].sort());
    expect(row.context.occasion).toBe("brunch");
  });

  it("forged items/baseKey/fullSignature/occasion echo → persists the SERVER-DERIVED values", async () => {
    const userId = oid();
    const { snapshotId, candidateId, topId, bottomId } = await makeSnapshot(userId);
    const forgedItem = oid();

    const res = await postInteraction(
      postReq({
        snapshotId,
        candidateId,
        action: "accepted",
        items: [forgedItem], // forged
        baseKey: "FORGED", // forged
        fullSignature: "FORGED", // forged
        occasion: "FORGED", // forged
      }),
      deps(userId),
    );
    expect(res.status).toBe(200);

    const row = (await OutfitInteraction.findOne({ user: userId }).lean()) as Any;
    // Server-derived, never the echo (the anti-poison invariant).
    expect(row.items.map((i: Any) => i.toString()).sort()).toEqual([topId, bottomId].sort());
    expect(row.baseKey).toBe(`top:${topId}|bottom:${bottomId}`);
    expect(row.fullSignature).toBe(`top:${topId}|bottom:${bottomId}`);
    expect(row.context.occasion).toBe("brunch");
    expect(row.items.map((i: Any) => i.toString())).not.toContain(forgedItem);
  });

  it("rejected with valid per-item feedback persists it", async () => {
    const userId = oid();
    const { snapshotId, candidateId, topId } = await makeSnapshot(userId);
    const res = await postInteraction(
      postReq({
        snapshotId,
        candidateId,
        action: "rejected",
        perItemFeedback: [{ itemId: topId, disliked: true, notes: "too bright" }],
      }),
      deps(userId),
    );
    expect(res.status).toBe(200);
    const row = (await OutfitInteraction.findOne({ user: userId }).lean()) as Any;
    expect(row.action).toBe("rejected");
    expect(row.perItemFeedback).toHaveLength(1);
    expect(row.perItemFeedback[0].itemId.toString()).toBe(topId);
    expect(row.perItemFeedback[0].disliked).toBe(true);
  });

  it("accepted with per-item feedback → 400, no row (perItemFeedback is a reject-time channel)", async () => {
    // The reducer reads perItemFeedback only on the rejected branch; on 'accepted' it would grant
    // the disliked item +1 affinity and drop the dislike. Reject at the boundary.
    const userId = oid();
    const { snapshotId, candidateId, topId } = await makeSnapshot(userId);
    const res = await postInteraction(
      postReq({
        snapshotId,
        candidateId,
        action: "accepted",
        perItemFeedback: [{ itemId: topId, disliked: true }],
      }),
      deps(userId),
    );
    expect(res.status).toBe(400);
    expect(await OutfitInteraction.countDocuments({ user: userId })).toBe(0);
  });

  it("cross-user snapshot → 404, no row (ownership re-read)", async () => {
    const owner = oid();
    const attacker = oid();
    const { snapshotId, candidateId } = await makeSnapshot(owner);
    const res = await postInteraction(postReq({ snapshotId, candidateId, action: "accepted" }), deps(attacker));
    expect(res.status).toBe(404);
    expect(await OutfitInteraction.countDocuments({ user: attacker })).toBe(0);
  });

  it("candidateId not in shownCandidateIds → 400, no row", async () => {
    const userId = oid();
    const { snapshotId } = await makeSnapshot(userId);
    const res = await postInteraction(postReq({ snapshotId, candidateId: "ghost", action: "accepted" }), deps(userId));
    expect(res.status).toBe(400);
    expect(await OutfitInteraction.countDocuments({ user: userId })).toBe(0);
  });

  it("degenerate snapshot (empty shown set) is unbindable → 400", async () => {
    const userId = oid();
    const { snapshotId, candidateId } = await makeSnapshot(userId, { shown: false });
    const res = await postInteraction(postReq({ snapshotId, candidateId, action: "accepted" }), deps(userId));
    expect(res.status).toBe(400);
    expect(await OutfitInteraction.countDocuments({ user: userId })).toBe(0);
  });

  it.each(["worn", "saved", "corrected", "generated", "swiped"])(
    "G8: disallowed action %s → 400 invalid_action, no row",
    async (action) => {
      const userId = oid();
      const { snapshotId, candidateId } = await makeSnapshot(userId);
      const res = await postInteraction(postReq({ snapshotId, candidateId, action }), deps(userId));
      expect(res.status).toBe(400);
      expect(await OutfitInteraction.countDocuments({ user: userId })).toBe(0);
    },
  );

  it("G10: non-hex perItemFeedback.itemId → 400, no row", async () => {
    const userId = oid();
    const { snapshotId, candidateId } = await makeSnapshot(userId);
    const res = await postInteraction(
      postReq({ snapshotId, candidateId, action: "rejected", perItemFeedback: [{ itemId: "item1", disliked: true }] }),
      deps(userId),
    );
    expect(res.status).toBe(400);
    expect(await OutfitInteraction.countDocuments({ user: userId })).toBe(0);
  });

  it("perItemFeedback.itemId not in the outfit → 400, no row", async () => {
    const userId = oid();
    const { snapshotId, candidateId } = await makeSnapshot(userId);
    const res = await postInteraction(
      postReq({ snapshotId, candidateId, action: "rejected", perItemFeedback: [{ itemId: oid(), disliked: true }] }),
      deps(userId),
    );
    expect(res.status).toBe(400);
    expect(await OutfitInteraction.countDocuments({ user: userId })).toBe(0);
  });

  it("feedbackReason: valid codes persist; rawText capped; invalid code → 400", async () => {
    const userId = oid();
    const s1 = await makeSnapshot(userId, { candidateId: "c0" });
    const okRes = await postInteraction(
      postReq({
        snapshotId: s1.snapshotId,
        candidateId: "c0",
        action: "rejected",
        feedbackReason: { codes: ["too_boring", "too_boring", "not_me"], rawText: "x".repeat(600) },
      }),
      deps(userId),
    );
    expect(okRes.status).toBe(200);
    const row = (await OutfitInteraction.findOne({ user: userId }).lean()) as Any;
    expect(new Set(row.feedbackReason.codes)).toEqual(new Set(["too_boring", "not_me"])); // deduped
    expect(row.feedbackReason.rawText).toHaveLength(500); // capped
    expect(row.feedbackReason.source).toBe("user");

    const badRes = await postInteraction(
      postReq({ snapshotId: s1.snapshotId, candidateId: "c0", action: "rejected", feedbackReason: { codes: ["nope"] } }),
      deps(userId),
    );
    expect(badRes.status).toBe(400);
  });

  it("double-tap appends two rows (append-only — corrections are new events)", async () => {
    const userId = oid();
    const { snapshotId, candidateId } = await makeSnapshot(userId);
    await postInteraction(postReq({ snapshotId, candidateId, action: "accepted" }), deps(userId));
    await postInteraction(postReq({ snapshotId, candidateId, action: "rejected" }), deps(userId));
    expect(await OutfitInteraction.countDocuments({ user: userId })).toBe(2);
  });
});

describe("POST /api/interactions — per-user rate limit (W2-4a)", () => {
  // Freeze the clock so the CAPACITY in-memory writes can't refill a token mid-loop (else a slow CI
  // run > 1s would let the (CAPACITY+1)th call succeed — a wall-clock flake). Deterministic depletion.
  const frozen = (userId: string): InteractionDeps => ({ ...deps(userId), now: () => 1_000_000 });

  it("rejects with 429 once a user exceeds the capacity, and does NOT write the rejected row", async () => {
    const userId = oid();
    const { snapshotId, candidateId } = await makeSnapshot(userId);
    // Exhaust the bucket (appends to the same candidate are append-only-legal).
    for (let i = 0; i < INTERACTION_RATE_LIMIT_CAPACITY; i++) {
      const res = await postInteraction(postReq({ snapshotId, candidateId, action: "accepted" }), frozen(userId));
      expect(res.status).toBe(200);
    }
    const over = await postInteraction(postReq({ snapshotId, candidateId, action: "accepted" }), frozen(userId));
    expect(over.status).toBe(429);
    expect((await over.json()).code).toBe("rate_limited");
    // The 429 wrote nothing — exactly CAPACITY rows persisted, not CAPACITY+1.
    expect(await OutfitInteraction.countDocuments({ user: userId })).toBe(INTERACTION_RATE_LIMIT_CAPACITY);
  });

  it("limits per-user — a second user is unaffected by the first's flood", async () => {
    const userA = oid();
    const userB = oid();
    const a = await makeSnapshot(userA);
    const b = await makeSnapshot(userB);
    for (let i = 0; i < INTERACTION_RATE_LIMIT_CAPACITY; i++) {
      await postInteraction(postReq({ snapshotId: a.snapshotId, candidateId: a.candidateId, action: "accepted" }), frozen(userA));
    }
    // userA is now exhausted; userB's independent bucket is full.
    expect((await postInteraction(postReq({ snapshotId: a.snapshotId, candidateId: a.candidateId, action: "accepted" }), frozen(userA))).status).toBe(429);
    expect((await postInteraction(postReq({ snapshotId: b.snapshotId, candidateId: b.candidateId, action: "accepted" }), frozen(userB))).status).toBe(200);
  });
});

describe("GET /api/interactions — user-scoped snapshot join (§I)", () => {
  it("joins the bound candidate content + itemSnapshots display fields; never leaks another user", async () => {
    const userId = oid();
    const victim = oid();
    const { snapshotId, candidateId } = await makeSnapshot(userId);
    // A victim row referencing a snapshot the requester does not own must never join/leak.
    const victimSnap = await makeSnapshot(victim);
    await postInteraction(postReq({ snapshotId, candidateId, action: "accepted" }), deps(userId));
    await postInteraction(
      postReq({ snapshotId: victimSnap.snapshotId, candidateId: victimSnap.candidateId, action: "accepted" }),
      deps(victim),
    );

    const res = await getInteractions(getReq("http://localhost/api/interactions?action=accepted"), deps(userId));
    const json = (await res.json()) as Any;
    expect(json.interactions).toHaveLength(1);
    const card = json.interactions[0];
    expect(card.snapshotId).toBe(snapshotId);
    expect(card.candidateId).toBe(candidateId);
    expect(card.styleMove.moveType).toBe("anchor");
    expect(card.templateType).toBe("two_piece");
    expect(card.displayItems).toHaveLength(2);
    expect(card.displayItems[0].name).toBeDefined();
    expect(card.displayItems.map((d: Any) => d.imageUrl)).toContain("mongo:img1");
  });
});

describe("route surface — append-only (no PATCH/DELETE handler)", () => {
  it("the route module exports only GET + POST", async () => {
    const mod = await import("@/app/api/interactions/route");
    expect(typeof mod.GET).toBe("function");
    expect(typeof mod.POST).toBe("function");
    expect((mod as Any).PATCH).toBeUndefined();
    expect((mod as Any).DELETE).toBeUndefined();
  });
});
