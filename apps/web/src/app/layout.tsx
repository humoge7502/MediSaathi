import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Vaidya — Agentic Medication Guardian",
  description:
    "Closed-loop medication safety: verify prescriptions with a deterministic safety engine, schedule therapy, measure adherence, and answer with citations — refusing, never guessing, when confidence drops.",
  keywords: ["medication safety", "adherence", "drug interactions", "health AI", "VMEDITHON", "VIT Chennai"],
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%230b6b5d'/%3E%3Ctext x='16' y='22' font-size='16' text-anchor='middle' fill='%23faf9f6' font-family='Georgia'%3E%E0%A4%B5%3C/text%3E%3C/svg%3E",
  },
  openGraph: {
    title: "Vaidya — Agentic Medication Guardian",
    description: "The model reads. The rules decide. Every medicine checked, every dose remembered.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
