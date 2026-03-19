from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower
from django.utils import timezone
import secrets
import uuid


def _generate_referral_code() -> str:
    """Generate a short unique referral code (8 chars, URL-safe)."""
    return secrets.token_urlsafe(6)[:8]


def _generate_short_id_for_user(model_class):
    import random
    for _ in range(100):
        n = random.randint(1_000_000_000, 9_999_999_999)
        if not model_class.objects.filter(short_id=n).exists():
            return n
    raise ValueError("Could not generate unique short_id")


class UserManager(BaseUserManager):
    def create_user(self, phone=None, password=None, **extra_fields):
        if not phone or not str(phone).strip():
            raise ValueError("Номер телефона обязателен.")
        phone = str(phone).strip()
        user = self.model(phone=phone, **extra_fields)
        if not user.referral_code:
            user.referral_code = _generate_referral_code()
        if user.short_id is None:
            user.short_id = _generate_short_id_for_user(self.model)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, phone, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        return self.create_user(phone=phone, password=password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    short_id = models.PositiveBigIntegerField(
        unique=True, null=True, blank=True, db_index=True,
        help_text="Уникальный 10-значный числовой ID (не меняется)",
    )
    phone = models.CharField(max_length=20, unique=True)
    username = models.CharField(max_length=30, null=True, blank=True, db_index=True)
    telegram_id = models.BigIntegerField(unique=True, null=True, blank=True, db_index=True)
    telegram_username = models.CharField(max_length=255, blank=True)
    display_name = models.CharField(max_length=255, blank=True)
    bio = models.CharField(
        max_length=512, blank=True, default="",
        help_text="Краткое описание — видят все, кто зайдёт в профиль",
    )
    status_emoji = models.CharField(
        max_length=16, blank=True, default="",
        help_text="Эмодзи-статус в профиле (один смайл)",
    )
    birthday = models.DateField(
        null=True, blank=True,
        help_text="День рождения — показывается в профиле",
    )
    birthday_hide_year = models.BooleanField(
        default=False,
        help_text="Не показывать год (только день и месяц)",
    )
    avatar = models.ImageField(upload_to="avatars/", blank=True, null=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(auto_now_add=True)

    # --- Stars (virtual currency) ---
    stars = models.PositiveIntegerField(
        default=0,
        help_text="Баланс звёзд пользователя",
    )

    # --- Online status ---
    last_seen = models.DateTimeField(
        null=True, blank=True,
        help_text="Последний раз в сети",
    )
    PRIVACY_EVERYONE = "everyone"
    PRIVACY_NOBODY = "nobody"
    PRIVACY_CONTACTS = "contacts"
    PRIVACY_CHOICES = [
        (PRIVACY_EVERYONE, "Все"),
        (PRIVACY_NOBODY, "Никто"),
        (PRIVACY_CONTACTS, "Контакты"),
    ]
    show_last_seen = models.CharField(
        max_length=10,
        choices=PRIVACY_CHOICES,
        default=PRIVACY_EVERYONE,
        help_text="Кому показывать время последнего захода",
    )
    show_phone = models.CharField(
        max_length=10,
        choices=PRIVACY_CHOICES,
        default=PRIVACY_EVERYONE,
        help_text="Кому показывать номер телефона",
    )

    # --- Privacy: who can write DMs ---
    DM_PRIVACY_EVERYONE = "everyone"
    DM_PRIVACY_NOBODY = "nobody"
    DM_PRIVACY_CONTACTS = "contacts"
    DM_PRIVACY_CHOICES = [
        (DM_PRIVACY_EVERYONE, "Все"),
        (DM_PRIVACY_NOBODY, "Никто"),
        (DM_PRIVACY_CONTACTS, "Контакты"),
    ]
    dm_privacy = models.CharField(
        max_length=10,
        choices=DM_PRIVACY_CHOICES,
        default=DM_PRIVACY_EVERYONE,
        help_text="Кто может писать в личные сообщения",
    )

    # --- Privacy: who can add to groups ---
    ADD_TO_GROUP_EVERYONE = "everyone"
    ADD_TO_GROUP_NOBODY = "nobody"
    ADD_TO_GROUP_CONTACTS = "contacts"
    ADD_TO_GROUP_CHOICES = [
        (ADD_TO_GROUP_EVERYONE, "Все"),
        (ADD_TO_GROUP_NOBODY, "Никто"),
        (ADD_TO_GROUP_CONTACTS, "Контакты"),
    ]
    add_to_group_privacy = models.CharField(
        max_length=10,
        choices=ADD_TO_GROUP_CHOICES,
        default=ADD_TO_GROUP_EVERYONE,
        help_text="Кто может добавлять в группы",
    )

    # --- Profile: optional channel shown in profile (user adds it manually) ---
    personal_channel = models.ForeignKey(
        "chats.Channel",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="profile_users",
        help_text="Канал, который пользователь вручную добавил в профиль. Только владелец канала может указать его.",
    )

    # --- Referral system ---
    referral_code = models.CharField(
        max_length=10, unique=True, blank=True, db_index=True,
        help_text="Уникальный реферальный код пользователя",
    )
    referred_by = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="referrals",
        help_text="Кто привёл этого пользователя",
    )

    # --- Registration / acquisition (for analytics) ---
    registration_source = models.CharField(
        max_length=32,
        blank=True,
        default="",
        db_index=True,
        help_text="Источник регистрации: organic, referral, utm",
    )
    utm_source = models.CharField(max_length=255, blank=True, default="")
    utm_medium = models.CharField(max_length=255, blank=True, default="")
    utm_campaign = models.CharField(max_length=255, blank=True, default="")

    USERNAME_FIELD = "phone"
    REQUIRED_FIELDS = []

    objects = UserManager()

    def _get_avatar_path(self) -> str | None:
        """Path to first avatar (gallery or legacy)."""
        try:
            first = self.avatars.order_by("order").first()
            if first and first.image:
                return first.image.name
            if self.avatar:
                return self.avatar.name
        except (ValueError, OSError):
            pass
        return None

    def get_avatar_url(self, request=None, base_url: str | None = None, *, size: str = "original"):
        """Первая аватарка из галереи или legacy User.avatar. size: original|small|medium."""
        path = self._get_avatar_path()
        if path:
            from apps.files.access_handles import make_user_avatar_handle

            return make_user_avatar_handle(self.id, size=size)
        return None

    def save(self, *args, **kwargs):
        if not self.referral_code:
            self.referral_code = _generate_referral_code()
        if self.username is not None:
            self.username = (self.username.strip() or None)
            if self.username:
                self.username = self.username.lower()
        super().save(*args, **kwargs)

    class Meta:
        verbose_name = "User"
        verbose_name_plural = "Users"
        constraints = [
            models.UniqueConstraint(
                Lower("username"),
                condition=Q(username__isnull=False),
                name="users_username_unique_ci",
            )
        ]



class UserSession(models.Model):
    """Tracks an authenticated session (one per login). Used for session listing,
    revocation (logout), and new-login notifications."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="sessions")
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default="")
    device_label = models.CharField(max_length=200, blank=True, default="")
    client_type = models.CharField(
        max_length=20,
        default="web",
        db_index=True,
        help_text="Platform: web | android | desktop",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    last_active = models.DateTimeField(auto_now=True)
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        ordering = ["-last_active"]

    def __str__(self):
        return f"Session {self.id} ({self.device_label or 'unknown'}) for {self.user_id}"


class UserAvatar(models.Model):
    """Галерея аватарок пользователя (до 30 шт.)."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="avatars")
    image = models.ImageField(upload_to="user_avatars/")
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]


class UserFeedback(models.Model):
    """User feedback and technical support requests."""
    class Type(models.TextChoices):
        FEEDBACK = "feedback", "Обратная связь"
        SUPPORT = "support", "Техподдержка"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="feedback_submissions")
    type = models.CharField(max_length=20, choices=Type.choices, db_index=True)
    message = models.TextField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Обращение пользователя"
        verbose_name_plural = "Обращения пользователей"


class UserFeedbackAttachment(models.Model):
    """Photo/screenshot attached to feedback or support request."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    feedback = models.ForeignKey(
        UserFeedback, on_delete=models.CASCADE, related_name="attachments"
    )
    image = models.ImageField(upload_to="feedback_attachments/%Y/%m/")

    class Meta:
        ordering = ["id"]


class AnalyticsEvent(models.Model):
    """События для аналитики: регистрация, первое сообщение и т.д."""
    id = models.BigAutoField(primary_key=True)
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="analytics_events", null=True, blank=True
    )
    event_type = models.CharField(max_length=64, db_index=True)
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["event_type", "created_at"], name="users_ev_type_created"),
        ]
        verbose_name = "Событие аналитики"
        verbose_name_plural = "События аналитики"


def record_analytics_event(user, event_type: str, payload: dict | None = None):
    """Записать событие аналитики (без блокировки основного потока)."""
    try:
        AnalyticsEvent.objects.create(
            user_id=user.pk if user else None,
            event_type=event_type,
            payload=payload or {},
        )
    except Exception:
        pass


class Contact(models.Model):
    """Локальное имя контакта (как в Telegram). Имя видно только владельцу."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="contacts",
        help_text="Пользователь, который занёс контакт",
    )
    contact_user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="contacted_by",
        help_text="Пользователь, занесённый в контакты",
    )
    local_name = models.CharField(
        max_length=255,
        help_text="Имя, отображаемое только у владельца контакта",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("owner", "contact_user")
        verbose_name = "Контакт"
        verbose_name_plural = "Контакты"
