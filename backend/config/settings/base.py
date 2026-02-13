import os
from pathlib import Path

import environ

env = environ.Env(DEBUG=(bool, False))

BASE_DIR = Path(__file__).resolve().parent.parent.parent

environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("SECRET_KEY", default="")

DEBUG = env("DEBUG")

# Р РµР¶РёРј РѕС‚Р»Р°РґРєРё Р°РІС‚РѕСЂРёР·Р°С†РёРё: РґР»СЏ РЅРѕРјРµСЂРѕРІ РёР· AUTH_DEBUG_PHONES РЅРµ РѕС‚РїСЂР°РІР»СЏРµС‚СЃСЏ SMS,
# РІС…РѕРґ РїРѕ РєРѕРґСѓ РёР· AUTH_DEBUG_CODE. РўРѕР»СЊРєРѕ РґР»СЏ СЂР°Р·СЂР°Р±РѕС‚РєРё.
AUTH_DEBUG = env.bool("AUTH_DEBUG", default=False)
AUTH_DEBUG_PHONES = env.list(
    "AUTH_DEBUG_PHONES",
    default=[],
)
AUTH_DEBUG_CODE = env("AUTH_DEBUG_CODE", default="")

if not DEBUG and not SECRET_KEY:
    raise RuntimeError("SECRET_KEY must be set when DEBUG=False")

ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

INSTALLED_APPS = [
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "apps.users",
    "apps.chats",
    "apps.e2ee",
    "apps.payments",
    "apps.files",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

WSGI_APPLICATION = "config.wsgi.application"

if env.bool("USE_SQLITE", default=False):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }
else:
    DATABASES = {
        "default": env.db(
            "DATABASE_URL",
            default="postgres://postgres:postgres@localhost:5432/chatdb",
        )
    }

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "ru-ru"
TIME_ZONE = "Europe/Moscow"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_USER_MODEL = "users.User"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.users.auth.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_THROTTLE_RATES": {
        "auth_send_code": env("AUTH_SEND_CODE_RATE", default="5/min"),
        "auth_verify_code": "15/min",
        "auth_refresh": "30/min",
        "payments_webhook": "60/min",
    },
}

# В dev-режиме ослабляем лимиты, чтобы тестовые входы не упирались в 429.
if DEBUG:
    REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["auth_send_code"] = env("AUTH_SEND_CODE_RATE", default="1000/min")

CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=["http://localhost:5173", "http://127.0.0.1:5173"])
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_ALL_ORIGINS = env.bool("CORS_ALLOW_ALL_ORIGINS", default=False)
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])

if not DEBUG:
    SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=31536000)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = env.bool("SECURE_HSTS_PRELOAD", default=False)
    SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SESSION_COOKIE_HTTPONLY = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_BROWSER_XSS_FILTER = True
    X_FRAME_OPTIONS = "DENY"
    REFERRER_POLICY = "strict-origin-when-cross-origin"

REDIS_URL = env("REDIS_URL", default="redis://localhost:6379/0")

# Detect if Redis is available; fall back to InMemoryChannelLayer for local dev
def _check_redis(url):
    try:
        import redis as _redis
        r = _redis.from_url(url, socket_connect_timeout=1)
        r.ping()
        return True
    except Exception:
        return False

_REDIS_OK = _check_redis(REDIS_URL)

if _REDIS_OK:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": REDIS_URL,
        }
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        }
    }

if _REDIS_OK:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {
                "hosts": [REDIS_URL],
            },
        },
    }
else:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels.layers.InMemoryChannelLayer",
        },
    }

ASGI_APPLICATION = "config.asgi.application"

if _REDIS_OK:
    CELERY_BROKER_URL = env("REDIS_URL", default="redis://localhost:6379/1")
    CELERY_RESULT_BACKEND = env("REDIS_URL", default="redis://localhost:6379/1")
else:
    CELERY_BROKER_URL = "memory://"
    CELERY_RESULT_BACKEND = "cache+memory://"

CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = TIME_ZONE
CELERY_TASK_ALWAYS_EAGER = not _REDIS_OK  # execute tasks synchronously when no Redis

FILE_UPLOAD_MAX_MEMORY_SIZE = 512 * 1024 * 1024   # 0.5 Р“Р‘
DATA_UPLOAD_MAX_MEMORY_SIZE = 512 * 1024 * 1024  # 0.5 Р“Р‘

# Frontend URL for invite links etc.
FRONTEND_URL = env("FRONTEND_URL", default="http://localhost:5173")

# Telegram auth
TELEGRAM_BOT_USERNAME = env("TELEGRAM_BOT_USERNAME", default="")
TELEGRAM_BOT_SECRET = env("TELEGRAM_BOT_SECRET", default="")

# Telegram Gateway API (verification codes via @VerificationCodes)
TELEGRAM_GATEWAY_TOKEN = env("TELEGRAM_GATEWAY_TOKEN", default="")


