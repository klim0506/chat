import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { authApi } from "../api/client";
import { useTranslation } from "../lib/i18n";
import { TOP_LAYER_Z_INDEX } from "./TopLayerPortal";

const MAX_IMAGES = 5;

interface SupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** При открытии установить тему (например "bug" для «Рассказать о баге»). */
  initialTopic?: string;
}

const TOPIC_FEEDBACK = "feedback";
const SUPPORT_TOPIC_GENERAL = "general";
const SUPPORT_TOPIC_RESERVED_USERNAME = "reserved_username";
const SUPPORT_TOPIC_BUG = "bug";

export default function SupportModal({ isOpen, onClose, initialTopic }: SupportModalProps) {
  const { t } = useTranslation();
  const [topic, setTopic] = useState(SUPPORT_TOPIC_GENERAL);
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTopic(initialTopic === SUPPORT_TOPIC_BUG ? SUPPORT_TOPIC_BUG : initialTopic === TOPIC_FEEDBACK ? TOPIC_FEEDBACK : SUPPORT_TOPIC_GENERAL);
      setMessage("");
      setFiles([]);
      setError("");
      setSent(false);
    }
  }, [isOpen, initialTopic]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, loading, onClose]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(e.target.files || []);
    const images = chosen.filter((f) => f.type.startsWith("image/"));
    setFiles((prev) => {
      const next = [...prev, ...images].slice(0, MAX_IMAGES);
      return next;
    });
    e.target.value = "";
  };

  const removeFile = (i: number) => {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  };

  const previewUrls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previewUrls.forEach(URL.revokeObjectURL), [previewUrls]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      setError(t("createChat.enterName"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      if (topic === TOPIC_FEEDBACK) {
        await authApi.feedback(trimmed, files.length ? files : undefined);
      } else {
        await authApi.support(trimmed, files.length ? files : undefined, topic);
      }
      setSent(true);
      setTimeout(() => { setSent(false); onClose(); }, 2000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof msg === "string" ? msg : "Error sending");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const isFeedback = topic === TOPIC_FEEDBACK;
  const modalTitle = t("support.menu");
  const desc = isFeedback ? t("feedback.desc") : t("support.desc");
  const placeholder = isFeedback ? t("feedback.placeholder") : t("support.placeholder");
  const attachLabel = isFeedback ? t("feedback.attachPhotos") : t("support.attachPhotos");

  const modalContent = (
    <div className="fixed inset-0 flex items-center justify-center p-4 bg-black/50" style={{ zIndex: TOP_LAYER_Z_INDEX }} onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-slate-800 mb-1">{modalTitle}</h2>
        <p className="text-sm text-slate-500 mb-4">{desc}</p>
        {sent ? (
          <p className="text-green-600 text-sm py-4">{t("feedback.sent")}</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="block text-sm font-medium text-slate-700 mb-1">{t("support.topic")}</label>
              <select
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                disabled={loading}
              >
                <option value={TOPIC_FEEDBACK}>{t("feedback.title")}</option>
                <option value={SUPPORT_TOPIC_GENERAL}>{t("support.title")}</option>
                <option value={SUPPORT_TOPIC_BUG}>{t("support.topicBug")}</option>
                <option value={SUPPORT_TOPIC_RESERVED_USERNAME}>{t("support.topicReservedUsername")}</option>
              </select>
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={placeholder}
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 resize-none min-h-[120px] ${error ? "border-red-500 focus:ring-red-500" : "border-slate-300 focus:ring-amber-400"}`}
              maxLength={2000}
              disabled={loading}
              autoFocus
            />
            <div className="mt-2 flex flex-wrap gap-2 items-center">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || files.length >= MAX_IMAGES}
                className="text-sm text-amber-600 hover:text-amber-800 disabled:opacity-50"
              >
                {attachLabel} {files.length > 0 && `(${files.length}/${MAX_IMAGES})`}
              </button>
              {files.map((_, i) => (
                <div key={i} className="relative group">
                  <img
                    src={previewUrls[i]}
                    alt=""
                    className="w-12 h-12 object-cover rounded border"
                  />
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs leading-none opacity-0 group-hover:opacity-100 hover:bg-red-600"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
            <div className="flex gap-2 justify-end mt-4">
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
                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 text-sm font-medium"
              >
                {loading ? t("common.loading") : t("common.send")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
