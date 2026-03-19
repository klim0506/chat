import { useState, useEffect, useCallback, useRef } from "react";
import { gifApi, stickersApi, type GifResult, type Sticker as ApiSticker, type StickerPack } from "../api/client";
import { useTranslation } from "../lib/i18n";
import { LottieSticker } from "./LottieSticker";
import { TELEGRAM_EMOJI_CATEGORIES } from "../data/telegram-emojis";
import { EmojiCategoryList } from "./EmojiCategoryList";
import { MediaImage } from "./MediaImage";

const DEBOUNCE_MS = 300;
const CONTENT_HEIGHT_PX = 8 * 32 + 7 * 2;

const BUNDLED_STICKERS = [
  { id: "fire", path: "/stickers/default/fire.svg", label: "Fire", animationUrl: "/animations/reactions/fire.json" },
  { id: "heart", path: "/stickers/default/heart.svg", label: "Heart" },
  { id: "party", path: "/stickers/default/party.svg", label: "Party" },
  { id: "smile", path: "/stickers/default/smile.svg", label: "Smile" },
  { id: "thumbsup", path: "/stickers/default/thumbsup.svg", label: "Thumbs up" },
  { id: "wave", path: "/stickers/default/wave.svg", label: "Wave" },
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

function StickerGrid({
  stickers,
  onSelectSticker,
}: {
  stickers: Array<{ id: string; label?: string; path?: string; animationUrl?: string; fileId?: string; url?: string; emoji?: string }>;
  onSelectSticker?: (pathOrSticker: StickerSelection) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-1">
      {stickers.map((sticker) => {
        const title = sticker.label || sticker.emoji || "Sticker";
        return (
          <button
            key={sticker.id}
            type="button"
            onClick={() => {
              if (!onSelectSticker) return;
              if (sticker.fileId && sticker.url) {
                onSelectSticker({
                  id: sticker.id,
                  fileId: sticker.fileId,
                  url: sticker.url,
                  animationUrl: sticker.animationUrl,
                });
                return;
              }
              if (sticker.path) onSelectSticker(sticker.path);
            }}
            className="ui-picker-tile flex h-14 w-14 items-center justify-center rounded-lg p-1"
            title={title}
          >
            {sticker.animationUrl ? (
              <LottieSticker animationUrl={sticker.animationUrl} size={40} />
            ) : sticker.url || sticker.path ? (
              <MediaImage source={sticker.url || sticker.path} alt={title} className="h-10 w-10 object-contain" loading="lazy" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function StickerGifPanel({
  onSelectEmoji,
  onSelectGif,
  onSelectSticker,
  onManageStickers,
  refreshToken,
  emojiOnly,
  className = "",
}: StickerGifPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("emoji");
  const [gifQuery, setGifQuery] = useState("");
  const [gifResults, setGifResults] = useState<GifResult[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [stickerSubTab, setStickerSubTab] = useState<"recent" | "default" | string>("recent");
  const [recentStickers, setRecentStickers] = useState<ApiSticker[]>([]);
  const [installedPacks, setInstalledPacks] = useState<StickerPack[]>([]);
  const [packStickersById, setPackStickersById] = useState<Record<string, ApiSticker[]>>({});
  const [stickersLoading, setStickersLoading] = useState(false);
  const [packLoadingId, setPackLoadingId] = useState<string | null>(null);

  const fetchStickers = useCallback(async () => {
    setStickersLoading(true);
    try {
      const [recentRes, installedRes] = await Promise.all([
        stickersApi.listRecent().catch(() => ({ data: [] })),
        stickersApi.listInstalled().catch(() => ({ data: [] })),
      ]);

      const nextRecent = recentRes.data ?? [];
      const nextInstalled = installedRes.data ?? [];

      setRecentStickers(nextRecent);
      setInstalledPacks(nextInstalled);
      setPackStickersById((prev) => {
        const next = { ...prev };
        nextInstalled.forEach((pack) => {
          if (pack.stickers) next[pack.id] = pack.stickers;
        });
        return next;
      });
      setStickerSubTab((prev) => {
        if (prev === "default") return prev;
        if (prev === "recent" && nextRecent.length > 0) return prev;
        if (prev !== "recent" && prev !== "default" && nextInstalled.some((pack) => pack.id === prev)) return prev;
        return nextRecent.length > 0 ? "recent" : "default";
      });
    } catch {
      setRecentStickers([]);
      setInstalledPacks([]);
      setPackStickersById({});
      setStickerSubTab("default");
    } finally {
      setStickersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "stickers") {
      fetchStickers();
    }
  }, [tab, fetchStickers, refreshToken]);

  useEffect(() => {
    if (tab !== "stickers") return;
    if (stickerSubTab === "recent" || stickerSubTab === "default") return;
    if (packStickersById[stickerSubTab]) return;

    let cancelled = false;
    setPackLoadingId(stickerSubTab);

    stickersApi.getPack(stickerSubTab)
      .then((res) => {
        if (cancelled) return;
        setPackStickersById((prev) => ({ ...prev, [stickerSubTab]: res.data.stickers ?? [] }));
      })
      .catch(() => {
        if (cancelled) return;
        setPackStickersById((prev) => ({ ...prev, [stickerSubTab]: [] }));
      })
      .finally(() => {
        if (!cancelled) {
          setPackLoadingId((current) => (current === stickerSubTab ? null : current));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tab, stickerSubTab, packStickersById]);

  const fetchGifs = useCallback(async (q: string) => {
    setGifLoading(true);
    try {
      const res = q.trim() ? await gifApi.search(q, { limit: 20 }) : await gifApi.trending(20);
      setGifResults(res.data.results);
    } catch {
      setGifResults([]);
    } finally {
      setGifLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      if (tab === "gif") fetchGifs(gifQuery);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [tab, gifQuery, fetchGifs]);

  const currentPackStickers = stickerSubTab !== "recent" && stickerSubTab !== "default"
    ? packStickersById[stickerSubTab] ?? []
    : [];

  const recentStickerCards = recentStickers.map((sticker) => {
    const url = sticker.file?.url || "";
    const isLottie = (sticker.file?.mime_type || "").includes("application/json");
    return {
      id: sticker.id,
      label: sticker.label,
      emoji: sticker.emoji,
      fileId: sticker.file_id || undefined,
      url,
      animationUrl: isLottie ? url : undefined,
    };
  }).filter((sticker) => Boolean(sticker.fileId && sticker.url));

  const currentPackCards = currentPackStickers.map((sticker) => {
    const url = sticker.file?.url || "";
    const isLottie = (sticker.file?.mime_type || "").includes("application/json");
    return {
      id: sticker.id,
      label: sticker.label,
      emoji: sticker.emoji,
      fileId: sticker.file_id || undefined,
      url,
      animationUrl: isLottie ? url : undefined,
    };
  }).filter((sticker) => Boolean(sticker.fileId && sticker.url));

  if (emojiOnly) {
    return (
      <div className={`ui-popover-surface overflow-hidden rounded-xl ${className}`} style={{ width: "320px" }}>
        <EmojiCategoryList categories={TELEGRAM_EMOJI_CATEGORIES} onSelectEmoji={onSelectEmoji} height={CONTENT_HEIGHT_PX} />
      </div>
    );
  }

  return (
    <div className={`ui-popover-surface overflow-hidden rounded-xl ${className}`} style={{ width: "320px" }}>
      <div className="flex border-b border-slate-100">
        <button
          type="button"
          onClick={() => setTab("emoji")}
          className={`flex-1 border-b py-2 text-sm font-medium transition-colors ${tab === "emoji" ? "border-blue-500 bg-blue-50/50 text-blue-600" : "border-transparent text-slate-600 hover:bg-slate-50/70"}`}
        >
          Emoji
        </button>
        <button
          type="button"
          onClick={() => setTab("stickers")}
          className={`flex-1 border-b py-2 text-sm font-medium transition-colors ${tab === "stickers" ? "border-blue-500 bg-blue-50/50 text-blue-600" : "border-transparent text-slate-600 hover:bg-slate-50/70"}`}
        >
          Stickers
        </button>
        <button
          type="button"
          onClick={() => setTab("gif")}
          className={`flex-1 border-b py-2 text-sm font-medium transition-colors ${tab === "gif" ? "border-blue-500 bg-blue-50/50 text-blue-600" : "border-transparent text-slate-600 hover:bg-slate-50/70"}`}
        >
          GIF
        </button>
      </div>

      {tab === "emoji" && (
        <EmojiCategoryList categories={TELEGRAM_EMOJI_CATEGORIES} onSelectEmoji={onSelectEmoji} height={CONTENT_HEIGHT_PX} />
      )}

      {tab === "stickers" && (
        <div className="flex flex-col" style={{ height: CONTENT_HEIGHT_PX }}>
          <div className="flex shrink-0 overflow-x-auto border-b border-slate-100">
            <button
              type="button"
              onClick={() => setStickerSubTab("recent")}
              className={`px-2 py-1.5 text-xs font-medium whitespace-nowrap border-b transition-colors ${stickerSubTab === "recent" ? "border-blue-500 bg-blue-50/50 text-blue-600" : "border-transparent text-slate-600 hover:bg-slate-50/70"}`}
            >
              Recent
            </button>
            <button
              type="button"
              onClick={() => setStickerSubTab("default")}
              className={`px-2 py-1.5 text-xs font-medium whitespace-nowrap border-b transition-colors ${stickerSubTab === "default" ? "border-blue-500 bg-blue-50/50 text-blue-600" : "border-transparent text-slate-600 hover:bg-slate-50/70"}`}
            >
              Default
            </button>
            {installedPacks.map((pack) => (
              <button
                key={pack.id}
                type="button"
                onClick={() => setStickerSubTab(pack.id)}
                className={`max-w-[96px] truncate px-2 py-1.5 text-xs font-medium whitespace-nowrap border-b transition-colors ${stickerSubTab === pack.id ? "border-blue-500 bg-blue-50/50 text-blue-600" : "border-transparent text-slate-600 hover:bg-slate-50/70"}`}
                title={pack.title}
              >
                {pack.title}
              </button>
            ))}
          </div>
          <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto p-2">
            {stickersLoading ? (
              <div className="flex items-center justify-center py-8 text-sm text-slate-500">Loading...</div>
            ) : stickerSubTab === "recent" ? (
              recentStickerCards.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-500">No recent stickers</div>
              ) : (
                <StickerGrid stickers={recentStickerCards} onSelectSticker={onSelectSticker} />
              )
            ) : stickerSubTab === "default" ? (
              <StickerGrid stickers={BUNDLED_STICKERS} onSelectSticker={onSelectSticker} />
            ) : packLoadingId === stickerSubTab ? (
              <div className="flex items-center justify-center py-8 text-sm text-slate-500">Loading pack...</div>
            ) : currentPackCards.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">
                Empty pack
                {onManageStickers && (
                  <button type="button" onClick={onManageStickers} className="mt-2 block w-full text-blue-600 hover:underline">
                    Add stickers
                  </button>
                )}
              </div>
            ) : (
              <StickerGrid stickers={currentPackCards} onSelectSticker={onSelectSticker} />
            )}
          </div>
          {onManageStickers && (
            <div className="shrink-0 border-t border-slate-100 p-2">
              <button type="button" onClick={onManageStickers} className="text-xs text-blue-600 hover:underline">
                Manage sticker packs
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
              <div className="flex items-center justify-center py-8 text-sm text-slate-500">Loading...</div>
            ) : gifResults.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">Enter a search query</div>
            ) : (
              <div className="grid grid-cols-4 gap-1">
                {gifResults.map((gif) => (
                  <button
                    key={gif.id}
                    type="button"
                    onClick={() => onSelectGif?.(gif.url)}
                    className="ui-picker-tile aspect-square overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
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
