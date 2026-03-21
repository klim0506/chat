import { useEffect } from "react";

/**
 * Publishes VisualViewport metrics on :root for CSS:
 * - --visual-viewport-offset-top: aligns top bars with the visible viewport.
 * - --keyboard-bottom-inset: space obscured below the visual viewport (soft keyboard
 *   and its accessory/suggestion row on Android Chrome). Used to lift the chat composer.
 */
export function useVisualViewportCssVars(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      document.documentElement.style.setProperty(
        "--visual-viewport-offset-top",
        `${vv.offsetTop}px`
      );
      const bottomInset = Math.max(
        0,
        window.innerHeight - vv.height - vv.offsetTop
      );
      document.documentElement.style.setProperty(
        "--keyboard-bottom-inset",
        `${bottomInset}px`
      );
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      document.documentElement.style.removeProperty("--visual-viewport-offset-top");
      document.documentElement.style.removeProperty("--keyboard-bottom-inset");
    };
  }, []);
}
