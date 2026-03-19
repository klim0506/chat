from rest_framework import serializers
from .models import FileAttachment
from .access_handles import make_file_handle


class FileAttachmentSerializer(serializers.ModelSerializer):
    access_handle = serializers.SerializerMethodField()

    class Meta:
        model = FileAttachment
        fields = ("id", "original_name", "mime_type", "size_bytes", "storage_type", "access_handle", "created_at", "width_px", "height_px")
        read_only_fields = ("id", "original_name", "mime_type", "size_bytes", "storage_type", "created_at", "width_px", "height_px")

    def get_access_handle(self, obj):
        if obj.external_url:
            return obj.external_url
        return make_file_handle(obj.id)
