from django.contrib import admin
from .models import Chat, ChatMember, Message, MessageReaction, ScheduledMessage, UserPinnedMessage


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
