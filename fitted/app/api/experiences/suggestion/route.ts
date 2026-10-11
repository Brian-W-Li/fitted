import { NextRequest } from "next/server";
import { memoryQuery, memoryRoute } from "@/lib/outfitExperience/http";
import { getSuggestion } from "@/lib/outfitExperience/read";

export function GET(request: NextRequest) {
  return memoryRoute(request, async owner => {
    const query = memoryQuery(request, ["snapshotId", "candidateId"]);
    return { suggestion: await getSuggestion(owner, query.snapshotId, query.candidateId) };
  });
}
