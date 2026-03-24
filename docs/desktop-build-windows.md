# Сборка десктопа (Windows, Tauri)

## Что нужно на ПК

- **Node.js** (LTS) и **npm**
- **Rust**: установить [rustup](https://rustup.rs/), в PATH должен быть `cargo` (`%USERPROFILE%\.cargo\bin`)
- Для успешной сборки **Rust** на Windows: в «Параметры → Безопасность Windows → Управление приложениями и браузером» отключить **Smart App Control** (или режим оценки), иначе возможна ошибка **4551** при сборке зависимостей Cargo
- Желательно: исключения **Защитника** для папок:
  - `%LOCALAPPDATA%\PingyTauriTarget`
  - `%USERPROFILE%\.cargo`
  - корень репозитория и при необходимости `frontend\node_modules`

## Где лежит скрипт

Корень репозитория — каталог с `package.json` и папкой `scripts` (например `...\chat\chat`, не родитель `...\chat`).

## Команда

```powershell
cd E:\Projects\chat\chat
powershell -ExecutionPolicy Bypass -File .\scripts\build-desktop-windows.ps1
```

Скрипт выставляет `VITE_CLIENT_TYPE=desktop`, `VITE_APP_URL=https://web.pingychat.com`, кладёт Cargo `target` в `%LOCALAPPDATA%\PingyTauriTarget`, при сбое `npm ci` пробует `npm install`, затем `npx tauri build` и копирует установщик.

## Где артефакты

| Что | Путь |
|-----|------|
| NSIS-установщик | `frontend\src-tauri\target\release\bundle\nsis\` — при использовании `CARGO_TARGET_DIR` см. `%LOCALAPPDATA%\PingyTauriTarget\release\bundle\nsis\` |
| Копия для сайта | `frontend\public\downloads\desktop\Pingy-setup.exe` |
| MSI | `...\bundle\msi\` |

## Типичные проблемы

- **`The argument ... does not exist`** — вы не в `...\chat\chat`, а уровнем выше; сделайте `cd` в каталог с `scripts\build-desktop-windows.ps1`.
- **EPERM / EBUSY на `esbuild.exe`** — закройте Cursor/IDE, остановите `node` (`Get-Process node \| Stop-Process -Force`), удалите `frontend\node_modules\@esbuild`, снова `npm install` в `frontend`, повторите скрипт.
- **4551** — см. раздел про Smart App Control и исключения выше.

## Альтернатива без локальной сборки

GitHub Actions: workflow **«Tauri build (Desktop + iOS)»** → **Run workflow** → артефакт **desktop-windows**.
