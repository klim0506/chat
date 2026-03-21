#!/usr/bin/env bash
# Копирует собранный APK в каталог статики фронта.
# Имя файла: Pingy_{version}.apk (версия из frontend/package.json, точки → подчёркивания), напр. Pingy_1_3_17.apk.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REL="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
DBG="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
if [[ -f "$REL" ]]; then
  SRC="$REL"
elif [[ -f "$DBG" ]]; then
  SRC="$DBG"
else
  echo "Нет ни $REL, ни $DBG" >&2
  echo "Сначала: cd android && ./gradlew assembleRelease или assembleDebug" >&2
  exit 1
fi
DST_DIR="$ROOT/frontend/public/downloads/android"
VER_UNDERSCORE="$(cd "$ROOT" && node -e "console.log(require('./frontend/package.json').version.split('.').join('_'))")"
DST="$DST_DIR/Pingy_${VER_UNDERSCORE}.apk"
mkdir -p "$DST_DIR"
cp -f "$SRC" "$DST"
echo "Скопировано: $DST"
echo "Далее: cd frontend && npm run build && деплой статики"
