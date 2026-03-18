"""
Fetch Open Graph meta tags from a URL for link preview cards.
"""
from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

# URL regex — match http(s) URLs
URL_RE = re.compile(
    r"https?://(?:[a-zA-Z0-9\-._~:/?#\[\]@!$&'()*+,;=%]|%[0-9A-Fa-f]{2})+",
    re.IGNORECASE,
)

REQUEST_TIMEOUT = 5
MAX_CONTENT_LENGTH = 500_000  # 500 KB


def _extract_first_url(text: str) -> str | None:
    """Extract the first http(s) URL from text."""
    match = URL_RE.search(text)
    return match.group(0) if match else None


def fetch_og_meta(url: str) -> dict | None:
    """
    Fetch Open Graph meta tags from a URL.
    Returns { "url", "title", "description", "image" } or None on failure.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return None
    try:
        resp = requests.get(
            url,
            timeout=REQUEST_TIMEOUT,
            headers={"User-Agent": "Pingy/1.0 (Link Preview)"},
            stream=True,
        )
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "text/html" not in content_type:
            return None
        content_length = resp.headers.get("content-length")
        if content_length and int(content_length) > MAX_CONTENT_LENGTH:
            return None
        content = resp.content[:MAX_CONTENT_LENGTH]
        resp.close()
    except (requests.RequestException, ValueError):
        return None

    try:
        soup = BeautifulSoup(content, "html.parser")
    except Exception:
        return None

    def _og(name: str) -> str | None:
        tag = soup.find("meta", property=f"og:{name}")
        if tag and tag.get("content"):
            return tag["content"].strip()[:500]
        return None

    def _fallback_title() -> str | None:
        title = soup.find("title")
        if title and title.string:
            return title.string.strip()[:500]
        return None

    title = _og("title") or _fallback_title()
    description = _og("description")
    image = _og("image")
    if image and not image.startswith(("http://", "https://")):
        image = urljoin(url, image)

    # Return only if we have at least title or description
    if not title and not description:
        return None

    return {
        "url": url,
        "title": title or "",
        "description": description or "",
        "image": image or "",
    }


def extract_and_fetch_link_preview(content: str, *, is_encrypted: bool = False) -> dict | None:
    """
    Extract first URL from content and fetch OG meta.
    Returns link_preview dict or None.
    Skips fetch for encrypted messages (content is ciphertext).
    """
    if not content or is_encrypted:
        return None
    url = _extract_first_url(content)
    if not url:
        return None
    return fetch_og_meta(url)
