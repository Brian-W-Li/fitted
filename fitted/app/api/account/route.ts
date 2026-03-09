import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";

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
    const { firebaseUid } = await request.json();
    if (!firebaseUid) {
      return NextResponse.json({ error: "firebaseUid is required" }, { status: 400 });
    }

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
    const user = (await User.findOne({
      authProvider: "firebase",
      authId: firebaseUid,
    }).lean()) as UserLean | null;

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
    const { firebaseUid, age, gender, photoDataUrl, appRatingScore10, appFeedbackComment } =
      await request.json();
    if (!firebaseUid) {
      return NextResponse.json({ error: "firebaseUid is required" }, { status: 400 });
    }

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
    const user = await User.findOne({
      authProvider: "firebase",
      authId: firebaseUid,
    });

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
