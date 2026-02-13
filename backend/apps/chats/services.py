"""Сервисы для чатов."""
from django.db import transaction

from .models import Chat, ChatMember
from .utils import generate_slug, make_verification_code

FAVORITES_TITLE = "Избранное"


def create_favorites_chat(user):
    """
    Создать чат «Избранное» для пользователя: только он в чате, никого нельзя добавить.
    Идемпотентно: если у пользователя уже есть такой чат, ничего не делаем.
    """
    if Chat.objects.filter(owner=user, is_favorites=True).exists():
        return Chat.objects.get(owner=user, is_favorites=True)
    slug = generate_slug()
    while Chat.objects.filter(slug=slug).exists():
        slug = generate_slug()
    with transaction.atomic():
        chat = Chat.objects.create(
            title=FAVORITES_TITLE,
            slug=slug,
            verification_code=make_verification_code(slug),
            owner=user,
            is_personal=False,
            is_favorites=True,
            max_members=1,
        )
        ChatMember.objects.create(
            chat=chat,
            user=user,
            role=ChatMember.Role.ADMIN,
            status=ChatMember.Status.ACTIVE,
        )
    return chat
