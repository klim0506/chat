# Desktop downloads (Tauri)

Артефакты desktop-сборки Tauri кладутся сюда. Сайт отдаёт их со страницы «Скачать для ПК».

**Сборка (Linux):**
```bash
npm run desktop:build
```

Результат в `src-tauri/target/release/bundle/`:
- **deb** — `deb/Pingy_*.deb`
- **AppImage** — `appimage/Pingy_*_amd64.AppImage`
- **rpm** — `rpm/Pingy-*.x86_64.rpm`

Скопировать в этот каталог вручную или скриптом.

**Windows (для сайта):** ссылка ведёт на `Pingy-setup.exe`. Положите сюда установщик из сборки (из `bundle/nsis/`, переименуйте в `Pingy-setup.exe`). Как собрать самому: [build-windows-exe.md](../../../docs/build-windows-exe.md). После загрузки файла пересоберите фронт и задеплойте.

**Windows и macOS (сборка):** только на соответствующей ОС или в CI. Подробно: [desktop-build-mac-windows.md](../../../docs/desktop-build-mac-windows.md).  
**Все платформы:** [installers-all-platforms.md](../../../docs/installers-all-platforms.md).

**Скрипты в package.json:** `desktop:build`, `tauri`, `desktop:dev`.
