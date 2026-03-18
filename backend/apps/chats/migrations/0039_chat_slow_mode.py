# Generated migration for slow_mode

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chats", "0038_chat_max_members_10k"),
    ]

    operations = [
        migrations.AddField(
            model_name="chat",
            name="slow_mode_seconds",
            field=models.PositiveIntegerField(
                default=0,
                help_text="0 = disabled; min seconds between messages per user (owners/admins exempt)",
            ),
        ),
    ]
