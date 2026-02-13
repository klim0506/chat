from django.contrib import admin
from .models import FileAttachment


@admin.register(FileAttachment)
class FileAttachmentAdmin(admin.ModelAdmin):
    list_display = ("original_name", "uploader", "storage_type", "size_bytes", "created_at")
