import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { chatsApi, paymentsApi, messagesApi, type Chat, type Message, type SubscriptionStatus, type User } from "../api/client";
import { useAuthStore } from "../store/auth";
import { useUnreadStore } from "../store/unread";
import { playSound } from "../lib/sounds";
import { useTranslation, getLocale } from "../lib/i18n";
import CreateChatModal from "../components/CreateChatModal";

const WS_BASE = import.meta.env.VITE_WS_URL || "";
const PREVIEW_MESSAGES_LIMIT = 25;

function getSenderName(msg: Message): string {
  const s = msg.sender as User | undefined;
  return (msg as { sender_display_name?: string }).sender_display_name ?? s?.display_name ?? s?.phone ?? "?";
}

function formatMessagePreview(msg: Message, fileLabel: string): string {
  if (msg.msg_type !== "text" && msg.msg_type !== "emoji") return msg.file ? `📎 ${(msg.file as { original_name?: string })?.original_name ?? msg.content}` : fileLabel;
  return (msg.content || "").slice(0, 200) + ((msg.content?.length ?? 0) > 200 ? "…" : "");
}

function formatUnread(count: number): string {
  if (count <= 0) return "";
  if (count > 999) return "999+";
  return String(count);
}

export default function DashboardPage() {
  const { t, lang } = useTranslation();
  const [chats, setChats] = useState<Chat[]>([]);
  const [sub, setSub] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsSub, setNeedsSub] = useState(false);
  const [preview, setPreview] = useState<{
    chatId: string;
    title: string;
    messages: Message[];
    loading: boolean;
    x: number;
    y: number;
  } | null>(null);
  const clearTokens = useAuthStore((s) => s.clearTokens);
  const token = useAuthStore((s) => s.accessToken);
  const navigate = useNavigate();
  const notifWsRef = useRef<WebSocket | null>(null);
  const previewPopoverRef = useRef<HTMLDivElement | null>(null);
  const [showCreateChatModal, setShowCreateChatModal] = useState(false);

  /* ── Long-press for chat preview on mobile ── */
  const lpChatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpChatFiredRef = useRef(false);
  const lpChatStartRef = useRef<{ x: number; y: number } | null>(null);
  const lpChatTargetRef = useRef<Chat | null>(null);

  /* ---------- Load data ---------- */
  useEffect(() => {
    paymentsApi.getSubscription()
      .then((subRes) => {
        setSub(subRes.data);
        if (!subRes.data.is_valid) {
          setNeedsSub(true);
          setLoading(false);
          return;
        }
        return chatsApi.list().then((res) => {
          const data = res.data;
          const list = Array.isArray(data) ? data : data.results ?? [];
          setChats(list);
          const byChat: Record<string, number> = {};
          for (const c of list) {
            if ((c.unread_count || 0) > 0) byChat[c.id] = c.unread_count!;
          }
          useUnreadStore.getState().setAll(byChat);
        });
      })
      .catch((e) => {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 403) {
          setNeedsSub(true);
        } else {
          setError(t("dashboard.loadError"));
        }
      })
      .finally(() => setLoading(false));
  }, [t]);

  /* ---------- Global notification WebSocket ---------- */
  const handleNotification = useCallback((data: {
    type: string;
    chat_id?: string;
    chat_title?: string;
    message?: { sender_display_name?: string; content?: string };
    is_muted?: boolean;
  }) => {
    if (data.type === "added_to_chat" && data.chat_id) {
      chatsApi.get(data.chat_id).then((chat) => {
        setChats((prev) => (prev.some((c) => c.id === chat.data.id) ? prev : [...prev, chat.data]));
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            new Notification(data.chat_title || chat.data.title, {
              body: t("notification.addedToGroup"),
              icon: "/assets/logo.png",
            });
          } catch { /* */ }
        }
      }).catch(() => {});
      return;
    }
    if (data.type === "new_message") {
      // Increment unread count for the chat
      setChats((prev) =>
        prev.map((c) =>
          c.id === data.chat_id ? { ...c, unread_count: (c.unread_count || 0) + 1 } : c
        )
      );
      if (data.chat_id) useUnreadStore.getState().incrementUnread(data.chat_id);
      if (!data.is_muted) {
        const content = (data.message?.content as string) || "";
        const me = useAuthStore.getState().user;
        const identifiers = [me?.display_name, me?.username, me?.telegram_username].filter(Boolean) as string[];
        const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const isMention = identifiers.some((id) => new RegExp(`@${escapeRegex(id)}\\b`, "i").test(content));
        playSound(isMention ? "mention" : "receive");
        if (document.hidden && "Notification" in window && Notification.permission === "granted") {
          try {
            new Notification(data.chat_title || t("dashboard.newMessage"), {
              body: data.message?.content || t("common.fileMsg"),
              icon: "/assets/logo.png",
            });
          } catch { /* */ }
        }
      }
    }
  }, [t]);

  useEffect(() => {
    if (!token || needsSub) return;
    // Request notification permission
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    const wsUrl =
      (WS_BASE ? WS_BASE.replace(/^http/, "ws") : `${window.location.origin.replace(/^http/, "ws")}`) +
      `/ws/notifications/`;
    const ws = new WebSocket(wsUrl, ["bearer", token]);
    notifWsRef.current = ws;
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleNotification(data);
      } catch { /* */ }
    };
    return () => {
      ws.close();
      notifWsRef.current = null;
    };
  }, [token, needsSub, handleNotification, t]);

  const handleLogout = () => {
    clearTokens();
    navigate("/auth");
  };

  /** Chat preview on right-click (does not mark as read). */
  const handleChatContextMenu = useCallback((e: React.MouseEvent, chat: Chat) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 320);
    const y = Math.min(e.clientY, window.innerHeight - 400);
    setPreview({ chatId: chat.id, title: chat.title, messages: [], loading: true, x, y });
    messagesApi.list(chat.id).then((res) => {
      const list = res.data.slice(-PREVIEW_MESSAGES_LIMIT);
      setPreview((p) => (p?.chatId === chat.id ? { ...p, messages: list, loading: false } : p));
    }).catch(() => {
      setPreview((p) => (p?.chatId === chat.id ? { ...p, messages: [], loading: false } : p));
    });
  }, []);

  const closePreview = useCallback(() => setPreview(null), []);

  const handleChatLongPress = useCallback((chat: Chat, touchX: number, touchY: number) => {
    if (navigator.vibrate) navigator.vibrate(15);
    const x = Math.min(touchX, window.innerWidth - 320);
    const y = Math.min(touchY, window.innerHeight - 400);
    setPreview({ chatId: chat.id, title: chat.title, messages: [], loading: true, x, y });
    messagesApi.list(chat.id).then((res) => {
      const list = res.data.slice(-PREVIEW_MESSAGES_LIMIT);
      setPreview((p) => (p?.chatId === chat.id ? { ...p, messages: list, loading: false } : p));
    }).catch(() => {
      setPreview((p) => (p?.chatId === chat.id ? { ...p, messages: [], loading: false } : p));
    });
  }, []);

  const chatLpHandlers = useMemo(() => ({
    onTouchStart(e: React.TouchEvent, chat: Chat) {
      if (e.touches.length !== 1) return;
      lpChatFiredRef.current = false;
      const touch = e.touches[0];
      lpChatStartRef.current = { x: touch.clientX, y: touch.clientY };
      lpChatTargetRef.current = chat;
      lpChatTimerRef.current = setTimeout(() => {
        lpChatTimerRef.current = null;
        lpChatFiredRef.current = true;
        const c = lpChatTargetRef.current;
        const s = lpChatStartRef.current;
        if (c && s) handleChatLongPress(c, s.x, s.y);
      }, 500);
    },
    onTouchMove(e: React.TouchEvent) {
      if (!lpChatTimerRef.current || e.touches.length !== 1) return;
      const start = lpChatStartRef.current;
      if (!start) return;
      const dx = Math.abs(e.touches[0].clientX - start.x);
      const dy = Math.abs(e.touches[0].clientY - start.y);
      if (dx > 10 || dy > 10) {
        clearTimeout(lpChatTimerRef.current);
        lpChatTimerRef.current = null;
      }
    },
    onTouchEnd() {
      if (lpChatTimerRef.current) { clearTimeout(lpChatTimerRef.current); lpChatTimerRef.current = null; }
    },
    onTouchCancel() {
      if (lpChatTimerRef.current) { clearTimeout(lpChatTimerRef.current); lpChatTimerRef.current = null; }
    },
  }), [handleChatLongPress]);

  useEffect(() => {
    if (!preview) return;
    const handleEscape = (e: KeyboardEvent) => { if (e.key === "Escape") closePreview(); };
    const handleClickOutside = (e: MouseEvent) => {
      if (previewPopoverRef.current && !previewPopoverRef.current.contains(e.target as Node)) closePreview();
    };
    document.addEventListener("keydown", handleEscape);
    document.addEventListener("mousedown", handleClickOutside, true);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("mousedown", handleClickOutside, true);
    };
  }, [preview, closePreview]);

  // Sort: chats with unread first, then by last message time
  const sortedChats = [...chats].sort((a, b) => {
    const ua = a.unread_count || 0;
    const ub = b.unread_count || 0;
    if (ua > 0 && ub === 0) return -1;
    if (ua === 0 && ub > 0) return 1;
    const aTime = (a.last_message_at || a.created_at) ?? a.created_at;
    const bTime = (b.last_message_at || b.created_at) ?? b.created_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Link to="/chats" aria-label={t("dashboard.title")} className="inline-flex items-center">
            <img src="/assets/logo.png" alt={t("landing.brand")} className="h-[3.75rem] w-auto object-contain" />
          </Link>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setShowCreateChatModal(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm">{t("dashboard.createChat")}</button>
            <Link to="/settings" className="text-slate-500 hover:text-slate-700 transition-colors" title={t("common.settings")}>
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </Link>
            <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 transition-colors" title={t("common.logout")}>
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">
        {loading && <p className="text-slate-500">{t("common.loading")}</p>}
        {error && <p className="text-red-500">{error}</p>}

        {/* Paywall banner */}
        {needsSub && !loading && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-6">
            <h2 className="text-lg font-semibold text-amber-900 mb-2">{t("dashboard.needsSub")}</h2>
            <p className="text-sm text-amber-800 mb-4">
              <span dangerouslySetInnerHTML={{ __html: t("dashboard.needsSubDesc") }} />
              {sub?.is_referral_trial && t("dashboard.freeTrialMonth")}
            </p>
            <Link
              to="/settings"
              className="inline-block bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors"
            >
              {t("dashboard.goToPayment")}
            </Link>
          </div>
        )}

        {!needsSub && (
          <>
            <h2 className="text-xl font-semibold text-slate-800 mb-4">{t("dashboard.myChats")}</h2>
            {!loading && !error && chats.length === 0 && <p className="text-slate-500">{t("dashboard.noChats")}</p>}
            {!loading && sortedChats.length > 0 && (
              <ul className="space-y-2">
                {sortedChats.map((chat) => {
                  const unread = chat.unread_count || 0;
                  const unreadStr = formatUnread(unread);
                  return (
                    <li key={chat.id}>
                      <Link
                        to={`/chat/${chat.id}`}
                        className="bg-white rounded-lg border p-4 flex items-center gap-3 hover:border-blue-300 transition-colors"
                        onContextMenu={(e) => handleChatContextMenu(e, chat)}
                        onClick={(e) => { if (lpChatFiredRef.current) { e.preventDefault(); e.stopPropagation(); } }}
                        onTouchStart={(e) => chatLpHandlers.onTouchStart(e, chat)}
                        onTouchMove={chatLpHandlers.onTouchMove}
                        onTouchEnd={chatLpHandlers.onTouchEnd}
                        onTouchCancel={chatLpHandlers.onTouchCancel}
                        title={t("dashboard.contextPreviewHint")}
                      >
                        {/* Unread badge */}
                        <div className="w-10 flex justify-center shrink-0">
                          {unread > 0 ? (
                            chat.manually_unread && unread <= 1 ? (
                              <span className={`inline-block w-3 h-3 rounded-full ${
                                chat.is_muted ? "bg-slate-400" : "bg-blue-600"
                              }`} />
                            ) : (
                              <span
                                className={`inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full text-xs font-bold text-white ${
                                  chat.is_muted ? "bg-slate-400" : "bg-blue-600"
                                }`}
                              >
                                {unreadStr}
                              </span>
                            )
                          ) : (
                            <span className="w-2.5 h-2.5 rounded-full bg-slate-200" />
                          )}
                        </div>

                        {/* Chat info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`font-medium truncate ${unread > 0 ? "text-slate-900" : "text-slate-700"}`}>
                              {chat.is_personal && chat.other_member ? (chat.other_member.display_name || chat.other_member.phone) : chat.title}
                            </span>
                            {chat.is_muted && (
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 shrink-0" aria-label={t("dashboard.muted")}>
                                <path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
                              </svg>
                            )}
                          </div>
                          <span className="text-slate-500 text-sm flex items-center gap-1">
                            {chat.is_secret && (
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-500 shrink-0" aria-hidden>
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                              </svg>
                            )}
                            {chat.is_secret ? t("secretChat.title") : chat.is_personal ? t("dashboard.personalChat") : `${chat.members_count} / ${chat.max_members} · ${chat.chat_type === "open" ? t("dashboard.openType") : t("dashboard.closedType")}`}
                          </span>
                        </div>

                        <span className="text-blue-600 text-sm shrink-0">{t("common.open")}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </main>

      {/* Modal: create chat */}
      <CreateChatModal
        isOpen={showCreateChatModal}
        onClose={() => setShowCreateChatModal(false)}
        onCreated={(chatId) => {
          setShowCreateChatModal(false);
          navigate(`/chat/${chatId}`, { replace: true, state: { inviteLinkCopied: true } });
        }}
      />

      {/* Chat preview (right-click on chat; does not mark as read) */}
      {preview && (
        <div
          ref={previewPopoverRef}
          className="fixed z-50 w-80 max-h-[400px] flex flex-col bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
          style={{ left: preview.x, top: preview.y }}
        >
          <div className="px-3 py-2 border-b bg-slate-50 flex items-center justify-between shrink-0">
            <span className="font-semibold text-slate-800 truncate">{preview.title}</span>
            <button
              type="button"
              onClick={closePreview}
              className="text-slate-400 hover:text-slate-600 p-1 rounded"
              aria-label={t("common.close")}
            >
              &#10005;
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 min-h-0">
            {preview.loading ? (
              <p className="text-slate-500 text-sm py-4 text-center">{t("common.loading")}</p>
            ) : preview.messages.length === 0 ? (
              <p className="text-slate-500 text-sm py-4 text-center">{t("dashboard.noChatMessages")}</p>
            ) : (
              <ul className="space-y-2">
                {preview.messages.map((msg) => (
                  <li key={msg.id} className="text-sm">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-slate-500 shrink-0">
                        {getSenderName(msg)} · {new Date(msg.created_at).toLocaleTimeString(getLocale(lang), { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="text-slate-800 mt-0.5 break-words whitespace-pre-wrap">{formatMessagePreview(msg, "📎 " + t("common.file"))}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="px-3 py-1.5 border-t bg-slate-50 text-xs text-slate-500 shrink-0">
            {t("dashboard.previewNote")}
          </div>
        </div>
      )}
    </div>
  );
}
