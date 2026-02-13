import { useState, useRef, useEffect, useCallback } from "react";

const CANVAS_SIZE = 320;
const EXPORT_SIZE = 256;

type Mode = "crop" | "draw" | "text";

interface CropRect {
  x: number;
  y: number;
  size: number;
}

interface TextItem {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
}

interface AvatarEditorModalProps {
  imageUrl: string | null;
  onSave: (blob: Blob) => void;
  onCancel: () => void;
}

export function AvatarEditorModal({ imageUrl, onSave, onCancel }: AvatarEditorModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<Mode>(imageUrl ? "crop" : "draw");
  const [baseDataUrl, setBaseDataUrl] = useState<string | null>(null);
  const [baseImage, setBaseImage] = useState<HTMLImageElement | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [crop, setCrop] = useState<CropRect>({ x: 40, y: 40, size: 240 });
  const [cropDrag, setCropDrag] = useState<{ active: boolean; startX: number; startY: number; startCrop: CropRect } | null>(null);
  const [strokes, setStrokes] = useState<{ path: number[][] }[]>([]);
  const [currentPath, setCurrentPath] = useState<number[] | null>(null);
  const [texts, setTexts] = useState<TextItem[]>([]);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [newTextValue, setNewTextValue] = useState("");
  const [brushSize, setBrushSize] = useState(8);
  const [brushColor, setBrushColor] = useState("#000000");
  const [textColor, setTextColor] = useState("#000000");
  const [textFontSize, setTextFontSize] = useState(24);
  const textIdRef = useRef(0);

  const getNextTextId = () => `t${++textIdRef.current}`;

  useEffect(() => {
    if (!baseDataUrl) {
      setBaseImage(null);
      return;
    }
    const img = new Image();
    img.onload = () => setBaseImage(img);
    img.onerror = () => setBaseImage(null);
    img.src = baseDataUrl;
  }, [baseDataUrl]);

  // Load image and set as base (or placeholder)
  useEffect(() => {
    if (!imageUrl) {
      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_SIZE;
      canvas.height = CANVAS_SIZE;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#f1f5f9";
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        setBaseDataUrl(canvas.toDataURL("image/png"));
      }
      setImageLoaded(true);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = CANVAS_SIZE;
      c.height = CANVAS_SIZE;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      try {
        setBaseDataUrl(c.toDataURL("image/png"));
      } catch {
        const fallback = document.createElement("canvas");
        fallback.width = CANVAS_SIZE;
        fallback.height = CANVAS_SIZE;
        const fctx = fallback.getContext("2d");
        if (fctx) {
          fctx.fillStyle = "#f1f5f9";
          fctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
          setBaseDataUrl(fallback.toDataURL("image/png"));
        } else {
          setBaseDataUrl(null);
        }
      }
      setImageLoaded(true);
    };
    img.onerror = () => {
      const fallback = document.createElement("canvas");
      fallback.width = CANVAS_SIZE;
      fallback.height = CANVAS_SIZE;
      const ctx = fallback.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#f1f5f9";
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        setBaseDataUrl(fallback.toDataURL("image/png"));
      }
      setImageLoaded(true);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  const drawToCanvas = useCallback(
    (ctx: CanvasRenderingContext2D, forExport = false) => {
      ctx.save();
      if (baseImage) {
        const drawCropOnExport = forExport && mode === "crop" && imageUrl && imageLoaded;
        if (drawCropOnExport) {
          const { x, y, size: s } = crop;
          ctx.drawImage(baseImage, x, y, s, s, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
        } else {
          ctx.drawImage(baseImage, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
        }
      } else {
        ctx.fillStyle = "#f1f5f9";
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      }

      if (mode === "crop" && imageLoaded && imageUrl && !forExport) {
        const { x, y, size: s } = crop;
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        ctx.rect(x, y, s, s);
        ctx.fill("evenodd");
        ctx.restore();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, s, s);
      }

      ctx.strokeStyle = brushColor;
      ctx.lineWidth = brushSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const s of strokes) {
        if (s.path.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(s.path[0][0], s.path[0][1]);
        for (let i = 1; i < s.path.length; i++) ctx.lineTo(s.path[i][0], s.path[i][1]);
        ctx.stroke();
      }
      if (currentPath && currentPath.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(currentPath[0], currentPath[1]);
        for (let i = 2; i < currentPath.length; i += 2) ctx.lineTo(currentPath[i], currentPath[i + 1]);
        ctx.stroke();
      }

      ctx.fillStyle = textColor;
      ctx.textBaseline = "top";
      for (const t of texts) {
        ctx.font = `${t.fontSize}px sans-serif`;
        ctx.fillText(t.text || "?", t.x, t.y);
      }

      ctx.restore();
    },
    [baseImage, baseDataUrl, mode, imageLoaded, imageUrl, crop, strokes, currentPath, texts, brushColor, brushSize, textColor]
  );

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    drawToCanvas(ctx, false);
  }, [drawToCanvas]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const getCanvasPoint = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const r = canvas.getBoundingClientRect();
    const scaleX = canvas.width / r.width;
    const scaleY = canvas.height / r.height;
    return [(e.clientX - r.left) * scaleX, (e.clientY - r.top) * scaleY];
  };

  const handleCropMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const [x, y] = getCanvasPoint(e);
    const { x: cx, y: cy, size: s } = crop;
    if (x >= cx && x <= cx + s && y >= cy && y <= cy + s) {
      setCropDrag({ active: true, startX: e.clientX, startY: e.clientY, startCrop: { ...crop } });
    }
  };

  const handleCropMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!cropDrag?.active) return;
    const dx = e.clientX - cropDrag.startX;
    const dy = e.clientY - cropDrag.startY;
    const { startCrop } = cropDrag;
    setCrop({
      x: Math.max(0, Math.min(CANVAS_SIZE - startCrop.size, startCrop.x + dx)),
      y: Math.max(0, Math.min(CANVAS_SIZE - startCrop.size, startCrop.y + dy)),
      size: startCrop.size,
    });
  };

  const handleCropMouseUp = () => setCropDrag(null);

  const applyCrop = () => {
    if (!baseDataUrl) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      const { x, y, size } = crop;
      c.width = size;
      c.height = size;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, x, y, size, size, 0, 0, size, size);
      const scaled = document.createElement("canvas");
      scaled.width = CANVAS_SIZE;
      scaled.height = CANVAS_SIZE;
      const ctx2 = scaled.getContext("2d");
      if (!ctx2) return;
      ctx2.drawImage(c, 0, 0, size, size, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      setBaseDataUrl(scaled.toDataURL("image/png"));
      setMode("draw");
      setStrokes([]);
      setTexts([]);
    };
    img.src = baseDataUrl;
  };

  const handleDrawMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode !== "draw") return;
    const pt = getCanvasPoint(e);
    setCurrentPath([pt[0], pt[1]]);
  };

  const handleDrawMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode !== "draw" || !currentPath) return;
    const pt = getCanvasPoint(e);
    setCurrentPath((prev) => (prev ? [...prev, pt[0], pt[1]] : [pt[0], pt[1]]));
  };

  const fixStrokePath = (path: number[]): number[][] => {
    const out: number[][] = [];
    for (let i = 0; i < path.length - 1; i += 2) out.push([path[i], path[i + 1]]);
    return out;
  };

  const handleDrawMouseUp = () => {
    if (currentPath && currentPath.length >= 4) {
      setStrokes((prev) => [...prev, { path: fixStrokePath(currentPath) }]);
    }
    setCurrentPath(null);
  };

  const handleDrawMouseLeave = () => setCurrentPath(null);

  const handleCanvasClickText = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode !== "text") return;
    const [x, y] = getCanvasPoint(e);
    const id = getNextTextId();
    setTexts((prev) => [...prev, { id, text: "Текст", x, y, fontSize: textFontSize }]);
    setEditingTextId(id);
    setNewTextValue("Текст");
  };

  const updateText = (id: string, updates: Partial<TextItem>) => {
    setTexts((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  };

  const removeText = (id: string) => {
    setTexts((prev) => prev.filter((t) => t.id !== id));
    setEditingTextId(null);
  };

  const handleExport = () => {
    const canvas = document.createElement("canvas");
    canvas.width = EXPORT_SIZE;
    canvas.height = EXPORT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(EXPORT_SIZE / CANVAS_SIZE, EXPORT_SIZE / CANVAS_SIZE);
    drawToCanvas(ctx, true);
    canvas.toBlob(
      (blob) => {
        if (blob) onSave(blob);
      },
      "image/png",
      0.92
    );
  };

  const isCropActive = mode === "crop" && imageUrl && baseDataUrl;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="p-3 flex items-center justify-between border-b border-slate-200">
          <h3 className="font-semibold text-slate-800">Редактирование аватарки</h3>
          <button type="button" onClick={onCancel} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100" aria-label="Закрыть">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 flex justify-center bg-slate-100">
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            className="max-w-full h-auto rounded-xl border border-slate-200 bg-white touch-none"
            style={{ width: 320, height: 320, cursor: isCropActive ? "move" : mode === "draw" ? "crosshair" : "text" }}
            onMouseDown={isCropActive ? handleCropMouseDown : mode === "draw" ? handleDrawMouseDown : undefined}
            onMouseMove={isCropActive ? handleCropMouseMove : mode === "draw" ? handleDrawMouseMove : undefined}
            onMouseUp={isCropActive ? handleCropMouseUp : mode === "draw" ? handleDrawMouseUp : undefined}
            onMouseLeave={mode === "draw" ? handleDrawMouseLeave : undefined}
            onClick={mode === "text" ? handleCanvasClickText : undefined}
          />
        </div>

        <div className="p-4 border-t border-slate-200 space-y-4">
          {/* Режимы */}
          <div className="flex gap-2 flex-wrap">
            {imageUrl && (
              <>
                <button
                  type="button"
                  onClick={() => setMode("crop")}
                  className={`px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-2 ${mode === "crop" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 13V6a1 1 0 0 1 1-1h7" />
                    <path d="M8 6v13a1 1 0 0 0 1 1h10" />
                  </svg>
                  Обрезать
                </button>
                {imageLoaded && (
                  <button type="button" onClick={applyCrop} className="px-3 py-2 rounded-xl text-sm font-medium bg-green-100 text-green-800 hover:bg-green-200">
                    Применить обрезку
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              onClick={() => setMode("draw")}
              className={`px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-2 ${mode === "draw" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
              </svg>
              Рисовать
            </button>
            <button
              type="button"
              onClick={() => setMode("text")}
              className={`px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-2 ${mode === "text" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20h16" />
                <path d="M6 16V4" />
                <path d="M18 16V4" />
                <path d="M10 4v16" />
                <path d="M14 4v16" />
              </svg>
              Текст
            </button>
          </div>

          {mode === "draw" && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                Размер:
                <input type="range" min={2} max={24} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-24" />
                <span className="tabular-nums">{brushSize}</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                Цвет:
                <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} className="w-8 h-8 rounded border border-slate-300 cursor-pointer" />
              </label>
            </div>
          )}

          {mode === "text" && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                Цвет:
                <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="w-8 h-8 rounded border border-slate-300 cursor-pointer" />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                Размер:
                <select value={textFontSize} onChange={(e) => setTextFontSize(Number(e.target.value))} className="border border-slate-300 rounded-lg px-2 py-1 text-sm">
                  {[14, 18, 24, 32, 40].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              {editingTextId && (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <input
                    type="text"
                    value={newTextValue}
                    onChange={(e) => setNewTextValue(e.target.value)}
                    onBlur={() => {
                      updateText(editingTextId, { text: newTextValue });
                      setEditingTextId(null);
                    }}
                    className="flex-1 min-w-0 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                    autoFocus
                  />
                  <button type="button" onClick={() => removeText(editingTextId)} className="text-red-600 text-sm">
                    Удалить
                  </button>
                </div>
              )}
              <p className="text-xs text-slate-500 w-full">Клик по холсту — добавить надпись</p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={handleExport} className="flex-1 py-3 px-4 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700">
              Сохранить аватарку
            </button>
            <button type="button" onClick={onCancel} className="py-3 px-4 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50">
              Отмена
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
