import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "fs/promises";
import { spawn } from "child_process";
import path from "path";
import os from "os";

const CV_SERVICE_URL = process.env.CV_SERVICE_URL;

/**
 * POST /api/cv/infer
 * Body: multipart form with field "file" (image).
 * Returns inferred clothing attributes.
 * - If CV_SERVICE_URL is set (e.g. on Vercel): forwards to that service.
 * - Else (local): runs cv-service/cv.py via spawn.
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

    if (CV_SERVICE_URL) {
      const url = `${CV_SERVICE_URL.replace(/\/$/, "")}/infer`;
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(url, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return NextResponse.json(
          { error: (data as { detail?: string }).detail ?? data?.error ?? "CV service error" },
          { status: res.status }
        );
      }
      return NextResponse.json(data as Record<string, unknown>);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const tempPath = path.join(
      os.tmpdir(),
      `cv-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    );
    await writeFile(tempPath, bytes);

    const scriptPath = path.join(process.cwd(), "cv-service", "cv.py");
    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const proc = spawn("python3", [scriptPath, tempPath], {
        cwd: process.cwd(),
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
      let stdout = "";
      let stderr = "";
      proc.stdout?.on("data", (chunk: Buffer | string) => { stdout += chunk; });
      proc.stderr?.on("data", (chunk: Buffer | string) => { stderr += chunk; });
      proc.on("close", (code: number | null) => {
        unlink(tempPath).catch(() => {});
        if (code !== 0) {
          reject(new Error(stderr || `python3 exited ${code}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as Record<string, unknown>);
        } catch {
          reject(new Error(`Invalid JSON from cv.py: ${stdout.slice(0, 200)}`));
        }
      });
      proc.on("error", (err: Error) => {
        unlink(tempPath).catch(() => {});
        reject(err);
      });
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error("CV infer error:", e);
    const message =
      e instanceof Error ? e.message : "Failed to run CV inference";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
