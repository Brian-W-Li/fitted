import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";
import { uploadWardrobeImage } from "@/lib/imageStorage";

async function getUserIdFromRequest(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { error: "Missing or invalid Authorization header", status: 401 as const };
  }

  const idToken = authHeader.slice("Bearer ".length).trim();

  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    const firebaseUid = decoded.uid;

    const { User } = await initDatabase();
    const user = await User.findOne({
      authProvider: "firebase",
      authId: firebaseUid,
    }).exec();

    if (!user) return { error: "User not found", status: 404 as const };
    return { userId: user._id.toString() };
  } catch (err) {
    console.error("verifyIdToken failed:", err);
    return { error: "Invalid or expired token", status: 401 as const };
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userResult = await getUserIdFromRequest(request);
    if ("error" in userResult) {
      return NextResponse.json({ error: userResult.error }, { status: userResult.status });
    }

    const { id: wardrobeItemId } = await params;
    const userId = userResult.userId;

    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing file (expected form field named 'file')" },
        { status: 400 }
      );
    }

    const contentType = file.type || "application/octet-stream";
    const bytes = Buffer.from(await file.arrayBuffer());

    // attach pointer on WardrobeItem (user-scoped)
    const { WardrobeItem, WardrobeImage } = await initDatabase();

    // 1) Load current item so we can see its existing imagePath
    const existingItem = await WardrobeItem.findOne({
    _id: wardrobeItemId,
    user: userId,
    }).lean();

    if (!existingItem) {
    return NextResponse.json(
        { error: "Wardrobe item not found (or not owned by user)" },
        { status: 404 }
    );
    }

    // 2) If it already has an image, delete the old WardrobeImage doc
    const oldPath = (existingItem as { imagePath?: unknown } | null)?.imagePath;
    const oldPathStr = typeof oldPath === "string" ? oldPath : undefined;
    if (oldPathStr?.startsWith("mongo:")) {
      const oldImageId = oldPathStr.slice("mongo:".length);
      await WardrobeImage.deleteOne({ _id: oldImageId, user: userId }).exec();
  }

    // 3) Store new image
    const { imagePath } = await uploadWardrobeImage({
    userId,
    wardrobeItemId,
    bytes,
    contentType,
    });

    // 4) Update wardrobe item with new pointer
    await WardrobeItem.updateOne(
    { _id: wardrobeItemId, user: userId },
    { $set: { imagePath } }
    ).exec();

    return NextResponse.json({ imagePath });
  } catch (err) {
    console.error("wardrobe image upload error:", err);
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}