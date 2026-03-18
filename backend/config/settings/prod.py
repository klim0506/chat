from .base import *  # noqa: F401, F403
import sys

DEBUG = False
# Force auth debug off in production regardless of .env
AUTH_DEBUG = False
AUTH_DEBUG_PHONES = []
AUTH_DEBUG_CODE = ""
# Ensure debug middleware never runs in prod (base may have loaded with DEBUG from .env)
MIDDLEWARE = [m for m in MIDDLEWARE if m != "config.debug_middleware.DebugConnectionMiddleware"]
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
# Off: nginx terminates SSL and redirects HTTP→HTTPS; backend is only reached via nginx (no redirect loop).
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=False)
_use_https = True  # Browser always uses HTTPS; secure cookies required
SESSION_COOKIE_SECURE = _use_https
CSRF_COOKIE_SECURE = _use_https
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

# Django's test client uses HTTP; disable redirect only during test runs.
if "test" in sys.argv:
    SECURE_SSL_REDIRECT = False
