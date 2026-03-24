# Сборка Windows (десктоп) и Android — чеклист и команды

Единая точка входа: что установить, что запустить, куда попадают файлы для сайта.

## Ожидаемые артефакты для сайта

| Платформа | Файл на сайте | Источник после сборки |
|-----------|---------------|------------------------|
| **Windows** | `frontend/public/downloads/desktop/Pingy-setup.exe` | NSIS-установщик из Tauri (`bundle/nsis/*.exe`) |
| **Android** | `frontend/public/downloads/android/Pingy.apk` | `android/.../apk/debug/app-debug.apk` (переименовать копированием) |

Ссылки в приложении: [LandingPage.tsx](../frontend/src/pages/LandingPage.tsx), [DesktopDownloadPage.tsx](../frontend/src/pages/DesktopDownloadPage.tsx), [AndroidDownloadPage.tsx](../frontend/src/pages/AndroidDownloadPage.tsx).

После копирования артефактов выполните **`cd frontend && npm run build`** и задеплойте статику (например `./scripts/deploy-prod.sh`).

---

## Версии

Держите в одном значении:

- `frontend/package.json` → `version`
- `frontend/src-tauri/tauri.conf.json` → `version`
- `android/app/build.gradle` → `versionName` и `versionCode` (код: например `1.3.15` → `10315` = 1×10000 + 3×100 + 15)

---

## A. Windows — десктоп (Tauri)

### Что установить

- [Node.js 20 LTS](https://nodejs.org/)
- [Rust (rustup)](https://rustup.rs/), toolchain `stable`
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) с рабочей нагрузкой **«Разработка классических приложений на C++»** (MSVC, Windows SDK)

### Команды (один скрипт)

Из **корня репозитория** в PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-desktop-windows.ps1
```

Скрипт выполнит `npm ci`, `npx tauri build` в `frontend/` и скопирует первый найденный NSIS `.exe` в `frontend/public/downloads/desktop/Pingy-setup.exe`.

### Вручную

```powershell
cd frontend
npm ci
npx tauri build
# Установщик: frontend\src-tauri\target\release\bundle\nsis\Pingy_*_x64-setup.exe
# Скопируйте в frontend\public\downloads\desktop\Pingy-setup.exe
```

Подробнее: [build-windows-exe.md](build-windows-exe.md), [desktop-build-mac-windows.md](desktop-build-mac-windows.md).

### CI (GitHub Actions)

Workflow **«Tauri build (Desktop + iOS)»** (`.github/workflows/tauri-build.yml`): push в ветку `release` или тег `v*`, либо **Actions → Run workflow**. Артефакт **desktop-windows** содержит `.msi`, `.exe` и `Pingy-setup.exe`. Скачайте и при необходимости положите в `frontend/public/downloads/desktop/`.

---

## B. Android — APK (WebView)

Приложение открывает `https://web.pingychat.com` ([MainActivity.java](../android/app/src/main/java/com/pingychat/app/MainActivity.java)).

### Что установить

- **JDK 17** (Temurin / Oracle)
- **Android SDK** с компонентами: `platform-tools`, `platforms;android-34`, `build-tools;34.0.0`
- Переменная **`ANDROID_HOME`** (или `ANDROID_SDK_ROOT`) — путь к SDK
- Для пересборки иконки из **`favicon.ico`**: в `frontend/` выполнить `npm run android:icons` (через **sharp-ico**, ImageMagick не нужен)

Первый раз на машине: в `android/` скопируйте `local.properties.example` → `local.properties` и укажите `sdk.dir=...` (Gradle подхватит SDK даже без `ANDROID_HOME`, если указан `sdk.dir`).

### Команды — Linux / macOS

```bash
cd /path/to/chat
export ANDROID_HOME="$HOME/Android/Sdk"   # свой путь
bash scripts/build-android.sh
bash scripts/copy-android-apk-to-public.sh
```

### Команды — Windows (PowerShell)

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"   # типичный путь
powershell -ExecutionPolicy Bypass -File .\scripts\build-android.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\copy-android-apk-to-public.ps1
```

### Из корня через npm

```bash
npm run build:android
npm run downloads:copy:android
```

(На Windows для сборки APK используйте `npm run build:android:win` и `npm run downloads:copy:android:win`.)

### CI (GitHub Actions)

Workflow **«Android APK (debug)»** (`.github/workflows/android-build.yml`): артефакт **android-debug-apk** (`app-debug.apk`). Переименуйте в `Pingy.apk` и положите в `frontend/public/downloads/android/`, затем пересоберите фронт.

**Release / Play:** для продакшена нужны `assembleRelease`, подпись keystore и AAB — см. [installers-all-platforms.md](installers-all-platforms.md).

---

## Быстрый порядок перед релизом

1. Выровнять версии (package.json, tauri.conf.json, `app/build.gradle`).
2. **Windows:** `scripts/build-desktop-windows.ps1` на ПК с Windows **или** скачать артефакт из Tauri workflow.
3. **Android:** `scripts/build-android.sh` + `copy-android-apk-to-public.sh` **или** скачать артефакт из Android workflow.
4. `cd frontend && npm run build` → деплой.

Чеклист подписей и стора: [production-release-guide.md](production-release-guide.md).
