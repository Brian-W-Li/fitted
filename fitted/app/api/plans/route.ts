import { NextRequest } from "next/server";
import { memoryBody, memoryQuery, memoryRoute } from "@/lib/outfitExperience/http";
import { OutfitPlanningStore } from "@/lib/outfitPlanning/store";
const store = new OutfitPlanningStore();
export function GET(request: NextRequest) {
  return memoryRoute(request, owner => { memoryQuery(request, []); return store.list(owner); });
}
export function POST(request: NextRequest) {
  return memoryRoute(request, async owner => store.create(owner, await memoryBody(request)));
}
