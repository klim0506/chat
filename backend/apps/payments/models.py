from django.db import models
from django.conf import settings
import uuid


class UserSubscription(models.Model):
    """Подписка пользователя на мессенджер (300 руб./мес.)."""

    class Status(models.TextChoices):
        TRIAL = "trial", "Пробный период"
        ACTIVE = "active", "Активна"
        PAST_DUE = "past_due", "Просрочена"
        CANCELLED = "cancelled", "Отменена"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="subscription",
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.TRIAL,
    )
    price_kopecks = models.PositiveIntegerField(
        default=30000,
        help_text="Цена подписки (30000 = 300 руб.)",
    )
    is_referral_trial = models.BooleanField(
        default=False,
        help_text="Пробный период получен по реферальной ссылке",
    )
    yookassa_payment_method_id = models.CharField(max_length=255, blank=True)
    current_period_start = models.DateTimeField(null=True, blank=True)
    current_period_end = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Подписка пользователя"
        verbose_name_plural = "Подписки пользователей"

    def __str__(self):
        return f"{self.user} — {self.get_status_display()}"

    @property
    def is_valid(self) -> bool:
        """Подписка действительна (trial или active, и период не истёк)."""
        from django.utils import timezone

        if self.status not in (self.Status.TRIAL, self.Status.ACTIVE):
            return False
        if self.current_period_end and self.current_period_end < timezone.now():
            return False
        return True


class StarTransaction(models.Model):
    """Лог операций со звёздами."""

    class Reason(models.TextChoices):
        REFERRAL_INVITER = "referral_inviter", "Пригласил пользователя"
        REFERRAL_INVITEE = "referral_invitee", "Зарегистрировался по ссылке"
        CHAT_EXPANSION = "chat_expansion", "Расширение чата"
        ADMIN_GRANT = "admin_grant", "Начислено администратором"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="star_transactions",
    )
    amount = models.IntegerField(
        help_text="Положительное = начисление, отрицательное = списание",
    )
    reason = models.CharField(max_length=30, choices=Reason.choices)
    description = models.CharField(max_length=255, blank=True)
    related_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
        help_text="Связанный пользователь (реферал)",
    )
    related_chat = models.ForeignKey(
        "chats.Chat",
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
        help_text="Связанный чат (расширение)",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Транзакция звёзд"
        verbose_name_plural = "Транзакции звёзд"


class PaymentLog(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "В обработке"
        SUCCEEDED = "succeeded", "Успешно"
        CANCELLED = "cancelled", "Отменён"
        REFUNDED = "refunded", "Возвращён"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subscription = models.ForeignKey(
        UserSubscription,
        on_delete=models.CASCADE,
        related_name="payment_logs",
    )
    yookassa_payment_id = models.CharField(max_length=255)
    amount_kopecks = models.PositiveIntegerField()
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
    )
    raw_response = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Платёж"
        verbose_name_plural = "Платежи"
