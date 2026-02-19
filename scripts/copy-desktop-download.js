#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const desktopUnpacked = path.join(__dirname, "../desktop/dist/win-unpacked");
const desktopExe = path.join(desktopUnpacked, "Приватные чаты.exe");
const desktopDestDir = path.join(__dirname, "../frontend/public/downloads/desktop");
const desktopDest = path.join(desktopDestDir, "Pingy-Setup.exe");

const androidSrc = path.join(__dirname, "../android/app/build/outputs/apk/debug/app-debug.apk");
const androidDestDir = path.join(__dirname, "../frontend/public/downloads/android");
const androidDest = path.join(androidDestDir, "Pingy.apk");

let copied = 0;

if (fs.existsSync(desktopExe)) {
  fs.mkdirSync(desktopDestDir, { recursive: true });
  fs.copyFileSync(desktopExe, desktopDest);
  console.log("Desktop: copied exe to", desktopDest);
  copied++;
} else {
  console.log("Desktop: skip (win-unpacked not found, run: npm run desktop:build)");
}

if (fs.existsSync(androidSrc)) {
  fs.mkdirSync(androidDestDir, { recursive: true });
  fs.copyFileSync(androidSrc, androidDest);
  console.log("Android: copied to", androidDest);
  copied++;
} else {
  console.log("Android: skip (build first: npm run android:build)");
}

if (copied === 0) {
  process.exit(1);
}
