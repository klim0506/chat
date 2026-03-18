import { useEffect } from "react";
import { useTranslation } from "../lib/i18n";

export interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  /** Optional title; if not set, uses common.confirmTitle */
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  /** "danger" for destructive actions (red button), "primary" for default (blue) */
  variant?: "primary" | "danger";
}

export default function ConfirmModal({
  open,
  onClose,
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  variant = "primary",
}: ConfirmModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  if (!open) return null;

  const confirmLabel = confirmText ?? t("common.logout");
  const cancelLabel = cancelText ?? t("common.cancel");
  const isDanger = variant === "danger";

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-desc"
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 border border-slate-200/80 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="confirm-modal-title"
          className="text-lg font-semibold text-slate-800 mb-1"
        >
          {title ?? t("common.confirmTitle")}
        </h2>
        <p
          id="confirm-modal-desc"
          className="text-sm text-slate-500 mb-6 leading-relaxed"
        >
          {message}
        </p>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={
              isDanger
                ? "px-4 py-2.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2"
                : "px-4 py-2.5 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
