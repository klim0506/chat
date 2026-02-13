type CompressRequest = {
  id: number;
  file: File;
  maxDim: number;
  quality: number;
};

type CompressSuccess = {
  id: number;
  ok: true;
  file: File;
};

type CompressFailure = {
  id: number;
  ok: false;
  error: string;
};

type CompressResponse = CompressSuccess | CompressFailure;

const SKIP_COMPRESS_SIZE_BYTES = 300 * 1024;

async function compressImage(file: File, maxDim: number, quality: number): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/gif" || file.type === "image/svg+xml") return file;
  if (file.size < SKIP_COMPRESS_SIZE_BYTES) return file;

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(maxDim / bitmap.width, maxDim / bitmap.height, 1);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const hasAlpha = file.type === "image/png" || file.type === "image/webp";
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: hasAlpha });
  if (!ctx) return file;
  if (!hasAlpha) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: "image/webp", quality });
  if (blob.size >= file.size * 0.98) return file;
  const fileName = file.name.replace(/\.[a-z0-9]+$/i, ".webp") || "image.webp";
  return new File([blob], fileName, { type: "image/webp", lastModified: file.lastModified });
}

self.onmessage = async (event: MessageEvent<CompressRequest>) => {
  const req = event.data;
  try {
    const file = await compressImage(req.file, req.maxDim, req.quality);
    const res: CompressResponse = { id: req.id, ok: true, file };
    self.postMessage(res);
  } catch (error) {
    const res: CompressResponse = { id: req.id, ok: false, error: String(error) };
    self.postMessage(res);
  }
};

