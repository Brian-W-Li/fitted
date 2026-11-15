import { isValidRequestId } from "./formats";
/** Browser-safe explicit instructions. A note or reaction never becomes an exclusion. */
export interface ExclusionInput { itemIds: string[]; outfitItemIds: string[][] }
export interface ExclusionRef { id: string; revision: number }
export interface ExplicitExclusionEntry { id: string; revision: number; scope: "saved" | "request"; kind: "item" | "combination"; itemIds: string[] }
export interface ExplicitExclusions { version: "explicit-exclusions.v1"; requestId: string; savedRef: ExclusionRef | null; entries: ExplicitExclusionEntry[]; digest: string }
export const emptyExclusionInput = (): ExclusionInput => ({ itemIds: [], outfitItemIds: [] });
export class ExplicitExclusionError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
function fail(message: string): never { throw new ExplicitExclusionError(400, "exclusions_invalid", message); }
const id = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{24}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function normalizeExclusionRef(value: unknown): ExclusionRef | null {
  if (value == null) return null;
  if (!record(value) || Object.keys(value).sort().join() !== "id,revision" || !id(value.id) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1)
    fail("Refresh the applicable saved exclusions before requesting outfits.");
  return { id: value.id as string, revision: value.revision as number };
}
function members(value: unknown, max = 5): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > max || !value.every(id) || new Set(value).size !== value.length)
    fail("Choose unique owned pieces; an exact outfit contains one through five pieces.");
  return [...value].sort() as string[];
}
export function normalizeExclusionInput(value: unknown): ExclusionInput {
  if (value === undefined) return emptyExclusionInput();
  if (!record(value) || Object.keys(value).sort().join() !== "itemIds,outfitItemIds" || !Array.isArray(value.itemIds) || !Array.isArray(value.outfitItemIds) ||
    value.itemIds.length > 20 || value.outfitItemIds.length > 20 || !value.itemIds.every(id) || new Set(value.itemIds).size !== value.itemIds.length)
    fail("Use at most 20 item exclusions and 20 exact outfit exclusions for one request.");
  const outfits = (value.outfitItemIds as unknown[]).map(items => members(items));
  if (new Set(outfits.map(items => items.join("|"))).size !== outfits.length) fail("An exact outfit exclusion appears more than once.");
  return { itemIds: [...value.itemIds as string[]].sort(), outfitItemIds: outfits.sort((a, b) => a.join("|").localeCompare(b.join("|"))) };
}
export function canonicalExclusionJson(value: unknown): string {
  const order = (v: unknown): unknown => Array.isArray(v) ? v.map(order) : record(v)
    ? Object.fromEntries(Object.keys(v).sort().map(key => [key, order(v[key])])) : v;
  return JSON.stringify(order(value));
}
export function violatesExplicitExclusions(policy: ExplicitExclusions | undefined, itemIds: string[]): boolean {
  if (!policy) return false;
  const ids = new Set(itemIds);
  return policy.entries.some(entry => entry.kind === "item" ? ids.has(entry.itemIds[0])
    : ids.size === entry.itemIds.length && entry.itemIds.every(itemId => ids.has(itemId)));
}
/** Validate typed captured data; the server also verifies its canonical digest. */
export function validExplicitExclusions(value: unknown): value is ExplicitExclusions {
  if (!record(value) || Object.keys(value).sort().join() !== "digest,entries,requestId,savedRef,version" || value.version !== "explicit-exclusions.v1" ||
    typeof value.requestId !== "string" || !isValidRequestId(value.requestId) || (value.requestId.includes("-") && value.requestId !== value.requestId.toLowerCase()) || !Array.isArray(value.entries) || value.entries.length > 80 || typeof value.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.digest)) return false;
  if (value.savedRef !== null && !record(value.savedRef)) return false;
  try { normalizeExclusionRef(value.savedRef); } catch { return false; }
  const counts = new Map<string, number>(), seen = new Set<string>(), semantics = new Set<string>();
  let previous = "";
  for (const entry of value.entries) {
    if (!record(entry) || Object.keys(entry).sort().join() !== "id,itemIds,kind,revision,scope" || !id(entry.id) || entry.id <= previous || seen.has(entry.id) ||
      !Number.isSafeInteger(entry.revision) || Number(entry.revision) < 1 || (entry.scope !== "saved" && entry.scope !== "request") || (entry.kind !== "item" && entry.kind !== "combination")) return false;
    try { if (canonicalExclusionJson(members(entry.itemIds, entry.kind === "item" ? 1 : 5)) !== canonicalExclusionJson(entry.itemIds)) return false; } catch { return false; }
    if (entry.scope === "saved" && value.savedRef === null) return false;
    const meaning = `${entry.scope}:${entry.kind}:${(entry.itemIds as string[]).join("|")}`;
    if (semantics.has(meaning)) return false;
    semantics.add(meaning);
    const key = `${entry.scope}:${entry.kind}`, count = (counts.get(key) ?? 0) + 1;
    if (count > 20) return false;
    counts.set(key, count); seen.add(entry.id); previous = entry.id;
  }
  return true;
}
