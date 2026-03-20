from datetime import timedelta
from urllib.parse import urlparse
import ipaddress
import json
import logging

from django.conf import settings
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from django.utils.decorators import method_decorator
from rest_framework import status
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.views import APIView
from rest_framework.response import Response

from .models import UserSubscription, PaymentLog
from .constants import (
    SUBSCRIPTION_PLANS,
    REFERRAL_MILESTONES,
    INTRO_OFFER_CODE,
    INTRO_OFFER_DAYS,
    INTRO_OFFER_PRICE_KOPECKS,
    INTRO_OFFER_RENEW_PRICE_KOPECKS,
)
from .plan_limits import get_video_circles_remaining_today
from .yookassa_client import create_payment, get_payment, get_payment_method
from .services import extend_subscription
from .throttles import WebhookThrottle

logger = logging.getLogger(__name__)


def _get_webhook_client_ip(request):
    """Client IP for webhook: leftmost X-Forwarded-For (nginx) or REMOTE_ADDR."""
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.strip().split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")


def _is_yookassa_webhook_ip_allowed(request) -> bool:
    """True if YOOKASSA_WEBHOOK_IP_ALLOWLIST is empty or client IP is in it."""
    allowlist = getattr(settings, "YOOKASSA_WEBHOOK_IP_ALLOWLIST", None) or []
    if not allowlist:
        return True
    try:
        client_ip = ipaddress.ip_address(_get_webhook_client_ip(request))
    except ValueError:
        return False
    for entry in allowlist:
        entry = (entry or "").strip()
        if not entry:
            continue
        try:
            if "/" in entry:
                if client_ip in ipaddress.ip_network(entry, strict=False):
                    return True
            else:
                if client_ip == ipaddress.ip_address(entry):
                    return True
        except ValueError:
            continue
    return False


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


def _get_referral_progress(user):
    invited_count = user.referrals.count()
    claimed = set(
        user.referral_rewards.values_list("tier", flat=True)
    )
    milestones = sorted(REFERRAL_MILESTONES.keys())
    next_milestone = next((m for m in milestones if m > invited_count), None)
    return {
        "invited_count": invited_count,
        "claimed_tiers": list(claimed),
        "next_milestone": next_milestone,
        "milestones": {str(k): v for k, v in REFERRAL_MILESTONES.items()},
    }


def _get_intro_offer_payload(sub: UserSubscription | None):
    is_valid = sub.is_valid if sub else False
    intro_used = bool(sub and sub.intro_offer_used_at)
    return {
        "available": not intro_used and not is_valid,
        "offer_code": INTRO_OFFER_CODE,
        "price_rub": INTRO_OFFER_PRICE_KOPECKS / 100,
        "duration_days": INTRO_OFFER_DAYS,
        "renew_price_rub": INTRO_OFFER_RENEW_PRICE_KOPECKS / 100,
    }


class SubscriptionStatusView(APIView):
    """GET — current subscription status + referral progress + plans."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        sub = UserSubscription.objects.filter(user=request.user).first()
        intro_offer = _get_intro_offer_payload(sub)
        plans = [
            {
                "months": m,
                "total_rub": info["total_kopecks"] / 100,
                "per_month_rub": info["per_month_kopecks"] / 100,
                "original_rub": info["original_kopecks"] / 100 if info["original_kopecks"] != info["total_kopecks"] else None,
                "discount_pct": info.get("discount_pct", 0) or 0,
                "savings_rub": (info["original_kopecks"] - info["total_kopecks"]) / 100 if info["original_kopecks"] != info["total_kopecks"] else None,
            }
            for m, info in SUBSCRIPTION_PLANS.items()
        ]
        base = {
            "plans": plans,
            "referral_progress": _get_referral_progress(request.user),
            "intro_offer": intro_offer,
            "intro_offer_available": intro_offer["available"],
        }
        if not sub:
            return Response({
                **base,
                "has_subscription": False,
                "status": None,
                "is_valid": False,
                "current_period_end": None,
                "is_referral_trial": False,
                "price_rub": plans[0]["per_month_rub"] if plans else 299,
            })
        return Response({
            **base,
            "has_subscription": True,
            "status": sub.status,
            "is_valid": sub.is_valid,
            "current_period_end": sub.current_period_end,
            "is_referral_trial": sub.is_referral_trial,
            "price_rub": sub.price_kopecks / 100,
        })


class VideoCircleQuotaView(APIView):
    """GET — remaining video circles for today. null = unlimited (Premium)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        remaining = get_video_circles_remaining_today(request.user)
        return Response({"remaining": remaining})


def _user_payment_method_id(request):
    """Return current user's saved YooKassa payment method id or None."""
    sub = UserSubscription.objects.filter(user=request.user).first()
    if not sub or not (sub.yookassa_payment_method_id or "").strip():
        return None
    return sub.yookassa_payment_method_id.strip()


class PaymentMethodsListView(APIView):
    """GET — list saved payment methods (for current user's subscription)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        pm_id = _user_payment_method_id(request)
        if not pm_id:
            return Response({"payment_methods": []})
        try:
            pm = get_payment_method(pm_id)
        except Exception as e:
            logger.warning("YooKassa get_payment_method failed: %s", e)
            return Response({"payment_methods": [{"id": pm_id, "title": "••••"}]})
        title = getattr(pm, "title", None) or ""
        if not title and getattr(pm, "card", None):
            last4 = getattr(pm.card, "last4", None) or "••••"
            title = f"•••• {last4}"
        if not title:
            title = "••••"
        return Response({
            "payment_methods": [{"id": pm_id, "title": title}],
        })


class PaymentMethodDetailView(APIView):
    """GET — detail of a saved payment method (card last4, type, expiry)."""

    permission_classes = [IsAuthenticated]

    def get(self, request, payment_method_id: str):
        if _user_payment_method_id(request) != payment_method_id:
            return Response(status=status.HTTP_404_NOT_FOUND)
        try:
            pm = get_payment_method(payment_method_id)
        except Exception as e:
            logger.warning("YooKassa get_payment_method failed: %s", e)
            return Response(status=status.HTTP_404_NOT_FOUND)
        card = getattr(pm, "card", None)
        out = {"id": payment_method_id, "title": getattr(pm, "title", None) or ""}
        if card:
            out["last4"] = getattr(card, "last4", None) or ""
            out["card_type"] = getattr(card, "card_type", None) or ""
            out["expiry_month"] = getattr(card, "expiry_month", None) or ""
            out["expiry_year"] = getattr(card, "expiry_year", None) or ""
        return Response(out)


class PaymentMethodUnlinkView(APIView):
    """DELETE — unlink saved payment method from subscription."""

    permission_classes = [IsAuthenticated]

    def delete(self, request, payment_method_id: str):
        sub = UserSubscription.objects.filter(user=request.user).first()
        if not sub or (sub.yookassa_payment_method_id or "").strip() != payment_method_id:
            return Response(status=status.HTTP_404_NOT_FOUND)
        sub.yookassa_payment_method_id = ""
        sub.save(update_fields=["yookassa_payment_method_id"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class CreateSubscriptionPaymentView(APIView):
    """POST — create a payment for subscription. plan_months (1,6,12,24), optional recipient_user_id for gift."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        plan_months = request.data.get("plan_months")
        offer_code = (request.data.get("offer_code") or "").strip()
        recipient_user_id = request.data.get("recipient_user_id")  # for gift
        is_intro_offer = offer_code == INTRO_OFFER_CODE
        if not is_intro_offer and plan_months not in SUBSCRIPTION_PLANS:
            return Response(
                {"detail": "Укажите plan_months: 1, 6, 12 или 24."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if is_intro_offer:
            amount_kopecks = INTRO_OFFER_PRICE_KOPECKS
            amount_rubles = amount_kopecks / 100.0
            renewal_price_kopecks = INTRO_OFFER_RENEW_PRICE_KOPECKS
        else:
            plan_info = SUBSCRIPTION_PLANS[plan_months]
            amount_kopecks = plan_info["total_kopecks"]
            amount_rubles = amount_kopecks / 100.0
            renewal_price_kopecks = plan_info["per_month_kopecks"]

        is_gift = bool(recipient_user_id)
        if is_intro_offer and is_gift:
            return Response(
                {"detail": "Пробную неделю нельзя подарить."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if is_gift:
            from apps.users.models import User
            recipient = User.objects.filter(id=recipient_user_id, is_active=True).first()
            if not recipient:
                return Response({"detail": "Пользователь не найден."}, status=status.HTTP_404_NOT_FOUND)
            if recipient.id == request.user.id:
                return Response({"detail": "Нельзя подарить подписку себе."}, status=status.HTTP_400_BAD_REQUEST)
            sub, _ = UserSubscription.objects.get_or_create(
                user=recipient,
                defaults={
                    "price_kopecks": renewal_price_kopecks,
                    "status": UserSubscription.Status.CANCELLED,
                },
            )
        else:
            sub, created = UserSubscription.objects.get_or_create(
                user=request.user,
                defaults={
                    "price_kopecks": renewal_price_kopecks,
                    "status": UserSubscription.Status.CANCELLED,
                },
            )
            if is_intro_offer and sub.intro_offer_used_at:
                return Response(
                    {"detail": "Пробная неделя уже была использована."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if sub.is_valid and sub.yookassa_payment_method_id and not created:
                return Response(
                    {"detail": "Подписка уже активна."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        default_return = f"{getattr(settings, 'FRONTEND_URL', '').rstrip('/')}/settings?paid=1"
        return_url = request.data.get("return_url") or default_return
        if not _is_allowed_return_url(return_url):
            return Response(
                {"detail": "Некорректный return_url."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        desc = f"Подписка Premium — {plan_months} мес." if plan_months == 1 else f"Подписка Premium — {plan_months} мес."
        if is_intro_offer:
            desc = "Пробная неделя Pingy Premium — 7 дней за 11 ₽"
        elif is_gift:
            desc = f"Подарок подписки Premium — {plan_months} мес."

        metadata = {
            "subscription_id": str(sub.id),
        }
        if is_intro_offer:
            metadata["offer_code"] = INTRO_OFFER_CODE
        else:
            metadata["plan_months"] = plan_months
        if is_gift:
            metadata["recipient_user_id"] = str(recipient_user_id)

        receipt_email = (
            getattr(settings, "YOOKASSA_RECEIPT_EMAIL", None)
            or "payments@pingychat.com"
        )
        if not receipt_email or "@" not in str(receipt_email):
            receipt_email = "payments@pingychat.com"
        receipt_desc = f"Подписка Pingy Premium на {plan_months} мес."
        if is_intro_offer:
            receipt_desc = "Пробная неделя Pingy Premium: 7 дней за 11 ₽, затем 299 ₽/мес."
        elif is_gift:
            receipt_desc = f"Подарок подписки Pingy Premium на {plan_months} мес."
        receipt = {
            "customer": {"email": str(receipt_email).strip()},
            "items": [
                {
                    "description": receipt_desc[:128],
                    "quantity": "1.00",
                    "amount": {"value": f"{amount_rubles:.2f}", "currency": "RUB"},
                    "vat_code": 1,
                    "payment_mode": "full_prepayment",
                    "payment_subject": "service",
                }
            ],
        }

        # save_payment_method=True требует подключённых рекуррентных платежей в кабинете YooKassa
        save_payment_method = getattr(settings, "YOOKASSA_SAVE_PAYMENT_METHOD", False) and not is_gift
        try:
            payment = create_payment(
                amount_rubles=amount_rubles,
                return_url=return_url,
                description=desc,
                save_payment_method=save_payment_method,
                metadata=metadata,
                receipt=receipt,
            )
        except Exception as e:
            logger.exception("YooKassa create_payment failed: %s", e)
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
            amount_kopecks=amount_kopecks,
            status=PaymentLog.Status.PENDING,
            raw_response={
                "id": pid,
                "plan_months": plan_months,
                "offer_code": INTRO_OFFER_CODE if is_intro_offer else None,
                "recipient_user_id": recipient_user_id,
            },
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
            "plan_months": plan_months,
            "offer_code": INTRO_OFFER_CODE if is_intro_offer else None,
        })


@method_decorator(csrf_exempt, name="dispatch")
@method_decorator(require_POST, name="dispatch")
class YooKassaWebhookView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [WebhookThrottle]

    def post(self, request):
        if not _is_yookassa_webhook_ip_allowed(request):
            return Response(status=status.HTTP_403_FORBIDDEN)
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
        if isinstance(metadata, dict):
            pass
        else:
            metadata = {}
        subscription_id = metadata.get("subscription_id")
        plan_months = metadata.get("plan_months")
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

        offer_code = metadata.get("offer_code") or paylog.raw_response.get("offer_code")
        months = plan_months
        if months is None:
            months = paylog.raw_response.get("plan_months", 1)
        if offer_code != INTRO_OFFER_CODE and months not in SUBSCRIPTION_PLANS:
            months = 1
        expected_kopecks = (
            INTRO_OFFER_PRICE_KOPECKS
            if offer_code == INTRO_OFFER_CODE
            else SUBSCRIPTION_PLANS[months]["total_kopecks"]
        )

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
        if currency != "RUB" or amount_kopecks != expected_kopecks:
            return Response(status=status.HTTP_200_OK)

        if not metadata.get("recipient_user_id"):
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

        if offer_code == INTRO_OFFER_CODE:
            now = timezone.now()
            subscription.status = UserSubscription.Status.TRIAL
            subscription.price_kopecks = INTRO_OFFER_RENEW_PRICE_KOPECKS
            subscription.intro_offer_used_at = subscription.intro_offer_used_at or now
            subscription.current_period_start = now
            subscription.current_period_end = now + timedelta(days=INTRO_OFFER_DAYS)
            subscription.save(
                update_fields=[
                    "status",
                    "price_kopecks",
                    "intro_offer_used_at",
                    "current_period_start",
                    "current_period_end",
                    "yookassa_payment_method_id",
                    "updated_at",
                ]
            )
        else:
            subscription.status = UserSubscription.Status.ACTIVE
            extend_subscription(subscription, months)

        PaymentLog.objects.filter(yookassa_payment_id=payment_id).update(
            status=PaymentLog.Status.SUCCEEDED,
            raw_response={
                "id": payment_id,
                "status": payment_status,
                "amount": value_raw,
                "currency": currency,
                "offer_code": offer_code,
                "plan_months": months,
            },
        )
        return Response(status=status.HTTP_200_OK)
