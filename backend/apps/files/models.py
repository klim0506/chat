from django.db import models
from django.conf import settings
import uuid


class FileAttachment(models.Model):
    class StorageType(models.TextChoices):
        LOCAL = "local", "Локально"
        GOOGLE_DRIVE = "google_drive", "Google Drive"
        MAILRU_CLOUD = "mailru_cloud", "Mail.ru Облако"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    uploader = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="uploaded_files")
    original_name = models.CharField(max_length=512)
    file_path = models.CharField(max_length=1024)
    mime_type = models.CharField(max_length=255, default="application/octet-stream")
    size_bytes = models.BigIntegerField(default=0)
    storage_type = models.CharField(max_length=20, choices=StorageType.choices, default=StorageType.LOCAL)
    external_url = models.URLField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Файл"
        verbose_name_plural = "Файлы"
