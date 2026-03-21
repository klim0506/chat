/**
 * Fitzpatrick skin tone modifiers (Unicode)
 * Yellow/default = no modifier
 */
export const SKIN_TONE_OPTIONS = [
  { id: "", modifier: "" as const, label: "Default" },
  { id: "1F3FB", modifier: "\u{1F3FB}" as const, label: "Light" },
  { id: "1F3FC", modifier: "\u{1F3FC}" as const, label: "Medium-Light" },
  { id: "1F3FD", modifier: "\u{1F3FD}" as const, label: "Medium" },
  { id: "1F3FE", modifier: "\u{1F3FE}" as const, label: "Medium-Dark" },
  { id: "1F3FF", modifier: "\u{1F3FF}" as const, label: "Dark" },
] as const;

const SKIN_TONE_REGEX = /[\u{1F3FB}\u{1F3FC}\u{1F3FD}\u{1F3FE}\u{1F3FF}]/gu;

/** Strip all skin tone modifiers from emoji string. */
export function stripSkinTone(emoji: string): string {
  return emoji.replace(SKIN_TONE_REGEX, "");
}

/** Check if emoji contains any skin tone modifier. */
export function hasSkinTone(emoji: string): boolean {
  return /[\u{1F3FB}\u{1F3FC}\u{1F3FD}\u{1F3FE}\u{1F3FF}]/u.test(emoji);
}

/** Get base key for grouping (strip skin tones). */
export function getBaseEmojiKey(emoji: string): string {
  return stripSkinTone(emoji);
}

/**
 * Apply skin tone modifier to emoji.
 * - Strips existing modifier, inserts new one before ZWJ if present, else appends.
 */
export function applySkinTone(emoji: string, modifier: typeof SKIN_TONE_OPTIONS[number]["modifier"]): string {
  const base = stripSkinTone(emoji);
  if (!modifier) return base;
  const zwj = "\u200D";
  const idx = base.indexOf(zwj);
  if (idx >= 0) {
    return base.slice(0, idx) + modifier + base.slice(idx);
  }
  return base + modifier;
}

