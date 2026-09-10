import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MediSaathi - Every prescription, understood",
  description:
    "Verification-first prescription intelligence: photo to verified, spoken medication plan in Tamil, Hindi, or English.",
};

const THEME_INIT = `
(function(){
  try {
    if (localStorage.getItem("medisaathi-contrast") === "1") {
      document.documentElement.classList.add("contrast");
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        {children}
        <footer className="mx-auto max-w-3xl px-6 pb-10 pt-16 text-center text-xs" style={{ color: "var(--muted)" }}>
          MediSaathi is an information tool, not a doctor. Discuss every medicine with your
          pharmacist or doctor. Data snapshots are cited on every verdict.
        </footer>
      </body>
    </html>
  );
}
