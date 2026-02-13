from django.db import models
from django.conf import settings
import uuid

# Лимиты участников: базовый 10, прокачка 50 звёзд → 100, 100 звёзд → 1000
DEFAULT_MAX_MEMBERS = 10
EXPANSION_TIER_100 = 100
EXPANSION_TIER_1000 = 1000

# Лимиты закреплённых сообщений по уровню прокачки
PIN_LIMITS = {
    None: 1,                # без прокачки — 1 закреплённое
    EXPANSION_TIER_100: 5,  # tier 100 — до 5
    EXPANSION_TIER_1000: 20,  # tier 1000 — до 20
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
    # У личного чата типа нет; только группы имеют тип (open/closed)
    chat_type = models.CharField(max_length=10, choices=ChatType.choices, null=True, blank=True)
    is_personal = models.BooleanField(
        default=False,
        help_text="Личный чат (на двоих, без ссылки-приглашения и без типа). Группа из 2 человек — не личный чат.",
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
        """Максимальное количество закреплённых для всех сообщений (зависит от уровня прокачки)."""
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
    is_muted = models.BooleanField(
        default=False,
        help_text="Беззвучный режим — уведомления не приходят",
    )

    pin_order = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        db_index=True,
        help_text="Pinned chat order for current user (1..N). Null means not pinned.",
    )

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

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    chat = models.ForeignKey(Chat, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sent_messages")
    msg_type = models.CharField(max_length=20, choices=MsgType.choices, default=MsgType.TEXT)
    content = models.TextField(blank=True)
    file = models.ForeignKey("files.FileAttachment", on_delete=models.SET_NULL, null=True, blank=True, related_name="messages")
    files = models.ManyToManyField(
        "files.FileAttachment", blank=True, related_name="multi_messages",
        help_text="Несколько файлов (изображений) в одном сообщении",
    )
    # Reply (quote) — одноуровневое цитирование
    reply_to = models.ForeignKey(
        "self", on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="replies",
        help_text="Сообщение, на которое отвечаем (одноуровневое цитирование)",
    )
    # Forward — кто и откуда переслал
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
    # Амплитуды для визуализации аудио (массив 0–255, ~60–80 значений)
    waveform = models.JSONField(null=True, blank=True)

    # E2EE: при is_encrypted=True content содержит base64 ciphertext
    is_encrypted = models.BooleanField(default=False)
    sender_device = models.ForeignKey(
        "e2ee.Device",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sent_messages",
        help_text="Устройство отправителя (для E2EE)",
    )
    # Шифрованный message key для каждого устройства: {"<device_id>": {"type": 0|1, "body": "<base64>"}}
    # type 0 = PreKeyWhisperMessage, type 1 = WhisperMessage
    encrypted_keys = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["created_at"]
        verbose_name = "Сообщение"
        verbose_name_plural = "Сообщения"


# Стикеры для реакций (15 штук, прикольные и разнообразные)
REACTION_EMOJIS = [
    "🔥", "💫", "✨", "❤️", "🥰", "😂", "😎", "🎉", "🙌", "👏", "💪", "🤩", "🌟", "😮", "😢",
]
# Сколько реакций может поставить один пользователь на одно сообщение
MAX_REACTIONS_PER_USER = 3


class UserPinnedMessage(models.Model):
    """Закрепление сообщения пользователем для себя (видно только ему)."""
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
    """Закрепление сообщения для всех участников чата (admin/owner). Несколько закреплённых."""
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
    """Реакция пользователя на сообщение. Один пользователь — до MAX_REACTIONS_PER_USER реакций (один тип эмодзи один раз)."""
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="message_reactions")
    emoji = models.CharField(max_length=16)

    class Meta:
        unique_together = ("message", "user", "emoji")
        verbose_name = "Реакция на сообщение"
        verbose_name_plural = "Реакции на сообщения"


class ScheduledMessage(models.Model):
    """Отложенное или рекуррентное сообщение в чат."""
    class Recurrence(models.TextChoices):
        NONE = "none", "Один раз"
        DAILY = "daily", "Каждый день"
        WEEKLY = "weekly", "Раз в неделю"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    chat = models.ForeignKey(Chat, on_delete=models.CASCADE, related_name="scheduled_messages")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="scheduled_messages")
    content = models.TextField()
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
