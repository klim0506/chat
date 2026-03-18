from django.conf import settings
from django.db import models
from django.db.models import Q
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.serializers import ValidationError as SerializerValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser

from .models import User, UserAvatar, UserSession
from apps.payments.plan_limits import get_max_avatars, RESTRICTION_CODE
from apps.common.image_utils import compress_uploaded_image, create_avatar_thumbnails, delete_avatar_thumbnails, AVATAR_MAX_DIM
from .serializers import (
    SendCodeSerializer,
    VerifyCodeSerializer,
    UserSerializer,
    validate_username_format,
)
from .services import (
    generate_code,
    set_otp_and_mark_sent,
    get_otp,
    delete_otp,
    can_send_sms,
    send_sms,
    send_telegram_verification,
    incr_verify_attempts,
    notify_new_login,
    MAX_VERIFY_ATTEMPTS,
)
from .jwt_utils import make_access_token, make_refresh_token, decode_token
from .throttles import SendCodeThrottle, VerifyCodeThrottle, RefreshTokenThrottle


def _normalize_phone(phone: str) -> str:
    p = phone.replace(" ", "").replace("-", "").replace("(", "").replace(")", "").strip()
    return p if p.startswith("+") else "+" + p


def _get_client_ip(request) -> str | None:
    """Extract client IP from request (respects X-Forwarded-For behind proxy)."""
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def _parse_device_label(ua_string: str) -> str:
    """Parse User-Agent string into a human-readable device label like 'Chrome 120, Windows 10'."""
    if not ua_string:
        return "Unknown device"
    try:
        from user_agents import parse as ua_parse
        ua = ua_parse(ua_string)
        browser = ua.browser.family
        if ua.browser.version_string:
            browser += " " + ua.browser.version_string.split(".")[0]
        os_name = ua.os.family
        if ua.os.version_string:
            os_name += " " + ua.os.version_string
        return f"{browser}, {os_name}"
    except Exception:
        return ua_string[:100] if ua_string else "Unknown device"


def _create_session(request, user, client_type: str = "web") -> UserSession:
    """Create a UserSession record for the current login."""
    ua_string = request.META.get("HTTP_USER_AGENT", "")
    return UserSession.objects.create(
        user=user,
        ip_address=_get_client_ip(request),
        user_agent=ua_string,
        device_label=_parse_device_label(ua_string),
        client_type=client_type,
    )


def _is_debug_phone(phone: str) -> bool:
    if not getattr(settings, "AUTH_DEBUG", False):
        return False
    normalized = _normalize_phone(phone)
    return normalized in getattr(settings, "AUTH_DEBUG_PHONES", [])


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    """Set httpOnly cookie with refresh token (30 days). Used for web to remember login."""
    max_age = getattr(settings, "REFRESH_COOKIE_MAX_AGE_DAYS", 30) * 24 * 60 * 60
    response.set_cookie(
        key=getattr(settings, "REFRESH_COOKIE_NAME", "refresh_token"),
        value=refresh_token,
        max_age=max_age,
        path="/",
        httponly=getattr(settings, "REFRESH_COOKIE_HTTPONLY", True),
        samesite=getattr(settings, "REFRESH_COOKIE_SAMESITE", "Lax"),
        secure=getattr(settings, "REFRESH_COOKIE_SECURE", False),
    )


def _clear_refresh_cookie(response: Response) -> None:
    """Remove refresh cookie (on explicit logout)."""
    response.delete_cookie(
        key=getattr(settings, "REFRESH_COOKIE_NAME", "refresh_token"),
        path="/",
        samesite=getattr(settings, "REFRESH_COOKIE_SAMESITE", "Lax"),
        secure=getattr(settings, "REFRESH_COOKIE_SECURE", False),
    )


class SendCodeView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [SendCodeThrottle]

    def post(self, request):
        ser = SendCodeSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        phone = _normalize_phone(ser.validated_data["phone"])
        method = ser.validated_data.get("method")  # sms|telegram (default: telegram first)

        # Check if the phone is already registered (for referral banner on frontend)
        user_exists = User.objects.filter(phone=phone, username__isnull=False).exclude(username="").exists()

        # Debug phones bypass rate limit
        if _is_debug_phone(phone):
            debug_code = getattr(settings, "AUTH_DEBUG_CODE", "")
            if not debug_code:
                return Response({"detail": "AUTH_DEBUG включён без AUTH_DEBUG_CODE."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            set_otp_and_mark_sent(phone, debug_code)
            return Response({"detail": "Режим отладки: код не отправлен.", "method": "debug", "is_new": not user_exists})

        if not can_send_sms(phone):
            return Response({"detail": "Следующий код можно запросить через минуту."}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        code = generate_code(6)

        if method == "sms":
            if send_sms(phone, f"Код для входа: {code}"):
                set_otp_and_mark_sent(phone, code)
                return Response({"detail": "Код отправлен по SMS.", "method": "sms", "is_new": not user_exists})
            return Response({"detail": "Не удалось отправить код. Попробуйте позже."}, status=status.HTTP_502_BAD_GATEWAY)

        # Try Telegram Gateway first (official verification bot); on API error — 503, otherwise fallback to SMS
        tg_result, tg_error = send_telegram_verification(phone, code)
        if tg_error:
            return Response({"detail": tg_error}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if tg_result is not None:
            set_otp_and_mark_sent(phone, code)
            return Response({"detail": "Код отправлен в Telegram.", "method": "telegram", "is_new": not user_exists})

        if send_sms(phone, f"Код для входа: {code}"):
            set_otp_and_mark_sent(phone, code)
            return Response({"detail": "Код отправлен по SMS.", "method": "sms", "is_new": not user_exists})

        return Response(
            {"detail": "Не удалось отправить код. Попробуйте позже."},
            status=status.HTTP_502_BAD_GATEWAY,
        )


class VerifyCodeView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [VerifyCodeThrottle]

    def post(self, request):
        ser = VerifyCodeSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        phone = _normalize_phone(ser.validated_data["phone"])
        code = ser.validated_data["code"].strip()
        if incr_verify_attempts(phone) > MAX_VERIFY_ATTEMPTS:
            return Response({"detail": "Превышено число попыток."}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        if _is_debug_phone(phone):
            debug_code = getattr(settings, "AUTH_DEBUG_CODE", "")
            if not debug_code:
                return Response({"detail": "AUTH_DEBUG включён без AUTH_DEBUG_CODE."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            if code != debug_code:
                return Response({"detail": "Неверный код."}, status=status.HTTP_400_BAD_REQUEST)
            delete_otp(phone)
        else:
            stored = get_otp(phone)
            if not stored or stored != code:
                return Response({"detail": "Неверный код."}, status=status.HTTP_400_BAD_REQUEST)
            delete_otp(phone)

        # Referral link
        ref_code = request.data.get("ref", "").strip()
        referrer = None
        if ref_code:
            referrer = User.objects.filter(referral_code=ref_code, is_active=True).first()
            if referrer and _normalize_phone(referrer.phone) == phone:
                referrer = None

        # UTM / registration source (for new users)
        utm_source = (request.data.get("utm_source") or "").strip()[:255]
        utm_medium = (request.data.get("utm_medium") or "").strip()[:255]
        utm_campaign = (request.data.get("utm_campaign") or "").strip()[:255]
        registration_source = "referral" if referrer else ("utm" if (utm_source or utm_medium or utm_campaign) else "organic")

        # Delete incomplete registration (phone claimed but no username set)
        # so the user can start fresh on re-verification.
        try:
            existing = User.objects.get(phone=phone)
            if not existing.username:
                existing.delete()  # CASCADE cleans up sessions, subscription, favorites, etc.
        except User.DoesNotExist:
            pass

        user, created = User.objects.get_or_create(
            phone=phone,
            defaults={
                "display_name": phone,
                "referred_by": referrer,
                "registration_source": registration_source,
                "utm_source": utm_source,
                "utm_medium": utm_medium,
                "utm_campaign": utm_campaign,
            },
        )
        if not user.is_active:
            return Response({"detail": "Аккаунт деактивирован."}, status=status.HTTP_403_FORBIDDEN)

        # On first registration, username can be set from request body
        if created:
            raw_username = ser.validated_data.get("username") or request.data.get("username") or ""
            if raw_username and raw_username.strip():
                try:
                    normalized = validate_username_format(raw_username)
                    if User.objects.filter(username__iexact=normalized).exists():
                        return Response(
                            {"detail": "Этот юзернейм уже занят."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    user.username = normalized
                    user.save(update_fields=["username"])
                except SerializerValidationError as e:
                    msg = e.detail[0] if isinstance(e.detail, list) else e.detail
                    return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)

        # Create subscription + award referral rewards + Favorites chat on first registration
        if created:
            from apps.payments.services import create_subscription_for_user, award_referral_subscription
            from apps.chats.services import create_favorites_chat
            from .models import record_analytics_event
            # Тестовый бесплатный аккаунт: +70000000002 без подписки (ограниченный функционал)
            if phone != "+70000000002":
                create_subscription_for_user(user, is_referral=bool(referrer))
            if referrer:
                award_referral_subscription(inviter=referrer, invitee=user)
            create_favorites_chat(user)
            record_analytics_event(
                user, "registration",
                {"registration_source": registration_source, "utm_source": utm_source or None, "utm_medium": utm_medium or None, "utm_campaign": utm_campaign or None, "ref": ref_code or None},
            )

        # Create session record for this login
        client = (request.META.get("HTTP_X_CLIENT") or "").strip().lower()
        if client not in ("android", "desktop"):
            client = "web"
        session = _create_session(request, user, client_type=client)
        access = make_access_token(user.id, session.id)
        refresh = make_refresh_token(user.id, session.id, client_type=client)

        # Notify existing sessions about the new login (WS if online, SMS if offline)
        if not created:
            try:
                notify_new_login(user, session)
            except Exception:
                pass  # Don't block login if notification fails

        response = Response({"access": access, "refresh": refresh, "user": UserSerializer(user).data, "created": created})
        if client == "web":
            _set_refresh_cookie(response, refresh)
        return response


class RefreshTokenView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [RefreshTokenThrottle]

    def post(self, request):
        cookie_name = getattr(settings, "REFRESH_COOKIE_NAME", "refresh_token")
        refresh = request.COOKIES.get(cookie_name) or request.data.get("refresh")
        if not refresh:
            return Response({"detail": "refresh обязателен."}, status=status.HTTP_400_BAD_REQUEST)
        payload = decode_token(refresh)
        if not payload or payload.get("type") != "refresh":
            return Response({"detail": "Недействительный refresh token."}, status=status.HTTP_401_UNAUTHORIZED)
        try:
            user = User.objects.get(pk=payload["user_id"])
        except User.DoesNotExist:
            return Response({"detail": "Пользователь не найден."}, status=status.HTTP_401_UNAUTHORIZED)
        if not user.is_active:
            return Response({"detail": "Аккаунт деактивирован."}, status=status.HTTP_403_FORBIDDEN)
        # Validate session is still active (skip for legacy tokens without sid)
        sid = payload.get("sid")
        if sid:
            if not UserSession.objects.filter(id=sid, is_active=True).exists():
                return Response({"detail": "Сессия завершена."}, status=status.HTTP_401_UNAUTHORIZED)
        data = {"access": make_access_token(user.id, sid), "user": UserSerializer(user).data}
        return Response(data)


class LogoutView(APIView):
    """POST — logout current session: deactivate session and clear refresh cookie."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        sid = getattr(request, "session_id", None)
        if sid:
            UserSession.objects.filter(id=sid, user=request.user, is_active=True).update(is_active=False)
        response = Response(status=status.HTTP_204_NO_CONTENT)
        _clear_refresh_cookie(response)
        return response


class CheckUsernameView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        raw = (request.data.get("username") or "").strip()
        if not raw:
            return Response({"available": False, "detail": "Username is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            normalized = validate_username_format(raw)
        except SerializerValidationError as e:
            msg = e.detail[0] if isinstance(e.detail, list) else str(e.detail)
            return Response({"available": False, "detail": str(msg)})
        taken = User.objects.filter(username__iexact=normalized).exclude(pk=request.user.pk).exists()
        return Response({"available": not taken})


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user, context={"request": request}).data)

    def patch(self, request):
        ser = UserSerializer(request.user, data=request.data, partial=True, context={"request": request})
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)


class MeAvatarView(APIView):
    """Legacy: single avatar. Kept for backward compatibility."""
    permission_classes = [IsAuthenticated]
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request):
        file_obj = request.FILES.get("avatar")
        if not file_obj:
            return Response({"detail": "Файл не передан."}, status=status.HTTP_400_BAD_REQUEST)
        if file_obj.size > 5 * 1024 * 1024:  # 5 MB
            return Response({"detail": "Файл больше 5 МБ."}, status=status.HTTP_400_BAD_REQUEST)
        file_obj = compress_uploaded_image(file_obj, max_dim=AVATAR_MAX_DIM)
        old_path = request.user.avatar.name if request.user.avatar else None
        request.user.avatar = file_obj
        request.user.save(update_fields=["avatar"])
        if old_path:
            delete_avatar_thumbnails(old_path)
        create_avatar_thumbnails(request.user.avatar.name)
        return Response(UserSerializer(request.user, context={"request": request}).data)

    def delete(self, request):
        old_path = request.user.avatar.name if request.user.avatar else None
        request.user.avatar = None
        request.user.save(update_fields=["avatar"])
        if old_path:
            delete_avatar_thumbnails(old_path)
        return Response(UserSerializer(request.user, context={"request": request}).data)


class MeAvatarsView(APIView):
    """Avatar gallery (up to 30). GET — list, POST — add."""
    permission_classes = [IsAuthenticated]
    parser_classes = (MultiPartParser, FormParser)

    def get(self, request):
        from apps.files.protected_media import make_protected_media_url

        avatars = UserAvatar.objects.filter(user=request.user).order_by("order", "id")
        data = []
        for a in avatars:
            try:
                if a.image:
                    url = make_protected_media_url(a.image.name, request)
                    if url:
                        data.append({"id": a.id, "url": url, "order": a.order})
            except (ValueError, OSError):
                continue
        if request.user.avatar and not avatars.exists():
            try:
                url = make_protected_media_url(request.user.avatar.name, request)
                if url:
                    data.append({"id": "legacy", "url": url, "order": 0})
            except (ValueError, OSError):
                pass
        return Response(data)

    def post(self, request):
        count = UserAvatar.objects.filter(user=request.user).count()
        if request.user.avatar and count == 0:
            count = 1  # account for legacy avatar
        max_avatars = get_max_avatars(request.user)
        if count >= max_avatars:
            return Response(
                {"detail": f"Максимум {max_avatars} аватарок на вашем тарифе. Оформите подписку для до 50 аватарок.", "code": RESTRICTION_CODE},
                status=status.HTTP_403_FORBIDDEN,
            )
        file_obj = request.FILES.get("avatar")
        if not file_obj:
            return Response({"detail": "Файл не передан."}, status=status.HTTP_400_BAD_REQUEST)
        if file_obj.size > 5 * 1024 * 1024:
            return Response({"detail": "Файл больше 5 МБ."}, status=status.HTTP_400_BAD_REQUEST)
        max_order = (
            UserAvatar.objects.filter(user=request.user).aggregate(
                m=models.Max("order")
            )["m"] or -1
        )
        file_obj = compress_uploaded_image(file_obj, max_dim=AVATAR_MAX_DIM)
        obj = UserAvatar.objects.create(user=request.user, image=file_obj, order=max_order + 1)
        create_avatar_thumbnails(obj.image.name)
        from apps.files.protected_media import make_protected_media_url
        url = make_protected_media_url(obj.image.name, request) or ""
        return Response({"id": obj.id, "url": url, "order": obj.order}, status=status.HTTP_201_CREATED)


class MeAvatarDetailView(APIView):
    """DELETE — remove, PATCH — change order."""
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        obj = UserAvatar.objects.filter(user=request.user, id=pk).first()
        if not obj:
            return Response({"detail": "Не найдено."}, status=status.HTTP_404_NOT_FOUND)
        old_path = obj.image.name if obj.image else None
        obj.image.delete(save=False)
        if old_path:
            delete_avatar_thumbnails(old_path)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def patch(self, request, pk):
        obj = UserAvatar.objects.filter(user=request.user, id=pk).first()
        if not obj:
            return Response({"detail": "Не найдено."}, status=status.HTTP_404_NOT_FOUND)
        new_order = request.data.get("order")
        if new_order is None:
            return Response({"detail": "Поле order обязательно."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            new_order = int(new_order)
        except (TypeError, ValueError):
            return Response({"detail": "order должен быть числом."}, status=status.HTTP_400_BAD_REQUEST)
        obj.order = new_order
        obj.save(update_fields=["order"])
        return Response({"id": obj.id, "order": obj.order})


class MeAvatarsReorderView(APIView):
    """POST { "order": [id1, id2, ...] } — reorder avatars."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ids = request.data.get("order")
        if not isinstance(ids, list):
            return Response({"detail": "order должен быть массивом id."}, status=status.HTTP_400_BAD_REQUEST)
        qs = UserAvatar.objects.filter(user=request.user)
        by_id = {a.id: a for a in qs}
        for i, id_val in enumerate(ids):
            aid = id_val if isinstance(id_val, int) else (int(id_val) if str(id_val).isdigit() else None)
            if aid and aid in by_id:
                by_id[aid].order = i
                by_id[aid].save(update_fields=["order"])
        return Response(status=status.HTTP_200_OK)


class UserSearchView(APIView):
    """Search users by username/display_name for adding to chat or starting a DM."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        q = (request.query_params.get("q") or "").strip().lower()
        if len(q) < 1:
            return Response({"results": []})
        if len(q) > 30:
            return Response({"results": []})
        # Search by username (contains) and display_name
        queryset = (
            User.objects.filter(
                Q(username__icontains=q) | Q(display_name__icontains=q)
            )
            .exclude(pk=request.user.pk)
            .filter(Q(username__isnull=False) & ~Q(username=""))
            .distinct()[:20]
        )
        results = []
        for u in queryset:
            data = {
                "id": str(u.id),
                "username": u.username,
                "display_name": u.display_name or u.username or "",
                "avatar_url": u.get_avatar_url(request),
                "avatar_url_small": u.get_avatar_url(request, size="small"),
                "avatar_url_medium": u.get_avatar_url(request, size="medium"),
            }
            results.append(data)
        return Response({"results": results})


class ResolveUsernameView(APIView):
    """Resolve @username to user. Public (AllowAny) for deep links."""
    permission_classes = [AllowAny]

    def get(self, request):
        username = (request.query_params.get("username") or "").strip().lstrip("@")
        if not username or len(username) < 3 or len(username) > 30:
            return Response({"detail": "Invalid username."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            return Response({"detail": "User not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response({
            "id": str(user.id),
            "username": user.username,
            "display_name": user.display_name or user.username or "",
            "avatar_url": user.get_avatar_url(request) if hasattr(user, "get_avatar_url") else None,
        })


