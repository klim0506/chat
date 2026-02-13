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

let worker: Worker | null = null;
let requestId = 0;
const pending = new Map<number, { resolve: (file: File) => void; reject: (reason: unknown) => void }>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/image-compression.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<CompressResponse>) => {
    const data = event.data;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.ok) entry.resolve(data.file);
    else entry.reject(new Error(data.error));
  };
  worker.onerror = (event) => {
    pending.forEach(({ reject }) => reject(event.error || new Error(event.message)));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

const SKIP_COMPRESS_SIZE_BYTES = 300 * 1024;

async function compressOnMainThread(file: File, maxDim: number, quality: number): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/gif" || file.type === "image/svg+xml") return file;
  if (file.size < SKIP_COMPRESS_SIZE_BYTES) return file;

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(maxDim / bitmap.width, maxDim / bitmap.height, 1);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const hasAlpha = file.type === "image/png" || file.type === "image/webp";
  const ctx = canvas.getContext("2d", { alpha: hasAlpha });
  if (!ctx) return file;
  if (!hasAlpha) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", quality)
  );
  if (!blob || blob.size >= file.size * 0.98) return file;
  const fileName = file.name.replace(/\.[a-z0-9]+$/i, ".webp") || "image.webp";
  return new File([blob], fileName, { type: "image/webp", lastModified: file.lastModified });
}

export async function compressImageForUpload(
  file: File,
  options?: { maxDim?: number; quality?: number }
): Promise<File> {
  const maxDim = options?.maxDim ?? 1920;
  const quality = options?.quality ?? 0.82;
  if (typeof Worker === "undefined") return compressOnMainThread(file, maxDim, quality);
  try {
    const w = ensureWorker();
    const id = ++requestId;
    const payload: CompressRequest = { id, file, maxDim, quality };
    return await new Promise<File>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage(payload);
    });
  } catch {
    return compressOnMainThread(file, maxDim, quality);
  }
}

