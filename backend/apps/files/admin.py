from django.contrib import admin
from .models import ChunkedUploadSession, FileAttachment


@admin.register(FileAttachment)
class FileAttachmentAdmin(admin.ModelAdmin):
    list_display = ("original_name", "uploader", "storage_type", "size_bytes", "created_at")


@admin.register(ChunkedUploadSession)
class ChunkedUploadSessionAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "original_name", "total_parts", "created_at")
    list_filter = ("created_at",)
