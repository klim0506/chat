from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User, UserFeedback, UserFeedbackAttachment, AnalyticsEvent


class UserFeedbackAttachmentInline(admin.TabularInline):
    model = UserFeedbackAttachment
    extra = 0
    readonly_fields = ("image",)


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ("phone", "display_name", "telegram_username", "is_active", "date_joined")
    search_fields = ("phone", "display_name", "telegram_username")
    ordering = ("phone",)
    fieldsets = (
        (None, {"fields": ("phone", "password")}),
        ("Профиль", {"fields": ("display_name", "telegram_id", "telegram_username", "avatar")}),
        ("Права", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("phone", "password1", "password2")}),
    )


@admin.register(UserFeedback)
class UserFeedbackAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "type", "message_preview", "attachments_count", "created_at")
    list_filter = ("type",)
    search_fields = ("message", "user__phone", "user__display_name")
    readonly_fields = ("id", "user", "type", "message", "created_at")
    inlines = [UserFeedbackAttachmentInline]

    def message_preview(self, obj):
        return (obj.message[:80] + "…") if len(obj.message) > 80 else obj.message
    message_preview.short_description = "Сообщение"

    def attachments_count(self, obj):
        return obj.attachments.count()
    attachments_count.short_description = "Фото"


@admin.register(AnalyticsEvent)
class AnalyticsEventAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "event_type", "created_at")
    list_filter = ("event_type",)
    search_fields = ("event_type", "user__phone")
    readonly_fields = ("id", "user", "event_type", "payload", "created_at")
    ordering = ("-created_at",)
