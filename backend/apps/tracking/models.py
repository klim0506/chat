import secrets
import uuid
from django.conf import settings
from django.db import models


def _generate_slug() -> str:
    """Generate a short unique slug for tracking URLs (10 chars, URL-safe)."""
    return secrets.token_urlsafe(8)[:10]


class TrackingLink(models.Model):
    """Меченая ссылка для отслеживания переходов."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tag = models.CharField(max_length=100, help_text="Название/метка для идентификации")
    slug = models.SlugField(max_length=20, unique=True, db_index=True, blank=True)
    target_url = models.URLField(max_length=2048)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_tracking_links",
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Меченая ссылка"
        verbose_name_plural = "Меченые ссылки"

    def __str__(self):
        return f"{self.tag} → {self.target_url[:50]}"

    def save(self, *args, **kwargs):
        if not self.slug:
            for _ in range(10):
                slug = _generate_slug()
                if not TrackingLink.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                    self.slug = slug
                    break
            else:
                self.slug = _generate_slug()  # fallback
        super().save(*args, **kwargs)


class TrackingLinkClick(models.Model):
    """Запись о переходе по меченой ссылке."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    link = models.ForeignKey(
        TrackingLink,
        on_delete=models.CASCADE,
        related_name="clicks",
    )
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default="")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tracking_clicks",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Переход по ссылке"
        verbose_name_plural = "Переходы по ссылкам"
