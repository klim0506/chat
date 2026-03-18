from .base import *  # noqa: F401, F403

DEBUG = True
ALLOWED_HOSTS = ["*"]
CORS_ALLOW_ALL_ORIGINS = True
# Local dev: no SSL, backend on http://127.0.0.1:8000
SECURE_SSL_REDIRECT = False
