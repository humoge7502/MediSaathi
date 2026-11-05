"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The card a panel shows when there is nothing to show.
 *
 * Empty is a state with an exit, so the pair is always a name and the route that
 * fills it — never a shrug. Panels hand-wrote this and drifted: two centred a
 * serif headline, one paired it with a button, and only Today named the tab the
 * user had to go to. The copy belongs to the panel; the shape does not, so the
 * shape lives here.
 */
export function EmptyState({
  title,
  children,
  className,
}: {
  title: string;
  /** The way out, in the panel's own words. Optional in the type only because
   *  `createElement` in the static tier passes it positionally; every caller
   *  does, and `tests/placeholder.test.ts` fails a card whose body carries no
   *  route — a guarantee about the copy, which a type cannot state. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "vy-hairline-card flex min-h-64 flex-col items-center justify-center gap-2 p-10 text-center",
        className
      )}
    >
      <p className="vy-serif text-2xl">{title}</p>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}
