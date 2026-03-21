import { useState, useRef } from "react";
import { channelsApi } from "../api/client";
import { useTranslation } from "../lib/i18n";
import { usePremiumModalStore } from "../store/premiumModal";
import { ModalViewportLayer } from "./TopLayerPortal";

interface ImportTelegramModalProps {
  channelId: string;
  channelTitle: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (created: number, errors: string[]) => void;
}

export default function ImportTelegramModal({
  channelId,
  channelTitle,
  isOpen,
  onClose,
  onSuccess,
}: ImportTelegramModalProps) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFile(f || null);
    setError("");
    setResult(null);
  };

  const handleSubmit = async () => {
    if (!file) {
      setError(t("channelImport.selectFile"));
      return;
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError(t("channelImport.zipOnly"));
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const { data } = await channelsApi.importTelegram(channelId, file);
      setResult(data);
      onSuccess?.(data.created, data.errors);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string | string[]; code?: string }; status?: number } };
      const status = err.response?.status;
      const code = err.response?.data?.code;
      if (status === 403 && code === "plan_restriction") {
        onClose();
        usePremiumModalStore.getState().openModal();
        return;
      }
      const detail = err.response?.data?.detail;
      const msg = Array.isArray(detail) ? detail[0] : (detail as string) || t("channelImport.error");
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setError("");
    setResult(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <ModalViewportLayer onBackdropClick={loading ? undefined : handleClose}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full my-auto animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{t("channelImport.title")}</h2>
            <p className="text-slate-500 text-xs mt-0.5">{t("channelImport.subtitle").replace("%s", channelTitle)}</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50"
            aria-label={t("common.close")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        <div className="px-6 pb-5 pt-3 space-y-4">
          <p className="text-sm text-slate-600">{t("channelImport.hint")}</p>

          <div>
            <input
              ref={inputRef}
              type="file"
              accept=".zip"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={loading}
              className="w-full border-2 border-dashed border-slate-300 rounded-lg px-4 py-3 text-sm text-slate-600 hover:border-blue-400 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              {file ? file.name : t("channelImport.browse")}
            </button>
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}
          {result && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm">
              <p className="text-slate-800 font-medium">{t("channelImport.imported").replace("%s", String(result.created))}</p>
              {result.errors.length > 0 && (
                <p className="text-slate-500 text-xs mt-1">
                  {t("channelImport.someErrors").replace("%s", String(result.errors.length))}
                  {result.errors.slice(0, 3).map((e, i) => (
                    <span key={i} className="block truncate mt-0.5">{e}</span>
                  ))}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {result ? t("common.close") : t("common.cancel")}
            </button>
            {!result && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading || !file}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium transition-colors"
              >
                {loading ? t("channelImport.importing") : t("channelImport.import")}
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalViewportLayer>
  );
}
