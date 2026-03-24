import { useEffect, useRef, useState } from "react";
import { useMediaAccess } from "../hooks/useMediaAccess";

const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

interface MediaImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  source: string | null | undefined;
  lazy?: boolean;
  autoplayAnimated?: boolean;
  aggressiveAnimatedCompression?: boolean;
}

function getAnimatedKind(url: string | null | undefined): "image" | "video" | null {
  if (!url) return null;
  const normalized = url.toLowerCase();
  const extractPath = (input: string) => {
    try {
      const parsed = new URL(input, typeof window !== "undefined" ? window.location.origin : "http://localhost");
      const mediaPath = parsed.searchParams.get("path");
      return (mediaPath || parsed.pathname || "").toLowerCase();
    } catch {
      return input.toLowerCase();
    }
  };
  const path = extractPath(normalized);
  if (/\.(mp4|webm|mov|m4v)(?:$|\?)/.test(path)) return "video";
  if (/\.(gif|webp|apng)(?:$|\?)/.test(path)) return "image";
  return null;
}

export function MediaImage({
  source,
  lazy = true,
  alt = "",
  autoplayAnimated = false,
  aggressiveAnimatedCompression = false,
  className,
  style,
  ...props
}: MediaImageProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [visible, setVisible] = useState(!lazy);
  const resolvedUrl = useMediaAccess(source, { enabled: visible });
  const animatedKind = autoplayAnimated ? getAnimatedKind(resolvedUrl || source) : null;
  const compressionStyle = aggressiveAnimatedCompression && animatedKind
    ? {
        filter: "saturate(0.78) contrast(0.82) brightness(0.92)",
        imageRendering: "pixelated" as const,
      }
    : undefined;
  const mergedStyle = compressionStyle ? { ...style, ...compressionStyle } : style;

  useEffect(() => {
    if (!lazy) {
      setVisible(true);
      return;
    }
    const node = imgRef.current ?? videoRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [lazy, source]);

  if (animatedKind === "video") {
    return (
      <video
        ref={videoRef}
        src={resolvedUrl || undefined}
        className={className}
        style={mergedStyle}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
      />
    );
  }

  return <img ref={imgRef} src={resolvedUrl || TRANSPARENT_PIXEL} alt={alt} className={className} style={mergedStyle} {...props} />;
}
