import axios from "axios";
import { useAuthStore } from "../store/auth";
import { usePremiumPromptStore } from "../store/premiumPrompt";

const baseURL = import.meta.env.VITE_API_URL || "";

/** Client type for session lifetime: web = 30 days, android/desktop = 3 years. Set at build time. */
const clientType = (import.meta.env.VITE_CLIENT_TYPE as string) || "web";

const API_TIMEOUT_MS = 12_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeMediaPayload<T>(value: T): T {
  const visit = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map((item) => visit(item));
    if (!isPlainObject(input)) return input;

    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(input)) out[key] = visit(raw);

    const accessHandle = typeof out.access_handle === "string" ? out.access_handle : null;
    const accessHandleSmall = typeof out.access_handle_small === "string" ? out.access_handle_small : null;
    const accessHandleMedium = typeof out.access_handle_medium === "string" ? out.access_handle_medium : null;
    const avatarHandle = typeof out.avatar_handle === "string" ? out.avatar_handle : null;
    const avatarHandleSmall = typeof out.avatar_handle_small === "string" ? out.avatar_handle_small : null;
    const avatarHandleMedium = typeof out.avatar_handle_medium === "string" ? out.avatar_handle_medium : null;
    const backgroundHandle = typeof out.background_handle === "string" ? out.background_handle : null;
    const senderAvatarHandle = typeof out.sender_avatar_handle === "string" ? out.sender_avatar_handle : null;
    const senderAvatarHandleSmall = typeof out.sender_avatar_handle_small === "string" ? out.sender_avatar_handle_small : null;

    if (accessHandle && out.url === undefined) out.url = accessHandle;
    if (accessHandleSmall && out.url_small === undefined) out.url_small = accessHandleSmall;
    if (accessHandleMedium && out.url_medium === undefined) out.url_medium = accessHandleMedium;
    if (avatarHandle && out.avatar_url === undefined) out.avatar_url = avatarHandle;
    if (avatarHandleSmall && out.avatar_url_small === undefined) out.avatar_url_small = avatarHandleSmall;
    if (avatarHandleMedium && out.avatar_url_medium === undefined) out.avatar_url_medium = avatarHandleMedium;
    if (backgroundHandle && out.background_url === undefined) out.background_url = backgroundHandle;
    if (senderAvatarHandle && out.sender_avatar_url === undefined) out.sender_avatar_url = senderAvatarHandle;
    if (senderAvatarHandleSmall && out.sender_avatar_url_small === undefined) out.sender_avatar_url_small = senderAvatarHandleSmall;

    return out;
  };

  return visit(value) as T;
}

export { normalizeMediaPayload };

export const api = axios.create({
  baseURL: baseURL ? `${baseURL}/api` : "/api",
  withCredentials: true,
  timeout: API_TIMEOUT_MS,
  headers: {
    "Content-Type": "application/json",
    "X-Client": clientType,
  },
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Don't set Content-Type for FormData — browser will set multipart/form-data with boundary
  if (config.data instanceof FormData && config.headers) {
    delete config.headers["Content-Type"];
  }
  return config;
});

api.interceptors.response.use(
  (r) => {
    r.data = normalizeMediaPayload(r.data);
    return r;
  },
  async (error) => {
    const original = error.config;
    const isRefreshRequest = original?.url?.includes("/auth/refresh/");
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      if (isRefreshRequest) {
        useAuthStore.getState().clearTokens();
        (useAuthStore as { persist?: { clearStorage?: () => void } }).persist?.clearStorage?.();
        return Promise.reject(error);
      }
      const refresh = useAuthStore.getState().refreshToken;
      try {
        const payload = refresh ? { refresh } : {};
        const { data } = await api.post<{ access: string; refresh?: string; user?: User }>(
          "/auth/refresh/",
          Object.keys(payload).length ? payload : undefined
        );
        useAuthStore.getState().setTokens(data.access, data.refresh ?? refresh ?? "", data.user);
        original.headers.Authorization = `Bearer ${data.access}`;
        return api(original);
      } catch {
        useAuthStore.getState().clearTokens();
        (useAuthStore as { persist?: { clearStorage?: () => void } }).persist?.clearStorage?.();
      }
    }
    if (error.response?.status === 403) {
      const data = error.response?.data;
      const code = data && typeof data === "object" && "code" in data ? (data as { code?: string }).code : undefined;
      const detail = data && typeof data === "object" && "detail" in data ? (data as { detail?: string | string[] }).detail : undefined;
      const msg = typeof detail === "string" ? detail : Array.isArray(detail) ? (detail[0] ?? "") : "";
      if (code === "plan_restriction" || (typeof msg === "string" && (msg.includes("подписк") || msg.includes("subscription")))) {
        const reason = typeof msg === "string" && (msg.includes("кружк") || msg.includes("video")) ? "videoCircles" as const : "generic";
        usePremiumPromptStore.getState().openPrompt(reason);
      }
    }
    return Promise.reject(error);
  }
);

export interface UserAvatar {
  id: number | "legacy";
  url: string;
  url_small?: string | null;
  url_medium?: string | null;
  order: number;
}

export interface User {
  id: string;
  /** Unique 10-digit numeric ID (read-only) */
  short_id?: number | null;
  phone: string;
  /** Unique username (latin, digits, underscore); for search and @mentions — editable in profile */
  username?: string | null;
  telegram_username?: string;
  display_name: string;
  /** Bio — visible to all who visit the profile */
  bio?: string | null;
  /** Status emoji — shown next to name in profile */
  status_emoji?: string | null;
  /** Birthday (ISO date string) — shown in profile */
  birthday?: string | null;
  /** When true, only month and day are shown (no year) */
  birthday_hide_year?: boolean;
  avatar: string | null;
  /** Full avatar URL (for display) — first from gallery */
  avatar_url?: string | null;
  /** Small avatar (64px) — for chat header, message bubble */
  avatar_url_small?: string | null;
  /** Medium avatar (160px) — for info panel, chat list */
  avatar_url_medium?: string | null;
  /** Avatar gallery (up to 30) */
  avatars?: UserAvatar[];
  referral_code?: string;
  stars?: number;
  /** User is currently online */
  is_online?: boolean;
  /** Last seen time: ISO string, "recently", or null */
  last_seen_display?: string | null;
  /** Who can see last seen: everyone | nobody | contacts */
  show_last_seen?: boolean | "everyone" | "nobody" | "contacts";
  /** Who can see phone: everyone | nobody | contacts */
  show_phone?: boolean | "everyone" | "nobody" | "contacts";
  /** Who can send DMs: everyone | nobody | contacts */
  dm_privacy?: "everyone" | "nobody" | "contacts";
  /** Who can add to groups: everyone | nobody | contacts */
  add_to_group_privacy?: "everyone" | "nobody" | "contacts";
  /** Admin dashboard access (only when viewing own profile) */
  is_staff?: boolean;
  /** Local name from contacts — visible only to the user who added it (Telegram-style) */
  local_display_name?: string | null;
  /** Channel the user manually added to their profile (only set by user, not auto) */
  personal_channel?: { id: string; title: string; title_icon?: string; username?: string | null; description?: string } | null;
}

export interface SubscriptionPlan {
  months: number;
  total_rub: number;
  per_month_rub: number;
  original_rub?: number | null;
  discount_pct?: number;
  savings_rub?: number | null;
}

export interface ReferralProgress {
  invited_count: number;
  claimed_tiers: number[];
  next_milestone: number | null;
  milestones: Record<string, number>;
}

export interface SubscriptionStatus {
  has_subscription: boolean;
  status: "trial" | "active" | "past_due" | "cancelled" | null;
  is_valid: boolean;
  current_period_end: string | null;
  is_referral_trial?: boolean;
  price_rub: number;
  plans?: SubscriptionPlan[];
  referral_progress?: ReferralProgress;
}

export interface StarTransaction {
  id: string;
  amount: number;
  reason: string;
  description: string;
  created_at: string;
}

export interface StarsBalance {
  stars: number;
  expansion_cost: number;
  transactions: StarTransaction[];
}

export type UserSearchResult = Pick<User, "id" | "username" | "display_name" | "avatar_url">;

export const authApi = {
  sendCode: (phone: string, method?: "sms" | "telegram", reuseExisting = false) =>
    api.post<{ detail: string; method?: "sms" | "telegram" | "pingy" | "debug"; is_new?: boolean }>("/auth/send-code/", {
      phone,
      ...(method ? { method } : {}),
      ...(reuseExisting ? { reuse_existing: true } : {}),
    }),
  verifyCode: (phone: string, code: string, ref?: string, username?: string) =>
    api.post<{ access: string; refresh: string; user: User }>("/auth/verify-code/", {
      phone,
      code,
      ...(ref ? { ref } : {}),
      ...(username ? { username } : {}),
    }),
  checkUsername: (username: string) =>
    api.post<{ available: boolean; detail?: string }>("/auth/check-username/", { username }),
  me: () => api.get<User>("/auth/me/"),
  logout: () => api.post("/auth/logout/"),
  updateMe: (data: Partial<User> & { personal_channel_id?: string | null }) => api.patch<User>("/auth/me/", data),
  uploadAvatar: (file: File) => {
    const fd = new FormData();
    fd.append("avatar", file);
    return api.post<User>("/auth/me/avatar/", fd);
  },
  deleteAvatar: () => api.delete<User>("/auth/me/avatar/"),
  listAvatars: () => api.get<UserAvatar[]>("/auth/me/avatars/"),
  addAvatar: (file: File) => {
    const fd = new FormData();
    fd.append("avatar", file);
    return api.post<UserAvatar>("/auth/me/avatars/", fd);
  },
  deleteAvatarById: (id: number) => api.delete(`/auth/me/avatars/${id}/`),
  reorderAvatars: (order: (number | string)[]) =>
    api.post("/auth/me/avatars/reorder/", { order }),
  searchUsers: (q: string) =>
    api.get<{ results: UserSearchResult[] }>("/auth/users/search/", { params: { q: q.trim() } }),
  /** Resolve @username to user (public, for deep links) */
  resolveUsername: (username: string) =>
    api.get<UserSearchResult & { id: string }>("/auth/users/resolve/", { params: { username: username.replace(/^@/, "") } }),
  /** Create pairing token for QR login (authenticated). Returns token, code, qr_url. */
  pairingCreate: () =>
    api.post<{ token: string; code: string; qr_url: string; expires_in: number }>("/auth/pairing/create/"),
  /** Exchange pairing token or code for access + refresh (public). */
  pairingExchange: (tokenOrCode: { token?: string; code?: string }) =>
    api.post<{ access: string; refresh: string; user: User }>("/auth/pairing/exchange/", tokenOrCode),
  feedback: (message: string, files?: File[]) => {
    const fd = new FormData();
    fd.append("message", message);
    (files || []).forEach((f) => fd.append("images", f));
    return api.post<{ status: string }>("/auth/feedback/", fd);
  },
  support: (message: string, files?: File[], topic?: string) => {
    const fd = new FormData();
    fd.append("message", message);
    if (topic) fd.append("topic", topic);
    (files || []).forEach((f) => fd.append("images", f));
    return api.post<{ status: string }>("/auth/support/", fd);
  },
};

export interface Contact {
  id: string;
  contact_user: User;
  local_name: string;
  created_at: string;
  updated_at: string;
}

export const contactsApi = {
  list: () => api.get<Contact[]>("/auth/contacts/"),
  create: (userId: string, localName: string) =>
    api.post<Contact>("/auth/contacts/", { user_id: userId, local_name: localName }),
  update: (id: string, localName: string) =>
    api.patch<Contact>(`/auth/contacts/${id}/`, { local_name: localName }),
  delete: (id: string) => api.delete(`/auth/contacts/${id}/`),
};

/** Display name for user: local_display_name > display_name > phone */
export function userDisplayName(u: { local_display_name?: string | null; display_name?: string; phone?: string } | null | undefined): string {
  if (!u) return "—";
  const s = u.local_display_name ?? u.display_name ?? u.phone ?? "";
  return String(s).trim() || "—";
}

export interface Chat {
  id: string;
  title: string;
  /** Emoji to the right of the title (Telegram-style) */
  title_icon?: string | null;
  description: string;
  slug: string;
  /** Only for groups; DMs have no type */
  chat_type: "open" | "closed" | null;
  /** DM — two people, no link and no type. A group of 2 is not a DM. */
  is_personal: boolean;
  /** Secret chat with E2EE. Messages encrypted on client; server stores only ciphertext. */
  is_secret: boolean;
  /** Favorites chat — owner only, no one can be added */
  is_favorites?: boolean;
  max_members: number;
  effective_max_members: number;
  owner: User;
  members_count: number;
  /** DMs have no invite link */
  invite_link: string | null;
  is_active: boolean;
  created_at: string;
  /** Last message timestamp (for chat list sorting) */
  last_message_at?: string | null;
  unread_count: number;
  /** True when user manually marked chat as unread (show dot, not count) */
  manually_unread?: boolean;
  is_muted: boolean;
  muted_until: string | null;
  pin_order?: number | null;
  is_archived?: boolean;
  is_expanded: boolean;
  expanded_until: string | null;
  avatar_url: string | null;
  avatar_url_small?: string | null;
  avatar_url_medium?: string | null;
  /** Chat background image URL (configured in group settings) */
  background_url: string | null;
  /** For DMs — the other member's data */
  other_member?: User | null;
  /** Pinned-for-all message (first from pinned_messages — backward compat) */
  pinned_message?: Message | null;
  /** All pinned-for-all messages (ordered by pin_order desc) */
  pinned_messages?: Message[];
  /** Max allowed pinned-for-all messages (depends on expansion level) */
  max_pins?: number;
  /** Messages pinned by current user (for self) */
  my_pinned_messages?: Message[];
  /** Last message preview for chat list */
  last_message_preview?: string | null;
  /** Last message is sent by current user (for checkmarks in chat list). */
  last_message_is_mine?: boolean;
  /** For own last message: delivered (1 check) or read (2 checks). */
  last_message_read_status?: "delivered" | "read" | null;
  /** IDs of user folders this chat belongs to */
  folder_ids?: string[];
  /** Pending join requests (for admins/owner of closed groups) */
  pending_join_requests_count?: number;
  /** Whether this chat has had Telegram import (shows "Manage import" instead of "Import") */
  has_telegram_import?: boolean;
  /** Slow mode: 0 = off; min seconds between messages per user (owners/admins exempt) */
  slow_mode_seconds?: number;
}

export interface JoinChatPreview {
  chat_type: "open" | "closed";
  title: string;
  description?: string;
  avatar_url?: string | null;
  members_count?: number;
  already_member?: boolean;
  chat_id?: string;
  is_kicked?: boolean;
  is_pending?: boolean;
}

export interface ReplyMessage {
  id: string;
  sender: User;
  /** Display name when imported from Telegram without user mapping */
  sender_display_name?: string | null;
  msg_type: string;
  content: string;
  file: FileAttachment | null;
  created_at: string;
  is_deleted: boolean;
}

export interface Message {
  id: string;
  chat: string;
  sender: User;
  /** Display name when imported from Telegram without user mapping */
  sender_display_name?: string | null;
  msg_type: string;
  content: string;
  file: FileAttachment | null;
  /** Multiple files (images) in a single message */
  files: FileAttachment[];
  created_at: string;
  edited_at: string | null;
  is_deleted: boolean;
  reactions: Record<string, number>;
  /** Up to 3 reactions by the current user on this message */
  my_reactions: string[];
  /** Channel mode only: number of comments under the post */
  comments_count?: number;
  /** Channel mode only: post views counter */
  views_count?: number;
  /** Own messages only: delivered (1 check) or read (2 checks). */
  read_status?: "delivered" | "read" | null;
  /** Own messages only: who read this message (last_read_at >= created_at). */
  read_by?: User[];
  /** Audio waveform amplitudes (0–255, up to 128 values) */
  waveform?: number[] | null;
  /** Voice message duration in seconds (for display before audio loads) */
  duration_seconds?: number | null;
  /** Message being replied to (single-level quoting) */
  reply_to?: ReplyMessage | null;
  /** Original sender of the forwarded message */
  forwarded_from?: User | null;
  /** Chat title the message was forwarded from */
  forwarded_from_chat_title?: string | null;
  /** E2EE: message is encrypted */
  is_encrypted?: boolean;
  /** E2EE: encrypted keys by device_id */
  encrypted_keys?: Record<string, { type: number; body: string; identity_key?: string; ephemeral_key?: string; spk_id?: number; opk_id?: number }>;
  /** E2EE: sender's device */
  sender_device_id?: number | null;
  /** Link preview (OG-meta): title, description, image */
  link_preview?: { url: string; title?: string; description?: string; image?: string } | null;
  /** Self-destruct TTL: ISO datetime when message will be deleted */
  expires_at?: string | null;
  /** Delete message after recipient views it */
  delete_after_read?: boolean;
  /** Poll config: options, multiple, anonymous, quiz, correct_index */
  poll_data?: { options: string[]; multiple?: boolean; anonymous?: boolean; quiz?: boolean; correct_index?: number | null } | null;
  /** Poll vote counts per option */
  poll_results?: { count: number }[] | null;
  /** Current user's vote (option indices) — null if anonymous or not voted */
  my_vote?: number[] | null;
}

export interface FileAttachment {
  id: string;
  original_name: string;
  file_path: string;
  mime_type: string;
  size_bytes: number;
  storage_type: string;
  external_url: string | null;
  url: string | null;
  created_at: string;
  /** Image dimensions from server (avoids layout shift before image loads). */
  width_px?: number | null;
  height_px?: number | null;
}

export interface ChatMember {
  id: string;
  user: User;
  role: "admin" | "member";
  status: "active" | "pending" | "kicked";
  joined_at: string;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export const chatsApi = {
  list: () => api.get<PaginatedResponse<Chat>>("/chats/"),
  /** Get or create the «Избранное» chat for the current user. */
  getFavorites: () => api.get<Chat>("/chats/favorites/"),
  create: (data: { title: string; chat_type: "open" | "closed"; description?: string; title_icon?: string }) => api.post<Chat>("/chats/", data),
  get: (id: string) => api.get<Chat>(`/chats/${id}/`),
  update: (id: string, data: { title?: string; description?: string; title_icon?: string; slow_mode_seconds?: number }) => api.patch<Chat>(`/chats/${id}/`, data),
  uploadAvatar: (id: string, file: File) => {
    const form = new FormData();
    form.append("avatar", file);
    return api.post<Chat>(`/chats/${id}/avatar/`, form);
  },
  removeAvatar: (id: string) => api.post<Chat>(`/chats/${id}/avatar/`, { remove: "true" }),
  uploadBackground: (id: string, file: File) => {
    const form = new FormData();
    form.append("background", file);
    return api.post<Chat>(`/chats/${id}/background/`, form);
  },
  removeBackground: (id: string) => api.post<Chat>(`/chats/${id}/background/`, { remove: "true" }),
  joinPreview: (slug: string, code: string) =>
    api.post<JoinChatPreview>("/chats/join/preview/", { slug, code }),
  join: (slug: string, code: string) => api.post<Chat>("/chats/join/", { slug, code }),
  members: (chatId: string) => api.get<ChatMember[]>(`/chats/${chatId}/members/`),
  invite: (chatId: string, data: { user_id?: string; username?: string }) =>
    api.post<Chat | { detail: string }>(`/chats/${chatId}/members/invite/`, data),
  setAdmin: (chatId: string, memberId: string) =>
    api.post<ChatMember[]>(`/chats/${chatId}/members/set-admin/`, { member_id: memberId }),
  approve: (chatId: string, memberId: string) =>
    api.post<ChatMember>(`/chats/${chatId}/members/approve/`, { member_id: memberId }),
  reject: (chatId: string, memberId: string) =>
    api.post<void>(`/chats/${chatId}/members/reject/`, { member_id: memberId }),
  leave: (chatId: string) => api.post<void>(`/chats/${chatId}/leave/`),
  delete: (chatId: string) => api.delete<void>(`/chats/${chatId}/`),
  markRead: (chatId: string) => api.post<{ last_read_at: string }>(`/chats/${chatId}/mark-read/`),
  markUnread: (chatId: string) => api.post<{ last_read_at: null }>(`/chats/${chatId}/mark-unread/`),
  muteChat: (chatId: string, duration: "1h" | "3h" | "8h" | "forever" | "off") =>
    api.post<{ is_muted: boolean; muted_until: string | null }>(`/chats/${chatId}/mute/`, { duration }),
  toggleArchive: (chatId: string) => api.post<{ is_archived: boolean }>(`/chats/${chatId}/toggle-archive/`),
  setPins: (chatIds: string[]) => api.post<{ pinned_chat_ids: string[] }>("/chats/pins/", { chat_ids: chatIds }),
  getOrCreateDm: (userId: string, opts?: { is_secret?: boolean }) =>
    api.post<Chat>("/chats/dm/", { user_id: userId, ...(opts?.is_secret ? { is_secret: true } : {}) }),
  searchMessages: (chatId: string, q: string, params?: { limit?: number; offset?: number }) =>
    api.get<{ results: Message[]; total: number }>(`/chats/${chatId}/messages/search/`, { params: { q, ...params } }),
  globalSearch: (q: string, params?: { limit?: number }) =>
    api.get<{ results: GlobalSearchResult[] }>("/chats/search/", { params: { q, ...params } }),
  /** Telegram import: preview (upload ZIP, get participants + message_count + session_id) */
  importTelegramPreview: (chatId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<{ participants: { tg_user_id: string; tg_display_name: string }[]; message_count: number; session_id: string }>(
      `/chats/${chatId}/import-telegram/preview/`,
      form
    );
  },
  /** Telegram import: perform import with session_id and mapping */
  importTelegram: (chatId: string, sessionId: string, mapping: Record<string, { display_name: string; user_id?: string | null }>) =>
    api.post<{ created: number; errors: string[] }>(`/chats/${chatId}/import-telegram/`, { session_id: sessionId, mapping }),
  /** Telegram import: list all participants (unmapped + mapped) for Manage */
  getImportParticipants: (chatId: string) =>
    api.get<{ participants: { display_name: string; user_id: string | null; message_count: number }[] }>(`/chats/${chatId}/import-telegram/`),
  /** Telegram import: update display_name (from_name -> to_name) */
  updateImportDisplayName: (chatId: string, fromName: string, toName: string) =>
    api.patch<{ ok: boolean }>(`/chats/${chatId}/import-telegram/`, { from_name: fromName, to_name: toName }),
  /** Telegram import: remap display_name to chat member */
  remapImport: (chatId: string, mapping: Record<string, string>) =>
    api.patch<{ ok: boolean }>(`/chats/${chatId}/import-telegram/remap/`, mapping),
};

export interface ChatFolder {
  id: string;
  name: string;
  emoji: string;
  color?: string;
  position: number;
  created_at: string;
}

export const foldersApi = {
  list: () => api.get<ChatFolder[]>("/chats/folders/"),
  create: (data: { name: string; emoji?: string; color?: string; chat_ids?: string[] }) =>
    api.post<ChatFolder>("/chats/folders/", data),
  update: (id: string, data: { name?: string; emoji?: string; color?: string; position?: number }) =>
    api.patch<ChatFolder>(`/chats/folders/${id}/`, data),
  delete: (id: string) => api.delete(`/chats/folders/${id}/`),
  addChat: (folderId: string, chatId: string) =>
    api.post<{ status: string }>(`/chats/folders/${folderId}/chats/`, { chat_id: chatId }),
  removeChat: (folderId: string, chatId: string) =>
    api.delete<{ status: string; deleted: number }>(`/chats/folders/${folderId}/chats/${chatId}/`),
};

export interface Channel {
  id: string;
  title: string;
  /** Emoji to the right of the title (Telegram-style) */
  title_icon?: string | null;
  description: string;
  slug: string;
  /** Public username for short link (e.g. @channelname) — unique among users and channels */
  username?: string | null;
  is_public: boolean;
  comments_enabled: boolean;
  owner: User;
  members_count: number;
  invite_link: string | null;
  my_role: string | null;
  /** Mute for current user (no notification sound). */
  is_muted?: boolean;
  avatar_url: string | null;
  avatar_url_small?: string | null;
  avatar_url_medium?: string | null;
  is_active: boolean;
  created_at: string;
  last_post_at: string | null;
  /** Preview of last post for channel list (like last_message_preview for chats) */
  last_post_preview?: string | null;
}

/** Channel post — similar to Message but for channel feed. */
export interface ChannelPost {
  id: string;
  channel: string;
  author: User;
  msg_type: string;
  content: string;
  file: FileAttachment | null;
  files: FileAttachment[];
  created_at: string;
  edited_at: string | null;
  is_deleted: boolean;
  reactions: Record<string, number>;
  my_reactions: string[];
  comments_count: number;
  views_count?: number;
  waveform?: number[] | null;
  forwarded_from?: User | null;
  forwarded_from_chat_title?: string | null;
  is_encrypted?: boolean;
  encrypted_keys?: Record<string, unknown>;
}

export interface ReplyComment {
  id: string;
  author: User;
  msg_type: string;
  content: string;
  file: FileAttachment | null;
  created_at: string;
  is_deleted: boolean;
}

export interface ChannelPostComment {
  id: string;
  post: string;
  author: User;
  msg_type: string;
  content: string;
  file: FileAttachment | null;
  files: FileAttachment[];
  created_at: string;
  edited_at: string | null;
  is_deleted: boolean;
  waveform?: number[] | null;
  reply_to?: ReplyComment | null;
}

export const channelsApi = {
  list: () => api.get<PaginatedResponse<Channel>>("/channels/"),
  create: (data: { title: string; username: string; description?: string; is_public?: boolean; title_icon?: string }) =>
    api.post<Channel>("/channels/", data),
  get: (id: string) => api.get<Channel>(`/channels/${id}/`),
  resolveUsername: (username: string) =>
    api.get<{ id: string; username?: string | null; title?: string }>("/channels/resolve/", { params: { username: username.replace(/^@/, "") } }),
  toggleMute: (id: string) => api.post<{ is_muted: boolean }>(`/channels/${id}/mute/`),
  update: (id: string, data: { title?: string; description?: string; is_public?: boolean; comments_enabled?: boolean; title_icon?: string; username?: string | null }) =>
    api.patch<Channel>(`/channels/${id}/`, data),
  uploadAvatar: (id: string, file: File) => {
    const form = new FormData();
    form.append("avatar", file);
    return api.post<Channel>(`/channels/${id}/avatar/`, form);
  },
  removeAvatar: (id: string) => api.post<Channel>(`/channels/${id}/avatar/`, { remove: "true" }),
  importTelegram: (channelId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<{ created: number; errors: string[] }>(`/channels/${channelId}/import-telegram/`, form);
  },
};

export const channelPostsApi = {
  list: async (channelId: string, params?: { before?: string; since?: string; limit?: number }) => {
    const res = await api.get<ChannelPost[]>(`/channels/${channelId}/posts/`, { params });
    const hasMore = (res.headers["x-has-more"] as string) === "true";
    return { data: Array.isArray(res.data) ? res.data : [], hasMore };
  },
  create: (channelId: string, data: { msg_type?: string; content?: string; file_id?: string | null; file_ids?: string[]; waveform?: number[]; duration_seconds?: number }) =>
    api.post<ChannelPost>(`/channels/${channelId}/posts/`, data),
  update: (channelId: string, postId: string, data: { content: string }) =>
    api.patch<ChannelPost>(`/channels/${channelId}/posts/${postId}/`, data),
  delete: (channelId: string, postId: string) =>
    api.delete(`/channels/${channelId}/posts/${postId}/`),
  setReaction: (channelId: string, postId: string, emoji: string) =>
    api.post<ChannelPost>(`/channels/${channelId}/posts/${postId}/reactions/`, { emoji }),
};

export const channelPostCommentsApi = {
  list: (channelId: string, postId: string, params?: { limit?: number; offset?: number }) =>
    api.get<ChannelPostComment[]>(`/channels/${channelId}/posts/${postId}/comments/`, { params }),
  create: (
    channelId: string,
    postId: string,
    data: { msg_type?: string; content?: string; file_id?: string | null; file_ids?: string[]; reply_to_id?: string; waveform?: number[] }
  ) => api.post<ChannelPostComment>(`/channels/${channelId}/posts/${postId}/comments/`, data),
  update: (channelId: string, postId: string, commentId: string, data: { content: string }) =>
    api.patch<ChannelPostComment>(`/channels/${channelId}/posts/${postId}/comments/${commentId}/`, data),
  delete: (channelId: string, postId: string, commentId: string) =>
    api.delete(`/channels/${channelId}/posts/${postId}/comments/${commentId}/`),
};

export interface GlobalSearchResult {
  id: string;
  chat_id: string;
  chat_title: string;
  chat_is_personal: boolean;
  sender_id: string;
  sender_name: string;
  content: string;
  msg_type: string;
  created_at: string;
}

export type ScheduledRecurrence = "none" | "daily" | "weekly";

export interface ScheduledMessage {
  id: string;
  chat: string;
  content: string;
  scheduled_at: string;
  recurrence: ScheduledRecurrence;
  recurrence_time: string | null; // "HH:MM"
  recurrence_weekday: number | null; // 0=Mon, 6=Sun
  created_at: string;
}

export interface MessagesListResponse {
  data: Message[];
  hasMore: boolean;
}

export const messagesApi = {
  list: async (chatId: string, params?: { since?: string; before?: string; limit?: number }): Promise<MessagesListResponse> => {
    const res = await api.get<Message[]>(`/chats/${chatId}/messages/`, { params });
    return {
      data: res.data,
      hasMore: res.headers?.["x-has-more"] === "true",
    };
  },
  create: (chatId: string, data: { msg_type?: string; content?: string; file_id?: string; file_ids?: string[]; waveform?: number[]; duration_seconds?: number; reply_to_id?: string; is_encrypted?: boolean; sender_device_id?: number; encrypted_keys?: Record<string, unknown>; poll_data?: { options: string[]; multiple?: boolean; anonymous?: boolean; quiz?: boolean; correct_index?: number | null } | null }) => {
    const payload: Record<string, unknown> = { ...data };
    if (data.file_ids && data.file_ids.length > 0) {
      payload.file_ids = data.file_ids;
    }
    // Всегда отправляем content строкой (подпись к файлу/фото), иначе бэкенд может не сохранить
    payload.content = typeof data.content === "string" ? data.content : (data.content != null ? String(data.content) : "");
    return api.post<Message>(`/chats/${chatId}/messages/`, payload);
  },
  update: (chatId: string, messageId: string, data: { content: string }) =>
    api.patch<Message>(`/chats/${chatId}/messages/${messageId}/`, data),
  delete: (chatId: string, messageId: string) =>
    api.delete(`/chats/${chatId}/messages/${messageId}/`),
  bulkDelete: (chatId: string, messageIds: string[]) =>
    api.post<{ deleted: number }>(`/chats/${chatId}/messages/bulk-delete/`, { message_ids: messageIds }),
  setReaction: (chatId: string, messageId: string, emoji: string) =>
    api.post<Message>(`/chats/${chatId}/messages/${messageId}/reactions/`, { emoji }),
  pin: (chatId: string, messageId: string, scope: "me" | "all") =>
    api.post<void>(`/chats/${chatId}/messages/${messageId}/pin/`, { scope }),
  unpin: (chatId: string, messageId: string, scope: "me" | "all") =>
    api.delete<void>(`/chats/${chatId}/messages/${messageId}/pin/`, { data: { scope } }),
  forward: (targetChatId: string, data: { message_id: string; source_chat_id: string }) =>
    api.post<Message>(`/chats/${targetChatId}/messages/forward/`, data),
  pollVote: (chatId: string, messageId: string, optionIndices: number[]) =>
    api.post<Message>(`/chats/${chatId}/messages/${messageId}/poll/vote/`, { option_indices: optionIndices }),
  pollUnvote: (chatId: string, messageId: string) =>
    api.delete<Message>(`/chats/${chatId}/messages/${messageId}/poll/vote/`),
};

export interface GifResult {
  id: string;
  url: string;
  preview_url: string;
  width: number;
  height: number;
}

export const gifApi = {
  search: (q: string, params?: { limit?: number; pos?: string }) =>
    api.get<{ results: GifResult[]; next: string }>("/gif/search/", { params: { q: q.trim(), ...params } }),
  trending: (limit?: number) =>
    api.get<{ results: GifResult[]; next: string }>("/gif/trending/", { params: limit ? { limit } : {} }),
};

export interface StickerFile {
  id: string;
  url: string;
  mime_type?: string;
  original_name?: string;
}

export interface Sticker {
  id: string;
  pack_id: string;
  file_id: string | null;
  file: StickerFile | null;
  emoji: string;
  label: string;
  position: number;
  created_at: string;
}

export interface StickerPack {
  id: string;
  title: string;
  short_name: string;
  owner_id: string;
  created_at: string;
  stickers?: Sticker[];
}

export const stickersApi = {
  listPacks: () => api.get<StickerPack[]>("/stickers/packs/"),
  createPack: (data: { title: string; short_name: string }) =>
    api.post<StickerPack>("/stickers/packs/", data),
  getPack: (id: string) => api.get<StickerPack>(`/stickers/packs/${id}/`),
  deletePack: (id: string) => api.delete(`/stickers/packs/${id}/`),
  listStickers: (packId: string) => api.get<Sticker[]>(`/stickers/packs/${packId}/stickers/`),
  addSticker: (packId: string, data: { file_id: string; emoji?: string; label?: string }) =>
    api.post<Sticker>(`/stickers/packs/${packId}/stickers/`, data),
  removeSticker: (packId: string, stickerId: string) =>
    api.delete(`/stickers/packs/${packId}/stickers/${stickerId}/`),
  listInstalled: () => api.get<StickerPack[]>("/stickers/installed/"),
  install: (stickersetId: string) =>
    api.post<StickerPack>("/stickers/install/", { stickerset_id: stickersetId }),
  uninstall: (stickersetId: string) =>
    api.post<{ uninstalled: boolean }>("/stickers/uninstall/", { stickerset_id: stickersetId }),
  listRecent: () => api.get<Sticker[]>("/stickers/recent/"),
  saveRecent: (stickerId: string) =>
    api.post<{ ok: boolean }>("/stickers/save-recent/", { sticker_id: stickerId }),
};

export const scheduledApi = {
  list: (chatId: string) => api.get<ScheduledMessage[]>(`/chats/${chatId}/scheduled/`),
  create: (
    chatId: string,
    data: {
      content: string;
      scheduled_at: string;
      recurrence: ScheduledRecurrence;
      recurrence_time?: string;
      recurrence_weekday?: number;
    }
  ) => api.post<ScheduledMessage>(`/chats/${chatId}/scheduled/`, data),
  delete: (chatId: string, scheduledId: string) =>
    api.delete(`/chats/${chatId}/scheduled/${scheduledId}/`),
};

/** Chunk size for chunked upload (128 KB). Server only holds one chunk in RAM. */
const CHUNK_SIZE = 128 * 1024;
/** Use chunked upload for files larger than this to avoid OOM on server. */
const CHUNKED_UPLOAD_THRESHOLD = 10 * 1024 * 1024; // 10 MB

/** Max concurrent chunk requests (parallel upload for speed). */
const CHUNKED_UPLOAD_CONCURRENCY = 6;

export const filesApi = {
  cancelChunkedUpload: (uploadId: string) =>
    api.post(`/files/upload/chunk/cancel/`, { upload_id: uploadId }),

  upload: (
    file: File,
    chatId?: string,
    isEncrypted?: boolean,
    options?: {
      onUploadProgress?: (loaded: number, total: number) => void;
      onChunkedUploadId?: (uploadId: string) => void;
      signal?: AbortSignal;
    }
  ) => {
    const useChunked = file.size > CHUNKED_UPLOAD_THRESHOLD;
    if (!useChunked) {
      const form = new FormData();
      form.append("file", file);
      if (chatId) form.append("chat_id", chatId);
      if (isEncrypted) form.append("is_encrypted", "true");
      return api.post<FileAttachment>("/files/upload/", form, {
        signal: options?.signal,
        onUploadProgress:
          options?.onUploadProgress &&
          ((e) => {
            const total = e.total != null && e.total > 0 ? e.total : file.size;
            options.onUploadProgress!(e.loaded, total);
          }),
      });
    }

    const totalParts = Math.ceil(file.size / CHUNK_SIZE);
    const partSize = (p: number) =>
      p === totalParts - 1 ? file.size - (totalParts - 1) * CHUNK_SIZE : CHUNK_SIZE;
    let uploadId: string | null = null;
    let loadedSoFar = 0;
    const reportProgress = () => options?.onUploadProgress?.(loadedSoFar, file.size);

    const uploadChunk = async (part: number): Promise<FileAttachment | { upload_id: string }> => {
      if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const start = part * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const blob = file.slice(start, end, file.type);
      const form = new FormData();
      form.append("file", blob, file.name);
      form.append("part", String(part));
      form.append("total_parts", String(totalParts));
      if (part === 0) {
        form.append("filename", file.name);
        if (chatId) form.append("chat_id", chatId);
        if (isEncrypted) form.append("is_encrypted", "true");
      } else {
        form.append("upload_id", uploadId!);
      }
      const res = await api.post<FileAttachment | { upload_id: string }>("/files/upload/chunk/", form, {
        signal: options?.signal,
      });
      const data = res.data;
      loadedSoFar += partSize(part);
      reportProgress();
      if ("upload_id" in data) {
        uploadId = data.upload_id;
        options?.onChunkedUploadId?.(data.upload_id);
        return data;
      }
      return data as FileAttachment;
    };

    return (async () => {
      const first = await uploadChunk(0);
      if ("id" in first) return { data: first as FileAttachment };
      if (totalParts === 1) throw new Error("Chunked upload did not return attachment");

      const remaining = Array.from({ length: totalParts - 1 }, (_, i) => i + 1);
      let nextIdx = 0;
      const lastResult: { current: FileAttachment | null } = { current: null };
      const getNext = () => (nextIdx < remaining.length ? remaining[nextIdx++] : null);
      const workers = Array.from({ length: CHUNKED_UPLOAD_CONCURRENCY }, async () => {
        while (true) {
          const part = getNext();
          if (part === null) break;
          if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
          const r = await uploadChunk(part);
          if (!("upload_id" in r)) lastResult.current = r as FileAttachment;
        }
      });
      await Promise.all(workers);
      if (!lastResult.current) throw new Error("Chunked upload did not return attachment");
      return { data: lastResult.current };
    })();
  },
};

/** E2EE device (server stores public keys only). */
export interface E2eeDevice {
  id: string;
  device_id: number;
  name: string;
  is_active: boolean;
  created_at: string;
  last_active_at: string;
}

/** Key bundle for one device from GET /e2ee/keys/{user_id}/ */
export interface KeyBundleDevice {
  device_id: number;
  identity_key: string;
  signed_prekey: string;
  signed_prekey_id: number;
  signed_prekey_sig: string;
  one_time_prekey?: { key_id: number; public_key: string } | null;
}

export const e2eeApi = {
  listDevices: () => api.get<E2eeDevice[]>("/e2ee/devices/"),
  registerDevice: (data: {
    device_id: number;
    name?: string;
    identity_key: string;
    signed_prekey: string;
    signed_prekey_id: number;
    signed_prekey_sig: string;
    prekeys: { key_id: number; public_key: string }[];
  }) => api.post<E2eeDevice>("/e2ee/devices/", data),
  removeDevice: (deviceId: string) => api.delete<void>(`/e2ee/devices/${deviceId}/`),
  getKeyBundle: (userId: string) =>
    api.get<{ devices: KeyBundleDevice[] }>(`/e2ee/keys/${userId}/`),
  uploadPrekeys: (deviceId: number, prekeys: { key_id: number; public_key: string }[]) =>
    api.post<{ unused_prekeys_count: number }>("/e2ee/keys/prekeys/", {
      device_id: deviceId,
      prekeys,
    }),
  rotateSignedPrekey: (deviceId: number, data: {
    signed_prekey: string;
    signed_prekey_id: number;
    signed_prekey_sig: string;
  }) =>
    api.put<E2eeDevice>("/e2ee/keys/signed-prekey/", {
      device_id: deviceId,
      ...data,
    }),
};

/** A single active session record. */
export interface UserSessionInfo {
  id: string;
  device_label: string;
  ip_address: string | null;
  created_at: string;
  last_active: string;
  is_current: boolean;
}

export const sessionsApi = {
  list: () => api.get<UserSessionInfo[]>("/auth/sessions/"),
  terminate: (id: string) => api.delete(`/auth/sessions/${id}/`),
  logoutAll: () => api.post<{ terminated: number }>("/auth/sessions/logout-all/"),
};

export interface AdminStats {
  users_logged_in_today: number;
  total_users: number;
  platform_distribution: Record<string, number>;
  auth_timeline: { date: string; count: number }[];
  paid_subscriptions_today: number;
  new_users_today: number;
}

export interface TrackingLinkItem {
  id: string;
  tag: string;
  slug: string;
  target_url: string;
  full_url: string;
  clicks_count: number;
  created_at: string;
}

export interface TrackingLinkClickItem {
  id: string;
  created_at: string;
  ip_masked: string | null;
  user_agent_short: string;
  user_id: string | null;
}

export interface FeedbackItem {
  id: string;
  type: "feedback" | "support";
  message: string;
  user_id: string;
  user_phone: string;
  user_display_name: string;
  created_at: string;
  attachment_urls?: string[];
}

export const adminApi = {
  getStats: () => api.get<AdminStats>("/admin/stats/"),
  getFeedback: (params?: { limit?: number; type?: "feedback" | "support" }) =>
    api.get<FeedbackItem[]>("/admin/feedback/", { params }),
  getTrackingLinks: () => api.get<TrackingLinkItem[]>("/admin/tracking-links/"),
  createTrackingLink: (data: { tag: string; slug?: string; target_url: string }) =>
    api.post<TrackingLinkItem>("/admin/tracking-links/", data),
  updateTrackingLink: (id: string, data: { tag?: string; target_url?: string }) =>
    api.patch<TrackingLinkItem>(`/admin/tracking-links/${id}/`, data),
  deleteTrackingLink: (id: string) => api.delete(`/admin/tracking-links/${id}/`),
  getTrackingLinkClicks: (id: string, limit?: number) =>
    api.get<{ clicks: TrackingLinkClickItem[]; total: number }>(
      `/admin/tracking-links/${id}/clicks/`,
      { params: limit ? { limit } : {} }
    ),
};

export interface PaymentMethodItem {
  id: string;
  title: string;
}

export interface PaymentMethodDetail extends PaymentMethodItem {
  last4?: string;
  card_type?: string;
  expiry_month?: string;
  expiry_year?: string;
}

export const paymentsApi = {
  getSubscription: () => api.get<SubscriptionStatus>("/payments/subscription/"),
  /** remaining: number (0–3 for free) or null (unlimited for Premium) */
  getVideoCircleQuota: () => api.get<{ remaining: number | null }>("/payments/video_circle_quota/"),
  getPaymentMethods: () => api.get<{ payment_methods: PaymentMethodItem[] }>("/payments/payment-methods/"),
  getPaymentMethodDetail: (id: string) => api.get<PaymentMethodDetail>(`/payments/payment-methods/${encodeURIComponent(id)}/`),
  unlinkPaymentMethod: (id: string) => api.delete(`/payments/payment-methods/${encodeURIComponent(id)}/unlink/`),
  subscribe: (params: {
    return_url?: string;
    plan_months: 1 | 6 | 12 | 24;
    recipient_user_id?: string;
  }) =>
    api.post<{ payment_id: string; confirmation_url: string; amount: number; plan_months: number }>(
      "/payments/subscribe/",
      params
    ),
};
