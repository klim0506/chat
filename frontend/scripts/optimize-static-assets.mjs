import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const projectRoot = path.resolve(process.cwd(), "..");
const frontendRoot = process.cwd();
const cacheFile = path.join(frontendRoot, ".asset-opt-cache.json");

const targets = [
  { dir: projectRoot, recursive: false },
  { dir: path.join(frontendRoot, "public"), recursive: true },
  { dir: path.join(frontendRoot, "src", "assets"), recursive: true },
];

const imageExt = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const minSavingsRatio = 0.98; // overwrite only when new file is at least 2% smaller

async function exists(dirPath) {
  try {
    await fs.access(dirPath);
    return true;
  } catch {
    return false;
  }
}

async function listImages(dirPath, recursive) {
  if (!(await exists(dirPath))) return [];
  const out = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (recursive) out.push(...(await listImages(fullPath, true)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (imageExt.has(path.extname(entry.name).toLowerCase())) out.push(fullPath);
  }
  return out;
}

async function loadCache() {
  try {
    return JSON.parse(await fs.readFile(cacheFile, "utf8"));
  } catch {
    return {};
  }
}

async function saveCache(cache) {
  await fs.writeFile(cacheFile, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function getFingerprint(stats) {
  return `${stats.size}:${Math.floor(stats.mtimeMs)}`;
}

async function optimizeFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const src = await fs.readFile(filePath);
  let pipeline = sharp(src, { failOn: "none" });
  if (ext === ".jpg" || ext === ".jpeg") {
    pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true, progressive: true });
  } else if (ext === ".png") {
    pipeline = pipeline.png({ compressionLevel: 9, palette: true, quality: 80, effort: 8 });
  } else if (ext === ".webp") {
    pipeline = pipeline.webp({ quality: 82, effort: 6 });
  } else {
    return { changed: false, from: src.length, to: src.length };
  }

  const next = await pipeline.toBuffer();
  if (next.length >= Math.floor(src.length * minSavingsRatio)) {
    return { changed: false, from: src.length, to: next.length };
  }
  await fs.writeFile(filePath, next);
  return { changed: true, from: src.length, to: next.length };
}

async function main() {
  const files = [];
  for (const target of targets) files.push(...(await listImages(target.dir, target.recursive)));
  const uniqueFiles = Array.from(new Set(files));
  const cache = await loadCache();

  let changed = 0;
  let checked = 0;
  let beforeBytes = 0;
  let afterBytes = 0;

  for (const filePath of uniqueFiles) {
    const rel = path.relative(projectRoot, filePath).replaceAll("\\", "/");
    const prevStats = await fs.stat(filePath);
    const prevFingerprint = getFingerprint(prevStats);
    if (cache[rel] === prevFingerprint) continue;

    checked += 1;
    const result = await optimizeFile(filePath);
    beforeBytes += result.from;
    afterBytes += result.changed ? result.to : result.from;
    if (result.changed) {
      changed += 1;
      console.log(`optimized ${rel}: ${result.from} -> ${result.to}`);
    }

    const nextStats = await fs.stat(filePath);
    cache[rel] = getFingerprint(nextStats);
  }

  await saveCache(cache);
  const saved = Math.max(0, beforeBytes - afterBytes);
  console.log(`asset optimization done: checked=${checked}, changed=${changed}, saved=${saved} bytes`);
}

main().catch((err) => {
  console.error("asset optimization failed", err);
  process.exit(1);
});

