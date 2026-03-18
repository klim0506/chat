/**
 * Countries with dial codes and flags for phone input (Telegram-style).
 * Sorted: RU first (common), then others by dial code / region.
 */
export type Country = { iso: string; name: string; dialCode: string; flag: string };

export const COUNTRIES: Country[] = [
  { iso: "RU", name: "Russia", dialCode: "7", flag: "🇷🇺" },
  { iso: "KZ", name: "Kazakhstan", dialCode: "7", flag: "🇰🇿" },
  { iso: "UA", name: "Ukraine", dialCode: "380", flag: "🇺🇦" },
  { iso: "BY", name: "Belarus", dialCode: "375", flag: "🇧🇾" },
  { iso: "UZ", name: "Uzbekistan", dialCode: "998", flag: "🇺🇿" },
  { iso: "TJ", name: "Tajikistan", dialCode: "992", flag: "🇹🇯" },
  { iso: "AM", name: "Armenia", dialCode: "374", flag: "🇦🇲" },
  { iso: "AZ", name: "Azerbaijan", dialCode: "994", flag: "🇦🇿" },
  { iso: "GE", name: "Georgia", dialCode: "995", flag: "🇬🇪" },
  { iso: "TM", name: "Turkmenistan", dialCode: "993", flag: "🇹🇲" },
  { iso: "KG", name: "Kyrgyzstan", dialCode: "996", flag: "🇰🇬" },
  { iso: "US", name: "United States", dialCode: "1", flag: "🇺🇸" },
  { iso: "CA", name: "Canada", dialCode: "1", flag: "🇨🇦" },
  { iso: "GB", name: "United Kingdom", dialCode: "44", flag: "🇬🇧" },
  { iso: "DE", name: "Germany", dialCode: "49", flag: "🇩🇪" },
  { iso: "FR", name: "France", dialCode: "33", flag: "🇫🇷" },
  { iso: "IT", name: "Italy", dialCode: "39", flag: "🇮🇹" },
  { iso: "ES", name: "Spain", dialCode: "34", flag: "🇪🇸" },
  { iso: "PL", name: "Poland", dialCode: "48", flag: "🇵🇱" },
  { iso: "TR", name: "Turkey", dialCode: "90", flag: "🇹🇷" },
  { iso: "IN", name: "India", dialCode: "91", flag: "🇮🇳" },
  { iso: "CN", name: "China", dialCode: "86", flag: "🇨🇳" },
  { iso: "JP", name: "Japan", dialCode: "81", flag: "🇯🇵" },
  { iso: "KR", name: "South Korea", dialCode: "82", flag: "🇰🇷" },
  { iso: "IL", name: "Israel", dialCode: "972", flag: "🇮🇱" },
  { iso: "AE", name: "United Arab Emirates", dialCode: "971", flag: "🇦🇪" },
  { iso: "SA", name: "Saudi Arabia", dialCode: "966", flag: "🇸🇦" },
  { iso: "BR", name: "Brazil", dialCode: "55", flag: "🇧🇷" },
  { iso: "MX", name: "Mexico", dialCode: "52", flag: "🇲🇽" },
  { iso: "AR", name: "Argentina", dialCode: "54", flag: "🇦🇷" },
  { iso: "AU", name: "Australia", dialCode: "61", flag: "🇦🇺" },
  { iso: "NL", name: "Netherlands", dialCode: "31", flag: "🇳🇱" },
  { iso: "BE", name: "Belgium", dialCode: "32", flag: "🇧🇪" },
  { iso: "CH", name: "Switzerland", dialCode: "41", flag: "🇨🇭" },
  { iso: "AT", name: "Austria", dialCode: "43", flag: "🇦🇹" },
  { iso: "SE", name: "Sweden", dialCode: "46", flag: "🇸🇪" },
  { iso: "NO", name: "Norway", dialCode: "47", flag: "🇳🇴" },
  { iso: "FI", name: "Finland", dialCode: "358", flag: "🇫🇮" },
  { iso: "CZ", name: "Czech Republic", dialCode: "420", flag: "🇨🇿" },
  { iso: "RO", name: "Romania", dialCode: "40", flag: "🇷🇴" },
  { iso: "HU", name: "Hungary", dialCode: "36", flag: "🇭🇺" },
  { iso: "GR", name: "Greece", dialCode: "30", flag: "🇬🇷" },
  { iso: "PT", name: "Portugal", dialCode: "351", flag: "🇵🇹" },
  { iso: "BG", name: "Bulgaria", dialCode: "359", flag: "🇧🇬" },
  { iso: "HR", name: "Croatia", dialCode: "385", flag: "🇭🇷" },
  { iso: "RS", name: "Serbia", dialCode: "381", flag: "🇷🇸" },
  { iso: "SK", name: "Slovakia", dialCode: "421", flag: "🇸🇰" },
  { iso: "SI", name: "Slovenia", dialCode: "386", flag: "🇸🇮" },
  { iso: "LT", name: "Lithuania", dialCode: "370", flag: "🇱🇹" },
  { iso: "LV", name: "Latvia", dialCode: "371", flag: "🇱🇻" },
  { iso: "EE", name: "Estonia", dialCode: "372", flag: "🇪🇪" },
  { iso: "MD", name: "Moldova", dialCode: "373", flag: "🇲🇩" },
  { iso: "EG", name: "Egypt", dialCode: "20", flag: "🇪🇬" },
  { iso: "ZA", name: "South Africa", dialCode: "27", flag: "🇿🇦" },
  { iso: "NG", name: "Nigeria", dialCode: "234", flag: "🇳🇬" },
  { iso: "KE", name: "Kenya", dialCode: "254", flag: "🇰🇪" },
];

/** Find country by ISO code (e.g. RU). */
export function getCountryByIso(iso: string): Country | undefined {
  const upper = iso.toUpperCase();
  return COUNTRIES.find((c) => c.iso === upper);
}

/** Find country by dial code (without +). Default to RU (+7) if not found. */
export function getCountryByDialCode(code: string): Country | undefined {
  const clean = String(code).replace(/\D/g, "");
  return COUNTRIES.find((c) => c.dialCode === clean) ?? COUNTRIES[0];
}
