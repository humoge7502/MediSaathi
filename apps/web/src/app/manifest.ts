/**
 * The web-app manifest (`/manifest.webmanifest`).
 *
 * It is a route and not a file in `public/` for one reason: `theme_color` and
 * `background_color` have to be the colours the product actually paints. A
 * hand-typed manifest is exactly the defect RES-33 records for `themeColor`
 * metadata — two hexes that were no token in the stylesheet, so a dark-preference
 * visitor got a light page inside a chrome the OS had already promised would be
 * dark. Here the values come from `THEME_CHROME`, which `tests/theme.test.ts`
 * already pins to the tokens each scheme paints, so a palette edit moves the
 * manifest with it and `tests/pwa.test.ts` fails anything that drifts the other
 * way.
 *
 * The manifest carries the *light* chrome and cannot do otherwise: it is read by
 * the OS at install time, before a document exists to resolve a scheme. The
 * per-visit colour is the job of `meta[name=theme-color]`, which the boot script
 * rewrites before first paint.
 */
import { TODAY_URL, VERIFY_URL } from "@/lib/reminders-background";
import { THEME_CHROME } from "@/lib/theme";

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vaidya — medication guardian",
    short_name: "Vaidya",
    description:
      "Verify a prescription, get a plain-language plan, and be reminded at the dose moment. The safety decisions are rule-derived and run offline.",
    lang: "en-IN",
    dir: "ltr",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: THEME_CHROME.light,
    theme_color: THEME_CHROME.light,
    categories: ["health", "medical", "lifestyle"],
    icons: [
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        // Two purposes, two entries — the form the manifest spec and Next's own
        // `MetadataRoute.Manifest` type both accept (`purpose` is a single token
        // there, not the "any maskable" string). One file behind both: its
        // background is full-bleed and the glyph sits inside the central 60%, so
        // a launcher that crops to a circle or a squircle cannot cut the mark.
        // `tests/pwa.test.ts` checks the geometry claim instead of trusting this
        // sentence, and checks that both purposes are present so neither launcher
        // falls back to a rasterised screenshot of the page.
        purpose: "any",
      },
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Today's doses",
        short_name: "Today",
        description: "Open the plan and mark a dose taken or skipped.",
        url: TODAY_URL,
        icons: [{ src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" }],
      },
      {
        name: "Verify a prescription",
        short_name: "Verify",
        description: "Paste or photograph a prescription and get the safety read.",
        url: VERIFY_URL,
        icons: [{ src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" }],
      },
    ],
  };
}
