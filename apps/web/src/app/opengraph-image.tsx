import { ImageResponse } from "next/og";

export const alt = "Vaidya — Agentic Medication Guardian";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Open Graph card, generated at build/runtime — no binary asset to maintain.
 * Clinical Editorial identity: warm paper field, oversized serif claim, the
 * two law lines as metadata, pine band anchoring the base. */
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
          background: "#fbfaf7",
          padding: "72px 80px",
          fontFamily: "Georgia, serif",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 20,
            letterSpacing: 4,
            color: "#23423d",
            textTransform: "uppercase",
          }}
        >
          VMEDITHON V3.0 · Bio × Engineering
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 76,
            lineHeight: 1.1,
            color: "#1c211f",
          }}
        >
          <span>Every medicine, checked.</span>
          <span style={{ color: "#0b6b5d" }}>Every dose, remembered.</span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div style={{ display: "flex", fontSize: 26, color: "#0b6b5d" }}>
            वैद्य · VAIDYA
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              color: "#faf9f6",
              background: "#0b6b5d",
              padding: "10px 24px",
              borderRadius: 999,
            }}
          >
            The model reads. The rules decide.
          </div>
        </div>
      </div>
    ),
    size
  );
}
