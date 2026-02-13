import { useState, useRef, useEffect, useCallback } from "react";

const VIEW_SIZE = 280;
const EXPORT_SIZE = 256;
const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;

interface AvatarCropConfirmModalProps {
  file: File;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}

export function AvatarCropConfirmModal({
  file,
  onConfirm,
  onCancel,
}: AvatarCropConfirmModalProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ startX: number; startY: number; startOffset: { x: number; y: number } } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const imageUrl = useRef<string>("");
  useEffect(() => {
    const url = URL.createObjectURL(file);
    imageUrl.current = url;
    const img = new Image();
    img.onload = () => {
      setImage(img);
    };
    img.onerror = () => setImage(null);
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const baseScale = image
    ? Math.max(VIEW_SIZE / image.naturalWidth, VIEW_SIZE / image.naturalHeight)
    : 1;
  const totalScale = baseScale * scale;

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, size: number, forExport: boolean) => {
      if (!image) return;
      const center = size / 2;
      const radius = size / 2;
      const ratio = size / VIEW_SIZE;
      ctx.save();
      ctx.beginPath();
      ctx.arc(center, center, radius, 0, 2 * Math.PI);
      ctx.clip();
      ctx.translate(center, center);
      ctx.translate(forExport ? offset.x * ratio : offset.x, forExport ? offset.y * ratio : offset.y);
      ctx.scale(forExport ? totalScale * ratio : totalScale, forExport ? totalScale * ratio : totalScale);
      ctx.drawImage(
        image,
        -image.naturalWidth / 2,
        -image.naturalHeight / 2,
        image.naturalWidth,
        image.naturalHeight
      );
      ctx.restore();
    },
    [image, scale, offset, totalScale]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, VIEW_SIZE, VIEW_SIZE);
    draw(ctx, VIEW_SIZE, false);
  }, [image, draw, scale, offset]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    setScale((s) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s + delta)));
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!image) return;
    setDrag({ startX: e.clientX, startY: e.clientY, startOffset: { ...offset } });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag) return;
    setOffset({
      x: drag.startOffset.x + (e.clientX - drag.startX),
      y: drag.startOffset.y + (e.clientY - drag.startY),
    });
  };

  const onMouseUp = () => setDrag(null);
  const onMouseLeave = () => setDrag(null);

  const handleConfirm = () => {
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = EXPORT_SIZE;
    canvas.height = EXPORT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    draw(ctx, EXPORT_SIZE, true);
    canvas.toBlob(
      (blob) => {
        if (blob) onConfirm(blob);
      },
      "image/png",
      0.92
    );
  };

  const [aiTooltipVisible, setAiTooltipVisible] = useState(false);

  if (!image) {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-slate-600">Загрузка фото…</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80" onClick={onCancel}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-sm w-full overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 flex items-center justify-between border-b border-slate-200">
          <h3 className="font-semibold text-slate-800">Подтверждение фото</h3>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
            aria-label="Закрыть"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 flex flex-col items-center gap-4">
          <p className="text-sm text-slate-600 text-center">
            Проверьте свою аватарку
          </p>
          <div
            className="rounded-full overflow-hidden border-2 border-slate-200 bg-slate-100 select-none"
            style={{ width: VIEW_SIZE, height: VIEW_SIZE }}
            onWheel={handleWheel}
          >
            {/* TODO: add touch drag + pinch zoom for mobile cropping. */}
            <canvas
              ref={canvasRef}
              width={VIEW_SIZE}
              height={VIEW_SIZE}
              className="block w-full h-full cursor-move touch-none"
              style={{ width: VIEW_SIZE, height: VIEW_SIZE }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseLeave}
            />
          </div>
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
              className="w-10 h-10 rounded-full border border-slate-200 text-slate-400 flex items-center justify-center shrink-0 cursor-not-allowed"
              aria-label="Редактировать с ИИ (скоро)"
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
            aria-label="Использовать фото"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
