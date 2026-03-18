/** Поддержка браузерных уведомлений */
export const NOTIFICATIONS_SUPPORTED =
  typeof window !== "undefined" && "Notification" in window;

export type NotificationPermission = "granted" | "denied" | "default";

export function getPermission(): NotificationPermission {
  if (!NOTIFICATIONS_SUPPORTED) return "denied";
  return Notification.permission as NotificationPermission;
}

export function requestPermission(): Promise<NotificationPermission> {
  if (!NOTIFICATIONS_SUPPORTED) return Promise.resolve("denied");
  return Notification.requestPermission();
}

/** Текст тела уведомления по типу сообщения (без отправителя — он в заголовке). */
export function getNotificationBody(message: {
  msg_type?: string;
  content?: string;
  sender_display_name?: string;
}): string {
  const type = message.msg_type || "text";
  switch (type) {
    case "audio":
      return "Голосовое сообщение";
    case "video":
    case "video_circle":
      return "Видео";
    case "file":
      if (message.content && /\.(jpg|jpeg|png|gif|webp)$/i.test(message.content)) {
        return "Фото";
      }
      return message.content || "Файл";
    case "emoji":
      return message.content || "Эмодзи";
    case "text":
    default:
      return message.content?.trim() || "(пусто)";
  }
}

/** Сухой формат пушей: только favicon, отправитель, текст, время. */
const NOTIFICATION_ICON = "/favicon.ico";

function formatNotificationTime(createdAt?: string): string {
  if (!createdAt) return "";
  try {
    return new Date(createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/**
 * Показать уведомление о новом сообщении.
 * Сухой формат: иконка (favicon), заголовок = отправитель, тело = текст · время.
 * На мобильном PWA использует Service Worker (reg.showNotification), чтобы пуш
 * приходил на телефон даже при свёрнутом или фоновом приложении.
 */
export function showMessageNotification(
  chatTitle: string,
  message: { msg_type?: string; content?: string; sender_display_name?: string; created_at?: string },
  options?: { icon?: string; chatId?: string }
): void {
  if (!NOTIFICATIONS_SUPPORTED || Notification.permission !== "granted") return;
  const sender = message.sender_display_name?.trim() || chatTitle || "Новое сообщение";
  const textPart = getNotificationBody(message);
  const timeStr = formatNotificationTime(message.created_at);
  const body = timeStr ? `${textPart} · ${timeStr}` : textPart;
  const icon = options?.icon ?? NOTIFICATION_ICON;
  const chatId = options?.chatId;
  const url = chatId ? `/chat/${chatId}` : "/chats";
  const timestamp = message.created_at ? new Date(message.created_at).getTime() : Date.now();

  const showViaSW = async () => {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) {
        await reg.showNotification(sender, {
          body,
          icon,
          tag: chatId ? `msg-${chatId}` : "message",
          data: { url },
          timestamp,
        } as NotificationOptions & { timestamp?: number });
        return;
      }
    } catch {
      /* fallback to page Notification */
    }
    try {
      const n = new Notification(sender, { body, icon, timestamp } as NotificationOptions & { timestamp?: number });
      n.onclick = () => {
        window.focus();
        try {
          window.location.href = url;
        } catch {
          /* ignore */
        }
        n.close();
      };
    } catch {
      /* ignore */
    }
  };

  showViaSW();
}
