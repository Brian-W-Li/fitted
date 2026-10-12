/** Optional declared attributes; no guessing or truncation of garment facts. */
export const MAX_ITEM_ATTR_CHARS = 60;
const UNKNOWN_DETAIL_LABELS = new Set(["0", "unknown", "unspecified", "not specified", "none", "n/a", "not applicable"]);
export function normalizeGarmentDetail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const detail = value.trim();
  if (!detail || detail.length > MAX_ITEM_ATTR_CHARS || !detail.isWellFormed() ||
      /[\u0000-\u001f\u007f-\u009f]/.test(detail) || UNKNOWN_DETAIL_LABELS.has(detail.toLowerCase())) return null;
  return detail;
}
