import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#141614" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // TD-2: the nonce-based CSP (middleware) requires dynamic rendering — Next
  // stamps its scripts with the per-request nonce during SSR, which cannot
  // happen for prerendered pages. `connection()` opts every document route
  // into dynamic rendering. Tradeoff (documented): the landing page is now
  // rendered per request; it is engine-free and tiny, and the strict CSP is
  // worth more than a static cache here.
  await connection();
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <a href="#main" className="vy-skip-link">
          Skip to content
        </a>
        <main id="main">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
