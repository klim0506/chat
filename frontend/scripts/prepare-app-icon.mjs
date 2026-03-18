/**
 * Trims transparent padding from app-icon.ico and creates an elongated version for the header.
 * Usage: node scripts/prepare-app-icon.mjs
 */
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ico = require("sharp-ico");

const INPUT = path.resolve(__dirname, "../public/app-icon.ico");
const OUTPUT = path.resolve(__dirname, "../public/app-icon-header.png");

// Elongation: new height = trimmedHeight * ELONGATE_RATIO (more vertical stretch)
const ELONGATE_RATIO = 1.35;

async function main() {
  const sharps = await ico.sharpsFromIco(INPUT);
  if (!sharps.length) {
    throw new Error("No images in ICO file");
  }
  // Use the largest frame (first is often the biggest in ico)
  const img = sharps[0];

  const trimmed = img.trim({ threshold: 0 });
  const meta = await trimmed.metadata();
  const w = meta.width || 32;
  const h = meta.height || 32;
  const newHeight = Math.round(h * ELONGATE_RATIO);
  const newWidth = Math.round((w * newHeight) / h);

  await trimmed
    .resize({ height: newHeight })
    .png()
    .toFile(OUTPUT);

  console.log(`Written: public/app-icon-header.png (${newWidth}x${newHeight})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
