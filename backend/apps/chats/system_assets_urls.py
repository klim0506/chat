from django.urls import path
from . import system_assets_views

urlpatterns = [
    path("emojis/", system_assets_views.SystemEmojiListView.as_view()),
    path("emojis/<uuid:emoji_id>/", system_assets_views.SystemEmojiDetailView.as_view()),
    path("stickers/", system_assets_views.SystemStickerListView.as_view()),
    path("stickers/<uuid:sticker_id>/", system_assets_views.SystemStickerDetailView.as_view()),
]
