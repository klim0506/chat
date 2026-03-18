# Generated migration

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0023_privacy_contacts"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="status_emoji",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Эмодзи-статус в профиле (один смайл)",
                max_length=16,
            ),
        ),
    ]
