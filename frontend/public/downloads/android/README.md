# Android APK (`Pingy_{version}.apk`)

Сюда кладётся файл вида **`Pingy_1_3_17.apk`** (версия = `frontend/package.json`, точки заменены на `_`) для страниц загрузок (лендинг, `/android`). Имя и URL в приложении берутся из `package.json` (`src/lib/host.ts`).

## Как получить файл

1. Соберите debug APK из корня репозитория:
   - Linux/macOS: `npm run build:android`
   - Windows: `npm run build:android:win`
2. Скопируйте в этот каталог:
   - Linux/macOS: `npm run downloads:copy:android`
   - Windows: `npm run downloads:copy:android:win`

Либо вручную скопируйте `app-debug.apk` с именем `Pingy_<версия_через_подчёркивания>.apk`.

3. Пересоберите фронт и задеплойте: `cd frontend && npm run build`.

Документация: [docs/build-windows-and-android.md](../../../docs/build-windows-and-android.md).
