# Static assets

Папка `frontend/public/assets/`. Сюда кладут изображения, которые отдаются по URL `/assets/...`.

## Куда вставить логотип

| Файл | Путь | Где показывается |
|------|------|-------------------|
| **Логотип в шапке** | `frontend/public/assets/logo.png` | Landing, Auth, Dashboard, страницы загрузок, Wiki. Прозрачный PNG, любая высота (масштаб по высоте ~60px). |

Если `logo.png` нет — в шапке отображается текст «Pingy».

## Куда вставить фавикон (иконка вкладки)

| Вариант | Путь | Приоритет |
|---------|------|-----------|
| **Круглая иконка (SVG)** | `frontend/public/favicon.svg` | Подключается первой в `index.html` — во вкладке будет круглый фавикон. |
| **Классический .ico** | `frontend/public/assets/favicon.ico` или `frontend/public/favicon.ico` | Опционально; при наличии можно добавить `<link rel="icon" href="/favicon.ico">` в `index.html`. |
| **PWA-иконки (все размеры)** | Папка `frontend/public/icons/` | Не копировать вручную — генерируются скриптом (см. ниже). |

В `index.html` уже есть:
- `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` — если положить `favicon.svg` в `public/`, он будет использоваться.
- Запасной вариант: `/icons/icon-96x96.png` (генерируется скриптом).

## Остальные файлы

| File | Description |
|------|-------------|
| `default-chat-bg.jpg` | Фон чата по умолчанию (JPEG, макс. ширина 1080px). |

## Генерация PWA-иконок (иконки вкладки из одного PNG)

Иконки для вкладки и PWA создаются скриптом из одного исходного изображения:

1. Положите в `frontend/public/` один из файлов:
   - `pingy.png`, или
   - `assets/logo.png` (уже добавленный логотип).
2. В папке `frontend` выполните:
   ```bash
   npm run pwa:icons
   ```
3. В `frontend/public/icons/` появятся `icon-48x48.png` … `icon-512x512.png` и `maskable-512x512.png`. Они подхватываются `index.html` и `manifest.json`.
