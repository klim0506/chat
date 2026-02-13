import axios from "axios";
import { useAuthStore } from "../store/auth";

const baseURL = import.meta.env.VITE_API_URL || "";

export const api = axios.create({
  baseURL: baseURL ? `${baseURL}/api` : "/api",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Для FormData не задаём Content-Type — браузер подставит multipart/form-data с boundary
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
  /** Уникальный юзернейм (латиница, цифры, подчёркивание); для поиска и @упоминаний */
  username?: string | null;
  telegram_username?: string;
  display_name: string;
  avatar: string | null;
  /** Полный URL аватарки (для отображения) — первая из галереи */
  avatar_url?: string | null;
  /** Галерея аватарок (до 30) */
  avatars?: UserAvatar[];
  referral_code?: string;
  stars?: number;
  /** Пользователь сейчас онлайн */
  is_online?: boolean;
  /** Время последнего захода: ISO-строка, "recently" или null */
  last_seen_display?: string | null;
  /** Показывать ли другим время последнего захода */
  show_last_seen?: boolean;
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
  sendCode: (phone: string, method?: "sms" | "telegram") =>
    api.post<{ detail: string; method?: string }>("/auth/send-code/", { phone, ...(method ? { method } : {}) }),
  verifyCode: (phone: string, code: string, ref?: string, username?: string) =>
    api.post<{ access: string; refresh: string; user: User }>("/auth/verify-code/", {
      phone,
      code,
      ...(ref ? { ref } : {}),
      ...(username ? { username } : {}),
    }),
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
  /** Только у групп; у личного чата типа нет */
  chat_type: "open" | "closed" | null;
  /** Личный чат — на двоих, без ссылки и без типа. Группа из 2 человек — не личный. */
  is_personal: boolean;
  /** Чат «Избранное» — только владелец, никого нельзя добавить */
  is_favorites?: boolean;
  max_members: number;
  effective_max_members: number;
  owner: User;
  members_count: number;
  /** У личного чата ссылки нет */
  invite_link: string | null;
  is_active: boolean;
  created_at: string;
  unread_count: number;
  is_muted: boolean;
  is_expanded: boolean;
  expanded_until: string | null;
  avatar_url: string | null;
  /** URL фонового изображения чата (настраивается в описании группы) */
  background_url: string | null;
  /** Для личного чата — данные собеседника */
  other_member?: User | null;
  /** Закреплённое для всех сообщение */
  pinned_message?: Message | null;
  /** Закреплённые текущим пользователем сообщения (для себя) */
  my_pinned_messages?: Message[];
  /** Превью последнего сообщения для списка чатов */
  last_message_preview?: string | null;
}

export interface Message {
  id: string;
  chat: string;
  sender: User;
  msg_type: string;
  content: string;
  file: FileAttachment | null;
  /** Несколько файлов (изображений) в одном сообщении */
  files: FileAttachment[];
  created_at: string;
  edited_at: string | null;
  is_deleted: boolean;
  reactions: Record<string, number>;
  /** До 3 реакций текущего пользователя на это сообщение */
  my_reactions: string[];
  /** Только для своих сообщений: доставлено (1 галочка) или прочитано (2 галочки). */
  read_status?: "delivered" | "read" | null;
  /** Только для своих сообщений: кто прочитал это сообщение (last_read_at >= created_at). */
  read_by?: User[];
  /** Амплитуды для визуализации аудио (0–255, до 128 значений) */
  waveform?: number[] | null;
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
  join: (slug: string, code: string) => api.post<Chat>("/chats/join/", { slug, code }),
  members: (chatId: string) => api.get<ChatMember[]>(`/chats/${chatId}/members/`),
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
  toggleMute: (chatId: string) => api.post<{ is_muted: boolean }>(`/chats/${chatId}/toggle-mute/`),
  getOrCreateDm: (userId: string) => api.post<Chat>("/chats/dm/", { user_id: userId }),
};

export type ScheduledRecurrence = "none" | "daily" | "weekly";

export interface ScheduledMessage {
  id: string;
  chat: string;
  content: string;
  scheduled_at: string;
  recurrence: ScheduledRecurrence;
  recurrence_time: string | null; // "HH:MM"
  recurrence_weekday: number | null; // 0=пн, 6=вс
  created_at: string;
}

export const messagesApi = {
  list: (chatId: string) => api.get<Message[]>(`/chats/${chatId}/messages/`),
  create: (chatId: string, data: { msg_type?: string; content?: string; file_id?: string; file_ids?: string[]; waveform?: number[] }) => {
    const payload: Record<string, unknown> = { ...data };
    if (data.file_id) {
      payload.file = data.file_id;
      delete payload.file_id;
    }
    // file_ids — для нескольких файлов в одном сообщении
    if (data.file_ids && data.file_ids.length > 0) {
      payload.file_ids = data.file_ids;
      // Также ставим первый файл как основной file для совместимости
      if (!payload.file) {
        payload.file = data.file_ids[0];
      }
    }
    delete payload.file_id;
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
  upload: (file: File, chatId?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (chatId) form.append("chat_id", chatId);
    return api.post<FileAttachment>("/files/upload/", form);
  },
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
