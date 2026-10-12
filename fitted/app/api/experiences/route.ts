import { NextRequest } from "next/server";
import { memoryBody, memoryQuery, memoryRoute } from "@/lib/outfitExperience/http";
import { ExperienceStore } from "@/lib/outfitExperience/store";
import { recallExperiences } from "@/lib/outfitExperience/read";
export function GET(request: NextRequest) {
  return memoryRoute(request, owner => {
    const query = memoryQuery(request, ["itemId", "context", "outcome", "lifecycle", "cursor"]);
    return recallExperiences(owner, query);
  });
}
export function POST(request: NextRequest) {
  return memoryRoute(request, async owner => new ExperienceStore().create(owner, await memoryBody(request)));
}
