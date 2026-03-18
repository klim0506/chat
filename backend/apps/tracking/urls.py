from django.urls import path

from .views import (
    AdminStatsView,
    AdminFeedbackListView,
    TrackingLinkListCreateView,
    TrackingLinkDetailView,
    TrackingLinkClicksView,
)

urlpatterns = [
    path("stats/", AdminStatsView.as_view(), name="admin-stats"),
    path("feedback/", AdminFeedbackListView.as_view(), name="admin-feedback"),
    path("tracking-links/", TrackingLinkListCreateView.as_view(), name="admin-tracking-links"),
    path(
        "tracking-links/<uuid:pk>/",
        TrackingLinkDetailView.as_view(),
        name="admin-tracking-link-detail",
    ),
    path(
        "tracking-links/<uuid:pk>/clicks/",
        TrackingLinkClicksView.as_view(),
        name="admin-tracking-link-clicks",
    ),
]
