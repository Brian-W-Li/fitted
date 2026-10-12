"""Regenerate the wholly synthetic EXIF-6 fixture; no closet photos are used."""

from pathlib import Path


def orientation_bytes() -> bytes:
    import io
    from PIL import Image

    image = Image.new("RGB", (32, 16))
    for y in range(16):
        for x in range(32):
            image.putpixel((x, y), (240, 20, 20) if x < 16 else (20, 20, 240))
    exif = Image.Exif()
    exif[274] = 6
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=95, subsampling=0, exif=exif)
    image.close()
    return buffer.getvalue()


if __name__ == "__main__":
    Path(__file__).with_name("orientation_6.jpg").write_bytes(orientation_bytes())
