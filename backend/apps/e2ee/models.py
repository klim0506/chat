import uuid
from django.conf import settings
from django.db import models


class Device(models.Model):
    """E2EE device: stores public keys only. Private keys stay on client."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="e2ee_devices")
    device_id = models.PositiveIntegerField(help_text="Sequential device number for user")
    name = models.CharField(max_length=128, default="")
    # Ed25519 public key (base64) — used to verify signed prekey
    identity_key = models.TextField()
    # X25519 public key (base64)
    signed_prekey = models.TextField()
    signed_prekey_id = models.PositiveIntegerField()
    signed_prekey_sig = models.TextField()  # Ed25519 signature of signed_prekey
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_active_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("user", "device_id")
        verbose_name = "E2EE Device"
        verbose_name_plural = "E2EE Devices"


class OneTimePreKey(models.Model):
    """One-time prekey for X3DH. Used once, then marked is_used."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name="prekeys")
    key_id = models.PositiveIntegerField()
    public_key = models.TextField()  # X25519 public key (base64)
    is_used = models.BooleanField(default=False)

    class Meta:
        unique_together = ("device", "key_id")
        verbose_name = "One-Time PreKey"
        verbose_name_plural = "One-Time PreKeys"
