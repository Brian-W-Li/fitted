/**
 * M5 recommend orchestrator (C5, seam #6) — the flag-on vertical the rewritten route calls. It
 * assembles the seam 3–5 building blocks + the seam-6 route-owned cross-checks into one render:
 *
 *   auth → requestId validate → §C.1 lineage gate → snapshotId mint → §C.4 idempotency read-check
 *   → wardrobe + behavioralRows fetch + §C.3/G16 preflight → §F/§15.2 adapter + wire body
 *   → POST /render → §G payload validation + §A/G4 cross-checks → TS merge + raw-field caps
 *   → §C.4 idempotent write → §A/G15 browser projection (no post-Python DB refetch, H10).
 *
 * The core is INJECTABLE (`MlRecommendDeps`) so a jest test drives it over a REAL Mongo harness
 * with a fake in-process service + a fixed clock — the behavior-first cure. `prodDeps()` binds the
 * real models/auth/service-client/clock; the route calls `mlRecommend(request, prodDeps())`.
 *
 * Reference: docs/plans/m5-cutover.md §A/§C/§D/§F/§G/§G.1; docs/sessions/2026-07-08-m5-c5-seam6-route.md.
 */
import { NextResponse, type NextRequest } from "next/server";
import mongoose from "mongoose";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";
import { getWeatherContext } from "@/lib/weather";
import {
  buildLens,
  buildRenderBody,
  projectWardrobe,
  GENERATOR_EXPECTATION,
  RequestContractError,
  WEATHER_BUCKETS,
  type Intent,
  type LensWire,
  type WeatherBucket,
  type WardrobeItemSource,
  type WardrobeItemWire,
  type DroppedWardrobeItem,
  type RenderBody,
} from "@/lib/mlRequestAdapter";
import { isValidRequestId } from "@/lib/formats";
import { allowRequest } from "@/lib/rateLimit";
import {
  callRenderService,
  buildDegradedResponse,
  type RenderServiceResult,
  type DegradedReasonHint,
} from "@/lib/mlServiceClient";
import { buildBehavioralRows } from "@/lib/mlBehavioralRows";
import { CLOTHING_TYPES, type ClothingType } from "@/lib/clothingType";
import { validateSnapshotPayload, PayloadContractError } from "@/lib/mlSnapshotValidation";
import { writeSnapshotWithIdempotency } from "@/lib/mlSnapshotWrite";
import {
  normalizeControls,
  makeRenderIdentity,
  identityMatches,
  crossCheckAuthorship,
  crossCheckShownIdentity,
  crossCheckShownBody,
  buildSnapshotDoc,
  projectBrowserResponse,
  type NormalizedControls,
  type WireShownEntry,
  type BrowserFlags,
  type EvidenceSourceItem,
} from "@/lib/mlSnapshotMerge";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;


// ---------------------------------------------------------------------------
// Injectable dependencies — the seam the behavior-first test drives.
// ---------------------------------------------------------------------------
export interface VerifyOk {
  userId: string;
}
export interface VerifyErr {
  error: string;
  status: number;
}
export type VerifyResult = VerifyOk | VerifyErr;

export interface MlModels {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  GenerationSnapshot: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  WardrobeItem: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  OutfitInteraction: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  User: any; // the post-persist erasure-race check (account deletion during an in-flight render)
}

export interface WeatherResolution {
  weather: WeatherBucket;
  weatherRaw: string | null;
}
export interface WeatherInput {
  occasion: string;
  weather?: unknown; // client-frozen resolved bucket (F10 replay) — validated ∈ WEATHER_BUCKETS
  weatherRaw?: unknown;
  lat?: unknown;
  lon?: unknown;
  eventTimeISO?: unknown;
}

export interface MlRecommendDeps {
  verifyUser(request: NextRequest): Promise<VerifyResult>;
  /** Per-user render ceiling (§A) — the service token bucket is GLOBAL (12/min across all
   *  users), so one looping account would starve every other user's renders; this bounds each
   *  account before the shared bucket. Optional so direct-deps tests can run unmetered; prodDeps
   *  always binds it. */
  allowRender?(userId: string): boolean;
  models: MlModels;
  callService(body: RenderBody): Promise<RenderServiceResult>;
  /** UTC YYYY-MM-DD (H8) — injected for determinism; the service never reads a clock. */
  today(): string;
  /** A fresh ObjectId hex — the pre-allocated snapshotId + feedback-binding token. */
  newId(): string;
  resolveWeather(input: WeatherInput): Promise<WeatherResolution>;
}

// ---------------------------------------------------------------------------
// prodDeps — the real-world wiring.
// ---------------------------------------------------------------------------
async function verifyUserProd(request: NextRequest): Promise<VerifyResult> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { error: "Missing or invalid Authorization header", status: 401 };
  }
  const idToken = authHeader.slice("Bearer ".length).trim();
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    const { User } = await initDatabase();
    const user = await User.findOne({ authProvider: "firebase", authId: decoded.uid }).exec();
    if (!user) return { error: "User not found", status: 404 };
    return { userId: user._id.toString() };
  } catch (error) {
    console.error("Error verifying Firebase token:", error);
    return { error: "Invalid or expired token", status: 401 };
  }
}

/** Resolve weather to an R5 bucket + raw summary. A client-frozen bucket (F10 replay) is honored
 *  verbatim; otherwise the route resolves server-side (getWeatherContext when geo is present, else
 *  the occasion-text heuristic). See the §F/§C.4 weather-freeze reconciliation in the plan. */
export async function resolveWeatherProd(input: WeatherInput): Promise<WeatherResolution> {
  if (input.weather != null) {
    if (typeof input.weather !== "string" || !WEATHER_BUCKETS.includes(input.weather as WeatherBucket)) {
      throw new RequestContractError("weather must be a resolved M5 bucket");
    }
    const raw = typeof input.weatherRaw === "string" ? input.weatherRaw : null;
    return { weather: input.weather as WeatherBucket, weatherRaw: raw };
  }
  if (typeof input.lat === "number" && typeof input.lon === "number") {
    const ctx = await getWeatherContext({
      lat: input.lat,
      lon: input.lon,
      eventTimeISO: typeof input.eventTimeISO === "string" ? input.eventTimeISO : undefined,
    });
    if (ctx) {
      return { weather: bucketFromTemp(ctx), weatherRaw: ctx.weatherSummary };
    }
  }
  return { weather: bucketFromSummary(input.occasion), weatherRaw: null };
}

/** Coarse R5 bucketing from a free-text summary/occasion — the legacy heuristic, condensed.
 *  Exported so the weather-bucket keyword contract (incl. the substring-collision guards) is tested
 *  against the LIVE function, not an inline copy. */
export function bucketFromSummary(text: string): WeatherBucket {
  const t = (text ?? "").toLowerCase();
  const has = (w: string) => (w.includes(" ") ? t.includes(w) : new RegExp(`\\b${w}\\b`).test(t));
  if (["cold", "winter", "freezing", "chilly", "snow", "frigid"].some(has)) return "cold";
  if (["hot", "summer", "warm", "humid", "heat", "scorching"].some(has)) return "hot";
  if (["outdoor", "outside", "beach", "park", "picnic", "hiking", "hike", "camping", "garden", "trail"].some(has))
    return "outdoor";
  if (["indoor", "inside", "air condition", "office"].some(has)) return "indoor";
  return "mild";
}

/** R5 bucket from RESOLVED TEMPERATURE (feels-like preferred; §F R5 "temp→bucket"). The geo weather
 *  path uses this: `getWeatherContext`'s summary carries the °C but no weather-appropriate keyword, so a
 *  friend on a 34°C clear day must bucket by the NUMBER, not the text (`bucketFromSummary` would return
 *  "mild"). `bucketFromSummary` stays the no-geo occasion-text fallback. The thresholds are practical
 *  feels-like dressing cut-points; the bucket then maps to the ranker's SEPARATE 0–10 item-warmth band
 *  (not a °C scale). Snow overrides to cold regardless of °C (snow showers at 12°C is still cold-dress). */
export function bucketFromTemp(ctx: { weatherSummary: string; tempC: number; feelsLikeC?: number }): WeatherBucket {
  if (/\bsnow\b/i.test(ctx.weatherSummary)) return "cold";
  const t = typeof ctx.feelsLikeC === "number" ? ctx.feelsLikeC : ctx.tempC;
  if (t <= 10) return "cold";
  if (t >= 24) return "hot";
  return "mild";
}

// Per-user render pacing: well under the service's global 12/min so one account can't own the
// shared bucket, well over any real friend's clicking rate. Per-instance best-effort (rateLimit.ts).
const RENDER_RATE_MAX_PER_MIN = 6;

export function prodDeps(): MlRecommendDeps {
  return {
    verifyUser: verifyUserProd,
    allowRender: (userId) => allowRequest(`render:${userId}`, RENDER_RATE_MAX_PER_MIN, 60_000),
    // Lazily resolved via initDatabase so a cold serverless invocation connects once.
    models: {
      get GenerationSnapshot() {
        return mongoose.models.GenerationSnapshot;
      },
      get WardrobeItem() {
        return mongoose.models.WardrobeItem;
      },
      get OutfitInteraction() {
        return mongoose.models.OutfitInteraction;
      },
      get User() {
        return mongoose.models.User;
      },
    } as unknown as MlModels,
    callService: (body) => callRenderService(body),
    today: () => new Date().toISOString().slice(0, 10),
    newId: () => new mongoose.Types.ObjectId().toString(),
    resolveWeather: resolveWeatherProd,
  };
}

// ---------------------------------------------------------------------------
// Response builders. Degraded + success are 200 (a valid-shape body the browser renders); the §C
// state/preflight arms are stable 4xx/409 with an error envelope.
// ---------------------------------------------------------------------------
function respondError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}
/**
 * The §A degraded empty browser state as a standalone 200 response — empty candidates, no
 * {snapshotId, candidateId} binding token, no snapshot written. Exported for the recommend route's
 * flag-OFF arm: with the legacy recommender retired (C8), `USE_ML_SHORTLISTER` unset/false means the
 * ML vertical is disabled, so the route returns this degraded state (never legacy, never a 5xx) —
 * the rollback story. Defaults to `service_unavailable` (the honest hint when the engine is off).
 */
export function renderDegraded(reasonHint: DegradedReasonHint = "service_unavailable"): NextResponse {
  return NextResponse.json(buildDegradedResponse(reasonHint));
}
function respondDegraded(reasonHint: DegradedReasonHint): NextResponse {
  return renderDegraded(reasonHint);
}

function rejectNonEmptyConstraints(raw: unknown): boolean {
  if (raw == null) return false;
  if (typeof raw !== "object" || Array.isArray(raw)) return true;
  return Object.keys(raw as Record<string, unknown>).length > 0;
}

function canonicalRequestId(raw: string): string {
  return raw.includes("-") ? raw.toLowerCase() : raw.toUpperCase();
}

function structuralLockError(lockedItemIds: string[], forcedItemId: string | null, wardrobeDocs: Any[]): string | null {
  const byId = new Map<string, string>(wardrobeDocs.map((d) => [d._id.toString(), String(d.clothingType ?? "")]));
  const pinIds = new Set(lockedItemIds);
  if (forcedItemId) pinIds.add(forcedItemId);
  const seenTypes = new Set<string>();
  for (const id of [...pinIds].sort()) {
    const type = byId.get(id);
    if (!type) continue;
    if (seenTypes.has(type)) return `more than one lock occupies the ${type} slot`;
    seenTypes.add(type);
  }
  if (seenTypes.has("dress") && (seenTypes.has("top") || seenTypes.has("bottom"))) {
    return "a locked dress cannot coexist with a locked top or bottom";
  }
  return null;
}

// ---------------------------------------------------------------------------
// The orchestrator.
// ---------------------------------------------------------------------------
export async function mlRecommend(request: NextRequest, deps: MlRecommendDeps): Promise<NextResponse> {
  try {
    // 1. Auth.
    const auth = await deps.verifyUser(request);
    if ("error" in auth) return respondError(auth.status, "auth", auth.error);
    const userId = auth.userId;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // 2. Parse + validate the idempotency token BEFORE any work (§C.4).
    const body = (await request.json().catch(() => null)) as Any;
    if (!body || typeof body !== "object") return respondError(400, "contract_invalid", "malformed body");
    const rawRequestId: unknown = body.requestId;
    if (typeof rawRequestId !== "string" || rawRequestId.length > 64 || !isValidRequestId(rawRequestId)) {
      return respondError(400, "contract_invalid", "requestId must be a UUIDv4 or ULID (<=64 chars)");
    }
    const requestId = canonicalRequestId(rawRequestId);

    const { GenerationSnapshot, WardrobeItem, OutfitInteraction, User } = deps.models;

    // 3. §C.1 lineage gate FIRST, then intent — a re-roll carries only {requestId, parentSnapshotId,
    //    controls}; intent + Lens are derived FROM THE PARENT, never the client (else a rescue re-roll,
    //    whose body has no forcedItemId, would mis-derive intent="daily").
    let intent: Intent;
    let generationIndex: number;
    let parentSnapshotId: string | null;
    let seedDate: string;
    let controls: NormalizedControls;
    let lensInput: {
      occasion: string;
      weather: string;
      weatherRaw: string | null;
      location: string | null;
      forcedItemId: string | null;
      seedDate: string;
      constraints: Record<string, unknown>;
    };
    let parentCandidateCacheKey: string | null = null;

    const rawParent: unknown = body.parentSnapshotId;
    if (rawParent != null && rawParent !== "") {
      if (typeof rawParent !== "string" || !mongoose.isValidObjectId(rawParent)) {
        return respondError(404, "parent_not_found", "parentSnapshotId is not a valid id");
      }
      const parent = await GenerationSnapshot.findOne({ _id: rawParent, user: userObjectId }).lean();
      if (!parent) return respondError(404, "parent_not_found", "parent snapshot not found");
      // Canonicalize to the stored (lowercase) ObjectId string: `.create()` casts the stored
      // parentSnapshotId to canonical form, so an uppercase-hex rawParent would make an identical
      // retry's identity compare (step 5) mismatch and wrongly 409 instead of replaying the winner.
      parentSnapshotId = new mongoose.Types.ObjectId(rawParent).toString();
      generationIndex = (parent.generationIndex ?? 0) + 1;
      intent = parent.intent as Intent;
      seedDate = parent.seedDate;
      parentCandidateCacheKey = parent.candidateCacheKey ?? null;
      controls = normalizeControls(body.controls);
      lensInput = {
        occasion: parent.occasion,
        weather: parent.weather,
        weatherRaw: parent.weatherRaw ?? null,
        location: parent.location ?? null,
        forcedItemId: parent.forcedItemId ?? null,
        seedDate: parent.seedDate,
        constraints: {},
      };
    } else {
      // Root render.
      parentSnapshotId = null;
      generationIndex = 0;
      intent = body.forcedItemId ? "rescue_item" : "daily";
      seedDate = deps.today();
      // Root-controls invariant (§C.3): a parentless render must carry EMPTY controls.
      const rootControls = normalizeControls(body.controls);
      if (rootControls.lockedItemIds.length > 0 || rootControls.dislikedItemIds.length > 0) {
        return respondError(400, "root_controls", "controls are regenerate-only; a root render must not carry them");
      }
      controls = { lockedItemIds: [], dislikedItemIds: [] };
      if (typeof body.occasion !== "string") {
        return respondError(400, "contract_invalid", "occasion is required");
      }
      if (rejectNonEmptyConstraints(body.constraints)) {
        return respondDegraded("contract_invalid");
      }
      const resolved = await deps.resolveWeather({
        occasion: body.occasion,
        weather: body.weather,
        weatherRaw: body.weatherRaw,
        lat: body.lat,
        lon: body.lon,
        eventTimeISO: body.eventTimeISO,
      });
      lensInput = {
        occasion: body.occasion,
        weather: resolved.weather,
        weatherRaw: resolved.weatherRaw,
        location: typeof body.location === "string" ? body.location : null,
        forcedItemId: typeof body.forcedItemId === "string" ? body.forcedItemId : null,
        seedDate,
        constraints: {},
      };
    }

    // Build the validated Lens now (rejects blank occasion / bad weather / missing seedDate etc.
    // as RequestContractError → the §A contract_invalid degraded state).
    let lens: LensWire;
    try {
      lens = buildLens(lensInput, intent);
    } catch (err) {
      if (err instanceof RequestContractError) return respondDegraded("contract_invalid");
      throw err;
    }

    // 4. Pre-allocate the snapshotId (= the feedback-binding token).
    const snapshotId = deps.newId();

    // The G5 render identity for the idempotency comparison (EXCLUDES seedDate — §C.4 trap-guard).
    const incomingIdentity = makeRenderIdentity({
      user: userId,
      intent,
      occasion: lens.occasion,
      weather: lens.weather,
      location: lens.location,
      forcedItemId: lens.forcedItemId,
      wardrobeVersion: 0,
      generationIndex,
      parentSnapshotId,
      controls,
    });

    // 5. §C.4 early read-check: a completed-render retry replays the winner; a reused requestId for a
    //    DIFFERENT render identity is a conflict (G5).
    const existing = await GenerationSnapshot.findOne({ user: userObjectId, requestId }).lean();
    if (existing) {
      if (identityMatches(incomingIdentity, identityFromDoc(existing))) {
        return NextResponse.json(projectBrowserResponse(existing, existing._id.toString()));
      }
      return respondError(409, "request_id_conflict", "requestId reused for a different render");
    }

    // 5.5 Per-user render ceiling — AFTER the §C.4 replay (an idempotent replay is one Mongo read
    // and zero service spend, so a rate-limited F10 resume must still return its already-paid
    // render), BEFORE the wardrobe fetch and everything that leads to the service call. Degraded
    // (200, rate_limited), never a 5xx: the dashboard keeps the current outfits and shows the
    // try-again copy.
    if (deps.allowRender && !deps.allowRender(userId)) {
      return respondDegraded("rate_limited");
    }

    // 6. Fetch wardrobe (full docs — evidence source) + behavioral rows; preflight.
    const wardrobeDocs = (await WardrobeItem.find({ user: userObjectId, isAvailable: { $ne: false } }).lean()) as Any[];
    const wardrobeIds = new Set<string>(wardrobeDocs.map((d) => d._id.toString()));

    // G16 (§C.3) — a rescue whose forced item was deleted since the parent render is a state conflict.
    if (intent === "rescue_item" && lens.forcedItemId && !wardrobeIds.has(lens.forcedItemId)) {
      return respondError(409, "forced_item_unavailable", "the item to rescue is no longer in your closet");
    }
    // Cheap request-decidable preflight mirrors (§C.3 / §I) → stable 400 before service spend.
    const dislikedSet = new Set(controls.dislikedItemIds);
    if (controls.lockedItemIds.some((id) => dislikedSet.has(id))) {
      return respondError(400, "controls_contradictory", "an item is both locked and disliked");
    }
    if (lens.forcedItemId && dislikedSet.has(lens.forcedItemId)) {
      return respondError(400, "controls_contradictory", "the forced item is disliked");
    }
    const missingControlId = [...controls.lockedItemIds, ...controls.dislikedItemIds].find((id) => !wardrobeIds.has(id));
    if (missingControlId) {
      return respondError(400, "control_item_unavailable", "a locked or disliked item is no longer in your closet");
    }
    const structuralError = structuralLockError(controls.lockedItemIds, lens.forcedItemId, wardrobeDocs);
    if (structuralError) {
      return respondError(400, "controls_structurally_infeasible", structuralError);
    }

    const interactionCountAtRequest = await OutfitInteraction.countDocuments({ user: userObjectId });
    const behavioralRows = await buildBehavioralRows(userObjectId, {
      OutfitInteraction,
      GenerationSnapshot,
    });

    // 7. §15.2 item map — per-item resilience (A-cluster): a malformed wardrobe row is dropped, not
    //    fatal, so one corrupt garment never costs the user their whole closet. An over-cap wardrobe
    //    is an ENVELOPE fault and still degrades.
    let wardrobe: WardrobeItemWire[];
    let droppedWardrobe: DroppedWardrobeItem[];
    try {
      ({ wire: wardrobe, dropped: droppedWardrobe } = projectWardrobe(
        wardrobeDocs as unknown as WardrobeItemSource[],
      ));
    } catch (err) {
      if (err instanceof RequestContractError) return respondDegraded("contract_invalid");
      throw err;
    }
    // A dropped row that a control explicitly references can't be silently discarded: the user
    // pointed at that specific garment (forcedItemId / locked / disliked), and the service also
    // rejects a control id absent from the wire wardrobe (app.py _preflight_controls). Escalate to a
    // hard, legible reject rather than drop the control or empty-succeed. Other drops just proceed on
    // the good items — the engine reports notEnoughItems itself if too few remain (app.py §C.3).
    if (droppedWardrobe.length > 0) {
      const droppedIds = new Set(droppedWardrobe.map((d) => d.id));
      if (lens.forcedItemId && droppedIds.has(lens.forcedItemId)) {
        return respondError(422, "forced_item_unusable", "the item you're building around has invalid data and can't be used");
      }
      const badControlId = [...controls.lockedItemIds, ...controls.dislikedItemIds].find((id) => droppedIds.has(id));
      if (badControlId) {
        return respondError(422, "control_item_unusable", "a locked or disliked item has invalid data and can't be used");
      }
      console.warn(
        `recommend: dropped ${droppedWardrobe.length} malformed wardrobe item(s): ` +
          droppedWardrobe.map((d) => `${d.id}(${d.reason})`).join(", "),
      );
    }
    let renderBody: RenderBody;
    try {
      renderBody = buildRenderBody({
        snapshotId,
        requestId,
        sessionId: userId,
        intent,
        generationIndex,
        parentSnapshotId,
        controls,
        lens,
        wardrobe,
        wardrobeVersion: 0,
        interactionCountAtRequest,
        behavioralRows,
      });
    } catch (err) {
      if (err instanceof RequestContractError) return respondDegraded("contract_invalid");
      throw err;
    }

    // 8. Call the render service. Any operational failure → the §A degraded empty state (no write,
    //    snapshotId discarded).
    const result = await deps.callService(renderBody);
    if (!result.ok) return respondDegraded(result.reasonHint);

    const { payload, shown, flags } = result.response;
    const wireShown = (shown ?? []) as WireShownEntry[];

    // 9. §G payload validation + §A/G4 cross-checks. Any violation → contract_invalid degraded, no write.
    try {
      validateSnapshotPayload(payload);
      crossCheckShownIdentity(payload, wireShown);
      crossCheckShownBody(payload, wireShown);
      crossCheckAuthorship(payload, {
        sessionId: userId,
        intent,
        occasion: lens.occasion,
        weather: lens.weather,
        weatherRaw: lens.weatherRaw,
        location: lens.location,
        forcedItemId: lens.forcedItemId,
        seedDate,
        wardrobeVersion: 0,
        requestId,
        parentSnapshotId,
        generationIndex,
        controls,
        generator: GENERATOR_EXPECTATION,
        parentCandidateCacheKey: parentSnapshotId ? parentCandidateCacheKey : undefined,
      });
    } catch (err) {
      if (err instanceof PayloadContractError) {
        // Post-spend: the paid render's payload failed the §G cross-check and is discarded. Log it —
        // a silent discard here is a burned gpt-5.4-mini call with zero yield (e.g. a service-deploy
        // candidateCacheKey drift), invisible without this line.
        console.warn("[render] post-service payload cross-check failed (paid render discarded) → contract_invalid");
        return respondDegraded("contract_invalid");
      }
      throw err;
    }

    // 10. TS merge (exactly-four added fields + raw-field caps + per-item evidence). A service-invented
    //     itemId (absent from the request wardrobe) fails loud here.
    const wardrobeById = new Map<string, EvidenceSourceItem>(
      wardrobeDocs.map((d) => [d._id.toString(), d as unknown as EvidenceSourceItem]),
    );
    let doc: Record<string, unknown>;
    try {
      doc = buildSnapshotDoc({
        payload,
        snapshotId,
        user: userObjectId,
        interactionCountAtRequest,
        wardrobeById,
      });
    } catch (err) {
      if (err instanceof PayloadContractError) {
        console.warn("[render] buildSnapshotDoc rejected the paid payload → contract_invalid");
        return respondDegraded("contract_invalid");
      }
      throw err;
    }

    // 11. §C.4 idempotent write. Non-E11000 failure → degrade (no binding token for an unpersisted row).
    let writeResult;
    try {
      writeResult = await writeSnapshotWithIdempotency<Any>(GenerationSnapshot, doc, userObjectId, requestId);
    } catch (err) {
      console.error("GenerationSnapshot write failed:", err);
      return respondDegraded("service_unavailable");
    }

    // 11.5 Erasure-race close, writer side (§23-H43 / Track 2): the account-deletion flow may run
    // while the render is in flight (auth re-reads the User row, so only an ALREADY-authed render
    // can race). A snapshot persisted for a since-deleted user must not survive — "delete me"
    // means delete — and must not hand back a binding token. Erase via the native driver (the
    // same sanctioned erasure door the User cascade uses; the Mongoose delete guard stays intact
    // for every other path) and degrade non-bindably. This check is reliable only once the User
    // row is actually gone — the deletion cascade is a PRE-hook, so a write landing between the
    // cascade's sweep and the user row's death still sees the user alive here; the account
    // route's phase-3 post-deletion sweep is the other half that closes that interleaving.
    const userStillExists = await User.exists({ _id: userObjectId });
    if (!userStillExists) {
      await GenerationSnapshot.db
        .collection("generationsnapshots")
        .deleteMany({ user: userObjectId });
      return respondDegraded("auth_failed");
    }

    if (writeResult.deduped) {
      // Lost the race: G5 must hold on the winner too, else a different-identity request slipped the
      // early check (a genuine concurrent double-submit of a different render under one token).
      const winner = writeResult.snapshot;
      if (!identityMatches(incomingIdentity, identityFromDoc(winner))) {
        return respondError(409, "request_id_conflict", "requestId reused for a different render");
      }
      return NextResponse.json(projectBrowserResponse(winner, winner._id.toString()));
    }

    // 12. §A/G15 browser projection from the in-memory merged doc (no post-Python DB refetch, H10).
    // D1 slot census (clothingtype-slot-correctness §4-D): counted from the PROJECTED wire wardrobe —
    // never raw wardrobeDocs (a malformed row the projection dropped must not be counted in a census
    // the engine can't see) and never itemSnapshots (the SCOPED rescue pool → miscount). Rides the
    // live render only; the §C.4 early-replay + dedup-loser paths have no census source and omit it,
    // degrading emptyStateMessage to the plain engine hint there. CONTROL-FREE renders only: on a
    // controls re-roll an empty can be controls-caused (the engine's "your locks and dislikes rule
    // out every outfit" state rides notEnoughItems), and the census's fix-a-mislabel/add-a-piece
    // remedy would be a false diagnosis there — the census defends FIRST-render walls, which never
    // carry controls.
    const hasControls = controls.lockedItemIds.length > 0 || controls.dislikedItemIds.length > 0;
    const slotCensus = Object.fromEntries(
      CLOTHING_TYPES.map((t) => [t, 0]),
    ) as Record<ClothingType, number>;
    for (const item of wardrobe) slotCensus[item.clothingType as ClothingType] += 1;
    const wireFlags: BrowserFlags = {
      notEnoughItems: Boolean(flags?.notEnoughItems),
      insufficientAfterGeneration: Boolean(flags?.insufficientAfterGeneration),
      spreadCollapsed: Boolean(flags?.spreadCollapsed),
      reasonHint: flags?.reasonHint ?? null,
      ...(hasControls ? {} : { slotCensus }),
    };
    return NextResponse.json(projectBrowserResponse(doc, snapshotId, wireFlags));
  } catch (error) {
    // An input-contract violation from any pre-service/validation helper (e.g. malformed `controls`
    // → normalizeControls, or a service-mangled controls in crossCheckAuthorship) is the §A
    // contract_invalid degraded state — the adapter's documented channel — never a 500. No snapshot
    // is written on this path (the throw precedes .create()).
    if (error instanceof RequestContractError) return respondDegraded("contract_invalid");
    console.error("mlRecommend fatal error:", error);
    // A genuine programming error (never an operational failure — those degrade above). Surface as a
    // 500 so a bug is loud, never a silent legacy fallthrough or a corpus lie.
    return respondError(500, "internal", "recommendation failed");
  }
}

// Extract the comparable identity from a stored/lean snapshot doc.
function identityFromDoc(doc: Any): ReturnType<typeof makeRenderIdentity> {
  return makeRenderIdentity({
    user: doc.user,
    intent: doc.intent,
    occasion: doc.occasion,
    weather: doc.weather,
    location: doc.location,
    forcedItemId: doc.forcedItemId,
    wardrobeVersion: doc.wardrobeVersion,
    generationIndex: doc.generationIndex,
    parentSnapshotId: doc.parentSnapshotId,
    controls: doc.controls,
  });
}
