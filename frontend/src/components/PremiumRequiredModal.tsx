import { useEffect, useState } from "react";
import { paymentsApi } from "../api/client";
import { useTranslation } from "../lib/i18n";
import type { TranslationKey } from "../lib/i18n";
import { usePremiumModalStore } from "../store/premiumModal";
import { ModalViewportLayer } from "./TopLayerPortal";

/** По приоритету для пользователя: от самых востребованных к менее критичным */
const BENEFIT_KEYS: TranslationKey[] = [
  "premiumModal.benefitFiles",
  "premiumModal.benefitFileUploads",
  "premiumModal.benefitFolders",
  "premiumModal.benefitPins",
  "premiumModal.benefitVideoCircles",
  "premiumModal.benefitReactions",
  "premiumModal.benefitScheduled",
  "premiumModal.benefitChannels",
  "premiumModal.benefitAvatars",
  "premiumModal.benefitPolls",
  "premiumModal.benefitStickers",
  "premiumModal.benefitBio",
];

export default function PremiumRequiredModal() {
  const { t } = useTranslation();
  const open = usePremiumModalStore((s) => s.open);
  const closeModal = usePremiumModalStore((s) => s.closeModal);
  const [subLoading, setSubLoading] = useState(false);
  const [paymentError, setPaymentError] = useState("");

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, closeModal]);

  const handleCta = async () => {
    if (subLoading) return;
    setPaymentError("");
    setSubLoading(true);
    try {
      const returnUrl = window.location.href;
      const { data } = await paymentsApi.subscribe({
        return_url: returnUrl,
        offer_code: "intro_week",
      });
      if (data.confirmation_url) {
        window.open(data.confirmation_url, "_blank", "noopener,noreferrer");
      }
      closeModal();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setPaymentError(detail || t("settings.paymentError"));
    } finally {
      setSubLoading(false);
    }
  };

  if (!open) return null;

  return (
    <ModalViewportLayer onBackdropClick={closeModal}>
      <div
        role="dialog"
        aria-labelledby="premium-modal-title"
        aria-describedby="premium-modal-desc"
        className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={closeModal}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
          aria-label={t("common.close")}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
        <div className="p-6 pb-4 pr-12">
          <h2 id="premium-modal-title" className="text-xl font-semibold text-slate-800">
            {t("premiumModal.title")}
          </h2>
          <p id="premium-modal-desc" className="text-sm text-slate-500 mt-1">
            {t("premiumModal.subtitle")}
          </p>
        </div>
        <ul className="px-6 pb-4 overflow-y-auto flex-1 min-h-0 space-y-2 text-sm text-slate-700">
          {BENEFIT_KEYS.map((key) => (
            <li key={key} className="flex items-start gap-3">
              <span
                className="shrink-0 w-5 h-5 mt-0.5 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0"
                aria-hidden
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
        <div className="p-6 pt-4 border-t border-slate-100 flex justify-center">
          <button
            type="button"
            onClick={handleCta}
            disabled={subLoading}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {subLoading ? t("common.loading") : t("premiumModal.cta")}
          </button>
        </div>
        {paymentError && (
          <div className="px-6 pb-5 -mt-2">
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {paymentError}
            </p>
          </div>
        )}
      </div>
    </ModalViewportLayer>
  );
}
