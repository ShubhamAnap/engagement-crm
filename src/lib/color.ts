/** Convert #RRGGBB to oklch() so theme tokens mix cleanly with color-mix / Tailwind alpha. */

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function hexToOklchCss(hex: string, opts?: { minLightness?: number }): string {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return "oklch(0.36 0.11 254)";
  const r = srgbToLinear(parseInt(raw.slice(0, 2), 16) / 255);
  const g = srgbToLinear(parseInt(raw.slice(2, 4), 16) / 255);
  const b = srgbToLinear(parseInt(raw.slice(4, 6), 16) / 255);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  let L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  if (opts?.minLightness != null) L = Math.max(L, opts.minLightness);
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const b2 = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const C = Math.sqrt(a * a + b2 * b2);
  let H = (Math.atan2(b2, a) * 180) / Math.PI;
  if (H < 0) H += 360;

  return `oklch(${L.toFixed(4)} ${C.toFixed(4)} ${H.toFixed(2)})`;
}

export function contrastingForegroundOklch(hex: string): string {
  const raw = hex.replace("#", "");
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.55 ? "oklch(0.18 0.02 254)" : "oklch(0.99 0.005 254)";
}
