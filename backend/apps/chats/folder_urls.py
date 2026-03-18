"""URLs for chat folders."""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .folder_views import ChatFolderViewSet

router = DefaultRouter()
router.register(r"", ChatFolderViewSet, basename="chat-folder")

urlpatterns = [
    path("", include(router.urls)),
]
