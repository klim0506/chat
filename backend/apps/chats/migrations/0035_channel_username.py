# Generated manually for channel username (Telegram-style @channelname)

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chats", "0034_poll_message_pollvote"),
    ]

    operations = [
        migrations.AddField(
            model_name="channel",
            name="username",
            field=models.CharField(blank=True, db_index=True, max_length=30, null=True),
        ),
    ]
