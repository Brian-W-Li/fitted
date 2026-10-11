import { NextRequest } from "next/server";
import { memoryBody, memoryRoute } from "@/lib/outfitExperience/http";
import { ExperienceStore } from "@/lib/outfitExperience/store";
export function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return memoryRoute(request, async owner => new ExperienceStore().retract(owner, (await context.params).id, await memoryBody(request)));
}
