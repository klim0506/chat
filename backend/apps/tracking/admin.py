from django.contrib import admin
from .models import TrackingLink, TrackingLinkClick


@admin.register(TrackingLink)
class TrackingLinkAdmin(admin.ModelAdmin):
    list_display = ("tag", "slug", "target_url", "created_at", "created_by")
    search_fields = ("tag", "slug", "target_url")
    readonly_fields = ("id", "created_at")


@admin.register(TrackingLinkClick)
class TrackingLinkClickAdmin(admin.ModelAdmin):
    list_display = ("link", "ip_address", "user", "created_at")
    list_filter = ("created_at",)
    readonly_fields = ("id", "created_at")
