/** 404 — the only unreachable URL is a bad address, so the copy is wayfinding,
 * not apology. Same Clinical Editorial voice as the rest of the product. */
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-6 py-20 text-center">
      <p className="vy-numeral text-sm" style={{ color: "var(--vy-pine-ink)" }}>
        404
      </p>
      <h1 className="vy-serif mt-4 text-4xl">
        This page isn&apos;t on the chart.
      </h1>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
        The address doesn&apos;t match anything Vaidya serves. The product
        itself — verification, scheduling, adherence, the evidence suite — is
        one page deep.
      </p>
      <Link
        href="/"
        className="mt-8 rounded-full px-6 py-2.5 text-sm font-semibold text-white"
        style={{ background: "var(--vy-pine)" }}
      >
        Go to Vaidya →
      </Link>
    </div>
  );
}
