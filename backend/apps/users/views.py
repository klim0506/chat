from django.conf import settings
from django.db import models
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.serializers import ValidationError as SerializerValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser

from .models import User, UserAvatar
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
    MAX_VERIFY_ATTEMPTS,
)
from .jwt_utils import make_access_token, make_refresh_token, decode_token
from .throttles import SendCodeThrottle, VerifyCodeThrottle, RefreshTokenThrottle


def _normalize_phone(phone: str) -> str:
    p = phone.replace(" ", "").replace("-", "").replace("(", "").replace(")", "").strip()
    return p if p.startswith("+") else "+" + p


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
            return Response({"detail": "Следующее SMS можно отправить через минуту."}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        if _is_debug_phone(phone):
            debug_code = getattr(settings, "AUTH_DEBUG_CODE", "")
            if not debug_code:
                return Response({"detail": "AUTH_DEBUG включён без AUTH_DEBUG_CODE."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            set_otp(phone, debug_code)
            return Response({"detail": "Режим отладки: код не отправлен.", "method": "debug"})

        code = generate_code(6)
        set_otp(phone, code)

        force_sms = ser.validated_data.get("method") == "sms" or request.query_params.get("method") == "sms"

        # 1) По умолчанию сначала Telegram Gateway; при method=sms сразу SMS
        if not force_sms:
            tg_result = send_telegram_verification(phone, code)
            if tg_result:
                return Response({"detail": "Код отправлен в Telegram.", "method": "telegram"})

        # 2) SMS: SMPP → RedSMS HTTP
        if send_sms(phone, f"Код для входа: {code}"):
            return Response({"detail": "Код отправлен по SMS.", "method": "sms"})

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

        # Реферальная ссылка
        ref_code = request.data.get("ref", "").strip()
        referrer = None
        if ref_code:
            referrer = User.objects.filter(referral_code=ref_code, is_active=True).first()
            if referrer and _normalize_phone(referrer.phone) == phone:
                referrer = None

        user, created = User.objects.get_or_create(
            phone=phone,
            defaults={
                "display_name": phone,
                "referred_by": referrer,
            },
        )
        if not user.is_active:
            return Response({"detail": "Аккаунт деактивирован."}, status=status.HTTP_403_FORBIDDEN)

        # При первой регистрации можно задать username из тела запроса
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

        # Создаём подписку + начисляем звёзды + чат «Избранное» при первой регистрации
        if created:
            from apps.payments.services import create_subscription_for_user, award_referral_stars
            from apps.chats.services import create_favorites_chat
            create_subscription_for_user(user, is_referral=bool(referrer))
            if referrer:
                award_referral_stars(inviter=referrer, invitee=user)
            create_favorites_chat(user)

        access = make_access_token(user.id)
        refresh = make_refresh_token(user.id)
        return Response({"access": access, "refresh": refresh, "user": UserSerializer(user).data})


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
        return Response({"access": make_access_token(user.id)})


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
    """Legacy: одна аватарка. Оставлен для обратной совместимости."""
    permission_classes = [IsAuthenticated]
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request):
        file_obj = request.FILES.get("avatar")
        if not file_obj:
            return Response({"detail": "Файл не передан."}, status=status.HTTP_400_BAD_REQUEST)
        if file_obj.size > 5 * 1024 * 1024:  # 5 МБ
            return Response({"detail": "Файл больше 5 МБ."}, status=status.HTTP_400_BAD_REQUEST)
        request.user.avatar = file_obj
        request.user.save(update_fields=["avatar"])
        return Response(UserSerializer(request.user, context={"request": request}).data)

    def delete(self, request):
        request.user.avatar = None
        request.user.save(update_fields=["avatar"])
        return Response(UserSerializer(request.user, context={"request": request}).data)


class MeAvatarsView(APIView):
    """Галерея аватарок (до 30). GET — список, POST — добавить."""
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
        # Legacy: если есть User.avatar, но нет в галерее — добавить первым
        if request.user.avatar and not avatars.exists():
            url = request.user.avatar.url
            if request_uri:
                url = request_uri(url)
            data.append({"id": "legacy", "url": url, "order": 0})
        return Response(data)

    def post(self, request):
        count = UserAvatar.objects.filter(user=request.user).count()
        if request.user.avatar and count == 0:
            count = 1  # учёт legacy
        if count >= MAX_AVATARS:
            return Response({"detail": f"Максимум {MAX_AVATARS} аватарок."}, status=status.HTTP_400_BAD_REQUEST)
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
        obj = UserAvatar.objects.create(user=request.user, image=file_obj, order=max_order + 1)
        url = obj.image.url
        if getattr(request, "build_absolute_uri", None):
            url = request.build_absolute_uri(url)
        return Response({"id": obj.id, "url": url, "order": obj.order}, status=status.HTTP_201_CREATED)


class MeAvatarDetailView(APIView):
    """DELETE — удалить, PATCH — изменить order."""
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        obj = UserAvatar.objects.filter(user=request.user, id=pk).first()
        if not obj:
            return Response({"detail": "Не найдено."}, status=status.HTTP_404_NOT_FOUND)
        obj.image.delete(save=False)
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
    """POST { "order": [id1, id2, ...] } — изменить порядок."""
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
    """Поиск пользователей по username для добавления в чат / «Написать»."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        q = (request.query_params.get("q") or "").strip().lower()
        if len(q) < 1:
            return Response({"results": []})
        if len(q) > 30:
            return Response({"results": []})
        queryset = (
            User.objects.filter(username__istartswith=q)
            .exclude(pk=request.user.pk)
            .exclude(username__isnull=True)
            .exclude(username="")[:20]
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
                data["avatar_url"] = request.build_absolute_uri(u.avatar.url)
            results.append(data)
        return Response({"results": results})
