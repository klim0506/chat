import { useEffect } from "react";
import { useUnreadStore } from "../store/unread";
import { updateFaviconBadge } from "../lib/favicon-badge";
import { setAppBadge } from "../lib/pwa";
import { useLang, t } from "../lib/i18n";

/**
 * Subscribes to unread store and updates document.title, favicon badge,
 * and PWA app badge (when installed as standalone app).
 */
export function useUnreadBadge(isAuthenticated: boolean): void {
  const unreadByChat = useUnreadStore((s) => s.unreadByChat);
  const reset = useUnreadStore((s) => s.reset);
  const lang = useLang();
  const baseTitle = t("landing.brand", lang);

  useEffect(() => {
    if (!isAuthenticated) {
      reset();
      document.title = baseTitle;
      updateFaviconBadge(0);
      setAppBadge(0);
      return;
    }
    const total = Object.values(unreadByChat).reduce((a, b) => a + b, 0);
    document.title = total > 0 ? `(${total}) ${baseTitle}` : baseTitle;
    updateFaviconBadge(total);
    setAppBadge(total);
  }, [unreadByChat, isAuthenticated, reset, baseTitle]);
}
