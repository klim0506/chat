/**
 * Generates PWA icons in multiple sizes from a source PNG.
 * Uses sharp (already a devDependency).
 *
 * Usage: node scripts/generate-pwa-icons.mjs
 */
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pingy app icon: prefer public/pingy.png, fallback to assets/logo.png.
const pingyPath = path.resolve(__dirname, "../public/pingy.png");
const logoPath = path.resolve(__dirname, "../public/assets/logo.png");
const SOURCE = existsSync(pingyPath) ? pingyPath : logoPath;
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
