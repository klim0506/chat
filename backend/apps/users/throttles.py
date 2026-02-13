"""
Rate limiting for auth endpoints: send-code, verify-code, refresh.
Uses DRF throttling + Django cache (Redis or LocMem).
"""
from rest_framework.throttling import SimpleRateThrottle
from django.conf import settings


class SendCodeThrottle(SimpleRateThrottle):
    """Ограничение запросов кода: 5 запросов в минуту с одного IP."""
    scope = "auth_send_code"

    def get_rate(self):
        rates = getattr(settings, "REST_FRAMEWORK", {}).get("DEFAULT_THROTTLE_RATES", {})
        return rates.get(self.scope) or super().get_rate()

    def get_cache_key(self, request, view):
        if getattr(request.user, "is_authenticated", False):
            return None
        return self.cache_format % {
            "scope": self.scope,
            "ident": self.get_ident(request),
        }


class VerifyCodeThrottle(SimpleRateThrottle):
    """Ограничение проверки кода: 15 запросов в минуту с одного IP."""
    scope = "auth_verify_code"

    def get_rate(self):
        rates = getattr(settings, "REST_FRAMEWORK", {}).get("DEFAULT_THROTTLE_RATES", {})
        return rates.get(self.scope) or super().get_rate()

    def get_cache_key(self, request, view):
        if getattr(request.user, "is_authenticated", False):
            return None
        return self.cache_format % {
            "scope": self.scope,
            "ident": self.get_ident(request),
        }


class RefreshTokenThrottle(SimpleRateThrottle):
    """Ограничение обновления токена: 30 запросов в минуту с одного IP."""
    scope = "auth_refresh"

    def get_rate(self):
        rates = getattr(settings, "REST_FRAMEWORK", {}).get("DEFAULT_THROTTLE_RATES", {})
        return rates.get(self.scope) or super().get_rate()

    def get_cache_key(self, request, view):
        return self.cache_format % {
            "scope": self.scope,
            "ident": self.get_ident(request),
        }
