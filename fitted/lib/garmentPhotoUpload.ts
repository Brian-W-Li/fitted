import type { User as FirebaseUser } from "firebase/auth";

// Pick sanity ceiling, followed by a separate post-resize platform upload gate.
export const MAX_PICK_BYTES = 40 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const TOO_LARGE_TO_UPLOAD_MSG =
  "That photo is too large to upload — take a screenshot of it and upload the screenshot instead.";
export const UNSUPPORTED_IMAGE_MSG =
  "That image type isn't supported. iPhone photos are often HEIC — take a screenshot of the photo and upload that, or set Camera → Formats to “Most Compatible”, then try again.";

/** Downscale a photo client-side before upload. Two hard reasons: Vercel rejects request bodies
 *  over ~4.5MB at the platform edge (the route's own 5MB check never runs in production), and
 *  images live as base64 in a 512MB Atlas M0 — full-size phone photos would exhaust it within a
 *  few closets. Longest edge 1280px; JPEG q0.85 (PNG stays PNG to preserve CV-crop transparency).
 *  Falls back to the original file on any decode/canvas failure — see the orientation note below
 *  for why the fallback returns the ORIGINAL rather than an unoriented re-encode. */
export async function prepareImageForUpload(file: File): Promise<File> {
  const SKIP_BELOW_BYTES = 400 * 1024; // already small — don't re-encode
  const MAX_EDGE_PX = 1280;
  if (file.size <= SKIP_BELOW_BYTES) return file;
  try {
    // Bake EXIF orientation into the re-encoded pixels. If oriented decode fails, retain the
    // original file: a plain decode followed by canvas encoding drops EXIF and can turn it sideways.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(
      () => null,
    );
    if (!bitmap) return file;
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close(); // release the decoded bitmap promptly (large phone photos)
    const isPng = file.type === "image/png";
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, isPng ? "image/png" : "image/jpeg", isPng ? undefined : 0.85),
    );
    if (!blob || blob.size >= file.size) return file; // re-encode didn't help — keep the original
    const newName = isPng ? file.name : file.name.replace(/\.\w+$/, "") + ".jpg";
    return new File([blob], newName, { type: blob.type });
  } catch {
    return file;
  }
}

export async function uploadWardrobeItemImage(params: {
  firebaseUser: FirebaseUser;
  wardrobeItemId: string;
  file: File;
  view?: "primary" | "supplemental";
  imageRef?: string;
  isCurrentOwner?: () => boolean;
}) {
  const token = await params.firebaseUser.getIdToken();

  const file = await prepareImageForUpload(params.file);
  if (file.size > MAX_UPLOAD_BYTES) {
    // Reject before the hosting platform turns an oversized body into an opaque 413.
    throw new Error(TOO_LARGE_TO_UPLOAD_MSG);
  }

  if (params.isCurrentOwner && !params.isCurrentOwner()) throw new Error("The signed-in account changed.");
  const fd = new FormData();
  fd.append("file", file);
  if (params.view) fd.append("view", params.view);
  if (params.imageRef) fd.append("imageRef", params.imageRef);

  const res = await fetch(`/api/wardrobe/${params.wardrobeItemId}/image`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      // DO NOT set Content-Type for FormData
    },
    body: fd,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new PhotoMutationError(data.error ?? "Failed to upload image", res.status);
  return data; // { ok: true, imagePath: "mongo:..." }
}


export class PhotoMutationError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}
