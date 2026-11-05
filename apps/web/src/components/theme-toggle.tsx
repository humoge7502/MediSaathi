"use client";

/**
 * Theme toggle — the control that makes the `.dark` palette reachable.
 *
 * Deliberately a two-state switch with no "system" option in the UI: an unset
 * preference already *means* "follow the system" (see `resolveTheme`), so a
 * third state would only let the user pin what the default already does, at the
 * cost of a three-way control in a header that has room for a 34 px circle.
 *
 * The icon pair is driven by the class itself (`dark:` utilities), not by
 * React state, so the swap is correct the instant the boot script paints and
 * stays correct even if this component's state were to disagree.
 *
 * There is no state here at all, deliberately: the page's theme is a fact about
 * `<html>` that the pre-paint script may have already set before React exists,
 * so the honest model is an external store (`useSyncExternalStore` over
 * `subscribeTheme`/`readTheme`) and not a `useState` mirror that an effect has
 * to keep catching up. The mirror was the first version, and it needed two
 * effects — one of which set state in its own body, which is exactly the
 * cascading-render shape `react-hooks/set-state-in-effect` exists to stop.
 */

import { useSyncExternalStore } from "react";
import {
  chooseTheme,
  opposite,
  readStoredTheme,
  readTheme,
  resolveTheme,
  subscribeTheme,
  type Theme,
} from "@/lib/theme";

export function ThemeToggle({ className = "" }: { className?: string }) {
  // `null` is the server snapshot. Before hydration the render cannot know which
  // palette the boot script will land on, and the label says "Colour theme"
  // rather than guessing — the same answer the icon pair is not asked for,
  // because the icons are pure CSS and never guess.
  const theme = useSyncExternalStore<Theme | null>(subscribeTheme, readTheme, () => null);

  function toggle() {
    const current =
      theme ?? resolveTheme(readStoredTheme(), window.matchMedia("(prefers-color-scheme: dark)").matches);
    chooseTheme(opposite(current));
  }

  const to = theme === null ? "colour" : opposite(theme);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === null ? "Colour theme" : `Switch to ${to} theme`}
      title={theme === null ? "Colour theme" : `Switch to ${to} theme`}
      className={`grid h-9 w-9 place-items-center rounded-full border text-foreground transition-colors hover:bg-secondary ${className}`}
    >
      {/* destination icon, not current-state icon, so it agrees with the label */}
      <svg viewBox="0 0 24 24" className="h-4 w-4 dark:hidden" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <svg viewBox="0 0 24 24" className="hidden h-4 w-4 dark:block" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.6v2.2M12 19.2v2.2M4.4 12H2.2M21.8 12h-2.2M6.5 6.5 5 5M19 19l-1.5-1.5M6.5 17.5 5 19M19 5l-1.5 1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}
