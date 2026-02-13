# Data migration: создать чат «Избранное» для всех пользователей, у которых его ещё нет

from django.db import migrations


def create_favorites_for_users(apps, schema_editor):
    Chat = apps.get_model("chats", "Chat")
    User = apps.get_model("users", "User")
    ChatMember = apps.get_model("chats", "ChatMember")
    # Логика из services.create_favorites_chat, но через historical models
    from apps.chats.utils import generate_slug, make_verification_code
    for user in User.objects.filter(is_active=True):
        if Chat.objects.filter(owner_id=user.id, is_favorites=True).exists():
            continue
        slug = generate_slug()
        while Chat.objects.filter(slug=slug).exists():
            slug = generate_slug()
        chat = Chat.objects.create(
            title="Избранное",
            slug=slug,
            verification_code=make_verification_code(slug),
            owner_id=user.id,
            is_personal=False,
            is_favorites=True,
            max_members=1,
        )
        ChatMember.objects.create(
            chat=chat,
            user_id=user.id,
            role="admin",
            status="active",
        )


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("chats", "0017_chat_is_favorites"),
        ("users", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(create_favorites_for_users, noop),
    ]
