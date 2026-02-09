"""
Clothing image attribute inference.

Takes an image input and returns category, type, color, pattern, style
with confidence scores as JSON. Aligns with cv-integration.md.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


# --- Background removal (optional) --------------------------------------------

def _remove_background(pil_image: Image.Image) -> Image.Image | None:
    """Return RGBA image with background removed, or None if rembg not available / fails."""
    try:
        from rembg import remove as rembg_remove
    except ImportError:
        return None
    try:
        rgba = rembg_remove(pil_image.convert("RGB"))
        if rgba is not None and rgba.mode == "RGBA":
            return rgba
    except Exception:
        pass
    return None


# --- Color extraction (PIL + numpy only) ------------------------------------

def _rgb_to_hex(r: int, g: int, b: int) -> str:
    return f"#{r:02X}{g:02X}{b:02X}"


def _rgb_distance(r1: int, g1: int, b1: int, r2: int, g2: int, b2: int) -> float:
    """Euclidean distance in RGB space (0–255)."""
    return float(np.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2))


def _extract_dominant_colors(
    pil_image: Image.Image,
    top_n: int = 3,
    foreground_only: bool = False,
) -> list[tuple[str, float]]:
    """Top dominant colors. If foreground_only, image must be RGBA and only alpha>=128 pixels are used."""
    pixels = None
    if foreground_only and pil_image.mode == "RGBA":
        arr = np.array(pil_image)
        h, w = arr.shape[:2]
        crop = 0.65
        y0, y1 = int(h * (1 - crop) / 2), int(h * (1 + crop) / 2)
        x0, x1 = int(w * (1 - crop) / 2), int(w * (1 + crop) / 2)
        arr = arr[max(0, y0):min(h, y1), max(0, x0):min(w, x1)]
        small = np.array(Image.fromarray(arr).resize((80, 80), resample=Image.Resampling.LANCZOS))
        alpha = small[:, :, 3]
        rgb = small[:, :, :3]
        mask = alpha >= 128
        if mask.sum() >= 200:
            pixels = rgb[mask]
    if pixels is None:
        img = pil_image.convert("RGB")
        arr = np.array(img)
        h, w = arr.shape[:2]
        crop = 0.65
        y0, y1 = int(h * (1 - crop) / 2), int(h * (1 + crop) / 2)
        x0, x1 = int(w * (1 - crop) / 2), int(w * (1 + crop) / 2)
        arr = arr[max(0, y0):min(h, y1), max(0, x0):min(w, x1)]
        small = np.array(Image.fromarray(arr).resize((80, 80)))
        pixels = small.reshape(-1, 3)

    q = 32
    quantized = (pixels // (256 // q)) * (256 // q) + (256 // q) // 2
    quantized = np.clip(quantized, 0, 255).astype(np.uint8)

    rounded = (quantized // 16).astype(np.uint32)
    linear = rounded[:, 0] * 256 + rounded[:, 1] * 16 + rounded[:, 2]
    unique, counts = np.unique(linear, return_counts=True)
    total = counts.sum()
    if total == 0:
        return [("#808080", 0.0)]

    # Consider more candidates so plaid/multi-color can yield distinct colors
    n_candidates = min(20, len(unique))
    order = np.argsort(-counts)[:n_candidates]
    # Min RGB distance to treat two colors as distinct (avoids 3 similar dark reds)
    min_dist = 85.0

    out: list[tuple[str, float]] = []
    chosen_rgb: list[tuple[int, int, int]] = []
    for i in order:
        if len(out) >= top_n:
            break
        idx = unique[i]
        r = ((idx // 256) % 16) * 16 + 8
        g = ((idx // 16) % 16) * 16 + 8
        b = (idx % 16) * 16 + 8
        r, g, b = int(r), int(g), int(b)
        if any(_rgb_distance(r, g, b, cr, cg, cb) < min_dist for (cr, cg, cb) in chosen_rgb):
            continue
        chosen_rgb.append((r, g, b))
        conf = float(counts[i] / total)
        out.append((_rgb_to_hex(r, g, b), conf))
    if not out:
        return [("#808080", 0.0)]
    # Renormalize so confidences sum to 1 (relative share among returned colors)
    total_conf = sum(c for _, c in out)
    out = [(hex_c, round(c / total_conf, 4)) for hex_c, c in out]
    return out


# --- Zero-shot classification (CLIP) ------------------------------------------

def _load_clip():
    try:
        from transformers import (
            AutoImageProcessor,
            AutoTokenizer,
            CLIPModel,
            pipeline,
        )
    except ImportError:
        raise ImportError(
            "Install vision deps: pip install 'transformers[torch]' pillow"
        ) from None
    model_id = "openai/clip-vit-base-patch32"
    model = CLIPModel.from_pretrained(model_id)
    try:
        image_processor = AutoImageProcessor.from_pretrained(model_id, use_fast=True)
    except TypeError:
        image_processor = AutoImageProcessor.from_pretrained(model_id)
    tokenizer = AutoTokenizer.from_pretrained(model_id)
    return pipeline(
        task="zero-shot-image-classification",
        model=model,
        image_processor=image_processor,
        tokenizer=tokenizer,
    )


_CACHE: dict[str, Any] = {}


def _classify_zero_shot(pil_image: Image.Image, candidate_labels: list[str], pipe: Any) -> tuple[str, float]:
    """Return best label and its confidence (0-1). Pipeline returns list of {score, label} sorted by score."""
    out = pipe(image=pil_image, candidate_labels=candidate_labels)
    if not out:
        return candidate_labels[0], 0.0
    best = out[0]
    return best["label"], round(float(best["score"]), 4)


# --- Public API --------------------------------------------------------------

def infer_attributes(image_input: str | Path | Image.Image) -> dict[str, Any]:
    """
    Infer clothing attributes from an image.

    Args:
        image_input: Path to image file (str or Path) or a PIL.Image.

    Returns:
        JSON-serializable dict with keys: category, type, color_primary, colors,
        pattern, style. Each value is {"value": ...} or list of same; colors has top 3 for plaid/graphic.
    """
    if isinstance(image_input, (str, Path)):
        pil_image = Image.open(image_input).convert("RGB")
    else:
        pil_image = image_input.convert("RGB")

    # Colors: use foreground-only pixels when background removal is available (drops bg color from list)
    rgba = _remove_background(pil_image)
    if rgba is not None:
        color_list = _extract_dominant_colors(rgba, top_n=3, foreground_only=True)
    else:
        color_list = _extract_dominant_colors(pil_image, top_n=3)
    primary_hex, primary_conf = color_list[0]
    result: dict[str, Any] = {
        "color_primary": {"value": primary_hex, "confidence": primary_conf},
        "colors": [{"value": hex_c, "confidence": conf} for hex_c, conf in color_list],
    }

    # CLIP for category, type, pattern, style
    if "pipe" not in _CACHE:
        _CACHE["pipe"] = _load_clip()
    pipe = _CACHE["pipe"]

    category_labels = [
        "a photo of a top or shirt or blouse or sweater",
        "a photo of pants or jeans or shorts or skirt",
        "a photo of shoes or sneakers or boots or footwear",
    ]
    cat_text, cat_conf = _classify_zero_shot(pil_image, category_labels, pipe)
    category_map = {
        "a photo of a top or shirt or blouse or sweater": "top",
        "a photo of pants or jeans or shorts or skirt": "bottom",
        "a photo of shoes or sneakers or boots or footwear": "footwear",
    }
    result["category"] = {
        "value": category_map.get(cat_text, "top"),
        "confidence": cat_conf,
    }

    # More specific phrases so CLIP distinguishes t-shirt (casual tee) from shirt (collared/formal)
    type_labels = [
        "t-shirt casual short sleeve tee",
        "dress shirt with collar and buttons",
        "sweater knitwear",
        "hoodie with hood",
        "jacket coat",
        "jeans denim",
        "pants trousers",
        "shorts",
        "skirt",
        "sneakers athletic shoes",
        "boots",
        "sandals",
        "dress shoes formal",
    ]
    type_text, type_conf = _classify_zero_shot(pil_image, type_labels, pipe)
    # Map back to short values for API
    type_map = {
        "t-shirt casual short sleeve tee": "t-shirt",
        "dress shirt with collar and buttons": "shirt",
        "sweater knitwear": "sweater",
        "hoodie with hood": "hoodie",
        "jacket coat": "jacket",
        "jeans denim": "jeans",
        "pants trousers": "pants",
        "shorts": "shorts",
        "skirt": "skirt",
        "sneakers athletic shoes": "sneakers",
        "boots": "boots",
        "sandals": "sandals",
        "dress shoes formal": "dress shoes",
    }
    type_val = type_map.get(type_text, type_text if type_text else "t-shirt")
    result["type"] = {"value": type_val, "confidence": type_conf}

    pattern_labels = ["solid color clothing", "striped clothing", "plaid clothing", "floral clothing", "graphic print"]
    pattern_text, pattern_conf = _classify_zero_shot(pil_image, pattern_labels, pipe)
    pattern_map = {
        "solid color clothing": "solid",
        "striped clothing": "striped",
        "plaid clothing": "plaid",
        "floral clothing": "floral",
        "graphic print": "graphic",
    }
    result["pattern"] = {
        "value": pattern_map.get(pattern_text, "solid"),
        "confidence": pattern_conf,
    }

    style_labels = ["casual clothing", "formal clothing", "athletic sportswear", "business professional clothing"]
    style_text, style_conf = _classify_zero_shot(pil_image, style_labels, pipe)
    style_map = {
        "casual clothing": "casual",
        "formal clothing": "formal",
        "athletic sportswear": "athletic",
        "business professional clothing": "business",
    }
    result["style"] = {
        "value": style_map.get(style_text, "casual"),
        "confidence": style_conf,
    }

    return result


def infer_attributes_json(image_input: str | Path | Image.Image) -> str:
    """Same as infer_attributes but returns a JSON string."""
    return json.dumps(infer_attributes(image_input), indent=2)


# --- CLI ---------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python clothing_cv.py <path_to_image>", file=sys.stderr)
        sys.exit(1)
    path = sys.argv[1]
    print(infer_attributes_json(path))
