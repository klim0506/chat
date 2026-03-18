import { useState, useEffect, useCallback, useRef } from "react";
import { gifApi, stickersApi, type GifResult, type Sticker as ApiSticker, type StickerPack } from "../api/client";
import { useTranslation } from "../lib/i18n";
import { AnimatedReaction } from "./AnimatedReaction";
import { LottieSticker } from "./LottieSticker";

const DEBOUNCE_MS = 300;

/** Высота контента панели = 8 рядов эмодзи (8×32px + 7×2px gap) */
const CONTENT_HEIGHT_PX = 8 * 32 + 7 * 2;

/** Emojis for quick insert into text input. */
const INPUT_EMOJIS = [
  "😀", "😃", "😄", "😁", "😅", "😂", "🤣", "😊", "😇", "🙂", "😉", "😍", "🥰", "😘", "😋",
  "😎", "🤩", "🥳", "😢", "😭", "😤", "😡", "🤔", "😶", "🙄", "❤️", "🧡", "💛", "💚", "💙",
  "💜", "🖤", "🤍", "💕", "💪", "👍", "👎", "👏", "🙌", "🤝", "🙏", "🔥", "✨", "💫", "🌟",
  "🎉", "🎊", "✅", "❌", "⚠️", "💯",
];

/** Bundled stickers in public/stickers/default/ (expandable later). */
const BUNDLED_STICKERS = [
  { id: "smile", path: "/stickers/default/smile.svg", label: "Smile" },
  { id: "heart", path: "/stickers/default/heart.svg", label: "Heart" },
  { id: "thumbsup", path: "/stickers/default/thumbsup.svg", label: "Thumbs up" },
  { id: "fire", path: "/stickers/default/fire.svg", label: "Fire", animationUrl: "/animations/reactions/fire.json" },
  { id: "party", path: "/stickers/default/party.svg", label: "Party" },
  { id: "wave", path: "/stickers/default/wave.svg", label: "Wave" },
];

type Tab = "emoji" | "stickers" | "gif";

export type StickerSelection = string | { id: string; fileId: string; url: string; animationUrl?: string };

interface StickerGifPanelProps {
  /** Insert emoji into text input */
  onSelectEmoji: (emoji: string) => void;
  onSelectGif?: (url: string) => void;
  /** Sticker: path string (bundled) or object { id, fileId, url, animationUrl? } (user sticker) */
  onSelectSticker?: (pathOrSticker: StickerSelection) => void;
  /** Called when user wants to manage/create sticker packs (optional) */
  onManageStickers?: () => void;
  /** Increment to trigger refetch of recent/installed stickers */
  refreshToken?: number;
  /** Show only emoji tab (for title/name inputs) */
  emojiOnly?: boolean;
  className?: string;
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
      setRecentStickers(recentRes.data);
      setInstalledPacks(installedRes.data);
    } catch {
      setRecentStickers([]);
      setInstalledPacks([]);
    } finally {
      setStickersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "stickers") {
      fetchStickers();
    }
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
      <div className={`bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden ${className}`} style={{ width: "320px" }}>
        <div className="p-2 overflow-y-auto scrollbar-hide" style={{ height: CONTENT_HEIGHT_PX }}>
          <div className="grid grid-cols-8 gap-0.5">
            {INPUT_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onSelectEmoji(emoji)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-lg hover:bg-slate-100 transition-colors"
                title={emoji}
              >
                {emoji === "🔥" ? <AnimatedReaction emoji={emoji} size={22} loop /> : emoji}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden ${className}`} style={{ width: "320px" }}>
      <div className="flex border-b border-slate-100">
        <button
          type="button"
          onClick={() => setTab("emoji")}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${tab === "emoji" ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50" : "text-slate-600 hover:bg-slate-50"}`}
        >
          Emoji
        </button>
        <button
          type="button"
          onClick={() => setTab("stickers")}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${tab === "stickers" ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50" : "text-slate-600 hover:bg-slate-50"}`}
        >
          Стикеры
        </button>
        <button
          type="button"
          onClick={() => setTab("gif")}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${tab === "gif" ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50" : "text-slate-600 hover:bg-slate-50"}`}
        >
          GIF
        </button>
      </div>

      {tab === "emoji" && (
        <div className="p-2 overflow-y-auto scrollbar-hide" style={{ height: CONTENT_HEIGHT_PX }}>
          <div className="grid grid-cols-8 gap-0.5">
            {INPUT_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onSelectEmoji(emoji)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-lg hover:bg-slate-100 transition-colors"
                title={emoji}
              >
                {emoji === "🔥" ? <AnimatedReaction emoji={emoji} size={22} loop /> : emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === "stickers" && (
        <div className="flex flex-col" style={{ height: CONTENT_HEIGHT_PX }}>
          <div className="flex border-b border-slate-100 overflow-x-auto shrink-0">
            <button
              type="button"
              onClick={() => setStickerSubTab("recent")}
              className={`px-2 py-1.5 text-xs font-medium whitespace-nowrap ${stickerSubTab === "recent" ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50" : "text-slate-600 hover:bg-slate-50"}`}
            >
              Последние
            </button>
            <button
              type="button"
              onClick={() => setStickerSubTab("default")}
              className={`px-2 py-1.5 text-xs font-medium whitespace-nowrap ${stickerSubTab === "default" ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50" : "text-slate-600 hover:bg-slate-50"}`}
            >
              По умолчанию
            </button>
            {installedPacks.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setStickerSubTab(p.id)}
                className={`px-2 py-1.5 text-xs font-medium whitespace-nowrap truncate max-w-[80px] ${stickerSubTab === p.id ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50" : "text-slate-600 hover:bg-slate-50"}`}
                title={p.title}
              >
                {p.title}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 scrollbar-hide">
            {stickersLoading ? (
              <div className="flex items-center justify-center py-8 text-slate-500 text-sm">Загрузка...</div>
            ) : stickerSubTab === "recent" ? (
              recentStickers.length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-sm">Нет недавних стикеров</div>
              ) : (
                <div className="grid grid-cols-4 gap-1">
                  {recentStickers.map((s) => {
                    const url = s.file?.url;
                    const isLottie = (s.file?.mime_type || "").includes("application/json");
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() =>
                          url &&
                          s.file_id &&
                          onSelectSticker?.({
                            id: s.id,
                            fileId: s.file_id,
                            url,
                            animationUrl: isLottie ? url : undefined,
                          })
                        }
                        className="w-14 h-14 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors p-1"
                        title={s.label || s.emoji}
                      >
                        {url &&
                          (isLottie ? (
                            <LottieSticker animationUrl={url} size={40} />
                          ) : (
                            <img src={url} alt={s.label} className="w-10 h-10 object-contain" />
                          ))}
                      </button>
                    );
                  })}
                </div>
              )
            ) : stickerSubTab === "default" ? (
              <div className="grid grid-cols-4 gap-1">
                {BUNDLED_STICKERS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onSelectSticker?.(s.path)}
                    className="w-14 h-14 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors p-1"
                    title={s.label}
                  >
                    {s.animationUrl ? (
                      <LottieSticker animationUrl={s.animationUrl} size={40} />
                    ) : (
                      <img src={s.path} alt={s.label} className="w-10 h-10 object-contain" />
                    )}
                  </button>
                ))}
              </div>
            ) : (
              (() => {
                const pack = installedPacks.find((p) => p.id === stickerSubTab);
                const stickers = pack?.stickers ?? [];
                if (stickers.length === 0) {
                  return (
                    <div className="py-8 text-center text-slate-500 text-sm">
                      Пустой набор
                      {onManageStickers && (
                        <button
                          type="button"
                          onClick={onManageStickers}
                          className="block mt-2 text-blue-600 hover:underline"
                        >
                          Добавить стикеры
                        </button>
                      )}
                    </div>
                  );
                }
                return (
                  <div className="grid grid-cols-4 gap-1">
                    {stickers.map((s) => {
                      const url = s.file?.url;
                      const isLottie = (s.file?.mime_type || "").includes("application/json");
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() =>
                            url &&
                            s.file_id &&
                            onSelectSticker?.({
                              id: s.id,
                              fileId: s.file_id,
                              url,
                              animationUrl: isLottie ? url : undefined,
                            })
                          }
                          className="w-14 h-14 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors p-1"
                          title={s.label || s.emoji}
                        >
                          {url &&
                            (isLottie ? (
                              <LottieSticker animationUrl={url} size={40} />
                            ) : (
                              <img src={url} alt={s.label} className="w-10 h-10 object-contain" />
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
            <div className="p-2 border-t border-slate-100 shrink-0">
              <button
                type="button"
                onClick={onManageStickers}
                className="text-xs text-blue-600 hover:underline"
              >
                Управление наборами
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "gif" && (
        <div className="flex flex-col" style={{ height: CONTENT_HEIGHT_PX }}>
          <div className="p-2 border-b border-slate-100 shrink-0">
            <input
              type="text"
              value={gifQuery}
              onChange={(e) => setGifQuery(e.target.value)}
              placeholder={t("sticker.searchGif")}
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 scrollbar-hide">
            {gifLoading && gifResults.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-slate-500 text-sm">Загрузка...</div>
            ) : gifResults.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-sm">Введите запрос для поиска</div>
            ) : (
              <div className="grid grid-cols-4 gap-1">
                {gifResults.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => onSelectGif?.(g.url)}
                    className="aspect-square rounded-lg overflow-hidden bg-slate-100 hover:ring-2 hover:ring-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <img
                      src={g.preview_url || g.url}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
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
