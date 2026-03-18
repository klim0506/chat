"""
Health check endpoint for load balancers and monitoring.
GET /api/health/ — 200 if app is up; optional ?deep=1 checks DB connectivity.
No authentication; keep logic minimal to avoid timeouts.
"""
from django.http import JsonResponse
from django.views import View
from django.utils.decorators import method_decorator
from django.views.decorators.http import require_GET
from django.db import connection


@method_decorator(require_GET, name="get")
class HealthView(View):
    def get(self, request):
        deep = request.GET.get("deep") in ("1", "true", "yes")
        if not deep:
            return JsonResponse({"status": "ok"}, status=200)

        # Deep check: DB connectivity (one cheap query)
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
        except Exception:
            return JsonResponse({"status": "error", "db": "unavailable"}, status=503)
        return JsonResponse({"status": "ok", "db": "ok"}, status=200)
