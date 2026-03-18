# Продовый релиз на все платформы — полный гайд

Документ для использования **перед размещением** приложения везде (Web, Android, iOS, Desktop). Сертификаты, подпись, «одна кнопка» сборки.

---

## 1. Что нужно для продовых версий по платформам

### Web
- **Ничего дополнительно.** Уже проде: деплой через `./scripts/deploy-prod.sh`. Пользователи заходят на сайт.

### Linux (desktop)
- **Ничего.** Собрали .deb / .AppImage / .rpm — раздаём. Подпись не обязательна.

### Windows (desktop)
- **Сертификат подписи кода (Code Signing).** Покупается у CA (Sectigo, DigiCert, SSL.com и т.п., ориентир от ~$200/год).
- Без сертификата: при первом запуске Windows покажет «Неизвестный издатель»; пользователь может нажать «Всё равно запустить».
- С сертификатом: установщик и exe без предупреждений.

### macOS (desktop)
- **Apple Developer Program** (~$99/год). Один аккаунт подходит и для macOS, и для iOS.
- Нужны: сертификат разработчика, подпись приложения, **нотаризация** (отправка бинарника в Apple).
- Без этого: Gatekeeper блокирует запуск («ненадёжный разработчик»), пользователь может обойти через ПКМ → «Открыть».
- С подписью и нотаризацией: приложение открывается без предупреждений.

### Android
- **Keystore** для подписи (создаётся один раз, хранится у вас, не терять).
- Для раздачи APK с сайта — достаточно подписанного APK.
- Для **Google Play** — тот же ключ (или отдельный upload key), плюс регистрация в Play Console.

### iOS
- **Apple Developer** (тот же аккаунт, что для macOS).
- Сертификаты, provisioning profiles, App Store Connect. Без этого в App Store не опубликовать; для TestFlight тоже нужны профили и подпись.

---

## 2. «Всё в 1 клик» — как устроить

Идея: **один запуск workflow в GitHub Actions** делает все сборки и, где настроено, подписывает и выкладывает артефакты.

### 2.1. Секреты репозитория (Settings → Secrets and variables → Actions)

Заранее завести и не светить в коде:

| Секрет | Для чего | Когда нужен |
|--------|----------|-------------|
| `WINDOWS_CERT_BASE64` | Сертификат подписи .pfx в base64 | Подпись Windows-установщиков |
| `WINDOWS_CERT_PASSWORD` | Пароль от .pfx | То же |
| `APPLE_CERTIFICATE` | Сертификат разработчика Apple (P12) в base64 | Подпись macOS/iOS |
| `APPLE_CERTIFICATE_PASSWORD` | Пароль от P12 | То же |
| `APPLE_PROVISIONING_PROFILE` | Provisioning profile (macOS/iOS) в base64 | Сборка под распространение |
| `APPLE_SIGNING_IDENTITY` | Имя identity, напр. "Developer ID Application: ..." | Подпись macOS |
| `APPLE_APP_STORE_CONNECT_API_KEY_ID` | API Key ID из App Store Connect | Загрузка в TestFlight/App Store |
| `APPLE_APP_STORE_CONNECT_ISSUER_ID` | Issuer ID | То же |
| `APPLE_APP_STORE_CONNECT_API_KEY_BASE64` | Приватный ключ API в base64 | То же |
| `ANDROID_KEYSTORE_BASE64` | Keystore (.jks/.keystore) в base64 | Подпись APK/AAB |
| `ANDROID_KEYSTORE_PASSWORD` | Пароль keystore | То же |
| `ANDROID_KEY_ALIAS` | Алиас ключа | То же |
| `ANDROID_KEY_PASSWORD` | Пароль ключа | То же |

Не все секреты обязательны сразу: можно начать без Windows/Apple/Android и добавлять по мере выхода на платформы.

### 2.2. Один workflow на все сборки

- **Триггер:** тег версии (например `v1.0.4`) или ручной **Run workflow**.
- **Jobs:** матрица или отдельные job’ы:
  - Linux (desktop) — сборка .deb, .AppImage, .rpm;
  - Windows — сборка .msi / .exe, при наличии секретов — подпись;
  - macOS (desktop) — сборка .dmg/.app, при наличии секретов — подпись и нотаризация;
  - iOS (на macos-latest) — сборка .ipa, при наличии — загрузка в TestFlight;
  - Android (опционально) — сборка APK/AAB, при наличии keystore — подпись.
- **Итог:** артефакты по платформам в **Artifacts** или автоматическая публикация в **GitHub Release** (все установщики в одном релизе).

Тогда «продовый релиз» = поставить тег (или нажать Run) → дождаться прохода workflow → скачать из Release/Artifacts готовые файлы и при необходимости разложить их на сайт (например в `frontend/public/downloads/` и задеплоить фронт).

### 2.3. Где что править в проекте

- **Workflow:** `.github/workflows/tauri-build.yml` — добавить шаги подписи для Windows/macOS/Android, когда появятся соответствующие секреты.
- **Tauri (desktop):** подпись Windows — через переменные окружения/конфиг Tauri (см. доки Tauri «Signing»). macOS — подпись и нотаризация через `xcrun notarytool` / `xcrun stapler` после сборки.
- **Android:** в CI подставлять keystore из секрета, вызывать `jarsigner` или `apksigner` (или Gradle `signingConfig` с переменными из env).
- **iOS:** в job на macos-latest при наличии профилей и сертификатов — `tauri ios build` с нужным export method и при желании шаг загрузки в App Store Connect через `xcrun altool` или Fastlane.

---

## 3. Чеклист перед «размещением везде»

Распечатать или держать под рукой перед каждым большим релизом.

- [ ] **Web:** деплой проверен (`./scripts/deploy-prod.sh`), версия/конфиг прода актуальны.
- [ ] **Сертификаты и ключи:**
  - [ ] Windows: код-сигнинг сертификат получен, .pfx сохранён, секреты `WINDOWS_CERT_*` заполнены (если используем).
  - [ ] Apple: аккаунт Developer активен, сертификаты и профили созданы, секреты `APPLE_*` заполнены (для macOS и/или iOS).
  - [ ] Android: keystore создан, бэкап в безопасном месте, секреты `ANDROID_*` заполнены (если собираем в CI).
- [ ] **CI:** workflow по тегу `v*` (или ручной запуск) собирает все нужные платформы; шаги подписи включены и не падают при наличии секретов.
- [ ] **Версия:** в `frontend/package.json`, `frontend/src-tauri/tauri.conf.json`, при необходимости в `android/` версия обновлена и закоммичена перед тегом.
- [ ] **Артефакты:** после прогона скачаны из Artifacts/Release, проверены на своей машине (запуск, подпись).
- [ ] **Раздача:** установщики разложены на сайт (`frontend/public/downloads/...`), фронт задеплоен; при необходимости обновлены ссылки на странице загрузок.
- [ ] **Магазины (если используете):** Google Play / App Store — билды загружены, метаданные и скриншоты актуальны, отправлены на проверку.

---

## 4. Полезные ссылки (оставить актуальными)

- **Tauri, подпись:**  
  - [Signing (Windows)](https://v2.tauri.app/distribute/sign/windows/)  
  - [Signing (macOS)](https://v2.tauri.app/distribute/sign/macos/)  
  - [Signing (iOS)](https://v2.tauri.app/distribute/sign/ios/)
- **Apple:** [App Store Connect](https://appstoreconnect.apple.com/), [Developer](https://developer.apple.com/).
- **Android:** [Play Console](https://play.google.com/console/), при подписи — доки по `jarsigner`/`apksigner`.
- **Локальные инструкции в репо:**  
  - [installers-all-platforms.md](installers-all-platforms.md) — кто что собирает и куда класть.  
  - [desktop-build-mac-windows.md](desktop-build-mac-windows.md) — десктоп Win/Mac/Linux и CI.

---

## 5. Кратко: что где лежит

| Нужно | Где |
|-------|-----|
| Список платформ и артефактов | [installers-all-platforms.md](installers-all-platforms.md) |
| Сборка десктопа (Win/Mac/Linux) и CI | [desktop-build-mac-windows.md](desktop-build-mac-windows.md) |
| Workflow сборки (desktop + iOS) | `.github/workflows/tauri-build.yml` |
| Чеклист продового релиза и сертификаты | этот файл — **production-release-guide.md** |

Перед размещением везде достаточно открыть этот гайд и пройти чеклист из раздела 3.
