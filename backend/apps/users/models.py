from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone
import secrets
import uuid


def _generate_referral_code() -> str:
    """Generate a short unique referral code (8 chars, URL-safe)."""
    return secrets.token_urlsafe(6)[:8]


class UserManager(BaseUserManager):
    def create_user(self, phone=None, password=None, **extra_fields):
        if not phone or not str(phone).strip():
            raise ValueError("Номер телефона обязателен.")
        phone = str(phone).strip()
        user = self.model(phone=phone, **extra_fields)
        if not user.referral_code:
            user.referral_code = _generate_referral_code()
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, phone, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        return self.create_user(phone=phone, password=password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone = models.CharField(max_length=20, unique=True)
    username = models.CharField(max_length=30, unique=True, null=True, blank=True, db_index=True)
    telegram_id = models.BigIntegerField(unique=True, null=True, blank=True, db_index=True)
    telegram_username = models.CharField(max_length=255, blank=True)
    display_name = models.CharField(max_length=255, blank=True)
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
    show_last_seen = models.BooleanField(
        default=True,
        help_text="Показывать другим время последнего захода",
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

    USERNAME_FIELD = "phone"
    REQUIRED_FIELDS = []

    objects = UserManager()

    def get_avatar_url(self, request=None):
        """Первая аватарка из галереи или legacy User.avatar."""
        first = self.avatars.order_by("order").first()
        if first and first.image:
            url = first.image.url
            return request.build_absolute_uri(url) if request else url
        if self.avatar:
            url = self.avatar.url
            return request.build_absolute_uri(url) if request else url
        return None

    def save(self, *args, **kwargs):
        if not self.referral_code:
            self.referral_code = _generate_referral_code()
        if self.username is not None and self.username != "":
            self.username = self.username.lower().strip()
        super().save(*args, **kwargs)

    class Meta:
        verbose_name = "Пользователь"
        verbose_name_plural = "Пользователи"


class UserAvatar(models.Model):
    """Галерея аватарок пользователя (до 30 шт.)."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="avatars")
    image = models.ImageField(upload_to="user_avatars/")
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]
