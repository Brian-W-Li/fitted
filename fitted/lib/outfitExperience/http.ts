import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseUser } from "@/lib/apiAuth";
import { ExperienceError, ExperienceValidationError } from "./errors";

const MAX_BODY_BYTES = 8192;
export async function memoryBody(request: NextRequest): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ExperienceError(415, "json_required");
  const reader = request.body?.getReader();
  if (!reader) throw new ExperienceValidationError("request", "Expected JSON body");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new ExperienceError(413, "body_too_large"); }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new ExperienceValidationError("request", "Expected valid JSON"); }
  } finally { reader.releaseLock(); }
}
export function memoryQuery(request: NextRequest, allowed: string[]) {
  const result: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams) {
    if (!allowed.includes(key) || key in result || value.length > 2048) throw new ExperienceValidationError("request", "Invalid query");
    result[key] = value;
  }
  return result;
}
export async function memoryRoute(request: NextRequest, run: (owner: string) => Promise<unknown>) {
  try {
    const identity = await verifyFirebaseUser(request);
    if ("error" in identity) return NextResponse.json({ error: identity.error }, { status: identity.status, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(await run(identity.userId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof ExperienceError ? error.status : error instanceof ExperienceValidationError ? 400 : 503;
    const message = error instanceof ExperienceError ? error.code : error instanceof ExperienceValidationError ? error.message : "Memory is temporarily unavailable. Please retry.";
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
