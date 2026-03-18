import { useState, useEffect, useCallback } from "react";
import { chatsApi } from "../api/client";
import { useTranslation } from "../lib/i18n";
import { userDisplayName } from "../api/client";

interface Participant {
  display_name: string;
  user_id: string | null;
  message_count: number;
}

interface ManageImportModalProps {
  chatId: string;
  chatTitle: string;
  members: { user: { id: string; display_name?: string; username?: string } }[];
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function ManageImportModal({
  chatId,
  chatTitle,
  members,
  isOpen,
  onClose,
  onSuccess,
}: ManageImportModalProps) {
  const { t } = useTranslation();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [localNames, setLocalNames] = useState<Record<string, string>>({});
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  const fetchParticipants = useCallback(() => {
    if (!chatId) return;
    setFetching(true);
    chatsApi
      .getImportParticipants(chatId)
      .then((res) => {
        const list = res.data.participants || [];
        setParticipants(list);
        const names: Record<string, string> = {};
        const map: Record<string, string> = {};
        for (const p of list) {
          names[p.display_name] = p.display_name;
          if (p.user_id) map[p.display_name] = p.user_id;
        }
        setLocalNames(names);
        setMapping(map);
        setFetching(false);
      })
      .catch(() => setFetching(false));
  }, [chatId]);

  useEffect(() => {
    if (isOpen && chatId) {
      fetchParticipants();
    }
  }, [isOpen, chatId, fetchParticipants]);

  const handleNameChange = (displayName: string, newName: string) => {
    setLocalNames((prev) => ({ ...prev, [displayName]: newName }));
  };

  const handleNameBlur = async (displayName: string) => {
    const newName = (localNames[displayName] ?? displayName).trim();
    if (!newName || newName === displayName) return;
    setLoading(true);
    setError("");
    try {
      await chatsApi.updateImportDisplayName(chatId, displayName, newName);
      fetchParticipants();
      onSuccess?.();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string | string[] } } };
      const detail = err.response?.data?.detail;
      setError(Array.isArray(detail) ? detail[0] : (detail as string) || t("channelImport.error"));
    } finally {
      setLoading(false);
    }
  };

  const handleRemap = async (displayName: string) => {
    const userId = mapping[displayName];
    if (!userId) return;
    setLoading(true);
    setError("");
    try {
      await chatsApi.remapImport(chatId, { [displayName]: userId });
      fetchParticipants();
      onSuccess?.();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string | string[] } } };
      const detail = err.response?.data?.detail;
      setError(Array.isArray(detail) ? detail[0] : (detail as string) || t("channelImport.error"));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/50 overflow-y-auto"
      onClick={() => { if (!loading) onClose(); }}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full my-auto animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-2 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{t("channelImport.manageTitle")}</h2>
            <p className="text-slate-500 text-xs mt-0.5">{t("channelImport.manageSubtitle").replace("%s", chatTitle)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50"
            aria-label={t("common.close")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        <div className="px-6 pb-5 pt-3 flex-1 overflow-y-auto space-y-4">
          <p className="text-sm text-slate-600">{t("channelImport.manageHint")}</p>

          {fetching ? (
            <p className="text-slate-500 text-sm">{t("common.loading")}</p>
          ) : participants.length === 0 ? (
            <p className="text-slate-500 text-sm">{t("channelImport.allMapped")}</p>
          ) : (
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {participants.map((p, idx) => (
                <div key={`${p.display_name}-${p.user_id ?? "u"}-${idx}`} className="border border-slate-200 rounded-lg p-3 space-y-2">
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={localNames[p.display_name] ?? p.display_name}
                      onChange={(e) => handleNameChange(p.display_name, e.target.value)}
                      onBlur={() => handleNameBlur(p.display_name)}
                      className="flex-1 text-sm border border-slate-200 rounded px-2 py-1.5"
                      placeholder={t("channelImport.displayName")}
                    />
                  </div>
                  <div className="flex gap-2 items-center">
                    <select
                      value={mapping[p.display_name] ?? ""}
                      onChange={(e) =>
                        setMapping((prev) => ({
                          ...prev,
                          [p.display_name]: e.target.value,
                        }))
                      }
                      disabled={!!p.user_id}
                      className="flex-1 text-sm border border-slate-200 rounded px-2 py-1.5 disabled:bg-slate-50 disabled:cursor-default"
                    >
                      <option value="">{t("channelImport.noMapping")}</option>
                      {members.map((m) => (
                        <option key={m.user.id} value={m.user.id}>
                          {userDisplayName(m.user)}
                        </option>
                      ))}
                    </select>
                    {!p.user_id && (
                      <button
                        type="button"
                        onClick={() => handleRemap(p.display_name)}
                        disabled={loading || !mapping[p.display_name]}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium shrink-0"
                      >
                        {t("channelImport.remap")}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {t("channelImport.messageCount").replace("%s", String(p.message_count))}
                  </p>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
