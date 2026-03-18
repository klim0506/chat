# Set max_members=10000 for all groups (remove tier limits)

from django.db import migrations


def set_max_members_10k(apps, schema_editor):
    Chat = apps.get_model("chats", "Chat")
    Chat.objects.filter(is_favorites=False).update(max_members=10000)


def reverse_noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("chats", "0037_chatfolder_color"),
    ]

    operations = [
        migrations.RunPython(set_max_members_10k, reverse_noop),
    ]
