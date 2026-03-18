"""
Rate limiting for auth endpoints: send-code, verify-code, refresh.
Uses DRF throttling + Django cache (Redis or LocMem).
"""
from rest_framework.throttling import SimpleRateThrottle
from django.conf import settings


def _normalize_phone(phone: str) -> str:
    p = (phone or "").replace(" ", "").replace("-", "").replace("(", "").replace(")", "").strip()
    return p if p.startswith("+") else "+" + p


def _is_debug_phone(phone: str) -> bool:
    if not getattr(settings, "AUTH_DEBUG", False):
        return False
    normalized = _normalize_phone(phone)
    return normalized in getattr(settings, "AUTH_DEBUG_PHONES", [])


class SendCodeThrottle(SimpleRateThrottle):
    """Ограничение запросов кода: 5 запросов в минуту с одного IP. Debug-номера не ограничиваются."""
    scope = "auth_send_code"

    def get_rate(self):
        rates = getattr(settings, "REST_FRAMEWORK", {}).get("DEFAULT_THROTTLE_RATES", {})
        return rates.get(self.scope) or super().get_rate()

    def get_cache_key(self, request, view):
        if getattr(request.user, "is_authenticated", False):
            return None
        phone = (request.data or {}).get("phone", "")
        if _is_debug_phone(phone):
            return None  # No throttle for debug phones
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


class PairingExchangeThrottle(SimpleRateThrottle):
    """Ограничение обмена pairing-кода: 20 запросов в минуту с одного IP (защита от перебора)."""
    scope = "auth_pairing_exchange"

    def get_rate(self):
        rates = getattr(settings, "REST_FRAMEWORK", {}).get("DEFAULT_THROTTLE_RATES", {})
        return rates.get(self.scope) or super().get_rate()

    def get_cache_key(self, request, view):
        return self.cache_format % {
            "scope": self.scope,
            "ident": self.get_ident(request),
        }
