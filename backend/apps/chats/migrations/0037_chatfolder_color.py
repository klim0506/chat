# Generated manually for folder color

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chats", "0036_message_delete_after_read"),
    ]

    operations = [
        migrations.AddField(
            model_name="chatfolder",
            name="color",
            field=models.CharField(blank=True, default="", max_length=20),
        ),
    ]
