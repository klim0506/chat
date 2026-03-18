import json
import secrets
import hashlib
import hmac
from pathlib import Path

from django.conf import settings

SLUG_LENGTH = 12

_RESERVED_USERNAMES_CACHE: set[str] | None = None


def _load_reserved_usernames() -> set[str]:
    """Load reserved usernames from JSON (cached)."""
    global _RESERVED_USERNAMES_CACHE
    if _RESERVED_USERNAMES_CACHE is not None:
        return _RESERVED_USERNAMES_CACHE
    path = Path(__file__).resolve().parent / "reserved_usernames.json"
    result: set[str] = set()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        for cat_usernames in data.get("categories", {}).values():
            if not isinstance(cat_usernames, list):
                continue
            for u in cat_usernames:
                if isinstance(u, str) and u:
                    result.add(u.strip().lower())
        # Flat list at top level
        usernames = data.get("usernames", [])
        if isinstance(usernames, list):
            for u in usernames:
                if isinstance(u, str) and u:
                    result.add(u.strip().lower())
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    _RESERVED_USERNAMES_CACHE = result
    return result


def is_username_available(normalized: str, exclude_channel=None):
    """
    Check that username is not taken by any User or Channel (case-insensitive).
    Reserved usernames (from reserved_usernames.json) are unavailable except when
    exclude_channel already has that username (assigned by staff).
    exclude_channel: Channel instance to exclude when updating (allow keeping own username).
    """
    from apps.users.models import User
    from .models import Channel

    if not normalized:
        return True
    norm = normalized.strip().lower()
    reserved = _load_reserved_usernames()
    if norm in reserved:
        if exclude_channel and exclude_channel.username and exclude_channel.username.lower() == norm:
            pass
        else:
            return False
    if User.objects.filter(username__iexact=norm).exists():
        return False
    qs = Channel.objects.filter(username__iexact=norm)
    if exclude_channel:
        qs = qs.exclude(pk=exclude_channel.pk)
    return not qs.exists()


def generate_slug():
    return secrets.token_urlsafe(SLUG_LENGTH)[:SLUG_LENGTH].replace("-", "x").replace("_", "y")


def make_verification_code(slug: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), slug.encode(), hashlib.sha256).hexdigest()[:16]


def verify_invite_code(slug: str, code: str) -> bool:
    if not slug or not code:
        return False
    return hmac.compare_digest(make_verification_code(slug), code)


DEFAULT_MAX_MEMBERS = 10
