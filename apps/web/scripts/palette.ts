/**
 * Palette maths shared by the contrast report and the theme tests.
 *
 * The design system is written in OKLCH (globals.css) while WCAG contrast is
 * computed on relative luminance in sRGB, and the browser composites CSS colours
 * in sRGB. So anything that claims a ratio needs the same three operations, in
 * one place, with the same rounding: OKLCH→sRGB, alpha compositing, and
 * `color-mix(in oklch, …)`.
 *
 * Extracted from `contrast.ts` because `tests/theme.test.ts` now uses
 * `oklchToRgb` to prove the browser-chrome hex values in `src/lib/theme.ts`
 * still are what the CSS tokens say they are. Two copies of this math would
 * drift, and a drifting copy is how a "measured" number stops being measured.
 */

export type Rgb = [number, number, number];
export type Lch = [number, number, number];

export function oklchToRgb(L: number, C: number, Hdeg: number): Rgb {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2301990377 * s;
  const g = -1.2684410233 * l + 2.60926038 * m - 0.3413117266 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const gamma = (u: number) => {
    const x = Math.max(0, Math.min(1, u));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  };
  return [gamma(r), gamma(g), gamma(bl)];
}

export const rgbFromLch = (x: Lch): Rgb => oklchToRgb(x[0], x[1], x[2]);

export function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Alpha-composite `top` over `bottom`, in sRGB — the model for
 * `color-mix(in oklch, X p%, transparent)`, which is an alpha layer. */
export function alphaOver(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  return [0, 1, 2].map((i) => alpha * top[i] + (1 - alpha) * bottom[i]) as Rgb;
}

/**
 * `color-mix(in oklch, A p%, B)` as RGB. L and C interpolate linearly; hue is
 * shortest-path when both sides carry chroma, and inherited from the chromatic
 * side when the other is achromatic — which is how a browser resolves the
 * undefined hue of `white` or a neutral card.
 */
export function mixOklch(a: Lch, b: Lch, pA: number): Rgb {
  const [, c1, h1] = a;
  const [, c2, h2] = b;
  let hue: number;
  if (c1 < 1e-6) hue = h2;
  else if (c2 < 1e-6) hue = h1;
  else {
    const delta = ((((h2 - h1) % 360) + 540) % 360) - 180;
    hue = h1 + pA * delta;
  }
  return oklchToRgb(pA * a[0] + (1 - pA) * b[0], pA * a[1] + (1 - pA) * b[1], hue);
}

/** WCAG 2.x contrast ratio of a foreground against a background. */
export function contrastRatio(fg: Rgb, bg: Rgb): number {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** `#rrggbb` as a browser would paint it from an OKLCH triple. */
export function hexFromLch(x: Lch): string {
  return "#" + rgbFromLch(x).map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}
