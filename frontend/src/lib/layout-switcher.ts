/**
 * Utility for switching keyboard layout EN ↔ RU.
 *
 * If the user typed Russian words using the English layout
 * (e.g. "ghbdtn" instead of "привет"), this function converts the text
 * to the correct layout and vice versa.
 */

/** Character mapping: QWERTY key → ЙЦУКЕН character */
const EN_TO_RU: Record<string, string> = {
  q: "й", w: "ц", e: "у", r: "к", t: "е", y: "н", u: "г", i: "ш", o: "щ", p: "з",
  "[": "х", "]": "ъ", a: "ф", s: "ы", d: "в", f: "а", g: "п", h: "р", j: "о", k: "л",
  l: "д", ";": "ж", "'": "э", z: "я", x: "ч", c: "с", v: "м", b: "и", n: "т", m: "ь",
  ",": "б", ".": "ю", "/": ".",
  Q: "Й", W: "Ц", E: "У", R: "К", T: "Е", Y: "Н", U: "Г", I: "Ш", O: "Щ", P: "З",
  "{": "Х", "}": "Ъ", A: "Ф", S: "Ы", D: "В", F: "А", G: "П", H: "Р", J: "О", K: "Л",
  L: "Д", ":": "Ж", '"': "Э", Z: "Я", X: "Ч", C: "С", V: "М", B: "И", N: "Т", M: "Ь",
  "<": "Б", ">": "Ю", "?": ",",
  "`": "ё", "~": "Ё",
  "@": '"', "#": "№", "$": ";", "^": ":", "&": "?",
};

/** Reverse mapping: ЙЦУКЕН → QWERTY */
const RU_TO_EN: Record<string, string> = {};
for (const [en, ru] of Object.entries(EN_TO_RU)) {
  RU_TO_EN[ru] = en;
}

/** Checks whether a character is Cyrillic */
function isCyrillic(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 0x0400 && code <= 0x04FF) || ch === "ё" || ch === "Ё";
}

/** Checks whether a character is Latin */
function isLatin(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 0x0041 && code <= 0x005A) || (code >= 0x0061 && code <= 0x007A);
}

/** Counts Cyrillic and Latin characters in a string to detect the layout */
function detectLayout(text: string): "ru" | "en" | "mixed" {
  let cyr = 0;
  let lat = 0;
  for (const ch of text) {
    if (isCyrillic(ch)) cyr++;
    else if (isLatin(ch)) lat++;
  }
  if (cyr === 0 && lat === 0) return "mixed";
  if (cyr > lat) return "ru";
  if (lat > cyr) return "en";
  return "mixed";
}

/** Converts text EN → RU (QWERTY → ЙЦУКЕН) */
export function enToRu(text: string): string {
  return Array.from(text)
    .map((ch) => EN_TO_RU[ch] ?? ch)
    .join("");
}

/** Converts text RU → EN (ЙЦУКЕН → QWERTY) */
export function ruToEn(text: string): string {
  return Array.from(text)
    .map((ch) => RU_TO_EN[ch] ?? ch)
    .join("");
}

/**
 * Automatically detects the layout and switches:
 * - Latin text → converts to Cyrillic (EN→RU)
 * - Cyrillic text → converts to Latin (RU→EN)
 * - Mixed → tries EN→RU
 */
export function switchLayout(text: string): string {
  const layout = detectLayout(text);
  if (layout === "ru") return ruToEn(text);
  return enToRu(text);
}
