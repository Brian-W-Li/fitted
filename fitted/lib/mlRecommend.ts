import { normalizeLayerRole } from "@/lib/layerRole";
import { finishImageLeases, mongoImageId, localImageId, withImageConcurrency, type ImageRetentionModels } from "@/lib/imageRetention";
import { snapshotVisible } from "@/lib/snapshotVisibility";
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
import { weatherSourceFromSnapshot, weatherSignalsFromSnapshot, validWeatherSignals, sameWeatherSignals, type WeatherSignals, type WeatherSource } from "@/lib/weatherContext";
import {
  buildLens,
  buildRenderBody,
  projectWardrobe,
  GENERATOR_EXPECTATION,
  RequestContractError,
  WEATHER_BUCKETS,
  MAX_WEATHER_RAW_CHARS,
  type Intent,
  type LensWire,
  type WeatherBucket,
  type WardrobeItemSource,
  type WardrobeItemWire,
  type DroppedWardrobeItem,
  type RenderBody,
} from "@/lib/mlRequestAdapter";
import { isValidRequestId } from "@/lib/formats";
import { experienceCollection } from "@/models/OutfitExperience";
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
import { OwnerWriteUnavailable } from "@/lib/ownerWriteFence";
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
  WardrobeImage: any;
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
  weatherSource?: WeatherSource;
  weatherSignals?: WeatherSignals;
}
export interface WeatherInput {
  occasion: string;
  weather?: unknown; // client-frozen resolved bucket (F10 replay) — validated ∈ WEATHER_BUCKETS
  weatherRaw?: unknown;
  weatherSource?: unknown;
  weatherSignals?: unknown;
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
  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch (error) {
    console.error("Error verifying Firebase token:", error);
    return { error: "Invalid or expired token", status: 401 };
  }
  // Same failure-class split as lib/apiAuth (DEFECTS-H88): past token verification a throw is the
  // database — a retryable 503, never a 401 that sends a friend back through sign-in for nothing.
  try {
    const { User } = await initDatabase();
    const user = await User.findOne({ authProvider: "firebase", authId: decoded.uid }).exec();
    if (!user) return { error: "User not found", status: 404 };
    if (user.erasureStarted) return { error: "Account deletion is in progress", status: 409 };
    return { userId: user._id.toString() };
  } catch (error) {
    console.error("Database error resolving user:", error);
    return { error: "We're having trouble reaching your closet — please try again in a moment.", status: 503 };
  }
}

/** Only a manual expectation may be declared by the client. Other source values are
 * server-owned; legacy client-frozen buckets remain source-unknown. */
function manualWeather(input: WeatherInput): WeatherResolution | null {
  if (input.weatherSignals !== undefined && !validWeatherSignals(input.weatherSignals)) {
    throw new RequestContractError("weatherSignals requires exactly rain and wind booleans");
  }
  if (input.weatherSignals !== undefined && input.weatherSource !== "manual") {
    throw new RequestContractError("Only manual expected conditions may supply weatherSignals");
  }
  if (input.weatherSource == null) return null;
  if (input.weatherSource !== "manual") throw new RequestContractError("weatherSource must be manual when supplied");
  if (typeof input.weather !== "string" || !WEATHER_BUCKETS.includes(input.weather as WeatherBucket)) {
    throw new RequestContractError("Manual weather requires a resolved weather bucket");
  }
  if (input.weatherRaw != null && (typeof input.weatherRaw !== "string" ||
    input.weatherRaw.length > MAX_WEATHER_RAW_CHARS || !input.weatherRaw.isWellFormed() ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(input.weatherRaw))) {
    throw new RequestContractError(`Manual weather details must be plain text of at most ${MAX_WEATHER_RAW_CHARS} chars`);
  }
  return { weather: input.weather as WeatherBucket, weatherRaw: (input.weatherRaw as string | null | undefined) || null,
    weatherSource: "manual", ...(input.weatherSignals ? { weatherSignals: input.weatherSignals as WeatherSignals } : {}) };
}

/** Manual expected conditions take precedence over geo. Explicit legacy weather is
 * still honored for frozen-command compatibility; otherwise resolve fetched context,
 * then the occasion heuristic, then the mild fallback assumption. */
export async function resolveWeatherProd(input: WeatherInput): Promise<WeatherResolution> {
  const manual = manualWeather(input);
  if (manual) return manual;
  if (input.weather != null) {
    if (typeof input.weather !== "string" || !WEATHER_BUCKETS.includes(input.weather as WeatherBucket)) {
      throw new RequestContractError("weather must be a resolved M5 bucket");
    }
    const raw = typeof input.weatherRaw === "string" ? input.weatherRaw : null;
    return { weather: input.weather as WeatherBucket, weatherRaw: raw, weatherSource: "unknown" };
  }
  if (typeof input.lat === "number" && typeof input.lon === "number") {
    const ctx = await getWeatherContext({
      lat: input.lat,
      lon: input.lon,
      eventTimeISO: typeof input.eventTimeISO === "string" ? input.eventTimeISO : undefined,
    });
    if (ctx) {
      return { weather: bucketFromTemp(ctx), weatherRaw: ctx.weatherSummary,
        weatherSource: ctx.isForecast ? "forecast" : "current", weatherSignals: ctx.weatherSignals };
    }
  }
  const weather = bucketFromSummary(input.occasion);
  return { weather, weatherRaw: null, weatherSource: weather === "mild" ? "default" : "occasion" };
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
      get WardrobeImage() {
        return mongoose.models.WardrobeImage;
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
  const byId = new Map<string, Any>(wardrobeDocs.map((d) => [d._id.toString(), d]));
  const pinIds = new Set(lockedItemIds);
  if (forcedItemId) pinIds.add(forcedItemId);
  const seenTypes = new Set<string>();
  const tops: Any[] = [];
  for (const id of [...pinIds].sort()) {
    const item = byId.get(id);
    const type = String(item?.clothingType ?? "");
    if (!type) continue;
    if (type === "top") tops.push(item);
    else if (seenTypes.has(type)) return `more than one lock occupies the ${type} slot`;
    seenTypes.add(type);
  }
  if (tops.length > 2 || tops.length === 2 &&
      tops.filter(item => normalizeLayerRole(item.layerRole) === "mid").length !== 1) {
    return "locked tops need one base top and at most one mid layer";
  }
  if (seenTypes.has("dress") && (seenTypes.has("top") || seenTypes.has("bottom"))) {
    return "a locked dress cannot coexist with a locked top or bottom";
  }
  return null;
}

interface ShownVariation {
  mode?: "explore";
  sourceCandidateId: string;
  anchorItemId: string;
  leaveOutItemId?: string;
  occasion: string;
}
interface ActualVariation {
  experienceId: string;
  expectedRevision: number;
  anchorItemId: string;
  leaveOutItemId?: string;
  occasion: string;
}
function parseActualVariation(raw: unknown): ActualVariation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (!["anchorItemId,expectedRevision,experienceId,leaveOutItemId,occasion", "anchorItemId,expectedRevision,experienceId,occasion"].includes(Object.keys(value).sort().join(",")) ||
    typeof value.experienceId !== "string" || value.experienceId.length > 64 || !isValidRequestId(value.experienceId) ||
    !Number.isInteger(value.expectedRevision) || (value.expectedRevision as number) < 1 || (value.expectedRevision as number) > 32 ||
    typeof value.occasion !== "string" || !value.occasion.trim() || value.occasion.length > 500 ||
    typeof value.anchorItemId !== "string" || !/^[a-f0-9]{24}$/i.test(value.anchorItemId) ||
    ("leaveOutItemId" in value && (typeof value.leaveOutItemId !== "string" || !/^[a-f0-9]{24}$/i.test(value.leaveOutItemId)))) return null;
  return { ...value, experienceId: canonicalRequestId(value.experienceId) } as unknown as ActualVariation;
}
function parseShownVariation(raw: unknown): ShownVariation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const keys = Object.keys(value).filter(key => key !== "mode").sort().join(",");
  if (("mode" in value && value.mode !== "explore") ||
    !["anchorItemId,leaveOutItemId,occasion,sourceCandidateId", "anchorItemId,occasion,sourceCandidateId"].includes(keys) ||
    typeof value.sourceCandidateId !== "string" || !value.sourceCandidateId || value.sourceCandidateId.length > 128 ||
    typeof value.occasion !== "string" || !value.occasion.trim() || value.occasion.length > 500 ||
    typeof value.anchorItemId !== "string" || !/^[a-f0-9]{24}$/i.test(value.anchorItemId) ||
    ("leaveOutItemId" in value && (typeof value.leaveOutItemId !== "string" || !/^[a-f0-9]{24}$/i.test(value.leaveOutItemId)))) return null;
  return value as unknown as ShownVariation;
}

// ---------------------------------------------------------------------------
// The orchestrator.
// ---------------------------------------------------------------------------
export async function mlRecommend(request: NextRequest, deps: MlRecommendDeps): Promise<NextResponse> {
  let uncertainSnapshotWrite = false;
  let imageLease: { user: unknown; token: string; ids: Set<string> } | undefined;
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

    const { GenerationSnapshot, WardrobeItem, WardrobeImage, OutfitInteraction, User } = deps.models;
    if (body.weatherSignals !== undefined && (body.parentSnapshotId != null || body.variation != null || body.actualVariation != null))
      return respondError(400, "contract_invalid", "Child requests inherit weather signals from their source");
    if (body.weatherSource != null && (body.weatherSource !== "manual" || body.parentSnapshotId != null ||
      body.variation != null || body.actualVariation != null)) {
      return respondError(400, "contract_invalid", "Manual weather is available on new daily or rescue requests only");
    }
    if (body.controls && "excludedOutfitItemIds" in Object(body.controls)) {
      return respondError(400, "variation_invalid", "Explore from a shown source instead of supplying its pieces");
    }

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
      weatherSignals?: WeatherSignals;
      location: string | null;
      forcedItemId: string | null;
      seedDate: string;
      constraints: Record<string, unknown>;
    };
    let weatherSource: WeatherSource = "unknown";
    let parentCandidateCacheKey: string | null = null;
    let variationSourceCandidateId: string | null = null;
    let variationSourceExperienceId: string | null = null;
    let variationSourceRevision: number | null = null;
    let variationAnchorId: string | null = null;
    let variationLeaveOutId: string | null = null;

    if (body.actualVariation != null && (body.variation != null || body.parentSnapshotId != null ||
      body.controls != null || body.forcedItemId != null || body.occasion != null)) {
      return respondError(400, "variation_invalid", "Choose a reported outfit and a new situation");
    }
    const actualVariation = body.actualVariation == null ? null : parseActualVariation(body.actualVariation);
    if (body.actualVariation != null && !actualVariation) return respondError(400, "variation_invalid", "Invalid reported-outfit variation");
    const actualExperience = actualVariation && await experienceCollection().findOne({
      user: userObjectId, experienceId: actualVariation.experienceId,
    });
    if (actualVariation && (!actualExperience || actualExperience.lifecycle !== "active")) {
      return respondError(404, "experience_unavailable", "That reported outfit is unavailable");
    }
    if (actualVariation && actualExperience!.currentRevision !== actualVariation.expectedRevision) {
      return respondError(409, "experience_revision_conflict", "Reload the corrected outfit before adapting it");
    }
    if (actualVariation) {
      const actualIds = new Set((actualExperience!.memberItemIds ?? []).map(String));
      const latest = actualExperience!.revisions?.at(-1)?.state;
      if (latest?.compositionStatus !== "changed" || !actualIds.has(actualVariation.anchorItemId.toLowerCase()) ||
        (actualVariation.leaveOutItemId !== undefined && (!actualIds.has(actualVariation.leaveOutItemId.toLowerCase()) ||
        actualVariation.anchorItemId.toLowerCase() === actualVariation.leaveOutItemId.toLowerCase()))) {
        return respondError(404, "experience_source_unavailable", "Those pieces are not in the current reported outfit");
      }
    }
    const rawParent: unknown = actualExperience?.snapshotId?.toString() ?? body.parentSnapshotId;
    if (rawParent != null && rawParent !== "") {
      if (typeof rawParent !== "string" || !mongoose.isValidObjectId(rawParent)) {
        return respondError(404, "parent_not_found", "parentSnapshotId is not a valid id");
      }
      const parent = await GenerationSnapshot.findOne({ _id: rawParent, user: userObjectId }).lean();
      if (!parent) return respondError(404, "parent_not_found", "parent snapshot not found");
      if (!actualVariation && !await snapshotVisible(userObjectId, parent)) return respondError(404, "parent_not_found", "parent snapshot is unavailable");
      // Plain reroll would drop report-revision provenance or explored-source exclusion.
      // Explicit source-bound variations retain the applicable contract.
      if ((parent.variationSourceExperienceId || (parent.controls?.excludedOutfitItemIds?.length && !body.variation)) && !actualVariation) {
        return respondError(400, "variation_invalid", parent.variationSourceExperienceId
          ? "Start a new variation from the current wear report" : "Start a new variation from the saved proposal");
      }
      // Canonicalize to the stored (lowercase) ObjectId string: `.create()` casts the stored
      // parentSnapshotId to canonical form, so an uppercase-hex rawParent would make an identical
      // retry's identity compare (step 5) mismatch and wrongly 409 instead of replaying the winner.
      parentSnapshotId = new mongoose.Types.ObjectId(rawParent).toString();
      generationIndex = (parent.generationIndex ?? 0) + 1;
      if (actualVariation) {
        intent = "rescue_item";
        seedDate = deps.today();
        const anchorId = actualVariation.anchorItemId.toLowerCase();
        const leaveOutId = actualVariation.leaveOutItemId?.toLowerCase() ?? null;
        controls = { lockedItemIds: [], dislikedItemIds: leaveOutId ? [leaveOutId] : [] };
        const resolved = await deps.resolveWeather({ occasion: actualVariation.occasion });
        weatherSource = weatherSourceFromSnapshot(resolved.weatherSource);
        lensInput = {
          occasion: actualVariation.occasion, weather: resolved.weather, weatherRaw: resolved.weatherRaw, weatherSignals: weatherSignalsFromSnapshot(resolved.weatherSignals),
          location: null, forcedItemId: anchorId, seedDate, constraints: {},
        };
        variationSourceExperienceId = actualVariation.experienceId;
        variationSourceRevision = actualVariation.expectedRevision;
        variationAnchorId = anchorId;
        variationLeaveOutId = leaveOutId;
      } else if (body.variation != null) {
        const variation = parseShownVariation(body.variation);
        if (!variation || body.controls != null || body.forcedItemId != null || body.occasion != null || parent.redacted) {
          return respondError(400, "variation_invalid", "Choose a shown outfit, a garment to keep, an optional different garment to leave out, and a new situation");
        }
        const source = parent.shownCandidateIds?.includes(variation.sourceCandidateId)
          ? parent.candidates?.find((candidate: Any) => candidate.candidateId === variation.sourceCandidateId) : null;
        const sourceIds = new Set<string>((source?.items ?? []).map((item: Any) => String(item.itemId).toLowerCase()));
        const anchorId = variation.anchorItemId.toLowerCase();
        const leaveOutId = variation.leaveOutItemId?.toLowerCase() ?? null;
        if (!source || !sourceIds.has(anchorId) || (leaveOutId !== null && (!sourceIds.has(leaveOutId) || anchorId === leaveOutId))) {
          return respondError(404, "variation_source_unavailable", "That shown outfit is unavailable for variation");
        }
        intent = "rescue_item";
        seedDate = deps.today();
        controls = { lockedItemIds: [], dislikedItemIds: leaveOutId ? [leaveOutId] : [],
          ...(variation.mode === "explore" ? { excludedOutfitItemIds: [...sourceIds].sort() } : {}),
        };
        if (variation.mode === "explore") {
          if (variation.occasion !== parent.occasion) return respondError(400, "variation_invalid", "Exploration uses the saved situation");
          seedDate = parent.seedDate;
          weatherSource = weatherSourceFromSnapshot(parent.weatherSource);
          lensInput = {
            occasion: parent.occasion, weather: parent.weather, weatherRaw: parent.weatherRaw ?? null, weatherSignals: weatherSignalsFromSnapshot(parent.weatherSignals),
            location: parent.location ?? null, forcedItemId: anchorId, seedDate, constraints: {},
          };
        } else {
          const resolved = await deps.resolveWeather({ occasion: variation.occasion });
          weatherSource = weatherSourceFromSnapshot(resolved.weatherSource);
          lensInput = {
            occasion: variation.occasion, weather: resolved.weather, weatherRaw: resolved.weatherRaw, weatherSignals: weatherSignalsFromSnapshot(resolved.weatherSignals),
            location: null, forcedItemId: anchorId, seedDate, constraints: {},
          };
        }
        variationSourceCandidateId = variation.sourceCandidateId;
        variationAnchorId = anchorId;
        variationLeaveOutId = leaveOutId;
      } else {
        intent = parent.intent as Intent;
        seedDate = parent.seedDate;
        parentCandidateCacheKey = parent.candidateCacheKey ?? null;
        weatherSource = weatherSourceFromSnapshot(parent.weatherSource);
        controls = normalizeControls(body.controls);
        lensInput = {
          occasion: parent.occasion,
          weather: parent.weather,
          weatherRaw: parent.weatherRaw ?? null,
          weatherSignals: weatherSignalsFromSnapshot(parent.weatherSignals),
          location: parent.location ?? null,
          forcedItemId: parent.forcedItemId ?? null,
          seedDate: parent.seedDate,
          constraints: {},
        };
      }
    } else {
      if (body.variation != null || actualVariation) return respondError(400, "variation_invalid", "A source is required for variation");
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
      const weatherInput: WeatherInput = {
        occasion: body.occasion,
        weather: body.weather,
        weatherRaw: body.weatherRaw,
        weatherSource: body.weatherSource,
        weatherSignals: body.weatherSignals,
        lat: body.lat,
        lon: body.lon,
        eventTimeISO: body.eventTimeISO,
      };
      let manual: WeatherResolution | null;
      try { manual = manualWeather(weatherInput); }
      catch (err) {
        if (err instanceof RequestContractError) return respondError(400, "contract_invalid", err.message);
        throw err;
      }
      const resolved = manual ?? await deps.resolveWeather(weatherInput);
      weatherSource = weatherSourceFromSnapshot(resolved.weatherSource);
      lensInput = {
        occasion: body.occasion,
        weather: resolved.weather,
        weatherRaw: resolved.weatherRaw,
        weatherSignals: weatherSignalsFromSnapshot(resolved.weatherSignals),
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

    // A root command can explicitly freeze raw weather. Automatic forecasts are captured by
    // the winning render; a refreshed summary must not orphan that already-paid result.
    const frozenRaw = parentSnapshotId === null && body.weather != null &&
      (body.weatherSource === "manual" || Object.hasOwn(body, "weatherRaw"));
    if (frozenRaw && body.weatherRaw != null && typeof body.weatherRaw !== "string") {
      return respondError(400, "contract_invalid", "weatherRaw must be a string or null");
    }
    const sameFrozenWeather = (winner: Any) => {
      const winnerSource = weatherSourceFromSnapshot(winner.weatherSource);
      // Switching to/from a manual expectation changes the command even when its bucket agrees.
      if ((weatherSource === "manual" || winnerSource === "manual") && weatherSource !== winnerSource) return false;
      if (body.weatherSource === "manual" && !sameWeatherSignals(lens.weatherSignals, winner.weatherSignals)) return false;
      return !frozenRaw || (body.weatherRaw || null) === (winner.weatherRaw || null);
    };

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
      variationSourceCandidateId,
      variationSourceExperienceId,
      variationSourceRevision,
    });

    // 5. §C.4 early read-check: a completed-render retry replays the winner; a reused requestId for a
    //    DIFFERENT render identity is a conflict (G5).
    const existing = await GenerationSnapshot.findOne({ user: userObjectId, requestId }).lean();
    if (existing) {
      if (!await snapshotVisible(userObjectId, existing)) return respondError(404, "proposal_unavailable", "That proposal is no longer available");
      if (identityMatches(incomingIdentity, identityFromDoc(existing)) && sameFrozenWeather(existing)) {
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

    // Capture the exact owned rows before the long service call. If deletion already won,
    // omit the missing photo honestly from both evidence and engine-visible URLs; never refetch
    // the garment's newer replacement. Pins are non-expiring because a paused writer can resume.
    imageLease = { user: userObjectId, token: snapshotId, ids: new Set() };
    const activeLease = imageLease;
    await withImageConcurrency(wardrobeDocs, async item => {
      const pathId = mongoImageId(item.imagePath);
      const urlId = localImageId(item.imageUrl);
      if (typeof item.imagePath === "string" && item.imagePath.startsWith("mongo:") && !pathId) delete item.imagePath;
      if (typeof item.imageUrl === "string" && (item.imageUrl.startsWith("/api/images/") || item.imageUrl.startsWith("mongo:")) && !urlId) delete item.imageUrl;
      for (const imageId of new Set([pathId, urlId].filter((id): id is string => !!id))) {
        activeLease.ids.add(imageId);
        const pin = await WardrobeImage.updateOne(
          { _id: imageId, user: userObjectId, wardrobeItem: item._id },
          { $addToSet: { generationLeases: snapshotId } },
        ).exec();
        if (pin.matchedCount === 0) {
          if (pathId === imageId) delete item.imagePath;
          if (urlId === imageId) delete item.imageUrl;
        } else if (!pathId && urlId === imageId) {
          // A legacy local URL-only row still has exact owned pixels: capture canonical evidence.
          item.imagePath = `mongo:${imageId}`;
        }
      }
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
        weatherSignals: lens.weatherSignals,
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

    // 10. TS merge (server-owned fields/provenance + raw-field caps + per-item evidence). A service-invented
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
        weatherSource,
        weatherSignals: lens.weatherSignals,
      });
      if (payload.layerChoice) {
        const choice = payload.layerChoice as { status: string };
        const active = ["mild", "cold"].includes(lens.weather) && Boolean(lens.weatherSignals?.rain || lens.weatherSignals?.wind);
        const layered = (doc.candidates as Any[]).some(candidate => candidate.shown &&
          candidate.items.some((item: Any) => item.role === "outer_layer"));
        if ((!active && choice.status !== "off") || (active && choice.status !== (layered ? "offered" : "gap")))
          return respondDegraded("contract_invalid");
      }
      if (variationSourceCandidateId || variationSourceExperienceId) {
        const shownIds = doc.shownCandidateIds as string[];
        const byId = new Map<string, Any>((doc.candidates as Any[]).map(candidate => [candidate.candidateId, candidate]));
        if (shownIds.some(id => {
          const members = new Set<string>((byId.get(id)?.items ?? []).map((item: Any) => String(item.itemId)));
          const excluded = controls.excludedOutfitItemIds;
          return !members.has(variationAnchorId!) || (variationLeaveOutId !== null && members.has(variationLeaveOutId)) ||
            (excluded !== undefined && members.size === excluded.length && excluded.every(id => members.has(id)));
        })) return respondDegraded("contract_invalid");
        if (variationSourceCandidateId) doc.variationSourceCandidateId = variationSourceCandidateId;
        if (variationSourceExperienceId) {
          doc.variationSourceExperienceId = variationSourceExperienceId;
          doc.variationSourceRevision = variationSourceRevision;
        }
      }
    } catch (err) {
      if (err instanceof PayloadContractError) {
        console.warn("[render] buildSnapshotDoc rejected the paid payload → contract_invalid");
        return respondDegraded("contract_invalid");
      }
      throw err;
    }

    // A source can be redacted while the service is running. Do not persist a new proposal whose
    // claimed shown source has disappeared during that paid call.
    if (variationSourceCandidateId && !await GenerationSnapshot.exists({
      _id: parentSnapshotId, user: userObjectId, redacted: { $ne: true },
    })) return respondError(404, "variation_source_unavailable", "That shown outfit is unavailable for variation");
    if (variationSourceExperienceId && !await experienceCollection().findOne({
      user: userObjectId, experienceId: variationSourceExperienceId, lifecycle: "active",
      currentRevision: variationSourceRevision!,
    }, { projection: { _id: 1 } })) {
      return respondError(409, "experience_revision_conflict", "Reload the corrected outfit before adapting it");
    }

    // 11. §C.4 idempotent write. Non-E11000 failure → degrade (no binding token for an unpersisted row).
    let writeResult;
    try {
      writeResult = await writeSnapshotWithIdempotency<Any>(GenerationSnapshot, doc, userObjectId, requestId, User);
    } catch (err) {
      // A transport failure can return before the server commits. An immediate negative read
      // does not fence a later insert; keep non-expiring pins until erasure/operator reconciliation.
      uncertainSnapshotWrite = !(err instanceof mongoose.Error.ValidationError || err instanceof OwnerWriteUnavailable);
      console.error("GenerationSnapshot write failed:", err);
      return respondDegraded(err instanceof OwnerWriteUnavailable ? "auth_failed" : "service_unavailable");
    }

    // An already-admitted render may persist after erasure starts. Reject its binding
    // and self-erase acknowledged snapshots when the owner is flagged or absent.
    // The owner-write transaction is the fence; this check controls acknowledgements.
    const userStillExists = await User.exists({ _id: userObjectId, erasureStarted: { $ne: true } });
    if (!userStillExists) {
      await GenerationSnapshot.db
        .collection("generationsnapshots")
        .deleteMany({ user: userObjectId });
      return respondDegraded("auth_failed");
    }

    // A correction/retraction/erasure can land after the pre-write read. Hide a derivative
    // whose actual-wear basis is no longer current, including an idempotent race winner.
    if (variationSourceExperienceId && !await experienceCollection().findOne({
      user: userObjectId, experienceId: variationSourceExperienceId, lifecycle: "active",
      currentRevision: variationSourceRevision!,
    }, { projection: { _id: 1 } })) {
      await GenerationSnapshot.collection.updateMany({ user: userObjectId, requestId,
        variationSourceExperienceId, redacted: { $ne: true } },
      { $set: { redacted: true, redactedAt: new Date(), redactionReason: "experience_changed" } });
      return respondError(409, "experience_revision_conflict", "Reload the corrected outfit before adapting it");
    }

    if (writeResult.deduped) {
      // Lost the race: G5 must hold on the winner too, else a different-identity request slipped the
      // early check (a genuine concurrent double-submit of a different render under one token).
      const winner = writeResult.snapshot;
      if (!await snapshotVisible(userObjectId, winner)) return respondError(404, "proposal_unavailable", "That proposal is no longer available");
      if (!identityMatches(incomingIdentity, identityFromDoc(winner)) || !sameFrozenWeather(winner)) {
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
    const hasControls = controls.lockedItemIds.length > 0 || controls.dislikedItemIds.length > 0 || !!controls.excludedOutfitItemIds?.length;
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
  } finally {
    if (imageLease) await finishImageLeases(deps.models as ImageRetentionModels,
      imageLease.user, imageLease.token, imageLease.ids, !uncertainSnapshotWrite);
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
    variationSourceCandidateId: doc.variationSourceCandidateId,
    variationSourceExperienceId: doc.variationSourceExperienceId,
    variationSourceRevision: doc.variationSourceRevision,
  });
}
