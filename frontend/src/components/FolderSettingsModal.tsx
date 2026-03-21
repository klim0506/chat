import { useState, useEffect, useRef } from "react";
import { foldersApi, type ChatFolder } from "../api/client";
import { useChatListStore } from "../store/chatList";
import { useTranslation } from "../lib/i18n";
import { getAvatarInitials } from "../lib/avatar-initials";
import type { Chat } from "../api/client";
import { AnchoredPortal, ModalViewportLayer } from "./TopLayerPortal";

const FOLDER_EMOJIS = ["📁", "📂", "💼", "⭐", "🏠", "👥", "💬", "❤️", "🔔", "📢", "🎯", "📱", "🌟", "🔥", "📣", "💡", "🎬", "✅", "📎", "🔒"];
const FOLDER_COLORS = ["#3B82F6", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#6B7280", "#EC4899", "#14B8A6"];

function chatTitle(c: Chat): string {
  if (c.title) return c.title;
  if (c.is_personal && c.other_member) {
    return c.other_member.display_name || (c.other_member as { username?: string }).username || c.other_member.phone || "";
  }
  return "";
}

interface FolderSettingsModalProps {
  isOpen: boolean;
  folder: ChatFolder | null;
  onClose: () => void;
  onUpdated: (folder: ChatFolder) => void;
}

export default function FolderSettingsModal({ isOpen, folder, onClose, onUpdated }: FolderSettingsModalProps) {
  const { t } = useTranslation();
  const chats = useChatListStore((s) => s.chats);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("📁");
  const [color, setColor] = useState("#3B82F6");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && folder) {
      setName(folder.name);
      setEmoji(folder.emoji || "📁");
      setColor(folder.color || "#3B82F6");
      setError("");
      setPickerOpen(false);
    }
  }, [isOpen, folder]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!pickerRef.current?.contains(target) && !pickerPopoverRef.current?.contains(target)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [pickerOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pickerOpen) setPickerOpen(false);
        else if (!saving) onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, saving, onClose, pickerOpen]);

  const folderChats = folder ? chats.filter((c) => (c.folder_ids || []).includes(folder.id)) : [];
  const chatsNotInFolder = folder ? chats.filter((c) => !(c.folder_ids || []).includes(folder.id)) : [];
  const storeUpdateChat = useChatListStore((s) => s.updateChat);

  const handleAddChat = async (chatId: string) => {
    if (!folder) return;
    setAdding(chatId);
    try {
      await foldersApi.addChat(folder.id, chatId);
      const chat = chats.find((c) => c.id === chatId);
      if (chat) {
        storeUpdateChat(chatId, {
          folder_ids: [...(chat.folder_ids || []), folder.id],
        });
      }
    } catch { /* ignore */ }
    setAdding(null);
  };

  const handleSave = async () => {
    if (!folder) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("createChat.enterName"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { data } = await foldersApi.update(folder.id, {
        name: trimmed,
        emoji: emoji || undefined,
        color: color || undefined,
      });
      onUpdated(data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof msg === "string" ? msg : "Error");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveChat = async (chatId: string) => {
    if (!folder) return;
    setRemoving(chatId);
    try {
      await foldersApi.removeChat(folder.id, chatId);
      const chat = chats.find((c) => c.id === chatId);
      if (chat) {
        storeUpdateChat(chatId, {
          folder_ids: (chat.folder_ids || []).filter((id) => id !== folder.id),
        });
      }
    } catch { /* ignore */ }
    setRemoving(null);
  };

  if (!isOpen || !folder) return null;

  return (
    <ModalViewportLayer onBackdropClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-800">{t("folders.settings")}</h2>
        </div>
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t("folders.name")}</label>
            <div className="flex gap-2 relative" ref={pickerRef}>
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                className="shrink-0 w-10 h-10 rounded-lg border border-slate-300 hover:bg-slate-50 flex items-center justify-center text-xl"
              >
                {emoji}
              </button>
              {pickerOpen && (
                <AnchoredPortal anchorRef={pickerRef} portalRef={pickerPopoverRef} className="p-2 bg-white rounded-xl border border-slate-200 shadow-lg">
                  <div className="flex flex-wrap gap-1 w-52">
                    {FOLDER_EMOJIS.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => { setEmoji(e); setPickerOpen(false); }}
                        className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg ${e === emoji ? "bg-blue-100 ring-1 ring-blue-300" : "bg-slate-100 hover:bg-slate-200"}`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </AnchoredPortal>
              )}
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 ${error ? "border-red-500 focus:ring-red-500" : "border-slate-300 focus:ring-blue-400"}`}
                maxLength={64}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t("folders.color")}</label>
            <div className="flex flex-wrap gap-1.5">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-lg border-2 transition-all ${color === c ? "border-slate-800 scale-110" : "border-slate-200 hover:border-slate-400"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">{t("folders.chatsInFolder")}</label>
            {folderChats.length > 0 && (
              <ul className="space-y-1 max-h-32 overflow-y-auto mb-2">
                {folderChats.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-slate-50">
                    <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-medium text-slate-600 shrink-0">
                      {getAvatarInitials(chatTitle(c) || "?")}
                    </div>
                    <span className="flex-1 text-sm text-slate-800 truncate">{chatTitle(c) || c.id.slice(0, 8)}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveChat(c.id)}
                      disabled={removing === c.id}
                      className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50 shrink-0"
                    >
                      {removing === c.id ? "…" : t("folders.removeFromFolder")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {chatsNotInFolder.length > 0 && (
              <details className="mt-2">
                <summary className="text-sm text-slate-600 cursor-pointer hover:text-slate-800">
                  {t("folders.addChatToFolder")}
                </summary>
                <ul className="space-y-1 max-h-32 overflow-y-auto mt-1">
                  {chatsNotInFolder.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-slate-50">
                      <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-medium text-slate-600 shrink-0">
                        {getAvatarInitials(chatTitle(c) || "?")}
                      </div>
                      <span className="flex-1 text-sm text-slate-800 truncate">{chatTitle(c) || c.id.slice(0, 8)}</span>
                      <button
                        type="button"
                        onClick={() => handleAddChat(c.id)}
                        disabled={adding === c.id}
                        className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50 shrink-0"
                      >
                        {adding === c.id ? "…" : t("folders.addToFolder")}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>
        <div className="p-5 border-t border-slate-100 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium">
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
          >
            {saving ? t("common.loading") : t("common.save")}
          </button>
        </div>
      </div>
    </ModalViewportLayer>
  );
}
