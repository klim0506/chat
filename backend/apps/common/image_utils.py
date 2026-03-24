"""Server-side image compression for avatars and backgrounds.

Stores full photos (with max dimension limit) in slightly compressed quality.
Aspect ratio is preserved; no cropping to circle — circle is display-only in the UI.

Avatar storage: 3 versions only — original, medium (160px), small (64px).
"""
from io import BytesIO
from pathlib import Path

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image, ImageOps


# Full photo size cap (avatars stored as full image, not tiny circle crop)
AVATAR_MAX_DIM = 1200
BACKGROUND_MAX_DIM = 1920
JPEG_QUALITY = 85
WEBP_QUALITY = 85
SKIP_BELOW_BYTES = 50 * 1024  # don't bother compressing tiny files

# Pre-generated avatar thumbnails (stored on disk, not on-the-fly)
AVATAR_SIZE_SMALL = 64   # chat header, message bubble, read-by
AVATAR_SIZE_MEDIUM = 160  # info panel, chat list


def compress_uploaded_image(
    file_obj,
    *,
    max_dim: int = AVATAR_MAX_DIM,
    quality: int = WEBP_QUALITY,
) -> SimpleUploadedFile:
    """Compress an uploaded image file. Returns a new file object.

    - Resizes to fit within max_dim x max_dim (preserving aspect ratio; full photo, not crop)
    - Auto-rotates via EXIF
    - Converts to WebP (or PNG if transparent) with slight quality reduction
    - Falls back to original if compression doesn't save space
    """
    original_bytes = file_obj.read()
    file_obj.seek(0)
    original_size = len(original_bytes)

    try:
        img = Image.open(BytesIO(original_bytes))
    except Exception:
        return file_obj

    # Keep animated avatars as-is (GIF/WebP/APNG): converting to static kills animation.
    if bool(getattr(img, "is_animated", False)) or int(getattr(img, "n_frames", 1) or 1) > 1:
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


def _avatar_thumbnail_path(original_path: str, size: int) -> str:
    """Derive thumbnail path: avatars/abc.webp -> avatars/abc_64.webp"""
    p = Path(original_path)
    return str(p.parent / f"{p.stem}_{size}.webp")


def create_avatar_thumbnails(original_path: str) -> bool:
    """
    Create 2 pre-stored thumbnails from original avatar.
    Saves avatars/xxx_64.webp and avatars/xxx_160.webp.
    Returns True if both were created, False otherwise.
    """
    from django.core.files.storage import default_storage

    media_root = Path(settings.MEDIA_ROOT).resolve()
    full_path = (media_root / original_path).resolve()
    if not full_path.is_file() or media_root not in full_path.parents and full_path != media_root:
        return False

    try:
        with Image.open(full_path) as img:
            img = ImageOps.exif_transpose(img)
            # Do not create static thumbnails for animated avatars.
            if bool(getattr(img, "is_animated", False)) or int(getattr(img, "n_frames", 1) or 1) > 1:
                return False
            has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)

            for size in (AVATAR_SIZE_SMALL, AVATAR_SIZE_MEDIUM):
                thumb = img.copy()
                thumb.thumbnail((size, size), Image.LANCZOS)
                buf = BytesIO()
                if has_alpha:
                    if thumb.mode != "RGBA":
                        thumb = thumb.convert("RGBA")
                    thumb.save(buf, format="WEBP", quality=85, method=4, lossless=False)
                else:
                    thumb = thumb.convert("RGB")
                    thumb.save(buf, format="WEBP", quality=85, method=4)
                buf.seek(0)
                thumb_path = _avatar_thumbnail_path(original_path, size)
                full_thumb = media_root / thumb_path
                full_thumb.parent.mkdir(parents=True, exist_ok=True)
                full_thumb.write_bytes(buf.getvalue())
    except Exception:
        return False
    return True


def get_avatar_thumbnail_path(original_path: str, size: str) -> str | None:
    """Return thumbnail path for size 'small' (64) or 'medium' (160)."""
    sz = AVATAR_SIZE_SMALL if size == "small" else AVATAR_SIZE_MEDIUM if size == "medium" else None
    return _avatar_thumbnail_path(original_path, sz) if sz else None


def delete_avatar_thumbnails(original_path: str) -> None:
    """Remove pre-stored thumbnails when avatar is replaced/deleted."""
    media_root = Path(settings.MEDIA_ROOT).resolve()
    for size in (AVATAR_SIZE_SMALL, AVATAR_SIZE_MEDIUM):
        thumb_path = _avatar_thumbnail_path(original_path, size)
        full = media_root / thumb_path
        if full.is_file():
            try:
                full.unlink()
            except OSError:
                pass
