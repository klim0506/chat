# Generated migration for privacy "contacts" option

from django.db import migrations, models


def migrate_show_last_seen_forward(apps, schema_editor):
    User = apps.get_model("users", "User")
    for u in User.objects.only("show_last_seen_bool", "show_last_seen"):
        val = getattr(u, "show_last_seen_bool", True)
        u.show_last_seen = "everyone" if val else "nobody"
        u.save(update_fields=["show_last_seen"])


def migrate_show_last_seen_reverse(apps, schema_editor):
    User = apps.get_model("users", "User")
    for u in User.objects.only("show_last_seen"):
        u.show_last_seen_bool = (u.show_last_seen == "everyone")
        u.save(update_fields=["show_last_seen_bool"])


def migrate_show_phone_forward(apps, schema_editor):
    User = apps.get_model("users", "User")
    for u in User.objects.only("show_phone_bool", "show_phone"):
        val = getattr(u, "show_phone_bool", True)
        u.show_phone = "everyone" if val else "nobody"
        u.save(update_fields=["show_phone"])


def migrate_show_phone_reverse(apps, schema_editor):
    User = apps.get_model("users", "User")
    for u in User.objects.only("show_phone"):
        u.show_phone_bool = (u.show_phone == "everyone")
        u.save(update_fields=["show_phone_bool"])


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0022_add_birthday"),
    ]

    operations = [
        # Rename bool columns to _bool
        migrations.RenameField(
            model_name="user",
            old_name="show_last_seen",
            new_name="show_last_seen_bool",
        ),
        migrations.RenameField(
            model_name="user",
            old_name="show_phone",
            new_name="show_phone_bool",
        ),
        # Add new char columns
        migrations.AddField(
            model_name="user",
            name="show_last_seen",
            field=models.CharField(
                choices=[("everyone", "Все"), ("nobody", "Никто"), ("contacts", "Контакты")],
                default="everyone",
                help_text="Кому показывать время последнего захода",
                max_length=10,
            ),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="user",
            name="show_phone",
            field=models.CharField(
                choices=[("everyone", "Все"), ("nobody", "Никто"), ("contacts", "Контакты")],
                default="everyone",
                help_text="Кому показывать номер телефона",
                max_length=10,
            ),
            preserve_default=False,
        ),
        migrations.RunPython(migrate_show_last_seen_forward, migrate_show_last_seen_reverse),
        migrations.RunPython(migrate_show_phone_forward, migrate_show_phone_reverse),
        # Remove old bool columns
        migrations.RemoveField(
            model_name="user",
            name="show_last_seen_bool",
        ),
        migrations.RemoveField(
            model_name="user",
            name="show_phone_bool",
        ),
    ]
