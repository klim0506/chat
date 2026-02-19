"""Server-side image compression for avatars and backgrounds.

Resizes images to fit within max dimensions and converts to WebP
for non-transparent images or PNG for transparent ones.
"""
from io import BytesIO

from django.core.files.uploadedfile import InMemoryUploadedFile, SimpleUploadedFile
from PIL import Image, ImageOps


AVATAR_MAX_DIM = 512
BACKGROUND_MAX_DIM = 1920
JPEG_QUALITY = 82
WEBP_QUALITY = 82
SKIP_BELOW_BYTES = 50 * 1024  # don't bother compressing tiny files


def compress_uploaded_image(
    file_obj,
    *,
    max_dim: int = AVATAR_MAX_DIM,
    quality: int = WEBP_QUALITY,
) -> SimpleUploadedFile:
    """Compress an uploaded image file. Returns a new file object.

    - Resizes to fit within max_dim x max_dim (preserving aspect ratio)
    - Auto-rotates via EXIF
    - Converts to WebP (or PNG if transparent)
    - Falls back to original if compression doesn't save space
    """
    original_bytes = file_obj.read()
    file_obj.seek(0)
    original_size = len(original_bytes)

    try:
        img = Image.open(BytesIO(original_bytes))
    except Exception:
        return file_obj

    img = ImageOps.exif_transpose(img)
    has_alpha = img.mode in ("RGBA", "LA") or (
        img.mode == "P" and "transparency" in img.info
    )

    img.thumbnail((max_dim, max_dim), Image.LANCZOS)

    buf = BytesIO()
    if has_alpha:
        if img.mode != "RGBA":
            img = img.convert("RGBA")
        img.save(buf, format="PNG", optimize=True)
        out_ext = ".png"
        out_mime = "image/png"
    else:
        img = img.convert("RGB")
        img.save(buf, format="WEBP", quality=quality, method=4)
        out_ext = ".webp"
        out_mime = "image/webp"

    compressed_bytes = buf.getvalue()

    if len(compressed_bytes) >= original_size * 0.95:
        return file_obj

    original_name = getattr(file_obj, "name", "image") or "image"
    stem = original_name.rsplit(".", 1)[0] if "." in original_name else original_name
    new_name = f"{stem}{out_ext}"

    return SimpleUploadedFile(new_name, compressed_bytes, content_type=out_mime)
