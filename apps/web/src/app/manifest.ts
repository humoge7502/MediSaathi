import type { MetadataRoute } from "next";

/** PWA manifest: installed-app identity for the workspace product. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vaidya — Agentic Medication Guardian",
    short_name: "Vaidya",
    description:
      "Closed-loop medication safety: verify, schedule, adhere, protect — refusing, never guessing, when confidence drops.",
    start_url: "/",
    display: "standalone",
    background_color: "#fbfaf7",
    theme_color: "#0b6b5d",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
