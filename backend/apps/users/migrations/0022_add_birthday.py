# Generated migration

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0021_add_feedback_attachments"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="birthday",
            field=models.DateField(blank=True, help_text="День рождения — показывается в профиле", null=True),
        ),
    ]
