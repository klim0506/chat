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
            className="ui-modal-surface ui-create-modal max-w-md w-full my-auto rounded-xl animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-3 pb-2 ui-create-modal-divider border-b">
              <h2 className="text-base font-semibold ui-create-modal-title">{t("createChannel.done")}</h2>
              <button
                type="button"
                onClick={() => { onCreated(createdChannel.id, createdChannel.inviteLink); onClose(); }}
                className="ui-icon-button rounded-lg p-1.5 transition-colors"
                aria-label={t("common.close")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            <div className="px-5 pb-4 pt-2 space-y-3">
              <p className="text-sm ui-create-modal-hint leading-snug">{t("createChannel.doneHint").replace("%s", createdChannel.title)}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShowImportModal(true)}
                  className="ui-accent-soft border rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
                >
                  {t("channelImport.title")}
                </button>
                <button
                  type="button"
                  onClick={() => { onCreated(createdChannel.id, createdChannel.inviteLink); onClose(); }}
                  className="ui-accent-strong rounded-lg px-4 py-1.5 text-sm font-medium transition-colors"
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
        className="ui-modal-surface ui-create-modal max-h-[85vh] max-w-lg w-full my-auto rounded-xl animate-in fade-in zoom-in-95 duration-150 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-3 pb-2 border-b ui-create-modal-divider">
          <div>
            <h2 className="text-base font-semibold ui-create-modal-title">{t("createChannel.title")}</h2>
            <p className="ui-create-modal-subtitle text-xs mt-0.5 leading-snug">{t("createChannel.afterCreateHint")}</p>
          </div>
          <button type="button" onClick={onClose} disabled={loading} className="ui-icon-button rounded-lg p-1.5 transition-colors disabled:opacity-50" aria-label={t("common.close")}>
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
          className="flex max-h-[85vh] flex-col"
        >
          <div className="space-y-3 overflow-y-auto px-5 py-3">
            <div className="flex gap-3 items-start">
              <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={onAvatarChange} />
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
                <label className="block ui-create-modal-label mb-1">{t("createChannel.channelName")}</label>
                <div className={`ui-create-field-row ${errors.title ? "ui-create-field-row--error" : ""}`}>
                  <input
                    type="text"
                    className="ui-create-input"
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
                      className={`ui-create-attach-btn h-9 w-9 min-h-[2.25rem] p-0 text-base leading-none ${watch("title_icon") ? "ui-create-attach-btn--active" : ""}`}
                      title={t("createChat.titleIcon")}
                    >
                      {watch("title_icon") || "−"}
                    </button>
                  </EmojiPickerPopover>
                </div>
                {titleValue.length >= 30 && <p className={`text-xs mt-0.5 ${titleValue.length >= TITLE_MAX ? "text-red-500 font-medium" : "ui-create-modal-hint"}`}>{titleValue.length}/{TITLE_MAX}</p>}
                {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title.message}</p>}
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

            <div>
              <label className="block ui-create-modal-label mb-1">{t("createChannel.username")}</label>
              <div className={`ui-create-field-row items-center ${errors.username ? "ui-create-field-row--error" : ""}`}>
                <span className="ui-create-prefix">@</span>
                <input
                  type="text"
                  maxLength={31}
                  placeholder="channelname"
                  className="ui-create-input lowercase"
                  {...register("username")}
                />
              </div>
              <p className="text-xs ui-create-modal-hint mt-1">{t("createChannel.usernameHint")}</p>
              {errors.username && <p className="text-red-500 text-xs mt-1">{errors.username.message}</p>}
            </div>

            {validationFocused && (errors.title || errors.username) && (
              <p ref={firstErrorRef} className="text-red-600 text-sm font-medium" role="alert">
                {t("createChat.fixErrors")}
              </p>
            )}

            <ClosedTypeSwitchRow
              closed={channelClosed}
              onClosedChange={(closed) => setValue("is_public", !closed, { shouldValidate: true })}
              tooltip={t("createChannel.typeHint")}
              disabled={loading}
            />
            {errors.is_public && <p className="text-red-500 text-xs mt-0.5">{errors.is_public.message}</p>}

            {error && <p ref={apiErrorRef} className="text-red-500 text-sm" role="alert">{error}</p>}
          </div>

          <div className="flex gap-2 justify-end border-t ui-create-modal-divider px-5 py-2.5">
            <button type="button" onClick={onClose} disabled={loading} className="ui-accent-soft border rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50">{t("common.cancel")}</button>
            <button type="submit" disabled={loading} className="ui-accent-strong rounded-lg px-4 py-1.5 disabled:opacity-50 text-sm font-medium transition-colors">
              {loading ? t("createChannel.creating") : t("createChannel.create")}
            </button>
          </div>
        </form>
      </div>
    </ModalViewportLayer>
  );
}
