import { NextRequest, NextResponse } from "next/server";

const CV_SERVICE_URL = process.env.CV_SERVICE_URL;

type CvInferLogBase = {
  ts: string;
  event: string;
  requestId: string;
};

function perfNowMs() {
  const p = globalThis.performance;
  if (p && typeof p.now === "function") return p.now();
  return Date.now();
}

function newRequestId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cvLog(payload: Omit<CvInferLogBase, "ts"> & Record<string, unknown>) {
  console.info(JSON.stringify({ ts: new Date().toISOString(), ...payload }));
}

/**
 * POST /api/cv/infer
 * Body: multipart form with field "file" (image).
 * Returns inferred clothing attributes by forwarding to the external CV service.
 */
export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const routeStartMs = perfNowMs();
  const sinceStartMs = () => Math.round(perfNowMs() - routeStartMs);

  cvLog({
    event: "cv_infer_route_enter",
    requestId,
    method: request.method,
    path: request.nextUrl?.pathname,
    contentType: request.headers.get("content-type"),
  });

  try {
    const formDataStartMs = perfNowMs();
    const formData = await request.formData();
    cvLog({
      event: "cv_infer_formdata_parsed",
      requestId,
      durationMs: Math.round(perfNowMs() - formDataStartMs),
      sinceStartMs: sinceStartMs(),
    });

    const file = formData.get("file");
    if (!(file instanceof File)) {
      cvLog({
        event: "cv_infer_total_inference_time",
        requestId,
        status: 400,
        totalMs: sinceStartMs(),
      });
      return NextResponse.json(
        { error: "Missing file (expected form field named 'file')" },
        { status: 400 }
      );
    }
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.type)) {
      cvLog({
        event: "cv_infer_image_received",
        requestId,
        fileType: file.type,
        fileSizeBytes: file.size,
        sinceStartMs: sinceStartMs(),
      });
      cvLog({
        event: "cv_infer_total_inference_time",
        requestId,
        status: 400,
        totalMs: sinceStartMs(),
      });
      return NextResponse.json(
        { error: "Unsupported image type (use JPEG, PNG, or WEBP)" },
        { status: 400 }
      );
    }

    if (!CV_SERVICE_URL) {
      cvLog({
        event: "cv_infer_image_received",
        requestId,
        fileType: file.type,
        fileSizeBytes: file.size,
        sinceStartMs: sinceStartMs(),
      });
      cvLog({
        event: "cv_infer_total_inference_time",
        requestId,
        status: 503,
        totalMs: sinceStartMs(),
      });
      return NextResponse.json(
        { error: "CV_SERVICE_URL is not configured on the server" },
        { status: 503 }
      );
    }

    const url = `${CV_SERVICE_URL.replace(/\/$/, "")}/infer`;
    const parsedUrl = (() => {
      try {
        return new URL(url);
      } catch {
        return null;
      }
    })();

    cvLog({
      event: "cv_infer_image_received",
      requestId,
      fileType: file.type,
      fileSizeBytes: file.size,
      sinceStartMs: sinceStartMs(),
    });

    const fd = new FormData();
    fd.append("file", file);

    cvLog({
      event: "cv_infer_cv_service_request_start",
      requestId,
      cvServiceHost: parsedUrl?.host,
      cvServicePath: parsedUrl?.pathname,
      sinceStartMs: sinceStartMs(),
    });

    const CV_TIMEOUT_MS = 15_000;
    const cvRequestStartMs = perfNowMs();
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), CV_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, { method: "POST", body: fd, signal: timeoutController.signal });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      const isTimeout = (fetchErr as Error)?.name === "AbortError";
      cvLog({
        event: "cv_infer_cv_service_fetch_error",
        requestId,
        isTimeout,
        message: (fetchErr as Error)?.message,
        sinceStartMs: sinceStartMs(),
      });
      cvLog({
        event: "cv_infer_total_inference_time",
        requestId,
        status: isTimeout ? 504 : 503,
        totalMs: sinceStartMs(),
      });
      const errCode = isTimeout ? "CV_SERVICE_TIMEOUT" : "CV_SERVICE_UNAVAILABLE";
      const message = isTimeout
        ? `Image analysis timed out after ${CV_TIMEOUT_MS / 1000}s. You can continue by filling the form manually.`
        : "Image analysis is temporarily unavailable. You can continue by filling the form manually.";
      return NextResponse.json({ ok: false, error: errCode, message }, { status: isTimeout ? 504 : 503 });
    } finally {
      clearTimeout(timeoutId);
    }

    // Parse JSON - do NOT silently convert bad upstream responses into {}
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      cvLog({
        event: "cv_infer_cv_service_json_parse_error",
        requestId,
        httpStatus: res.status,
        sinceStartMs: sinceStartMs(),
      });
      cvLog({ event: "cv_infer_total_inference_time", requestId, status: 502, totalMs: sinceStartMs() });
      return NextResponse.json(
        { ok: false, error: "CV_SERVICE_BAD_RESPONSE", message: "Image analysis returned an unexpected response. You can continue by filling the form manually." },
        { status: 502 }
      );
    }

    cvLog({
      event: "cv_infer_cv_service_return",
      requestId,
      status: res.status,
      ok: res.ok,
      durationMs: Math.round(perfNowMs() - cvRequestStartMs),
      sinceStartMs: sinceStartMs(),
    });

    if (!res.ok) {
      type CvServiceErrorPayload = { detail?: string; error?: string };
      const errorPayload: CvServiceErrorPayload =
        typeof data === "object" && data !== null
          ? (data as CvServiceErrorPayload)
          : {};
      const errorMessage =
        errorPayload.detail ?? errorPayload.error ?? "CV service error";
      cvLog({
        event: "cv_infer_total_inference_time",
        requestId,
        status: res.status,
        totalMs: sinceStartMs(),
      });
      return NextResponse.json(
        { ok: false, error: "CV_SERVICE_ERROR", message: `${errorMessage}. You can continue by filling the form manually.` },
        { status: res.status }
      );
    }

    cvLog({
      event: "cv_infer_total_inference_time",
      requestId,
      status: 200,
      totalMs: sinceStartMs(),
    });
    return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
  } catch (e) {
    console.error("CV infer error:", e);
    cvLog({
      event: "cv_infer_error",
      requestId,
      totalMs: sinceStartMs(),
      message: e instanceof Error ? e.message : String(e),
    });
    cvLog({
      event: "cv_infer_total_inference_time",
      requestId,
      status: 500,
      totalMs: sinceStartMs(),
    });
    const message =
      e instanceof Error ? e.message : "Failed to run CV inference";
    return NextResponse.json({ ok: false, error: "CV_INTERNAL_ERROR", message }, { status: 500 });
  }
}
