"""
Minimal HTTP service for clothing attribute inference.
Deploy this to Railway, Render, Fly.io, or Cloud Run; call it from your Next.js API route.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile

from .cv import infer_attributes

app = FastAPI(title="CV Infer", version="0.1.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/infer")
async def infer(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Expected an image file (e.g. image/jpeg, image/png)")
    suffix = ".jpg"
    if file.content_type == "image/png":
        suffix = ".png"
    elif file.content_type == "image/webp":
        suffix = ".webp"
    path = None
    try:
        body = await file.read()
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(body)
            path = f.name
        result = infer_attributes(path)
        return result
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        if path:
            Path(path).unlink(missing_ok=True)
