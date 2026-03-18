import { useState, useEffect, useRef } from "react";
import { foldersApi, type ChatFolder } from "../api/client";
import { useTranslation } from "../lib/i18n";

const FOLDER_EMOJIS = ["📁", "📂", "💼", "⭐", "🏠", "👥", "💬", "❤️", "🔔", "📢", "🎯", "📱", "🌟", "🔥", "📣", "💡", "🎬", "✅", "📎", "🔒"];
const FOLDER_COLORS = ["#3B82F6", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#6B7280", "#EC4899", "#14B8A6"];

interface CreateFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (folder: ChatFolder) => void;
}

export default function CreateFolderModal({ isOpen, onClose, onCreated }: CreateFolderModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("📁");
  const [color, setColor] = useState("#3B82F6");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setEmoji("📁");
      setColor("#3B82F6");
      setError("");
      setPickerOpen(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [pickerOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pickerOpen) setPickerOpen(false);
        else if (!loading) onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, loading, onClose, pickerOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("createChat.enterName"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data } = await foldersApi.create({ name: trimmed, emoji: emoji || undefined, color: color || undefined });
      onCreated(data);
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof msg === "string" ? msg : "Error creating folder");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-slate-800 mb-4">{t("folders.createTitle")}</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">{t("folders.name")}</label>
            <div className="flex gap-2 relative" ref={pickerRef}>
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                className={`shrink-0 w-10 h-10 rounded-lg border flex items-center justify-center text-xl transition-colors ${
                  pickerOpen ? "border-blue-400 bg-blue-50 ring-1 ring-blue-300" : "border-slate-300 hover:bg-slate-50"
                }`}
              >
                {emoji}
              </button>
              {pickerOpen && (
                <div className="absolute left-0 top-full mt-1 z-50 p-2 bg-white rounded-xl border border-slate-200 shadow-lg">
                  <div className="flex flex-wrap gap-1 w-52">
                    {FOLDER_EMOJIS.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => {
                          setEmoji(e);
                          setPickerOpen(false);
                        }}
                        className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-colors ${
                          e === emoji ? "bg-blue-100 text-blue-700 ring-1 ring-blue-300" : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                        }`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("folders.name")}
                className={`flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 ${error ? "border-red-500 focus:ring-red-500" : "border-slate-300 focus:ring-blue-400"}`}
                maxLength={64}
                autoFocus
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">{t("folders.color")}</label>
            <div className="flex flex-wrap gap-1.5">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-lg border-2 transition-all ${
                    color === c ? "border-slate-800 scale-110" : "border-slate-200 hover:border-slate-400"
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>
          {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
            >
              {loading ? t("common.loading") : t("folders.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
