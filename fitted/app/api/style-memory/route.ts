import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseUser } from "@/lib/apiAuth";
import { memoryBody, memoryQuery } from "@/lib/outfitExperience/http";
import { ExperienceError, ExperienceValidationError } from "@/lib/outfitExperience/errors";
import { StyleMemoryStore } from "@/lib/styleMemory/store";
import { StyleMemoryError } from "@/lib/styleMemory/validation";
const store = new StyleMemoryStore();
async function route(request: NextRequest, write: boolean) {
  try {
    const identity = await verifyFirebaseUser(request);
    if ("error" in identity) return NextResponse.json({ error: identity.error, code: "auth" }, { status: identity.status, headers: { "Cache-Control": "no-store" } });
    memoryQuery(request, []);
    const result = write ? await store.mutate(identity.userId, await memoryBody(request)) : await store.list(identity.userId);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof StyleMemoryError || error instanceof ExperienceError || error instanceof ExperienceValidationError;
    const status = error instanceof StyleMemoryError || error instanceof ExperienceError ? error.status : error instanceof ExperienceValidationError ? 400 : 503;
    return NextResponse.json({ error: known ? error.message : "Saved styling is temporarily unavailable. Retry the same change.", code: error instanceof StyleMemoryError || error instanceof ExperienceError ? error.code : "invalid_or_unavailable" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
export function GET(request: NextRequest) { return route(request, false); }
export function POST(request: NextRequest) { return route(request, true); }
