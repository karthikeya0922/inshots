import type { DesignTokens, RuntimeAnalysis, Screen, UIAnalysis, VisualSystem } from "../types.js";
import { contrastRatio, ensureContrast, isDark, mix, parseColor, relativeLuminance, saturation, toHex, readableTextOn } from "../shared/color.js";
import { topN } from "../shared/text.js";

/**
 * UIUXAnalyzer: turns sampled computed styles from real rendered pages into a
 * visual system (colors, typography, radius, shadows, glass) plus a design
 * language classification. When no runtime is available it falls back to the
 * repository's CSS tokens. Confidence is reported; we never force a style.
 */

// Only generic families here: Hyperframes' lint requires an @font-face for any *named* family it cannot
// auto-resolve, and it auto-resolves Google Fonts by name — see GOOGLE_FONTS below.
const SYSTEM_SANS = "system-ui, sans-serif";
const SYSTEM_MONO = "ui-monospace, monospace";
const SYSTEM_SERIF = "ui-serif, serif";

/** Google Fonts families Hyperframes can fetch by name — using them preserves the product's real typography. */
const GOOGLE_FONTS = new Set([
  "inter", "roboto", "open sans", "lato", "montserrat", "poppins", "source sans 3", "source sans pro", "nunito", "nunito sans", "raleway", "work sans", "dm sans", "manrope", "figtree", "plus jakarta sans", "outfit", "space grotesk", "sora", "urbanist", "lexend", "rubik", "karla", "mulish", "ibm plex sans", "ibm plex mono", "ibm plex serif", "jetbrains mono", "fira code", "fira sans", "source code pro", "roboto mono", "space mono", "dm mono", "playfair display", "merriweather", "lora", "libre baskerville", "crimson pro", "fraunces", "eb garamond", "cormorant garamond", "bricolage grotesque", "geist", "geist mono", "instrument sans", "instrument serif", "onest", "archivo", "barlow", "cabin", "quicksand", "josefin sans", "oswald", "bebas neue", "anton", "syne", "unbounded", "chivo", "public sans", "red hat display", "red hat text", "libre franklin", "noto sans", "noto serif", "pt sans", "pt serif", "ubuntu", "ubuntu mono", "titillium web", "exo 2", "kanit", "prompt", "hind", "heebo", "assistant", "be vietnam pro", "albert sans", "schibsted grotesk", "hanken grotesk", "gabarito", "atkinson hyperlegible", "spectral", "newsreader", "literata", "zilla slab", "roboto slab", "bitter", "domine", "vollkorn", "recursive", "commissioner", "epilogue", "jost", "nunito", "mona sans", "hubot sans", "overpass", "questrial", "varela round", "comfortaa", "righteous", "pacifico", "caveat", "dancing script", "courier prime", "inconsolata", "overpass mono", "victor mono", "azeret mono", "martian mono", "chivo mono",
]);

export function isGoogleFont(family: string): boolean {
  return GOOGLE_FONTS.has(family.trim().toLowerCase().replace(/["']/g, ""));
}

export function analyzeUI(runtime: RuntimeAnalysis, tokens: DesignTokens): UIAnalysis {
  const screens = runtime.screens;
  if (!screens.length) return staticUIAnalysis(tokens, runtime.sourceDerived.length > 0);

  // ---- Aggregate weighted style samples across screens (top screens weigh more)
  const agg = { backgrounds: {} as Record<string, number>, textColors: {} as Record<string, number>, fontFamilies: {} as Record<string, number>, fontSizes: {} as Record<string, number>, fontWeights: {} as Record<string, number>, borderRadii: {} as Record<string, number>, shadows: {} as Record<string, number>, gradients: [] as string[], backdropFilters: 0, iconCount: 0, monospaceUsage: 0, textTotal: 0 };
  const merge = (into: Record<string, number>, from: Record<string, number>, w: number) => {
    for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v * w;
  };
  screens.forEach((s, i) => {
    const w = i === 0 ? 1.5 : 1;
    merge(agg.backgrounds, s.styles.backgrounds, w);
    merge(agg.textColors, s.styles.textColors, w);
    merge(agg.fontFamilies, s.styles.fontFamilies, w);
    merge(agg.fontSizes, s.styles.fontSizes, w);
    merge(agg.fontWeights, s.styles.fontWeights, w);
    merge(agg.borderRadii, s.styles.borderRadii, w);
    merge(agg.shadows, s.styles.shadows, w);
    for (const g of s.styles.gradients) if (!agg.gradients.includes(g)) agg.gradients.push(g);
    agg.backdropFilters += s.styles.backdropFilters;
    agg.iconCount += s.styles.iconCount;
    agg.monospaceUsage += s.styles.monospaceUsage;
    agg.textTotal += Object.values(s.styles.textColors).reduce((a, b) => a + b, 0);
  });

  // ---- Background: the page background as computed by the browser, cross-checked with area-weighted sampling.
  const bodyBg = screens[0].dom.bodyBackground;
  const bgRanked = topN(agg.backgrounds, 12).map(([c]) => c).filter((c) => parseColor(c));
  let background = normalize(bodyBg) ?? normalize(bgRanked[0]) ?? "#ffffff";
  if (bgRanked[0] && normalize(bgRanked[0]) && Math.abs(relativeLuminance(parseColor(bgRanked[0])!) - relativeLuminance(parseColor(background)!)) > 0.5 && agg.backgrounds[bgRanked[0]] > 0.6 * Object.values(agg.backgrounds).reduce((a, b) => a + b, 0)) {
    // A full-bleed wrapper dominates: trust the sampled area.
    background = normalize(bgRanked[0])!;
  }
  const mode: "dark" | "light" = isDark(background) ? "dark" : "light";
  const bgC = parseColor(background)!;

  // ---- Surface: the most common background that is near-but-not-equal to the page background.
  const surface = bgRanked.map(normalize).filter((c): c is string => !!c).find((c) => {
    const pc = parseColor(c)!;
    const dl = Math.abs(relativeLuminance(pc) - relativeLuminance(bgC));
    return c !== background && dl > 0.01 && dl < 0.25 && saturation(pc) < 0.35;
  }) ?? (mode === "dark" ? mix(background, "#ffffff", 0.06) : mix(background, "#000000", 0.035));

  // ---- Text colors: most used text color with readable contrast on the background.
  const textRanked = topN(agg.textColors, 10).map(([c]) => normalize(c)).filter((c): c is string => !!c);
  const text = textRanked.find((c) => contrastRatio(parseColor(c)!, bgC) >= 4.5) ?? readableTextOn(background);
  const mutedText = textRanked.find((c) => c !== text && contrastRatio(parseColor(c)!, bgC) >= 3 && contrastRatio(parseColor(c)!, bgC) < contrastRatio(parseColor(text)!, bgC)) ?? mix(text, background, 0.4);

  // ---- Accent: the most saturated color used on buttons/backgrounds with decent area, excluding text/bg neutrals.
  const accentCandidates = [...topN(agg.backgrounds, 30), ...topN(agg.textColors, 12)]
    .map(([c, w]) => ({ c: normalize(c), w, p: parseColor(c) }))
    .filter((x): x is { c: string; w: number; p: NonNullable<ReturnType<typeof parseColor>> } => !!x.c && !!x.p && x.p.a > 0.5)
    .filter((x) => saturation(x.p) > 0.35 && relativeLuminance(x.p) > 0.03 && relativeLuminance(x.p) < 0.85)
    .map((x) => ({ ...x, score: saturation(x.p) * 2 + Math.log10(x.w + 1) * 0.3 }))
    .sort((a, b) => b.score - a.score);
  let accent = accentCandidates[0]?.c ?? tokenAccent(tokens) ?? (mode === "dark" ? "#7c9cff" : "#2563eb");
  // Accent from tokens wins when the sampled one is too close to neutral text.
  const tokenAcc = tokenAccent(tokens);
  if (tokenAcc && (!accentCandidates.length || accentCandidates[0].score < 1.0)) accent = tokenAcc;
  const accentText = readableTextOn(accent);
  const palette = uniqColors([background, surface, accent, ...accentCandidates.slice(0, 5).map((x) => x.c), text].filter(Boolean) as string[]).slice(0, 8);

  // ---- Typography
  const families = topN(agg.fontFamilies, 6).map(([f]) => f).filter((f) => f && !/^(inherit|initial)$/i.test(f));
  const body = families[0] ?? "system-ui";
  // Display font: the family used on the largest sizes, when different from body.
  const display = displayFamily(screens) ?? body;
  const mono = families.find((f) => /mono|code|courier|consolas|menlo|fira|jetbrains/i.test(f));
  const sizes = topN(agg.fontSizes, 8).map(([s]) => s).sort((a, b) => parseFloat(a) - parseFloat(b));
  const weights = topN(agg.fontWeights, 5).map(([w]) => w);

  // ---- Radius, shadows, glass
  const radiiRanked = topN(agg.borderRadii, 5).map(([r]) => r);
  const radiiPx = median(radiiRanked.map((r) => parseFloat(r)).filter((n) => !Number.isNaN(n)));
  const borderRadius = radiiPx >= 20 ? "pill / very rounded" : radiiPx >= 10 ? "rounded" : radiiPx >= 4 ? "subtly rounded" : "sharp";
  const shadows = topN(agg.shadows, 3).map(([s]) => s);
  const glass = agg.backdropFilters >= 2;

  // ---- Components across screens
  const components: Record<string, number> = {};
  for (const s of screens) for (const c of s.components) components[c] = (components[c] ?? 0) + 1;

  // ---- Design language classification (evidence-based, multi-label)
  const language: string[] = [];
  const notes: string[] = [];
  language.push(mode);
  if (glass) language.push("glass");
  const gradientUse = agg.gradients.length;
  if (gradientUse >= 2) language.push("gradient-rich");
  const avgSize = weightedAvg(agg.fontSizes);
  const boldShare = share(agg.fontWeights, (w) => parseInt(w, 10) >= 600);
  const monoShare = agg.textTotal ? agg.monospaceUsage / agg.textTotal : 0;
  const hasDashboard = (components.sidebar ?? 0) + (components.chart ?? 0) + (components.table ?? 0) >= 2;
  const cardsShare = (components.cards ?? 0) / screens.length;
  const sat = saturation(parseColor(accent)!);
  if (hasDashboard) language.push("dashboard");
  if (monoShare > 0.15 || (components.code ?? 0) > 0) language.push("developer-focused");
  if (cardsShare > 0.5 && radiiPx >= 10) language.push("modern SaaS");
  if (radiiPx >= 14 && shadows.length && !glass) language.push("soft / friendly");
  if (radiiPx <= 3 && !shadows.length) language.push("brutalist / flat");
  if (mode === "dark" && sat > 0.5) language.push("premium");
  if (mode === "light" && sat < 0.6 && !gradientUse && radiiPx < 10) language.push("enterprise");
  if (Object.keys(agg.backgrounds).length <= 6 && !gradientUse && shadows.length <= 1) language.push("minimal");
  if (sat > 0.75 && boldShare > 0.35 && gradientUse) language.push("playful");
  if (avgSize && avgSize >= 17) language.push("large-type");
  const designConfidence = Math.min(0.95, 0.4 + screens.length * 0.08 + (agg.textTotal > 500 ? 0.15 : 0));
  if (designConfidence < 0.6) notes.push("Few screens captured — design language classification has low confidence.");

  const layout: UIAnalysis["layout"] = hasDashboard ? "dashboard" : screens[0].dom.headings.length && screens[0].dom.textLength > 800 && (components.form ?? 0) === 0 && screens.length <= 2 ? "landing" : (components.form ?? 0) > 0 || (components.tabs ?? 0) > 0 ? "app" : monoShare > 0.3 ? "docs" : screens.length > 3 ? "app" : "content";

  const perScreen = screens.map((s) => ({ screenId: s.id, components: s.components, dominantColors: topN(s.styles.backgrounds, 3).map(([c]) => normalize(c) ?? c) }));

  const visualSystem: VisualSystem = {
    colors: { background, surface, text: ensureContrast(text, background), mutedText: ensureContrast(mutedText, background, 3), accent, accentText, palette, gradients: agg.gradients.slice(0, 4), mode },
    typography: { display, body, mono, families, sizes, weights, displayStack: stackFor(display), bodyStack: stackFor(body) },
    borderRadius,
    radiiPx: Number.isNaN(radiiPx) ? 8 : radiiPx,
    shadows,
    glass,
    spacingScale: avgSize && avgSize > 16 ? "airy" : avgSize && avgSize < 13.5 ? "tight" : "regular",
    iconStyle: agg.iconCount > screens.length * 6 ? "svg icon set" : undefined,
  };
  return { status: "runtime", visualSystem, components, designLanguage: language, designConfidence: Math.round(designConfidence * 100) / 100, layout, perScreen, notes };
}

/** Static fallback: derive a visual system from CSS tokens in the repository. */
export function staticUIAnalysis(tokens: DesignTokens, hasSourceVisuals: boolean): UIAnalysis {
  const p = staticPalette(tokens);
  const mode: "dark" | "light" = isDark(p.background) ? "dark" : "light";
  const fonts = tokens.fonts.map((f) => f.split(",")[0].replace(/["']/g, "").trim()).filter(Boolean);
  const display = fonts[0] ?? "system-ui";
  const radius = tokens.radii[0] ? parseFloat(tokens.radii[0]) : 8;
  const notes = ["No rendered UI available — visual system derived from repository CSS tokens."];
  if (!tokens.source.length) notes.push("No stylesheets found; using a neutral system palette.");
  return {
    status: hasSourceVisuals ? "static" : "none",
    visualSystem: {
      colors: { background: p.background, surface: p.surface, text: p.text, mutedText: mix(p.text, p.background, 0.4), accent: p.accent, accentText: readableTextOn(p.accent), palette: uniqColors([p.background, p.surface, p.accent, p.text]), gradients: [], mode },
      typography: { display, body: fonts[1] ?? display, mono: fonts.find((f) => /mono|code/i.test(f)), families: fonts, sizes: [], weights: [], displayStack: stackFor(display), bodyStack: stackFor(fonts[1] ?? display) },
      borderRadius: radius >= 12 ? "rounded" : radius >= 4 ? "subtly rounded" : "sharp",
      radiiPx: Number.isNaN(radius) ? 8 : radius,
      shadows: [],
      glass: false,
      spacingScale: "regular",
    },
    components: {},
    designLanguage: [mode, ...(tokens.source.length ? [] : ["neutral"])],
    designConfidence: tokens.source.length ? 0.4 : 0.15,
    layout: "unknown",
    perScreen: [],
    notes,
  };
}

export function staticPalette(tokens: DesignTokens): { background: string; surface: string; text: string; accent: string; mono: string } {
  const find = (re: RegExp) => Object.entries(tokens.colors).find(([k, v]) => re.test(k) && parseColor(resolveVar(v, tokens)))?.[1];
  const bgRaw = find(/^(--)?(bg|background|color-bg|color-background|surface-0|base|body-bg)$/i) ?? find(/(^|-)(bg|background)(-primary|-base|-default|-page|-body)?$/i) ?? find(/background/i);
  const accentRaw = find(/^(--)?(primary|accent|brand|color-primary|color-accent|primary-color|accent-color)$/i) ?? find(/(primary|accent|brand)(-500|-600|-color|-default)?$/i) ?? find(/(primary|accent|brand)/i);
  const textRaw = find(/^(--)?(fg|foreground|text|color-text|text-primary|text-color|color-fg)$/i) ?? find(/(text|foreground|fg)/i);
  const background = normalize(resolveVar(bgRaw ?? "", tokens)) ?? (tokens.tailwind?.darkMode === "class" ? "#0b0f14" : "#ffffff");
  const accent = normalize(resolveVar(accentRaw ?? "", tokens)) ?? tokenAccent(tokens) ?? (isDark(background) ? "#7c9cff" : "#2563eb");
  const text = ensureContrast(normalize(resolveVar(textRaw ?? "", tokens)) ?? readableTextOn(background), background);
  const surface = isDark(background) ? mix(background, "#ffffff", 0.07) : mix(background, "#000000", 0.04);
  const mono = tokens.fonts.find((f) => /mono|code/i.test(f)) ?? SYSTEM_MONO;
  return { background, surface, text, accent, mono };
}

function resolveVar(value: string, tokens: DesignTokens, depth = 0): string {
  const m = value.match(/^var\(--([a-zA-Z0-9_-]+)\)/);
  if (m && depth < 4) return resolveVar(tokens.customProperties[m[1]] ?? "", tokens, depth + 1);
  // Tailwind/shadcn "222.2 84% 4.9%" HSL triplets
  const hsl = value.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (hsl) return `hsl(${hsl[1]} ${hsl[2]}% ${hsl[3]}%)`;
  return value;
}

function tokenAccent(tokens: DesignTokens): string | undefined {
  const tw = tokens.tailwind?.themeColors;
  if (tw) {
    for (const key of ["primary", "accent", "brand", "primary-500", "brand-500", "DEFAULT"]) if (tw[key] && parseColor(tw[key])) return normalize(tw[key]);
  }
  for (const [k, v] of Object.entries(tokens.colors)) {
    if (/(primary|accent|brand)/i.test(k)) {
      const n = normalize(resolveVar(v, tokens));
      if (n && saturation(parseColor(n)!) > 0.25) return n;
    }
  }
  return undefined;
}

function normalize(c: string | undefined): string | undefined {
  if (!c) return undefined;
  const p = parseColor(c);
  if (!p || p.a < 0.4) return undefined;
  return toHex(p);
}

function uniqColors(colors: string[]): string[] {
  const out: string[] = [];
  for (const c of colors) {
    const n = normalize(c);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

function displayFamily(screens: Screen[]): string | undefined {
  // Approximation: family that appears on headings (we have no per-heading data), use the second most common family
  // when the primary family clearly dominates body text.
  const counts: Record<string, number> = {};
  for (const s of screens) for (const [f, n] of Object.entries(s.styles.fontFamilies)) counts[f] = (counts[f] ?? 0) + n;
  const ranked = topN(counts, 3);
  if (ranked.length >= 2 && ranked[1][1] > ranked[0][1] * 0.05 && !/mono|code/i.test(ranked[1][0])) return ranked[1][0];
  return ranked[0]?.[0];
}

function median(nums: number[]): number {
  if (!nums.length) return NaN;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function weightedAvg(rec: Record<string, number>): number | undefined {
  let total = 0;
  let sum = 0;
  for (const [k, w] of Object.entries(rec)) {
    const v = parseFloat(k);
    if (Number.isNaN(v)) continue;
    total += w;
    sum += v * w;
  }
  return total ? sum / total : undefined;
}

function share(rec: Record<string, number>, pred: (k: string) => boolean): number {
  let total = 0;
  let hit = 0;
  for (const [k, w] of Object.entries(rec)) {
    total += w;
    if (pred(k)) hit += w;
  }
  return total ? hit / total : 0;
}

/** Map a detected family to a CSS stack: the real family when Hyperframes can resolve it, else a generic stack. */
export function stackFor(family: string): string {
  const f = family.toLowerCase().replace(/["']/g, "").trim();
  if (isGoogleFont(f)) {
    const generic = /mono/.test(f) ? SYSTEM_MONO : /serif|playfair|merriweather|lora|garamond|fraunces|spectral|newsreader|literata|domine|vollkorn|bitter|slab/.test(f) && !/sans/.test(f) ? SYSTEM_SERIF : SYSTEM_SANS;
    return `"${family.replace(/["']/g, "").trim()}", ${generic}`;
  }
  if (/mono|code|courier|consolas|menlo|fira code|jetbrains|source code|ibm plex mono|roboto mono/.test(f)) return SYSTEM_MONO;
  if (/serif|georgia|times|playfair|merriweather|lora|garamond|crimson|fraunces|libre baskerville|spectral|newsreader/.test(f) && !/sans/.test(f)) return SYSTEM_SERIF;
  return SYSTEM_SANS;
}
