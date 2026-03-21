import { useState, useRef, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { chatsApi } from "../api/client";
import { useTranslation, type TranslationKey } from "../lib/i18n";
import { usePremiumModalStore } from "../store/premiumModal";
import { StickerGifPanel } from "./StickerGifPanel";
import { ModalViewportLayer } from "./TopLayerPortal";
import { ClosedTypeSwitchRow } from "./ClosedTypeSwitchRow";

const TITLE_MAX = 50;
const DESCRIPTION_MAX = 300;
const DESCRIPTION_COUNTER_NEAR = 50;

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
  const chatType = watch("chat_type");

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
    <ModalViewportLayer onBackdropClick={loading ? undefined : onClose}>
      <div
        className="ui-modal-surface ui-create-modal max-h-[85vh] max-w-lg w-full my-auto rounded-xl animate-in fade-in zoom-in-95 duration-150 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b ui-create-modal-divider px-5 pt-3 pb-2">
          <div>
            <h2 className="text-base font-semibold ui-create-modal-title">{t("createChat.title")}</h2>
            <p className="mt-0.5 text-xs ui-create-modal-subtitle leading-snug">
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
        <form onSubmit={handleSubmit(onSubmit)} className="flex max-h-[85vh] flex-col">
          <div className="space-y-3 overflow-y-auto px-5 py-3">
          <div className="flex gap-3 items-start">
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
              className="ui-avatar-slot ui-create-avatar-btn w-12 h-12 rounded-full flex items-center justify-center overflow-hidden shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:rgba(33,55,84,0.28)]"
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
            <div className="flex-1 min-w-0">
              <div className="flex-1 min-w-0">
                <label className="block ui-create-modal-label mb-1">{t("createChat.chatName")}</label>
                <div ref={emojiPanelRef} className="relative">
                  <div className={`ui-create-field-row ${errors.title ? "ui-create-field-row--error" : ""}`}>
                  <input
                    type="text"
                    className="ui-create-input"
                    maxLength={TITLE_MAX}
                    placeholder={t("createChat.namePlaceholder")}
                    autoFocus
                    {...register("title")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowEmojiPanel((v) => !v)}
                    className={`ui-create-attach-btn min-h-[2.25rem] px-2.5 ${showEmojiPanel ? "ui-create-attach-btn--active" : ""}`}
                    title={t("chat.emoji")}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                  </button>
                  </div>
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
                  <p className={`text-xs mt-0.5 ${titleValue.length >= TITLE_MAX ? "text-red-500 font-medium" : "ui-create-modal-hint"}`}>
                    {titleValue.length}/{TITLE_MAX}
                  </p>
                )}
                {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title.message}</p>}
              </div>
            </div>
          </div>

          <div>
            <label className="block ui-create-modal-label mb-1">{t("createChat.description")}</label>
            <textarea
              className={`ui-create-input ${errors.description ? "ui-create-input--error" : ""}`}
              rows={2}
              maxLength={DESCRIPTION_MAX}
              placeholder={t("createChat.descPlaceholder")}
              {...register("description")}
            />
            {descriptionValue.length >= DESCRIPTION_MAX - DESCRIPTION_COUNTER_NEAR && (
              <p
                className={`text-xs text-right mt-0.5 ${
                  descriptionValue.length >= DESCRIPTION_MAX ? "text-red-500 font-medium" : "ui-create-modal-hint"
                }`}
              >
                {descriptionValue.length}/{DESCRIPTION_MAX}
              </p>
            )}
          </div>

          <ClosedTypeSwitchRow
            closed={chatType === "closed"}
            onClosedChange={(closed) => setValue("chat_type", closed ? "closed" : "open", { shouldValidate: true })}
            tooltip={t("createChat.typeHint")}
            disabled={loading}
          />

          {error && <p className="text-red-500 text-sm">{error}</p>}
          </div>

          <div className="flex gap-2 justify-end border-t ui-create-modal-divider px-5 py-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="ui-accent-soft border rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="ui-accent-strong rounded-lg px-4 py-1.5 disabled:opacity-50 text-sm font-medium transition-colors"
            >
              {loading ? t("createChat.creating") : t("createChat.create")}
            </button>
          </div>
        </form>
      </div>
    </ModalViewportLayer>
  );
}
