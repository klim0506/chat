from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import HttpResponseRedirect
from django.urls import path, include

from config.geo_views import CountryCodeView
from config.health_views import HealthView
from apps.tracking.views import TrackingRedirectView


def redirect_join_to_frontend(request, _rest):
    """Redirect invite link to frontend (when /chat/join/... is opened on the backend)."""
    base = getattr(settings, "FRONTEND_URL", "").rstrip("/")
    if not base:
        base = request.build_absolute_uri("/").rstrip("/")
    return HttpResponseRedirect(base + request.get_full_path())


urlpatterns = [
    path("api/health/", HealthView.as_view(), name="health"),
    path("admin/", admin.site.urls),
    path("t/<slug:slug>/", TrackingRedirectView.as_view(), name="tracking-redirect"),
    path("api/admin/", include("apps.tracking.urls")),
    path("api/auth/", include("apps.users.urls")),
    path("api/geo/country-code/", CountryCodeView.as_view(), name="geo-country-code"),
    path("api/chats/", include("apps.chats.urls")),
    path("api/channels/", include("apps.chats.channel_urls")),
    path("api/payments/", include("apps.payments.urls")),
    path("api/files/", include("apps.files.urls")),
    path("api/media/", include("apps.files.media_urls")),
    path("api/e2ee/", include("apps.e2ee.urls")),
    path("api/gif/", include("apps.chats.gif_urls")),
    path("api/stickers/", include("apps.chats.sticker_urls")),
    path("chat/join/<path:_rest>", redirect_join_to_frontend),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
