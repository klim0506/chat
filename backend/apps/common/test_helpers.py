"""
Shared test helpers for the backend test suite.
Re-usable factory functions so that every test module doesn't duplicate setup logic.
"""
import uuid

from rest_framework.test import APIClient

from apps.users.models import User
from apps.users.jwt_utils import make_access_token
from apps.files.models import FileAttachment
from apps.chats.models import Chat, ChatMember, Message, DEFAULT_MAX_MEMBERS


# ── User ──────────────────────────────────────────────────────

def create_user(phone="+79990001122", display_name="Test", **kwargs):
    """Create and return a User instance."""
    return User.objects.create_user(phone=phone, display_name=display_name, **kwargs)


# ── Auth ──────────────────────────────────────────────────────

def make_auth_header(user):
    """Return dict suitable for ``client.credentials(**header)``."""
    token = make_access_token(user.pk)
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def auth_client(user):
    """Return an APIClient already authenticated as *user*."""
    client = APIClient()
    client.credentials(**make_auth_header(user))
    return client


# ── Chat ──────────────────────────────────────────────────────

def create_chat(owner, title="Test Chat", is_personal=False):
    """Create a Chat with *owner* as ADMIN member."""
    from apps.chats.utils import generate_slug, make_verification_code

    slug = generate_slug()
    code = make_verification_code(slug)
    chat = Chat.objects.create(
        title=title,
        slug=slug,
        verification_code=code,
        chat_type=None if is_personal else Chat.ChatType.OPEN,
        is_personal=is_personal,
        max_members=DEFAULT_MAX_MEMBERS,
        owner=owner,
    )
    ChatMember.objects.create(
        chat=chat,
        user=owner,
        role=ChatMember.Role.ADMIN,
        status=ChatMember.Status.ACTIVE,
    )
    return chat


def add_member(chat, user, role=ChatMember.Role.MEMBER):
    """Add *user* to *chat* as an active member."""
    return ChatMember.objects.create(
        chat=chat,
        user=user,
        role=role,
        status=ChatMember.Status.ACTIVE,
    )


# ── Message ───────────────────────────────────────────────────

def send_message(client, chat, text="hello", **extra):
    """POST a text message via the API and return the response."""
    payload = {"msg_type": "text", "content": text, **extra}
    return client.post(f"/api/chats/{chat.id}/messages/", payload, format="json")


def create_message(chat, sender, text="hello", **kwargs):
    """Create a Message object directly in the DB."""
    return Message.objects.create(
        chat=chat,
        sender=sender,
        msg_type=kwargs.pop("msg_type", Message.MsgType.TEXT),
        content=text,
        **kwargs,
    )


# ── File ──────────────────────────────────────────────────────

def create_file(user, name="photo.jpg", mime="image/jpeg",
                scan_status=FileAttachment.ScanStatus.CLEAN):
    """Create a FileAttachment record (no real file on disk)."""
    return FileAttachment.objects.create(
        uploader=user,
        original_name=name,
        file_path=f"chat_uploads/test/{uuid.uuid4().hex}.jpg",
        mime_type=mime,
        size_bytes=1024,
        storage_type=FileAttachment.StorageType.LOCAL,
        scan_status=scan_status,
    )
