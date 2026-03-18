"""Simple geo endpoint: proxy IP→country on the server to avoid CORS and 403 from public APIs."""
import logging
from urllib.request import urlopen
from urllib.error import URLError
import json

from django.http import JsonResponse
from django.views import View
from django.utils.decorators import method_decorator
from django.views.decorators.http import require_GET

logger = logging.getLogger(__name__)

# Server-side only; no CORS. ip-api.com allows non-commercial use.
GEO_URL = "http://ip-api.com/json/?fields=status,countryCode"


@method_decorator(require_GET, name="get")
class CountryCodeView(View):
    """GET /api/geo/country-code/ → { \"country_code\": \"RU\" } or 204/null on failure."""

    def get(self, request):
        try:
            with urlopen(GEO_URL, timeout=3) as resp:
                data = json.loads(resp.read().decode())
        except (URLError, OSError, ValueError) as e:
            logger.debug("Geo lookup failed: %s", e)
            return JsonResponse({"country_code": None}, status=200)

        if data.get("status") != "success":
            return JsonResponse({"country_code": None}, status=200)

        code = data.get("countryCode")
        if isinstance(code, str):
            code = code.upper()
        else:
            code = None
        return JsonResponse({"country_code": code}, status=200)
