# Generated manually for scheduled/recurring messages

import uuid
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chats", "0004_chatmember_is_muted_chatmember_last_read_at"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ScheduledMessage",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("content", models.TextField()),
                ("scheduled_at", models.DateTimeField(help_text="Когда отправить (или следующий запуск для рекуррентных)")),
                ("recurrence", models.CharField(choices=[("none", "Один раз"), ("daily", "Каждый день"), ("weekly", "Раз в неделю")], default="none", max_length=10)),
                ("recurrence_time", models.TimeField(blank=True, help_text="Время суток для daily/weekly", null=True)),
                ("recurrence_weekday", models.SmallIntegerField(blank=True, help_text="0=пн, 6=вс для weekly", null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("chat", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="scheduled_messages", to="chats.chat")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="scheduled_messages", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "verbose_name": "Отложенное сообщение",
                "verbose_name_plural": "Отложенные сообщения",
                "ordering": ["scheduled_at"],
            },
        ),
    ]
