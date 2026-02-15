from django.urls import path
from .gif_views import GifSearchView, GifTrendingView

urlpatterns = [
    path("search/", GifSearchView.as_view(), name="gif-search"),
    path("trending/", GifTrendingView.as_view(), name="gif-trending"),
]
