import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ImageResponse } from "next/og";

export const alt = "Vaidya — Agentic Medication Guardian";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Open Graph card. Clinical Editorial identity: warm paper field, oversized
 * serif claim, the two law lines as metadata, a pine-fill pill anchoring the
 * base.
 *
 * The card is composed by satori, not by a browser: it inherits nothing from
 * `globals.css` and knows only the faces it is handed. An earlier revision of
 * this file asked for `fontFamily: "Georgia, serif"` and handed over no fonts at
 * all, so the "oversized serif claim" it described rendered in the runtime's
 * bundled sans — and its five hardcoded colours were a snapshot of the palette
 * before the theme pass, so the one surface every share, link preview and
 * investor message shows was painting colours the product no longer uses
 * (`#0b6b5d` where `--vy-pine` resolves to `#0f6353`). Both halves are now
 * derived and gated in `tests/theme.test.ts`: every colour literal here is a
 * token `:root` declares, every family literal here is a face registered below,
 * every face file exists and is traced into the standalone image, and the
 * claim's metrics are the hero's.
 *
 * OFL-1.1 faces, unmodified Google Fonts static instances, licence text shipped
 * beside each file in `src/app/fonts/`.
 */

// `fetch(new URL("./fonts/x.ttf", import.meta.url))` is the pattern the Next.js
// OG docs show and Turbopack does not implement it: the build reached this line
// and threw `[TypeError: fetch failed] not implemented... yet...` while
// prerendering `/opengraph-image`. Reading the file is the portable form, and
// `outputFileTracingIncludes` in `next.config.ts` is what keeps these bytes
// beside the standalone server the container runs — the card is prerendered
// today, so this read happens at build; the first dynamic card would happen at
// request time, and a face that only exists in the source tree is a 500 on a
// link preview.
const FONT_DIR = join(process.cwd(), "src", "app", "fonts");

const FACES: { name: string; weight: 400 | 600; file: string }[] = [
  { name: "Fraunces", weight: 600, file: "fraunces-display-600.ttf" },
  { name: "Rozha One", weight: 400, file: "rozha-one-400.ttf" },
];

const fontData = (file: string): ArrayBuffer => new Uint8Array(readFileSync(join(FONT_DIR, file))).buffer;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#f8f7f4",
          padding: "72px 80px",
        }}
      >
        <div style={{ display: "flex" }}>
          <div
            style={{
              display: "flex",
              fontSize: 20,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "#003d31",
            }}
          >
            VMEDITHON V3.0 · Bio × Engineering
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontFamily: "Fraunces",
            fontWeight: 600,
            fontSize: 76,
            lineHeight: 1.02,
            letterSpacing: "-0.02em",
            color: "#171c19",
          }}
        >
          <span>Every medicine, checked.</span>
          <span style={{ color: "#003d31" }}>Every dose, remembered.</span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span
              style={{
                display: "flex",
                fontFamily: "Rozha One",
                fontSize: 34,
                color: "#003d31",
              }}
            >
              वैद्य
            </span>
            <span style={{ display: "flex", fontSize: 20, letterSpacing: 3, color: "#171c19" }}>
              VAIDYA
            </span>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              color: "#fdfcf8",
              background: "#0f6353",
              padding: "10px 24px",
              borderRadius: 999,
            }}
          >
            The model reads. The rules decide.
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: FACES.map((face) => ({
        name: face.name,
        data: fontData(face.file),
        style: "normal",
        weight: face.weight,
      })),
    }
  );
}
