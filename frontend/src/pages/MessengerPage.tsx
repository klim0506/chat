import { useEffect, useState, useRef, useCallback } from "react";
import { Link, useNavigate, useParams, useLocation } from "react-router-dom";
import { authApi, chatsApi, paymentsApi, type Chat, type UserSearchResult } from "../api/client";
import { useAuthStore } from "../store/auth";
import { useChatListStore } from "../store/chatList";
import { getAvatarInitials } from "../lib/avatar-initials";
import { toSameOriginMediaUrl } from "../lib/media-url";
import { showMessageNotification, requestPermission } from "../lib/notifications";
import { playSound } from "../lib/sounds";
import ChatPage from "./ChatPage";
import SettingsPage from "./SettingsPage";
import { useE2eeStore } from "../store/e2ee";
import { OfflineBanner } from "../components/OfflineBanner";
import { WsManager, buildWsUrl } from "../lib/ws-manager";
import CreateChatModal from "../components/CreateChatModal";
import JoinChatPreviewModal from "../components/JoinChatPreviewModal";
import { useTranslation, formatMembersCount, t as tFn } from "../lib/i18n";
import type { AppLanguage } from "../store/preferences";

/** Превью сообщения для списка чатов (совпадает с логикой бэкенда get_last_message_preview). */
function formatMessagePreview(msg: { msg_type?: string; content?: string; file?: { mime_type?: string }; is_encrypted?: boolean }, lang: AppLanguage): string {
  if (!msg) return "";
  if ((msg as { is_encrypted?: boolean }).is_encrypted) return tFn("common.encryptedMessage", lang);
  const mime = (msg.file && msg.file.mime_type) || "";
  if (msg.msg_type === "audio") return tFn("common.voice", lang);
  if (msg.msg_type === "video" || msg.msg_type === "video_circle" || String(mime).startsWith("video/")) return tFn("common.video", lang);
  if (String(mime).startsWith("image/")) return tFn("common.photo", lang);
  if (msg.msg_type === "file") return tFn("common.fileMsg", lang);
  const text = (msg.content || "").trim();
  if (!text) return tFn("common.message", lang);
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
  const { t, lang } = useTranslation();
  const tRef = useRef(t);
  const { chatId: urlChatId } = useParams<{ chatId: string }>();
  const location = useLocation();
  const showSettings = location.pathname === "/chats/settings";
  const [activeChatId, setActiveChatId] = useState<string | null>(urlChatId || null);
  const chats = useChatListStore((s) => s.chats);
  const chatListLoading = useChatListStore((s) => s.loading);
  const chatListError = useChatListStore((s) => s.error);
  const pinnedChatIds = useChatListStore((s) => s.pinnedChatIds);
  const setPinnedChatIds = useChatListStore((s) => s.setPinnedChatIds);
  const storeUpsertChat = useChatListStore((s) => s.upsertChat);
  const storeUpdateChat = useChatListStore((s) => s.updateChat);
  const storeRemoveChat = useChatListStore((s) => s.removeChat);
  const storeSetUnread = useChatListStore((s) => s.setUnread);
  const loadChats = useChatListStore((s) => s.loadChats);
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
  /** Join-preview modal state (triggered by URL params or paste-a-link flow) */
  const [joinPreviewSlug, setJoinPreviewSlug] = useState("");
  const [joinPreviewCode, setJoinPreviewCode] = useState("");
  const [showJoinPreviewModal, setShowJoinPreviewModal] = useState(false);
  /** Контекстное меню по правому клику на чат */
  const [chatContextMenu, setChatContextMenu] = useState<{ x: number; y: number; chat: Chat } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showCreateChatModal, setShowCreateChatModal] = useState(false);
  const [inviteFriendsCopied, setInviteFriendsCopied] = useState(false);
  const [inviteFriendsExpanded, setInviteFriendsExpanded] = useState(false);
  const [referralLink, setReferralLink] = useState(window.location.origin);
  const MAX_PINNED = 5;
  const lastSyncedPinnedRef = useRef<string[]>([]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // Fetch referral code for invite links
  useEffect(() => {
    authApi.me().then((r) => {
      const code = r.data.referral_code;
      if (code) setReferralLink(`${window.location.origin}/auth?ref=${code}`);
    }).catch(() => {});
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

  // Open JoinChatPreviewModal when URL contains join_slug & join_code (e.g. redirect from invite link)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const slug = params.get("join_slug") || "";
    const code = params.get("join_code") || "";
    if (slug && code) {
      setJoinPreviewSlug(slug);
      setJoinPreviewCode(code);
      setShowJoinPreviewModal(true);
      // Clean up the URL params so they don't re-trigger on navigation
      params.delete("join_slug");
      params.delete("join_code");
      const remaining = params.toString();
      navigate(remaining ? `${location.pathname}?${remaining}` : location.pathname, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync URL with active chat / settings
  useEffect(() => {
    if (location.pathname === "/chats/settings") {
      setActiveChatId(null);
    } else if (urlChatId && urlChatId !== activeChatId) {
      setActiveChatId(urlChatId);
    }
  }, [location.pathname, urlChatId]);

  /* ---------- E2EE device registration (when authenticated) ---------- */
  useEffect(() => {
    if (token) {
      useE2eeStore.getState().ensureRegistered();
    }
  }, [token]);

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
        // Use the store's loadChats (cache-first + network revalidate)
        return loadChats().then(() => {
          lastSyncedPinnedRef.current = useChatListStore.getState().pinnedChatIds;
        });
      })
      .catch((e) => {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 403) {
          setNeedsSub(true);
        } else {
          setError(tRef.current("dashboard.loadError"));
        }
      })
      .finally(() => setLoading(false));
  }, [loadChats]);

  /* ---------- New-login toast ---------- */
  const [newLoginToast, setNewLoginToast] = useState<{ device: string; ip: string } | null>(null);
  useEffect(() => {
    if (!newLoginToast) return;
    const t = setTimeout(() => setNewLoginToast(null), 8000);
    return () => clearTimeout(t);
  }, [newLoginToast]);

  /* ---------- Global notification WebSocket ---------- */
  const handleNotification = useCallback((data: {
    type: string;
    chat_id?: string;
    chat_title?: string;
    message?: { sender_display_name?: string; content?: string };
    is_muted?: boolean;
    is_mention?: boolean;
    // new_login_alert fields
    device?: string;
    ip?: string;
    session_id?: string;
    // force_logout fields
    terminated_session_ids?: string[];
  }) => {
    // Handle force_logout: if our session was terminated, clear tokens and redirect
    if (data.type === "force_logout") {
      const currentSid = useAuthStore.getState().sessionId;
      const terminated = data.terminated_session_ids || [];
      if (currentSid && terminated.includes(currentSid)) {
        useAuthStore.getState().clearTokens();
        window.location.href = "/auth";
      }
      return;
    }

    // Handle new login alert: show toast
    if (data.type === "new_login_alert") {
      setNewLoginToast({ device: data.device || "Unknown", ip: data.ip || "" });
      return;
    }

    // Handle E2EE prekeys low: upload more one-time prekeys
    if (data.type === "e2ee.prekeys_low") {
      useE2eeStore.getState().uploadPrekeysIfLow();
      return;
    }

    if (data.type === "added_to_chat" && data.chat_id) {
      chatsApi.get(data.chat_id).then((res) => {
        storeUpsertChat(res.data);
        if ("Notification" in window && Notification.permission === "granted") {
          showMessageNotification(
            data.chat_title || res.data.title,
            { content: t("notification.addedToGroup") },
          );
        }
      }).catch(() => {});
      return;
    }

    if (data.type === "new_message") {
      const preview = data.message ? formatMessagePreview(data.message, lang) : undefined;
      const currentChats = useChatListStore.getState().chats;
      const found = currentChats.some((c) => c.id === data.chat_id);

      if (found) {
        // Update existing chat in store; auto-unarchive when new message arrives (Telegram-style)
        const isActive = data.chat_id === activeChatId;
        const chat = currentChats.find((c) => c.id === data.chat_id);
        storeUpdateChat(data.chat_id, {
          unread_count: isActive
            ? (chat?.unread_count || 0)
            : (chat?.unread_count || 0) + 1,
          ...(preview ? { last_message_preview: preview } : {}),
          ...(chat?.is_archived ? { is_archived: false } : {}),
        });
      } else {
        chatsApi.get(data.chat_id).then((res) => {
          storeUpsertChat(res.data, {
            unread_count: activeChatId === data.chat_id ? res.data.unread_count : (res.data.unread_count || 0) + 1,
            last_message_preview: preview ?? res.data.last_message_preview,
          });
        }).catch(() => {
          // Chat not accessible — do not add to store
        });
      }
      if (!data.is_muted) {
        const isActive = data.chat_id === activeChatId;
        const tabVisible = !document.hidden;
        // Skip sound & notification if ChatPage's chat WS already handles it
        if (isActive && tabVisible) { /* ChatPage plays sound via chat WS */ } else {
          const content = (data.message?.content as string) || "";
          const me = useAuthStore.getState().user;
          const identifiers = [me?.display_name, me?.username, me?.telegram_username].filter(Boolean) as string[];
          const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const isMention = identifiers.some((id) => new RegExp(`@${escapeRegex(id)}\\b`, "i").test(content));
          playSound(isMention ? "mention" : "receive");
          showMessageNotification(data.chat_title || t("dashboard.newMessage"), data.message || {});
        }
      }
    }
  }, [activeChatId, storeUpsertChat, storeUpdateChat]);

  const notifMgrRef = useRef<WsManager | null>(null);
  const handleNotificationRef = useRef(handleNotification);
  handleNotificationRef.current = handleNotification;
  useEffect(() => {
    if (!token || needsSub) return;
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      requestPermission();
    }
    const wsUrl = buildWsUrl("/ws/notifications/");
    const mgr = new WsManager({
      url: wsUrl,
      protocols: ["bearer", token],
    });
    notifMgrRef.current = mgr;
    notifWsRef.current = mgr.raw;

    mgr.on("*", (data: unknown) => {
      handleNotificationRef.current(data as Parameters<typeof handleNotification>[0]);
    });

    // Handle user online/offline status updates (for DM chats green dot in sidebar)
    mgr.on("user.online.status", (data: unknown) => {
      const d = data as { user_id?: string; is_online?: boolean; last_seen_display?: string | null };
      if (!d.user_id) return;
      const currentChats = useChatListStore.getState().chats;
      const updateChat = useChatListStore.getState().updateChat;
      for (const chat of currentChats) {
        if (chat.is_personal && chat.other_member?.id === d.user_id) {
          updateChat(chat.id, {
            other_member: { ...chat.other_member, is_online: !!d.is_online },
          } as Partial<Chat>);
        }
      }
    });

    mgr.connect();

    return () => {
      notifMgrRef.current = null;
      notifWsRef.current = null;
      mgr.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, needsSub]);

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
    storeSetUnread(chatId, 0);
    navigate(`/chat/${chatId}`, { replace: true });
  };

  const closeChat = () => {
    setActiveChatId(null);
    navigate("/chats", { replace: true });
  };

  const closeSettings = () => {
    navigate("/chats", { replace: true });
  };

  // Sort: pinned first (preserve pin order), then unread first, then by last message time
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
    const aTime = (a.last_message_at || a.created_at) ?? a.created_at;
    const bTime = (b.last_message_at || b.created_at) ?? b.created_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  const archivedCount = chats.filter((c) => c.is_archived).length;
  const baseChats = showArchived
    ? sortedChats.filter((c) => c.is_archived)
    : sortedChats.filter((c) => !c.is_archived);

  const q = searchQuery.trim().toLowerCase();
  const filteredChats = q
    ? baseChats.filter((c) => {
        const title = (c.title || "").toLowerCase();
        const otherName = (c.is_personal && c.other_member)
          ? (c.other_member.display_name || c.other_member.phone || (c.other_member as { username?: string }).username || "").toLowerCase()
          : "";
        const otherUsername = (c.is_personal && c.other_member && (c.other_member as { username?: string }).username)
          ? String((c.other_member as { username?: string }).username || "").toLowerCase()
          : "";
        return title.includes(q) || otherName.includes(q) || otherUsername.includes(q);
      })
    : baseChats;

  const rightPanelOpen = !!activeChatId || showSettings;
  const onlyFavoritesChat = chats.length === 1 && !!chats[0]?.is_favorites;
  const showRightPanel = rightPanelOpen || chats.length === 0 || (!rightPanelOpen && onlyFavoritesChat);

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

  const togglePin = useCallback(async (chatId: string) => {
    const prev = pinnedChatIds;
    const next = prev.includes(chatId)
      ? prev.filter((id) => id !== chatId)
      : (prev.length >= MAX_PINNED ? prev : [...prev, chatId]);

    // no-op (limit reached)
    if (next === prev) {
      setChatContextMenu(null);
      return;
    }

    setPinnedChatIds(next);
    try {
      const { data } = await chatsApi.setPins(next);
      const synced = (data.pinned_chat_ids || []).slice(0, MAX_PINNED);
      setPinnedChatIds(synced);
      lastSyncedPinnedRef.current = synced;
    } catch {
      setPinnedChatIds(lastSyncedPinnedRef.current);
    } finally {
      setChatContextMenu(null);
    }
  }, [pinnedChatIds]);

  const handleMute = useCallback(
    async (chat: Chat, duration: "1h" | "3h" | "8h" | "forever" | "off") => {
      try {
        const { data } = await chatsApi.muteChat(chat.id, duration);
        storeUpdateChat(chat.id, { is_muted: data.is_muted, muted_until: data.muted_until });
      } catch { /* ignore */ }
      setChatContextMenu(null);
    },
    [storeUpdateChat]
  );

  const handleMarkUnread = useCallback(
    async (chat: Chat) => {
      try {
        await chatsApi.markUnread(chat.id);
        const hadReal = (chat.unread_count || 0) > 0;
        storeSetUnread(chat.id, (prev) => Math.max(1, prev));
        if (!hadReal) storeUpdateChat(chat.id, { manually_unread: true });
      } catch { /* ignore */ }
      setChatContextMenu(null);
    },
    [storeSetUnread, storeUpdateChat]
  );

  const handleToggleArchive = useCallback(
    async (chat: Chat) => {
      try {
        const { data } = await chatsApi.toggleArchive(chat.id);
        storeUpdateChat(chat.id, { is_archived: data.is_archived });
      } catch { /* ignore */ }
      setChatContextMenu(null);
    },
    [storeUpdateChat]
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
          storeUpsertChat(chat);
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
        .catch((err: { response?: { status?: number; data?: { detail?: string } } }) => {
          const detail = err?.response?.data?.detail;
          const msg = typeof detail === "string" ? detail : t("messenger.openChatError");
          setError(msg);
          setTimeout(() => setError(""), 5000);
        });
    },
    [openChat, t]
  );

  const handleJoinByLinkSubmit = () => {
    const raw = joinLinkInput.trim();
    if (!raw) {
      setJoinMessage(t("messenger.joinLinkEmpty"));
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
      setJoinMessage(t("messenger.joinLinkBadFormat"));
      setJoinStatus("error");
      return;
    }
    if (!slug || !code) {
      setJoinMessage(t("messenger.joinLinkMissing"));
      setJoinStatus("error");
      return;
    }
    // Close the paste-a-link modal and open the preview modal instead
    closeJoinByLinkModal();
    setJoinPreviewSlug(slug);
    setJoinPreviewCode(code);
    setShowJoinPreviewModal(true);
  };

  const closeJoinByLinkModal = () => {
    setShowJoinByLinkModal(false);
    setJoinLinkInput("");
    setJoinStatus("idle");
    setJoinMessage("");
  };

  const copyInviteLink = (url: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(() => {});
    } else {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  };

  const handleChatCreated = useCallback((chatId: string, inviteLink: string | null) => {
    setShowCreateChatModal(false);
    if (inviteLink) {
      copyInviteLink(inviteLink);
      setInviteToastIsChatLink(false);
      setShowInviteLinkCopiedToast(true);
      setTimeout(() => setShowInviteLinkCopiedToast(false), 2000);
    }
    // Reload chat list and open the new chat
    loadChats().then(() => {
      openChat(chatId);
    });
  }, [loadChats, openChat]);

  const handleJoinPreviewJoined = useCallback((chatId: string) => {
    setShowJoinPreviewModal(false);
    loadChats().then(() => {
      openChat(chatId);
    });
  }, [loadChats, openChat]);

  const handleJoinPreviewClose = useCallback(() => {
    setShowJoinPreviewModal(false);
    setJoinPreviewSlug("");
    setJoinPreviewCode("");
  }, []);

  const handleJoinPreviewRequestSent = useCallback(() => {
    const params = new URLSearchParams(location.search);
    if (params.has("join_slug") || params.has("join_code")) {
      params.delete("join_slug");
      params.delete("join_code");
      const remaining = params.toString();
      navigate(remaining ? `${location.pathname}?${remaining}` : location.pathname, { replace: true });
    }
  }, [location.search, location.pathname, navigate]);

  return (
    <div className="flex flex-col h-screen bg-slate-50 overflow-hidden relative">
      <OfflineBanner />
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
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
          <span>{inviteToastIsChatLink ? t("messenger.chatLinkCopied") : t("messenger.inviteLinkCopied")}</span>
        </button>
      )}

      {/* Toast: новый вход в аккаунт */}
      {newLoginToast && (
        <button
          type="button"
          onClick={() => {
            setNewLoginToast(null);
            navigate("/chats/settings");
          }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 px-4 py-3 bg-amber-600 text-white text-sm rounded-lg shadow-lg cursor-pointer hover:bg-amber-700 transition-colors text-left max-w-md"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-200 shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div>
            <p className="font-medium">{t("messenger.newLoginTitle")}</p>
            <p className="text-amber-100 text-xs mt-0.5">
              {newLoginToast.device}{newLoginToast.ip ? ` (${newLoginToast.ip})` : ""}. {t("messenger.newLoginDesc")}
            </p>
          </div>
        </button>
      )}

      {/* Модалка: вступить по ссылке */}
      {showJoinByLinkModal && (
        <div className="fixed inset-0 z-[150] min-h-screen w-screen flex items-center justify-center p-4 bg-black/50 overflow-y-auto" onClick={closeJoinByLinkModal}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 text-left my-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">{t("messenger.joinByLinkTitle")}</h2>
            <p className="text-slate-600 text-sm mb-4">
              {t("messenger.joinByLinkDesc")}
            </p>
            <input
              type="url"
              placeholder={t("messenger.joinByLinkPlaceholder")}
              value={joinLinkInput}
              onChange={(e) => setJoinLinkInput(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 mb-4"
              disabled={joinStatus === "loading"}
              autoFocus
            />
            {joinStatus === "loading" && <p className="text-slate-500 text-sm mb-2">{t("common.loading")}</p>}
            {joinStatus === "error" && <p className="text-red-500 text-sm mb-2">{joinMessage}</p>}
            {joinStatus === "pending" && <p className="text-green-600 text-sm mb-2">{joinMessage}</p>}
            {joinStatus === "joined" && <p className="text-green-600 text-sm mb-2">{joinMessage}</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={closeJoinByLinkModal} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium">
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleJoinByLinkSubmit}
                disabled={joinStatus === "loading"}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
              >
                {joinStatus === "loading" ? t("messenger.joining") : t("messenger.join")}
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
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => togglePin(chatContextMenu.chat.id)}
            disabled={!pinnedChatIds.includes(chatContextMenu.chat.id) && pinnedChatIds.length >= MAX_PINNED}
            title={!pinnedChatIds.includes(chatContextMenu.chat.id) && pinnedChatIds.length >= MAX_PINNED ? t("messenger.maxPinned") : undefined}
            className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors w-full text-left disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent ${
              pinnedChatIds.includes(chatContextMenu.chat.id)
                ? "text-blue-600 bg-blue-50 hover:bg-blue-100"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={pinnedChatIds.includes(chatContextMenu.chat.id) ? "text-blue-500" : "text-slate-400"}>
              <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
            </svg>
            {pinnedChatIds.includes(chatContextMenu.chat.id) ? t("messenger.unpin") : t("messenger.pin")}
          </button>
          {chatContextMenu.chat.is_muted ? (
            <button
              type="button"
              onClick={() => handleMute(chatContextMenu.chat, "off")}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors w-full text-left"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              </svg>
              {t("messenger.enableNotif")}
            </button>
          ) : (
            <div className="relative group/mute">
              <button
                type="button"
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors w-full text-left justify-between"
              >
                <span className="flex items-center gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                  {t("messenger.mute")}
                </span>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-400"><path d="m9 18 6-6-6-6"/></svg>
              </button>
              <div className="invisible group-hover/mute:visible absolute left-full top-0 pl-1 min-w-[140px] z-50"><div className="py-1 bg-white border border-slate-200 rounded-lg shadow-lg">
                {(["1h", "3h", "8h", "forever"] as const).map((dur) => (
                  <button
                    key={dur}
                    type="button"
                    onClick={() => handleMute(chatContextMenu.chat, dur)}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors w-full text-left"
                  >
                    {t(dur === "1h" ? "messenger.muteFor1h" : dur === "3h" ? "messenger.muteFor3h" : dur === "8h" ? "messenger.muteFor8h" : "messenger.muteForever")}
                  </button>
                ))}
              </div></div>
            </div>
          )}
          <button
            type="button"
            onClick={() => handleMarkUnread(chatContextMenu.chat)}
            className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors w-full text-left"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
              <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
            </svg>
            {t("messenger.markUnread")}
          </button>
          <button
            type="button"
            onClick={() => handleToggleArchive(chatContextMenu.chat)}
            className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors w-full text-left"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
              <path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>
            </svg>
            {chatContextMenu.chat.is_archived ? t("messenger.unarchive") : t("messenger.archive")}
          </button>
        </div>
      )}

      {/* ═══════ Left sidebar — Chat list ═══════ */}
      <aside
        className={`${rightPanelOpen ? "hidden md:flex" : "flex max-md:!w-full"} flex-col border-r bg-white shrink-0`}
        style={{ width: sidebarWidth }}
      >
        {/* Sidebar header */}
        <div className="border-b px-4 py-3 flex items-center gap-2">
          <h1 className="text-lg font-semibold text-slate-800 flex-1">{t("messenger.chats")}</h1>
          <button type="button" onClick={() => setShowCreateChatModal(true)} className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 transition-colors" title={t("dashboard.createChat")}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
          </button>

          {/* Three-dot menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="text-slate-500 hover:text-slate-700 p-2 rounded-lg hover:bg-slate-100 transition-colors"
              title={t("messenger.menu")}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50 animate-in fade-in slide-in-from-top-1">
                <Link
                  to="/chats/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  {t("common.settings")}
                </Link>
                <div className="border-t border-slate-100 my-1" />
                <button
                  onClick={() => { setMenuOpen(false); handleLogout(); }}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors w-full text-left"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  {t("common.logout")}
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
              placeholder={t("messenger.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white transition-colors"
            />
          </div>
        </div>

        {/* Список: при активном поиске — чаты + пользователи, иначе только чаты */}
        <div className="flex-1 overflow-y-auto">
          {(loading || chatListLoading) && <p className="text-slate-500 text-sm text-center py-8">{t("common.loading")}</p>}
          {(error || chatListError) && <p className="text-red-500 text-sm text-center py-8">{error || chatListError}</p>}

          {needsSub && !loading && !chatListLoading && (
            <div className="p-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-amber-900 mb-1">{t("dashboard.needsSub")}</h2>
                <p className="text-xs text-amber-800 mb-3" dangerouslySetInnerHTML={{ __html: t("dashboard.needsSubDesc") }} />
                <Link to="/chats/settings" className="inline-block bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-xs font-medium transition-colors">
                  {t("dashboard.goToPayment")}
                </Link>
              </div>
            </div>
          )}

          {!needsSub && !loading && !chatListLoading && !error && !chatListError && chats.length === 0 && q.length === 0 && (
            <div className="p-6 text-center">
              <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <h2 className="text-slate-700 font-medium mb-1">{t("messenger.noChatsYet")}</h2>
              <p className="text-slate-500 text-sm mb-4 max-w-[240px] mx-auto">
                {t("messenger.noChatsDesc")}
              </p>
              <button
                type="button"
                onClick={() => setShowCreateChatModal(true)}
                className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                {t("messenger.createFirst")}
              </button>
              <p className="text-slate-400 text-xs mt-3">
                {t("messenger.haveInvite")}{" "}
                <button type="button" onClick={() => setShowJoinByLinkModal(true)} className="text-blue-600 hover:underline">{t("messenger.joinChat")}</button>
              </p>
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!inviteFriendsExpanded && navigator.clipboard?.writeText) {
                      navigator.clipboard.writeText(referralLink).then(() => {
                        setInviteFriendsCopied(true);
                        setTimeout(() => setInviteFriendsCopied(false), 2000);
                      });
                    }
                    setInviteFriendsExpanded((v) => !v);
                  }}
                  className="inline-flex items-center gap-1.5 text-purple-600 hover:underline text-xs"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                  {inviteFriendsCopied ? t("messenger.welcomeInviteCopied") : t("messenger.welcomeInviteFriends")}
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-200 ${inviteFriendsExpanded ? "rotate-180" : ""}`}><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <div className={`overflow-hidden transition-all duration-200 ease-out ${inviteFriendsExpanded ? "max-h-32 opacity-100 mt-2" : "max-h-0 opacity-0"}`}>
                  <div className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 flex items-center gap-2 mx-auto">
                    <div className="flex items-center bg-slate-50 rounded-lg px-2.5 py-1.5 min-w-0 flex-1">
                      <span className="text-[11px] text-slate-500 truncate select-all">{referralLink}</span>
                    </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (navigator.clipboard?.writeText) {
                            navigator.clipboard.writeText(referralLink).then(() => {
                              setInviteFriendsCopied(true);
                              setTimeout(() => setInviteFriendsCopied(false), 2000);
                            });
                          }
                        }}
                        className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-purple-50 text-purple-700 text-[11px] font-medium hover:bg-purple-100 transition-colors whitespace-nowrap shrink-0"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        {inviteFriendsCopied ? t("messenger.welcomeInviteCopied") : t("messenger.inviteCopyLink")}
                      </button>
                      {typeof navigator.share === "function" && (
                        <button
                          type="button"
                          onClick={() => {
                            navigator.share({ title: t("messenger.welcomeInviteFriends"), url: referralLink }).catch(() => {});
                          }}
                          className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-[11px] font-medium hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                          {t("messenger.inviteShare")}
                        </button>
                      )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {!needsSub && !loading && !chatListLoading && (filteredChats.length > 0 || q.length > 0 || showArchived) && (
            <>
              {showArchived ? (
                <button
                  type="button"
                  onClick={() => setShowArchived(false)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-slate-600 hover:bg-slate-50 transition-colors text-left border-b border-slate-200"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                    <path d="m15 18-6-6 6-6"/>
                  </svg>
                  {t("messenger.chats")}
                </button>
              ) : archivedCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowArchived(true)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-slate-600 hover:bg-slate-50 transition-colors text-left border-b border-slate-200"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                    <path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>
                  </svg>
                  {t("messenger.archived")} ({archivedCount})
                </button>
              ) : null}
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
                            {chat.is_favorites ? (
                              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                                isActive ? "bg-blue-600" : "bg-blue-500"
                              }`}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                              </div>
                            ) : (chat.is_personal && (chat.other_member?.avatar_url ?? chat.other_member?.avatar)) || (!chat.is_personal && chat.avatar_url) ? (
                              <>
                                <img
                                  src={
                                    withPreviewParams(
                                      toSameOriginMediaUrl(
                                        chat.is_personal && chat.other_member
                                          ? (chat.other_member!.avatar_url ?? chat.other_member!.avatar)
                                          : chat.avatar_url
                                      ),
                                      96
                                    ) || ""
                                  }
                                  alt=""
                                  className="w-12 h-12 rounded-full object-cover"
                                  loading="lazy"
                                  decoding="async"
                                  onError={(e) => { const img = e.currentTarget; img.style.display = 'none'; const fallback = img.nextElementSibling as HTMLElement; if (fallback) fallback.style.display = ''; }}
                                />
                                <div style={{ display: 'none' }} className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-semibold ${
                                  isActive ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"
                                }`}>
                                  {chat.is_personal && chat.other_member
                                    ? getAvatarInitials(chat.other_member.display_name || chat.other_member.phone)
                                    : getAvatarInitials(chat.title || "Ч")}
                                </div>
                              </>
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
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500 shrink-0" aria-label={t("messenger.pinned")}>
                                  <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
                                </svg>
                              )}
                              <span className={`font-medium truncate text-sm flex items-center gap-1 ${unread > 0 ? "text-slate-900" : "text-slate-700"}`}>
                                {chat.is_favorites ? t("chat.favoritesTitle") : chat.is_personal && chat.other_member ? (chat.other_member.display_name || chat.other_member.phone) : chat.title}
                                {chat.is_personal && (
                                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-slate-400" aria-hidden>
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                  </svg>
                                )}
                              </span>
                              {chat.is_muted && (
                                <span className="shrink-0 text-[10px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded" title={t("messenger.muted")}>
                                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle -mt-0.5"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                                  {" "}{t("messenger.muted")}
                                </span>
                              )}
                            </div>
                            <span className="text-slate-500 text-xs truncate block mt-0.5">
                              {chat.last_message_preview || (chat.is_personal
                                ? (chat.other_member?.username ? `@${chat.other_member.username}` : t("dashboard.personalChat"))
                                : `${formatMembersCount(chat.members_count ?? 0, lang)} · ${chat.chat_type === "open" ? t("dashboard.openType") : t("dashboard.closedType")}`)}
                            </span>
                          </div>
                          {unread > 0 && (
                            chat.manually_unread && unread <= 1 ? (
                              <span className={`inline-block w-3 h-3 rounded-full shrink-0 ${
                                chat.is_muted ? "bg-slate-400" : "bg-blue-600"
                              }`} />
                            ) : (
                              <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold text-white ${
                                chat.is_muted ? "bg-slate-400" : "bg-blue-600"
                              }`}>
                                {unreadStr}
                              </span>
                            )
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : q.length > 0 ? (
                <p className="text-slate-500 text-sm py-3 px-4">{t("messenger.noMatchingChats")}</p>
              ) : showArchived ? (
                <p className="text-slate-500 text-sm py-3 px-4">{t("messenger.archiveEmpty")}</p>
              ) : null}
              {q.length >= 2 && (
                <div className="border-t border-slate-200">
                  <p className="px-4 py-2 text-xs font-medium text-slate-500 bg-slate-50/80">{t("messenger.users")}</p>
                  {userSearchLoading ? (
                    <p className="text-slate-500 text-xs py-3 px-4">{t("messenger.searching")}</p>
                  ) : userSearchResults.length === 0 ? (
                    <p className="text-slate-500 text-xs py-3 px-4">{t("messenger.noUsersFound")}</p>
                  ) : (
                    <ul className="py-1">
                      {userSearchResults.map((u) => (
                        <li key={u.id} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50">
                          {u.avatar_url ? (
                            <img
                              src={withPreviewParams(toSameOriginMediaUrl(u.avatar_url), 96) || ""}
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
                            {t("common.write")}
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

      {/* Resizer — всегда виден на десктопе, позиция сохраняется */}
      <div
        role="separator"
        aria-label={t("messenger.resizeSidebar")}
        onMouseDown={handleResizeStart}
        className="hidden md:block w-1 flex-shrink-0 cursor-col-resize bg-slate-200 hover:bg-blue-400 active:bg-blue-500 transition-colors min-h-full"
      />

      {/* ═══════ Right panel — Chat or Settings (скрыт, если есть чаты и ничего не выбрано) ═══════ */}
      <main className={`${showRightPanel ? "flex" : "hidden md:flex"} flex-col flex-1 min-w-0 min-h-0 overflow-hidden bg-white`}>
        {showSettings ? (
          <>
            <header className="border-b bg-white px-4 py-2 flex items-center gap-4 shrink-0">
              <button
                type="button"
                onClick={closeSettings}
                className="p-2 -ml-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                title={t("common.back")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6"/>
                </svg>
              </button>
              <h1 className="font-semibold text-slate-800">{t("common.settings")}</h1>
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
                {
                  const updates: Partial<Chat> = {};
                  if (updated.title !== undefined) updates.title = updated.title;
                  if (updated.avatar_url !== undefined) updates.avatar_url = updated.avatar_url;
                  if (updated.is_muted !== undefined) updates.is_muted = updated.is_muted;
                  storeUpdateChat(updated.id, updates);
                }
              }
              onMessageSent={(cid, preview) =>
                storeUpdateChat(cid, { last_message_preview: preview })
              }
              onChatLeft={(leftChatId) => {
                storeRemoveChat(leftChatId);
                closeChat();
              }}
              onOpenDmWithUserId={(userId) => {
                chatsApi.getOrCreateDm(userId)
                  .then((res) => {
                    const chat = res.data;
                    storeUpsertChat(chat);
                    openChat(chat.id);
                  })
                  .catch((err: { response?: { status?: number; data?: { detail?: string } } }) => {
                    const detail = err?.response?.data?.detail;
                    const msg = typeof detail === "string" ? detail : t("messenger.openChatError");
                    setError(msg);
                    setTimeout(() => setError(""), 5000);
                  });
              }}
              onNavigateToChat={openChat}
            />
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex items-center justify-center bg-slate-50 p-6">
          {(() => {
            const favChat = chats.find((chat) => chat.is_favorites) ?? null;
            const favChatId = favChat?.id ?? null;

            return (
              <div className="text-center max-w-md">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-5">
                  <span className="text-2xl">👋</span>
                </div>
                <h2 className="text-xl font-semibold text-slate-800 mb-2">{t("messenger.welcomeTitle")}</h2>
                <p className="text-sm text-slate-500 mb-6">{t("messenger.welcomeDesc")}</p>
                <div className="flex flex-col gap-3">
                  <div className="w-full">
                    <button
                      type="button"
                      onClick={() => {
                        if (!inviteFriendsExpanded && navigator.clipboard?.writeText) {
                          navigator.clipboard.writeText(referralLink).then(() => {
                            setInviteFriendsCopied(true);
                            setTimeout(() => setInviteFriendsCopied(false), 2000);
                          });
                        }
                        setInviteFriendsExpanded((v) => !v);
                      }}
                      className={`flex items-center gap-3 w-full rounded-xl bg-white border px-4 py-3.5 text-left hover:border-purple-300 hover:shadow-sm transition-all group ${inviteFriendsExpanded ? "border-purple-300 rounded-b-none" : "border-slate-200"}`}
                    >
                      <span className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center shrink-0 group-hover:bg-purple-200 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-600"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800">
                          {inviteFriendsCopied ? t("messenger.welcomeInviteCopied") : t("messenger.welcomeInviteFriends")}
                        </p>
                        <p className="text-xs text-slate-400">{t("messenger.welcomeInviteFriendsDesc")}</p>
                      </div>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-slate-400 shrink-0 transition-transform duration-200 ${inviteFriendsExpanded ? "rotate-180" : ""}`}><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                    <div className={`overflow-hidden transition-all duration-200 ease-out ${inviteFriendsExpanded ? "max-h-40 opacity-100" : "max-h-0 opacity-0"}`}>
                      <div className="bg-white border border-t-0 border-purple-300 rounded-b-xl px-4 py-3 flex items-center gap-2">
                        <div className="flex items-center bg-slate-50 rounded-lg px-3 py-2 min-w-0 flex-1">
                          <span className="text-xs text-slate-500 truncate select-all">{referralLink}</span>
                        </div>
                          <button
                            type="button"
                            onClick={() => {
                              if (navigator.clipboard?.writeText) {
                                navigator.clipboard.writeText(referralLink).then(() => {
                                  setInviteFriendsCopied(true);
                                  setTimeout(() => setInviteFriendsCopied(false), 2000);
                                });
                              }
                            }}
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-purple-50 text-purple-700 text-xs font-medium hover:bg-purple-100 transition-colors whitespace-nowrap shrink-0"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            {inviteFriendsCopied ? t("messenger.welcomeInviteCopied") : t("messenger.inviteCopyLink")}
                          </button>
                          {typeof navigator.share === "function" && (
                            <button
                              type="button"
                              onClick={() => {
                                navigator.share({ title: t("messenger.welcomeInviteFriends"), url: referralLink }).catch(() => {});
                              }}
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                              {t("messenger.inviteShare")}
                            </button>
                          )}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCreateChatModal(true)}
                    className="flex items-center gap-3 w-full rounded-xl bg-white border border-slate-200 px-4 py-3.5 text-left hover:border-blue-300 hover:shadow-sm transition-all group"
                  >
                    <span className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0 group-hover:bg-blue-200 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{t("messenger.welcomeCreateGroup")}</p>
                      <p className="text-xs text-slate-400">{t("messenger.welcomeCreateGroupDesc")}</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowJoinByLinkModal(true)}
                    className="flex items-center gap-3 w-full rounded-xl bg-white border border-slate-200 px-4 py-3.5 text-left hover:border-blue-300 hover:shadow-sm transition-all group"
                  >
                    <span className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0 group-hover:bg-green-200 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-600"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{t("messenger.welcomeJoin")}</p>
                      <p className="text-xs text-slate-400">{t("messenger.welcomeJoinDesc")}</p>
                    </div>
                  </button>
                  {favChatId && (
                    <button
                      type="button"
                      onClick={() => openChat(favChatId)}
                      className="flex items-center gap-3 w-full rounded-xl bg-white border border-slate-200 px-4 py-3.5 text-left hover:border-amber-300 hover:shadow-sm transition-all group"
                    >
                      <span className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0 group-hover:bg-amber-200 transition-colors">
                        <span className="text-lg">⭐</span>
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{t("messenger.welcomeFavorites")}</p>
                        <p className="text-xs text-slate-400">{t("messenger.welcomeFavoritesDesc")}</p>
                      </div>
                    </button>
                  )}
                </div>
              </div>
            );
          })()}
          </div>
        )}
      </main>
      </div>

      {/* Модалка: создать чат */}
      <CreateChatModal
        isOpen={showCreateChatModal}
        onClose={() => setShowCreateChatModal(false)}
        onCreated={handleChatCreated}
      />

      {/* Модалка: предпросмотр чата перед вступлением */}
      <JoinChatPreviewModal
        isOpen={showJoinPreviewModal}
        slug={joinPreviewSlug}
        code={joinPreviewCode}
        onClose={handleJoinPreviewClose}
        onJoined={handleJoinPreviewJoined}
        onRequestSent={handleJoinPreviewRequestSent}
      />
    </div>
  );
}
