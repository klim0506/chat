/**
 * Переписывает URL медиа/файлов на origin страницы.
 * В dev: API возвращает localhost:8000, страница на 5173 — запросы идут
 * через Vite proxy и работают. Без этого img src на 8000 даёт cross-origin ошибку.
 * Относительные пути (avatar.png, avatars/xxx.jpg) приводятся к абсолютным с /media/.
 */
export function toSameOriginMediaUrl(url: string | null | undefined): string {
  if (!url || typeof url !== "string") return url || "";
  const s = url.trim();
  if (!s) return "";

  try {
    const page = new URL(window.location.href);
    const origin = page.origin;

    // Относительный путь без ведущего / — бэкенд отдаёт медиа из /media/
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
