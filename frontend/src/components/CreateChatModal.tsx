import { useState, useRef, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { chatsApi } from "../api/client";
import { useTranslation, type TranslationKey } from "../lib/i18n";
import { usePremiumModalStore } from "../store/premiumModal";
import { StickerGifPanel } from "./StickerGifPanel";

const TITLE_MAX = 50;
const DESCRIPTION_MAX = 300;

function getSchema(t: (key: TranslationKey) => string) {
  return z.object({
    title: z.string().min(1, t("createChat.enterName")).max(TITLE_MAX, t("createChat.maxChars").replace("%s", String(TITLE_MAX))),
    description: z.string().max(DESCRIPTION_MAX, t("createChat.maxChars").replace("%s", String(DESCRIPTION_MAX))).optional(),
    chat_type: z.enum(["open", "closed"]),
  });
}
type FormData = z.infer<ReturnType<typeof getSchema>>;

interface CreateChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after chat is successfully created. Receives chatId and invite_link (if any). */
  onCreated: (chatId: string, inviteLink: string | null) => void;
}

export default function CreateChatModal({ isOpen, onClose, onCreated }: CreateChatModalProps) {
  const { t } = useTranslation();
  const schema = useMemo(() => getSchema(t), [t]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const { register, handleSubmit, watch, reset, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", description: "", chat_type: "open" },
  });
  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  const emojiPanelRef = useRef<HTMLDivElement>(null);
  const titleValue = watch("title") ?? "";
  const descriptionValue = watch("description") ?? "";

  const onAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    } else {
      setAvatarFile(null);
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview(null);
    }
  };

  // Cleanup object URL on unmount or when preview changes
  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      reset({ title: "", description: "", chat_type: "open" });
      setShowEmojiPanel(false);
      setError("");
      setAvatarFile(null);
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, reset]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, loading, onClose]);

  // Close emoji panel on outside click
  useEffect(() => {
    if (!showEmojiPanel) return;
    const handleClick = (e: MouseEvent) => {
      if (emojiPanelRef.current && !emojiPanelRef.current.contains(e.target as Node)) {
        setShowEmojiPanel(false);
      }
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handleClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [showEmojiPanel]);

  const onSubmit = async (data: FormData) => {
    setError("");
    setLoading(true);
    const payload = { title: data.title, chat_type: data.chat_type, description: data.description || "", title_icon: "" };
    try {
      const { data: chat } = await chatsApi.create(payload);
      if (avatarFile) {
        await chatsApi.uploadAvatar(chat.id, avatarFile);
      }
      onCreated(chat.id, chat.invite_link ?? null);
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: unknown }; message?: string; code?: string };
      const resData = err.response?.data;
      const status = err.response?.status;
      let msg: string;
      if (resData && typeof resData === "object" && "detail" in resData) {
        const d = (resData as { detail?: string | string[] }).detail;
        msg = Array.isArray(d) ? (d[0] || "") : String(d ?? "");
      } else {
        msg = "";
      }
      if (status === 401) {
        setError(t("createChat.sessionExpired"));
      } else if (status === 403 && (msg.includes("подписк") || msg.includes("subscription"))) {
        usePremiumModalStore.getState().openModal();
        setError(t("createChat.needsSubscription"));
      } else if (!err.response) {
        setError(t("createChat.serverError"));
      } else {
        setError(msg || t("createChat.genericError"));
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="ui-overlay fixed inset-0 z-[150] flex items-center justify-center p-4 overflow-y-auto"
      onClick={() => { if (!loading) onClose(); }}
    >
      <div
        className="ui-modal-surface max-w-md w-full my-auto rounded-2xl animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{t("createChat.title")}</h2>
            <p className="text-slate-500 text-xs mt-0.5">
              {t("createChat.afterCreateHint")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="ui-icon-button rounded-lg p-1.5 transition-colors disabled:opacity-50"
            aria-label={t("common.close")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="px-6 pb-5 pt-3 space-y-4">
          <div className="flex gap-4 items-start">
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onAvatarChange}
            />
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              className="ui-avatar-slot w-14 h-14 rounded-full flex items-center justify-center overflow-hidden shrink-0 border-2 border-dashed hover:border-blue-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
              title={t("createChat.addPhoto")}
            >
              {avatarPreview ? (
                <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                  <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
                </svg>
              )}
            </button>
            <div className="flex-1 min-w-0 flex gap-2 items-end">
              <div className="flex-1 min-w-0">
                <label className="block text-sm font-medium text-slate-700 mb-1">{t("createChat.chatName")}</label>
                <div ref={emojiPanelRef} className="relative flex">
                  <input
                    type="text"
                    className={`flex-1 border rounded-l-lg rounded-r-none px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-inset ${errors.title ? "border-red-500 focus:ring-red-500" : "border-slate-300 focus:ring-blue-400"}`}
                    maxLength={TITLE_MAX}
                    placeholder={t("createChat.namePlaceholder")}
                    autoFocus
                    {...register("title")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowEmojiPanel((v) => !v)}
                    className={`ui-picker-tile shrink-0 rounded-r-lg border border-l-0 px-2.5 transition-colors ${showEmojiPanel ? "ui-picker-tile-active" : ""} ${errors.title ? "border-red-500" : "border-slate-300"}`}
                    title={t("chat.emoji")}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                  </button>
                  {showEmojiPanel && (
                    <div className="absolute right-0 bottom-full mb-1 z-50">
                      <StickerGifPanel
                        emojiOnly
                        onSelectEmoji={(emoji) => {
                          const curr = watch("title") ?? "";
                          const next = curr.length + emoji.length <= TITLE_MAX ? curr + emoji : curr;
                          setValue("title", next, { shouldValidate: true });
                          setShowEmojiPanel(false);
                        }}
                      />
                    </div>
                  )}
                </div>
                {titleValue.length >= 30 && (
                  <p className={`text-xs mt-0.5 ${titleValue.length >= TITLE_MAX ? "text-red-500 font-medium" : "text-slate-500"}`}>
                    {titleValue.length}/{TITLE_MAX}
                  </p>
                )}
                {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title.message}</p>}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t("createChat.description")}</label>
            <textarea
              className="w-full border border-slate-300 rounded-lg px-3 py-2 resize-none text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
              rows={2}
              maxLength={DESCRIPTION_MAX}
              placeholder={t("createChat.descPlaceholder")}
              {...register("description")}
            />
            <p className="text-xs text-slate-500 text-right mt-0.5">{descriptionValue.length}/{DESCRIPTION_MAX}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">{t("createChat.chatType")}</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" value="open" className="accent-blue-600" {...register("chat_type")} /> {t("createChat.open")}
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" value="closed" className="accent-blue-600" {...register("chat_type")} /> {t("createChat.closed")}
              </label>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {t("createChat.typeHint")}
            </p>
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="ui-picker-tile rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition-colors disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium transition-colors"
            >
              {loading ? t("createChat.creating") : t("createChat.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
