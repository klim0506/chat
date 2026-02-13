import secrets
import hashlib
import hmac
from django.conf import settings

SLUG_LENGTH = 12


def generate_slug():
    return secrets.token_urlsafe(SLUG_LENGTH)[:SLUG_LENGTH].replace("-", "x").replace("_", "y")


def make_verification_code(slug: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), slug.encode(), hashlib.sha256).hexdigest()[:16]


def verify_invite_code(slug: str, code: str) -> bool:
    if not slug or not code:
        return False
    return hmac.compare_digest(make_verification_code(slug), code)


DEFAULT_MAX_MEMBERS = 10
