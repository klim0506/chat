import { useEffect } from "react";
import { useLang, t } from "../lib/i18n";

const DEFAULT_DESCRIPTION = "Свой мессенджер без VPN и блокировок. Чаты на 2–300 человек, файлы до 2 ГБ. Регистрация по SMS, личный чат бесплатно.";

/**
 * Устанавливает document.title, meta name="description" и при необходимости canonical для SEO.
 * При размонтировании возвращает дефолтные title/description.
 */
export function useDocumentHead(title: string, description?: string, setCanonical = true) {
  const lang = useLang();
  const defaultTitle = t("landing.brand", lang);
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;

    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevContent = meta?.getAttribute("content") ?? "";
    if (description) {
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "description";
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", description);
    }

    let linkCanonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const prevHref = linkCanonical?.getAttribute("href") ?? "";
    if (setCanonical && typeof window !== "undefined") {
      const canonicalUrl = window.location.origin + window.location.pathname;
      if (!linkCanonical) {
        linkCanonical = document.createElement("link");
        linkCanonical.rel = "canonical";
        document.head.appendChild(linkCanonical);
      }
      linkCanonical.setAttribute("href", canonicalUrl);
    }

    return () => {
      document.title = prevTitle || defaultTitle;
      if (meta && description) meta.setAttribute("content", prevContent || DEFAULT_DESCRIPTION);
      if (linkCanonical && setCanonical) linkCanonical.setAttribute("href", prevHref || window.location.origin + "/");
    };
  }, [title, description, setCanonical]);
}
