import { useEffect, useRef } from "react";
import lottie, { type AnimationItem } from "lottie-web";
import { useMediaAccess } from "../hooks/useMediaAccess";

/**
 * Map of sticker paths → Lottie animation URLs.
 * Stickers in this map will be rendered as animated Lottie instead of static images.
 */
export const ANIMATED_STICKER_MAP: Record<string, string> = {
  "/stickers/default/fire.svg": "/animations/reactions/fire.json",
};

/** Check if a sticker path has an animation. */
export function getStickerAnimationUrl(path: string): string | null {
  const normalized = path.startsWith("/") ? path : `/${path.replace(/^\/+/, "")}`;
  return ANIMATED_STICKER_MAP[normalized] ?? null;
}

const dataCache = new Map<string, object>();

interface LottieStickerProps {
  animationUrl: string;
  size: number;
  loop?: boolean;
  className?: string;
}

/** Renders a Lottie animation for an animated sticker. */
export function LottieSticker({ animationUrl, size, loop = true, className = "" }: LottieStickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<AnimationItem | null>(null);
  const resolvedAnimationUrl = useMediaAccess(animationUrl);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !resolvedAnimationUrl) return;
    let cancelled = false;

    const cached = dataCache.get(resolvedAnimationUrl);
    const load = cached ? Promise.resolve(cached) : fetch(resolvedAnimationUrl).then((r) => r.json() as Promise<object>);

    load
      .then((data) => {
        if (cancelled || !containerRef.current) return;
        if (!cached) dataCache.set(resolvedAnimationUrl, data);
        animRef.current = lottie.loadAnimation({
          container: containerRef.current,
          renderer: "canvas",
          loop,
          autoplay: true,
          animationData: data,
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      animRef.current?.destroy();
      animRef.current = null;
    };
  }, [resolvedAnimationUrl, loop]);

  return (
    <div
      ref={containerRef}
      className={`inline-block shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
