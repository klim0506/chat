"""
Лимиты и ограничения по тарифным планам.

Три плана:
- Free: нет активной подписки (истек trial или не было)
- Trial: активный пробный период подписки
- Premium: оплаченная подписка

Trial и Premium имеют полный доступ. Free — ограниченный.
"""


def _user_has_subscription(user) -> bool:
    """Есть ли у пользователя активная подписка (trial или paid)."""
    sub = getattr(user, "subscription", None)
    if sub is None:
        from .models import UserSubscription
        sub = UserSubscription.objects.filter(user=user).first()
    return sub is not None and sub.is_valid


# --- Лимиты Free (если !has_subscription) ---

BIO_MAX_FREE = 60
BIO_MAX_PREMIUM = 150

FREE_FILE_SIZE_BYTES = 500 * 1024 * 1024  # 500 MB
PREMIUM_FILE_SIZE_BYTES = 4 * 1024 * 1024 * 1024  # 4 GB

FREE_AVATARS_MAX = 5
PREMIUM_AVATARS_MAX = 50

FREE_PINNED_CHATS_MAX = 3
PREMIUM_PINNED_CHATS_MAX = 10

FREE_REACTIONS_PER_MESSAGE = 1
PREMIUM_REACTIONS_PER_MESSAGE = 3

# Файлы в день: Free — 20, Premium — без лимита
FREE_DAILY_FILE_UPLOADS = 20
# Premium: без лимита (возвращаем None в get_max_daily_file_uploads)

# Poll: Free — нет; Premium — любые опросы и викторины
# Video circles: Free — 3 в день; Premium — без лимита
FREE_DAILY_VIDEO_CIRCLES = 3
# Scheduled messages: Free — нет; Premium — да
# Folders: Free — нет; Premium — да
# Каналы: создать канал и настройки — доступны всем; публиковать посты — только Premium
# Import TG: Free — нет; Premium — да
# Custom stickers: Free — нет (только базовый набор pingy); Premium — да
# Privacy (dm, add_to_group, phone, last_seen): Free — нет; Premium — да


def get_max_bio_length(user) -> int:
    """Максимальная длина поля «О себе»: 60 для free, 150 для подписки (BIO_MAX_PREMIUM)."""
    if _user_has_subscription(user):
        return BIO_MAX_PREMIUM
    return BIO_MAX_FREE


def get_max_file_size_bytes(user) -> int:
    if _user_has_subscription(user):
        return PREMIUM_FILE_SIZE_BYTES
    return FREE_FILE_SIZE_BYTES


def get_max_avatars(user) -> int:
    if _user_has_subscription(user):
        return PREMIUM_AVATARS_MAX
    return FREE_AVATARS_MAX


def get_max_pinned_chats(user) -> int:
    if _user_has_subscription(user):
        return PREMIUM_PINNED_CHATS_MAX
    return FREE_PINNED_CHATS_MAX


def get_max_reactions_per_message(user) -> int:
    if _user_has_subscription(user):
        return PREMIUM_REACTIONS_PER_MESSAGE
    return FREE_REACTIONS_PER_MESSAGE


def get_max_daily_file_uploads(user) -> int | None:
    """Максимум загрузок файлов в день. None = без лимита (Premium)."""
    if _user_has_subscription(user):
        return None
    return FREE_DAILY_FILE_UPLOADS


def can_use_video_circles(user) -> bool:
    """Все могут отправлять кружочки: Free — до 3 в день; Premium — без лимита."""
    return True


def can_send_video_circle_today(user) -> bool:
    """True если можно отправить кружок: Premium — всегда; Free — не более FREE_DAILY_VIDEO_CIRCLES в день."""
    remaining = get_video_circles_remaining_today(user)
    return remaining is None or remaining > 0


def get_video_circles_remaining_today(user) -> int | None:
    """Сколько кружков можно ещё отправить сегодня. None = без лимита (Premium)."""
    if _user_has_subscription(user):
        return None
    from django.utils import timezone
    from apps.chats.models import Message
    today = timezone.now().date()
    count = Message.objects.filter(
        sender=user,
        msg_type=Message.MsgType.VIDEO_CIRCLE,
        created_at__date=today,
        is_deleted=False,
    ).count()
    return max(0, FREE_DAILY_VIDEO_CIRCLES - count)


def can_use_scheduled_messages(user) -> bool:
    return _user_has_subscription(user)


def can_create_folders(user) -> bool:
    return _user_has_subscription(user)


def can_post_channel_content(user) -> bool:
    """Публикация и редактирование постов в канале (owner/admin) — только с подпиской."""
    return _user_has_subscription(user)


def can_import_telegram(user) -> bool:
    return _user_has_subscription(user)


def can_create_custom_stickers(user) -> bool:
    return _user_has_subscription(user)


def can_use_privacy_settings(user) -> bool:
    """dm_privacy, add_to_group_privacy, show_phone, show_last_seen."""
    return _user_has_subscription(user)


def can_create_poll(user) -> bool:
    """Free — опросы и викторины недоступны; Premium — любые опросы и викторины."""
    return _user_has_subscription(user)


def can_use_extended_reactions(user) -> bool:
    """Free — 1 эмодзи из фиксированного набора; Premium — до 3 из любого."""
    return _user_has_subscription(user)


# Код ошибки для фронтенда (в detail или code)
RESTRICTION_CODE = "plan_restriction"


class PlanRestrictionError(Exception):
    """Исключение для ограничений по тарифу — возвращает 403 с code=plan_restriction."""
    def __init__(self, detail: str):
        self.detail = detail
        super().__init__(detail)
