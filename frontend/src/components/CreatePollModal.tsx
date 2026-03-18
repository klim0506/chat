import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../lib/i18n";

export interface CreatePollModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (question: string, options: string[], multiple: boolean, anonymous: boolean, quiz?: boolean, correctIndex?: number) => void;
}

export default function CreatePollModal({ isOpen, onClose, onCreate }: CreatePollModalProps) {
  const { t } = useTranslation();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [quiz, setQuiz] = useState(false);
  const [correctIndex, setCorrectIndex] = useState<number>(0);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setQuestion("");
      setOptions(["", ""]);
      setMultiple(false);
      setAnonymous(false);
      setQuiz(false);
      setCorrectIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sending) onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, sending, onClose]);

  const validOptions = options.filter((o) => o.trim().length > 0);
  const canCreate = question.trim().length > 0 && validOptions.length >= 2
    && (!quiz || (correctIndex >= 0 && correctIndex < validOptions.length));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate || sending) return;
    setSending(true);
    onCreate(question.trim(), validOptions, quiz ? false : multiple, anonymous, quiz, quiz ? Math.min(correctIndex, validOptions.length - 1) : undefined);
    onClose();
    setSending(false);
  };

  const addOption = () => {
    if (options.length < 10) setOptions([...options, ""]);
  };

  const updateOption = (idx: number, value: string) => {
    const next = [...options];
    next[idx] = value;
    setOptions(next);
  };

  const removeOption = (idx: number) => {
    if (options.length <= 2) return;
    setOptions(options.filter((_, i) => i !== idx));
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !sending) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-[90vw] max-w-md max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800">{t("chat.pollCreate")}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" disabled={sending}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("chat.pollQuestion")}</label>
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={t("chat.pollQuestion")}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                maxLength={255}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("chat.pollOption")}</label>
              <div className="space-y-2">
                {options.map((opt, idx) => (
                  <div key={idx} className="flex gap-2">
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) => updateOption(idx, e.target.value)}
                      placeholder={`${t("chat.pollOption")} ${idx + 1}`}
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                      maxLength={100}
                    />
                    <button
                      type="button"
                      onClick={() => removeOption(idx)}
                      disabled={options.length <= 2}
                      className="p-2 text-slate-400 hover:text-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                  </div>
                ))}
              </div>
              {options.length < 10 && (
                <button type="button" onClick={addOption} className="mt-2 text-sm text-blue-600 hover:text-blue-700 font-medium">
                  + {t("chat.pollAddOption")}
                </button>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={quiz}
                  onChange={(e) => { setQuiz(e.target.checked); if (e.target.checked) setMultiple(false); }}
                />
                <span className="text-sm text-slate-700">{t("chat.pollQuiz")}</span>
              </label>
              {quiz && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t("chat.pollCorrectAnswer")}</label>
                  <select
                    value={Math.min(correctIndex, validOptions.length - 1)}
                    onChange={(e) => setCorrectIndex(Number(e.target.value))}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    {validOptions.map((opt, idx) => (
                      <option key={idx} value={idx}>{opt}</option>
                    ))}
                  </select>
                </div>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={multiple}
                  onChange={(e) => setMultiple(e.target.checked)}
                  disabled={quiz}
                />
                <span className="text-sm text-slate-700">{t("chat.pollMultiple")}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={anonymous}
                  onChange={(e) => setAnonymous(e.target.checked)}
                />
                <span className="text-sm text-slate-700">{t("chat.pollAnonymous")}</span>
              </label>
            </div>
          </div>
          <div className="p-4 border-t border-slate-200">
            <button
              type="submit"
              disabled={!canCreate || sending}
              className="w-full py-2.5 rounded-lg bg-blue-500 text-white font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("chat.pollCreate")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
