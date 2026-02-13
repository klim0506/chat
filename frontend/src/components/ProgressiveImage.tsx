import { useState, useCallback } from "react";

const BLUR_PLACEHOLDER_WIDTH = 40;

/** URL для крошечного превью (blur placeholder). Только для http(s). */
function getThumbnailUrl(url: string, width: number = BLUR_PLACEHOLDER_WIDTH): string {
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return url;
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
}: ProgressiveImageProps) {
  const [loaded, setLoaded] = useState(false);

  const useThumbnail = src && (src.startsWith("http://") || src.startsWith("https://"));
  const thumbnailUrl = useThumbnail ? getThumbnailUrl(src) : null;
  const fullUrl = useThumbnail
    ? preserveAnimation
      ? src
      : (() => {
          try {
            const u = new URL(src, window.location.origin);
            if (!u.searchParams.has("w")) u.searchParams.set("w", String(fullWidth));
            if (!u.searchParams.has("preview")) u.searchParams.set("preview", "1");
            return u.toString();
          } catch {
            return src;
          }
        })()
    : src;

  const handleLoad = useCallback(() => setLoaded(true), []);

  const imgProps = {
    alt,
    loading,
    decoding,
  };

  const content = (
    <span className="relative block overflow-hidden rounded-lg [&>img:last-child]:relative">
      {/* Blur placeholder — крошечное превью, размытое и растянутое */}
      {thumbnailUrl && (
        <img
          src={thumbnailUrl}
          alt=""
          aria-hidden
          className={`absolute inset-0 w-full h-full transition-opacity duration-300 ${
            objectFit === "cover" ? "object-cover" : "object-contain"
          } ${loaded ? "opacity-0" : "opacity-100"}`}
          style={{ filter: "blur(12px)", transform: "scale(1.05)" }}
        />
      )}
      {/* Полноразмерное изображение */}
      <img
        src={fullUrl}
        {...imgProps}
        onLoad={handleLoad}
        className={`block transition-opacity duration-300 ${
          objectFit === "cover" ? "w-full h-full object-cover" : "object-contain"
        } ${loaded ? "opacity-100" : "opacity-0"} ${className}`}
      />
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
