# Сборка .exe для Windows (локально)

Краткая инструкция: собрать на своей Windows-машине и загрузить на сайт самому.

## Что нужно

- **Node.js** (LTS, например 20)
- **Rust:** установить [rustup](https://rustup.rs/) → в установщике выбрать default
- **Visual Studio Build Tools** (или полная Visual Studio) с компонентом **«Desktop development with C++»**  
  Скачать: https://visualstudio.microsoft.com/visual-cpp-build-tools/

## Шаги

1. Клонировать репозиторий (или взять уже обновлённый код).

2. В терминале (PowerShell или cmd):
   ```powershell
   cd frontend
   npm ci
   npx tauri build
   ```

3. Дождаться окончания сборки. Результат:
   - **Установщик .exe:** `frontend\src-tauri\target\release\bundle\nsis\Pingy_1.0.3_x64-setup.exe` (или похожее имя)
   - **Папка без установки (portable):** `frontend\src-tauri\target\release\bundle\win-unpacked\` — там лежит `Pingy.exe`

## Что загрузить на сайт

Сайт отдаёт ссылку на **Pingy-setup.exe** (установщик).

1. Взять готовый установщик из папки:  
   **`frontend\src-tauri\target\release\bundle\nsis\`** — файл вида `Pingy_1.0.3_x64-setup.exe`.
2. Переименовать или скопировать его в **Pingy-setup.exe**.
3. Положить в репозитории в каталог:  
   **`frontend/public/downloads/desktop/Pingy-setup.exe`**
4. Пересобрать фронт и задеплойть (или залить этот файл на сервер в тот же путь относительно статики).

Пример в PowerShell (из корня репо, после сборки):
```powershell
copy frontend\src-tauri\target\release\bundle\nsis\Pingy_*.exe frontend\public\downloads\desktop\Pingy-setup.exe
```
(имя exe может содержать версию — скопируйте один установщик и назовите копию `Pingy-setup.exe`.)

После этого задеплойте фронт — ссылка «Скачать для Windows» на сайте будет вести на этот файл.
