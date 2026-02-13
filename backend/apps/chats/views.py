import logging
from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView
from django.shortcuts import get_object_or_404
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .models import Chat, ChatMember, DEFAULT_MAX_MEMBERS
from .serializers import ChatSerializer, ChatCreateSerializer, ChatMemberSerializer, JoinChatSerializer
from .utils import verify_invite_code, generate_slug, make_verification_code
from apps.payments.permissions import HasActiveSubscription
from apps.users.models import User

logger = logging.getLogger(__name__)


def _broadcast_mark_read(chat_id, user_id, last_read_at):
    """Уведомить участников чата, что пользователь прочитал чат (для галочек «прочитано»)."""
    try:
        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)(
                f"chat_{chat_id}",
                {
                    "type": "chat.mark_read.broadcast",
                    "user_id": str(user_id),
                    "last_read_at": last_read_at.isoformat() if hasattr(last_read_at, "isoformat") else last_read_at,
                },
            )
    except Exception:
        pass


class ChatViewSet(viewsets.ModelViewSet):
    serializer_class = ChatSerializer
    permission_classes = [HasActiveSubscription]

    def get_queryset(self):
        return Chat.objects.filter(is_active=True, members__user=self.request.user, members__status=ChatMember.Status.ACTIVE).distinct().select_related("owner").prefetch_related("members__user")

    @action(detail=True, methods=["post"], url_path="mark-read")
    def mark_read(self, request, pk=None):
        """Отметить чат как прочитанный."""
        chat = self.get_object()
        membership = ChatMember.objects.filter(
            chat=chat, user=request.user, status=ChatMember.Status.ACTIVE
        ).first()
        if not membership:
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        membership.last_read_at = timezone.now()
        membership.save(update_fields=["last_read_at"])
        _broadcast_mark_read(chat.id, request.user.id, membership.last_read_at)
        return Response({"last_read_at": membership.last_read_at})

    @action(detail=True, methods=["post"], url_path="mark-unread")
    def mark_unread(self, request, pk=None):
        """Пометить чат как непрочитанный (сброс last_read_at)."""
        chat = self.get_object()
        membership = ChatMember.objects.filter(
            chat=chat, user=request.user, status=ChatMember.Status.ACTIVE
        ).first()
        if not membership:
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        membership.last_read_at = None
        membership.save(update_fields=["last_read_at"])
        _broadcast_mark_read(chat.id, request.user.id, None)
        return Response({"last_read_at": None})

    @action(detail=True, methods=["post"], url_path="toggle-mute")
    def toggle_mute(self, request, pk=None):
        """Переключить беззвучный режим."""
        chat = self.get_object()
        membership = ChatMember.objects.filter(
            chat=chat, user=request.user, status=ChatMember.Status.ACTIVE
        ).first()
        if not membership:
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        membership.is_muted = not membership.is_muted
        membership.save(update_fields=["is_muted"])
        return Response({"is_muted": membership.is_muted})

    @action(detail=True, methods=["post"], url_path="leave")
    def leave(self, request, pk=None):
        """Выйти из чата. Админ должен предварительно назначить другого администратора."""
        chat = self.get_object()
        membership = ChatMember.objects.filter(
            chat=chat, user=request.user, status=ChatMember.Status.ACTIVE
        ).first()
        if not membership:
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        if getattr(chat, "is_favorites", False):
            return Response({"detail": "Из чата «Избранное» выйти нельзя."}, status=status.HTTP_400_BAD_REQUEST)
        # Личный чат: участник может выйти (удалить себя из чата). Группа: админ должен назначить другого.
        if not getattr(chat, "is_personal", False):
            admins_count = chat.members.filter(
                status=ChatMember.Status.ACTIVE, role=ChatMember.Role.ADMIN
            ).count()
            if membership.role == ChatMember.Role.ADMIN and admins_count <= 1:
                return Response(
                    {"detail": "Назначьте другого администратора перед выходом из чата."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        membership.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def get_serializer_class(self):
        if self.action == "create":
            return ChatCreateSerializer
        return ChatSerializer

    def create(self, request, *args, **kwargs):
        ser = ChatCreateSerializer(data=request.data, context={"request": request})
        ser.is_valid(raise_exception=True)
        for attempt in (1, 2):
            try:
                chat = ser.save()
                return Response(ChatSerializer(chat, context={"request": request}).data, status=status.HTTP_201_CREATED)
            except IntegrityError as e:
                logger.warning("Chat create IntegrityError (attempt %s): %s", attempt, e, exc_info=True)
                if attempt == 2:
                    return Response(
                        {"detail": "Не удалось создать чат. Попробуйте ещё раз."},
                        status=status.HTTP_409_CONFLICT,
                    )
                ser = ChatCreateSerializer(data=request.data, context={"request": request})
                ser.is_valid(raise_exception=True)
            except Exception as e:
                logger.exception("Chat create unexpected error: %s", e)
                return Response(
                    {"detail": "Серверная ошибка. Попробуйте позже."},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

    def partial_update(self, request, *args, **kwargs):
        chat = self.get_object()
        if chat.owner_id != request.user.id:
            return Response({"detail": "Только владелец может редактировать чат."}, status=status.HTTP_403_FORBIDDEN)
        allowed = {"title", "description"}
        update_data = {k: v for k, v in request.data.items() if k in allowed}
        for field, value in update_data.items():
            setattr(chat, field, value)
        if update_data:
            chat.save(update_fields=list(update_data.keys()))
        return Response(ChatSerializer(chat, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="avatar",
            parser_classes=[MultiPartParser, FormParser, JSONParser])
    def upload_avatar(self, request, pk=None):
        """Загрузить или удалить аватарку чата."""
        chat = self.get_object()
        if chat.owner_id != request.user.id:
            return Response({"detail": "Только владелец может менять аватарку."}, status=status.HTTP_403_FORBIDDEN)
        avatar_file = request.FILES.get("avatar")
        if avatar_file:
            # Удалим старую аватарку
            if chat.avatar:
                chat.avatar.delete(save=False)
            chat.avatar = avatar_file
            chat.save(update_fields=["avatar"])
        elif request.data.get("remove") == "true":
            if chat.avatar:
                chat.avatar.delete(save=False)
                chat.avatar = None
                chat.save(update_fields=["avatar"])
        else:
            return Response({"detail": "Файл avatar не найден."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(ChatSerializer(chat, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="background",
            parser_classes=[MultiPartParser, FormParser, JSONParser])
    def upload_background(self, request, pk=None):
        """Загрузить или удалить фоновое изображение чата."""
        chat = self.get_object()
        if chat.owner_id != request.user.id:
            return Response({"detail": "Только владелец может менять фон чата."}, status=status.HTTP_403_FORBIDDEN)
        bg_file = request.FILES.get("background")
        if bg_file:
            if chat.background:
                chat.background.delete(save=False)
            chat.background = bg_file
            chat.save(update_fields=["background"])
        elif request.data.get("remove") == "true":
            if chat.background:
                chat.background.delete(save=False)
                chat.background = None
                chat.save(update_fields=["background"])
        else:
            return Response({"detail": "Файл background не найден."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(ChatSerializer(chat, context={"request": request}).data)

    def destroy(self, request, *args, **kwargs):
        chat = self.get_object()
        if chat.owner_id != request.user.id:
            return Response({"detail": "Только владелец может удалить чат."}, status=status.HTTP_403_FORBIDDEN)
        chat.is_active = False
        chat.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CreateOrGetDMView(APIView):
    """Получить или создать личный чат с пользователем. POST { \"user_id\": \"uuid\" }."""
    permission_classes = [HasActiveSubscription]

    def post(self, request):
        user_id = request.data.get("user_id")
        if not user_id:
            return Response({"detail": "user_id обязателен."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            target_user = User.objects.get(pk=user_id)
        except (User.DoesNotExist, ValueError, TypeError):
            return Response({"detail": "Пользователь не найден."}, status=status.HTTP_400_BAD_REQUEST)
        if target_user.pk == request.user.pk:
            return Response({"detail": "Нельзя написать самому себе."}, status=status.HTTP_400_BAD_REQUEST)

        def find_existing_dm():
            # Без двойного filter(members__user=...) — иначе JOIN дублирует строки и Count даёт не 2, а 4
            my_chat_ids = ChatMember.objects.filter(
                user=request.user, status=ChatMember.Status.ACTIVE
            ).values_list("chat_id", flat=True)
            their_chat_ids = ChatMember.objects.filter(
                user=target_user, status=ChatMember.Status.ACTIVE
            ).values_list("chat_id", flat=True)
            return (
                Chat.objects.filter(
                    is_active=True,
                    is_personal=True,
                    id__in=my_chat_ids,
                )
                .filter(id__in=their_chat_ids)
                .annotate(active_count=Count("members", filter=Q(members__status=ChatMember.Status.ACTIVE)))
                .filter(active_count=2)
                .order_by("created_at")
                .first()
            )

        with transaction.atomic():
            existing = find_existing_dm()
            if existing:
                return Response(ChatSerializer(existing, context={"request": request}).data)

            # Создать новый личный чат (без типа, без ссылки-приглашения)
            slug = generate_slug()
            while Chat.objects.filter(slug=slug).exists():
                slug = generate_slug()
            chat = Chat.objects.create(
                title="Личный чат",
                description="",
                slug=slug,
                verification_code=make_verification_code(slug),
                chat_type=None,
                is_personal=True,
                max_members=DEFAULT_MAX_MEMBERS,
                owner=request.user,
                is_active=True,
            )
            ChatMember.objects.create(
                chat=chat,
                user=request.user,
                role=ChatMember.Role.ADMIN,
                status=ChatMember.Status.ACTIVE,
            )
            ChatMember.objects.create(
                chat=chat,
                user=target_user,
                role=ChatMember.Role.MEMBER,
                status=ChatMember.Status.ACTIVE,
            )
            # Повторная проверка на случай гонки: другой запрос мог уже создать чат
            existing = find_existing_dm()
            if existing and existing.id != chat.id:
                return Response(ChatSerializer(existing, context={"request": request}).data)
        return Response(ChatSerializer(chat, context={"request": request}).data, status=status.HTTP_201_CREATED)


class JoinChatView(APIView):
    permission_classes = [HasActiveSubscription]

    def post(self, request):
        ser = JoinChatSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        slug, code = ser.validated_data["slug"], ser.validated_data["code"]
        if not verify_invite_code(slug, code):
            return Response({"detail": "Неверная ссылка или код."}, status=status.HTTP_400_BAD_REQUEST)
        chat = get_object_or_404(Chat, slug=slug, is_active=True)
        if getattr(chat, "is_personal", False) or getattr(chat, "is_favorites", False):
            return Response({"detail": "Неверная ссылка или код."}, status=status.HTTP_400_BAD_REQUEST)
        membership = ChatMember.objects.filter(chat=chat, user=request.user).first()
        if membership:
            if membership.status == ChatMember.Status.ACTIVE:
                data = ChatSerializer(chat, context={"request": request}).data
                data["already_member"] = True
                return Response(data)
            if membership.status == ChatMember.Status.KICKED:
                return Response({"detail": "Вы были исключены из чата."}, status=status.HTTP_403_FORBIDDEN)
            if membership.status == ChatMember.Status.PENDING:
                return Response({"detail": "Запрос уже отправлен. Ожидайте подтверждения."})
        if chat.members.filter(status=ChatMember.Status.ACTIVE).count() >= chat.effective_max_members:
            return Response({"detail": "Чат заполнен."}, status=status.HTTP_400_BAD_REQUEST)
        if chat.chat_type and chat.chat_type == Chat.ChatType.OPEN:
            ChatMember.objects.get_or_create(chat=chat, user=request.user, defaults={"role": ChatMember.Role.MEMBER, "status": ChatMember.Status.ACTIVE})
            chat.refresh_from_db()
            return Response(ChatSerializer(chat, context={"request": request}).data, status=status.HTTP_201_CREATED)
        ChatMember.objects.get_or_create(chat=chat, user=request.user, defaults={"role": ChatMember.Role.MEMBER, "status": ChatMember.Status.PENDING})
        return Response({"detail": "Запрос на вступление отправлен. Ожидайте подтверждения от владельца."}, status=status.HTTP_202_ACCEPTED)


class ChatMemberViewSet(viewsets.ViewSet):
    def list(self, request, chat_id=None):
        chat_id = chat_id or request.resolver_match.kwargs.get("chat_id")
        chat = get_object_or_404(Chat, id=chat_id)
        if not chat.members.filter(user=request.user, status=ChatMember.Status.ACTIVE).exists():
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        ser = ChatMemberSerializer(chat.members.select_related("user").all(), many=True)
        return Response(ser.data)

    @action(detail=False, methods=["post"], url_path="approve")
    def approve(self, request, chat_id=None):
        chat_id = chat_id or request.resolver_match.kwargs.get("chat_id")
        chat = get_object_or_404(Chat, id=chat_id)
        if chat.owner_id != request.user.id:
            return Response({"detail": "Только владелец может подтверждать."}, status=status.HTTP_403_FORBIDDEN)
        member_id = request.data.get("member_id")
        if not member_id:
            return Response({"detail": "member_id обязателен."}, status=status.HTTP_400_BAD_REQUEST)
        member = get_object_or_404(ChatMember, id=member_id, chat=chat, status=ChatMember.Status.PENDING)
        if chat.members.filter(status=ChatMember.Status.ACTIVE).count() >= chat.effective_max_members:
            return Response({"detail": "Чат заполнен."}, status=status.HTTP_400_BAD_REQUEST)
        member.status = ChatMember.Status.ACTIVE
        member.save()
        return Response(ChatMemberSerializer(member).data)

    @action(detail=False, methods=["post"], url_path="reject")
    def reject(self, request, chat_id=None):
        chat_id = chat_id or request.resolver_match.kwargs.get("chat_id")
        chat = get_object_or_404(Chat, id=chat_id)
        if chat.owner_id != request.user.id:
            return Response({"detail": "Только владелец может отклонять."}, status=status.HTTP_403_FORBIDDEN)
        member_id = request.data.get("member_id")
        if not member_id:
            return Response({"detail": "member_id обязателен."}, status=status.HTTP_400_BAD_REQUEST)
        member = get_object_or_404(ChatMember, id=member_id, chat=chat, status=ChatMember.Status.PENDING)
        member.status = ChatMember.Status.KICKED
        member.save()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["post"], url_path="kick")
    def kick(self, request, chat_id=None):
        chat_id = chat_id or request.resolver_match.kwargs.get("chat_id")
        chat = get_object_or_404(Chat, id=chat_id)
        if chat.owner_id != request.user.id and not chat.members.filter(user=request.user, role=ChatMember.Role.ADMIN, status=ChatMember.Status.ACTIVE).exists():
            return Response({"detail": "Нет прав."}, status=status.HTTP_403_FORBIDDEN)
        member_id = request.data.get("member_id")
        if not member_id:
            return Response({"detail": "member_id обязателен."}, status=status.HTTP_400_BAD_REQUEST)
        member = get_object_or_404(ChatMember, id=member_id, chat=chat, status=ChatMember.Status.ACTIVE)
        if member.user_id == chat.owner_id:
            return Response({"detail": "Нельзя исключить владельца."}, status=status.HTTP_400_BAD_REQUEST)
        member.status = ChatMember.Status.KICKED
        member.save()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["post"], url_path="set-admin")
    def set_admin(self, request, chat_id=None):
        """Назначить участника администратором. Только текущий админ или владелец чата."""
        chat_id = chat_id or request.resolver_match.kwargs.get("chat_id")
        chat = get_object_or_404(Chat, id=chat_id)
        my_membership = ChatMember.objects.filter(
            chat=chat, user=request.user, status=ChatMember.Status.ACTIVE
        ).first()
        if not my_membership:
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        if my_membership.role != ChatMember.Role.ADMIN and chat.owner_id != request.user.id:
            return Response({"detail": "Только администратор или владелец может назначать админа."}, status=status.HTTP_403_FORBIDDEN)
        member_id = request.data.get("member_id")
        if not member_id:
            return Response({"detail": "member_id обязателен."}, status=status.HTTP_400_BAD_REQUEST)
        member = get_object_or_404(ChatMember, id=member_id, chat=chat, status=ChatMember.Status.ACTIVE)
        member.role = ChatMember.Role.ADMIN
        member.save(update_fields=["role"])
        return Response(ChatMemberSerializer(chat.members.select_related("user").all(), many=True).data)
