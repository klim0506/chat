from django.db import models
from django.conf import settings
from django.db.models import Q
from django.utils import timezone
import uuid

from .fields import EncryptedTextField

# Member limits: 10 000 for groups (no expansion tiers)
DEFAULT_MAX_MEMBERS = 10000
EXPANSION_TIER_100 = 100
EXPANSION_TIER_1000 = 1000

# Pinned message limits by expansion tier
PIN_LIMITS = {
    None: 1,                # no expansion — 1 pinned
    EXPANSION_TIER_100: 5,  # tier 100 — up to 5
    EXPANSION_TIER_1000: 20,  # tier 1000 — up to 20
}


class Chat(models.Model):
    class ChatType(models.TextChoices):
        OPEN = "open", "Открытый"
        CLOSED = "closed", "Закрытый"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255)
    title_icon = models.CharField(
        max_length=16, blank=True, default="",
        help_text="Эмодзи справа от названия (как в Telegram)",
    )
    description = models.TextField(blank=True, default="", help_text="Описание группы")
    avatar = models.ImageField(upload_to="chat_avatars/", null=True, blank=True, help_text="Аватарка чата")
    background = models.ImageField(upload_to="chat_backgrounds/", null=True, blank=True, help_text="Фоновое изображение чата")
    slug = models.SlugField(max_length=20, unique=True, db_index=True)
    verification_code = models.CharField(max_length=64)
    # Personal chats have no type; only groups have a type (open/closed)
    chat_type = models.CharField(max_length=10, choices=ChatType.choices, null=True, blank=True)
    is_personal = models.BooleanField(
        default=False,
        help_text="Личный чат (на двоих, без ссылки-приглашения и без типа). Группа из 2 человек — не личный чат.",
    )
    is_secret = models.BooleanField(
        default=False,
        help_text="Секретный чат с E2EE. Сообщения шифруются на клиенте; на сервере хранится только ciphertext. "
                  "Не синхронизируется между устройствами, нет серверного поиска.",
    )
    is_favorites = models.BooleanField(
        default=False,
        help_text="Чат «Избранное» — только владелец, никого нельзя добавить.",
    )
    max_members = models.PositiveIntegerField(default=DEFAULT_MAX_MEMBERS)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="owned_chats")
    is_active = models.BooleanField(default=True)
    expanded_until = models.DateTimeField(
        null=True, blank=True,
        help_text="До когда действует прокачка (100 или 1000 участников)",
    )
    expansion_tier = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="Уровень прокачки: 100 или 1000 участников",
    )
    slow_mode_seconds = models.PositiveIntegerField(
        default=0,
        help_text="0 = disabled; min seconds between messages per user (owners/admins exempt)",
    )
    pinned_message = models.ForeignKey(
        "Message",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pinned_in_chats",
        help_text="Сообщение, закреплённое для всех в чате",
    )
    has_telegram_import = models.BooleanField(
        default=False,
        help_text="Был ли импорт истории из Telegram; переключает кнопку «Импорт» → «Управление импортом»",
    )
    telegram_import_mappings = models.JSONField(
        default=dict,
        blank=True,
        help_text="Маппинг display_name -> user_id для уже сопоставленных участников импорта (для экрана «Управление импортом»).",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def is_expanded(self) -> bool:
        if not self.expanded_until:
            return False
        from django.utils import timezone
        return self.expanded_until > timezone.now()

    @property
    def effective_max_members(self) -> int:
        if self.is_favorites:
            return self.max_members  # Favorites: 1
        return 10000

    @property
    def max_pins(self) -> int:
        """Maximum number of pinned-for-all messages (depends on expansion tier)."""
        if self.is_expanded:
            return PIN_LIMITS.get(self.expansion_tier, 1)
        return 1

    class Meta:
        verbose_name = "Чат"
        verbose_name_plural = "Чаты"


class ChatFolder(models.Model):
    """User-created folder to organize chats (Telegram-style)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_folders")
    name = models.CharField(max_length=64)
    emoji = models.CharField(max_length=8, blank=True, default="")
    color = models.CharField(max_length=20, blank=True, default="", help_text="Hex color for tab (e.g. #3B82F6)")
    position = models.PositiveSmallIntegerField(default=0, help_text="Display order")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "created_at"]
        verbose_name = "Папка чатов"
        verbose_name_plural = "Папки чатов"


class ChatFolderChat(models.Model):
    """Chats in a user's folder."""
    folder = models.ForeignKey(ChatFolder, on_delete=models.CASCADE, related_name="chats")
    chat = models.ForeignKey(Chat, on_delete=models.CASCADE, related_name="folder_memberships")
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("folder", "chat")
        verbose_name = "Чат в папке"
        verbose_name_plural = "Чаты в папках"


class ChatMember(models.Model):
    class Role(models.TextChoices):
        ADMIN = "admin", "Администратор"
        MEMBER = "member", "Участник"

    class Status(models.TextChoices):
        ACTIVE = "active", "Активный"
        PENDING = "pending", "Ожидает подтверждения"
        KICKED = "kicked", "Исключён"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    chat = models.ForeignKey(Chat, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_memberships")
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.MEMBER)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    joined_at = models.DateTimeField(auto_now_add=True)
    last_read_at = models.DateTimeField(
        null=True, blank=True,
        help_text="Когда пользователь последний раз прочитал чат",
    )
    muted_until = models.DateTimeField(
        null=True, blank=True,
        help_text="Беззвучный режим до указанного времени. null = не замьючен; дата в прошлом = отключено; дата в будущем = замьючен.",
    )

    pin_order = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        db_index=True,
        help_text="Pinned chat order for current user (1..N). Null means not pinned.",
    )
    is_archived = models.BooleanField(
        default=False,
        help_text="Чат убран в архив (скрыт из основного списка)",
    )

    @property
    def is_muted(self) -> bool:
        if not self.muted_until:
            return False
        return self.muted_until > timezone.now()

    class Meta:
        unique_together = ("chat", "user")
        verbose_name = "Участник чата"
        verbose_name_plural = "Участники чатов"


class Message(models.Model):
    class MsgType(models.TextChoices):
        TEXT = "text", "Текст"
        FILE = "file", "Файл"
        AUDIO = "audio", "Аудио"
        VIDEO = "video", "Видео"
        VIDEO_CIRCLE = "video_circle", "Видео-кружочек"
        EMOJI = "emoji", "Эмодзи"
        GIF = "gif", "GIF"
        STICKER = "sticker", "Стикер"
        POLL = "poll", "Опрос"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    chat = models.ForeignKey(Chat, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sent_messages")
    sender_display_name = models.CharField(
        max_length=255,
        null=True,
        blank=True,
        help_text="Отображаемое имя при импорте из Telegram (когда нет привязки к User)",
    )
    msg_type = models.CharField(max_length=20, choices=MsgType.choices, default=MsgType.TEXT)
    content = EncryptedTextField(blank=True)
    file = models.ForeignKey("files.FileAttachment", on_delete=models.SET_NULL, null=True, blank=True, related_name="messages")
    files = models.ManyToManyField(
        "files.FileAttachment", blank=True, related_name="multi_messages",
        help_text="Несколько файлов (изображений) в одном сообщении",
    )
    # Reply (quote) — single-level quoting
    reply_to = models.ForeignKey(
        "self", on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="replies",
        help_text="Сообщение, на которое отвечаем (одноуровневое цитирование)",
    )
    # Forward — who forwarded and from where
    forwarded_from = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="forwarded_messages",
        help_text="Оригинальный отправитель пересланного сообщения",
    )
    forwarded_from_chat = models.ForeignKey(
        Chat, on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="forwarded_from_messages",
        help_text="Оригинальный чат пересланного сообщения",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False)
    # Audio waveform amplitudes (array of 0–255, ~60–80 values)
    waveform = models.JSONField(null=True, blank=True)
    # Voice message duration in seconds (for display before audio loads)
    duration_seconds = models.FloatField(null=True, blank=True)

    # E2EE: when is_encrypted=True, content holds base64 ciphertext
    is_encrypted = models.BooleanField(default=False)
    sender_device = models.ForeignKey(
        "e2ee.Device",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sent_messages",
        help_text="Устройство отправителя (для E2EE)",
    )
    # Encrypted message key per device: {"<device_id>": {"type": 0|1, "body": "<base64>"}}
    # type 0 = PreKeyWhisperMessage, type 1 = WhisperMessage
    encrypted_keys = models.JSONField(default=dict, blank=True)
    # Link preview (OG-meta): { "url", "title", "description", "image" }
    link_preview = models.JSONField(null=True, blank=True)
    # Self-destruct TTL: message is soft-deleted when expires_at passes
    expires_at = models.DateTimeField(
        null=True, blank=True,
        help_text="When this message should self-destruct (soft-delete). Celery task cleans expired.",
    )
    # Poll data: { "options": ["A","B"], "multiple": false, "anonymous": false, "quiz": false, "correct_index": null }
    poll_data = models.JSONField(
        null=True, blank=True,
        help_text="Poll config: options (list), multiple, anonymous, quiz, correct_index",
    )
    delete_after_read = models.BooleanField(
        default=False,
        help_text="Удалить сообщение после просмотра получателем",
    )

    class Meta:
        ordering = ["created_at"]
        verbose_name = "Сообщение"
        verbose_name_plural = "Сообщения"
        indexes = [
            models.Index(fields=["chat", "is_deleted", "created_at"], name="chats_msg_chat_del_created"),
            models.Index(fields=["expires_at"], name="chats_msg_expires", condition=Q(is_deleted=False)),
        ]


# Reaction stickers (15 fun and diverse emojis)
REACTION_EMOJIS = [
    "🔥", "💫", "✨", "❤️", "🥰", "😂", "😎", "🎉", "🙌", "👏", "💪", "🤩", "🌟", "😮", "😢",
]
# Maximum reactions a single user can add to one message
MAX_REACTIONS_PER_USER = 3


class UserPinnedMessage(models.Model):
    """Message pinned by a user for themselves (visible only to them)."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="pinned_messages")
    chat = models.ForeignKey(Chat, on_delete=models.CASCADE, related_name="user_pins")
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="pinned_by_users")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "chat", "message")
        ordering = ["-created_at"]
        verbose_name = "Закреплённое сообщение (для себя)"
        verbose_name_plural = "Закреплённые сообщения (для себя)"


class ChatPinnedMessage(models.Model):
    """Message pinned for all chat members (admin/owner). Multiple pins supported."""
    chat = models.ForeignKey(Chat, on_delete=models.CASCADE, related_name="pinned_messages_all")
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="pinned_in_chats_all")
    pinned_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="pinned_for_all")
    pin_order = models.PositiveIntegerField(default=0, help_text="Порядок отображения (больше = новее)")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("chat", "message")
        ordering = ["-pin_order"]
        verbose_name = "Закреплённое сообщение (для всех)"
        verbose_name_plural = "Закреплённые сообщения (для всех)"


class PollVote(models.Model):
    """User vote on a poll message. One vote per (message, user)."""
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="poll_votes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="poll_votes")
    option_indices = models.JSONField(
        default=list,
        help_text="Array of option indices [0], [0,2], etc. Empty = unvote.",
    )

    class Meta:
        unique_together = ("message", "user")
        verbose_name = "Голос в опросе"
        verbose_name_plural = "Голоса в опросах"


class MessageReaction(models.Model):
    """User reaction to a message. One user — up to MAX_REACTIONS_PER_USER reactions (each emoji type only once)."""
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="message_reactions")
    emoji = models.CharField(max_length=16)

    class Meta:
        unique_together = ("message", "user", "emoji")
        verbose_name = "Реакция на сообщение"
        verbose_name_plural = "Реакции на сообщения"


class ScheduledMessage(models.Model):
    """Scheduled or recurring message in a chat."""
    class Recurrence(models.TextChoices):
        NONE = "none", "Один раз"
        DAILY = "daily", "Каждый день"
        WEEKLY = "weekly", "Раз в неделю"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    chat = models.ForeignKey(Chat, on_delete=models.CASCADE, related_name="scheduled_messages")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="scheduled_messages")
    content = EncryptedTextField()
    scheduled_at = models.DateTimeField(help_text="Когда отправить (или следующий запуск для рекуррентных)")
    recurrence = models.CharField(max_length=10, choices=Recurrence.choices, default=Recurrence.NONE)
    recurrence_time = models.TimeField(null=True, blank=True, help_text="Время суток для daily/weekly")
    recurrence_weekday = models.SmallIntegerField(
        null=True, blank=True,
        help_text="0=пн, 6=вс для weekly",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["scheduled_at"]
        verbose_name = "Отложенное сообщение"
        verbose_name_plural = "Отложенные сообщения"


# --- Channels (Telegram-style: open/closed, posts, comments) ---


class Channel(models.Model):
    """Канал: открытый (по ссылке) или закрытый (по приглашению)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255)
    title_icon = models.CharField(
        max_length=16, blank=True, default="",
        help_text="Эмодзи справа от названия (как в Telegram)",
    )
    description = models.TextField(blank=True, default="")
    avatar = models.ImageField(upload_to="channel_avatars/", null=True, blank=True)
    slug = models.SlugField(max_length=32, unique=True, db_index=True)
    """Публичный username канала (как @channelname). Уникален среди пользователей и каналов."""
    username = models.CharField(max_length=30, null=True, blank=True, db_index=True)
    verification_code = models.CharField(max_length=64)
    is_public = models.BooleanField(
        default=True,
        help_text="Открытый канал: можно вступить по ссылке. Закрытый: только по приглашению (одобрение владельца).",
    )
    comments_enabled = models.BooleanField(
        default=True,
        help_text="Разрешить комментарии к постам.",
    )
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="owned_channels")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Канал"
        verbose_name_plural = "Каналы"


class ChannelMember(models.Model):
    """Участник канала: владелец, администратор или подписчик."""
    class Role(models.TextChoices):
        OWNER = "owner", "Владелец"
        ADMIN = "admin", "Администратор"
        SUBSCRIBER = "subscriber", "Подписчик"

    class Status(models.TextChoices):
        ACTIVE = "active", "Активный"
        PENDING = "pending", "Ожидает подтверждения"
        KICKED = "kicked", "Исключён"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    channel = models.ForeignKey(Channel, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="channel_memberships")
    role = models.CharField(max_length=12, choices=Role.choices, default=Role.SUBSCRIBER)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    is_muted = models.BooleanField(default=False, help_text="Отключить звук/уведомления для этого канала (для пользователя).")
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("channel", "user")
        verbose_name = "Участник канала"
        verbose_name_plural = "Участники каналов"


class ChannelPost(models.Model):
    """Пост в канале. Типы контента как у Message (text, file, audio, video, gif, sticker, emoji)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    channel = models.ForeignKey(Channel, on_delete=models.CASCADE, related_name="posts")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="channel_posts")
    msg_type = models.CharField(max_length=20, choices=Message.MsgType.choices, default=Message.MsgType.TEXT)
    content = EncryptedTextField(blank=True)
    file = models.ForeignKey(
        "files.FileAttachment", on_delete=models.SET_NULL, null=True, blank=True, related_name="channel_posts"
    )
    files = models.ManyToManyField(
        "files.FileAttachment", blank=True, related_name="multi_channel_posts",
        help_text="Несколько файлов (изображений) в одном посте",
    )
    forwarded_from = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="forwarded_channel_posts",
    )
    forwarded_from_chat = models.ForeignKey(
        Chat, on_delete=models.SET_NULL, null=True, blank=True, related_name="forwarded_to_channel_posts",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False)
    waveform = models.JSONField(null=True, blank=True)
    is_encrypted = models.BooleanField(default=False)
    sender_device = models.ForeignKey(
        "e2ee.Device", on_delete=models.SET_NULL, null=True, blank=True, related_name="channel_posts_sent",
    )
    encrypted_keys = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Пост канала"
        verbose_name_plural = "Посты каналов"
        indexes = [
            models.Index(fields=["channel", "is_deleted", "created_at"], name="chats_chpost_ch_del_created"),
        ]


class ChannelPostView(models.Model):
    """Просмотр поста канала пользователем (уникально: пользователь × пост)."""
    post = models.ForeignKey(ChannelPost, on_delete=models.CASCADE, related_name="views")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="channel_post_views")
    viewed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("post", "user")
        verbose_name = "Просмотр поста канала"
        verbose_name_plural = "Просмотры постов канала"
        indexes = [
            models.Index(fields=["post", "viewed_at"], name="chats_chpostv_post_viewed"),
            models.Index(fields=["user", "viewed_at"], name="chats_chpostv_user_viewed"),
        ]


class ChannelPostComment(models.Model):
    """Комментарий к посту. Те же типы контента, что и в чатах."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    post = models.ForeignKey(ChannelPost, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="channel_post_comments")
    msg_type = models.CharField(max_length=20, choices=Message.MsgType.choices, default=Message.MsgType.TEXT)
    content = EncryptedTextField(blank=True)
    file = models.ForeignKey(
        "files.FileAttachment", on_delete=models.SET_NULL, null=True, blank=True, related_name="channel_post_comments"
    )
    files = models.ManyToManyField(
        "files.FileAttachment", blank=True, related_name="multi_channel_post_comments",
    )
    reply_to = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="replies",
        help_text="Ответ на другой комментарий",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False)
    waveform = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
        verbose_name = "Комментарий к посту"
        verbose_name_plural = "Комментарии к постам"


class ChannelPostReaction(models.Model):
    """Реакция на пост канала (как MessageReaction)."""
    post = models.ForeignKey(ChannelPost, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="channel_post_reactions")
    emoji = models.CharField(max_length=16)

    class Meta:
        unique_together = ("post", "user", "emoji")
        verbose_name = "Реакция на пост"
        verbose_name_plural = "Реакции на посты"


# --- Sticker packs (Telegram-style) ---

RECENT_STICKERS_LIMIT = 50


class StickerSet(models.Model):
    """Набор стикеров пользователя."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="owned_sticker_sets"
    )
    title = models.CharField(max_length=64)
    short_name = models.SlugField(max_length=32, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("owner", "short_name")
        ordering = ["created_at"]
        verbose_name = "Набор стикеров"
        verbose_name_plural = "Наборы стикеров"


class Sticker(models.Model):
    """Один стикер в наборе (PNG/WebP или Lottie JSON)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    pack = models.ForeignKey(
        StickerSet, on_delete=models.CASCADE, related_name="stickers"
    )
    file = models.ForeignKey(
        "files.FileAttachment", on_delete=models.CASCADE, related_name="stickers"
    )
    emoji = models.CharField(max_length=16, blank=True, default="")
    label = models.CharField(max_length=64, blank=True, default="")
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "created_at"]
        verbose_name = "Стикер"
        verbose_name_plural = "Стикеры"


class UserStickerSet(models.Model):
    """Установленный пак стикеров пользователя."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="installed_sticker_sets"
    )
    stickerset = models.ForeignKey(
        StickerSet, on_delete=models.CASCADE, related_name="installed_by"
    )
    order = models.PositiveIntegerField(default=0)
    installed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "stickerset")
        ordering = ["order", "installed_at"]
        verbose_name = "Установленный набор стикеров"
        verbose_name_plural = "Установленные наборы стикеров"


class RecentSticker(models.Model):
    """Недавно использованный стикер."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="recent_stickers"
    )
    sticker = models.ForeignKey(
        Sticker, on_delete=models.CASCADE, related_name="recent_by"
    )
    used_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("user", "sticker")
        ordering = ["-used_at"]
        verbose_name = "Недавний стикер"
        verbose_name_plural = "Недавние стикеры"
