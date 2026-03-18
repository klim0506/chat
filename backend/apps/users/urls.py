from django.urls import path
from .pairing_views import CreatePairingView, ExchangePairingView
from .views import (
    SendCodeView,
    VerifyCodeView,
    RefreshTokenView,
    LogoutView,
    CheckUsernameView,
    ResolveUsernameView,
    MeView,
    MeAvatarView,
    MeAvatarsView,
    MeAvatarDetailView,
    MeAvatarsReorderView,
    UserSearchView,
)
from .session_views import (
    SessionListView,
    SessionTerminateView,
    SessionLogoutAllView,
)
from .contact_views import ContactListCreateView, ContactDetailView
from .feedback_views import FeedbackSubmitView, SupportSubmitView

urlpatterns = [
    path("send-code/", SendCodeView.as_view(), name="send-code"),
    path("verify-code/", VerifyCodeView.as_view(), name="verify-code"),
    path("refresh/", RefreshTokenView.as_view(), name="refresh"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("pairing/create/", CreatePairingView.as_view(), name="pairing-create"),
    path("pairing/exchange/", ExchangePairingView.as_view(), name="pairing-exchange"),
    path("check-username/", CheckUsernameView.as_view(), name="check-username"),
    path("me/", MeView.as_view(), name="me"),
    path("me/avatar/", MeAvatarView.as_view(), name="me-avatar"),
    path("me/avatars/", MeAvatarsView.as_view(), name="me-avatars"),
    path("me/avatars/reorder/", MeAvatarsReorderView.as_view(), name="me-avatars-reorder"),
    path("me/avatars/<int:pk>/", MeAvatarDetailView.as_view(), name="me-avatar-detail"),
    path("users/search/", UserSearchView.as_view(), name="user-search"),
    path("users/resolve/", ResolveUsernameView.as_view(), name="user-resolve"),
    # Contacts (local display name, Telegram-style)
    path("contacts/", ContactListCreateView.as_view(), name="contacts-list-create"),
    path("contacts/<uuid:pk>/", ContactDetailView.as_view(), name="contacts-detail"),
    # Session management
    path("sessions/", SessionListView.as_view(), name="sessions-list"),
    path("sessions/<uuid:pk>/", SessionTerminateView.as_view(), name="sessions-terminate"),
    path("sessions/logout-all/", SessionLogoutAllView.as_view(), name="sessions-logout-all"),
    path("feedback/", FeedbackSubmitView.as_view(), name="feedback-submit"),
    path("support/", SupportSubmitView.as_view(), name="support-submit"),
]
