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
  "common.close": { en: "Close", ru: "Закрыть" },
  "common.saved": { en: "Saved", ru: "Сохранено" },
  "common.saveError": { en: "Save error", ru: "Ошибка сохранения" },
  "common.error": { en: "Error", ru: "Ошибка" },
  "common.logout": { en: "Log out", ru: "Выйти" },
  "common.settings": { en: "Settings", ru: "Настройки" },
  "common.back": { en: "Back", ru: "Назад" },
  "common.copy": { en: "Copy", ru: "Копировать" },
  "common.copied": { en: "Copied", ru: "Скопировано" },
  "common.open": { en: "Open", ru: "Открыть" },
  "common.delete": { en: "Delete", ru: "Удалить" },
  "common.send": { en: "Send", ru: "Отправить" },
  "common.search": { en: "Search", ru: "Поиск" },
  "common.everyone": { en: "Everyone", ru: "Все" },
  "common.nobody": { en: "Nobody", ru: "Никто" },
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
  "landing.brand": { en: "Private Chats", ru: "Приватные чаты" },
  "landing.help": { en: "Help", ru: "Справка" },
  "landing.dashboard": { en: "Chats", ru: "Чаты" },
  "landing.login": { en: "Log in", ru: "Войти" },
  "landing.hero.tag": { en: "Stable messenger without VPN and blocks", ru: "Стабильный мессенджер без VPN и блокировок" },
  "landing.hero.title1": { en: "Chats that ", ru: "Чаты, которые " },
  "landing.hero.titleHighlight": { en: "always work", ru: "работают всегда" },
  "landing.hero.title2": { en: ". No VPN. Full encryption.", ru: ". Без VPN. Полное шифрование." },
  "landing.hero.desc": {
    en: "A messenger that works stably from Russia without VPN. We strictly comply with Russian Federation legislation and use end-to-end encryption based on Telegram protocols. Your messages are protected — only you and the recipient can read them.",
    ru: "Мессенджер, который стабильно работает из России без VPN. Строго соблюдаем законодательство РФ и используем сквозное шифрование данных от Telegram. Ваши сообщения защищены — читать их можете только вы и собеседник.",
  },
  "landing.hero.subdesc": {
    en: "Try the trial version and stay forever. SMS registration, fast file uploads, from personal chats to communities.",
    ru: "Попробуйте триальную версию и останьтесь навсегда. Регистрация по SMS, быстрая загрузка файлов, от личных чатов до сообществ.",
  },
  "landing.hero.start": { en: "Try for free", ru: "Попробовать бесплатно" },
  "landing.hero.createChat": { en: "Create chat", ru: "Создать чат" },
  "landing.features.title": { en: "Stability and security in every message", ru: "Стабильность и безопасность в каждом сообщении" },
  "landing.features.subtitle": { en: "No VPN, no blocks, full encryption compliant with Russian law.", ru: "Без VPN, без блокировок, полное шифрование в рамках законодательства РФ." },
  "landing.feature1.title": { en: "No VPN", ru: "Без VPN" },
  "landing.feature1.desc": {
    en: "Works from Russia without workarounds and proxies. No blocks — your chat is always accessible.",
    ru: "Работает из России без обходов и прокси. Никаких блокировок — ваш чат доступен всегда.",
  },
  "landing.feature2.title": { en: "Fast file uploads", ru: "Быстрая загрузка файлов" },
  "landing.feature2.desc": {
    en: "Any files upload quickly — videos, documents, media. Currently up to 0.5 GB per file; cloud storage integration planned.",
    ru: "Любые файлы загружаются быстро — видео, документы, медиа. Сейчас до 0,5 ГБ на файл; в планах интеграция с облаком для хранения ваших данных.",
  },
  "landing.feature3.title": { en: "Real time", ru: "В реальном времени" },
  "landing.feature3.desc": {
    en: "Messages and media are delivered instantly. No delays.",
    ru: "Сообщения и медиа доставляются мгновенно. Никаких задержек.",
  },
  "landing.feature4.title": { en: "Encryption from Telegram", ru: "Шифрование от Telegram" },
  "landing.feature4.desc": {
    en: "End-to-end encryption based on Telegram protocols. We comply with Russian Federation legislation — your data is protected by law and technology.",
    ru: "Сквозное шифрование на основе протоколов Telegram. Соблюдаем законодательство РФ — ваши данные защищены и законом, и технологиями.",
  },
  "landing.scope.title": { en: "One subscription — any scale", ru: "Одна подписка — любой масштаб" },
  "landing.scope.desc": {
    en: "From private chats for two to communities with hundreds of participants. All with end-to-end encryption.",
    ru: "От личного чата на двоих до сообщества на сотни участников. Всё с шифрованием данных.",
  },
  "landing.scope.personal": { en: "Personal chat", ru: "Личный чат" },
  "landing.scope.group": { en: "Group", ru: "Группа" },
  "landing.scope.team": { en: "Team", ru: "Команда" },
  "landing.scope.community": { en: "Community", ru: "Сообщество" },
  "landing.cta.title": { en: "Try trial and stay forever", ru: "Дарим пробную подписку на месяц. Попробуйте сами и останьтесь навсегда" },
  "landing.cta.desc": {
    en: "SMS registration in a minute. Stable, encrypted, compliant with Russian law. Trial period — then decide.",
    ru: "Регистрация по SMS за минуту. Стабильный, зашифрованный, в рамках законодательства РФ. Пробный период — а потом решайте.",
  },
  "landing.cta.loginOrRegister": { en: "Log in or register", ru: "Войти или зарегистрироваться" },
  "landing.cta.createNew": { en: "Create new chat", ru: "Создать новый чат" },
  "landing.footer.copy": { en: "© Private Chats", ru: "© Приватные чаты" },

  // ─── Settings page ───────────────────────────────────────
  "settings.profile": { en: "Profile", ru: "Профиль" },
  "settings.manageAvatars": { en: "Manage avatars", ru: "Управление аватарками" },
  "settings.enterName": { en: "Enter name", ru: "Введите имя" },
  "settings.noName": { en: "No name", ru: "Без имени" },
  "settings.editName": { en: "Edit name", ru: "Изменить имя" },
  "settings.settingsTitle": { en: "Settings", ru: "Настройки" },
  "settings.messageTextScale": { en: "Message text scale", ru: "Масштаб текста в сообщениях" },
  "settings.scaleSmall": { en: "Small", ru: "Маленький" },
  "settings.scaleReduced": { en: "Reduced", ru: "Уменьшенный" },
  "settings.scaleNormal": { en: "Normal", ru: "Обычный" },
  "settings.scaleLarge": { en: "Large", ru: "Крупный" },
  "settings.notifications": { en: "New message notifications", ru: "Уведомления о новых сообщениях" },
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
  "settings.noDevices": { en: "No registered devices.", ru: "Нет зарегистрированных устройств." },
  "settings.endSession": { en: "End session", ru: "Завершить сессию" },
  "settings.privacy": { en: "Privacy", ru: "Приватность" },
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
    en: "Extended trial (2 weeks) via referral link",
    ru: "Расширенная триалка (2 недели) по реферальной ссылке",
  },
  "settings.goToPayment": { en: "Redirecting to payment...", ru: "Переход к оплате..." },
  "settings.paymentError": { en: "Payment error", ru: "Ошибка оплаты" },
  "settings.referral": { en: "Referral program", ru: "Реферальная программа" },
  "settings.referralDesc": {
    en: "Invite a friend — they get <strong>2 weeks free</strong> and <strong>⭐ 10 stars</strong>, and you — also <strong>⭐ 10 stars</strong>.",
    ru: "Пригласите друга — он получит <strong>2 недели бесплатно</strong> и <strong>⭐ 10 звёзд</strong>, а вы — тоже <strong>⭐ 10 звёзд</strong>.",
  },
  "settings.stars": { en: "Stars", ru: "Звёзды" },
  "settings.starsDesc": {
    en: "Invite friends — you both get <strong>⭐ 10 stars</strong>. For <strong>⭐ 50 stars</strong> — upgrade chat to 100 members, for <strong>⭐ 100 stars</strong> — to 1000 (forever).",
    ru: "Приглашайте друзей — вы оба получаете <strong>⭐ 10 звёзд</strong>. За <strong>⭐ 50 звёзд</strong> — прокачать чат до 100 участников, за <strong>⭐ 100 звёзд</strong> — до 1000 (раз и навсегда).",
  },
  "settings.transactionHistory": { en: "Transaction history", ru: "История операций" },
  "settings.loadProfileError": { en: "Could not load profile", ru: "Не удалось загрузить профиль" },
  "settings.myChats": { en: "My chats", ru: "Мои чаты" },

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
  "dashboard.createChat": { en: "Create chat", ru: "Создать чат" },
  "dashboard.myChats": { en: "My chats", ru: "Мои чаты" },
  "dashboard.noChats": { en: "No chats yet. Create your first one.", ru: "Чатов пока нет. Создайте первый." },
  "dashboard.loadError": { en: "Could not load chats", ru: "Не удалось загрузить чаты" },
  "dashboard.needsSub": { en: "Subscription required", ru: "Необходима подписка" },
  "dashboard.needsSubDesc": {
    en: "Subscribe for <strong>300 ₽/mo</strong> to access the messenger.",
    ru: "Для доступа к мессенджеру оформите подписку за <strong>300 ₽/мес</strong>.",
  },
  "dashboard.goToPayment": { en: "Go to payment", ru: "Перейти к оплате" },
  "dashboard.personalChat": { en: "Personal chat", ru: "Личный чат" },
  "dashboard.openType": { en: "Open", ru: "Открытый" },
  "dashboard.closedType": { en: "Closed", ru: "Закрытый" },
  "dashboard.newMessage": { en: "New message", ru: "Новое сообщение" },
  "dashboard.previewNote": { en: "Preview · chat not marked as read", ru: "Предпросмотр · чат не отмечен как прочитанный" },
  "dashboard.noChatMessages": { en: "No messages in this chat yet", ru: "В этом чате пока нет сообщений" },
  "dashboard.muted": { en: "Muted", ru: "Беззвучный" },
  "dashboard.freeTrialMonth": { en: " You have a free trial month!", ru: " У вас есть бесплатный пробный месяц!" },
  "dashboard.contextPreviewHint": { en: "Right-click / long press — preview", ru: "Правый клик / долгое нажатие — предпросмотр" },

  // ─── Messenger page ──────────────────────────────────────
  "messenger.chats": { en: "Chats", ru: "Чаты" },
  "messenger.menu": { en: "Menu", ru: "Меню" },
  "messenger.searchPlaceholder": { en: "Search chats and people...", ru: "Поиск чатов и людей..." },
  "messenger.noChatsYet": { en: "No chats yet", ru: "Чатов пока нет" },
  "messenger.noChatsDesc": {
    en: "Create a chat, join a group via an invite link, or invite friends to this messenger.",
    ru: "Создайте чат, вступите в группу по ссылке-приглашению или пригласите друзей в этот мессенджер.",
  },
  "messenger.createFirst": { en: "Create first chat", ru: "Создать первый чат" },
  "messenger.haveInvite": { en: "Have an invite link?", ru: "Есть ссылка-приглашение?" },
  "messenger.joinChat": { en: "Join chat", ru: "Вступить в чат" },
  "messenger.selectChat": { en: "Select a chat", ru: "Выберите чат" },
  "messenger.selectChatEmpty": {
    en: "Create your first chat or join a chat via an invite link — your conversation will open here.",
    ru: "Создайте первый чат или вступите в чат по пригласительной ссылке — тогда здесь откроется переписка.",
  },
  "messenger.selectChatDesc": { en: "Select a chat from the list on the left or create a new one.", ru: "Выберите чат из списка слева или создайте новый." },
  "messenger.welcomeTitle": { en: "Welcome!", ru: "Добро пожаловать!" },
  "messenger.welcomeDesc": {
    en: "Your account is ready. In addition to creating a group and joining a group via invite link, you can also invite friends and try Favorites.",
    ru: "Ваш аккаунт готов. Помимо создания группы и вступления в группу по ссылке, вы можете пригласить друзей и попробовать Избранное.",
  },
  "messenger.welcomeCreateGroup": { en: "Create a group chat", ru: "Создать групповой чат" },
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
    en: "Friend gets 2 weeks free, you get 10 stars",
    ru: "Друг получит 2 недели бесплатно, вы — 10 звёзд",
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
  "messenger.noMatchingChats": { en: "No matching chats", ru: "Нет подходящих чатов" },
  "messenger.archiveEmpty": { en: "No archived chats yet", ru: "В архиве пока нет чатов" },
  "messenger.users": { en: "Users", ru: "Пользователи" },
  "messenger.searching": { en: "Searching…", ru: "Поиск…" },
  "messenger.noUsersFound": { en: "Nobody found", ru: "Никого не найдено" },
  "messenger.muted": { en: "Muted", ru: "Без звука" },
  "messenger.openChatError": { en: "Could not open chat", ru: "Не удалось открыть чат" },
  "messenger.profileAndSubscription": { en: "Profile and subscription settings — in menu (⋮) in the chat list header.", ru: "Настройки профиля и подписки — в меню (⋮) в шапке списка чатов." },
  "messenger.pinned": { en: "Pinned", ru: "Закреплён" },
  "messenger.resizeSidebar": { en: "Resize chat list", ru: "Изменить ширину списка чатов" },

  // ─── Create chat modal ───────────────────────────────────
  "createChat.title": { en: "Create chat", ru: "Создать чат" },
  "createChat.afterCreateHint": { en: "After creating you can invite members by link.", ru: "После создания вы сможете пригласить участников по ссылке." },
  "createChat.addPhoto": { en: "Add photo", ru: "Добавить фото" },
  "createChat.chatName": { en: "Chat name", ru: "Название чата" },
  "createChat.namePlaceholder": { en: "Name", ru: "Название" },
  "createChat.enterName": { en: "Enter name", ru: "Введите название" },
  "createChat.description": { en: "Description", ru: "Описание" },
  "createChat.descPlaceholder": { en: "What's this chat about? (optional)", ru: "О чём этот чат? (необязательно)" },
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
  "createChat.maxChars": { en: "Max %s characters", ru: "Максимум %s символов" },

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
  "chat.type": { en: "Type", ru: "Тип" },
  "chat.participants": { en: "Members", ru: "Участники" },
  "chat.media": { en: "Media", ru: "Медиа" },
  "chat.links": { en: "Links", ru: "Ссылки" },
  "chat.files": { en: "Files", ru: "Файлы" },
  "chat.messagePlaceholder": { en: "Message...", ru: "Сообщение..." },
  "chat.attachFile": { en: "Attach file", ru: "Прикрепить файл" },
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
  "chat.alreadyInChat": { en: "You're already in this chat", ru: "Вы уже в этом чате" },
  "chat.inviteError": { en: "Could not invite", ru: "Не удалось пригласить" },
  "chat.leaveChat": { en: "Are you sure you want to leave the chat?", ru: "Вы уверены, что хотите выйти из чата?" },
  "chat.leaveError": { en: "Could not leave the chat", ru: "Не удалось выйти из чата" },
  "chat.deleteChat": { en: "Delete chat permanently? All messages will be lost.", ru: "Удалить чат безвозвратно? Все сообщения будут недоступны." },
  "chat.deleteError": { en: "Could not delete chat", ru: "Не удалось удалить чат" },
  "chat.micAccessDenied": { en: "Microphone access denied. Allow in browser settings.", ru: "Доступ к микрофону запрещён. Разрешите в настройках браузера." },
  "chat.micAccessFailed": { en: "Could not access microphone. Allow in browser settings.", ru: "Не удалось получить доступ к микрофону. Разрешите в настройках браузера." },
  "chat.voiceTooLarge": { en: "Voice message is larger than 0.5 GB.", ru: "Голосовое сообщение больше 0,5 ГБ." },
  "chat.serverBadResponse": { en: "Server returned invalid response", ru: "Сервер вернул некорректный ответ" },
  "chat.uploadError": { en: "File upload error", ru: "Ошибка загрузки файла" },
  "chat.uploadErrorMultiple": { en: "Files upload error", ru: "Ошибка загрузки файлов" },
  "chat.speechNotSupported": { en: "Speech recognition not supported in this browser (Chrome or Edge required).", ru: "Распознавание речи не поддерживается в этом браузере (нужен Chrome или Edge)." },
  "chat.speechStartError": { en: "Could not start speech recognition.", ru: "Не удалось запустить распознавание речи." },
  "chat.cameraAccessDenied": { en: "Camera access denied. Allow in browser settings.", ru: "Доступ к камере запрещён. Разрешите в настройках браузера." },
  "chat.cameraAccessFailed": { en: "Could not access camera. Allow in browser settings.", ru: "Не удалось получить доступ к камере. Разрешите в настройках браузера." },
  "chat.expandError": { en: "Could not expand chat", ru: "Не удалось расширить чат" },
  "chat.avatarTooLarge": { en: "Avatar file is larger than 0.5 GB.", ru: "Файл аватара больше 0,5 ГБ." },
  "chat.bgTooLarge": { en: "Background file is larger than 0.5 GB.", ru: "Файл фона больше 0,5 ГБ." },
  "chat.copyLink": { en: "Copy link", ru: "Копировать ссылку" },
  "chat.share": { en: "Share", ru: "Поделиться" },
  "chat.shareTitle": { en: "Join private chats", ru: "Присоединяйся к чатам" },
  "chat.shareText": { en: "Register via my link — free month and ⭐ 10 stars as a gift.", ru: "Зарегистрируйся по моей ссылке — месяц бесплатно и ⭐ 10 звёзд в подарок." },
  "chat.searchChat": { en: "Search chat...", ru: "Поиск чата..." },
  "chat.enterUsername": { en: "Enter @username", ru: "Введите @username" },
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
  "chat.noLinks": { en: "No links", ru: "Нет ссылок" },
  "chat.noFiles": { en: "No files", ru: "Нет файлов" },
  "chat.noMedia": { en: "No media", ru: "Нет медиа" },
  "chat.upgradeDesc": { en: "Currently the group supports up to 10 members. To expand to 100, collect 50 stars in the referral program.", ru: "Сейчас в группе до 10 участников. Чтобы расширить до 100, накопите 50 звёзд в реферальной программе." },
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
  "chat.scheduleLabelText": { en: "Text", ru: "Текст" },
  "chat.scheduleLabelWhen": { en: "When to send", ru: "Когда отправить" },
  "chat.scheduleLabelRepeat": { en: "Repeat", ru: "Повтор" },
  "chat.scheduleOnce": { en: "Once", ru: "Один раз" },
  "chat.scheduleEveryDay": { en: "Every day", ru: "Каждый день" },
  "chat.scheduleWeekly": { en: "Weekly", ru: "Раз в неделю" },
  "chat.scheduleLabelTime": { en: "Time", ru: "Время" },
  "chat.scheduleLabelWeekday": { en: "Weekday", ru: "День недели" },
  "chat.featureInDev": { en: "Feature under development", ru: "Функционал в разработке" },
  "chat.messageDeleted": { en: "Message deleted", ru: "Сообщение удалено" },
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
  "chat.online": { en: "online", ru: "в сети" },

  // ─── File size warnings (parameterized) ──────────────────
  "chat.fileTooLargeNamed": { en: 'File "%s" is larger than 0.5 GB.', ru: "Файл «%s» больше 0,5 ГБ." },
  "chat.fileTooLarge": { en: "File is larger than 0.5 GB.", ru: "Файл больше 0,5 ГБ." },

  // ─── Subscription-related text in createChat / dashboard ─
  "sub.pricePerMonth": { en: "rub./mo.", ru: "руб./мес." },
  "sub.noSubDesc": { en: "No active subscription. Price: <strong>300 rub./mo.</strong>", ru: "Подписка не оформлена. Стоимость: <strong>300 руб./мес.</strong>" },
  "sub.subscribe": { en: "Subscribe", ru: "Оформить подписку" },

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
  "auth.referralBonus": {
    en: "You are signing up via referral link! For this we give you 2 weeks of free service use and ⭐ 10 stars. We also give ⭐ 10 stars to the person who invited you.",
    ru: "Вы регистрируетесь по реферальной ссылке! За это мы дарим вам 2 недели бесплатного использования сервиса и ⭐ 10 звёзд. А тому, кто вас пригласил, мы тоже начислим ⭐ 10 звёзд.",
  },
  "auth.referralAlreadyRegistered": {
    en: "You already have an account. Referral bonuses are only available for new users.",
    ru: "У вас уже есть аккаунт. Реферальные бонусы доступны только для новых пользователей.",
  },
  "auth.phoneNumber": { en: "Phone number", ru: "Номер телефона" },
  "auth.codeDeliveryMethod": { en: "Code delivery method", ru: "Способ получения кода" },
  "auth.codeHint": {
    en: "Confirmation code will arrive via Telegram or SMS",
    ru: "Код подтверждения придёт в Telegram или по SMS",
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
  "auth.didntReceiveCode": { en: "Didn't receive the code?", ru: "Не пришёл код?" },
  "auth.sendViaSms": { en: "Send via SMS", ru: "Отправить по SMS" },
  "auth.usernameAvailable": { en: "Username is available", ru: "Юзернейм свободен" },
  "auth.usernameTakenLive": { en: "This username is already taken", ru: "Этот юзернейм уже занят" },
  "auth.usernameChecking": { en: "Checking...", ru: "Проверка..." },

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

  // ─── Spravka (Help) pages ─────────────────────────────────
  "spravka.title": { en: "Help", ru: "Справка" },
  "spravka.chats": { en: "Chats", ru: "Чаты" },
  "spravka.referral": { en: "Referral program", ru: "Реферальная программа" },
  "spravka.security": { en: "Security", ru: "Безопасность" },
  "spravka.channels": { en: "Channels", ru: "Каналы" },
  "spravka.bots": { en: "Bots", ru: "Боты" },
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
