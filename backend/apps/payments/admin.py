from django.contrib import admin
from .models import UserSubscription, PaymentLog, StarTransaction


@admin.register(UserSubscription)
class UserSubscriptionAdmin(admin.ModelAdmin):
    list_display = ("user", "status", "price_kopecks", "is_referral_trial", "current_period_end", "created_at")
    list_filter = ("status", "is_referral_trial")
    search_fields = ("user__phone",)


@admin.register(PaymentLog)
class PaymentLogAdmin(admin.ModelAdmin):
    list_display = ("subscription", "yookassa_payment_id", "amount_kopecks", "status", "created_at")


@admin.register(StarTransaction)
class StarTransactionAdmin(admin.ModelAdmin):
    list_display = ("user", "amount", "reason", "description", "created_at")
    list_filter = ("reason",)
    search_fields = ("user__phone", "description")
