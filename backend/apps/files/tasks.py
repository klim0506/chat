from __future__ import annotations

from pathlib import Path

from celery import shared_task
from django.conf import settings
from django.utils import timezone
from PIL import Image, ImageOps

from .models import FileAttachment

# Standard EICAR AV test signature.
EICAR_SIGNATURE = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"


def _resolve_local_path(att: FileAttachment) -> Path | None:
    media_root = Path(settings.MEDIA_ROOT).resolve()
    full_path = (media_root / att.file_path).resolve()
    if media_root not in full_path.parents or not full_path.is_file():
        return None
    return full_path


def _detect_malware(full_path: Path) -> tuple[bool, str]:
    """
    Lightweight scanner stub for queue-based validation.
    If ClamAV integration is added later, this function is the extension point.
    """
    try:
        content = full_path.read_bytes()
    except OSError as exc:
        return True, f"read-error:{exc}"
    if EICAR_SIGNATURE in content:
        return True, "eicar-signature"
    return False, ""


@shared_task
def optimize_uploaded_image(file_id: str) -> None:
    """
    Optimize uploaded raster image asynchronously.
    Runs only for files that already passed malware scan.
    """
    try:
        att = FileAttachment.objects.get(pk=file_id)
    except FileAttachment.DoesNotExist:
        return

    if att.scan_status != FileAttachment.ScanStatus.CLEAN:
        return
    if att.storage_type != FileAttachment.StorageType.LOCAL:
        return
    if not att.mime_type.startswith("image/"):
        return
    if att.mime_type in {"image/gif", "image/svg+xml"}:
        return

    full_path = _resolve_local_path(att)
    if not full_path:
        return

    ext = full_path.suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        return

    original_size = full_path.stat().st_size
    if original_size <= 250 * 1024:
        return

    with Image.open(full_path) as img:
        img = ImageOps.exif_transpose(img)
        max_dim = 2560
        if img.width > max_dim or img.height > max_dim:
            img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

        temp_path = full_path.with_suffix(f"{full_path.suffix}.opt")
        if ext in {".jpg", ".jpeg"}:
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            img.save(temp_path, format="JPEG", quality=82, optimize=True, progressive=True)
        elif ext == ".png":
            if img.mode not in ("RGB", "RGBA", "P", "L"):
                img = img.convert("RGBA")
            img.save(temp_path, format="PNG", optimize=True, compress_level=9)
        else:
            if img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGB")
            img.save(temp_path, format="WEBP", quality=82, method=6)

    optimized_size = temp_path.stat().st_size if temp_path.exists() else original_size
    if optimized_size < original_size:
        temp_path.replace(full_path)
        att.size_bytes = optimized_size
        att.save(update_fields=["size_bytes"])
    elif temp_path.exists():
        temp_path.unlink(missing_ok=True)


@shared_task
def scan_uploaded_file(file_id: str) -> None:
    """
    Queue-based malware scanning.
    File is not accessible for users until status becomes CLEAN.
    """
    try:
        att = FileAttachment.objects.get(pk=file_id)
    except FileAttachment.DoesNotExist:
        return

    if att.storage_type != FileAttachment.StorageType.LOCAL:
        att.scan_status = FileAttachment.ScanStatus.CLEAN
        att.scanned_at = timezone.now()
        att.scan_details = "non-local"
        att.save(update_fields=["scan_status", "scanned_at", "scan_details"])
        return

    full_path = _resolve_local_path(att)
    if not full_path:
        att.scan_status = FileAttachment.ScanStatus.ERROR
        att.scanned_at = timezone.now()
        att.scan_details = "file-not-found"
        att.save(update_fields=["scan_status", "scanned_at", "scan_details"])
        return

    infected, details = _detect_malware(full_path)
    att.scan_status = FileAttachment.ScanStatus.INFECTED if infected else FileAttachment.ScanStatus.CLEAN
    att.scanned_at = timezone.now()
    att.scan_details = details
    att.save(update_fields=["scan_status", "scanned_at", "scan_details"])

    if not infected:
        optimize_uploaded_image.delay(str(att.id))

