from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.shortcuts import get_object_or_404

from .models import Chat, ChatMember, ScheduledMessage
from .serializers import ScheduledMessageSerializer
from .message_views import _check_chat_member


class ScheduledMessageListCreateView(APIView):
    """GET: список отложенных сообщений текущего пользователя в чате. POST: создать."""
    def get(self, request, chat_id):
        chat, err = _check_chat_member(request, chat_id)
        if err is not None:
            return err
        qs = ScheduledMessage.objects.filter(chat=chat, user=request.user).order_by("scheduled_at")
        return Response(ScheduledMessageSerializer(qs, many=True).data)

    def post(self, request, chat_id):
        chat, err = _check_chat_member(request, chat_id)
        if err is not None:
            return err
        ser = ScheduledMessageSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ser.save(chat=chat, user=request.user)
        return Response(ser.data, status=status.HTTP_201_CREATED)


class ScheduledMessageDetailView(APIView):
    """DELETE: отменить отложенное сообщение."""
    def delete(self, request, chat_id, scheduled_id):
        chat, err = _check_chat_member(request, chat_id)
        if err is not None:
            return err
        obj = get_object_or_404(ScheduledMessage, id=scheduled_id, chat=chat, user=request.user)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
