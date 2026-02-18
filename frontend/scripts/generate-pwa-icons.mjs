/**
 * Generates PWA icons in multiple sizes from a source PNG.
 * Uses sharp (already a devDependency).
 *
 * Usage: node scripts/generate-pwa-icons.mjs
 */
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default to an existing 512x512 icon in the repo.
// If you have a better brand logo, point SOURCE to it.
const SOURCE = path.resolve(__dirname, "../public/icons/icon-512x512.png");
const OUT_DIR = path.resolve(__dirname, "../public/icons");

const sizes = [48, 72, 96, 128, 144, 152, 192, 384, 512];

async function generate() {
  for (const size of sizes) {
    await sharp(SOURCE)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(OUT_DIR, `icon-${size}x${size}.png`));
    console.log(`  icon-${size}x${size}.png`);
  }

  // Maskable icon (with padding for safe zone)
  await sharp(SOURCE)
    .resize(384, 384, { fit: "inside" })
    .extend({
      top: 64,
      bottom: 64,
      left: 64,
      right: 64,
      background: { r: 11, g: 18, b: 32, alpha: 1 },
    })
    .resize(512, 512)
    .png()
    .toFile(path.join(OUT_DIR, "maskable-512x512.png"));
  console.log("  maskable-512x512.png");

  console.log("Done!");
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
