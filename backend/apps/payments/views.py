from datetime import timedelta
from urllib.parse import urlparse
import json

from django.conf import settings
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from django.utils.decorators import method_decorator
from rest_framework import status
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.views import APIView
from rest_framework.response import Response

from .models import UserSubscription, PaymentLog, StarTransaction
from .constants import (
    SUBSCRIPTION_PRICE_KOPECKS, SUBSCRIPTION_PERIOD_DAYS,
    CHAT_EXPANSION_COST_STARS,
)
from .yookassa_client import create_payment, get_payment
from .services import expand_chat
from .throttles import WebhookThrottle


def _is_allowed_return_url(return_url: str) -> bool:
    try:
        parsed = urlparse(return_url)
    except Exception:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    frontend = urlparse(getattr(settings, "FRONTEND_URL", ""))
    if not frontend.netloc:
        return False
    return parsed.netloc == frontend.netloc


class SubscriptionStatusView(APIView):
    """GET — current subscription status + star balance."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        sub = UserSubscription.objects.filter(user=request.user).first()
        base = {
            "stars": request.user.stars,
            "price_rub": SUBSCRIPTION_PRICE_KOPECKS / 100,
        }
        if not sub:
            return Response({
                **base,
                "has_subscription": False,
                "status": None,
                "is_valid": False,
                "current_period_end": None,
            })
        return Response({
            **base,
            "has_subscription": True,
            "status": sub.status,
            "is_valid": sub.is_valid,
            "current_period_end": sub.current_period_end,
            "is_referral_trial": sub.is_referral_trial,
        })


class StarsBalanceView(APIView):
    """GET — star balance + transaction history."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        txns = StarTransaction.objects.filter(user=request.user)[:50]
        return Response({
            "stars": request.user.stars,
            "expansion_cost": CHAT_EXPANSION_COST_STARS,
            "transactions": [
                {
                    "id": str(t.id),
                    "amount": t.amount,
                    "reason": t.reason,
                    "description": t.description,
                    "created_at": t.created_at.isoformat(),
                }
                for t in txns
            ],
        })


class ExpandChatView(APIView):
    """POST — expand chat with stars: target_max_members 100 (50 stars) or 1000 (100 stars)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from apps.chats.models import Chat, EXPANSION_TIER_100, EXPANSION_TIER_1000
        chat_id = request.data.get("chat_id")
        try:
            target = int(request.data.get("target_max_members") or 0)
        except (TypeError, ValueError):
            target = 0
        if not chat_id:
            return Response({"detail": "chat_id обязателен."}, status=status.HTTP_400_BAD_REQUEST)
        if target not in (EXPANSION_TIER_100, EXPANSION_TIER_1000):
            return Response(
                {"detail": "Укажите target_max_members: 100 (50 звёзд) или 1000 (100 звёзд)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            chat = Chat.objects.get(id=chat_id, is_active=True)
        except Chat.DoesNotExist:
            return Response({"detail": "Чат не найден."}, status=status.HTTP_404_NOT_FOUND)

        result = expand_chat(request.user, chat, target)
        if not result["ok"]:
            return Response({"detail": result["detail"]}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)


class CreateSubscriptionPaymentView(APIView):
    """POST — create a payment to activate/renew user subscription."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        sub, created = UserSubscription.objects.get_or_create(
            user=request.user,
            defaults={
                "price_kopecks": SUBSCRIPTION_PRICE_KOPECKS,
                "status": UserSubscription.Status.CANCELLED,
            },
        )
        # If subscription is active and hasn't expired — no payment needed
        if sub.is_valid and sub.yookassa_payment_method_id:
            return Response(
                {"detail": "Подписка уже активна."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        amount_rubles = SUBSCRIPTION_PRICE_KOPECKS / 100.0
        default_return = f"{getattr(settings, 'FRONTEND_URL', '').rstrip('/')}/chats?paid=1"
        return_url = request.data.get("return_url") or default_return
        if not _is_allowed_return_url(return_url):
            return Response(
                {"detail": "Некорректный return_url."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            payment = create_payment(
                amount_rubles=amount_rubles,
                return_url=return_url,
                description="Подписка на мессенджер (300 руб./мес.)",
                save_payment_method=True,
                metadata={"subscription_id": str(sub.id)},
            )
        except Exception:
            return Response(
                {"detail": "Ошибка создания платежа."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        pid = getattr(payment, "id", None) or (
            payment.get("id") if isinstance(payment, dict) else None
        )
        PaymentLog.objects.create(
            subscription=sub,
            yookassa_payment_id=pid,
            amount_kopecks=SUBSCRIPTION_PRICE_KOPECKS,
            status=PaymentLog.Status.PENDING,
            raw_response={"id": pid},
        )
        confirmation = getattr(payment, "confirmation", None) or (
            payment.get("confirmation") if isinstance(payment, dict) else None
        )
        url = (
            getattr(confirmation, "confirmation_url", None)
            if confirmation
            else (
                confirmation.get("confirmation_url")
                if isinstance(confirmation, dict)
                else None
            )
        )
        return Response({
            "payment_id": pid,
            "confirmation_url": url,
            "amount": amount_rubles,
        })


@method_decorator(csrf_exempt, name="dispatch")
@method_decorator(require_POST, name="dispatch")
class YooKassaWebhookView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [WebhookThrottle]

    def post(self, request):
        try:
            body = json.loads(request.body)
        except json.JSONDecodeError:
            return Response(status=status.HTTP_400_BAD_REQUEST)

        if body.get("event") != "payment.succeeded":
            return Response(status=status.HTTP_200_OK)

        obj = body.get("object", {})
        payment_id = obj.get("id")
        if not payment_id:
            return Response(status=status.HTTP_200_OK)

        try:
            payment = get_payment(payment_id)
        except Exception:
            return Response(status=status.HTTP_200_OK)

        payment_status = getattr(payment, "status", None) or (
            payment.get("status") if isinstance(payment, dict) else None
        )
        if payment_status != "succeeded":
            return Response(status=status.HTTP_200_OK)

        metadata = getattr(payment, "metadata", None) or {}
        subscription_id = metadata.get("subscription_id")
        if not subscription_id:
            return Response(status=status.HTTP_200_OK)

        subscription = UserSubscription.objects.filter(id=subscription_id).first()
        if not subscription:
            return Response(status=status.HTTP_200_OK)

        paylog = PaymentLog.objects.filter(
            yookassa_payment_id=payment_id,
            subscription=subscription,
        ).first()
        if not paylog:
            return Response(status=status.HTTP_200_OK)
        if paylog.status == PaymentLog.Status.SUCCEEDED:
            return Response(status=status.HTTP_200_OK)

        amount_obj = getattr(payment, "amount", None) or (
            payment.get("amount") if isinstance(payment, dict) else None
        )
        value_raw = getattr(amount_obj, "value", None) if amount_obj and not isinstance(amount_obj, dict) else (
            amount_obj.get("value") if isinstance(amount_obj, dict) else None
        )
        currency = getattr(amount_obj, "currency", None) if amount_obj and not isinstance(amount_obj, dict) else (
            amount_obj.get("currency") if isinstance(amount_obj, dict) else None
        )
        try:
            amount_kopecks = int(round(float(value_raw) * 100))
        except (TypeError, ValueError):
            return Response(status=status.HTTP_200_OK)
        if currency != "RUB" or amount_kopecks != subscription.price_kopecks:
            return Response(status=status.HTTP_200_OK)

        # Save payment method for recurring payments
        pm = getattr(payment, "payment_method", None) or (
            payment.get("payment_method") if isinstance(payment, dict) else None
        )
        payment_method = getattr(payment, "payment_method_id", None) or (
            getattr(pm, "id", None) if pm and not isinstance(pm, dict) else (
                pm.get("id") if isinstance(pm, dict) else None
            )
        )
        if payment_method:
            subscription.yookassa_payment_method_id = payment_method

        subscription.status = UserSubscription.Status.ACTIVE
        now = timezone.now()
        subscription.current_period_start = now
        subscription.current_period_end = now + timedelta(days=SUBSCRIPTION_PERIOD_DAYS)
        subscription.save()

        PaymentLog.objects.filter(yookassa_payment_id=payment_id).update(
            status=PaymentLog.Status.SUCCEEDED,
            raw_response={"id": payment_id, "status": payment_status, "amount": value_raw, "currency": currency},
        )
        return Response(status=status.HTTP_200_OK)
