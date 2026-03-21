import { useEffect, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { channelsApi, channelPostsApi, filesApi, paymentsApi } from "../api/client";
import type { Channel, ChannelPost, SubscriptionStatus } from "../api/client";
import { userDisplayName } from "../api/client";
import { useTranslation } from "../lib/i18n";
import { usePremiumModalStore } from "../store/premiumModal";
import { ProgressiveImage } from "../components/ProgressiveImage";
import { MediaImage } from "../components/MediaImage";
import SendIcon from "../components/icons/SendIcon";
import { REACTIONS } from "../lib/reaction-animations";

const MAX_IMAGES = 10;
const REACTION_EMOJIS = REACTIONS.map((r) => r.emoji);

function ViewsBadge({ count }: { count: number | undefined }) {
  const n = typeof count === "number" ? count : 0;
  return (
    <span className="inline-flex items-center gap-1 text-slate-400 text-xs">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      <span className="tabular-nums">{n}</span>
    </span>
  );
}

function PostContent({ post }: { post: ChannelPost }) {
  const content = post.content?.trim() || "";
  if (!content) return null;
  return (
    <div className="markdown-message text-slate-800 prose prose-slate max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          s: ({ children }) => <s className="line-through">{children}</s>,
          a: ({ href, children, ...props }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-blue-600 hover:text-blue-800" {...props}>
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="list-disc list-inside my-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside my-1">{children}</ol>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function PostImagePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-slate-100 group">
      <img src={url} alt="" className="w-full h-full object-cover" />
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/50 text-white rounded-full flex items-center justify-center text-xs hover:bg-black/70"
      >
        ×
      </button>
    </div>
  );
}

function PostImages({ post }: { post: ChannelPost }) {
  const files = post.files ?? [];
  const single = post.file && !files.length;
  const images = single ? [post.file!] : files;
  if (!images.length) return null;
  const urls = images
    .slice(0, 9)
    .map((f) => (f && typeof f === "object" && "url" in f ? ((f as { url?: string | null }).url || "") : ""))
    .filter(Boolean);
  if (urls.length === 0) return null;
  if (urls.length === 1) {
    return (
      <div className="rounded-xl overflow-hidden max-w-full my-1">
        <ProgressiveImage src={urls[0]} alt="" className="max-h-[400px] w-full object-contain" />
      </div>
    );
  }
  const gridCols = urls.length === 2 ? "grid-cols-2" : "grid-cols-3";
  return (
    <div className={`grid ${gridCols} gap-1 rounded-xl overflow-hidden my-1 max-w-full`}>
      {urls.map((url, i) => (
        <div key={i} className="aspect-square overflow-hidden bg-slate-100">
          <ProgressiveImage src={url} alt="" className="w-full h-full object-cover" />
        </div>
      ))}
    </div>
  );
}

interface ChannelPageProps {
  embed?: boolean;
  onBack?: () => void;
}

export default function ChannelPage({ embed, onBack }: ChannelPageProps) {
  const { channelId } = useParams<{ channelId: string }>();
  const { t } = useTranslation();
  const openPremiumModal = usePremiumModalStore((s) => s.openModal);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [posts, setPosts] = useState<ChannelPost[]>([]);
  const [subscriptionState, setSubscriptionState] = useState<Pick<SubscriptionStatus, "is_valid" | "has_subscription"> | null>(() => {
    try {
      const raw = localStorage.getItem("subscription_cache_v1");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Pick<SubscriptionStatus, "is_valid" | "has_subscription"> | null;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [content, setContent] = useState("");
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [muteLoading, setMuteLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!channelId) return;
    setLoading(true);
    setError("");
    Promise.all([channelsApi.get(channelId), channelPostsApi.list(channelId)])
      .then(([chRes, postsRes]) => {
        setChannel(chRes.data);
        setPosts(postsRes.data);
      })
      .catch(() => setError(t("channelPage.channelNotFound")))
      .finally(() => setLoading(false));
  }, [channelId, t]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [posts]);

  useEffect(() => {
    paymentsApi
      .getSubscription()
      .then((res) => {
        const next = {
          is_valid: res.data.is_valid,
          has_subscription: res.data.has_subscription,
        };
        setSubscriptionState(next);
        localStorage.setItem("subscription_cache_v1", JSON.stringify(next));
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  const loadPosts = () => {
    if (!channelId) return;
    channelPostsApi.list(channelId).then((res) => setPosts(res.data));
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    setImageFiles((prev) => [...prev.slice(0, MAX_IMAGES - files.length), ...files].slice(0, MAX_IMAGES));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeImage = (index: number) => {
    setImageFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePublish = async () => {
    if (!channelId || (!content.trim() && imageFiles.length === 0)) return;
    if (!(channel?.my_role === "owner" || channel?.my_role === "admin")) return;
    if (subscriptionState?.is_valid !== true) {
      openPremiumModal();
      return;
    }
    setPublishing(true);
    setPublishError("");
    try {
      let fileIds: string[] = [];
      if (imageFiles.length > 0) {
        const uploads = await Promise.all(imageFiles.map((f) => filesApi.upload(f)));
        fileIds = uploads.map((r) => r.data.id);
      }
      await channelPostsApi.create(channelId, {
        msg_type: "text",
        content: content.trim() || undefined,
        file_ids: fileIds.length > 0 ? fileIds : undefined,
      });
      setContent("");
      setImageFiles([]);
      loadPosts();
    } catch {
      setPublishError(t("channelPage.publishError"));
    } finally {
      setPublishing(false);
    }
  };

  if (loading) {
    return (
      <div className={`flex items-center justify-center ${embed ? "flex-1 min-h-0" : "min-h-screen bg-slate-50"}`}>
        <p className="text-slate-500">{t("channelPage.loading")}</p>
      </div>
    );
  }

  if (error || !channel) {
    return (
      <div className={`flex flex-col items-center justify-center gap-4 p-4 ${embed ? "flex-1 min-h-0" : "min-h-screen bg-slate-50"}`}>
        <p className="text-red-600">{error || t("channelPage.channelNotFound")}</p>
        {embed && onBack ? (
          <button type="button" onClick={onBack} className="text-blue-600 hover:underline">{t("channelPage.backToChats")}</button>
        ) : (
          <Link to="/chats" className="text-blue-600 hover:underline">{t("channelPage.backToChats")}</Link>
        )}
      </div>
    );
  }

  const hasChannelAuthorRole = channel.my_role === "owner" || channel.my_role === "admin";

  const BackButton = embed && onBack ? (
    <button
      type="button"
      onClick={onBack}
      className="p-2 -ml-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
      aria-label={t("channelPage.backToChats")}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m15 18-6-6 6-6" />
      </svg>
    </button>
  ) : (
    <Link to="/chats" className="p-2 -ml-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors" aria-label={t("channelPage.backToChats")}>
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m15 18-6-6 6-6" />
      </svg>
    </Link>
  );

  return (
    <div className={`flex flex-col h-full ${embed ? "min-h-0" : "min-h-screen bg-slate-50"}`}>
      {/* Header — как в чате */}
      <header className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-slate-200 bg-white">
        {BackButton}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {channel.avatar_url && (
            <MediaImage source={channel.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
          )}
          <div className="min-w-0">
            <h1 className="font-semibold text-slate-800 truncate">
              {channel.title}
              {channel.title_icon && <span className="ml-1" aria-hidden>{channel.title_icon}</span>}
            </h1>
            {channel.username && <p className="text-sm text-slate-500 truncate">@{channel.username}</p>}
          </div>
        </div>
      </header>

      {/* Лента постов — как сообщения в чате */}
      <main className="flex-1 min-h-0 overflow-y-auto px-4 py-3 bg-slate-50">
        {posts.length === 0 && (
          <p className="text-slate-500 text-center py-12">{t("channelPage.noPosts")}</p>
        )}
        <div className="space-y-3">
          {posts.map((post) => (
            <div key={post.id} className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-4 py-2.5 shadow-sm border border-slate-200/80">
                <div className="flex items-center gap-2 mb-1">
                  {post.author && (
                    <span className="font-medium text-slate-800 text-sm">{userDisplayName(post.author)}</span>
                  )}
                  <span className="text-slate-400 text-xs">
                    {new Date(post.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </div>
                <PostImages post={post} />
                <PostContent post={post} />
                <div className="flex items-center justify-between gap-2 mt-2">
                  <div className="flex flex-wrap gap-1">
                    {REACTION_EMOJIS.slice(0, 6).map((emoji) => {
                      const count = post.reactions?.[emoji] ?? 0;
                      const active = (post.my_reactions || []).includes(emoji);
                      return (
                        <button
                          key={emoji}
                          type="button"
                          onClick={async () => {
                            if (!channelId) return;
                            try {
                              const { data } = await channelPostsApi.setReaction(channelId, post.id, emoji);
                              setPosts((prev) => prev.map((p) => (p.id === post.id ? data : p)));
                            } catch {
                              // ignore
                            }
                          }}
                          className={`px-2 py-1 rounded-full text-xs border transition-colors ${
                            active ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                          }`}
                          title={emoji}
                        >
                          <span className="mr-1">{emoji}</span>
                          <span className="tabular-nums">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                  <ViewsBadge count={post.views_count} />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div ref={messagesEndRef} />
      </main>

      {/* Input — только для автора */}
      {hasChannelAuthorRole ? (
        <div className="shrink-0 border-t border-slate-200 bg-white p-3">
          <div className="flex flex-col gap-2">
            {imageFiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {imageFiles.map((file, i) => (
                  <PostImagePreview key={i} file={file} onRemove={() => removeImage(i)} />
                ))}
              </div>
            )}
            <div className="flex gap-2 items-end">
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageChange} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 shrink-0"
                title={t("channelPage.addPhotos")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                </svg>
              </button>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t("channelPage.contentPlaceholder")}
                className="flex-1 min-h-[44px] max-h-32 resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                rows={1}
              />
              <button
                type="button"
                onClick={handlePublish}
                disabled={publishing || (!content.trim() && imageFiles.length === 0)}
                className="p-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 shrink-0"
              >
                <SendIcon size={20} />
              </button>
            </div>
            {publishError && <p className="text-red-600 text-sm">{publishError}</p>}
          </div>
        </div>
      ) : (
        <div className="shrink-0 border-t border-slate-200 bg-white p-3">
          <button
            type="button"
            disabled={muteLoading}
            onClick={async () => {
              if (!channelId) return;
              setMuteLoading(true);
              try {
                const res = await channelsApi.toggleMute(channelId);
                setChannel((c) => (c ? { ...c, is_muted: res.data.is_muted } : c));
              } finally {
                setMuteLoading(false);
              }
            }}
            className={`w-full h-12 rounded-xl text-sm font-semibold transition-colors ${
              channel.is_muted ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            } disabled:opacity-50`}
          >
            {channel.is_muted ? "Вкл. звук" : "Выкл. звук"}
          </button>
        </div>
      )}
    </div>
  );
}
