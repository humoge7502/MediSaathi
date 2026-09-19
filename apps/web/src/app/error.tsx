"use client";

import { useEffect } from "react";

/** Route error boundary: every failure lands here rendered as Vaidya — the
 * same paper, the same serif, the same honest voice. The digest is shown
 * (support conversations need it); stack traces stay in the console. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[vaidya] route error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-6 py-20 text-center">
      <p className="vy-eyebrow">Something failed on our side</p>
      <h1 className="vy-serif mt-4 text-4xl">
        We stopped rather than guess.
      </h1>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
        This screen hit an unexpected error. Nothing was saved incorrectly and
        nothing was invented to fill the gap — the same refusal principle the
        safety engine applies to prescriptions applies here.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-full px-6 py-2.5 text-sm font-semibold text-white"
          style={{ background: "var(--vy-pine)" }}
        >
          Try again
        </button>
        <a
          href="/"
          className="rounded-full border px-6 py-2.5 text-sm font-medium transition-colors hover:bg-secondary"
        >
          Back to the beginning
        </a>
      </div>
      {error.digest ? (
        <p className="vy-numeral mt-10 text-xs text-muted-foreground">
          error reference {error.digest}
        </p>
      ) : null}
    </div>
  );
}
