import { useMemo, useState, useEffect, useRef } from "react";
import { foldersApi, userDisplayName, type Chat, type ChatFolder } from "../api/client";
import { useTranslation } from "../lib/i18n";
import { AnchoredPortal } from "./TopLayerPortal";

const FOLDER_EMOJIS = ["📁", "📂", "💼", "⭐", "🏠", "👥", "💬", "❤️", "🔔", "📢", "🎯", "📱", "🌟", "🔥", "📣", "💡", "🎬", "✅", "📎", "🔒"];
const FOLDER_COLORS = ["#3B82F6", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#6B7280", "#EC4899", "#14B8A6"];

interface CreateFolderModalProps {
  isOpen: boolean;
  chats: Chat[];
  onClose: () => void;
  onCreated: (folder: ChatFolder, selectedChatIds: string[]) => void;
}

function getChatLabel(chat: Chat) {
  if (chat.is_favorites) return "Избранное";
  if (chat.is_personal && chat.other_member) return userDisplayName(chat.other_member);
  return chat.title || "";
}

export default function CreateFolderModal({ isOpen, chats, onClose, onCreated }: CreateFolderModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("📁");
  const [color, setColor] = useState("#3B82F6");
  const [query, setQuery] = useState("");
  const [selectedChatIds, setSelectedChatIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName("");
    setEmoji("📁");
    setColor("#3B82F6");
    setQuery("");
    setSelectedChatIds([]);
    setError("");
    setPickerOpen(false);
  }, [isOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!pickerRef.current?.contains(target) && !pickerPopoverRef.current?.contains(target)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [pickerOpen]);

  const visibleChats = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chats
      .filter((chat) => !chat.is_archived)
      .filter((chat) => {
        if (!q) return true;
        return getChatLabel(chat).toLowerCase().includes(q);
      })
      .sort((a, b) => getChatLabel(a).localeCompare(getChatLabel(b), "ru"));
  }, [chats, query]);

  const toggleChat = (chatId: string) => {
    setSelectedChatIds((prev) => (
      prev.includes(chatId) ? prev.filter((id) => id !== chatId) : [...prev, chatId]
    ));
  };

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
      const { data } = await foldersApi.create({
        name: trimmed,
        emoji: emoji || undefined,
        color: color || undefined,
        chat_ids: selectedChatIds,
      });
      onCreated(data, selectedChatIds);
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
    <div className="ui-overlay fixed inset-0 z-[150] flex items-center justify-center p-4" onClick={onClose}>
      <div className="ui-modal-surface max-h-[85vh] w-full max-w-lg overflow-hidden rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit} className="flex max-h-[85vh] flex-col">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-800">{t("folders.createTitle")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("folders.addChatToFolder")}</p>
          </div>

          <div className="space-y-4 overflow-y-auto px-6 py-5">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">{t("folders.name")}</label>
              <div className="flex gap-2" ref={pickerRef}>
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  className={`ui-picker-tile flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl ${
                    pickerOpen ? "ui-picker-tile-active" : ""
                  }`}
                >
                  {emoji}
                </button>
                {pickerOpen && (
                  <AnchoredPortal anchorRef={pickerRef} portalRef={pickerPopoverRef} className="ui-popover-surface rounded-xl p-2">
                    <div className="flex w-52 flex-wrap gap-1">
                      {FOLDER_EMOJIS.map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => {
                            setEmoji(item);
                            setPickerOpen(false);
                          }}
                          className={`ui-picker-tile flex h-9 w-9 items-center justify-center rounded-lg text-lg ${
                            item === emoji ? "ui-picker-tile-active" : ""
                          }`}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </AnchoredPortal>
                )}
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("folders.namePlaceholder")}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${error ? "border-red-500 focus:ring-red-500" : "border-slate-300 focus:ring-blue-400"}`}
                  maxLength={64}
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">{t("folders.color")}</label>
              <div className="flex flex-wrap gap-1.5">
                {FOLDER_COLORS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setColor(item)}
                    className={`ui-picker-tile h-8 w-8 rounded-lg border-2 transition-all ${color === item ? "scale-110 border-slate-800" : "hover:border-slate-400"}`}
                    style={{ backgroundColor: item }}
                    title={item}
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <label className="block text-sm font-medium text-slate-700">{t("folders.chatsInFolder")}</label>
                <span className="text-xs text-slate-400">{selectedChatIds.length}</span>
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("search.placeholder")}
                className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <div className="ui-subtle-panel max-h-64 space-y-1 overflow-y-auto rounded-xl p-2">
                {visibleChats.map((chat) => {
                  const selected = selectedChatIds.includes(chat.id);
                  return (
                    <label
                      key={chat.id}
                      className={`ui-list-row flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${
                        selected ? "ui-list-row-active text-slate-900" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleChat(chat.id)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{getChatLabel(chat)}</span>
                    </label>
                  );
                })}
                {visibleChats.length === 0 && (
                  <p className="px-2 py-4 text-center text-sm text-slate-500">{t("search.noResults")}</p>
                )}
              </div>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="ui-picker-tile rounded-lg px-4 py-2 text-sm font-medium text-slate-600"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? t("common.loading") : t("folders.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
