from rest_framework import serializers
from .models import FileAttachment


class FileAttachmentSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = FileAttachment
        fields = ("id", "original_name", "mime_type", "size_bytes", "storage_type", "url", "created_at")
        read_only_fields = ("id", "original_name", "mime_type", "size_bytes", "storage_type", "created_at")

    def get_url(self, obj):
        if obj.external_url:
            return obj.external_url
        from .views import make_file_token
        token = make_file_token(str(obj.id))
        path = f"/api/files/{obj.id}/?t={token}"
        request = self.context.get("request")
        if request:
            return request.build_absolute_uri(path)
        return path
