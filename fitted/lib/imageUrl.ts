/**
 * Resolve a stored image reference to a browser `<img src>`.
 *
 * The UI receives image references in three forms, and a helper that handled only one silently
 * dropped the others (the §6.5 bug: `displayItems.imageUrl` arrives ALREADY resolved to
 * `/api/images/<id>` from `mlRequestAdapter.resolveImageUrl`, but the legacy `mongo:`-only helper
 * returned `null` for it → no image rendered):
 *   - `"mongo:<id>"`       → `/api/images/<id>`  (raw `WardrobeItem.imagePath`, the wardrobe surface)
 *   - `"/api/images/<id>"` → as-is               (already-resolved §6.5 `displayItems.imageUrl` /
 *                                                 `itemSnapshots.engineVisible.imageUrl`)
 *   - `"http(s)://…"`      → as-is               (external `imageUrl` passthrough, §15.2)
 * Anything else — including `""` (a no-image item is legitimate, §15.2) — resolves to `null`.
 */
export function resolveImageSrc(value?: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("mongo:")) return `/api/images/${value.slice("mongo:".length)}`;
  if (value.startsWith("/api/images/")) return value;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return null;
}
