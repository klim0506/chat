import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "../lib/i18n";
import { ModalViewportLayer } from "./TopLayerPortal";

const VIEW_SIZE = 280;
const EXPORT_SIZE = 256;
const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;

interface AvatarCropConfirmModalProps {
  file: File;
  onConfirm: (file: File) => void;
  onCancel: () => void;
}

type MediaSource =
  | { kind: "image"; image: HTMLImageElement }
  | { kind: "video"; video: HTMLVideoElement };

export function AvatarCropConfirmModal({
  file,
  onConfirm,
  onCancel,
}: AvatarCropConfirmModalProps) {
  const { t } = useTranslation();
  const [media, setMedia] = useState<MediaSource | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragStartRef = useRef<{ x: number; y: number; offset: { x: number; y: number } } | null>(null);
  const pinchStartRef = useRef<{ dist: number; scale: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  const objectUrlRef = useRef<string>("");
  useEffect(() => {
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    const isVideoFile = file.type.startsWith("video/");
    setIsVideo(isVideoFile);
    if (isVideoFile) {
      const video = document.createElement("video");
      video.src = url;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.onloadeddata = () => {
        setMedia({ kind: "video", video });
        video.play().catch(() => {});
      };
      video.onerror = () => setMedia(null);
    } else {
      const img = new Image();
      img.onload = () => setMedia({ kind: "image", image: img });
      img.onerror = () => setMedia(null);
      img.src = url;
    }
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const baseScale = media
    ? media.kind === "image"
      ? Math.max(VIEW_SIZE / media.image.naturalWidth, VIEW_SIZE / media.image.naturalHeight)
      : Math.max(VIEW_SIZE / media.video.videoWidth, VIEW_SIZE / media.video.videoHeight)
    : 1;
  const totalScale = baseScale * scale;

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, size: number, mediaSource: MediaSource) => {
      const center = size / 2;
      const radius = size / 2;
      const ratio = size / VIEW_SIZE;
      ctx.save();
      ctx.beginPath();
      ctx.arc(center, center, radius, 0, 2 * Math.PI);
      ctx.clip();
      ctx.translate(center, center);
      ctx.translate(offset.x * ratio, offset.y * ratio);
      ctx.scale(totalScale * ratio, totalScale * ratio);
      if (mediaSource.kind === "image") {
        const img = mediaSource.image;
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2, img.naturalWidth, img.naturalHeight);
      } else {
        const video = mediaSource.video;
        ctx.drawImage(video, -video.videoWidth / 2, -video.videoHeight / 2, video.videoWidth, video.videoHeight);
      }
      ctx.restore();
    },
    [offset.x, offset.y, totalScale]
  );

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !media) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, VIEW_SIZE, VIEW_SIZE);
    draw(ctx, VIEW_SIZE, media);
  }, [draw, media]);

  useEffect(() => {
    if (!media) return;
    if (media.kind === "video") {
      const tick = () => {
        redraw();
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => {
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      };
    }
    redraw();
  }, [media, redraw]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    setScale((s) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s + delta)));
  };

  const resetGestures = () => {
    dragStartRef.current = null;
    pinchStartRef.current = null;
    pointersRef.current.clear();
  };

  const pointerDistance = (points: { x: number; y: number }[]) => {
    if (points.length < 2) return 0;
    const [a, b] = points;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.hypot(dx, dy);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const points = Array.from(pointersRef.current.values());
    if (points.length === 1) {
      dragStartRef.current = { x: e.clientX, y: e.clientY, offset: { ...offset } };
    } else if (points.length === 2) {
      pinchStartRef.current = { dist: pointerDistance(points), scale };
      dragStartRef.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const points = Array.from(pointersRef.current.values());
    if (points.length >= 2 && pinchStartRef.current) {
      const currentDist = pointerDistance(points);
      if (pinchStartRef.current.dist > 0) {
        const ratio = currentDist / pinchStartRef.current.dist;
        setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchStartRef.current.scale * ratio)));
      }
      return;
    }
    if (points.length === 1 && dragStartRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setOffset({
        x: dragStartRef.current.offset.x + dx,
        y: dragStartRef.current.offset.y + dy,
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    const points = Array.from(pointersRef.current.values());
    if (points.length < 2) pinchStartRef.current = null;
    if (points.length === 1) {
      const p = points[0];
      dragStartRef.current = { x: p.x, y: p.y, offset: { ...offset } };
    }
    if (points.length === 0) dragStartRef.current = null;
  };

  const exportCroppedVideo = async (): Promise<File | null> => {
    if (!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream)) return null;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = EXPORT_SIZE;
    exportCanvas.height = EXPORT_SIZE;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return null;
    const stream = exportCanvas.captureStream(24);
    const candidates = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    const mimeType = candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 320_000,
    });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (evt) => {
      if (evt.data?.size) chunks.push(evt.data);
    };

    const source = document.createElement("video");
    source.src = objectUrlRef.current;
    source.muted = true;
    source.loop = false;
    source.playsInline = true;
    source.preload = "auto";
    await new Promise<void>((resolve, reject) => {
      source.onloadedmetadata = () => resolve();
      source.onerror = () => reject(new Error("video-load-failed"));
    });

    const duration = Number.isFinite(source.duration) && source.duration > 0
      ? Math.min(source.duration, 8)
      : 5;
    let stopped = false;
    const finish = () => {
      if (stopped) return;
      stopped = true;
      try { source.pause(); } catch { /* ignore */ }
      try { recorder.stop(); } catch { /* ignore */ }
    };

    recorder.start(120);
    source.currentTime = 0;
    await source.play();
    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (stopped) return;
        ctx.clearRect(0, 0, EXPORT_SIZE, EXPORT_SIZE);
        draw(ctx, EXPORT_SIZE, { kind: "video", video: source });
        if ((performance.now() - startedAt) / 1000 >= duration || source.ended) {
          finish();
          return;
        }
        requestAnimationFrame(tick);
      };
      recorder.onstop = () => resolve();
      requestAnimationFrame(tick);
      source.onended = finish;
    });

    const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
    if (!blob.size) return null;
    return new File([blob], "avatar.webm", { type: blob.type, lastModified: Date.now() });
  };

  const handleConfirm = async () => {
    if (!media) return;
    if (media.kind === "video") {
      const videoFile = await exportCroppedVideo();
      if (videoFile) {
        onConfirm(videoFile);
        return;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = EXPORT_SIZE;
    canvas.height = EXPORT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    draw(ctx, EXPORT_SIZE, media);
    canvas.toBlob((blob) => {
      if (!blob) return;
      onConfirm(new File([blob], "avatar.png", { type: "image/png", lastModified: Date.now() }));
    }, "image/png", 0.92);
  };

  const [aiTooltipVisible, setAiTooltipVisible] = useState(false);

  if (!media) {
    return (
      <ModalViewportLayer>
        <div className="ui-modal-surface rounded-2xl p-8 text-slate-600">Загрузка медиа…</div>
      </ModalViewportLayer>
    );
  }

  return (
    <ModalViewportLayer onBackdropClick={onCancel}>
      <div
        className="ui-modal-surface max-w-sm w-full overflow-hidden rounded-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 flex items-center justify-between border-b border-slate-200">
          <h3 className="font-semibold text-slate-800">Подтверждение фото</h3>
          <button
            type="button"
            onClick={onCancel}
            className="ui-icon-button rounded-lg p-1.5"
            aria-label={t("avatar.close")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 flex flex-col items-center gap-4">
          <p className="text-sm text-slate-600 text-center">
            Настройте область в кружке и масштаб
          </p>
          <div
            className="ui-avatar-slot rounded-full overflow-hidden border-2 select-none"
            style={{ width: VIEW_SIZE, height: VIEW_SIZE }}
            onWheel={handleWheel}
          >
            <canvas
              ref={canvasRef}
              width={VIEW_SIZE}
              height={VIEW_SIZE}
              className="block w-full h-full cursor-move touch-none"
              style={{ width: VIEW_SIZE, height: VIEW_SIZE }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={resetGestures}
              onPointerLeave={resetGestures}
            />
          </div>
          <div className="w-full max-w-[260px]">
            <label className="mb-1 block text-xs text-slate-500">Масштаб</label>
            <input
              type="range"
              min={MIN_SCALE}
              max={MAX_SCALE}
              step={0.01}
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              className="w-full"
            />
          </div>
          {isVideo && (
            <p className="text-[11px] text-slate-500 text-center">
              Видео будет экспортировано в сжатом виде для аватарки.
            </p>
          )}
        </div>

        <div className="p-4 border-t border-slate-200 flex items-center justify-end gap-2">
          <div
            className="relative"
            onMouseEnter={() => setAiTooltipVisible(true)}
            onMouseLeave={() => setAiTooltipVisible(false)}
          >
            <button
              type="button"
              disabled
              className="ui-icon-button flex h-10 w-10 items-center justify-center rounded-full shrink-0 cursor-not-allowed"
              aria-label={t("avatar.editWithAi")}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
              </svg>
            </button>
            {aiTooltipVisible && (
              <div className="absolute bottom-full right-0 mb-1 z-10 py-2 px-3 rounded-lg bg-slate-800 text-white text-xs shadow-lg max-w-[200px]">
                <div className="font-medium">Редактировать с ИИ</div>
                <div className="text-slate-300 mt-0.5">Улучшение и правка фото с помощью нейросети. Скоро.</div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleConfirm}
            className="w-10 h-10 rounded-full bg-blue-600 text-white hover:bg-blue-700 flex items-center justify-center shrink-0"
            aria-label={t("avatar.usePhoto")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </button>
        </div>
      </div>
    </ModalViewportLayer>
  );
}
