"""Views for user feedback and technical support."""
import os

from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import UserFeedback, UserFeedbackAttachment

MAX_ATTACHMENTS = 5
MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024  # 5 MB


def _is_image_file(f):
    """Check if uploaded file is an image (by content_type or extension)."""
    ct = (getattr(f, "content_type") or "").lower()
    if ct.startswith("image/"):
        return True
    ext = os.path.splitext(getattr(f, "name", "") or "")[1].lower()
    return ext in (".jpg", ".jpeg", ".png", ".webp", ".gif")


def _parse_and_validate_feedback(request):
    """Parse message and image files from request. Returns (message, files, error)."""
    message = (request.data.get("message") or "").strip()
    if not message:
        return None, None, "Сообщение обязательно."
    if len(message) > 2000:
        return None, None, "Сообщение слишком длинное."

    files = request.FILES.getlist("images") or []
    if len(files) > MAX_ATTACHMENTS:
        return None, None, f"Максимум {MAX_ATTACHMENTS} фото."
    valid_files = []
    for f in files:
        if f.size > MAX_ATTACHMENT_SIZE:
            return None, None, "Размер каждого фото — до 5 МБ."
        if not _is_image_file(f):
            return None, None, "Разрешены только изображения (JPG, PNG, WebP, GIF)."
        valid_files.append(f)
    return message, valid_files, None


class FeedbackSubmitView(APIView):
    """POST /api/auth/feedback/ — submit feedback (feature requests, improvements)."""
    parser_classes = (MultiPartParser, FormParser)
    permission_classes = [IsAuthenticated]

    def post(self, request):
        message, files, err = _parse_and_validate_feedback(request)
        if err:
            return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)
        feedback = UserFeedback.objects.create(
            user=request.user,
            type=UserFeedback.Type.FEEDBACK,
            message=message,
        )
        for f in files:
            UserFeedbackAttachment.objects.create(feedback=feedback, image=f)
        return Response({"status": "ok"}, status=status.HTTP_201_CREATED)


class SupportSubmitView(APIView):
    """POST /api/auth/support/ — submit technical support request (emergency)."""
    parser_classes = (MultiPartParser, FormParser)
    permission_classes = [IsAuthenticated]

    def post(self, request):
        message, files, err = _parse_and_validate_feedback(request)
        if err:
            return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)
        topic = (request.data.get("topic") or "").strip()
        if topic == "reserved_username":
            message = "[Запрос reserved username для канала]\n\n" + message
        elif topic == "bug":
            message = "[Сообщение о баге]\n\n" + message
        feedback = UserFeedback.objects.create(
            user=request.user,
            type=UserFeedback.Type.SUPPORT,
            message=message,
        )
        for f in files:
            UserFeedbackAttachment.objects.create(feedback=feedback, image=f)
        return Response({"status": "ok"}, status=status.HTTP_201_CREATED)
