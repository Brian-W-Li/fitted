import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { initDatabase } from "@/lib/db";

/**
 * GET /api/images/[imageId] — serve wardrobe image bytes.
 *
 * §I note (ownership residual): these bytes are rendered by `<img src="/api/images/<id>">` tags, which
 * CANNOT carry an `Authorization: Bearer` header, so per-request Firebase-token auth is infeasible here
 * without a separate mechanism the browser attaches automatically — a Firebase **session cookie**
 * (`verifySessionCookie`) or **signed image URLs** (an HMAC over `{imageId, user}` appended by every
 * URL producer). Both are separable infra beyond this C6/C7 UI+interactions pass; the ownership closure
 * is a registered pre-C8 residual (m5-cutover.md §I). At solo scale the exposure — a caller guessing a
 * 24-hex ObjectId to read a clothing photo — is low. What IS closed here: a malformed id returns a
 * stable 400 (never a cast-crash 500), and existence is not confirmed for a bad id.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ imageId: string }> },
) {
  const { imageId } = await params;
  if (!mongoose.isValidObjectId(imageId)) {
    return NextResponse.json({ error: "Invalid image id" }, { status: 400 });
  }

  const { WardrobeImage } = await initDatabase();
  const doc = await WardrobeImage.findById(imageId).exec();

  if (!doc) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  const bytes = Buffer.from(doc.base64, "base64");

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": doc.contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
