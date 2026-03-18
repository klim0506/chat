from django.urls import path
from .views import ChunkedUploadCancelView, ChunkedUploadView, FileUploadView, SecureFileServeView

urlpatterns = [
    path("upload/", FileUploadView.as_view(), name="file-upload"),
    path("upload/chunk/", ChunkedUploadView.as_view(), name="file-upload-chunk"),
    path("upload/chunk/cancel/", ChunkedUploadCancelView.as_view(), name="file-upload-chunk-cancel"),
    path("<uuid:file_id>/", SecureFileServeView.as_view(), name="file-serve"),
]
