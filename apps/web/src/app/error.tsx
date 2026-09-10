"use client";

// Route-level error boundary: users never see a raw stack trace.
// Offers a retry (transient failures) and a way home (persistent ones).
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-20 text-center">
      <p className="text-4xl" aria-hidden="true">⚠</p>
      <h1 className="mt-4 text-2xl font-bold" style={{ color: "var(--primary)" }}>
        Something went wrong
      </h1>
      <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
        The page failed to load. Your data was not lost - prescription records are
        stored server-side and survive page errors.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs" style={{ color: "var(--muted)" }}>
          reference: {error.digest}
        </p>
      )}
      <div className="mt-8 flex justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
          style={{ background: "var(--primary)" }}
        >
          Try again
        </button>
        <a
          href="/"
          className="rounded-lg border px-5 py-2.5 text-sm"
          style={{ borderColor: "var(--border)" }}
        >
          Go home
        </a>
      </div>
    </main>
  );
}
