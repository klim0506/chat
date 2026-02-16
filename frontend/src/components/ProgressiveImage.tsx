import { useState, useCallback } from "react";

const BLUR_PLACEHOLDER_WIDTH = 420;

/** URL для крошечного превью (blur placeholder). Работает для http(s) и относительных путей. */
function getThumbnailUrl(url: string, width: number = BLUR_PLACEHOLDER_WIDTH): string {
  if (!url || url === "#" || url.startsWith("blob:") || url.startsWith("data:")) return url;
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.set("w", String(width));
    if (!u.searchParams.has("preview")) u.searchParams.set("preview", "1");
    return u.toString();
  } catch {
    return url;
  }
}

export interface ProgressiveImageProps {
  src: string;
  alt?: string;
  className?: string;
  /** object-contain | object-cover */
  objectFit?: "contain" | "cover";
  loading?: "lazy" | "eager";
  decoding?: "async" | "sync" | "auto";
  onClick?: () => void;
  /** Ширина полноразмерного превью (передаётся в withPreviewParams) */
  fullWidth?: number;
  /** Не добавлять w= к URL — загружать оригинал без сжатия (для лайтбокса) */
  useOriginalQuality?: boolean;
  /** Оборачивающий элемент: button | a | div */
  wrapper?: "button" | "a" | "div";
  href?: string;
  /** Не добавлять w= к полному изображению (для GIF — сохранить анимацию) */
  preserveAnimation?: boolean;
}

/**
 * Прогрессивная загрузка изображения: размытый placeholder → полное изображение (как в Telegram).
 */
export function ProgressiveImage({
  src,
  alt = "",
  className = "",
  objectFit = "contain",
  loading = "lazy",
  decoding = "async",
  onClick,
  fullWidth = 1400,
  wrapper = "div",
  href,
  preserveAnimation = false,
  useOriginalQuality = false,
}: ProgressiveImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const isValidUrl = !!src && src !== "#" && (src.startsWith("http") || src.startsWith("/") || src.startsWith("blob:") || src.startsWith("data:"));
  const useThumbnail = isValidUrl && (src.startsWith("http") || src.startsWith("/"));
  const showErrorPlaceholder = !isValidUrl || error;
  const thumbnailUrl = useThumbnail ? getThumbnailUrl(src) : null;
  const fullUrl = useThumbnail
    ? preserveAnimation || useOriginalQuality
      ? src
      : (() => {
          try {
            const u = new URL(src, window.location.origin);
            if (!u.searchParams.has("w")) u.searchParams.set("w", String(fullWidth));
            return u.toString();
          } catch {
            return src;
          }
        })()
    : src;

  const handleLoad = useCallback(() => {
    setLoaded(true);
    setError(false);
  }, []);
  const handleError = useCallback(() => {
    setError(true);
  }, []);

  const imgProps = {
    alt,
    loading,
    decoding,
  };

  const content = (
    <span className={`relative block overflow-hidden ${objectFit === "cover" ? "rounded-none w-full h-full" : "rounded-lg bg-slate-100"} [&>img:last-child]:relative`}>
      {showErrorPlaceholder ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-slate-200/80 text-slate-600 text-sm p-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
            <circle cx="9" cy="9" r="2"/>
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
          </svg>
          <span>Не удалось загрузить</span>
        </div>
      ) : (
        <>
          {/* Blur placeholder */}
          {thumbnailUrl && (
            <img
              src={thumbnailUrl}
              alt=""
              aria-hidden
              className={`absolute inset-0 w-full h-full transition-opacity duration-300 ${
                objectFit === "cover" ? "object-cover" : "object-contain"
              } ${loaded ? "opacity-0" : "opacity-100"}`}
              style={{ filter: "blur(12px)", transform: "scale(1.05)" }}
              onError={() => {}}
            />
          )}
          {/* Полноразмерное изображение */}
          <img
            src={fullUrl}
            {...imgProps}
            onLoad={handleLoad}
            onError={handleError}
            className={`block transition-opacity duration-300 ${
              objectFit === "cover" ? "w-full h-full object-cover" : "object-contain"
            } ${loaded ? "opacity-100" : "opacity-0"} ${className}`}
          />
        </>
      )}
    </span>
  );

  const wrapperCls = objectFit === "cover" ? "block min-w-0 max-w-full w-full h-full" : "block min-w-0 max-w-full";

  if (wrapper === "button" && onClick) {
    return (
      <button type="button" onClick={onClick} className={`${wrapperCls} text-left cursor-pointer hover:opacity-90 transition-opacity`}>
        {content}
      </button>
    );
  }
  if (wrapper === "a" && href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={wrapperCls}>
        {content}
      </a>
    );
  }
  return <div className={wrapperCls}>{content}</div>;
}
