"""
Session management API views.

GET    /api/auth/sessions/                — list active sessions
DELETE /api/auth/sessions/<uuid:pk>/      — terminate a specific session
POST   /api/auth/sessions/logout-all/     — terminate all sessions except current
"""
import logging

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import UserSession

logger = logging.getLogger(__name__)


def _send_force_logout(user_id: str, terminated_session_ids: list[str]):
    """Send force_logout event via WebSocket to the user's notification group."""
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync

        channel_layer = get_channel_layer()
        if channel_layer is None:
            return
        async_to_sync(channel_layer.group_send)(
            f"user_{user_id}",
            {
                "type": "force.logout",
                "terminated_session_ids": terminated_session_ids,
            },
        )
    except Exception:
        logger.exception("Failed to send force_logout via WebSocket")


class SessionListView(APIView):
    """GET — list active sessions for the current user."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        current_sid = getattr(request, "session_id", None)
        sessions = UserSession.objects.filter(user=request.user, is_active=True)
        data = []
        for s in sessions:
            data.append({
                "id": str(s.id),
                "device_label": s.device_label,
                "ip_address": s.ip_address,
                "created_at": s.created_at.isoformat(),
                "last_active": s.last_active.isoformat(),
                "is_current": str(s.id) == str(current_sid) if current_sid else False,
            })
        return Response(data)


class SessionTerminateView(APIView):
    """DELETE — terminate a specific session by UUID."""
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        current_sid = getattr(request, "session_id", None)
        if str(pk) == str(current_sid):
            return Response(
                {"detail": "Нельзя завершить текущую сессию."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        session = UserSession.objects.filter(
            id=pk, user=request.user, is_active=True
        ).first()
        if not session:
            return Response(
                {"detail": "Сессия не найдена."},
                status=status.HTTP_404_NOT_FOUND,
            )
        session.is_active = False
        session.save(update_fields=["is_active"])
        _send_force_logout(str(request.user.id), [str(session.id)])
        return Response(status=status.HTTP_204_NO_CONTENT)


class SessionLogoutAllView(APIView):
    """POST — terminate all sessions except the current one."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        current_sid = getattr(request, "session_id", None)
        qs = UserSession.objects.filter(user=request.user, is_active=True)
        if current_sid:
            qs = qs.exclude(id=current_sid)
        terminated_ids = list(qs.values_list("id", flat=True))
        qs.update(is_active=False)
        if terminated_ids:
            _send_force_logout(
                str(request.user.id),
                [str(sid) for sid in terminated_ids],
            )
        return Response({"terminated": len(terminated_ids)})
