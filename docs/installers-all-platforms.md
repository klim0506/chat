# Установщики Pingy на все устройства

Сводка: как собрать и распространять приложение на каждой платформе.

**Windows + Android (команды, скрипты, GitHub Actions):** [build-windows-and-android.md](build-windows-and-android.md).

| Платформа | Что собираем | Где собирать | Артефакты / распространение |
|-----------|----------------|--------------|-----------------------------|
| **Web** | SPA (Vite) | Любая ОС | Деплой в `/var/www/frontend`, доступ по https://web.pingychat.com |
| **Android** | APK (или AAB) | Linux / Windows / macOS | `android/app/build/.../app-debug.apk` → подпись → Google Play или прямая раздача |
| **iOS** (iPhone/iPad) | .ipa | Только **macOS** (Xcode) | Tauri: `tauri ios build` → TestFlight / App Store. Альтернатива: Capacitor |
| **Desktop Windows** | .msi, .exe | Windows или CI (GitHub Actions) | Страница загрузок, прямая раздача |
| **Desktop macOS** | .dmg, .app | macOS или CI | Страница загрузок, App Store (опционально) |
| **Desktop Linux** | .deb, .AppImage, .rpm | Linux или CI | Страница загрузок |

---

## 1. Web

- **Сборка:** из корня репо: `cd frontend && npm run build`.
- **Деплой:** `./scripts/deploy-prod.sh` (сборка + rsync в `FRONTEND_DEST` + перезапуск бэкенда при необходимости).
- Пользователи заходят по ссылке, установщик не нужен.

---

## 2. Android

- **Текущий способ:** нативный WebView-проект в каталоге `android/`.
  - Требуется: JDK 17+, Android SDK (`ANDROID_HOME`).
  - Сборка: `cd android && ./gradlew assembleDebug` (или `assembleRelease` с подписью).
  - APK: `android/app/build/outputs/apk/debug/app-debug.apk` → копировать в `frontend/public/downloads/android/Pingy.apk`.
- **Альтернатива:** Tauri Android (один код с десктопом): в `frontend` выполнить `npx tauri android init`, затем `npx tauri android build`. Артефакты в `frontend/src-tauri/gen/android/`.

После обновления APK — пересобрать фронт и задеплоить, чтобы сайт отдавал новый файл.

---

## 3. iOS (мобильный macOS — iPhone/iPad)

Сборка возможна **только на macOS** (нужен Xcode). Есть два варианта.

### Вариант A: Tauri iOS (рекомендуется, один стек с десктопом)

1. **Один раз на Mac** инициализировать iOS-цель:
   ```bash
   cd frontend
   npm ci
   npx tauri ios init
   ```
   Появится Xcode-проект (каталог `src-tauri/gen/apple/` или аналог). Его нужно закоммитить в репо.

2. **Сборка на Mac:**
   ```bash
   npm run build
   npx tauri ios build -- --export-method app-store-connect
   ```
   IPA будет в `frontend/src-tauri/gen/apple/build/arm64/Pingy.ipa`.

3. **Публикация:** загрузить IPA в App Store Connect (через Xcode или `xcrun altool`). Дальше — TestFlight и/или App Store.

4. **В CI (GitHub Actions):** на `macos-latest` можно добавить job, который делает `npm ci`, `npm run build`, `npx tauri ios build`. Для загрузки в App Store в CI нужны сертификаты и профили (секреты).

### Вариант B: Capacitor iOS

Если Tauri iOS по какой-то причине не подходит:

1. В `frontend`: `npm install @capacitor/core @capacitor/cli @capacitor/ios`, `npx cap init`, `npx cap add ios`.
2. После каждой сборки фронта: `npm run build`, затем `npx cap sync ios`.
3. Открыть Xcode: `npx cap open ios`, собрать и подписать проект, загрузить в App Store Connect.

И в том, и в другом случае для публикации в App Store нужен **Apple Developer аккаунт** и настройка подписи (сертификаты, provisioning profiles).

---

## 4. Desktop (Windows, macOS, Linux)

- **Сборка:** в каталоге `frontend`: `npm run desktop:build` (или `npx tauri build`). На Linux получаются только Linux-артефакты; Windows — на Windows, macOS — на macOS.
- **CI:** workflow `.github/workflows/tauri-build.yml` при пуше в `release` или по тегу `v*` собирает все три ОС (см. [desktop-build-mac-windows.md](desktop-build-mac-windows.md)).
- Артефакты из CI или локальной сборки положить в `frontend/public/downloads/desktop/`, затем пересобрать фронт и задеплоить — ссылки на установщики появятся на странице «Скачать для ПК».

---

## 5. Краткий чеклист «всё сразу»

1. **Web:** `./scripts/deploy-prod.sh` (из корня репо).
2. **Android:** собрать APK в `android/`, скопировать в `frontend/public/downloads/android/Pingy.apk`.
3. **iOS:** на Mac выполнить `tauri ios init` (один раз), затем `tauri ios build`; загрузить IPA в App Store Connect.
4. **Desktop:** запустить workflow **Tauri build** в GitHub Actions (или собрать локально под каждую ОС) и разложить артефакты в `frontend/public/downloads/desktop/`.
5. Финально: из `frontend` снова `npm run build` и деплой фронта, чтобы сайт отдавал актуальные установщики.

При необходимости можно добавить в CI отдельный job для iOS (на `macos-latest`) и автоматическую загрузку в TestFlight по тегам.

---

**Перед размещением везде (сертификаты, подпись, «одна кнопка»):** [production-release-guide.md](production-release-guide.md)
