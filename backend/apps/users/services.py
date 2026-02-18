import hashlib
import time
import random
import string
import threading
import logging
from django.conf import settings

logger = logging.getLogger(__name__)

REDIS_OTP_TTL = 300
REDIS_SMS_RATE_TTL = 60
REDIS_OTP_KEY = "otp:code:{phone}"
REDIS_SMS_SENT_KEY = "otp:sent:{phone}"
REDIS_VERIFY_ATTEMPTS_KEY = "otp:attempts:{phone}"
MAX_VERIFY_ATTEMPTS = 5


# ---------------------------------------------------------------------------
# In-memory fallback when Redis is not available
# ---------------------------------------------------------------------------
_USE_REDIS = None  # tri-state: None = unknown, True/False
_mem_store: dict[str, tuple[str, float]] = {}  # key -> (value, expire_ts)
_mem_lock = threading.Lock()


def _mem_cleanup():
    """Remove expired keys."""
    now = time.time()
    expired = [k for k, (_, ts) in _mem_store.items() if ts and ts < now]
    for k in expired:
        _mem_store.pop(k, None)


def _mem_setex(key: str, ttl: int, value: str):
    with _mem_lock:
        _mem_cleanup()
        _mem_store[key] = (value, time.time() + ttl)


def _mem_get(key: str) -> bytes | None:
    with _mem_lock:
        _mem_cleanup()
        item = _mem_store.get(key)
        if item is None:
            return None
        return item[0].encode()


def _mem_delete(key: str):
    with _mem_lock:
        _mem_store.pop(key, None)


def _mem_incr(key: str, ttl: int) -> int:
    with _mem_lock:
        _mem_cleanup()
        item = _mem_store.get(key)
        if item is None:
            _mem_store[key] = ("1", time.time() + ttl)
            return 1
        val = int(item[0]) + 1
        _mem_store[key] = (str(val), item[1])
        return val


def _redis_available() -> bool:
    global _USE_REDIS
    if _USE_REDIS is not None:
        return _USE_REDIS
    try:
        import redis as _redis
        r = _redis.from_url(settings.REDIS_URL, socket_connect_timeout=1)
        r.ping()
        _USE_REDIS = True
        logger.info("Redis is available, using Redis for OTP storage")
    except Exception:
        _USE_REDIS = False
        logger.warning("Redis not available, using in-memory OTP storage (dev mode)")
    return _USE_REDIS


def get_redis():
    import redis as _redis
    return _redis.from_url(settings.REDIS_URL)


def generate_code(length=6):
    return "".join(random.choices(string.digits, k=length))



def _normalize_phone(phone: str) -> str:
    """Номер только цифры (без + и пробелов)."""
    return phone.strip().replace("+", "").replace(" ", "").replace("-", "").replace("(", "").replace(")", "")


def send_sms_redsms(phone: str, text: str) -> bool:
    """RedSMS HTTP API. Документация: https://docs.redsms.ru/http/getting-started/"""
    import os
    import requests

    login = os.environ.get("REDSMS_LOGIN") or getattr(settings, "REDSMS_LOGIN", "")
    api_key = os.environ.get("REDSMS_API_KEY") or getattr(settings, "REDSMS_API_KEY", "")
    from_name = os.environ.get("REDSMS_FROM") or getattr(settings, "REDSMS_FROM", "REDSMS.RU")
    if not login or not api_key:
        logger.warning("RedSMS: REDSMS_LOGIN or REDSMS_API_KEY not set")
        return False
    digits = _normalize_phone(phone)
    if not digits:
        logger.warning("RedSMS: empty phone")
        return False
    to_international = "+" + digits
    ts = str(int(time.time()))
    secret = hashlib.md5((ts + api_key).encode()).hexdigest()
    headers = {"login": login, "ts": ts, "secret": secret, "Content-Type": "application/json"}
    payload = {"route": "sms", "from": from_name, "to": to_international, "text": text}
    try:
        r = requests.post("https://cp.redsms.ru/api/message", headers=headers, json=payload, timeout=15)
        data = r.json() if r.text else {}
        if r.status_code == 200 and data.get("success") and not data.get("errors"):
            logger.info(f"RedSMS sent to {to_international}, uuid={data.get('items', [{}])[0].get('uuid', '')}")
            return True
        logger.warning(f"RedSMS failed: status={r.status_code}, body={data}")
        return False
    except Exception as e:
        logger.exception(f"RedSMS request failed: {e}")
        return False


def send_sms(phone: str, text: str) -> bool:
    """Send SMS via RedSMS HTTP API."""
    return send_sms_redsms(phone, text)


# ---------------------------------------------------------------------------
# Telegram Gateway API — send verification codes via @VerificationCodes
# ---------------------------------------------------------------------------

def send_telegram_verification(phone: str, code: str) -> dict | None:
    """
    Send a verification code via Telegram Gateway API (@VerificationCodes bot).
    Returns the request status dict on success, None on failure.
    """
    import requests

    token = getattr(settings, "TELEGRAM_GATEWAY_TOKEN", "")
    if not token:
        logger.info("TELEGRAM_GATEWAY_TOKEN not set, skipping Telegram Gateway")
        return None

    dest = phone.strip()
    if not dest.startswith("+"):
        dest = "+" + dest

    payload = {
        "phone_number": dest,
        "code": str(code),
        "ttl": REDIS_OTP_TTL,
    }

    last_error: str | None = None
    for attempt in range(1, 3):
        try:
            resp = requests.post(
                "https://gatewayapi.telegram.org/sendVerificationMessage",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                json=payload,
                timeout=(3.05, 12),
            )
            try:
                data = resp.json()
            except ValueError:
                last_error = f"non-JSON response status={resp.status_code} body={(resp.text or '')[:200]}"
                logger.warning("Telegram Gateway %s", last_error)
                continue

            if resp.status_code == 200 and data.get("ok"):
                logger.info(
                    "Telegram Gateway code sent to %s, request_id=%s",
                    dest,
                    data.get("result", {}).get("request_id"),
                )
                return data.get("result") or {}

            last_error = f"status={resp.status_code} error={data.get('error')} body={str(data)[:200]}"
            logger.warning("Telegram Gateway error (attempt %s/2): %s", attempt, last_error)
        except Exception as e:
            last_error = str(e)
            logger.warning("Telegram Gateway request failed (attempt %s/2): %s", attempt, last_error)
            continue

    if last_error:
        logger.error("Telegram Gateway failed for %s: %s", dest, last_error)
    return None


def set_otp(phone: str, code: str) -> None:
    if _redis_available():
        r = get_redis()
        r.setex(REDIS_OTP_KEY.format(phone=phone), REDIS_OTP_TTL, code)
    else:
        _mem_setex(REDIS_OTP_KEY.format(phone=phone), REDIS_OTP_TTL, code)


def mark_code_sent(phone: str) -> None:
    """Per-phone rate limit marker to prevent spamming send-code."""
    if _redis_available():
        get_redis().setex(REDIS_SMS_SENT_KEY.format(phone=phone), REDIS_SMS_RATE_TTL, "1")
    else:
        _mem_setex(REDIS_SMS_SENT_KEY.format(phone=phone), REDIS_SMS_RATE_TTL, "1")


def set_otp_and_mark_sent(phone: str, code: str) -> None:
    """Store OTP and set per-phone send marker (call only after successful delivery)."""
    set_otp(phone, code)
    mark_code_sent(phone)


def get_otp(phone: str) -> str | None:
    if _redis_available():
        r = get_redis()
        val = r.get(REDIS_OTP_KEY.format(phone=phone))
        return val.decode() if val else None
    else:
        val = _mem_get(REDIS_OTP_KEY.format(phone=phone))
        return val.decode() if val else None


def delete_otp(phone: str) -> None:
    if _redis_available():
        get_redis().delete(REDIS_OTP_KEY.format(phone=phone))
    else:
        _mem_delete(REDIS_OTP_KEY.format(phone=phone))


def can_send_sms(phone: str) -> bool:
    # Backwards-compatible name: used for any auth code delivery method.
    if _redis_available():
        return get_redis().get(REDIS_SMS_SENT_KEY.format(phone=phone)) is None
    return _mem_get(REDIS_SMS_SENT_KEY.format(phone=phone)) is None


def incr_verify_attempts(phone: str) -> int:
    if _redis_available():
        r = get_redis()
        key = REDIS_VERIFY_ATTEMPTS_KEY.format(phone=phone)
        n = r.incr(key)
        if n == 1:
            r.expire(key, REDIS_OTP_TTL)
        return n
    else:
        return _mem_incr(REDIS_VERIFY_ATTEMPTS_KEY.format(phone=phone), REDIS_OTP_TTL)


# ---------------------------------------------------------------------------
# New-login notification (WebSocket if online, SMS if offline)
# ---------------------------------------------------------------------------

def notify_new_login(user, session) -> None:
    """Notify the user about a new login on another device.
    Uses WebSocket if the user has an active connection, SMS otherwise.
    Should be called only for existing users (not first registration)."""
    from apps.users.online import is_online

    if is_online(str(user.id)):
        # Send via WebSocket (free, instant)
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync

            channel_layer = get_channel_layer()
            if channel_layer is not None:
                async_to_sync(channel_layer.group_send)(
                    f"user_{user.id}",
                    {
                        "type": "notify.new_login",
                        "session_id": str(session.id),
                        "device": session.device_label,
                        "ip": session.ip_address or "",
                        "time": session.created_at.isoformat(),
                    },
                )
                return
        except Exception:
            logger.exception("Failed to send new-login notification via WebSocket")
            # Fall through to SMS

    # Fallback: SMS
    try:
        send_sms(
            user.phone,
            f"Новый вход: {session.device_label}, "
            f"{session.created_at:%H:%M}. "
            f"Не вы? Зайдите в Настройки -> Сессии.",
        )
    except Exception:
        logger.exception("Failed to send new-login SMS notification")

