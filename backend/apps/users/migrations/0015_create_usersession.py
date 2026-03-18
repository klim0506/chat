import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0014_add_add_to_group_privacy"),
    ]

    operations = [
        migrations.CreateModel(
            name="UserSession",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "ip_address",
                    models.GenericIPAddressField(blank=True, null=True),
                ),
                (
                    "user_agent",
                    models.TextField(blank=True, default=""),
                ),
                (
                    "device_label",
                    models.CharField(blank=True, default="", max_length=200),
                ),
                (
                    "created_at",
                    models.DateTimeField(auto_now_add=True),
                ),
                (
                    "last_active",
                    models.DateTimeField(auto_now=True),
                ),
                (
                    "is_active",
                    models.BooleanField(db_index=True, default=True),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="sessions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-last_active"],
            },
        ),
    ]
