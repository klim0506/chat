import { useState, useRef, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { channelsApi } from "../api/client";
import { useTranslation, type TranslationKey } from "../lib/i18n";
import { EmojiPickerPopover } from "./EmojiPickerPopover";
import ImportTelegramModal from "./ImportTelegramModal";
import { ModalViewportLayer } from "./TopLayerPortal";
import { ClosedTypeSwitchRow } from "./ClosedTypeSwitchRow";

const TITLE_MAX = 50;
const DESCRIPTION_MAX = 300;
const DESCRIPTION_COUNTER_NEAR = 50;

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

function getSchema(t: (key: TranslationKey) => string) {
  return z.object({
    title: z.string().min(1, t("createChat.enterName")).max(TITLE_MAX, t("createChat.maxChars").replace("%s", String(TITLE_MAX))),
    title_icon: z.string().max(16).optional(),
    description: z.string().max(DESCRIPTION_MAX, t("createChat.maxChars").replace("%s", String(DESCRIPTION_MAX))).optional(),
    is_public: z
      .union([z.boolean(), z.literal("true"), z.literal("false")])
      .transform((v) => v === true || v === "true"),
    username: z
      .string()
      .max(31) // allow leading @
      .transform((s) => (s ?? "").trim().replace(/^@+/, ""))
      .pipe(
        z
          .string()
          .min(1, t("createChannel.usernameRequired"))
          .refine((v) => USERNAME_REGEX.test(v), { message: "Латиница, цифры, подчёркивание, 3–30 символов" })
      ),
  });
}
type FormData = z.infer<ReturnType<typeof getSchema>>;

interface CreateChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (channelId: string, inviteLink: string | null) => void;
}

export default function CreateChannelModal({ isOpen, onClose, onCreated }: CreateChannelModalProps) {
  const { t } = useTranslation();
  const schema = useMemo(() => getSchema(t), [t]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [createdChannel, setCreatedChannel] = useState<{ id: string; title: string; inviteLink: string | null } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [validationFocused, setValidationFocused] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const firstErrorRef = useRef<HTMLParagraphElement | null>(null);
  const apiErrorRef = useRef<HTMLParagraphElement | null>(null);
  const { register, handleSubmit, watch, reset, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", title_icon: "", description: "", is_public: true, username: "" },
  });
  const titleValue = watch("title") ?? "";
  const descriptionValue = watch("description") ?? "";
  const isPublicRaw = watch("is_public");
  const channelClosed = isPublicRaw === false;

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

  useEffect(() => {
    return () => { if (avatarPreview) URL.revokeObjectURL(avatarPreview); };
  }, [avatarPreview]);

  useEffect(() => {
    if (isOpen) {
      reset({ title: "", title_icon: "", description: "", is_public: true, username: "" });
      setError("");
      setAvatarFile(null);
      setCreatedChannel(null);
      setShowImportModal(false);
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview(null);
    }
  }, [isOpen, reset]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, loading, onClose]);

  const onSubmit = async (data: FormData) => {
    setError("");
    setValidationFocused(false);
    setLoading(true);
    try {
      const username = data.username.trim().replace(/^@+/, "");
      const payload = {
        title: data.title.trim(),
        title_icon: data.title_icon || "",
        description: (data.description ?? "").trim(),
        is_public: Boolean(data.is_public),
        username,
      };
      const { data: channel } = await channelsApi.create(payload);
      if (avatarFile) {
        await channelsApi.uploadAvatar(channel.id, avatarFile);
      }
      setCreatedChannel({
        id: channel.id,
        title: channel.title,
        inviteLink: channel.invite_link ?? null,
      });
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: unknown }; message?: string };
      const resData = err.response?.data;
      const status = err.response?.status;
      let msg = "";
      if (resData && typeof resData === "object") {
        const data = resData as Record<string, unknown>;
        if ("detail" in data) {
          const d = data.detail;
          msg = Array.isArray(d) ? (d[0] || "") : String(d ?? "");
        } else {
          // Field-level validation (e.g. username, title) or non_field_errors
          const nonField = data.non_field_errors;
          if (Array.isArray(nonField) && nonField.length > 0) {
            msg = nonField[0] ?? "";
          } else {
            const firstKey = ["username", "title", "description"].find((k) => Array.isArray(data[k]) && (data[k] as string[]).length > 0);
            if (firstKey) {
              const arr = data[firstKey] as string[];
              msg = arr[0] ?? "";
            }
          }
        }
      }
      if (status === 401) setError(t("createChat.sessionExpired"));
      else if (!err.response) setError(t("createChat.serverError"));
      else setError(msg || t("createChannel.genericError"));
      if (status === 400) {
        setValidationFocused(true);
        setTimeout(() => (apiErrorRef.current ?? firstErrorRef.current)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  if (createdChannel) {
    return (
      <>
        <ModalViewportLayer onBackdropClick={() => onClose()}>
          <div
            className="auth-glass-card ui-modal-surface w-full max-w-[min(30rem,94vw)] my-auto overflow-hidden rounded-[24px] sm:rounded-[28px] animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/70 px-5 pb-3 pt-5 sm:px-6 sm:pb-4 sm:pt-6">
              <h2 className="text-[1.2rem] font-semibold leading-tight tracking-[-0.02em] text-slate-950 sm:text-[1.35rem]">
                {t("createChannel.done")}
              </h2>
              <button
                type="button"
                onClick={() => { onCreated(createdChannel.id, createdChannel.inviteLink); onClose(); }}
                className="ui-field-shell rounded-2xl p-2 text-slate-500 transition-colors hover:text-slate-800"
                aria-label={t("common.close")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            <div className="space-y-3 px-5 pb-5 pt-3 sm:px-6">
              <p className="text-sm leading-6 text-slate-500">
                {t("createChannel.doneHint").replace("%s", createdChannel.title)}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShowImportModal(true)}
                  className="ui-field-shell rounded-2xl border border-slate-200/80 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-white"
                >
                  {t("channelImport.title")}
                </button>
                <button
                  type="button"
                  onClick={() => { onCreated(createdChannel.id, createdChannel.inviteLink); onClose(); }}
                  className="ui-accent-strong rounded-2xl px-5 py-2 text-sm font-medium text-white shadow-[0_10px_24px_rgba(37,99,235,0.24)] transition-colors"
                >
                  {t("createChannel.later")}
                </button>
              </div>
            </div>
          </div>
        </ModalViewportLayer>
        <ImportTelegramModal
          channelId={createdChannel.id}
          channelTitle={createdChannel.title}
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
        />
      </>
    );
  }

  return (
    <ModalViewportLayer onBackdropClick={loading ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="auth-glass-card ui-modal-surface max-h-[88vh] w-full max-w-[min(42rem,96vw)] my-auto overflow-hidden rounded-[28px] sm:rounded-[32px] animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/70 px-5 pb-4 pt-5 sm:px-6 sm:pb-5 sm:pt-6">
          <div className="min-w-0">
            <h2 className="text-[1.35rem] font-semibold leading-tight tracking-[-0.02em] text-slate-950 sm:text-2xl">
              {t("createChannel.title")}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
              {t("createChannel.afterCreateHint")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="ui-field-shell shrink-0 rounded-2xl p-2 text-slate-500 transition-colors hover:text-slate-800 disabled:opacity-50"
            aria-label={t("common.close")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        <form
          id="create-channel-form"
          onSubmit={handleSubmit(
            onSubmit,
            () => {
              setValidationFocused(true);
              setTimeout(() => firstErrorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
            }
          )}
          className="flex max-h-[88vh] flex-col"
        >
          <div className="space-y-4 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex items-start gap-4">
              <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={onAvatarChange} />
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
              <div className="flex-1 min-w-0">
                <label className="mb-1 block text-sm font-medium text-slate-700">{t("createChannel.channelName")}</label>
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
                  <EmojiPickerPopover
                    value={watch("title_icon") ?? ""}
                    onChange={(v) => setValue("title_icon", v)}
                    emptyLabel={t("createChat.noIcon")}
                  >
                    <button
                      type="button"
                      className={`ui-field-shell rounded-none border-0 border-l px-3 py-2.5 text-base leading-none text-slate-500 transition-colors hover:text-slate-800 ${
                        watch("title_icon") ? "bg-sky-50 text-sky-700" : ""
                      }`}
                      title={t("createChat.titleIcon")}
                    >
                      {watch("title_icon") || "−"}
                    </button>
                  </EmojiPickerPopover>
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
                <p
                  className={`mt-1 text-right text-xs ${
                    descriptionValue.length >= DESCRIPTION_MAX ? "font-medium text-rose-500" : "text-slate-400"
                  }`}
                >
                  {descriptionValue.length}/{DESCRIPTION_MAX}
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">{t("createChannel.username")}</label>
              <div className={`ui-field-shell flex items-center overflow-hidden rounded-2xl border transition-[border-color,box-shadow,background-color] focus-within:bg-white focus-within:ring-4 ${
                errors.username ? "border-rose-300 focus-within:ring-rose-100" : "focus-within:border-sky-300 focus-within:ring-sky-100"
              }`}>
                <span className="shrink-0 border-r px-4 py-3 text-sm font-semibold text-slate-600">@</span>
                <input
                  type="text"
                  maxLength={31}
                  placeholder="channelname"
                  className="min-w-0 flex-1 border-0 bg-transparent px-4 py-3 text-sm lowercase text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                  {...register("username")}
                />
              </div>
              <p className="mt-1 text-xs text-slate-500">{t("createChannel.usernameHint")}</p>
              {errors.username && <p className="mt-1 text-xs text-rose-500">{errors.username.message}</p>}
            </div>

            {validationFocused && (errors.title || errors.username) && (
              <p ref={firstErrorRef} className="text-sm font-medium text-rose-600" role="alert">
                {t("createChat.fixErrors")}
              </p>
            )}

            <div className="rounded-2xl border border-slate-200/70 bg-white/65 px-3 py-2.5 sm:px-4">
              <ClosedTypeSwitchRow
                closed={channelClosed}
                onClosedChange={(closed) => setValue("is_public", !closed, { shouldValidate: true })}
                tooltip={t("createChannel.typeHint")}
                disabled={loading}
              />
            </div>
            {errors.is_public && <p className="text-red-500 text-xs mt-0.5">{errors.is_public.message}</p>}

            {error && <p ref={apiErrorRef} className="text-sm text-rose-500" role="alert">{error}</p>}
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
              {loading ? t("createChannel.creating") : t("createChannel.create")}
            </button>
          </div>
        </form>
      </div>
    </ModalViewportLayer>
  );
}
