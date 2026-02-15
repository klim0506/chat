from django.urls import path
from .views import (
    SendCodeView,
    VerifyCodeView,
    RefreshTokenView,
    CheckUsernameView,
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

urlpatterns = [
    path("send-code/", SendCodeView.as_view(), name="send-code"),
    path("verify-code/", VerifyCodeView.as_view(), name="verify-code"),
    path("refresh/", RefreshTokenView.as_view(), name="refresh"),
    path("check-username/", CheckUsernameView.as_view(), name="check-username"),
    path("me/", MeView.as_view(), name="me"),
    path("me/avatar/", MeAvatarView.as_view(), name="me-avatar"),
    path("me/avatars/", MeAvatarsView.as_view(), name="me-avatars"),
    path("me/avatars/reorder/", MeAvatarsReorderView.as_view(), name="me-avatars-reorder"),
    path("me/avatars/<int:pk>/", MeAvatarDetailView.as_view(), name="me-avatar-detail"),
    path("users/search/", UserSearchView.as_view(), name="user-search"),
    # Session management
    path("sessions/", SessionListView.as_view(), name="sessions-list"),
    path("sessions/<uuid:pk>/", SessionTerminateView.as_view(), name="sessions-terminate"),
    path("sessions/logout-all/", SessionLogoutAllView.as_view(), name="sessions-logout-all"),
]
