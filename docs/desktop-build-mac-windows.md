# Сборка Pingy Desktop для macOS и Windows

Tauri собирает нативный бинарник только на той ОС, для которой собираешь: под **Windows** — на Windows, под **macOS** — на Mac. На Linux получаются только Linux-артефакты.

**Windows: один скрипт из корня репо** — `npm run build:windows-desktop` (см. [build-windows-and-android.md](build-windows-and-android.md)).

---

## Вариант 1: GitHub Actions (рекомендуется)

Сборка для всех платформ в одном репозитории без своих Mac/Windows-машин.

### Настройка

1. В корне репозитория создан workflow: **`.github/workflows/tauri-build.yml`**  
   При пуше в ветку `release` (или по тегу `v*`) он собирает:
   - **Linux** — `.deb`, `.AppImage`, `.rpm`
   - **Windows** — `.msi`, `.exe` (installer)
   - **macOS** — `.dmg`, `.app` (Intel и Apple Silicon)

2. Артефакты появятся в **Actions → выбранный run → Artifacts** (или в Release, если настроена публикация).

3. Скачайте нужные файлы и положите в `frontend/public/downloads/desktop/`, затем пересоберите и задеплойте фронт.

### Запуск вручную

- **Actions** → **Tauri build (Linux / Windows / macOS)** → **Run workflow** → выбрать ветку → **Run**.

---

## Вариант 2: Локально на своей машине

### Windows

**Требования:** Node.js, Rust (rustup), Visual Studio Build Tools с компонентом «Desktop development with C++» (или полная VS).

```powershell
cd frontend
npm ci
npx tauri build
```

Результат:

- `src-tauri\target\release\bundle\msi\` — установщик .msi  
- `src-tauri\target\release\bundle\nsis\` — установщик .exe  

Для страницы загрузок можно упаковать папку `src-tauri\target\release\bundle\win-unpacked\` в **Pingy-win64.zip** (распаковать и запустить .exe).

### macOS

**Требования:** Node.js, Rust (rustup), Xcode Command Line Tools (`xcode-select --install`).

```bash
cd frontend
npm ci
npx tauri build
```

Результат:

- **Apple Silicon (M1/M2/M3):** `src-tauri/target/release/bundle/dmg/Pingy_*.aarch64.dmg` и `.app`
- **Intel:** по умолчанию на M1 собирается под aarch64. Для x86_64:  
  `npx tauri build --target x86_64-apple-darwin`

Для распространения в App Store или без предупреждений Gatekeeper нужна подпись и нотаризация (Apple Developer аккаунт).

---

## Копирование артефактов на сайт

После сборки (локально или из CI) скопируйте нужные файлы в репозиторий:

```bash
# Пример (пути зависят от ОС)
cp "артефакт.dmg" frontend/public/downloads/desktop/
cp "Pingy-win64.zip" frontend/public/downloads/desktop/
```

Затем соберите фронт и задеплойте:

```bash
cd frontend && npm run build
# и ваш обычный деплой (например ./scripts/deploy-prod.sh)
```

Страница «Скачать для ПК» должна отдавать файлы из `downloads/desktop/` (ссылки на эти имена нужно добавить в разметку/конфиг, если ещё не добавлены).
