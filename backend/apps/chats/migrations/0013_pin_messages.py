# Message pinning: for all (Chat.pinned_message) and for self (UserPinnedMessage)

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("chats", "0012_message_waveform"),
    ]

    operations = [
        migrations.AddField(
            model_name="chat",
            name="pinned_message",
            field=models.ForeignKey(
                blank=True,
                help_text="Сообщение, закреплённое для всех в чате",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="pinned_in_chats",
                to="chats.message",
            ),
        ),
        migrations.CreateModel(
            name="UserPinnedMessage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("chat", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="user_pins", to="chats.chat")),
                ("message", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="pinned_by_users", to="chats.message")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="pinned_messages", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "ordering": ["-created_at"],
                "unique_together": {("user", "chat", "message")},
                "verbose_name": "Закреплённое сообщение (для себя)",
                "verbose_name_plural": "Закреплённые сообщения (для себя)",
            },
        ),
    ]
