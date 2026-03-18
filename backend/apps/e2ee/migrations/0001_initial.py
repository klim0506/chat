# Generated manually for E2EE app

import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Device",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("device_id", models.PositiveIntegerField(help_text="Sequential device number for user")),
                ("name", models.CharField(default="", max_length=128)),
                ("identity_key", models.TextField()),
                ("signed_prekey", models.TextField()),
                ("signed_prekey_id", models.PositiveIntegerField()),
                ("signed_prekey_sig", models.TextField()),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("last_active_at", models.DateTimeField(auto_now=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="e2ee_devices", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "verbose_name": "E2EE Device",
                "verbose_name_plural": "E2EE Devices",
                "unique_together": {("user", "device_id")},
            },
        ),
        migrations.CreateModel(
            name="OneTimePreKey",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("key_id", models.PositiveIntegerField()),
                ("public_key", models.TextField()),
                ("is_used", models.BooleanField(default=False)),
                ("device", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="prekeys", to="e2ee.device")),
            ],
            options={
                "verbose_name": "One-Time PreKey",
                "verbose_name_plural": "One-Time PreKeys",
                "unique_together": {("device", "key_id")},
            },
        ),
    ]
