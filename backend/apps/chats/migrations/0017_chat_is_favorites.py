# Generated manually for the Favorites chat

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chats", "0016_alter_chat_expanded_until"),
    ]

    operations = [
        migrations.AddField(
            model_name="chat",
            name="is_favorites",
            field=models.BooleanField(
                default=False,
                help_text="Чат «Избранное» — только владелец, никого нельзя добавить.",
            ),
        ),
    ]
