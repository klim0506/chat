import { useState, useRef, useEffect, useMemo, useLayoutEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { createPortal } from "react-dom";
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
  const emojiTriggerRef = useRef<HTMLButtonElement>(null);
  const emojiPanelRef = useRef<HTMLDivElement>(null);
  const [emojiPanelPos, setEmojiPanelPos] = useState<{ top: number; left: number } | null>(null);
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
      const target = e.target as Node;
      if (emojiTriggerRef.current?.contains(target)) return;
      if (emojiPanelRef.current?.contains(target)) return;
      setShowEmojiPanel(false);
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handleClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [showEmojiPanel]);

  useLayoutEffect(() => {
    if (!showEmojiPanel) return;
    const updatePosition = () => {
      const trigger = emojiTriggerRef.current;
      const panel = emojiPanelRef.current;
      if (!trigger || !panel) return;

      const triggerRect = trigger.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const panelWidth = panelRect.width || 320;
      const panelHeight = panelRect.height || 296;
      const pad = 8;
      const gap = 8;

      let left = triggerRect.right - panelWidth;
      left = Math.max(pad, Math.min(left, window.innerWidth - panelWidth - pad));

      let top = triggerRect.top - panelHeight - gap;
      if (top < pad) {
        top = triggerRect.bottom + gap;
      }
      top = Math.max(pad, Math.min(top, window.innerHeight - panelHeight - pad));

      setEmojiPanelPos({ top, left });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [showEmojiPanel]);

  useEffect(() => {
    if (!showEmojiPanel) setEmojiPanelPos(null);
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
        className="auth-glass-card ui-modal-surface max-h-[88vh] w-full max-w-[min(42rem,96vw)] my-auto overflow-hidden rounded-[28px] sm:rounded-[32px] animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/70 px-5 pb-4 pt-5 sm:px-6 sm:pb-5 sm:pt-6">
          <div className="min-w-0">
            <h2 className="text-[1.35rem] font-semibold leading-tight tracking-[-0.02em] text-slate-950 sm:text-2xl">
              {t("createChat.title")}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
              {t("createChat.afterCreateHint")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="ui-field-shell shrink-0 rounded-2xl p-2 text-slate-500 transition-colors hover:text-slate-800 disabled:opacity-50"
            aria-label={t("common.close")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex max-h-[88vh] flex-col">
          <div className="space-y-4 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex items-start gap-4">
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
                className="ui-field-shell flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-white/70 text-slate-400 transition-colors hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
                title={t("createChat.addPhoto")}
              >
                {avatarPreview ? (
                  <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
                  </svg>
                )}
              </button>
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-sm font-medium text-slate-700">{t("createChat.chatName")}</label>
                <div className="relative">
                  <div className={`ui-field-shell flex items-center overflow-hidden rounded-2xl border transition-[border-color,box-shadow,background-color] focus-within:bg-white focus-within:ring-4 ${
                    errors.title ? "border-rose-300 focus-within:ring-rose-100" : "focus-within:border-sky-300 focus-within:ring-sky-100"
                  }`}>
                    <input
                      type="text"
                      className="min-w-0 flex-1 border-0 bg-transparent px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                      maxLength={TITLE_MAX}
                      placeholder={t("createChat.namePlaceholder")}
                      autoFocus
                      {...register("title")}
                    />
                    <button
                      ref={emojiTriggerRef}
                      type="button"
                      onClick={() => setShowEmojiPanel((v) => !v)}
                      className={`ui-field-shell rounded-none border-0 border-l px-3 py-2.5 text-slate-500 transition-colors hover:text-slate-800 ${showEmojiPanel ? "bg-sky-50 text-sky-700" : ""}`}
                      title={t("chat.emoji")}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                    </button>
                  </div>
                  {showEmojiPanel && emojiPanelPos && typeof document !== "undefined" && createPortal(
                    <div
                      ref={emojiPanelRef}
                      className="fixed z-[220]"
                      style={{ top: emojiPanelPos.top, left: emojiPanelPos.left }}
                    >
                      <StickerGifPanel
                        emojiOnly
                        onSelectEmoji={(emoji) => {
                          const curr = watch("title") ?? "";
                          const next = curr.length + emoji.length <= TITLE_MAX ? curr + emoji : curr;
                          setValue("title", next, { shouldValidate: true });
                        }}
                      />
                    </div>,
                    document.body,
                  )}
                </div>
                {titleValue.length >= 30 && (
                  <p className={`mt-1 text-xs ${titleValue.length >= TITLE_MAX ? "font-medium text-rose-500" : "text-slate-400"}`}>
                    {titleValue.length}/{TITLE_MAX}
                  </p>
                )}
                {errors.title && <p className="mt-1 text-xs text-rose-500">{errors.title.message}</p>}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">{t("createChat.description")}</label>
              <textarea
                className={`ui-field-shell w-full resize-none rounded-2xl px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 transition-[border-color,box-shadow,background-color] focus:border-sky-300 focus:bg-white focus:outline-none focus:ring-4 ${
                  errors.description ? "border-rose-300 focus:ring-rose-100" : "focus:ring-sky-100"
                }`}
                rows={3}
                maxLength={DESCRIPTION_MAX}
                placeholder={t("createChat.descPlaceholder")}
                {...register("description")}
              />
              {descriptionValue.length >= DESCRIPTION_MAX - DESCRIPTION_COUNTER_NEAR && (
                <p className={`mt-1 text-right text-xs ${descriptionValue.length >= DESCRIPTION_MAX ? "font-medium text-rose-500" : "text-slate-400"}`}>
                  {descriptionValue.length}/{DESCRIPTION_MAX}
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200/70 bg-white/65 px-3 py-2.5 sm:px-4">
              <ClosedTypeSwitchRow
                closed={chatType === "closed"}
                onClosedChange={(closed) => setValue("chat_type", closed ? "closed" : "open", { shouldValidate: true })}
                tooltip={t("createChat.typeHint")}
                disabled={loading}
              />
            </div>

            {error && <p className="text-sm text-rose-500">{error}</p>}
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-200/70 px-5 py-4 sm:px-6">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="ui-field-shell rounded-2xl px-5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-white disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="ui-accent-strong rounded-2xl px-6 py-2.5 text-sm font-medium text-white shadow-[0_10px_24px_rgba(37,99,235,0.24)] transition-colors disabled:opacity-50"
            >
              {loading ? t("createChat.creating") : t("createChat.create")}
            </button>
          </div>
        </form>
      </div>
    </ModalViewportLayer>
  );
}
