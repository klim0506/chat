import { useEffect, useState, useRef, useCallback, useMemo, type ReactNode } from "react";
import { Link, useNavigate, useParams, useLocation } from "react-router-dom";
import { authApi, chatsApi, channelsApi, foldersApi, paymentsApi, userDisplayName, type Chat, type Channel, type ChatFolder, type UserSearchResult, type GlobalSearchResult } from "../api/client";
import { useAuthStore } from "../store/auth";
import { useChatListStore } from "../store/chatList";
import { useUploadProgressStore } from "../store/uploadProgress";
import { useMessagesStore, normalizeMessage } from "../store/messages";
import { getAvatarInitials } from "../lib/avatar-initials";
import { toSameOriginMediaUrl, getAvatarUrlBySize } from "../lib/media-url";
import { showMessageNotification } from "../lib/notifications";
import { playSound } from "../lib/sounds";
import ChatPage from "./ChatPage";
import SettingsPage from "./SettingsPage";
import { useE2eeStore } from "../store/e2ee";
import { OfflineBanner } from "../components/OfflineBanner";
import { WsManager, buildWsUrl } from "../lib/ws-manager";
import { subscribeCrossTabMessageSync } from "../lib/cross-tab-sync";
import CreateChatModal from "../components/CreateChatModal";
import CreateChannelModal from "../components/CreateChannelModal";
import JoinChatPreviewModal from "../components/JoinChatPreviewModal";
import { AnchoredPortal, TopLayerPortal, TOP_LAYER_Z_INDEX } from "../components/TopLayerPortal";
import { useTranslation, formatMembersCount, t as tFn } from "../lib/i18n";
import { usePreferencesStore } from "../store/preferences";
import type { AppLanguage } from "../store/preferences";

/** Compact time for chat list: today = "14:30", yesterday = "Вчера", older = "12 мар" */
function formatLastMessageTime(iso: string | undefined | null, lang: AppLanguage): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const today = now.getDate() === d.getDate() && now.getMonth() === d.getMonth() && now.getFullYear() === d.getFullYear();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = yesterday.getDate() === d.getDate() && yesterday.getMonth() === d.getMonth() && yesterday.getFullYear() === d.getFullYear();
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  if (today) return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (isYesterday) return lang === "ru" ? "Вчера" : "Yesterday";
  return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

/** Message preview for the chat list (matches backend get_last_message_preview logic). */
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

const ARCHIVE_FOLDER_ID = "__archive__";
const PERSONAL_FOLDER_ID = "__personal__";
const UNREAD_FOLDER_ID = "__unread__";

const FOLDER_NAME_MAX_LEN = 14;

/** Подпись вкладки папки в левой колонке — до 14 символов, обрезка с многоточием. */
function FolderTabLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  const text = typeof children === "string"
    ? (children.length > FOLDER_NAME_MAX_LEN ? children.slice(0, FOLDER_NAME_MAX_LEN) + "…" : children)
    : children;
  return (
    <div className={`overflow-hidden w-full min-w-0 font-medium truncate leading-tight px-2 ${className}`} style={{ lineHeight: 1.25 }}>
      <span className="block truncate text-center">{text}</span>
    </div>
  );
}

/** Обрезает название папки до 14 символов. */
function folderDisplayName(name: string): string {
  return (name || "").length > FOLDER_NAME_MAX_LEN ? (name || "").slice(0, FOLDER_NAME_MAX_LEN) + "…" : (name || "");
}

/** Breakpoint for left folder nav (Telegram-style) — below this, top tabs shown instead. */
const FOLDER_LEFT_BREAKPOINT = 1024;

const MOBILE_BREAKPOINT = 768;

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = () => setMatches(mq.matches);
    mq.addEventListener("change", handler);
    handler();
    return () => mq.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

function formatUnread(count: number): string {
  if (count <= 0) return "";
  if (count > 999) return "999+";
  return String(count);
}

function getActivityTimeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

type SidebarConversationItem =
  | { kind: "chat"; id: string; sortTs: number; titleKey: string; chat: Chat }
  | { kind: "channel"; id: string; sortTs: number; titleKey: string; channel: Channel };

function ChatListCheckmarks({ status }: { status: "delivered" | "read" | null | undefined }) {
  if (!status) return null;
  const color = status === "read" ? "text-blue-500" : "text-slate-400";
  return (
    <span className={`inline-flex items-center ${color}`} aria-label={status}>
      {status === "read" ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
          <path d="M22 6 11 17l-2-2" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
    </span>
  );
}


/** Shown at top of chat panel when user is in another chat but has uploads in progress elsewhere. */
function UploadingToOtherChatBar({
  currentConversationId,
  chats,
  channels,
  onNavigateToChat,
  onNavigateToChannel,
}: {
  currentConversationId: string;
  chats: Chat[];
  channels: Channel[];
  onNavigateToChat: (chatId: string) => void;
  onNavigateToChannel: (id: string) => void;
}) {
  const otherUploads = useUploadProgressStore((s) => s.getActiveUploadsForOtherChats(currentConversationId));
  const cancelUpload = useUploadProgressStore((s) => s.cancelUpload);
  const { t } = useTranslation();
  if (otherUploads.length === 0) return null;
  const byChat = otherUploads.reduce<Record<string, typeof otherUploads>>((acc, u) => {
    (acc[u.conversationId] = acc[u.conversationId] ?? []).push(u);
    return acc;
  }, {});
  const chatIds = Object.keys(byChat);
  return (
    <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 bg-amber-50 border-b border-amber-200 text-sm">
      {chatIds.map((convId) => {
        const list = byChat[convId];
        const chat = chats.find((c) => c.id === convId);
        const channel = channels.find((c) => c.id === convId);
        const title = channel?.title ?? chat?.title ?? convId.slice(0, 8);
        const isChannel = !!channel;
        return (
          <span key={convId} className="inline-flex items-center gap-2 flex-wrap">
            <span className="text-amber-800">
              {list.length === 1 ? t("chat.uploading") : `${t("chat.uploading")} (${list.length})`} → {title}
            </span>
            <button
              type="button"
              className="text-amber-700 underline hover:text-amber-900"
              onClick={() => (isChannel ? onNavigateToChannel(convId) : onNavigateToChat(convId))}
            >
              {t("common.open")}
            </button>
            {list.map((u) => (
              <button
                key={u.tempId}
                type="button"
                className="text-amber-600 hover:text-amber-800 text-xs"
                onClick={() => cancelUpload(u.tempId)}
              >
                {t("chat.cancelUpload")}
              </button>
            ))}
          </span>
        );
      })}
    </div>
  );
}

export default function MessengerPage() {
  const { t, lang } = useTranslation();
  const tRef = useRef(t);
  const { chatId: urlChatId, channelId: urlChannelId } = useParams<{ chatId?: string; channelId?: string }>();
  const location = useLocation();
  const showSettings = location.pathname === "/chats/settings";
  // Derive from pathname as source of truth (avoids useParams/react-router timing issues)
  const pathname = location.pathname;
  const renderChannelId = pathname.startsWith("/channel/") ? pathname.slice("/channel/".length).split("/")[0] || null : null;
  const renderChatId = pathname.startsWith("/chat/") && !pathname.startsWith("/chat/join") ? pathname.slice("/chat/".length).split("/")[0] || null : null;
  const isMobile = useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  const [settingsMobileInSubSection, setSettingsMobileInSubSection] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(urlChatId || null);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(urlChannelId || null);
  const [channels, setChannels] = useState<Channel[]>([]);
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
  const SUB_CACHE_KEY = "subscription_cache_v1";
  const [sub, setSub] = useState<{ is_valid?: boolean; has_subscription?: boolean; is_referral_trial?: boolean } | null>(() => {
    try {
      const raw = localStorage.getItem(SUB_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { is_valid?: boolean; has_subscription?: boolean; is_referral_trial?: boolean } | null;
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsSub, _setNeedsSub] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [userSearchResults, setUserSearchResults] = useState<UserSearchResult[]>([]);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [msgSearchResults, setMsgSearchResults] = useState<GlobalSearchResult[]>([]);
  const [msgSearchLoading, setMsgSearchLoading] = useState(false);
  const msgSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const menuPopoverRef = useRef<HTMLDivElement>(null);
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
  /** Context menu on right-click on a chat */
  const [chatContextMenu, setChatContextMenu] = useState<{ x: number; y: number; chat: Chat } | null>(null);
  /** Custom folders (no default "Чаты"/"Новые" — add in Settings → Folders) */
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expandedFolderId, setExpandedFolderId] = useState<string | null>(null);
  const folderLayout = usePreferencesStore((s) => s.folderLayout);
  const isFolderLeftWider = useMediaQuery(`(min-width: ${FOLDER_LEFT_BREAKPOINT}px)`);
  const theme = usePreferencesStore((s) => s.theme);
  const setTheme = usePreferencesStore((s) => s.setTheme);
  const foldersEnabled = usePreferencesStore((s) => s.foldersEnabled);
  const showFolderPersonal = usePreferencesStore((s) => s.showFolderPersonal);
  const showFolderUnread = usePreferencesStore((s) => s.showFolderUnread);
  const showFolderArchive = usePreferencesStore((s) => s.showFolderArchive);
  const [showCreateChatModal, setShowCreateChatModal] = useState(false);
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const createMenuPopoverRef = useRef<HTMLDivElement>(null);
  const [inviteFriendsCopied, setInviteFriendsCopied] = useState(false);
  const [expandedOnboardingBlock, setExpandedOnboardingBlock] = useState<"invite" | "create" | null>(null);
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

  // Toast: link copied on chat creation (group — invite link, DM — chat link)
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

  // Open DM when URL contains ?write=username (shareable profile link)
  useEffect(() => {
    if (location.pathname !== "/chats" || !location.search) return;
    const params = new URLSearchParams(location.search);
    const writeUsername = params.get("write");
    if (!writeUsername?.trim()) return;
    params.delete("write");
    const remaining = params.toString();
    navigate(remaining ? `${location.pathname}?${remaining}` : location.pathname, { replace: true });
    authApi.searchUsers(writeUsername.trim())
      .then((res) => {
        const exact = (res.data.results || []).find((u) => (u.username || "").toLowerCase() === writeUsername.trim().toLowerCase());
        const user = exact || (res.data.results || [])[0];
        if (!user) return;
        return chatsApi.getOrCreateDm(user.id).then((dmRes) => {
          const chat = dmRes.data;
          storeUpsertChat(chat);
          openChat(chat.id);
        });
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  // Sync URL with active chat/channel / settings
  useEffect(() => {
    if (location.pathname === "/chats/settings") {
      setActiveChatId(null);
      setActiveChannelId(null);
    } else if (urlChannelId) {
      setActiveChannelId(urlChannelId);
      setActiveChatId(null);
    } else if (urlChatId) {
      setActiveChatId(urlChatId);
      setActiveChannelId(null); // Always clear channel when on chat route
    }
  }, [location.pathname, urlChatId, urlChannelId]);

  /* ---------- Load channels ---------- */
  useEffect(() => {
    if (!token) return;
    channelsApi.list()
      .then((res) => setChannels(res.data?.results ?? []))
      .catch(() => setChannels([]));
  }, [token]);

  /* ---------- Load folders ---------- */
  useEffect(() => {
    if (!token) return;
    foldersApi.list()
      .then((res) => setFolders(Array.isArray(res.data) ? res.data : []))
      .catch(() => setFolders([]));
  }, [token]);

  /* ---------- E2EE device registration (when authenticated) ---------- */
  useEffect(() => {
    if (token) {
      useE2eeStore.getState().ensureRegistered();
    }
  }, [token]);

  /* ---------- Load data ---------- */
  const LOAD_TIMEOUT_MS = 10_000;
  useEffect(() => {
    if (!token) {
      setLoading(false);
      useChatListStore.getState().setLoading(false);
      return;
    }
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      setLoading(false);
      useChatListStore.getState().setLoading(false);
      // Не выставляем error по таймауту — ошибку выставит loadChats при реальном падении запроса
    }, LOAD_TIMEOUT_MS);

    const finish = () => {
      if (!timedOut) {
        clearTimeout(timeoutId);
        setLoading(false);
      }
    };

    paymentsApi.getSubscription()
      .then((subRes) => {
        if (timedOut) return;
        setSub(subRes.data);
        try { localStorage.setItem(SUB_CACHE_KEY, JSON.stringify(subRes.data ?? null)); } catch { /* ignore */ }
        return loadChats().then(() => {
          if (!timedOut) lastSyncedPinnedRef.current = useChatListStore.getState().pinnedChatIds;
        });
      })
      .catch(() => {
        if (timedOut) return;
        setSub(null);
        try { localStorage.setItem(SUB_CACHE_KEY, "null"); } catch { /* ignore */ }
        // Не показываем «Не удалось загрузить чаты» из‑за ошибки подписки — только при реальной ошибке loadChats
        return loadChats().catch(() => {}).then(() => {
          if (!timedOut) lastSyncedPinnedRef.current = useChatListStore.getState().pinnedChatIds;
        });
      })
      .finally(finish);

    return () => clearTimeout(timeoutId);
  }, [loadChats, token]);

  /* ---------- New-login toast ---------- */
  const [newLoginToast, setNewLoginToast] = useState<{ device: string; ip: string } | null>(null);
  useEffect(() => {
    if (!newLoginToast) return;
    const t = setTimeout(() => setNewLoginToast(null), 8000);
    return () => clearTimeout(t);
  }, [newLoginToast]);

  /* ---------- Global notification WebSocket ---------- */
  const [typingByChat, setTypingByChat] = useState<Record<string, string>>({});
  const typingTimeoutRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleNotification = useCallback((data: {
    type: string;
    chat_id?: string;
    chat_title?: string;
    message?: { sender_display_name?: string; content?: string };
    is_muted?: boolean;
    is_mention?: boolean;
    display_name?: string;
    user_id?: string;
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

    if (data.type === "join_request" && data.chat_id) {
      chatsApi.get(data.chat_id).then((res) => {
        storeUpsertChat(res.data);
      }).catch(() => {});
      return;
    }

    if (data.type === "reaction_on_message" && data.chat_id) {
      const d = data as { chat_id: string; chat_title?: string; reactor_name?: string; emoji?: string; message_preview?: string };
      const body = t("notification.reactionOnMessage")
        .replace(/\{\{name\}\}/g, d.reactor_name ?? "")
        .replace(/\{\{emoji\}\}/g, d.emoji ?? "")
        .replace(/\{\{message\}\}/g, d.message_preview ?? "");
      // Telegram-like behavior: if the chat is open and visible, don't notify about seen reactions.
      const isActive = d.chat_id === activeChatId;
      const tabVisible = !document.hidden;
      if (!(isActive && tabVisible)) {
        showMessageNotification(d.chat_title || t("dashboard.newMessage"), { content: body }, { chatId: d.chat_id });
      }
      return;
    }

    if (data.type === "typing" && data.chat_id) {
      const name = (data.display_name || data.user_id || "").trim();
      if (typingTimeoutRef.current[data.chat_id]) clearTimeout(typingTimeoutRef.current[data.chat_id]);
      setTypingByChat((prev) => ({ ...prev, [data.chat_id!]: name }));
      typingTimeoutRef.current[data.chat_id!] = setTimeout(() => {
        setTypingByChat((prev) => {
          const next = { ...prev };
          delete next[data.chat_id!];
          return next;
        });
        delete typingTimeoutRef.current[data.chat_id!];
      }, 3000);
      return;
    }

    if (data.type === "new_message" && data.chat_id) {
      const chatId = data.chat_id;
      const raw = data.message as Record<string, unknown> | undefined;
      // Upsert message into store immediately (with file/files) so it appears when opening the chat
      if (raw && typeof raw.id === "string") {
        let msgRaw = { ...raw };
        if (!msgRaw.sender && msgRaw.sender_id) {
          msgRaw = {
            ...msgRaw,
            sender: {
              id: msgRaw.sender_id,
              display_name: (msgRaw.sender_display_name as string) || "",
              phone: "",
              avatar: null,
              avatar_url: (msgRaw.sender_avatar_url as string) || null,
              avatar_url_small: (msgRaw.sender_avatar_url_small as string) || null,
            },
          };
        }
        const msg = normalizeMessage({
          ...msgRaw,
          id: msgRaw.id as string,
          created_at: (msgRaw.created_at as string) || new Date().toISOString(),
          reactions: (msgRaw.reactions as Record<string, number>) ?? {},
          my_reactions: (msgRaw.my_reactions as string[]) ?? [],
        } as Parameters<typeof normalizeMessage>[0]);
        useMessagesStore.getState().upsertMessage(chatId, msg);
      }
      const preview = data.message ? formatMessagePreview(data.message, lang) : undefined;
      const currentChats = useChatListStore.getState().chats;
      const found = currentChats.some((c) => c.id === chatId);

      if (found) {
        // Update existing chat in store; auto-unarchive when new message arrives (Telegram-style)
        const isActive = chatId === activeChatId;
        const chat = currentChats.find((c) => c.id === chatId);
        const msgCreatedAt = (data.message as { created_at?: string })?.created_at;
        const senderId = (data.message as { sender_id?: string; sender?: { id?: string } })?.sender_id
          || (data.message as { sender?: { id?: string } })?.sender?.id;
        const myUserId = useAuthStore.getState().user?.id;
        const isMine = !!senderId && !!myUserId && senderId === myUserId;
        storeUpdateChat(chatId, {
          unread_count: isActive
            ? (chat?.unread_count || 0)
            : (chat?.unread_count || 0) + 1,
          ...(preview ? { last_message_preview: preview } : {}),
          ...(msgCreatedAt ? { last_message_at: msgCreatedAt } : {}),
          ...(isMine ? { last_message_is_mine: true, last_message_read_status: "delivered" as const } : { last_message_is_mine: false, last_message_read_status: null }),
          ...(chat?.is_archived ? { is_archived: false } : {}),
        });
      } else {
        chatsApi.get(chatId).then((res) => {
          const msgCreatedAt = (data.message as { created_at?: string })?.created_at;
          const senderId = (data.message as { sender_id?: string; sender?: { id?: string } })?.sender_id
            || (data.message as { sender?: { id?: string } })?.sender?.id;
          const myUserId = useAuthStore.getState().user?.id;
          const isMine = !!senderId && !!myUserId && senderId === myUserId;
          storeUpsertChat(res.data, {
            unread_count: activeChatId === chatId ? res.data.unread_count : (res.data.unread_count || 0) + 1,
            last_message_preview: preview ?? res.data.last_message_preview,
            ...(msgCreatedAt ? { last_message_at: msgCreatedAt } : {}),
            ...(isMine ? { last_message_is_mine: true, last_message_read_status: "delivered" as const } : {}),
          });
        }).catch(() => {
          // Chat not accessible — do not add to store
        });
      }
      if (!data.is_muted) {
        const isActive = chatId === activeChatId;
        const tabVisible = !document.hidden;
        // Skip sound & notification if ChatPage's chat WS already handles it
        if (isActive && tabVisible) { /* ChatPage plays sound via chat WS */ } else {
          const content = (data.message?.content as string) || "";
          const me = useAuthStore.getState().user;
          const identifiers = [me?.display_name, me?.username, me?.telegram_username].filter(Boolean) as string[];
          const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const isMention = identifiers.some((id) => new RegExp(`@${escapeRegex(id)}\\b`, "i").test(content));
          playSound(isMention ? "mention" : "receive");
          showMessageNotification(data.chat_title || t("dashboard.newMessage"), data.message || {}, {
            chatId,
          });
        }
      }
    }
  }, [activeChatId, storeUpsertChat, storeUpdateChat]);

  const notifMgrRef = useRef<WsManager | null>(null);
  const handleNotificationRef = useRef(handleNotification);
  handleNotificationRef.current = handleNotification;
  useEffect(() => {
    if (!token || needsSub) return;
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

  // Cross-tab sync: when one tab sends a message via REST, other tabs (same browser) get it immediately
  useEffect(() => {
    const unsub = subscribeCrossTabMessageSync();
    return unsub;
  }, []);

  useEffect(() => {
    if (!showCreateMenu) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        createMenuRef.current &&
        !createMenuRef.current.contains(target) &&
        !createMenuPopoverRef.current?.contains(target)
      ) {
        setShowCreateMenu(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [showCreateMenu]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        !menuPopoverRef.current?.contains(target)
      ) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (selectedFolderId === PERSONAL_FOLDER_ID && !showFolderPersonal) {
      setSelectedFolderId(null);
    } else if (selectedFolderId === UNREAD_FOLDER_ID && !showFolderUnread) {
      setSelectedFolderId(null);
    } else if (selectedFolderId === ARCHIVE_FOLDER_ID && !showFolderArchive) {
      setSelectedFolderId(null);
    }
  }, [selectedFolderId, showFolderArchive, showFolderPersonal, showFolderUnread]);

  const openChat = (chatId: string) => {
    setActiveChatId(chatId);
    setActiveChannelId(null);
    storeSetUnread(chatId, 0);
    navigate(`/chat/${chatId}`, { replace: true });
  };

  const closeChat = () => {
    setActiveChatId(null);
    navigate("/chats", { replace: true });
  };

  const openChannel = (channelId: string) => {
    setActiveChannelId(channelId);
    setActiveChatId(null);
    navigate(`/channel/${channelId}`, { replace: true });
  };

  const closeChannel = () => {
    setActiveChannelId(null);
    navigate("/chats", { replace: true });
  };

  const closeSettings = () => {
    navigate("/chats", { replace: true });
  };

  const pinnedOrder = useMemo(
    () => new Map(pinnedChatIds.map((id, index) => [id, index])),
    [pinnedChatIds],
  );
  const compareSidebarItems = useCallback((a: SidebarConversationItem, b: SidebarConversationItem) => {
    const aPinIndex = a.kind === "chat" ? pinnedOrder.get(a.chat.id) : undefined;
    const bPinIndex = b.kind === "chat" ? pinnedOrder.get(b.chat.id) : undefined;
    const aPinned = aPinIndex !== undefined;
    const bPinned = bPinIndex !== undefined;
    if (aPinned || bPinned) {
      if (!aPinned) return 1;
      if (!bPinned) return -1;
      return aPinIndex - bPinIndex;
    }
    if (a.sortTs !== b.sortTs) return b.sortTs - a.sortTs;
    const titleCmp = a.titleKey.localeCompare(b.titleKey, lang === "ru" ? "ru" : "en", { sensitivity: "base" });
    if (titleCmp !== 0) return titleCmp;
    if (a.kind !== b.kind) return a.kind === "channel" ? -1 : 1;
    return a.id.localeCompare(b.id);
  }, [lang, pinnedOrder]);

  const sortedChats = useMemo(() => [...chats].sort((a, b) => {
    const aItem: SidebarConversationItem = {
      kind: "chat",
      id: a.id,
      sortTs: getActivityTimeMs(a.last_message_at || a.created_at),
      titleKey: (a.is_favorites ? t("chat.favoritesTitle") : a.is_personal && a.other_member ? userDisplayName(a.other_member) : a.title || "").trim().toLocaleLowerCase(),
      chat: a,
    };
    const bItem: SidebarConversationItem = {
      kind: "chat",
      id: b.id,
      sortTs: getActivityTimeMs(b.last_message_at || b.created_at),
      titleKey: (b.is_favorites ? t("chat.favoritesTitle") : b.is_personal && b.other_member ? userDisplayName(b.other_member) : b.title || "").trim().toLocaleLowerCase(),
      chat: b,
    };
    return compareSidebarItems(aItem, bItem);
  }), [chats, compareSidebarItems, t]);

  const archivedCount = chats.filter((c) => c.is_archived && (c.unread_count || 0) > 0).length;
  const unreadCount = chats.filter((c) => !c.is_archived && (c.unread_count || 0) > 0).length;
  const personalCount = chats.filter((c) => !c.is_archived && !!c.is_personal && (c.unread_count || 0) > 0).length;

  const hasFolderTabs = foldersEnabled && (sub?.has_subscription === true || sub?.is_valid === true);

  let baseChats: typeof sortedChats;
  if (selectedFolderId === ARCHIVE_FOLDER_ID) {
    baseChats = sortedChats.filter((c) => c.is_archived);
  } else if (selectedFolderId === PERSONAL_FOLDER_ID) {
    baseChats = sortedChats.filter((c) => !c.is_archived && !!c.is_personal);
  } else if (selectedFolderId === UNREAD_FOLDER_ID) {
    baseChats = sortedChats.filter((c) => !c.is_archived && (c.unread_count || 0) > 0);
  } else if (selectedFolderId) {
    baseChats = sortedChats
      .filter((c) => !c.is_archived)
      .filter((c) => (c.folder_ids || []).includes(selectedFolderId));
  } else {
    baseChats = sortedChats.filter((c) => !c.is_archived);
  }

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

  const baseChannels = selectedFolderId ? [] : channels;
  const filteredChannels = q
    ? baseChannels.filter((c) => {
        const title = (c.title || "").toLowerCase();
        const username = (c.username || "").toLowerCase();
        return title.includes(q) || username.includes(q);
      })
    : baseChannels;
  const sidebarItems = useMemo<SidebarConversationItem[]>(() => {
    const items: SidebarConversationItem[] = [
      ...filteredChats.map((chat) => ({
        kind: "chat" as const,
        id: chat.id,
        sortTs: getActivityTimeMs(chat.last_message_at || chat.created_at),
        titleKey: (chat.is_favorites ? t("chat.favoritesTitle") : chat.is_personal && chat.other_member ? userDisplayName(chat.other_member) : chat.title || "").trim().toLocaleLowerCase(),
        chat,
      })),
      ...filteredChannels.map((channel) => ({
        kind: "channel" as const,
        id: channel.id,
        sortTs: getActivityTimeMs(channel.last_post_at || channel.created_at),
        titleKey: (channel.title || "").trim().toLocaleLowerCase(),
        channel,
      })),
    ];
    return items.sort(compareSidebarItems);
  }, [compareSidebarItems, filteredChannels, filteredChats, t]);

  const rightPanelOpen = !!activeChatId || !!activeChannelId || showSettings;
  const onlyFavoritesChat = chats.length === 1 && !!chats[0]?.is_favorites;
  const hasRegularChats = chats.some((chat) => !chat.is_favorites);
  const showSidebarSearch = hasRegularChats || channels.length > 0 || archivedCount > 0 || !!selectedFolderId || q.length > 0;
  const showRightPanel = rightPanelOpen || chats.length === 0 || (!rightPanelOpen && onlyFavoritesChat);
  const folderTabBaseClass = "border text-center transition-[background-color,box-shadow,border-color,color,transform] duration-150 ease-out";
  const folderTabActiveClass = "border-sky-200 bg-white/90 text-slate-900 shadow-[0_8px_18px_rgba(15,23,42,0.05)]";
  const folderTabInactiveClass = "border-transparent text-slate-600 hover:bg-white/75 hover:text-slate-800";
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

  // Close context menu on outside click
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

  const handleMarkRead = useCallback(
    async (chat: Chat) => {
      try {
        await chatsApi.markRead(chat.id);
        storeSetUnread(chat.id, 0);
      } catch { /* ignore */ }
      setChatContextMenu(null);
    },
    [storeSetUnread]
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

  // Unified search: by chats (filteredChats) and by usernames (debounced API)
  useEffect(() => {
    const raw = searchQuery.trim();
    const usernameOnly = raw.startsWith("@");
    const q = usernameOnly ? raw.slice(1).trim() : raw;
    // If user started with "@", treat as username-only search and allow 1 char after "@"
    const minLen = usernameOnly ? 1 : 2;
    if (q.length < minLen) {
      setUserSearchResults([]);
      return;
    }
    if (userSearchDebounceRef.current) clearTimeout(userSearchDebounceRef.current);
    userSearchDebounceRef.current = setTimeout(() => {
      setUserSearchLoading(true);
      authApi
        .searchUsers(q)
        .then((res) => {
          const list = res.data.results || [];
          if (!usernameOnly) {
            setUserSearchResults(list);
            return;
          }
          const ql = q.toLowerCase();
          setUserSearchResults(list.filter((u) => (u.username || "").toLowerCase().startsWith(ql)));
        })
        .catch(() => setUserSearchResults([]))
        .finally(() => setUserSearchLoading(false));
    }, 300);
    return () => {
      if (userSearchDebounceRef.current) clearTimeout(userSearchDebounceRef.current);
    };
  }, [searchQuery]);

  // Global message search
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) { setMsgSearchResults([]); return; }
    if (msgSearchDebounceRef.current) clearTimeout(msgSearchDebounceRef.current);
    msgSearchDebounceRef.current = setTimeout(() => {
      setMsgSearchLoading(true);
      chatsApi
        .globalSearch(q, { limit: 20 })
        .then((res) => setMsgSearchResults(res.data.results || []))
        .catch(() => setMsgSearchResults([]))
        .finally(() => setMsgSearchLoading(false));
    }, 400);
    return () => { if (msgSearchDebounceRef.current) clearTimeout(msgSearchDebounceRef.current); };
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
    [openChat, t, storeUpsertChat]
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
    loadChats().then(() => openChat(chatId));
  }, [loadChats, openChat]);

  const handleChannelCreated = useCallback((channelId: string, inviteLink: string | null) => {
    setShowCreateChannelModal(false);
    if (inviteLink) {
      copyInviteLink(inviteLink);
      setInviteToastIsChatLink(false);
      setShowInviteLinkCopiedToast(true);
      setTimeout(() => setShowInviteLinkCopiedToast(false), 2000);
    }
    channelsApi.list()
      .then((res) => setChannels(res.data?.results ?? []))
      .catch(() => {});
    openChannel(channelId);
  }, [openChannel]);

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
    <div className="messenger-app-bg flex h-screen flex-col overflow-hidden relative">
      <OfflineBanner />
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
      {/* Toast: invite link copied */}
      {showInviteLinkCopiedToast && (
        <TopLayerPortal>
          <button
            type="button"
            onClick={() => setShowInviteLinkCopiedToast(false)}
            className="fixed top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-3 bg-slate-800 text-white text-sm rounded-lg shadow-lg cursor-pointer hover:bg-slate-700 transition-colors text-left"
            style={{ zIndex: TOP_LAYER_Z_INDEX }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400 shrink-0">
              <path d="M20 6 9 17l-5-5"/>
            </svg>
            <span>{inviteToastIsChatLink ? t("messenger.chatLinkCopied") : t("messenger.inviteLinkCopied")}</span>
          </button>
        </TopLayerPortal>
      )}

      {/* Toast: new account login */}
      {newLoginToast && (
        <TopLayerPortal>
          <button
            type="button"
            onClick={() => {
              setNewLoginToast(null);
              navigate("/chats/settings");
            }}
            className="fixed top-4 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-3 bg-amber-600 text-white text-sm rounded-lg shadow-lg cursor-pointer hover:bg-amber-700 transition-colors text-left max-w-md"
            style={{ zIndex: TOP_LAYER_Z_INDEX }}
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
        </TopLayerPortal>
      )}

      {/* Modal: join by link */}
      {showJoinByLinkModal && (
        <div className="fixed inset-0 z-[150] min-h-screen w-screen flex items-center justify-center p-4 bg-black/50 overflow-y-auto" onClick={closeJoinByLinkModal}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 text-left my-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">{t("messenger.joinByLinkTitle")}</h2>
            <p className="text-slate-600 text-sm mb-4">
              {t("messenger.joinByLinkDesc")}
            </p>
            <div className="flex gap-2">
              <input
                type="url"
                placeholder={t("messenger.joinByLinkPlaceholder")}
                value={joinLinkInput}
                onChange={(e) => setJoinLinkInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJoinByLinkSubmit()}
                className={`flex-1 min-w-0 px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 ${joinStatus === "error" ? "border-red-500 focus:ring-red-500 focus:border-red-500" : "border-slate-300 focus:ring-blue-400 focus:border-blue-400"}`}
                disabled={joinStatus === "loading"}
                autoFocus
              />
              <button
                type="button"
                onClick={handleJoinByLinkSubmit}
                disabled={joinStatus === "loading"}
                className="shrink-0 px-4 py-2.5 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm"
              >
                {joinStatus === "loading" ? t("messenger.joining") : t("messenger.join")}
              </button>
            </div>
            {joinStatus === "loading" && <p className="text-slate-500 text-sm mt-2">{t("common.loading")}</p>}
            {joinStatus === "error" && <p className="text-red-500 text-sm mt-2">{joinMessage}</p>}
            {joinStatus === "pending" && <p className="text-green-600 text-sm mt-2">{joinMessage}</p>}
            {joinStatus === "joined" && <p className="text-green-600 text-sm mt-2">{joinMessage}</p>}
            <button type="button" onClick={closeJoinByLinkModal} className="mt-3 text-slate-500 hover:text-slate-700 text-sm">
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Chat context menu (right-click) */}
      {chatContextMenu && (
        <TopLayerPortal>
          <div
            className="fixed w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-1"
            style={{ left: chatContextMenu.x, top: chatContextMenu.y, zIndex: TOP_LAYER_Z_INDEX }}
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
          {(() => {
            const hasUnread = (chatContextMenu.chat.unread_count || 0) > 0 || !!chatContextMenu.chat.manually_unread;
            return (
              <button
                type="button"
                onClick={() => hasUnread ? handleMarkRead(chatContextMenu.chat) : handleMarkUnread(chatContextMenu.chat)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors w-full text-left"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                  <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                </svg>
                {hasUnread ? t("messenger.markRead") : t("messenger.markUnread")}
              </button>
            );
          })()}
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
          {folders.length > 0 && (
            <>
              <div className="border-t border-slate-100 my-1" />
              <p className="px-4 py-1.5 text-xs font-medium text-slate-500">{t("folders.addToFolder")}</p>
              {folders.map((f) => {
                const isInFolder = (chatContextMenu.chat.folder_ids || []).includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={async () => {
                      try {
                        if (isInFolder) {
                          await foldersApi.removeChat(f.id, chatContextMenu.chat.id);
                          storeUpdateChat(chatContextMenu.chat.id, {
                            folder_ids: (chatContextMenu.chat.folder_ids || []).filter((id) => id !== f.id),
                          });
                        } else {
                          await foldersApi.addChat(f.id, chatContextMenu.chat.id);
                          storeUpdateChat(chatContextMenu.chat.id, {
                            folder_ids: [...(chatContextMenu.chat.folder_ids || []), f.id],
                          });
                        }
                      } catch { /* ignore */ }
                      setChatContextMenu(null);
                    }}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors w-full text-left"
                  >
                    <span className="text-base">{f.emoji || "📁"}</span>
                    <span>{f.name}</span>
                    {isInFolder && <span className="ml-auto text-xs text-blue-600">✓</span>}
                  </button>
                );
              })}
            </>
          )}
          </div>
        </TopLayerPortal>
      )}

      {/* ═══════ Left sidebar — column-left (Telegram: chatlist-container + folders) ═══════ */}
      <aside
        className={`column-left chatlist-container ${rightPanelOpen ? "hidden md:flex" : "flex max-md:!w-full"} app-shell-backdrop flex-row border-r ui-border-subtle ui-surface-1 shrink-0 relative overflow-hidden`}
        style={{ width: sidebarWidth, minWidth: 220 }}
        id="column-left"
      >
        {/* Tab panel (left layout): standard folders + user folders — hidden when <xl, top tabs shown instead */}
        {folderLayout === "left" && hasFolderTabs && isFolderLeftWider && (
        <nav
          className="flex w-24 shrink-0 flex-col gap-2 border-r border-slate-200/70 bg-white/62 px-2 py-3 backdrop-blur-xl"
          aria-label={t("messenger.chats")}
        >
          <button
            type="button"
            onClick={() => setSelectedFolderId(null)}
            className={`flex h-[4.5rem] w-full flex-col items-center justify-center gap-0.5 rounded-[24px] ${folderTabBaseClass} ${selectedFolderId === null ? folderTabActiveClass : folderTabInactiveClass}`}
          >
            <span className="flex items-center justify-center w-11 h-11 shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </span>
            <FolderTabLabel className="ui-text-title">
              {t("messenger.chats")}
            </FolderTabLabel>
          </button>
          {foldersEnabled && showFolderPersonal && (
            <button
              type="button"
              onClick={() => setSelectedFolderId(PERSONAL_FOLDER_ID)}
              className={`flex h-[4.5rem] w-full flex-col items-center justify-center gap-0.5 rounded-[24px] ${folderTabBaseClass} ${selectedFolderId === PERSONAL_FOLDER_ID ? folderTabActiveClass : folderTabInactiveClass}`}
            >
              <span className="relative flex items-center justify-center w-11 h-11 shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                {personalCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[0.625rem] font-semibold flex items-center justify-center">
                    {personalCount > 99 ? "99+" : personalCount}
                  </span>
                )}
              </span>
              <FolderTabLabel className="ui-text-title">{t("folders.standardPersonal")}</FolderTabLabel>
            </button>
          )}
          {foldersEnabled && showFolderUnread && (
            <button
              type="button"
              onClick={() => setSelectedFolderId(UNREAD_FOLDER_ID)}
              className={`flex h-[4.5rem] w-full flex-col items-center justify-center gap-0.5 rounded-[24px] ${folderTabBaseClass} ${selectedFolderId === UNREAD_FOLDER_ID ? folderTabActiveClass : folderTabInactiveClass}`}
            >
              <span className="relative flex items-center justify-center w-11 h-11 shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13 17a1 1 0 0 1-2 0"/>
                </svg>
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[0.625rem] font-semibold flex items-center justify-center">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </span>
              <FolderTabLabel className="ui-text-title">{t("folders.standardUnread")}</FolderTabLabel>
            </button>
          )}
          {foldersEnabled && showFolderArchive && (
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => setSelectedFolderId(ARCHIVE_FOLDER_ID)}
              className={`flex h-[4.5rem] w-full flex-col items-center justify-center gap-0.5 rounded-[24px] ${folderTabBaseClass} ${selectedFolderId === ARCHIVE_FOLDER_ID ? folderTabActiveClass : folderTabInactiveClass}`}
            >
                <span className="relative flex items-center justify-center w-11 h-11 shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>
                  </svg>
                  {archivedCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[0.625rem] font-semibold flex items-center justify-center">
                      {archivedCount > 99 ? "99+" : archivedCount}
                    </span>
                  )}
                </span>
                <FolderTabLabel className="ui-text-title">{t("folders.standardArchive")}</FolderTabLabel>
              </button>
            </div>
          )}
          {folders.map((f) => {
            const folderChatsList = sortedChats.filter((c) => !c.is_archived && (c.folder_ids || []).includes(f.id));
            return (
              <div key={f.id} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFolderId(f.id);
                    setExpandedFolderId((prev) => (prev === f.id ? null : f.id));
                  }}
                  className={`flex h-[4.5rem] w-full flex-col items-center justify-center gap-0.5 rounded-[24px] ${folderTabBaseClass} ${selectedFolderId === f.id ? folderTabActiveClass : folderTabInactiveClass}`}
                >
                  <span className="flex items-center justify-center w-11 h-11 shrink-0 text-2xl leading-none">{f.emoji || "📁"}</span>
                  <FolderTabLabel className="ui-text-title">{folderDisplayName(f.name)}</FolderTabLabel>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`shrink-0 transition-transform ${expandedFolderId === f.id ? "rotate-180" : ""}`}><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {expandedFolderId === f.id && (
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-2xl border border-slate-200/80 bg-white/72 p-1.5 shadow-[0_12px_28px_rgba(15,23,42,0.08)]">
                    {folderChatsList.length === 0 ? null : (
                      folderChatsList.map((chat) => (
                        <button
                          key={chat.id}
                          type="button"
                          onClick={() => openChat(chat.id)}
                          className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors duration-150 ease-out ${chat.id === activeChatId && !showSettings ? "ui-accent-soft border-sky-200/70 text-slate-900" : "border-transparent text-slate-600 hover:bg-slate-50"}`}
                        >
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-[0.625rem] font-medium text-slate-600">
                            {chat.is_personal && chat.other_member
                              ? getAvatarInitials(userDisplayName(chat.other_member))
                              : getAvatarInitials(chat.title || "?")}
                          </div>
                          <span className="text-[0.6875rem] truncate flex-1">{chat.is_personal && chat.other_member ? userDisplayName(chat.other_member) : chat.title || "?"}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        )}

        {/* Chat list content */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {/* Sidebar header (Telegram: sidebar-header) */}
        <div
          className="sidebar-header sticky top-0 z-20 flex h-16 items-center border-b px-4 backdrop-blur-xl"
          style={{ background: "var(--glass-bg)", borderColor: "var(--border-subtle)", boxShadow: "var(--shadow-1)" }}
        >
          <div className="flex w-full min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 shrink-0 items-center justify-center">
                <img src="/app-icon-header.png" alt="Pingy" className="h-8 w-auto object-contain object-center" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative" ref={createMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowCreateMenu((v) => !v)}
                  className="ui-accent-strong flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-medium text-white transition-[transform,background-color,box-shadow] active:scale-[0.98]"
                  title={t("dashboard.createChat")}
                >
                  <span aria-hidden className="text-xl leading-none font-semibold">
                    +
                  </span>
                </button>
                {showCreateMenu && (
                  <AnchoredPortal
                    anchorRef={createMenuRef}
                    portalRef={createMenuPopoverRef}
                    align="right"
                    minWidth={168}
                    className="rounded-2xl border border-slate-200 bg-white/95 py-1.5 shadow-[0_24px_60px_rgba(15,23,42,0.16)] backdrop-blur animate-in fade-in slide-in-from-top-1"
                  >
                    <button
                      type="button"
                      onClick={() => { setShowCreateMenu(false); setShowCreateChatModal(true); }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 shrink-0">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                      </svg>
                      {t("createMenu.optionGroup")}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowCreateMenu(false); setShowCreateChannelModal(true); }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 shrink-0">
                        <path d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"/>
                      </svg>
                      {t("createMenu.optionChannel")}
                    </button>
                  </AnchoredPortal>
                )}
              </div>

              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  className="soft-chip flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-2xl px-3 text-sm font-medium text-slate-500 transition-[transform,background-color,color] hover:text-slate-800 active:scale-[0.98]"
                  title={t("messenger.menu")}
                  aria-label={t("messenger.menu")}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
                  </svg>
                </button>

                {menuOpen && (
                  <AnchoredPortal
                    anchorRef={menuRef}
                    portalRef={menuPopoverRef}
                    align="right"
                    minWidth={220}
                    className="rounded-2xl border border-slate-200 bg-white/95 py-1.5 shadow-[0_24px_60px_rgba(15,23,42,0.16)] backdrop-blur animate-in fade-in slide-in-from-top-1"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        navigate("/chats/settings");
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-400">
                        <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                      </svg>
                      {t("common.settings")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setSelectedFolderId(ARCHIVE_FOLDER_ID);
                        navigate("/chats", { replace: true });
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-400">
                        <path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>
                      </svg>
                      {t("messenger.archived")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTheme(theme === "dark" ? "light" : "dark");
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-400">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3c0 .89.2 1.73.57 2.49A7 7 0 0 0 18.5 12c.76.37 1.6.57 2.5.57z"/>
                      </svg>
                      {t(theme === "dark" ? "messenger.dayTheme" : "messenger.nightTheme")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        navigate("/downloads/desktop");
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-400">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                      {t("messenger.downloadApp")}
                    </button>
                  </AnchoredPortal>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Unified search: chats + users by username */}
        {showSidebarSearch && (
          <div className="border-b px-4 py-3 ui-border-subtle">
            <div className="relative">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
              </svg>
              <input
                type="text"
                placeholder={t("messenger.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ui-text-assist w-full rounded-2xl border border-slate-200/80 bg-white/80 py-3 pl-10 pr-4 text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] placeholder:text-slate-400 transition-[border-color,box-shadow,background-color] focus:border-sky-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-sky-100"
              />
            </div>
          </div>
        )}

        {/* Folder tabs: when top layout — scrollable row of buttons with icon + label */}
        {hasFolderTabs && (folderLayout === "top" || (folderLayout === "left" && !isFolderLeftWider)) && (
          <div className="flex h-16 shrink-0 items-center gap-2 overflow-x-auto scrollbar-hide border-b px-4 ui-border-subtle">
            {(() => {
              const short = (s: string) => (s.length > 8 ? `${s.slice(0, 8)}…` : s);
              return (
                <>
            <button
              type="button"
              onClick={() => setSelectedFolderId(null)}
              title={t("messenger.chats")}
              className={`flex h-11 min-w-[6.25rem] shrink-0 items-center justify-start gap-1.5 rounded-2xl px-3 text-left ${
                folderTabBaseClass
              } ${
                !selectedFolderId ? folderTabActiveClass : folderTabInactiveClass
              }`}
            >
              <span className="flex items-center justify-center w-6 h-6 shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </span>
              <span className="text-[0.75rem] leading-tight font-medium truncate text-left">{short(t("messenger.chats"))}</span>
            </button>
            {foldersEnabled && showFolderPersonal && (
              <button
                type="button"
                onClick={() => setSelectedFolderId(PERSONAL_FOLDER_ID)}
                title={t("folders.standardPersonal")}
                className={`flex h-11 min-w-[6.25rem] shrink-0 items-center justify-start gap-1.5 rounded-2xl px-3 text-left ${
                  folderTabBaseClass
                } ${
                  selectedFolderId === PERSONAL_FOLDER_ID ? folderTabActiveClass : folderTabInactiveClass
                }`}
              >
                <span className="relative flex items-center justify-center w-6 h-6 shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  {personalCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-blue-600 px-1 text-[0.625rem] font-semibold text-white">
                      {personalCount > 99 ? "99+" : personalCount}
                    </span>
                  )}
                </span>
                <span className="text-[0.75rem] leading-tight font-medium truncate text-left">{short(t("folders.standardPersonal"))}</span>
              </button>
            )}
            {foldersEnabled && showFolderUnread && (
              <button
                type="button"
                onClick={() => setSelectedFolderId(UNREAD_FOLDER_ID)}
                title={t("folders.standardUnread")}
                className={`flex h-11 min-w-[6.25rem] shrink-0 items-center justify-start gap-1.5 rounded-2xl px-3 text-left ${
                  folderTabBaseClass
                } ${
                  selectedFolderId === UNREAD_FOLDER_ID ? folderTabActiveClass : folderTabInactiveClass
                }`}
              >
                <span className="relative flex items-center justify-center w-6 h-6 shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13 17a1 1 0 0 1-2 0"/></svg>
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-blue-600 px-1 text-[0.625rem] font-semibold text-white">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </span>
                <span className="text-[0.75rem] leading-tight font-medium truncate text-left">{short(t("folders.standardUnread"))}</span>
              </button>
            )}
            {foldersEnabled && showFolderArchive && (
              <button
                type="button"
                onClick={() => setSelectedFolderId(ARCHIVE_FOLDER_ID)}
                title={t("folders.standardArchive")}
                className={`flex h-11 min-w-[6.25rem] shrink-0 items-center justify-start gap-1.5 rounded-2xl px-3 text-left ${
                  folderTabBaseClass
                } ${
                  selectedFolderId === ARCHIVE_FOLDER_ID ? folderTabActiveClass : folderTabInactiveClass
                }`}
              >
                <span className="relative flex items-center justify-center w-6 h-6 shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
                  {archivedCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-blue-600 px-1 text-[0.625rem] font-semibold text-white">
                      {archivedCount > 99 ? "99+" : archivedCount}
                    </span>
                  )}
                </span>
                <span className="text-[0.75rem] leading-tight font-medium truncate text-left">{short(t("folders.standardArchive"))}</span>
              </button>
            )}
            {folders.map((f) => {
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelectedFolderId(f.id)}
                  title={folderDisplayName(f.name)}
                  className={`flex h-11 min-w-[6.25rem] shrink-0 items-center justify-start gap-1.5 rounded-2xl px-3 text-left ${
                    folderTabBaseClass
                  } ${
                    selectedFolderId === f.id ? folderTabActiveClass : folderTabInactiveClass
                  }`}
                >
                  <span className="flex items-center justify-center w-6 h-6 shrink-0 text-base leading-none">{f.emoji || "📁"}</span>
                  <span className="text-[0.75rem] leading-tight font-medium truncate text-left">{short(folderDisplayName(f.name))}</span>
                </button>
              );
            })}
                </>
              );
            })()}
          </div>
        )}

        {/* List: when search is active — chats + users, otherwise chats only */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div key={selectedFolderId ?? "all"} className="min-h-full messenger-panel-fade-in">
          {(loading || chatListLoading) && <p className="text-slate-500 text-sm text-center py-8">{t("common.loading")}</p>}
          {(error || chatListError) && chats.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 px-4 gap-3">
              <p className="text-red-500 text-sm text-center">
                {chatListError === "dashboard.loadError" || chatListError === "subscription_required"
                  ? t(chatListError)
                  : (error || chatListError)}
              </p>
              <button
                type="button"
                onClick={() => {
                  setError("");
                  useChatListStore.getState().loadChats().then((ok) => {
                    if (ok || useChatListStore.getState().error === null) setError("");
                    else if (chats.length > 0) setError(tRef.current("dashboard.refreshError"));
                  });
                }}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
              >
                {t("common.retry")}
              </button>
            </div>
          )}
          {(error || chatListError) && chats.length > 0 && (
            <div className="flex items-center justify-center gap-2 py-2 px-3 bg-amber-50 border-b border-amber-200/70">
              <p className="text-amber-800 text-sm">{t("dashboard.refreshError")}</p>
              <button
                type="button"
                onClick={() => {
                  setError("");
                  useChatListStore.getState().loadChats().then((ok) => {
                    if (ok || useChatListStore.getState().error === null) setError("");
                    else if (chats.length > 0) setError(tRef.current("dashboard.refreshError"));
                  });
                }}
                className="text-sm font-medium text-amber-700 hover:text-amber-900 underline shrink-0"
              >
                {t("common.retry")}
              </button>
            </div>
          )}

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

          {!needsSub && !loading && !chatListLoading && !error && !chatListError && chats.length === 0 && channels.length === 0 && q.length === 0 && (
            <div className="p-5">
              <div className="mx-auto max-w-sm rounded-[28px] border border-slate-200/80 bg-white/80 p-6 text-center shadow-[0_18px_42px_rgba(15,23,42,0.08)]">
              <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <h2 className="text-slate-700 font-medium mb-1">{t("messenger.noChatsYet")}</h2>
              <p className="text-slate-500 text-sm mb-4 max-w-[240px] mx-auto">
                {t("messenger.noChatsDesc")}
              </p>
              <div className="flex flex-col gap-2 mb-3">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await chatsApi.getFavorites();
                      const fav = res.data;
                      if (fav) {
                        storeUpsertChat(fav);
                        openChat(fav.id);
                      }
                    } catch {
                      setError(t("messenger.openChatError"));
                      setTimeout(() => setError(""), 5000);
                    }
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  {t("chat.favoritesTitle")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateMenu(true)}
                  className="ui-accent-strong inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium text-white transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                  {t("messenger.createFirst")}
                </button>
              </div>
              <p className="text-slate-400 text-xs mt-3">
                {t("messenger.haveInvite")}{" "}
                <button type="button" onClick={() => setShowJoinByLinkModal(true)} className="text-blue-600 hover:underline">{t("messenger.joinChat")}</button>
              </p>
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (expandedOnboardingBlock !== "invite" && navigator.clipboard?.writeText) {
                      navigator.clipboard.writeText(referralLink).then(() => {
                        setInviteFriendsCopied(true);
                        setTimeout(() => setInviteFriendsCopied(false), 2000);
                      });
                    }
                    setExpandedOnboardingBlock((v) => (v === "invite" ? null : "invite"));
                  }}
                  className="inline-flex items-center gap-1.5 text-xs text-purple-600 hover:underline"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                  {inviteFriendsCopied ? t("messenger.welcomeInviteCopied") : t("messenger.welcomeInviteFriends")}
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-200 ${expandedOnboardingBlock === "invite" ? "rotate-180" : ""}`}><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <div className={`overflow-hidden transition-all duration-200 ease-out ${expandedOnboardingBlock === "invite" ? "max-h-32 opacity-100 mt-2" : "max-h-0 opacity-0"}`}>
                  <div className="mx-auto flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2.5">
                    <div className="flex items-center bg-slate-50 rounded-lg px-2.5 py-1.5 min-w-0 flex-1">
                      <span className="text-[0.6875rem] text-slate-500 truncate select-all">{referralLink}</span>
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
                        className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-purple-50 text-purple-700 text-[0.6875rem] font-medium hover:bg-purple-100 transition-colors whitespace-nowrap shrink-0"
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
                          className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-[0.6875rem] font-medium hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                          {t("messenger.inviteShare")}
                        </button>
                      )}
                  </div>
                </div>
                  </div>
              </div>
            </div>
          )}

          {!needsSub && !loading && !chatListLoading && (sidebarItems.length > 0 || q.length > 0 || archivedCount > 0 || selectedFolderId) && (
            <>
              {false && (
                <ul className="flex flex-col gap-1 px-2 py-1">
                  {filteredChannels.map((ch) => {
                    const isActive = ch.id === activeChannelId && !showSettings;
                    const channelSubtitle = ch.last_post_preview || (ch.username ? `@${ch.username}` : t("createMenu.createChannel"));
                    const channelTime = formatLastMessageTime((ch.last_post_at ?? ch.created_at) ?? undefined, lang);
                    return (
                      <li key={ch.id}>
                        <button
                          type="button"
                          onClick={() => openChannel(ch.id)}
                          className={`flex w-full items-center gap-2.5 rounded-[20px] border px-3 py-2.5 text-left transition-[background-color,box-shadow,border-color,transform] duration-150 ease-out ${
                            isActive ? "border-sky-200 bg-white/90 shadow-[0_8px_18px_rgba(15,23,42,0.05)]" : "border-transparent hover:bg-white/75"
                          }`}
                        >
                          <div className="relative shrink-0">
                            {ch.avatar_url ? (
                              <>
                                <img
                                  src={toSameOriginMediaUrl(getAvatarUrlBySize(ch.avatar_url, ch.avatar_url_small, ch.avatar_url_medium, "medium")) || ""}
                                  alt=""
                                  className="h-10 w-10 rounded-full object-cover"
                                  loading="lazy"
                                  decoding="async"
                                  onError={(e) => { e.currentTarget.style.display = "none"; const fb = e.currentTarget.nextElementSibling as HTMLElement; if (fb) fb.style.display = ""; }}
                                />
                                <div style={{ display: "none" }} className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${isActive ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"}`}>
                                  {getAvatarInitials(ch.title || "К")}
                                </div>
                              </>
                            ) : (
                              <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${
                                isActive ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"
                              }`}>
                                {getAvatarInitials(ch.title || "К")}
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`flex items-center gap-1 truncate text-[0.9375rem] font-medium ${isActive ? "text-blue-700" : "text-slate-700"}`}>
                                {ch.title}
                                {ch.title_icon && <span className="shrink-0" aria-hidden>{ch.title_icon}</span>}
                              </span>
                            </div>
                            <div className="mt-0.5 flex min-w-0 items-baseline justify-between gap-2">
                              <span className="text-slate-500 text-xs truncate min-w-0">
                                {channelSubtitle}
                              </span>
                              {channelTime && (
                                <span className="shrink-0 text-[0.625rem] tabular-nums text-slate-400">
                                  {channelTime}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {sidebarItems.length > 0 ? (
                <ul className="flex flex-col gap-1 px-2 py-1">
                  {sidebarItems.map((item) => {
                    if (item.kind === "channel") {
                      const ch = item.channel;
                      const isActive = ch.id === activeChannelId && !showSettings;
                      const channelSubtitle = ch.last_post_preview || (ch.username ? `@${ch.username}` : t("createMenu.createChannel"));
                      const channelTime = formatLastMessageTime((ch.last_post_at ?? ch.created_at) ?? undefined, lang);
                      return (
                        <li key={`channel-${ch.id}`}>
                          <button
                            type="button"
                            onClick={() => openChannel(ch.id)}
                            className={`flex w-full items-center gap-2.5 rounded-[20px] border px-3 py-2.5 text-left transition-[background-color,box-shadow,border-color,transform] duration-150 ease-out ${
                              isActive ? "border-sky-200 bg-white/90 shadow-[0_8px_18px_rgba(15,23,42,0.05)]" : "border-transparent hover:bg-white/75"
                            }`}
                          >
                            <div className="relative shrink-0">
                              {ch.avatar_url ? (
                                <>
                                  <img
                                    src={toSameOriginMediaUrl(getAvatarUrlBySize(ch.avatar_url, ch.avatar_url_small, ch.avatar_url_medium, "medium")) || ""}
                                    alt=""
                                    className="h-10 w-10 rounded-full object-cover"
                                    loading="lazy"
                                    decoding="async"
                                    onError={(e) => { e.currentTarget.style.display = "none"; const fb = e.currentTarget.nextElementSibling as HTMLElement; if (fb) fb.style.display = ""; }}
                                  />
                                  <div style={{ display: "none" }} className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${isActive ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"}`}>
                                    {getAvatarInitials(ch.title || "Ðš")}
                                  </div>
                                </>
                              ) : (
                                <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${
                                  isActive ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"
                                }`}>
                                  {getAvatarInitials(ch.title || "Ðš")}
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className={`flex items-center gap-1 truncate text-[0.9375rem] font-medium ${isActive ? "text-blue-700" : "text-slate-700"}`}>
                                  {ch.title}
                                  {ch.title_icon && <span className="shrink-0" aria-hidden>{ch.title_icon}</span>}
                                </span>
                              </div>
                              <div className="mt-0.5 flex min-w-0 items-baseline justify-between gap-2">
                                <span className="text-slate-500 text-xs truncate min-w-0">
                                  {channelSubtitle}
                                </span>
                                {channelTime && (
                                  <span className="shrink-0 text-[0.625rem] tabular-nums text-slate-400">
                                    {channelTime}
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    }

                    const chat = item.chat;
                    const unread = chat.unread_count || 0;
                    const unreadStr = formatUnread(unread);
                    const isActive = chat.id === activeChatId && !showSettings;
                    const isPinned = pinnedOrder.has(chat.id);
                    return (
                      <li key={`chat-${chat.id}`}>
                        <button
                          onClick={() => openChat(chat.id)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setChatContextMenu({ x: e.clientX, y: e.clientY, chat });
                          }}
                          className={`chat-list-row flex w-full items-center gap-2.5 rounded-[20px] border px-3 py-2.5 text-left transition-[background-color,box-shadow,border-color,transform] duration-150 ease-out ${
                              isActive
                                ? "border-sky-200 bg-white/90 shadow-[0_8px_18px_rgba(15,23,42,0.05)]"
                                : "border-transparent hover:bg-white/75"
                          } active:scale-[0.997]`}
                        >
                          {/* Avatar left, then content (subtitle row + title row) */}
                          <div className="chat-list-row-avatar relative shrink-0">
                            {chat.is_favorites ? (
                              <div className={`dialog-avatar flex h-10 w-10 items-center justify-center rounded-full ${
                                isActive ? "bg-blue-600" : "bg-blue-500"
                              }`}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                              </div>
                            ) : (() => {
                              const rawUrl = chat.is_personal && chat.other_member
                                ? (chat.other_member.avatar_url ?? chat.other_member.avatar)
                                : chat.avatar_url;
                              const urlSmall = chat.is_personal && chat.other_member ? chat.other_member.avatar_url_small : chat.avatar_url_small;
                              const urlMedium = chat.is_personal && chat.other_member ? chat.other_member.avatar_url_medium : chat.avatar_url_medium;
                              const src = rawUrl ? (toSameOriginMediaUrl(getAvatarUrlBySize(rawUrl, urlSmall, urlMedium, "medium")) ?? "") : "";
                              const showImg = Boolean(src);
                              return showImg ? (
                                <>
                                  <img
                                    src={src}
                                    alt=""
                                    className="dialog-avatar avatar-photo h-10 w-10 rounded-full object-cover"
                                    loading="lazy"
                                    decoding="async"
                                    onError={(e) => { const img = e.currentTarget; img.style.display = "none"; const fallback = img.nextElementSibling as HTMLElement; if (fallback) fallback.style.display = ""; }}
                                  />
                                  <div style={{ display: "none" }} className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${
                                    isActive ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"
                                  }`}>
                                    {chat.is_personal && chat.other_member
                                      ? getAvatarInitials(userDisplayName(chat.other_member))
                                      : getAvatarInitials(chat.title || "Ч")}
                                  </div>
                                </>
                              ) : (
                                <div className={`dialog-avatar flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${
                                  isActive ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"
                                }`}>
                                  {chat.is_personal && chat.other_member
                                    ? getAvatarInitials(userDisplayName(chat.other_member))
                                    : getAvatarInitials(chat.title || "Ч")}
                                </div>
                              );
                            })()}
                            {chat.is_personal && chat.other_member?.is_online && (
                              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-green-500 shadow-sm" />
                            )}
                          </div>
                          <div className="chat-list-row-content flex flex-1 min-w-0 flex-col">
                            {/* Row 1: preview / typing + unread badge (dialog-subtitle) */}
                            <div className="chat-list-row-subtitle flex min-w-0 items-center justify-between gap-2">
                              <span className="text-slate-500 text-xs truncate min-w-0">
                                {typingByChat[chat.id] && chat.id !== activeChatId
                                  ? `${typingByChat[chat.id]} ${t("chat.typing")}`
                                  : (chat.last_message_preview || (chat.is_personal
                                    ? (chat.other_member?.username ? `@${chat.other_member.username}` : t("dashboard.personalChat"))
                                    : `${formatMembersCount(chat.members_count ?? 0, lang)} · ${chat.chat_type === "open" ? t("dashboard.openType") : t("dashboard.closedType")}`))}
                              </span>
                              {unread > 0 && (
                                chat.manually_unread && unread <= 1 ? (
                                  <span className={`dialog-subtitle-badge inline-block w-3 h-3 shrink-0 rounded-full ${
                                    chat.is_muted ? "bg-slate-400" : "bg-blue-600"
                                  }`} />
                                ) : (
                                  <span className={`dialog-subtitle-badge inline-flex min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 py-0.5 text-[0.625rem] font-bold text-white ${
                                    chat.is_muted ? "bg-slate-400" : "bg-blue-600"
                                  }`}>
                                    {unreadStr}
                                  </span>
                                )
                              )}
                            </div>
                            {/* Row 2: title + icons, time / checkmarks (row-title-row) */}
                            <div className="chat-list-row-title row-title-row flex min-w-0 items-center justify-between gap-2 mt-0.5">
                              <div className="flex min-w-0 items-center gap-1.5">
                                {isPinned && (
                                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500 shrink-0" aria-label={t("messenger.pinned")}>
                                    <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
                                  </svg>
                                )}
                                <span className={`peer-title flex items-center gap-1 truncate text-[0.9375rem] font-medium ${unread > 0 ? "text-slate-900" : "text-slate-700"}`}>
                                  {chat.is_favorites ? t("chat.favoritesTitle") : chat.is_personal && chat.other_member ? userDisplayName(chat.other_member) : chat.title}
                                  {chat.title_icon && <span className="shrink-0" aria-hidden>{chat.title_icon}</span>}
                                  {chat.is_secret && (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-emerald-500" aria-hidden>
                                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                    </svg>
                                  )}
                                </span>
                                {chat.is_muted && (
                                  <span className="inline-flex h-4.5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-400" title={t("messenger.muted")} aria-label={t("messenger.muted")}>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                                  </span>
                                )}
                                {(chat.pending_join_requests_count ?? 0) > 0 && (
                                  <span className="shrink-0 text-[0.625rem] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded" title={t("chat.pendingRequests")}>
                                    {t("chat.pendingRequests")}: {chat.pending_join_requests_count}
                                  </span>
                                )}
                              </div>
                              {(chat.last_message_at || chat.created_at) && (
                                <span className="message-time inline-flex shrink-0 items-center gap-1 text-[0.625rem] tabular-nums text-slate-400">
                                  {chat.last_message_is_mine && (
                                    <ChatListCheckmarks status={chat.last_message_read_status ?? "delivered"} />
                                  )}
                                  {formatLastMessageTime((chat.last_message_at || chat.created_at) ?? undefined, lang)}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : q.length > 0 ? (
                <p className="text-slate-500 text-sm py-3 px-4">{t("messenger.noMatchingChats")}</p>
              ) : selectedFolderId === ARCHIVE_FOLDER_ID ? (
                <p className="text-slate-500 text-sm py-3 px-4">{t("messenger.archiveEmpty")}</p>
              ) : selectedFolderId === PERSONAL_FOLDER_ID ? (
                <p className="text-slate-500 text-sm py-3 px-4">{t("messenger.personalEmpty")}</p>
              ) : selectedFolderId === UNREAD_FOLDER_ID ? (
                <p className="text-slate-500 text-sm py-3 px-4">{t("messenger.unreadEmpty")}</p>
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
                            <>
                              <img
                                src={toSameOriginMediaUrl(getAvatarUrlBySize(u.avatar_url, undefined, undefined, "medium")) || ""}
                                alt=""
                                className="w-12 h-12 rounded-full object-cover shrink-0"
                                loading="lazy"
                                decoding="async"
                                onError={(e) => { e.currentTarget.style.display = "none"; const fb = e.currentTarget.nextElementSibling as HTMLElement; if (fb) fb.style.display = ""; }}
                              />
                              <div style={{ display: "none" }} className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center text-sm font-medium text-slate-600 shrink-0">
                                {getAvatarInitials(u.display_name || u.username || "?")}
                              </div>
                            </>
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
              {q.length >= 2 && (
                <div className="border-t border-slate-200">
                  <p className="px-4 py-2 text-xs font-medium text-slate-500 bg-slate-50/80">{t("search.globalPlaceholder")}</p>
                  {msgSearchLoading ? (
                    <p className="text-slate-500 text-xs py-3 px-4">{t("messenger.searching")}</p>
                  ) : msgSearchResults.length === 0 ? (
                    <p className="text-slate-500 text-xs py-3 px-4">{t("search.noResults")}</p>
                  ) : (
                    <ul className="py-1">
                      {msgSearchResults.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => { openChat(r.chat_id); setSearchQuery(""); setMsgSearchResults([]); }}
                            className="w-full text-left flex items-start gap-3 px-4 py-2 hover:bg-slate-50 transition-colors"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-400 mt-0.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-1">
                                <span className="text-xs font-medium text-slate-700 truncate">{r.sender_name}</span>
                                <span className="text-[0.625rem] text-slate-400 shrink-0">{new Date(r.created_at).toLocaleDateString()}</span>
                              </div>
                              <p className="text-xs text-slate-500 truncate">{r.content}</p>
                              <p className="text-[0.625rem] text-blue-500 truncate mt-0.5">{r.chat_title}</p>
                            </div>
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
        </div>
        </div>
      </aside>

      {/* Resizer — always visible on desktop, position is persisted. Dark cursor so visible in light theme. */}
      <div
        role="separator"
        aria-label={t("messenger.resizeSidebar")}
        onMouseDown={handleResizeStart}
        className="hidden md:block absolute top-0 bottom-0"
        style={{
          left: sidebarWidth,
          width: 12,
          transform: "translateX(-6px)",
          cursor: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='24' viewBox='0 0 16 24'%3E%3Cpath fill='%23000' d='M5 0h2v24H5zM9 0h2v24H9z'/%3E%3C/svg%3E") 8 12, col-resize`,
        }}
      />

      {/* ═══════ Right panel — column-center (Telegram: main-column / chat area) ═══════ */}
      <main id="column-center" className={`column-center main-column ${showRightPanel ? "flex" : "hidden md:flex"} messenger-main-backdrop flex-col flex-1 min-w-0 min-h-0 overflow-hidden`}>
        {showSettings ? (
          <div key="settings" className="flex flex-col flex-1 min-h-0 overflow-hidden messenger-panel-fade-in">
            {!(isMobile && settingsMobileInSubSection) && (
              <header
                className="sticky top-0 z-20 shrink-0 border-b backdrop-blur px-4 h-16 flex items-center gap-3"
                style={{ background: "var(--glass-bg)", borderColor: "var(--border-subtle)", boxShadow: "var(--shadow-1)" }}
              >
                <button
                  type="button"
                  onClick={closeSettings}
                  className="p-2 -ml-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100/80 transition-colors"
                  title={t("common.back")}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m15 18-6-6 6-6"/>
                  </svg>
                </button>
                <h1 className="font-semibold truncate" style={{ color: "var(--text-0)" }}>{t("common.settings")}</h1>
              </header>
            )}
            <div className="flex-1 min-h-0 overflow-hidden">
              <SettingsPage
                embed
                onMobileInSubSection={setSettingsMobileInSubSection}
                onFoldersUpdated={() => {
                  foldersApi.list()
                    .then((res) => setFolders(Array.isArray(res.data) ? res.data : []))
                    .catch(() => setFolders([]));
                }}
              />
            </div>
          </div>
        ) : renderChannelId ? (
          <div key={`channel-${renderChannelId}`} className="flex-1 min-h-0 overflow-hidden flex flex-col messenger-chat-panel messenger-panel-fade-in">
            <UploadingToOtherChatBar
              currentConversationId={renderChannelId}
              chats={chats}
              channels={channels}
              onNavigateToChat={openChat}
              onNavigateToChannel={(id) => navigate(`/channel/${id}`)}
            />
            <ChatPage
              key={renderChannelId}
              channelId={renderChannelId}
              onBack={closeChannel}
              onMessageSent={(cid, preview, messageCreatedAt) => {
                setChannels((prev) => prev.map((channel) => (
                  channel.id === cid
                    ? {
                        ...channel,
                        last_post_preview: preview,
                        ...(messageCreatedAt ? { last_post_at: messageCreatedAt } : {}),
                      }
                    : channel
                )));
              }}
            />
          </div>
        ) : renderChatId ? (
          <div key={`chat-${renderChatId}`} className="flex-1 min-h-0 overflow-hidden flex flex-col messenger-chat-panel messenger-panel-fade-in">
            <UploadingToOtherChatBar
              currentConversationId={renderChatId}
              chats={chats}
              channels={channels}
              onNavigateToChat={openChat}
              onNavigateToChannel={(id) => navigate(`/channel/${id}`)}
            />
            <ChatPage
              key={renderChatId}
              chatId={renderChatId}
              onBack={closeChat}
              onChatUpdated={(updated) => {
                const updates: Partial<Chat> = {};
                if (updated.title !== undefined) updates.title = updated.title;
                if (updated.avatar_url !== undefined) updates.avatar_url = updated.avatar_url;
                if (updated.is_muted !== undefined) updates.is_muted = updated.is_muted;
                if (updated.pending_join_requests_count !== undefined) updates.pending_join_requests_count = updated.pending_join_requests_count;
                storeUpdateChat(updated.id, updates);
              }}
              onMessageSent={(cid, preview, messageCreatedAt) =>
                storeUpdateChat(cid, { last_message_preview: preview, ...(messageCreatedAt ? { last_message_at: messageCreatedAt } : {}) })
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
          <div key="welcome" className="messenger-main-backdrop flex-1 min-h-0 flex items-center justify-center p-6 messenger-panel-fade-in">
          {(() => {
            const favChat = chats.find((chat) => chat.is_favorites) ?? null;
            const favChatId = favChat?.id ?? null;
            const welcomeCopy = lang === "ru"
              ? {
                  existingTitle: "Выберите чат",
                  existingDesc: "Откройте диалог слева или начните новый разговор.",
                  firstTitle: "Начните с первого чата",
                  firstDesc: "Создайте группу или канал, вступите по ссылке или используйте Избранное для заметок и файлов.",
                  inviteHint: "Приглашение можно отправить позже — ссылка уже готова.",
                }
              : {
                  existingTitle: "Choose a chat",
                  existingDesc: "Open a conversation from the left or start a new one.",
                  firstTitle: "Start with your first chat",
                  firstDesc: "Create a group or channel, join via invite link, or use Favorites for notes and files.",
                  inviteHint: "You can invite friends later, the referral link is already ready.",
                };

            const openFavorites = () => {
              if (favChatId) {
                openChat(favChatId);
                return;
              }
              chatsApi.getFavorites()
                .then((res) => {
                  const fav = res.data;
                  if (fav) {
                    storeUpsertChat(fav);
                    openChat(fav.id);
                  }
                })
                .catch((err: { response?: { data?: { detail?: string } } }) => {
                  const detail = err?.response?.data?.detail;
                  const msg = typeof detail === "string" ? detail : t("messenger.openChatError");
                  setError(msg);
                  setTimeout(() => setError(""), 5000);
                });
            };

            const copyReferral = () => {
              if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(referralLink).then(() => {
                  setInviteFriendsCopied(true);
                  setTimeout(() => setInviteFriendsCopied(false), 2000);
                });
              }
            };

            if (hasRegularChats) {
              return (
                <div className="max-w-lg rounded-[32px] border border-slate-200/80 bg-white/72 p-7 text-center shadow-[0_24px_60px_rgba(15,23,42,0.10)] backdrop-blur">
                  <div className="mb-4 inline-flex items-center justify-center rounded-full bg-slate-100/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {lang === "ru" ? "Открытые чаты" : "Open chats"}
                  </div>
                  <h2 className="mb-2 text-xl font-semibold text-slate-800">{welcomeCopy.existingTitle}</h2>
                  <p className="mx-auto mb-6 max-w-md text-sm leading-6 text-slate-500">{welcomeCopy.existingDesc}</p>
                  <div className="mx-auto mb-6 grid max-w-md gap-2 text-left sm:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-white/85 px-4 py-3">
                      <p className="text-sm font-medium text-slate-800">{lang === "ru" ? "Список слева" : "List on the left"}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">{lang === "ru" ? "Откройте любой диалог одним нажатием." : "Open any conversation with one tap."}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white/85 px-4 py-3">
                      <p className="text-sm font-medium text-slate-800">{lang === "ru" ? "Новый чат" : "Start new"}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">{lang === "ru" ? "Создайте группу, канал или перейдите в Избранное." : "Create a group, a channel, or open Favorites."}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => setShowCreateChatModal(true)}
                      className="ui-accent-strong inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium text-white transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                      {t("createMenu.createGroup")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreateChannelModal(true)}
                      className="ui-accent-strong inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium text-white transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"/></svg>
                      {t("createMenu.createChannel")}
                    </button>
                    <button
                      type="button"
                      onClick={openFavorites}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <span className="text-base">★</span>
                      {t("messenger.welcomeFavorites")}
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div className="max-w-md rounded-[32px] border border-slate-200/80 bg-white/76 p-7 text-center shadow-[0_24px_60px_rgba(15,23,42,0.10)] backdrop-blur">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100">
                  <span className="text-2xl">👋</span>
                </div>
                <h2 className="text-2xl font-semibold text-slate-800 mb-2">{welcomeCopy.firstTitle}</h2>
                <p className="text-sm text-slate-500 mb-6 leading-6">{welcomeCopy.firstDesc}</p>
                <div className="flex flex-col gap-3">
                  <div className="w-full rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 text-left">
                    <div className="mb-3 flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-700">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">
                          {inviteFriendsCopied ? t("messenger.welcomeInviteCopied") : t("messenger.welcomeInviteFriends")}
                        </p>
                        <p className="text-xs leading-5 text-slate-400">{welcomeCopy.inviteHint}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                        <span className="block truncate select-all">{referralLink}</span>
                      </div>
                      <button
                        type="button"
                        onClick={copyReferral}
                        className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-purple-50 px-3 py-2 text-xs font-medium text-purple-700 transition-colors hover:bg-purple-100"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        {inviteFriendsCopied ? t("messenger.welcomeInviteCopied") : t("messenger.inviteCopyLink")}
                      </button>
                      {typeof navigator.share === "function" && (
                        <button
                          type="button"
                          onClick={() => {
                            navigator.share({ title: t("messenger.welcomeInviteFriends"), url: referralLink }).catch(() => {});
                          }}
                          className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                          {t("messenger.inviteShare")}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setShowCreateChatModal(true)}
                      className="flex items-center gap-3 rounded-[24px] border border-slate-200 bg-white px-4 py-4 text-left transition-colors hover:border-sky-200 hover:bg-sky-50/40"
                    >
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                        <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{t("createMenu.createGroup")}</p>
                        <p className="text-xs text-slate-400">{t("messenger.welcomeCreateGroupDesc")}</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreateChannelModal(true)}
                      className="flex items-center gap-3 rounded-[24px] border border-slate-200 bg-white px-4 py-4 text-left transition-colors hover:border-sky-200 hover:bg-sky-50/40"
                    >
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                        <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"/></svg>
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{t("createMenu.createChannel")}</p>
                        <p className="text-xs text-slate-400">{t("messenger.welcomeCreateGroupDesc")}</p>
                      </div>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowJoinByLinkModal(true)}
                    className="flex items-center gap-3 w-full rounded-[24px] border border-slate-200 bg-white px-4 py-4 text-left transition-colors hover:border-emerald-200 hover:bg-emerald-50/40"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                      <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{t("messenger.joinChat")}</p>
                      <p className="text-xs text-slate-400">{t("messenger.noChatsDesc")}</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={openFavorites}
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
                </div>
              </div>
            );
          })()}
          </div>
        )}
      </main>
      </div>

      {/* Modal: create chat */}
      <CreateChatModal
        isOpen={showCreateChatModal}
        onClose={() => setShowCreateChatModal(false)}
        onCreated={handleChatCreated}
      />
      <CreateChannelModal
        isOpen={showCreateChannelModal}
        onClose={() => setShowCreateChannelModal(false)}
        onCreated={handleChannelCreated}
      />


      {/* Modal: chat preview before joining */}
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
