import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-20 text-center">
      <p className="text-4xl" aria-hidden="true">🔍</p>
      <h1 className="mt-4 text-2xl font-bold" style={{ color: "var(--primary)" }}>
        Page not found
      </h1>
      <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
        The page you are looking for does not exist. Everything useful lives one
        click away:
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <Link
          href="/scan"
          className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
          style={{ background: "var(--primary)" }}
        >
          Scan a prescription
        </Link>
        <Link
          href="/"
          className="rounded-lg border px-5 py-2.5 text-sm"
          style={{ borderColor: "var(--border)" }}
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
