import { NextRequest } from "next/server";
import { memoryQuery, memoryRoute } from "@/lib/outfitExperience/http";
import { recentSuggestions } from "@/lib/outfitExperience/read";
export function GET(request: NextRequest) {
  return memoryRoute(request, owner => {
    const query = memoryQuery(request, ["itemId", "cursor"]);
    return recentSuggestions(owner, query.itemId, { cursor: query.cursor });
  });
}
