import { OBJECT_ID_RE } from "@/lib/formats";
export function mongoImageId(path: unknown): string | undefined {
  if (typeof path !== "string" || !path.startsWith("mongo:")) return;
  const id = path.slice(6);
  return OBJECT_ID_RE.test(id) ? id : undefined;
}
export function localImageId(url: unknown): string | undefined {
  if (typeof url !== "string") return;
  return mongoImageId(url.startsWith("/api/images/") ? `mongo:${url.slice(12)}` : url);
}

export const MAX_SUPPLEMENTAL_IMAGES = 2;
export type RawAttachments = { imagePath?: unknown; imageUrl?: unknown; supplementalImages?: unknown };
export type AttachmentState = { imagePath?: string; imageUrl?: string; supplementalImages: string[] };
const FIELDS = ["imagePath", "imageUrl", "supplementalImages"] as const;

/** Public current state; historic generation projections continue to read only the primary. */
export function attachmentState(item: RawAttachments): AttachmentState {
  return {
    ...(typeof item.imagePath === "string" ? { imagePath: item.imagePath } : {}),
    ...(typeof item.imageUrl === "string" ? { imageUrl: item.imageUrl } : {}),
    supplementalImages: Array.isArray(item.supplementalImages)
      ? item.supplementalImages.filter((ref): ref is string => typeof ref === "string" && !!mongoImageId(ref)) : [],
  };
}
export function primaryImageRef(item: RawAttachments): string | undefined {
  const state = attachmentState(item);
  return state.imageUrl || state.imagePath;
}
/** Exact raw equality preserves missing/null/malformed legacy primary fields without casting. */
export function attachmentCAS(item: RawAttachments): Record<string, unknown> {
  return Object.fromEntries(FIELDS.map(field => [field,
    Object.hasOwn(item, field) ? item[field] : { $exists: false },
  ]));
}
export function attachmentImageIds(item: RawAttachments): string[] {
  return [...new Set([
    mongoImageId(item.imagePath), localImageId(item.imageUrl),
    ...attachmentState(item).supplementalImages.map(mongoImageId),
  ].filter((id): id is string => !!id))];
}
export function activeAttachmentFilter(imageId: string): Record<string, unknown> {
  const ref = `mongo:${imageId}`;
  return { $or: [
    { imagePath: ref }, { imageUrl: { $in: [ref, `/api/images/${imageId}`] } },
    { supplementalImages: ref },
  ] };
}
