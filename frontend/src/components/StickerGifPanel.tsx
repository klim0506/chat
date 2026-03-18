import { useState, useEffect, useCallback, useRef } from "react";
import { gifApi, stickersApi, type GifResult, type Sticker as ApiSticker, type StickerPack } from "../api/client";
import { useTranslation } from "../lib/i18n";
import { AnimatedReaction } from "./AnimatedReaction";
import { LottieSticker } from "./LottieSticker";
import { TELEGRAM_EMOJI_CATEGORIES } from "../data/telegram-emojis";
import { EmojiGlyph } from "./EmojiGlyph";

const DEBOUNCE_MS = 300;
const CONTENT_HEIGHT_PX = 8 * 32 + 7 * 2;

const BUNDLED_STICKERS = [
  { id: "fire", path: "/stickers/default/fire.svg", label: "Fire", animationUrl: "/animations/reactions/fire.json" },
];

type Tab = "emoji" | "stickers" | "gif";

export type StickerSelection = string | { id: string; fileId: string; url: string; animationUrl?: string };

interface StickerGifPanelProps {
  onSelectEmoji: (emoji: string) => void;
  onSelectGif?: (url: string) => void;
  onSelectSticker?: (pathOrSticker: StickerSelection) => void;
  onManageStickers?: () => void;
  refreshToken?: number;
  emojiOnly?: boolean;
  className?: string;
}

function EmojiSections({ onSelectEmoji }: { onSelectEmoji: (emoji: string) => void }) {
  return (
    <div className="space-y-3">
      {TELEGRAM_EMOJI_CATEGORIES.map((category) => (
        <section key={category.id}>
          <div className="sticky top-0 z-[1] mb-1 bg-white/95 px-1 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-slate-400 backdrop-blur">
            {category.label}
          </div>
          <div className="grid grid-cols-8 gap-0.5">
            {category.items.map((item) => (
              <button
                key={item.src}
                type="button"
                onClick={() => onSelectEmoji(item.emoji)}
                className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
                title={item.emoji}
              >
                {item.emoji === "\u{1F525}" ? <AnimatedReaction emoji={item.emoji} size={22} loop /> : <EmojiGlyph emoji={item.emoji} size={22} />}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function StickerGifPanel({ onSelectEmoji, onSelectGif, onSelectSticker, onManageStickers, refreshToken, emojiOnly, className = "" }: StickerGifPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("emoji");
  const [gifQuery, setGifQuery] = useState("");
  const [gifResults, setGifResults] = useState<GifResult[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [, setGifNext] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef("");

  const [stickerSubTab, setStickerSubTab] = useState<"recent" | "default" | string>("recent");
  const [recentStickers, setRecentStickers] = useState<ApiSticker[]>([]);
  const [installedPacks, setInstalledPacks] = useState<StickerPack[]>([]);
  const [stickersLoading, setStickersLoading] = useState(false);

  const fetchStickers = useCallback(async () => {
    setStickersLoading(true);
    try {
      const [recentRes, installedRes] = await Promise.all([
        stickersApi.listRecent().catch(() => ({ data: [] })),
        stickersApi.listInstalled().catch(() => ({ data: [] })),
      ]);

      const onlyEmoji = "\u{1F525}";
      const recentFiltered = (recentRes.data ?? []).filter((s) => s.emoji === onlyEmoji);
      const installedFiltered = (installedRes.data ?? [])
        .map((pack) => ({
          ...pack,
          stickers: (pack.stickers ?? []).filter((s) => s.emoji === onlyEmoji),
        }))
        .filter((pack) => (pack.stickers?.length ?? 0) > 0);

      setRecentStickers(recentFiltered);
      setInstalledPacks(installedFiltered);
    } catch {
      setRecentStickers([]);
      setInstalledPacks([]);
    } finally {
      setStickersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "stickers") fetchStickers();
  }, [tab, fetchStickers, refreshToken]);

  const fetchGifs = useCallback(async (q: string, pos?: string) => {
    setGifLoading(true);
    try {
      const res = q.trim()
        ? await gifApi.search(q, { limit: 20, pos })
        : await gifApi.trending(20);
      setGifResults(pos ? (prev) => [...prev, ...res.data.results] : res.data.results);
      setGifNext(res.data.next || "");
    } catch {
      setGifResults([]);
      setGifNext("");
    } finally {
      setGifLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      if (tab === "gif") {
        lastQueryRef.current = gifQuery;
        fetchGifs(gifQuery);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [tab, gifQuery, fetchGifs]);

  if (emojiOnly) {
    return (
      <div className={`overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg ${className}`} style={{ width: "320px" }}>
        <div className="scrollbar-hide overflow-y-auto p-2" style={{ height: CONTENT_HEIGHT_PX }}>
          <EmojiSections onSelectEmoji={onSelectEmoji} />
        </div>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg ${className}`} style={{ width: "320px" }}>
      <div className="flex border-b border-slate-100">
        <button
          type="button"
          onClick={() => setTab("emoji")}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${tab === "emoji" ? "border-b-2 border-blue-600 bg-blue-50/50 text-blue-600" : "text-slate-600 hover:bg-slate-50"}`}
        >
          Emoji
        </button>
        <button
          type="button"
          onClick={() => setTab("stickers")}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${tab === "stickers" ? "border-b-2 border-blue-600 bg-blue-50/50 text-blue-600" : "text-slate-600 hover:bg-slate-50"}`}
        >
          Стикеры
        </button>
        <button
          type="button"
          onClick={() => setTab("gif")}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${tab === "gif" ? "border-b-2 border-blue-600 bg-blue-50/50 text-blue-600" : "text-slate-600 hover:bg-slate-50"}`}
        >
          GIF
        </button>
      </div>

      {tab === "emoji" && (
        <div className="scrollbar-hide overflow-y-auto p-2" style={{ height: CONTENT_HEIGHT_PX }}>
          <EmojiSections onSelectEmoji={onSelectEmoji} />
        </div>
      )}

      {tab === "stickers" && (
        <div className="flex flex-col" style={{ height: CONTENT_HEIGHT_PX }}>
          <div className="flex shrink-0 overflow-x-auto border-b border-slate-100">
            <button
              type="button"
              onClick={() => setStickerSubTab("recent")}
              className={`px-2 py-1.5 text-xs font-medium whitespace-nowrap ${stickerSubTab === "recent" ? "border-b-2 border-blue-600 bg-blue-50/50 text-blue-600" : "text-slate-600 hover:bg-slate-50"}`}
            >
              Последние
            </button>
            <button
              type="button"
              onClick={() => setStickerSubTab("default")}
              className={`px-2 py-1.5 text-xs font-medium whitespace-nowrap ${stickerSubTab === "default" ? "border-b-2 border-blue-600 bg-blue-50/50 text-blue-600" : "text-slate-600 hover:bg-slate-50"}`}
            >
              По умолчанию
            </button>
            {installedPacks.map((pack) => (
              <button
                key={pack.id}
                type="button"
                onClick={() => setStickerSubTab(pack.id)}
                className={`max-w-[80px] truncate px-2 py-1.5 text-xs font-medium whitespace-nowrap ${stickerSubTab === pack.id ? "border-b-2 border-blue-600 bg-blue-50/50 text-blue-600" : "text-slate-600 hover:bg-slate-50"}`}
                title={pack.title}
              >
                {pack.title}
              </button>
            ))}
          </div>
          <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto p-2">
            {stickersLoading ? (
              <div className="flex items-center justify-center py-8 text-sm text-slate-500">Загрузка...</div>
            ) : stickerSubTab === "recent" ? (
              recentStickers.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-500">Нет недавних стикеров</div>
              ) : (
                <div className="grid grid-cols-4 gap-1">
                  {recentStickers.map((sticker) => {
                    const url = sticker.file?.url;
                    const isLottie = (sticker.file?.mime_type || "").includes("application/json");
                    return (
                      <button
                        key={sticker.id}
                        type="button"
                        onClick={() =>
                          url &&
                          sticker.file_id &&
                          onSelectSticker?.({
                            id: sticker.id,
                            fileId: sticker.file_id,
                            url,
                            animationUrl: isLottie ? url : undefined,
                          })
                        }
                        className="flex h-14 w-14 items-center justify-center rounded-lg p-1 transition-colors hover:bg-slate-100"
                        title={sticker.label || sticker.emoji}
                      >
                        {url &&
                          (isLottie ? (
                            <LottieSticker animationUrl={url} size={40} />
                          ) : (
                            <img src={url} alt={sticker.label} className="h-10 w-10 object-contain" />
                          ))}
                      </button>
                    );
                  })}
                </div>
              )
            ) : stickerSubTab === "default" ? (
              <div className="grid grid-cols-4 gap-1">
                {BUNDLED_STICKERS.map((sticker) => (
                  <button
                    key={sticker.id}
                    type="button"
                    onClick={() => onSelectSticker?.(sticker.path)}
                    className="flex h-14 w-14 items-center justify-center rounded-lg p-1 transition-colors hover:bg-slate-100"
                    title={sticker.label}
                  >
                    {sticker.animationUrl ? (
                      <LottieSticker animationUrl={sticker.animationUrl} size={40} />
                    ) : (
                      <img src={sticker.path} alt={sticker.label} className="h-10 w-10 object-contain" />
                    )}
                  </button>
                ))}
              </div>
            ) : (
              (() => {
                const pack = installedPacks.find((item) => item.id === stickerSubTab);
                const stickers = pack?.stickers ?? [];
                if (stickers.length === 0) {
                  return (
                    <div className="py-8 text-center text-sm text-slate-500">
                      Пустой набор
                      {onManageStickers && (
                        <button type="button" onClick={onManageStickers} className="mt-2 block text-blue-600 hover:underline">
                          Добавить стикеры
                        </button>
                      )}
                    </div>
                  );
                }
                return (
                  <div className="grid grid-cols-4 gap-1">
                    {stickers.map((sticker) => {
                      const url = sticker.file?.url;
                      const isLottie = (sticker.file?.mime_type || "").includes("application/json");
                      return (
                        <button
                          key={sticker.id}
                          type="button"
                          onClick={() =>
                            url &&
                            sticker.file_id &&
                            onSelectSticker?.({
                              id: sticker.id,
                              fileId: sticker.file_id,
                              url,
                              animationUrl: isLottie ? url : undefined,
                            })
                          }
                          className="flex h-14 w-14 items-center justify-center rounded-lg p-1 transition-colors hover:bg-slate-100"
                          title={sticker.label || sticker.emoji}
                        >
                          {url &&
                            (isLottie ? (
                              <LottieSticker animationUrl={url} size={40} />
                            ) : (
                              <img src={url} alt={sticker.label} className="h-10 w-10 object-contain" />
                            ))}
                        </button>
                      );
                    })}
                  </div>
                );
              })()
            )}
          </div>
          {onManageStickers && (
            <div className="shrink-0 border-t border-slate-100 p-2">
              <button type="button" onClick={onManageStickers} className="text-xs text-blue-600 hover:underline">
                Управление наборами
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "gif" && (
        <div className="flex flex-col" style={{ height: CONTENT_HEIGHT_PX }}>
          <div className="shrink-0 border-b border-slate-100 p-2">
            <input
              type="text"
              value={gifQuery}
              onChange={(e) => setGifQuery(e.target.value)}
              placeholder={t("sticker.searchGif")}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto p-2">
            {gifLoading && gifResults.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-sm text-slate-500">Загрузка...</div>
            ) : gifResults.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">Введите запрос для поиска</div>
            ) : (
              <div className="grid grid-cols-4 gap-1">
                {gifResults.map((gif) => (
                  <button
                    key={gif.id}
                    type="button"
                    onClick={() => onSelectGif?.(gif.url)}
                    className="aspect-square overflow-hidden rounded-lg bg-slate-100 hover:ring-2 hover:ring-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <img src={gif.preview_url || gif.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
