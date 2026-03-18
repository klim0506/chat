/** Max dimension for avatar (width or height). */
const MAX_SIZE = 512;
/** JPEG quality for output. */
const QUALITY = 0.85;

/**
 * Resize and compress an image file before upload.
 * Preserves aspect ratio, outputs JPEG.
 * Returns original file if not an image or if compression fails.
 */
export async function compressAvatar(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.width;
      const h = img.height;
      if (w <= MAX_SIZE && h <= MAX_SIZE && file.type === "image/jpeg" && file.size < 200_000) {
        resolve(file);
        return;
      }

      let dw = w;
      let dh = h;
      if (w > MAX_SIZE || h > MAX_SIZE) {
        if (w >= h) {
          dw = MAX_SIZE;
          dh = Math.round((h * MAX_SIZE) / w);
        } else {
          dh = MAX_SIZE;
          dw = Math.round((w * MAX_SIZE) / h);
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = dw;
      canvas.height = dh;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, dw, dh);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const baseName = file.name.replace(/\.[^.]+$/, "");
          const compressed = new File([blob], `${baseName}.jpg`, {
            type: "image/jpeg",
            lastModified: Date.now(),
          });
          resolve(compressed);
        },
        "image/jpeg",
        QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };

    img.src = url;
  });
}
