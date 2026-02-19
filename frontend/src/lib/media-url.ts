/**
 * Rewrites media/file URLs to the page origin.
 * In dev: API returns localhost:8000, page is on 5173 — requests go
 * through Vite proxy and work. Without this, img src on 8000 gives cross-origin error.
 * Relative paths (avatar.png, avatars/xxx.jpg) are converted to absolute with /media/.
 */
export function toSameOriginMediaUrl(url: string | null | undefined): string {
  if (!url || typeof url !== "string") return url || "";
  const s = url.trim();
  if (!s) return "";

  try {
    const page = new URL(window.location.href);
    const origin = page.origin;

    // Relative path without leading / — backend serves media from /media/
    if (!s.startsWith("http://") && !s.startsWith("https://") && !s.startsWith("/")) {
      const path = s.startsWith("media/") ? `/${s}` : `/media/${s}`;
      return `${origin}${path}`;
    }

    const target = new URL(s, origin);
    if (target.origin === page.origin) return url;
    return `${page.origin}${target.pathname}${target.search}`;
  } catch {
    return url;
  }
}
