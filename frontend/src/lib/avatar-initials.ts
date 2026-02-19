/**
 * Avatar initials: 2 characters when the name has 2+ characters.
 * Multiple words → first letters of the first two words (e.g. John Doe → JD).
 * Single word with 2+ characters → first 2 characters.
 * Single word with 1 character → 1 character.
 */
export function getAvatarInitials(name: string | null | undefined): string {
  const s = (name || "").trim();
  if (!s) return "?";
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length >= 2)
    return (words[0][0] + words[1][0]).toUpperCase().slice(0, 2);
  return (s.slice(0, 2).toUpperCase() || "?");
}
