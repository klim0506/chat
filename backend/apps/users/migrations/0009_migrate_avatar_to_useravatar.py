# Migrate existing User.avatar to UserAvatar

from django.db import migrations


def migrate_avatars(apps, schema_editor):
    User = apps.get_model("users", "User")
    UserAvatar = apps.get_model("users", "UserAvatar")
    for user in User.objects.filter(avatar__isnull=False).exclude(avatar=""):
        if not UserAvatar.objects.filter(user=user).exists():
            UserAvatar.objects.create(user=user, image=user.avatar, order=0)


def reverse_migrate(apps, schema_editor):
    pass  # no reverse


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0008_useravatar"),
    ]

    operations = [
        migrations.RunPython(migrate_avatars, reverse_migrate),
    ]
