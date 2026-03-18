# Generated migration for link_preview

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chats", "0031_add_chat_folders"),
    ]

    operations = [
        migrations.AddField(
            model_name="message",
            name="link_preview",
            field=models.JSONField(blank=True, null=True),
        ),
    ]
