"""Tenor GIF search proxy — hides API key from client."""
import logging
from urllib.parse import urlencode

import requests
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django.conf import settings

logger = logging.getLogger(__name__)

TENOR_BASE = "https://tenor.googleapis.com/v2"
CLIENT_KEY = "chats_app"


def _tenor_request(path: str, params: dict) -> dict | None:
    api_key = getattr(settings, "TENOR_API_KEY", "") or ""
    if not api_key:
        return None
    params["key"] = api_key
    params["client_key"] = CLIENT_KEY
    params.setdefault("limit", 20)
    params.setdefault("media_filter", "gif,tinygif,nanogif")
    params.setdefault("contentfilter", "low")

    url = f"{TENOR_BASE}{path}?{urlencode(params)}"
    try:
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        return r.json()
    except requests.RequestException as e:
        logger.warning("Tenor API request failed: %s", e)
        return None


def _format_result(item: dict) -> dict:
    """Extract id, url, preview_url, width, height from Tenor response object."""
    media = item.get("media_formats", {}) or {}
    gif = media.get("gif") or media.get("tinygif") or {}
    preview = media.get("nanogif") or media.get("tinygif") or gif
    return {
        "id": item.get("id", ""),
        "url": gif.get("url", ""),
        "preview_url": preview.get("url", ""),
        "width": gif.get("dims", [0, 0])[0] or preview.get("dims", [0, 0])[0],
        "height": gif.get("dims", [0, 0])[1] or preview.get("dims", [0, 0])[1],
    }


class GifSearchView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        q = (request.query_params.get("q") or "").strip()
        limit = min(50, max(1, int(request.query_params.get("limit", 20))))
        offset = request.query_params.get("pos", "")

        if not getattr(settings, "TENOR_API_KEY", ""):
            return Response(
                {"results": [], "next": ""},
                status=status.HTTP_200_OK,
            )

        if not q:
            path, params = "/featured", {"limit": limit}
            if offset:
                params["pos"] = offset
        else:
            path, params = "/search", {"q": q, "limit": limit}
            if offset:
                params["pos"] = offset

        data = _tenor_request(path, params)
        if not data:
            return Response(
                {"results": [], "next": ""},
                status=status.HTTP_200_OK,
            )

        results = [_format_result(r) for r in data.get("results", [])]
        return Response({
            "results": results,
            "next": data.get("next", ""),
        })


class GifTrendingView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        limit = min(50, max(1, int(request.query_params.get("limit", 20))))

        if not getattr(settings, "TENOR_API_KEY", ""):
            return Response(
                {"results": [], "next": ""},
                status=status.HTTP_200_OK,
            )

        data = _tenor_request("/featured", {"limit": limit})
        if not data:
            return Response(
                {"results": [], "next": ""},
                status=status.HTTP_200_OK,
            )

        results = [_format_result(r) for r in data.get("results", [])]
        return Response({
            "results": results,
            "next": data.get("next", ""),
        })
