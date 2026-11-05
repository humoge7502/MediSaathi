"use client";

/**
 * Site header — brand, section nav, theme control, CTA.
 *
 * Active-section indication: one IntersectionObserver watches the landing
 * sections and marks the nav link whose section occupies the top band of the
 * viewport (rootMargin biased upward). Progressively enhanced: without JS the
 * links are plain anchors; nothing depends on the observer.
 */
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

const SECTIONS = [
  { id: "gap", label: "The gap" },
  { id: "loop", label: "The loop" },
  { id: "law", label: "The law" },
  { id: "proof", label: "The proof" },
] as const;

export function SiteHeader({ onLaunch }: { onLaunch: () => void }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      // A thin horizontal band near the top of the viewport decides which
      // section "is being read" — the standard editorial-header heuristic.
      { rootMargin: "-20% 0px -75% 0px", threshold: 0 }
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <a href="#top" className="flex items-baseline gap-2">
          <span className="vy-serif vy-devanagari text-xl font-semibold" style={{ color: "var(--vy-pine-ink)" }}>
            वैद्य
          </span>
          <span className="text-sm font-semibold tracking-wide">VAIDYA</span>
          <span className="sr-only">— back to top</span>
        </a>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex" aria-label="Sections">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              aria-current={active === s.id ? "true" : undefined}
              data-active={active === s.id}
              className="vy-nav-link py-1 transition-colors hover:text-foreground data-[active=true]:text-foreground"
            >
              {s.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={onLaunch}
            className="rounded-full px-5 py-2 text-sm font-semibold text-white transition-transform hover:scale-[1.03] active:scale-[0.99]"
            style={{ background: "var(--vy-pine)" }}
          >
            Launch app
          </button>
        </div>
      </div>
    </header>
  );
}
