import { NextRequest, NextResponse } from "next/server";

const CV_SERVICE_URL = process.env.CV_SERVICE_URL;

/**
 * POST /api/cv/infer
 * Body: multipart form with field "file" (image).
 * Returns inferred clothing attributes by forwarding to the external CV service.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing file (expected form field named 'file')" },
        { status: 400 }
      );
    }
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.type)) {
      return NextResponse.json(
        { error: "Unsupported image type (use JPEG, PNG, or WEBP)" },
        { status: 400 }
      );
    }

    if (!CV_SERVICE_URL) {
      return NextResponse.json(
        { error: "CV_SERVICE_URL is not configured on the server" },
        { status: 503 }
      );
    }

    const url = `${CV_SERVICE_URL.replace(/\/$/, "")}/infer`;
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(url, { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: (data as { detail?: string }).detail ?? (data as any)?.error ?? "CV service error" },
        { status: res.status }
      );
    }
    return NextResponse.json(data as Record<string, unknown>);
  } catch (e) {
    console.error("CV infer error:", e);
    const message =
      e instanceof Error ? e.message : "Failed to run CV inference";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
