from django.urls import path
from .views import FileUploadView, SecureFileServeView

urlpatterns = [
    path("upload/", FileUploadView.as_view(), name="file-upload"),
    path("<uuid:file_id>/", SecureFileServeView.as_view(), name="file-serve"),
]
