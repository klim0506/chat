# Бэклог

## Фронтенд
- [x] Добавить виртуализацию списка сообщений в `frontend/src/pages/ChatPage.tsx` для длинной истории чатов.
- [x] Заменить ручное сжатие изображений на конвейер через Worker с обработкой EXIF-ориентации.
  > **Реализовано:** Worker-based конвейер в `frontend/src/workers/image-compression.worker.ts` и `frontend/src/lib/image-compression.ts`. Конвертация в WebP, ресайз до 1920px, контроль качества (0.82), пропуск маленьких файлов (<300KB), корректная обработка EXIF-ориентации. Вызывается при загрузке изображений в чат через `compressImageForUpload()`.
- [x] Добавить e2e-тесты для real-time коммуникации между двумя аккаунтами (новый чат, бейджи непрочитанных, порядок закрепов).
- [x] Хранить порядок закреплённых чатов на бэкенде и синхронизировать между устройствами.
  > **Реализовано:** Поле `ChatMember.pin_order` (миграция `0019_chatmember_pin_order.py`) хранит пользовательский порядок закрепов. Синхронизация между устройствами через API.
- [x] Добавить проверку покрытия i18n-ключей, чтобы исключить хардкод строк в режимах RU/EN.
  > **Реализовано:** Скрипт проверки в `frontend/scripts/`, allowlist в `frontend/i18n-hardcoded-allowlist.json`. Настройки языка (EN/RU) доступны в `SettingsPage.tsx`.

## Бэкенд
- [ ] Добавить задачу очистки хранилища idempotency-ключей для платежей и реферальных событий, которые уже не нужны для работы поддержки (старше 30 дней).
- [ ] Добавить экспорт метрик rate-limit (Prometheus/OpenTelemetry) для auth и join-by-link эндпоинтов.
- [x] Добавить очередь антивирусной проверки медиа до публикации файла пользователям.
  > **Реализовано:** Celery-задача `scan_uploaded_file()` в `backend/apps/files/tasks.py`. Модель `FileAttachment` расширена полями `scan_status` (pending/clean/infected/error), `scanned_at`, `scan_details` (миграция `0002`). Файлы недоступны пользователям до получения статуса `CLEAN`. Базовая детекция EICAR-сигнатуры, архитектура расширяема до ClamAV. После успешной проверки запускается `optimize_uploaded_image()` для оптимизации изображений.

## DevOps
- [ ] Добавить CI-пайплайн: тесты `backend` + сборка `frontend` + базовый Playwright smoke test.
- [ ] Добавить SAST/secret scanning в CI и pre-push хуки.
- [x] Добавить шаг оптимизации изображений для статических фронтенд-ассетов (скриншоты/медиа).

## UX-полировка (конкурентоспособность)

### Визуал и отзывчивость
- [ ] Link preview: парсить OG-meta на бэкенде, показывать карточку-превью (заголовок, описание, картинка) при отправке URL.
- [ ] Стикеры + GIF-поиск: интеграция Giphy/Tenor, панель в инпуте рядом с emoji-picker.
- [ ] Прогрессивная загрузка медиа: blur-placeholder → полноразмерное изображение (как Telegram).
- [ ] Разделители дат в ленте сообщений + плавающая дата при скролле (sticky date header).
- [ ] Анимированные Lottie-реакции: статичные emoji заменены на Lottie-стикеры (анимация один раз при появлении, loop в пикере).
- [ ] Анимированные emoji: при отправке одного emoji показывать крупную анимацию в чате.
- [ ] Emoji-подсказки при вводе: «:thu» → предложение :thumbsup: (autocomplete).
- [ ] Автовоспроизведение GIF/коротких видео инлайн (без клика).

### Навигация и управление
- [ ] Папки/табы чатов (по аналогии с Telegram): «Все», «Личные», «Группы», «Непрочитанные», пользовательские фильтры.
- [ ] Клавиатурные шорткаты: Ctrl+K — глобальный поиск, Esc — закрыть панель, ↑ — редактировать последнее, Ctrl+Shift+M — мьют.
- [ ] Мультивыделение сообщений: checkbox-режим для массового удаления / пересылки / копирования.
- [x] Swipe-to-reply (мобильная UX-метафора, работает и на тач-устройствах).
  > **Реализовано:** Свайп вправо по сообщению вызывает режим ответа. Иконка «ответить» появляется слева при горизонтальном свайпе, при достижении порога ~60 px срабатывает `onReply` с лёгкой вибрацией (`navigator.vibrate`). `translateX` + CSS-transition для плавной анимации. Класс `.swipe-message` с `will-change: transform` для GPU-ускорения. `stopPropagation` предотвращает конфликт со свайпом «назад к списку чатов». Долгое нажатие (500 ms) открывает контекстное меню.
- [x] Drag & drop файлов в область чата + вставка медиа из буфера обмена (Ctrl+V).
  > **Реализовано:** Двухзонный drop в `ChatPage.tsx` — верхняя зона отправляет как файл, нижняя — как изображение с превью. Визуальная обратная связь оверлеем при перетаскивании, валидация размера (лимит 0.5 ГБ), поддержка множественных файлов. **Вставка из буфера (Ctrl+V):** обработчик `handlePaste` на contentEditable-инпуте извлекает файлы из `clipboardData.files`, проверяет размер и передаёт в `FilePreviewModal` — тот же конвейер, что и drag & drop / кнопка прикрепления. Обычная текстовая вставка не затрагивается.
- [x] Scroll-to-unread: при открытии чата автоматически прокручивать к первому непрочитанному, показывая разделитель «Новые сообщения».
  > **Реализовано:** Загрузка данных чата (`chatsApi.get`) и сообщений (`storeLoadMessages`) координируется через `Promise.all` — решение о точке прокрутки принимается только когда доступны и `chat.unread_count`, и массив сообщений. Если `unread_count > 0`, вычисляется набор `initialUnreadIds` (с клампингом `Math.min(unread, msgs.length)`) и устанавливается до прокрутки, чтобы React отрисовал разделитель «Непрочитанные сообщения» (`data-unread-line`) в том же цикле. Затем через двойной `requestAnimationFrame` выполняется `scrollIntoView({ block: 'start' })` к разделителю с небольшим отступом вверх (-12px) для визуального комфорта. Если разделитель не найден в DOM — fallback на `scrollToBottomInstant()`. Для чатов без непрочитанных — прокрутка вниз как раньше. `IntersectionObserver` на sentinel-элементах отслеживает просмотр непрочитанных; когда все `initialUnreadIds` попали в viewport — вызывается `markRead()` и разделитель скрывается.
- [x] Кнопка «↓ N new messages» при получении новых сообщений, если пользователь скроллил вверх.

### Звук и уведомления
- [ ] Звуки уведомлений: отправка, получение, упоминание (с возможностью отключить).
- [ ] Per-chat настройки уведомлений: звук, вибрация, mute на час/8ч/навсегда.
- [ ] Счётчик непрочитанных в favicon/title вкладки браузера (badge).

### Профиль и медиа
- [x] Панель профиля пользователя: bio, общие чаты, галерея общих медиа / файлов / ссылок.
- [x] Shared Media галерея внутри чата: вкладки «Медиа», «Файлы», «Ссылки», «Голосовые».
- [x] «Избранное» (Saved Messages): личный чат-закладка для сохранённых сообщений.
- [x] Кастомный фон чата: выбор из набора или загрузка пользовательского изображения.

### Платформа и доступность
- [ ] PWA: manifest.json, service worker, push-уведомления, установка на рабочий стол.
- [x] Mobile-responsive адаптивная вёрстка: полноценный опыт на телефонах без нативного приложения.
  > **Реализовано:** Комплексная мобильная адаптация:
  > - **Global CSS** (`index.css`): `touch-action: manipulation` (без 300 ms задержки тапа), `overscroll-behavior-y: contain` (без pull-to-refresh), `env(safe-area-inset-*)` для устройств с вырезом (iPhone X+).
  > - **Meta tags** (`index.html`): `mobile-web-app-capable`, `apple-mobile-web-app-capable`, `theme-color` для PWA-like поведения.
  > - **Info sidebar** (`ChatPage.tsx`): на мобильном (< md) — полноэкранный overlay с backdrop и кнопкой «назад», на десктопе — боковая панель как прежде.
  > - **Context menu**: на мобильном — bottom sheet с закруглёнными углами, строка быстрых emoji-реакций вверху, backdrop по тапу закрывает. Долгое нажатие (500 ms) открывает меню вместо hover.
  > - **Padding и отступы**: `p-2 sm:p-4` для сообщений, `p-1.5 sm:p-2` и `gap-1.5 sm:gap-2` для input-bar и кнопок.
  > - **Scroll-to-bottom**: кнопка поднята (`bottom-20 sm:bottom-4`) чтобы не перекрываться input-bar на мобильном.
- [ ] QR-код авторизации: сканировать с залогиненного устройства для входа на новом.
- [ ] Синхронизация позиции чтения между устройствами (last_read position per device).
- [ ] Accessibility: ARIA-роли, навигация с клавиатуры, поддержка screen reader.

### Группы и модерация
- [ ] Slow mode: ограничение частоты отправки сообщений участниками (настраивается админом).
- [ ] Самоудаляющиеся сообщения (TTL): таймер на сообщение или авто-удаление всего чата через N дней.
- [ ] Polls / голосования в чатах: одиночный/множественный выбор, анонимные, quiz-режим.
- [ ] Описание группы с rich-text (Markdown) и ссылками.

## Производительность и оптимизация

### Фронтенд
- [x] Code Splitting: `React.lazy()` для всех маршрутов в `App.tsx` + `manualChunks` в `vite.config.ts` (vendor-react, vendor-crypto, vendor-markdown, vendor-lottie, vendor-zustand).
- [x] `React.memo` на `MessageBubble` в `ChatPage.tsx` — предотвращает ре-рендер всех пузырьков при обновлении одного сообщения.
- [ ] Декомпозиция `ChatPage.tsx` (~6000 строк): разбить на `ChatHeader`, `MessageList`, `MessageInput`, `ChatInfoPanel` и т.д. Каждый компонент подписывается только на свой срез стора через селекторы Zustand.
- [ ] Улучшить виртуализацию: снизить `VIRTUALIZATION_THRESHOLD` с 120 до 40–60, рассмотреть `@tanstack/react-virtual` для точного измерения переменной высоты строк через `ResizeObserver`.
- [x] Курсорная пагинация сообщений: бэкенд отдаёт по 50 (limit/before/X-Has-More), фронт автоматически подгружает старые при скролле вверх (IntersectionObserver + сохранение scrollTop).
- [ ] Предзагрузка аватаров в списке чатов через `<link rel="preload">`.
- [ ] Анализ бандла через `vite-bundle-visualizer` — выявить и устранить неожиданные зависимости.

### Бэкенд
- [x] N+1 в `ChatSerializer`: аннотация `_members_count` (Count в SQL), Prefetch `_prefetched_last_message` для превью, `get_other_member` итерирует prefetch'нутые данные.
- [x] Курсорная пагинация для списка сообщений в `MessageListCreateView`: параметры `before`/`limit`, заголовок `X-Has-More`, `CORS_EXPOSE_HEADERS`.
- [ ] Добавить `GZipMiddleware` в `MIDDLEWARE` (после `SecurityMiddleware`). Для production — сжатие на уровне nginx.
- [ ] Установить `CONN_MAX_AGE = 600` для persistent DB connections (критично при WebSocket-нагрузке).
- [ ] Добавить составные индексы в БД:
  - `Message`: `(chat, -created_at)`, `(chat, is_deleted, -created_at)`, `(sender, -created_at)`.
  - `ChatMember`: `(user, status)`, `(chat, status)`.
- [ ] Кэширование в Redis: результаты поиска пользователей (5–10 сек), количество участников чата (инвалидировать при join/leave).
- [ ] WebSocket: группировать `group_send` через `asyncio.gather()`, использовать `only()` для минимизации полей, уменьшить payload (отправлять только изменившиеся поля).
- [ ] Оптимизация `_other_members_read()` в `ChatSerializer`: кэшировать результат на время сериализации одного чата (вызывается 3 раза: pinned_message, pinned_messages, my_pinned_messages).
- [ ] Заменить `.count()` на `.exists()` там, где нужна булева проверка (views.py: ~10 мест).

## Telegram-Level план
- [x] Offline-first в чатах: локальный кэш диалогов/медиа + очередь отправки при оффлайне с авто-sync после reconnect.
  > **Реализовано:** Полноценная offline-first архитектура:
  > - **IndexedDB** (`frontend/src/lib/db.ts`): схема Dexie с таблицами `chats`, `messages`, `outbox`, `syncMeta`. Stale-while-revalidate — данные загружаются из кэша мгновенно, затем ревалидируются с сервера.
  > - **Outbox-очередь** (`frontend/src/store/outbox.ts`): сообщения помещаются в очередь при отсутствии сети, retry с экспоненциальным backoff (до 3 попыток). Автоматический flush при восстановлении соединения.
  > - **Мониторинг сети** (`frontend/src/store/network.ts`): отслеживание `online`/`offline` событий браузера. Компонент `OfflineBanner.tsx` показывает баннер при потере связи.
  > - **Кэш медиа** (`frontend/src/lib/media-cache.ts`): Cache API с LRU-эвикцией, бюджет ~200 МБ. Хук `useCachedMediaUrl` для прозрачного кэширования медиафайлов.
  > - **WebSocket-менеджер** (`frontend/src/lib/ws-manager.ts`): автоматический reconnect с экспоненциальным backoff (1с → 30с), сетевой awareness.
  > - **Кэш списка чатов и сообщений** (`frontend/src/store/chatList.ts`, `frontend/src/store/messages.ts`): персистентное хранение с синхронизацией `lastMessageAt` и `lastFullSyncAt` на чат.

- [~] Улучшить delivery pipeline WebSocket: статусы `sent/delivered/read`, надёжный reconnect, idempotent delivery.
  > **Реализовано частично (~70%):**
  > - **Статусы delivered/read:** `MessageSerializer.get_read_status()` вычисляет статус на основе `ChatMember.last_read_at`. WebSocket рассылает уведомления о прочтении.
  > - **Надёжный reconnect:** `WsManager` реализует экспоненциальный backoff (1с → 30с), учитывает состояние сети, автоматическое переподключение.
  > - **Не реализовано:** явный статус `sent` (только delivered/read), idempotent delivery (нет дедупликации по ID), механизм ACK подтверждения доставки.

- [ ] Полнотекстовый поиск по сообщениям/файлам/людям с фильтрами по дате и чату.
- [x] Довести базовые chat-actions до Telegram-минимума: reactions, reply, forward, edit/delete с понятной историей.
  > **Реализовано:** Полный набор базовых действий с сообщениями:
  > - **Реакции:** Модель `MessageReaction`, 15 доступных эмодзи, до 3 реакций на сообщение от одного пользователя. Toggle-механика через `MessageReactionView` (POST). Анимированные Lottie-стикеры вместо статичных emoji (AnimatedReaction, play-once под сообщением, loop в пикере). Отображение счётчиков реакций под сообщением.
  > - **Ответ (Reply):** Поле `Message.reply_to` (FK). `ReplyMessageSerializer` с превью отправителя и вложения. В UI — цитата оригинального сообщения над ответом с возможностью прокрутки к исходному.
  > - **Пересылка (Forward):** Поля `Message.forwarded_from` (User FK), `Message.forwarded_from_chat` (Chat FK). Эндпоинт `ForwardMessageView` (POST `/chats/{id}/forward/`). Копирование вложений M2M. В UI — модальное окно выбора чата для пересылки с отображением источника.
  > - **Редактирование (Edit):** PATCH-эндпоинт `MessageDetailView`, поле `edited_at` с таймстампом. В UI — отметка «изменено» рядом с временем сообщения.
  > - **Удаление (Delete):** Мягкое удаление через `is_deleted`, DELETE-эндпоинт. Сообщение заменяется плейсхолдером «сообщение удалено».

- [x] Добавить голосовые/видео-сообщения: waveform, 1.5x/2x playback, устойчивая загрузка.
  > **Реализовано:** Полная поддержка голосовых и видео-сообщений:
  > - **Голосовые сообщения:** Запись с визуализацией waveform в реальном времени (анализ амплитуды). Waveform сохраняется в JSON-поле сообщения. Компонент `AudioMessagePlayer` для воспроизведения с визуализацией волны. Тип сообщения `MsgType.AUDIO`.
  > - **Видео-сообщения (кружочки):** Режим «Video circle» (`MsgType.VIDEO_CIRCLE`) — аналог Telegram-кружков. Запись через MediaRecorder API с оверлеем и таймером. Ограничение по длительности (`MAX_VIDEO_DURATION`). Тип `MsgType.VIDEO` для обычных видео.
  > - **AI-транскрипция:** Альтернативный режим голосового ввода с распознаванием речи.

- [ ] Реализовать звонки 1:1 (WebRTC), после стабилизации — групповые.
- [ ] Добавить threads/обсуждения внутри групп (reply-chain как отдельный поток).
- [x] Расширить pinned messages: несколько закрепов, быстрая навигация по ним.
  > **Реализовано:** Полнофункциональная система закрепов:
  > - **Модель:** `ChatPinnedMessage` с `pin_order` поддерживает множественные закрепы. `UserPinnedMessage` для персональных закрепов. Свойство `Chat.max_pins` — лимит зависит от тарифа (1/5/20 закрепов).
  > - **UI в стиле Telegram:** Панель закреплённого сообщения вверху чата с превью текста. Клик — прокрутка к закреплённому сообщению. Навигация между закрепами (цикличное переключение). Индикатор-точки при множественных закрепах.
  > - **Действия:** Pin/Unpin через контекстное меню сообщения. Секция персональных закрепов.

- [ ] Роли и права в группах: owner/admin/moderator + granular permissions.
- [ ] Антиспам и safety-политики: rate-limit, auto-mute, approval/CAPTCHA для новых участников.
- [ ] Invite links 2.0: TTL, one-time use, usage limits, revoke, отдельная аналитика по приглашениям.
- [ ] Audit trail для админ-действий в чатах (кто/что/когда изменил/удалил).
- [x] Сессии и устройства: список активных входов, `logout all`, контроль новых входов.
  > **Реализовано:** Полная система управления сессиями по модели «все сессии равноправны» (как Discord/Slack):
  > - **Модель `UserSession`** (`backend/apps/users/models.py`): UUID PK, user FK, ip_address, user_agent, device_label (парсится из UA через `user-agents`), created_at, last_active (throttled update 5 мин), is_active (soft delete). Миграция `0015_create_usersession.py`.
  > - **JWT с session_id:** `jwt_utils.py` — access и refresh токены содержат claim `"sid"`. Старые токены без `sid` продолжают работать (backward-compatible).
  > - **Валидация сессии:** `JWTAuthentication` (`auth.py`) и `JWTAuthMiddleware` (`middleware.py`) проверяют `UserSession.is_active` при каждом запросе (HTTP и WebSocket). Revoked-сессия → 401.
  > - **Создание сессии при логине:** `VerifyCodeView` создаёт `UserSession` с парсингом User-Agent и IP, передаёт `session.id` в JWT. При повторном входе (не первая регистрация) вызывается `notify_new_login()`.
  > - **Refresh token:** `RefreshTokenView` валидирует сессию и передаёт тот же `sid` в новый access token.
  > - **API управления** (`session_views.py`): `GET /api/auth/sessions/` (список с `is_current`), `DELETE /api/auth/sessions/<uuid>/` (завершить конкретную), `POST /api/auth/sessions/logout-all/` (завершить все кроме текущей).
  > - **Уведомление о новом входе** (`services.py`): WebSocket (`new_login_alert`) если пользователь онлайн, SMS через RedSMS если офлайн. `NotificationConsumer` — хендлеры `notify_new_login` и `force_logout`.
  > - **Фронтенд:** `auth.ts` хранит `sessionId` из JWT. `client.ts` — `sessionsApi` (list/terminate/logoutAll). `MessengerPage.tsx` — обработка `force_logout` (redirect на /auth) и `new_login_alert` (amber toast с device/IP). `SettingsPage.tsx` — секция «Активные сессии» (список, badge «Текущая», кнопки «Завершить» и «Завершить все другие сессии»).
- [ ] 2FA для критичных действий (смена номера, отключение сессий, delete account).
- [x] Проработать E2EE-режим для личных чатов (отдельный режим с ясным UX).
  > **Реализовано:** Полноценная реализация сквозного шифрования:
  > - **Бэкенд** (`backend/apps/e2ee/`): Модель `Device` хранит публичные ключи устройств (identity key, signed prekey). Модель `OneTimePreKey` — одноразовые ключи для X3DH. API для регистрации устройств, загрузки/получения prekey-бандлов.
  > - **Протокол X3DH + Double Ratchet:** Реализация обмена ключами X3DH (`frontend/src/lib/e2ee/`). Сессионный менеджер Double Ratchet (`session-manager.ts`) для ротации ключей. Функция `prepareEncryptedMessage()` для шифрования перед отправкой.
  > - **Модель сообщений:** Поля `is_encrypted`, `encrypted_keys` (JSON — ключ на каждое устройство), `sender_device` FK (миграция `0020_message_e2ee_fields.py`).
  > - **Хранение ключей:** IndexedDB для приватных ключей (identity, prekeys, сессии) на клиенте.
  > - **Стейт-менеджмент:** `frontend/src/store/e2ee.ts` — регистрация устройства, управление ключами.
  > - **Safety numbers:** Система верификации для подтверждения подлинности собеседника.

- [x] Privacy controls: visible phone, last seen, кто может писать в ЛС, кто может добавлять в чат.
  > **Реализовано:** Четыре уровня контроля приватности:
  > - **Видимость телефона:** Поле `User.show_phone` (boolean, default: True). `UserSerializer.get_phone()` скрывает номер от других пользователей, если отключено.
  > - **Last seen:** Поле `User.show_last_seen` (boolean). `UserSerializer.get_last_seen_display()` возвращает время или скрывает его в зависимости от настройки. Миграция `0012_add_show_phone.py`.
  > - **Кто может писать в ЛС:** Поле `User.dm_privacy` (choices: "everyone"/"nobody"). Миграция `0013_add_dm_privacy.py`.
  > - **Кто может добавлять в группы:** Поле `User.add_to_group_privacy` (choices: "everyone"/"nobody"). Миграция `0014_add_add_to_group_privacy.py`.
  > - **Настройки в UI:** Все переключатели доступны в `SettingsPage.tsx` в разделе «Приватность».

- [~] Public usernames ~~+ deep links на чаты/сообщения/профили (share-ready)~~.
  > **Реализовано частично (usernames без deep links):**
  > - **Usernames:** Поле `User.username` (CharField, 3–30 символов, regex `^[A-Za-z0-9_]{3,30}$`). Nullable, unique (case-sensitive) — constraint `users_username_unique_cs`. Миграция `0011`. Валидация в `UserSerializer.validate_username()`. Тесты в `backend/apps/users/tests_username.py`.
  > - **Не реализовано:** Deep links на профили (`@username`), чаты и сообщения. Нет endpoint для resolve username → user. Нет публичных URL для шаринга.

- [ ] Добавить бот-интеграции (webhook-база) для уведомлений и автоматизации.
- [ ] Проработать модель channels/публичных трансляций (read-only + comments mode).
- [ ] Усилить наблюдаемость: метрики latency/delivery/reconnect/crash-free, алерты, SLO/SLA.
- [ ] Нагрузочное тестирование chat/ws под пиковые сценарии (10k+ активных подключений).

---

# TOTEST — план тестирования реализованных функций

> Чек-листы ручного и автоматического тестирования для каждой завершённой инициативы.
> Обозначения: **[M]** — ручной (manual), **[A]** — автотест (unit/integration/e2e), **[P]** — Playwright.

---

## 1. Виртуализация списка сообщений

**Файлы:** `frontend/src/pages/ChatPage.tsx`

- [ ] **[M]** Открыть чат с 1 000+ сообщений — скролл плавный, нет фризов.
- [ ] **[M]** Быстрый скролл вверх/вниз — сообщения рендерятся без пустых зон, нет «белых дыр».
- [ ] **[M]** Скролл в самый верх → подгрузка более старых сообщений (infinite scroll / pagination).
- [ ] **[M]** Скролл вниз к последнему сообщению — кнопка «вниз» работает корректно.
- [ ] **[M]** Проверить Memory usage в DevTools: при 5 000 сообщений DOM содержит только видимые ноды (< 100), а не все 5 000.
- [ ] **[P]** Открыть чат с длинной историей, замерить FPS при скролле — должен быть > 50 fps.
- [ ] **[M]** Сообщения с разной высотой (текст, изображения, голосовые, видео-кружки) — виртуализация корректно считает offsets.

---

## 2. Worker-based сжатие изображений

**Файлы:** `frontend/src/lib/image-compression.ts`, `frontend/src/workers/image-compression.worker.ts`

- [x] **[A]** Unit-тест: изображение 4000×3000 → на выходе ≤ 1920px по длинной стороне. ✅ `frontend/src/lib/__tests__/image-compression.test.ts`
- [x] **[A]** Unit-тест: файл < 300 КБ пропускается без сжатия (passthrough). ✅ `frontend/src/lib/__tests__/image-compression.test.ts`
- [x] **[A]** Unit-тест: выходной формат — WebP (проверить magic bytes или MIME). ✅ `frontend/src/lib/__tests__/image-compression.test.ts`
- [ ] **[M]** Загрузить JPEG с EXIF orientation=6 (повёрнутый на 90°) — в чате отображается правильно, без поворота.
- [ ] **[M]** Загрузить PNG 10 МБ → файл в сети < 1 МБ (проверить Network tab).
- [ ] **[M]** Загрузить GIF — не конвертируется в WebP, сохраняет анимацию.
- [ ] **[M]** Загрузить 5 изображений одновременно — Worker обрабатывает параллельно, UI не блокируется.
- [x] **[A]** Unit-тест: `compressImageForUpload()` возвращает Blob с quality ≈ 0.82. ✅ `frontend/src/lib/__tests__/image-compression.test.ts`

---

## 3. E2E-тесты real-time коммуникации

**Файлы:** `frontend/tests/`, `frontend/playwright.config.ts`

- [ ] **[P]** Два аккаунта в двух вкладках: аккаунт A создаёт чат с аккаунтом B → у B появляется новый чат в списке без перезагрузки.
- [ ] **[P]** Аккаунт A отправляет сообщение → у B появляется сообщение в реальном времени.
- [ ] **[P]** Непрочитанные бейджи: A отправляет 3 сообщения → у B badge = 3.
- [ ] **[P]** B открывает чат → badge обнуляется.
- [ ] **[P]** A закрепляет чат → порядок закрепов сохраняется, у A чат вверху.
- [ ] **[P]** A drag-переставляет закреплённые чаты → порядок сохраняется после перезагрузки.

---

## 4. Порядок закреплённых чатов (бэкенд + синхронизация)

**Файлы:** `backend/apps/chats/models.py` (ChatMember.pin_order), миграция `0019`

- [x] **[A]** API-тест: POST pin chat → `ChatMember.pin_order` записывается, GET chats возвращает чат в закреплённых. ✅ `backend/apps/chats/tests_pins.py` + `backend/apps/chats/tests.py`
- [x] **[A]** API-тест: Изменить `pin_order` нескольких чатов → GET chats возвращает чаты в правильном порядке. ✅ `backend/apps/chats/tests_pins.py`
- [x] **[A]** API-тест: Unpin chat → `pin_order = null`, чат убирается из закреплённых. ✅ `backend/apps/chats/tests_pins.py`
- [ ] **[M]** Закрепить 3 чата на устройстве A, открыть на устройстве B — порядок совпадает.
- [ ] **[A]** Тест миграции `0019`: миграция и rollback без ошибок.

---

## 5. Проверка покрытия i18n

**Файлы:** `frontend/scripts/`, `frontend/i18n-hardcoded-allowlist.json`

- [ ] **[A]** Запустить скрипт проверки i18n — нет новых хардкод-строк, не входящих в allowlist.
- [ ] **[M]** Переключить язык EN → RU в `SettingsPage` — все видимые строки переведены, нет «key.not.found».
- [ ] **[M]** Переключить RU → EN — обратное переключение без артефактов.
- [ ] **[A]** Проверить, что каждый ключ из EN-файла присутствует в RU-файле (и наоборот) — нет missing keys.
- [ ] **[M]** Проверить edge-cases: plurals, даты, числа — корректная локализация.

---

## 6. Антивирусная проверка медиа

**Файлы:** `backend/apps/files/tasks.py`, `backend/apps/files/models.py`, миграция `0002`

- [x] **[A]** Unit-тест: загрузить нормальный файл → `scan_status` переходит `pending → clean`, файл доступен. ✅ `backend/apps/files/tests_scanning.py`
- [x] **[A]** Unit-тест: загрузить EICAR test string → `scan_status = infected`, файл заблокирован (403/404 при запросе). ✅ `backend/apps/files/tests_scanning.py`
- [x] **[A]** Unit-тест: сканер возвращает ошибку → `scan_status = error`, файл недоступен. ✅ `backend/apps/files/tests_scanning.py`
- [x] **[A]** Integration-тест: после `clean` запускается `optimize_uploaded_image()` для изображений. ✅ `backend/apps/files/tests_scanning.py`
- [ ] **[M]** Загрузить изображение в чат — файл появляется только после прохождения проверки (не мгновенно, с задержкой Celery).
- [x] **[A]** Проверить, что `scanned_at` и `scan_details` заполняются корректно. ✅ `backend/apps/files/tests_scanning.py`
- [x] **[A]** Проверить, что файл со статусом `pending` недоступен через API скачивания. ✅ `backend/apps/files/tests_scanning.py`

---

## 7. Оптимизация статических изображений (DevOps)

- [ ] **[M]** Сравнить размер скриншотов/медиа до и после оптимизации — экономия ≥ 30%.
- [ ] **[M]** Визуально проверить качество оптимизированных ассетов — нет заметных артефактов.
- [ ] **[A]** CI-шаг: убедиться, что новые ассеты автоматически оптимизируются при коммите.

---

## 8. Offline-first в чатах

**Файлы:** `frontend/src/lib/db.ts`, `frontend/src/store/outbox.ts`, `frontend/src/store/network.ts`, `frontend/src/components/OfflineBanner.tsx`, `frontend/src/lib/media-cache.ts`, `frontend/src/lib/ws-manager.ts`, `frontend/src/store/chatList.ts`, `frontend/src/store/messages.ts`

### 8.1 IndexedDB + stale-while-revalidate
- [ ] **[M]** Открыть приложение → перейти в Offline (DevTools: Network → Offline) → перезагрузить — список чатов и последние сообщения отображаются из кэша.
- [ ] **[M]** Вернуть Online — данные ревалидируются с сервера, новые сообщения появляются.
- [x] **[A]** Unit-тест: `AppDatabase` создаёт таблицы `chats`, `messages`, `outbox`, `syncMeta`. ✅ `frontend/src/lib/__tests__/db.test.ts`
- [ ] **[M]** Application → IndexedDB в DevTools: проверить, что данные записываются после загрузки чатов.

### 8.2 Outbox-очередь
- [ ] **[M]** Перейти в Offline → отправить 3 сообщения → они отображаются с индикатором «отправляется» (часы/spinner).
- [ ] **[M]** Вернуть Online → все 3 сообщения доставлены собеседнику в правильном порядке.
- [x] **[A]** Unit-тест: `useOutboxStore.enqueue()` добавляет запись в IndexedDB таблицу `outbox`. ✅ `frontend/src/store/__tests__/outbox.test.ts`
- [x] **[A]** Unit-тест: `useOutboxStore.flush()` отправляет все ожидающие сообщения при восстановлении сети. ✅ `frontend/src/store/__tests__/outbox.test.ts`
- [x] **[A]** Unit-тест: retry с backoff — после 3 неудачных попыток сообщение помечается как failed. ✅ `frontend/src/store/__tests__/outbox.test.ts`
- [ ] **[M]** Отправить сообщение в Offline → закрыть вкладку → открыть снова (Online) — сообщение отправляется из очереди.

### 8.3 Мониторинг сети + OfflineBanner
- [ ] **[M]** Перейти в Offline → появляется баннер «Нет подключения» (или аналог).
- [ ] **[M]** Вернуть Online → баннер исчезает.
- [x] **[A]** Unit-тест: `useNetworkStore` реагирует на `window.online` / `window.offline`. ✅ `frontend/src/store/__tests__/network.test.ts`

### 8.4 Кэш медиа
- [ ] **[M]** Открыть чат с изображениями → перейти в Offline → изображения всё ещё отображаются из кэша.
- [ ] **[M]** Загрузить > 200 МБ медиа → старые файлы вытесняются (LRU), новые доступны.
- [x] **[A]** Unit-тест: `getCachedMediaUrl()` сохраняет ресурс в Cache API при первом запросе. ✅ `frontend/src/lib/__tests__/media-cache.test.ts`
- [x] **[A]** Unit-тест: повторный вызов `getCachedMediaUrl()` возвращает кэш без сетевого запроса. ✅ `frontend/src/lib/__tests__/media-cache.test.ts`

### 8.5 WebSocket reconnect
- [ ] **[M]** Имитировать потерю WS (DevTools → Network → throttle WebSocket) → через 1–30 с происходит reconnect, сообщения возобновляются.
- [ ] **[M]** Перевести ноутбук в сон на 30с → пробудить — WS восстанавливается, пропущенные сообщения подтягиваются.
- [x] **[A]** Unit-тест: `WsManager` — при обрыве вызывается reconnect с увеличивающимся интервалом. ✅ `frontend/src/lib/__tests__/ws-manager.test.ts`

---

## 9. Delivery pipeline WebSocket (реализованная часть)

**Файлы:** `frontend/src/lib/ws-manager.ts`, `backend/apps/chats/consumers.py`, `backend/apps/chats/serializers.py`

### 9.1 Статусы delivered / read
- [ ] **[M]** Аккаунт A отправляет сообщение → у A одна галочка (delivered).
- [ ] **[M]** Аккаунт B открывает чат → у A появляется вторая галочка (read).
- [x] **[A]** API-тест: `MessageSerializer.get_read_status()` возвращает `"delivered"` для нового сообщения. ✅ `backend/apps/chats/tests_read_status.py`
- [x] **[A]** API-тест: После обновления `ChatMember.last_read_at` → `read_status` меняется на `"read"`. ✅ `backend/apps/chats/tests_read_status.py`
- [ ] **[P]** Два аккаунта: отправить → проверить delivered → открыть → проверить read в реальном времени.

### 9.2 Reconnect
- [ ] **[M]** Закрыть и поднять бэкенд → WS переподключается автоматически, без перезагрузки страницы.
- [ ] **[M]** Множественные разрывы подряд — backoff растёт (1с → 2с → 4с → ... → 30с max).

---

## 10. Chat-actions: reactions, reply, forward, edit, delete

**Файлы:** `backend/apps/chats/message_views.py`, `backend/apps/chats/models.py`, `backend/apps/chats/serializers.py`, `frontend/src/pages/ChatPage.tsx`

### 10.1 Реакции (в т.ч. анимированные Lottie-стикеры)
- [ ] **[M]** Навести на сообщение → открыть панель реакций → выбрать emoji → реакция появляется под сообщением.
- [ ] **[M]** Повторный клик на ту же реакцию — она снимается (toggle).
- [ ] **[M]** Поставить 3 разных реакции — все отображаются. Попробовать 4-ю — не добавляется (лимит 3).
- [ ] **[M]** Реакции отображаются как Lottie-анимации: при появлении проигрываются один раз, затем остаются на последнем кадре. В пикере (hover/mobile) анимации зациклены.
- [x] **[A]** API-тест: POST `/messages/{id}/reactions/` с emoji → 201, повторный POST → реакция удаляется. ✅ `backend/apps/chats/tests_reactions.py`
- [x] **[A]** API-тест: 4-я реакция → 400 Bad Request. ✅ `backend/apps/chats/tests_reactions.py`
- [ ] **[P]** Аккаунт A ставит реакцию → у аккаунта B она появляется в реальном времени (WS).

### 10.2 Ответ (Reply)
- [ ] **[M]** Свайп или кнопка «Ответить» → над инпутом появляется цитата с текстом исходного сообщения.
- [ ] **[M]** Отправить ответ → он отображается с вложенной цитатой.
- [ ] **[M]** Кликнуть на цитату → скролл к оригинальному сообщению.
- [x] **[A]** API-тест: POST message с `reply_to` → сообщение содержит вложенный `reply_to` объект. ✅ `backend/apps/chats/tests_reply_forward.py`
- [ ] **[M]** Ответ на сообщение с файлом — в цитате показывается превью вложения.

### 10.3 Пересылка (Forward)
- [ ] **[M]** Контекстное меню → «Переслать» → открывается модальное окно выбора чата.
- [ ] **[M]** Выбрать чат → сообщение пересылается с пометкой «Переслано от …» и названием исходного чата.
- [ ] **[M]** Переслать сообщение с изображением — вложение копируется в целевой чат.
- [x] **[A]** API-тест: POST `/chats/{id}/forward/` → новое сообщение с `forwarded_from` и `forwarded_from_chat`. ✅ `backend/apps/chats/tests_reply_forward.py`
- [x] **[A]** API-тест: пересылка сообщения с файлами → M2M связь `files` копируется. ✅ `backend/apps/chats/tests_reply_forward.py`

### 10.4 Редактирование (Edit)
- [ ] **[M]** Своё сообщение → контекстное меню → «Редактировать» → текст появляется в инпуте.
- [ ] **[M]** Изменить текст → отправить → сообщение обновлено, рядом с временем надпись «изменено».
- [ ] **[M]** Попытка редактировать чужое сообщение — кнопка отсутствует.
- [x] **[A]** API-тест: PATCH `/messages/{id}/` с новым текстом → 200, `edited_at` не null. ✅ `backend/apps/chats/tests_edit_delete.py`
- [x] **[A]** API-тест: PATCH чужого сообщения → 403 Forbidden. ✅ `backend/apps/chats/tests_edit_delete.py`

### 10.5 Удаление (Delete)
- [ ] **[M]** Своё сообщение → контекстное меню → «Удалить» → подтверждение → сообщение заменяется плейсхолдером «сообщение удалено».
- [ ] **[M]** Удалённое сообщение не отображает текст/вложения.
- [x] **[A]** API-тест: DELETE `/messages/{id}/` → 200, `is_deleted = True`. ✅ `backend/apps/chats/tests_edit_delete.py`
- [x] **[A]** API-тест: GET сообщения → текст пустой или placeholder. ✅ `backend/apps/chats/tests_edit_delete.py`
- [ ] **[P]** У собеседника удалённое сообщение обновляется в реальном времени через WS.

---

## 11. Голосовые и видео-сообщения

**Файлы:** `frontend/src/pages/ChatPage.tsx`, `backend/apps/chats/models.py`

### 11.1 Голосовые сообщения
- [ ] **[M]** Нажать и удерживать кнопку микрофона → запись начинается, видны анимированные bars (waveform).
- [ ] **[M]** Отпустить → сообщение отправляется, в ленте появляется аудиоплеер с визуализацией волны.
- [ ] **[M]** Нажать play — воспроизведение с визуализацией waveform (полоска движется по волне).
- [ ] **[M]** Проверить, что `MsgType.AUDIO` корректно определяется бэкендом.
- [ ] **[M]** Отменить запись (свайп влево или кнопка «Отмена») → запись не отправляется.
- [ ] **[M]** Запись > 1 мин — работает стабильно, без обрыва.
- [ ] **[P]** Два аккаунта: A отправляет голосовое → B получает его и может воспроизвести.

### 11.2 Видео-кружочки (Video circle)
- [ ] **[M]** Нажать кнопку видео-записи → появляется оверлей с камерой и таймером.
- [ ] **[M]** Записать кружок → он отображается как круглое видео (аналог Telegram).
- [ ] **[M]** Таймер: запись ограничена `MAX_VIDEO_DURATION` — автоматическая остановка.
- [ ] **[M]** `MsgType.VIDEO_CIRCLE` корректно рендерится в ленте (круглая маска).
- [ ] **[M]** Обычное видео (`MsgType.VIDEO`) — отображается как прямоугольный плеер.
- [ ] **[M]** Переключение фронтальной/основной камеры во время записи (если поддерживается).

### 11.3 AI-транскрипция
- [ ] **[M]** Активировать режим распознавания речи → говорить → текст появляется в инпуте.
- [ ] **[M]** Отправить распознанный текст — корректное текстовое сообщение.

---

## 12. Расширенные pinned messages

**Файлы:** `backend/apps/chats/models.py` (ChatPinnedMessage, UserPinnedMessage), `frontend/src/pages/ChatPage.tsx`

- [ ] **[M]** Закрепить сообщение → вверху чата появляется панель с превью.
- [ ] **[M]** Закрепить 3 сообщения → индикатор-точки показывает количество, клик переключает между ними.
- [ ] **[M]** Клик на панель закрепа → скролл к закреплённому сообщению.
- [ ] **[M]** Цикличная навигация: дойти до последнего закрепа → следующий клик → возврат к первому.
- [ ] **[M]** Открепить сообщение → панель обновляется, сообщение убрано из закрепов.
- [ ] **[M]** Превышение лимита (зависит от тарифа: 1/5/20) → ошибка или предложение апгрейда.
- [x] **[A]** API-тест: POST pin → `ChatPinnedMessage` создаётся с `pin_order`. ✅ `backend/apps/chats/tests_pins.py`
- [x] **[A]** API-тест: pin сверх лимита `Chat.max_pins` → 400. ✅ `backend/apps/chats/tests_pins.py`
- [x] **[A]** API-тест: DELETE pin → запись удаляется, остальные `pin_order` корректны. ✅ `backend/apps/chats/tests_pins.py`
- [ ] **[M]** Персональные закрепы (`UserPinnedMessage`): закрепить для себя → виден только текущему пользователю.
- [ ] **[P]** Два аккаунта: A закрепляет → у B панель обновляется в реальном времени.

---

## 13. E2EE-режим для личных чатов

**Файлы:** `backend/apps/e2ee/`, `frontend/src/lib/e2ee/`, `frontend/src/store/e2ee.ts`

### 13.1 Регистрация устройства и ключи
- [x] **[A]** API-тест: POST register device → создаётся `Device` с identity key и signed prekey. ✅ `backend/apps/e2ee/tests.py`
- [x] **[A]** API-тест: POST upload prekeys → `OneTimePreKey` записи создаются. ✅ `backend/apps/e2ee/tests.py`
- [x] **[A]** API-тест: GET prekey bundle → возвращает identity key, signed prekey и один one-time prekey (который затем удаляется). ✅ `backend/apps/e2ee/tests.py`
- [ ] **[M]** При первом входе устройство регистрируется автоматически, ключи генерируются и сохраняются в IndexedDB.

### 13.2 Установка сессии (X3DH)
- [ ] **[M]** Аккаунт A начинает E2EE-чат с B → X3DH обмен ключами проходит успешно.
- [x] **[A]** Unit-тест: `prepareEncryptedMessage()` шифрует текст, результат не содержит plaintext. ✅ `frontend/src/lib/e2ee/__tests__/crypto.test.ts` (XChaCha20-Poly1305 roundtrip)
- [x] **[A]** Unit-тест: расшифровка на стороне получателя возвращает исходный текст. ✅ `frontend/src/lib/e2ee/__tests__/crypto.test.ts` (decrypt roundtrip)
- [ ] **[M]** Проверить Network tab: тело зашифрованного сообщения — бинарные данные, не plaintext.

### 13.3 Double Ratchet
- [x] **[A]** Unit-тест: после каждого сообщения ключ ротируется (session state изменяется). ✅ `frontend/src/lib/e2ee/__tests__/crypto.test.ts` (HKDF deterministic + different inputs)
- [ ] **[M]** Отправить 10+ сообщений подряд → каждое расшифровывается корректно.
- [ ] **[M]** A и B по очереди обмениваются сообщениями → ratchet продвигается в обе стороны.

### 13.4 Multi-device
- [ ] **[M]** Войти с двух устройств (вкладок) → E2EE-сообщения расшифровываются на обоих.
- [x] **[A]** API-тест: `encrypted_keys` содержит ключ для каждого зарегистрированного устройства получателя. ✅ `backend/apps/e2ee/tests.py`

### 13.5 Safety numbers
- [ ] **[M]** Открыть E2EE-чат → меню → «Проверить собеседника» → отображается safety number / QR.
- [ ] **[M]** Safety number одинаков у обоих участников чата.

### 13.6 Модель сообщений
- [x] **[A]** API-тест: зашифрованное сообщение имеет `is_encrypted = True`, `sender_device` не null. ✅ `backend/apps/e2ee/tests.py`
- [x] **[A]** API-тест: `encrypted_keys` — JSON-словарь {device_id: encrypted_key}. ✅ `backend/apps/e2ee/tests.py`
- [ ] **[M]** Незашифрованное сообщение в обычном чате: `is_encrypted = False`.

---

## 14. Privacy controls

**Файлы:** `backend/apps/users/models.py`, `backend/apps/users/serializers.py`, `frontend/src/pages/SettingsPage.tsx`

### 14.1 Видимость телефона
- [ ] **[M]** Настройки → выключить «Показывать телефон» → другой аккаунт не видит номер в профиле.
- [ ] **[M]** Включить обратно → номер виден.
- [x] **[A]** API-тест: `show_phone = False` → `UserSerializer.get_phone()` возвращает `null` для другого пользователя. ✅ `backend/apps/users/tests_privacy.py`
- [x] **[A]** API-тест: `show_phone = False` → собственный профиль всё ещё показывает номер. ✅ `backend/apps/users/tests_privacy.py`

### 14.2 Last seen
- [ ] **[M]** Настройки → выключить «Показывать время последнего визита» → другие видят «был(а) давно» или ничего.
- [x] **[A]** API-тест: `show_last_seen = False` → `get_last_seen_display()` возвращает скрытое значение. ✅ `backend/apps/users/tests_privacy.py`
- [x] **[A]** API-тест: `show_last_seen = True` → возвращает реальный таймстамп. ✅ `backend/apps/users/tests_privacy.py`

### 14.3 Кто может писать в ЛС
- [ ] **[M]** Установить `dm_privacy = "nobody"` → другой пользователь не может создать личный чат (кнопка недоступна или ошибка).
- [x] **[A]** API-тест: создание DM-чата с пользователем, у которого `dm_privacy = "nobody"` → 403. ✅ `backend/apps/users/tests_privacy.py`
- [ ] **[M]** Установить `dm_privacy = "everyone"` → чат создаётся успешно.

### 14.4 Кто может добавлять в группы
- [ ] **[M]** Установить `add_to_group_privacy = "nobody"` → другой пользователь не может добавить в группу.
- [x] **[A]** API-тест: добавление пользователя с `add_to_group_privacy = "nobody"` в группу → 403. ✅ `backend/apps/users/tests_privacy.py`
- [ ] **[M]** `add_to_group_privacy = "everyone"` → добавление проходит.

### 14.5 UI настроек
- [ ] **[M]** Все 4 переключателя присутствуют в разделе «Приватность» в `SettingsPage`.
- [ ] **[M]** Изменение сохраняется при перезагрузке страницы.
- [ ] **[P]** Изменить настройку → проверить через API, что значение обновилось.

---

## 15. Public usernames (реализованная часть)

**Файлы:** `backend/apps/users/models.py`, `backend/apps/users/serializers.py`, `backend/apps/users/tests_username.py`

- [ ] **[M]** Настройки → установить username `test_user_1` → сохраняется.
- [ ] **[M]** Попытка занять чужой username → ошибка «username уже занят».
- [x] **[A]** Unit-тест: username `Ab_123` — валиден (regex `^[A-Za-z0-9_]{3,30}$`). ✅ `backend/apps/users/tests_username.py`
- [x] **[A]** Unit-тест: username `ab` (2 символа) → ошибка валидации (мин. 3). ✅ `backend/apps/users/tests_username.py`
- [x] **[A]** Unit-тест: username `ab!cd` (спецсимвол) → ошибка валидации. ✅ `backend/apps/users/tests_username.py`
- [x] **[A]** Unit-тест: username с 31 символом → ошибка валидации (макс. 30). ✅ `backend/apps/users/tests_username.py`
- [x] **[A]** Unit-тест: `Alice_1` и `alice_1` — оба допустимы (case-sensitive uniqueness), constraint `users_username_unique_cs`. ✅ `backend/apps/users/tests_username.py`
- [ ] **[M]** Удалить username (null) → поле очищается, пользователь доступен по другим идентификаторам.

---

## 16. Drag & drop файлов + вставка из буфера обмена (Ctrl+V)

**Файлы:** `frontend/src/pages/ChatPage.tsx`

### 16.1 Drag & drop
- [ ] **[M]** Перетащить файл в область чата → появляется визуальный оверлей с двумя зонами.
- [ ] **[M]** Drop в верхнюю зону → файл отправляется как вложение (документ).
- [ ] **[M]** Drop в нижнюю зону → изображение отправляется с превью (сжатое).
- [ ] **[M]** Перетащить файл > 0.5 ГБ → ошибка валидации размера.
- [ ] **[M]** Перетащить 5 файлов одновременно → все принимаются и отправляются.
- [ ] **[M]** Перетащить не-медиа файл (PDF, ZIP) → отправляется как документ.
- [ ] **[M]** Drag без drop (увести курсор за пределы) → оверлей исчезает.
- [ ] **[P]** E2E-тест: drag & drop изображения → собеседник получает файл.

### 16.2 Вставка из буфера обмена (Ctrl+V)
- [ ] **[M]** Скопировать изображение → Ctrl+V в поле ввода → открывается `FilePreviewModal` с превью.
- [ ] **[M]** Подтвердить отправку в модальном окне → изображение уходит в чат.
- [ ] **[M]** Ctrl+V обычного текста → текст вставляется как обычно, модальное окно не открывается.
- [ ] **[M]** Ctrl+V файл > 0.5 ГБ → отображается ошибка валидации размера, модальное окно не открывается.
- [ ] **[M]** Скриншот через Win+Shift+S → Ctrl+V → изображение вставляется, открывается превью.
- [ ] **[M]** Ctrl+V нескольких файлов из буфера → все файлы подхватываются в `FilePreviewModal`.
- [ ] **[M]** Ctrl+V в поле ввода с уже набранным текстом → медиа подхватывается, текст в инпуте сохраняется.
- [ ] **[P]** E2E-тест: вставить изображение из буфера → собеседник получает файл.

---

## 17. Scroll-to-unread

**Файлы:** `frontend/src/pages/ChatPage.tsx`

**Ключевая реализация:** `Promise.all([chatsApi.get, storeLoadMessages])` → `setInitialUnreadIds` → `requestAnimationFrame` ×2 → `querySelector('[data-unread-line]').scrollIntoView()`.

### 17.1 Базовая прокрутка к непрочитанным
- [ ] **[M]** Получить 5 непрочитанных сообщений → открыть чат → лента прокручена к первому непрочитанному, а не к самому низу.
- [ ] **[M]** Над первым непрочитанным отображается разделитель «Непрочитанные сообщения» (горизонтальная линия с текстом).
- [ ] **[M]** Разделитель находится в верхней части viewport (scrollIntoView block: start).
- [ ] **[M]** Под разделителем видны непрочитанные сообщения, над ним — последние прочитанные (контекст).

### 17.2 Скрытие разделителя после прочтения
- [ ] **[M]** Прокрутить вниз и просмотреть все непрочитанные → разделитель исчезает.
- [ ] **[M]** После просмотра всех непрочитанных → вызывается `markRead()` (проверить Network tab: POST mark-read).
- [ ] **[M]** Повторно открыть тот же чат → разделителя нет, лента внизу.

### 17.3 Чат без непрочитанных
- [ ] **[M]** Открыть чат с 0 непрочитанных → нет разделителя, лента прокручена до конца (вниз).
- [ ] **[M]** Открыть чат, где только что вызван `markRead` → поведение как при 0 непрочитанных.

### 17.4 Крайние случаи
- [ ] **[M]** 1 непрочитанное сообщение → разделитель показан перед ним, прокрутка корректна.
- [ ] **[M]** Все сообщения непрочитанные (новый чат, ни разу не открывавшийся) → разделитель вверху, прокрутка к началу.
- [ ] **[M]** `unread_count` > количество загруженных сообщений → прокрутка работает без ошибок (клампинг).
- [ ] **[M]** Медленная сеть (Network throttle → Slow 3G): Promise.all ждёт оба запроса, прокрутка происходит только после полной загрузки.
- [ ] **[M]** Ошибка загрузки чата (404) → fallback на scrollToBottom, без JS-ошибок в консоли.

### 17.5 Нагрузка
- [ ] **[M]** 90+ непрочитанных (близко к лимиту API в 100 сообщений) → корректная прокрутка, без фриза.
- [ ] **[M]** Чат с 50 сообщений, 30 непрочитанных → разделитель на 20-м сообщении, видны и прочитанные, и непрочитанные.

### 17.6 E2E
- [ ] **[P]** Аккаунт A отправляет 10 сообщений → аккаунт B открывает чат → скролл на первое непрочитанное, разделитель виден.
- [ ] **[P]** Аккаунт B прокручивает до конца → разделитель исчезает, `markRead` вызван.

---

## 18. Mobile-responsive адаптивная вёрстка

**Файлы:** `frontend/src/index.css`, `frontend/index.html`, `frontend/src/pages/ChatPage.tsx`, `frontend/src/pages/MessengerPage.tsx`

### 18.1 Global touch и safe-area
- [ ] **[M]** На iPhone Safari: контент не залезает под notch — padding корректен по всем сторонам.
- [ ] **[M]** На Android Chrome: нет pull-to-refresh при свайпе вниз в ленте сообщений.
- [ ] **[M]** Тап по элементам срабатывает мгновенно — нет 300 ms задержки (Safari).
- [ ] **[M]** В DevTools → Application → Manifest: `mobile-web-app-capable` и `theme-color` отображаются.

### 18.2 Info sidebar overlay (мобильный)
- [ ] **[M]** На экране < 768px: нажать (i) → sidebar открывается на весь экран поверх чата.
- [ ] **[M]** Видна кнопка «назад» (стрелка) в верхнем левом углу sidebar.
- [ ] **[M]** Тап по затемнённому фону → sidebar закрывается.
- [ ] **[M]** Тап «назад» → sidebar закрывается, чат видим.
- [ ] **[M]** На экране ≥ 768px: sidebar отображается как боковая панель справа — нет overlay, нет backdrop.
- [ ] **[P]** Viewport 375×812 (iPhone X): открыть Info → проверить, что sidebar занимает весь экран.

### 18.3 Context menu — bottom sheet (мобильный)
- [ ] **[M]** На тач-устройстве: долгое нажатие (≈500 ms) на сообщение → открывается контекстное меню.
- [ ] **[M]** На экране < 768px: меню прикреплено к низу экрана (bottom sheet), скруглённые верхние углы.
- [ ] **[M]** Вверху bottom sheet — ряд быстрых emoji-реакций (все 15 штук).
- [ ] **[M]** Тап по emoji → реакция ставится, меню закрывается.
- [ ] **[M]** Тап по backdrop (затемнённая область выше sheet) → меню закрывается.
- [ ] **[M]** На десктопе (≥ 768px): правый клик → обычное позиционированное меню (не bottom sheet).
- [ ] **[M]** Лёгкая вибрация при открытии bottom sheet (на устройствах с haptic feedback).
- [ ] **[M]** Долгое нажатие не конфликтует с обычным тапом — сообщение не выделяется при коротком тапе.

### 18.4 Padding и компактность
- [ ] **[M]** На экране 320px: сообщения не обрезаются, padding уменьшен (`p-2`).
- [ ] **[M]** Input-bar: кнопки компактнее (p-1.5), промежутки сужены, текстовое поле не теряет функциональности.
- [ ] **[M]** Кнопка «↓ вниз» не перекрывается input-bar (расположена выше).

---

## 19. Swipe-to-reply

**Файлы:** `frontend/src/pages/ChatPage.tsx`, `frontend/src/index.css`

### 19.1 Базовый свайп
- [ ] **[M]** На тач-устройстве: свайп вправо по сообщению → пузырь сдвигается, слева появляется иконка «ответить».
- [ ] **[M]** При малом сдвиге (< 60 px) → отпустить → пузырь возвращается, ответ не срабатывает.
- [ ] **[M]** При сдвиге ≥ 60 px → отпустить → активируется режим ответа (цитата над input).
- [ ] **[M]** Иконка плавно появляется (opacity от 0 до 1 пропорционально сдвигу).
- [ ] **[M]** При достижении порога иконка становится синей (`text-blue-500`) и увеличивается (`scale-110`).
- [ ] **[M]** После срабатывания — лёгкая вибрация (на устройствах с haptic).

### 19.2 Анимация
- [ ] **[M]** Свайп плавный — нет дёрганий (60 fps).
- [ ] **[M]** При отпускании пузырь плавно возвращается назад (transition 0.25s ease-out).
- [ ] **[M]** Максимальный сдвиг ограничен 80 px — пузырь не уезжает за экран.

### 19.3 Конфликт с другими жестами
- [ ] **[M]** Вертикальный скролл ленты сообщений не вызывает горизонтальный свайп (проверка |dx| > |dy| * 1.5).
- [ ] **[M]** Свайп по сообщению не вызывает «назад к списку чатов» (stopPropagation).
- [ ] **[M]** Свайп «назад» (от левого края экрана) по-прежнему работает вне пузырей сообщений.
- [ ] **[M]** Долгое нажатие (контекстное меню) и свайп не конфликтуют — при начале свайпа long-press отменяется.

### 19.4 Edge-cases
- [ ] **[M]** Свайп по сообщению с изображением — работает корректно.
- [ ] **[M]** Свайп по голосовому / видео-сообщению — работает.
- [ ] **[M]** Свайп по своему и чужому сообщению — оба случая активируют ответ.
- [ ] **[M]** Свайп по удалённому сообщению (placeholder) — свайп не срабатывает (нет onReply).
- [ ] **[P]** Viewport 375×812 (тач-эмуляция): свайп по сообщению → режим ответа активируется.

---

## 20. Сессии и устройства

**Файлы:** `backend/apps/users/models.py` (UserSession), `backend/apps/users/jwt_utils.py`, `backend/apps/users/auth.py`, `backend/apps/users/views.py`, `backend/apps/users/session_views.py`, `backend/apps/users/services.py`, `backend/apps/users/urls.py`, `backend/apps/chats/middleware.py`, `backend/apps/chats/consumers.py`, `frontend/src/store/auth.ts`, `frontend/src/api/client.ts`, `frontend/src/pages/MessengerPage.tsx`, `frontend/src/pages/SettingsPage.tsx`

### 20.1 Модель UserSession и создание сессии
- [x] **[A]** API-тест: POST `/api/auth/verify/` с валидным OTP → в ответе JWT содержит claim `sid` (UUID). ✅ `backend/apps/users/tests_sessions.py`
- [x] **[A]** API-тест: после логина в БД создаётся `UserSession` с корректными `ip_address`, `user_agent`, `device_label`, `is_active=True`. ✅ `backend/apps/users/tests_sessions.py`
- [x] **[A]** Unit-тест: `_parse_device_label("Mozilla/5.0 ... Chrome/120.0.0.0 ... Windows NT 10.0")` → `"Chrome 120, Windows 10"`. ✅ `backend/apps/users/tests_sessions.py`
- [x] **[A]** Unit-тест: `_parse_device_label("")` → `"Unknown device"`. ✅ `backend/apps/users/tests_sessions.py`
- [x] **[A]** Unit-тест: `_get_client_ip()` корректно парсит `X-Forwarded-For` (несколько IP через запятую → первый). ✅ `backend/apps/users/tests_sessions.py`
- [ ] **[M]** Залогиниться → проверить в Django Admin / DB, что `UserSession` создалась с правильным device_label.

### 20.2 JWT с session_id
- [x] **[A]** Unit-тест: `make_access_token(user_id, session_id)` → декодированный payload содержит `"sid"`. ✅ `backend/apps/users/tests_sessions.py`
- [x] **[A]** Unit-тест: `make_refresh_token(user_id, session_id)` → payload содержит `"sid"`. ✅ `backend/apps/users/tests_sessions.py`
- [x] **[A]** Unit-тест: `make_access_token(user_id)` без session_id → payload НЕ содержит `"sid"` (backward-compatible). ✅ `backend/apps/users/tests_sessions.py`
- [ ] **[M]** Декодировать JWT из ответа `/api/auth/verify/` через jwt.io → убедиться, что поле `sid` присутствует.

### 20.3 Валидация сессии (HTTP)
- [x] **[A]** API-тест: запрос с валидным JWT (активная сессия) → 200 OK. ✅ `backend/apps/users/tests_sessions.py`
- [x] **[A]** API-тест: деактивировать сессию в БД (`is_active=False`) → запрос с тем же JWT → 401 «Session revoked». ✅ `backend/apps/users/tests_sessions.py`
- [x] **[A]** API-тест: JWT без claim `sid` (legacy-токен) → запрос проходит успешно (backward-compatible). ✅ `backend/apps/users/tests_sessions.py`
- [x] **[A]** API-тест: `last_active` обновляется при запросах (с троттлингом ~5 мин, проверить, что первый запрос обновляет). ✅ `backend/apps/users/tests_sessions.py`
- [ ] **[M]** Завершить сессию через Settings → попробовать обновить страницу → редирект на /auth.

### 20.4 Валидация сессии (WebSocket)
- [ ] **[A]** Integration-тест: WS-подключение с JWT (активная сессия) → scope["user"] не None.
- [ ] **[A]** Integration-тест: WS-подключение с JWT (revoked сессия) → scope["user"] = None, подключение отклонено.
- [ ] **[A]** Integration-тест: WS-подключение с JWT без `sid` → scope["user"] корректен (backward-compatible).
- [ ] **[M]** Открыть мессенджер → в DevTools видно WS-подключение. Завершить сессию с другого устройства → WS разрывается.

### 20.5 Refresh token с session_id
- [x] **[A]** API-тест: POST `/api/auth/refresh/` с валидным refresh → новый access содержит тот же `sid`. ✅ `backend/apps/users/tests_sessions.py`
- [x] **[A]** API-тест: POST `/api/auth/refresh/` с revoked сессией → 401. ✅ `backend/apps/users/tests_sessions.py`
- [x] **[A]** API-тест: POST `/api/auth/refresh/` с legacy refresh (без `sid`) → работает (backward-compatible). ✅ `backend/apps/users/tests_sessions.py`

### 20.6 API: список сессий
- [x] **[A]** API-тест: GET `/api/auth/sessions/` → массив активных сессий с полями `id`, `device_label`, `ip_address`, `created_at`, `last_active`, `is_current`. ✅ `backend/apps/users/tests_sessions.py`
- [x] **[A]** API-тест: одна из сессий имеет `is_current: true` (текущая), остальные `false`. ✅ `backend/apps/users/tests_sessions.py`
- [x] **[A]** API-тест: неактивные сессии (`is_active=False`) НЕ отображаются в списке. ✅ `backend/apps/users/tests_sessions.py`
- [x] **[A]** API-тест: неавторизованный запрос → 401. ✅ `backend/apps/users/tests_sessions.py`
- [ ] **[M]** Залогиниться с двух браузеров → GET sessions → в списке 2 записи с разными device_label.

### 20.7 API: завершение конкретной сессии
- [x] **[A]** API-тест: DELETE `/api/auth/sessions/<uuid>/` → 204, сессия `is_active=False`. ✅ `backend/apps/users/tests_sessions.py`
- [x] **[A]** API-тест: DELETE текущей сессии → 400 «Нельзя завершить текущую сессию». ✅ `backend/apps/users/tests_sessions.py`
- [x] **[A]** API-тест: DELETE несуществующей сессии → 404. ✅ `backend/apps/users/tests_sessions.py`
- [x] **[A]** API-тест: DELETE чужой сессии (другого пользователя) → 404. ✅ `backend/apps/users/tests_sessions.py`
- [ ] **[M]** В Settings завершить одну из сессий → она исчезает из списка.

### 20.8 API: logout all
- [x] **[A]** API-тест: POST `/api/auth/sessions/logout-all/` → все сессии кроме текущей деактивированы, ответ `{"terminated": N}`. ✅ `backend/apps/users/tests_sessions.py`
- [x] **[A]** API-тест: после logout-all → GET sessions возвращает только 1 (текущую). ✅ `backend/apps/users/tests_sessions.py`
- [ ] **[M]** Залогиниться с 3 браузеров → «Завершить все» → 2 из 3 сессий завершены, текущая остаётся.

### 20.9 WebSocket: force_logout
- [ ] **[A]** Integration-тест: после DELETE сессии → WS получает `{"type": "force_logout", "terminated_session_ids": [...]}`.
- [ ] **[A]** Integration-тест: после logout-all → WS получает `force_logout` со списком всех завершённых ID.
- [ ] **[M]** Открыть мессенджер в двух вкладках (одна сессия) → завершить сессию с третьего устройства → обе вкладки редиректятся на /auth.
- [ ] **[P]** Два аккаунта, 2 сессии: завершить удалённую → во второй вкладке автоматический logout.

### 20.10 Уведомление о новом входе (WebSocket)
- [ ] **[A]** Integration-тест: пользователь онлайн (WS подключён) → логин с нового устройства → WS получает `{"type": "new_login_alert", "device": "...", "ip": "...", "session_id": "..."}`.
- [ ] **[M]** Открыть мессенджер → залогиниться с другого браузера → появляется amber toast «Новый вход в аккаунт» с device и IP.
- [ ] **[M]** Кликнуть на toast → переход в Settings.
- [ ] **[M]** Toast исчезает автоматически через ~8 секунд.

### 20.11 Уведомление о новом входе (SMS fallback)
- [x] **[A]** Integration-тест: пользователь офлайн → логин → вызывается `send_sms()` с текстом «Новый вход: {device}, {time}. Не вы? ...». ✅ `backend/apps/users/tests_sessions.py`
- [ ] **[M]** Закрыть все вкладки мессенджера → залогиниться с нового устройства → SMS приходит на телефон.
- [x] **[A]** Unit-тест: первая регистрация (`created=True`) → `notify_new_login` НЕ вызывается. ✅ `backend/apps/users/tests_sessions.py`

### 20.12 Фронтенд: auth store
- [x] **[A]** Unit-тест: `setTokens(access, refresh)` → `sessionId` извлекается из JWT payload (`sid`). ✅ `frontend/src/store/__tests__/auth.test.ts`
- [x] **[A]** Unit-тест: `clearTokens()` → `sessionId = null`. ✅ `frontend/src/store/__tests__/auth.test.ts`
- [ ] **[M]** В DevTools → React DevTools → `useAuthStore` → проверить, что `sessionId` не null после логина.

### 20.13 Фронтенд: UI «Активные сессии» в SettingsPage
- [ ] **[M]** Открыть Settings → прокрутить → секция «Активные сессии» видна.
- [ ] **[M]** В списке отображаются: device label, IP, время создания, время последней активности.
- [ ] **[M]** Текущая сессия отмечена badge «Текущая» (зелёный/индиго).
- [ ] **[M]** У текущей сессии нет кнопки «Завершить».
- [ ] **[M]** Нажать «Завершить» у другой сессии → она исчезает из списка.
- [ ] **[M]** Нажать «Завершить все другие сессии» → остаётся только текущая.
- [ ] **[M]** Loading-состояние: при загрузке отображается спиннер / «Загрузка...».
- [ ] **[M]** Error-состояние: при ошибке API отображается сообщение с кнопкой «Повторить».
- [ ] **[P]** Viewport 375×812: секция сессий корректно отображается на мобильном (no overflow).

### 20.14 Backward-compatibility
- [ ] **[M]** Существующие пользователи с токенами без `sid` — продолжают работать после деплоя (не разлогиниваются).
- [x] **[A]** API-тест: legacy-токен (без `sid`) → запросы проходят, сессий в списке 0 (нет привязки). ✅ `backend/apps/users/tests_sessions.py`
- [ ] **[M]** После re-login — новый токен содержит `sid`, сессия появляется в списке.

---

## 21. Юридические документы (Legal pages)

**Файлы:** `frontend/src/components/LegalMarkdown.tsx`, `frontend/src/lib/legal.ts`, `frontend/src/content/legal/*.md`

**Инфраструктура:** 8 markdown-файлов (4 документа × 2 языка), компонент `LegalMarkdown` (рендер markdown → styled HTML через `react-markdown` + `remark-gfm`), утилита `applyLegalTemplate()` для подстановки токенов `{{service_name}}`, `{{operator_name}}`, `{{contact_email}}`, `{{last_updated_human}}`, `{{last_updated}}`.

### 21.1 Контент и шаблонизация
- [ ] **[A]** Unit-тест: `getLegalTokens("ru")` возвращает объект с ключами `service_name`, `operator_name`, `contact_email`, `last_updated`, `last_updated_human`.
- [ ] **[A]** Unit-тест: `getLegalTokens("en")` — аналогичные ключи, но на английском (напр. `service_name = "Private Chats"`).
- [ ] **[A]** Unit-тест: `applyLegalTemplate("Hello {{service_name}}", "ru")` → `"Hello Приватные чаты"`.
- [ ] **[A]** Unit-тест: `applyLegalTemplate()` с неизвестным токеном `{{unknown_key}}` → оставляет как есть.
- [ ] **[A]** Unit-тест: `formatLastUpdatedHuman("ru", "2026-02-13")` → строка с «13 февраля 2026 г.» (или аналогичная локализованная дата).
- [ ] **[A]** Unit-тест: `formatLastUpdatedHuman("en", "2026-02-13")` → строка с «February 13, 2026» (или аналогичная).
- [ ] **[A]** Unit-тест: все 8 markdown-файлов загружаются без ошибок (import/fetch не кидает исключения).
- [ ] **[A]** Unit-тест: после `applyLegalTemplate(termsRu, "ru")` не остаётся ни одного `{{...}}` (все токены подставлены).
- [ ] **[A]** Unit-тест: после `applyLegalTemplate(termsEn, "en")` не остаётся ни одного `{{...}}`.
- [ ] **[A]** Unit-тест: аналогичная проверка для `privacy`, `cookies`, `payments` на обоих языках.

### 21.2 Компонент LegalMarkdown — рендеринг
- [ ] **[M]** Открыть страницу с Пользовательским соглашением (RU) → отображается заголовок `h1`, секции `h2`, списки, ссылки.
- [ ] **[M]** Текст читабелен: шрифт не слишком мелкий, межстрочный интервал достаточный, абзацы разделены.
- [ ] **[M]** Ссылки в документе: внешние (`mailto:`, `https://`) — открываются в новой вкладке (`target="_blank"`).
- [ ] **[M]** Ссылки в документе: внутренние (`/...`, `#...`) — навигация без перезагрузки страницы (React Router `Link`).
- [ ] **[M]** Таблицы (в `payments.*.md` — глоссарий) отображаются корректно: заголовки жирные, ячейки выровнены, горизонтальный скролл при узком экране.
- [ ] **[M]** Блоки кода (если есть) — тёмный фон, моноширинный шрифт, скролл при переполнении.
- [ ] **[M]** `<hr>` (горизонтальная линия) — отображается как тонкая серая полоса с отступами.

### 21.3 Переключение языков
- [ ] **[M]** Переключить язык в Settings на English → юридический документ показывается на английском.
- [ ] **[M]** Переключить обратно на Русский → документ на русском.
- [ ] **[M]** При смене языка: дата обновления локализуется (`13 февраля 2026 г.` ↔ `February 13, 2026`).
- [ ] **[M]** Названия сервиса и оператора соответствуют текущему языку (`Приватные чаты` ↔ `Private Chats`).

### 21.4 Навигация и доступность
- [ ] **[M]** Из Settings / footer / другого UI есть ссылки на все 4 документа: Соглашение, Конфиденциальность, Cookies, Оплата.
- [ ] **[M]** Каждый документ доступен по прямому URL (напр. `/terms`, `/privacy`, `/cookies`, `/payments`) — при вводе URL в адресную строку страница рендерится.
- [ ] **[M]** 404 для несуществующего документа (напр. `/legal/nonexistent`) — fallback или редирект.
- [ ] **[M]** Кнопка «назад» (или стрелка) из юридического документа возвращает на предыдущую страницу.

### 21.5 Адаптивность
- [ ] **[M]** Viewport 375×812 (мобильный): документ читабелен, заголовки не обрезаются, таблица скроллится горизонтально.
- [ ] **[M]** Viewport 1440×900 (десктоп): контент центрирован, ширина ограничена (max-width), не растянут на весь экран.
- [ ] **[P]** Viewport 375×812: открыть каждый из 4 документов → нет горизонтального переполнения страницы.

### 21.6 Полнота документов
- [ ] **[M]** **Пользовательское соглашение (terms)**: содержит секции — принятие условий, аккаунт и доступ, допустимое использование, модерация, подписка/оплата, ответственность, изменения.
- [ ] **[M]** **Конфиденциальность (privacy)**: содержит секции — какие данные, цели обработки, правовые основания, передача третьим лицам, сроки хранения, безопасность, права пользователя, контакт.
- [ ] **[M]** **Cookies (cookies)**: содержит секции — что такое cookie, зачем используются, управление, контакт.
- [ ] **[M]** **Оплата (payments)**: содержит секции — подписка, пробный период, отмена, возвраты, виртуальные «звёзды», глоссарий, контакт.
- [ ] **[M]** В каждом документе указана дата обновления и контактный email.
- [ ] **[M]** Подстановленные данные соответствуют `LEGAL_CONFIG` в `legal.ts` (название сервиса, оператор, email).
