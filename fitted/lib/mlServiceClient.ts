/**
 * M5 render-service client (C5, seam #3) — the Next→Fly.io `POST /render` call, its timeout, and
 * the §A/§D degraded-empty-state mapping.
 *
 * The service is stateless and holds `OPENAI_API_KEY`; Next authenticates with the shared-secret
 * header `X-Fitted-Service-Key` (§A). Every failure mode the route must degrade on — unreachable,
 * timeout, 5xx, auth, rate-limit, or a `contract_invalid` envelope AFTER a service call — is
 * folded here into a single `{ ok: false, reasonHint }` result so the route can uniformly discard
 * the pre-allocated snapshotId and return the §A empty state (never a 500, never legacy).
 *
 * A `contract_invalid` returned by the SERVICE is a Next↔service drift (the wire generator
 * expectation vs the service config, or a bad Lens) — it maps to the same degraded state; the
 * request-adapter's own pre-service RequestContractError is the *input*-side of the same code.
 *
 * Reference: docs/plans/m5-cutover.md §A wire contract + degraded response, §D H12 trigger set.
 */
import type { RenderBody } from "@/lib/mlRequestAdapter";

/** Next's own timeout for the whole service round-trip. Must exceed the service's OpenAI timeout
 *  (30s) + overhead and sit below the route `maxDuration` (§D/G6 — tuned at route integration).
 *  A garbage env override falls back to the default (a NaN would make AbortSignal.timeout throw,
 *  degrading every call). */
function envTimeoutMs(): number {
  const raw = process.env.ML_SERVICE_TIMEOUT_MS;
  if (raw == null) return 45_000;
  const n = Number(raw);
  // Clamp an operator override well under the route maxDuration (60s), leaving ~10s for the
  // pre-service Mongo reads + post-service write — the recommend route's documented
  // PRE + SERVICE_TIMEOUT + WRITE_MARGIN < 60s budget. This makes the AbortSignal.timeout degrade
  // normally win the race against Vercel's raw-504 kill; it is not an absolute guarantee under a
  // pathological cold-start (a multi-second pre-read could still push the abort past 60s). The
  // unset default (45s) carries the full ~15s margin.
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50_000) : 45_000;
}
export const SERVICE_TIMEOUT_MS = envTimeoutMs();

/** The §A degraded-state reason codes (machine-code register — the browser maps to localized copy). */
export type DegradedReasonHint =
  | "service_unavailable"
  | "contract_invalid"
  | "rate_limited"
  | "auth_failed";

/** A successful service render — the payload is opaque here; seam #5 validates + persists it. */
export interface RenderServiceResponse {
  payload: Record<string, unknown>;
  shown: Array<{ candidateId: string; outfit?: unknown }>;
  flags: {
    notEnoughItems: boolean;
    insufficientAfterGeneration: boolean;
    spreadCollapsed: boolean;
    reasonHint: string | null;
  };
  degenerate: boolean;
}

export type RenderServiceResult =
  | { ok: true; response: RenderServiceResponse }
  | { ok: false; reasonHint: DegradedReasonHint };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRenderServiceResponse(value: unknown): value is RenderServiceResponse {
  if (!isObject(value)) return false;
  if (!isObject(value.payload)) return false;
  if (!Array.isArray(value.shown)) return false;
  if (!isObject(value.flags)) return false;
  return typeof value.degenerate === "boolean";
}

/** The §A degraded browser empty state — no snapshot, no binding token, no feedback controls. */
export interface DegradedBrowserResponse {
  shown: [];
  displayItems: [];
  bindable: false;
  flags: {
    notEnoughItems: false;
    insufficientAfterGeneration: false;
    spreadCollapsed: false;
    reasonHint: DegradedReasonHint;
  };
}

export function buildDegradedResponse(reasonHint: DegradedReasonHint): DegradedBrowserResponse {
  return {
    shown: [],
    displayItems: [],
    bindable: false,
    flags: {
      notEnoughItems: false,
      insufficientAfterGeneration: false,
      spreadCollapsed: false,
      reasonHint,
    },
  };
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

/** Map an HTTP status + parsed error envelope to the degraded reason code (§D trigger set). */
function degradeFromResponse(status: number, envelope: ErrorEnvelope | null): DegradedReasonHint {
  const code = envelope?.error?.code;
  if (status === 401 || code === "auth") return "auth_failed";
  if (status === 429 || code === "rate_limit") return "rate_limited";
  if (code === "contract_invalid") return "contract_invalid";
  // 5xx, "internal", or any unrecognized non-2xx → generic outage.
  return "service_unavailable";
}

export interface CallRenderServiceOptions {
  serviceUrl?: string;
  serviceKey?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * POST the render body to the service. NEVER throws for an operational failure — every failure is
 * a `{ ok: false, reasonHint }` the route degrades on. (A programming error — e.g. a missing
 * service URL — still throws, since it is not an outage.)
 */
export async function callRenderService(
  body: RenderBody,
  opts: CallRenderServiceOptions = {},
): Promise<RenderServiceResult> {
  const serviceUrl = opts.serviceUrl ?? process.env.ML_SERVICE_URL;
  const serviceKey = opts.serviceKey ?? process.env.FITTED_SERVICE_KEY;
  const timeoutMs = opts.timeoutMs ?? SERVICE_TIMEOUT_MS;
  const doFetch = opts.fetchImpl ?? fetch;

  if (!serviceUrl) throw new Error("ML_SERVICE_URL is not configured");
  if (!serviceKey) throw new Error("FITTED_SERVICE_KEY is not configured");

  const endpoint = `${serviceUrl.replace(/\/$/, "")}/render`;

  let res: Response;
  try {
    res = await doFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fitted-Service-Key": serviceKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // Transport failure: unreachable, DNS, connection reset, OR our own AbortSignal.timeout firing.
    // All are the same outage from the browser's perspective (§D — Next catch).
    console.warn("[render] service unreachable/timeout → degrade (service_unavailable)");
    return { ok: false, reasonHint: "service_unavailable" };
  }

  if (!res.ok) {
    let envelope: ErrorEnvelope | null = null;
    try {
      envelope = (await res.json()) as ErrorEnvelope;
    } catch {
      envelope = null;
    }
    const reasonHint = degradeFromResponse(res.status, envelope);
    // Observability for the collection mission: a silent 200-empty state means zero yield. A wrong
    // service key (401→auth_failed) or a service hiccup should be visible in the logs, not invisible.
    console.warn(`[render] service HTTP ${res.status} → degrade (${reasonHint})`);
    return { ok: false, reasonHint };
  }

  // 2xx — a degenerate payload is STILL a 2xx (the service returns it for a paid-but-no-JSON run,
  // §A.6/§D); the route writes it as a snapshot. A body that won't parse is treated as an outage.
  try {
    const response = (await res.json()) as unknown;
    if (!isRenderServiceResponse(response)) {
      console.warn("[render] 2xx payload failed shape validation → degrade (contract_invalid)");
      return { ok: false, reasonHint: "contract_invalid" };
    }
    return { ok: true, response };
  } catch {
    console.warn("[render] 2xx body failed to parse → degrade (service_unavailable)");
    return { ok: false, reasonHint: "service_unavailable" };
  }
}
