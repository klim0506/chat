from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.views import View
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import TrackingLink, TrackingLinkClick


def _get_client_ip(request) -> str | None:
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def _is_staff(request) -> bool:
    return request.user.is_authenticated and request.user.is_staff


class TrackingRedirectView(View):
    """Redirect /t/<slug> to target_url and log the click. AllowAny."""

    def get(self, request, slug):
        link = get_object_or_404(TrackingLink, slug=slug)
        ua = request.META.get("HTTP_USER_AGENT", "")
        user = request.user if request.user.is_authenticated else None

        TrackingLinkClick.objects.create(
            link=link,
            ip_address=_get_client_ip(request),
            user_agent=ua,
            user=user,
        )
        return HttpResponseRedirect(link.target_url, status=302)


class AdminStatsView(APIView):
    """GET /api/admin/stats/ — метрики нагрузки. Только is_staff."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _is_staff(request):
            return Response({"detail": "Нет прав."}, status=status.HTTP_403_FORBIDDEN)

        from django.db.models import Count
        from django.db.models.functions import TruncDate
        from django.utils import timezone

        from apps.payments.models import PaymentLog
        from apps.users.models import User, UserSession

        today = timezone.now().date()

        users_logged_in_today = (
            UserSession.objects.filter(created_at__date=today)
            .values("user")
            .distinct()
            .count()
        )

        total_users = (
            User.objects.filter(username__isnull=False).exclude(username="").count()
        )

        platform_qs = UserSession.objects.values("client_type").annotate(
            count=Count("id")
        )
        platform_distribution = {
            row["client_type"] or "web": row["count"] for row in platform_qs
        }
        for key in ("web", "android", "desktop"):
            if key not in platform_distribution:
                platform_distribution[key] = 0

        auth_timeline = (
            UserSession.objects.filter(
                created_at__date__gte=timezone.now().date() - timezone.timedelta(days=30)
            )
            .annotate(date=TruncDate("created_at"))
            .values("date")
            .annotate(count=Count("id"))
            .order_by("date")
        )
        auth_timeline = [
            {"date": str(row["date"]), "count": row["count"]} for row in auth_timeline
        ]

        paid_subscriptions_today = PaymentLog.objects.filter(
            status=PaymentLog.Status.SUCCEEDED, created_at__date=today
        ).count()

        new_users_today = User.objects.filter(date_joined__date=today).count()

        return Response(
            {
                "users_logged_in_today": users_logged_in_today,
                "total_users": total_users,
                "platform_distribution": platform_distribution,
                "auth_timeline": auth_timeline,
                "paid_subscriptions_today": paid_subscriptions_today,
                "new_users_today": new_users_today,
            }
        )


class TrackingLinkListCreateView(APIView):
    """GET/POST /api/admin/tracking-links/. Только is_staff."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _is_staff(request):
            return Response({"detail": "Нет прав."}, status=status.HTTP_403_FORBIDDEN)
        links = TrackingLink.objects.all().order_by("-created_at")
        base = request.build_absolute_uri("/").rstrip("/")
        data = []
        for link in links:
            full_url = f"{base}/t/{link.slug}/"
            data.append(
                {
                    "id": str(link.id),
                    "tag": link.tag,
                    "slug": link.slug,
                    "target_url": link.target_url,
                    "full_url": full_url,
                    "clicks_count": link.clicks.count(),
                    "created_at": link.created_at.isoformat(),
                }
            )
        return Response(data)

    def post(self, request):
        if not _is_staff(request):
            return Response({"detail": "Нет прав."}, status=status.HTTP_403_FORBIDDEN)
        tag = (request.data.get("tag") or "").strip()
        slug = (request.data.get("slug") or "").strip()
        target_url = (request.data.get("target_url") or "").strip()

        if not tag:
            return Response(
                {"detail": "tag обязателен."}, status=status.HTTP_400_BAD_REQUEST
            )
        if not target_url:
            return Response(
                {"detail": "target_url обязателен."}, status=status.HTTP_400_BAD_REQUEST
            )
        if target_url and not (
            target_url.startswith("http://") or target_url.startswith("https://")
        ):
            return Response(
                {"detail": "target_url должен начинаться с http:// или https://."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if slug:
            if not all(c.isalnum() or c in "-_" for c in slug):
                return Response(
                    {"detail": "slug может содержать только буквы, цифры, дефис и подчёркивание."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if TrackingLink.objects.filter(slug=slug).exists():
                return Response(
                    {"detail": "Ссылка с таким slug уже существует."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            slug = None

        link = TrackingLink.objects.create(
            tag=tag,
            slug=slug or "",
            target_url=target_url,
            created_by=request.user,
        )
        base = request.build_absolute_uri("/").rstrip("/")
        full_url = f"{base}/t/{link.slug}/"
        return Response(
            {
                "id": str(link.id),
                "tag": link.tag,
                "slug": link.slug,
                "target_url": link.target_url,
                "full_url": full_url,
                "clicks_count": 0,
                "created_at": link.created_at.isoformat(),
            },
            status=status.HTTP_201_CREATED,
        )


class TrackingLinkDetailView(APIView):
    """GET/PATCH/DELETE /api/admin/tracking-links/<id>/. Только is_staff."""

    permission_classes = [IsAuthenticated]

    def _get_link(self, pk):
        return get_object_or_404(TrackingLink, pk=pk)

    def get(self, request, pk):
        if not _is_staff(request):
            return Response({"detail": "Нет прав."}, status=status.HTTP_403_FORBIDDEN)
        link = self._get_link(pk)
        base = request.build_absolute_uri("/").rstrip("/")
        full_url = f"{base}/t/{link.slug}/"
        return Response(
            {
                "id": str(link.id),
                "tag": link.tag,
                "slug": link.slug,
                "target_url": link.target_url,
                "full_url": full_url,
                "clicks_count": link.clicks.count(),
                "created_at": link.created_at.isoformat(),
            }
        )

    def patch(self, request, pk):
        if not _is_staff(request):
            return Response({"detail": "Нет прав."}, status=status.HTTP_403_FORBIDDEN)
        link = self._get_link(pk)
        tag = request.data.get("tag")
        target_url = request.data.get("target_url")
        if tag is not None:
            tag = str(tag).strip()
            if not tag:
                return Response(
                    {"detail": "tag не может быть пустым."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            link.tag = tag
        if target_url is not None:
            target_url = str(target_url).strip()
            if not target_url:
                return Response(
                    {"detail": "target_url не может быть пустым."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not (
                target_url.startswith("http://") or target_url.startswith("https://")
            ):
                return Response(
                    {"detail": "target_url должен начинаться с http:// или https://."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            link.target_url = target_url
        link.save()
        base = request.build_absolute_uri("/").rstrip("/")
        full_url = f"{base}/t/{link.slug}/"
        return Response(
            {
                "id": str(link.id),
                "tag": link.tag,
                "slug": link.slug,
                "target_url": link.target_url,
                "full_url": full_url,
                "clicks_count": link.clicks.count(),
                "created_at": link.created_at.isoformat(),
            }
        )

    def delete(self, request, pk):
        if not _is_staff(request):
            return Response({"detail": "Нет прав."}, status=status.HTTP_403_FORBIDDEN)
        link = self._get_link(pk)
        link.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class TrackingLinkClicksView(APIView):
    """GET /api/admin/tracking-links/<id>/clicks/. Только is_staff."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        if not _is_staff(request):
            return Response({"detail": "Нет прав."}, status=status.HTTP_403_FORBIDDEN)
        link = get_object_or_404(TrackingLink, pk=pk)
        limit = min(int(request.query_params.get("limit", 100)), 500)
        clicks = link.clicks.select_related("user").order_by("-created_at")[:limit]

        def mask_ip(ip):
            if not ip:
                return None
            parts = ip.split(".")
            if len(parts) == 4:
                return f"{parts[0]}.***.***.{parts[3]}"
            return "***"

        def shorten_ua(ua):
            if not ua or len(ua) <= 60:
                return ua or ""
            return ua[:60] + "…"

        data = [
            {
                "id": str(c.id),
                "created_at": c.created_at.isoformat(),
                "ip_masked": mask_ip(c.ip_address),
                "user_agent_short": shorten_ua(c.user_agent),
                "user_id": str(c.user_id) if c.user_id else None,
            }
            for c in clicks
        ]
        return Response({"clicks": data, "total": link.clicks.count()})


class AdminFeedbackListView(APIView):
    """GET /api/admin/feedback/ — list user feedback and support requests. Staff only."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _is_staff(request):
            return Response({"detail": "Нет прав."}, status=status.HTTP_403_FORBIDDEN)
        from apps.files.protected_media import make_protected_media_url
        from apps.users.models import UserFeedback

        limit = min(int(request.query_params.get("limit", 100)), 500)
        type_filter = request.query_params.get("type", "")
        qs = UserFeedback.objects.select_related("user").prefetch_related("attachments").order_by("-created_at")
        if type_filter in ("feedback", "support"):
            qs = qs.filter(type=type_filter)
        qs = qs[:limit]
        data = []
        for f in qs:
            attachment_urls = []
            for att in f.attachments.all():
                url = make_protected_media_url(att.image.name, request)
                if url:
                    attachment_urls.append(url)
            data.append({
                "id": str(f.id),
                "type": f.type,
                "message": f.message,
                "user_id": str(f.user_id),
                "user_phone": f.user.phone,
                "user_display_name": f.user.display_name or "",
                "created_at": f.created_at.isoformat(),
                "attachment_urls": attachment_urls,
            })
        return Response(data)
