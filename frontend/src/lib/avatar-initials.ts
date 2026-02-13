/**
 * Инициалы для аватара: 2 символа, если название/имя из 2+ символов.
 * Несколько слов → первые буквы первых двух слов (Иван Петров → ИП).
 * Одно слово 2+ символов → первые 2 символа (Клим → Кл).
 * Одно слово 1 символ → 1 символ.
 */
export function getAvatarInitials(name: string | null | undefined): string {
  const s = (name || "").trim();
  if (!s) return "?";
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length >= 2)
    return (words[0][0] + words[1][0]).toUpperCase().slice(0, 2);
  return (s.slice(0, 2).toUpperCase() || "?");
}
