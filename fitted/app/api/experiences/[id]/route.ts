import { NextRequest } from "next/server";
import { memoryBody, memoryRoute } from "@/lib/outfitExperience/http";
import { ExperienceStore } from "@/lib/outfitExperience/store";
import { getExperience } from "@/lib/outfitExperience/read";
type Context = { params: Promise<{ id: string }> };
export function GET(request: NextRequest, context: Context) {
  return memoryRoute(request, async owner => getExperience(owner, (await context.params).id));
}
export function PATCH(request: NextRequest, context: Context) {
  return memoryRoute(request, async owner => new ExperienceStore().revise(owner, (await context.params).id, await memoryBody(request)));
}
export function DELETE(request: NextRequest, context: Context) {
  return memoryRoute(request, async owner => { await new ExperienceStore().erase(owner, (await context.params).id); return { erased: true }; });
}
