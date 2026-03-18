from django.conf import settings
from django.db import models
import uuid


class ChunkedUploadSession(models.Model):
    """Temporary session for chunked file upload (like Telegram). Parts are written to disk, not RAM."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chunked_upload_sessions")
    temp_dir = models.CharField(max_length=512)  # path under MEDIA_ROOT
    original_name = models.CharField(max_length=512)
    mime_type = models.CharField(max_length=255, default="application/octet-stream")
    total_parts = models.PositiveIntegerField()
    chat_id = models.UUIDField(null=True, blank=True)
    is_encrypted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)


class FileAttachment(models.Model):
    class StorageType(models.TextChoices):
        LOCAL = "local", "Local"
        GOOGLE_DRIVE = "google_drive", "Google Drive"
        MAILRU_CLOUD = "mailru_cloud", "Mail.ru Cloud"

    class ScanStatus(models.TextChoices):
        CLEAN = "clean", "Clean"
        PENDING = "pending", "Pending scan"
        INFECTED = "infected", "Infected"
        ERROR = "error", "Scan error"
        ENCRYPTED = "encrypted", "E2EE encrypted (skip scan)"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    uploader = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="uploaded_files")
    original_name = models.CharField(max_length=512)
    file_path = models.CharField(max_length=1024)
    mime_type = models.CharField(max_length=255, default="application/octet-stream")
    size_bytes = models.BigIntegerField(default=0)
    storage_type = models.CharField(max_length=20, choices=StorageType.choices, default=StorageType.LOCAL)
    external_url = models.URLField(blank=True, null=True)
    scan_status = models.CharField(
        max_length=16,
        choices=ScanStatus.choices,
        default=ScanStatus.CLEAN,
        db_index=True,
    )
    scanned_at = models.DateTimeField(null=True, blank=True)
    is_encrypted = models.BooleanField(
        default=False,
        help_text="E2EE: file is opaque ciphertext, skip MIME/AV validation",
    )
    scan_details = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    # Image dimensions (set on upload for image/*) — avoids layout shift when rendering before load
    width_px = models.PositiveIntegerField(null=True, blank=True)
    height_px = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        verbose_name = "Файл"
        verbose_name_plural = "Файлы"

