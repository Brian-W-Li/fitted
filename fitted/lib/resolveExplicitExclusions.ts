import { createHash } from "crypto";
import { isValidRequestId } from "./formats";
import { canonicalExclusionJson, ExplicitExclusionError, normalizeExclusionInput, validExplicitExclusions,
  type ExclusionInput, type ExclusionRef, type ExplicitExclusions, type ExplicitExclusionEntry } from "./explicitExclusions";
import type { SavedExclusionSet } from "./styleMemory/contract";
const sha = (value: unknown) => createHash("sha256").update(canonicalExclusionJson(value)).digest("hex");
export function exclusionCommandKey(ref: ExclusionRef | null, input: ExclusionInput): string | null {
  return ref || input.itemIds.length || input.outfitItemIds.length ? sha({ savedRef: ref, oneRequest: input }) : null;
}
export function assertCurrentExclusionRef(ref: ExclusionRef | null, set: SavedExclusionSet | null): void {
  if ((ref?.id ?? null) !== (set?.id ?? null) || (ref?.revision ?? null) !== (set?.revision ?? null))
    throw new ExplicitExclusionError(409, "exclusions_changed", "Saved exclusions changed. Review the refreshed rules before requesting outfits.");
}
export function buildExplicitExclusions(requestId: string, set: SavedExclusionSet | null, oneRequest: ExclusionInput, ref: ExclusionRef | null): ExplicitExclusions | undefined {
  if (!isValidRequestId(requestId) || (requestId.includes("-") && requestId !== requestId.toLowerCase()))
    throw new ExplicitExclusionError(400, "exclusions_invalid", "A canonical request ID is required for explicit instructions.");
  assertCurrentExclusionRef(ref, set);
  const input = normalizeExclusionInput(oneRequest);
  if (!set && !input.itemIds.length && !input.outfitItemIds.length) return undefined;
  const entries: ExplicitExclusionEntry[] = (set?.entries ?? []).map(entry => ({ ...entry, itemIds: [...entry.itemIds], scope: "saved" }));
  const add = (kind: ExplicitExclusionEntry["kind"], itemIds: string[]) => entries.push({
    id: sha(["request", requestId, kind, itemIds]).slice(0, 24), revision: 1, scope: "request", kind, itemIds,
  });
  input.itemIds.forEach(itemId => add("item", [itemId]));
  input.outfitItemIds.forEach(itemIds => add("combination", itemIds));
  entries.sort((a, b) => a.id.localeCompare(b.id));
  const body = { version: "explicit-exclusions.v1" as const, requestId, savedRef: ref, entries };
  const policy = { ...body, digest: sha(body) };
  if (!validExplicitExclusions(policy)) throw new ExplicitExclusionError(400, "exclusions_invalid", "The exclusion policy is not valid.");
  return policy;
}
export function verifiedExplicitExclusions(value: unknown, requestId?: string): value is ExplicitExclusions {
  if (!validExplicitExclusions(value) || (requestId !== undefined && value.requestId !== requestId)) return false;
  const { digest, ...body } = value;
  return sha(body) === digest;
}
