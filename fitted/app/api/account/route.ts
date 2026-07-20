import { NextRequest, NextResponse } from "next/server";
import { deleteUserWithData, initDatabase } from "@/lib/db";
import { verifyFirebaseUser } from "@/lib/apiAuth";
import { adminAuth } from "@/lib/firebaseAdmin";
import { cascadeDeleteUserData } from "@/models/User";

function parseAge(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < 0 || i > 130) return null;
  return i;
}

function parseRatingScore10(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 0 || rounded > 10) return null;
  return rounded;
}

const ALLOWED_GENDERS = new Set([
  "male",
  "female",
  "nonbinary",
  "other",
  "prefer_not_to_say",
]);

const MAX_PHOTO_DATA_URL_LENGTH = 3_000_000;
const PHOTO_DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i;

/** Safely read from metadata (Mongoose may give Map or plain object). */
function getMeta(metadata: unknown, key: string): unknown {
  if (metadata == null) return undefined;
  if (metadata instanceof Map) return metadata.get(key);
  if (typeof metadata === "object" && metadata !== null && key in metadata) {
    return (metadata as Record<string, unknown>)[key];
  }
  return undefined;
}

export async function POST(request: NextRequest) {
  try {
    // §I gate — identity comes ONLY from the verified Firebase token, never a body `firebaseUid`.
    const auth = await verifyFirebaseUser(request);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { User } = await initDatabase();
    type UserLean = {
      _id: { toString(): string };
      email: string;
      displayName?: string;
      photoURL?: string;
      metadata?: unknown;
      createdAt?: Date;
      updatedAt?: Date;
    };
    const user = (await User.findById(auth.userId).lean()) as UserLean | null;

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const meta = user.metadata;
    const customPhotoURL = getMeta(meta, "customPhotoURL");
    const profilePhotoURL =
      typeof customPhotoURL === "string" && customPhotoURL.length > 0
        ? customPhotoURL
        : user.photoURL ?? null;

    return NextResponse.json({
      user: {
        id: user._id.toString(),
        email: user.email,
        displayName: user.displayName ?? null,
        photoURL: profilePhotoURL,
        hasCustomPhoto: typeof customPhotoURL === "string" && customPhotoURL.length > 0,
        age: getMeta(meta, "age") ?? null,
        gender: getMeta(meta, "gender") ?? null,
        appRatingScore10: getMeta(meta, "appRatingScore10") ?? null,
        appFeedbackComment: getMeta(meta, "appFeedbackComment") ?? null,
        createdAt: user.createdAt ?? null,
        updatedAt: user.updatedAt ?? null,
      },
    });
  } catch (error) {
    console.error("Error fetching account:", error);
    return NextResponse.json({ error: "Failed to fetch account" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    // §I gate — identity comes ONLY from the verified Firebase token, never a body `firebaseUid`.
    const auth = await verifyFirebaseUser(request);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { age, gender, photoDataUrl, appRatingScore10, appFeedbackComment } =
      await request.json();

    const ageProvided = age !== undefined;
    const genderProvided = gender !== undefined;
    const ratingProvided = appRatingScore10 !== undefined;
    const feedbackCommentProvided = appFeedbackComment !== undefined;

    const ageParsed = parseAge(age);
    if (ageProvided && ageParsed === null && age !== "" && age !== null) {
      return NextResponse.json({ error: "Invalid age value" }, { status: 400 });
    }

    let genderParsed: string | null = null;
    if (gender === "" || gender === null || gender === undefined) {
      genderParsed = null;
    } else if (typeof gender === "string" && ALLOWED_GENDERS.has(gender)) {
      genderParsed = gender;
    } else {
      return NextResponse.json({ error: "Invalid gender value" }, { status: 400 });
    }

    const ratingParsed = parseRatingScore10(appRatingScore10);
    if (ratingProvided && ratingParsed === null && appRatingScore10 !== "" && appRatingScore10 !== null) {
      return NextResponse.json({ error: "Invalid rating value" }, { status: 400 });
    }

    let feedbackCommentParsed: string | null = null;
    if (
      appFeedbackComment === "" ||
      appFeedbackComment === null ||
      appFeedbackComment === undefined
    ) {
      feedbackCommentParsed = null;
    } else if (typeof appFeedbackComment === "string") {
      feedbackCommentParsed = appFeedbackComment.trim().slice(0, 2000);
    } else {
      return NextResponse.json({ error: "Invalid feedback comment value" }, { status: 400 });
    }

    const photoDataUrlProvided = photoDataUrl !== undefined;
    if (photoDataUrlProvided && photoDataUrl !== null && photoDataUrl !== "") {
      if (typeof photoDataUrl !== "string") {
        return NextResponse.json({ error: "Invalid photo format" }, { status: 400 });
      }
      if (photoDataUrl.length > MAX_PHOTO_DATA_URL_LENGTH) {
        return NextResponse.json({ error: "Photo is too large" }, { status: 400 });
      }
      if (!PHOTO_DATA_URL_RE.test(photoDataUrl)) {
        return NextResponse.json({ error: "Only PNG, JPG, JPEG, or WEBP images are allowed" }, { status: 400 });
      }
    }

    const { User } = await initDatabase();
    const user = await User.findById(auth.userId);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const meta = user.metadata ?? new Map<string, unknown>();
    if (!(meta instanceof Map)) {
      user.metadata = new Map(Object.entries(meta as Record<string, unknown>));
    }
    if (ageProvided) {
      if (ageParsed === null) user.metadata.delete("age");
      else user.metadata.set("age", ageParsed);
    }
    if (genderProvided) {
      if (genderParsed === null) user.metadata.delete("gender");
      else user.metadata.set("gender", genderParsed);
    }
    if (ratingProvided) {
      if (ratingParsed === null) user.metadata.delete("appRatingScore10");
      else user.metadata.set("appRatingScore10", ratingParsed);
    }
    if (feedbackCommentProvided) {
      if (feedbackCommentParsed === null) user.metadata.delete("appFeedbackComment");
      else user.metadata.set("appFeedbackComment", feedbackCommentParsed);
    }
    if (photoDataUrlProvided) {
      if (photoDataUrl === null || photoDataUrl === "") {
        user.metadata.delete("customPhotoURL");
      } else {
        user.metadata.set("customPhotoURL", photoDataUrl);
      }
    }

    await user.save();

    const metaAfter = user.metadata as unknown;
    const customPhotoURL = getMeta(metaAfter, "customPhotoURL");
    const profilePhotoURL =
      typeof customPhotoURL === "string" && customPhotoURL.length > 0
        ? customPhotoURL
        : user.photoURL ?? null;

    return NextResponse.json({
      user: {
        id: user._id.toString(),
        email: user.email,
        displayName: user.displayName ?? null,
        photoURL: profilePhotoURL,
        hasCustomPhoto: typeof customPhotoURL === "string" && customPhotoURL.length > 0,
        age: getMeta(metaAfter, "age") ?? null,
        gender: getMeta(metaAfter, "gender") ?? null,
        appRatingScore10: getMeta(metaAfter, "appRatingScore10") ?? null,
        appFeedbackComment: getMeta(metaAfter, "appFeedbackComment") ?? null,
        createdAt: user.createdAt ?? null,
        updatedAt: user.updatedAt ?? null,
      },
    });
  } catch (error) {
    console.error("Error updating account:", error);
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
  }
}

/**
 * DELETE /api/account — the user-facing data-deletion promise (§14.4 / §23-H43, Track 2 policy:
 * "delete me" means delete — the UI copy "permanently deletes … outfit history" is literally true).
 *
 * Three-phase erasure, order deliberate:
 *   1. Phase-1 fail-safe: REDACT the user's GenerationSnapshots (the H43 seam — the only
 *      post-insert-mutable fields). If the cascade below dies midway, the rows are at least
 *      marked, M6-excluded, and findable via the {user, redacted} index for a manual sweep
 *      (the corpusReadback verifier flags this exact state).
 *   2. Hard-delete the User row — the PRE-delete hook cascade-deletes wardrobe items,
 *      interactions, images, AND generation snapshots (models/User.ts — the single sanctioned
 *      erasure door through the snapshot delete guard; native driver by design).
 *   3. Phase-3 sweep: re-run the cascade AFTER the User row is gone. The cascade is a pre-hook,
 *      so a snapshot/interaction persisted by an in-flight request AFTER the cascade's sweep but
 *      BEFORE the user row died would otherwise survive; once the user row is gone, no new write
 *      can slip past (auth + the writer's post-persist User.exists check both fail), so this
 *      sweep is the closing bracket of the race.
 *   4. Delete the Firebase Auth account so the Google binding is gone too, retrying once (300ms
 *      backoff) on a transient failure. If it STILL fails, the route returns 502 with an honest
 *      partial-success body ({dataDeleted:true, authDeleted:false}) — it never claims full erasure
 *      while the identity survives (§23-H63). All Mongo data is already gone; re-signing-in
 *      re-creates a fresh empty user, and deleting again retries only this step.
 * The in-flight-render race is thus closed from both sides: mlRecommend self-erases when it sees
 * the user gone post-persist; this route sweeps once the user row's death makes that check reliable.
 */
export async function DELETE(request: NextRequest) {
  try {
    // §I gate — identity comes ONLY from the verified Firebase token.
    const auth = await verifyFirebaseUser(request);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { User, GenerationSnapshot } = await initDatabase();
    const user = (await User.findById(auth.userId).select("authId").lean()) as {
      authId?: string;
    } | null;
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    await GenerationSnapshot.updateMany(
      { user: auth.userId, redacted: { $ne: true } },
      { $set: { redacted: true, redactedAt: new Date(), redactionReason: "account_deleted" } },
    );

    const deleted = await deleteUserWithData(auth.userId);
    if (!deleted) {
      return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
    }

    // Phase-3 sweep (see the docblock): idempotent cascade re-run now that the user row is gone,
    // catching any row an in-flight request persisted between the pre-hook sweep and the row's death.
    await cascadeDeleteUserData(User.db, auth.userId);

    if (user.authId) {
      let authDeleted = false;
      for (let attempt = 0; attempt < 2 && !authDeleted; attempt++) {
        try {
          await adminAuth.deleteUser(user.authId);
          authDeleted = true;
        } catch (e) {
          console.error(`Firebase auth deletion failed (attempt ${attempt + 1}; Mongo data already removed):`, e);
          if (attempt === 0) await new Promise((r) => setTimeout(r, 300));
        }
      }
      if (!authDeleted) {
        // Honest partial-success: ALL Mongo data (photos, snapshots, interactions) is gone, but the
        // Firebase identity (email/displayName/photoURL) survived — do NOT claim full erasure. Signing
        // in once re-creates a fresh empty user; deleting again retries only this step.
        return NextResponse.json(
          { ok: false, dataDeleted: true, authDeleted: false, error: "auth_deletion_failed" },
          { status: 502 },
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting account:", error);
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }
}
