# Generated migration for Message.waveform

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chats", "0011_reactions_3_per_user"),
    ]

    operations = [
        migrations.AddField(
            model_name="message",
            name="waveform",
            field=models.JSONField(blank=True, null=True),
        ),
    ]
