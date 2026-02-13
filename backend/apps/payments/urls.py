from django.urls import path
from .views import (
    SubscriptionStatusView,
    CreateSubscriptionPaymentView,
    YooKassaWebhookView,
    StarsBalanceView,
    ExpandChatView,
)

urlpatterns = [
    path("subscription/", SubscriptionStatusView.as_view(), name="subscription-status"),
    path("subscribe/", CreateSubscriptionPaymentView.as_view(), name="subscribe"),
    path("webhook/", YooKassaWebhookView.as_view(), name="webhook"),
    path("stars/", StarsBalanceView.as_view(), name="stars-balance"),
    path("expand-chat/", ExpandChatView.as_view(), name="expand-chat"),
]
