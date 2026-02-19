import { useEffect, useRef, useState } from "react";
import lottie, { type AnimationItem } from "lottie-web";
import { REACTION_BY_EMOJI } from "../lib/reaction-animations";

const animationCache = new Map<string, object>();

async function fetchAnimationData(url: string): Promise<object> {
  const cached = animationCache.get(url);
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load: ${url}`);
  const data = (await res.json()) as object;
  animationCache.set(url, data);
  return data;
}

export interface AnimatedReactionProps {
  emoji: string;
  size?: number;
  /** Play once then stop on last frame. Default true for reaction bubbles. */
  playOnce?: boolean;
  /** Loop animation. Use true for picker. */
  loop?: boolean;
  className?: string;
  /** Always show emoji (no Lottie) — reliable in any browser. Use in picker. */
  preferEmoji?: boolean;
}

export function AnimatedReaction({
  emoji,
  size = 24,
  playOnce = true,
  loop = false,
  className = "",
  preferEmoji = false,
}: AnimatedReactionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<AnimationItem | null>(null);
  const [useFallback, setUseFallback] = useState(false);
  const [visible, setVisible] = useState(loop);

  const def = REACTION_BY_EMOJI.get(emoji);
  const showEmoji = preferEmoji || useFallback || !def;

  useEffect(() => {
    if (preferEmoji || !def || useFallback) return;
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    fetchAnimationData(def.animationUrl)
      .then((animationData) => {
        if (cancelled || !containerRef.current) return;

        animRef.current = lottie.loadAnimation({
          container,
          renderer: "canvas",
          loop,
          autoplay: visible,
          animationData,
        });

        if (playOnce) {
          animRef.current.addEventListener("complete", () => {
            const anim = animRef.current;
            if (anim) {
              const totalFrames = anim.totalFrames;
              anim.goToAndStop(totalFrames - 1, true);
            }
          });
        }

        if (visible) {
          animRef.current.play();
        }
      })
      .catch(() => {
        if (!cancelled) setUseFallback(true);
      });

    return () => {
      cancelled = true;
      animRef.current?.destroy();
      animRef.current = null;
    };
  }, [preferEmoji, def, emoji, loop, playOnce, useFallback, visible]);

  useEffect(() => {
    if (preferEmoji || !def || useFallback) return;

    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) setVisible(true);
      },
      { rootMargin: "50px", threshold: 0 }
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, [preferEmoji, def, useFallback]);

  useEffect(() => {
    if (visible && animRef.current) {
      animRef.current.play();
    }
  }, [visible]);

  if (showEmoji) {
    return (
      <span
        className={`inline-flex items-center justify-center ${className}`}
        style={{
          width: size,
          height: size,
          fontSize: Math.round(size * 0.85),
          lineHeight: 1,
          fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Android Emoji",emoji',
        }}
      >
        {emoji}
      </span>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`inline-block shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
