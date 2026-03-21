# Pingy Android (WebView)

Одна Activity с WebView, загружает **https://web.pingychat.com** ([MainActivity.java](app/src/main/java/com/pingychat/app/MainActivity.java)).

## Требования

- **JDK 17+**
- **Android SDK:** `platform-tools`, `platforms;android-34`, `build-tools;34.0.0`
- **`ANDROID_HOME`** (или `ANDROID_SDK_ROOT`), либо **`local.properties`** — см. [local.properties.example](local.properties.example)

## Сборка

Из **корня репозитория** (рекомендуется):

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
npm run build:android
npm run downloads:copy:android
```

Windows (PowerShell):

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
npm run build:android:win
npm run downloads:copy:android:win
```

Или из каталога `android/`:

```bash
./gradlew assembleDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk` → для сайта: **`frontend/public/downloads/android/Pingy.apk`**.

Иконка лаунчера генерируется из **`frontend/public/favicon.ico`** (`npm run android:icons` в `frontend/`). Для `.ico` в PATH нужен **ImageMagick** (`convert` или `magick`).

Полный чеклист и CI: [docs/build-windows-and-android.md](../docs/build-windows-and-android.md).
