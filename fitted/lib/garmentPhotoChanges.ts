import type { User as FirebaseUser } from "firebase/auth";
import { PhotoMutationError, uploadWardrobeItemImage } from "./garmentPhotoUpload";

export type SupplementalPhotoDraft = { imageRef?: string; file?: File; removed?: boolean };
export type GarmentPhotoChanges = { removePrimary?: string; supplemental: SupplementalPhotoDraft[] };
export type CurrentPhotoAttachments = { imagePath?: string; imageUrl?: string; supplementalImages?: string[] };
type PhotoOperation = { label: string; view: "primary" | "supplemental"; file?: File; imageRef?: string };

/** Metadata is saved once before these independent photo operations. Never retry an unknown append. */
export async function saveGarmentPhotos({ firebaseUser, wardrobeItemId, current, primaryFile, changes, isCurrentOwner }: {
  firebaseUser: FirebaseUser; wardrobeItemId: string; current: CurrentPhotoAttachments;
  primaryFile: File | null; changes?: GarmentPhotoChanges; isCurrentOwner: () => boolean;
}) {
  let attachments = { imagePath: current.imagePath, imageUrl: current.imageUrl, supplementalImages: current.supplementalImages ?? [] };
  const operations: PhotoOperation[] = [];
  if (primaryFile) operations.push({ label: "Main photo", view: "primary", file: primaryFile });
  else if (changes?.removePrimary) operations.push({ label: "Main photo removal", view: "primary", imageRef: changes.removePrimary });
  changes?.supplemental.forEach((draft, index) => {
    if (draft.file) operations.push({ label: `Additional view ${index + 1}`, view: "supplemental", file: draft.file, imageRef: draft.imageRef });
    else if (draft.removed && draft.imageRef) operations.push({ label: `Additional view ${index + 1} removal`, view: "supplemental", imageRef: draft.imageRef });
  });
  const saved: string[] = [];
  const failed: string[] = [];
  let uncertain = false;
  let reloadFailed = false;
  let missing = false;
  for (let index = 0; index < operations.length; index++) {
    if (!isCurrentOwner()) break;
    const operation = operations[index];
    try {
      let data;
      if (operation.file) {
        data = await uploadWardrobeItemImage({ firebaseUser, wardrobeItemId, view: operation.view, imageRef: operation.imageRef, file: operation.file, isCurrentOwner });
        if (operation.view === "supplemental" && !Array.isArray(data.supplementalImages)) throw new Error("The upload response did not confirm this view.");
        if (operation.view === "primary" && typeof data.imagePath !== "string") throw new Error("The upload response did not confirm the main photo.");
      } else {
        const token = await firebaseUser.getIdToken();
        if (!isCurrentOwner()) break;
        const res = await fetch(`/api/wardrobe/${wardrobeItemId}/image`, {
          method: "DELETE", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ view: operation.view, imageRef: operation.imageRef }),
        });
        data = await res.json().catch(() => ({}));
        if (!res.ok) throw new PhotoMutationError(data.error ?? "Failed to remove photo", res.status);
        if (!Array.isArray(data.supplementalImages)) throw new Error("The removal response did not confirm the current photos.");
      }
      attachments = {
        imagePath: operation.view === "primary" ? data.imagePath : attachments.imagePath,
        imageUrl: operation.view === "primary" ? data.imageUrl : attachments.imageUrl,
        supplementalImages: data.supplementalImages ?? attachments.supplementalImages,
      };
      // Full responses are authoritative for all attachments, including concurrent changes.
      if (Array.isArray(data.supplementalImages)) { attachments.imagePath = data.imagePath; attachments.imageUrl = data.imageUrl; }
      saved.push(operation.label);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Photo change failed.";
      const status = error instanceof PhotoMutationError ? error.status : undefined;
      const unknownOutcome = status === undefined || status >= 500;
      failed.push(`${operation.label}: ${unknownOutcome ? "could not confirm whether it saved — " : "failed — "}${reason}`);
      if (unknownOutcome || status === 409 || status === 404 || status === 410) {
        uncertain = unknownOutcome;
        // Get the owner-authoritative state before exposing another explicit edit. This also
        // discovers an append that committed before its response was lost, preventing duplicates.
        try {
          const token = await firebaseUser.getIdToken();
          if (!isCurrentOwner()) break;
          const res = await fetch("/api/wardrobe", { headers: { Authorization: `Bearer ${token}` } });
          const body = await res.json();
          if (!res.ok || !Array.isArray(body.items)) throw new Error("Reload failed");
          const item = body.items.find((item: { id?: string; _id?: string }) => (item.id ?? item._id) === wardrobeItemId);
          missing = !item;
          if (item) attachments = { imagePath: item.imagePath, imageUrl: item.imageUrl, supplementalImages: item.supplementalImages ?? [] };
        } catch { reloadFailed = true; }
        operations.slice(index + 1).forEach(pending => failed.push(`${pending.label}: not attempted; inspect the reloaded photos before trying again.`));
        break;
      }
    }
  }
  return { attachments, saved, failed, uncertain, reloadFailed, missing };
}
