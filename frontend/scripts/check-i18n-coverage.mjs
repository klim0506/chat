import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const srcDir = path.join(root, "src");
const i18nFile = path.join(srcDir, "lib", "i18n.ts");
const allowlistFile = path.join(root, "i18n-hardcoded-allowlist.json");
const updateAllowlist = process.argv.includes("--update-allowlist");

const attrPattern = /\b(placeholder|title|aria-label)\s*=\s*"([^"]+)"/g;
const jsxTextPattern = />([^<{][^<{]*[A-Za-zА-Яа-я][^<{]*)</g;
const ignoredDirs = new Set(["node_modules", "dist", "tests", "test-results", "playwright-report"]);
const ignoredFiles = new Set([
  "src/lib/i18n.ts",
  "src/workers/image-compression.worker.ts",
  "src/lib/image-compression.ts",
]);

function normalizeRel(p) {
  return path.relative(root, p).replaceAll("\\", "/");
}

function looksUserFacing(value) {
  const s = value.trim();
  if (s.length < 2) return false;
  if (/^[0-9\s:.,\-+_]+$/.test(s)) return false;
  if (/^(https?:|\/|#|[A-Za-z0-9_-]+$)/.test(s) && s.length < 12) return false;
  return /[A-Za-zА-Яа-я]/.test(s);
}

async function collectFiles(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!ignoredDirs.has(e.name)) await collectFiles(full, out);
      continue;
    }
    if (e.isFile() && full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

async function checkDict() {
  const text = await fs.readFile(i18nFile, "utf8");
  const keyRegex = /([a-zA-Z0-9_]+)\s*:\s*\{\s*en:\s*"([^"]*)"\s*,\s*ru:\s*"([^"]*)"\s*\}/g;
  const keys = [];
  const problems = [];
  let m;
  while ((m = keyRegex.exec(text)) !== null) {
    const [, key, en, ru] = m;
    keys.push(key);
    if (!en.trim() || !ru.trim()) problems.push(`DICT key "${key}" must contain non-empty en/ru values`);
  }
  if (keys.length === 0) problems.push("No i18n DICT keys found");
  return problems;
}

async function scanHardcodedStrings() {
  const files = await collectFiles(srcDir);
  const findings = [];
  for (const file of files) {
    const rel = normalizeRel(file);
    if (ignoredFiles.has(rel)) continue;
    const text = await fs.readFile(file, "utf8");

    let m;
    while ((m = attrPattern.exec(text)) !== null) {
      const value = m[2];
      if (!looksUserFacing(value)) continue;
      findings.push(`${rel}::attr::${value.trim()}`);
    }
    while ((m = jsxTextPattern.exec(text)) !== null) {
      const value = m[1].replace(/\s+/g, " ").trim();
      if (!looksUserFacing(value)) continue;
      findings.push(`${rel}::text::${value}`);
    }
  }
  return [...new Set(findings)].sort();
}

async function loadAllowlist() {
  try {
    const raw = await fs.readFile(allowlistFile, "utf8");
    const json = JSON.parse(raw);
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}

async function saveAllowlist(items) {
  await fs.writeFile(allowlistFile, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

async function main() {
  const dictProblems = await checkDict();
  const findings = await scanHardcodedStrings();

  if (updateAllowlist) {
    await saveAllowlist(findings);
    console.log(`i18n allowlist updated: ${findings.length} entries`);
    return;
  }

  const allowlist = new Set(await loadAllowlist());
  const unknown = findings.filter((x) => !allowlist.has(x));

  if (dictProblems.length || unknown.length) {
    for (const p of dictProblems) console.error(`DICT: ${p}`);
    if (unknown.length) {
      console.error("New hardcoded UI strings found (not in allowlist):");
      for (const item of unknown.slice(0, 50)) console.error(`- ${item}`);
      if (unknown.length > 50) console.error(`... and ${unknown.length - 50} more`);
      console.error('Run "npm run i18n:allowlist:update" after deliberate text additions.');
    }
    process.exit(1);
  }

  console.log(`i18n check passed: ${findings.length} known string entries`);
}

main().catch((err) => {
  console.error("i18n check failed", err);
  process.exit(1);
});

