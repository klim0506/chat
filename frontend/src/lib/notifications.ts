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

/** Текст тела уведомления по типу сообщения */
export function getNotificationBody(message: {
  msg_type?: string;
  content?: string;
  sender_display_name?: string;
}): string {
  const sender = message.sender_display_name ? `${message.sender_display_name}: ` : "";
  const type = message.msg_type || "text";
  switch (type) {
    case "audio":
      return sender + "Голосовое сообщение";
    case "video":
    case "video_circle":
      return sender + "Видео";
    case "file":
      if (message.content && /\.(jpg|jpeg|png|gif|webp)$/i.test(message.content)) {
        return sender + "Фото";
      }
      return sender + (message.content || "Файл");
    case "emoji":
      return sender + (message.content || "Эмодзи");
    case "text":
    default:
      return sender + (message.content?.trim() || "(пусто)");
  }
}

const NOTIFICATION_ICON = "/icons/icon-192x192.png";

/**
 * Показать уведомление о новом сообщении.
 * На мобильном PWA использует Service Worker (reg.showNotification), чтобы пуш
 * приходил на телефон даже при свёрнутом или фоновом приложении.
 */
export function showMessageNotification(
  chatTitle: string,
  message: { msg_type?: string; content?: string; sender_display_name?: string },
  options?: { icon?: string; chatId?: string }
): void {
  if (!NOTIFICATIONS_SUPPORTED || Notification.permission !== "granted") return;
  const title = chatTitle || "Новое сообщение";
  const body = getNotificationBody(message);
  const icon = options?.icon ?? NOTIFICATION_ICON;
  const chatId = options?.chatId;
  const url = chatId ? `/chat/${chatId}` : "/chats";

  const showViaSW = async () => {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) {
        await reg.showNotification(title, {
          body,
          icon,
          badge: icon,
          tag: chatId ? `msg-${chatId}` : "message",
          data: { url },
        } as NotificationOptions);
        return;
      }
    } catch {
      /* fallback to page Notification */
    }
    try {
      const n = new Notification(title, { body, icon });
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
