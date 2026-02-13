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

/** Показать уведомление о новом сообщении (если разрешено и браузер поддерживает) */
export function showMessageNotification(
  chatTitle: string,
  message: { msg_type?: string; content?: string; sender_display_name?: string },
  options?: { icon?: string }
): void {
  if (!NOTIFICATIONS_SUPPORTED || Notification.permission !== "granted") return;
  try {
    const n = new Notification(chatTitle || "Новое сообщение", {
      body: getNotificationBody(message),
      icon: options?.icon ?? "/favicon.ico",
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // ignore
  }
}
