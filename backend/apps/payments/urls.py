from django.urls import path
from .views import (
    SubscriptionStatusView,
    VideoCircleQuotaView,
    PaymentMethodsListView,
    PaymentMethodDetailView,
    PaymentMethodUnlinkView,
    CreateSubscriptionPaymentView,
    YooKassaWebhookView,
)

urlpatterns = [
    path("subscription/", SubscriptionStatusView.as_view(), name="subscription-status"),
    path("video_circle_quota/", VideoCircleQuotaView.as_view(), name="video-circle-quota"),
    path("payment-methods/", PaymentMethodsListView.as_view(), name="payment-methods-list"),
    path("payment-methods/<str:payment_method_id>/", PaymentMethodDetailView.as_view(), name="payment-method-detail"),
    path("payment-methods/<str:payment_method_id>/unlink/", PaymentMethodUnlinkView.as_view(), name="payment-method-unlink"),
    path("subscribe/", CreateSubscriptionPaymentView.as_view(), name="subscribe"),
    path("webhook/", YooKassaWebhookView.as_view(), name="webhook"),
]
