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
    <div className="fixed inset-0 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]" style={{ zIndex: TOP_LAYER_Z_INDEX }} onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.2)] md:p-7" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold leading-tight text-slate-900">{modalTitle}</h2>
            <p className="mt-2 text-base text-slate-500">{desc}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            aria-label={t("common.close")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="text-2xl leading-none">×</span>
          </button>
        </div>
        {sent ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{t("feedback.sent")}</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("support.topic")}</label>
              <select
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 transition focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
                disabled={loading}
              >
                <option value={TOPIC_FEEDBACK}>{t("feedback.title")}</option>
                <option value={SUPPORT_TOPIC_GENERAL}>{t("support.title")}</option>
                <option value={SUPPORT_TOPIC_BUG}>{t("support.topicBug")}</option>
                <option value={SUPPORT_TOPIC_RESERVED_USERNAME}>{t("support.topicReservedUsername")}</option>
              </select>
            </div>
            <div className="mb-2">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={placeholder}
                className={`w-full resize-none rounded-2xl border bg-slate-50/70 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 transition focus:bg-white focus:outline-none focus:ring-2 min-h-[170px] ${error ? "border-red-400 focus:border-red-500 focus:ring-red-200" : "border-slate-300 focus:border-amber-400 focus:ring-amber-200"}`}
                maxLength={2000}
                disabled={loading}
                autoFocus
              />
              <div className="mt-1.5 flex justify-end">
                <span className="text-xs text-slate-400">{message.length}/2000</span>
              </div>
            </div>
            <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
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
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {attachLabel} {files.length > 0 && `(${files.length}/${MAX_IMAGES})`}
              </button>
              {files.map((_, i) => (
                <div key={i} className="group relative">
                  <img
                    src={previewUrls[i]}
                    alt=""
                    className="h-14 w-14 rounded-lg border border-slate-200 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="absolute -right-1 -top-1 h-5 w-5 rounded-full bg-red-500 text-xs leading-none text-white opacity-0 transition hover:bg-red-600 group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex justify-end gap-2.5 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={loading}
                className="rounded-xl bg-amber-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
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
