import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { initDatabase } from "@/lib/db";
import { verifySessionCookieUser } from "@/lib/session";

/**
 * GET /api/images/[imageId] — serve wardrobe image bytes to the OWNER only (§I).
 *
 * These bytes are rendered by `<img src="/api/images/<id>">` tags, which cannot carry an
 * `Authorization: Bearer` header — so ownership is enforced via the Firebase **session cookie** the
 * browser attaches automatically (minted at sign-in, see /api/auth/session + lib/session.ts). A
 * missing/invalid cookie → 401; a valid cookie whose user does not own the image → 404 (existence is
 * not revealed to a non-owner). A malformed id → stable 400 (never a cast-crash 500).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ imageId: string }> },
) {
  const { imageId } = await params;
  if (!mongoose.isValidObjectId(imageId)) {
    return NextResponse.json({ error: "Invalid image id" }, { status: 400 });
  }

  const auth = await verifySessionCookieUser(request);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { WardrobeImage } = await initDatabase();
  const doc = await WardrobeImage.findById(imageId).exec();

  // 404 for both "no such image" and "not yours" — a non-owner cannot distinguish the two.
  if (!doc || doc.user.toString() !== auth.userId) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  const bytes = Buffer.from(doc.base64, "base64");

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": doc.contentType,
      // Upload allowlists jpeg/png/webp, so this is belt-and-braces against a stored
      // contentType ever being sniffed into something executable.
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
