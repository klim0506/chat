from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .channel_views import (
    ChannelViewSet,
    ResolveChannelUsernameView,
    PublicChannelSearchView,
    JoinChannelPreviewView,
    JoinChannelView,
    ChannelImportTelegramView,
    ChannelPostListCreateView,
    ChannelPostDetailView,
    ChannelPostReactionView,
    ChannelPostCommentListCreateView,
    ChannelPostCommentDetailView,
    ChannelMemberApproveRejectView,
    ChannelMemberKickView,
)

router = DefaultRouter()
router.register(r"", ChannelViewSet, basename="channel")

urlpatterns = [
    path("resolve/", ResolveChannelUsernameView.as_view(), name="channel-resolve"),
    path("search/", PublicChannelSearchView.as_view(), name="channel-search-public"),
    path("join/preview/", JoinChannelPreviewView.as_view(), name="channel-join-preview"),
    path("join/", JoinChannelView.as_view(), name="channel-join"),
    path("", include(router.urls)),
    path("<uuid:channel_id>/members/approve-reject/", ChannelMemberApproveRejectView.as_view(), name="channel-members-approve-reject"),
    path("<uuid:channel_id>/members/kick/", ChannelMemberKickView.as_view(), name="channel-members-kick"),
    path("<uuid:channel_id>/import-telegram/", ChannelImportTelegramView.as_view(), name="channel-import-telegram"),
    path("<uuid:channel_id>/posts/", ChannelPostListCreateView.as_view(), name="channel-posts"),
    path("<uuid:channel_id>/posts/<uuid:post_id>/", ChannelPostDetailView.as_view(), name="channel-post-detail"),
    path("<uuid:channel_id>/posts/<uuid:post_id>/reactions/", ChannelPostReactionView.as_view(), name="channel-post-reactions"),
    path("<uuid:channel_id>/posts/<uuid:post_id>/comments/", ChannelPostCommentListCreateView.as_view(), name="channel-post-comments"),
    path("<uuid:channel_id>/posts/<uuid:post_id>/comments/<uuid:comment_id>/", ChannelPostCommentDetailView.as_view(), name="channel-post-comment-detail"),
]
