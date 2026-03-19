from __future__ import annotations

from django.core import signing

MEDIA_HANDLE_SALT = "media-access-handle-v1"

KIND_FILE = "file"
KIND_USER_AVATAR = "user-avatar"
KIND_USER_GALLERY_AVATAR = "user-gallery-avatar"
KIND_CHAT_AVATAR = "chat-avatar"
KIND_CHAT_BACKGROUND = "chat-background"
KIND_CHANNEL_AVATAR = "channel-avatar"


def make_media_handle(kind: str, object_id, *, variant: str | None = None) -> str:
    payload: dict[str, str] = {"k": kind, "i": str(object_id)}
    if variant:
        payload["v"] = variant
    return signing.dumps(payload, salt=MEDIA_HANDLE_SALT, compress=True)


def parse_media_handle(handle: str) -> dict[str, str]:
    data = signing.loads(handle, salt=MEDIA_HANDLE_SALT)
    if not isinstance(data, dict):
        raise signing.BadSignature("Invalid media handle payload.")
    kind = str(data.get("k") or "").strip()
    object_id = str(data.get("i") or "").strip()
    variant = str(data.get("v") or "").strip()
    if not kind or not object_id:
        raise signing.BadSignature("Incomplete media handle payload.")
    return {"kind": kind, "object_id": object_id, "variant": variant or "original"}


def make_file_handle(file_id) -> str:
    return make_media_handle(KIND_FILE, file_id)


def make_user_avatar_handle(user_id, *, size: str = "original") -> str:
    return make_media_handle(KIND_USER_AVATAR, user_id, variant=size)


def make_user_gallery_avatar_handle(avatar_id, *, size: str = "original") -> str:
    return make_media_handle(KIND_USER_GALLERY_AVATAR, avatar_id, variant=size)


def make_chat_avatar_handle(chat_id, *, size: str = "original") -> str:
    return make_media_handle(KIND_CHAT_AVATAR, chat_id, variant=size)


def make_chat_background_handle(chat_id) -> str:
    return make_media_handle(KIND_CHAT_BACKGROUND, chat_id, variant="original")


def make_channel_avatar_handle(channel_id, *, size: str = "original") -> str:
    return make_media_handle(KIND_CHANNEL_AVATAR, channel_id, variant=size)
