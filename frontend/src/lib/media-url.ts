/**
 * Переписывает URL медиа/файлов на origin страницы.
 * В dev: API возвращает localhost:8000, страница на 5173 — запросы идут
 * через Vite proxy и работают. Без этого img src на 8000 даёт cross-origin ошибку.
 */
export function toSameOriginMediaUrl(url: string | null | undefined): string {
  if (!url || typeof url !== "string") return url || "";
  try {
    const page = new URL(window.location.href);
    const target = new URL(url, window.location.origin);
    if (target.origin === page.origin) return url;
    return `${page.origin}${target.pathname}${target.search}`;
  } catch {
    return url;
  }
}
