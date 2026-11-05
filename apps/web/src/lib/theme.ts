/**
 * Theme resolution — the single source of truth for light and dark.
 *
 * globals.css has carried a full `.dark` palette since the design system
 * landed, and nothing could ever apply it: no control, no stored preference, no
 * `color-scheme` (RES-33). This module owns the four facts the rest of the app
 * shares — where the choice is stored, which class carries it, what the browser
 * chrome colour becomes, and how a first visit resolves when nothing is stored.
 * Both consumers (the pre-paint boot script and the toggle) build from these
 * same values, so the SSR default, the script and the control cannot drift.
 *
 * It is deliberately not a dependency: a theme package would add a provider and
 * a context for four constants, and the part that actually constrains the design
 * here — the script needs the per-request CSP nonce, which only the proxy and
 * the root layout can thread — would still be hand-written.
 *
 * The dark pairs are measured rather than eyeballed: `bun scripts/contrast.ts`
 * prints PASS/FAIL for every foreground/background combination below.
 */

export type Theme = "light" | "dark";

/** Persisted choice. Namespaced, because this browser profile also holds the
 * reminder delivery log (`use-reminders.ts`) and a bare "theme" key is the kind
 * of collision that silently reads someone else's value. */
export const THEME_STORAGE_KEY = "vaidya-theme";

/** Tailwind v4 is configured with `@custom-variant dark (&:is(.dark *))`, so
 * the class must sit on an ancestor of everything it recolours — `<html>`. */
export const DARK_CLASS = "dark";

/**
 * Browser-chrome colour per scheme, converted from the token each scheme
 * actually paints with: light is `--vy-paper` oklch(0.975 0.004 90), dark is
 * `.dark --background` oklch(0.18 0.01 160). The metadata block this replaces
 * claimed #fbfaf7 and #141614, which are neither of those tokens.
 */
export const THEME_CHROME: Record<Theme, string> = {
  light: "#f8f7f4",
  dark: "#0e1310",
};

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/**
 * The whole law, in one pure function: an explicit stored choice wins, and
 * with nothing stored the app follows the OS. A corrupt or unknown stored value
 * is treated as "nothing stored" rather than trusted, so a hostile or stale
 * localStorage entry cannot put an unknown class on `<html>`.
 */
export function resolveTheme(stored: unknown, prefersDark: boolean): Theme {
  if (isTheme(stored)) return stored;
  return prefersDark ? "dark" : "light";
}

export function opposite(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

/* ---------------------------------------------------------------- DOM half
 * Everything below touches the document, which is why it lives in functions
 * rather than at module scope: `tests/theme.test.ts` and the E2E spec both
 * import this file in a plain JS runtime, and a top-level `document` here would
 * take the pure law down with it.
 */

/** A blocked storage API is "nothing stored", not a throw — the same degraded
 * outcome the boot script chooses, and for the same reason: the page still has
 * to resolve to the OS. */
export function readStoredTheme(): string | null {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Which palette is on the page right now — read from the class, never from
 * component state, so the boot script's work counts as the truth. */
export function readTheme(): Theme {
  return document.documentElement.classList.contains(DARK_CLASS) ? "dark" : "light";
}

/** The DOM side of the law, in one place so the control and the pre-paint
 * script cannot diverge: a class on `<html>` plus one meta attribute.
 * `THEME_BOOT_SCRIPT` is this function written as text, and the test that pins
 * the two together is the reason neither may grow a fourth effect. */
export function paintTheme(theme: Theme): void {
  document.documentElement.classList.toggle(DARK_CLASS, theme === "dark");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_CHROME[theme]);
}

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * `useSyncExternalStore`'s subscribe contract.
 *
 * The OS listener belongs here and not in the component because the rule it
 * implements — an expressed choice silences the system, an unexpressed one
 * follows it — is part of the theme law, and a second consumer must not be able
 * to get it wrong.
 */
export function subscribeTheme(listener: Listener): () => void {
  listeners.add(listener);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (readStoredTheme() !== null) return;
    paintTheme(resolveTheme(null, mq.matches));
    emit();
  };
  mq.addEventListener("change", onChange);
  return () => {
    listeners.delete(listener);
    mq.removeEventListener("change", onChange);
  };
}

/** The user spoke. Persist first, then paint: if storage throws, this visit
 * still changes and only the memory is lost. */
export function chooseTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // persistence is the casualty, not the page
  }
  paintTheme(theme);
  emit();
}

/**
 * Runs before first paint, in a nonced inline script (the CSP has no
 * 'unsafe-inline' for scripts — TD-2), so a dark-preference visitor never sees
 * a white flash. `color-scheme` is set by the stylesheet, not here, so form
 * controls, scrollbars and the default canvas follow the class in one place.
 *
 * try/catch, not a guard: reading localStorage throws outright in a browser that
 * blocks storage for the page, and an exception here would leave the document
 * unstyled-in-dark *and* stop the script before the meta update. Falling through
 * to the light default is the correct degraded outcome.
 */
export const THEME_BOOT_SCRIPT = [
  "(function(){",
  "try{",
  `var k="${THEME_STORAGE_KEY}";`,
  "var s=null;",
  "try{s=localStorage.getItem(k);}catch(e){}",
  "var d=!!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);",
  `var t=(s==="light"||s==="dark")?s:(d?"dark":"light");`,
  `document.documentElement.classList.toggle("${DARK_CLASS}",t==="dark");`,
  "var m=document.querySelector('meta[name=\"theme-color\"]');",
  `if(m)m.setAttribute("content",t==="dark"?"${THEME_CHROME.dark}":"${THEME_CHROME.light}");`,
  "}catch(e){}",
  "})();",
].join("");
