export type LegalLang = "ru" | "en";

export type LegalText = { ru: string; en: string };

export const LEGAL_CONFIG = {
  serviceName: { ru: "Pingy", en: "Pingy" },
  operatorName: { ru: "ООО «Пример»", en: "Example LLC" },
  contactEmail: "support@pingychat.com",
  // ISO date (YYYY-MM-DD)
  lastUpdated: "2026-02-13",
} as const;

function formatLastUpdatedHuman(lang: LegalLang, isoDate: string): string {
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  // Make formatting stable across timezones.
  const date = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric" }).format(date);
}

export function getLegalTokens(lang: LegalLang): Record<string, string> {
  return {
    service_name: LEGAL_CONFIG.serviceName[lang],
    operator_name: LEGAL_CONFIG.operatorName[lang],
    contact_email: LEGAL_CONFIG.contactEmail,
    last_updated: LEGAL_CONFIG.lastUpdated,
    last_updated_human: formatLastUpdatedHuman(lang, LEGAL_CONFIG.lastUpdated),
  };
}

export function applyLegalTemplate(markdown: string, lang: LegalLang): string {
  const tokens = getLegalTokens(lang);
  return markdown.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (m, key: string) => tokens[key] ?? m);
}
