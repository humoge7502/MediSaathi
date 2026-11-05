"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Loading placeholders — the geometry of the panel that is coming, not a
 * sentence about it.
 *
 * Every panel used to pulse one line of real prose ("Loading today…") inside a
 * hairline card. That single line carried two defects that are certain, and one
 * that turned out to be smaller than it looks:
 *
 * - `animate-pulse` cycles a node down to 50% opacity. On a shape that is a
 *   shimmer; on body text it is copy that spends a third of every cycle under
 *   the AA contrast floor — an accessibility failure created by the loading
 *   state and cured by the data arriving.
 * - A screen reader reads the sentence, then reads the panel that replaced it.
 *   The first reading described a state that had already ended.
 * - The third cost was supposed to be layout shift, and it is real but bounded:
 *   measured at 1 280×720 the one-line card left the document exactly a viewport
 *   tall and the skeletons leave it 800 px, against 1 590 px loaded, because
 *   `main` carries `min-h-screen` and floors any placeholder. What drawing the
 *   real layout buys is that each column starts where the loaded column starts —
 *   not that the page stops moving.
 *
 * So: the pulse sits on shapes only, each placeholder block is `aria-hidden`
 * because there is nothing in it to read, and `aria-busy` on the shell is how the
 * region says *loading* to assistive tech that honours it. Support for
 * `aria-busy` is uneven, which is exactly why the shapes carry no text — an AT
 * that ignores the attribute loses nothing, and one that reads it loses the false
 * sentence instead.
 */

interface ShapeProps {
  className?: string;
}

/** One pulsing block. Size comes from the caller, because the only honest thing
 *  about a placeholder is the height of the thing it stands in for, and that is
 *  known where the real layout is written. */
export function Skeleton({ className }: ShapeProps) {
  return <div aria-hidden="true" className={cn("vy-skeleton animate-pulse rounded-md", className)} />;
}

/** A heading-and-line block, the shape every panel card opens with. */
export function SkeletonHeading() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-2.5 w-24" />
      <Skeleton className="h-5 w-2/5" />
    </div>
  );
}

/** A hairline card in the shape the loaded panel will arrive in. */
export function SkeletonCard({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div aria-busy="true" className={cn("vy-hairline-card p-5", className)}>
      {children}
    </div>
  );
}

/** `count` rows of a list, each a label and a trailing numeral — the shape of a
 *  dose line, a medication line or a queue entry. */
export function SkeletonRows({ count, className }: { count: number; className?: string }) {
  return (
    <ul className={cn("mt-3 space-y-3", className)} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex items-center justify-between gap-4 border-b pb-3 last:border-0 last:pb-0">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-3 w-16 shrink-0" />
        </li>
      ))}
    </ul>
  );
}
