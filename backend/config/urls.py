from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import HttpResponseRedirect
from django.urls import path, include

from config.geo_views import CountryCodeView


def redirect_join_to_frontend(request, _rest):
    """Редирект пригласительной ссылки на фронтенд (при открытии /chat/join/... на бэкенде)."""
    base = getattr(settings, "FRONTEND_URL", "").rstrip("/")
    if not base:
        base = request.build_absolute_uri("/").rstrip("/")
    return HttpResponseRedirect(base + request.get_full_path())


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.users.urls")),
    path("api/geo/country-code/", CountryCodeView.as_view(), name="geo-country-code"),
    path("api/chats/", include("apps.chats.urls")),
    path("api/payments/", include("apps.payments.urls")),
    path("api/files/", include("apps.files.urls")),
    path("api/e2ee/", include("apps.e2ee.urls")),
    path("api/gif/", include("apps.chats.gif_urls")),
    path("chat/join/<path:_rest>", redirect_join_to_frontend),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
