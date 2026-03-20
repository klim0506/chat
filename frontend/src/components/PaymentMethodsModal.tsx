import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "../lib/i18n";
import { paymentsApi, type PaymentMethodItem, type PaymentMethodDetail } from "../api/client";

export interface PaymentMethodsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called when user clicks "Add card" — e.g. scroll to subscribe block */
  onAddCard?: () => void;
}

export default function PaymentMethodsModal({ isOpen, onClose, onAddCard }: PaymentMethodsModalProps) {
  const { t } = useTranslation();
  const [list, setList] = useState<PaymentMethodItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PaymentMethodDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  const loadList = useCallback(() => {
    if (!isOpen) return;
    setLoading(true);
    paymentsApi
      .getPaymentMethods()
      .then((r) => setList(r.data.payment_methods || []))
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      loadList();
      setSelectedId(null);
      setDetail(null);
    }
  }, [isOpen, loadList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    paymentsApi
      .getPaymentMethodDetail(selectedId)
      .then((r) => setDetail(r.data))
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  const handleUnlink = () => {
    if (!selectedId || unlinking) return;
    setUnlinking(true);
    paymentsApi
      .unlinkPaymentMethod(selectedId)
      .then(() => {
        setSelectedId(null);
        setDetail(null);
        loadList();
      })
      .finally(() => setUnlinking(false));
  };

  const handleAddCard = () => {
    onClose();
    onAddCard?.();
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">{t("settings.paymentMethods")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
            aria-label={t("common.close")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          {loading ? (
            <p className="text-sm text-slate-500">{t("common.loading")}</p>
          ) : (
            <>
              {list.length === 0 && !selectedId && (
                <p className="text-sm text-slate-500 mb-4">{t("settings.noPaymentMethods")}</p>
              )}
              {list.map((pm) => (
                <button
                  key={pm.id}
                  type="button"
                  onClick={() => setSelectedId(selectedId === pm.id ? null : pm.id)}
                  className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-colors mb-2 ${
                    selectedId === pm.id ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300 bg-white"
                  }`}
                >
                  <span className="font-medium text-slate-800">{pm.title}</span>
                </button>
              ))}
              {selectedId && (
                <div className="mt-4 p-4 rounded-lg border border-slate-200 bg-slate-50">
                  {detailLoading ? (
                    <p className="text-sm text-slate-500">{t("common.loading")}</p>
                  ) : detail ? (
                    <>
                      <p className="text-sm font-medium text-slate-800">{detail.title || `•••• ${detail.last4 || ""}`}</p>
                      {detail.card_type && (
                        <p className="text-sm text-slate-600 mt-1">{detail.card_type}</p>
                      )}
                      {detail.expiry_month && detail.expiry_year && (
                        <p className="text-sm text-slate-600 mt-1">
                          {t("settings.cardExpires")}: {detail.expiry_month}/{detail.expiry_year}
                        </p>
                      )}
                      <p className="mt-4 text-right">
                        <button
                          type="button"
                          onClick={handleUnlink}
                          disabled={unlinking}
                          className="text-xs text-slate-400 hover:text-red-600 disabled:opacity-50"
                        >
                          {t("settings.unlinkPaymentMethod")}
                        </button>
                      </p>
                    </>
                  ) : null}
                </div>
              )}
              <p className="text-xs text-slate-500 mt-4">{t("settings.addCardHint")}</p>
              <p className="text-xs text-slate-500 mt-2">{t("settings.unlinkPaymentMethodHint")}</p>
              <button
                type="button"
                onClick={handleAddCard}
                className="mt-3 w-full py-2.5 rounded-lg border-2 border-dashed border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600 text-sm font-medium transition-colors"
              >
                + {t("settings.addCard")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
