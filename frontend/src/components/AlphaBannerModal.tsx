import { useState, useEffect } from "react";
import { useTranslation } from "../lib/i18n";

const SESSION_STORAGE_KEY = "alphaBannerDismissed";

export function AlphaBannerModal() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_STORAGE_KEY) === "1") {
        setVisible(false);
        return;
      }
      setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  const onClose = () => {
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[200] max-w-[320px] rounded-lg border border-amber-200 bg-amber-50/95 shadow-lg backdrop-blur-sm p-3 animate-in fade-in slide-in-from-bottom-2 duration-200"
      role="dialog"
      aria-labelledby="alpha-banner-title"
      aria-describedby="alpha-banner-desc"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h2 id="alpha-banner-title" className="text-sm font-semibold text-amber-900">
            {t("alphaBanner.title")}
          </h2>
          <p id="alpha-banner-desc" className="text-xs text-amber-800 mt-0.5">
            {t("alphaBanner.body")}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 p-1 rounded text-amber-600 hover:bg-amber-100 hover:text-amber-900 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1"
          aria-label={t("common.close")}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
