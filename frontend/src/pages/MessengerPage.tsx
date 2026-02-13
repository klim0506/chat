import { useEffect, useState, useRef, useCallback } from "react";
import { Link, useNavigate, useParams, useLocation } from "react-router-dom";
import { authApi, chatsApi, paymentsApi, type Chat, type UserSearchResult } from "../api/client";
import { useAuthStore } from "../store/auth";
import { getAvatarInitials } from "../lib/avatar-initials";
import { showMessageNotification, requestPermission } from "../lib/notifications";
import ChatPage from "./ChatPage";
import SettingsPage from "./SettingsPage";

const WS_BASE = import.meta.env.VITE_WS_URL || "";

/** Превью сообщения для списка чатов (совпадает с логикой бэкенда get_last_message_preview). */
function formatMessagePreview(msg: { msg_type?: string; content?: string; file?: { mime_type?: string } }): string {
  if (!msg) return "";
  const mime = (msg.file && msg.file.mime_type) || "";
  if (msg.msg_type === "video" || msg.msg_type === "video_circle" || String(mime).startsWith("video/")) return "(видео)";
  if (msg.msg_type === "audio") return "(голосовое)";
  if (String(mime).startsWith("image/")) return "(фото)";
  if (msg.msg_type === "file") return "(файл)";
  const text = (msg.content || "").trim();
  if (!text) return "(сообщение)";
  return text.length > 60 ? text.slice(0, 60) + "…" : text;
}

function formatUnread(count: number): string {
  if (count <= 0) return "";
  if (count > 999) return "999+";
  return String(count);
}

function withPreviewParams(url: string | null | undefined, width: number): string | null {
  if (!url) return url || null;
  try {
    const u = new URL(url, window.location.origin);
    if (!u.searchParams.has("w")) u.searchParams.set("w", String(width));
    if (!u.searchParams.has("preview")) u.searchParams.set("preview", "1");
    return u.toString();
  } catch {
    return url;
  }
}

export default function MessengerPage() {
  const { chatId: urlChatId } = useParams<{ chatId: string }>();
  const location = useLocation();
  const showSettings = location.pathname === "/dashboard/settings";
  const [activeChatId, setActiveChatId] = useState<string | null>(urlChatId || null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [, setSub] = useState<{ is_valid?: boolean; is_referral_trial?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsSub, setNeedsSub] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [userSearchResults, setUserSearchResults] = useState<UserSearchResult[]>([]);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const userSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const w = localStorage.getItem("sidebarWidth");
      const n = w ? Number(w) : 320;
      return Number.isFinite(n) ? Math.min(520, Math.max(220, n)) : 320;
    } catch {
      return 320;
    }
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const clearTokens = useAuthStore((s) => s.clearTokens);
  const token = useAuthStore((s) => s.accessToken);
  const navigate = useNavigate();
  const notifWsRef = useRef<WebSocket | null>(null);
  const [showInviteLinkCopiedToast, setShowInviteLinkCopiedToast] = useState(false);
  const [inviteToastIsChatLink, setInviteToastIsChatLink] = useState(false);
  const [showJoinByLinkModal, setShowJoinByLinkModal] = useState(false);
  const [joinLinkInput, setJoinLinkInput] = useState("");
  const [joinStatus, setJoinStatus] = useState<"idle" | "loading" | "joined" | "pending" | "error">("idle");
  const [joinMessage, setJoinMessage] = useState("");
  /** Контекстное меню по правому клику на чат */
  const [chatContextMenu, setChatContextMenu] = useState<{ x: number; y: number; chat: Chat } | null>(null);
  const MAX_PINNED = 5;
  /** Закреплённые чаты (localStorage, для сортировки; не более MAX_PINNED) */
  const [pinnedChatIds, setPinnedChatIds] = useState<string[]>(() => {
    try {
      const s = localStorage.getItem("pinned_chat_ids");
      const arr = s ? JSON.parse(s) : [];
      return Array.isArray(arr) ? arr.slice(0, MAX_PINNED) : [];
    } catch {
      return [];
    }
  });
  const upsertChat = useCallback((chat: Chat, updates?: Partial<Chat>) => {
    setChats((prev) => {
      const idx = prev.findIndex((c) => c.id === chat.id);
      if (idx === -1) return [{ ...chat, ...(updates || {}) }, ...prev];
      const next = [...prev];
      next[idx] = { ...next[idx], ...chat, ...(updates || {}) };
      return next;
    });
  }, []);

  // Toast: ссылка скопирована при создании чата (группа — приглашение, личный — ссылка на чат)
  useEffect(() => {
    const state = location.state as { inviteLinkCopied?: boolean } | null;
    if (state?.inviteLinkCopied) {
      setInviteToastIsChatLink(false);
      setShowInviteLinkCopiedToast(true);
      navigate(location.pathname, { replace: true, state: {} });
      const t = setTimeout(() => setShowInviteLinkCopiedToast(false), 2000);
      return () => clearTimeout(t);
    }
  }, [location.state, location.pathname, navigate]);

  // Sync URL with active chat / settings
  useEffect(() => {
    if (location.pathname === "/dashboard/settings") {
      setActiveChatId(null);
    } else if (urlChatId && urlChatId !== activeChatId) {
      setActiveChatId(urlChatId);
    }
  }, [location.pathname, urlChatId]);

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
          setChats(Array.isArray(data) ? data : data.results ?? []);
        });
      })
      .catch((e) => {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 403) {
          setNeedsSub(true);
        } else {
          setError("Не удалось загрузить чаты");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  /* ---------- Global notification WebSocket ---------- */
  const handleNotification = useCallback((data: {
    type: string;
    chat_id: string;
    chat_title: string;
    message: { sender_display_name?: string; content?: string };
    is_muted: boolean;
  }) => {
    if (data.type === "new_message") {
      const preview = data.message ? formatMessagePreview(data.message) : undefined;
      let found = false;
      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== data.chat_id) return c;
          found = true;
          return {
            ...c,
            unread_count: c.id === activeChatId ? c.unread_count : (c.unread_count || 0) + 1,
            last_message_preview: preview ?? c.last_message_preview,
          };
        })
      );
      if (!found) {
        chatsApi.get(data.chat_id).then((res) => {
          upsertChat(res.data, {
            unread_count: activeChatId === data.chat_id ? res.data.unread_count : (res.data.unread_count || 0) + 1,
            last_message_preview: preview ?? res.data.last_message_preview,
          });
        }).catch(() => {
          const now = new Date().toISOString();
          const stubOwner = { id: data.chat_id, phone: "", display_name: data.chat_title || "User", avatar: null };
          upsertChat({
            id: data.chat_id,
            title: data.chat_title || "Новый чат",
            description: "",
            slug: "",
            chat_type: "open",
            is_personal: false,
            max_members: 100,
            effective_max_members: 100,
            owner: stubOwner,
            members_count: 2,
            invite_link: null,
            is_active: true,
            created_at: now,
            unread_count: 1,
            is_muted: false,
            is_expanded: false,
            expanded_until: null,
            avatar_url: null,
            background_url: null,
          } as Chat, {
            last_message_preview: preview || "",
          });
        });
      }
      if (!data.is_muted && document.hidden) {
        showMessageNotification(data.chat_title || "Новое сообщение", data.message || {});
      }
    }
  }, [activeChatId, upsertChat]);

  useEffect(() => {
    if (!token || needsSub) return;
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      requestPermission();
    }
    const wsUrl =
      (WS_BASE ? WS_BASE.replace(/^http/, "ws") : `${window.location.origin.replace(/^http/, "ws")}`) +
      `/ws/notifications/`;
    const ws = new WebSocket(wsUrl, ["bearer", token]);
    notifWsRef.current = ws;
    let cancelled = false;
    ws.onopen = () => {
      if (cancelled) ws.close();
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleNotification(data);
      } catch { /* */ }
    };
    return () => {
      cancelled = true;
      notifWsRef.current = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
        ws.close();
      }
      /* When CONNECTING, we don't close here to avoid "closed before established" console error; onopen will close if cancelled */
    };
  }, [token, needsSub, handleNotification]);

  const handleLogout = () => {
    clearTokens();
    navigate("/auth");
  };

  // Close menu on click outside
  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  const openChat = (chatId: string) => {
    setActiveChatId(chatId);
    setChats((prev) => prev.map((c) => c.id === chatId ? { ...c, unread_count: 0 } : c));
    navigate(`/chat/${chatId}`, { replace: true });
  };

  const closeChat = () => {
    setActiveChatId(null);
    navigate("/dashboard", { replace: true });
  };

  const closeSettings = () => {
    navigate("/dashboard", { replace: true });
  };

  // Sort: pinned first (preserve pin order), then unread first, then by created_at
  // TODO: persist pin order on backend so multi-device ordering stays consistent.
  const sortedChats = [...chats].sort((a, b) => {
    const ia = pinnedChatIds.indexOf(a.id);
    const ib = pinnedChatIds.indexOf(b.id);
    const aPinned = ia !== -1;
    const bPinned = ib !== -1;
    if (aPinned || bPinned) {
      if (!aPinned) return 1;
      if (!bPinned) return -1;
      return ia - ib;
    }
    const ua = a.unread_count || 0;
    const ub = b.unread_count || 0;
    if (ua > 0 && ub === 0) return -1;
    if (ua === 0 && ub > 0) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const q = searchQuery.trim().toLowerCase();
  const filteredChats = q
    ? sortedChats.filter((c) => {
        const title = (c.title || "").toLowerCase();
        const otherName = (c.is_personal && c.other_member)
          ? (c.other_member.display_name || c.other_member.phone || (c.other_member as { username?: string }).username || "").toLowerCase()
          : "";
        const otherUsername = (c.is_personal && c.other_member && (c.other_member as { username?: string }).username)
          ? String((c.other_member as { username?: string }).username || "").toLowerCase()
          : "";
        return title.includes(q) || otherName.includes(q) || otherUsername.includes(q);
      })
    : sortedChats;

  const rightPanelOpen = !!activeChatId || showSettings;
  const showRightPanel = rightPanelOpen || chats.length === 0;

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      setSidebarWidth(Math.min(520, Math.max(220, startW + dx)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    try {
      localStorage.setItem("sidebarWidth", String(sidebarWidth));
    } catch { /* ignore */ }
  }, [sidebarWidth]);

  useEffect(() => {
    try {
      localStorage.setItem("pinned_chat_ids", JSON.stringify(pinnedChatIds));
    } catch { /* ignore */ }
  }, [pinnedChatIds]);

  // Закрытие контекстного меню при клике снаружи
  useEffect(() => {
    if (!chatContextMenu) return;
    const close = () => setChatContextMenu(null);
    const t = setTimeout(() => document.addEventListener("mousedown", close), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", close);
    };
  }, [chatContextMenu]);

  const togglePin = useCallback((chatId: string) => {
    setPinnedChatIds((prev) => {
      if (prev.includes(chatId)) return prev.filter((id) => id !== chatId);
      if (prev.length >= MAX_PINNED) return prev;
      return [...prev, chatId];
    });
    setChatContextMenu(null);
  }, []);

  const handleToggleMute = useCallback(
    async (chat: Chat) => {
      try {
        const { data } = await chatsApi.toggleMute(chat.id);
        setChats((prev) =>
          prev.map((c) => (c.id === chat.id ? { ...c, is_muted: data.is_muted } : c))
        );
      } catch { /* ignore */ }
      setChatContextMenu(null);
    },
    []
  );

  const handleMarkUnread = useCallback(
    async (chat: Chat) => {
      try {
        await chatsApi.markUnread(chat.id);
        setChats((prev) =>
          prev.map((c) => (c.id === chat.id ? { ...c, unread_count: Math.max(1, (c.unread_count || 0)) } : c))
        );
      } catch { /* ignore */ }
      setChatContextMenu(null);
    },
    []
  );

  // Единый поиск: по чатам (filteredChats) и по юзернеймам (debounced API)
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setUserSearchResults([]);
      return;
    }
    if (userSearchDebounceRef.current) clearTimeout(userSearchDebounceRef.current);
    userSearchDebounceRef.current = setTimeout(() => {
      setUserSearchLoading(true);
      authApi
        .searchUsers(q)
        .then((res) => setUserSearchResults(res.data.results || []))
        .catch(() => setUserSearchResults([]))
        .finally(() => setUserSearchLoading(false));
    }, 300);
    return () => {
      if (userSearchDebounceRef.current) clearTimeout(userSearchDebounceRef.current);
    };
  }, [searchQuery]);

  const handleWriteToUser = useCallback(
    (userId: string) => {
      chatsApi
        .getOrCreateDm(userId)
        .then((res) => {
          const chat = res.data;
          setChats((prev) => (prev.some((c) => c.id === chat.id) ? prev : [chat, ...prev]));
          openChat(chat.id);
          setSearchQuery("");
          setUserSearchResults([]);
          // У личного чата нет пригласительной ссылки — копируем ссылку на чат в буфер
          if (chat.is_personal) {
            const chatLink = `${window.location.origin}/chat/${chat.id}`;
            if (navigator.clipboard?.writeText) {
              navigator.clipboard.writeText(chatLink).then(() => {
                setInviteToastIsChatLink(true);
                setShowInviteLinkCopiedToast(true);
                setTimeout(() => setShowInviteLinkCopiedToast(false), 2000);
              });
            }
          }
        })
        .catch(() => {
          setError("Не удалось открыть чат");
        });
    },
    [openChat]
  );

  const handleJoinByLinkSubmit = () => {
    const raw = joinLinkInput.trim();
    if (!raw) {
      setJoinMessage("Вставьте пригласительную ссылку на чат.");
      setJoinStatus("error");
      return;
    }
    let slug = "";
    let code = "";
    try {
      const url = raw.startsWith("http") ? new URL(raw) : new URL(raw, window.location.origin);
      const path = url.pathname.replace(/\/$/, "");
      const match = path.match(/\/chat\/join\/([^/]+)/);
      if (match) slug = decodeURIComponent(match[1]);
      code = url.searchParams.get("code") || "";
    } catch {
      setJoinMessage("Неверный формат ссылки. Вставьте полную пригласительную ссылку.");
      setJoinStatus("error");
      return;
    }
    if (!slug || !code) {
      setJoinMessage("В ссылке должны быть путь вида …/chat/join/название-чата и параметр code.");
      setJoinStatus("error");
      return;
    }
    setJoinStatus("loading");
    setJoinMessage("");
    chatsApi.join(slug, code)
      .then((res) => {
        const data = res.data as { detail?: string; id: string; already_member?: boolean };
        const detail = data?.detail;
        if (detail?.includes("Ожидайте подтверждения")) {
          setJoinStatus("pending");
          setJoinMessage("Запрос отправлен. Ожидайте подтверждения от владельца чата.");
        } else {
          setJoinStatus("joined");
          setJoinMessage(data.already_member ? "Вы уже в чате." : "Вы вступили в чат.");
          const newChatId = data.id;
          setChats((prev) => {
            const already = prev.some((c) => c.id === newChatId);
            if (already) return prev;
            return [{ ...res.data } as Chat, ...prev];
          });
          setShowJoinByLinkModal(false);
          setJoinLinkInput("");
          setJoinStatus("idle");
          openChat(newChatId);
        }
      })
      .catch((e) => {
        setJoinMessage((e?.response?.data?.detail as string) || "Не удалось вступить в чат.");
        setJoinStatus("error");
      });
  };

  const closeJoinByLinkModal = () => {
    setShowJoinByLinkModal(false);
    setJoinLinkInput("");
    setJoinStatus("idle");
    setJoinMessage("");
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden relative">
      {/* Toast: ссылка-приглашение скопирована */}
      {showInviteLinkCopiedToast && (
        <button
          type="button"
          onClick={() => setShowInviteLinkCopiedToast(false)}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-2 px-4 py-3 bg-slate-800 text-white text-sm rounded-lg shadow-lg cursor-pointer hover:bg-slate-700 transition-colors text-left"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400 shrink-0">
            <path d="M20 6 9 17l-5-5"/>
          </svg>
          <span>{inviteToastIsChatLink ? "Ссылка на чат скопирована в буфер обмена" : "Ссылка-приглашение скопирована в буфер обмена"}</span>
        </button>
      )}

      {/* Модалка: вступить по ссылке */}
      {showJoinByLinkModal && (
        <div className="fixed inset-0 z-[150] min-h-screen w-screen flex items-center justify-center p-4 bg-black/50 overflow-y-auto" onClick={closeJoinByLinkModal}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 text-left my-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">Вступить по ссылке</h2>
            <p className="text-slate-600 text-sm mb-4">
              Вставьте пригласительную ссылку на чат (её отправил владелец чата).
            </p>
            <input
              type="url"
              placeholder="https://…/chat/join/название-чата?code=…"
              value={joinLinkInput}
              onChange={(e) => setJoinLinkInput(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 mb-4"
              disabled={joinStatus === "loading"}
              autoFocus
            />
            {joinStatus === "loading" && <p className="text-slate-500 text-sm mb-2">Загрузка…</p>}
            {joinStatus === "error" && <p className="text-red-500 text-sm mb-2">{joinMessage}</p>}
            {joinStatus === "pending" && <p className="text-green-600 text-sm mb-2">{joinMessage}</p>}
            {joinStatus === "joined" && <p className="text-green-600 text-sm mb-2">{joinMessage}</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={closeJoinByLinkModal} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium">
                Отмена
              </button>
              <button
                type="button"
                onClick={handleJoinByLinkSubmit}
                disabled={joinStatus === "loading"}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
              >
                {joinStatus === "loading" ? "Вступление…" : "Вступить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Контекстное меню чата (правый клик) */}
      {chatContextMenu && (
        <div
          className="fixed z-[60] w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-1"
          style={{ left: chatContextMenu.x, top: chatContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => togglePin(chatContextMenu.chat.id)}
            disabled={!pinnedChatIds.includes(chatContextMenu.chat.id) && pinnedChatIds.length >= MAX_PINNED}
            title={!pinnedChatIds.includes(chatContextMenu.chat.id) && pinnedChatIds.length >= MAX_PINNED ? "Максимум 5 закреплённых чатов" : undefined}
            className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors w-full text-left disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent ${
              pinnedChatIds.includes(chatContextMenu.chat.id)
                ? "text-blue-600 bg-blue-50 hover:bg-blue-100"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={pinnedChatIds.includes(chatContextMenu.chat.id) ? "text-blue-500" : "text-slate-400"}>
              <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
            </svg>
            {pinnedChatIds.includes(chatContextMenu.chat.id) ? "Открепить" : "Закрепить"}
          </button>
          <button
            type="button"
            onClick={() => handleToggleMute(chatContextMenu.chat)}
            className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors w-full text-left"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
              <path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
            </svg>
            {chatContextMenu.chat.is_muted ? "Включить звук" : "Без звука"}
          </button>
          <button
            type="button"
            onClick={() => handleMarkUnread(chatContextMenu.chat)}
            className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors w-full text-left"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
              <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
            </svg>
            Пометить непрочитанным
          </button>
        </div>
      )}

      {/* ═══════ Left sidebar — Chat list ═══════ */}
      <aside
        className={`${rightPanelOpen ? "hidden md:flex" : "flex"} flex-col border-r bg-white shrink-0 ${!rightPanelOpen ? "w-full md:!w-[22rem] md:!min-w-[18rem]" : ""}`}
        style={rightPanelOpen ? { width: sidebarWidth } : undefined}
      >
        {/* Sidebar header */}
        <div className="border-b px-4 py-3 flex items-center gap-2">
          <h1 className="text-lg font-semibold text-slate-800 flex-1">Чаты</h1>
          <Link to="/dashboard/create" className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 transition-colors" title="Создать чат">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
          </Link>

          {/* Three-dot menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="text-slate-500 hover:text-slate-700 p-2 rounded-lg hover:bg-slate-100 transition-colors"
              title="Меню"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50 animate-in fade-in slide-in-from-top-1">
                <Link
                  to="/dashboard/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  Настройки
                </Link>
                <div className="border-t border-slate-100 my-1" />
                <button
                  onClick={() => { setMenuOpen(false); handleLogout(); }}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors w-full text-left"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Выйти
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Единый поиск: чаты + пользователи по юзернейму */}
        <div className="px-3 py-2 border-b">
          <div className="relative">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
            </svg>
            <input
              type="text"
              placeholder="Поиск чатов и людей..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white transition-colors"
            />
          </div>
        </div>

        {/* Список: при активном поиске — чаты + пользователи, иначе только чаты */}
        <div className="flex-1 overflow-y-auto">
          {loading && <p className="text-slate-500 text-sm text-center py-8">Загрузка…</p>}
          {error && <p className="text-red-500 text-sm text-center py-8">{error}</p>}

          {needsSub && !loading && (
            <div className="p-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-amber-900 mb-1">Необходима подписка</h2>
                <p className="text-xs text-amber-800 mb-3">Для доступа оформите подписку за <strong>300 ₽/мес</strong>.</p>
                <Link to="/dashboard/settings" className="inline-block bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-xs font-medium transition-colors">
                  Перейти к оплате
                </Link>
              </div>
            </div>
          )}

          {!needsSub && !loading && !error && chats.length === 0 && q.length === 0 && (
            <div className="p-6 text-center">
              <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <h2 className="text-slate-700 font-medium mb-1">Чатов пока нет</h2>
              <p className="text-slate-500 text-sm mb-4 max-w-[240px] mx-auto">
                Создайте чат, чтобы общаться с коллегами или друзьями, либо вступите в чат по пригласительной ссылке.
              </p>
              <Link
                to="/dashboard/create"
                className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                Создать первый чат
              </Link>
              <p className="text-slate-400 text-xs mt-3">
                Есть ссылка-приглашение?{" "}
                <button type="button" onClick={() => setShowJoinByLinkModal(true)} className="text-blue-600 hover:underline">Вступить в чат</button>
              </p>
            </div>
          )}

          {!needsSub && !loading && (filteredChats.length > 0 || q.length > 0) && (
            <>
              {filteredChats.length > 0 ? (
                <ul className="divide-y divide-slate-400">
                  {filteredChats.map((chat) => {
                    const unread = chat.unread_count || 0;
                    const unreadStr = formatUnread(unread);
                    const isActive = chat.id === activeChatId && !showSettings;
                    const isPinned = pinnedChatIds.includes(chat.id);
                    return (
                      <li key={chat.id}>
                        <button
                          onClick={() => openChat(chat.id)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setChatContextMenu({ x: e.clientX, y: e.clientY, chat });
                          }}
                          className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                            isActive
                              ? "bg-blue-50 border-l-2 border-l-blue-600"
                              : "hover:bg-slate-50"
                          }`}
                        >
                          <div className="relative shrink-0">
                            {(chat.is_personal && (chat.other_member?.avatar_url ?? chat.other_member?.avatar)) || (!chat.is_personal && chat.avatar_url) ? (
                              <img
                                src={
                                  withPreviewParams(
                                    chat.is_personal && chat.other_member
                                      ? (chat.other_member!.avatar_url ?? chat.other_member!.avatar)
                                      : chat.avatar_url,
                                    96
                                  ) || ""
                                }
                                alt=""
                                className="w-12 h-12 rounded-full object-cover"
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <div className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-semibold ${
                                isActive ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"
                              }`}>
                                {chat.is_personal && chat.other_member
                                  ? getAvatarInitials(chat.other_member.display_name || chat.other_member.phone)
                                  : getAvatarInitials(chat.title || "Ч")}
                              </div>
                            )}
                            {chat.is_personal && chat.other_member?.is_online && (
                              <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 border-2 border-white rounded-full" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              {isPinned && (
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500 shrink-0" aria-label="Закреплён">
                                  <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
                                </svg>
                              )}
                              <span className={`font-medium truncate text-sm ${unread > 0 ? "text-slate-900" : "text-slate-700"}`}>
                                {chat.is_personal && chat.other_member ? (chat.other_member.display_name || chat.other_member.phone) : chat.title}
                              </span>
                              {chat.is_muted && (
                                <span className="shrink-0 text-[10px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded" title="Без звука">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle -mt-0.5"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                                  {" "}Без звука
                                </span>
                              )}
                            </div>
                            <span className="text-slate-500 text-xs truncate block mt-0.5">
                              {chat.last_message_preview || (chat.is_personal ? "Личный чат" : `${chat.members_count} участн. · ${chat.chat_type === "open" ? "откр." : "закр."}`)}
                            </span>
                          </div>
                          {unread > 0 && (
                            <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold text-white ${
                              chat.is_muted ? "bg-slate-400" : "bg-blue-600"
                            }`}>
                              {unreadStr}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : q.length > 0 ? (
                <p className="text-slate-500 text-sm py-3 px-4">Нет подходящих чатов</p>
              ) : null}
              {q.length >= 2 && (
                <div className="border-t border-slate-200">
                  <p className="px-4 py-2 text-xs font-medium text-slate-500 bg-slate-50/80">Пользователи</p>
                  {userSearchLoading ? (
                    <p className="text-slate-500 text-xs py-3 px-4">Поиск…</p>
                  ) : userSearchResults.length === 0 ? (
                    <p className="text-slate-500 text-xs py-3 px-4">Никого не найдено</p>
                  ) : (
                    <ul className="py-1">
                      {userSearchResults.map((u) => (
                        <li key={u.id} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50">
                          {u.avatar_url ? (
                            <img
                              src={withPreviewParams(u.avatar_url, 96) || ""}
                              alt=""
                              className="w-12 h-12 rounded-full object-cover shrink-0"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center text-sm font-medium text-slate-600 shrink-0">
                              {getAvatarInitials(u.display_name || u.username || "?")}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-slate-800 text-sm truncate block">@{u.username}</span>
                            {u.display_name && u.display_name !== u.username && (
                              <span className="text-xs text-slate-500 truncate block">{u.display_name}</span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleWriteToUser(u.id)}
                            className="shrink-0 text-blue-600 hover:text-blue-700 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                          >
                            Написать
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      {/* Resizer — только при открытой правой панели на десктопе */}
      {showRightPanel && (
        <div
          role="separator"
          aria-label="Изменить ширину списка чатов"
          onMouseDown={handleResizeStart}
          className="hidden md:block w-1 flex-shrink-0 cursor-col-resize bg-slate-200 hover:bg-blue-400 active:bg-blue-500 transition-colors min-h-full"
        />
      )}

      {/* ═══════ Right panel — Chat or Settings (скрыт, если есть чаты и ничего не выбрано) ═══════ */}
      <main className={`${showRightPanel ? "flex" : "hidden"} flex-col flex-1 min-w-0 min-h-0 overflow-hidden bg-white`}>
        {showSettings ? (
          <>
            <header className="border-b bg-white px-4 py-2 flex items-center gap-4 shrink-0">
              <button
                type="button"
                onClick={closeSettings}
                className="p-2 -ml-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                title="Назад"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6"/>
                </svg>
              </button>
              <h1 className="font-semibold text-slate-800">Настройки</h1>
            </header>
            <div className="flex-1 min-h-0 overflow-hidden">
              <SettingsPage embed />
            </div>
          </>
        ) : activeChatId ? (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <ChatPage
              key={activeChatId}
              chatId={activeChatId}
              onBack={closeChat}
              onChatUpdated={(updated) =>
                setChats((prev) =>
                  prev.map((c) => {
                    if (c.id !== updated.id) return c;
                    const next = { ...c };
                    if (updated.title !== undefined) next.title = updated.title;
                    if (updated.avatar_url !== undefined) next.avatar_url = updated.avatar_url;
                    if (updated.is_muted !== undefined) next.is_muted = updated.is_muted;
                    return next;
                  })
                )
              }
              onMessageSent={(cid, preview) =>
                setChats((prev) =>
                  prev.map((c) => (c.id === cid ? { ...c, last_message_preview: preview } : c))
                )
              }
              onChatLeft={(leftChatId) => {
                setChats((prev) => prev.filter((c) => c.id !== leftChatId));
                closeChat();
              }}
              onOpenDmWithUserId={(userId) => {
                // Личный чат с человеком только один — getOrCreateDm возвращает существующий или создаёт единственный
                chatsApi.getOrCreateDm(userId).then((res) => {
                  const chat = res.data;
                  setChats((prev) => (prev.some((c) => c.id === chat.id) ? prev : [chat, ...prev]));
                  openChat(chat.id);
                }).catch(() => {});
              }}
            />
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex items-center justify-center bg-slate-50 p-6">
            <div className="text-center max-w-sm">
              <div className="w-20 h-20 bg-slate-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <h2 className="text-lg font-medium text-slate-600 mb-1">Выберите чат</h2>
              <p className="text-sm text-slate-500 mb-4">
                {chats.length === 0
                  ? "Создайте первый чат или вступите в чат по пригласительной ссылке — тогда здесь откроется переписка."
                  : "Выберите чат из списка слева или создайте новый."}
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <Link
                  to="/dashboard/create"
                  className="inline-flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                  Создать чат
                </Link>
                <button
                  type="button"
                  onClick={() => setShowJoinByLinkModal(true)}
                  className="inline-flex items-center justify-center gap-2 border border-slate-300 text-slate-700 px-4 py-2.5 rounded-lg hover:bg-slate-50 text-sm font-medium transition-colors"
                >
                  Вступить по ссылке
                </button>
              </div>
              <p className="text-slate-400 text-xs mt-4">
                Настройки профиля и подписки — в меню (⋮) в шапке списка чатов.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
