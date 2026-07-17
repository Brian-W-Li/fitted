/**
 * M5 request adapter (C5, seam #3) — the trust boundary that maps the deployed request into the
 * stateless render service's `POST /render` wire body.
 *
 *   - `buildLens`        §F Lens adapter table (deployed request → service `lens`)
 *   - `projectWardrobe`  §15.2 item map (WardrobeItemDocument → engineVisible wire item)
 *   - `GENERATOR_EXPECTATION` the Next-side EXACTLY-MIRRORED expectation of the service generator
 *                        config (§A: the service authors provenance from its OWN config; this wire
 *                        object is exact-match-validated by the service — a mismatch is
 *                        `contract_invalid` pre-spend, never clamped)
 *   - `buildRenderBody`  assembles the full wire body from the identity/lineage/behavioral parts
 *                        the route + later seams supply
 *
 * This adapter REJECTS invalid *envelope* fields before any service call or write — Mongoose must
 * never be the first validator mid-write (§F wire-validation / R12). Envelope rejections (a bad
 * Lens, a control-id array over cap, a wardrobe over the request cap) throw RequestContractError,
 * which the route maps to the §A `contract_invalid` degraded state.
 *
 * Per-ITEM faults are handled differently: a single malformed wardrobe row is DROPPED (with a
 * reason), never fatal — one stored-but-corrupt garment must not cost the user their other items
 * (the green-shirt resilience promise; the render is well-defined without the bad row). See
 * `projectWardrobe`. The route re-escalates a drop that a control explicitly references
 * (forcedItemId / locked / disliked) back to a hard reject, since the user pointed at that item.
 *
 * The membership of every wire object is owned cross-runtime by `ml-system/service/contract.py` +
 * its mirror `contract_fields.json`; the C5 acceptance gate asserts this adapter's emitted keys
 * equal that file's `wireBoundaries` (tests/mlRequestAdapter.test.ts). Field-set edits happen
 * there, never here.
 *
 * Reference: docs/plans/m5-cutover.md §A/§F, docs/Fitted_Spec_v2.md §15.2.
 */
import { CLOTHING_TYPES, type ClothingType } from "@/lib/clothingType";
import { SEED_DATE_RE } from "@/lib/formats";

// ---------------------------------------------------------------------------
// Next-side mirror of ml-system/service/config.py (§A "one home service-side + mirrored
// Next-side"). These MUST track the service config; the service exact-match-validates the wire
// `generator` block and independently re-clamps text/arrays, so a drift here fails loud
// (contract_invalid) rather than silently — but keeping them in sync avoids a self-inflicted
// pre-spend rejection on every render.
// ---------------------------------------------------------------------------

/** Parse a positive-int env override, falling back on absent/garbage (a NaN here would emit `null`
 *  on the wire → a pre-spend contract_invalid on every render; fail to the safe default instead). */
function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** §A.6 generator surface — mirrors config.GENERATOR_* + OPENAI_TIMEOUT_SECONDS/OPENAI_MAX_RETRIES. */
export const GENERATOR_EXPECTATION = {
  provider: "openai",
  model: "gpt-5.4-mini",
  temperature: 0.5,
  // Env-overridable within the service band (MIN_COMPLETION_TOKENS_FLOOR..MAX_COMPLETION_TOKENS_CEILING);
  // read the SAME env name the service does so the two stay in sync across a deploy-time tune.
  maxCompletionTokens: envPositiveInt("M5_MAX_COMPLETION_TOKENS", 2200),
  apiSurface: "chat_completions",
  responseFormat: "json_schema_strict",
  reasoningEffort: "none",
  storeMode: "none",
  promptCacheRetention: "in_memory",
  timeoutSeconds: 30,
  maxRetries: 0,
} as const;

/** §A/G7 input clamps — mirror of config.MAX_* (values are defaults; the load-bearing part is they
 *  are concrete + boundary-tested on both sides). */
export const MAX_OCCASION_CHARS = 200;
export const MAX_WEATHER_RAW_CHARS = 120;
export const MAX_LOCATION_CHARS = 120;
export const MAX_WARDROBE_ITEMS = 2000;
export const MAX_CONTROL_IDS = 50;
// Per-item clamps — mirror of config.MAX_ITEM_* (§A "Service-side clamp additions"). The service
// _string_list REJECTS a blank/whitespace tag or an over-cap tag/name with contract_invalid for
// the WHOLE render, so the adapter must sanitize deployed data to pass (⚠ C5 mirror obligation,
// m5-cutover.md) — else one stored-but-over-clamp item makes a closet permanently unrenderable.
export const MAX_ITEM_NAME_CHARS = 200;
export const MAX_ITEM_TAG_CHARS = 60;
export const MAX_ITEM_TAGS = 25;
// imageUrl is stored engineVisible but never reaches the prompt (H33). The service REJECTS an
// over-cap imageUrl for the WHOLE render, so a stored data-URI / very long signed URL would make a
// closet permanently unrenderable — the adapter drops an over-cap URL to "" (⚠ mirror obligation,
// config.MAX_IMAGE_URL_CHARS; a blank imageUrl is legitimate, §15.2).
export const MAX_IMAGE_URL_CHARS = 2048;

/** The R5 weather buckets — mirror of config.WEATHER_BUCKETS + the GenerationSnapshot.weather enum. */
export const WEATHER_BUCKETS = ["hot", "mild", "cold", "indoor", "outdoor"] as const;
export type WeatherBucket = (typeof WEATHER_BUCKETS)[number];

/** The implemented M5 intent set — mirror of config.SUPPORTED_INTENTS. */
export const SUPPORTED_INTENTS = ["daily", "rescue_item"] as const;
export type Intent = (typeof SUPPORTED_INTENTS)[number];

// ---------------------------------------------------------------------------
// The one predictable error channel (§F / R12). Every invalid-input rejection is this; the route
// maps it to the §A `contract_invalid` degraded browser state (never a 500, never legacy).
// ---------------------------------------------------------------------------
export class RequestContractError extends Error {
  readonly code = "contract_invalid";
  constructor(message: string) {
    super(message);
    this.name = "RequestContractError";
  }
}

// ---------------------------------------------------------------------------
// §15.2 item map — deployed WardrobeItem → the engineVisible wire projection.
// ---------------------------------------------------------------------------

/** The deployed columns the item map reads (a structural slice of WardrobeItemDocument). */
export interface WardrobeItemSource {
  _id: { toString(): string };
  name: string;
  clothingType: string; // M4 5-value, written natively
  warmth: number; // M4 column, keyword-derived at ingestion (0..10)
  colors?: string[];
  occasions?: string[];
  imageUrl?: string;
  imagePath?: string; // e.g. "mongo:<imageId>" — the deployed image reference (§15.2 fallback)
}

/** §15.2 image resolution: `imageUrl → else resolve imagePath → else ""`. Pure — the deployed
 *  `mongo:<id>` path maps to the `/api/images/<id>` route (imageStorage.ts / dashboard), no DB read.
 *  An over-cap result (a data-URI or a very long signed URL) is dropped to "" rather than emitted:
 *  the service rejects an over-`MAX_IMAGE_URL_CHARS` imageUrl for the whole render, and no-image is a
 *  legitimate projection (§15.2), so this keeps one bad-URL item from making a closet unrenderable. */
function resolveImageUrl(item: WardrobeItemSource): string {
  const resolved = resolveRawImageUrl(item);
  return resolved.length > MAX_IMAGE_URL_CHARS ? "" : resolved;
}
function resolveRawImageUrl(item: WardrobeItemSource): string {
  if (typeof item.imageUrl === "string" && item.imageUrl) return item.imageUrl;
  const p = item.imagePath;
  if (typeof p !== "string") return "";
  if (p.startsWith("mongo:")) return `/api/images/${p.slice("mongo:".length)}`;
  return p;
}

/** Trim, drop blank + over-length elements, and cap the count — mirrors the service _string_list so
 *  a stored-but-untrimmed tag never rejects the whole render. Blank/over-long tags are noise
 *  (dropped, not truncated — truncating would fabricate a corrupt tag). Callers guarantee an
 *  array-or-nil (a scalar container is a per-item drop, decided in `tryProjectWardrobeItem`). */
function sanitizeTags(tags: string[] | undefined): string[] {
  if (tags == null) return [];
  return tags
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= MAX_ITEM_TAG_CHARS)
    .slice(0, MAX_ITEM_TAGS);
}

/** The wire item shape (camelCase; membership owned by contract_fields.json wardrobeItem). */
export interface WardrobeItemWire {
  id: string;
  name: string;
  clothingType: string;
  warmth: number;
  colorTags: string[];
  occasionTags: string[];
  styleTags: string[]; // no column until the W-track → []
  material: string | null; // no column until the W-track → null
  formality: string | null;
  imageUrl: string;
}

/** A wardrobe row excluded from a render because its stored data is unusable. `id` is the item's
 *  ObjectId (or a placeholder when the row has none); `reason` is a short, non-sensitive tag. */
export interface DroppedWardrobeItem {
  id: string;
  reason: string;
}

/** The result of projecting a wardrobe: the good wire items + the rows that were dropped. */
export interface WardrobeProjection {
  wire: WardrobeItemWire[];
  dropped: DroppedWardrobeItem[];
}

function isStringArrayOrNil(v: unknown): v is string[] | undefined {
  return v == null || Array.isArray(v);
}

/** Project ONE wardrobe row, or report it as a per-item drop. A per-garment fault (bad/absent id,
 *  non-string/blank name, out-of-range warmth, a clothingType outside the 5-value set, a scalar
 *  tag container) means the row is unusable — the render is still well-defined without it, so it is
 *  DROPPED, never thrown. We never coerce a bad value (clamping warmth or guessing a clothingType
 *  would fabricate signal the user never entered, poisoning the immutable M6 corpus); sanitize
 *  removes noise, it does not invent data. Clean-DB ingestion keeps these latent today, but the
 *  resilience promise is about messy CV-derived / legacy / hand-edited rows — the data M6 needs. */
function tryProjectWardrobeItem(
  item: WardrobeItemSource,
): { ok: true; wire: WardrobeItemWire } | { ok: false; id: string; reason: string } {
  const id = item?._id?.toString?.() ?? "";
  if (!id) return { ok: false, id: "(no id)", reason: "missing id" };
  if (typeof item.name !== "string") return { ok: false, id, reason: "non-string name" };
  const name = item.name.trim();
  if (!name) return { ok: false, id, reason: "blank name" };
  // warmth is contractually an INTEGER 0..10 (§15.2; the service's `_non_bool_int` rejects a float
  // for the WHOLE render). Next's drop-predicate must match the service's accept-predicate exactly,
  // else a fractional row passes here and sinks the closet service-side. Number.isInteger also
  // rejects NaN/±Infinity.
  if (typeof item.warmth !== "number" || !Number.isInteger(item.warmth) || item.warmth < 0 || item.warmth > 10) {
    return { ok: false, id, reason: "warmth not an integer in [0,10]" };
  }
  // clothingType must be in the 5-value ontology (single-homed in lib/clothingType; the service
  // independently rejects an unknown clothingType for the WHOLE render, so a stale/undefined value
  // reaching the wire would sink every item — drop the one bad row instead).
  if (!CLOTHING_TYPES.includes(item.clothingType as ClothingType)) {
    return { ok: false, id, reason: "clothingType not in the 5-value set" };
  }
  if (!isStringArrayOrNil(item.colors)) return { ok: false, id, reason: "colors is not an array" };
  if (!isStringArrayOrNil(item.occasions)) return { ok: false, id, reason: "occasions is not an array" };
  return {
    ok: true,
    wire: {
      id,
      // Cap the name to the service limit (⚠ mirror obligation — an over-long name would reject the
      // whole render). The untrimmed/untruncated original is preserved verbatim in the snapshot's
      // evidence{} block server-side (§15.1); engineVisible carries the bounded projection.
      name: name.length > MAX_ITEM_NAME_CHARS ? name.slice(0, MAX_ITEM_NAME_CHARS) : name,
      clothingType: item.clothingType,
      warmth: item.warmth,
      colorTags: sanitizeTags(item.colors),
      occasionTags: sanitizeTags(item.occasions),
      styleTags: [],
      material: null,
      formality: null,
      imageUrl: resolveImageUrl(item),
    },
  };
}

/** Project a wardrobe into wire items, partitioning off any unusable rows (see
 *  `tryProjectWardrobeItem`). The `MAX_WARDROBE_ITEMS` request bound is an ENVELOPE fault (the whole
 *  request is malformed) and still throws; per-item faults become `dropped` entries. The route
 *  re-escalates a dropped row that a control references (forcedItemId / locked / disliked) to a hard
 *  reject; other drops are logged, and the render proceeds on the good items (the engine reports
 *  `notEnoughItems` itself if too few remain). The engine still per-type-caps to 135. */
export function projectWardrobe(items: WardrobeItemSource[]): WardrobeProjection {
  if (items.length > MAX_WARDROBE_ITEMS) {
    throw new RequestContractError(
      `wardrobe has ${items.length} items, over the ${MAX_WARDROBE_ITEMS} request cap`,
    );
  }
  const wire: WardrobeItemWire[] = [];
  const dropped: DroppedWardrobeItem[] = [];
  for (const item of items) {
    const result = tryProjectWardrobeItem(item);
    if (result.ok) wire.push(result.wire);
    else dropped.push({ id: result.id, reason: result.reason });
  }
  return { wire, dropped };
}

// ---------------------------------------------------------------------------
// §F Lens adapter — deployed request → the service `lens` object.
// ---------------------------------------------------------------------------

export interface LensAdapterInput {
  occasion: string;
  /** The R5 bucket — resolved from the raw weather BEFORE the adapter (the route buckets; the
   *  service does not read a clock or a network). */
  weather: string;
  weatherRaw?: string | null;
  location?: string | null;
  forcedItemId?: string | null;
  /** Required UTC YYYY-MM-DD (H8) — computed Next-side, passed in for determinism. */
  seedDate: string;
  /** M5 requires {} (H36 deferred); a non-empty map is rejected before the service call. */
  constraints?: Record<string, unknown>;
}

export interface LensWire {
  occasion: string;
  weather: WeatherBucket;
  weatherRaw: string | null;
  location: string | null;
  forcedItemId: string | null;
  seedDate: string;
  constraints: Record<string, never>;
}

export function buildLens(input: LensAdapterInput, intent: Intent): LensWire {
  // occasion — trim-check REJECT (whitespace-only passes Mongoose required; a trimmed-blank occasion
  // is a corrupt Lens). Never trim-and-proceed (§F).
  if (typeof input.occasion !== "string" || !input.occasion.trim()) {
    throw new RequestContractError("occasion is blank");
  }
  if (input.occasion.length > MAX_OCCASION_CHARS) {
    throw new RequestContractError(`occasion exceeds ${MAX_OCCASION_CHARS} chars`);
  }
  // weather — must be a resolved bucket; an un-bucketed raw would throw Mongoose enum on write.
  if (!WEATHER_BUCKETS.includes(input.weather as WeatherBucket)) {
    throw new RequestContractError(`weather ${JSON.stringify(input.weather)} is not a valid bucket`);
  }
  // seedDate — required UTC YYYY-MM-DD (H8); missing/malformed is contract_invalid.
  if (!input.seedDate || !SEED_DATE_RE.test(input.seedDate)) {
    throw new RequestContractError("seedDate must be a UTC YYYY-MM-DD string");
  }
  // optional text clamps
  if (input.weatherRaw != null && input.weatherRaw.length > MAX_WEATHER_RAW_CHARS) {
    throw new RequestContractError(`weatherRaw exceeds ${MAX_WEATHER_RAW_CHARS} chars`);
  }
  if (input.location != null && input.location.length > MAX_LOCATION_CHARS) {
    throw new RequestContractError(`location exceeds ${MAX_LOCATION_CHARS} chars`);
  }
  // constraints — M5 defers; must be {} (non-empty rejected before the service call).
  const constraints = input.constraints ?? {};
  if (Object.keys(constraints).length > 0) {
    throw new RequestContractError("constraints must be empty at M5 (H36 deferred)");
  }
  // forcedItemId — required iff intent="rescue_item" (mirrors RenderRequest.__post_init__).
  const forcedItemId = input.forcedItemId ?? null;
  if (intent === "rescue_item" && !forcedItemId) {
    throw new RequestContractError("forcedItemId is required for a rescue_item render");
  }
  if (intent === "daily" && forcedItemId) {
    throw new RequestContractError("forcedItemId is not allowed on a daily render");
  }

  return {
    occasion: input.occasion,
    weather: input.weather as WeatherBucket,
    weatherRaw: input.weatherRaw ?? null,
    location: input.location ?? null,
    forcedItemId,
    seedDate: input.seedDate,
    constraints: {},
  };
}

// ---------------------------------------------------------------------------
// The full `POST /render` wire body. The identity/lineage/behavioral parts are supplied by the
// route + later seams; this assembler owns only their composition + the generator expectation.
// ---------------------------------------------------------------------------

export interface ControlsWire {
  lockedItemIds: string[];
  dislikedItemIds: string[];
}

/** Raw behavioral rows the SERVICE reduces (seam #4 builds these from Mongo). Opaque here. */
export interface BehavioralRowsWire {
  recentSnapshots?: unknown[];
  interactionRows?: unknown[];
}

export interface RenderBodyParts {
  snapshotId: string;
  requestId: string;
  sessionId: string;
  intent: Intent;
  generationIndex: number;
  parentSnapshotId: string | null;
  controls: ControlsWire;
  lens: LensWire;
  wardrobe: WardrobeItemWire[];
  wardrobeVersion: number;
  interactionCountAtRequest: number;
  behavioralRows?: BehavioralRowsWire;
}

export interface RenderBody extends Omit<RenderBodyParts, "behavioralRows"> {
  behavioralRows: BehavioralRowsWire;
  generator: typeof GENERATOR_EXPECTATION;
}

/** Validate the control id arrays + assemble the full wire body. */
export function buildRenderBody(parts: RenderBodyParts): RenderBody {
  for (const [field, ids] of [
    ["lockedItemIds", parts.controls.lockedItemIds],
    ["dislikedItemIds", parts.controls.dislikedItemIds],
  ] as const) {
    if (ids.length > MAX_CONTROL_IDS) {
      throw new RequestContractError(`controls.${field} exceeds ${MAX_CONTROL_IDS} ids`);
    }
    for (const id of ids) {
      if (typeof id !== "string" || !id.trim()) {
        throw new RequestContractError(`controls.${field} contains a blank/non-string id`);
      }
    }
  }
  return {
    snapshotId: parts.snapshotId,
    requestId: parts.requestId,
    sessionId: parts.sessionId,
    intent: parts.intent,
    generationIndex: parts.generationIndex,
    parentSnapshotId: parts.parentSnapshotId,
    controls: parts.controls,
    lens: parts.lens,
    wardrobe: parts.wardrobe,
    wardrobeVersion: parts.wardrobeVersion,
    interactionCountAtRequest: parts.interactionCountAtRequest,
    behavioralRows: parts.behavioralRows ?? { recentSnapshots: [], interactionRows: [] },
    generator: GENERATOR_EXPECTATION,
  };
}
