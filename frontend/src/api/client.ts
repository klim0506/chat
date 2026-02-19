import axios from "axios";
import { useAuthStore } from "../store/auth";

const baseURL = import.meta.env.VITE_API_URL || "";

/** Client type for session lifetime: web = 7 days, android/desktop = 3 years. Set at build time. */
const clientType = (import.meta.env.VITE_CLIENT_TYPE as string) || "web";

export const api = axios.create({
  baseURL: baseURL ? `${baseURL}/api` : "/api",
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
  (r) => r,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refresh = useAuthStore.getState().refreshToken;
      if (refresh) {
        try {
          const { data } = await axios.post<{ access: string }>(`${baseURL}/api/auth/refresh/`, { refresh });
          useAuthStore.getState().setTokens(data.access, refresh);
          original.headers.Authorization = `Bearer ${data.access}`;
          return api(original);
        } catch {
          useAuthStore.getState().clearTokens();
          window.location.href = "/auth";
        }
      }
    }
    return Promise.reject(error);
  }
);

export interface UserAvatar {
  id: number | "legacy";
  url: string;
  order: number;
}

export interface User {
  id: string;
  phone: string;
  /** Unique username (latin, digits, underscore); for search and @mentions */
  username?: string | null;
  telegram_username?: string;
  display_name: string;
  avatar: string | null;
  /** Full avatar URL (for display) — first from gallery */
  avatar_url?: string | null;
  /** Avatar gallery (up to 30) */
  avatars?: UserAvatar[];
  referral_code?: string;
  stars?: number;
  /** User is currently online */
  is_online?: boolean;
  /** Last seen time: ISO string, "recently", or null */
  last_seen_display?: string | null;
  /** Whether to show last seen time to others */
  show_last_seen?: boolean;
  /** Whether to show phone number to others */
  show_phone?: boolean;
  /** Who can send DMs: everyone | nobody */
  dm_privacy?: "everyone" | "nobody";
  /** Who can add to groups: everyone | nobody */
  add_to_group_privacy?: "everyone" | "nobody";
}

export interface SubscriptionStatus {
  has_subscription: boolean;
  status: "trial" | "active" | "past_due" | "cancelled" | null;
  is_valid: boolean;
  current_period_end: string | null;
  is_referral_trial?: boolean;
  price_rub: number;
  stars: number;
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
  sendCode: (phone: string) =>
    api.post<{ detail: string; method?: string }>("/auth/send-code/", { phone }),
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
  updateMe: (data: Partial<User>) => api.patch<User>("/auth/me/", data),
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
};

export interface Chat {
  id: string;
  title: string;
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
  /** Own messages only: delivered (1 check) or read (2 checks). */
  read_status?: "delivered" | "read" | null;
  /** Own messages only: who read this message (last_read_at >= created_at). */
  read_by?: User[];
  /** Audio waveform amplitudes (0–255, up to 128 values) */
  waveform?: number[] | null;
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
  create: (data: { title: string; chat_type: "open" | "closed"; description?: string }) => api.post<Chat>("/chats/", data),
  get: (id: string) => api.get<Chat>(`/chats/${id}/`),
  update: (id: string, data: { title?: string; description?: string }) => api.patch<Chat>(`/chats/${id}/`, data),
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
  create: (chatId: string, data: { msg_type?: string; content?: string; file_id?: string; file_ids?: string[]; waveform?: number[]; reply_to_id?: string; is_encrypted?: boolean; sender_device_id?: number; encrypted_keys?: Record<string, unknown> }) => {
    const payload: Record<string, unknown> = { ...data };
    // file_ids — for multiple files in a single message
    if (data.file_ids && data.file_ids.length > 0) {
      payload.file_ids = data.file_ids;
    }
    return api.post<Message>(`/chats/${chatId}/messages/`, payload);
  },
  update: (chatId: string, messageId: string, data: { content: string }) =>
    api.patch<Message>(`/chats/${chatId}/messages/${messageId}/`, data),
  delete: (chatId: string, messageId: string) =>
    api.delete(`/chats/${chatId}/messages/${messageId}/`),
  setReaction: (chatId: string, messageId: string, emoji: string) =>
    api.post<Message>(`/chats/${chatId}/messages/${messageId}/reactions/`, { emoji }),
  pin: (chatId: string, messageId: string, scope: "me" | "all") =>
    api.post<void>(`/chats/${chatId}/messages/${messageId}/pin/`, { scope }),
  unpin: (chatId: string, messageId: string, scope: "me" | "all") =>
    api.delete<void>(`/chats/${chatId}/messages/${messageId}/pin/`, { data: { scope } }),
  forward: (targetChatId: string, data: { message_id: string; source_chat_id: string }) =>
    api.post<Message>(`/chats/${targetChatId}/messages/forward/`, data),
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

export const filesApi = {
  upload: (file: File, chatId?: string, isEncrypted?: boolean) => {
    const form = new FormData();
    form.append("file", file);
    if (chatId) form.append("chat_id", chatId);
    if (isEncrypted) form.append("is_encrypted", "true");
    return api.post<FileAttachment>("/files/upload/", form);
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

export const paymentsApi = {
  getSubscription: () => api.get<SubscriptionStatus>("/payments/subscription/"),
  subscribe: (returnUrl?: string) =>
    api.post<{ payment_id: string; confirmation_url: string; amount: number }>("/payments/subscribe/", { return_url: returnUrl }),
  getStars: () => api.get<StarsBalance>("/payments/stars/"),
  expandChat: (chatId: string, targetMaxMembers: 100 | 1000) =>
    api.post<{ ok: boolean; expanded_until: string; stars_remaining: number; effective_max_members?: number }>(
      "/payments/expand-chat/",
      { chat_id: chatId, target_max_members: targetMaxMembers }
    ),
};
