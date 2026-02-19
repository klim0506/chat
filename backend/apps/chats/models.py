from django.db import models
from django.conf import settings
from django.utils import timezone
import uuid

from .fields import EncryptedTextField

# Member limits: base 10, upgrade 50 stars → 100, 100 stars → 1000
DEFAULT_MAX_MEMBERS = 10
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
    pinned_message = models.ForeignKey(
        "Message",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pinned_in_chats",
        help_text="Сообщение, закреплённое для всех в чате",
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
        if self.is_expanded and self.expansion_tier in (EXPANSION_TIER_100, EXPANSION_TIER_1000):
            return self.expansion_tier
        return self.max_members

    @property
    def max_pins(self) -> int:
        """Maximum number of pinned-for-all messages (depends on expansion tier)."""
        if self.is_expanded:
            return PIN_LIMITS.get(self.expansion_tier, 1)
        return 1

    class Meta:
        verbose_name = "Чат"
        verbose_name_plural = "Чаты"


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

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    chat = models.ForeignKey(Chat, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sent_messages")
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

    class Meta:
        ordering = ["created_at"]
        verbose_name = "Сообщение"
        verbose_name_plural = "Сообщения"


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
