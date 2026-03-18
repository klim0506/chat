from django.contrib import admin
from .models import (
    Chat, ChatMember, Message, MessageReaction, ScheduledMessage, UserPinnedMessage,
    Channel, ChannelMember, ChannelPost, ChannelPostComment, ChannelPostReaction,
    StickerSet, Sticker, UserStickerSet, RecentSticker,
)


@admin.register(Chat)
class ChatAdmin(admin.ModelAdmin):
    list_display = ("title", "slug", "is_personal", "chat_type", "max_members", "owner", "created_at")


@admin.register(ChatMember)
class ChatMemberAdmin(admin.ModelAdmin):
    list_display = ("chat", "user", "role", "status", "joined_at")


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ("chat", "sender", "msg_type", "created_at", "edited_at")


@admin.register(MessageReaction)
class MessageReactionAdmin(admin.ModelAdmin):
    list_display = ("message", "user", "emoji")


@admin.register(ScheduledMessage)
class ScheduledMessageAdmin(admin.ModelAdmin):
    list_display = ("chat", "user", "scheduled_at", "recurrence", "created_at")


@admin.register(UserPinnedMessage)
class UserPinnedMessageAdmin(admin.ModelAdmin):
    list_display = ("user", "chat", "message", "created_at")


@admin.register(Channel)
class ChannelAdmin(admin.ModelAdmin):
    list_display = ("title", "username", "slug", "is_public", "owner", "is_active", "created_at")
    list_editable = ("username",)
    list_filter = ("is_public", "is_active")
    search_fields = ("title", "username", "slug")
    readonly_fields = ("slug", "verification_code")


@admin.register(ChannelMember)
class ChannelMemberAdmin(admin.ModelAdmin):
    list_display = ("channel", "user", "role", "status", "joined_at")


@admin.register(ChannelPost)
class ChannelPostAdmin(admin.ModelAdmin):
    list_display = ("channel", "author", "msg_type", "created_at", "is_deleted")


@admin.register(ChannelPostComment)
class ChannelPostCommentAdmin(admin.ModelAdmin):
    list_display = ("post", "author", "msg_type", "created_at", "is_deleted")


@admin.register(ChannelPostReaction)
class ChannelPostReactionAdmin(admin.ModelAdmin):
    list_display = ("post", "user", "emoji")


@admin.register(StickerSet)
class StickerSetAdmin(admin.ModelAdmin):
    list_display = ("title", "short_name", "owner", "created_at")


@admin.register(Sticker)
class StickerAdmin(admin.ModelAdmin):
    list_display = ("pack", "label", "emoji", "position", "created_at")


@admin.register(UserStickerSet)
class UserStickerSetAdmin(admin.ModelAdmin):
    list_display = ("user", "stickerset", "order", "installed_at")


@admin.register(RecentSticker)
class RecentStickerAdmin(admin.ModelAdmin):
    list_display = ("user", "sticker", "used_at")
