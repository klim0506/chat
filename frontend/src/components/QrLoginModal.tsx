import { useEffect, useState, useCallback } from "react";
import QRCode from "qrcode";
import { authApi } from "../api/client";
import { useTranslation } from "../lib/i18n";
import { ModalViewportLayer } from "./TopLayerPortal";

function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

interface QrLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function QrLoginModal({ isOpen, onClose }: QrLoginModalProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expiresIn, setExpiresIn] = useState(0);

  const createPairing = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await authApi.pairingCreate();
      const { qr_url, code: c, expires_in } = res.data;
      setCode(c);
      setExpiresIn(expires_in);
      const dataUrl = await QRCode.toDataURL(qr_url, { width: 256, margin: 2 });
      setQrDataUrl(dataUrl);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (isOpen) {
      createPairing();
    } else {
      setCode("");
      setQrDataUrl(null);
      setError("");
    }
  }, [isOpen, createPairing]);

  useEffect(() => {
    if (!isOpen || expiresIn <= 0) return;
    const timer = setInterval(() => {
      setExpiresIn((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen, expiresIn]);

  if (!isOpen) return null;

  return (
    <ModalViewportLayer>
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-800">{t("settings.qrLoginTitle")}</h2>
          <p className="text-sm text-slate-500 mt-0.5">{t("settings.qrLoginHint")}</p>
        </div>
        <div className="p-5 space-y-4">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <div className="flex justify-center">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="QR" className="w-64 h-64 rounded-lg border border-slate-200" />
                ) : null}
              </div>
              <p className="text-center text-sm text-slate-600">{t("settings.qrLoginScanOrCode")}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-lg font-mono font-bold tracking-widest text-center py-3 bg-slate-100 rounded-lg">
                  {code}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    copyToClipboard(code);
                  }}
                  className="px-4 py-3 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg"
                >
                  {t("common.copy")}
                </button>
              </div>
              {expiresIn > 0 && (
                <p className="text-center text-xs text-slate-500">
                  {t("settings.qrLoginExpires")}: {Math.floor(expiresIn / 60)}:{(expiresIn % 60).toString().padStart(2, "0")}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={createPairing}
                  disabled={loading}
                  className="flex-1 py-2.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-xl"
                >
                  {t("settings.qrLoginRefresh")}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  {t("common.close")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </ModalViewportLayer>
  );
}
