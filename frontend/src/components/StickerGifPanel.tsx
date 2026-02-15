import { useState, useEffect, useCallback, useRef } from "react";
import { gifApi, type GifResult } from "../api/client";
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

interface StickerGifPanelProps {
  /** Insert emoji into text input */
  onSelectEmoji: (emoji: string) => void;
  onSelectGif: (url: string) => void;
  /** Sticker path (e.g. /stickers/default/smile.svg) */
  onSelectSticker: (path: string) => void;
  className?: string;
}

export function StickerGifPanel({ onSelectEmoji, onSelectGif, onSelectSticker, className = "" }: StickerGifPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("emoji");
  const [gifQuery, setGifQuery] = useState("");
  const [gifResults, setGifResults] = useState<GifResult[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [, setGifNext] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef("");

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
        <div className="p-2 overflow-y-auto scrollbar-hide" style={{ height: CONTENT_HEIGHT_PX }}>
          <div className="grid grid-cols-4 gap-1">
            {BUNDLED_STICKERS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectSticker(s.path)}
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
                    onClick={() => onSelectGif(g.url)}
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
