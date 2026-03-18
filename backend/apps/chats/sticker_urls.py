from django.urls import path
from .sticker_views import (
    StickerPackListCreateView,
    StickerPackDetailView,
    StickerListCreateView,
    StickerDetailView,
    InstalledStickerSetsView,
    InstallStickerSetView,
    UninstallStickerSetView,
    RecentStickersView,
    SaveRecentStickerView,
)

urlpatterns = [
    path("packs/", StickerPackListCreateView.as_view(), name="sticker-packs"),
    path("packs/<uuid:pack_id>/", StickerPackDetailView.as_view(), name="sticker-pack-detail"),
    path("packs/<uuid:pack_id>/stickers/", StickerListCreateView.as_view(), name="sticker-list-create"),
    path("packs/<uuid:pack_id>/stickers/<uuid:sticker_id>/", StickerDetailView.as_view(), name="sticker-detail"),
    path("installed/", InstalledStickerSetsView.as_view(), name="sticker-installed"),
    path("install/", InstallStickerSetView.as_view(), name="sticker-install"),
    path("uninstall/", UninstallStickerSetView.as_view(), name="sticker-uninstall"),
    path("recent/", RecentStickersView.as_view(), name="sticker-recent"),
    path("save-recent/", SaveRecentStickerView.as_view(), name="sticker-save-recent"),
]
