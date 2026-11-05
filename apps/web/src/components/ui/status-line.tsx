"use client";

/**
 * Status lines for assistive tech — WCAG 2.1 SC 4.1.3 (Status Messages).
 *
 * Two rules decide the shape of these components, and both are easy to get
 * backwards:
 *
 * 1. A live region announces text that changes *inside a node the accessibility
 *    tree already had*. `{msg && <p role="status">…}` inserts the region and its
 *    first message in the same commit, which is precisely the case screen readers
 *    are documented not to report. So the region is always mounted and only its
 *    text changes; an empty region collapses to `h-0` instead of disappearing,
 *    because `display: none` would take it out of the accessibility tree and put
 *    the bug right back.
 *
 * 2. The region holds one sentence, not the result. `aria-live` on a result
 *    container re-reads the entire panel on every mutation inside it — the verify
 *    column used to be one — burying the summary under hundreds of words and
 *    re-reading all of it when an unrelated line is appended underneath.
 *
 * `StatusLine` and `AlertLine` are separate components rather than one `tone`
 * prop because a panel that flips tone on a single node flips `role` on a live
 * region that is already in the tree, which assistive tech is not obliged to
 * re-register. Panels mount both, permanently, and hand the message to one.
 */

import { cn } from "@/lib/utils";

interface LineProps {
  /** The sentence to announce. `null` empties the region; it never unmounts it. */
  text: string | null;
  className?: string;
}

export function StatusLine({ text, className }: LineProps) {
  return (
    <p
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn("text-sm leading-snug text-muted-foreground", text ? "min-h-5" : "h-0", className)}
    >
      {text}
    </p>
  );
}

/** Assertive: it interrupts, so it is for the messages that must not be missed —
 *  a refused dose action, a failed verification. Everything else is `StatusLine`. */
export function AlertLine({ text, className }: LineProps) {
  return (
    <p
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className={cn(
        // The rail marks the line as a refusal without a conditional container;
        // on the empty region it paints nothing, because a 0-height box has no
        // left border to draw.
        "border-l-2 border-[color:var(--vy-severe)] pl-3 vy-sev-severe text-sm font-medium leading-snug",
        text ? "min-h-5" : "h-0 pl-0",
        className
      )}
    >
      {text}
    </p>
  );
}
