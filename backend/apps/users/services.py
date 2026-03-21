import hashlib
import json
import time
import random
import string
import threading
import logging
from django.conf import settings

logger = logging.getLogger(__name__)


# #region agent log
def _agent_debug_log_services(hypothesis_id: str, location: str, message: str, data: dict) -> None:
    try:
        with open("/root/.cursor/debug-d69873.log", "a", encoding="utf-8") as _f:
            _f.write(
                json.dumps(
                    {
                        "sessionId": "d69873",
                        "hypothesisId": hypothesis_id,
                        "location": location,
                        "message": message,
                        "data": data,
                        "timestamp": int(time.time() * 1000),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    except Exception:
        pass


# #endregion

REDIS_OTP_TTL = 300
REDIS_SMS_RATE_TTL = 60
REDIS_OTP_KEY = "otp:code:{phone}"
REDIS_SMS_SENT_KEY = "otp:sent:{phone}"
REDIS_VERIFY_ATTEMPTS_KEY = "otp:attempts:{phone}"
MAX_VERIFY_ATTEMPTS = 5
MAX_SEND_CODE_REQUESTS_PER_MINUTE = 2


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
    """Digits only (strip +, spaces, dashes, parens)."""
    return phone.strip().replace("+", "").replace(" ", "").replace("-", "").replace("(", "").replace(")", "")


def send_sms_redsms(phone: str, text: str) -> bool:
    """RedSMS HTTP API. Docs: https://docs.redsms.ru/http/getting-started/"""
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


PINGY_VERIFICATION_USERNAME = "pingy_verification"
PINGY_VERIFICATION_DISPLAY_NAME = "Pingy Verification"
PINGY_VERIFICATION_DEFAULT_PHONE = "+70000000101"


# ---------------------------------------------------------------------------
# Telegram Gateway API — official phone verification bot
# https://core.telegram.org/gateway/api, https://gateway.telegram.org/account/api
# ---------------------------------------------------------------------------

# TTL for sendVerificationMessage: 30–3600 seconds (API docs)
TELEGRAM_GATEWAY_TTL = max(30, min(3600, REDIS_OTP_TTL))

# User-facing messages for common API errors (RU — ответ уходит в detail на фронт)
TELEGRAM_GATEWAY_ERROR_MESSAGES = {
    "ACCESS_TOKEN_INVALID": "Токен Telegram Gateway недействителен или истёк. Обновите ключ в кабинете gateway.telegram.org.",
    "PHONE_NUMBER_INVALID": "Неверный формат номера. Укажите телефон в формате E.164 (например +79001234567).",
    "PHONE_NUMBER_NOT_REGISTERED": "Этот номер не привязан к Telegram. Установите Telegram и привяжите номер.",
}


def send_telegram_verification(phone: str, code: str) -> tuple[dict | None, str | None]:
    """
    Send verification code via Telegram Gateway API (official verification bot).
    Returns (result_dict, None) on success, (None, error_message) on API error (ok=false),
    (None, None) when token is missing or network error (can fallback to SMS).
    """
    import requests

    token = (getattr(settings, "TELEGRAM_GATEWAY_TOKEN", None) or "").strip()
    if not token:
        logger.info("TELEGRAM_GATEWAY_TOKEN not set, skipping Telegram Gateway")
        return (None, None)

    dest = phone.strip()
    if not dest.startswith("+"):
        dest = "+" + dest

    payload = {
        "phone_number": dest,
        "code": str(code),
        "ttl": TELEGRAM_GATEWAY_TTL,
    }

    last_error: str | None = None
    api_error_code: str | None = None  # error code from data["error"] for 503
    proxy_url = (getattr(settings, "TELEGRAM_GATEWAY_HTTPS_PROXY", None) or "").strip()
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None

    for attempt in range(1, 4):
        try:
            resp = requests.post(
                "https://gatewayapi.telegram.org/sendVerificationMessage",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                json=payload,
                proxies=proxies,
                # Keep total worst-case under frontend send-code timeout (connect + read per attempt).
                timeout=(8, 15),
            )
            try:
                data = resp.json()
            except ValueError:
                last_error = f"non-JSON response status={resp.status_code} body={(resp.text or '')[:200]}"
                logger.warning("Telegram Gateway %s", last_error)
                if attempt < 3:
                    time.sleep(0.5)
                continue

            if resp.status_code == 200 and data.get("ok"):
                logger.info(
                    "Telegram Gateway code sent to %s, request_id=%s",
                    dest,
                    data.get("result", {}).get("request_id"),
                )
                # #region agent log
                _agent_debug_log_services(
                    "TG",
                    "services.send_telegram_verification",
                    "tg_finished",
                    {"success": True, "has_api_error_code": False, "api_error_code": ""},
                )
                # #endregion
                return (data.get("result") or {}, None)

            # API returned an error — capture the code to return 503 with a user-friendly message
            api_error_code = data.get("error") if isinstance(data.get("error"), str) else None
            last_error = f"status={resp.status_code} error={api_error_code} body={str(data)[:200]}"
            logger.warning("Telegram Gateway error (attempt %s/3): %s", attempt, last_error)
            if attempt < 3:
                time.sleep(0.5)
        except Exception as e:
            last_error = str(e)
            logger.warning("Telegram Gateway request failed (attempt %s/3): %s", attempt, last_error)
            if attempt < 3:
                time.sleep(0.5)
            continue

    if last_error:
        logger.error("Telegram Gateway failed for %s: %s", dest, last_error)
    # If API returned an explicit error — pass it to the client (503), otherwise None (try SMS)
    user_message = None
    if api_error_code:
        user_message = TELEGRAM_GATEWAY_ERROR_MESSAGES.get(
            api_error_code,
            f"Ошибка Telegram Gateway: {api_error_code}.",
        )
    # #region agent log
    _agent_debug_log_services(
        "TG",
        "services.send_telegram_verification",
        "tg_finished",
        {
            "success": False,
            "has_api_error_code": bool(api_error_code),
            "api_error_code": api_error_code or "",
        },
    )
    # #endregion
    return (None, user_message)


def send_pingy_verification_message(user, code: str) -> bool:
    """Deliver a login code to the user's active Pingy devices via a system DM."""
    from django.db import transaction

    from apps.chats.message_views import _broadcast_new_message, _notify_members_new_message
    from apps.chats.models import Chat, ChatMember, Message
    from apps.chats.serializers import MessageSerializer
    from apps.chats.utils import generate_slug, make_verification_code
    from apps.users.models import User

    if not user or not getattr(user, "pk", None):
        return False

    def _get_or_create_verification_user():
        existing = User.objects.filter(username__iexact=PINGY_VERIFICATION_USERNAME).first()
        if existing:
            return existing

        preferred_phone = str(
            getattr(settings, "PINGY_VERIFICATION_PHONE", "") or PINGY_VERIFICATION_DEFAULT_PHONE
        ).strip() or PINGY_VERIFICATION_DEFAULT_PHONE
        if not preferred_phone.startswith("+"):
            preferred_phone = "+" + preferred_phone

        phone_candidate = preferred_phone
        if User.objects.filter(phone=phone_candidate).exclude(username__iexact=PINGY_VERIFICATION_USERNAME).exists():
            phone_candidate = None
            for suffix in range(101, 1000):
                candidate = f"+70000000{suffix:03d}"
                if not User.objects.filter(phone=candidate).exists():
                    phone_candidate = candidate
                    break
            if phone_candidate is None:
                logger.error("Could not allocate a phone number for @%s", PINGY_VERIFICATION_USERNAME)
                return None

        try:
            return User.objects.create_user(
                phone=phone_candidate,
                password=None,
                username=PINGY_VERIFICATION_USERNAME,
                display_name=PINGY_VERIFICATION_DISPLAY_NAME,
                dm_privacy=User.DM_PRIVACY_EVERYONE,
            )
        except Exception:
            logger.exception("Failed to create @%s system user", PINGY_VERIFICATION_USERNAME)
            return User.objects.filter(username__iexact=PINGY_VERIFICATION_USERNAME).first()

    def _find_existing_dm(left_user, right_user):
        left_chat_ids = ChatMember.objects.filter(
            user=left_user,
            status=ChatMember.Status.ACTIVE,
            chat__is_personal=True,
        ).values_list("chat_id", flat=True)
        right_chat_ids = ChatMember.objects.filter(
            user=right_user,
            status=ChatMember.Status.ACTIVE,
            chat__is_personal=True,
        ).values_list("chat_id", flat=True)
        return (
            Chat.objects.filter(
                is_active=True,
                is_personal=True,
                is_secret=False,
                id__in=left_chat_ids,
            )
            .filter(id__in=right_chat_ids)
            .order_by("created_at")
            .first()
        )

    verification_user = _get_or_create_verification_user()
    if verification_user is None:
        return False

    try:
        with transaction.atomic():
            chat = _find_existing_dm(verification_user, user)
            if chat is None:
                slug = generate_slug()
                while Chat.objects.filter(slug=slug).exists():
                    slug = generate_slug()
                chat = Chat.objects.create(
                    title="Verification",
                    description="",
                    slug=slug,
                    verification_code=make_verification_code(slug),
                    chat_type=None,
                    is_personal=True,
                    is_secret=False,
                    owner=verification_user,
                    is_active=True,
                )
                ChatMember.objects.create(
                    chat=chat,
                    user=verification_user,
                    role=ChatMember.Role.ADMIN,
                    status=ChatMember.Status.ACTIVE,
                )
                ChatMember.objects.create(
                    chat=chat,
                    user=user,
                    role=ChatMember.Role.MEMBER,
                    status=ChatMember.Status.ACTIVE,
                )

            msg = Message.objects.create(
                chat=chat,
                sender=verification_user,
                msg_type=Message.MsgType.TEXT,
                content=(
                    f"Код входа в Pingy: {code}\n"
                    "Он действует 5 минут. Если это не вы, ничего не вводите."
                ),
            )
    except Exception:
        logger.exception("Failed to create Pingy verification DM for user %s", getattr(user, "id", None))
        return False

    try:
        payload = MessageSerializer(msg, context={"request": None, "other_members_read": []}).data
        _broadcast_new_message(str(chat.id), payload)
        _notify_members_new_message(chat.id, verification_user.id, payload)
    except Exception:
        logger.exception("Failed to broadcast Pingy verification DM for user %s", getattr(user, "id", None))

    return True


def set_otp(phone: str, code: str) -> None:
    if _redis_available():
        r = get_redis()
        r.setex(REDIS_OTP_KEY.format(phone=phone), REDIS_OTP_TTL, code)
    else:
        _mem_setex(REDIS_OTP_KEY.format(phone=phone), REDIS_OTP_TTL, code)


def mark_code_sent(phone: str) -> None:
    """Increment per-phone send-code counter in a rolling 60s window."""
    key = REDIS_SMS_SENT_KEY.format(phone=phone)
    if _redis_available():
        redis = get_redis()
        count = redis.incr(key)
        if count == 1:
            redis.expire(key, REDIS_SMS_RATE_TTL)
    else:
        _mem_incr(key, REDIS_SMS_RATE_TTL)


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
    key = REDIS_SMS_SENT_KEY.format(phone=phone)
    if _redis_available():
        raw_count = get_redis().get(key)
    else:
        raw_count = _mem_get(key)

    if raw_count is None:
        return True

    try:
        sent_count = int(raw_count.decode() if isinstance(raw_count, bytes) else raw_count)
    except (TypeError, ValueError):
        return False

    return sent_count < MAX_SEND_CODE_REQUESTS_PER_MINUTE


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
            f"New login: {session.device_label}, "
            f"{session.created_at:%H:%M}. "
            f"Not you? Go to Settings -> Sessions.",
        )
    except Exception:
        logger.exception("Failed to send new-login SMS notification")

