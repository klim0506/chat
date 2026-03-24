/**
 * Generates Android launcher icons from favicon.ico (same as web app icon).
 * Creates mipmap resources for adaptive icon (API 26+) and legacy icons.
 *
 * Usage: npm run android:icons  (from frontend/)
 */
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { existsSync, mkdirSync, unlinkSync } from "fs";
import os from "node:os";

const require = createRequire(import.meta.url);
const ico = require("sharp-ico");

/**
 * Sharp не читает .ico напрямую; ImageMagick на Windows часто конфликтует с convert.exe.
 * Берём крупнейший кадр через sharp-ico (как в scripts/prepare-app-icon.mjs).
 */
async function rasterPathForSharp(sourcePath) {
  if (!sourcePath.toLowerCase().endsWith(".ico")) {
    return { path: sourcePath, cleanup: () => {} };
  }
  const sharps = await ico.sharpsFromIco(sourcePath);
  if (!sharps.length) {
    throw new Error("No images in ICO: " + sourcePath);
  }
  let best = sharps[0];
  let bestArea = 0;
  for (const s of sharps) {
    const m = await s.metadata();
    const area = (m.width || 0) * (m.height || 0);
    if (area > bestArea) {
      bestArea = area;
      best = s;
    }
  }
  const tmp = path.join(os.tmpdir(), `android-launcher-ico-${process.pid}.png`);
  await best.png().toFile(tmp);
  return {
    path: tmp,
    cleanup: () => {
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    },
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SOURCE = path.resolve(__dirname, "../public/favicon.ico");
const OUT_BASE = path.resolve(__dirname, "../../android/app/src/main/res");

// Mipmap densities: [folder, scale factor for 108dp foreground]
const FOREGROUND_SIZES = [
  ["mipmap-mdpi", 108],
  ["mipmap-hdpi", 162],
  ["mipmap-xhdpi", 216],
  ["mipmap-xxhdpi", 324],
  ["mipmap-xxxhdpi", 432],
];

// Full launcher icon sizes (48dp base)
const LAUNCHER_SIZES = [
  ["mipmap-mdpi", 48],
  ["mipmap-hdpi", 72],
  ["mipmap-xhdpi", 96],
  ["mipmap-xxhdpi", 144],
  ["mipmap-xxxhdpi", 192],
];

async function generate() {
  if (!existsSync(SOURCE)) {
    console.error("Source logo not found:", SOURCE);
    process.exit(1);
  }

  const { path: raster, cleanup } = await rasterPathForSharp(SOURCE);
  try {
  for (const [folder, px] of FOREGROUND_SIZES) {
    const dir = path.join(OUT_BASE, folder);
    mkdirSync(dir, { recursive: true });

    // Foreground: logo centered on transparent 108dp canvas, ~72% of canvas for safe zone
    const logoSize = Math.round(px * 0.72);
    const padding = Math.round((px - logoSize) / 2);

    await sharp(raster)
      .resize(logoSize, logoSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(path.join(dir, "ic_launcher_foreground.png"));
    console.log(`  ${folder}/ic_launcher_foreground.png`);
  }

  for (const [folder, px] of LAUNCHER_SIZES) {
    const dir = path.join(OUT_BASE, folder);
    mkdirSync(dir, { recursive: true });

    // Full icon: logo on solid background (for legacy API < 26)
    const logoSize = Math.round(px * 0.72);
    const padding = Math.round((px - logoSize) / 2);

    const logoBuf = await sharp(raster)
      .resize(logoSize, logoSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    // Solid white behind logo (legacy launcher + round icon)
    await sharp(logoBuf)
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toFile(path.join(dir, "ic_launcher.png"));
    console.log(`  ${folder}/ic_launcher.png`);

    await sharp(logoBuf)
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toFile(path.join(dir, "ic_launcher_round.png"));
    console.log(`  ${folder}/ic_launcher_round.png`);
  }

  console.log("Done! Android icons generated.");
  } finally {
    cleanup();
  }
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
