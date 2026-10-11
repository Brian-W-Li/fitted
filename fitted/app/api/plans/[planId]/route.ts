import { NextRequest } from "next/server";
import { memoryBody, memoryRoute } from "@/lib/outfitExperience/http";
import { OutfitPlanningStore } from "@/lib/outfitPlanning/store";
const store = new OutfitPlanningStore();
type Context = { params: Promise<{ planId: string }> };
export function PATCH(request: NextRequest, context: Context) {
  return memoryRoute(request, async owner => store.reschedule(owner, (await context.params).planId, await memoryBody(request)));
}
export function DELETE(request: NextRequest, context: Context) {
  return memoryRoute(request, async owner => store.remove(owner, (await context.params).planId));
}
