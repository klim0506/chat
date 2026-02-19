from django.urls import path
from .views import ProtectedMediaServeView

urlpatterns = [
    path("serve/", ProtectedMediaServeView.as_view(), name="protected-media-serve"),
]
