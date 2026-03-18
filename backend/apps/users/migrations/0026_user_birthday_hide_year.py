# Generated manually: birthday can be shown without year

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0025_add_registration_analytics"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="birthday_hide_year",
            field=models.BooleanField(default=False, help_text="Не показывать год (только день и месяц)"),
        ),
    ]
