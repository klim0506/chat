# Reactions: up to 3 per user per message (unique on message, user, emoji)

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("chats", "0010_chat_expansion_tier_base_10"),
    ]

    operations = [
        migrations.AlterUniqueTogether(
            name="messagereaction",
            unique_together={("message", "user", "emoji")},
        ),
    ]
