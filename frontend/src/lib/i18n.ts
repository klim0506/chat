import { useMemo } from "react";
import { usePreferencesStore, type AppLanguage } from "../store/preferences";
export type { AppLanguage };

/* ================================================================
   Translation dictionary — every UI string in the app.
   Keys are grouped by page / component / feature for readability.
   ================================================================ */

const translations = {
  // ─── Common ──────────────────────────────────────────────
  "common.loading": { en: "Loading…", ru: "Загрузка…" },
  "common.save": { en: "Save", ru: "Сохранить" },
  "common.cancel": { en: "Cancel", ru: "Отмена" },
  "common.confirmTitle": { en: "Confirm", ru: "Подтвердите действие" },
  "common.close": { en: "Close", ru: "Закрыть" },
  "common.saved": { en: "Saved", ru: "Сохранено" },
  "common.saveError": { en: "Save error", ru: "Ошибка сохранения" },
  "common.error": { en: "Error", ru: "Ошибка" },
  "common.retry": { en: "Retry", ru: "Повторить" },
  "common.logout": { en: "Log out", ru: "Выйти" },
  "common.logoutConfirm": { en: "Are you sure you want to log out?", ru: "Вы уверены, что хотите выйти из аккаунта?" },
  "common.settings": { en: "Settings", ru: "Настройки" },
  "common.back": { en: "Back", ru: "Назад" },
  "common.copy": { en: "Copy", ru: "Копировать" },
  "common.copied": { en: "Copied", ru: "Скопировано" },
  "common.open": { en: "Open", ru: "Открыть" },
  "common.download": { en: "Download", ru: "Скачать" },
  "common.delete": { en: "Delete", ru: "Удалить" },
  "common.remove": { en: "Remove", ru: "Убрать" },
  "common.send": { en: "Send", ru: "Отправить" },
  "common.search": { en: "Search", ru: "Поиск" },
  "common.everyone": { en: "Everyone", ru: "Все" },
  "common.nobody": { en: "Nobody", ru: "Никто" },
  "common.contacts": { en: "Contacts", ru: "Контакты" },
  "common.write": { en: "Write", ru: "Написать" },
  "common.file": { en: "file", ru: "файл" },
  "common.photo": { en: "(photo)", ru: "(фото)" },
  "common.video": { en: "(video)", ru: "(видео)" },
  "common.voice": { en: "(voice)", ru: "(голосовое)" },
  "common.fileMsg": { en: "(file)", ru: "(файл)" },
  "common.stickerMsg": { en: "(sticker)", ru: "(стикер)" },
  "common.message": { en: "(message)", ru: "(сообщение)" },
  "common.encryptedMessage": { en: "Encrypted message", ru: "Зашифрованное сообщение" },

  // ─── Landing page ────────────────────────────────────────
  "landing.brand": { en: "Pingy", ru: "Pingy" },
  "landing.help": { en: "Wiki Pingy", ru: "Wiki Pingy" },
  "landing.dashboard": { en: "Chats", ru: "Чаты" },
  "landing.login": { en: "Log in", ru: "Войти" },
  "landing.hero.tag": { en: "Messenger without VPN and blocks", ru: "Безопасный мессенджер без VPN и блокировок" },
  "landing.hero.title1": { en: "Pingy — ", ru: "Pingy — " },
  "landing.hero.titleHighlight": { en: "Secure messenger", ru: "Безопасный мессенджер" },
  "landing.hero.title2": { en: " without VPN and blocks.", ru: " без VPN и блокировок." },
  "landing.hero.desc": {
    en: "Messenger that works from Russia without VPN. Registration by phone number, end-to-end encryption based on Telegram protocols. Free forever — no trial, no expiry. Files up to 4 GB, voice messages, video, polls. From personal chats to communities of 10,000.",
    ru: "Мессенджер, работающий в России без VPN. Регистрация по номеру телефона, шифрование на основе алгоритмов Telegram. Бесплатно для всех. Файлы до 4 ГБ. Лучшая альтернатива MAX и Telegram. Для личных и рабочих чатов, групп и каналов",
  },
  "landing.hero.subdesc": {
    en: "Web, Windows, Android.",
    ru: "Веб, Windows, Android.",
  },
  "landing.hero.start": { en: "Try for free", ru: "Попробовать бесплатно" },
  "landing.hero.createChat": { en: "Create chat", ru: "Создать чат" },
  "landing.features.title": { en: "Why Pingy", ru: "Почему Pingy" },
  "landing.features.subtitle": { en: "Free forever. No VPN. End-to-end encryption. Compliant with Russian law.", ru: "Бесплатно. Без VPN. Шифрование. Импорт чатов и каналов из телеграмм." },
  "landing.features.wikiHint": { en: "Learn more about features in Pingy Wiki", ru: "Узнать больше о функционале можно в Wiki Pingy → " },
  "landing.feature1.title": { en: "No VPN", ru: "Без VPN" },
  "landing.feature1.desc": {
    en: "Works from Russia without workarounds. Chat always accessible.",
    ru: "Работает из России без обходов. Чат доступен всегда.",
  },
  "landing.feature2.title": { en: "Fast file uploads", ru: "Быстрая загрузка файлов" },
  "landing.feature2.desc": {
    en: "Up to 4 GB per file. Videos, documents — fast delivery.",
    ru: "До 4 ГБ на файл. Видео, документы — быстрая доставка.",
  },
  "landing.feature3.title": { en: "Real time", ru: "Сообщения в реальном времени" },
  "landing.feature3.desc": {
    en: "Voice, video, polls, stickers. Offline sync.",
    ru: "Голосовые, видео, опросы, стикеры. Офлайн-синхронизация.",
  },
  "landing.feature4.title": { en: "Encryption from Telegram", ru: "Шифрование как в Telegram" },
  "landing.feature4.desc": {
    en: "Based on Telegram protocols. Data protected.",
    ru: "На основе протоколов Telegram. Данные защищены.",
  },
  "landing.feature5.title": { en: "Free forever", ru: "Бесплатно навсегда" },
  "landing.feature5.desc": {
    en: "No trial, no expiry. Premium — optional.",
    ru: "Без пробного периода. Premium — по желанию.",
  },
  "landing.feature6.title": { en: "Import from Telegram", ru: "Импорт из Telegram" },
  "landing.feature6.desc": {
    en: "Transfer chats and channels. Keep communities.",
    ru: "Перенесите чаты и каналы. Сохраните сообщества.",
  },
  "landing.scope.title": { en: "From personal to community", ru: "От личного до сообщества" },
  "landing.scope.desc": {
    en: "Free account = all chats. Personal (2), group up to 10,000 members.",
    ru: "Free-аккаунт = все чаты. Личный (2), группа до 10 000 участников.",
  },
  "landing.scope.personal": { en: "Personal chat", ru: "Личный чат" },
  "landing.scope.group": { en: "Group", ru: "Группа" },
  "landing.scope.team": { en: "Team", ru: "Команда" },
  "landing.scope.community": { en: "Community", ru: "Сообщество" },
  "landing.cta.title": { en: "Start for free — no trial, no expiry", ru: "Pingy - мессенджер для всех" },
  "landing.cta.desc": {
    en: "Register, invite family, friends and colleagues — and connect without borders.",
    ru: "Регистрируйся, пригласи родных, друзей и коллег — общайся без границ.",
  },
  "landing.cta.button": { en: "Register for free", ru: "Начать общаться" },
  "landing.cta.buttonAuth": { en: "Go to messenger", ru: "Открыть мессенджер" },
  "landing.footer.copy": { en: "© Pingy", ru: "© Pingy" },
  "landing.downloads.desktop": { en: "Download desktop app", ru: "Скачать десктоп" },
  "landing.downloads.android": { en: "Download for Android", ru: "Скачать на Android" },
  "landing.downloads.forYourDevice": { en: "For your device", ru: "Для вашего устройства" },
  "landing.downloads.subtitle": { en: "Desktop (Windows, macOS, Linux) · Android app", ru: "Десктоп (Windows, macOS, Linux) · приложение для Android" },
  "landing.downloads.blockTitle": { en: "Download for your device", ru: "Скачать для вашего устройства" },
  "landing.downloads.blockSubtitle": { en: "Web, desktop and mobile apps", ru: "Веб, десктоп и мобильные приложения" },
  "landing.downloads.web": { en: "Web", ru: "Веб" },
  "landing.downloads.webDesc": { en: "Open in browser", ru: "Открыть в браузере" },
  "landing.downloads.windows": { en: "Windows", ru: "Windows" },
  "landing.downloads.windowsDesc": { en: "Download EXE", ru: "Скачать EXE" },
  "landing.downloads.androidLabel": { en: "Android", ru: "Android" },
  "landing.downloads.androidDesc": { en: "Download APK", ru: "Скачать APK" },
  "landing.downloads.macos": { en: "macOS", ru: "macOS" },
  "landing.downloads.ios": { en: "iPhone", ru: "iPhone" },
  "landing.downloads.ipados": { en: "iPad", ru: "iPad" },
  "landing.downloads.linux": { en: "Linux", ru: "Linux" },
  "landing.downloads.comingSoon": { en: "Coming soon", ru: "Будет позже" },
  "landing.downloads.clusterWeb": { en: "Web", ru: "Веб" },
  "landing.downloads.clusterDesktop": { en: "Desktop", ru: "Десктоп" },
  "landing.downloads.clusterMobile": { en: "Mobile", ru: "Мобилка" },

  "downloads.desktop.pageTitle": { en: "Download Pingy Desktop | Pingy", ru: "Скачать Pingy для ПК | Pingy" },
  "downloads.desktop.pageDesc": { en: "Download Pingy desktop app for Windows, macOS and Linux.", ru: "Скачайте десктопное приложение Pingy для Windows, macOS и Linux." },
  "downloads.desktop.title": { en: "Download Pingy for desktop", ru: "Скачать Pingy для ПК" },
  "downloads.desktop.desc": { en: "Pingy desktop app works on Windows, macOS and Linux. Use the web version if the installer is not yet available for your platform.", ru: "Десктопное приложение Pingy работает на Windows, macOS и Linux. Если установщик ещё не готов для вашей платформы — используйте веб-версию." },
  "downloads.desktop.windows": { en: "Download for Windows", ru: "Скачать для Windows" },
  "downloads.desktop.windowsNote": { en: "Windows 10/11, 64-bit. Installer, ~120 MB.", ru: "Windows 10/11, 64-bit. Установщик, ~120 МБ." },
  "downloads.desktop.alternatives": { en: "Other options", ru: "Другие варианты" },
  "downloads.desktop.webLabel": { en: "Web version", ru: "Веб-версия" },
  "downloads.desktop.webLink": { en: "Open in browser", ru: "Открыть в браузере" },
  "downloads.desktop.otherPlatforms": { en: "Coming soon. Use the web version for now.", ru: "Скоро. Пока используйте веб-версию." },
  "downloads.desktop.back": { en: "Back to main page", ru: "На главную" },

  "downloads.android.pageTitle": { en: "Download Pingy for Android | Pingy", ru: "Скачать Pingy для Android | Pingy" },
  "downloads.android.pageDesc": { en: "Download Pingy Android app (APK).", ru: "Скачайте приложение Pingy для Android (APK)." },
  "downloads.android.title": { en: "Download Pingy for Android", ru: "Скачать Pingy для Android" },
  "downloads.android.desc": { en: "Pingy Android app — install the APK on your device. Allow installation from unknown sources if prompted.", ru: "Приложение Pingy для Android — установите APK на устройство. При запросе разрешите установку из неизвестных источников." },
  "downloads.android.download": { en: "Download APK", ru: "Скачать APK" },
  "downloads.android.note": { en: "Android 5.0+. ~50 MB.", ru: "Android 5.0+. ~50 МБ." },
  "downloads.android.alternatives": { en: "Other options", ru: "Другие варианты" },
  "downloads.android.desktopLink": { en: "Download for PC", ru: "Скачать для ПК" },
  "downloads.android.back": { en: "Back to main page", ru: "На главную" },

  // ─── Settings page ───────────────────────────────────────
  "settings.version": { en: "Version", ru: "Версия" },
  "settings.profile": { en: "Profile", ru: "Профиль" },
  "settings.manageAvatars": { en: "Manage avatars", ru: "Управление аватарками" },
  "settings.enterName": { en: "Enter name", ru: "Введите имя" },
  "settings.noName": { en: "No name", ru: "Без имени" },
  "settings.editName": { en: "Edit name", ru: "Изменить имя" },
  "settings.statusEmoji": { en: "Status emoji", ru: "Статус-эмодзи" },
  "settings.statusEmojiNone": { en: "No status emoji", ru: "Без эмодзи" },
  "settings.copyUsernameLink": { en: "Copy link (others can message you)", ru: "Скопировать ссылку (другие смогут написать вам)" },
  "settings.editUsername": { en: "Edit username", ru: "Изменить username" },
  "settings.usernamePlaceholder": { en: "username", ru: "username" },
  "settings.noUsername": { en: "No username", ru: "Нет username" },
  "settings.phoneNotEditable": { en: "Phone number cannot be changed", ru: "Номер телефона изменить нельзя" },
  "settings.userId": { en: "Your ID", ru: "Ваш ID" },
  "settings.bio": { en: "Bio", ru: "О себе" },
  "settings.bioPlaceholder": { en: "Tell about yourself (visible to everyone who visits your profile)", ru: "Расскажите о себе (видят все, кто зайдёт в профиль)" },
  "settings.bioWithPremium": { en: "With Premium — up to 150 characters", ru: "с Premium — до 150 символов" },
  "settings.bioEmpty": { en: "No bio", ru: "Нет" },
  "settings.editBio": { en: "Edit bio", ru: "Изменить" },
  "settings.birthday": { en: "Birthday", ru: "День рождения" },
  "settings.birthdayPlaceholder": { en: "YYYY-MM-DD", ru: "ГГГГ-ММ-ДД" },
  "settings.birthdayWithoutYear": { en: "Without year", ru: "Без года" },
  "settings.birthdayEmpty": { en: "Not set", ru: "Не указано" },
  "settings.editBirthday": { en: "Edit birthday", ru: "Изменить" },
  "settings.personalChannel": { en: "Personal channel", ru: "Персональный канал" },
  "settings.noChannel": { en: "No channel yet", ru: "Канал не создан" },
  "settings.noChannelInProfile": { en: "Not added to profile", ru: "В профиле не указан" },
  "settings.addChannelToProfile": { en: "Add channel to profile", ru: "Добавить канал в профиль" },
  "settings.removeChannelFromProfile": { en: "Remove from profile", ru: "Убрать из профиля" },
  "settings.createChannel": { en: "Create channel", ru: "Создать канал" },
  "settings.settingsTitle": { en: "Settings", ru: "Настройки" },
  "settings.messageTextScale": { en: "Message text scale", ru: "Масштаб текста в сообщениях" },
  "settings.scalePreview": { en: "Preview", ru: "Пример" },
  "settings.scalePreviewMessage1": { en: "Hello! How are you?", ru: "Привет! Как дела?" },
  "settings.scalePreviewMessage2": { en: "Great, and you?", ru: "Отлично, а у тебя?" },
  "settings.scaleSmall": { en: "Small", ru: "Маленький" },
  "settings.scaleReduced": { en: "Reduced", ru: "Уменьшенный" },
  "settings.scaleNormal": { en: "Normal", ru: "Обычный" },
  "settings.scaleLarge": { en: "Large", ru: "Крупный" },
  "settings.scaleExtraLarge": { en: "Extra large", ru: "Очень крупный" },
  "settings.notifications": { en: "New message notifications", ru: "Уведомления о новых сообщениях" },
  "settings.notifHint": {
    en: "Show a popup when a new message arrives (even when the app is in the background).",
    ru: "Показывать всплывающее окно при новом сообщении (даже при свёрнутом приложении).",
  },
  "settings.language": { en: "Language", ru: "Язык" },
  "settings.theme": { en: "Theme", ru: "Тема" },
  "settings.themeLight": { en: "Light", ru: "Светлая" },
  "settings.themeDark": { en: "Dark", ru: "Тёмная" },
  "settings.notifNotSupported": { en: "Your browser does not support notifications.", ru: "Ваш браузер не поддерживает уведомления." },
  "settings.notifEnabled": { en: "Notifications enabled", ru: "Уведомления включены" },
  "settings.notifBlocked": {
    en: "Notifications blocked. Allow them in browser settings for this site.",
    ru: "Уведомления заблокированы. Разрешите их в настройках браузера для этого сайта.",
  },
  "settings.notifRequest": { en: "Requesting…", ru: "Запрос…" },
  "settings.notifEnable": { en: "Enable notifications", ru: "Включить уведомления" },
  "settings.notifBrowserPrompt": { en: "Browser prompt will appear", ru: "Появится запрос браузера" },
  "settings.sounds": { en: "Notification sounds", ru: "Звуки уведомлений" },
  "settings.enableSounds": { en: "Enable sounds", ru: "Включить звуки" },
  "settings.soundSend": { en: "Message sent", ru: "Отправка сообщения" },
  "settings.soundReceive": { en: "Message received", ru: "Получение сообщения" },
  "settings.soundMention": { en: "Mention", ru: "Упоминание" },
  "settings.activeSessions": { en: "Active sessions", ru: "Активные сессии" },
  "settings.noSessions": { en: "No active sessions.", ru: "Нет активных сессий." },
  "settings.unknownDevice": { en: "Unknown device", ru: "Неизвестное устройство" },
  "settings.currentSession": { en: "Current", ru: "Текущая" },
  "settings.loginAt": { en: "Login:", ru: "Вход:" },
  "settings.activeAt": { en: "Active:", ru: "Активна:" },
  "settings.terminateSession": { en: "Terminate", ru: "Завершить" },
  "settings.terminateAllOtherSessions": { en: "Terminate all other sessions", ru: "Завершить все другие сессии" },
  "settings.terminatingAll": { en: "Terminating...", ru: "Завершение..." },
  "settings.e2eeDevices": { en: "Devices (end-to-end encryption)", ru: "Устройства (сквозное шифрование)" },
  "settings.qrLogin": { en: "Login with QR", ru: "Вход по QR-коду" },
  "settings.qrLoginTitle": { en: "Login with QR", ru: "Вход по QR-коду" },
  "settings.qrLoginHint": {
    en: "Scan the QR code on another device, or enter the code manually.",
    ru: "Отсканируйте QR-код на другом устройстве или введите код вручную.",
  },
  "settings.qrLoginScanOrCode": {
    en: "Or enter this code on the new device:",
    ru: "Или введите этот код на новом устройстве:",
  },
  "settings.qrLoginExpires": { en: "Expires in", ru: "Истекает через" },
  "settings.qrLoginRefresh": { en: "Refresh", ru: "Обновить" },
  "settings.noDevices": { en: "No registered devices.", ru: "Нет зарегистрированных устройств." },
  "settings.endSession": { en: "End session", ru: "Завершить сессию" },
  "settings.privacy": { en: "Privacy", ru: "Конфиденциальность" },
  "settings.privacyPremiumOnly": { en: "Privacy settings are available with a subscription.", ru: "Настройки конфиденциальности доступны по подписке." },
  "settings.foldersPremiumOnly": { en: "Chat folders are available with a subscription.", ru: "Папки с чатами доступны по подписке." },
  "settings.goToPremium": { en: "Go to Premium", ru: "Перейти в Премиум" },
  "settings.navAccount": { en: "Account", ru: "Аккаунт" },
  "settings.navChatSettings": { en: "Chat settings", ru: "Настройки чатов" },
  "settings.navPrivacy": { en: "Privacy", ru: "Приватность" },
  "settings.navFolders": { en: "Chat folders", ru: "Папки с чатами" },
  "settings.navDevices": { en: "Devices", ru: "Устройства" },
  "settings.navPremium": { en: "Pingy Premium", ru: "Pingy Premium" },
  "settings.showLastSeen": { en: "Show last seen time", ru: "Показывать время последнего захода" },
  "settings.showLastSeenHint": { en: 'If off, others will see "recently online"', ru: "Если выключено, другие увидят «был(а) в сети недавно»" },
  "settings.showPhone": { en: "Show phone number", ru: "Показывать номер телефона" },
  "settings.showPhoneHint": { en: "If off, others won't see your number", ru: "Если выключено, другие не увидят ваш номер" },
  "settings.dmPrivacy": { en: "Who can message me directly", ru: "Кто может писать мне в ЛС" },
  "settings.dmPrivacyHint": { en: 'If "Nobody", new users can\'t message you first', ru: "Если «Никто», новые пользователи не смогут написать вам первыми" },
  "settings.groupPrivacy": { en: "Who can add me to groups", ru: "Кто может добавлять меня в группы" },
  "settings.groupPrivacyHint": { en: 'If "Nobody", you can\'t be invited to groups', ru: "Если «Никто», вас нельзя будет пригласить в группы" },
  "settings.subscription": { en: "Subscription", ru: "Подписка" },
  "settings.status": { en: "Status", ru: "Статус" },
  "settings.validUntil": { en: "Valid until", ru: "Действует до" },
  "settings.price": { en: "Price", ru: "Стоимость" },
  "settings.noSubscription": { en: "No subscription", ru: "Нет подписки" },
  "settings.referralTrial": {
    en: "Free account forever via referral link",
    ru: "Free-аккаунт навсегда по реферальной ссылке",
  },
  "settings.goToPayment": { en: "Redirecting to payment...", ru: "Переход к оплате..." },
  "settings.paymentError": { en: "Payment error", ru: "Ошибка оплаты" },
  "settings.paymentMethods": { en: "Payment methods", ru: "Способы оплаты" },
  "settings.addCard": { en: "Add card", ru: "Добавить карту" },
  "settings.unlinkPaymentMethod": { en: "Unlink payment method", ru: "Отвязать способ оплаты" },
  "settings.cardExpires": { en: "Expires", ru: "Действует до" },
  "settings.noPaymentMethods": { en: "No saved payment methods", ru: "Нет привязанных способов оплаты" },
  "settings.addCardHint": { en: "Card can be saved when you pay for a subscription below.", ru: "Карта сохранится при оплате подписки ниже." },
  "settings.referral": { en: "Invite friends", ru: "Пригласить друзей" },
  "settings.referralDesc": {
    en: "They get pingy forever. You get 1 month of subscription for every 10 invited friends.",
    ru: "Им — pingy. Вам — подписка на месяц за каждые 10 приглашённых друзей.",
  },
  "settings.transactionHistory": { en: "Transaction history", ru: "История операций" },
  "settings.loadProfileError": { en: "Could not load profile", ru: "Не удалось загрузить профиль" },
  "settings.myChats": { en: "My chats", ru: "Мои чаты" },
  "settings.techSupport": { en: "Support", ru: "Техподдержка" },

  // Status labels
  "status.trial": { en: "Trial period", ru: "Пробный период" },
  "status.active": { en: "Active", ru: "Активна" },
  "status.past_due": { en: "Past due", ru: "Просрочена" },
  "status.cancelled": { en: "Inactive", ru: "Не активна" },

  // Reason labels
  "reason.referral_inviter": { en: "Invited a user", ru: "Пригласил пользователя" },
  "reason.referral_invitee": { en: "Registered via link", ru: "Регистрация по ссылке" },
  "reason.chat_expansion": { en: "Chat expansion", ru: "Расширение чата" },
  "reason.admin_grant": { en: "Bonus", ru: "Бонус" },

  // ─── Chats page ─────────────────────────────────────────
  "dashboard.title": { en: "Chats", ru: "Чаты" },
  "dashboard.createChat": { en: "Create group", ru: "Создать группу" },
  "dashboard.myChats": { en: "My chats", ru: "Мои чаты" },
  "dashboard.noChats": { en: "No chats yet. Create your first one.", ru: "Чатов пока нет. Создайте первый." },
  "dashboard.loadError": { en: "Could not load chats", ru: "Не удалось загрузить чаты" },
  "subscription_required": { en: "Subscription required", ru: "Необходима подписка" },
  "dashboard.needsSub": { en: "Subscription required", ru: "Необходима подписка" },
  "dashboard.needsSubDesc": {
    en: "Subscribe to Premium to access the messenger.",
    ru: "Для доступа к мессенджеру оформите подписку Premium.",
  },
  "dashboard.goToPayment": { en: "Go to payment", ru: "Перейти к оплате" },
  "dashboard.personalChat": { en: "Personal chat", ru: "Личный чат" },
  "dashboard.openType": { en: "Open", ru: "Открытый" },
  "dashboard.closedType": { en: "Closed", ru: "Закрытый" },
  "dashboard.newMessage": { en: "New message", ru: "Новое сообщение" },
  "notification.addedToGroup": { en: "You were added to the group", ru: "Вас добавили в группу" },
  "notification.reactionOnMessage": { en: "{{name}} reacted \"{{emoji}}\" to {{message}}", ru: "{{name}} отреагировал \"{{emoji}}\" на {{message}}" },
  "dashboard.previewNote": { en: "Preview · chat not marked as read", ru: "Предпросмотр · чат не отмечен как прочитанный" },
  "dashboard.noChatMessages": { en: "No messages in this chat yet", ru: "В этом чате пока нет сообщений" },
  "dashboard.muted": { en: "Muted", ru: "Беззвучный" },
  "dashboard.freeTrialMonth": { en: " You have a free account forever!", ru: " У вас free-аккаунт навсегда!" },
  "dashboard.contextPreviewHint": { en: "Right-click / long press — preview", ru: "Правый клик / долгое нажатие — предпросмотр" },

  // ─── Messenger page ──────────────────────────────────────
  "messenger.chats": { en: "Chats", ru: "Чаты" },
  "messenger.allChats": { en: "All chats", ru: "Все чаты" },
  "messenger.menu": { en: "Menu", ru: "Меню" },
  "messenger.searchPlaceholder": { en: "Search chats and people...", ru: "Поиск..." },
  "messenger.noChatsYet": { en: "No chats yet", ru: "Чатов пока нет" },
  "messenger.noChatsDesc": {
    en: "Create a chat, join a group via an invite link, or invite friends to this messenger.",
    ru: "Создайте чат, вступите в группу по ссылке-приглашению или пригласите друзей в этот мессенджер.",
  },
  "messenger.createFirst": { en: "Create first chat", ru: "Создать первый чат" },
  "messenger.haveInvite": { en: "Have an invite link?", ru: "Есть ссылка-приглашение?" },
  "messenger.joinChat": { en: "Join chat", ru: "Вступить в чат" },
  "messenger.welcomeTitle": { en: "Welcome!", ru: "Добро пожаловать!" },
  "messenger.welcomeDesc": {
    en: "Your account is ready. In addition to creating a group and joining a group via invite link, you can also invite friends and try Favorites.",
    ru: "Ваш аккаунт готов. Помимо создания группы и вступления в группу по ссылке, вы можете пригласить друзей и попробовать Избранное.",
  },
  "messenger.welcomeCreateGroup": { en: "Create a group chat or channel", ru: "Создать групповой чат или канал" },
  "messenger.welcomeCreateGroupDesc": {
    en: "Invite friends and start chatting",
    ru: "Пригласите друзей и начните общение",
  },
  "messenger.welcomeJoin": { en: "Join a group via invite link", ru: "Вступить в группу по ссылке" },
  "messenger.welcomeJoinDesc": {
    en: "Got a link from a friend? Join the group",
    ru: "Получили ссылку от друга? Вступите в группу",
  },
  "messenger.welcomeInviteFriends": { en: "Invite friends", ru: "Пригласить друзей" },
  "messenger.welcomeInviteFriendsDesc": {
    en: "Friend gets free account forever, you get subscription months",
    ru: "Друг получит free-аккаунт навсегда, вы — месяцы подписки",
  },
  "messenger.welcomeInviteCopied": { en: "Link copied!", ru: "Ссылка скопирована!" },
  "messenger.inviteCopyLink": { en: "Copy link", ru: "Скопировать" },
  "messenger.inviteShare": { en: "Share", ru: "Поделиться" },
  "messenger.welcomeFavorites": { en: "Try Favorites", ru: "Попробовать Избранное" },
  "messenger.welcomeFavoritesDesc": {
    en: "Test messaging, save notes and files for yourself",
    ru: "Протестируйте отправку сообщений, сохраняйте заметки и файлы",
  },
  "messenger.joinByLink": { en: "Join by link", ru: "Вступить по ссылке" },
  "messenger.joinByLinkTitle": { en: "Join by link", ru: "Вступить по ссылке" },
  "messenger.joinByLinkDesc": {
    en: "Paste the invite link to a chat (sent by the chat owner).",
    ru: "Вставьте пригласительную ссылку на чат (её отправил владелец чата).",
  },
  "messenger.joinByLinkPlaceholder": { en: "https://…/chat/join/chat-name?code=…", ru: "https://…/chat/join/название-чата?code=…" },
  "messenger.joinLinkEmpty": { en: "Paste an invite link to a chat.", ru: "Вставьте пригласительную ссылку на чат." },
  "messenger.joinLinkBadFormat": { en: "Invalid link format. Paste a full invite link.", ru: "Неверный формат ссылки. Вставьте полную пригласительную ссылку." },
  "messenger.joinLinkMissing": { en: "The link must contain a path like …/chat/join/chat-name and a code parameter.", ru: "В ссылке должны быть путь вида …/chat/join/название-чата и параметр code." },
  "messenger.joining": { en: "Joining…", ru: "Вступление…" },
  "messenger.join": { en: "Join", ru: "Вступить" },
  "messenger.inviteLinkCopied": { en: "Invite link copied to clipboard", ru: "Ссылка-приглашение скопирована в буфер обмена" },
  "messenger.chatLinkCopied": { en: "Chat link copied to clipboard", ru: "Ссылка на чат скопирована в буфер обмена" },
  "messenger.newLoginTitle": { en: "New account login", ru: "Новый вход в аккаунт" },
  "messenger.newLoginDesc": { en: "Not you? Click to open session settings.", ru: "Не вы? Нажмите, чтобы открыть настройки сессий." },
  "messenger.pin": { en: "Pin", ru: "Закрепить" },
  "messenger.unpin": { en: "Unpin", ru: "Открепить" },
  "messenger.maxPinned": { en: "Maximum 5 pinned chats", ru: "Максимум 5 закреплённых чатов" },
  "messenger.enableNotif": { en: "Enable notifications", ru: "Включить уведомления" },
  "messenger.mute": { en: "Mute...", ru: "Без звука..." },
  "messenger.muteFor1h": { en: "1 hour", ru: "1 час" },
  "messenger.muteFor3h": { en: "3 hours", ru: "3 часа" },
  "messenger.muteFor8h": { en: "8 hours", ru: "8 часов" },
  "messenger.muteForever": { en: "Forever", ru: "Навсегда" },
  "messenger.markUnread": { en: "Mark as unread", ru: "Пометить непрочитанным" },
  "messenger.archive": { en: "Archive", ru: "В архив" },
  "messenger.unarchive": { en: "Unarchive", ru: "Из архива" },
  "messenger.archived": { en: "Archive", ru: "Архив" },
  "messenger.unread": { en: "Unread", ru: "Непрочитанное" },
  "messenger.unreadEmpty": { en: "No unread chats", ru: "Нет чатов с непрочитанными" },
  "messenger.noMatchingChats": { en: "No matching chats", ru: "Нет подходящих чатов" },
  "messenger.archiveEmpty": { en: "No archived chats yet", ru: "В архиве пока нет чатов" },
  "messenger.personalEmpty": { en: "No personal chats yet", ru: "Нет личных чатов" },
  "messenger.users": { en: "Users", ru: "Пользователи" },
  "messenger.searching": { en: "Searching…", ru: "Поиск…" },
  "messenger.noUsersFound": { en: "Nobody found", ru: "Никого не найдено" },
  "messenger.muted": { en: "Muted", ru: "Без звука" },
  "messenger.openChatError": { en: "An error occurred while opening the chat.", ru: "Произошла ошибка при открытии чата." },
  "messenger.pinned": { en: "Pinned", ru: "Закреплён" },
  "messenger.resizeSidebar": { en: "Resize chat list", ru: "Изменить ширину списка чатов" },

  // ─── Folders ─────────────────────────────────────────────
  "folders.create": { en: "Create folder", ru: "Создать папку" },
  "folders.createTitle": { en: "Create folder", ru: "Создать папку" },
  "folders.name": { en: "Folder name", ru: "Название папки" },
  "folders.namePlaceholder": { en: "Name", ru: "Название" },
  "folders.addToFolder": { en: "Add to folder", ru: "Добавить в папку" },
  "folders.removeFromFolder": { en: "Remove from folder", ru: "Убрать из папки" },
  "folders.emptyFolder": { en: "No chats in this folder. Right-click a chat and add it to a folder.", ru: "В этой папке пока нет чатов. Правый клик по чату — добавить в папку." },
  "folders.enabled": { en: "Folders", ru: "Папки" },
  "folders.standardFolders": { en: "Standard folders", ru: "Стандартные папки" },
  "folders.standardPersonal": { en: "Personal", ru: "Персональное" },
  "folders.standardUnread": { en: "Unread", ru: "Непрочитанное" },
  "folders.standardArchive": { en: "Archive", ru: "Архив" },
  "folders.tabsView": { en: "Tabs view", ru: "Вид папок" },
  "folders.tabsLeft": { en: "Tabs on the left", ru: "Вкладки слева" },
  "folders.tabsTop": { en: "Tabs at the top", ru: "Вкладки сверху" },
  "folders.color": { en: "Tab color", ru: "Цвет вкладки" },
  "folders.chatsInFolder": { en: "Chats in folder", ru: "Чаты в папке" },
  "folders.addChatToFolder": { en: "Add chat to folder", ru: "Добавить чат в папку" },
  "folders.settings": { en: "Folder settings", ru: "Настройки папки" },

  // ─── Feedback & Support ─────────────────────────────────────
  "support.menu": { en: "Support", ru: "Поддержка" },
  "feedback.title": { en: "Send feedback", ru: "Обратная связь" },
  "feedback.desc": { en: "For improvements and new features.", ru: "Доработки и улучшение функционала." },
  "feedback.placeholder": { en: "Describe your suggestion or improvement…", ru: "Опишите пожелание или идею…" },
  "feedback.attachPhotos": { en: "Attach photos or screenshots", ru: "Прикрепить фото или скрины" },
  "feedback.sent": { en: "Thank you! Your message has been sent.", ru: "Спасибо! Сообщение отправлено." },
  "support.title": { en: "Technical support", ru: "Техническая поддержка" },
  "support.desc": { en: "For urgent issues. We'll respond as soon as possible.", ru: "Для экстренных обращений. Ответим в ближайшее время." },
  "support.placeholder": { en: "Describe the problem in detail…", ru: "Опишите проблему подробно…" },
  "support.attachPhotos": { en: "Attach photos or screenshots", ru: "Прикрепить фото или скрины проблемы" },
  "support.topic": { en: "Topic", ru: "Тема" },
  "support.topicGeneral": { en: "General support", ru: "Общий вопрос" },
  "support.topicReservedUsername": { en: "Request reserved username for channel", ru: "Запрос reserved username для канала" },
  "support.topicBug": { en: "Report a bug", ru: "Рассказать о баге" },

  // ─── Create chat modal ───────────────────────────────────
  "createChat.title": { en: "Create group", ru: "Создать группу" },
  "createChat.afterCreateHint": { en: "After creating you can invite members by link.", ru: "После создания вы сможете пригласить участников по ссылке." },
  "createChat.addPhoto": { en: "Add photo", ru: "Добавить фото" },
  "createChat.chatName": { en: "Chat name", ru: "Название чата" },
  "createChat.namePlaceholder": { en: "Name", ru: "Название" },
  "createChat.enterName": { en: "Enter name", ru: "Введите название" },
  "createChat.description": { en: "Description", ru: "Описание" },
  "createChat.descPlaceholder": { en: "What's this chat about?", ru: "О чём этот чат?" },
  "createChat.chatType": { en: "Chat type", ru: "Тип чата" },
  "createChat.open": { en: "Open", ru: "Открытый" },
  "createChat.closed": { en: "Closed", ru: "Закрытый" },
  "createChat.typeHint": { en: "Anyone can join an open chat by link. Closed chats require approval.", ru: "В открытый чат может войти любой по ссылке. В закрытый — только после одобрения." },
  "createChat.creating": { en: "Creating…", ru: "Создание…" },
  "createChat.create": { en: "Create", ru: "Создать" },
  "createChat.sessionExpired": { en: "Session expired. Please log in again.", ru: "Сессия истекла или вы вышли. Войдите снова." },
  "createChat.needsSubscription": { en: "Active subscription required to create chats. Subscribe in settings.", ru: "Для создания чатов нужна активная подписка. Оформите подписку в настройках." },
  "createChat.serverError": { en: "Could not connect to server.", ru: "Не удалось подключиться к серверу." },
  "createChat.genericError": { en: "Error creating chat", ru: "Ошибка создания чата" },
  "createChat.fixErrors": { en: "Please fix the errors below.", ru: "Исправьте ошибки в форме." },
  "createChat.maxChars": { en: "Max %s characters", ru: "Максимум %s символов" },
  "createChat.titleIcon": { en: "Icon to the right of name", ru: "Иконка справа от названия" },
  "createChat.noIcon": { en: "No icon", ru: "Без иконки" },

  // ─── Create channel modal ─────────────────────────────────
  "createChannel.title": { en: "Create channel", ru: "Создать канал" },
  "createChannel.afterCreateHint": { en: "Share the invite link so others can join.", ru: "Поделитесь ссылкой-приглашением, чтобы подписчики могли вступить." },
  "createChannel.channelName": { en: "Channel name", ru: "Название канала" },
  "createChannel.typeHint": { en: "Open: anyone can join by link. Closed: you approve each join request.", ru: "Открытый: любой может вступить по ссылке. Закрытый: вы одобряете каждую заявку." },
  "createChannel.username": { en: "Channel link (username)", ru: "Ссылка на канал (username)" },
  "createChannel.usernameHint": { en: "Latin, digits, underscore, 3–30 chars. Unique among users and channels. Required.", ru: "Латиница, цифры, подчёркивание, 3–30 символов. Уникален среди пользователей и каналов. Обязательно." },
  "createChannel.usernameRequired": { en: "Enter channel username", ru: "Укажите username канала" },
  "createChannel.creating": { en: "Creating…", ru: "Создание…" },
  "createChannel.create": { en: "Create", ru: "Создать" },
  "createChannel.done": { en: "Channel created", ru: "Канал создан" },
  "createChannel.doneHint": { en: "Channel %s created. You can import history from Telegram or close.", ru: "Канал %s создан. Можно импортировать историю из Telegram или закрыть." },
  "createMenu.createChat": { en: "Create group", ru: "Создать группу" },
  "createMenu.createChannel": { en: "Create channel", ru: "Создать канал" },

  // ─── Channel import (Telegram export) ─────────────────────────
  "channelImport.title": { en: "Import from Telegram", ru: "Импорт из Telegram" },
  "channelImport.menuItem": { en: "Import history from Telegram", ru: "Импортировать историю из Telegram" },
  "channelImport.subtitle": { en: "Import history into channel %s", ru: "Импорт истории в канал %s" },
  "channelImport.hint": {
    en: "Export your channel in Telegram Desktop (Settings → Advanced → Export Telegram data), choose JSON format, then upload the ZIP file here.",
    ru: "Экспортируйте канал в Telegram Desktop (Настройки → Дополнительно → Экспорт данных Telegram), выберите формат JSON и загрузите ZIP-архив.",
  },
  "channelImport.browse": { en: "Select ZIP file...", ru: "Выберите ZIP-файл..." },
  "channelImport.selectFile": { en: "Select a ZIP file.", ru: "Выберите ZIP-файл." },
  "channelImport.zipOnly": { en: "File must be a ZIP archive.", ru: "Файл должен быть ZIP-архивом." },
  "channelImport.import": { en: "Import", ru: "Импортировать" },
  "channelImport.importing": { en: "Importing…", ru: "Импорт…" },
  "channelImport.imported": { en: "Imported %s posts.", ru: "Импортировано постов: %s." },
  "channelImport.someErrors": { en: "Errors (%s):", ru: "Ошибок (%s):" },
  "channelImport.error": { en: "Import failed.", ru: "Ошибка импорта." },
  "createMenu.createGroup": { en: "Create group", ru: "Создать группу" },

  // ─── Channel page ────────────────────────────────────────
  "channelPage.backToChats": { en: "To chats", ru: "К чатам" },
  "channelPage.publish": { en: "Publish", ru: "Опубликовать" },
  "channelPage.publishing": { en: "Publishing…", ru: "Публикация…" },
  "channelPage.contentPlaceholder": { en: "Write a post (Markdown supported)…", ru: "Напишите пост (поддерживается Markdown)…" },
  "channelPage.addPhotos": { en: "Add photos", ru: "Добавить фото" },
  "channelPage.loading": { en: "Loading channel…", ru: "Загрузка канала…" },
  "channelPage.noPosts": { en: "No posts yet", ru: "Пока нет постов" },
  "channelPage.publishError": { en: "Failed to publish post", ru: "Не удалось опубликовать пост" },
  "channelPage.channelNotFound": { en: "Channel not found", ru: "Канал не найден" },
  "channelPage.onlyAuthorCanPost": { en: "Only the channel author can post", ru: "Публиковать может только автор канала" },

  // ─── Secret chat ──────────────────────────────────────────
  "secretChat.title": { en: "Secret chat", ru: "Секретный чат" },
  "secretChat.createTitle": { en: "Create secret chat", ru: "Создать секретный чат" },
  "secretChat.warningTitle": { en: "Secret chat limitations", ru: "Ограничения секретного чата" },
  "secretChat.warning1": { en: "Messages are end-to-end encrypted — only you and the recipient can read them.", ru: "Сообщения зашифрованы сквозным шифрованием — их можете прочитать только вы и собеседник." },
  "secretChat.warning2": { en: "Messages are NOT synced between devices. You can only read them on the device where you sent or received them.", ru: "Сообщения НЕ синхронизируются между устройствами. Вы сможете прочитать их только на том устройстве, где отправили или получили." },
  "secretChat.warning3": { en: "Server search is unavailable — the server does not have access to your messages.", ru: "Серверный поиск недоступен — сервер не имеет доступа к вашим сообщениям." },
  "secretChat.warning4": { en: "If you clear app data, the message history will be lost.", ru: "При очистке данных приложения история сообщений будет потеряна." },
  "secretChat.confirm": { en: "Create secret chat", ru: "Создать секретный чат" },

  // ─── Message search ──────────────────────────────────────
  "search.placeholder": { en: "Search messages…", ru: "Поиск сообщений…" },
  "search.noResults": { en: "No messages found", ru: "Сообщений не найдено" },
  "search.result": { en: "%n message found", ru: "%n сообщение найдено" },
  "search.results": { en: "%n messages found", ru: "%n сообщений найдено" },
  "search.secretLocal": { en: "Search in secret chat (local only)", ru: "Поиск в секретном чате (только локально)" },
  "search.globalPlaceholder": { en: "Search across all chats…", ru: "Поиск по всем чатам…" },

  // ─── Join chat modal ─────────────────────────────────────
  "joinChat.title": { en: "Joining chat", ru: "Вступление в чат" },
  "joinChat.kicked": { en: "You have been kicked from the chat.", ru: "Вы были исключены из чата." },
  "joinChat.badLink": { en: "Invalid link or code.", ru: "Неверная ссылка или код." },
  "joinChat.pendingApproval": { en: "Request sent. Waiting for chat owner approval.", ru: "Запрос отправлен. Ожидайте подтверждения от владельца чата." },
  "joinChat.joined": { en: "You joined the chat.", ru: "Вы вступили в чат." },
  "joinChat.joinError": { en: "Could not join the chat.", ru: "Не удалось вступить в чат." },
  "joinChat.alreadyPending": { en: "Request already sent. Waiting for approval.", ru: "Запрос уже отправлен. Ожидайте подтверждения." },
  "joinChat.infoOnlyForMembers": { en: "Information available only to members", ru: "Информация доступна только участникам" },

  // ─── Chat page ───────────────────────────────────────────
  "chat.loadError": { en: "Chat not found.", ru: "Чат не найден." },
  "chat.toChatList": { en: "To chat list", ru: "К списку чатов" },
  "chat.chatInfo": { en: "Chat info", ru: "Информация о чате" },
  "chat.e2ee": { en: "End-to-end encryption", ru: "Сквозное шифрование" },
  "chat.aboutChat": { en: "About chat", ru: "О чате" },
  "chat.profileTitle": { en: "Profile", ru: "Профиль" },
  "chat.admin": { en: "Admin", ru: "Админ" },
  "chat.administrator": { en: "Administrator", ru: "Администратор" },
  "chat.member": { en: "Member", ru: "Участник" },
  "chat.add": { en: "Add", ru: "Добавить" },
  "chat.pendingRequests": { en: "Join requests", ru: "Заявки" },
  "chat.hide": { en: "Hide", ru: "Скрыть" },
  "chat.hideJoinRequests": { en: "Hide panel; approve only in chat info", ru: "Скрыть панель; одобрять только в описании чата" },
  "chat.type": { en: "Type", ru: "Тип" },
  "chat.participants": { en: "Members", ru: "Участники" },
  "chat.media": { en: "Media", ru: "Медиа" },
  "chat.links": { en: "Links", ru: "Ссылки" },
  "chat.files": { en: "Files", ru: "Файлы" },
  "chat.voiceMessages": { en: "Voice messages", ru: "Голосовые" },
  "chat.voiceMessage": { en: "Voice message", ru: "Голосовое сообщение" },
  "chat.videoCircles": { en: "Video circles", ru: "Кружочки" },
  "chat.noVoiceMessages": { en: "No voice messages", ru: "Нет голосовых" },
  "chat.noVideoCircles": { en: "No video circles", ru: "Нет кружочков" },
  "chat.messagePlaceholder": { en: "Message...", ru: "Сообщение..." },
  "chat.enterToSend": { en: "Enter — send, Shift+Enter — new line", ru: "Enter — отправить, Shift+Enter — новая строка" },
  "chat.attach": { en: "Attach", ru: "Прикрепить" },
  "chat.attachFile": { en: "File", ru: "Файл" },
  "chat.attachImage": { en: "Image", ru: "Изображение" },
  "chat.attachLocation": { en: "Location", ru: "Геопозиция" },
  "chat.attachContact": { en: "Contact", ru: "Контакт" },
  "chat.locationError": { en: "Could not get location", ru: "Не удалось получить геопозицию" },
  "chat.locationDenied": { en: "Location access denied", ru: "Доступ к геопозиции запрещён" },
  "chat.pickContact": { en: "Choose contact", ru: "Выберите контакт" },
  "chat.noContacts": { en: "No contacts", ru: "Нет контактов" },
  "chat.emoji": { en: "Emoji", ru: "Эмодзи" },
  "chat.stickersAndGif": { en: "Stickers & GIF", ru: "Стикеры и GIF" },
  "chat.videoCircle": { en: "Video circle", ru: "Кружочек" },
  "chat.voiceMsg": { en: "Voice message (right-click — AI input)", ru: "Голосовое сообщение (правый клик — AI-ввод и мгновенная транскрипция)" },
  "chat.stopDictation": { en: "Stop dictation", ru: "Остановить диктовку" },
  "chat.aiVoiceInput": { en: "AI voice input (transcription to field)", ru: "AI-голосовой ввод (транскрипция в поле)" },
  "chat.cancelRecording": { en: "Cancel", ru: "Отменить" },
  "chat.cancelReply": { en: "Cancel reply", ru: "Отменить ответ" },
  "chat.scrollDown": { en: "Scroll down", ru: "Вниз" },
  "chat.sending": { en: "Sending…", ru: "Отправляется…" },
  "chat.typing": { en: "is typing…", ru: "печатает…" },
  "chat.read": { en: "Read", ru: "Прочитано" },
  "chat.delivered": { en: "Delivered", ru: "Доставлено" },
  "chat.enterUrl": { en: "Enter URL:", ru: "Введите URL:" },
  "chat.chatPhoto": { en: "Chat photo", ru: "Фото чата" },
  "chat.fullPhoto": { en: "Full photo", ru: "Полное фото" },
  "chat.viewPhoto": { en: "View photo", ru: "Просмотреть фото" },
  "chat.editPhoto": { en: "Edit photo", ru: "Изменить фото" },
  "chat.cropDrawText": { en: "Crop, draw, add text", ru: "Обрезать, рисовать, писать текст" },
  "chat.editChatName": { en: "Edit chat name", ru: "Изменить название" },
  "chat.chatNamePlaceholder": { en: "Chat name", ru: "Название чата" },
  "chat.editDescription": { en: "Edit description", ru: "Изменить описание" },
  "chat.descPlaceholder": { en: "Add group description...", ru: "Добавьте описание группы..." },
  "chat.slowMode": { en: "Slow mode", ru: "Медленный режим" },
  "chat.slowModeHint": { en: "Min seconds between messages per user (owners/admins exempt)", ru: "Минимальный интервал между сообщениями (владелец и админы не ограничены)" },
  "chat.slowModeOff": { en: "Off", ru: "Выкл" },
  "chat.slowMode1s": { en: "1 s", ru: "1 с" },
  "chat.slowMode5s": { en: "5 s", ru: "5 с" },
  "chat.slowMode15s": { en: "15 s", ru: "15 с" },
  "chat.slowMode60s": { en: "1 min", ru: "1 мин" },
  "chat.slowMode300s": { en: "5 min", ru: "5 мин" },
  "chat.slowModeError": { en: "Wait %n sec before sending", ru: "Подождите %n сек. перед отправкой" },
  "chat.alreadyInChat": { en: "You're already in this chat", ru: "Вы уже в этом чате" },
  "chat.inviteError": { en: "Could not invite", ru: "Не удалось пригласить" },
  "chat.leaveChat": { en: "Are you sure you want to leave the chat?", ru: "Вы уверены, что хотите выйти из чата?" },
  "chat.leave": { en: "Leave", ru: "Выйти из чата" },
  "chat.leaveError": { en: "Could not leave the chat", ru: "Не удалось выйти из чата" },
  "chat.deleteChat": { en: "Delete chat permanently? All messages will be lost.", ru: "Удалить чат безвозвратно? Все сообщения будут недоступны." },
  "chat.deleteError": { en: "Could not delete chat", ru: "Не удалось удалить чат" },
  "chat.micAccessDenied": { en: "Microphone access denied. Allow in browser settings.", ru: "Доступ к микрофону запрещён. Разрешите в настройках браузера." },
  "chat.micAccessFailed": { en: "Could not access microphone. Allow in browser settings.", ru: "Не удалось получить доступ к микрофону. Разрешите в настройках браузера." },
  "chat.voiceTooLarge": { en: "Voice message is larger than 2 GB.", ru: "Голосовое сообщение больше 2 ГБ." },
  "chat.serverBadResponse": { en: "Server returned invalid response", ru: "Сервер вернул некорректный ответ" },
  "chat.sendError": { en: "Could not send message", ru: "Не удалось отправить сообщение" },
  "chat.messageTooLong": { en: "Message is too long.", ru: "Сообщение слишком длинное." },
  "chat.charCountLimit": { en: "%s/4096 characters", ru: "%s/4096 символов" },
  "chat.uploadError": { en: "File upload error", ru: "Ошибка загрузки файла" },
  "chat.uploadErrorMultiple": { en: "Files upload error", ru: "Ошибка загрузки файлов" },
  "chat.progressMB": { en: "MB", ru: "Мб" },
  "chat.uploading": { en: "Uploading…", ru: "Загрузка…" },
  "chat.cancelUpload": { en: "Cancel upload", ru: "Отменить загрузку" },
  "chat.downloading": { en: "Downloading…", ru: "Скачивание…" },
  "chat.speechNotSupported": { en: "Speech recognition not supported in this browser (Chrome or Edge required).", ru: "Распознавание речи не поддерживается в этом браузере (нужен Chrome или Edge)." },
  "chat.speechStartError": { en: "Could not start speech recognition.", ru: "Не удалось запустить распознавание речи." },
  "chat.cameraAccessDenied": { en: "Camera access denied. Allow in browser settings.", ru: "Доступ к камере запрещён. Разрешите в настройках браузера." },
  "chat.cameraAccessFailed": { en: "Could not access camera. Allow in browser settings.", ru: "Не удалось получить доступ к камере. Разрешите в настройках браузера." },
  "chat.expandError": { en: "Could not expand chat", ru: "Не удалось расширить чат" },
  "chat.avatarTooLarge": { en: "Avatar file is larger than 2 GB.", ru: "Файл аватара больше 2 ГБ." },
  "chat.bgTooLarge": { en: "Background file is larger than 2 GB.", ru: "Файл фона больше 2 ГБ." },
  "chat.copyLink": { en: "Copy link", ru: "Копировать ссылку" },
  "chat.share": { en: "Share", ru: "Поделиться" },
  "chat.shareTitle": { en: "Join private chats", ru: "Присоединяйся к чатам" },
  "chat.shareText": { en: "Register via my link — free account forever.", ru: "Зарегистрируйся по моей ссылке — free-аккаунт навсегда." },
  "chat.searchChat": { en: "Search chat...", ru: "Поиск чата..." },
  "chat.enterUsername": { en: "Enter @username", ru: "Введите @username" },
  "chat.mentionLabel": { en: "Mention", ru: "Упоминание" },
  "chat.megaGroup": { en: "Mega group", ru: "Мега группа" },
  "chat.kiloGroup": { en: "Kilo group", ru: "Кило группа" },
  "chat.group": { en: "Group", ru: "Группа" },
  "chat.upTo10k": { en: "Up to 10,000 members", ru: "До 10 000 участников" },
  "chat.upTo1k": { en: "Up to 1,000 members", ru: "До 1 000 участников" },
  "chat.upTo100": { en: "Up to 100 members", ru: "До 100 участников" },
  "chat.maxReactions": { en: "Max 3 reactions", ru: "Макс. 3 реакции" },
  "chat.contextCopied": { en: "Copied", ru: "Скопировано" },
  "chat.contextCopy": { en: "Copy", ru: "Копировать" },
  "chat.copyForWord": { en: "Copy for Word", ru: "Копировать для Word" },
  "chat.edit": { en: "Edit", ru: "Редактировать" },
  "chat.editMessage": { en: "Edit message", ru: "Редактировать сообщение" },
  "chat.pause": { en: "Pause", ru: "Пауза" },
  "chat.play": { en: "Play", ru: "Воспроизвести" },
  "chat.seekWave": { en: "Seek: click on wave", ru: "Перемотка: клик по волне" },
  "chat.assignAdminFirst": { en: "Assign another admin first", ru: "Сначала назначьте другого администратора" },
  "chat.personal": { en: "Personal", ru: "Личный" },
  "chat.backToChat": { en: "About chat", ru: "О чате" },
  "chat.addToContacts": { en: "Add to contacts", ru: "Добавить в контакты" },
  "chat.inContacts": { en: "In contacts", ru: "В контактах" },
  "chat.editContact": { en: "Edit contact name", ru: "Изменить имя в контактах" },
  "chat.removeFromContacts": { en: "Remove from contacts", ru: "Удалить из контактов" },
  "chat.contactNamePlaceholder": { en: "Contact name (visible only to you)", ru: "Имя контакта (видно только вам)" },
  "chat.personInfo": { en: "Person info", ru: "Информация о человеке" },
  "chat.noLinks": { en: "No links", ru: "Нет ссылок" },
  "chat.noFiles": { en: "No files", ru: "Нет файлов" },
  "chat.fileCaption": { en: "Caption", ru: "Подпись" },
  "chat.fileCaptionPlaceholder": { en: "Add a caption (optional)", ru: "Добавить подпись (необязательно)" },
  "chat.noMedia": { en: "No media", ru: "Нет медиа" },
  "chat.upgradeDesc": { en: "Group supports up to 10,000 members.", ru: "В группе до 10 000 участников." },
  "chat.inviteFriendsStars": { en: "Invite friends — earn ★ 10 stars each", ru: "Приглашайте друзей — за каждого ★ 10 звёзд" },
  "chat.daily": { en: "daily", ru: "ежедн." },
  "chat.weekly": { en: "weekly", ru: "еженед." },
  "chat.schedule": { en: "Schedule", ru: "Запланировать" },
  "chat.scheduleEnterText": { en: "Enter message text.", ru: "Введите текст сообщения." },
  "chat.scheduleSetTime": { en: "Set date and time.", ru: "Укажите дату и время отправки." },
  "chat.scheduleInFuture": { en: "Time must be in the future.", ru: "Время отправки должно быть в будущем." },
  "chat.scheduleSaveError": { en: "Save error.", ru: "Ошибка сохранения." },
  "chat.scheduleSaving": { en: "Saving…", ru: "Сохранение…" },
  "chat.messageSchedule": { en: "Message...", ru: "Сообщение..." },
  "chat.scheduledMessageTitle": { en: "Scheduled message", ru: "Отложенное сообщение" },
  "chat.scheduleLabelText": { en: "Text (Markdown supported)", ru: "Текст (поддерживается Markdown)" },
  "chat.scheduleLabelWhen": { en: "When to send", ru: "Когда отправить" },
  "chat.scheduleLabelDate": { en: "Date", ru: "Дата" },
  "chat.scheduleLabelTime": { en: "Time", ru: "Время" },
  "chat.scheduleLabelRepeat": { en: "Repeat", ru: "Повтор" },
  "chat.scheduleOnce": { en: "Once", ru: "Один раз" },
  "chat.scheduleEveryDay": { en: "Every day", ru: "Каждый день" },
  "chat.scheduleWeekly": { en: "Weekly", ru: "Раз в неделю" },
  "chat.scheduleLabelWeekday": { en: "Weekday", ru: "День недели" },
  "chat.featureInDev": { en: "Feature under development", ru: "Функционал в разработке" },
  "chat.messageDeleted": { en: "Message deleted", ru: "Сообщение удалено" },
  "chat.messageDeleteError": { en: "Could not delete message.", ru: "Не удалось удалить сообщение." },
  "chat.conversationStart": { en: "Start of chat", ru: "Начало чата" },
  "chat.favoritesTitle": { en: "Favorites", ru: "Избранное" },
  "chat.favoritesHint": {
    en: "Your personal space for notes. Save messages, links, files — only you can see them.",
    ru: "Личное пространство для заметок. Сохраняйте сообщения, ссылки, файлы — видите только вы.",
  },
  "chat.emptyChat": { en: "No messages yet", ru: "Здесь пока нет сообщений" },
  "chat.emptyChatHint": {
    en: "Write the first message below — text, emoji or send a file.",
    ru: "Напишите первое сообщение в поле ввода ниже — текст, эмодзи или отправьте файл.",
  },

  // "last seen" strings
  "chat.lastSeen.recently": { en: "last seen recently", ru: "был(а) в сети недавно" },
  "chat.lastSeen.justNow": { en: "last seen just now", ru: "был(а) в сети только что" },
  "chat.lastSeen.yesterday": { en: "last seen yesterday", ru: "был(а) в сети вчера" },

  // Date labels
  "date.today": { en: "Today", ru: "Сегодня" },
  "date.yesterday": { en: "Yesterday", ru: "Вчера" },

  // Weekdays
  "weekday.mon": { en: "Mon", ru: "Пн" },
  "weekday.tue": { en: "Tue", ru: "Вт" },
  "weekday.wed": { en: "Wed", ru: "Ср" },
  "weekday.thu": { en: "Thu", ru: "Чт" },
  "weekday.fri": { en: "Fri", ru: "Пт" },
  "weekday.sat": { en: "Sat", ru: "Сб" },
  "weekday.sun": { en: "Sun", ru: "Вс" },

  // member counts (parameterized helpers will format these)
  "chat.nMembers": { en: "member", ru: "участник" },
  "chat.nMembers2_4": { en: "members", ru: "участника" },
  "chat.nMembers5plus": { en: "members", ru: "участников" },

  // forward modal
  "chat.forwardSending": { en: "Sending…", ru: "Отправка…" },
  "chat.forward": { en: "Forward", ru: "Переслать" },
  "chat.forwardMessage": { en: "Forward message", ru: "Переслать сообщение" },
  "chat.forwarded": { en: "Forwarded", ru: "Переслано" },
  "chat.select": { en: "Select", ru: "Выбрать" },
  "chat.selectMode": { en: "Select messages", ru: "Выбрать сообщения" },
  "chat.cancelSelect": { en: "Cancel", ru: "Отмена" },
  "chat.deleteSelected": { en: "Delete", ru: "Удалить" },
  "chat.forwardSelected": { en: "Forward", ru: "Переслать" },
  "chat.online": { en: "online", ru: "в сети" },
  "chat.deleteAfterRead": { en: "Delete after recipient views", ru: "Удалить после просмотра" },
  "chat.sendWithoutSound": { en: "Send without sound", ru: "Отправить без звука" },
  "chat.poll": { en: "Poll", ru: "Опрос" },
  "chat.pollQuestion": { en: "Question", ru: "Вопрос" },
  "chat.pollOption": { en: "Option", ru: "Вариант" },
  "chat.pollAddOption": { en: "Add option", ru: "Добавить вариант" },
  "chat.pollMultiple": { en: "Multiple choice", ru: "Несколько вариантов" },
  "chat.pollAnonymous": { en: "Anonymous voting", ru: "Анонимное голосование" },
  "chat.pollQuiz": { en: "Quiz (one correct answer)", ru: "Викторина (один правильный ответ)" },
  "chat.pollCorrectAnswer": { en: "Correct answer", ru: "Правильный ответ" },
  "chat.pollCreate": { en: "Create poll", ru: "Создать опрос" },
  "chat.pollUnvote": { en: "Revoke vote", ru: "Снять голос" },
  "chat.pollViewResults": { en: "View results", ru: "Посмотреть ответы" },
  "chat.pollHideResults": { en: "Hide results", ru: "Скрыть ответы" },

  // ─── File size warnings (parameterized) ──────────────────
  "chat.fileTooLargeNamed": { en: 'File "%s" is larger than 2 GB.', ru: "Файл «%s» больше 2 ГБ." },
  "chat.fileTooLarge": { en: "File is larger than 2 GB.", ru: "Файл больше 2 ГБ." },

  // ─── Subscription-related text in createChat / dashboard ─
  "sub.pricePerMonth": { en: "rub./mo.", ru: "руб./мес." },
  "sub.noSubDesc": { en: "No active subscription.", ru: "Подписка не оформлена." },
  "sub.planRestriction": { en: "This feature requires a subscription. Subscribe in settings.", ru: "Эта функция доступна по подписке. Оформите подписку в настройках." },
  "sub.subscribe": { en: "Subscribe", ru: "Оформить подписку" },

  "premiumModal.title": { en: "Pingy Premium", ru: "Pingy Premium" },
  "premiumModal.subtitle": {
    en: "More possibilities for communication and self-expression.",
    ru: "Больше возможностей для общения и самовыражения.",
  },
  "premiumModal.benefitFiles": { en: "Files up to 4 GB", ru: "Файлы до 4 ГБ" },
  "premiumModal.benefitFileUploads": { en: "Unlimited document uploads (instead of 20 per day)", ru: "Безлимитная загрузка документов (вместо 20 в день)" },
  "premiumModal.benefitAvatars": { en: "Up to 50 avatars in profile", ru: "До 50 аватарок в профиле" },
  "premiumModal.benefitPins": { en: "Up to 10 pinned chats", ru: "До 10 закреплённых чатов" },
  "premiumModal.benefitReactions": { en: "Up to 3 reactions per message", ru: "До 3 реакций на сообщение" },
  "premiumModal.benefitVideoCircles": { en: "Video circles in chats", ru: "Видео-кружки в чатах" },
  "premiumModal.benefitPolls": { en: "Polls and quizzes", ru: "Викторины и опросы" },
  "premiumModal.benefitScheduled": { en: "Scheduled messages", ru: "Отложенные сообщения" },
  "premiumModal.benefitFolders": { en: "Chat folders and tabs", ru: "Папки с чатами и вкладки" },
  "premiumModal.benefitChannels": { en: "Run channels without limits", ru: "Веди каналы без ограничений" },
  "premiumModal.benefitTelegramImport": { en: "Import chat and channel history from Telegram", ru: "Импорт истории чатов и каналов из телеграмм" },
  "premiumModal.benefitStickers": { en: "Custom sticker packs", ru: "Свои наборы стикеров" },
  "premiumModal.benefitBio": { en: "Extended bio up to 150 characters", ru: "Расширенное «О себе» до 150 символов" },
  "premiumModal.cta": { en: "Subscribe", ru: "Оформить подписку" },
  "premiumPrompt.generic": {
    en: "Subscribe to Pingy Premium to unlock this feature.",
    ru: "Оформите Pingy Premium, чтобы воспользоваться этой возможностью.",
  },
  "premiumPrompt.folders": {
    en: "Subscribe to Pingy Premium to use chat folders.",
    ru: "Оформите Pingy Premium, чтобы пользоваться папками с чатами.",
  },
  "premiumPrompt.videoCircles": {
    en: "Subscribe to Pingy Premium to send more video messages.",
    ru: "Оформите Pingy Premium, чтобы отправлять больше видео-сообщений.",
  },
  "sub.buyOrGift": { en: "Buy or gift", ru: "Купить или подарить" },
  "sub.buy": { en: "Buy", ru: "Купить" },
  "sub.gift": { en: "Gift", ru: "Подарить" },
  "sub.giftRecipient": { en: "Gift recipient", ru: "Кому подарить" },
  "sub.searchUser": { en: "Search by name or username…", ru: "Поиск по имени или @username…" },
  "sub.giftingTo": { en: "Gifting to", ru: "Дарим" },
  "sub.giftSubscribe": { en: "Pay and gift", ru: "Оплатить и подарить" },
  "sub.invitedCount": { en: "Invited", ru: "Приглашено" },

  // ─── Misc / dynamic pieces ───────────────────────────────
  "misc.newChat": { en: "New chat", ru: "Новый чат" },
  "misc.lessThanDay": { en: "less than a day", ru: "менее дня" },
  "misc.oneDay": { en: "1 day", ru: "1 день" },

  // ─── Auth page ────────────────────────────────────────────
  "auth.enterPhone": { en: "Enter phone number", ru: "Введите номер телефона" },
  "auth.codeDigits": { en: "6-digit code", ru: "Код из 6 цифр" },
  "auth.username3to30": { en: "3 to 30 characters", ru: "От 3 до 30 символов" },
  "auth.usernameChars": { en: "Only Latin letters, digits and underscore", ru: "Только латиница, цифры и подчёркивание" },
  "auth.sendCode": { en: "Get code", ru: "Получить код" },
  "auth.sending": { en: "Sending...", ru: "Отправка..." },
  "auth.retryInSeconds": { en: "Retry in %s sec.", ru: "Повторить через %s сек." },
  "auth.codeFromTelegram": { en: "Code from Telegram", ru: "Код из Telegram" },
  "auth.codeFromSms": { en: "Code from SMS", ru: "Код из SMS" },
  "auth.checking": { en: "Checking...", ru: "Проверка..." },
  "auth.loginBtn": { en: "Log in", ru: "Войти" },
  "auth.howToAddress": { en: "How should we call you", ru: "Как к вам обращаться" },
  "auth.addAvatar": { en: "Add avatar", ru: "Добавить аватарку" },
  "auth.photoPlaceholder": { en: "photo", ru: "фото" },
  "auth.saving": { en: "Saving...", ru: "Сохранение..." },
  "auth.continue": { en: "Continue", ru: "Продолжить" },
  "auth.invalidCode": { en: "Invalid code", ru: "Неверный код" },
  "auth.usernameTaken": { en: "This username is taken or unavailable", ru: "Этот юзернейм занят или недоступен" },
  "auth.logo": { en: "Logo", ru: "Логотип" },
  "auth.createAccount": { en: "Create account", ru: "Создание аккаунта" },
  "auth.login": { en: "Log in", ru: "Вход" },
  "auth.verifiedPhone": { en: "Verified number", ru: "Подтверждённый номер" },
  "auth.createAccountTariffInfo": {
    en: "Free tier: basic account forever, chats and groups. Subscription adds extra features; payment in Settings.",
    ru: "Бесплатный тариф: базовый аккаунт навсегда, чаты и группы. Подписка — дополнительные возможности, оплата в настройках.",
  },
  "auth.referralBonus": {
    en: "You are signing up via referral link! For this we give you a free account forever. Your inviter gets subscription rewards for inviting friends.",
    ru: "Вы регистрируетесь по реферальной ссылке! За это мы дарим вам free-аккаунт навсегда. Тот, кто вас пригласил, получает месяцы подписки за приглашённых друзей.",
  },
  "auth.referralAlreadyRegistered": {
    en: "You already have an account. Referral bonuses are only available for new users.",
    ru: "У вас уже есть аккаунт. Реферальные бонусы доступны только для новых пользователей.",
  },
  "auth.phoneNumber": { en: "Phone number", ru: "Номер телефона" },
  "auth.interfaceLanguage": { en: "Interface language", ru: "Язык интерфейса" },
  "auth.codeDeliveryMethod": { en: "Code delivery method", ru: "Способ получения кода" },
  "auth.codeHint": {
    en: "Confirmation code will arrive via Telegram",
    ru: "Код подтверждения придёт в Telegram",
  },
  "auth.usernameHint": {
    en: "Choose a username. Others can find and message you by it. You can set your name and avatar now or later in settings.",
    ru: "Придумайте юзернейм. По нему вас смогут найти и написать. Имя и аватарку можно задать сейчас или позже в профиле.",
  },
  "auth.nameLabel": { en: "Name", ru: "Имя" },
  "auth.usernameLabel": { en: "Username", ru: "Юзернейм" },
  "auth.usernameRules": {
    en: "Latin letters, digits and underscore, 3–30 characters",
    ru: "Латиница, цифры и подчёркивание, 3–30 символов",
  },
  "auth.codeSentTelegram": { en: "Code sent to Telegram at", ru: "Код отправлен в Telegram на" },
  "auth.codeSentTelegramFrom": { en: "from", ru: "от" },
  "auth.codeSentSms": { en: "Code sent via SMS to", ru: "Код отправлен по SMS на" },
  "auth.changePhone": { en: "Change", ru: "Изменить" },
  "auth.changeNumber": { en: "Change number", ru: "Изменить номер" },
  "auth.didntReceiveCode": { en: "Didn't receive the code?", ru: "Не пришёл код?" },
  "auth.sendViaSms": { en: "Send via SMS", ru: "Отправить по SMS" },
  "auth.usernameAvailable": { en: "Username is available", ru: "Юзернейм свободен" },
  "auth.usernameTakenLive": { en: "This username is already taken", ru: "Этот юзернейм уже занят" },
  "auth.usernameChecking": { en: "Checking...", ru: "Проверка..." },
  "auth.qrLoginEnterCode": {
    en: "Enter the 6-digit code from your other device",
    ru: "Введите 6-значный код с другого устройства",
  },
  "auth.qrLoginSuccess": { en: "Logged in successfully", ru: "Вход выполнен" },
  "auth.qrLoginError": {
    en: "Invalid or expired code. Generate a new one on your other device.",
    ru: "Неверный или просроченный код. Создайте новый на другом устройстве.",
  },

  // ─── Alpha banner (env-controlled) ─────────────────────────
  "alphaBanner.title": { en: "Beta testing", ru: "Бета-тестирование" },
  "alphaBanner.body": {
    en: "The service is in beta. We are open for your feedback to make pingy better",
    ru: "Сервис в стадии бета-тестирования. Мы будем рады обратной связи, чтобы сделать pingy лучше для вас",
  },

  // ─── JoinChat page ────────────────────────────────────────
  "joinPage.missingParams": { en: "Link is missing slug or code parameters.", ru: "В ссылке отсутствуют параметры slug или code." },
  "joinPage.alreadyInChat": { en: "You are already in this chat.", ru: "Вы уже в чате." },

  // ─── NotFound page ────────────────────────────────────────
  "notFound.toChats": { en: "To chats", ru: "К чатам" },
  "notFound.toHome": { en: "To home", ru: "На главную" },

  // ─── Small components ─────────────────────────────────────
  "avatar.close": { en: "Close", ru: "Закрыть" },
  "avatar.delete": { en: "Delete", ru: "Удалить" },
  "avatar.moveUp": { en: "Move up", ru: "Выше" },
  "avatar.moveDown": { en: "Move down", ru: "Ниже" },
  "avatar.addError": { en: "Could not add", ru: "Не удалось добавить" },
  "avatar.deleteError": { en: "Could not delete", ru: "Не удалось удалить" },
  "avatar.reorderError": { en: "Could not reorder", ru: "Не удалось изменить порядок" },
  "avatar.usePhoto": { en: "Use photo", ru: "Использовать фото" },
  "avatar.editWithAi": { en: "Edit with AI (coming soon)", ru: "Редактировать с ИИ (скоро)" },
  "avatar.defaultText": { en: "Text", ru: "Текст" },
  "sticker.searchGif": { en: "Search GIF...", ru: "Поиск GIF..." },

  // ─── Wiki (Help) pages ────────────────────────────────────
  "wiki.title": { en: "Wiki", ru: "Wiki" },
  "wiki.chats": { en: "Chats", ru: "Чаты" },
  "wiki.referral": { en: "Referral program", ru: "Реферальная программа" },
  "wiki.security": { en: "Security", ru: "Безопасность" },
  "wiki.channels": { en: "Channels", ru: "Каналы" },
  "wiki.bots": { en: "Bots", ru: "Боты" },
  "pin.pinned": { en: "Pinned", ru: "Закреплено" },
  "pin.forYou": { en: "for you", ru: "для вас" },
  "pin.pinnedForYou": { en: "Pinned for you", ru: "Закреплено для вас" },
} as const;

export type TranslationKey = keyof typeof translations;

/* ================================================================
   Public API
   ================================================================ */

/** Get a translated string by key and language. */
export function t(key: TranslationKey, lang: AppLanguage): string {
  const entry = translations[key];
  if (!entry) return key;
  return entry[lang] ?? entry.en ?? key;
}

/** Convenience: get current language from preferences store. */
export function useLang(): AppLanguage {
  return usePreferencesStore((s) => s.language);
}

/** React hook — returns a stable translator fn bound to current language. */
export function useTranslation() {
  const lang = useLang();
  // Memoize so the function reference is stable when language doesn't change
  const tr = useMemo(() => (key: TranslationKey) => t(key, lang), [lang]);
  return { t: tr, lang };
}

/** Format member count with correct plural form */
export function formatMembersCount(n: number, lang: AppLanguage): string {
  if (lang === "en") {
    return `${n} member${n === 1 ? "" : "s"}`;
  }
  if (n === 1) return `${n} участник`;
  if (n >= 2 && n <= 4) return `${n} участника`;
  return `${n} участников`;
}

/** Format "last seen" text */
export function formatLastSeenI18n(value: string | null | undefined, lang: AppLanguage): string {
  if (!value) return "";
  if (value === "recently") return t("chat.lastSeen.recently", lang);
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t("chat.lastSeen.justNow", lang);
  if (diffMin < 60) {
    return lang === "en"
      ? `last seen ${diffMin} min. ago`
      : `был(а) в сети ${diffMin} мин. назад`;
  }
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) {
    return lang === "en"
      ? `last seen ${diffH} h. ago`
      : `был(а) в сети ${diffH} ч. назад`;
  }
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return t("chat.lastSeen.yesterday", lang);
  if (diffD < 7) {
    return lang === "en"
      ? `last seen ${diffD} days ago`
      : `был(а) в сети ${diffD} дн. назад`;
  }
  return lang === "en"
    ? `last seen ${d.toLocaleDateString("en-US")}`
    : `был(а) в сети ${d.toLocaleDateString("ru-RU")}`;
}

/** Format date label for message day separators */
export function formatDateLabelI18n(iso: string | undefined, lang: AppLanguage): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const thisYear = today.getFullYear();
  const day = d.getDate();
  const month = d.getMonth();
  const year = d.getFullYear();
  const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
  const isYesterday = day === yesterday.getDate() && month === yesterday.getMonth() && year === yesterday.getFullYear();

  if (lang === "ru") {
    if (isToday) return "Сегодня";
    if (isYesterday) return "Вчера";
    const months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
    return year !== thisYear ? `${day} ${months[month]} ${year}` : `${day} ${months[month]}`;
  }
  if (isToday) return "Today";
  if (isYesterday) return "Yesterday";
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return year !== thisYear ? `${months[month]} ${day}, ${year}` : `${months[month]} ${day}`;
}

/** Locale for toLocaleDateString / toLocaleTimeString */
export function getLocale(lang: AppLanguage): string {
  return lang === "ru" ? "ru-RU" : "en-US";
}

/** Weekday names */
export function getWeekdays(lang: AppLanguage): string[] {
  if (lang === "en") return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
}
