# Generated for username: unique, nullable for existing users.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0006_phone_required_telegram_optional"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="username",
            field=models.CharField(blank=True, db_index=True, max_length=30, null=True, unique=True),
        ),
    ]
