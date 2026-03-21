import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { type TelegramEmojiCategory, type TelegramEmojiItem } from "../data/telegram-emojis";
import { AnimatedReaction } from "./AnimatedReaction";
import { EmojiGlyph } from "./EmojiGlyph";
import {
  SKIN_TONE_OPTIONS,
  stripSkinTone,
  applySkinTone,
  hasSkinTone,
} from "../lib/emoji-skin-tones";
import { useTranslation, type TranslationKey } from "../lib/i18n";

const EMOJI_BATCH_SIZE = 160;
const LOAD_MORE_THRESHOLD_PX = 220;

const FITZPATRICK_COLORS = [
  "#FFDBB5", // light
  "#E8B98A",
  "#C88B5A",
  "#8D5524",
  "#5D3A1A", // dark
];

function collapseSkinToneVariants(items: TelegramEmojiItem[]): {
  collapsed: TelegramEmojiItem[];
  supportsSkinTone: Set<string>;
} {
  const byBase = new Map<string, TelegramEmojiItem[]>();
  for (const item of items) {
    const base = stripSkinTone(item.emoji);
    const list = byBase.get(base) ?? [];
    list.push(item);
    byBase.set(base, list);
  }
  const collapsed: TelegramEmojiItem[] = [];
  const supportsSkinTone = new Set<string>();
  for (const list of byBase.values()) {
    const defaultItem = list.find((i) => !hasSkinTone(i.emoji)) ?? list[0];
    collapsed.push(defaultItem);
    if (list.length > 1) {
      supportsSkinTone.add(defaultItem.emoji);
    }
  }
  return { collapsed, supportsSkinTone };
}

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
  imageSource,
}: {
  emoji: string;
  selected: boolean;
  title: string;
  size: number;
  onSelect: (emoji: string) => void;
  imageSource?: string;
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
      className={`ui-picker-tile ui-picker-tile-borderless flex items-center justify-center rounded-lg ${
        selected ? "ui-picker-tile-active" : ""
      }`}
      style={{ width: size, height: size }}
    >
      {emoji === "\u{1F525}" && showRichEmoji ? (
        <AnimatedReaction emoji={emoji} size={Math.max(20, size - 10)} loop />
      ) : (
        <EmojiGlyph emoji={emoji} size={Math.max(20, size - 10)} preferNative={!showRichEmoji} imageSource={imageSource} />
      )}
    </button>
  );
}

function SkinTonePicker({
  selectedId,
  onSelect,
  t,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  t: (key: TranslationKey) => string;
}) {
  return (
    <div className="mb-2 flex items-center justify-center gap-1 rounded-lg bg-slate-50/80 px-2 py-1.5">
      <button
        type="button"
        onClick={() => onSelect("")}
        title={t("emoji.skinToneDefault")}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          selectedId === "" ? "border-blue-500 bg-amber-200" : "border-slate-200 bg-amber-100 hover:border-slate-300"
        }`}
      >
        <span className="text-sm" aria-hidden>👋</span>
      </button>
      {SKIN_TONE_OPTIONS.slice(1).map((opt, i) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onSelect(opt.id)}
          title={opt.label}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
            selectedId === opt.id ? "border-blue-500 scale-110" : "border-slate-200 hover:border-slate-300"
          }`}
          style={{ backgroundColor: FITZPATRICK_COLORS[i] }}
        />
      ))}
    </div>
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
  const { t } = useTranslation();
  const [skinToneId, setSkinToneId] = useState("");

  const collapsedCategories = useMemo(() => {
    const out: { category: TelegramEmojiCategory; supportsSkinTone: Set<string> }[] = [];
    for (const category of categories) {
      const { collapsed, supportsSkinTone } = collapseSkinToneVariants(category.items);
      out.push({
        category: { ...category, items: collapsed },
        supportsSkinTone,
      });
    }
    return out;
  }, [categories]);

  const totalItems = useMemo(
    () => collapsedCategories.reduce((sum, { category }) => sum + category.items.length, 0),
    [collapsedCategories]
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

  const visibleData = useMemo(() => {
    let remaining = renderedCount;
    const result: { category: TelegramEmojiCategory; supportsSkinTone: Set<string>; items: TelegramEmojiItem[] }[] = [];
    for (const { category, supportsSkinTone } of collapsedCategories) {
      if (remaining <= 0) break;
      const items = category.items.slice(0, remaining);
      remaining -= items.length;
      if (items.length > 0) {
        result.push({ category, supportsSkinTone, items });
      }
    }
    return result;
  }, [collapsedCategories, renderedCount]);

  const handleSelectEmoji = useCallback(
    (displayEmoji: string, supportsTone: boolean) => {
      const opt = skinToneId ? SKIN_TONE_OPTIONS.find((o) => o.id === skinToneId) : null;
      const final = supportsTone && opt?.modifier ? applySkinTone(displayEmoji, opt.modifier) : displayEmoji;
      onSelectEmoji(final);
    },
    [onSelectEmoji, skinToneId]
  );

  return (
    <div className="scrollbar-hide overflow-y-auto pl-0 pr-2 pt-2 pb-2" style={{ height }} onScroll={handleScroll}>
      <SkinTonePicker selectedId={skinToneId} onSelect={setSkinToneId} t={t} />
      {leadingContent}
      <div className="space-y-3">
        {visibleData.map(({ category, supportsSkinTone, items }) => (
          <section key={category.id}>
            <div className="sticky top-0 z-[1] mb-1 rounded-md bg-white/80 pl-0 pr-1 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-slate-400 backdrop-blur">
              {category.label}
            </div>
            <div className="grid grid-cols-8 gap-0.5">
              {items.map((item) => (
                <LazyEmojiCell
                  key={item.src}
                  emoji={item.emoji}
                  selected={
                    selectedEmoji === item.emoji ||
                    !!(selectedEmoji && stripSkinTone(selectedEmoji) === stripSkinTone(item.emoji))
                  }
                  title={item.emoji}
                  size={buttonSize}
                  onSelect={(emoji) => handleSelectEmoji(emoji, supportsSkinTone.has(item.emoji))}
                  imageSource={item.src}
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
