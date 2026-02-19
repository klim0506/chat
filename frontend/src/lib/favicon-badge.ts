const FAVICON_SIZE = 32;
const BADGE_SIZE = 14;
const BADGE_OFFSET = FAVICON_SIZE - BADGE_SIZE;
let originalFaviconUrl: string | null = null;
let originalFaviconLink: HTMLLinkElement | null = null;

function getFaviconLink(): HTMLLinkElement | null {
  const links = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');
  return links[0] ?? null;
}

/**
 * Update favicon with unread count badge. If count is 0, restore original favicon.
 */
export function updateFaviconBadge(count: number): void {
  const link = getFaviconLink();
  if (!link) return;

  if (!originalFaviconLink || originalFaviconLink !== link) {
    originalFaviconLink = link;
    const href = link.getAttribute("href");
    if (href && !href.startsWith("data:")) originalFaviconUrl = href;
    else if (!originalFaviconUrl) originalFaviconUrl = "/favicon.ico?v=2";
  }

  if (count <= 0) {
    if (originalFaviconUrl) {
      link.setAttribute("href", originalFaviconUrl);
    }
    return;
  }

  const img = new Image();
  img.crossOrigin = "anonymous";

  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = FAVICON_SIZE;
      canvas.height = FAVICON_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(img, 0, 0, FAVICON_SIZE, FAVICON_SIZE);

      const displayCount = count > 99 ? "99+" : String(count);
      const badgeRadius = BADGE_SIZE / 2;
      const badgeX = BADGE_OFFSET + badgeRadius;
      const badgeY = badgeRadius;

      ctx.beginPath();
      ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
      ctx.fillStyle = "#dc2626";
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = "white";
      ctx.font = displayCount.length > 2 ? "bold 8px system-ui" : "bold 10px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(displayCount, badgeX, badgeY);

      link.setAttribute("href", canvas.toDataURL("image/png"));
    } catch {
      // Ignore CORS or canvas errors
    }
  };

  img.onerror = () => {
    // Fallback: try to draw badge on blank canvas
    try {
      const canvas = document.createElement("canvas");
      canvas.width = FAVICON_SIZE;
      canvas.height = FAVICON_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#e5e7eb";
      ctx.fillRect(0, 0, FAVICON_SIZE, FAVICON_SIZE);

      const displayCount = count > 99 ? "99+" : String(count);
      const badgeRadius = BADGE_SIZE / 2;
      const badgeX = BADGE_OFFSET + badgeRadius;
      const badgeY = badgeRadius;

      ctx.beginPath();
      ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
      ctx.fillStyle = "#dc2626";
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = "white";
      ctx.font = displayCount.length > 2 ? "bold 8px system-ui" : "bold 10px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(displayCount, badgeX, badgeY);

      link.setAttribute("href", canvas.toDataURL("image/png"));
    } catch {
      /* ignore */
    }
  };

  const baseUrl = originalFaviconUrl || "/favicon.ico?v=2";
  img.src = baseUrl.startsWith("data:") ? "/favicon.ico?v=2" : new URL(baseUrl, window.location.origin).toString();
}
