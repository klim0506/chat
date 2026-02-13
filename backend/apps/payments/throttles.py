"""
Rate limiting for payment webhook (YooKassa). Защита от флуда и DoS.
"""
from rest_framework.throttling import SimpleRateThrottle


class WebhookThrottle(SimpleRateThrottle):
    """Ограничение вызовов webhook: 60 запросов в минуту с одного IP."""
    scope = "payments_webhook"
    rate = "60/min"

    def get_cache_key(self, request, view):
        return self.cache_format % {
            "scope": self.scope,
            "ident": self.get_ident(request),
        }
