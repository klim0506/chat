#!/usr/bin/env bash
# Сборка debug APK. Нужны JDK 17+ и Android SDK; задайте ANDROID_HOME или ANDROID_SDK_ROOT.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/android"

if [[ -z "${ANDROID_HOME:-}" ]] && [[ -z "${ANDROID_SDK_ROOT:-}" ]]; then
  echo "Ошибка: не задан ANDROID_HOME (или ANDROID_SDK_ROOT)." >&2
  echo "Пример: export ANDROID_HOME=\$HOME/Android/Sdk" >&2
  exit 1
fi
export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"

chmod +x ./gradlew
./gradlew assembleDebug --no-daemon
echo ""
echo "Готово: android/app/build/outputs/apk/debug/app-debug.apk"
echo "Скопировать для сайта: bash scripts/copy-android-apk-to-public.sh"
