import { useState } from "react";
import { TELEGRAM_EMOJI_SRC_BY_EMOJI } from "../data/telegram-emojis";
import { MediaImage } from "./MediaImage";
import { isOpaqueMediaHandle } from "../lib/media-url";

interface EmojiGlyphProps {
  emoji: string;
  size?: number;
  className?: string;
  preferNative?: boolean;
  /** Override: image URL or access handle (e.g. for system emojis from API) */
  imageSource?: string;
}

export function EmojiGlyph({ emoji, size = 22, className = "", preferNative = false, imageSource }: EmojiGlyphProps) {
  const src = imageSource ?? TELEGRAM_EMOJI_SRC_BY_EMOJI.get(emoji);
  const [useNativeFallback, setUseNativeFallback] = useState(preferNative);
  const useMediaImage = imageSource && isOpaqueMediaHandle(imageSource);
  if (src && !useNativeFallback) {
    if (useMediaImage) {
      return (
        <MediaImage
          source={src}
          alt={emoji}
          width={size}
          height={size}
          className={`inline-block shrink-0 object-contain ${className}`}
        />
      );
    }
    return (
      <img
        src={src}
        alt={emoji}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setUseNativeFallback(true)}
        className={`inline-block shrink-0 object-contain ${className}`}
      />
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.9),
        lineHeight: 1,
        fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Android Emoji",emoji',
      }}
    >
      {emoji}
    </span>
  );
}
