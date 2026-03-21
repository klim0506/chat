/**
 * Message bubble display: preserve Shift+Enter line breaks, but drop trailing
 * empty lines (a newline at the very end with nothing after).
 */
export function stripTrailingNewlinesForDisplay(text: string): string {
  return text.replace(/\n+$/, "");
}
