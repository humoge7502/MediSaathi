import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { headers } from "next/headers";
import { Geist, Geist_Mono, Fraunces, Rozha_One } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { THEME_BOOT_SCRIPT, THEME_CHROME } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display face for every `.vy-serif` surface — headings, the verdict label, the
// big numerals. Variable with an `opsz` axis, so `font-optical-sizing: auto`
// gives the page a *display* cut at 48 px and a text cut at 18 px from one file,
// which is the difference between a serif that looks set and one that looks
// scaled. `SOFT`/`WONK` are Fraunces' own axes: the hero turns WONK on, the rest
// of the product does not. Italic is requested because three surfaces use it and
// a synthesised oblique on a serif is the tell that the face was not chosen.
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "variable",
  style: ["normal", "italic"],
  axes: ["SOFT", "WONK"],
});

// The wordmark is Devanagari (वैद्य), and a Latin-only display face renders it in
// whatever the OS offers — on a demo machine that is a fallback sans sitting
// inside a serif brand. Rozha One is a high-contrast Devanagari display serif
// that reads as the same family as the Latin beside it.
const rozha = Rozha_One({
  variable: "--font-devanagari",
  subsets: ["devanagari", "latin"],
  weight: "400",
});

// Canonical origin for metadata (Open Graph, sitemap, robots). Deployments
// set NEXT_PUBLIC_SITE_URL; the fallback keeps local dev coherent.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Vaidya — Agentic Medication Guardian",
    template: "%s · Vaidya",
  },
  description:
    "Closed-loop medication safety: verify prescriptions with a deterministic safety engine, schedule therapy, measure adherence, and answer with citations — refusing, never guessing, when confidence drops.",
  keywords: ["medication safety", "adherence", "drug interactions", "health AI", "VMEDITHON", "VIT Chennai"],
  alternates: { canonical: "/" },
  // Icon ships as a file convention (src/app/icon.svg); no data-URI duplicate.
  openGraph: {
    title: "Vaidya — Agentic Medication Guardian",
    description:
      "The model reads. The rules decide. Every medicine checked, every dose remembered.",
    type: "website",
    url: "/",
    siteName: "Vaidya",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Vaidya — Agentic Medication Guardian",
    description: "The model reads. The rules decide. Closed-loop medication safety that refuses rather than guesses.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  // One meta, not a light/dark media pair: the app now has its own theme
  // switch, so the browser chrome must follow the *rendered* scheme, which a
  // media query cannot express. The SSR default is light and the boot script
  // below rewrites the content attribute to the resolved theme before paint.
  themeColor: THEME_CHROME.light,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // TD-2: the nonce-based CSP (proxy) requires dynamic rendering — Next
  // stamps its scripts with the per-request nonce during SSR, which cannot
  // happen for prerendered pages. `connection()` opts every document route
  // into dynamic rendering. Tradeoff (documented): the landing page is now
  // rendered per request; it is engine-free and tiny, and the strict CSP is
  // worth more than a static cache here.
  await connection();
  // The proxy mints a per-request nonce and puts it on the request headers
  // (src/proxy.ts); Next reads the same header to stamp its own bootstrap
  // scripts. This is the only other consumer: script-src has no
  // 'unsafe-inline', so an inline script without the nonce is silently
  // blocked, and a blocked theme script is a white flash on a dark visit.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} ${rozha.variable} antialiased bg-background text-foreground`}
      >
        <a href="#main" className="vy-skip-link">
          Skip to content
        </a>
        {/* The page owns its own <main id="main">, because the skip link has to name
            the content *after* the navigation bar and only the page knows where the
            bar ends. A wrapper here would nest one main inside another — the second
            landmark a reader then has to find their way out of — and would put the
            header inside the jump target, so "Skip to content" re-presented the
            navigation it claimed to bypass. */}
        {children}
        <Toaster />
      </body>
    </html>
  );
}
