# Generated migration: звёзды — прокачка 10→100 (50 звёзд), 100→1000 (100 звёзд)

from django.db import migrations, models


def backfill_expansion_tier(apps, schema_editor):
    Chat = apps.get_model("chats", "Chat")
    # Уже расширенные чаты (expanded_until задан) — уровень 1000
    Chat.objects.filter(expanded_until__isnull=False).update(expansion_tier=1000)
    # Базовые чаты с лимитом 100 → 10
    Chat.objects.filter(expanded_until__isnull=True, max_members=100).update(max_members=10)


def reverse_backfill(apps, schema_editor):
    Chat = apps.get_model("chats", "Chat")
    Chat.objects.filter(expanded_until__isnull=True, max_members=10).update(max_members=100)
    Chat.objects.filter(expansion_tier=1000).update(expansion_tier=None)


class Migration(migrations.Migration):

    dependencies = [
        ("chats", "0009_add_chat_description_avatar"),
    ]

    operations = [
        migrations.AddField(
            model_name="chat",
            name="expansion_tier",
            field=models.PositiveIntegerField(
                blank=True,
                help_text="Уровень прокачки: 100 или 1000 участников",
                null=True,
            ),
        ),
        migrations.AlterField(
            model_name="chat",
            name="max_members",
            field=models.PositiveIntegerField(default=10),
        ),
        migrations.RunPython(backfill_expansion_tier, reverse_backfill),
    ]
