import { useState, useEffect, useMemo, useRef, useCallback, type MutableRefObject } from "react";
import { useTranslation } from "../lib/i18n";
import SendIcon from "./icons/SendIcon";
import { ModalViewportLayer } from "./TopLayerPortal";

export interface FilePreviewItem {
  file: File;
  id: string;
}

interface FilePreviewModalProps {
  files: File[];
  onConfirm: (files: File[], caption: string) => void;
  onCancel: () => void;
  /** Ref to expose confirm handler so parent can trigger send on Enter when focus is in chat input. */
  confirmRef?: MutableRefObject<(() => void) | null>;
}

function isImage(file: File) {
  return file.type.startsWith("image/");
}

function isVideo(file: File) {
  return file.type.startsWith("video/");
}

function isMedia(file: File) {
  return isImage(file) || isVideo(file);
}

async function buildImagePreview(file: File): Promise<Blob | null> {
  try {
    const srcUrl = URL.createObjectURL(file);
    const img = document.createElement("img");
    const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = srcUrl;
    });
    URL.revokeObjectURL(srcUrl);
    const maxDim = 1200;
    const scale = Math.min(maxDim / loaded.naturalWidth, maxDim / loaded.naturalHeight, 1);
    const w = Math.max(1, Math.round(loaded.naturalWidth * scale));
    const h = Math.max(1, Math.round(loaded.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(loaded, 0, 0, w, h);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
  } catch {
    return null;
  }
}

export function FilePreviewModal({ files: initialFiles, onConfirm, onCancel, confirmRef }: FilePreviewModalProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<FilePreviewItem[]>(() =>
    initialFiles.map((f, i) => ({ file: f, id: `${f.name}-${f.size}-${i}-${Date.now()}` }))
  );
  const [caption, setCaption] = useState("");
  const itemsRef = useRef<FilePreviewItem[]>(items);
  const captionRef = useRef(caption);
  const captionInputRef = useRef<HTMLTextAreaElement>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  const mediaItems = items.filter((it) => isMedia(it.file));
  const docItems = items.filter((it) => !isMedia(it.file));
  const mediaIdsKey = useMemo(
    () => items.filter((it) => isMedia(it.file)).map((it) => it.id).join(","),
    [items]
  );

  useEffect(() => {
    let cancelled = false;
    const urls: Record<string, string> = {};
    (async () => {
      for (const it of mediaItems) {
        try {
          if (isImage(it.file)) {
            const previewBlob = await buildImagePreview(it.file);
            urls[it.id] = URL.createObjectURL(previewBlob ?? it.file);
          } else {
            urls[it.id] = URL.createObjectURL(it.file);
          }
        } catch { /* ignore */ }
      }
      if (cancelled) {
        Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
        return;
      }
      setPreviewUrls((prev) => {
        Object.values(prev).forEach((u) => URL.revokeObjectURL(u));
        return urls;
      });
    })();
    return () => {
      cancelled = true;
      Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    };
  }, [mediaIdsKey]);

  const remove = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    captionRef.current = caption;
  }, [caption]);

  const handleConfirm = useCallback(() => {
    if (itemsRef.current.length === 0) {
      onCancel();
      return;
    }
    onConfirm(itemsRef.current.map((it) => it.file), (captionRef.current || "").trim());
  }, [onConfirm, onCancel]);

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  useEffect(() => {
    if (confirmRef) {
      confirmRef.current = handleConfirm;
      return () => { confirmRef.current = null; };
    }
  }, [handleConfirm, confirmRef]);

  useEffect(() => {
    const shouldIgnoreTarget = (el: Element | null) => {
      if (!el) return false;
      const tag = (el as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT") return true;
      if ((el as HTMLElement).isContentEditable) return true;
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
        return;
      }
      if (e.key !== "Enter") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.tagName === "TEXTAREA" && active === captionInputRef.current) {
        if (!e.shiftKey) {
          e.preventDefault();
          handleConfirm();
        }
        return;
      }
      if (shouldIgnoreTarget(active)) return;
      if (!e.shiftKey) {
        e.preventDefault();
        handleConfirm();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleCancel, handleConfirm]);

  const getGridClass = (count: number) => {
    if (count <= 1) return "grid-cols-1";
    if (count === 2) return "grid-cols-2";
    if (count <= 4) return "grid-cols-2";
    return "grid-cols-3";
  };

  const getItemClass = (idx: number, count: number) => {
    if (count === 3 && idx === 0) return "col-span-2";
    return "";
  };

  return (
    <ModalViewportLayer onBackdropClick={handleCancel}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200">
          <h3 className="text-lg font-medium text-slate-800">Превью вложений</h3>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {mediaItems.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-2">Фото и видео</p>
              <div className={`grid gap-1.5 ${getGridClass(mediaItems.length)}`}>
                {mediaItems.map((it, idx) => (
                  <div
                    key={it.id}
                    className={`relative group rounded-lg overflow-hidden aspect-square bg-slate-100 ${getItemClass(idx, mediaItems.length)}`}
                  >
                    {isImage(it.file) ? (
                      <img
                        src={previewUrls[it.id] || "#"}
                        alt={it.file.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <video
                        src={previewUrls[it.id] || "#"}
                        className="w-full h-full object-cover"
                        muted
                        playsInline
                        preload="metadata"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => remove(it.id)}
                      className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/60 hover:bg-red-500 text-white flex items-center justify-center text-sm transition-colors"
                      title={t("common.delete")}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {docItems.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-2">Документы</p>
              <div className="space-y-1">
                {docItems.map((it) => (
                  <div
                    key={it.id}
                    className="flex items-center gap-3 py-2 px-3 rounded-lg bg-slate-50 border border-slate-200 group"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="text-slate-500 shrink-0"
                    >
                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span className="flex-1 min-w-0 truncate text-sm text-slate-800" title={it.file.name}>
                      {it.file.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(it.id)}
                      className="shrink-0 w-7 h-7 rounded-full bg-slate-200 hover:bg-red-500 hover:text-white text-slate-600 flex items-center justify-center text-sm transition-colors"
                      title={t("common.delete")}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {items.length === 0 && (
            <p className="text-sm text-slate-500 py-4">Все файлы удалены</p>
          )}

          {items.length > 0 && (
            <div>
              <label htmlFor="file-caption" className="block text-xs text-slate-500 mb-1.5">
                {t("chat.fileCaption")}
              </label>
              <textarea
                ref={captionInputRef}
                id="file-caption"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder={t("chat.fileCaptionPlaceholder")}
                rows={2}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg resize-none focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400 placeholder:text-slate-400"
              />
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={items.length === 0}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-sky-400 text-white rounded-xl hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <SendIcon size={18} />
            {t("common.send")}
          </button>
        </div>
      </div>
    </ModalViewportLayer>
  );
}
