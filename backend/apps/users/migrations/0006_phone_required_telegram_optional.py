# Generated manually: phone is required; telegram is optional link.

from django.db import migrations, models


def remove_users_without_phone(apps, schema_editor):
    """Удалить пользователей без номера телефона перед введением ограничения."""
    User = apps.get_model("users", "User")
    User.objects.filter(phone="").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0005_user_stars"),
    ]

    operations = [
        migrations.RunPython(remove_users_without_phone, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="user",
            name="phone",
            field=models.CharField(max_length=20, unique=True),
        ),
    ]
