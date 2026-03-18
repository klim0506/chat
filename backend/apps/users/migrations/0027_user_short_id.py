# Unique 10-digit numeric ID per user

import random
from django.db import migrations, models


def fill_short_ids(apps, schema_editor):
    User = apps.get_model("users", "User")
    used = set(User.objects.exclude(short_id__isnull=False).values_list("short_id", flat=True))
    used = {x for x in used if x is not None}
    for user in User.objects.filter(short_id__isnull=True):
        for _ in range(100):
            n = random.randint(1_000_000_000, 9_999_999_999)
            if n not in used:
                user.short_id = n
                used.add(n)
                user.save(update_fields=["short_id"])
                break
        else:
            raise ValueError(f"Could not generate short_id for user {user.pk}")


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0026_user_birthday_hide_year"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="short_id",
            field=models.PositiveBigIntegerField(blank=True, db_index=True, help_text="Уникальный 10-значный числовой ID (не меняется)", null=True, unique=True),
        ),
        migrations.RunPython(fill_short_ids, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="user",
            name="short_id",
            field=models.PositiveBigIntegerField(blank=False, db_index=True, help_text="Уникальный 10-значный числовой ID (не меняется)", null=False, unique=True),
        ),
    ]
