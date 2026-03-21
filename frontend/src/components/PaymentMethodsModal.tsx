import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "../lib/i18n";
import { paymentsApi, type PaymentMethodItem, type PaymentMethodDetail } from "../api/client";
import { ModalViewportLayer } from "./TopLayerPortal";

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
  const [listError, setListError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PaymentMethodDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState(false);

  const loadList = useCallback(() => {
    if (!isOpen) return;
    setLoading(true);
    setListError(false);
    paymentsApi
      .getPaymentMethods()
      .then((r) => setList(r.data.payment_methods || []))
      .catch(() => {
        setList([]);
        setListError(true);
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      loadList();
      setSelectedId(null);
      setDetail(null);
      setUnlinkError(false);
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
    setUnlinkError(false);
    paymentsApi
      .unlinkPaymentMethod(selectedId)
      .then(() => {
        setSelectedId(null);
        setDetail(null);
        loadList();
      })
      .catch(() => setUnlinkError(true))
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
    <ModalViewportLayer onBackdropClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{t("settings.paymentMethods")}</h2>
            <p className="mt-1 text-xs text-slate-500">{t("settings.paymentMethodsModalHint")}</p>
          </div>
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
              {listError && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 flex items-center justify-between gap-2">
                  <span>{t("settings.paymentMethodsLoadError")}</span>
                  <button
                    type="button"
                    onClick={loadList}
                    className="shrink-0 rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-100"
                  >
                    {t("common.retry")}
                  </button>
                </div>
              )}
              {list.length > 0 && (
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
                  {t("settings.savedCardsCount").replace("%s", String(list.length))}
                </p>
              )}
              {list.length === 0 && !selectedId && !listError && (
                <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-medium text-slate-700">{t("settings.noPaymentMethods")}</p>
                  <p className="mt-1 text-xs text-slate-500">{t("settings.noPaymentMethodsHint")}</p>
                </div>
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
                      {unlinkError && (
                        <p className="mt-2 text-xs text-red-600">{t("settings.unlinkPaymentMethodError")}</p>
                      )}
                    </>
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>
        <div className="border-t border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">{t("settings.addCardHint")}</p>
          <p className="mt-1 text-xs text-slate-500">{t("settings.unlinkPaymentMethodHint")}</p>
          <button
            type="button"
            onClick={handleAddCard}
            className="mt-3 w-full py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium transition-colors"
          >
            {t("settings.addCardPrimary")}
          </button>
        </div>
      </div>
    </ModalViewportLayer>
  );
}
