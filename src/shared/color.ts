/** Small color toolkit: parse CSS colors, luminance, contrast, mixing. */

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, string> = {
  white: "#ffffff",
  black: "#000000",
  red: "#ff0000",
  blue: "#0000ff",
  green: "#008000",
  gray: "#808080",
  grey: "#808080",
  transparent: "rgba(0,0,0,0)",
  orange: "#ffa500",
  purple: "#800080",
  yellow: "#ffff00",
  pink: "#ffc0cb",
  teal: "#008080",
  navy: "#000080",
  silver: "#c0c0c0",
  indigo: "#4b0082",
  violet: "#ee82ee",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  lime: "#00ff00",
  maroon: "#800000",
  olive: "#808000",
  aqua: "#00ffff",
  gold: "#ffd700",
  coral: "#ff7f50",
  salmon: "#fa8072",
  crimson: "#dc143c",
  slate: "#708090",
  slategray: "#708090",
  whitesmoke: "#f5f5f5",
  ghostwhite: "#f8f8ff",
  lightgray: "#d3d3d3",
  darkgray: "#a9a9a9",
  dimgray: "#696969",
};

export function parseColor(input: string | undefined | null): RGBA | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (NAMED[s]) return parseColor(NAMED[s]);
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      const r = parseInt(h[0] + h[0], 16);
      const g = parseInt(h[1] + h[1], 16);
      const b = parseInt(h[2] + h[2], 16);
      const a = h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1;
      return { r, g, b, a };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    let a = 1;
    if (m[4]) a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  m = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const [r, g, b] = hslToRgb(+m[1], +m[2] / 100, +m[3] / 100);
    let a = 1;
    if (m[4]) a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r, g, b, a };
  }
  m = s.match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const L = m[1].endsWith("%") ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
    const [r, g, b] = oklchToRgb(L, +m[2], +m[3]);
    let a = 1;
    if (m[4]) a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r, g, b, a };
  }
  return null;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function oklchToRgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const gamma = (v: number) => {
    const c = Math.max(0, Math.min(1, v));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };
  return [Math.round(gamma(lr) * 255), Math.round(gamma(lg) * 255), Math.round(gamma(lb) * 255)];
}

export function toHex(c: RGBA): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

export function relativeLuminance(c: RGBA): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

export function contrastRatio(a: RGBA, b: RGBA): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function isDark(color: string): boolean {
  const c = parseColor(color);
  return c ? relativeLuminance(c) < 0.35 : false;
}

export function mix(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  return toHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
    a: 1,
  });
}

export function saturation(c: RGBA): number {
  const max = Math.max(c.r, c.g, c.b) / 255;
  const min = Math.min(c.r, c.g, c.b) / 255;
  const l = (max + min) / 2;
  if (max === min) return 0;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

/** Pick white or near-black text for a background so the contrast is ≥ 4.5 when possible. */
export function readableTextOn(bg: string): string {
  const c = parseColor(bg);
  if (!c) return "#ffffff";
  const white = parseColor("#ffffff")!;
  const dark = parseColor("#0b0f14")!;
  return contrastRatio(c, white) >= contrastRatio(c, dark) ? "#ffffff" : "#0b0f14";
}

/** Adjust `fg` until contrast against `bg` reaches the target ratio (WCAG AA = 4.5). */
export function ensureContrast(fg: string, bg: string, target = 4.5): string {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b) return fg;
  if (contrastRatio(f, b) >= target) return toHex(f);
  const bgDark = relativeLuminance(b) < 0.5;
  const goal = bgDark ? "#ffffff" : "#000000";
  let lo = 0;
  let hi = 1;
  let best = goal;
  for (let i = 0; i < 12; i++) {
    const t = (lo + hi) / 2;
    const candidate = mix(toHex(f), goal, t);
    if (contrastRatio(parseColor(candidate)!, b) >= target) {
      best = candidate;
      hi = t;
    } else lo = t;
  }
  return best;
}

export function rgbaString(c: RGBA, alpha: number): string {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${alpha})`;
}
