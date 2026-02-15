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
from .serializers import (
    SendCodeSerializer,
    VerifyCodeSerializer,
    UserSerializer,
    validate_username_format,
)
from .services import (
    generate_code,
    set_otp,
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


def _create_session(request, user) -> UserSession:
    """Create a UserSession record for the current login."""
    ua_string = request.META.get("HTTP_USER_AGENT", "")
    return UserSession.objects.create(
        user=user,
        ip_address=_get_client_ip(request),
        user_agent=ua_string,
        device_label=_parse_device_label(ua_string),
    )


def _is_debug_phone(phone: str) -> bool:
    if not getattr(settings, "AUTH_DEBUG", False):
        return False
    normalized = _normalize_phone(phone)
    return normalized in getattr(settings, "AUTH_DEBUG_PHONES", [])


class SendCodeView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [SendCodeThrottle]

    def post(self, request):
        ser = SendCodeSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        phone = _normalize_phone(ser.validated_data["phone"])
        if not can_send_sms(phone):
            return Response({"detail": "РЎР»РµРґСѓСЋС‰РµРµ SMS РјРѕР¶РЅРѕ РѕС‚РїСЂР°РІРёС‚СЊ С‡РµСЂРµР· РјРёРЅСѓС‚Сѓ."}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        if _is_debug_phone(phone):
            debug_code = getattr(settings, "AUTH_DEBUG_CODE", "")
            if not debug_code:
                return Response({"detail": "AUTH_DEBUG РІРєР»СЋС‡С‘РЅ Р±РµР· AUTH_DEBUG_CODE."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            set_otp(phone, debug_code)
            return Response({"detail": "Р РµР¶РёРј РѕС‚Р»Р°РґРєРё: РєРѕРґ РЅРµ РѕС‚РїСЂР°РІР»РµРЅ.", "method": "debug"})

        code = generate_code(6)
        set_otp(phone, code)

        # 1) Try Telegram verification first; fallback to SMS
        tg_result = send_telegram_verification(phone, code)
        if tg_result:
            return Response({"detail": "Код отправлен в Telegram.", "method": "telegram"})

        # 2) Fallback: SMS via RedSMS HTTP
        if send_sms(phone, f"MyChat: Код для входа: {code}"):
            return Response({"detail": "РљРѕРґ РѕС‚РїСЂР°РІР»РµРЅ РїРѕ SMS.", "method": "sms"})

        return Response(
            {"detail": "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ РєРѕРґ. РџРѕРїСЂРѕР±СѓР№С‚Рµ РїРѕР·Р¶Рµ."},
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
            return Response({"detail": "РџСЂРµРІС‹С€РµРЅРѕ С‡РёСЃР»Рѕ РїРѕРїС‹С‚РѕРє."}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        if _is_debug_phone(phone):
            debug_code = getattr(settings, "AUTH_DEBUG_CODE", "")
            if not debug_code:
                return Response({"detail": "AUTH_DEBUG РІРєР»СЋС‡С‘РЅ Р±РµР· AUTH_DEBUG_CODE."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            if code != debug_code:
                return Response({"detail": "РќРµРІРµСЂРЅС‹Р№ РєРѕРґ."}, status=status.HTTP_400_BAD_REQUEST)
            delete_otp(phone)
        else:
            stored = get_otp(phone)
            if not stored or stored != code:
                return Response({"detail": "РќРµРІРµСЂРЅС‹Р№ РєРѕРґ."}, status=status.HTTP_400_BAD_REQUEST)
            delete_otp(phone)

        # Р РµС„РµСЂР°Р»СЊРЅР°СЏ СЃСЃС‹Р»РєР°
        ref_code = request.data.get("ref", "").strip()
        referrer = None
        if ref_code:
            referrer = User.objects.filter(referral_code=ref_code, is_active=True).first()
            if referrer and _normalize_phone(referrer.phone) == phone:
                referrer = None

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
            },
        )
        if not user.is_active:
            return Response({"detail": "РђРєРєР°СѓРЅС‚ РґРµР°РєС‚РёРІРёСЂРѕРІР°РЅ."}, status=status.HTTP_403_FORBIDDEN)

        # РџСЂРё РїРµСЂРІРѕР№ СЂРµРіРёСЃС‚СЂР°С†РёРё РјРѕР¶РЅРѕ Р·Р°РґР°С‚СЊ username РёР· С‚РµР»Р° Р·Р°РїСЂРѕСЃР°
        if created:
            raw_username = ser.validated_data.get("username") or request.data.get("username") or ""
            if raw_username and raw_username.strip():
                try:
                    normalized = validate_username_format(raw_username)
                    if User.objects.filter(username__iexact=normalized).exists():
                        return Response(
                            {"detail": "Р­С‚РѕС‚ СЋР·РµСЂРЅРµР№Рј СѓР¶Рµ Р·Р°РЅСЏС‚."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    user.username = normalized
                    user.save(update_fields=["username"])
                except SerializerValidationError as e:
                    msg = e.detail[0] if isinstance(e.detail, list) else e.detail
                    return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)

        # РЎРѕР·РґР°С‘Рј РїРѕРґРїРёСЃРєСѓ + РЅР°С‡РёСЃР»СЏРµРј Р·РІС‘Р·РґС‹ + С‡Р°С‚ В«РР·Р±СЂР°РЅРЅРѕРµВ» РїСЂРё РїРµСЂРІРѕР№ СЂРµРіРёСЃС‚СЂР°С†РёРё
        if created:
            from apps.payments.services import create_subscription_for_user, award_referral_stars
            from apps.chats.services import create_favorites_chat
            create_subscription_for_user(user, is_referral=bool(referrer))
            if referrer:
                award_referral_stars(inviter=referrer, invitee=user)
            create_favorites_chat(user)

        # Create session record for this login
        session = _create_session(request, user)
        access = make_access_token(user.id, session.id)
        refresh = make_refresh_token(user.id, session.id)

        # Notify existing sessions about the new login (WS if online, SMS if offline)
        if not created:
            try:
                notify_new_login(user, session)
            except Exception:
                pass  # Don't block login if notification fails

        return Response({"access": access, "refresh": refresh, "user": UserSerializer(user).data, "created": created})


class RefreshTokenView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [RefreshTokenThrottle]

    def post(self, request):
        refresh = request.data.get("refresh")
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
        return Response({"access": make_access_token(user.id, sid)})


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user, context={"request": request}).data)

    def patch(self, request):
        ser = UserSerializer(request.user, data=request.data, partial=True, context={"request": request})
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)


MAX_AVATARS = 30


class MeAvatarView(APIView):
    """Legacy: РѕРґРЅР° Р°РІР°С‚Р°СЂРєР°. РћСЃС‚Р°РІР»РµРЅ РґР»СЏ РѕР±СЂР°С‚РЅРѕР№ СЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚Рё."""
    permission_classes = [IsAuthenticated]
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request):
        file_obj = request.FILES.get("avatar")
        if not file_obj:
            return Response({"detail": "Р¤Р°Р№Р» РЅРµ РїРµСЂРµРґР°РЅ."}, status=status.HTTP_400_BAD_REQUEST)
        if file_obj.size > 5 * 1024 * 1024:  # 5 РњР‘
            return Response({"detail": "Р¤Р°Р№Р» Р±РѕР»СЊС€Рµ 5 РњР‘."}, status=status.HTTP_400_BAD_REQUEST)
        request.user.avatar = file_obj
        request.user.save(update_fields=["avatar"])
        return Response(UserSerializer(request.user, context={"request": request}).data)

    def delete(self, request):
        request.user.avatar = None
        request.user.save(update_fields=["avatar"])
        return Response(UserSerializer(request.user, context={"request": request}).data)


class MeAvatarsView(APIView):
    """Р“Р°Р»РµСЂРµСЏ Р°РІР°С‚Р°СЂРѕРє (РґРѕ 30). GET вЂ” СЃРїРёСЃРѕРє, POST вЂ” РґРѕР±Р°РІРёС‚СЊ."""
    permission_classes = [IsAuthenticated]
    parser_classes = (MultiPartParser, FormParser)

    def get(self, request):
        avatars = UserAvatar.objects.filter(user=request.user).order_by("order", "id")
        data = []
        request_uri = getattr(request, "build_absolute_uri", None)
        for a in avatars:
            url = a.image.url
            if request_uri:
                url = request_uri(url)
            data.append({"id": a.id, "url": url, "order": a.order})
        # Legacy: РµСЃР»Рё РµСЃС‚СЊ User.avatar, РЅРѕ РЅРµС‚ РІ РіР°Р»РµСЂРµРµ вЂ” РґРѕР±Р°РІРёС‚СЊ РїРµСЂРІС‹Рј
        if request.user.avatar and not avatars.exists():
            url = request.user.avatar.url
            if request_uri:
                url = request_uri(url)
            data.append({"id": "legacy", "url": url, "order": 0})
        return Response(data)

    def post(self, request):
        count = UserAvatar.objects.filter(user=request.user).count()
        if request.user.avatar and count == 0:
            count = 1  # СѓС‡С‘С‚ legacy
        if count >= MAX_AVATARS:
            return Response({"detail": f"РњР°РєСЃРёРјСѓРј {MAX_AVATARS} Р°РІР°С‚Р°СЂРѕРє."}, status=status.HTTP_400_BAD_REQUEST)
        file_obj = request.FILES.get("avatar")
        if not file_obj:
            return Response({"detail": "Р¤Р°Р№Р» РЅРµ РїРµСЂРµРґР°РЅ."}, status=status.HTTP_400_BAD_REQUEST)
        if file_obj.size > 5 * 1024 * 1024:
            return Response({"detail": "Р¤Р°Р№Р» Р±РѕР»СЊС€Рµ 5 РњР‘."}, status=status.HTTP_400_BAD_REQUEST)
        max_order = (
            UserAvatar.objects.filter(user=request.user).aggregate(
                m=models.Max("order")
            )["m"] or -1
        )
        obj = UserAvatar.objects.create(user=request.user, image=file_obj, order=max_order + 1)
        url = obj.image.url
        if getattr(request, "build_absolute_uri", None):
            url = request.build_absolute_uri(url)
        return Response({"id": obj.id, "url": url, "order": obj.order}, status=status.HTTP_201_CREATED)


class MeAvatarDetailView(APIView):
    """DELETE вЂ” СѓРґР°Р»РёС‚СЊ, PATCH вЂ” РёР·РјРµРЅРёС‚СЊ order."""
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        obj = UserAvatar.objects.filter(user=request.user, id=pk).first()
        if not obj:
            return Response({"detail": "РќРµ РЅР°Р№РґРµРЅРѕ."}, status=status.HTTP_404_NOT_FOUND)
        obj.image.delete(save=False)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def patch(self, request, pk):
        obj = UserAvatar.objects.filter(user=request.user, id=pk).first()
        if not obj:
            return Response({"detail": "РќРµ РЅР°Р№РґРµРЅРѕ."}, status=status.HTTP_404_NOT_FOUND)
        new_order = request.data.get("order")
        if new_order is None:
            return Response({"detail": "РџРѕР»Рµ order РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            new_order = int(new_order)
        except (TypeError, ValueError):
            return Response({"detail": "order РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ С‡РёСЃР»РѕРј."}, status=status.HTTP_400_BAD_REQUEST)
        obj.order = new_order
        obj.save(update_fields=["order"])
        return Response({"id": obj.id, "order": obj.order})


class MeAvatarsReorderView(APIView):
    """POST { "order": [id1, id2, ...] } вЂ” РёР·РјРµРЅРёС‚СЊ РїРѕСЂСЏРґРѕРє."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ids = request.data.get("order")
        if not isinstance(ids, list):
            return Response({"detail": "order РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РјР°СЃСЃРёРІРѕРј id."}, status=status.HTTP_400_BAD_REQUEST)
        qs = UserAvatar.objects.filter(user=request.user)
        by_id = {a.id: a for a in qs}
        for i, id_val in enumerate(ids):
            aid = id_val if isinstance(id_val, int) else (int(id_val) if str(id_val).isdigit() else None)
            if aid and aid in by_id:
                by_id[aid].order = i
                by_id[aid].save(update_fields=["order"])
        return Response(status=status.HTTP_200_OK)


class UserSearchView(APIView):
    """Поиск пользователей по username/display_name для добавления в чат / «Написать»."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        q = (request.query_params.get("q") or "").strip().lower()
        if len(q) < 1:
            return Response({"results": []})
        if len(q) > 30:
            return Response({"results": []})
        # Ищем по username (содержит) и display_name
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
                "avatar_url": None,
            }
            if u.avatar:
                try:
                    url = u.avatar.url
                    if getattr(request, "build_absolute_uri", None):
                        try:
                            url = request.build_absolute_uri(url)
                        except Exception:
                            pass
                    data["avatar_url"] = url
                except (ValueError, OSError):
                    pass
            results.append(data)
        return Response({"results": results})



