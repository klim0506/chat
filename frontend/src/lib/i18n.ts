import { usePreferencesStore } from "../store/preferences";

type Lang = "en" | "ru";

type Dict = Record<string, { en: string; ru: string }>;

const DICT: Dict = {
  auth_title: { en: "Sign in", ru: "Вход" },
  auth_phone: { en: "Phone number", ru: "Номер телефона" },
  auth_get_code: { en: "Get code", ru: "Получить код" },
  auth_verify: { en: "Verify", ru: "Войти" },
  auth_code_sent_sms: { en: "Code sent via SMS to", ru: "Код отправлен по SMS на" },
  auth_code_sent_tg: { en: "Code sent in Telegram to", ru: "Код отправлен в Telegram на" },
  auth_try_sms: { en: "Send via SMS", ru: "Отправить по SMS" },
  auth_method_auto: { en: "Telegram first, then SMS", ru: "Сначала Telegram, потом SMS" },
  auth_method_sms: { en: "SMS only", ru: "Только SMS" },
  auth_method_tg: { en: "Telegram first", ru: "Сначала Telegram" },
  join_title: { en: "Join chat", ru: "Вступление в чат" },
  join_success: { en: "You joined the chat.", ru: "Вы вступили в чат." },
  join_already: { en: "You are already in this chat.", ru: "Вы уже в чате." },
  settings_title: { en: "Profile", ru: "Профиль" },
  settings_language: { en: "Language", ru: "Язык" },
  settings_theme: { en: "Theme", ru: "Тема" },
  settings_light: { en: "Light", ru: "Светлая" },
  settings_dark: { en: "Dark", ru: "Тёмная" },
  settings_en: { en: "English", ru: "Английский" },
  settings_ru: { en: "Russian", ru: "Русский" },
  messenger_search: { en: "Search chats and people...", ru: "Поиск чатов и людей..." },
  messenger_join_link: { en: "Join by link", ru: "Вступить по ссылке" },
};

export function useI18n() {
  const language = usePreferencesStore((s) => s.language);
  const lang: Lang = language === "ru" ? "ru" : "en";

  function t(key: keyof typeof DICT): string {
    return DICT[key]?.[lang] ?? DICT[key]?.en ?? String(key);
  }

  return { t, lang };
}

