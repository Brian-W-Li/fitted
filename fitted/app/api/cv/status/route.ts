import { NextResponse } from "next/server";

const CV_SERVICE_URL = process.env.CV_SERVICE_URL;
const STATUS_TIMEOUT_MS = 3_000;

/**
 * GET /api/cv/status
 * Lightweight health probe for the external CV service.
 * Returns { available: boolean } quickly (3s timeout) so the client can
 * decide whether to show the "Analyze photo" flow or skip straight to manual entry.
 */
export async function GET() {
  if (!CV_SERVICE_URL) {
    return NextResponse.json({ available: false, reason: "not_configured" });
  }

  const url = `${CV_SERVICE_URL.replace(/\/$/, "")}/infer`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);

  try {
    const res = await fetch(url, { method: "HEAD", signal: controller.signal });
    clearTimeout(timeoutId);
    // A 405 (Method Not Allowed) means the service is up but doesn't support HEAD —
    // that still counts as available.
    const available = res.ok || res.status === 405 || res.status === 422;
    return NextResponse.json({ available });
  } catch {
    clearTimeout(timeoutId);
    return NextResponse.json({ available: false, reason: "unreachable" });
  }
}
