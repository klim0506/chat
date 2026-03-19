from django.urls import path
from .views import MediaAccessView, ProtectedMediaServeView

urlpatterns = [
    path("access/", MediaAccessView.as_view(), name="media-access"),
    path("serve/", ProtectedMediaServeView.as_view(), name="protected-media-serve"),
]
