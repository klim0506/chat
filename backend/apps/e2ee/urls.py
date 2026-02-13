from django.urls import path
from .views import DeviceViewSet, KeyBundleView, PreKeyUploadView, SignedPreKeyRotateView

urlpatterns = [
    path("devices/", DeviceViewSet.as_view({"get": "list", "post": "create"})),  # list, create
    path("devices/<uuid:pk>/", DeviceViewSet.as_view({"delete": "destroy"})),
    path("keys/<uuid:user_id>/", KeyBundleView.as_view()),
    path("keys/prekeys/", PreKeyUploadView.as_view()),
    path("keys/signed-prekey/", SignedPreKeyRotateView.as_view()),
]
