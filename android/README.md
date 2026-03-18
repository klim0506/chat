# Pingy Android (WebView)

Минимальное приложение: одна Activity с WebView, загружает https://web.pingychat.com.

## Сборка APK

Требуется: JDK 17+, Android SDK (platform-tools, platforms;android-34, build-tools;34.0.0).

```bash
export ANDROID_HOME=/opt/android-sdk   # или путь к вашему SDK
./gradlew assembleDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk`

Скопировать в фронт для страницы скачивания:

```bash
cp app/build/outputs/apk/debug/app-debug.apk ../frontend/public/downloads/android/Pingy.apk
```

Затем пересобрать фронт и задеплоить.
