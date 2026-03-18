#!/bin/bash
# После сборки Windows в CI: скачайте артефакт desktop-windows,
# возьмите установщик .exe и положите в frontend/public/downloads/desktop/Pingy-setup.exe
# Либо запустите этот скрипт, передав путь к .exe:
#   ./scripts/prepare-windows-download.sh /path/to/Pingy-setup.exe
set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$REPO_ROOT/frontend/public/downloads/desktop"
mkdir -p "$DEST"
if [ -n "$1" ] && [ -f "$1" ]; then
  cp "$1" "$DEST/Pingy-setup.exe"
  echo "Скопирован $1 -> $DEST/Pingy-setup.exe"
else
  echo "Использование: $0 /path/to/Pingy-setup.exe"
  echo "Или вручную: cp установщик.exe $DEST/Pingy-setup.exe"
fi
