import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { type TelegramEmojiCategory } from "../data/telegram-emojis";
import { AnimatedReaction } from "./AnimatedReaction";
import { EmojiGlyph } from "./EmojiGlyph";

const EMOJI_BATCH_SIZE = 160;
const LOAD_MORE_THRESHOLD_PX = 220;

interface EmojiCategoryListProps {
  categories: TelegramEmojiCategory[];
  onSelectEmoji: (emoji: string) => void;
  selectedEmoji?: string;
  height: number;
  leadingContent?: ReactNode;
  buttonSize?: number;
}

function LazyEmojiCell({
  emoji,
  selected,
  title,
  size,
  onSelect,
}: {
  emoji: string;
  selected: boolean;
  title: string;
  size: number;
  onSelect: (emoji: string) => void;
}) {
  const [showRichEmoji, setShowRichEmoji] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowRichEmoji(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <button
      type="button"
      onClick={() => onSelect(emoji)}
      title={title}
      className={`ui-picker-tile flex items-center justify-center rounded-lg ${
        selected ? "ui-picker-tile-active" : ""
      }`}
      style={{ width: size, height: size }}
    >
      {emoji === "\u{1F525}" && showRichEmoji ? (
        <AnimatedReaction emoji={emoji} size={Math.max(20, size - 10)} loop />
      ) : (
        <EmojiGlyph emoji={emoji} size={Math.max(20, size - 10)} preferNative={!showRichEmoji} />
      )}
    </button>
  );
}

export function EmojiCategoryList({
  categories,
  onSelectEmoji,
  selectedEmoji = "",
  height,
  leadingContent,
  buttonSize = 32,
}: EmojiCategoryListProps) {
  const totalItems = useMemo(
    () => categories.reduce((sum, category) => sum + category.items.length, 0),
    [categories]
  );
  const [renderedCount, setRenderedCount] = useState(() => Math.min(totalItems, EMOJI_BATCH_SIZE));

  useEffect(() => {
    setRenderedCount(Math.min(totalItems, EMOJI_BATCH_SIZE));
  }, [totalItems]);

  const loadMore = useCallback(() => {
    setRenderedCount((current) => (current >= totalItems ? current : Math.min(totalItems, current + EMOJI_BATCH_SIZE)));
  }, [totalItems]);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - LOAD_MORE_THRESHOLD_PX) {
        loadMore();
      }
    },
    [loadMore]
  );

  const visibleCategories = useMemo(() => {
    let remaining = renderedCount;
    return categories
      .map((category) => {
        if (remaining <= 0) return null;
        const visibleItems = category.items.slice(0, remaining);
        remaining -= visibleItems.length;
        if (visibleItems.length === 0) return null;
        return { ...category, items: visibleItems };
      })
      .filter((category): category is TelegramEmojiCategory => category !== null);
  }, [categories, renderedCount]);

  return (
    <div className="scrollbar-hide overflow-y-auto p-2" style={{ height }} onScroll={handleScroll}>
      {leadingContent}
      <div className="space-y-3">
        {visibleCategories.map((category) => (
          <section key={category.id}>
            <div className="sticky top-0 z-[1] mb-1 rounded-md bg-white/80 px-1 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-slate-400 backdrop-blur">
              {category.label}
            </div>
            <div className="grid grid-cols-8 gap-0.5">
              {category.items.map((item) => (
                <LazyEmojiCell
                  key={item.src}
                  emoji={item.emoji}
                  selected={selectedEmoji === item.emoji}
                  title={item.emoji}
                  size={buttonSize}
                  onSelect={onSelectEmoji}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      {renderedCount < totalItems && (
        <div className="py-2 text-center text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-slate-400">
          Loading more...
        </div>
      )}
    </div>
  );
}
