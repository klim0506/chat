import { useState, useEffect } from "react";
import { chatsApi, type JoinChatPreview } from "../api/client";
import { getAvatarInitials } from "../lib/avatar-initials";
import { useTranslation, formatMembersCount } from "../lib/i18n";
import { MediaImage } from "./MediaImage";
import { ModalViewportLayer } from "./TopLayerPortal";

interface JoinChatPreviewModalProps {
  isOpen: boolean;
  slug: string;
  code: string;
  onClose: () => void;
  /** Вызывается при успешном вступлении в открытый чат */
  onJoined: (chatId: string) => void;
  /** Вызывается при отправке заявки в закрытый чат (для очистки URL и т.п.) */
  onRequestSent?: () => void;
}

export default function JoinChatPreviewModal({
  isOpen,
  slug,
  code,
  onClose,
  onJoined,
  onRequestSent,
}: JoinChatPreviewModalProps) {
  const { t, lang } = useTranslation();
  const [preview, setPreview] = useState<JoinChatPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinStatus, setJoinStatus] = useState<"idle" | "joined" | "pending" | "error">("idle");
  const [joinMessage, setJoinMessage] = useState("");

  useEffect(() => {
    if (!isOpen || !slug || !code) return;
    setPreview(null);
    setPreviewError("");
    setJoinStatus("idle");
    setJoinMessage("");
    setPreviewLoading(true);
    chatsApi
      .joinPreview(slug, code)
      .then((res) => {
        const data = res.data;
        if (data.already_member && data.chat_id) {
          onJoined(data.chat_id);
          onClose();
          return;
        }
        if ((data as { is_kicked?: boolean }).is_kicked) {
          setPreviewError(t("joinChat.kicked"));
          return;
        }
        setPreview(data);
      })
      .catch((e) => {
        const detail = (e?.response?.data?.detail as string) || t("joinChat.badLink");
        setPreviewError(detail);
      })
      .finally(() => setPreviewLoading(false));
  }, [isOpen, slug, code, onClose, onJoined]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !previewLoading && !joinLoading) onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, previewLoading, joinLoading, onClose]);

  const handleJoin = () => {
    if (!slug || !code || joinLoading) return;
    setJoinLoading(true);
    setJoinMessage("");
    chatsApi
      .join(slug, code)
      .then((res) => {
        const data = res.data;
        const detail = (res.data as { detail?: string }).detail;
        if (detail?.includes("Ожидайте подтверждения") || res.status === 202) {
          setJoinStatus("pending");
          setJoinMessage(t("joinChat.pendingApproval"));
          onRequestSent?.();
        } else {
          setJoinStatus("joined");
          setJoinMessage(t("joinChat.joined"));
          onJoined(data.id);
          onClose();
        }
      })
      .catch((e) => {
        setJoinStatus("error");
        setJoinMessage((e?.response?.data?.detail as string) || t("joinChat.joinError"));
      })
      .finally(() => setJoinLoading(false));
  };

  if (!isOpen) return null;

  return (
    <ModalViewportLayer onBackdropClick={previewLoading || joinLoading ? undefined : onClose}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full my-auto animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <h2 className="text-lg font-semibold text-slate-800">{t("joinChat.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={previewLoading || joinLoading}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50"
            aria-label={t("common.close")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        </div>

        <div className="px-6 pb-5 pt-2">
          {previewLoading ? (
            <div className="py-12 text-center">
              <p className="text-slate-500 text-sm">{t("common.loading")}</p>
            </div>
          ) : previewError ? (
            <div className="space-y-4">
              <p className="text-red-500 text-sm">{previewError}</p>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium"
              >
                {t("common.close")}
              </button>
            </div>
          ) : preview ? (
            <div className="space-y-4">
              <div className="flex gap-4 items-start">
                {preview.chat_type === "open" && (preview.avatar_url || preview.members_count !== undefined) ? (
                  preview.avatar_url ? (
                    <MediaImage source={preview.avatar_url} alt="" className="w-16 h-16 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-slate-200 flex items-center justify-center text-lg font-semibold text-slate-600 shrink-0">
                      {getAvatarInitials(preview.title)}
                    </div>
                  )
                ) : (
                  <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center shrink-0" title={t("createChat.closed")}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-slate-800 truncate">{preview.title}</h3>
                  {preview.chat_type === "open" && preview.members_count !== undefined && (
                    <p className="text-slate-500 text-sm mt-0.5">
                      {formatMembersCount(preview.members_count, lang)}
                    </p>
                  )}
                </div>
              </div>

              <div className="min-h-[3rem]">
                {preview.chat_type === "open" && preview.description !== undefined ? (
                  <p className="text-slate-600 text-sm whitespace-pre-wrap">{preview.description || "—"}</p>
                ) : (
                  <p className="text-slate-400 text-sm italic">{t("joinChat.infoOnlyForMembers")}</p>
                )}
              </div>

              {joinStatus === "pending" && (
                <p className="text-green-600 text-sm">{joinMessage}</p>
              )}
              {joinStatus === "error" && (
                <p className="text-red-500 text-sm">{joinMessage}</p>
              )}

              {preview.is_pending ? (
                <p className="text-amber-600 text-sm">{t("joinChat.alreadyPending")}</p>
              ) : joinStatus !== "pending" ? (
                <div className="flex gap-2 justify-end pt-1">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={joinLoading}
                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleJoin}
                    disabled={joinLoading}
                    className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium transition-colors"
                  >
                    {joinLoading ? t("messenger.joining") : t("messenger.join")}
                  </button>
                </div>
              ) : (
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium"
                  >
                    {t("common.close")}
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </ModalViewportLayer>
  );
}
