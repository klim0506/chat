import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation, type TranslationKey } from "../lib/i18n";
import { usePremiumPromptStore, type PremiumPromptReason } from "../store/premiumPrompt";
import { usePremiumModalStore } from "../store/premiumModal";

const REASON_TO_KEY: Record<PremiumPromptReason, TranslationKey> = {
  generic: "premiumPrompt.generic",
  folders: "premiumPrompt.folders",
  videoCircles: "premiumPrompt.videoCircles",
};

/** Telegram-style centered popup: dark rounded card, "Subscribe to Pingy Premium to …". */
export default function PremiumPromptPopup() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const open = usePremiumPromptStore((s) => s.open);
  const reason = usePremiumPromptStore((s) => s.reason);
  const closePrompt = usePremiumPromptStore((s) => s.closePrompt);
  const openModal = usePremiumModalStore((s) => s.openModal);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePrompt();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, closePrompt]);

  const handleSubscribe = () => {
    closePrompt();
    openModal();
    navigate("/chats/settings?section=premium");
  };

  if (!open || !reason) return null;

  const text = t(REASON_TO_KEY[reason]);
  const parts = text.split("Pingy Premium");

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-black/50"
      onClick={closePrompt}
      role="dialog"
      aria-labelledby="premium-prompt-title"
      aria-modal="true"
    >
      <div
        className="bg-slate-700 rounded-2xl shadow-xl max-w-sm w-full px-5 py-4 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="premium-prompt-title" className="text-white text-[15px] leading-snug">
          {parts.length === 2 ? (
            <>
              {parts[0]}
              <span className="text-blue-400 font-medium">Pingy Premium</span>
              {parts[1]}
            </>
          ) : (
            text
          )}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            onClick={closePrompt}
            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-600 transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubscribe}
            className="px-5 py-2 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors"
          >
            {t("premiumModal.cta")}
          </button>
        </div>
      </div>
    </div>
  );
}
