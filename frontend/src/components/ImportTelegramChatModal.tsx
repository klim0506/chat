import { useState, useRef, useEffect } from "react";
import { chatsApi } from "../api/client";
import { useTranslation } from "../lib/i18n";
import { userDisplayName } from "../api/client";
import { usePremiumModalStore } from "../store/premiumModal";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

interface ImportTelegramChatModalProps {
  chatId: string;
  chatTitle: string;
  members: { user: { id: string; display_name?: string; username?: string } }[];
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function ImportTelegramChatModal({
  chatId,
  chatTitle,
  members,
  isOpen,
  onClose,
  onSuccess,
}: ImportTelegramChatModalProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<"upload" | "mapping" | "done">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<{ tg_user_id: string; tg_display_name: string }[]>([]);
  const [messageCount, setMessageCount] = useState(0);
  const [mapping, setMapping] = useState<Record<string, { display_name: string; user_id: string | null }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setStep("upload");
      setFile(null);
      setSessionId(null);
      setParticipants([]);
      setMessageCount(0);
      setMapping({});
      setError("");
      setResult(null);
    }
  }, [isOpen]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFile(f || null);
    setError("");
  };

  const handlePreview = async () => {
    if (!file) {
      setError(t("channelImport.selectFile"));
      return;
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError(t("channelImport.zipOnly"));
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError(t("channelImport.fileTooBig"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data } = await chatsApi.importTelegramPreview(chatId, file);
      setSessionId(data.session_id);
      setParticipants(data.participants);
      setMessageCount(data.message_count);
      const initMapping: Record<string, { display_name: string; user_id: string | null }> = {};
      for (const p of data.participants) {
        initMapping[p.tg_user_id] = { display_name: p.tg_display_name, user_id: null };
      }
      setMapping(initMapping);
      setStep("mapping");
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string | string[] }; status?: number } };
      const detail = err.response?.data?.detail;
      const msg = Array.isArray(detail) ? detail[0] : (detail as string) || t("channelImport.error");
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!sessionId) return;
    setLoading(true);
    setError("");
    try {
      const apiMapping: Record<string, { display_name: string; user_id?: string | null }> = {};
      for (const [tid, m] of Object.entries(mapping)) {
        apiMapping[tid] = { display_name: m.display_name, user_id: m.user_id || undefined };
      }
      const { data } = await chatsApi.importTelegram(chatId, sessionId, apiMapping);
      setResult(data);
      setStep("done");
      onSuccess?.();
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
    setStep("upload");
    setFile(null);
    setSessionId(null);
    setParticipants([]);
    setMapping({});
    setError("");
    setResult(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/50 overflow-y-auto"
      onClick={() => { if (!loading) handleClose(); }}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full my-auto animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-2 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{t("channelImport.title")}</h2>
            <p className="text-slate-500 text-xs mt-0.5">{t("channelImport.chatSubtitle").replace("%s", chatTitle)}</p>
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

        <div className="px-6 pb-5 pt-3 flex-1 overflow-y-auto space-y-4">
          {step === "upload" && (
            <>
              <p className="text-sm text-slate-600">{t("channelImport.chatHint")}</p>
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
                <p className="text-xs text-slate-400 mt-1">{t("channelImport.fileSizeLimit")}</p>
              </div>
            </>
          )}

          {step === "mapping" && (
            <>
              <p className="text-sm text-slate-600">
                {t("channelImport.mappingHint").replace("%s", String(messageCount))}
              </p>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {participants.map((p) => (
                  <div key={p.tg_user_id} className="border border-slate-200 rounded-lg p-3 space-y-2">
                    <div className="flex gap-2 items-center">
                      <input
                        type="text"
                        value={mapping[p.tg_user_id]?.display_name ?? p.tg_display_name}
                        onChange={(e) =>
                          setMapping((prev) => ({
                            ...prev,
                            [p.tg_user_id]: { ...prev[p.tg_user_id], display_name: e.target.value },
                          }))
                        }
                        className="flex-1 text-sm border border-slate-200 rounded px-2 py-1.5"
                        placeholder={t("channelImport.displayName")}
                      />
                    </div>
                    <select
                      value={mapping[p.tg_user_id]?.user_id ?? ""}
                      onChange={(e) =>
                        setMapping((prev) => ({
                          ...prev,
                          [p.tg_user_id]: { ...prev[p.tg_user_id], user_id: e.target.value || null },
                        }))
                      }
                      className="w-full text-sm border border-slate-200 rounded px-2 py-1.5"
                    >
                      <option value="">{t("channelImport.noMapping")}</option>
                      {members.map((m) => (
                        <option key={m.user.id} value={m.user.id}>
                          {userDisplayName(m.user)}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === "done" && result && (
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

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {step === "done" ? t("common.close") : t("common.cancel")}
            </button>
            {step === "upload" && (
              <button
                type="button"
                onClick={handlePreview}
                disabled={loading || !file}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium transition-colors"
              >
                {loading ? t("channelImport.loading") : t("channelImport.next")}
              </button>
            )}
            {step === "mapping" && (
              <button
                type="button"
                onClick={handleImport}
                disabled={loading}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium transition-colors"
              >
                {loading ? t("channelImport.importing") : t("channelImport.import")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
