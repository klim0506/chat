from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ChatViewSet, JoinChatView, JoinChatPreviewView, ChatMemberViewSet, CreateOrGetDMView
from .message_views import MessageListCreateView, MessageDetailView, MessageReactionView, MessagePinView, ForwardMessageView, MessageSearchView, GlobalMessageSearchView
from .scheduled_views import ScheduledMessageListCreateView, ScheduledMessageDetailView

router = DefaultRouter()
router.register(r"", ChatViewSet, basename="chat")

urlpatterns = [
    path("join/preview/", JoinChatPreviewView.as_view(), name="chat-join-preview"),
    path("join/", JoinChatView.as_view(), name="chat-join"),
    path("dm/", CreateOrGetDMView.as_view(), name="chat-dm"),
    path("search/", GlobalMessageSearchView.as_view(), name="global-message-search"),
    path("", include(router.urls)),
    path("<uuid:chat_id>/members/", ChatMemberViewSet.as_view({"get": "list"}), name="chat-members"),
    path("<uuid:chat_id>/members/invite/", ChatMemberViewSet.as_view({"post": "invite"}), name="chat-members-invite"),
    path("<uuid:chat_id>/members/approve/", ChatMemberViewSet.as_view({"post": "approve"}), name="chat-members-approve"),
    path("<uuid:chat_id>/members/reject/", ChatMemberViewSet.as_view({"post": "reject"}), name="chat-members-reject"),
    path("<uuid:chat_id>/members/kick/", ChatMemberViewSet.as_view({"post": "kick"}), name="chat-members-kick"),
    path("<uuid:chat_id>/messages/", MessageListCreateView.as_view(), name="chat-messages"),
    path("<uuid:chat_id>/messages/<uuid:message_id>/", MessageDetailView.as_view(), name="chat-message-detail"),
    path("<uuid:chat_id>/messages/<uuid:message_id>/reactions/", MessageReactionView.as_view(), name="chat-message-reactions"),
    path("<uuid:chat_id>/messages/<uuid:message_id>/pin/", MessagePinView.as_view(), name="chat-message-pin"),
    path("<uuid:chat_id>/messages/search/", MessageSearchView.as_view(), name="chat-message-search"),
    path("<uuid:chat_id>/messages/forward/", ForwardMessageView.as_view(), name="chat-message-forward"),
    path("<uuid:chat_id>/scheduled/", ScheduledMessageListCreateView.as_view(), name="chat-scheduled-list-create"),
    path("<uuid:chat_id>/scheduled/<uuid:scheduled_id>/", ScheduledMessageDetailView.as_view(), name="chat-scheduled-detail"),
]
