import { useState, useRef, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { channelsApi } from "../api/client";
import { useTranslation, type TranslationKey } from "../lib/i18n";
import { usePremiumModalStore } from "../store/premiumModal";
import { EmojiPickerPopover } from "./EmojiPickerPopover";
import ImportTelegramModal from "./ImportTelegramModal";

const TITLE_MAX = 50;
const DESCRIPTION_MAX = 300;

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
    defaultValues: { title: "", title_icon: "", description: "", is_public: "true" as unknown as boolean, username: "" },
  });
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

  useEffect(() => {
    return () => { if (avatarPreview) URL.revokeObjectURL(avatarPreview); };
  }, [avatarPreview]);

  useEffect(() => {
    if (isOpen) {
      reset({ title: "", title_icon: "", description: "", is_public: "true" as unknown as boolean, username: "" });
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
      else if (status === 403 && (msg.includes("подписк") || msg.includes("subscription"))) {
        usePremiumModalStore.getState().openModal();
        setError(t("createChat.needsSubscription"));
      }
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
        <div
          className="ui-overlay fixed inset-0 z-[150] flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => onClose()}
        >
          <div
            className="ui-modal-surface max-w-md w-full my-auto rounded-2xl animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 pt-5 pb-2">
              <h2 className="text-lg font-semibold text-slate-800">{t("createChannel.done")}</h2>
              <button
                type="button"
                onClick={() => { onCreated(createdChannel.id, createdChannel.inviteLink); onClose(); }}
                className="ui-icon-button rounded-lg p-1.5 transition-colors"
                aria-label={t("common.close")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            <div className="px-6 pb-5 pt-3 space-y-4">
              <p className="text-sm text-slate-600">{t("createChannel.doneHint").replace("%s", createdChannel.title)}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowImportModal(true)}
                  className="ui-picker-tile rounded-lg px-4 py-2 text-sm font-medium text-slate-700 transition-colors"
                >
                  {t("channelImport.title")}
                </button>
                <button
                  type="button"
                  onClick={() => { onCreated(createdChannel.id, createdChannel.inviteLink); onClose(); }}
                  className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors"
                >
                  {t("createChannel.later")}
                </button>
              </div>
            </div>
          </div>
        </div>
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
    <div
      role="dialog"
      aria-modal="true"
      className="ui-overlay fixed inset-0 z-[150] flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => { if (!loading && e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="ui-modal-surface max-w-md w-full my-auto rounded-2xl animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{t("createChannel.title")}</h2>
            <p className="text-slate-500 text-xs mt-0.5">{t("createChannel.afterCreateHint")}</p>
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
          className="px-6 pb-5 pt-3 space-y-4"
        >
          <div className="flex gap-4 items-start">
            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={onAvatarChange} />
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
            <div className="flex-1 min-w-0 flex flex-col">
              <label className="block text-sm font-medium text-slate-700 mb-1">{t("createChannel.channelName")}</label>
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  className={`flex-1 min-w-0 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${errors.title ? "border-red-500 focus:ring-red-500 focus:border-red-500" : "border-slate-300 focus:ring-blue-400 focus:border-blue-400"}`}
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
                    className={`ui-picker-tile h-10 w-10 rounded-lg flex items-center justify-center text-xl shrink-0 ${
                      watch("title_icon") ? "ui-picker-tile-active" : ""
                    }`}
                    title={t("createChat.titleIcon")}
                  >
                    {watch("title_icon") || "−"}
                  </button>
                </EmojiPickerPopover>
              </div>
              {titleValue.length >= 30 && <p className={`text-xs mt-0.5 ${titleValue.length >= TITLE_MAX ? "text-red-500 font-medium" : "text-slate-500"}`}>{titleValue.length}/{TITLE_MAX}</p>}
              {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title.message}</p>}
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
            <label className="block text-sm font-medium text-slate-700 mb-1">{t("createChannel.username")}</label>
            <div
              className={`flex items-center border rounded-lg overflow-hidden focus-within:ring-2 ${errors.username ? "border-red-500 focus-within:ring-red-500 focus-within:border-red-500" : "border-slate-300 focus-within:ring-blue-400 focus-within:border-blue-400"}`}
            >
              <span className="px-3 py-2 text-slate-500 bg-slate-50 border-r border-slate-200 text-lg font-medium select-none">@</span>
              <input
                type="text"
                maxLength={31}
                placeholder="channelname"
                className="flex-1 min-w-0 border-0 rounded-none px-3 py-2 text-sm focus:outline-none focus:ring-0 lowercase bg-transparent placeholder:text-slate-400"
                {...register("username")}
              />
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{t("createChannel.usernameHint")}</p>
            {errors.username && <p className="text-red-500 text-xs mt-1">{errors.username.message}</p>}
          </div>

          {validationFocused && (errors.title || errors.username || errors.is_public) && (
            <p ref={firstErrorRef} className="text-red-600 text-sm font-medium" role="alert">
              {t("createChat.fixErrors")}
            </p>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">{t("createChat.chatType")}</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" value="true" className="accent-blue-600" {...register("is_public", { setValueAs: (v) => v === "true" })} /> {t("createChat.open")}
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" value="false" className="accent-blue-600" {...register("is_public", { setValueAs: (v) => v === "true" })} /> {t("createChat.closed")}
              </label>
            </div>
            {errors.is_public && <p className="text-red-500 text-xs mt-1">{errors.is_public.message}</p>}
            <p className="text-xs text-slate-400 mt-1">{t("createChannel.typeHint")}</p>
          </div>

          {error && <p ref={apiErrorRef} className="text-red-500 text-sm" role="alert">{error}</p>}

          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={onClose} disabled={loading} className="ui-picker-tile rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition-colors disabled:opacity-50">{t("common.cancel")}</button>
            <button type="submit" disabled={loading} className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium transition-colors">
              {loading ? t("createChannel.creating") : t("createChannel.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
